// =============================================================================
// First Contact Router & Outcome Resolver (Domain & Service Foundation)
// =============================================================================
// Authoritative business rules for first-contact automation:
//
// 1. Meta / Instagram leads:
//    - Both Email and SMS are eligible if valid email and valid phone exist,
//      regardless of whether the lead selected contact_preference = 'email' or 'sms'.
//    - The selected contact_preference MUST remain preserved (not overwritten).
//    - If only valid email exists: Email eligible only.
//    - If only valid phone exists: SMS eligible only.
//    - If neither valid channel exists: ineligible (remains in Novo Lead with attention state).
//
// 2. Website leads (source = 'form' | source_detail = 'website'):
//    - Suppressed from automatic initial email and SMS.
//    - Remains in Novo Lead for manual client response.
//
// 3. Historical HubSpot / CSV imports:
//    - Excluded from automatic initial outreach.
//
// 4. Respondido Result Contract:
//    - At least one eligible channel accepted by provider -> move to Respondido.
//    - One accepted + one failed -> move to Respondido, retain partial channel failure.
//    - Both fail -> remain Novo Lead + First Contact Failure.
//    - Single valid channel accepted -> Respondido.
//    - Single valid channel fails -> remain Novo Lead.
// =============================================================================

export interface FirstContactLeadInput {
  id?: string;
  source?: string | null;
  source_detail?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_raw?: string | null;
  phone_e164?: string | null;
  contact_preference?: string | null;
}

export interface FirstContactEligibility {
  isEligible: boolean;
  eligibleChannels: ('email' | 'sms')[];
  preservedPreference: string;
  suppressedReason?: string;
  hasValidEmail: boolean;
  hasValidPhone: boolean;
}

export interface FirstContactOutcomeInput {
  attemptedChannels: ('email' | 'sms')[];
  channelResults: {
    email?: 'accepted' | 'failed';
    sms?: 'accepted' | 'failed';
  };
}

export interface FirstContactOutcome {
  targetStageCode: 'qualification' | 'capture'; // 'qualification' = Respondido, 'capture' = Novo Lead
  partialFailureVisible: boolean;
  failedChannels: ('email' | 'sms')[];
  acceptedChannels: ('email' | 'sms')[];
  firstContactAttentionState: boolean;
  summary: string;
}

export interface FirstContactRouterOptions {
  emailOnlyPhase?: boolean;
}

/**
 * Validates whether an email string is structurally valid for outreach.
 */
export function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  return trimmed.length > 3 && trimmed.includes('@') && trimmed.includes('.');
}

/**
 * Validates whether a phone number string is valid for SMS outreach.
 */
export function isValidPhone(phone?: string | null): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8;
}

/**
 * Evaluates first-contact outreach eligibility according to EDS HUB client rules.
 */
export function evaluateFirstContactEligibility(
  lead: FirstContactLeadInput,
  options?: FirstContactRouterOptions
): FirstContactEligibility {
  const preservedPreference = lead.contact_preference || 'email';
  const hasValidEmailAddr = isValidEmail(lead.email);
  const hasValidPhoneNum = isValidPhone(lead.phone_e164 || lead.phone_raw);

  // 1. Website leads: manual client response required
  const isWebsite =
    lead.source === 'form' ||
    lead.source === 'website' ||
    lead.source_detail === 'website' ||
    lead.source_detail === 'website-register' ||
    lead.source_detail === 'incomplete_registration' ||
    (lead.source_detail || '').toLowerCase().includes('website');

  if (isWebsite) {
    return {
      isEligible: false,
      eligibleChannels: [],
      preservedPreference,
      suppressedReason: 'Website leads require manual client initial response and are excluded from automated outreach.',
      hasValidEmail: hasValidEmailAddr,
      hasValidPhone: hasValidPhoneNum,
    };
  }

  // 2. Historical imports: HubSpot batch sync, CSV imports, legacy migrations
  const isHistorical =
    ['hubspot', 'csv_import', 'legacy_import', 'historical_migration'].includes(lead.source || '') ||
    Boolean(
      lead.source_detail &&
      ['hubspot_sync', 'hubspot_historical', 'hubspot_reconcile', 'csv_import', 'legacy_import', 'historical_migration'].includes(lead.source_detail)
    );

  if (isHistorical) {
    return {
      isEligible: false,
      eligibleChannels: [],
      preservedPreference,
      suppressedReason: 'Historical import lead is excluded from automatic initial outreach.',
      hasValidEmail: hasValidEmailAddr,
      hasValidPhone: hasValidPhoneNum,
    };
  }

  // 3. Test leads
  if (lead.source === 'test' || lead.source_detail === 'test') {
    return {
      isEligible: false,
      eligibleChannels: [],
      preservedPreference,
      suppressedReason: 'Test leads are excluded from automated live outreach.',
      hasValidEmail: hasValidEmailAddr,
      hasValidPhone: hasValidPhoneNum,
    };
  }

  // 4. Meta / Instagram advertising leads
  const isMeta =
    lead.source === 'meta' ||
    ['meta', 'facebook', 'instagram', 'fb', 'ig'].includes((lead.source || '').toLowerCase()) ||
    ['meta', 'facebook', 'instagram', 'fb', 'ig', 'meta_ad', 'instagram_ad'].includes((lead.source_detail || '').toLowerCase());

  if (isMeta) {
    if (options?.emailOnlyPhase) {
      // Batch 7.5 Email-Only Safe Activation: SMS is completely inactive
      if (hasValidEmailAddr) {
        return {
          isEligible: true,
          eligibleChannels: ['email'],
          preservedPreference,
          hasValidEmail: true,
          hasValidPhone: hasValidPhoneNum,
        };
      }

      if (hasValidPhoneNum) {
        return {
          isEligible: false,
          eligibleChannels: [],
          preservedPreference,
          suppressedReason: 'Meta lead has phone only; automated SMS is inactive in email-only phase.',
          hasValidEmail: false,
          hasValidPhone: true,
        };
      }

      return {
        isEligible: false,
        eligibleChannels: [],
        preservedPreference,
        suppressedReason: 'Meta lead has neither valid email nor valid phone number for initial outreach.',
        hasValidEmail: false,
        hasValidPhone: false,
      };
    }

    // Default multi-channel evaluation (for historical compatibility)
    const eligibleChannels: ('email' | 'sms')[] = [];
    if (hasValidEmailAddr) eligibleChannels.push('email');
    if (hasValidPhoneNum) eligibleChannels.push('sms');

    if (eligibleChannels.length === 0) {
      return {
        isEligible: false,
        eligibleChannels: [],
        preservedPreference,
        suppressedReason: 'Meta lead has neither valid email nor valid phone number for initial outreach.',
        hasValidEmail: false,
        hasValidPhone: false,
      };
    }

    return {
      isEligible: true,
      eligibleChannels,
      preservedPreference,
      hasValidEmail: hasValidEmailAddr,
      hasValidPhone: hasValidPhoneNum,
    };
  }

  // 5. Other sources (manual, google, etc.) default to preferred channel if valid
  const eligibleChannels: ('email' | 'sms')[] = [];
  if (preservedPreference === 'email' && hasValidEmailAddr) {
    eligibleChannels.push('email');
  } else if (preservedPreference === 'sms' && hasValidPhoneNum) {
    eligibleChannels.push('sms');
  }

  return {
    isEligible: eligibleChannels.length > 0,
    eligibleChannels,
    preservedPreference,
    suppressedReason: eligibleChannels.length === 0 ? 'No valid channel available matching contact preference.' : undefined,
    hasValidEmail: hasValidEmailAddr,
    hasValidPhone: hasValidPhoneNum,
  };
}

/**
 * Resolves the final pipeline stage and status following first-contact dispatch attempts.
 */
export function resolveFirstContactOutcome(input: FirstContactOutcomeInput): FirstContactOutcome {
  const { attemptedChannels, channelResults } = input;

  if (attemptedChannels.length === 0) {
    return {
      targetStageCode: 'capture', // Remains Novo Lead
      partialFailureVisible: false,
      failedChannels: [],
      acceptedChannels: [],
      firstContactAttentionState: true,
      summary: 'Nenhum canal elegível para envio inicial',
    };
  }

  const acceptedChannels: ('email' | 'sms')[] = [];
  const failedChannels: ('email' | 'sms')[] = [];

  for (const ch of attemptedChannels) {
    if (channelResults[ch] === 'accepted') {
      acceptedChannels.push(ch);
    } else {
      failedChannels.push(ch);
    }
  }

  // Rule: At least one attempted channel succeeded
  if (acceptedChannels.length > 0) {
    const hasPartialFailure = failedChannels.length > 0;
    const summary = hasPartialFailure
      ? `Primeiro contato aceito parcialmente (${acceptedChannels.join(', ')}), falha em: ${failedChannels.join(', ')}`
      : `Primeiro contato aceito via ${acceptedChannels.join(' e ')}`;

    return {
      targetStageCode: 'qualification', // Move to Respondido
      partialFailureVisible: hasPartialFailure,
      failedChannels,
      acceptedChannels,
      firstContactAttentionState: false,
      summary,
    };
  }

  // All attempted channels failed
  return {
    targetStageCode: 'capture', // Remains Novo Lead
    partialFailureVisible: false,
    failedChannels,
    acceptedChannels: [],
    firstContactAttentionState: true,
    summary: 'Falha no Primeiro Contato',
  };
}

/**
 * Batch 7.5 Helper: Evaluates Meta / Instagram lead eligibility specifically
 * under the Email-Only Safe Activation phase.
 */
export function evaluateMetaFirstContactEligibility(lead: FirstContactLeadInput): FirstContactEligibility {
  return evaluateFirstContactEligibility(lead, { emailOnlyPhase: true });
}
