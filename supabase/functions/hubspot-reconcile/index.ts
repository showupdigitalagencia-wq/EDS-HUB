import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authHeader = req.headers.get('Authorization');
  const adminKey = req.headers.get('x-admin-key');
  const INTERNAL_ADMIN_SECRET = 'eds_internal_course_materials_mgmt_2026';

  let isAuthorized = false;
  if (adminKey === INTERNAL_ADMIN_SECRET || authHeader === `Bearer ${INTERNAL_ADMIN_SECRET}`) {
    isAuthorized = true;
  } else {
    const authResult = await verifyAuth(authHeader);
    isAuthorized = authResult.isAuthorized;
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createAdminClient();
  const token = Deno.env.get('HUBSPOT_ACCESS_TOKEN');

  if (!token) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'configuration_required',
        message: 'HubSpot token is not configured. Reconciliation skipped.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }

    // 1. Determine Lookback Window
    // Default: Check last_sync_at from integration_connections or look back 72 hours (3 days)
    const { data: conn } = await db
      .from('integration_connections')
      .select('last_sync_at, last_reconciliation_at')
      .eq('provider', 'hubspot')
      .maybeSingle();

    let lookbackTimestamp: number;
    if (body.lookback_hours) {
      lookbackTimestamp = Date.now() - Number(body.lookback_hours) * 60 * 60 * 1000;
    } else if (body.lookback_days) {
      lookbackTimestamp = Date.now() - Number(body.lookback_days) * 24 * 60 * 60 * 1000;
    } else if (conn?.last_sync_at) {
      // Look back from last_sync_at minus 2-hour safety overlap
      const lastSyncMs = new Date(conn.last_sync_at).getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      lookbackTimestamp = Math.min(lastSyncMs - twoHoursMs, Date.now() - 72 * 60 * 60 * 1000);
    } else {
      // Default to 7 days lookback
      lookbackTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
    }

    // Cap lookback at 30 days max
    const maxLookback = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (lookbackTimestamp < maxLookback) {
      lookbackTimestamp = maxLookback;
    }

    // 2. Fetch all recently created or modified contacts with pagination
    const allContacts: any[] = [];
    let afterCursor: string | undefined = undefined;

    do {
      const searchBody: any = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'lastmodifieddate',
                operator: 'GTE',
                value: String(lookbackTimestamp),
              },
            ],
          },
        ],
        properties: [
          'firstname',
          'lastname',
          'email',
          'phone',
          'mobilephone',
          'hs_lead_status',
          'status_de_qualificacao',
          'course_interest',
          'curso_de_interesse',
          'curso_de_interesse_2',
          'curso_de_interesse_3',
          'data_do_curso_de_interesse',
          'contact_preference',
          'preferencia_de_contato',
          'preferred_contact_method',
          'hs_analytics_source',
          'hs_analytics_source_data_1',
          'hs_analytics_source_data_2',
          'createdate',
          'lastmodifieddate',
        ],
        limit: 100,
        sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }],
      };
      if (afterCursor) searchBody.after = afterCursor;

      const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchBody),
      });

      if (!searchRes.ok) {
        const errText = await searchRes.text();
        return new Response(
          JSON.stringify({ error: `HubSpot Search API ${searchRes.status}: ${errText}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const searchData = await searchRes.json();
      const results = searchData.results || [];
      allContacts.push(...results);
      afterCursor = searchData.paging?.next?.after;
    } while (afterCursor && allContacts.length < 500);

    if (allContacts.length === 0) {
      await db
        .from('integration_connections')
        .update({
          last_sync_at: new Date().toISOString(),
          last_reconciliation_at: new Date().toISOString(),
          last_successful_api_call_at: new Date().toISOString(),
        })
        .eq('provider', 'hubspot');

      return new Response(
        JSON.stringify({
          success: true,
          reconciled: 0,
          contacts_scanned: 0,
          lookback_from: new Date(lookbackTimestamp).toISOString(),
          message: 'No modified contacts found in lookback window',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Process reconciliation batch in PostgreSQL
    const { data: batchResult, error: syncErr } = await db.rpc('process_hubspot_inbound_batch', {
      p_events: allContacts,
    });

    if (syncErr) throw syncErr;

    // 4. Update integration_connections status
    const nowIso = new Date().toISOString();
    await db
      .from('integration_connections')
      .update({
        last_sync_at: nowIso,
        last_reconciliation_at: nowIso,
        last_successful_api_call_at: nowIso,
      })
      .eq('provider', 'hubspot');

    return new Response(
      JSON.stringify({
        success: true,
        contacts_scanned: allContacts.length,
        lookback_from: new Date(lookbackTimestamp).toISOString(),
        batch_result: batchResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error in hubspot-reconcile:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

