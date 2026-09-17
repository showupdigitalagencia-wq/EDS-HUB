import type { AutomationStep } from '../../../types/database';
import type { LeadConditionContext } from './condition-evaluator';
import { evaluateCondition } from './condition-evaluator';
import { checkContactPreference } from './contact-preference-guard';

export const MAX_AUTOMATION_DEPTH = 10;

export interface StepSimulationResult {
  step_order: number;
  step_type: 'condition' | 'action' | 'wait';
  action_type?: string | null;
  status: 'completed' | 'skipped' | 'waiting' | 'failed';
  would_execute: boolean;
  would_skip: boolean;
  would_wait: boolean;
  channel?: 'email' | 'sms' | 'call';
  skip_reason_code?: string;
  skip_reason_message?: string;
  condition_result?: boolean;
  summary: string;
  details: Record<string, unknown>;
}

export interface AutomationSimulationReport {
  success: boolean;
  trigger_matched: boolean;
  depth_exceeded: boolean;
  steps_evaluated: StepSimulationResult[];
  error?: string;
}

/**
 * Generates canonical source_event_key for automation_events
 */
export function buildSourceEventKey(
  eventType: string,
  sourceRecordId: string,
  extra?: string
): string {
  switch (eventType) {
    case 'form_submitted':
      return `form_submission:${sourceRecordId}`;
    case 'lead_created':
      return `lead_created:${sourceRecordId}`;
    case 'qualification_status_changed':
      return `qualification_status:${sourceRecordId}:${extra || 'updated'}`;
    case 'pipeline_stage_changed':
      return `stage_history:${sourceRecordId}`;
    case 'tag_added':
      return `tag_added:${sourceRecordId}:${extra || 'added'}`;
    default:
      return `${eventType}:${sourceRecordId}`;
  }
}

/**
 * Generates canonical idempotency_key for automation_runs
 */
export function buildRunIdempotencyKey(
  automationId: string,
  version: number,
  leadId: string,
  triggerEventKey: string
): string {
  return `auto:${automationId}:v${version}:lead:${leadId}:evt:${triggerEventKey}`;
}

/**
 * Generates canonical idempotency_key for step actions
 */
export function buildActionIdempotencyKey(
  runId: string,
  stepOrder: number,
  actionType: string
): string {
  return `action:${runId}:step:${stepOrder}:${actionType}`;
}

/**
 * Pure simulator for Test Mode / dry-run evaluation.
 * Does NOT execute external network calls or persist DB updates.
 */
export function simulateAutomationExecution(
  steps: AutomationStep[],
  lead: LeadConditionContext,
  currentDepth = 0
): AutomationSimulationReport {
  if (currentDepth > MAX_AUTOMATION_DEPTH) {
    return {
      success: false,
      trigger_matched: true,
      depth_exceeded: true,
      steps_evaluated: [],
      error: 'AUTOMATION_DEPTH_EXCEEDED: Maximum automation nesting depth of 10 reached.',
    };
  }

  const results: StepSimulationResult[] = [];
  let blockSkipped = false;

  const sortedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);

  for (const step of sortedSteps) {
    if (step.step_type === 'condition') {
      const rule = {
        field: step.config.field || 'course_interest',
        operator: step.config.operator || 'equals',
        value: step.config.value,
      };

      const evalRes = evaluateCondition(lead, rule);

      if (!evalRes.matched) {
        blockSkipped = true; // condition failed, following then-actions are skipped
      }

      results.push({
        step_order: step.step_order,
        step_type: 'condition',
        status: evalRes.matched ? 'completed' : 'skipped',
        would_execute: evalRes.matched,
        would_skip: !evalRes.matched,
        would_wait: false,
        condition_result: evalRes.matched,
        skip_reason_code: evalRes.matched ? undefined : 'CONDITION_FAILED',
        skip_reason_message: evalRes.matched
          ? undefined
          : `Condition ${rule.field} ${rule.operator} "${rule.value}" not met`,
        summary: `Condition: ${rule.field} ${rule.operator} "${rule.value}" -> ${evalRes.matched ? 'Passed' : 'Not Met'}`,
        details: {
          field: rule.field,
          operator: rule.operator,
          expected: rule.value,
          actual: evalRes.actualValue,
        },
      });
      continue;
    }

    if (blockSkipped) {
      results.push({
        step_order: step.step_order,
        step_type: step.step_type,
        action_type: step.action_type,
        status: 'skipped',
        would_execute: false,
        would_skip: true,
        would_wait: false,
        skip_reason_code: 'PREVIOUS_CONDITION_FAILED',
        skip_reason_message: 'Skipped because a previous condition in this block evaluated to false',
        summary: `Action ${step.action_type || step.step_type} skipped (condition not met)`,
        details: {},
      });
      continue;
    }

    if (step.step_type === 'wait') {
      const durValue = step.config.duration_value ?? 1;
      const durUnit = step.config.duration_unit ?? 'days';
      results.push({
        step_order: step.step_order,
        step_type: 'wait',
        status: 'waiting',
        would_execute: true,
        would_skip: false,
        would_wait: true,
        summary: `Wait ${durValue} ${durUnit} (Server-side scheduled job)`,
        details: { duration_value: durValue, duration_unit: durUnit },
      });
      continue;
    }

    if (step.step_type === 'action') {
      const action = step.action_type || 'create_task';

      // Check contact preference guard
      const prefCheck = checkContactPreference(action, lead.contact_preference);

      if (!prefCheck.allowed) {
        results.push({
          step_order: step.step_order,
          step_type: 'action',
          action_type: action,
          status: 'skipped',
          would_execute: false,
          would_skip: true,
          would_wait: false,
          channel: prefCheck.channel,
          skip_reason_code: prefCheck.skip_reason_code,
          skip_reason_message: prefCheck.skip_reason_message,
          summary: `${action} skipped: ${prefCheck.skip_reason_message}`,
          details: {
            lead_contact_preference: lead.contact_preference,
            required_channel: prefCheck.channel,
          },
        });
        continue;
      }

      // Check Stop Automation action
      if (action === 'stop_automation') {
        results.push({
          step_order: step.step_order,
          step_type: 'action',
          action_type: 'stop_automation',
          status: 'completed',
          would_execute: true,
          would_skip: false,
          would_wait: false,
          summary: `Stop Automation (Run concludes cleanly)`,
          details: { reason: step.config.stop_reason || 'End of workflow reached' },
        });
        break; // Stop further steps
      }

      // Action would execute
      results.push({
        step_order: step.step_order,
        step_type: 'action',
        action_type: action,
        status: 'completed',
        would_execute: true,
        would_skip: false,
        would_wait: false,
        channel: prefCheck.channel,
        summary: `Execute action: ${action}`,
        details: { config: step.config },
      });
    }
  }

  return {
    success: true,
    trigger_matched: true,
    depth_exceeded: false,
    steps_evaluated: results,
  };
}

export interface StopConditionCheckResult {
  stopped: boolean;
  matchedCondition?: {
    type: string;
    operator: string;
    values?: string[];
  };
  reasonCode?: string;
  reasonMessage?: string;
}

/**
 * Evaluates sequence stop conditions against lead state.
 * Returns true if any configured stop condition is met.
 */
export function evaluateStopConditions(
  lead: LeadConditionContext,
  stopConditions: Array<{ type: string; operator: string; values?: string[] }> = []
): StopConditionCheckResult {
  if (!stopConditions || stopConditions.length === 0) {
    return { stopped: false };
  }

  for (const cond of stopConditions) {
    if (cond.type === 'qualification_status') {
      const current = lead.qualification_status;
      if (current && cond.values && cond.values.includes(current)) {
        return {
          stopped: true,
          matchedCondition: cond,
          reasonCode: 'QUALIFICATION_STATUS_CHANGED',
          reasonMessage: `Lead qualification status changed to "${current}"`,
        };
      }
    } else if (cond.type === 'pipeline_stage') {
      const currentStageId = lead.pipeline_stage_id;
      if (currentStageId && cond.values && cond.values.includes(currentStageId)) {
        return {
          stopped: true,
          matchedCondition: cond,
          reasonCode: 'PIPELINE_STAGE_CHANGED',
          reasonMessage: `Pipeline stage moved to "${lead.pipeline_stage_name || currentStageId}"`,
        };
      }
    } else if (cond.type === 'tag') {
      const leadTags = lead.tags || [];
      if (cond.values && cond.values.some((v) => leadTags.includes(v))) {
        return {
          stopped: true,
          matchedCondition: cond,
          reasonCode: 'TAG_ADDED',
          reasonMessage: `Stop tag added to lead`,
        };
      }
    }
  }

  return { stopped: false };
}

export interface NextActionInfo {
  actionType: string;
  actionLabel: string;
  scheduledAt: string | null;
  isImmediate: boolean;
  isPaused: boolean;
}

export function formatStepActionLabel(step: AutomationStep): string {
  if (step.step_type === 'wait') {
    const val = step.config?.duration_value || 1;
    const unit = step.config?.duration_unit || 'days';
    return `Wait ${val} ${unit}`;
  }
  if (step.step_type === 'condition') {
    return `Check ${step.config?.field || 'condition'}`;
  }
  switch (step.action_type) {
    case 'send_email':
      return step.config?.subject ? `Send email: "${step.config.subject.slice(0, 30)}..."` : 'Send email';
    case 'send_sms':
      return 'Send SMS follow-up';
    case 'create_call_task':
      return 'Create call task';
    case 'create_task':
      return step.config?.title ? `Create task: "${step.config.title}"` : 'Create CRM task';
    case 'add_tag':
      return `Add tag: ${step.config?.tag_name || 'tag'}`;
    case 'remove_tag':
      return `Remove tag: ${step.config?.tag_name || 'tag'}`;
    case 'move_pipeline_stage':
      return 'Move pipeline stage';
    case 'update_qualification_status':
      return `Update status: ${step.config?.qualification_status || ''}`;
    case 'stop_automation':
      return 'Stop sequence';
    default:
      return 'Execute next step';
  }
}

/**
 * Computes deterministic next action from run and step definitions without duplicate state.
 */
export function computeNextAction(
  runStatus: string,
  runControlStatus: string,
  currentStepOrder: number,
  steps: AutomationStep[] = [],
  pendingJob?: { run_at: string; status: string } | null
): NextActionInfo {
  // If run is paused
  if (runStatus === 'paused' || runControlStatus === 'paused') {
    return {
      actionType: 'resume_sequence',
      actionLabel: 'Resume sequence (Paused)',
      scheduledAt: null,
      isImmediate: false,
      isPaused: true,
    };
  }

  // If run is completed, failed, cancelled, or stopped_by_condition
  if (['completed', 'failed', 'cancelled', 'stopped_by_condition'].includes(runStatus)) {
    return {
      actionType: 'none',
      actionLabel: 'None (Concluded)',
      scheduledAt: null,
      isImmediate: false,
      isPaused: false,
    };
  }

  // Find next step to execute
  const nextStep = steps.find((s) => s.step_order === currentStepOrder);

  if (!nextStep) {
    return {
      actionType: 'conclude',
      actionLabel: 'Completing sequence',
      scheduledAt: null,
      isImmediate: true,
      isPaused: false,
    };
  }

  const stepLabel = formatStepActionLabel(nextStep);

  // If waiting
  if (runStatus === 'waiting' && pendingJob) {
    return {
      actionType: nextStep.action_type || nextStep.step_type,
      actionLabel: stepLabel,
      scheduledAt: pendingJob.run_at,
      isImmediate: false,
      isPaused: false,
    };
  }

  return {
    actionType: nextStep.action_type || nextStep.step_type,
    actionLabel: stepLabel,
    scheduledAt: new Date().toISOString(),
    isImmediate: true,
    isPaused: false,
  };
}

