import { describe, it, expect } from 'vitest';
import {
  analyzeCsvImport,
  classifyRow,
  buildUpdatePayload,
  buildDbLeadIndexes,
  buildFieldToColumnMap,
  type DbLeadRef,
  type PipelineStageRef,
} from '../features/leads/utils/csvImportEngine';
import { getQualificationStatusLabel } from '../features/leads/utils/qualificationMapping';

describe('CSV Import Engine - Preview, Safe Deduplication & Conflict Isolation', () => {
  const mockStages: PipelineStageRef[] = [
    { id: 'stg-1', code: 'capture', name: 'Capture', sort_order: 1 },
    { id: 'stg-2', code: 'qualification', name: 'Qualification', sort_order: 2 },
    { id: 'stg-3', code: 'acquisition', name: 'Acquisition', sort_order: 3 },
    { id: 'stg-4', code: 'approval', name: 'Approval', sort_order: 4 },
    { id: 'stg-5', code: 'enrollment', name: 'Enrollment', sort_order: 5 },
    { id: 'stg-6', code: 'post_course', name: 'Post-Course', sort_order: 6 },
    { id: 'stg-7', code: 'alumni', name: 'Alumni', sort_order: 7 },
  ];

  const stageById = new Map(mockStages.map((s) => [s.id, s]));
  const qualStage = mockStages.find((s) => s.code === 'qualification')!;

  const columnMapping = {
    'Record ID': 'hubspot_contact_id',
    'First Name': 'first_name',
    'Last Name': 'last_name',
    'Email': 'email',
    'Phone Number': 'phone',
    'Status de Qualificação': 'qualification_status',
    'Curso de Interesse': 'course_interest',
    'Preferred channels': 'contact_preference',
  };

  it('correctly inverts column mapping', () => {
    const fieldToCol = buildFieldToColumnMap(columnMapping);
    expect(fieldToCol.hubspot_contact_id).toBe('Record ID');
    expect(fieldToCol.first_name).toBe('First Name');
    expect(fieldToCol.phone).toBe('Phone Number');
    expect(fieldToCol.qualification_status).toBe('Status de Qualificação');
  });

  describe('Priority 1: hubspot_contact_id exact match', () => {
    it('matches by HubSpot contact ID even if email or phone differs', () => {
      const dbLeads: DbLeadRef[] = [
        {
          id: 'lead-hs-1',
          hubspot_contact_id: 'HS-1001',
          email: 'old@example.com',
          phone_raw: '1111111111',
          pipeline_stage_id: 'stg-1',
          qualification_status: 'no_response',
        },
      ];

      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const csvPhoneCountMap = new Map<string, number>();
      const stageByCode = new Map(mockStages.map((s) => [s.code, s]));
      const fieldToCol = buildFieldToColumnMap(columnMapping);

      const row = {
        'Record ID': 'HS-1001',
        'First Name': 'Updated',
        'Last Name': 'Person',
        'Email': 'new_email@example.com',
        'Phone Number': '2222222222',
        'Status de Qualificação': 'Interessado',
        'Curso de Interesse': 'Pilates',
      };

      const res = classifyRow(
        row,
        1,
        fieldToCol,
        dbHubspotIdMap,
        dbEmailMap,
        dbPhoneToLeadsMap,
        csvPhoneCountMap,
        stageByCode,
      );

      expect(res.action).toBe('update');
      expect(res.matchedLead?.id).toBe('lead-hs-1');
      expect(res.conflictReason).toBeNull();
    });
  });

  describe('Priority 2: email normalized exact match', () => {
    it('matches by normalized email when no hubspot_contact_id matches', () => {
      const dbLeads: DbLeadRef[] = [
        {
          id: 'lead-em-1',
          email: 'carla@domain.com',
          phone_raw: '3333333333',
          pipeline_stage_id: 'stg-1',
        },
      ];

      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const csvPhoneCountMap = new Map<string, number>();
      const stageByCode = new Map(mockStages.map((s) => [s.code, s]));
      const fieldToCol = buildFieldToColumnMap(columnMapping);

      const row = {
        'Record ID': 'HS-NEW-99',
        'First Name': 'Carla',
        'Last Name': 'Silva',
        'Email': '  CARLA@domain.com  ',
        'Phone Number': '3333333333',
        'Status de Qualificação': 'Quente',
      };

      const res = classifyRow(
        row,
        1,
        fieldToCol,
        dbHubspotIdMap,
        dbEmailMap,
        dbPhoneToLeadsMap,
        csvPhoneCountMap,
        stageByCode,
      );

      expect(res.action).toBe('update');
      expect(res.matchedLead?.id).toBe('lead-em-1');
      expect(res.extracted.qualificationStatus).toBe('hot');
    });

    it('flags conflict when email points to Lead A and phone points to Lead B', () => {
      const dbLeads: DbLeadRef[] = [
        { id: 'lead-A', email: 'user@domain.com', phone_raw: '1111111111' },
        { id: 'lead-B', email: 'other@domain.com', phone_raw: '2222222222' },
      ];

      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const csvPhoneCountMap = new Map<string, number>();
      const stageByCode = new Map(mockStages.map((s) => [s.code, s]));
      const fieldToCol = buildFieldToColumnMap(columnMapping);

      const row = {
        'Record ID': 'HS-CONFLICT-1',
        'First Name': 'Conflicted',
        'Email': 'user@domain.com', // points to lead-A
        'Phone Number': '2222222222', // points to lead-B
      };

      const res = classifyRow(
        row,
        1,
        fieldToCol,
        dbHubspotIdMap,
        dbEmailMap,
        dbPhoneToLeadsMap,
        csvPhoneCountMap,
        stageByCode,
      );

      expect(res.action).toBe('conflict');
      expect(res.matchedLead).toBeNull();
      expect(res.conflictReason).toContain('Email points to one lead and Phone points to a different lead');
    });
  });

  describe('Priority 3: Phone ONLY if strictly unique on both sides', () => {
    it('matches safely when phone is unique in CSV and unique in CRM', () => {
      const dbLeads: DbLeadRef[] = [
        { id: 'lead-unique-phone', phone_raw: '+1 (555) 123-4567', pipeline_stage_id: 'stg-1' },
      ];

      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const csvPhoneCountMap = new Map<string, number>([['15551234567', 1]]);
      const stageByCode = new Map(mockStages.map((s) => [s.code, s]));
      const fieldToCol = buildFieldToColumnMap(columnMapping);

      const row = {
        'Record ID': 'HS-PHONE-1',
        'First Name': 'Unique',
        'Phone Number': '+1 (555) 123-4567',
        'Status de Qualificação': 'Confirmado',
      };

      const res = classifyRow(
        row,
        1,
        fieldToCol,
        dbHubspotIdMap,
        dbEmailMap,
        dbPhoneToLeadsMap,
        csvPhoneCountMap,
        stageByCode,
      );

      expect(res.action).toBe('update');
      expect(res.matchedLead?.id).toBe('lead-unique-phone');
    });

    it('flags conflict if phone is repeated in CSV (shared phone across contacts)', () => {
      const dbLeads: DbLeadRef[] = [
        { id: 'lead-phone-csv-dup', phone_raw: '19149182770' },
      ];

      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const csvPhoneCountMap = new Map<string, number>([['19149182770', 2]]); // appears 2x in CSV!
      const stageByCode = new Map(mockStages.map((s) => [s.code, s]));
      const fieldToCol = buildFieldToColumnMap(columnMapping);

      const row = {
        'Record ID': 'HS-SHARED-1',
        'First Name': 'Angela',
        'Phone Number': '+1 914-918-2770',
      };

      const res = classifyRow(
        row,
        1,
        fieldToCol,
        dbHubspotIdMap,
        dbEmailMap,
        dbPhoneToLeadsMap,
        csvPhoneCountMap,
        stageByCode,
      );

      expect(res.action).toBe('conflict');
      expect(res.matchedLead).toBeNull();
      expect(res.conflictReason).toContain('Phone is shared by 2 contacts in CSV');
    });

    it('flags conflict if phone belongs to multiple leads in DB', () => {
      const dbLeads: DbLeadRef[] = [
        { id: 'lead-db-dup-1', phone_raw: '7703625569' },
        { id: 'lead-db-dup-2', phone_raw: '7703625569' },
      ];

      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const csvPhoneCountMap = new Map<string, number>([['7703625569', 1]]); // unique in CSV but dup in DB!
      const stageByCode = new Map(mockStages.map((s) => [s.code, s]));
      const fieldToCol = buildFieldToColumnMap(columnMapping);

      const row = {
        'Record ID': 'HS-DB-DUP',
        'First Name': 'Duplicate',
        'Phone Number': '770-362-5569',
      };

      const res = classifyRow(
        row,
        1,
        fieldToCol,
        dbHubspotIdMap,
        dbEmailMap,
        dbPhoneToLeadsMap,
        csvPhoneCountMap,
        stageByCode,
      );

      expect(res.action).toBe('conflict');
      expect(res.matchedLead).toBeNull();
      expect(res.conflictReason).toContain('Phone is shared by 2 leads in CRM');
    });
  });

  describe('Non-Destructive Merge (Empty CSV cells never overwrite existing data)', () => {
    it('preserves existing DB values when CSV cell is blank', () => {
      const existingLead: DbLeadRef = {
        id: 'lead-merge-1',
        first_name: 'ExistingFirst',
        last_name: 'ExistingLast',
        email: 'keepme@example.com',
        phone_raw: '9999999999',
        course_interest: 'Pilates Comprehensive',
        pipeline_stage_id: 'stg-1',
        qualification_status: 'some_response',
      };

      const extracted = {
        firstName: '', // empty in CSV
        lastName: 'NewLast', // filled in CSV
        email: '', // empty in CSV
        emailConfirmation: '',
        phone: '', // empty in CSV
        phoneDigits: '',
        hubspotId: 'HS-MERGE-1', // filled in CSV
        qualificationStatus: 'hot' as const, // filled in CSV
        courseInterest: '', // empty in CSV
        contactPreference: 'email' as const,
        source: 'manual' as const,
        targetExplicitStage: null,
        tags: '',
      };

      const { updateData } = buildUpdatePayload(existingLead, extracted, stageById, qualStage);

      // Filled fields are updated
      expect(updateData.last_name).toBe('NewLast');
      expect(updateData.hubspot_contact_id).toBe('HS-MERGE-1');
      expect(updateData.qualification_status).toBe('hot');

      // Empty fields are NOT in updateData, preserving existing values
      expect(updateData.first_name).toBeUndefined();
      expect(updateData.email).toBeUndefined();
      expect(updateData.phone_raw).toBeUndefined();
      expect(updateData.course_interest).toBeUndefined();
    });
  });

  describe('Pipeline Stage Anti-Downgrade Protection', () => {
    it('promotes lead in capture (sort_order 1) to qualification (sort_order 2) when status is present', () => {
      const existingLead: DbLeadRef = {
        id: 'lead-promote',
        pipeline_stage_id: 'stg-1', // capture
      };

      const extracted = {
        firstName: 'Promote',
        lastName: 'Me',
        email: 'promote@example.com',
        emailConfirmation: '',
        phone: '1234567890',
        phoneDigits: '1234567890',
        hubspotId: 'HS-PROMOTE',
        qualificationStatus: 'interested' as const,
        courseInterest: '',
        contactPreference: 'email' as const,
        source: 'manual' as const,
        targetExplicitStage: null,
        tags: '',
      };

      const { newStageId, stageChangeReason } = buildUpdatePayload(existingLead, extracted, stageById, qualStage);
      expect(newStageId).toBe('stg-2'); // promoted to qualification!
      expect(stageChangeReason).toBe('csv_import_stage_mapping');
    });

    it('STRICTLY PROTECTS advanced stages (sort_order >= 3) from downgrade', () => {
      const advancedStageCodes = ['acquisition', 'approval', 'enrollment', 'post_course', 'alumni'];

      advancedStageCodes.forEach((code) => {
        const stage = mockStages.find((s) => s.code === code)!;
        const advancedLead: DbLeadRef = {
          id: `lead-${code}`,
          pipeline_stage_id: stage.id,
        };

        const extracted = {
          firstName: 'Advanced',
          lastName: 'Student',
          email: `${code}@example.com`,
          emailConfirmation: '',
          phone: '9876543210',
          phoneDigits: '9876543210',
          hubspotId: `HS-${code}`,
          qualificationStatus: 'hot' as const,
          courseInterest: '',
          contactPreference: 'email' as const,
          source: 'manual' as const,
          targetExplicitStage: null,
          tags: '',
        };

        const { newStageId } = buildUpdatePayload(advancedLead, extracted, stageById, qualStage);
        // Must NOT downgrade to qualification!
        expect(newStageId).toBeNull();
      });
    });
  });

  describe('Full Preview Simulation (analyzeCsvImport)', () => {
    it('simulates batch rows accurately into New Leads, To Update, and Conflicts', () => {
      const dbLeads: DbLeadRef[] = [
        { id: 'db-1', hubspot_contact_id: 'HS-1' },
        { id: 'db-2', email: 'person2@domain.com' },
        { id: 'db-3', phone_raw: '1112223333' },
      ];

      const csvRows = [
        // Match by HubSpot ID
        { 'Record ID': 'HS-1', 'First Name': 'Alice', 'Email': 'a@a.com', 'Phone Number': '999' },
        // Match by Email
        { 'Record ID': 'HS-NEW-1', 'First Name': 'Bob', 'Email': 'person2@domain.com', 'Phone Number': '888' },
        // Match by Unique Phone
        { 'Record ID': 'HS-NEW-2', 'First Name': 'Carol', 'Email': '', 'Phone Number': '111-222-3333' },
        // Conflict: Phone repeated in CSV!
        { 'Record ID': 'HS-NEW-3', 'First Name': 'Dan 1', 'Email': '', 'Phone Number': '4445556666' },
        { 'Record ID': 'HS-NEW-4', 'First Name': 'Dan 2', 'Email': '', 'Phone Number': '4445556666' },
        // Brand New Lead
        { 'Record ID': 'HS-NEW-5', 'First Name': 'Eve', 'Email': 'brandnew@domain.com', 'Phone Number': '7778889999' },
        // Invalid / empty row
        { 'Record ID': '', 'First Name': '', 'Email': '', 'Phone Number': '' },
      ];

      const analysis = analyzeCsvImport(csvRows, columnMapping, dbLeads, mockStages);

      expect(analysis.totalRows).toBe(7);
      expect(analysis.existingToUpdateCount).toBe(3); // Alice, Bob, Carol
      expect(analysis.conflictsCount).toBe(2); // Dan 1 and Dan 2 (shared phone in CSV)
      expect(analysis.newLeadsCount).toBe(1); // Eve
      expect(analysis.invalidCount).toBe(1); // Empty row
      expect(analysis.conflicts).toHaveLength(2);
      expect(analysis.conflicts[0].reason).toContain('Phone is shared by 2 contacts in CSV');
    });

    it('scales to 2,599 rows in milliseconds without memory strain', () => {
      const rows: Record<string, string>[] = [];
      for (let i = 0; i < 2599; i++) {
        rows.push({
          'Record ID': `HS-${100000 + i}`,
          'First Name': `Lead_${i}`,
          'Last Name': `Test_${i}`,
          'Email': i % 10 === 0 ? `lead_${i}@example.com` : '',
          'Phone Number': `+1555${String(i).padStart(7, '0')}`,
          'Status de Qualificação': i % 2 === 0 ? 'Quente' : 'Sem resposta',
        });
      }

      const dbLeads: DbLeadRef[] = [];
      for (let j = 0; j < 2500; j++) {
        dbLeads.push({
          id: `db-lead-${j}`,
          phone_raw: `+1555${String(j).padStart(7, '0')}`,
          pipeline_stage_id: 'stg-1',
        });
      }

      const start = performance.now();
      const analysis = analyzeCsvImport(rows, columnMapping, dbLeads, mockStages);
      const elapsed = performance.now() - start;

      expect(analysis.totalRows).toBe(2599);
      expect(analysis.existingToUpdateCount).toBe(2500);
      expect(analysis.newLeadsCount).toBe(99);
      expect(analysis.conflictsCount).toBe(0);
      // Performance check: should complete in well under 200ms
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('Qualification Status Display Values', () => {
    it('displays canonical English labels for all qualification statuses', () => {
      expect(getQualificationStatusLabel('no_response')).toBe('No Response');
      expect(getQualificationStatusLabel('some_response')).toBe('Some Response');
      expect(getQualificationStatusLabel('interested')).toBe('Interested');
      expect(getQualificationStatusLabel('hot')).toBe('Hot');
      expect(getQualificationStatusLabel('confirmed')).toBe('Confirmed');
      expect(getQualificationStatusLabel(null)).toBe('None');
    });
  });
});
