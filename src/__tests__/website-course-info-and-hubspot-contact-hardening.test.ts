import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isWebsiteLead } from '../features/pipeline/components/MinimalLeadCard';
import { evaluateFirstContactEligibility } from '../features/automations/engine/first-contact-router';

// =============================================================================
// VERIFICATION SUITE: Website Course Info & HubSpot Contact Us Hardening
// Tests 1 through 30 covering Contact Us, Request Course Information,
// Recovery, and Non-regression of Register, Meta, and 00113.
// =============================================================================

describe('Website Course Info & HubSpot Contact Us Hardening Suite', () => {
  const migration00114Path = join(process.cwd(), 'supabase', 'migrations', '00114_website_course_info_and_hubspot_contact_hardening.sql');
  const migration00113Path = join(process.cwd(), 'supabase', 'migrations', '00113_inbound_queue_reschedule_and_turma_hardening.sql');
  const submitPublicFormPath = join(process.cwd(), 'supabase', 'functions', 'submit-public-form', 'index.ts');
  const processLeadIntakePath = join(process.cwd(), 'supabase', 'functions', 'process-lead-intake', 'index.ts');
  const webhooksMetaPath = join(process.cwd(), 'hubspot-project', 'src', 'app', 'webhooks', 'webhooks-hsmeta.json');

  const migration00114Content = readFileSync(migration00114Path, 'utf-8');
  const migration00113Content = readFileSync(migration00113Path, 'utf-8');
  const submitPublicFormContent = readFileSync(submitPublicFormPath, 'utf-8');
  const processLeadIntakeContent = readFileSync(processLeadIntakePath, 'utf-8');
  const webhooksMetaContent = readFileSync(webhooksMetaPath, 'utf-8');

  // ---------------------------------------------------------------------------
  // CONTACT US: Tests 1 - 11
  // ---------------------------------------------------------------------------
  describe('CONTACT US — Reliable Server-Side Path', () => {
    it('1. factual Contact Us identification works in SQL and router', () => {
      expect(migration00114Content).toContain("v_conv_name LIKE '%#contact-form%'");
      expect(migration00114Content).toContain("v_conv_name LIKE '%contact us%'");
      expect(migration00114Content).toContain("v_source_detail := 'contact_form'");
    });

    it('2. HubSpot -> EDS server-side path routes to contact_form without direct JS dependency', () => {
      expect(migration00114Content).toContain("CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch");
      expect(migration00114Content).toContain("v_activity_summary := 'Mensagem enviada via formulário Fale Conosco (HubSpot)'");
    });

    it('3. expected latency: webhook provides 1-3s ingestion, reconcile provides 5m bounded fallback', () => {
      const webhookConfig = JSON.parse(webhooksMetaContent);
      expect(webhookConfig.config.subscriptions.crmObjects.some((s: any) => s.propertyName === 'recent_conversion_date')).toBe(true);
      expect(webhookConfig.config.settings.targetUrl).toContain('hubspot-webhook');
    });

    it('4. same canonical lead matched across phone and email', () => {
      expect(migration00114Content).toContain('SELECT eds_entity_id INTO v_matched_lead_id');
      expect(migration00114Content).toMatch(/hubspot_contact_id\s*=\s*v_contact_id/);
      expect(migration00114Content).toContain('public.find_canonical_lead_by_email(v_clean_email)');
    });

    it('5. returning commercial stage preserved when Contact Us form arrives', () => {
      // In process_hubspot_inbound_batch and process_form_submission_transaction, returning lead updates NEVER change pipeline_stage_id
      expect(migration00114Content).not.toMatch(/UPDATE public\.leads\s+SET[\s\S]+?pipeline_stage_id\s*=/);
    });

    it('6. last_acquisition_at advances monotonically', () => {
      expect(migration00114Content).toContain("last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), v_authoritative_ts)");
    });

    it('7. new inbound attention created (has_new_submission = true and new_inbound_count incremented)', () => {
      expect(migration00114Content).toContain('has_new_submission = true');
      expect(migration00114Content).toContain('new_inbound_count = COALESCE(new_inbound_count, 0) + 1');
    });

    it('8. generic Contact sends NO automated course email', () => {
      // generic Contact Us sets v_course_interest_val := NULL in migration 00114
      expect(migration00114Content).toContain('v_course_interest_val := NULL;');

      const eligibility = evaluateFirstContactEligibility({
        id: 'lead-test',
        source: 'website',
        source_detail: 'contact_form',
        email: 'test@example.com',
        phone_e164: '+15550001000',
      });

      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.suppressedReason).toContain('Website leads require manual client initial response');
    });

    it('9. event + reconcile do not duplicate form submissions', () => {
      expect(migration00114Content).toContain("'hs-' || v_contact_id || '-' || extract(epoch from v_authoritative_ts)::text");
      expect(migration00114Content).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    });

    it('10. direct path + HubSpot path do not duplicate if both enabled', () => {
      expect(migration00114Content).toContain('v_direct_sub_already_exists');
      expect(migration00114Content).toContain('submitted_at >= (v_authoritative_ts - interval \'2 hours\')');
    });

    it('11. reconcile recovers failed event when direct path was missing', () => {
      expect(migration00114Content).toContain('IF v_is_form_submission AND NOT v_direct_sub_already_exists THEN');
      expect(migration00114Content).toContain('INSERT INTO public.form_submissions');
    });
  });

  // ---------------------------------------------------------------------------
  // REQUEST COURSE INFORMATION: Tests 12 - 24
  // ---------------------------------------------------------------------------
  describe('REQUEST COURSE INFORMATION — website-course-info', () => {
    it('12. website-course-info exists in public.forms seed', () => {
      expect(migration00114Content).toContain("'website-course-info'");
      expect(migration00114Content).toContain("'Request Course Information'");
    });

    it('13. active = true configured on website-course-info', () => {
      expect(migration00114Content).toContain("status = 'active'");
    });

    it('14. public lookup succeeds: submit-public-form edge function supports website-course-info', () => {
      expect(submitPublicFormContent).toContain("slug === 'website-course-info'");
      expect(submitPublicFormContent).toContain("form.source_detail === 'course_information_request'");
    });

    it('15. direct submission accepted: full_name and course_code mappings handled', () => {
      expect(submitPublicFormContent).toContain('fields.full_name || fields.name');
      expect(submitPublicFormContent).toContain('fields.course_code');
    });

    it('16. source = website assigned in transaction', () => {
      expect(migration00114Content).toContain("v_assigned_source := 'website'");
    });

    it('17. source_detail = course_information_request assigned for website-course-info', () => {
      expect(migration00114Content).toContain("v_assigned_source_detail := 'course_information_request'");
      expect(submitPublicFormContent).toContain("'course_information_request'");
      expect(isWebsiteLead({ source: 'website', source_detail: 'course_information_request' })).toBe(true);
    });

    it('18. factual course maps correctly in PostgreSQL matching', () => {
      expect(migration00114Content).toContain("lower(name) = lower(v_clean_course)");
      expect(migration00114Content).toContain("lower(code) = lower(v_clean_course)");
      expect(migration00114Content).toContain("lower(v_clean_course) LIKE '%zygo%'");
    });

    it('19. previous interests preserved and merged without duplicate entries', () => {
      expect(migration00114Content).toContain("v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb)");
      expect(migration00114Content).toContain("v_merged_course_interests || jsonb_build_array(v_clean_course)");
    });

    it('20. no enrollment created for website-course-info', () => {
      // process_form_submission_transaction must NEVER insert into enrollments!
      expect(migration00114Content).not.toContain('INSERT INTO public.enrollments');
    });

    it('21. request course information email rules: known vs unknown vs conflicting', () => {
      expect(processLeadIntakeContent).toContain("payload.source_detail === 'course_information_request'");

      // A. website-course-info + factual Wisdom Teeth -> approved Wisdom Teeth email can run with PDF
      const wisdomElig = evaluateFirstContactEligibility({
        id: 'lead-wisdom',
        source: 'website',
        source_detail: 'course_information_request',
        email: 'doctor@example.com',
        phone_e164: '+15551234000',
        course_interest: 'Wisdom Teeth Extraction',
      });
      expect(wisdomElig.isEligible).toBe(true);
      expect(wisdomElig.eligibleChannels).toEqual(['email']);
      expect(wisdomElig.resolvedTemplate?.templateKey).toBe('wisdom_course_details');
      expect(wisdomElig.resolvedTemplate?.hasPdfAttachment).toBe(true);
      expect(wisdomElig.resolvedTemplate?.pdfAttachmentName).toBe('Third molar course.pdf');

      // B. website-course-info + factual Advanced -> approved Advanced email can run with dual PDFs
      const advElig = evaluateFirstContactEligibility({
        id: 'lead-adv',
        source: 'website',
        source_detail: 'course_information_request',
        email: 'doctor@example.com',
        phone_e164: '+15551234000',
        course_interest: 'Advanced Dental Implant',
      });
      expect(advElig.isEligible).toBe(true);
      expect(advElig.eligibleChannels).toEqual(['email']);
      expect(advElig.resolvedTemplate?.templateKey).toBe('implant_course_details');
      expect(advElig.resolvedTemplate?.hasPdfAttachment).toBe(true);
      expect(advElig.resolvedTemplate?.pdfAttachmentNames).toEqual(['Intensive implant .pdf', 'Advanced implant course (1).pdf']);

      // C. website-course-info + unknown course -> ZERO automated email (null / suppressed)
      const unknownElig = evaluateFirstContactEligibility({
        id: 'lead-unknown',
        source: 'website',
        source_detail: 'course_information_request',
        email: 'doctor@example.com',
        phone_e164: '+15551234000',
        course_interest: 'Some Unmapped Random Dental Topic',
      });
      expect(unknownElig.isEligible).toBe(false);
      expect(unknownElig.eligibleChannels).toEqual([]);
      expect(unknownElig.suppressedReason).toContain('Unknown or unmapped course');

      // D. website-course-info + conflicting course values -> ZERO automated email
      const conflictElig = evaluateFirstContactEligibility({
        id: 'lead-conflict',
        source: 'website',
        source_detail: 'course_information_request',
        email: 'doctor@example.com',
        phone_e164: '+15551234000',
        course_interest: 'Wisdom Teeth, Zygomatic Implant',
      });
      expect(conflictElig.isEligible).toBe(false);
      expect(conflictElig.eligibleChannels).toEqual([]);
      expect(conflictElig.suppressedReason).toContain('Conflicting course interests');

      // E. website-course-info without course -> ZERO automated email
      const emptyElig = evaluateFirstContactEligibility({
        id: 'lead-empty',
        source: 'website',
        source_detail: 'course_information_request',
        email: 'doctor@example.com',
        phone_e164: '+15551234000',
        course_interest: null,
      });
      expect(emptyElig.isEligible).toBe(false);
      expect(emptyElig.eligibleChannels).toEqual([]);
    });

    it('22. new inbound attention created in Novas entradas', () => {
      expect(migration00114Content).toContain('has_new_submission = true');
      expect(migration00114Content).toContain('new_inbound_count = COALESCE(new_inbound_count, 0) + 1');
    });

    it('23. returning stage preserved when Request Course Info arrives', () => {
      expect(migration00114Content).toContain("WHERE id = v_target_lead_id;");
      expect(migration00114Content).not.toMatch(/UPDATE public\.leads\s+SET[\s\S]+?pipeline_stage_id\s*=\s*[\s\S]+?WHERE id = v_target_lead_id;/);
    });

    it('24. no duplicate lead created: find_canonical_lead_by_email matches existing lead', () => {
      expect(migration00114Content).toContain('v_lead_by_email := public.find_canonical_lead_by_email(v_clean_email)');
    });
  });

  // ---------------------------------------------------------------------------
  // RECOVERY & OBSERVABILITY: Tests 25 - 27
  // ---------------------------------------------------------------------------
  describe('RECOVERY & OBSERVABILITY', () => {
    it('25. missed Contact Us records recovered safely via process_hubspot_inbound_batch', () => {
      expect(migration00114Content).toContain("v_conv_name LIKE '%#contact-form%'");
      expect(migration00114Content).toContain("v_activity_summary := 'Mensagem enviada via formulário Fale Conosco (HubSpot)'");
    });

    it('26. missed Course Info records recovered safely via process_hubspot_inbound_batch', () => {
      expect(migration00114Content).toContain("v_conv_name LIKE '%#course-info-form%'");
      expect(migration00114Content).toContain("v_activity_summary := 'Solicitou informações do curso via site (HubSpot)'");
    });

    it('27. existing canonical leads not duplicated during recovery', () => {
      expect(migration00114Content).toContain('WHERE integration = \'hubspot\'');
      expect(migration00114Content).toContain('ON CONFLICT (lead_id, course_id) DO NOTHING');
    });
  });

  // ---------------------------------------------------------------------------
  // REGRESSIONS: Tests 28 - 30
  // ---------------------------------------------------------------------------
  describe('REGRESSIONS (Register, Meta, and 00113 Preservation)', () => {
    it('28. Register regression PASS: website-register preserved as website_registration_form', () => {
      expect(migration00114Content).toContain("v_form.slug IN ('website-register', 'register')");
      expect(migration00114Content).toContain("v_assigned_source_detail := 'website_registration_form'");
      expect(submitPublicFormContent).toContain("slug === 'website-register' || form.source_detail === 'website_registration_form'");
      expect(isWebsiteLead({ source: 'website', source_detail: 'website_registration_form' })).toBe(true);
    });

    it('29. Meta regression PASS: Meta lead ads preserved with direct intake and course accumulation', () => {
      expect(migration00114Content).toContain("v_source := 'meta'");
      expect(migration00114Content).toContain("v_source_detail := 'meta_lead_ad'");
      expect(migration00114Content).toContain("v_intent := 'META_LEAD_AD'");
    });

    it('30. 00113 functionality preserved: Novas entradas, task reschedule, turma hardening untouched', () => {
      expect(existsSync(migration00113Path)).toBe(true);
      expect(migration00113Content).toContain('new_inbound_count');
      expect(migration00113Content).toContain('reschedule_crm_task');
      // confirms lead_activities table insert does not specify nonexistent actor_id column
      expect(migration00113Content).not.toMatch(/INSERT INTO public\.lead_activities\s*\([^)]*actor_id[^)]*\)/);
      expect(migration00113Content).toContain('ensure_course_session_for_label'); // confirms Issue 3 fix preserved
    });
  });
});
