// =============================================================================
// Shared Automation Engine Logic for Edge Functions
// =============================================================================

export const MAX_AUTOMATION_DEPTH = 10;

export interface ConditionRule {
  field: string;
  operator: string;
  value?: string;
}

export interface LeadConditionContext {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_raw?: string | null;
  phone_e164?: string | null;
  contact_preference?: string | null;
  course_interest?: string | null;
  course_interests?: string[] | null;
  qualification_status?: string | null;
  pipeline_stage_id?: string | null;
  pipeline_stage_code?: string | null;
  pipeline_stage_name?: string | null;
  source?: string | null;
  source_detail?: string | null;
  tags?: string[] | null;
  form_id?: string | null;
  form_slug?: string | null;
}

export function evaluateCondition(
  lead: LeadConditionContext,
  rule: ConditionRule
): { matched: boolean; actualValue: unknown; expectedValue?: string } {
  const { field, operator, value } = rule;
  let actualValue: unknown = undefined;

  switch (field) {
    case 'contact_preference':
      actualValue = lead.contact_preference?.toLowerCase() || '';
      break;
    case 'course_interest':
      actualValue = lead.course_interest || '';
      break;
    case 'qualification_status':
      actualValue = lead.qualification_status || '';
      break;
    case 'pipeline_stage':
      actualValue = lead.pipeline_stage_code || lead.pipeline_stage_id || lead.pipeline_stage_name || '';
      break;
    case 'source':
      actualValue = lead.source?.toLowerCase() || '';
      break;
    case 'source_detail':
      actualValue = lead.source_detail || '';
      break;
    case 'tag':
      actualValue = lead.tags || [];
      break;
    case 'email exists':
      actualValue = lead.email;
      break;
    case 'phone exists':
      actualValue = lead.phone_e164 || lead.phone_raw;
      break;
    case 'form_id':
      actualValue = lead.form_id || lead.form_slug || '';
      break;
    default:
      actualValue = undefined;
  }

  const normalizedExpected = (value ?? '').trim().toLowerCase();

  switch (operator) {
    case 'equals': {
      const normalizedActual = String(actualValue ?? '').trim().toLowerCase();
      return {
        matched: normalizedActual === normalizedExpected,
        actualValue,
        expectedValue: value,
      };
    }
    case 'not_equals': {
      const normalizedActual = String(actualValue ?? '').trim().toLowerCase();
      return {
        matched: normalizedActual !== normalizedExpected,
        actualValue,
        expectedValue: value,
      };
    }
    case 'contains': {
      if (Array.isArray(actualValue)) {
        const containsItem = actualValue.some((item) =>
          String(item).trim().toLowerCase().includes(normalizedExpected)
        );
        return { matched: containsItem, actualValue, expectedValue: value };
      }
      const strVal = String(actualValue ?? '').toLowerCase();
      return {
        matched: strVal.includes(normalizedExpected),
        actualValue,
        expectedValue: value,
      };
    }
    case 'exists': {
      const exists =
        actualValue !== null &&
        actualValue !== undefined &&
        (Array.isArray(actualValue) ? actualValue.length > 0 : String(actualValue).trim() !== '');
      return { matched: exists, actualValue, expectedValue: value };
    }
    case 'not_exists': {
      const notExists =
        actualValue === null ||
        actualValue === undefined ||
        (Array.isArray(actualValue) ? actualValue.length === 0 : String(actualValue).trim() === '');
      return { matched: notExists, actualValue, expectedValue: value };
    }
    case 'in': {
      const allowedItems = (value ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      if (Array.isArray(actualValue)) {
        const hasAny = actualValue.some((item) =>
          allowedItems.includes(String(item).trim().toLowerCase())
        );
        return { matched: hasAny, actualValue, expectedValue: value };
      }

      const normalizedActual = String(actualValue ?? '').trim().toLowerCase();
      return {
        matched: allowedItems.includes(normalizedActual),
        actualValue,
        expectedValue: value,
      };
    }
    default:
      return { matched: false, actualValue, expectedValue: value };
  }
}

export function checkContactPreference(
  actionType: string,
  leadPreference: string | null | undefined
): { allowed: boolean; channel?: 'email' | 'sms' | 'call'; skip_reason_code?: string; skip_reason_message?: string } {
  const pref = (leadPreference || 'email').toLowerCase();

  if (actionType === 'send_email') {
    if (pref !== 'email') {
      return {
        allowed: false,
        channel: 'email',
        skip_reason_code: 'CONTACT_PREFERENCE_MISMATCH',
        skip_reason_message: `Lead prefers ${pref.toUpperCase()}`,
      };
    }
    return { allowed: true, channel: 'email' };
  }

  if (actionType === 'send_sms') {
    if (pref !== 'sms') {
      return {
        allowed: false,
        channel: 'sms',
        skip_reason_code: 'CONTACT_PREFERENCE_MISMATCH',
        skip_reason_message: `Lead prefers ${pref.toUpperCase()}`,
      };
    }
    return { allowed: true, channel: 'sms' };
  }

  if (actionType === 'create_call_task') {
    if (pref !== 'call') {
      return {
        allowed: false,
        channel: 'call',
        skip_reason_code: 'CONTACT_PREFERENCE_MISMATCH',
        skip_reason_message: `Lead prefers ${pref.toUpperCase()}`,
      };
    }
    return { allowed: true, channel: 'call' };
  }

  return { allowed: true };
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

