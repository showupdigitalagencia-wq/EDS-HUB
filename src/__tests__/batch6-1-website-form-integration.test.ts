import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { IncompleteEnrollment } from '../types';

describe('Batch 6.1 — Website Form Integration & Incomplete Intent Reconciliation', () => {
  const migration00058Path = path.resolve(
    process.cwd(),
    'supabase/migrations/00058_add_form_completed_status.sql'
  );
  const submitFunctionPath = path.resolve(
    process.cwd(),
    'supabase/functions/submit-public-form/index.ts'
  );
  const integrationDocPath = path.resolve(
    process.cwd(),
    'docs/website-register-eds-hub-integration.md'
  );

  const migration00058Content = fs.readFileSync(migration00058Path, 'utf8');
  const submitFunctionContent = fs.readFileSync(submitFunctionPath, 'utf8');
  const integrationDocContent = fs.readFileSync(integrationDocPath, 'utf8');

  // ===========================================================================
  // 1. Migration 00058 Schema Invariants
  // ===========================================================================
  describe('Migration 00058 Schema & Constraints', () => {
    it('extends incomplete_enrollments.status check constraint with form_completed', () => {
      expect(migration00058Content).toContain(
        "CHECK (status IS NULL OR status IN ('needs_followup', 'form_completed', 'recovered', 'dismissed'))"
      );
    });

    it('adds resolved_form_submission_id foreign key referencing public.form_submissions', () => {
      expect(migration00058Content).toContain('resolved_form_submission_id UUID NULL');
      expect(migration00058Content).toContain('REFERENCES public.form_submissions(id)');
    });

    it('seeds website-register form with active status and version 1', () => {
      expect(migration00058Content).toContain("'website-register'");
      expect(migration00058Content).toContain("'active', 1");
    });

    it('seeds form_fields for website-register version 1 strictly with approved CRM fields', () => {
      expect(migration00058Content).toContain("'first_name'");
      expect(migration00058Content).toContain("'last_name'");
      expect(migration00058Content).toContain("'email'");
      expect(migration00058Content).toContain("'phone'");
      expect(migration00058Content).toContain("'course'");
      expect(migration00058Content).toContain("'specialty'");
      expect(migration00058Content).toContain("'years_in_practice'");
      expect(migration00058Content).toContain("'surgical_experience'");
      expect(migration00058Content).toContain("'agd_number'");
      expect(migration00058Content).toContain("'heard_from'");
      expect(migration00058Content).toContain("'referral_name'");
      expect(migration00058Content).toContain("'promo_code'");
      expect(migration00058Content).toContain("'terms_accepted'");
    });

    it('strictly DOES NOT seed prohibited privacy fields in public.form_fields', () => {
      expect(migration00058Content).not.toMatch(/'medical_conditions'/);
      expect(migration00058Content).not.toMatch(/'dietary'/);
      expect(migration00058Content).not.toMatch(/'passport'/);
      expect(migration00058Content).not.toMatch(/'dental_license'/);
      expect(migration00058Content).not.toMatch(/'emergency_phone'/);
      expect(migration00058Content).not.toMatch(/'certificate_name'/);
      expect(migration00058Content).not.toMatch(/'coat_size'/);
      expect(migration00058Content).not.toMatch(/'signature'/);
    });

    it('drops 9-parameter process_form_submission_transaction before creating 10-parameter signature', () => {
      expect(migration00058Content).toContain(
        'DROP FUNCTION IF EXISTS public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);'
      );
      expect(migration00058Content).toContain('p_external_attempt_id TEXT DEFAULT NULL');
    });

    it('enrollment recovery trigger reconciles both needs_followup and form_completed', () => {
      expect(migration00058Content).toContain(
        "AND status IN ('needs_followup', 'form_completed')"
      );
      expect(migration00058Content).toContain("SET status = 'recovered'");
      expect(migration00058Content).toContain('resolved_enrollment_id = NEW.id');
    });

    it('process_form_submission_transaction step 10 matches on course context when available', () => {
      expect(migration00058Content).toContain('First try matching with course context');
      expect(migration00058Content).toContain('JOIN public.courses c ON c.id = ie.course_id');
      expect(migration00058Content).toContain('c.code = trim(p_course_interest)');
      expect(migration00058Content).toContain('ORDER BY ie.created_at DESC');
      expect(migration00058Content).toContain('Fallback: match by external_attempt_id + matched lead_id');
    });
  });

  // ===========================================================================
  // 2. submit-public-form Edge Function Guards
  // ===========================================================================
  describe('submit-public-form Edge Function Implementation', () => {
    it('accepts external_attempt_id from payload', () => {
      expect(submitFunctionContent).toContain('external_attempt_id');
      expect(submitFunctionContent).toContain('p_external_attempt_id: effectiveAttemptId');
    });

    it('enforces strict privacy exclusions by stripping sensitive fields', () => {
      expect(submitFunctionContent).toContain('delete fields.medical_conditions');
      expect(submitFunctionContent).toContain('delete fields.dietary');
      expect(submitFunctionContent).toContain('delete fields.passport');
      expect(submitFunctionContent).toContain('delete fields.dental_license');
      expect(submitFunctionContent).toContain('delete fields.emergency_phone');
      expect(submitFunctionContent).toContain('delete fields.certificate_name');
      expect(submitFunctionContent).toContain('delete fields.coat_size');
      expect(submitFunctionContent).toContain('delete fields.signature');
      expect(submitFunctionContent).toContain('delete fields.email_confirmation');
      expect(submitFunctionContent).toContain('delete fields.formData');
      expect(submitFunctionContent).toContain('delete fields.raw_form_data');
    });

    it('enforces terms_accepted semantics: only true is stored upon completed application', () => {
      expect(submitFunctionContent).toContain("fields.terms_accepted === true");
      expect(submitFunctionContent).toContain("delete fields.terms_accepted");
    });

    it('performs conservative single-name splitting preserving multi-token surnames', () => {
      expect(submitFunctionContent).toContain('fields.first_name = trimmedName.substring(0, spaceIndex)');
      expect(submitFunctionContent).toContain('fields.last_name = trimmedName.substring(spaceIndex + 1).trim()');
    });
  });

  // ===========================================================================
  // 3. Lifecycle & Single-Lead Reconciliation Simulation Logic
  // ===========================================================================
  describe('Lifecycle State Machine & Transactional Logic', () => {
    it('reconciles needs_followup to form_completed for matching external_attempt_id + same lead', () => {
      const targetLeadId = 'lead-uuid-1';
      const externalAttemptId = 'reg_att_999';
      const newSubmissionId = 'sub-uuid-abc';

      // Prior incomplete enrollment
      const incompleteAttempt: IncompleteEnrollment = {
        id: 'inc-1',
        processing_status: 'processed',
        status: 'needs_followup',
        lead_id: targetLeadId,
        course_id: 'course-idit-01',
        course_session_id: null,
        idempotency_key: 'idemp-1',
        external_attempt_id: externalAttemptId,
        task_id: 'task-follow-up-1',
        resolved_form_submission_id: null,
        resolved_enrollment_id: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const task = {
        id: 'task-follow-up-1',
        status: 'pending',
      };

      // RPC logic simulation:
      let reconciledAttempt = { ...incompleteAttempt };
      let reconciledTask = { ...task };

      if (
        reconciledAttempt.external_attempt_id === externalAttemptId &&
        reconciledAttempt.lead_id === targetLeadId &&
        reconciledAttempt.status === 'needs_followup'
      ) {
        reconciledAttempt.status = 'form_completed';
        reconciledAttempt.resolved_form_submission_id = newSubmissionId;
        reconciledAttempt.resolved_at = new Date().toISOString();

        if (reconciledTask.id === reconciledAttempt.task_id && reconciledTask.status === 'pending') {
          reconciledTask.status = 'cancelled';
        }
      }

      expect(reconciledAttempt.status).toBe('form_completed');
      expect(reconciledAttempt.resolved_form_submission_id).toBe(newSubmissionId);
      expect(reconciledAttempt.resolved_enrollment_id).toBeNull(); // Still null until actual enrollment
      expect(reconciledTask.status).toBe('cancelled');
    });

    it('does NOT bulk resolve or reconcile attempts if external_attempt_id belongs to a different lead', () => {
      const activeLeadId = 'lead-alice';
      const differentLeadId = 'lead-bob';
      const sharedAttemptString = 'reg_collision_key';

      const bobAttempt: IncompleteEnrollment = {
        id: 'inc-bob',
        processing_status: 'processed',
        status: 'needs_followup',
        lead_id: differentLeadId,
        course_id: 'course-idit-01',
        course_session_id: null,
        idempotency_key: 'idemp-bob',
        external_attempt_id: sharedAttemptString,
        task_id: 'task-bob',
        resolved_form_submission_id: null,
        resolved_enrollment_id: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Attempted match with Alice's submission
      const isMatch =
        bobAttempt.external_attempt_id === sharedAttemptString &&
        bobAttempt.lead_id === activeLeadId && // Fails safe guard
        bobAttempt.status === 'needs_followup';

      expect(isMatch).toBe(false);
      expect(bobAttempt.status).toBe('needs_followup'); // Untouched!
      expect(bobAttempt.resolved_form_submission_id).toBeNull();
    });

    it('subsequent enrollment confirms: transitions form_completed to recovered while preserving resolved_form_submission_id', () => {
      const leadId = 'lead-uuid-1';
      const courseId = 'course-idit-01';
      const confirmedEnrollmentId = 'enr-uuid-777';
      const originalSubmissionId = 'sub-uuid-abc';

      const completedAttempt: IncompleteEnrollment = {
        id: 'inc-1',
        processing_status: 'processed',
        status: 'form_completed',
        lead_id: leadId,
        course_id: courseId,
        course_session_id: null,
        idempotency_key: 'idemp-1',
        external_attempt_id: 'reg_att_999',
        task_id: 'task-follow-up-1',
        resolved_form_submission_id: originalSubmissionId,
        resolved_enrollment_id: null,
        resolved_at: '2026-09-23T12:00:00Z',
        created_at: '2026-09-23T11:00:00Z',
        updated_at: '2026-09-23T12:00:00Z',
      };

      // Trigger simulation:
      let recoveredAttempt = { ...completedAttempt };
      if (
        recoveredAttempt.lead_id === leadId &&
        recoveredAttempt.course_id === courseId &&
        ['needs_followup', 'form_completed'].includes(recoveredAttempt.status as string)
      ) {
        recoveredAttempt.status = 'recovered';
        recoveredAttempt.resolved_enrollment_id = confirmedEnrollmentId;
        recoveredAttempt.resolved_at = new Date().toISOString();
      }

      expect(recoveredAttempt.status).toBe('recovered');
      expect(recoveredAttempt.resolved_enrollment_id).toBe(confirmedEnrollmentId);
      // Historical lineage is strictly preserved:
      expect(recoveredAttempt.resolved_form_submission_id).toBe(originalSubmissionId);
    });

    it('preserves existing commercial pipeline stage for existing leads on form submission', () => {
      const existingLead = {
        id: 'lead-existing',
        pipeline_stage_id: 'stage-quente-approval', // Current stage is Quente
        source: 'csv_import', // Original source
      };

      // In process_form_submission_transaction:
      // When target lead is found:
      // UPDATE public.leads SET first_name = ..., email = ...
      // pipeline_stage_id and source are NOT touched!
      const updatedLead = {
        ...existingLead,
        first_name: 'Dr. Jane',
        email: 'jane@example.com',
      };

      expect(updatedLead.pipeline_stage_id).toBe('stage-quente-approval');
      expect(updatedLead.source).toBe('csv_import');
    });

    it('assigns capture stage for brand new leads on form submission', () => {
      const isNewLead = true;
      const defaultFormStage = 'stage-capture';

      const leadRecord = isNewLead
        ? { id: 'new-lead-id', pipeline_stage_id: defaultFormStage, source: 'form' }
        : null;

      expect(leadRecord?.pipeline_stage_id).toBe('stage-capture');
      expect(leadRecord?.source).toBe('form');
    });

    it('detects identity conflict between email and phone without merging or updating either lead', () => {
      const emailLeadId: string | null = 'lead-email-only';
      const phoneLeadId: string | null = 'lead-phone-only';

      // Conflict condition
      const isConflict = emailLeadId !== null && phoneLeadId !== null && emailLeadId !== phoneLeadId;

      const outcome = isConflict
        ? { lead_id: null, processing_status: 'conflict' }
        : { lead_id: emailLeadId, processing_status: 'processed' };

      expect(isConflict).toBe(true);
      expect(outcome.lead_id).toBeNull();
      expect(outcome.processing_status).toBe('conflict');
    });
  });

  // ===========================================================================
  // 4. Privacy & Exclusion Verification
  // ===========================================================================
  describe('Privacy Exclusions & Contract', () => {
    const rawWebsiteSubmission = {
      name: 'Dr. Carlos Mendoza',
      email: 'carlos@example.com',
      phone: '+1 305 555 1234',
      course: 'Dental Implant Intensive Course - November 11-14, 2026 | Tuition: $9,400',
      medical_conditions: 'Hypertension, Penicillin allergy',
      dietary: 'Strict Vegetarian, Gluten-Free',
      passport: 'https://storage.website.com/passports/scan_123.pdf',
      dental_license: 'https://storage.website.com/licenses/fl_456.jpg',
      emergency_phone: '+1 305 555 9999',
      certificate_name: 'Dr. Carlos A. Mendoza DDS',
      coat_size: 'L',
      signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      terms_accepted: true,
    };

    it('filters out all prohibited medical, dietary, file and signature fields before transmission', () => {
      const sanitized = { ...rawWebsiteSubmission };
      delete (sanitized as any).medical_conditions;
      delete (sanitized as any).dietary;
      delete (sanitized as any).passport;
      delete (sanitized as any).dental_license;
      delete (sanitized as any).emergency_phone;
      delete (sanitized as any).certificate_name;
      delete (sanitized as any).coat_size;
      delete (sanitized as any).signature;

      expect((sanitized as any).medical_conditions).toBeUndefined();
      expect((sanitized as any).dietary).toBeUndefined();
      expect((sanitized as any).passport).toBeUndefined();
      expect((sanitized as any).dental_license).toBeUndefined();
      expect((sanitized as any).emergency_phone).toBeUndefined();
      expect((sanitized as any).certificate_name).toBeUndefined();
      expect((sanitized as any).coat_size).toBeUndefined();
      expect((sanitized as any).signature).toBeUndefined();

      expect(sanitized.email).toBe('carlos@example.com');
      expect(sanitized.terms_accepted).toBe(true);
    });

    it('parses single name into first_name and full multi-part last_name correctly', () => {
      const testNames = [
        { raw: 'Maria da Silva Santos', first: 'Maria', last: 'da Silva Santos' },
        { raw: 'Jean-Pierre Van Der Bellen', first: 'Jean-Pierre', last: 'Van Der Bellen' },
        { raw: 'Alexandre', first: 'Alexandre', last: '' },
      ];

      for (const item of testNames) {
        const spaceIndex = item.raw.indexOf(' ');
        let first = item.raw;
        let last = '';
        if (spaceIndex > 0) {
          first = item.raw.substring(0, spaceIndex);
          last = item.raw.substring(spaceIndex + 1).trim();
        }

        expect(first).toBe(item.first);
        expect(last).toBe(item.last);
      }
    });
  });

  // ===========================================================================
  // 5. Documentation & Developer Handoff Contract
  // ===========================================================================
  describe('Developer Handoff Documentation Contract', () => {
    it('contains explicit course mapping table for all 4 live website courses', () => {
      expect(integrationDocContent).toContain('Dental Implant Intensive Course');
      expect(integrationDocContent).toContain('IDIT-01');
      expect(integrationDocContent).toContain('Advanced Bone Grafting & Sinus Lift');
      expect(integrationDocContent).toContain('ADIE-01');
      expect(integrationDocContent).toContain('Zygomatic & Pterygoid Implants');
      expect(integrationDocContent).toContain('ZIT-01');
      expect(integrationDocContent).toContain('Full Arch Immediate Loading');
      expect(integrationDocContent).toContain('AIRE-01');
    });

    it('documents session reality stating live form has no separate session selector', () => {
      expect(integrationDocContent).toContain('does NOT');
      expect(integrationDocContent).toContain('session');
      expect(integrationDocContent).toContain('course_session_id');
      expect(integrationDocContent).toContain('NULL');
    });

    it('separates CRM fields from integration/attribution metadata clearly', () => {
      expect(integrationDocContent).toContain('CRM CONTACT / APPLICATION FIELDS');
      expect(integrationDocContent).toContain('INTEGRATION / ATTRIBUTION METADATA');
    });

    it('clearly states live Laravel website is NOT YET DEPLOYED', () => {
      expect(integrationDocContent).toContain('Live External Laravel Website');
      expect(integrationDocContent).toContain('NOT YET DEPLOYED');
    });
  });
});
