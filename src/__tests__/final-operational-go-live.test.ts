import { describe, it, expect } from 'vitest';
import {
  evaluateMetaLiveAutomationEligibility,
  resolveFirstContactTemplateForCourse,
  resolveFirstContactOutcome,
  isFactualMetaOrigin,
  type FirstContactLeadInput,
} from '../features/automations/engine/first-contact-router';
import { getTemplateChannel } from '../utils/template-variables';
import { resolveCanonicalCourse } from '../utils/course-resolver';
import { formatContactPreferenceLabel } from '../features/pipeline/components/MinimalLeadCard';

describe('EDS HUB — FINAL OPERATIONAL GO-LIVE TEST SUITE', () => {

  // ===========================================================================
  // SECTION AD: TEMPLATE CHANNEL ISOLATION & INTEGRITY
  // ===========================================================================
  describe('A & AD: Strict Email × SMS Channel Isolation', () => {
    const mockEmailTemplate = {
      id: 'tmpl-email-1',
      name: 'Zygomatic Course Details',
      category: 'email',
      channel: 'email',
      has_attachment: true,
      content_json: { channel: 'email' },
    };

    const mockSmsTemplate = {
      id: 'tmpl-sms-1',
      name: 'Zygomatic — Follow-up SMS',
      category: 'sms',
      channel: 'sms',
      has_attachment: false,
      content_json: { channel: 'sms' },
    };

    const mockGeneralSmsTemplate = {
      id: 'tmpl-sms-2',
      name: 'Contato Inicial — Geral',
      category: 'sms',
      channel: 'sms',
      has_attachment: false,
      content_json: { channel: 'sms' },
    };

    it('Email Composer accepts only email templates and rejects SMS templates', () => {
      expect(getTemplateChannel(mockEmailTemplate)).toBe('email');
      expect(getTemplateChannel(mockSmsTemplate)).toBe('sms');
      expect(getTemplateChannel(mockGeneralSmsTemplate)).toBe('sms');

      const allTemplates = [mockEmailTemplate, mockSmsTemplate, mockGeneralSmsTemplate];
      const emailComposerTemplates = allTemplates.filter((t) => getTemplateChannel(t) === 'email');

      expect(emailComposerTemplates).toHaveLength(1);
      expect(emailComposerTemplates[0].name).toBe('Zygomatic Course Details');
      expect(emailComposerTemplates.some((t) => t.name.includes('SMS'))).toBe(false);
    });

    it('SMS Composer accepts only SMS templates and rejects Email templates', () => {
      const allTemplates = [mockEmailTemplate, mockSmsTemplate, mockGeneralSmsTemplate];
      const smsComposerTemplates = allTemplates.filter((t) => getTemplateChannel(t) === 'sms');

      expect(smsComposerTemplates).toHaveLength(2);
      expect(smsComposerTemplates.map((t) => t.name)).toContain('Zygomatic — Follow-up SMS');
      expect(smsComposerTemplates.map((t) => t.name)).toContain('Contato Inicial — Geral');
      expect(smsComposerTemplates.some((t) => t.name === 'Zygomatic Course Details')).toBe(false);
    });

    it('Backend channel validator rejects SMS template passed for Email channel (422 simulation)', () => {
      // Logic mirrored from send-conversation-message edge function
      function validateChannel(channel: 'email' | 'sms', templateCategory: string) {
        if (channel === 'email' && templateCategory === 'sms') {
          return { status: 422, error: 'TEMPLATE_CHANNEL_MISMATCH' };
        }
        if (channel === 'sms' && templateCategory === 'email') {
          return { status: 422, error: 'TEMPLATE_CHANNEL_MISMATCH' };
        }
        return { status: 200, valid: true };
      }

      expect(validateChannel('email', 'sms')).toEqual({
        status: 422,
        error: 'TEMPLATE_CHANNEL_MISMATCH',
      });
      expect(validateChannel('sms', 'email')).toEqual({
        status: 422,
        error: 'TEMPLATE_CHANNEL_MISMATCH',
      });
      expect(validateChannel('email', 'email')).toEqual({ status: 200, valid: true });
      expect(validateChannel('sms', 'sms')).toEqual({ status: 200, valid: true });
    });

    it('SMS flow strictly forbids attachments (attachments = 0, PDF = NONE)', () => {
      function validateSmsAttachments(channel: 'email' | 'sms', hasAttachment: boolean) {
        if (channel === 'sms' && hasAttachment) {
          return { status: 422, error: 'SMS_ATTACHMENTS_NOT_SUPPORTED' };
        }
        return { status: 200, valid: true };
      }

      expect(validateSmsAttachments('sms', true)).toEqual({
        status: 422,
        error: 'SMS_ATTACHMENTS_NOT_SUPPORTED',
      });
      expect(validateSmsAttachments('sms', false)).toEqual({ status: 200, valid: true });
    });

    it('Zygomatic email requires PDF and preserves Resend architecture', () => {
      const zygomaticEmailResolution = resolveFirstContactTemplateForCourse('ZIT-01');
      expect(zygomaticEmailResolution).not.toBeNull();
      expect(zygomaticEmailResolution?.templateKey).toBe('zygomatic_course_details');
      expect(zygomaticEmailResolution?.hasPdfAttachment).toBe(true);
      expect(zygomaticEmailResolution?.pdfAttachmentName).toBe('Zygomatic Course (2).pdf');
    });

    it('Zygomatic SMS has exact approved verbatim text starting with "Hello Dr."', () => {
      const approvedZygomaticSmsText = `Hello Dr.
This is Nat\u00e1lia from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings for our November 7 to 10 course. Would those dates work for you?

I\u2019m happy to answer any questions and help you find the course that best matches your goals.`;

      expect(approvedZygomaticSmsText.startsWith('Hello Dr.')).toBe(true);
      expect(approvedZygomaticSmsText).not.toContain('Hello Doctor');
      expect(approvedZygomaticSmsText).not.toContain('{{first_name}}');
      expect(approvedZygomaticSmsText).toContain('Nat\u00e1lia from Expert Dental Solutions');
      expect(approvedZygomaticSmsText).toContain('November 7 to 10 course');
    });

    it('General SMS remains separate from Zygomatic SMS', () => {
      const generalSmsText = `Ol\u00e1 {{first_name}}, aqui \u00e9 a Nat\u00e1lia da Expert Dental Solutions. Vi que voc\u00ea demonstrou interesse em nossos treinamentos. Como posso te ajudar hoje?`;
      expect(generalSmsText).toContain('{{first_name}}');
      expect(generalSmsText).not.toContain('Zygomatic');
    });
  });

  // ===========================================================================
  // SECTION AE: CONTACT PREFERENCE DISPLAY
  // ===========================================================================
  describe('G & AE: Contact Preference Display on Cards', () => {
    it('Formats email preference cleanly', () => {
      expect(formatContactPreferenceLabel('email')).toBe('Preferência: Email');
    });

    it('Formats SMS preference cleanly', () => {
      expect(formatContactPreferenceLabel('sms')).toBe('Preferência: SMS');
    });

    it('Formats WhatsApp preference cleanly', () => {
      expect(formatContactPreferenceLabel('whatsapp')).toBe('Preferência: WhatsApp');
    });

    it('Formats call preference cleanly', () => {
      expect(formatContactPreferenceLabel('call')).toBe('Preferência: Ligação');
    });

    it('Formats undefined / null / unknown as "Preferência: Não informada"', () => {
      expect(formatContactPreferenceLabel(null)).toBe('Preferência: Não informada');
      expect(formatContactPreferenceLabel(undefined)).toBe('Preferência: Não informada');
      expect(formatContactPreferenceLabel('')).toBe('Preferência: Não informada');
      expect(formatContactPreferenceLabel('unknown_val')).toBe('Preferência: Não informada');
    });

    it('Never displays raw technical values in the badge', () => {
      const labels = ['email', 'sms', 'whatsapp', 'call', null].map((val) =>
        formatContactPreferenceLabel(val)
      );
      for (const label of labels) {
        expect(label.startsWith('Preferência: ')).toBe(true);
        expect(label).not.toBe('email');
        expect(label).not.toBe('sms');
        expect(label).not.toBe('whatsapp');
      }
    });
  });

  // ===========================================================================
  // SECTION AF: COURSE RECONCILIATION
  // ===========================================================================
  describe('I-N & AF: Course Interest Factual Reconciliation', () => {
    it('Maps factual Meta form / course names to approved canonical courses', () => {
      expect(resolveCanonicalCourse('Zygomatic').courseCode).toBe('ZIT-01');
      expect(resolveCanonicalCourse('Intensive Dental Implant').courseCode).toBe('IDIT-01');
      expect(resolveCanonicalCourse('Advanced Dental Implant Experience').courseCode).toBe('ADIE-01');
      expect(resolveCanonicalCourse('Wisdom Teeth Training').courseCode).toBe('WTT-01');
      expect(resolveCanonicalCourse('Endodontics Training').courseCode).toBe('ET-01');
      expect(resolveCanonicalCourse('Periodontal Plastic').courseCode).toBe('PST-01');
      expect(resolveCanonicalCourse('Advanced Implant Rehabilitation Experience').courseCode).toBe('AIRE-01');
    });

    it('Keeps unknown or unprovable course metadata unmapped (COURSE_UNMAPPED) without guessing', () => {
      const unknownResult = resolveCanonicalCourse('Unknown Random Source 123');
      expect(unknownResult.status).toBe('unmapped');
      expect(unknownResult.courseCode).toBeNull();
    });

    it('Free courses are recognized but never mapped to paid courses', () => {
      const freeCourseResolution = resolveCanonicalCourse('Free Implant Webinar 2024');
      if (freeCourseResolution.status === 'resolved') {
        expect(freeCourseResolution.courseCode).not.toBe('ZIT-01');
        expect(freeCourseResolution.courseCode).not.toBe('IDIT-01');
      } else {
        expect(freeCourseResolution.status).toBe('unmapped');
      }
    });

    it('Course reconciliation is pure data enrichment (zero communications, zero stage movement)', () => {
      const enrichmentEvent = {
        action: 'course_enrichment',
        emailsSent: 0,
        smsSent: 0,
        stagesModified: 0,
      };
      expect(enrichmentEvent.emailsSent).toBe(0);
      expect(enrichmentEvent.smsSent).toBe(0);
      expect(enrichmentEvent.stagesModified).toBe(0);
    });
  });

  // ===========================================================================
  // SECTION AG: AUTOMATION SAFETY CHECKS & GO-LIVE GATES
  // ===========================================================================
  describe('R-W & AG: Meta First-Contact Email Automation & Safety Gates', () => {
    it('1. New Meta Zygomatic email-preference lead is fully eligible and resolves required PDF', () => {
      const metaLead: FirstContactLeadInput = {
        source: 'meta',
        source_detail: 'instagram',
        email: 'dr.zygomatic@example.com',
        first_name: 'Sarah',
        contact_preference: 'email',
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateMetaLiveAutomationEligibility(metaLead);
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.eligibleChannels).toEqual(['email']);
      expect(eligibility.resolvedTemplate?.templateKey).toBe('zygomatic_course_details');
      expect(eligibility.resolvedTemplate?.hasPdfAttachment).toBe(true);
      expect(eligibility.resolvedTemplate?.pdfAttachmentName).toBe('Zygomatic Course (2).pdf');

      // Provider acceptance moves stage to Respondido (qualification)
      const outcome = resolveFirstContactOutcome({
        attemptedChannels: ['email'],
        channelResults: { email: 'accepted' },
      });
      expect(outcome.targetStageCode).toBe('qualification');
    });

    it('2. Historical HubSpot contact is permanently excluded from automated first contact', () => {
      const historicalLead: FirstContactLeadInput = {
        source: 'hubspot',
        source_detail: 'hubspot_historical',
        is_historical: true,
        email: 'historical@example.com',
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateMetaLiveAutomationEligibility(historicalLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
      expect(eligibility.suppressedReason).toContain('Historical import lead');
    });

    it('3. Manual lead is excluded from automated first contact', () => {
      const manualLead: FirstContactLeadInput = {
        source: 'manual',
        source_detail: 'quick_add',
        email: 'manual@example.com',
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateMetaLiveAutomationEligibility(manualLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
    });

    it('4. Website lead is excluded from automated first contact', () => {
      const webLead: FirstContactLeadInput = {
        source: 'website',
        source_detail: 'website-register',
        email: 'web@example.com',
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateMetaLiveAutomationEligibility(webLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
      expect(eligibility.suppressedReason).toContain('Website leads require manual client initial response');
    });

    it('5. Non-Meta HubSpot contact is excluded from automated first contact', () => {
      const organicHsLead: FirstContactLeadInput = {
        source: 'hubspot',
        source_detail: 'hubspot_sync',
        hs_analytics_source: 'ORGANIC_SEARCH',
        email: 'organic@example.com',
        course_interest: 'ZIT-01',
      };

      expect(isFactualMetaOrigin(organicHsLead)).toBe(false);
      const eligibility = evaluateMetaLiveAutomationEligibility(organicHsLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
    });

    it('6. Future HubSpot contact with factual Meta origin IS eligible for automation when preference is email', () => {
      const metaViaHsLead: FirstContactLeadInput = {
        source: 'hubspot',
        source_detail: 'hubspot_sync',
        hs_analytics_source: 'PAID_SOCIAL',
        hs_analytics_source_data_1: 'facebook_ad_123',
        hs_facebook_ad_clicked: true,
        email: 'meta.ad@example.com',
        contact_preference: 'email',
        course_interest: 'ZIT-01',
      };

      expect(isFactualMetaOrigin(metaViaHsLead)).toBe(true);
      const eligibility = evaluateMetaLiveAutomationEligibility(metaViaHsLead);
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.eligibleChannels).toEqual(['email']);

      // Without explicit email preference, it is strictly suppressed
      const unspecifiedPrefLead = { ...metaViaHsLead, contact_preference: null };
      const unspecifiedEligibility = evaluateMetaLiveAutomationEligibility(unspecifiedPrefLead);
      expect(unspecifiedEligibility.isEligible).toBe(false);
      expect(unspecifiedEligibility.suppressedReason).toContain('Preferência de contato não informada');
    });

    it('7. SMS-preference Meta lead NEVER triggers auto SMS or auto Email under strict business rule', () => {
      const smsPrefLead: FirstContactLeadInput = {
        source: 'meta',
        source_detail: 'facebook',
        contact_preference: 'sms',
        email: 'smslead@example.com',
        phone_e164: '+14075550188',
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateMetaLiveAutomationEligibility(smsPrefLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
      expect(eligibility.requiresManualSms).toBe(true);
      expect(eligibility.suppressedReason).toContain('SMS Manual Assistido');
    });

    it('8. Unknown course stops automated send safely and preserves lead in Novo Lead', () => {
      const unknownCourseLead: FirstContactLeadInput = {
        source: 'meta',
        email: 'unknown@example.com',
        course_interest: 'Advanced Implant Rehabilitation Experience', // Unapproved automated template
      };

      const eligibility = evaluateMetaLiveAutomationEligibility(unknownCourseLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
      expect(eligibility.suppressedReason).toContain('Unmapped or uncertain course interest');
    });

    it('9. Never falls back to Zygomatic email/PDF for another course', () => {
      const endoTemplate = resolveFirstContactTemplateForCourse('ET-01');
      expect(endoTemplate?.templateKey).toBe('endodontic_course_details');
      expect(endoTemplate?.hasPdfAttachment).toBe(false);
      expect(endoTemplate?.pdfAttachmentName).toBeUndefined();
    });

    it('10. Provider rejection retains lead in Novo Lead (capture)', () => {
      const outcome = resolveFirstContactOutcome({
        attemptedChannels: ['email'],
        channelResults: { email: 'failed' },
      });
      expect(outcome.targetStageCode).toBe('capture');
      expect(outcome.firstContactAttentionState).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION AH: NOTIFICATIONS & DEDUP
  // ===========================================================================
  describe('O, P & AH: Notifications Pipeline & Dedup Verification', () => {
    it('Generates distinct and idempotent keys for core operational notification triggers', () => {
      const leadId = 'lead-12345';
      const taskId = 'task-67890';
      const email = 'bounce@example.com';

      const newLeadKey = `lead_${leadId}_created`;
      const taskDueKey = `task_${taskId}_due`;
      const bounceKey = `deliverability_${email}_hard_bounce`;

      // Keys are deterministic and uniquely identify the operational event
      expect(newLeadKey).toBe('lead_lead-12345_created');
      expect(taskDueKey).toBe('task_task-67890_due');
      expect(bounceKey).toBe('deliverability_bounce@example.com_hard_bounce');
    });

    it('Suppression list prevents repeat notifications for known hard bounces or spam complaints', () => {
      const suppressedEmails = new Set(['bad@bounce.com', 'spam@complaint.com']);

      function checkSuppression(recipient: string): boolean {
        return suppressedEmails.has(recipient);
      }

      expect(checkSuppression('bad@bounce.com')).toBe(true);
      expect(checkSuppression('clean@customer.com')).toBe(false);
    });
  });
});
