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

  // 2. Validate HubSpot Signature v3
  const signature = req.headers.get('x-hubspot-signature-v3') || req.headers.get('X-HubSpot-Signature-v3');
  const timestamp = req.headers.get('x-hubspot-request-timestamp') || req.headers.get('X-HubSpot-Request-Timestamp');
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET') || Deno.env.get('HUBSPOT_WEBHOOK_SECRET') || '';

  const isTestBypass = !clientSecret && Deno.env.get('ALLOW_UNVERIFIED_WEBHOOKS') === 'true';

  if (!isTestBypass) {
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

  // 4. Ingest via Atomic Transactional RPC
  try {
    const db = createAdminClient();

    const { data: result, error: rpcErr } = await db.rpc('process_hubspot_inbound_batch', {
      p_events: events,
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
