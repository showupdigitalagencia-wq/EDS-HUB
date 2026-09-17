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
