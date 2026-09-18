// =============================================================================
// Edge Function: hubspot-initial-sync
// =============================================================================
// Orchestrates Initial Base Synchronization:
// 1. Dry Run Mode: Previews matches, updates, creations, and conflicts without mutations.
// 2. Full Sync Mode: Cursor-based paginated ingestion via process_hubspot_inbound_batch.
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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const mode = body.mode === 'full_sync' ? 'full_sync' : 'dry_run';
  const cursor = body.cursor || null;
  const limit = Math.min(Math.max(Number(body.limit) || 100, 10), 100);

  // If test contacts array is supplied directly in request (e.g. unit/smoke testing or dry run preview)
  if (Array.isArray(body.test_contacts)) {
    if (mode === 'dry_run') {
      const { data: dryResult, error: dryErr } = await db.rpc('execute_hubspot_dry_run', {
        p_contacts: body.test_contacts,
      });

      if (dryErr) throw dryErr;
      return new Response(
        JSON.stringify({ success: true, mode: 'dry_run', ...dryResult }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      const { data: syncResult, error: syncErr } = await db.rpc('process_hubspot_inbound_batch', {
        p_events: body.test_contacts,
      });

      if (syncErr) throw syncErr;
      return new Response(
        JSON.stringify({ success: true, mode: 'full_sync', ...syncResult }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // Live HubSpot API Execution requires configured token
  if (!token) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'configuration_required',
        message: 'HubSpot Private App Token is not configured. Initial sync requires valid credentials.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    let url = `https://api.hubapi.com/crm/objects/2026-09/contacts?limit=${limit}&properties=firstname,lastname,email,phone,mobilephone,hs_lead_status,course_interest,lastmodifieddate`;
    if (cursor) {
      url += `&after=${encodeURIComponent(cursor)}`;
    }

    const apiRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(
        JSON.stringify({ error: `HubSpot API returned ${apiRes.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiData = await apiRes.json();
    const contacts = apiData.results || [];
    const nextCursor = apiData.paging?.next?.after || null;

    if (mode === 'dry_run') {
      const { data: dryResult, error: dryErr } = await db.rpc('execute_hubspot_dry_run', {
        p_contacts: contacts,
      });

      if (dryErr) throw dryErr;

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'dry_run',
          has_more: !!nextCursor,
          next_cursor: nextCursor,
          ...dryResult,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Full Sync Mode
    const { data: syncResult, error: syncErr } = await db.rpc('process_hubspot_inbound_batch', {
      p_events: contacts,
    });

    if (syncErr) throw syncErr;

    // Update connection status
    await db
      .from('integration_connections')
      .update({
        last_sync_at: new Date().toISOString(),
        last_successful_api_call_at: new Date().toISOString(),
      })
      .eq('provider', 'hubspot');

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'full_sync',
        has_more: !!nextCursor,
        next_cursor: nextCursor,
        ...syncResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error in hubspot-initial-sync:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
