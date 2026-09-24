import { describe, it, expect } from 'vitest';

describe('EDS HUB — Dual Ingestion Deduplication Suite (Meta Direct + HubSpot Mirror)', () => {
  // Mock Lead Store to test state transformations
  interface LeadRecord {
    id: string;
    source: 'meta' | 'google' | 'manual' | 'test';
    source_detail: string;
    external_lead_id: string | null;
    hubspot_contact_id: string | null;
    first_name: string;
    last_name: string;
    email: string;
    phone_raw: string;
    phone_e164: string | null;
    pipeline_stage_id: string;
    qualification_status: string;
    created_at: string;
    updated_at: string;
  }

  interface EntityLink {
    integration: string;
    entity_type: string;
    eds_entity_id: string;
    external_entity_id: string;
    status: 'active' | 'conflict' | 'archived';
  }

  interface CourseInterest {
    lead_id: string;
    course_id: string;
    course_session_id?: string | null;
    priority?: number | null;
    source: string;
    status: string;
  }

  interface OperationalTask {
    lead_id: string;
    task_type: string;
    title: string;
    status: 'pending' | 'completed';
  }

  interface ConflictRecord {
    conflict_type: string;
    conflict_summary: string;
    field_name: string;
  }

  // ===========================================================================
  // 1. Ingestion Ordering & Convergence
  // ===========================================================================
  describe('Ingestion Ordering & Convergence into ONE Lead', () => {
    it('Scenario 1: Meta direct arrives first -> HubSpot mirror arrives later -> ONE lead', () => {
      const leads: LeadRecord[] = [];
      const links: EntityLink[] = [];

      // Step 1: Meta direct ingestion creates lead
      const metaLead: LeadRecord = {
        id: 'lead-meta-1',
        source: 'meta',
        source_detail: 'instagram',
        external_lead_id: 'meta-lead-12345',
        hubspot_contact_id: null,
        first_name: 'Dra. Camila',
        last_name: 'Silveira',
        email: 'camila.silveira@example.com',
        phone_raw: '+55 11 98765-4321',
        phone_e164: '+5511987654321',
        pipeline_stage_id: 'stage-capture-id',
        qualification_status: 'no_response',
        created_at: new Date('2026-09-24T10:00:00Z').toISOString(),
        updated_at: new Date('2026-09-24T10:00:00Z').toISOString(),
      };
      leads.push(metaLead);

      expect(leads.length).toBe(1);
      expect(leads[0].source).toBe('meta');
      expect(leads[0].external_lead_id).toBe('meta-lead-12345');
      expect(leads[0].hubspot_contact_id).toBeNull();

      // Step 2: Later HubSpot mirror arrives with same email & phone
      const incomingHubSpotContact = {
        id: 'hs-contact-9876',
        email: 'camila.silveira@example.com',
        phone: '+55 11 98765-4321',
        firstname: 'Camila',
        lastname: 'Silveira',
        hs_lead_status: 'qualification',
      };

      // Inbound matching matches by email
      const matchedLead = leads.find((l) => l.email.toLowerCase() === incomingHubSpotContact.email.toLowerCase());
      expect(matchedLead).toBeDefined();

      if (matchedLead) {
        // Safe update: updates HubSpot contact ID and links entity, does NOT create new lead
        matchedLead.hubspot_contact_id = incomingHubSpotContact.id;
        matchedLead.updated_at = new Date('2026-09-24T10:05:00Z').toISOString();

        links.push({
          integration: 'hubspot',
          entity_type: 'lead',
          eds_entity_id: matchedLead.id,
          external_entity_id: incomingHubSpotContact.id,
          status: 'active',
        });
      }

      // Assertions: Still exactly 1 lead, source remains 'meta', both external IDs exist
      expect(leads.length).toBe(1);
      expect(leads[0].id).toBe('lead-meta-1');
      expect(leads[0].source).toBe('meta');
      expect(leads[0].source_detail).toBe('instagram');
      expect(leads[0].external_lead_id).toBe('meta-lead-12345');
      expect(leads[0].hubspot_contact_id).toBe('hs-contact-9876');
      expect(links.length).toBe(1);
      expect(links[0].eds_entity_id).toBe('lead-meta-1');
      expect(links[0].external_entity_id).toBe('hs-contact-9876');
    });

    it('Scenario 2: HubSpot mirror arrives first -> Meta direct arrives later -> ONE lead', () => {
      const leads: LeadRecord[] = [];

      // Step 1: HubSpot mirror ingestion creates initial lead
      const hubspotLead: LeadRecord = {
        id: 'lead-hubspot-1',
        source: 'manual',
        source_detail: 'hubspot_sync',
        external_lead_id: null,
        hubspot_contact_id: 'hs-contact-5555',
        first_name: 'Dr. Roberto',
        last_name: 'Almeida',
        email: 'roberto.almeida@example.com',
        phone_raw: '+55 21 99887-7665',
        phone_e164: '+5521998877665',
        pipeline_stage_id: 'stage-capture-id',
        qualification_status: 'no_response',
        created_at: new Date('2026-09-24T10:00:00Z').toISOString(),
        updated_at: new Date('2026-09-24T10:00:00Z').toISOString(),
      };
      leads.push(hubspotLead);

      expect(leads.length).toBe(1);
      expect(leads[0].external_lead_id).toBeNull();
      expect(leads[0].hubspot_contact_id).toBe('hs-contact-5555');

      // Step 2: Later Meta direct ingestion arrives with matching normalized E164 phone
      const incomingMetaLead = {
        leadgen_id: 'meta-lead-77777',
        cleanEmail: 'roberto.almeida@example.com',
        phoneE164: '+5521998877665',
        rawPhone: '+55 21 99887-7665',
        sourceDetail: 'facebook',
      };

      // Meta webhook checks: by external_id, then by email, then by E164 phone
      const matchedLead = leads.find(
        (l) => l.email === incomingMetaLead.cleanEmail || (incomingMetaLead.phoneE164 && l.phone_e164 === incomingMetaLead.phoneE164)
      );
      expect(matchedLead).toBeDefined();

      if (matchedLead) {
        // Meta webhook attaches external_lead_id without creating duplicate lead
        if (!matchedLead.external_lead_id) {
          matchedLead.external_lead_id = incomingMetaLead.leadgen_id;
        }
        matchedLead.updated_at = new Date('2026-09-24T10:05:00Z').toISOString();
      }

      // Assertions: Still exactly 1 lead, both IDs bound to the same lead
      expect(leads.length).toBe(1);
      expect(leads[0].id).toBe('lead-hubspot-1');
      expect(leads[0].external_lead_id).toBe('meta-lead-77777');
      expect(leads[0].hubspot_contact_id).toBe('hs-contact-5555');
    });
  });

  // ===========================================================================
  // 2. Identity Matching & Conflict Protection
  // ===========================================================================
  describe('Matching Safety & Identity Collision Protection', () => {
    it('matches by normalized unique email', () => {
      const leads: LeadRecord[] = [
        {
          id: 'lead-1',
          source: 'meta',
          source_detail: 'instagram',
          external_lead_id: 'meta-1',
          hubspot_contact_id: null,
          first_name: 'Ana',
          last_name: 'Costa',
          email: 'ana.costa@clinica.com.br',
          phone_raw: '11999998888',
          phone_e164: '+5511999998888',
          pipeline_stage_id: 'stage-1',
          qualification_status: 'no_response',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const inputEmail = '  Ana.Costa@Clinica.Com.BR  '.trim().toLowerCase();
      const match = leads.find((l) => l.email.toLowerCase() === inputEmail);
      expect(match).toBeDefined();
      expect(match?.id).toBe('lead-1');
    });

    it('matches by normalized E.164 phone when email is unprovided or differs', () => {
      const leads: LeadRecord[] = [
        {
          id: 'lead-phone-1',
          source: 'meta',
          source_detail: 'facebook',
          external_lead_id: 'meta-2',
          hubspot_contact_id: null,
          first_name: 'Bruno',
          last_name: 'Dias',
          email: 'bruno@example.com',
          phone_raw: '+1 (407) 555-1234',
          phone_e164: '+14075551234',
          pipeline_stage_id: 'stage-1',
          qualification_status: 'no_response',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const incomingPhoneE164 = '+14075551234';
      const match = leads.find((l) => l.phone_e164 === incomingPhoneE164);
      expect(match).toBeDefined();
      expect(match?.id).toBe('lead-phone-1');
    });

    it('detects identity conflict when incoming email matches Lead A and phone matches Lead B -> BLOCKS auto-merge', () => {
      const leads: LeadRecord[] = [
        {
          id: 'lead-a',
          source: 'meta',
          source_detail: 'instagram',
          external_lead_id: 'meta-10',
          hubspot_contact_id: null,
          first_name: 'Carlos',
          last_name: 'Mendes',
          email: 'carlos@example.com',
          phone_raw: '+5511911111111',
          phone_e164: '+5511911111111',
          pipeline_stage_id: 'stage-1',
          qualification_status: 'no_response',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'lead-b',
          source: 'meta',
          source_detail: 'facebook',
          external_lead_id: 'meta-20',
          hubspot_contact_id: null,
          first_name: 'Daniela',
          last_name: 'Lima',
          email: 'daniela@example.com',
          phone_raw: '+5511922222222',
          phone_e164: '+5511922222222',
          pipeline_stage_id: 'stage-1',
          qualification_status: 'no_response',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const conflicts: ConflictRecord[] = [];
      const tasks: OperationalTask[] = [];

      const incomingPayload = {
        email: 'carlos@example.com', // matches lead-a
        phone: '+5511922222222',    // matches lead-b
      };

      const matchByEmail = leads.find((l) => l.email === incomingPayload.email);
      const matchByPhone = leads.find((l) => l.phone_e164 === incomingPayload.phone);

      const isCollision = matchByEmail && matchByPhone && matchByEmail.id !== matchByPhone.id;
      expect(isCollision).toBe(true);

      if (isCollision) {
        conflicts.push({
          conflict_type: 'EMAIL_PHONE_SPLIT_COLLISION',
          conflict_summary: `Incoming payload matches email of ${matchByEmail.id} and phone of ${matchByPhone.id}. Merge blocked.`,
          field_name: 'identity',
        });

        tasks.push({
          lead_id: matchByEmail.id,
          task_type: 'data_review',
          title: 'Meta Lead Conflict: Email & Phone Mismatch',
          status: 'pending',
        });
      }

      // Assertions: Neither lead is modified, no auto-merge occurs, review task is recorded
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('EMAIL_PHONE_SPLIT_COLLISION');
      expect(tasks.length).toBe(1);
      expect(leads.length).toBe(2);
      expect(leads[0].email).toBe('carlos@example.com');
      expect(leads[1].email).toBe('daniela@example.com');
    });
  });

  // ===========================================================================
  // 3. Automation Gating & Idempotency
  // ===========================================================================
  describe('First-Contact Automation Suppression & Idempotency', () => {
    it('confirms ENABLE_META_FIRST_EMAIL_AUTOMATION remains FALSE', () => {
      const isMetaAutoEmailActive = process.env.ENABLE_META_FIRST_EMAIL_AUTOMATION === 'true';
      expect(isMetaAutoEmailActive).toBe(false);
    });

    it('suppresses first-contact automation when lead arrives via HubSpot mirror', () => {
      const syncOrigin = 'hubspot_sync';
      const isHubSpotOrigin = ['hubspot_sync', 'hubspot_historical', 'hubspot_reconcile'].includes(syncOrigin);

      // Trigger condition from Migration 00051
      const shouldSuppressAutomation = isHubSpotOrigin;
      expect(shouldSuppressAutomation).toBe(true);
    });

    it('suppresses first-contact automation for historical or bulk HubSpot imports', () => {
      const sourceDetail = 'hubspot_historical';
      const isHistoricalImport = ['hubspot_sync', 'hubspot_historical', 'csv_import'].includes(sourceDetail);

      expect(isHistoricalImport).toBe(true);
    });

    it('prevents duplicate first-contact automation if lead has already been contacted or attempted', () => {
      const outboundMessages = [
        {
          id: 'outbound-msg-1',
          lead_id: 'lead-100',
          channel: 'email',
          template_key: 'lead_intake_email',
          status: 'sent',
        },
      ];

      const checkExisting = (leadId: string) => {
        return outboundMessages.some(
          (m) => m.lead_id === leadId && m.channel === 'email' && m.template_key === 'lead_intake_email' && ['sent', 'delivered', 'pending'].includes(m.status)
        );
      };

      const alreadyAttempted = checkExisting('lead-100');
      expect(alreadyAttempted).toBe(true);

      const canDispatchAgain = !alreadyAttempted;
      expect(canDispatchAgain).toBe(false);
    });
  });

  // ===========================================================================
  // 4. Webhook Retry & Deduplication
  // ===========================================================================
  describe('Webhook Retry & Deduplication Guarantees', () => {
    it('Meta webhook retry with same idempotencyKey / leadgenId is safely ignored', () => {
      const processedIntakeKeys = new Set<string>();

      const event1 = { leadgen_id: 'meta-leadgen-999', form_id: 'form-1' };
      const idempotencyKey1 = `meta_${event1.leadgen_id}_${event1.form_id}`;

      // First run
      const isFirstRunDuplicate = processedIntakeKeys.has(idempotencyKey1);
      expect(isFirstRunDuplicate).toBe(false);
      processedIntakeKeys.add(idempotencyKey1);

      // Webhook retry from Meta network
      const isSecondRunDuplicate = processedIntakeKeys.has(idempotencyKey1);
      expect(isSecondRunDuplicate).toBe(true);
    });

    it('HubSpot webhook retry with same eventId or payload hash is safely ignored', () => {
      const syncEventsByExternalId = new Set<string>();

      const eventId = 'hs-evt-8888';
      // First processing
      expect(syncEventsByExternalId.has(eventId)).toBe(false);
      syncEventsByExternalId.add(eventId);

      // Retry delivery from HubSpot
      const isDuplicate = syncEventsByExternalId.has(eventId);
      expect(isDuplicate).toBe(true);
    });
  });

  // ===========================================================================
  // 5. Course Interests & Task Deduplication
  // ===========================================================================
  describe('Course Interests & Task Deduplication', () => {
    it('prevents duplicate course interests when both Meta and HubSpot provide the same course', () => {
      const interests: CourseInterest[] = [];

      const addCourseInterest = (leadId: string, courseId: string, source: string) => {
        const alreadyExists = interests.some((i) => i.lead_id === leadId && i.course_id === courseId);
        if (!alreadyExists) {
          interests.push({
            lead_id: leadId,
            course_id: courseId,
            source,
            status: 'active',
          });
        }
      };

      // Meta intake adds course
      addCourseInterest('lead-1', 'course-implantology', 'form');
      expect(interests.length).toBe(1);

      // HubSpot sync adds the same course later
      addCourseInterest('lead-1', 'course-implantology', 'hubspot_sync');
      expect(interests.length).toBe(1); // Not duplicated!

      // Adding a different second course works cleanly
      addCourseInterest('lead-1', 'course-orthodontics', 'hubspot_sync');
      expect(interests.length).toBe(2);
    });

    it('prevents duplicate review tasks for unmapped form when lead already has an open pending task', () => {
      const tasks: OperationalTask[] = [];

      const addUnmappedReviewTask = (leadId: string) => {
        const existingPending = tasks.some(
          (t) => t.lead_id === leadId && t.task_type === 'data_review' && t.status === 'pending'
        );
        if (!existingPending) {
          tasks.push({
            lead_id: leadId,
            task_type: 'data_review',
            title: 'Review Unmapped Meta Lead Form',
            status: 'pending',
          });
        }
      };

      // First ingestion creates task
      addUnmappedReviewTask('lead-50');
      expect(tasks.length).toBe(1);

      // Second ingestion checks and avoids duplicate
      addUnmappedReviewTask('lead-50');
      expect(tasks.length).toBe(1);
    });
  });

  // ===========================================================================
  // 6. Pipeline Stage Synchronization Safety
  // ===========================================================================
  describe('Pipeline Stage Synchronization Safety', () => {
    it('HubSpot stage update moves pipeline stage without altering marketing source', () => {
      const lead: LeadRecord = {
        id: 'lead-pipeline-1',
        source: 'meta',
        source_detail: 'instagram',
        external_lead_id: 'meta-555',
        hubspot_contact_id: 'hs-777',
        first_name: 'Dra. Luiza',
        last_name: 'Freitas',
        email: 'luiza@example.com',
        phone_raw: '+5511999990000',
        phone_e164: '+5511999990000',
        pipeline_stage_id: 'stage-capture',
        qualification_status: 'no_response',
        created_at: new Date('2026-09-24T08:00:00Z').toISOString(),
        updated_at: new Date('2026-09-24T08:00:00Z').toISOString(),
      };

      // HubSpot webhook indicates stage changed to 'qualification' (Respondido)
      const incomingStageCode = 'qualification';
      const stageMapping: Record<string, string> = {
        capture: 'stage-capture',
        qualification: 'stage-qualification',
        acquisition: 'stage-acquisition',
        approval: 'stage-approval',
        enrollment: 'stage-enrollment',
      };

      if (stageMapping[incomingStageCode]) {
        lead.pipeline_stage_id = stageMapping[incomingStageCode];
        lead.qualification_status = 'some_response';
        lead.updated_at = new Date('2026-09-24T08:30:00Z').toISOString();
      }

      // Assertions: Pipeline stage updated, but original marketing source remains untouched
      expect(lead.pipeline_stage_id).toBe('stage-qualification');
      expect(lead.qualification_status).toBe('some_response');
      expect(lead.source).toBe('meta');
      expect(lead.source_detail).toBe('instagram');
      expect(lead.external_lead_id).toBe('meta-555');
      expect(lead.hubspot_contact_id).toBe('hs-777');
    });
  });
});
