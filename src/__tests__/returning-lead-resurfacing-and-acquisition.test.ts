import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  compareLeadsNewestFirst,
} from '../lib/lead-sorting';
import type { Lead } from '../types/database';

describe('Returning / Re-engaged Lead Resurfacing and Acquisition Audit', () => {
  const metaWebhookCode = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/meta-webhook/index.ts'),
    'utf-8'
  );
  const intakeCode = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/process-lead-intake/index.ts'),
    'utf-8'
  );
  const kanbanCode = fs.readFileSync(
    path.resolve(process.cwd(), 'src/features/pipeline/PipelineKanbanPage.tsx'),
    'utf-8'
  );
  const migration00110Code = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/00110_guard_returning_lead_acquisition_and_hubspot_regression.sql'),
    'utf-8'
  );

  const normalize = (s: string) => s.replace(/\r\n/g, '\n');
  const metaWebhookNorm = normalize(metaWebhookCode);
  const intakeNorm = normalize(intakeCode);
  const kanbanNorm = normalize(kanbanCode);
  const migration00110Norm = normalize(migration00110Code);

  describe('1. Pipeline Ordering & Card Resurfacing Logic', () => {
    it('ranks returning lead at top of current stage when last_acquisition_at is newer, while created_at is preserved', () => {
      // Kais Larbi scenario: created June 2026, re-engaged via Meta Oct 6 2026
      const kaisLarbi: Partial<Lead> = {
        id: '3e793f07-780d-455c-bbcd-6c8f4b4b4c32',
        first_name: 'Kais',
        last_name: 'Larbi',
        created_at: '2026-06-11T23:01:51.000Z',
        last_acquisition_at: '2026-10-06T10:22:13.000Z',
        pipeline_stage_id: 'stage-respondido',
      };

      const newerLeadWithoutReengagement: Partial<Lead> = {
        id: 'newer-lead-1',
        first_name: 'John',
        last_name: 'Doe',
        created_at: '2026-10-05T12:00:00.000Z',
        last_acquisition_at: '2026-10-05T12:00:00.000Z',
        pipeline_stage_id: 'stage-respondido',
      };

      const olderLeadWithoutReengagement: Partial<Lead> = {
        id: 'older-lead-2',
        first_name: 'Jane',
        last_name: 'Smith',
        created_at: '2026-06-11T20:00:00.000Z',
        last_acquisition_at: null,
        pipeline_stage_id: 'stage-respondido',
      };

      const morningLead: Partial<Lead> = {
        id: 'morning-lead-3',
        first_name: 'Morning',
        last_name: 'Lead',
        created_at: '2026-10-06T08:00:00.000Z',
        last_acquisition_at: '2026-10-06T08:00:00.000Z',
        pipeline_stage_id: 'stage-respondido',
      };

      const stageLeads = [
        olderLeadWithoutReengagement,
        newerLeadWithoutReengagement,
        morningLead,
        kaisLarbi,
      ] as Lead[];

      // Sort with canonical comparator
      const sorted = [...stageLeads].sort(compareLeadsNewestFirst);

      // Kais Larbi (last_acquisition_at Oct 6, 10:22) must resurface to the very top (#1)
      expect(sorted[0].id).toBe(kaisLarbi.id);
      expect(sorted[0].first_name).toBe('Kais');

      // Next is morning lead (Oct 6, 08:00)
      expect(sorted[1].id).toBe(morningLead.id);

      // Next is newer lead without reengagement (Oct 5)
      expect(sorted[2].id).toBe(newerLeadWithoutReengagement.id);

      // Last is older lead (June 11)
      expect(sorted[3].id).toBe(olderLeadWithoutReengagement.id);

      // Kais Larbi's created_at is strictly preserved
      expect(sorted[0].created_at).toBe('2026-06-11T23:01:51.000Z');
      expect(sorted[0].pipeline_stage_id).toBe('stage-respondido');
    });

    it('falls back to created_at when last_acquisition_at is null or empty', () => {
      const leadA: Partial<Lead> = {
        id: 'a',
        created_at: '2026-10-01T10:00:00Z',
        last_acquisition_at: null,
      };
      const leadB: Partial<Lead> = {
        id: 'b',
        created_at: '2026-10-02T10:00:00Z',
        last_acquisition_at: null,
      };

      const sorted = [leadA, leadB].sort(compareLeadsNewestFirst as any);
      expect(sorted[0].id).toBe('b');
      expect(sorted[1].id).toBe('a');
    });
  });

  describe('2. Meta Webhook Intake (supabase/functions/meta-webhook/index.ts)', () => {
    it('fetches last_acquisition_at when matching canonical leads', () => {
      expect(metaWebhookNorm).toContain(
        "select('id, pipeline_stage_id, email, phone_e164, external_lead_id, source, last_acquisition_at')"
      );
    });

    it('sets last_acquisition_at on initial lead creation', () => {
      expect(metaWebhookNorm).toContain('last_acquisition_at: sourceCreatedIso');
    });

    it('monotonically updates last_acquisition_at on existing lead match', () => {
      expect(metaWebhookNorm).toContain('const incomingAcqMs = new Date(sourceCreatedIso).getTime();');
      expect(metaWebhookNorm).toContain('const existingAcqMs = matchedLead.last_acquisition_at ? new Date(matchedLead.last_acquisition_at).getTime() : 0;');
      expect(metaWebhookNorm).toContain('updateData.last_acquisition_at = sourceCreatedIso;');
    });

    it('does NOT regress or overwrite pipeline_stage_id on existing lead match', () => {
      // For existing leads, updateData only modifies non-destructive fields
      expect(metaWebhookNorm).toContain('targetLeadId = matchedLead.id;');
      // Verify pipeline_stage_id is NOT in updateData in the else branch
      const existingBranch = metaWebhookNorm.substring(
        metaWebhookNorm.indexOf('// Existing lead — non-destructive update'),
        metaWebhookNorm.indexOf('await db\n        .from(\'leads\')\n        .update(updateData)')
      );
      expect(existingBranch).not.toContain('pipeline_stage_id:');
    });
  });

  describe('3. Process Lead Intake (supabase/functions/process-lead-intake/index.ts)', () => {
    it('guards last_acquisition_at updates monotonically across all lookup methods', () => {
      expect(intakeNorm).toContain('const incomingAcqMs = new Date(acqTimestamp).getTime();');
      expect(intakeNorm).toContain('const shouldUpdateAcquisition = (existingAcq: string | null | undefined): boolean => {');
      expect(intakeNorm).toContain('if (shouldUpdateAcquisition(existing.last_acquisition_at)) {');
    });

    it('does NOT regress pipeline stage for returning leads in active stages', () => {
      // Returning leads (isNewLead === false) are not forced to capture
      expect(intakeNorm).toContain('if (isNewLead) {');
      expect(intakeNorm).toContain(".update({ pipeline_stage_id: captureStage.id })");
      // Only leads currently in capture stage can advance to respondido
      expect(intakeNorm).toContain('if (currentLead && currentLead.pipeline_stage_id === captureStage.id) {');
    });
  });

  describe('4. PipelineKanbanPage Database Queries & Realtime', () => {
    it('enforces last_acquisition_at DESC NULLS LAST, created_at DESC across initial load, pagination, and search', () => {
      // Initial load query
      expect(kanbanNorm).toContain(".order('last_acquisition_at', { ascending: false, nullsFirst: false })");
      // Pagination (handleLoadMore)
      expect(kanbanNorm).toContain("const o0 = qMore.order('last_acquisition_at', { ascending: false, nullsFirst: false });");
      // Server search (executeServerSearch)
      expect(kanbanNorm).toContain(".order('last_acquisition_at', { ascending: false, nullsFirst: false })\n        .order('created_at', { ascending: false })\n        .order('id', { ascending: false })");
    });

    it('listens for postgres_changes on leads table to refresh pipeline in realtime without reload', () => {
      expect(kanbanNorm).toContain("channel('pipeline-leads-realtime')");
      expect(kanbanNorm).toContain("{ event: '*', schema: 'public', table: 'leads' }");
      expect(kanbanNorm).toContain('void loadPipelineData();');
    });
  });

  describe('5. Database Migration 00110 Safety & HubSpot Protection', () => {
    it('installs trigger on form_submissions to keep leads.last_acquisition_at in sync', () => {
      expect(migration00110Norm).toContain('trg_form_submissions_sync_lead_acquisition');
      expect(migration00110Norm).toContain('CREATE OR REPLACE FUNCTION public.trg_form_submissions_sync_lead_acquisition()');
      expect(migration00110Norm).toContain("last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), NEW.submitted_at)");
    });

    it('guards process_hubspot_inbound_batch against overwriting newer Meta/website acquisitions', () => {
      expect(migration00110Norm).toContain("last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), v_authoritative_ts)");
    });
  });
});
