// =============================================================================
// Edge Function: process-automation-events
// =============================================================================
// Event Bus dispatcher: finds pending events in automation_events,
// matches active automations, verifies idempotency, enqueues runs,
// and invokes execute-automation-run.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

interface ProcessEventsPayload {
  limit?: number;
  event_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Authorization
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    let payload: ProcessEventsPayload = {};
    try {
      payload = await req.json();
    } catch {
      // Empty body allowed
    }

    const db = createAdminClient();
    const batchLimit = Math.min(Math.max(Number(payload.limit) || 10, 1), 50);

    // 2. Fetch pending events
    let query = db
      .from('automation_events')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchLimit);

    if (payload.event_id) {
      query = db.from('automation_events').select('*').eq('id', payload.event_id);
    }

    const { data: events, error: evErr } = await query;

    if (evErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch automation events', details: evErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No pending automation events', processed_count: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const runsCreated: string[] = [];

    // 3. Process each event
    for (const event of events) {
      // Mark event as processing
      await db
        .from('automation_events')
        .update({ status: 'processing' })
        .eq('id', event.id);

      // Find active automations matching event_type
      const { data: automations } = await db
        .from('automations')
        .select('*, automation_versions(id, version, status)')
        .eq('trigger_type', event.event_type)
        .eq('status', 'active');

      if (!automations || automations.length === 0) {
        await db
          .from('automation_events')
          .update({ status: 'ignored', processed_at: new Date().toISOString() })
          .eq('id', event.id);
        continue;
      }

      for (const auto of automations) {
        // Evaluate trigger_config filters
        const trigCfg = auto.trigger_config || {};
        let matchesFilter = true;

        if (event.event_type === 'form_submitted') {
          if (trigCfg.form_id && trigCfg.form_id !== event.payload?.form_id) {
            matchesFilter = false;
          }
        } else if (event.event_type === 'qualification_status_changed') {
          if (trigCfg.to_status && trigCfg.to_status !== event.payload?.new_status) {
            matchesFilter = false;
          }
        } else if (event.event_type === 'pipeline_stage_changed') {
          if (trigCfg.to_stage_id && trigCfg.to_stage_id !== event.payload?.to_stage_id) {
            matchesFilter = false;
          }
        } else if (event.event_type === 'tag_added') {
          if (trigCfg.tag_id && trigCfg.tag_id !== event.payload?.tag_id) {
            matchesFilter = false;
          }
        }

        if (!matchesFilter) {
          continue;
        }

        // Locate published version
        const versions = auto.automation_versions || [];
        const publishedVer = versions.find((v: { status: string }) => v.status === 'published') || versions[0];

        if (!publishedVer) {
          console.warn(`[process-automation-events] No published version for automation ${auto.id}`);
          continue;
        }

        // Check Event Idempotency
        const idempotencyKey = `auto:${auto.id}:v${publishedVer.version}:lead:${event.lead_id}:evt:${event.source_event_key}`;

        const { data: existingRun } = await db
          .from('automation_runs')
          .select('id, status')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingRun) {
          // Idempotent: already enrolled
          continue;
        }

        // Determine recursion depth
        let depth = 0;
        let parentRunId: string | null = null;
        if (event.payload?.caused_by_automation_run_id) {
          parentRunId = String(event.payload.caused_by_automation_run_id);
          const { data: parentRun } = await db
            .from('automation_runs')
            .select('automation_depth')
            .eq('id', parentRunId)
            .maybeSingle();
          if (parentRun) {
            depth = (parentRun.automation_depth || 0) + 1;
          }
        }

        // Create new automation run
        const { data: newRun, error: createRunErr } = await db
          .from('automation_runs')
          .insert({
            automation_id: auto.id,
            automation_version_id: publishedVer.id,
            lead_id: event.lead_id,
            trigger_event_id: event.id,
            idempotency_key: idempotencyKey,
            parent_run_id: parentRunId,
            caused_by_automation_run_id: parentRunId,
            automation_depth: depth,
            status: 'pending',
            current_step_order: 1,
          })
          .select('id')
          .single();

        if (createRunErr) {
          console.error(`[process-automation-events] Error creating run for auto ${auto.id}:`, createRunErr);
          continue;
        }

        if (newRun) {
          runsCreated.push(newRun.id);

          // Execute run asynchronously via internal call
          try {
            const supabaseUrl = Deno.env.get('SUPABASE_URL');
            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

            await fetch(`${supabaseUrl}/functions/v1/execute-automation-run`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({ automation_run_id: newRun.id }),
            });
          } catch (execErr) {
            console.error(`[process-automation-events] Error invoking execute-automation-run:`, execErr);
          }
        }
      }

      // Mark event as processed
      await db
        .from('automation_events')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', event.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed_events: events.length,
        runs_created: runsCreated.length,
        run_ids: runsCreated,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[process-automation-events] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
