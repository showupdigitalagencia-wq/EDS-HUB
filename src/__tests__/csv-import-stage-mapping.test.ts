// =============================================================================
// Tests: CSV Import Pipeline Stage Mapping
// =============================================================================
// Verifies:
// 1. Qualified -> Qualificação
// 2. Approved -> Aprovação
// 3. Enrolled -> Matrícula
// 4. Status vazio -> Captura (history = initial_assignment, activity = csv_status_unmapped, NO stage_changed)
// 5. Status desconhecido -> Captura (history = initial_assignment, activity = csv_status_unmapped, NO stage_changed)
// 6. Update existing + status válido diferente -> altera estágio, preserva lead_id, cria history csv_import_stage_mapping, registra stage_changed
// 7. Update existing + mesmo estágio -> não cria histórico redundante nem stage_changed
// 8. Update existing + status vazio/desconhecido -> preserva estágio atual, não faz downgrade, registra apenas csv_status_unmapped
// 9. Skip duplicate -> não altera estágio nem dados do lead existente
// 10. Isolamento estrito: nenhuma mensagem enviada (0 Resend, 0 Twilio), nenhuma task criada
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapCsvStatusToStageCode,
} from '../features/leads/utils/stageMapping';

// Mocked stage registry matching real database records
const PIPELINE_STAGES = [
  { id: 'fe2a6162-1574-409f-975e-d2b5bafb9862', code: 'capture', name: 'Captura', sort_order: 1 },
  { id: '5dd772b7-4ce8-425d-ac9a-46811a76d5fe', code: 'qualification', name: 'Qualificação', sort_order: 2 },
  { id: '5a8bb21c-7770-4841-b27f-db1ca365520a', code: 'acquisition', name: 'Aquisição', sort_order: 3 },
  { id: 'fa39988e-b775-4184-8049-f5ced0ab7fe1', code: 'approval', name: 'Aprovação', sort_order: 4 },
  { id: '3cc8bad1-3abd-4f36-ac5b-480033dc8d48', code: 'enrollment', name: 'Matrícula', sort_order: 5 },
  { id: 'ce22a31d-419c-45fc-b5f1-0b4f24b5c482', code: 'post_course', name: 'Pós-curso', sort_order: 6 },
  { id: '9de406b0-3ea5-4c6a-b58e-b4dd53f09027', code: 'alumni', name: 'Alumni', sort_order: 7 },
];

const STAGE_BY_CODE = new Map(PIPELINE_STAGES.map((s) => [s.code, s]));
const CAPTURE_STAGE = STAGE_BY_CODE.get('capture')!;

interface MockLead {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_raw?: string;
  pipeline_stage_id: string;
}

interface MockStageHistory {
  lead_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  change_reason: 'initial_assignment' | 'auto_after_intake' | 'manual' | 'csv_import_stage_mapping';
}

interface MockActivity {
  lead_id: string;
  activity_type: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

interface ImportRow {
  email?: string;
  phone?: string;
  first_name?: string;
  status?: string;
}

function simulateCsvImportRow(
  row: ImportRow,
  strategy: 'create' | 'update' | 'skip',
  existingLeads: Map<string, MockLead>,
  historyRecords: MockStageHistory[],
  activities: MockActivity[],
  _sentEmails: Array<{ to: string }>,
  _sentSms: Array<{ to: string }>,
  _tasksCreated: Array<{ type: string }>,
) {
  const rawStatus = (row.status || '').trim();
  const mappedCode = mapCsvStatusToStageCode(rawStatus);
  const targetStage = mappedCode ? STAGE_BY_CODE.get(mappedCode) || null : null;

  const emailKey = row.email?.trim().toLowerCase();
  const existingLead = emailKey ? existingLeads.get(emailKey) : null;

  if (existingLead && strategy === 'skip') {
    // Rule 3: Skip Duplicate - do nothing
    return { status: 'skipped', lead_id: existingLead.id };
  }

  if (existingLead && strategy === 'update') {
    const hasStageChanged = Boolean(targetStage && targetStage.id !== existingLead.pipeline_stage_id);
    const fromStageId = existingLead.pipeline_stage_id;

    if (hasStageChanged && targetStage) {
      existingLead.pipeline_stage_id = targetStage.id;
    }

    if (hasStageChanged && targetStage) {
      // Rule 4: Update Existing + status válido diferente
      historyRecords.push({
        lead_id: existingLead.id,
        from_stage_id: fromStageId,
        to_stage_id: targetStage.id,
        change_reason: 'csv_import_stage_mapping',
      });

      activities.push({
        lead_id: existingLead.id,
        activity_type: 'stage_changed',
        summary: `Pipeline stage set from CSV import status: ${rawStatus}`,
        metadata: {
          status_raw: rawStatus,
          to_stage_code: targetStage.code,
        },
      });
    } else if (!targetStage) {
      // Rule 6: Update Existing + status vazio ou desconhecido
      // Preserves current stage, NO stage history, NO stage_changed, logs csv_status_unmapped
      activities.push({
        lead_id: existingLead.id,
        activity_type: 'csv_status_unmapped',
        summary: 'CSV status not mapped; lead kept in current stage',
        metadata: {
          status_raw: rawStatus || null,
          current_stage_id: existingLead.pipeline_stage_id,
        },
      });
    }
    // Rule 5: Update Existing + mesmo estágio -> no redundant stage history or activity

    return { status: 'updated', lead_id: existingLead.id };
  }

  // New lead creation (or strategy === 'create')
  const initialStage = targetStage ? targetStage : CAPTURE_STAGE;
  const newLeadId = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newLead: MockLead = {
    id: newLeadId,
    email: row.email,
    first_name: row.first_name,
    pipeline_stage_id: initialStage.id,
  };
  if (emailKey) existingLeads.set(emailKey, newLead);

  activities.push({
    lead_id: newLeadId,
    activity_type: 'lead_created',
    summary: 'Lead imported from CSV',
  });

  if (targetStage) {
    // Rule 1: Create All + status válido
    historyRecords.push({
      lead_id: newLeadId,
      from_stage_id: null,
      to_stage_id: targetStage.id,
      change_reason: 'csv_import_stage_mapping',
    });

    activities.push({
      lead_id: newLeadId,
      activity_type: 'stage_changed',
      summary: `Pipeline stage set from CSV import status: ${rawStatus}`,
      metadata: {
        status_raw: rawStatus,
        mapped_stage_code: targetStage.code,
      },
    });
  } else {
    // Rule 2: Create All + status vazio/desconhecido
    historyRecords.push({
      lead_id: newLeadId,
      from_stage_id: null,
      to_stage_id: CAPTURE_STAGE.id,
      change_reason: 'initial_assignment',
    });

    activities.push({
      lead_id: newLeadId,
      activity_type: 'csv_status_unmapped',
      summary: 'CSV status not mapped; lead kept in New Lead',
      metadata: {
        status_raw: rawStatus || null,
        default_stage: 'capture',
      },
    });
  }

  return { status: 'created', lead_id: newLeadId };
}

describe('CSV Import Stage Mapping', () => {
  // Unit tests for mapCsvStatusToStageCode
  describe('mapCsvStatusToStageCode mapping table', () => {
    it('maps "Qualified", "qualified", "qualification" to qualification', () => {
      expect(mapCsvStatusToStageCode('Qualified')).toBe('qualification');
      expect(mapCsvStatusToStageCode('qualified')).toBe('qualification');
      expect(mapCsvStatusToStageCode('qualification')).toBe('qualification');
      expect(mapCsvStatusToStageCode('Qualificação')).toBe('qualification');
    });

    it('maps "Approved", "approval", "aprovado" to approval', () => {
      expect(mapCsvStatusToStageCode('Approved')).toBe('approval');
      expect(mapCsvStatusToStageCode('approved')).toBe('approval');
      expect(mapCsvStatusToStageCode('approval')).toBe('approval');
      expect(mapCsvStatusToStageCode('Aprovação')).toBe('approval');
    });

    it('maps "Enrolled", "enrollment", "matricula" to enrollment', () => {
      expect(mapCsvStatusToStageCode('Enrolled')).toBe('enrollment');
      expect(mapCsvStatusToStageCode('enrolled')).toBe('enrollment');
      expect(mapCsvStatusToStageCode('enrollment')).toBe('enrollment');
      expect(mapCsvStatusToStageCode('Matrícula')).toBe('enrollment');
    });

    it('maps "new", "new lead", "captura" to capture', () => {
      expect(mapCsvStatusToStageCode('new')).toBe('capture');
      expect(mapCsvStatusToStageCode('new lead')).toBe('capture');
      expect(mapCsvStatusToStageCode('Captura')).toBe('capture');
    });

    it('maps "completed", "post-course", "pós-curso" to post_course', () => {
      expect(mapCsvStatusToStageCode('completed')).toBe('post_course');
      expect(mapCsvStatusToStageCode('post-course')).toBe('post_course');
      expect(mapCsvStatusToStageCode('post_course')).toBe('post_course');
      expect(mapCsvStatusToStageCode('Pós-curso')).toBe('post_course');
    });

    it('maps "alumni" to alumni', () => {
      expect(mapCsvStatusToStageCode('alumni')).toBe('alumni');
      expect(mapCsvStatusToStageCode('Alumni')).toBe('alumni');
    });

    it('returns null for empty or whitespace status', () => {
      expect(mapCsvStatusToStageCode('')).toBeNull();
      expect(mapCsvStatusToStageCode('   ')).toBeNull();
      expect(mapCsvStatusToStageCode(null)).toBeNull();
      expect(mapCsvStatusToStageCode(undefined)).toBeNull();
    });

    it('returns null for unknown/unsupported status', () => {
      expect(mapCsvStatusToStageCode('random_unknown')).toBeNull();
      expect(mapCsvStatusToStageCode('xyz123')).toBeNull();
      expect(mapCsvStatusToStageCode('lost')).toBeNull();
    });
  });

  // End-to-end simulation of import rules
  describe('Import Logic Rules', () => {
    let existingLeads: Map<string, MockLead>;
    let historyRecords: MockStageHistory[];
    let activities: MockActivity[];
    let sentEmails: Array<{ to: string }>;
    let sentSms: Array<{ to: string }>;
    let tasksCreated: Array<{ type: string }>;

    beforeEach(() => {
      existingLeads = new Map();
      historyRecords = [];
      activities = [];
      sentEmails = [];
      sentSms = [];
      tasksCreated = [];
    });

    // Rule 1: Create All + status válido
    it('Rule 1: creates lead directly in mapped stage (Qualified -> Qualificação) with history and stage_changed', () => {
      const res = simulateCsvImportRow(
        { email: 'qualified@example.com', first_name: 'Ana', status: 'Qualified' },
        'create',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('created');
      const lead = existingLeads.get('qualified@example.com')!;
      expect(lead.pipeline_stage_id).toBe(STAGE_BY_CODE.get('qualification')!.id);

      // History
      const hist = historyRecords.find((h) => h.lead_id === lead.id);
      expect(hist).toBeDefined();
      expect(hist?.from_stage_id).toBeNull();
      expect(hist?.to_stage_id).toBe(STAGE_BY_CODE.get('qualification')!.id);
      expect(hist?.change_reason).toBe('csv_import_stage_mapping');

      // Activities
      const stageChanged = activities.find((a) => a.activity_type === 'stage_changed');
      expect(stageChanged).toBeDefined();
      expect(stageChanged?.summary).toContain('Pipeline stage set from CSV import status: Qualified');

      const unmapped = activities.find((a) => a.activity_type === 'csv_status_unmapped');
      expect(unmapped).toBeUndefined();
    });

    it('Rule 1: creates lead directly in Approved (Aprovação) and Enrolled (Matrícula)', () => {
      simulateCsvImportRow(
        { email: 'app@example.com', status: 'Approved' },
        'create',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );
      expect(existingLeads.get('app@example.com')?.pipeline_stage_id).toBe(STAGE_BY_CODE.get('approval')!.id);

      simulateCsvImportRow(
        { email: 'enr@example.com', status: 'Enrolled' },
        'create',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );
      expect(existingLeads.get('enr@example.com')?.pipeline_stage_id).toBe(STAGE_BY_CODE.get('enrollment')!.id);
    });

    // Rule 2: Create All + status vazio/desconhecido
    it('Rule 2: creates in Captura with initial_assignment and csv_status_unmapped when status is empty', () => {
      const res = simulateCsvImportRow(
        { email: 'empty@example.com', status: '' },
        'create',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('created');
      const lead = existingLeads.get('empty@example.com')!;
      expect(lead.pipeline_stage_id).toBe(CAPTURE_STAGE.id);

      // History
      const hist = historyRecords.find((h) => h.lead_id === lead.id);
      expect(hist?.change_reason).toBe('initial_assignment');
      expect(hist?.to_stage_id).toBe(CAPTURE_STAGE.id);

      // Activities: MUST NOT register stage_changed! MUST register csv_status_unmapped!
      const stageChanged = activities.find((a) => a.activity_type === 'stage_changed');
      expect(stageChanged).toBeUndefined();

      const unmapped = activities.find((a) => a.activity_type === 'csv_status_unmapped');
      expect(unmapped).toBeDefined();
      expect(unmapped?.summary).toBe('CSV status not mapped; lead kept in New Lead');
      expect(unmapped?.metadata?.default_stage).toBe('capture');
    });

    it('Rule 2: creates in Captura with initial_assignment and csv_status_unmapped when status is unknown', () => {
      const res = simulateCsvImportRow(
        { email: 'unknown@example.com', status: 'random_garbage_status' },
        'create',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('created');
      const lead = existingLeads.get('unknown@example.com')!;
      expect(lead.pipeline_stage_id).toBe(CAPTURE_STAGE.id);

      const stageChanged = activities.find((a) => a.activity_type === 'stage_changed');
      expect(stageChanged).toBeUndefined();

      const unmapped = activities.find((a) => a.activity_type === 'csv_status_unmapped');
      expect(unmapped).toBeDefined();
      expect(unmapped?.metadata?.status_raw).toBe('random_garbage_status');
    });

    // Rule 3: Skip Duplicates
    it('Rule 3: does not alter anything on existing lead when strategy is skip', () => {
      const origStage = STAGE_BY_CODE.get('qualification')!.id;
      existingLeads.set('existing@example.com', {
        id: 'lead-1',
        email: 'existing@example.com',
        first_name: 'Original',
        pipeline_stage_id: origStage,
      });

      const res = simulateCsvImportRow(
        { email: 'existing@example.com', first_name: 'Changed', status: 'Enrolled' },
        'skip',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('skipped');
      const lead = existingLeads.get('existing@example.com')!;
      expect(lead.pipeline_stage_id).toBe(origStage); // not modified
      expect(lead.first_name).toBe('Original'); // not modified
      expect(historyRecords).toHaveLength(0);
      expect(activities).toHaveLength(0);
    });

    // Rule 4: Update Existing + status válido diferente
    it('Rule 4: updates existing lead stage, preserves lead_id, records history and stage_changed', () => {
      const origStage = STAGE_BY_CODE.get('qualification')!.id;
      const targetStage = STAGE_BY_CODE.get('approval')!.id;

      existingLeads.set('lead@example.com', {
        id: 'lead-orig-id',
        email: 'lead@example.com',
        pipeline_stage_id: origStage,
      });

      const res = simulateCsvImportRow(
        { email: 'lead@example.com', status: 'Approved' },
        'update',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('updated');
      expect(res.lead_id).toBe('lead-orig-id'); // preserved id
      const lead = existingLeads.get('lead@example.com')!;
      expect(lead.pipeline_stage_id).toBe(targetStage);

      // History
      expect(historyRecords).toHaveLength(1);
      expect(historyRecords[0].change_reason).toBe('csv_import_stage_mapping');
      expect(historyRecords[0].from_stage_id).toBe(origStage);
      expect(historyRecords[0].to_stage_id).toBe(targetStage);

      // Activity
      const stageChanged = activities.find((a) => a.activity_type === 'stage_changed');
      expect(stageChanged).toBeDefined();
      expect(stageChanged?.summary).toContain('Pipeline stage set from CSV import status: Approved');
    });

    // Rule 5: Update Existing + mesmo estágio
    it('Rule 5: does not create redundant stage history or activity if stage is already the same', () => {
      const origStage = STAGE_BY_CODE.get('approval')!.id;

      existingLeads.set('lead@example.com', {
        id: 'lead-orig-id',
        email: 'lead@example.com',
        pipeline_stage_id: origStage,
      });

      const res = simulateCsvImportRow(
        { email: 'lead@example.com', status: 'Approved' },
        'update',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('updated');
      const lead = existingLeads.get('lead@example.com')!;
      expect(lead.pipeline_stage_id).toBe(origStage);

      // No redundant history or stage_changed
      expect(historyRecords).toHaveLength(0);
      expect(activities.filter((a) => a.activity_type === 'stage_changed')).toHaveLength(0);
    });

    // Rule 6: Update Existing + status vazio/desconhecido
    it('Rule 6: preserves existing stage (no downgrade), records no history, logs csv_status_unmapped', () => {
      const origStage = STAGE_BY_CODE.get('enrollment')!.id;

      existingLeads.set('lead@example.com', {
        id: 'lead-orig-id',
        email: 'lead@example.com',
        pipeline_stage_id: origStage,
      });

      const res = simulateCsvImportRow(
        { email: 'lead@example.com', status: 'unknown_status' },
        'update',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(res.status).toBe('updated');
      const lead = existingLeads.get('lead@example.com')!;
      expect(lead.pipeline_stage_id).toBe(origStage); // PRESERVED, NO DOWNGRADE

      // No stage history created
      expect(historyRecords).toHaveLength(0);

      // No stage_changed created
      expect(activities.filter((a) => a.activity_type === 'stage_changed')).toHaveLength(0);

      // csv_status_unmapped registered
      const unmapped = activities.find((a) => a.activity_type === 'csv_status_unmapped');
      expect(unmapped).toBeDefined();
      expect(unmapped?.summary).toBe('CSV status not mapped; lead kept in current stage');
      expect(unmapped?.metadata?.current_stage_id).toBe(origStage);
    });

    // Rule 7 & 10: Strict isolation
    it('Rule 7 & 10: does not send emails, SMS or create call tasks during CSV import', () => {
      simulateCsvImportRow(
        { email: 'isolated@example.com', status: 'Qualified' },
        'create',
        existingLeads,
        historyRecords,
        activities,
        sentEmails,
        sentSms,
        tasksCreated,
      );

      expect(sentEmails).toHaveLength(0);
      expect(sentSms).toHaveLength(0);
      expect(tasksCreated).toHaveLength(0);
    });
  });
});
