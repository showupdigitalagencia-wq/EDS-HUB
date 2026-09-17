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
import { evaluateStopConditions, type LeadConditionContext } from '../_shared/automation-evaluator.ts';

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

      // 3.1 Event-time Stop Condition Check on Active Runs for this Lead
      if (['qualification_status_changed', 'pipeline_stage_changed', 'tag_added'].includes(event.event_type)) {
        const { data: activeRuns } = await db
          .from('automation_runs')
          .select('id, automation_id, automations(id, name, automation_type, stop_conditions), automation_versions(id, stop_conditions)')
          .eq('lead_id', event.lead_id)
          .in('status', ['pending', 'running', 'waiting', 'paused']);

        if (activeRuns && activeRuns.length > 0) {
          // Fetch fresh lead context
          const { data: freshLead } = await db
            .from('leads')
            .select('*, pipeline_stages(id, code, name)')
            .eq('id', event.lead_id)
            .single();

          const { data: leadTags } = await db
            .from('lead_tags')
            .select('tag_id, tags(id, name, slug)')
            .eq('lead_id', event.lead_id);

          const tagNamesOrSlugs = (leadTags || []).map((lt: { tag_id: string; tags?: { name?: string; slug?: string } }) =>
            lt.tags?.slug || lt.tags?.name || lt.tag_id
          );

          if (freshLead) {
            const ctx: LeadConditionContext = {
              id: freshLead.id,
              first_name: freshLead.first_name,
              last_name: freshLead.last_name,
              email: freshLead.email,
              phone_raw: freshLead.phone_raw,
              phone_e164: freshLead.phone_e164,
              contact_preference: freshLead.contact_preference,
              course_interest: freshLead.course_interest,
              course_interests: freshLead.course_interests,
              qualification_status: freshLead.qualification_status,
              pipeline_stage_id: freshLead.pipeline_stage_id,
              pipeline_stage_code: (freshLead.pipeline_stages as { code?: string })?.code,
              pipeline_stage_name: (freshLead.pipeline_stages as { name?: string })?.name,
              source: freshLead.source,
              source_detail: freshLead.source_detail,
              tags: tagNamesOrSlugs,
            };

            for (const r of activeRuns) {
              const rawConds = (r.automations as any)?.stop_conditions || (r.automation_versions as any)?.stop_conditions || [];
              const stopConds = Array.isArray(rawConds) ? rawConds : [];
              const stopCheck = evaluateStopConditions(ctx, stopConds);

              if (stopCheck.stopped) {
                // Cancel pending jobs
                await db
                  .from('automation_jobs')
                  .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                  .eq('automation_run_id', r.id)
                  .in('status', ['pending', 'processing']);

                // Mark run as stopped_by_condition
                await db
                  .from('automation_runs')
                  .update({
                    status: 'stopped_by_condition',
                    run_control_status: 'stopped',
                    stop_reason: stopCheck.reasonMessage,
                    stop_reason_code: stopCheck.reasonCode,
                    stop_reason_message: stopCheck.reasonMessage,
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', r.id);

                await db.from('lead_activities').insert({
                  lead_id: freshLead.id,
                  automation_run_id: r.id,
                  activity_type: (r.automations as any)?.automation_type === 'sequence' ? 'sequence_stopped' : 'automation_completed',
                  actor_type: 'system',
                  summary: `Sequence stopped: ${(r.automations as any)?.name || 'Sequence'} (${stopCheck.reasonMessage})`,
                  metadata: {
                    stop_reason_code: stopCheck.reasonCode,
                    stop_reason_message: stopCheck.reasonMessage,
                  },
                });
              }
            }
          }
        }
      }

      // 3.2 Find active automations matching trigger event_type
      const { data: automations } = await db
        .from('automations')
        .select('*, automation_versions(id, version, status)')
        .eq('trigger_type', event.event_type)
        .eq('status', 'active');

      if (!automations || automations.length === 0) {
        await db
          .from('automation_events')
          .update({ status: 'processed', processed_at: new Date().toISOString() })
          .eq('id', event.id);
        continue;
      }

      for (const auto of automations) {
        // Guard against duplicate active enrollment
        const { data: existingActive } = await db
          .from('automation_runs')
          .select('id')
          .eq('automation_id', auto.id)
          .eq('lead_id', event.lead_id)
          .in('status', ['pending', 'running', 'waiting', 'paused'])
          .maybeSingle();

        if (existingActive) {
          // Already actively enrolled in this automation/sequence
          continue;
        }

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
