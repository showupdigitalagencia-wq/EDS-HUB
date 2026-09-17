// =============================================================================
// Edge Function: execute-automation-run
// =============================================================================
// Core executor for an individual automation run.
// Evaluates conditions, enforces contact preferences, executes actions,
// pauses at wait steps, and logs detailed execution history in automation_run_steps.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';
import { sendSms } from '../_shared/twilio-adapter.ts';
import { resolveSalutation } from '../_shared/salutation.ts';
import {
  evaluateCondition,
  checkContactPreference,
  evaluateStopConditions,
  MAX_AUTOMATION_DEPTH,
  type LeadConditionContext,
} from '../_shared/automation-evaluator.ts';

interface ExecuteRunPayload {
  automation_run_id: string;
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
    const payload: ExecuteRunPayload = await req.json();
    const runId = payload.automation_run_id;

    if (!runId) {
      return new Response(
        JSON.stringify({ error: 'Missing automation_run_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = createAdminClient();

    // 2. Fetch run with version and automation
    const { data: run, error: runErr } = await db
      .from('automation_runs')
      .select('*, automations(id, name, trigger_type, automation_type, stop_conditions), automation_versions(id, version, status, definition, stop_conditions)')
      .eq('id', runId)
      .single();

    if (runErr || !run) {
      return new Response(
        JSON.stringify({ error: 'Automation run not found', details: runErr?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Explicit Run Pause Guard
    if (run.status === 'paused' || run.run_control_status === 'paused') {
      return new Response(
        JSON.stringify({ success: true, message: 'Run is paused. No steps executed.', run_id: runId, is_paused: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If run already finished, stopped or cancelled, no-op
    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed' || run.status === 'stopped_by_condition') {
      return new Response(
        JSON.stringify({ success: true, message: `Run is already ${run.status}`, run_id: runId }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Loop & recursion depth protection
    if ((run.automation_depth || 0) > MAX_AUTOMATION_DEPTH) {
      await db
        .from('automation_runs')
        .update({
          status: 'failed',
          last_error: 'AUTOMATION_DEPTH_EXCEEDED: Maximum automation nesting depth of 10 reached.',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      await db.from('lead_activities').insert({
        lead_id: run.lead_id,
        automation_run_id: runId,
        activity_type: 'automation_failed',
        actor_type: 'system',
        summary: `Automation failed: Nesting depth exceeded (${run.automation_depth})`,
        metadata: { error_code: 'AUTOMATION_DEPTH_EXCEEDED' },
      });

      return new Response(
        JSON.stringify({ success: false, error: 'AUTOMATION_DEPTH_EXCEEDED', run_id: runId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Fetch lead data
    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*, pipeline_stages(id, code, name)')
      .eq('id', run.lead_id)
      .single();

    if (leadErr || !lead) {
      await db
        .from('automation_runs')
        .update({
          status: 'failed',
          last_error: 'Lead not found for automation run',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      return new Response(
        JSON.stringify({ error: 'Lead not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Fetch lead tags
    const { data: leadTags } = await db
      .from('lead_tags')
      .select('tag_id, tags(id, name, slug)')
      .eq('lead_id', lead.id);

    const tagNamesOrSlugs = (leadTags || []).map((lt: { tag_id: string; tags?: { name?: string; slug?: string } }) =>
      lt.tags?.slug || lt.tags?.name || lt.tag_id
    );

    const leadContext: LeadConditionContext = {
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone_raw: lead.phone_raw,
      phone_e164: lead.phone_e164,
      contact_preference: lead.contact_preference,
      course_interest: lead.course_interest,
      course_interests: lead.course_interests,
      qualification_status: lead.qualification_status,
      pipeline_stage_id: lead.pipeline_stage_id,
      pipeline_stage_code: (lead.pipeline_stages as { code?: string })?.code,
      pipeline_stage_name: (lead.pipeline_stages as { name?: string })?.name,
      source: lead.source,
      source_detail: lead.source_detail,
      tags: tagNamesOrSlugs,
    };

    // Stop conditions check at execution time
    const rawStopConds = run.automations?.stop_conditions || run.automation_versions?.stop_conditions || [];
    const stopConditions = Array.isArray(rawStopConds) ? rawStopConds : [];
    const initialStopCheck = evaluateStopConditions(leadContext, stopConditions);

    if (initialStopCheck.stopped) {
      await db
        .from('automation_jobs')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('automation_run_id', runId)
        .in('status', ['pending', 'processing']);

      await db
        .from('automation_runs')
        .update({
          status: 'stopped_by_condition',
          run_control_status: 'stopped',
          stop_reason: initialStopCheck.reasonMessage,
          stop_reason_code: initialStopCheck.reasonCode,
          stop_reason_message: initialStopCheck.reasonMessage,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      await db.from('lead_activities').insert({
        lead_id: lead.id,
        automation_run_id: runId,
        activity_type: run.automations?.automation_type === 'sequence' ? 'sequence_stopped' : 'automation_completed',
        actor_type: 'system',
        summary: `Sequence stopped: ${run.automations?.name || 'Sequence'} (${initialStopCheck.reasonMessage})`,
        metadata: {
          stop_reason_code: initialStopCheck.reasonCode,
          stop_reason_message: initialStopCheck.reasonMessage,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          status: 'stopped_by_condition',
          stop_reason_code: initialStopCheck.reasonCode,
          message: initialStopCheck.reasonMessage,
          run_id: runId,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Fetch steps for this version
    const { data: steps, error: stepsErr } = await db
      .from('automation_steps')
      .select('*')
      .eq('automation_version_id', run.automation_version_id)
      .order('step_order', { ascending: true });

    if (stepsErr || !steps || steps.length === 0) {
      await db
        .from('automation_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      return new Response(
        JSON.stringify({ success: true, message: 'No steps in version, marked completed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log automation_started milestone if starting from step 1
    if (run.current_step_order === 1 && run.status === 'pending') {
      await db.from('lead_activities').insert({
        lead_id: lead.id,
        automation_run_id: runId,
        activity_type: run.automations?.automation_type === 'sequence' ? 'sequence_started' : 'automation_started',
        actor_type: 'system',
        summary: `${run.automations?.automation_type === 'sequence' ? 'Sequence' : 'Automation'} started: ${run.automations?.name || 'Automation'} (v${run.automation_versions?.version || 1})`,
        metadata: {
          automation_id: run.automation_id,
          automation_type: run.automations?.automation_type || 'workflow',
          version: run.automation_versions?.version,
          trigger_type: run.automations?.trigger_type,
        },
      });

      await db
        .from('automation_runs')
        .update({ status: 'running', updated_at: new Date().toISOString() })
        .eq('id', runId);
    }

    // 6. Execute steps starting from current_step_order
    let isWaiting = false;
    let runTerminated = false;

    for (const step of steps) {
      if (step.step_order < run.current_step_order) {
        continue; // Already processed
      }

      // Re-fetch latest lead state to ensure execution-time freshness
      const { data: freshLead } = await db
        .from('leads')
        .select('*, pipeline_stages(id, code, name)')
        .eq('id', run.lead_id)
        .single();

      if (freshLead) {
        leadContext.qualification_status = freshLead.qualification_status;
        leadContext.pipeline_stage_id = freshLead.pipeline_stage_id;
        leadContext.pipeline_stage_code = (freshLead.pipeline_stages as { code?: string })?.code;
        leadContext.pipeline_stage_name = (freshLead.pipeline_stages as { name?: string })?.name;
      }

      // Re-check stop conditions before each step (execution time)
      const stepStopCheck = evaluateStopConditions(leadContext, stopConditions);
      if (stepStopCheck.stopped) {
        await db
          .from('automation_jobs')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('automation_run_id', runId)
          .in('status', ['pending', 'processing']);

        await db
          .from('automation_runs')
          .update({
            status: 'stopped_by_condition',
            run_control_status: 'stopped',
            stop_reason: stepStopCheck.reasonMessage,
            stop_reason_code: stepStopCheck.reasonCode,
            stop_reason_message: stepStopCheck.reasonMessage,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId);

        await db.from('lead_activities').insert({
          lead_id: lead.id,
          automation_run_id: runId,
          activity_type: run.automations?.automation_type === 'sequence' ? 'sequence_stopped' : 'automation_completed',
          actor_type: 'system',
          summary: `Sequence stopped: ${run.automations?.name || 'Sequence'} (${stepStopCheck.reasonMessage})`,
          metadata: {
            stop_reason_code: stepStopCheck.reasonCode,
            stop_reason_message: stepStopCheck.reasonMessage,
          },
        });

        runTerminated = true;
        break;
      }

      // Legacy step-level stop check
      if (step.config?.stop_on_qualification_status && Array.isArray(step.config.stop_on_qualification_status)) {
        if (leadContext.qualification_status && step.config.stop_on_qualification_status.includes(leadContext.qualification_status as any)) {
          await db
            .from('automation_runs')
            .update({
              status: 'stopped_by_condition',
              run_control_status: 'stopped',
              stop_reason: `Qualification status changed to "${leadContext.qualification_status}"`,
              stop_reason_code: 'QUALIFICATION_STATUS_CHANGED',
              stop_reason_message: `Qualification status changed to "${leadContext.qualification_status}"`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId);

          runTerminated = true;
          break;
        }
      }

      // 6.1 Condition Step
      if (step.step_type === 'condition') {
        const rule = {
          field: step.config?.field || 'course_interest',
          operator: step.config?.operator || 'equals',
          value: step.config?.value,
        };

        const evalResult = evaluateCondition(leadContext, rule);

        await db.from('automation_run_steps').insert({
          automation_run_id: runId,
          automation_step_id: step.id,
          step_order: step.step_order,
          step_type: 'condition',
          status: evalResult.matched ? 'completed' : 'skipped',
          condition_input: { rule, actual: evalResult.actualValue },
          condition_result: evalResult.matched,
          skip_reason_code: evalResult.matched ? null : 'CONDITION_FAILED',
          skip_reason_message: evalResult.matched ? null : `Condition not met: ${rule.field} ${rule.operator} ${rule.value || ''}`,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });

        if (!evalResult.matched) {
          // If condition fails, conclude cleanly
          await db
            .from('automation_runs')
            .update({
              status: 'completed',
              stop_reason: `Condition not met at step ${step.step_order}`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId);

          runTerminated = true;
          break;
        }

        // Advance current step order
        await db
          .from('automation_runs')
          .update({ current_step_order: step.step_order + 1, updated_at: new Date().toISOString() })
          .eq('id', runId);
        continue;
      }

      // 6.2 Wait Step
      if (step.step_type === 'wait') {
        const durVal = Number(step.config?.duration_value) || 1;
        const durUnit = step.config?.duration_unit || 'days';
        const now = new Date();
        let runAtMs = now.getTime();

        if (durUnit === 'minutes') runAtMs += durVal * 60 * 1000;
        else if (durUnit === 'hours') runAtMs += durVal * 60 * 60 * 1000;
        else runAtMs += durVal * 24 * 60 * 60 * 1000; // days default

        const runAtIso = new Date(runAtMs).toISOString();

        // Create waiting step run
        const { data: stepRun } = await db
          .from('automation_run_steps')
          .insert({
            automation_run_id: runId,
            automation_step_id: step.id,
            step_order: step.step_order,
            step_type: 'wait',
            status: 'waiting',
            scheduled_resume_at: runAtIso,
            started_at: now.toISOString(),
          })
          .select('id')
          .single();

        // Create scheduled job in automation_jobs
        if (stepRun) {
          await db.from('automation_jobs').insert({
            automation_run_id: runId,
            automation_run_step_id: stepRun.id,
            lead_id: lead.id,
            run_at: runAtIso,
            status: 'pending',
          });
        }

        // Put run into waiting state and advance current_step_order
        await db
          .from('automation_runs')
          .update({
            status: 'waiting',
            current_step_order: step.step_order + 1,
            updated_at: now.toISOString(),
          })
          .eq('id', runId);

        isWaiting = true;
        break; // Stop synchronous loop; wait job will resume later
      }

      // 6.3 Action Step
      if (step.step_type === 'action') {
        const action = step.action_type || 'create_task';

        // 1. Strict Contact Preference Guard
        const prefCheck = checkContactPreference(action, lead.contact_preference);
        if (!prefCheck.allowed) {
          // Skip action due to contact preference mismatch
          await db.from('automation_run_steps').insert({
            automation_run_id: runId,
            automation_step_id: step.id,
            step_order: step.step_order,
            step_type: 'action',
            action_type: action,
            status: 'skipped',
            skip_reason_code: prefCheck.skip_reason_code,
            skip_reason_message: prefCheck.skip_reason_message,
            input_data: { lead_contact_preference: lead.contact_preference },
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          });

          await db
            .from('automation_runs')
            .update({ current_step_order: step.step_order + 1, updated_at: new Date().toISOString() })
            .eq('id', runId);
          continue;
        }

        // 2. Stop Automation Action
        if (action === 'stop_automation') {
          await db.from('automation_run_steps').insert({
            automation_run_id: runId,
            automation_step_id: step.id,
            step_order: step.step_order,
            step_type: 'action',
            action_type: 'stop_automation',
            status: 'completed',
            input_data: { stop_reason: step.config?.stop_reason || 'Stopped by sequence action' },
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          });

          await db
            .from('automation_runs')
            .update({
              status: 'completed',
              stop_reason: step.config?.stop_reason || 'Sequence stop action executed',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId);

          runTerminated = true;
          break;
        }

        // 3. Create run step record
        const { data: stepRun } = await db
          .from('automation_run_steps')
          .insert({
            automation_run_id: runId,
            automation_step_id: step.id,
            step_order: step.step_order,
            step_type: 'action',
            action_type: action,
            status: 'running',
            input_data: step.config || {},
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        const stepRunId = stepRun?.id;

        // 4. Action Idempotency, Provider Reconciliation & Execution
        try {
          if (action === 'send_email') {
            const recipient = lead.email ? lead.email.trim().toLowerCase() : '';
            if (!recipient) {
              throw new Error('Lead has no valid email address');
            }

            // Check if already sent or accepted by provider (reconciliation)
            const actionIdempotencyKey = `auto_msg:${runId}:${step.step_order}:email`;
            const { data: existingMsg } = await db
              .from('outbound_messages')
              .select('id, status, provider_message_id')
              .or(`automation_run_step_id.eq.${stepRunId},idempotency_key.eq.${actionIdempotencyKey}`)
              .maybeSingle();

            if (existingMsg && (existingMsg.status === 'sent' || existingMsg.provider_message_id)) {
              // Reconciled with provider: do NOT resend
              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  output_data: { note: 'Already sent / reconciled with provider', message_id: existingMsg.id, provider_message_id: existingMsg.provider_message_id },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            } else {
              const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'team@expertdentalsolutions.org';
              const salutation = resolveSalutation(lead.last_name, lead.first_name, 'Doc');
              const rawSubject = step.config?.subject || 'Important update from Expert Dental Solutions';
              const rawBody = step.config?.body || '<p>Hello {{salutation}}, thank you for connecting with us.</p>';
              const subject = rawSubject.replace(/{{salutation}}/g, salutation).replace(/{{first_name}}/g, lead.first_name || '');
              const html = rawBody.replace(/{{salutation}}/g, salutation).replace(/{{first_name}}/g, lead.first_name || '');

              const sendRes = await sendEmail({
                from: fromEmail,
                to: recipient,
                subject,
                html,
                idempotencyKey: actionIdempotencyKey,
              });

              if (!sendRes.success) {
                throw new Error(sendRes.errorMessage || 'Failed to send email via Resend');
              }

              // Record to outbound_messages
              await db.from('outbound_messages').insert({
                lead_id: lead.id,
                channel: 'email',
                provider: 'resend',
                recipient,
                template_key: step.config?.template_id || 'automation_email',
                subject_snapshot: subject,
                body_snapshot: html,
                status: 'sent',
                provider_message_id: sendRes.messageId,
                idempotency_key: actionIdempotencyKey,
                attempt_count: 1,
                sent_at: new Date().toISOString(),
                automation_run_id: runId,
                automation_run_step_id: stepRunId,
              });

              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  provider: 'resend',
                  output_data: { provider_message_id: sendRes.messageId },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            }
          } else if (action === 'send_sms') {
            const recipientPhone = lead.phone_e164 || lead.phone_raw;
            if (!recipientPhone) {
              throw new Error('Lead has no valid phone number');
            }

            // Check if already sent or accepted by provider (reconciliation)
            const actionIdempotencyKey = `auto_msg:${runId}:${step.step_order}:sms`;
            const { data: existingSms } = await db
              .from('outbound_messages')
              .select('id, status, provider_message_id')
              .or(`automation_run_step_id.eq.${stepRunId},idempotency_key.eq.${actionIdempotencyKey}`)
              .maybeSingle();

            if (existingSms && (existingSms.status === 'sent' || existingSms.provider_message_id)) {
              // Reconciled with provider: do NOT resend
              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  output_data: { note: 'Already sent / reconciled with provider', message_id: existingSms.id, provider_message_id: existingSms.provider_message_id },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            } else {
              const salutation = resolveSalutation(lead.last_name, lead.first_name, 'Doc');
              const rawMessage = step.config?.message || 'Hello {{salutation}}, thank you for contacting Expert Dental Solutions.';
              const body = rawMessage.replace(/{{salutation}}/g, salutation).replace(/{{first_name}}/g, lead.first_name || '');

              const sendRes = await sendSms({
                to: recipientPhone,
                body,
              });

              if (!sendRes.success) {
                throw new Error(sendRes.errorMessage || 'Failed to send SMS via Twilio');
              }

              // Record to outbound_messages
              await db.from('outbound_messages').insert({
                lead_id: lead.id,
                channel: 'sms',
                provider: 'twilio',
                recipient: recipientPhone,
                template_key: 'automation_sms',
                body_snapshot: body,
                status: 'sent',
                provider_message_id: sendRes.messageId,
                idempotency_key: actionIdempotencyKey,
                attempt_count: 1,
                sent_at: new Date().toISOString(),
                automation_run_id: runId,
                automation_run_step_id: stepRunId,
              });

              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  provider: 'twilio',
                  output_data: { provider_message_id: sendRes.messageId },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            }
          } else if (action === 'create_call_task' || action === 'create_task') {
            const taskType = action === 'create_call_task' ? 'call' : (step.config?.task_type || 'general');
            const title = step.config?.title || (action === 'create_call_task' ? 'Call Lead' : 'CRM Follow-up');
            const description = step.config?.description || `Created by ${run.automations?.name || 'Sequence'}`;

            // Check if task already exists for this step run
            const { data: existingTask } = await db
              .from('tasks')
              .select('id')
              .or(`automation_run_step_id.eq.${stepRunId},and(automation_run_id.eq.${runId},task_type.eq.${taskType})`)
              .maybeSingle();

            if (!existingTask) {
              const { data: newTask } = await db
                .from('tasks')
                .insert({
                  lead_id: lead.id,
                  task_type: taskType,
                  title,
                  description,
                  status: 'pending',
                  created_by: 'system',
                  automation_run_id: runId,
                  automation_run_step_id: stepRunId,
                })
                .select('id')
                .single();

              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  output_data: { task_id: newTask?.id, task_type: taskType },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            } else {
              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  output_data: { task_id: existingTask.id, note: 'Already created (idempotent)' },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            }
          } else if (action === 'add_tag') {
            const tagId = step.config?.tag_id;
            if (tagId) {
              // Check if already assigned
              const { data: existingTag } = await db
                .from('lead_tags')
                .select('tag_id')
                .eq('lead_id', lead.id)
                .eq('tag_id', tagId)
                .maybeSingle();

              if (!existingTag) {
                await db.from('lead_tags').insert({
                  lead_id: lead.id,
                  tag_id: tagId,
                });
              }

              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  output_data: { tag_id: tagId, was_existing: Boolean(existingTag) },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            }
          } else if (action === 'remove_tag') {
            const tagId = step.config?.tag_id;
            if (tagId) {
              await db
                .from('lead_tags')
                .delete()
                .eq('lead_id', lead.id)
                .eq('tag_id', tagId);

              await db
                .from('automation_run_steps')
                .update({
                  status: 'completed',
                  output_data: { tag_id: tagId, action: 'removed' },
                  completed_at: new Date().toISOString(),
                })
                .eq('id', stepRunId);
            }
          } else if (action === 'move_pipeline_stage') {
            const newStageId = step.config?.pipeline_stage_id;
            if (newStageId) {
              if (lead.pipeline_stage_id === newStageId) {
                // Idempotent: already at requested stage
                await db
                  .from('automation_run_steps')
                  .update({
                    status: 'completed',
                    output_data: { note: 'Already in stage (idempotent)', stage_id: newStageId },
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', stepRunId);
              } else {
                // Update lead stage
                await db
                  .from('leads')
                  .update({ pipeline_stage_id: newStageId, updated_at: new Date().toISOString() })
                  .eq('id', lead.id);

                // Insert stage history
                await db.from('lead_stage_history').insert({
                  lead_id: lead.id,
                  from_stage_id: lead.pipeline_stage_id,
                  to_stage_id: newStageId,
                  change_reason: 'auto_after_intake',
                });

                leadContext.pipeline_stage_id = newStageId;

                await db
                  .from('automation_run_steps')
                  .update({
                    status: 'completed',
                    output_data: { from_stage_id: lead.pipeline_stage_id, to_stage_id: newStageId },
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', stepRunId);
              }
            }
          } else if (action === 'update_qualification_status') {
            const newStatus = step.config?.qualification_status;
            if (newStatus) {
              if (lead.qualification_status === newStatus) {
                // Idempotent: already at requested status
                await db
                  .from('automation_run_steps')
                  .update({
                    status: 'completed',
                    output_data: { note: 'Already at status (idempotent)', qualification_status: newStatus },
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', stepRunId);
              } else {
                await db
                  .from('leads')
                  .update({ qualification_status: newStatus, updated_at: new Date().toISOString() })
                  .eq('id', lead.id);

                leadContext.qualification_status = newStatus;

                await db
                  .from('automation_run_steps')
                  .update({
                    status: 'completed',
                    output_data: { qualification_status: newStatus },
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', stepRunId);
              }
            }
          }

          // Advance current step order
          await db
            .from('automation_runs')
            .update({ current_step_order: step.step_order + 1, updated_at: new Date().toISOString() })
            .eq('id', runId);
        } catch (actionErr) {
          const errMsg = actionErr instanceof Error ? actionErr.message : 'Unknown action error';
          console.error(`[execute-automation-run] Action failed at step ${step.step_order}:`, errMsg);

          await db
            .from('automation_run_steps')
            .update({
              status: 'failed',
              error_code: 'ACTION_FAILED',
              error_message: errMsg,
              completed_at: new Date().toISOString(),
            })
            .eq('id', stepRunId);

          await db
            .from('automation_runs')
            .update({
              status: 'failed',
              last_error: `Step ${step.step_order} (${action}) failed: ${errMsg}`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId);

          await db.from('lead_activities').insert({
            lead_id: lead.id,
            automation_run_id: runId,
            activity_type: 'automation_failed',
            actor_type: 'system',
            summary: `Automation failed at step ${step.step_order} (${action}): ${errMsg.slice(0, 200)}`,
            metadata: { step_order: step.step_order, action, error: errMsg },
          });

          return new Response(
            JSON.stringify({ success: false, error: errMsg, failed_step: step.step_order }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // 7. Complete run if not waiting and not prematurely stopped
    if (!isWaiting && !runTerminated) {
      await db
        .from('automation_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      await db.from('lead_activities').insert({
        lead_id: lead.id,
        automation_run_id: runId,
        activity_type: 'automation_completed',
        actor_type: 'system',
        summary: `Automation completed: ${run.automations?.name || 'Automation'} (v${run.automation_versions?.version || 1})`,
        metadata: { automation_id: run.automation_id, version: run.automation_versions?.version },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        status: isWaiting ? 'waiting' : (runTerminated ? 'completed' : 'completed'),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[execute-automation-run] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
