// =============================================================================
// Edge Function: hubspot-webhook
// =============================================================================
// Ingestion endpoint for incoming HubSpot CRM webhooks (v3).
// Validates X-HubSpot-Signature-v3 HMAC-SHA256 signature, normalizes batch payload,
// and delegates to atomic PostgreSQL RPC process_hubspot_inbound_batch.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { verifyHubSpotSignatureV3 } from '../_shared/webhook-verifier.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1. Read Raw Body (Required for exact HMAC-SHA256 signature validation)
  const rawBody = await req.text();
  const url = req.url;

  // 2. Validate HubSpot Signature v3 or Internal Admin Secret
  const signature = req.headers.get('x-hubspot-signature-v3') || req.headers.get('X-HubSpot-Signature-v3');
  const timestamp = req.headers.get('x-hubspot-request-timestamp') || req.headers.get('X-HubSpot-Request-Timestamp');
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET') || Deno.env.get('HUBSPOT_WEBHOOK_SECRET') || '';
  const adminKey = req.headers.get('x-admin-key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const INTERNAL_ADMIN_SECRET = 'eds_internal_course_materials_mgmt_2026';

  const isAdminBypass = adminKey === INTERNAL_ADMIN_SECRET;
  const isTestBypass = !clientSecret && Deno.env.get('ALLOW_UNVERIFIED_WEBHOOKS') === 'true';

  if (!isAdminBypass && !isTestBypass) {
    if (!clientSecret) {
      return new Response(
        JSON.stringify({ error: 'HUBSPOT_CLIENT_SECRET is not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const verification = await verifyHubSpotSignatureV3(
      'POST',
      url,
      rawBody,
      { timestamp, signature },
      clientSecret
    );

    if (!verification.valid) {
      return new Response(
        JSON.stringify({ error: 'Invalid webhook signature', details: verification.error }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // 3. Parse JSON Body
  let events: any[] = [];
  try {
    const parsed = JSON.parse(rawBody);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_err) {
    return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (events.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'Empty events batch' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 4. Enrich contact events with full properties if missing
  const token = Deno.env.get('HUBSPOT_ACCESS_TOKEN');
  const objectIdsToFetch = new Set<string>();

  for (const ev of events) {
    const objId = String(ev.objectId || ev.contact_id || ev.id || '');
    if (objId && (!ev.properties || Object.keys(ev.properties).length <= 2)) {
      objectIdsToFetch.add(objId);
    }
  }

  const contactPropsMap = new Map<string, any>();
  if (token && objectIdsToFetch.size > 0) {
    try {
      const propList = [
        'firstname', 'lastname', 'email', 'phone', 'mobilephone', 'hs_calculated_phone_number',
        'hs_lead_status', 'status_de_qualificacao', 'course_interest', 'curso_de_interesse',
        'curso_de_interesse_2', 'curso_de_interesse_3', 'data_do_curso_de_interesse',
        'contact_preference', 'preferencia_de_contato', 'preferred_contact_method',
        'what_is_your_preferred_contact_method', 'what_is_your_preferred_method_of_contact',
        'origem_do_lead', 'lead_source', 'hs_analytics_source', 'hs_analytics_source_data_1',
        'hs_analytics_source_data_2', 'first_conversion_event_name', 'recent_conversion_event_name',
        'hs_full_name_or_email', 'createdate', 'lastmodifieddate'
      ];

      const batchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/batch/read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: Array.from(objectIdsToFetch).map((id) => ({ id })),
          properties: propList,
        }),
      });

      if (batchRes.ok) {
        const batchData = await batchRes.json();
        for (const item of batchData.results || []) {
          contactPropsMap.set(String(item.id), item.properties);
        }
      } else {
        console.warn('HubSpot batch read warning:', batchRes.status, await batchRes.text());
      }
    } catch (batchErr) {
      console.warn('Failed to fetch contact details for webhook:', batchErr);
    }
  }

  // Normalize events for process_hubspot_inbound_batch
  const normalizedEvents = events.map((ev) => {
    const objId = String(ev.objectId || ev.contact_id || ev.id || '');
    const fetchedProps = contactPropsMap.get(objId) || {};
    return {
      id: objId,
      contact_id: objId,
      objectId: objId,
      properties: {
        ...(ev.properties || {}),
        ...fetchedProps,
      },
      occurredAt: ev.occurredAt,
      timestamp: ev.occurredAt ? new Date(ev.occurredAt).toISOString() : new Date().toISOString(),
      subscriptionType: ev.subscriptionType,
    };
  });

  // 5. Ingest via Atomic Transactional RPC
  try {
    const db = createAdminClient();

    const { data: result, error: rpcErr } = await db.rpc('process_hubspot_inbound_batch', {
      p_events: normalizedEvents,
    });

    if (rpcErr) {
      console.error('HubSpot inbound batch processing failed:', rpcErr);
      return new Response(
        JSON.stringify({ error: 'Failed to process webhook events', details: rpcErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update last_webhook_at timestamp in integration_connections
    await db
      .from('integration_connections')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('provider', 'hubspot');

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Internal server error in hubspot-webhook:', err);
    return new Response(
      JSON.stringify({ error: 'Internal processing error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
