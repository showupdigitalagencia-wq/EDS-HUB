import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authHeader = req.headers.get('Authorization');
  const adminKey = req.headers.get('x-admin-key');
  const INTERNAL_ADMIN_SECRET = Deno.env.get('INTERNAL_ADMIN_SECRET');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  let isAuthorized = false;
  if (
    (INTERNAL_ADMIN_SECRET && (adminKey === INTERNAL_ADMIN_SECRET || authHeader === `Bearer ${INTERNAL_ADMIN_SECRET}`)) ||
    (serviceRoleKey && (adminKey === serviceRoleKey || authHeader === `Bearer ${serviceRoleKey}`))
  ) {
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
    // Default: Check last_sync_at from integration_connections with 2-hour safety overlap or 72 hours max
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
      // Look back from last_sync_at minus 2-hour safety overlap, bounded to 72 hours
      const lastSyncMs = new Date(conn.last_sync_at).getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      lookbackTimestamp = Math.max(lastSyncMs - twoHoursMs, Date.now() - 72 * 60 * 60 * 1000);
    } else {
      // Default to 7 days lookback
      lookbackTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
    }

    // Cap lookback at 30 days max
    const maxLookback = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (lookbackTimestamp < maxLookback) {
      lookbackTimestamp = maxLookback;
    }

    // 2. Fetch all recently created or modified contacts with deterministic pagination
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
          {
            filters: [
              {
                propertyName: 'createdate',
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
          'hs_calculated_phone_number',
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
          'what_is_your_preferred_contact_method',
          'what_is_your_preferred_method_of_contact',
          'origem_do_lead',
          'lead_source',
          'hs_analytics_source',
          'hs_analytics_source_data_1',
          'hs_analytics_source_data_2',
          'first_conversion_event_name',
          'recent_conversion_event_name',
          'hs_full_name_or_email',
          'createdate',
          'lastmodifieddate',
        ],
        limit: 100,
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
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
    } while (afterCursor && allContacts.length < (body.max_contacts || 500));

    if (allContacts.length === 0) {
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
          reconciled: 0,
          contacts_scanned: 0,
          lookback_from: new Date(lookbackTimestamp).toISOString(),
          message: 'No modified contacts found in lookback window',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Normalize contacts and process reconciliation batch in PostgreSQL
    const hubspotSourceCreatedMap = new Map<string, string>();
    for (const c of allContacts) {
      if (c.properties?.createdate) {
        hubspotSourceCreatedMap.set(String(c.id), String(c.properties.createdate));
      }
    }

    const normalizedEvents = allContacts.map((c: any) => ({
      id: String(c.id),
      contact_id: String(c.id),
      objectId: c.id,
      properties: c.properties || {},
      timestamp: c.properties?.lastmodifieddate || c.updatedAt || new Date().toISOString(),
    }));

    const { data: batchResult, error: syncErr } = await db.rpc('process_hubspot_inbound_batch', {
      p_events: normalizedEvents,
    });

    if (syncErr) throw syncErr;

    // 4. Update integration_connections status (only on success)
    const nowIso = new Date().toISOString();
    await db
      .from('integration_connections')
      .update({
        last_sync_at: nowIso,
        last_reconciliation_at: nowIso,
        last_successful_api_call_at: nowIso,
      })
      .eq('provider', 'hubspot');

    // 5. Automatic First Contact Automation handoff for genuinely new Ad Leads
    if (batchResult && Array.isArray(batchResult.created_leads)) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseServiceKey) {
        for (const newLead of batchResult.created_leads) {
          const isProvenAd =
            newLead.source === 'meta' ||
            newLead.source_detail === 'meta_lead_ad' ||
            newLead.source_detail === 'facebook' ||
            newLead.source_detail === 'instagram';

          // AUTHORITATIVE SOURCE FRESHNESS CHECK:
          // The freshness decision MUST be based on the ORIGINAL SOURCE TIMESTAMP (HubSpot contact createdate),
          // NEVER on the local EDS created_at timestamp!
          // If source timestamp is missing, unparseable, or > 4 hours old -> fail safe -> suppress automated outreach.
          const contactId = String(newLead.hubspot_contact_id || newLead.external_id || '');
          const sourceCreatedRaw = hubspotSourceCreatedMap.get(contactId) || newLead.source_created_at || null;

          let isFreshLead = false;
          let sourceAgeHours: number | null = null;
          let sourceCreatedIso: string | undefined = undefined;

          if (sourceCreatedRaw) {
            const parsedMs = !isNaN(Number(sourceCreatedRaw)) && Number(sourceCreatedRaw) > 100000000000
              ? Number(sourceCreatedRaw)
              : Date.parse(String(sourceCreatedRaw));

            if (!isNaN(parsedMs) && parsedMs > 0) {
              sourceCreatedIso = new Date(parsedMs).toISOString();
              const diffMs = Date.now() - parsedMs;
              sourceAgeHours = diffMs / (1000 * 60 * 60);
              // Fresh lead: created at source within the last 4 hours (with 15 min clock skew tolerance)
              if (sourceAgeHours >= -0.25 && sourceAgeHours <= 4.0) {
                isFreshLead = true;
              }
            }
          }

          if (isProvenAd) {
            try {
              const intakePayload = {
                source: newLead.source || 'meta',
                source_detail: isFreshLead ? (newLead.source_detail || 'meta_lead_ad') : 'hubspot_reconcile',
                lead_id: newLead.lead_id,
                email: newLead.email,
                email_confirmation: newLead.email_confirmation,
                phone: newLead.phone,
                first_name: newLead.first_name,
                last_name: newLead.last_name,
                contact_preference: newLead.contact_preference,
                course_interest: newLead.course_interest,
                course_title: newLead.course_interest,
                is_new_lead: isFreshLead,
                source_created_at: sourceCreatedIso,
                idempotency_key: `hubspot_first_contact_${newLead.lead_id}`,
              };
              const intakeRes = await fetch(`${supabaseUrl}/functions/v1/process-lead-intake`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify(intakePayload),
              });
              if (!intakeRes.ok) {
                console.warn(`[hubspot-reconcile] process-lead-intake returned ${intakeRes.status}:`, await intakeRes.text());
              }
            } catch (intakeErr) {
              console.error('[hubspot-reconcile] Failed calling process-lead-intake:', intakeErr);
            }
          }
        }
      }
    }

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

