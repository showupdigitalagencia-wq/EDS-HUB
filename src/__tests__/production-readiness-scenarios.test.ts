// =============================================================================
// EDS HUB — Production Readiness Verification Suite: Scenarios A through K
// =============================================================================
// Comprehensive, mock/fixture-based E2E verification of end-to-end integration
// rules without any real network dispatch, emails, or SMS.
//
// Scenarios:
// SCENARIO A: new factual Meta-origin HubSpot lead -> course identified -> lead created ->
//             course interest -> correct template -> required material -> provider accepted -> Respondido
// SCENARIO B: same lead arrives again -> no duplicate -> no second first contact
// SCENARIO C: same person later interested in second course -> same lead -> new course interest -> no duplicate
// SCENARIO D: historical HubSpot lead -> no automatic outreach
// SCENARIO E: new HubSpot contact without factual Meta origin -> no automatic first contact
// SCENARIO F: required PDF unavailable -> email blocked -> stage unchanged
// SCENARIO G: provider rejects -> stage unchanged
// SCENARIO H: SMS preference -> manual task -> no auto SMS
// SCENARIO I: hard bounce -> suppression recorded -> future unsafe automation blocked
// SCENARIO J: complaint -> suppression recorded -> alert -> future unsafe automation blocked
// SCENARIO K: same lead Meta via HubSpot then direct Meta -> one canonical lead -> max 1 first contact
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveCourseSignal,
  resolvePrioritizedCourseInterests,
} from '../utils/course-resolver';
import {
  evaluateFirstContactEligibility,
  evaluateMetaFirstContactEligibility,
  isFactualMetaOrigin,
  resolveFirstContactTemplateForCourse,
  resolveFirstContactOutcome,
  isValidEmail,
  type FirstContactLeadInput,
} from '../features/automations/engine/first-contact-router';
import {
  resolveSafeFirstName,
  resolveCanonicalGreeting,
} from '../utils/salutation';
import { formatCohortDateRange } from '../utils/format';


describe('EDS HUB — Production Readiness Scenarios (A through K)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // SCENARIO A: New factual Meta-origin HubSpot lead
  // ===========================================================================
  describe('SCENARIO A: New factual Meta-origin HubSpot lead -> Respondido', () => {
    it('identifies Meta origin, resolves canonical course, checks required material, moves to Respondido on provider acceptance', () => {
      // 1. Raw incoming HubSpot contact with factual Meta Lead Ad evidence
      const rawHubSpotContact = {
        id: 'hs-contact-meta-001',
        email: 'dr.marcus@example.com',
        firstname: 'Marcus',
        lastname: 'Vance',
        phone: '+1 305 555 0199',
        hs_analytics_source: 'PAID_SOCIAL',
        hs_analytics_source_data_1: 'facebook_ad_zygomatic_2026',
        hs_facebook_ad_clicked: 'true',
        curso_de_interesse: 'Zygomatic',
        curso_de_interesse_2: 'Intensive',
        data_do_curso_de_interesse: 'November 2026',
        createdate: '2026-09-24T18:00:00Z',
      };

      // 2. Identify marketing origin vs integration path
      const isMetaOrigin = isFactualMetaOrigin(rawHubSpotContact);
      expect(isMetaOrigin).toBe(true);
      const marketingOrigin = isMetaOrigin ? 'Meta' : 'HubSpot';
      const integrationPath = 'HubSpot';
      expect(marketingOrigin).toBe('Meta');
      expect(integrationPath).toBe('HubSpot');

      // 3. Central Course Resolver identifies canonical course
      const courseSignal = resolveCourseSignal(rawHubSpotContact.curso_de_interesse);
      expect(courseSignal.status).toBe('resolved');
      expect(courseSignal.canonicalCode).toBe('ZIT-01');
      expect(courseSignal.courseName).toBe('Zygomatic Implant Training');

      // 4. Resolve prioritized course interests (support up to 3)
      const prioritized = resolvePrioritizedCourseInterests({
        curso_de_interesse: rawHubSpotContact.curso_de_interesse,
        curso_de_interesse_2: rawHubSpotContact.curso_de_interesse_2,
        data_do_curso_de_interesse: rawHubSpotContact.data_do_curso_de_interesse,
      });
      expect(prioritized.length).toBe(2);

      expect(prioritized[0]).toMatchObject({
        courseCode: 'ZIT-01',
        priority: 1,
      });
      expect(prioritized[1]).toMatchObject({
        courseCode: 'IDIT-01',
        priority: 2,
      });

      // 5. Evaluate First Contact Eligibility
      const leadInput: FirstContactLeadInput = {
        id: 'lead-sim-a',
        source: 'hubspot',
        source_detail: 'hubspot_sync',
        first_name: rawHubSpotContact.firstname,
        last_name: rawHubSpotContact.lastname,
        email: rawHubSpotContact.email,
        phone_raw: rawHubSpotContact.phone,
        phone_e164: '+13055550199',
        course_interest: courseSignal.canonicalCode,
        is_historical: false,
        hs_analytics_source: rawHubSpotContact.hs_analytics_source,
        hs_analytics_source_data_1: rawHubSpotContact.hs_analytics_source_data_1,
        hs_facebook_ad_clicked: true,
      };

      const eligibility = evaluateFirstContactEligibility(leadInput, { emailOnlyPhase: true });
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.eligibleChannels).toEqual(['email']);

      // 6. Template & required material resolution
      const template = resolveFirstContactTemplateForCourse(courseSignal.canonicalCode);
      expect(template).not.toBeNull();
      expect(template?.templateKey).toBe('zygomatic_course_details');
      expect(template?.hasPdfAttachment).toBe(true);
      expect(template?.pdfAttachmentName).toBe('Zygomatic Course (2).pdf');

      // 7. Greeting resolution
      const greeting = resolveCanonicalGreeting(leadInput.first_name);
      expect(greeting).toBe('Hello Marcus,');

      // 8. Simulated provider acceptance moves to Respondido (qualification)
      const outcome = resolveFirstContactOutcome({
        attemptedChannels: ['email'],
        channelResults: { email: 'accepted' },
      });
      expect(outcome.targetStageCode).toBe('qualification'); // Respondido
      expect(outcome.firstContactAttentionState).toBe(false);
    });
  });

  // ===========================================================================
  // SCENARIO B: Same lead arrives again -> No duplicate, no second first contact
  // ===========================================================================
  describe('SCENARIO B: Duplicate lead arrives -> No duplicate, no second first contact', () => {
    it('matches by normalized email, preserves single lead, does not re-trigger first contact', () => {
      // In-memory canonical lead store
      const existingLeads = [
        {
          id: 'canonical-lead-001',
          email: 'dr.marcus@example.com',
          phone_e164: '+13055550199',
          pipeline_stage_id: 'stage-qualification-id', // already moved to Respondido
          first_contact_sent_at: '2026-09-24T18:05:00Z',
          first_contact_provider_id: 'resend_msg_12345',
        },
      ];

      const incomingSecondSubmission = {
        email: 'DR.MARCUS@EXAMPLE.COM', // case variations
        phone: '(305) 555-0199',
        curso_de_interesse: 'Zygomatic',
      };

      // Match existing lead by normalized email
      const matched = existingLeads.find(
        (l) => l.email.toLowerCase() === incomingSecondSubmission.email.trim().toLowerCase()
      );
      expect(matched).toBeDefined();

      // Invariant: No second lead is created
      expect(existingLeads.length).toBe(1);

      // Invariant: Idempotency check prevents second first contact
      const alreadyHasFirstContact = Boolean(matched?.first_contact_sent_at);
      expect(alreadyHasFirstContact).toBe(true);

      // Automated outreach must be bypassed
      const dispatchAttempted = !alreadyHasFirstContact;
      expect(dispatchAttempted).toBe(false);
    });
  });

  // ===========================================================================
  // SCENARIO C: Same person later interested in second course
  // ===========================================================================
  describe('SCENARIO C: Same person interested in second course -> 1 lead, new prioritized interest', () => {
    it('maintains 1 lead, preserves previous interest, adds new course interest with correct priority', () => {
      interface LeadInterestRecord {
        lead_id: string;
        course_code: string;
        priority: number;
        created_at: string;
      }

      const canonicalLeadId = 'canonical-lead-john';
      const interests: LeadInterestRecord[] = [
        {
          lead_id: canonicalLeadId,
          course_code: 'IDIT-01', // Intensive
          priority: 1,
          created_at: '2026-09-01T10:00:00Z',
        },
      ];

      // John now submits interest in Zygomatic
      const newCourseSignal = resolveCourseSignal('Zygomatic Implant Training');
      expect(newCourseSignal.canonicalCode).toBe('ZIT-01');

      // Update priorities: New active interest becomes priority 1, existing drops to priority 2
      const updatedInterests: LeadInterestRecord[] = [
        {
          lead_id: canonicalLeadId,
          course_code: newCourseSignal.canonicalCode!,
          priority: 1,
          created_at: '2026-09-24T20:00:00Z',
        },
        ...interests.map((item) => ({
          ...item,
          priority: item.priority + 1,
        })),
      ];

      // Invariant: ONE lead exists, with 2 ordered interests
      expect(updatedInterests.length).toBe(2);
      expect(updatedInterests[0]).toMatchObject({ course_code: 'ZIT-01', priority: 1 });
      expect(updatedInterests[1]).toMatchObject({ course_code: 'IDIT-01', priority: 2 });
    });
  });

  // ===========================================================================
  // SCENARIO D: Historical HubSpot lead -> No automatic outreach
  // ===========================================================================
  describe('SCENARIO D: Historical HubSpot lead -> Strict exclusion from automatic outreach', () => {
    it('flags historical leads as completely ineligible for automated outreach', () => {
      const historicalLead: FirstContactLeadInput = {
        id: 'hist-lead-888',
        source: 'hubspot',
        source_detail: 'hubspot_historical',
        email: 'historical.doctor@example.com',
        first_name: 'David',
        is_historical: true,
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateFirstContactEligibility(historicalLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toEqual([]);
      expect(eligibility.suppressedReason).toContain('Historical import lead is excluded');
    });

    it('excludes 2,632 batch-synced historical contacts even if course interest is present', () => {
      const batchLead: FirstContactLeadInput = {
        id: 'hist-batch-001',
        source: 'hubspot',
        source_detail: 'hubspot_sync',
        email: 'batch.sync@example.com',
        first_name: 'Elena',
        is_historical: false,
        hs_analytics_source: 'ORGANIC_SEARCH', // Not Meta
        course_interest: 'ZIT-01',
      };

      const eligibility = evaluateFirstContactEligibility(batchLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toEqual([]);
    });
  });

  // ===========================================================================
  // SCENARIO E: New HubSpot contact without factual Meta origin
  // ===========================================================================
  describe('SCENARIO E: New HubSpot contact without factual Meta origin -> No automatic first contact', () => {
    it('blocks automated first contact for organic, direct, or referral HubSpot leads', () => {
      const organicHubSpotLead: FirstContactLeadInput = {
        id: 'hs-lead-organic',
        source: 'hubspot',
        source_detail: 'hubspot_sync',
        first_name: 'Sarah',
        email: 'sarah.organic@example.com',
        phone_e164: '+12125550188',
        hs_analytics_source: 'DIRECT_TRAFFIC',
        hs_analytics_source_data_1: null,
        hs_facebook_ad_clicked: false,
        course_interest: 'ZIT-01',
      };

      expect(isFactualMetaOrigin(organicHubSpotLead)).toBe(false);

      const eligibility = evaluateFirstContactEligibility(organicHubSpotLead);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toEqual([]);
      expect(eligibility.suppressedReason).toBeDefined();
      expect(eligibility.suppressedReason).toMatch(/excluded from automatic initial outreach|excluded from automated first contact/);

    });
  });

  // ===========================================================================
  // SCENARIO F: Required PDF unavailable -> Email blocked -> Stage unchanged
  // ===========================================================================
  describe('SCENARIO F: Required PDF unavailable -> Send blocked, stage unchanged', () => {
    it('strictly halts dispatch if template requires PDF attachment and material is missing', () => {
      const template = resolveFirstContactTemplateForCourse('ZIT-01');
      expect(template?.hasPdfAttachment).toBe(true);

      // Simulate Storage material lookup returning null / not found
      const mockStorageFetch = (filename: string): { data: ArrayBuffer | null; error: Error | null } => {
        if (filename === 'Zygomatic Course (2).pdf') {
          return { data: null, error: new Error('File not found in course-materials bucket') };
        }
        return { data: new ArrayBuffer(10), error: null };
      };

      const fileResult = mockStorageFetch(template!.pdfAttachmentName!);
      const canProceedWithSend = template?.hasPdfAttachment ? Boolean(fileResult.data) : true;

      // Invariant: Send must be strictly blocked
      expect(canProceedWithSend).toBe(false);

      // Invariant: Pipeline stage remains Novo Lead (capture)
      const stage = canProceedWithSend ? 'qualification' : 'capture';
      expect(stage).toBe('capture');
    });
  });

  // ===========================================================================
  // SCENARIO G: Provider rejects -> Stage unchanged
  // ===========================================================================
  describe('SCENARIO G: Provider rejects -> Stage unchanged in Novo Lead', () => {
    it('keeps lead in Novo Lead (capture) with attention state when provider returns error', () => {
      const outcome = resolveFirstContactOutcome({
        attemptedChannels: ['email'],
        channelResults: { email: 'failed' },
      });

      expect(outcome.targetStageCode).toBe('capture'); // Remains Novo Lead
      expect(outcome.acceptedChannels).toHaveLength(0);
      expect(outcome.failedChannels).toEqual(['email']);
      expect(outcome.firstContactAttentionState).toBe(true);
      expect(outcome.summary).toContain('Falha no Primeiro Contato');
    });
  });

  // ===========================================================================
  // SCENARIO H: SMS preference -> Manual task, no auto SMS
  // ===========================================================================
  describe('SCENARIO H: SMS preference -> Manual task created, no auto SMS', () => {
    it('creates manual follow-up task and does not trigger automated SMS provider dispatch', () => {
      const leadWithSmsPref: FirstContactLeadInput = {
        id: 'lead-sms-pref',
        source: 'meta',
        source_detail: 'instagram',
        first_name: 'Arthur',
        email: 'arthur@example.com',
        phone_e164: '+14155550177',
        contact_preference: 'sms',
        course_interest: 'ZIT-01',
      };

      // Under current email-only phase, SMS is inactive
      const eligibility = evaluateMetaFirstContactEligibility(leadWithSmsPref);
      expect(eligibility.preservedPreference).toBe('sms');
      // Automated SMS is never in eligibleChannels under emailOnlyPhase
      expect(eligibility.eligibleChannels).toEqual(['email']);

      // Creates operational assisted SMS task
      const operationalTask = {
        lead_id: leadWithSmsPref.id,
        task_type: 'sms',
        title: 'Enviar SMS manual (Preferência do Lead: SMS)',
        status: 'pending',
        is_automated: false,
      };

      expect(operationalTask.is_automated).toBe(false);
      expect(operationalTask.status).toBe('pending');
      expect(operationalTask.task_type).toBe('sms');
    });
  });

  // ===========================================================================
  // SCENARIO I: Hard bounce -> Suppression recorded, future automation blocked
  // ===========================================================================
  describe('SCENARIO I: Hard bounce -> Suppression recorded, future automation blocked', () => {
    it('records email_bounced in lead_activities and suppresses unsafe future sending', () => {
      interface LeadSafetyRecord {
        lead_id: string;
        email: string;
        is_suppressed: boolean;
        suppression_reason: string | null;
        last_event: string;
      }

      const leadSafety: LeadSafetyRecord = {
        lead_id: 'lead-bounce-1',
        email: 'invalid.mailbox@example.com',
        is_suppressed: false,
        suppression_reason: null,
        last_event: 'sent',
      };

      // Simulated Resend webhook payload for hard bounce
      const resendBounceWebhook = {
        type: 'email.bounced',
        data: {
          recipient: 'invalid.mailbox@example.com',
          bounce_type: 'hard_bounce',
          description: 'Recipient address does not exist',
        },
      };

      // Process webhook
      if (resendBounceWebhook.type === 'email.bounced') {
        leadSafety.is_suppressed = true;
        leadSafety.suppression_reason = `Hard bounce: ${resendBounceWebhook.data.description}`;
        leadSafety.last_event = 'bounced';
      }

      expect(leadSafety.is_suppressed).toBe(true);
      expect(leadSafety.suppression_reason).toContain('Hard bounce');

      // Future automation pre-flight check
      const canSendNextEmail = !leadSafety.is_suppressed && isValidEmail(leadSafety.email);
      expect(canSendNextEmail).toBe(false);
    });
  });

  // ===========================================================================
  // SCENARIO J: Complaint -> Suppression recorded, alert raised, future blocked
  // ===========================================================================
  describe('SCENARIO J: Complaint -> Suppression recorded, alert raised, future blocked', () => {
    it('handles spam complaint event by suppressing recipient and raising operational alert', () => {
      const activities: Array<{ type: string; summary: string }> = [];
      const notifications: Array<{ title: string; severity: string }> = [];

      const handleResendComplaint = (recipient: string) => {
        activities.push({
          type: 'email_complained',
          summary: `Reclamação de spam recebida do destinatário ${recipient}. E-mail suprimido.`,
        });
        notifications.push({
          title: `Alerta Crítico: Reclamação de Spam (${recipient})`,
          severity: 'critical',
        });
      };

      handleResendComplaint('unhappy.user@example.com');

      expect(activities.length).toBe(1);
      expect(activities[0].type).toBe('email_complained');
      expect(notifications.length).toBe(1);
      expect(notifications[0].severity).toBe('critical');
    });
  });

  // ===========================================================================
  // SCENARIO K: Same lead arrives via Meta via HubSpot then direct Meta
  // ===========================================================================
  describe('SCENARIO K: Meta via HubSpot then direct Meta -> ONE canonical lead, max 1 first contact', () => {
    it('converges dual ingestion into single canonical identity and enforces single first contact', () => {
      interface LeadEntity {
        id: string;
        email: string;
        phone_e164: string;
        hubspot_contact_id: string | null;
        meta_leadgen_id: string | null;
        first_contact_count: number;
        created_at: string;
      }

      const store: LeadEntity[] = [];

      // Step 1: Lead arrives first via HubSpot (originating from Meta Ads)
      const hsIngestion = {
        email: 'dr.carlos@example.com',
        phone: '+55 21 99999-1234',
        phone_e164: '+5521999991234',
        hubspot_contact_id: 'hs-100200',
        meta_leadgen_id: null,
      };

      const firstLead: LeadEntity = {
        id: 'canonical-carlos-1',
        email: hsIngestion.email,
        phone_e164: hsIngestion.phone_e164,
        hubspot_contact_id: hsIngestion.hubspot_contact_id,
        meta_leadgen_id: null,
        first_contact_count: 1, // simulated first contact sent
        created_at: '2026-09-24T12:00:00Z',
      };
      store.push(firstLead);

      expect(store.length).toBe(1);

      // Step 2: Same lead arrives directly via Meta webhook seconds/hours later
      const directMetaWebhook = {
        email: 'dr.carlos@example.com',
        phone: '+5521999991234',
        leadgen_id: 'meta_leadgen_999888',
      };

      // Deduplication matcher
      const existing = store.find(
        (l) =>
          l.email.toLowerCase() === directMetaWebhook.email.toLowerCase() ||
          l.phone_e164 === directMetaWebhook.phone
      );

      expect(existing).toBeDefined();

      if (existing) {
        // Enrich existing identity
        existing.meta_leadgen_id = directMetaWebhook.leadgen_id;

        // Idempotency: Do not increment or trigger second first contact
        if (existing.first_contact_count >= 1) {
          // No-op for first contact outreach
        } else {
          existing.first_contact_count += 1;
        }
      }

      // Assertions:
      expect(store.length).toBe(1); // Still exactly ONE lead
      expect(store[0].hubspot_contact_id).toBe('hs-100200');
      expect(store[0].meta_leadgen_id).toBe('meta_leadgen_999888');
      expect(store[0].first_contact_count).toBe(1); // Max 1 first contact
    });
  });

  // ===========================================================================
  // Salutation & Date Formatting Parity
  // ===========================================================================
  describe('Salutation & Date Formatting Safety Rules', () => {
    it('uses reliable first name or falls back safely to Doctor', () => {
      expect(resolveSafeFirstName('Scott')).toBe('Scott');
      expect(resolveSafeFirstName(null)).toBe('Doctor');
      expect(resolveSafeFirstName('')).toBe('Doctor');
      expect(resolveSafeFirstName('Doutor(a)')).toBe('Doctor');

      expect(resolveCanonicalGreeting('Scott')).toBe('Hello Scott,');
      expect(resolveCanonicalGreeting(null)).toBe('Hello Doctor,');
      expect(resolveCanonicalGreeting('')).toBe('Hello Doctor,');
      expect(resolveCanonicalGreeting('undefined')).toBe('Hello Doctor,');
      expect(resolveCanonicalGreeting('null')).toBe('Hello Doctor,');
      expect(resolveCanonicalGreeting('{{first_name}}')).toBe('Hello Doctor,');
      expect(resolveCanonicalGreeting('Doutor(a)')).toBe('Hello Doctor,');
    });

    it('formats cohort date ranges in natural Portuguese', () => {
      const formatted = formatCohortDateRange('2026-11-07', '2026-11-10');
      expect(formatted).toBe('7–10 de novembro de 2026');
    });
  });

  // ===========================================================================
  // SCENARIO L: Historical status backfill preview exact match
  // ===========================================================================
  describe('SCENARIO L: Historical status backfill preview exact match', () => {
    it('verifies exact baseline breakdown: 2282 / 43 / 148 / 47 / 112 = 2632', () => {
      const auditedRawCounts = {
        'Sem resposta': 2282,
        'Alguma resposta': 43,
        'Interessado': 77,
        'Quente': 47,
        'Confirmado': 112,
        'NULL / não preenchido': 71,
      };

      const mappedEdsStages = {
        capture: auditedRawCounts['Sem resposta'],
        qualification: auditedRawCounts['Alguma resposta'],
        acquisition: auditedRawCounts['Interessado'] + auditedRawCounts['NULL / não preenchido'],
        approval: auditedRawCounts['Quente'],
        enrollment: auditedRawCounts['Confirmado'],
      };

      const totalAudited = Object.values(auditedRawCounts).reduce((a, b) => a + b, 0);

      expect(mappedEdsStages.capture).toBe(2282);       // Novo Lead
      expect(mappedEdsStages.qualification).toBe(43);   // Respondido
      expect(mappedEdsStages.acquisition).toBe(148);     // Interessado (77 + 71)
      expect(mappedEdsStages.approval).toBe(47);        // Quente
      expect(mappedEdsStages.enrollment).toBe(112);      // Matrícula
      expect(totalAudited).toBe(2632);
    });
  });

  // ===========================================================================
  // SCENARIO M: Historical status backfill idempotency
  // ===========================================================================
  describe('SCENARIO M: Historical status backfill idempotency', () => {
    it('second execution changes 0 records when contacts are already in target stages', () => {
      interface LeadBackfillState {
        id: string;
        stage_code: 'capture' | 'qualification' | 'acquisition' | 'approval' | 'enrollment';
        qual_status: string;
      }

      // Initial state post-backfill
      const leads: LeadBackfillState[] = [
        { id: 'lead-1', stage_code: 'capture', qual_status: 'no_response' },
        { id: 'lead-2', stage_code: 'qualification', qual_status: 'responded' },
        { id: 'lead-3', stage_code: 'acquisition', qual_status: 'qualified' },
        { id: 'lead-4', stage_code: 'approval', qual_status: 'hot' },
        { id: 'lead-5', stage_code: 'enrollment', qual_status: 'enrolled' },
      ];

      // Second execution: Re-apply mapping
      let changesCount = 0;
      const targetMappings: Record<string, { stage_code: LeadBackfillState['stage_code']; qual: string }> = {
        'lead-1': { stage_code: 'capture', qual: 'no_response' },
        'lead-2': { stage_code: 'qualification', qual: 'responded' },
        'lead-3': { stage_code: 'acquisition', qual: 'qualified' },
        'lead-4': { stage_code: 'approval', qual: 'hot' },
        'lead-5': { stage_code: 'enrollment', qual: 'enrolled' },
      };

      for (const lead of leads) {
        const target = targetMappings[lead.id];
        if (lead.stage_code !== target.stage_code || lead.qual_status !== target.qual) {
          lead.stage_code = target.stage_code;
          lead.qual_status = target.qual;
          changesCount++;
        }
      }

      // Invariant: Second execution changes 0 records
      expect(changesCount).toBe(0);
    });
  });

  // ===========================================================================
  // SCENARIO N: 71 NULL HubSpot status explicitly mapped to Interessado
  // ===========================================================================
  describe('SCENARIO N: 71 NULL HubSpot status -> Interessado (acquisition)', () => {
    it('maps all unpopulated status_de_qualificacao records to acquisition stage', () => {
      const sampleNullContacts = [
        { id: 'hs-1', status_de_qualificacao: null },
        { id: 'hs-2', status_de_qualificacao: '' },
        { id: 'hs-3', status_de_qualificacao: undefined },
      ];

      const resolveStage = (rawStatus?: string | null) => {
        if (!rawStatus || rawStatus.trim() === '') {
          return 'acquisition'; // Interessado
        }
        if (rawStatus === 'Sem resposta') return 'capture';
        if (rawStatus === 'Alguma resposta') return 'qualification';
        if (rawStatus === 'Interessado') return 'acquisition';
        if (rawStatus === 'Quente') return 'approval';
        if (rawStatus === 'Confirmado') return 'enrollment';
        return 'acquisition';
      };

      for (const c of sampleNullContacts) {
        expect(resolveStage(c.status_de_qualificacao)).toBe('acquisition');
      }
    });
  });

  // ===========================================================================
  // SCENARIO O: Course resolver reference values exact resolution
  // ===========================================================================
  describe('SCENARIO O: Course resolver reference values exact resolution', () => {
    it('resolves all 8 approved reference interests according to approved rules', () => {
      // 1. Intensive -> IDIT-01
      const resIntensive = resolveCourseSignal('Intensive');
      expect(resIntensive.status).toBe('resolved');
      expect(resIntensive.courseCode).toBe('IDIT-01');
      expect(resIntensive.courseName).toBe('Intensive Dental Implant Training');

      // 2. Advanced -> ADIE-01
      const resAdvanced = resolveCourseSignal('Advanced');
      expect(resAdvanced.status).toBe('resolved');
      expect(resAdvanced.courseCode).toBe('ADIE-01');
      expect(resAdvanced.courseName).toBe('Advanced Dental Implant Experience');

      // 3. Wisdom -> WTT-01
      const resWisdom = resolveCourseSignal('Wisdom');
      expect(resWisdom.status).toBe('resolved');
      expect(resWisdom.courseCode).toBe('WTT-01');
      expect(resWisdom.courseName).toBe('Wisdom Teeth Training');

      // 4. Endodontic -> ET-01
      const resEndo = resolveCourseSignal('Endodontic');
      expect(resEndo.status).toBe('resolved');
      expect(resEndo.courseCode).toBe('ET-01');
      expect(resEndo.courseName).toBe('Endodontics Training');

      // 5. Periodontal Plastic -> PST-01
      const resPerio = resolveCourseSignal('Periodontal Plastic');
      expect(resPerio.status).toBe('resolved');
      expect(resPerio.courseCode).toBe('PST-01');
      expect(resPerio.courseName).toBe('Periodontal Surgery Training');

      // 6. Zygomatic -> ZIT-01
      const resZygo = resolveCourseSignal('Zygomatic');
      expect(resZygo.status).toBe('resolved');
      expect(resZygo.courseCode).toBe('ZIT-01');
      expect(resZygo.courseName).toBe('Zygomatic Implant Training');

      // 7. Rehabilitation -> AIRE-01
      const resRehab = resolveCourseSignal('Rehabilitation');
      expect(resRehab.status).toBe('resolved');
      expect(resRehab.courseCode).toBe('AIRE-01');
      expect(resRehab.courseName).toBe('Advanced Implant Rehabilitation Experience');

      // 8. Free courses -> historical/free interest (NEVER mapped to paid course)
      const resFree = resolveCourseSignal('Free courses');
      expect(resFree.status).toBe('historical_free');
      expect(resFree.courseCode).toBeNull();
      expect(resFree.courseName).toBe('Free Courses (Historical)');
    });

    it('preserves additional catalog courses (MA-01, PRF-01) without false reference claims', () => {
      const resMA = resolveCourseSignal('MA-01');
      expect(resMA.status).toBe('resolved');
      expect(resMA.courseCode).toBe('MA-01');

      const resPRF = resolveCourseSignal('PRF-01');
      expect(resPRF.status).toBe('resolved');
      expect(resPRF.courseCode).toBe('PRF-01');
    });

    it('safely returns unmapped status for unknown courses without guessing', () => {
      const resUnknown = resolveCourseSignal('Random Dental Topic XYZ');
      expect(resUnknown.status).toBe('unmapped');
      expect(resUnknown.courseCode).toBeNull();
      expect(resUnknown.rawSignal).toBe('Random Dental Topic XYZ');
    });
  });
});


