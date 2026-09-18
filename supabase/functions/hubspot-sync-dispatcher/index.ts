// =============================================================================
// Edge Function: hubspot-sync-dispatcher
// =============================================================================
// Transactional Outbox worker: batches pending outbound events from
// integration_outbox and pushes updates to HubSpot CRM API with backoff retry.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // Authorize caller (scheduled job or authenticated app user)
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);
  if (!authResult.isAuthorized) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createAdminClient();
  const token = Deno.env.get('HUBSPOT_ACCESS_TOKEN');

  // Check connection status
  if (!token) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'configuration_required',
        message: 'HubSpot Private App Token is not configured. Outbox processing halted.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // 1. Fetch pending outbox records
    const nowIso = new Date().toISOString();
    const { data: records, error: fetchErr } = await db
      .from('integration_outbox')
      .select('*')
      .eq('integration', 'hubspot')
      .in('status', ['pending', 'failed'])
      .lte('next_retry_at', nowIso)
      .order('next_retry_at', { ascending: true })
      .limit(50);

    if (fetchErr) throw fetchErr;

    if (!records || records.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No pending outbox records' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Mark records as processing
    const recordIds = records.map((r: any) => r.id);
    await db
      .from('integration_outbox')
      .update({ status: 'processing' })
      .in('id', recordIds);

    let completedCount = 0;
    let failedCount = 0;

    // 3. Process each record
    for (const record of records) {
      try {
        let externalId = record.external_entity_id;

        // If no external ID, check if link was established in the meantime
        if (!externalId) {
          const { data: link } = await db
            .from('integration_entity_links')
            .select('external_entity_id')
            .eq('eds_entity_id', record.eds_entity_id)
            .eq('status', 'active')
            .single();

          if (link?.external_entity_id) {
            externalId = link.external_entity_id;
          }
        }

        let apiSuccess = false;
        let apiErrorMsg = '';

        if (externalId) {
          // Update existing contact via PATCH /crm/v3/objects/contacts/{contactId}
          const patchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${externalId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: record.payload }),
          });

          if (patchRes.ok) {
            apiSuccess = true;
          } else {
            const errBody = await patchRes.text();
            apiErrorMsg = `HubSpot API ${patchRes.status}: ${errBody}`;
          }
        } else {
          // Create new contact in HubSpot via POST /crm/v3/objects/contacts
          const postRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: record.payload }),
          });

          if (postRes.ok) {
            const postData = await postRes.json();
            externalId = postData.id;
            apiSuccess = true;

            // Link contact
            await db.from('integration_entity_links').upsert({
              integration: 'hubspot',
              entity_type: 'lead',
              eds_entity_id: record.eds_entity_id,
              external_entity_id: externalId,
              status: 'active',
              last_synced_hash: record.payload_hash,
              last_outbound_sync_at: new Date().toISOString(),
            }, { onConflict: 'integration,entity_type,eds_entity_id' });
          } else {
            const errBody = await postRes.text();
            apiErrorMsg = `HubSpot API ${postRes.status}: ${errBody}`;
          }
        }

        if (apiSuccess) {
          // Mark completed
          await db
            .from('integration_outbox')
            .update({
              status: 'completed',
              external_entity_id: externalId,
              processed_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', record.id);

          // Update link sync timestamp and hash
          if (externalId) {
            await db
              .from('integration_entity_links')
              .update({
                last_synced_hash: record.payload_hash,
                last_outbound_sync_at: new Date().toISOString(),
              })
              .eq('external_entity_id', externalId);
          }

          completedCount++;
        } else {
          // Handle failure & retry backoff
          const attempts = (record.attempt_count || 0) + 1;
          const maxAttempts = record.max_attempts || 5;
          const isDeadLetter = attempts >= maxAttempts;

          const backoffSec = Math.min(3600, Math.pow(2, attempts) * 5) + Math.floor(Math.random() * 3);
          const nextRetry = new Date(Date.now() + backoffSec * 1000).toISOString();

          await db
            .from('integration_outbox')
            .update({
              status: isDeadLetter ? 'dead_letter' : 'failed',
              attempt_count: attempts,
              next_retry_at: nextRetry,
              last_error: apiErrorMsg,
            })
            .eq('id', record.id);

          failedCount++;
        }
      } catch (recordErr: any) {
        await db
          .from('integration_outbox')
          .update({
            status: 'failed',
            attempt_count: (record.attempt_count || 0) + 1,
            last_error: recordErr.message,
          })
          .eq('id', record.id);

        failedCount++;
      }
    }

    // Update connection status
    await db
      .from('integration_connections')
      .update({
        last_outbound_sync_at: new Date().toISOString(),
        last_successful_api_call_at: completedCount > 0 ? new Date().toISOString() : undefined,
      })
      .eq('provider', 'hubspot');

    return new Response(
      JSON.stringify({
        success: true,
        processed: records.length,
        completed: completedCount,
        failed: failedCount,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error in hubspot-sync-dispatcher:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
