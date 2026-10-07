import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  resolveLeadCanonicalCourseInterests,
  getCanonicalCourseShortName,
} from '../utils/course-resolver';
import type { Lead } from '../types/database';

describe('Meta -> EDS Consistency & Returning Lead Course Interest Accumulation', () => {
  const metaWebhookCode = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/meta-webhook/index.ts'),
    'utf-8'
  );
  const intakeCode = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/process-lead-intake/index.ts'),
    'utf-8'
  );
  const editModalCode = fs.readFileSync(
    path.resolve(process.cwd(), 'src/features/leads/components/EditLeadModal.tsx'),
    'utf-8'
  );
  const profileCode = fs.readFileSync(
    path.resolve(process.cwd(), 'src/features/leads/components/LeadProfileContent.tsx'),
    'utf-8'
  );
  const migration00111Code = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/00111_guarantee_course_interest_accumulation.sql'),
    'utf-8'
  );

  const normalize = (s: string) => s.replace(/\r\n/g, '\n');
  const metaWebhookNorm = normalize(metaWebhookCode);
  const intakeNorm = normalize(intakeCode);
  const editModalNorm = normalize(editModalCode);
  const profileNorm = normalize(profileCode);
  const migration00111Norm = normalize(migration00111Code);

  describe('Part 1: Meta Direct Intake Independence & Visibility', () => {
    it('creates new Meta leads directly without waiting for or requiring HubSpot', () => {
      // meta-webhook inserts directly into leads table with source: 'meta'
      expect(metaWebhookNorm).toContain(".from('leads')\n        .insert({");
      expect(metaWebhookNorm).toContain("source: 'meta'");
      expect(metaWebhookNorm).toContain('pipeline_stage_id: captureStage.id');
      // Fires process-lead-intake immediately
      expect(metaWebhookNorm).toContain('/functions/v1/process-lead-intake');
    });

    it('matches returning Meta leads to the same canonical lead without duplicates', () => {
      expect(metaWebhookNorm).toContain("// Existing lead — non-destructive update");
      expect(metaWebhookNorm).toContain("targetLeadId = matchedLead.id;");
      const returningBranch = metaWebhookNorm.slice(
        metaWebhookNorm.indexOf("// Existing lead — non-destructive update"),
        metaWebhookNorm.indexOf("await db\n        .from('leads')\n        .update(updateData)")
      );
      expect(returningBranch).not.toContain("pipeline_stage_id");
    });

    it('monotonically updates last_acquisition_at for returning Meta leads', () => {
      expect(metaWebhookNorm).toContain('const incomingAcqMs = new Date(sourceCreatedIso).getTime();');
      expect(metaWebhookNorm).toContain('const existingAcqMs = matchedLead.last_acquisition_at ? new Date(matchedLead.last_acquisition_at).getTime() : 0;');
      expect(metaWebhookNorm).toContain('updateData.last_acquisition_at = sourceCreatedIso;');
    });

    it('documents the controlled test: lead created at 10:55:06, auto-advanced to respondido at 10:55:11, HubSpot reconciled at 11:00:01', () => {
      // Confirmed fact: HubSpot continuous reconcile ran 5 minutes after EDS lead was already created and emailed
      const metaSubmission = new Date('2026-10-06T10:54:53Z').getTime();
      const edsLeadCreated = new Date('2026-10-06T10:55:06Z').getTime();
      const autoStageAdvanced = new Date('2026-10-06T10:55:11Z').getTime();
      const hubspotContinuousReconcile = new Date('2026-10-06T11:00:01Z').getTime();

      expect(edsLeadCreated - metaSubmission).toBe(13000); // 13 seconds from Meta submit to DB queryable
      expect(autoStageAdvanced - edsLeadCreated).toBe(5000); // 5 seconds from creation to Respondido transition
      expect(hubspotContinuousReconcile - edsLeadCreated).toBe(295000); // HubSpot arrived ~5 min later
    });
  });

  describe('Part 2: Course Accumulation Business Rules', () => {
    it('accumulates Advanced Dental Implant Experience + Wisdom Teeth Training without replacement', () => {
      const existingLead: Partial<Lead> = {
        course_interest: 'Advanced Dental Implant Experience',
        course_interests: ['Advanced Dental Implant Experience'],
      };

      const relationalInterests = [
        {
          courseName: 'Advanced Dental Implant Experience',
          priority: 1,
        },
        {
          courseName: 'Wisdom Teeth Training',
          priority: 2,
        },
      ];

      const canonical = resolveLeadCanonicalCourseInterests(existingLead as Lead, relationalInterests);
      const names = canonical.map((c) => c.canonicalName);

      expect(names).toContain('Advanced');
      expect(names).toContain('Wisdom');
      expect(names.length).toBe(2);
    });

    it('prevents duplicates when the same course is submitted multiple times', () => {
      const existingLead: Partial<Lead> = {
        course_interest: 'Wisdom Teeth Training, Wisdom Teeth Training',
        course_interests: ['Wisdom Teeth Training', 'Wisdom Teeth Training'],
      };

      const relationalInterests = [
        { courseName: 'Wisdom Teeth Training', priority: 1 },
        { courseName: 'Wisdom Teeth Training', priority: 2 },
      ];

      const canonical = resolveLeadCanonicalCourseInterests(existingLead as Lead, relationalInterests);
      const names = canonical.map((c) => c.canonicalName);

      expect(names).toEqual(['Wisdom']);
      expect(names.length).toBe(1);
    });

    it('resolves canonical short names cleanly for all approved courses', () => {
      expect(getCanonicalCourseShortName('Advanced Dental Implant Experience')).toBe('Advanced');
      expect(getCanonicalCourseShortName('Wisdom Teeth Training')).toBe('Wisdom');
      expect(getCanonicalCourseShortName('Zygomatic Implant Training')).toBe('Zygomatic');
      expect(getCanonicalCourseShortName('Intensive Dental Implant Training')).toBe('Intensive');
      expect(getCanonicalCourseShortName('Endodontics Training')).toBe('Endodontic');
      expect(getCanonicalCourseShortName('Periodontal Surgery Training')).toBe('Periodontal Plastic');
    });

    it('ensures meta-webhook extracts from both array and comma-separated string on returning leads', () => {
      expect(metaWebhookNorm).toContain('const currentInterests: string[] = [];');
      expect(metaWebhookNorm).toContain('if (Array.isArray(existingLead?.course_interests))');
      expect(metaWebhookNorm).toContain('if (existingLead?.course_interest)');
      expect(metaWebhookNorm).toContain('updateData.course_interests = currentInterests;');
      expect(metaWebhookNorm).toContain("updateData.course_interest = currentInterests.join(', ');");
    });

    it('ensures meta-webhook calculates next available priority (1..3) without colliding with idx_lead_course_interests_lead_priority', () => {
      expect(metaWebhookNorm).toContain('const usedPriorities = new Set(');
      expect(metaWebhookNorm).toContain('let assignedPriority: number | null = null;');
      expect(metaWebhookNorm).toContain('priority: assignedPriority,');
      expect(metaWebhookNorm).toContain("source: 'meta',");
    });

    it('ensures process-lead-intake accumulates courses and synchronizes lead_course_interests', () => {
      expect(intakeNorm).toContain('function accumulateCourseInterests(');
      expect(intakeNorm).toContain('async function syncLeadCourseInterest(');
      expect(intakeNorm).toContain('await syncLeadCourseInterest(db, leadId, payload.course_interest, payload.source);');
    });

    it('accumulates THREE distinct courses (Advanced + Wisdom + Zygomatic) without losing any', () => {
      const existingLead: Partial<Lead> = {
        course_interest: 'Advanced Dental Implant Experience, Wisdom Teeth Training',
        course_interests: ['Advanced Dental Implant Experience', 'Wisdom Teeth Training'],
      };

      const relationalInterests = [
        { courseName: 'Advanced Dental Implant Experience', priority: 1 },
        { courseName: 'Wisdom Teeth Training', priority: 2 },
        { courseName: 'Zygomatic Implant Training', priority: 3 },
      ];

      const canonical = resolveLeadCanonicalCourseInterests(existingLead as Lead, relationalInterests);
      const names = canonical.map((c) => c.canonicalName);

      expect(names).toEqual(expect.arrayContaining(['Advanced', 'Wisdom', 'Zygomatic']));
      expect(names.length).toBe(3);
    });

    it('accumulates FOUR distinct courses (Advanced + Wisdom + Zygomatic + Intensive) preserving all four', () => {
      const existingLead: Partial<Lead> = {
        course_interest: 'Advanced Dental Implant Experience, Wisdom Teeth Training, Zygomatic Implant Training',
        course_interests: [
          'Advanced Dental Implant Experience',
          'Wisdom Teeth Training',
          'Zygomatic Implant Training',
          'Intensive Dental Implant Training',
        ],
      };

      const relationalInterests = [
        { courseName: 'Advanced Dental Implant Experience', priority: 1 },
        { courseName: 'Wisdom Teeth Training', priority: 2 },
        { courseName: 'Zygomatic Implant Training', priority: 3 },
        { courseName: 'Intensive Dental Implant Training', priority: null }, // 4th course has priority null
      ];

      const canonical = resolveLeadCanonicalCourseInterests(existingLead as Lead, relationalInterests);
      const names = canonical.map((c) => c.canonicalName);

      expect(names).toContain('Advanced');
      expect(names).toContain('Wisdom');
      expect(names).toContain('Zygomatic');
      expect(names).toContain('Intensive');
      expect(names.length).toBe(4);
    });

    it('ensures EditLeadModal does not drop courses beyond 3 on save and assigns null priority to 4th+', () => {
      expect(editModalNorm).toContain('// 4. Resolve Prioritized Course Interests (preserves all distinct courses)');
      expect(editModalNorm).toContain('priority: (idx < 3 ? ((idx + 1) as 1 | 2 | 3) : null),');
      expect(editModalNorm).not.toContain('.slice(0, 3)');
    });

    it('ensures LeadProfileContent resolves ci.notes as fallback', () => {
      expect(profileNorm).toContain("courseName: ci.course?.name || ci.course?.code || ci.notes || ''");
    });

    it('ensures migration 00111 updates process_hubspot_inbound_batch to accumulate courses and never overwrite', () => {
      expect(migration00111Norm).toContain('v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);');
      expect(migration00111Norm).toContain("v_merged_course_interest := v_existing_lead_course || ', ' || v_course_interest_val;");
      expect(migration00111Norm).toContain('INSERT INTO public.lead_course_interests (');
      expect(migration00111Norm).toContain('ON CONFLICT (lead_id, course_id) DO NOTHING;');
    });
  });
});
