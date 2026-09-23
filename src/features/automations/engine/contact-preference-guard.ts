import type { AutomationActionType, ContactPreference } from '../../../types/database';

export interface PreferenceGuardResult {
  allowed: boolean;
  skip_reason_code?:
    | 'CONTACT_PREFERENCE_MISMATCH'
    | 'WEBSITE_INITIAL_OUTREACH_SUPPRESSED'
    | 'HISTORICAL_IMPORT_SUPPRESSED'
    | 'TEST_LEAD_SUPPRESSED'
    | 'NO_VALID_EMAIL'
    | 'NO_VALID_PHONE';
  skip_reason_message?: string;
  channel?: 'email' | 'sms' | 'call';
}

export interface CheckPreferenceContext {
  source?: string | null;
  source_detail?: string | null;
  isInitialOutreach?: boolean;
  hasValidEmail?: boolean;
  hasValidPhone?: boolean;
}

/**
 * Contact Preference Guard:
 * Mandatory rule for any automated outreach action:
 * - Test leads: strictly suppressed from automatic outreach.
 * - Historical imports (hubspot_sync, hubspot_historical, csv_import): suppressed from automatic outreach.
 * - Website leads (source = 'form' | source_detail = 'website'): suppresses automated initial outreach.
 * - Meta leads: triggers both Email and SMS if channels are valid on initial outreach, regardless of preference.
 * - Ongoing sequences / standard actions:
 *   - send_email: allowed ONLY if lead.contact_preference === 'email'
 *   - send_sms: allowed ONLY if lead.contact_preference === 'sms'
 *   - create_call_task: allowed ONLY if lead.contact_preference === 'call'
 *   - create_task (generic): allowed regardless of preference (administrative task)
 */
export function checkContactPreference(
  actionType: AutomationActionType,
  leadPreference: ContactPreference | string | null | undefined,
  context?: CheckPreferenceContext
): PreferenceGuardResult {
  const pref = (leadPreference || 'email').toLowerCase();

  // Guard against automated outreach to test or historical import leads
  if (context) {
    if (context.source === 'test' || context.source_detail === 'test') {
      return {
        allowed: false,
        skip_reason_code: 'TEST_LEAD_SUPPRESSED',
        skip_reason_message: 'Test leads are excluded from automatic outreach',
      };
    }

    const isImport =
      Boolean(context.source && ['hubspot_sync', 'hubspot_historical', 'csv_import'].includes(context.source)) ||
      Boolean(context.source_detail && ['hubspot_sync', 'hubspot_historical', 'csv_import'].includes(context.source_detail));

    if (isImport) {
      return {
        allowed: false,
        skip_reason_code: 'HISTORICAL_IMPORT_SUPPRESSED',
        skip_reason_message: 'Historical import leads are excluded from automatic initial contact',
      };
    }
  }

  // If this is initial automated outreach, evaluate source-based routing rules
  if (context?.isInitialOutreach) {
    if (
      context.source === 'form' ||
      context.source === 'website' ||
      context.source_detail === 'website' ||
      context.source_detail === 'website-register'
    ) {
      return {
        allowed: false,
        skip_reason_code: 'WEBSITE_INITIAL_OUTREACH_SUPPRESSED',
        skip_reason_message: 'Website leads require manual client initial outreach',
      };
    }

    if (context.source === 'meta') {
      if (actionType === 'send_email') {
        if (context.hasValidEmail === false) {
          return {
            allowed: false,
            channel: 'email',
            skip_reason_code: 'NO_VALID_EMAIL',
            skip_reason_message: 'Meta lead does not have a valid email address',
          };
        }
        return { allowed: true, channel: 'email' };
      }

      if (actionType === 'send_sms') {
        if (context.hasValidPhone === false) {
          return {
            allowed: false,
            channel: 'sms',
            skip_reason_code: 'NO_VALID_PHONE',
            skip_reason_message: 'Meta lead does not have a valid phone number',
          };
        }
        return { allowed: true, channel: 'sms' };
      }

      if (actionType === 'create_call_task') {
        return {
          allowed: pref === 'call',
          channel: 'call',
          skip_reason_code: pref === 'call' ? undefined : 'CONTACT_PREFERENCE_MISMATCH',
          skip_reason_message: pref === 'call' ? undefined : `Lead prefers ${pref.toUpperCase()}`,
        };
      }

      return { allowed: true };
    }
  }

  // Standard ongoing sequence step check
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
