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
  course_interest?: string | null;
  is_historical?: boolean;
  hs_analytics_source?: string | null;
  hs_analytics_source_data_1?: string | null;
  hs_facebook_ad_clicked?: boolean | string | null;
  hs_facebook_click_id?: string | null;
  hs_facebookid?: string | null;
  lead_ad_prop0?: string | null;
  lead_ad_prop1?: string | null;
  lead_ad_prop2?: string | null;
  utm_source?: string | null;
}

export interface FirstContactEligibility {
  isEligible: boolean;
  eligibleChannels: ('email' | 'sms')[];
  preservedPreference: string;
  suppressedReason?: string;
  hasValidEmail: boolean;
  hasValidPhone: boolean;
  resolvedTemplate?: FirstContactTemplateResolution | null;
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

export interface FirstContactTemplateResolution {
  courseCode: string;
  courseName: string;
  templateKey: string;
  templateName: string;
  hasPdfAttachment: boolean;
  pdfAttachmentName?: string;
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
 * Evaluates whether a lead arriving through HubSpot or other channels
 * factually originates from Meta Lead Ads (Facebook / Instagram).
 */
export function isFactualMetaOrigin(data?: Record<string, any> | null): boolean {
  if (!data) return false;
  const source = String(data.source || '').toLowerCase();
  const sourceDetail = String(data.source_detail || '').toLowerCase();
  const analyticsSource = String(data.hs_analytics_source || '').toUpperCase();
  const drillDown1 = String(data.hs_analytics_source_data_1 || '').toLowerCase();
  const utmSource = String(data.utm_source || '').toLowerCase();

  // Direct Meta sources
  if (['meta', 'facebook', 'instagram', 'fb', 'ig'].includes(source)) return true;
  if (['meta', 'facebook', 'instagram', 'meta_ad', 'instagram_ad', 'hubspot_meta_lead_ad'].includes(sourceDetail)) return true;

  // Real HubSpot properties identifying Meta Lead Ads origin:
  if (analyticsSource === 'PAID_SOCIAL' && (drillDown1.includes('facebook') || drillDown1.includes('instagram'))) return true;
  if (data.hs_facebook_ad_clicked === true || data.hs_facebook_ad_clicked === 'true') return true;
  if (Boolean(data.hs_facebook_click_id || data.hs_facebookid)) return true;
  if (Boolean(data.lead_ad_prop0 || data.lead_ad_prop1 || data.lead_ad_prop2)) return true;
  if (['meta', 'facebook', 'instagram', 'fb', 'ig'].includes(utmSource)) return true;

  return false;
}

/**
 * Resolves the appropriate transactional email template for a given course interest.
 * Returns null if the course is unmapped or requires human review, which halts automated dispatch safely.
 */
export function resolveFirstContactTemplateForCourse(course?: string | null): FirstContactTemplateResolution | null {
  if (!course) {
    // Default generic intake template if no course specified
    return {
      courseCode: 'GENERIC',
      courseName: 'General Inquiry',
      templateKey: 'lead_intake_email',
      templateName: 'Lead Intake Email',
      hasPdfAttachment: false,
    };
  }

  const normalized = course.trim().toLowerCase();

  // 1. Zygomatic -> ZIT-01 -> Zygomatic Course Details with PDF attachment
  if (
    normalized === 'zygomatic' ||
    normalized === 'zit-01' ||
    normalized.includes('zygomatic')
  ) {
    return {
      courseCode: 'ZIT-01',
      courseName: 'Zygomatic Implant Training',
      templateKey: 'zygomatic_course_details',
      templateName: 'Zygomatic Course Details',
      hasPdfAttachment: true,
      pdfAttachmentName: 'Zygomatic Course (2).pdf',
    };
  }

  // 2. Intensive -> IDIT-01 -> Intensive Course Details
  if (
    normalized === 'intensive' ||
    normalized === 'idit-01' ||
    normalized.includes('intensive')
  ) {
    return {
      courseCode: 'IDIT-01',
      courseName: 'Intensive Dental Implant Training',
      templateKey: 'intensive_course_details',
      templateName: 'Intensive Course Details',
      hasPdfAttachment: false,
    };
  }

  // 3. Endodontic -> ET-01 -> Endodontic Course Details
  if (
    normalized === 'endodontic' ||
    normalized === 'et-01' ||
    normalized.includes('endodontic') ||
    normalized.includes('endo')
  ) {
    return {
      courseCode: 'ET-01',
      courseName: 'Endodontics Training',
      templateKey: 'endodontic_course_details',
      templateName: 'Endodontic Course Details',
      hasPdfAttachment: false,
    };
  }

  // 4. Wisdom -> WTT-01 -> Wisdom Course Details
  if (
    normalized === 'wisdom' ||
    normalized === 'wtt-01' ||
    normalized.includes('wisdom')
  ) {
    return {
      courseCode: 'WTT-01',
      courseName: 'Wisdom Teeth Training',
      templateKey: 'wisdom_course_details',
      templateName: 'Wisdom Course Details',
      hasPdfAttachment: false,
    };
  }

  // 5. Unmapped / Uncertain values: Advanced, Periodontal Plastic, Rehabilitation, Free courses
  // MUST NOT BE GUESSED - Returns null to block automated dispatch until human approval
  return null;
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
    lead.is_historical === true ||
    lead.source === 'hubspot_historical' ||
    lead.source_detail === 'hubspot_historical' ||
    ((lead.source === 'hubspot' || lead.source_detail === 'hubspot_sync') && !isFactualMetaOrigin(lead)) ||
    lead.source === 'csv_import' ||
    lead.source_detail === 'csv_import' ||
    lead.source === 'legacy_import' ||
    lead.source_detail === 'legacy_import' ||
    lead.source === 'historical_migration' ||
    lead.source_detail === 'historical_migration';


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

  // 4. Meta origin evaluation (Direct Meta Lead Ads OR Future HubSpot lead with factual Meta origin)
  const isDirectMeta =
    lead.source === 'meta' ||
    ['meta', 'facebook', 'instagram', 'fb', 'ig'].includes((lead.source || '').toLowerCase()) ||
    ['meta', 'facebook', 'instagram', 'fb', 'ig', 'meta_ad', 'instagram_ad'].includes((lead.source_detail || '').toLowerCase());

  const isMetaViaHubspot =
    (lead.source === 'hubspot' || lead.source_detail === 'hubspot_sync' || lead.source_detail === 'hubspot_meta_lead_ad') &&
    isFactualMetaOrigin(lead);

  const isMeta = isDirectMeta || isMetaViaHubspot;

  if (!isMeta) {
    return {
      isEligible: false,
      eligibleChannels: [],
      preservedPreference,
      suppressedReason: 'Manual, email-origin, and non-Meta leads are excluded from automated first contact.',
      hasValidEmail: hasValidEmailAddr,
      hasValidPhone: hasValidPhoneNum,
    };
  }

  // 5. Course Template Resolution: If course interest is provided, ensure it can be resolved
  let resolvedTemplate: FirstContactTemplateResolution | null = null;
  if (lead.course_interest) {
    resolvedTemplate = resolveFirstContactTemplateForCourse(lead.course_interest);
    if (!resolvedTemplate) {
      return {
        isEligible: false,
        eligibleChannels: [],
        preservedPreference,
        suppressedReason: `Unmapped or uncertain course interest "${lead.course_interest}" prevents automated outreach until approved.`,
        hasValidEmail: hasValidEmailAddr,
        hasValidPhone: hasValidPhoneNum,
      };
    }
  }

  // 6. Channel evaluation for eligible Meta leads
  if (options?.emailOnlyPhase) {
    // Batch 7.5 Email-Only Safe Activation: SMS is completely inactive
    if (hasValidEmailAddr) {
      return {
        isEligible: true,
        eligibleChannels: ['email'],
        preservedPreference,
        hasValidEmail: true,
        hasValidPhone: hasValidPhoneNum,
        resolvedTemplate,
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
        resolvedTemplate,
      };
    }

    return {
      isEligible: false,
      eligibleChannels: [],
      preservedPreference,
      suppressedReason: 'Meta lead has neither valid email nor valid phone number for initial outreach.',
      hasValidEmail: false,
      hasValidPhone: false,
      resolvedTemplate,
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
      resolvedTemplate,
    };
  }

  return {
    isEligible: true,
    eligibleChannels,
    preservedPreference,
    hasValidEmail: hasValidEmailAddr,
    hasValidPhone: hasValidPhoneNum,
    resolvedTemplate,
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
