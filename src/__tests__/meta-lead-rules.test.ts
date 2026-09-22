import { describe, it, expect } from 'vitest';

/**
 * Specification Logic Model for Meta / Instagram Advertising Leads
 * and Website Form Rules (Sprint Contract)
 */
interface LeadInput {
  source: 'meta' | 'google' | 'manual' | 'test' | 'form';
  source_detail?: string | null;
  contact_preference: 'email' | 'sms' | 'call';
  email?: string | null;
  phone_raw?: string | null;
  phone_e164?: string | null;
}

interface ChannelEligibility {
  emailEligible: boolean;
  smsEligible: boolean;
  attemptOutreach: boolean;
  reasons: string[];
}

interface DispatchResult {
  emailSent?: boolean;
  smsSent?: boolean;
}

interface StageProgressionOutcome {
  targetStage: 'novo_lead' | 'respondido';
  firstContactFailure: boolean;
  partialFailureNotice?: 'email_failed' | 'sms_failed' | null;
}

function evaluateInitialOutreachEligibility(lead: LeadInput): ChannelEligibility {
  // Website Form Rule: Website leads must NOT receive an automatic first response
  if (lead.source === 'form') {
    return {
      emailEligible: false,
      smsEligible: false,
      attemptOutreach: false,
      reasons: ['website_leads_require_manual_response'],
    };
  }

  // Meta / Instagram Advertising Lead Rule
  if (lead.source === 'meta') {
    const hasValidEmail = Boolean(lead.email && lead.email.includes('@') && lead.email.includes('.'));
    const hasValidPhone = Boolean(lead.phone_e164 || (lead.phone_raw && lead.phone_raw.replace(/\D/g, '').length >= 10));

    // Preference is preserved, but initial contact uses BOTH if available
    const emailEligible = hasValidEmail;
    const smsEligible = hasValidPhone;

    return {
      emailEligible,
      smsEligible,
      attemptOutreach: emailEligible || smsEligible,
      reasons: [
        ...(emailEligible ? ['valid_email_present'] : ['missing_valid_email']),
        ...(smsEligible ? ['valid_phone_present'] : ['missing_valid_phone']),
      ],
    };
  }

  // Default non-Meta behavior follows selected preference
  return {
    emailEligible: lead.contact_preference === 'email' && Boolean(lead.email),
    smsEligible: lead.contact_preference === 'sms' && Boolean(lead.phone_raw || lead.phone_e164),
    attemptOutreach: true,
    reasons: ['standard_preference_routing'],
  };
}

function deriveStageProgression(
  lead: LeadInput,
  eligibility: ChannelEligibility,
  dispatchResult: DispatchResult
): StageProgressionOutcome {
  // Website leads always enter and remain in Novo Lead
  if (lead.source === 'form') {
    return {
      targetStage: 'novo_lead',
      firstContactFailure: false,
      partialFailureNotice: null,
    };
  }

  // If neither channel was eligible
  if (!eligibility.attemptOutreach) {
    return {
      targetStage: 'novo_lead',
      firstContactFailure: true,
      partialFailureNotice: null,
    };
  }

  const emailAttempted = eligibility.emailEligible;
  const smsAttempted = eligibility.smsEligible;

  const emailSuccess = emailAttempted && Boolean(dispatchResult.emailSent);
  const smsSuccess = smsAttempted && Boolean(dispatchResult.smsSent);

  // Both attempted
  if (emailAttempted && smsAttempted) {
    if (emailSuccess && smsSuccess) {
      return {
        targetStage: 'respondido',
        firstContactFailure: false,
        partialFailureNotice: null,
      };
    }
    if (emailSuccess && !smsSuccess) {
      return {
        targetStage: 'respondido',
        firstContactFailure: false,
        partialFailureNotice: 'sms_failed',
      };
    }
    if (!emailSuccess && smsSuccess) {
      return {
        targetStage: 'respondido',
        firstContactFailure: false,
        partialFailureNotice: 'email_failed',
      };
    }
    // Both failed
    return {
      targetStage: 'novo_lead',
      firstContactFailure: true,
      partialFailureNotice: null,
    };
  }

  // Only email attempted
  if (emailAttempted && !smsAttempted) {
    return {
      targetStage: emailSuccess ? 'respondido' : 'novo_lead',
      firstContactFailure: !emailSuccess,
      partialFailureNotice: null,
    };
  }

  // Only SMS attempted
  if (!emailAttempted && smsAttempted) {
    return {
      targetStage: smsSuccess ? 'respondido' : 'novo_lead',
      firstContactFailure: !smsSuccess,
      partialFailureNotice: null,
    };
  }

  return {
    targetStage: 'novo_lead',
    firstContactFailure: true,
    partialFailureNotice: null,
  };
}

describe('Meta / Instagram Lead Rules & Website Lead Rules Specification', () => {
  describe('Channel Eligibility & Contact Preference Preservation', () => {
    it('Meta lead with preference=email and valid email + phone triggers BOTH email and SMS while preserving preference', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'email',
        email: 'dr.smith@example.com',
        phone_raw: '(407) 555-1234',
        phone_e164: '+14075551234',
      };

      const eligibility = evaluateInitialOutreachEligibility(lead);

      // Both channels eligible
      expect(eligibility.emailEligible).toBe(true);
      expect(eligibility.smsEligible).toBe(true);
      expect(eligibility.attemptOutreach).toBe(true);

      // Selected preference is NOT overwritten
      expect(lead.contact_preference).toBe('email');
    });

    it('Meta lead with preference=sms and valid email + phone triggers BOTH SMS and email while preserving preference', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'sms',
        email: 'dr.alvarez@example.com',
        phone_raw: '(305) 555-9876',
        phone_e164: '+13055559876',
      };

      const eligibility = evaluateInitialOutreachEligibility(lead);

      expect(eligibility.smsEligible).toBe(true);
      expect(eligibility.emailEligible).toBe(true);
      expect(eligibility.attemptOutreach).toBe(true);

      // Selected preference is NOT overwritten
      expect(lead.contact_preference).toBe('sms');
    });

    it('Meta lead with preference=email and valid email only triggers email only (no SMS)', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'email',
        email: 'dr.miller@example.com',
        phone_raw: null,
        phone_e164: null,
      };

      const eligibility = evaluateInitialOutreachEligibility(lead);

      expect(eligibility.emailEligible).toBe(true);
      expect(eligibility.smsEligible).toBe(false);
      expect(eligibility.attemptOutreach).toBe(true);
    });

    it('Meta lead with preference=sms and valid phone only triggers SMS only (no email)', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'sms',
        email: null,
        phone_raw: '+14075558888',
        phone_e164: '+14075558888',
      };

      const eligibility = evaluateInitialOutreachEligibility(lead);

      expect(eligibility.emailEligible).toBe(false);
      expect(eligibility.smsEligible).toBe(true);
      expect(eligibility.attemptOutreach).toBe(true);
    });

    it('Meta lead with neither valid email nor valid phone attempts no outreach and flags attention', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'email',
        email: null,
        phone_raw: null,
        phone_e164: null,
      };

      const eligibility = evaluateInitialOutreachEligibility(lead);

      expect(eligibility.emailEligible).toBe(false);
      expect(eligibility.smsEligible).toBe(false);
      expect(eligibility.attemptOutreach).toBe(false);

      const progression = deriveStageProgression(lead, eligibility, {});
      expect(progression.targetStage).toBe('novo_lead');
      expect(progression.firstContactFailure).toBe(true);
    });
  });

  describe('Stage Progression (Respondido Rule)', () => {
    it('promotes to Respondido when both email and SMS succeed', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'email',
        email: 'doc@example.com',
        phone_e164: '+14075550001',
      };
      const eligibility = evaluateInitialOutreachEligibility(lead);
      const outcome = deriveStageProgression(lead, eligibility, { emailSent: true, smsSent: true });

      expect(outcome.targetStage).toBe('respondido');
      expect(outcome.firstContactFailure).toBe(false);
      expect(outcome.partialFailureNotice).toBeNull();
    });

    it('promotes to Respondido when email succeeds and SMS fails, retaining visible partial failure', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'email',
        email: 'doc@example.com',
        phone_e164: '+14075550002',
      };
      const eligibility = evaluateInitialOutreachEligibility(lead);
      const outcome = deriveStageProgression(lead, eligibility, { emailSent: true, smsSent: false });

      expect(outcome.targetStage).toBe('respondido');
      expect(outcome.firstContactFailure).toBe(false);
      expect(outcome.partialFailureNotice).toBe('sms_failed');
    });

    it('promotes to Respondido when SMS succeeds and email fails, retaining visible partial failure', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'sms',
        email: 'doc@example.com',
        phone_e164: '+14075550003',
      };
      const eligibility = evaluateInitialOutreachEligibility(lead);
      const outcome = deriveStageProgression(lead, eligibility, { emailSent: false, smsSent: true });

      expect(outcome.targetStage).toBe('respondido');
      expect(outcome.firstContactFailure).toBe(false);
      expect(outcome.partialFailureNotice).toBe('email_failed');
    });

    it('remains in Novo Lead and marks First Contact Failure when both email and SMS fail', () => {
      const lead: LeadInput = {
        source: 'meta',
        contact_preference: 'email',
        email: 'doc@example.com',
        phone_e164: '+14075550004',
      };
      const eligibility = evaluateInitialOutreachEligibility(lead);
      const outcome = deriveStageProgression(lead, eligibility, { emailSent: false, smsSent: false });

      expect(outcome.targetStage).toBe('novo_lead');
      expect(outcome.firstContactFailure).toBe(true);
    });
  });

  describe('Website Lead Rule', () => {
    it('website form lead never receives automatic email or SMS and remains in Novo Lead', () => {
      const lead: LeadInput = {
        source: 'form',
        source_detail: 'website-form',
        contact_preference: 'email',
        email: 'web.doc@example.com',
        phone_raw: '(407) 555-9999',
        phone_e164: '+14075559999',
      };

      const eligibility = evaluateInitialOutreachEligibility(lead);

      // Automatic outreach must be disabled for website leads
      expect(eligibility.emailEligible).toBe(false);
      expect(eligibility.smsEligible).toBe(false);
      expect(eligibility.attemptOutreach).toBe(false);

      const outcome = deriveStageProgression(lead, eligibility, {});
      expect(outcome.targetStage).toBe('novo_lead');
      expect(outcome.firstContactFailure).toBe(false);
    });
  });
});
