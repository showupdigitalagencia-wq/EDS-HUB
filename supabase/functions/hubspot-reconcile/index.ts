// =============================================================================
// Edge Function: hubspot-reconcile
// =============================================================================
// Periodic safety-net reconciliation: fetches recently updated HubSpot contacts,
// compares mapped hashes against integration_entity_links, and repairs drift.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

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
    // Look back 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'lastmodifieddate',
                operator: 'GTE',
                value: String(oneDayAgo),
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
          'course_interest',
          'curso_de_interesse',
          'curso_de_interesse_2',
          'curso_de_interesse_3',
          'data_do_curso_de_interesse',
          'status_de_qualificacao',
          'hs_analytics_source',
          'hs_analytics_source_data_1',
          'hs_analytics_source_data_2',
          'createdate',
          'lastmodifieddate',
        ],
        limit: 100,
      }),
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return new Response(
        JSON.stringify({ error: `HubSpot Search API ${searchRes.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const searchData = await searchRes.json();
    const contacts = searchData.results || [];

    if (contacts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, reconciled: 0, message: 'No delta contacts in past 24h' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process reconciliation batch
    const { data: result, error: syncErr } = await db.rpc('process_hubspot_inbound_batch', {
      p_events: contacts,
    });

    if (syncErr) throw syncErr;

    // Update connection status
    await db
      .from('integration_connections')
      .update({
        last_reconciliation_at: new Date().toISOString(),
        last_successful_api_call_at: new Date().toISOString(),
      })
      .eq('provider', 'hubspot');

    return new Response(
      JSON.stringify({ success: true, contacts_scanned: contacts.length, ...result }),
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
