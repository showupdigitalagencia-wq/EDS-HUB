-- =============================================================================
-- Migration 00058: Add form_completed Status & Website Form Reconciliation
-- =============================================================================
-- 1. Extends public.incomplete_enrollments.status check constraint to include
--    'form_completed', establishing the truthful 4-state lifecycle:
--    'needs_followup' -> 'form_completed' -> 'recovered' (or 'dismissed').
-- 2. Adds resolved_form_submission_id foreign key referencing public.form_submissions.
-- 3. Updates trg_reconcile_incomplete_enrollment_on_confirm to reconcile attempts
--    in either 'needs_followup' OR 'form_completed' to 'recovered' when confirmed.
-- 4. Seeds canonical 'website-register' form and version 1 safe whitelist fields.
-- 5. Updates process_form_submission_transaction RPC to accept p_external_attempt_id
--    and atomically reconcile matching incomplete attempt + cancel linked task.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend incomplete_enrollments.status check constraint
-- -----------------------------------------------------------------------------
ALTER TABLE public.incomplete_enrollments
  DROP CONSTRAINT IF EXISTS incomplete_enrollments_status_check;

ALTER TABLE public.incomplete_enrollments
  ADD CONSTRAINT incomplete_enrollments_status_check
  CHECK (status IS NULL OR status IN ('needs_followup', 'form_completed', 'recovered', 'dismissed'));

COMMENT ON CONSTRAINT incomplete_enrollments_status_check ON public.incomplete_enrollments IS
  'Allowed lifecycle statuses: needs_followup (intent started), form_completed (application submitted), recovered (enrollment confirmed in public.enrollments), dismissed (operator dismissed).';

-- -----------------------------------------------------------------------------
-- 2. Add resolved_form_submission_id foreign key
-- -----------------------------------------------------------------------------
ALTER TABLE public.incomplete_enrollments
  ADD COLUMN IF NOT EXISTS resolved_form_submission_id UUID NULL
  REFERENCES public.form_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_resolved_form
  ON public.incomplete_enrollments(resolved_form_submission_id);

-- -----------------------------------------------------------------------------
-- 3. Update Enrollment Recovery Trigger Function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_reconcile_incomplete_enrollment_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Triggered when an enrollment is inserted as confirmed or updated to confirmed
  IF (TG_OP = 'INSERT' AND NEW.enrollment_status = 'confirmed') OR
     (TG_OP = 'UPDATE' AND NEW.enrollment_status = 'confirmed' AND OLD.enrollment_status IS DISTINCT FROM 'confirmed') THEN

     FOR v_rec IN
       SELECT id, task_id, course_session_id
       FROM public.incomplete_enrollments
       WHERE lead_id = NEW.lead_id
         AND course_id = NEW.course_id
         AND status IN ('needs_followup', 'form_completed')
         AND (
           -- CASE A: Enrollment has course_session_id NOT NULL -> match same session OR generic null session
           (NEW.course_session_id IS NOT NULL AND (course_session_id = NEW.course_session_id OR course_session_id IS NULL))
           OR
           -- CASE B: Enrollment has course_session_id NULL -> controlled fallback course recovery
           (NEW.course_session_id IS NULL)
         )
     LOOP
       -- 1. Mark recovered, preserving resolved_form_submission_id lineage
       UPDATE public.incomplete_enrollments
       SET status = 'recovered',
           resolved_enrollment_id = NEW.id,
           resolved_at = now(),
           updated_at = now()
       WHERE id = v_rec.id;

       -- 2. Complete ONLY the specifically linked task if still pending
       IF v_rec.task_id IS NOT NULL THEN
         UPDATE public.tasks
         SET status = 'completed', completed_at = now(), updated_at = now()
         WHERE id = v_rec.task_id AND status = 'pending';
       END IF;

       -- 3. Log recovery activity
       INSERT INTO public.lead_activities (
         lead_id, activity_type, actor_type, summary, metadata
       ) VALUES (
         NEW.lead_id, 'incomplete_enrollment_recovered', 'system',
         'Inscrição recuperada: matrícula confirmada no curso.',
         jsonb_build_object(
           'enrollment_id', NEW.id,
           'incomplete_enrollment_id', v_rec.id,
           'course_id', NEW.course_id,
           'course_session_id', NEW.course_session_id
         )
       );
     END LOOP;

  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Seed Canonical website-register Form & Version 1 Whitelist Fields
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_capture_stage_id UUID;
  v_form_id UUID;
BEGIN
  -- Obtain capture stage ID safely
  SELECT id INTO v_capture_stage_id
  FROM public.pipeline_stages
  WHERE code = 'capture'
  LIMIT 1;

  -- Insert or update website-register form
  INSERT INTO public.forms (
    name, slug, description, status, current_version,
    submit_button_text, success_message, source_detail,
    default_pipeline_stage_id, duplicate_update_enabled
  ) VALUES (
    'Inscrição Website (Cursos)',
    'website-register',
    'Formulário oficial de inscrição do site expdentalsolutions.com',
    'active', 1,
    'Submit Application',
    'Obrigado pela sua inscrição! Entraremos em contato em breve.',
    'website_registration_form',
    v_capture_stage_id,
    true
  ) ON CONFLICT (slug) DO UPDATE SET
    status = 'active',
    current_version = 1,
    duplicate_update_enabled = true
  RETURNING id INTO v_form_id;

  IF v_form_id IS NULL THEN
    SELECT id INTO v_form_id FROM public.forms WHERE slug = 'website-register';
  END IF;

  -- Clean version 1 fields before inserting canonical whitelist
  DELETE FROM public.form_fields WHERE form_id = v_form_id AND version = 1;

  -- Insert safe CRM whitelist form_fields (Strictly excluding medical, dietary, files, signature)
  INSERT INTO public.form_fields (form_id, version, internal_name, label, field_type, required, sort_order) VALUES
    (v_form_id, 1, 'first_name', 'Nome', 'first_name', true, 1),
    (v_form_id, 1, 'last_name', 'Sobrenome', 'last_name', false, 2),
    (v_form_id, 1, 'email', 'E-mail', 'email', true, 3),
    (v_form_id, 1, 'phone', 'Telefone', 'phone', true, 4),
    (v_form_id, 1, 'course', 'Curso de Interesse', 'course_interest', true, 5),
    (v_form_id, 1, 'specialty', 'Especialidade', 'select', false, 6),
    (v_form_id, 1, 'years_in_practice', 'Anos de Prática', 'select', false, 7),
    (v_form_id, 1, 'surgical_experience', 'Experiência Cirúrgica', 'select', false, 8),
    (v_form_id, 1, 'agd_number', 'Número AGD', 'text', false, 9),
    (v_form_id, 1, 'heard_from', 'Como Conheceu', 'select', false, 10),
    (v_form_id, 1, 'referral_name', 'Indicação', 'text', false, 11),
    (v_form_id, 1, 'promo_code', 'Código Promocional', 'text', false, 12),
    (v_form_id, 1, 'terms_accepted', 'Termos Aceitos', 'checkbox', false, 13);
END $$;

-- -----------------------------------------------------------------------------
-- 5. Update process_form_submission_transaction with external_attempt_id
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_form_submission_transaction(
  p_form_slug TEXT,
  p_idempotency_key TEXT,
  p_submitted_data JSONB,
  p_email TEXT,
  p_phone_e164 TEXT,
  p_contact_preference TEXT,
  p_course_interest TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_external_attempt_id TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_form RECORD;
  v_existing_sub RECORD;
  v_lead_by_email UUID := NULL;
  v_lead_by_phone UUID := NULL;
  v_target_lead_id UUID := NULL;
  v_submission_id UUID;
  v_intake_event_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
  v_clean_email TEXT;
  v_clean_phone_raw TEXT;
  v_pref TEXT;
  v_tag_id UUID;
  v_matched_incomplete RECORD;
BEGIN
  -- 1. Locate active form
  SELECT id, name, slug, status, success_message, redirect_url, source_detail,
         default_pipeline_stage_id, default_tags, duplicate_update_enabled, current_version
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Form not found',
      'error_code', 'FORM_NOT_FOUND'
    );
  END IF;

  IF v_form.status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Form is inactive',
      'error_code', 'FORM_INACTIVE'
    );
  END IF;

  -- 2. Check Idempotency Key (scoped to form_id)
  SELECT id, lead_id, intake_event_id, processing_status, processing_error
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE form_id = v_form.id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'submission_id', v_existing_sub.id,
      'lead_id', v_existing_sub.lead_id,
      'intake_event_id', v_existing_sub.intake_event_id,
      'processing_status', v_existing_sub.processing_status,
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  -- 3. Lead Deduplication Search (email and phone)
  v_clean_email := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  IF v_clean_email IS NOT NULL THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE email = v_clean_email
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = trim(p_phone_e164)
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 4. Identity Conflict Protection: If email and phone belong to different leads
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    -- Conflict detected: do NOT merge, do NOT alter leads, do NOT advance pipeline
    INSERT INTO public.form_submissions (
      form_id, form_version, lead_id, intake_event_id, submitted_data,
      email, phone_e164, contact_preference, course_interest,
      source_detail, processing_status, processing_error,
      idempotency_key, ip_address, user_agent, submitted_at, processed_at
    ) VALUES (
      v_form.id, v_form.current_version, NULL, NULL, p_submitted_data,
      v_clean_email, p_phone_e164, p_contact_preference, p_course_interest,
      v_form.source_detail, 'conflict', 'Conflict: email and phone belong to different leads.',
      p_idempotency_key, p_ip_address, p_user_agent, now(), now()
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', false,
      'submission_id', v_submission_id,
      'lead_id', NULL,
      'intake_event_id', NULL,
      'processing_status', 'conflict',
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  -- 5. Resolve target lead (new or existing)
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);
  v_first_name := NULLIF(trim(COALESCE(p_submitted_data->>'first_name', '')), '');
  v_last_name := NULLIF(trim(COALESCE(p_submitted_data->>'last_name', '')), '');

  -- Conservative single name fallback: first token = first_name, remaining = last_name
  IF v_first_name IS NULL AND p_submitted_data->>'name' IS NOT NULL THEN
    DECLARE
      v_full_name TEXT := trim(p_submitted_data->>'name');
      v_space_pos INT := position(' ' IN v_full_name);
    BEGIN
      IF v_space_pos > 0 THEN
        v_first_name := substring(v_full_name FROM 1 FOR v_space_pos - 1);
        v_last_name := trim(substring(v_full_name FROM v_space_pos + 1));
      ELSE
        v_first_name := v_full_name;
      END IF;
    END;
  END IF;

  v_clean_phone_raw := NULLIF(trim(COALESCE(p_submitted_data->>'phone', '')), '');
  v_pref := COALESCE(p_contact_preference, 'email');
  IF v_pref NOT IN ('email', 'sms', 'call') THEN
    v_pref := 'email';
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- Create new lead with canonical source = 'form' in capture stage
    INSERT INTO public.leads (
      source, first_name, last_name, email, email_confirmation,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, created_at, updated_at
    ) VALUES (
      'form', v_first_name, v_last_name, v_clean_email, v_clean_email,
      v_clean_phone_raw, p_phone_e164,
      v_pref, p_course_interest,
      CASE WHEN p_course_interest IS NOT NULL AND trim(p_course_interest) != '' 
           THEN jsonb_build_array(trim(p_course_interest)) 
           ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, now(), now()
    ) RETURNING id INTO v_target_lead_id;

    -- Stage history assignment
    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_assignment'
    );

    -- Activity: lead_created
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'lead_created', 'system',
      'Lead created from form: ' || v_form.name,
      jsonb_build_object(
        'source', 'form',
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'source_detail', v_form.source_detail
      )
    );
  ELSE
    -- Existing lead: PRESERVE original source and PRESERVE commercial pipeline_stage_id
    IF v_form.duplicate_update_enabled THEN
      UPDATE public.leads
      SET 
        first_name = COALESCE(v_first_name, first_name),
        last_name = COALESCE(v_last_name, last_name),
        email = COALESCE(v_clean_email, email),
        phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
        phone_e164 = COALESCE(p_phone_e164, phone_e164),
        contact_preference = CASE WHEN p_contact_preference IN ('email', 'sms', 'call') THEN p_contact_preference ELSE contact_preference END,
        course_interest = COALESCE(p_course_interest, course_interest),
        course_interests = CASE 
          WHEN p_course_interest IS NOT NULL AND trim(p_course_interest) != '' AND NOT (course_interests @> jsonb_build_array(trim(p_course_interest)))
          THEN course_interests || jsonb_build_array(trim(p_course_interest))
          ELSE course_interests
        END,
        updated_at = now()
      WHERE id = v_target_lead_id;
    END IF;
  END IF;

  -- 6. Insert form_submissions record
  INSERT INTO public.form_submissions (
    form_id, form_version, lead_id, submitted_data,
    email, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, idempotency_key,
    ip_address, user_agent, submitted_at
  ) VALUES (
    v_form.id, v_form.current_version, v_target_lead_id, p_submitted_data,
    v_clean_email, p_phone_e164, p_contact_preference, p_course_interest,
    v_form.source_detail, 'processing', p_idempotency_key,
    p_ip_address, p_user_agent, now()
  ) RETURNING id INTO v_submission_id;

  -- 7. Associate default tags if configured
  IF v_form.default_tags IS NOT NULL AND jsonb_array_length(v_form.default_tags) > 0 THEN
    FOR v_tag_id IN SELECT jsonb_array_elements_text(v_form.default_tags)::uuid LOOP
      INSERT INTO public.lead_tags (lead_id, tag_id)
      VALUES (v_target_lead_id, v_tag_id)
      ON CONFLICT (lead_id, tag_id) DO NOTHING;
    END LOOP;
  END IF;

  -- 8. Activity: form_submitted
  INSERT INTO public.lead_activities (
    lead_id, activity_type, actor_type, summary, metadata
  ) VALUES (
    v_target_lead_id, 'form_submitted', 'system',
    'Submitted form: ' || v_form.name,
    jsonb_build_object(
      'form_id', v_form.id,
      'form_name', v_form.name,
      'form_slug', v_form.slug,
      'submission_id', v_submission_id,
      'form_version', v_form.current_version,
      'external_attempt_id', p_external_attempt_id,
      'source_detail', v_form.source_detail
    )
  );

  -- 9. Create lead_intake_event
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
  ) VALUES (
    'form', v_submission_id::text, v_target_lead_id::text,
    'form:' || v_form.id::text || ':' || p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'first_name', v_first_name,
      'last_name', v_last_name,
      'email', v_clean_email,
      'phone', p_phone_e164,
      'contact_preference', p_contact_preference,
      'course_interest', p_course_interest,
      'form_id', v_form.id,
      'form_slug', v_form.slug,
      'source_detail', v_form.source_detail
    ),
    'processing', v_target_lead_id, 1, now()
  ) RETURNING id INTO v_intake_event_id;

  -- Link intake_event_id to form_submission
  UPDATE public.form_submissions
  SET intake_event_id = v_intake_event_id
  WHERE id = v_submission_id AND id IS NOT NULL;

  -- 10. Atomically reconcile earlier incomplete enrollment attempt if external_attempt_id is provided
  -- Constrain by BOTH external_attempt_id AND matched lead_id to avoid ambiguous cross-lead collision
  IF p_external_attempt_id IS NOT NULL AND trim(p_external_attempt_id) != '' AND v_target_lead_id IS NOT NULL THEN
    -- 10.1 First try matching with course context if course interest is provided
    IF p_course_interest IS NOT NULL AND trim(p_course_interest) != '' THEN
      SELECT ie.id, ie.task_id INTO v_matched_incomplete
      FROM public.incomplete_enrollments ie
      JOIN public.courses c ON c.id = ie.course_id
      WHERE ie.external_attempt_id = trim(p_external_attempt_id)
        AND ie.lead_id = v_target_lead_id
        AND (c.code = trim(p_course_interest) OR lower(c.name) = lower(trim(p_course_interest)))
        AND ie.status = 'needs_followup'
      ORDER BY ie.created_at DESC
      LIMIT 1;
    END IF;

    -- 10.2 Fallback: match by external_attempt_id + matched lead_id (safely constrained, single row)
    IF v_matched_incomplete.id IS NULL THEN
      SELECT id, task_id INTO v_matched_incomplete
      FROM public.incomplete_enrollments
      WHERE external_attempt_id = trim(p_external_attempt_id)
        AND lead_id = v_target_lead_id
        AND status = 'needs_followup'
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF v_matched_incomplete.id IS NOT NULL THEN
      -- Transition to form_completed
      UPDATE public.incomplete_enrollments
      SET status = 'form_completed',
          resolved_form_submission_id = v_submission_id,
          resolved_at = now(),
          updated_at = now()
      WHERE id = v_matched_incomplete.id;

      -- Cancel specifically linked follow-up task if pending
      IF v_matched_incomplete.task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'cancelled',
            completed_at = now(),
            updated_at = now()
        WHERE id = v_matched_incomplete.task_id AND status = 'pending';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processing',
    'reconciled_incomplete_id', v_matched_incomplete.id,
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

-- Maintain function execution privileges
REVOKE ALL ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
