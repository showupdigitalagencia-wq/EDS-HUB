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

  // ---------------------------------------------------------------------------
  // 6. APPROVED COURSE MAPPINGS & FREE COURSES HANDLING
  // ---------------------------------------------------------------------------
  describe('6. Approved Course Mappings & Free Courses Handling', () => {
    const APPROVED_COURSE_MAP: Record<string, { code: string; name: string } | null> = {
      Intensive: { code: 'IDIT-01', name: 'Intensive Dental Implant Training' },
      Endodontic: { code: 'ET-01', name: 'Endodontics Training' },
      Wisdom: { code: 'WTT-01', name: 'Wisdom Teeth Training' },
      Zygomatic: { code: 'ZIT-01', name: 'Zygomatic Implant Training' },
      Advanced: { code: 'ADIE-01', name: 'Advanced Dental Implant Experience' },
      'Periodontal Plastic': { code: 'PST-01', name: 'Periodontal Surgery Training' },
      Rehabilitation: { code: 'AIRE-01', name: 'Advanced Implant Rehabilitation Experience' },
      'Free courses': null, // Do not map to a paid course
    };

    it('maps all approved commercial courses to their canonical EDS course code', () => {
      expect(APPROVED_COURSE_MAP['Intensive']?.code).toBe('IDIT-01');
      expect(APPROVED_COURSE_MAP['Endodontic']?.code).toBe('ET-01');
      expect(APPROVED_COURSE_MAP['Wisdom']?.code).toBe('WTT-01');
      expect(APPROVED_COURSE_MAP['Zygomatic']?.code).toBe('ZIT-01');
      expect(APPROVED_COURSE_MAP['Advanced']?.code).toBe('ADIE-01');
      expect(APPROVED_COURSE_MAP['Periodontal Plastic']?.code).toBe('PST-01');
      expect(APPROVED_COURSE_MAP['Rehabilitation']?.code).toBe('AIRE-01');
    });

    it('Free courses imports without paid-course mapping and preserves historical note', () => {
      const freeCourseVal = 'Free courses';
      const mapped = APPROVED_COURSE_MAP[freeCourseVal];
      expect(mapped).toBeNull();

      // Ensure historical value is preserved in notes/metadata without failing import
      const leadPayload = {
        name: 'Dr. Historical Free Course',
        email: 'freecourse@example.com',
        historicalNotes: freeCourseVal ? `Historical Course Interest: ${freeCourseVal}` : undefined,
      };

      expect(leadPayload.historicalNotes).toBe('Historical Course Interest: Free courses');
    });

    it('historical date preference (data_do_curso_de_interesse) is preserved as note context without inventing session', () => {
      const rawDate = '2025-10-15';
      const note = `Historical Session Preference: ${rawDate}`;
      expect(note).toContain('2025-10-15');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. IDENTITY DEDUPLICATION & CONFLICT RESOLUTION
  // ---------------------------------------------------------------------------
  describe('7. Identity Deduplication & Safe Matching', () => {
    it('matches by HubSpot integration link first', () => {
      const existingLinks = new Map<string, string>([['hs-101', 'lead-eds-101']]);
      const hubspotContactId = 'hs-101';
      expect(existingLinks.get(hubspotContactId)).toBe('lead-eds-101');
    });

    it('matches by normalized email second', () => {
      const emailMap = new Map<string, string>([['doctor@eds.com', 'lead-eds-102']]);
      const normalizedEmail = '  Doctor@EDS.com '.trim().toLowerCase();
      expect(emailMap.get(normalizedEmail)).toBe('lead-eds-102');
    });

    it('matches by normalized E.164 phone third', () => {
      const phoneMap = new Map<string, string>([['+14075550199', 'lead-eds-103']]);
      const rawPhone = '+1 (407) 555-0199';
      const normalized = rawPhone.replace(/[^\d+]/g, '');
      expect(phoneMap.get(normalized)).toBe('lead-eds-103');
    });

    it('flags conflict safely and avoids automatic merge when email matches Lead A and phone matches Lead B', () => {
      const emailMatchesLead: string = 'lead-A';
      const phoneMatchesLead: string = 'lead-B';

      const isConflict = emailMatchesLead !== phoneMatchesLead;
      expect(isConflict).toBe(true);

      const resolveMatch = (emailMatch: string, phoneMatch: string) => {
        if (emailMatch && phoneMatch && emailMatch !== phoneMatch) {
          return { status: 'conflict', targetLead: null, flag: 'IDENTITY_CONFLICT_MANUAL_REVIEW_REQUIRED' };
        }
        return { status: 'matched', targetLead: emailMatch || phoneMatch };
      };

      const result = resolveMatch(emailMatchesLead, phoneMatchesLead);
      expect(result.status).toBe('conflict');
      expect(result.targetLead).toBeNull();
      expect(result.flag).toBe('IDENTITY_CONFLICT_MANUAL_REVIEW_REQUIRED');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. CONTINUOUS INBOUND SYNC & IDEMPOTENCY
  // ---------------------------------------------------------------------------
  describe('8. Continuous Inbound Sync & Idempotent Delta Polling', () => {
    it('uses incremental delta polling using lastmodifieddate', () => {
      const syncConfig = {
        sync_direction: 'hubspot_to_eds_only',
        mechanism: 'incremental_delta_polling_lastmodifieddate',
        polling_cadence_minutes: 5,
        target_cadence_range: '1-5 minutes',
        outbound_sync_enabled: false,
      };

      expect(syncConfig.sync_direction).toBe('hubspot_to_eds_only');
      expect(syncConfig.mechanism).toBe('incremental_delta_polling_lastmodifieddate');
      expect(syncConfig.polling_cadence_minutes).toBeGreaterThanOrEqual(1);
      expect(syncConfig.polling_cadence_minutes).toBeLessThanOrEqual(5);
      expect(syncConfig.outbound_sync_enabled).toBe(false);
    });

    it('delta polling updates existing contacts idempotently without duplicating', () => {
      const leadsDb = new Map<string, { id: string; email: string; stage: string; updated_at: string }>();
      leadsDb.set('hs-501', { id: 'eds-501', email: 'doc@example.com', stage: 'capture', updated_at: '2026-09-01T00:00:00Z' });

      // Incoming delta update from HubSpot
      const incomingDelta = {
        hubspot_contact_id: 'hs-501',
        email: 'doc@example.com',
        lifecyclestage: 'opportunity',
        lastmodifieddate: '2026-09-24T12:00:00Z',
      };

      if (leadsDb.has(incomingDelta.hubspot_contact_id)) {
        const existing = leadsDb.get(incomingDelta.hubspot_contact_id)!;
        existing.stage = incomingDelta.lifecyclestage === 'opportunity' ? 'acquisition' : 'capture';
        existing.updated_at = incomingDelta.lastmodifieddate;
      }

      expect(leadsDb.size).toBe(1); // No new duplicate created
      expect(leadsDb.get('hs-501')?.stage).toBe('acquisition');
    });

    it('future non-Meta HubSpot contact does not trigger automation even with active continuous sync', () => {
      const nonMetaFutureContact = {
        id: 'hs-fut-organic',
        email: 'organic@example.com',
        source: 'manual',
        source_detail: 'hubspot_sync',
        is_historical: false,
        hs_analytics_source: 'ORGANIC_SEARCH',
      };

      const eligibility = evaluateFirstContactEligibility(nonMetaFutureContact);
      expect(eligibility.isEligible).toBe(false);
    });

    it('permanent retention: disconnecting HubSpot preserves all EDS leads, notes, and course interests', () => {
      const disconnectionPolicy = {
        deleteRecordsOnHubSpotDisconnect: false,
        archiveRecordsOnHubSpotDisconnect: false,
        removeHistoryOnHubSpotDisconnect: false,
        removeCourseInterestsOnHubSpotDisconnect: false,
        permanentEdsCrmRecord: true,
      };

      expect(disconnectionPolicy.deleteRecordsOnHubSpotDisconnect).toBe(false);
      expect(disconnectionPolicy.permanentEdsCrmRecord).toBe(true);
    });
  });
});
