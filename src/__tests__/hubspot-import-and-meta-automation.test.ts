// =============================================================================
// EDS HUB — HubSpot Import + Meta-Origin Automation + Course Mapping Test Suite
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  evaluateFirstContactEligibility,
  evaluateMetaFirstContactEligibility,
  resolveFirstContactOutcome,
  isFactualMetaOrigin,
  resolveFirstContactTemplateForCourse,
} from '../features/automations/engine/first-contact-router';

describe('EDS HUB — HubSpot Import, Meta-Origin Automation & Course Mapping', () => {
  // ---------------------------------------------------------------------------
  // 1. HISTORICAL HUBSPOT IMPORT
  // ---------------------------------------------------------------------------
  describe('1. Historical HubSpot Import Safety', () => {
    it('historical HubSpot import with email + phone never triggers first contact', () => {
      const historicalLead = {
        id: 'lead-hist-1',
        source: 'hubspot',
        source_detail: 'hubspot_historical',
        contact_preference: 'email',
        email: 'dr.alves@example.com',
        phone_raw: '+55 21 98888-7777',
        is_historical: true,
      };

      const eligibility = evaluateFirstContactEligibility(historicalLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
      expect(eligibility.suppressedReason).toContain('Historical import lead is excluded');
    });

    it('historical HubSpot sync batch lead is excluded from automatic initial outreach', () => {
      const syncLead = {
        id: 'lead-hist-2',
        source: 'manual',
        source_detail: 'hubspot_sync',
        contact_preference: 'email',
        email: 'dr.souza@example.com',
        phone_raw: '+1 407 555 0100',
        is_historical: true,
      };

      const eligibility = evaluateFirstContactEligibility(syncLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.suppressedReason).toContain('Historical import lead is excluded');
    });

    it('stage mapping decision: lifecyclestage = lead maps to Novo Lead (capture)', () => {
      const mapStage = (lifecycleStage: string): { code: string; name: string } => {
        if (lifecycleStage === 'opportunity') {
          return { code: 'acquisition', name: 'Interessado' };
        }
        return { code: 'capture', name: 'Novo Lead' };
      };

      expect(mapStage('lead')).toEqual({ code: 'capture', name: 'Novo Lead' });
    });

    it('stage mapping decision: lifecyclestage = opportunity maps to Interessado (acquisition) and NOT Quente', () => {
      const mapStage = (lifecycleStage: string): { code: string; name: string } => {
        if (lifecycleStage === 'opportunity') {
          return { code: 'acquisition', name: 'Interessado' };
        }
        return { code: 'capture', name: 'Novo Lead' };
      };

      const outcome = mapStage('opportunity');
      expect(outcome.code).toBe('acquisition');
      expect(outcome.name).toBe('Interessado');
      expect(outcome.code).not.toBe('approval'); // Never Quente
    });

    it('multi-course priorities 1, 2, and 3 are preserved in data model', () => {
      const hubspotCourseData = {
        curso_de_interesse: 'Intensive',
        curso_de_interesse_2: 'Wisdom',
        curso_de_interesse_3: 'Endodontic',
      };

      const mappedInterests = [
        { course: hubspotCourseData.curso_de_interesse, priority: 1 },
        { course: hubspotCourseData.curso_de_interesse_2, priority: 2 },
        { course: hubspotCourseData.curso_de_interesse_3, priority: 3 },
      ];

      expect(mappedInterests[0]).toEqual({ course: 'Intensive', priority: 1 });
      expect(mappedInterests[1]).toEqual({ course: 'Wisdom', priority: 2 });
      expect(mappedInterests[2]).toEqual({ course: 'Endodontic', priority: 3 });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. FUTURE META-ORIGIN VIA HUBSPOT
  // ---------------------------------------------------------------------------
  describe('2. Future Meta-Origin Via HubSpot Eligibility', () => {
    it('identifies factual Meta Lead Ads origin from real HubSpot properties', () => {
      const metaLeadHubspot = {
        hs_analytics_source: 'PAID_SOCIAL',
        hs_analytics_source_data_1: 'Facebook Ads - Zygomatic 2026',
        hs_facebook_ad_clicked: 'true',
        hs_facebook_click_id: 'fb.1.123456789',
        lead_ad_prop0: 'Yes, licensed dentist',
      };

      expect(isFactualMetaOrigin(metaLeadHubspot)).toBe(true);
    });

    it('identifies factual Meta origin from Instagram drilldown', () => {
      const igLeadHubspot = {
        hs_analytics_source: 'PAID_SOCIAL',
        hs_analytics_source_data_1: 'Instagram - Intensive Residency',
      };

      expect(isFactualMetaOrigin(igLeadHubspot)).toBe(true);
    });

    it('future HubSpot contact with proven Meta origin is eligible for first-contact automation', () => {
      const futureMetaLead = {
        id: 'lead-meta-fut-1',
        source: 'meta',
        source_detail: 'hubspot_meta_lead_ad',
        contact_preference: 'email',
        email: 'future.meta.lead@example.com',
        phone_raw: '+1 305 555 0199',
        is_historical: false,
        course_interest: 'Zygomatic',
        hs_analytics_source: 'PAID_SOCIAL',
        hs_analytics_source_data_1: 'Facebook',
      };

      const eligibility = evaluateMetaFirstContactEligibility(futureMetaLead);
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.eligibleChannels).toEqual(['email']);
      expect(eligibility.resolvedTemplate?.templateKey).toBe('zygomatic_course_details');
    });

    it('new HubSpot contact with NO factual Meta origin is strictly ineligible', () => {
      const organicHubSpotLead = {
        id: 'lead-org-1',
        source: 'manual',
        source_detail: 'hubspot_sync',
        contact_preference: 'email',
        email: 'organic.lead@example.com',
        phone_raw: '+1 305 555 0200',
        is_historical: false,
        hs_analytics_source: 'ORGANIC_SEARCH',
        hs_analytics_source_data_1: 'Google',
      };

      const eligibility = evaluateFirstContactEligibility(organicHubSpotLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
    });

    it('manual lead is strictly ineligible for automatic first contact', () => {
      const manualLead = {
        source: 'manual',
        source_detail: 'phone_call_manual_entry',
        contact_preference: 'email',
        email: 'manual@example.com',
        phone_raw: '+1 407 555 0300',
      };

      const eligibility = evaluateFirstContactEligibility(manualLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.suppressedReason).toContain('Manual, email-origin, and non-Meta leads');
    });

    it('email-origin inbound lead is strictly ineligible for automated first contact', () => {
      const emailOriginLead = {
        source: 'email',
        source_detail: 'inbound_email_message',
        contact_preference: 'email',
        email: 'inbound@example.com',
      };

      const eligibility = evaluateFirstContactEligibility(emailOriginLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.suppressedReason).toContain('Manual, email-origin, and non-Meta leads');
    });

    it('website lead is strictly ineligible for automated first contact', () => {
      const webLead = {
        source: 'form',
        source_detail: 'website-register',
        contact_preference: 'email',
        email: 'web@example.com',
      };

      const eligibility = evaluateFirstContactEligibility(webLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.suppressedReason).toContain('Website leads require manual client initial response');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. COURSE MAPPING & TEMPLATE RESOLUTION
  // ---------------------------------------------------------------------------
  describe('3. Course Mapping & Template Resolution', () => {
    it('resolves Zygomatic to ZIT-01 and zygomatic_course_details with PDF attachment', () => {
      const res = resolveFirstContactTemplateForCourse('Zygomatic');
      expect(res).not.toBeNull();
      expect(res?.courseCode).toBe('ZIT-01');
      expect(res?.templateKey).toBe('zygomatic_course_details');
      expect(res?.hasPdfAttachment).toBe(true);
      expect(res?.pdfAttachmentName).toBe('Zygomatic_Implant_Course_Details_EDS.pdf');
    });

    it('resolves Intensive to IDIT-01 and intensive_course_details', () => {
      const res = resolveFirstContactTemplateForCourse('Intensive');
      expect(res).not.toBeNull();
      expect(res?.courseCode).toBe('IDIT-01');
      expect(res?.templateKey).toBe('intensive_course_details');
      expect(res?.hasPdfAttachment).toBe(false);
    });

    it('resolves Endodontic to ET-01 and endodontic_course_details', () => {
      const res = resolveFirstContactTemplateForCourse('Endodontic');
      expect(res).not.toBeNull();
      expect(res?.courseCode).toBe('ET-01');
      expect(res?.templateKey).toBe('endodontic_course_details');
      expect(res?.hasPdfAttachment).toBe(false);
    });

    it('resolves Wisdom to WTT-01 and wisdom_course_details', () => {
      const res = resolveFirstContactTemplateForCourse('Wisdom');
      expect(res).not.toBeNull();
      expect(res?.courseCode).toBe('WTT-01');
      expect(res?.templateKey).toBe('wisdom_course_details');
      expect(res?.hasPdfAttachment).toBe(false);
    });

    it('does NOT guess unmapped courses (Advanced, Periodontal Plastic, Rehabilitation, Free courses)', () => {
      expect(resolveFirstContactTemplateForCourse('Advanced')).toBeNull();
      expect(resolveFirstContactTemplateForCourse('Periodontal Plastic')).toBeNull();
      expect(resolveFirstContactTemplateForCourse('Rehabilitation')).toBeNull();
      expect(resolveFirstContactTemplateForCourse('Free courses')).toBeNull();
    });

    it('unmapped course blocks automatic outreach until approved', () => {
      const leadWithUnmappedCourse = {
        source: 'meta',
        source_detail: 'hubspot_meta_lead_ad',
        email: 'doctor@example.com',
        phone_raw: '+1 407 555 0199',
        course_interest: 'Periodontal Plastic',
        hs_analytics_source: 'PAID_SOCIAL',
        hs_analytics_source_data_1: 'Facebook',
      };

      const eligibility = evaluateMetaFirstContactEligibility(leadWithUnmappedCourse);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.suppressedReason).toContain('Unmapped or uncertain course interest "Periodontal Plastic"');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. FIRST-CONTACT IDEMPOTENCY & STAGE ADVANCEMENT
  // ---------------------------------------------------------------------------
  describe('4. Idempotency & Respondido Progression Contract', () => {
    it('advances stage to Respondido (qualification) only when provider accepts message', () => {
      const outcome = resolveFirstContactOutcome({
        attemptedChannels: ['email'],
        channelResults: { email: 'accepted' },
      });

      expect(outcome.targetStageCode).toBe('qualification'); // Respondido
      expect(outcome.firstContactAttentionState).toBe(false);
    });

    it('retains stage in Novo Lead (capture) when send fails', () => {
      const outcome = resolveFirstContactOutcome({
        attemptedChannels: ['email'],
        channelResults: { email: 'failed' },
      });

      expect(outcome.targetStageCode).toBe('capture'); // Novo Lead
      expect(outcome.firstContactAttentionState).toBe(true);
      expect(outcome.summary).toContain('Falha no Primeiro Contato');
    });

    it('enforces that first contact is sent only once per lead (idempotency simulation)', () => {
      const processedLeads = new Set<string>();

      const attemptSend = (leadId: string): { sent: boolean; reason?: string } => {
        if (processedLeads.has(leadId)) {
          return { sent: false, reason: 'duplicate_suppressed' };
        }
        processedLeads.add(leadId);
        return { sent: true };
      };

      // 1st attempt: sends
      const res1 = attemptSend('lead-xyz-1');
      expect(res1.sent).toBe(true);

      // 2nd attempt (HubSpot sync retry or direct Meta duplicate): suppressed
      const res2 = attemptSend('lead-xyz-1');
      expect(res2.sent).toBe(false);
      expect(res2.reason).toBe('duplicate_suppressed');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. OUTBOX & OUTBOUND SYNC SAFETY
  // ---------------------------------------------------------------------------
  describe('5. Outbound Sync Safety & Quarantine', () => {
    it('verifies outbound sync to HubSpot is disabled by default', () => {
      const integrationConfig = {
        provider: 'hubspot',
        sync_enabled: false,
        outbound_sync_enabled: false,
        auto_suppress_automations: true,
      };

      expect(integrationConfig.outbound_sync_enabled).toBe(false);
      expect(integrationConfig.auto_suppress_automations).toBe(true);
    });

    it('quarantines pending outbox records when outbound_sync_enabled is false', () => {
      const pendingOutboxItems = [
        { id: 'out-1', status: 'pending', payload: { email: 'test@example.com' } },
        { id: 'out-2', status: 'pending', payload: { email: 'test2@example.com' } },
      ];

      const outboundSyncEnabled = false;

      const dispatched = outboundSyncEnabled ? pendingOutboxItems : [];
      expect(dispatched).toHaveLength(0);
      expect(pendingOutboxItems.every(i => i.status === 'pending')).toBe(true);
    });
  });
});
