// =============================================================================
// Edge Function: test-automation-run
// =============================================================================
// Dry-run simulation for Test Mode in the Automation Builder.
// Simulates condition evaluations, contact preference guards, and action channels
// against an actual lead's data without sending emails, sending SMS,
// modifying the lead, or altering the database.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import {
  evaluateCondition,
  checkContactPreference,
  type LeadConditionContext,
} from '../_shared/automation-evaluator.ts';

interface TestPayload {
  automation_id: string;
  version_id?: string;
  lead_id: string;
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
    const payload: TestPayload = await req.json();

    if (!payload.automation_id || !payload.lead_id) {
      return new Response(
        JSON.stringify({ error: 'Missing automation_id or lead_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = createAdminClient();

    // 2. Fetch lead
    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*, pipeline_stages(id, code, name)')
      .eq('id', payload.lead_id)
      .single();

    if (leadErr || !lead) {
      return new Response(
        JSON.stringify({ error: 'Lead not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch lead tags
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

    // 3. Fetch steps
    let versionId = payload.version_id;

    if (!versionId) {
      const { data: ver } = await db
        .from('automation_versions')
        .select('id')
        .eq('automation_id', payload.automation_id)
        .order('version', { ascending: false })
        .limit(1)
        .single();

      versionId = ver?.id;
    }

    const { data: steps, error: stepsErr } = await db
      .from('automation_steps')
      .select('*')
      .eq('automation_version_id', versionId)
      .order('step_order', { ascending: true });

    if (stepsErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch automation steps', details: stepsErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Dry-run simulation (pure evaluation, zero DB mutations)
    const reportSteps = [];
    let blockSkipped = false;

    for (const step of (steps || [])) {
      if (step.step_type === 'condition') {
        const rule = {
          field: step.config?.field || 'course_interest',
          operator: step.config?.operator || 'equals',
          value: step.config?.value,
        };

        const res = evaluateCondition(leadContext, rule);
        if (!res.matched) {
          blockSkipped = true;
        }

        reportSteps.push({
          step_order: step.step_order,
          step_type: 'condition',
          status: res.matched ? 'passed' : 'failed',
          would_execute: res.matched,
          would_skip: !res.matched,
          condition_result: res.matched,
          summary: `Condition: ${rule.field} ${rule.operator} "${rule.value || ''}" -> ${res.matched ? 'Passed' : 'Failed'}`,
          details: { field: rule.field, operator: rule.operator, expected: rule.value, actual: res.actualValue },
        });
        continue;
      }

      if (blockSkipped) {
        reportSteps.push({
          step_order: step.step_order,
          step_type: step.step_type,
          action_type: step.action_type,
          status: 'skipped',
          would_execute: false,
          would_skip: true,
          skip_reason: 'Previous condition in this branch evaluated to false',
          summary: `${step.action_type || step.step_type} skipped (condition not met)`,
        });
        continue;
      }

      if (step.step_type === 'wait') {
        reportSteps.push({
          step_order: step.step_order,
          step_type: 'wait',
          status: 'waiting',
          would_execute: true,
          would_skip: false,
          summary: `Would wait ${step.config?.duration_value || 1} ${step.config?.duration_unit || 'days'} (server-side job)`,
          details: { duration_value: step.config?.duration_value || 1, duration_unit: step.config?.duration_unit || 'days' },
        });
        continue;
      }

      if (step.step_type === 'action') {
        const action = step.action_type || 'create_task';
        const prefCheck = checkContactPreference(action, lead.contact_preference);

        if (!prefCheck.allowed) {
          reportSteps.push({
            step_order: step.step_order,
            step_type: 'action',
            action_type: action,
            status: 'skipped',
            would_execute: false,
            would_skip: true,
            channel: prefCheck.channel,
            skip_reason_code: prefCheck.skip_reason_code,
            skip_reason: prefCheck.skip_reason_message,
            summary: `${action} SKIPPED: ${prefCheck.skip_reason_message}`,
            details: { lead_preference: lead.contact_preference, action },
          });
          continue;
        }

        if (action === 'stop_automation') {
          reportSteps.push({
            step_order: step.step_order,
            step_type: 'action',
            action_type: 'stop_automation',
            status: 'completed',
            would_execute: true,
            would_skip: false,
            summary: 'Would stop automation cleanly',
          });
          break;
        }

        reportSteps.push({
          step_order: step.step_order,
          step_type: 'action',
          action_type: action,
          status: 'ready',
          would_execute: true,
          would_skip: false,
          channel: prefCheck.channel,
          summary: `Would execute action: ${action} (${prefCheck.channel ? 'Channel: ' + prefCheck.channel : 'CRM update'})`,
          details: step.config || {},
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: true,
        lead: {
          id: lead.id,
          name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.email,
          email: lead.email,
          phone: lead.phone_e164 || lead.phone_raw,
          contact_preference: lead.contact_preference,
          course_interest: lead.course_interest,
          qualification_status: lead.qualification_status,
        },
        steps_count: steps?.length || 0,
        report: reportSteps,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[test-automation-run] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
