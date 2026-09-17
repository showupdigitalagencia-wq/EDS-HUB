import type { AutomationActionType, ContactPreference } from '../../../types/database';

export interface PreferenceGuardResult {
  allowed: boolean;
  skip_reason_code?: 'CONTACT_PREFERENCE_MISMATCH';
  skip_reason_message?: string;
  channel?: 'email' | 'sms' | 'call';
}

/**
 * Contact Preference Guard:
 * Mandatory rule for any automated outreach action:
 * - send_email: allowed ONLY if lead.contact_preference === 'email'
 * - send_sms: allowed ONLY if lead.contact_preference === 'sms'
 * - create_call_task: allowed ONLY if lead.contact_preference === 'call'
 * - create_task (generic): allowed regardless of preference (administrative task)
 * - All other actions (tags, stage, wait, stop): allowed regardless of preference
 */
export function checkContactPreference(
  actionType: AutomationActionType,
  leadPreference: ContactPreference | string | null | undefined
): PreferenceGuardResult {
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

  // Generic task or CRM state changes are not outreach messages
  return { allowed: true };
}
