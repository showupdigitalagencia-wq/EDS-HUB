-- =============================================================================
-- Migration 00114: Website Course Info Intake & HubSpot Contact Us Server-Side Hardening
-- =============================================================================
-- Objectives:
-- 1. Register canonical 'website-course-info' public form in public.forms (active, version 1)
--    with source_detail = 'course_information_request' and approved CRM fields.
-- 2. Hardens process_form_submission_transaction:
--    - Supports 'website-course-info' with source = 'website', source_detail = 'course_information_request'
--    - Accumulates factual course interest without creating an enrollment
--    - Preserves commercial stage, updates last_acquisition_at, flags Novas entradas
--    - Restores soft-deleted leads upon new inbound submission
-- 3. Hardens process_hubspot_inbound_batch:
--    - Factual server-side classification of Contact Us (#contact-form -> contact_form)
--      and Course Information (#course-info-form -> course_information_request)
--    - Strong idempotency avoiding duplicates when both browser direct path and HubSpot fire
--    - Preserves existing stage, restores soft-deleted leads, increments new_inbound_count
--    - Generic Contact Us: ZERO inferred course, ZERO automatic course email
-- 4. Updates check_website_sync_health() to observe all three website channels:
--    contact_form, course_information_request, website_registration_form.
-- =============================================================================

-- 1. Register 'website-course-info' in public.forms
INSERT INTO public.forms (
  id, name, slug, description, status, current_version,
  submit_button_text, success_message, redirect_url,
  default_pipeline_stage_id, source_detail, duplicate_update_enabled,
  created_at, updated_at
) VALUES (
  'b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid,
  'Request Course Information',
  'website-course-info',
  'Official course information request form from expdentalsolutions.com',
  'active',
  1,
  'Submit',
  'Thank you for your interest! Our team will send the course details shortly.',
  'https://www.expdentalsolutions.com/thank-you',
  (SELECT id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1),
  'course_information_request',
  true,
  now(), now()
) ON CONFLICT (slug) DO UPDATE SET
  status = 'active',
  source_detail = 'course_information_request',
  name = 'Request Course Information',
  updated_at = now();

-- 2. Register Form Fields for website-course-info (Version 1)
INSERT INTO public.form_fields (
  form_id, version, internal_name, label, field_type, required, sort_order, created_at, updated_at
) VALUES
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'first_name', 'Nome', 'first_name', false, 1, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'last_name', 'Sobrenome', 'last_name', false, 2, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'name', 'Nome Completo', 'text', false, 3, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'full_name', 'Nome Completo', 'text', false, 4, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'email', 'E-mail', 'email', true, 5, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'phone', 'Telefone', 'phone', false, 6, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'course', 'Curso de Interesse', 'select', false, 7, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'course_code', 'Código do Curso', 'text', false, 8, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'message', 'Mensagem', 'textarea', false, 9, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'source_page', 'Página de Origem', 'text', false, 10, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'utm_source', 'UTM Source', 'text', false, 11, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'utm_medium', 'UTM Medium', 'text', false, 12, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'utm_campaign', 'UTM Campaign', 'text', false, 13, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'utm_term', 'UTM Term', 'text', false, 14, now(), now()),
  ('b4c9d2e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e'::uuid, 1, 'utm_content', 'UTM Content', 'text', false, 15, now(), now())
ON CONFLICT (form_id, version, internal_name) DO UPDATE SET
  required = EXCLUDED.required,
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- 3. Hardened process_form_submission_transaction
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_form RECORD;
  v_existing_sub RECORD;
  v_lead_by_email UUID;
  v_lead_by_phone UUID;
  v_target_lead_id UUID;
  v_email_resolution JSONB;
  v_clean_email TEXT;
  v_clean_email_conf TEXT;
  v_email_mismatch BOOLEAN := false;
  v_clean_phone_raw TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_pref TEXT;
  v_clean_course TEXT;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_intake_event_id UUID;
  v_submission_id UUID;
  v_assigned_source TEXT;
  v_assigned_source_detail TEXT;
  v_intent TEXT;
  v_activity_summary TEXT;
  v_authoritative_ts TIMESTAMPTZ;
  v_resolved_course_id UUID;
  v_slot INT;
BEGIN
  -- 1. Fetch Form
  SELECT id, slug, name, current_version, status, default_pipeline_stage_id,
         success_message, redirect_url, source_detail
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug
  LIMIT 1;

  IF NOT FOUND OR v_form.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found or inactive');
  END IF;

  -- 2. Idempotency Check
  SELECT id, lead_id, intake_event_id, processing_status
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

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

  -- 3. Resolve Authoritative Inbound Timestamp
  v_authoritative_ts := COALESCE(
    public.parse_authoritative_timestamp(p_submitted_data->>'submitted_at'),
    public.parse_authoritative_timestamp(p_submitted_data->>'created_time'),
    public.parse_authoritative_timestamp(p_submitted_data->>'conversion_time'),
    public.parse_authoritative_timestamp(p_submitted_data->>'recent_conversion_date'),
    public.parse_authoritative_timestamp(p_submitted_data->>'source_created_at'),
    public.parse_authoritative_timestamp(p_submitted_data->>'event_timestamp'),
    public.parse_authoritative_timestamp(p_submitted_data->>'timestamp'),
    now()
  );

  -- 4. Multi-Email Canonical Resolution
  v_email_resolution := public.resolve_intake_emails(
    p_email,
    p_submitted_data->>'email_confirmation'
  );
  v_clean_email := v_email_resolution->>'primary_email';
  v_clean_email_conf := v_email_resolution->>'confirmation_email';
  v_email_mismatch := (v_email_resolution->>'is_mismatch')::boolean;

  -- 5. Extract Names & Contact Info
  v_first_name := NULLIF(trim(COALESCE(
    p_submitted_data->>'first_name',
    p_submitted_data->>'firstname',
    ''
  )), '');

  v_last_name := NULLIF(trim(COALESCE(
    p_submitted_data->>'last_name',
    p_submitted_data->>'lastname',
    ''
  )), '');

  -- Name splitting fallback if single name field was submitted
  IF v_first_name IS NULL AND (p_submitted_data->>'name' IS NOT NULL OR p_submitted_data->>'full_name' IS NOT NULL) THEN
    DECLARE
      v_full_raw TEXT := trim(COALESCE(p_submitted_data->>'name', p_submitted_data->>'full_name', ''));
      v_space_idx INT := position(' ' in v_full_raw);
    BEGIN
      IF v_space_idx > 0 THEN
        v_first_name := substring(v_full_raw from 1 for v_space_idx - 1);
        v_last_name := trim(substring(v_full_raw from v_space_idx + 1));
      ELSE
        v_first_name := v_full_raw;
        v_last_name := NULL;
      END IF;
    END;
  END IF;

  v_clean_phone_raw := NULLIF(trim(COALESCE(
    p_submitted_data->>'phone',
    p_submitted_data->>'mobilephone',
    p_phone_e164,
    ''
  )), '');

  v_pref := lower(trim(COALESCE(
    p_contact_preference,
    p_submitted_data->>'contact_preference',
    p_submitted_data->>'preferred_contact_method',
    'email'
  )));
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := 'email';
  END IF;

  v_clean_course := NULLIF(trim(COALESCE(
    p_course_interest,
    p_submitted_data->>'course',
    p_submitted_data->>'course_interest',
    p_submitted_data->>'course_code',
    ''
  )), '');

  -- 6. Canonical Classification & Routing
  v_assigned_source := 'website';

  IF v_form.slug = 'website-course-info' OR v_form.source_detail = 'course_information_request' THEN
    v_assigned_source_detail := 'course_information_request';
    v_intent := 'course_info';
    v_activity_summary := 'Solicitou informações do curso via site';
  ELSIF v_form.slug IN ('website-contact', 'contact', 'contact-form', 'fale-conosco') OR v_form.source_detail = 'contact_form' THEN
    v_assigned_source_detail := 'contact_form';
    v_intent := 'contact_request';
    v_activity_summary := 'Mensagem enviada via formulário Fale Conosco';
  ELSIF v_form.slug IN ('website-register', 'register') OR v_form.source_detail = 'website_registration_form' THEN
    v_assigned_source_detail := 'website_registration_form';
    v_intent := 'enrollment';
    v_activity_summary := 'Inscrição via site';
  ELSE
    v_assigned_source_detail := COALESCE(v_form.source_detail, 'website');
    v_intent := 'form_submission';
    v_activity_summary := 'Formulário do site preenchido: ' || v_form.name;
  END IF;

  -- 7. Deduplication & Canonical Lead Resolution
  IF v_clean_email IS NOT NULL THEN
    v_lead_by_email := public.find_canonical_lead_by_email(v_clean_email);
  END IF;

  IF p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = p_phone_e164
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    -- Also check soft-deleted lead if no active lead found
    IF v_lead_by_phone IS NULL THEN
      SELECT id INTO v_lead_by_phone
      FROM public.leads
      WHERE phone_e164 = p_phone_e164
        AND deleted_at IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- Cross-match conflict protection
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    INSERT INTO public.form_submissions (
      form_id, form_version, submitted_data, email, phone_e164, contact_preference,
      course_interest, source_detail, processing_status, processing_error,
      idempotency_key, ip_address, user_agent, submitted_at, processed_at
    ) VALUES (
      v_form.id, v_form.current_version, p_submitted_data, v_clean_email, p_phone_e164, v_pref,
      v_clean_course, v_assigned_source_detail, 'conflict',
      format('Conflict: email matches lead %s but phone matches lead %s', v_lead_by_email, v_lead_by_phone),
      p_idempotency_key, p_ip_address, p_user_agent, v_authoritative_ts, now()
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
      'success', true,
      'submission_id', v_submission_id,
      'processing_status', 'conflict',
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);

  -- 8. Lead Processing (Update vs Create)
  IF v_target_lead_id IS NOT NULL THEN
    -- RETURNING LEAD: Strictly preserve commercial pipeline stage! Accumulate course interests!
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    IF v_clean_course IS NOT NULL AND trim(v_clean_course) != '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) elem
        WHERE lower(trim(elem)) = lower(trim(v_clean_course))
           OR (lower(trim(v_clean_course)) LIKE '%zygo%' AND lower(trim(elem)) LIKE '%zygo%')
           OR (lower(trim(v_clean_course)) LIKE '%wisdom%' AND lower(trim(elem)) LIKE '%wisdom%')
           OR (lower(trim(v_clean_course)) LIKE '%intensiv%' AND lower(trim(elem)) LIKE '%intensiv%')
           OR (lower(trim(v_clean_course)) LIKE '%advanced%' AND lower(trim(elem)) LIKE '%advanced%')
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
      END IF;
    END IF;

    IF v_existing_course_interest IS NULL OR trim(v_existing_course_interest) = '' THEN
      v_merged_course_interest := v_clean_course;
    ELSIF v_clean_course IS NOT NULL AND trim(v_clean_course) != '' THEN
      IF NOT (
        lower(v_existing_course_interest) LIKE '%' || lower(trim(v_clean_course)) || '%'
        OR (lower(trim(v_clean_course)) LIKE '%zygo%' AND lower(v_existing_course_interest) LIKE '%zygo%')
        OR (lower(trim(v_clean_course)) LIKE '%wisdom%' AND lower(v_existing_course_interest) LIKE '%wisdom%')
        OR (lower(trim(v_clean_course)) LIKE '%intensiv%' AND lower(v_existing_course_interest) LIKE '%intensiv%')
        OR (lower(trim(v_clean_course)) LIKE '%advanced%' AND lower(v_existing_course_interest) LIKE '%advanced%')
      ) THEN
        v_merged_course_interest := v_existing_course_interest || ', ' || v_clean_course;
      ELSE
        v_merged_course_interest := v_existing_course_interest;
      END IF;
    ELSE
      v_merged_course_interest := v_existing_course_interest;
    END IF;

    -- Update lead with un-delete recovery, new attention state, and increment count
    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      contact_preference = COALESCE(v_pref, contact_preference),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), v_authoritative_ts),
      last_inbound_activity_at = GREATEST(COALESCE(last_inbound_activity_at, '-infinity'::timestamptz), v_authoritative_ts),
      has_new_submission = true,
      new_submission_at = GREATEST(COALESCE(new_submission_at, '-infinity'::timestamptz), v_authoritative_ts),
      new_inbound_count = COALESCE(new_inbound_count, 0) + 1,
      deleted_at = NULL,
      updated_at = now()
    WHERE id = v_target_lead_id;

  ELSE
    -- NEW LEAD: Initial assignment to capture stage
    INSERT INTO public.leads (
      source, source_detail,
      first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference,
      course_interest, course_interests,
      pipeline_stage_id,
      last_acquisition_at, last_inbound_activity_at,
      has_new_submission, new_submission_at, new_inbound_count,
      created_at, updated_at
    ) VALUES (
      v_assigned_source, v_assigned_source_detail,
      COALESCE(v_first_name, 'Lead'), v_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
      v_clean_phone_raw, p_phone_e164, v_pref,
      v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL THEN jsonb_build_array(v_clean_course) ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id,
      v_authoritative_ts, v_authoritative_ts,
      true, v_authoritative_ts, 1,
      v_authoritative_ts, now()
    ) RETURNING id INTO v_target_lead_id;

    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_form_submission'
    );
  END IF;

  -- 9. Relational lead_course_interests resolution
  IF v_clean_course IS NOT NULL AND trim(v_clean_course) != '' THEN
    SELECT id INTO v_resolved_course_id
    FROM public.courses
    WHERE active = true
      AND (
        lower(name) = lower(v_clean_course)
        OR lower(code) = lower(v_clean_course)
        OR lower(name) LIKE '%' || lower(v_clean_course) || '%'
        OR (lower(v_clean_course) LIKE '%zygo%' AND lower(name) LIKE '%zygo%')
        OR (lower(v_clean_course) LIKE '%wisdom%' AND lower(name) LIKE '%wisdom%')
        OR (lower(v_clean_course) LIKE '%intensiv%' AND lower(name) LIKE '%intensiv%')
        OR (lower(v_clean_course) LIKE '%advanced%' AND lower(name) LIKE '%advanced%')
        OR (lower(v_clean_course) LIKE '%endo%' AND lower(name) LIKE '%endo%')
        OR (lower(v_clean_course) LIKE '%perio%' AND lower(name) LIKE '%perio%')
        OR (lower(v_clean_course) LIKE '%rehab%' AND lower(name) LIKE '%rehab%')
      )
    LIMIT 1;

    IF v_resolved_course_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.lead_course_interests
        WHERE lead_id = v_target_lead_id AND course_id = v_resolved_course_id
      ) THEN
        SELECT slot INTO v_slot
        FROM unnest(ARRAY[1, 2, 3]) AS slot
        WHERE slot NOT IN (
          SELECT priority FROM public.lead_course_interests
          WHERE lead_id = v_target_lead_id AND priority IS NOT NULL
        )
        ORDER BY slot ASC
        LIMIT 1;

        INSERT INTO public.lead_course_interests (
          lead_id, course_id, priority, source, status, created_at, updated_at
        ) VALUES (
          v_target_lead_id,
          v_resolved_course_id,
          v_slot,
          'website',
          'active',
          now(),
          now()
        ) ON CONFLICT (lead_id, course_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- 10. Sync Lead Emails
  PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

  -- 11. Create Intake Event
  INSERT INTO public.lead_intake_events (
    source, source_detail, payload, status, lead_id, idempotency_key, created_at
  ) VALUES (
    v_assigned_source, v_assigned_source_detail,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'form_name', v_form.name,
      'submitted_data', p_submitted_data,
      'external_attempt_id', p_external_attempt_id,
      'intent', v_intent
    ),
    'processed', v_target_lead_id, p_idempotency_key, v_authoritative_ts
  ) RETURNING id INTO v_intake_event_id;

  -- 12. Create Form Submission
  INSERT INTO public.form_submissions (
    form_id, form_version, lead_id, intake_event_id,
    submitted_data, email, email_confirmation, email_mismatch,
    phone_e164, contact_preference, course_interest, source_detail,
    processing_status, idempotency_key, ip_address, user_agent,
    submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_target_lead_id, v_intake_event_id,
    p_submitted_data, v_clean_email, v_clean_email_conf, v_email_mismatch,
    p_phone_e164, v_pref, v_clean_course, v_assigned_source_detail,
    'processed', p_idempotency_key, p_ip_address, p_user_agent,
    v_authoritative_ts, now()
  ) RETURNING id INTO v_submission_id;

  -- 13. Audit Activity
  INSERT INTO public.lead_activities (
    lead_id, intake_event_id, activity_type, actor_type, summary, metadata, created_at
  ) VALUES (
    v_target_lead_id, v_intake_event_id, 'form_submitted', 'system',
    v_activity_summary,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'form_name', v_form.name,
      'source', v_assigned_source,
      'source_detail', v_assigned_source_detail,
      'submission_id', v_submission_id,
      'external_attempt_id', p_external_attempt_id,
      'intent', v_intent,
      'course_interest', v_clean_course
    ),
    v_authoritative_ts
  );

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processed',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

-- 4. Hardened process_hubspot_inbound_batch
-- Accurately classifies Contact Us vs Request Course Information vs Register vs Meta
-- Provides bulletproof deduplication with direct website submissions.
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(
  p_contacts JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contact JSONB;
  v_props JSONB;
  v_contact_id TEXT;
  v_email TEXT;
  v_email_confirmation TEXT;
  v_email_mismatch BOOLEAN;
  v_email_resolution JSONB;
  v_first_name TEXT;
  v_last_name TEXT;
  v_phone TEXT;
  v_source TEXT;
  v_source_detail TEXT;
  v_course_interest_raw TEXT;
  v_course_interest_val TEXT;
  v_contact_pref TEXT;
  v_source_created_at TIMESTAMPTZ;
  v_first_conv_date TIMESTAMPTZ;
  v_recent_conv_date TIMESTAMPTZ;
  v_authoritative_ts TIMESTAMPTZ;
  v_first_conv TEXT;
  v_recent_conv TEXT;
  v_conv_name TEXT;
  v_is_course_info BOOLEAN := false;
  v_is_contact_us BOOLEAN := false;
  v_is_register BOOLEAN := false;
  v_is_form_submission BOOLEAN := false;
  v_activity_summary TEXT;
  v_intent TEXT;
  v_capture_stage_id UUID;
  v_matched_lead_id UUID;
  v_existing_lead_course TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
  v_slot INT;
  v_existing_active_link RECORD;
  v_direct_sub_already_exists BOOLEAN;
  v_processed_count INT := 0;
  v_ignored_count INT := 0;
BEGIN
  -- Fetch default capture stage
  SELECT id INTO v_capture_stage_id
  FROM public.pipeline_stages
  WHERE code = 'capture'
  LIMIT 1;

  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    BEGIN
      v_props := COALESCE(v_contact->'properties', '{}'::jsonb);
      v_contact_id := NULLIF(trim(v_contact->>'id'), '');

      IF v_contact_id IS NULL THEN
        CONTINUE;
      END IF;

      -- 1. Email Resolution
      v_email_resolution := public.resolve_intake_emails(
        v_props->>'email',
        v_props->>'email_confirmation'
      );
      v_email := v_email_resolution->>'primary_email';
      v_email_confirmation := v_email_resolution->>'confirmation_email';
      v_email_mismatch := (v_email_resolution->>'is_mismatch')::boolean;

      -- 2. Names & Phone
      v_first_name := NULLIF(trim(v_props->>'firstname'), '');
      v_last_name := NULLIF(trim(v_props->>'lastname'), '');
      v_phone := NULLIF(trim(COALESCE(v_props->>'phone', v_props->>'mobilephone', '')), '');

      -- 3. Course Interest Extraction
      v_course_interest_raw := NULLIF(trim(COALESCE(
        v_props->>'course_interest',
        v_props->>'curso_de_interesse',
        v_props->>'what_course_are_you_interested_in_',
        v_props->>'curso',
        ''
      )), '');

      v_course_interest_val := v_course_interest_raw;

      -- 4. Contact Preference
      v_contact_pref := lower(trim(COALESCE(v_props->>'contact_preference', v_props->>'preferencia_de_contato', '')));
      IF v_contact_pref NOT IN ('email', 'sms', 'phone', 'whatsapp') THEN
        v_contact_pref := 'email';
      END IF;

      -- 5. Timestamps
      v_source_created_at := NULLIF(trim(v_props->>'createdate'), '')::timestamptz;
      v_first_conv_date := NULLIF(trim(v_props->>'first_conversion_date'), '')::timestamptz;
      v_recent_conv_date := NULLIF(trim(v_props->>'recent_conversion_date'), '')::timestamptz;

      v_authoritative_ts := COALESCE(
        v_recent_conv_date,
        v_first_conv_date,
        v_source_created_at,
        now()
      );

      -- 6. Factual Form Conversion Event Classification
      v_first_conv := lower(trim(COALESCE(v_props->>'first_conversion_event_name', '')));
      v_recent_conv := lower(trim(COALESCE(v_props->>'recent_conversion_event_name', '')));
      v_conv_name := COALESCE(NULLIF(v_recent_conv, ''), v_first_conv);

      IF v_conv_name LIKE '%#course-info-form%'
         OR v_conv_name LIKE '%request course information%'
         OR v_conv_name LIKE '%course-info%'
         OR (v_conv_name LIKE '%course%' AND v_conv_name LIKE '%info%') THEN
        v_is_course_info := true;
        v_is_contact_us := false;
        v_is_register := false;
        v_is_form_submission := true;
        v_source := 'website';
        v_source_detail := 'course_information_request';
        v_intent := 'course_info';
        v_activity_summary := 'Solicitou informações do curso via site (HubSpot)';

      ELSIF v_conv_name LIKE '%#contact-form%'
         OR v_conv_name LIKE '%contact us%'
         OR v_conv_name LIKE '%contact-form%'
         OR (v_conv_name LIKE '%contact%' AND NOT v_conv_name LIKE '%lead ad%') THEN
        v_is_course_info := false;
        v_is_contact_us := true;
        v_is_register := false;
        v_is_form_submission := true;
        v_source := 'website';
        v_source_detail := 'contact_form';
        v_intent := 'contact_request';
        v_activity_summary := 'Mensagem enviada via formulário Fale Conosco (HubSpot)';
        -- Generic Contact Us: strictly ZERO inferred course
        v_course_interest_val := NULL;

      ELSIF v_conv_name LIKE '%#register-form%'
         OR v_conv_name LIKE '%register%'
         OR v_conv_name LIKE '%registration%' THEN
        v_is_course_info := false;
        v_is_contact_us := false;
        v_is_register := true;
        v_is_form_submission := true;
        v_source := 'website';
        v_source_detail := 'website_registration_form';
        v_intent := 'enrollment';
        v_activity_summary := 'Inscrição via site (HubSpot)';

      ELSIF lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', '')) LIKE '%meta%'
         OR lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', '')) LIKE '%facebook%'
         OR lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', '')) LIKE '%instagram%'
         OR v_conv_name LIKE '%lead ad%'
         OR v_conv_name LIKE '%facebook%'
         OR lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' THEN
        v_is_course_info := false;
        v_is_contact_us := false;
        v_is_register := false;
        v_is_form_submission := true;
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
        v_intent := 'META_LEAD_AD';
        v_activity_summary := 'Lead sincronizado via Meta Lead Ads';

      ELSE
        v_is_course_info := false;
        v_is_contact_us := false;
        v_is_register := false;
        v_is_form_submission := (v_conv_name != '');
        v_source := 'hubspot';
        v_source_detail := COALESCE(v_props->>'hs_analytics_source', 'hubspot_sync');
        v_intent := 'contact_sync';
        v_activity_summary := 'Contato sincronizado do HubSpot';
      END IF;

      -- 7. Deduplication / Canonical Lead Matching
      v_matched_lead_id := NULL;

      -- 7a. Match by active integration_entity_link
      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      -- 7b. Match by leads.hubspot_contact_id
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- 7c. Match by primary or secondary email
      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        SELECT l.id INTO v_matched_lead_id
        FROM public.leads l
        LEFT JOIN public.lead_emails le ON le.lead_id = l.id
        WHERE (lower(trim(l.email)) = v_email
           OR lower(trim(COALESCE(l.email_confirmation, ''))) = v_email
           OR lower(trim(COALESCE(le.normalized_email, ''))) = v_email)
          AND l.deleted_at IS NULL
        ORDER BY l.created_at ASC
        LIMIT 1;
      END IF;

      -- 7d. Match by normalized phone
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
           OR regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') LIKE '%' || substring(v_phone from length(v_phone) - 7))
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- 7e. Soft-deleted returning lead recovery check
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(email) = v_email))
          AND deleted_at IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_matched_lead_id IS NOT NULL THEN
          IF v_is_form_submission THEN
            -- Un-delete soft-deleted lead upon genuine new inbound submission
            UPDATE public.leads
            SET deleted_at = NULL, updated_at = now()
            WHERE id = v_matched_lead_id;
          ELSE
            -- Routine sync of archived contact: ignore
            v_ignored_count := v_ignored_count + 1;
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- 8. Deduplication Protection between Direct Browser Path & HubSpot Path
      v_direct_sub_already_exists := false;
      IF v_matched_lead_id IS NOT NULL AND (v_is_contact_us OR v_is_course_info OR v_is_register) THEN
        -- Check if direct submission was already logged for this lead & source_detail in recent window
        SELECT EXISTS (
          SELECT 1 FROM public.form_submissions
          WHERE lead_id = v_matched_lead_id
            AND source_detail = v_source_detail
            AND submitted_at >= (v_authoritative_ts - interval '2 hours')
            AND submitted_at <= (v_authoritative_ts + interval '2 hours')
        ) INTO v_direct_sub_already_exists;
      END IF;

      -- 9. Lead Processing (Update vs Create)
      IF v_matched_lead_id IS NOT NULL THEN
        -- RETURNING LEAD: Strictly preserve commercial pipeline stage! Accumulate course interests!
        SELECT course_interest, course_interests
        INTO v_existing_lead_course, v_existing_course_interests
        FROM public.leads
        WHERE id = v_matched_lead_id;

        v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) elem
            WHERE lower(trim(elem)) = lower(trim(v_course_interest_val))
               OR (lower(trim(v_course_interest_val)) LIKE '%zygo%' AND lower(trim(elem)) LIKE '%zygo%')
               OR (lower(trim(v_course_interest_val)) LIKE '%wisdom%' AND lower(trim(elem)) LIKE '%wisdom%')
               OR (lower(trim(v_course_interest_val)) LIKE '%intensiv%' AND lower(trim(elem)) LIKE '%intensiv%')
               OR (lower(trim(v_course_interest_val)) LIKE '%advanced%' AND lower(trim(elem)) LIKE '%advanced%')
          ) THEN
            v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);
          END IF;
        END IF;

        IF v_existing_lead_course IS NULL OR trim(v_existing_lead_course) = '' THEN
          v_merged_course_interest := v_course_interest_val;
        ELSIF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          IF NOT (
            lower(v_existing_lead_course) LIKE '%' || lower(trim(v_course_interest_val)) || '%'
            OR (lower(trim(v_course_interest_val)) LIKE '%zygo%' AND lower(v_existing_lead_course) LIKE '%zygo%')
            OR (lower(trim(v_course_interest_val)) LIKE '%wisdom%' AND lower(v_existing_lead_course) LIKE '%wisdom%')
            OR (lower(trim(v_course_interest_val)) LIKE '%intensiv%' AND lower(v_existing_lead_course) LIKE '%intensiv%')
            OR (lower(trim(v_course_interest_val)) LIKE '%advanced%' AND lower(v_existing_lead_course) LIKE '%advanced%')
          ) THEN
            v_merged_course_interest := v_existing_lead_course || ', ' || v_course_interest_val;
          ELSE
            v_merged_course_interest := v_existing_lead_course;
          END IF;
        ELSE
          v_merged_course_interest := v_existing_lead_course;
        END IF;

        UPDATE public.leads
        SET
          first_name = COALESCE(v_first_name, first_name),
          last_name = COALESCE(v_last_name, last_name),
          email_confirmation = COALESCE(v_email_confirmation, email_confirmation),
          email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
          phone_raw = COALESCE(v_phone, phone_raw),
          contact_preference = COALESCE(v_contact_pref, contact_preference),
          hubspot_contact_id = COALESCE(hubspot_contact_id, v_contact_id),
          source_created_at = COALESCE(source_created_at, v_source_created_at),
          course_interest = v_merged_course_interest,
          course_interests = v_merged_course_interests,
          last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), v_authoritative_ts),
          last_inbound_activity_at = GREATEST(COALESCE(last_inbound_activity_at, '-infinity'::timestamptz), v_authoritative_ts),
          has_new_submission = CASE WHEN v_is_form_submission THEN true ELSE has_new_submission END,
          new_submission_at = CASE WHEN v_is_form_submission THEN GREATEST(COALESCE(new_submission_at, '-infinity'::timestamptz), v_authoritative_ts) ELSE new_submission_at END,
          new_inbound_count = CASE WHEN v_is_form_submission AND NOT v_direct_sub_already_exists THEN COALESCE(new_inbound_count, 0) + 1 ELSE new_inbound_count END,
          deleted_at = NULL,
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Relational lead_course_interests linking
        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          SELECT id INTO v_resolved_course_id
          FROM public.courses
          WHERE active = true
            AND (
              lower(name) = lower(v_course_interest_val)
              OR lower(code) = lower(v_course_interest_val)
              OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
              OR (lower(v_course_interest_val) LIKE '%zygo%' AND lower(name) LIKE '%zygo%')
              OR (lower(v_course_interest_val) LIKE '%wisdom%' AND lower(name) LIKE '%wisdom%')
              OR (lower(v_course_interest_val) LIKE '%intensiv%' AND lower(name) LIKE '%intensiv%')
              OR (lower(v_course_interest_val) LIKE '%advanced%' AND lower(name) LIKE '%advanced%')
              OR (lower(v_course_interest_val) LIKE '%endo%' AND lower(name) LIKE '%endo%')
              OR (lower(v_course_interest_val) LIKE '%perio%' AND lower(name) LIKE '%perio%')
              OR (lower(v_course_interest_val) LIKE '%rehab%' AND lower(name) LIKE '%rehab%')
            )
          LIMIT 1;

          IF v_resolved_course_id IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM public.lead_course_interests
              WHERE lead_id = v_matched_lead_id AND course_id = v_resolved_course_id
            ) THEN
              SELECT slot INTO v_slot
              FROM unnest(ARRAY[1, 2, 3]) AS slot
              WHERE slot NOT IN (
                SELECT priority FROM public.lead_course_interests
                WHERE lead_id = v_matched_lead_id AND priority IS NOT NULL
              )
              ORDER BY slot ASC
              LIMIT 1;

              INSERT INTO public.lead_course_interests (
                lead_id, course_id, priority, source, status, created_at, updated_at
              ) VALUES (
                v_matched_lead_id,
                v_resolved_course_id,
                v_slot,
                'hubspot',
                'active',
                now(),
                now()
              ) ON CONFLICT (lead_id, course_id) DO NOTHING;
            END IF;
          END IF;
        END IF;

        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        -- Safe integration link
        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
        DO UPDATE SET
          eds_entity_id = EXCLUDED.eds_entity_id,
          updated_at = now();

        -- Record activity only if not already logged by direct path
        IF v_is_form_submission AND NOT v_direct_sub_already_exists THEN
          INSERT INTO public.lead_activities (
            lead_id, activity_type, actor_type, summary, metadata, created_at
          ) VALUES (
            v_matched_lead_id, 'form_submitted', 'system',
            v_activity_summary,
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'source', v_source,
              'source_detail', v_source_detail,
              'course', v_course_interest_val,
              'intent', v_intent,
              'form_name', v_conv_name
            ),
            v_authoritative_ts
          );

          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            v_conv_name,
            'Site',
            v_source_detail,
            v_course_interest_val,
            v_authoritative_ts,
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'properties', v_props,
              'intent', v_intent
            ),
            v_email,
            v_email_confirmation,
            v_email_mismatch,
            v_phone,
            v_contact_pref,
            'processed',
            'none',
            'hs-' || v_contact_id || '-' || extract(epoch from v_authoritative_ts)::text
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        v_processed_count := v_processed_count + 1;

      ELSE
        -- NEW LEAD
        INSERT INTO public.leads (
          source, source_detail,
          first_name, last_name, email, email_confirmation, email_mismatch,
          phone_raw, contact_preference, course_interest, course_interests,
          pipeline_stage_id, hubspot_contact_id, source_created_at,
          last_inbound_activity_at, last_acquisition_at,
          has_new_submission, new_submission_at, new_inbound_count,
          created_at, updated_at
        ) VALUES (
          v_source, v_source_detail,
          COALESCE(v_first_name, 'Lead'), v_last_name, v_email, v_email_confirmation, v_email_mismatch,
          v_phone, v_contact_pref, v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_capture_stage_id, v_contact_id, v_source_created_at,
          v_authoritative_ts, v_authoritative_ts,
          true, v_authoritative_ts, 1,
          COALESCE(v_source_created_at, v_authoritative_ts), now()
        ) RETURNING id INTO v_matched_lead_id;

        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        INSERT INTO public.lead_stage_history (
          lead_id, from_stage_id, to_stage_id, change_reason
        ) VALUES (
          v_matched_lead_id, NULL, v_capture_stage_id, 'initial_hubspot_ingestion'
        );

        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
        DO UPDATE SET
          eds_entity_id = EXCLUDED.eds_entity_id,
          updated_at = now();

        IF v_is_form_submission THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            v_conv_name,
            'Site',
            v_source_detail,
            v_course_interest_val,
            v_authoritative_ts,
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'properties', v_props,
              'intent', v_intent
            ),
            v_email,
            v_email_confirmation,
            v_email_mismatch,
            v_phone,
            v_contact_pref,
            'processed',
            'none',
            'hs-' || v_contact_id || '-' || extract(epoch from v_authoritative_ts)::text
          ) ON CONFLICT (idempotency_key) DO NOTHING;

          INSERT INTO public.lead_activities (
            lead_id, activity_type, actor_type, summary, metadata, created_at
          ) VALUES (
            v_matched_lead_id, 'form_submitted', 'system',
            v_activity_summary,
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'source', v_source,
              'source_detail', v_source_detail,
              'course', v_course_interest_val,
              'intent', v_intent,
              'form_name', v_conv_name
            ),
            v_authoritative_ts
          );
        END IF;

        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          SELECT id INTO v_resolved_course_id
          FROM public.courses
          WHERE active = true
            AND (
              lower(name) = lower(v_course_interest_val)
              OR lower(code) = lower(v_course_interest_val)
              OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
              OR (lower(v_course_interest_val) LIKE '%zygo%' AND lower(name) LIKE '%zygo%')
              OR (lower(v_course_interest_val) LIKE '%wisdom%' AND lower(name) LIKE '%wisdom%')
              OR (lower(v_course_interest_val) LIKE '%intensiv%' AND lower(name) LIKE '%intensiv%')
              OR (lower(v_course_interest_val) LIKE '%advanced%' AND lower(name) LIKE '%advanced%')
              OR (lower(v_course_interest_val) LIKE '%endo%' AND lower(name) LIKE '%endo%')
              OR (lower(v_course_interest_val) LIKE '%perio%' AND lower(name) LIKE '%perio%')
              OR (lower(v_course_interest_val) LIKE '%rehab%' AND lower(name) LIKE '%rehab%')
            )
          LIMIT 1;

          IF v_resolved_course_id IS NOT NULL THEN
            INSERT INTO public.lead_course_interests (
              lead_id, course_id, priority, source, status, created_at, updated_at
            ) VALUES (
              v_matched_lead_id, v_resolved_course_id, 1, 'hubspot', 'active', now(), now()
            ) ON CONFLICT (lead_id, course_id) DO NOTHING;
          END IF;
        END IF;

        v_processed_count := v_processed_count + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Bounded failure isolation: one bad contact never breaks the entire batch
      RAISE WARNING 'Error processing HubSpot contact %: %', v_contact_id, SQLERRM;
      v_ignored_count := v_ignored_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed_count,
    'ignored', v_ignored_count
  );
END;
$$;

-- 5. Updated check_website_sync_health() to observe all three channels
CREATE OR REPLACE FUNCTION public.check_website_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_direct_intake TIMESTAMPTZ;
  v_last_hubspot_reconcile TIMESTAMPTZ;
  v_contact_form_intakes INT := 0;
  v_course_info_intakes INT := 0;
  v_register_intakes INT := 0;
  v_total_website_intakes INT := 0;
  v_unmatched_intakes INT := 0;
  v_unmatched_sync_events INT := 0;
  v_total_anomalies INT := 0;
  v_is_healthy BOOLEAN := true;
  v_status TEXT := 'healthy';
  v_details TEXT := 'All website intake and HubSpot reconciliation channels operational.';
  v_window_start TIMESTAMPTZ := now() - interval '24 hours';
  v_window_end TIMESTAMPTZ := now() - interval '15 minutes';
BEGIN
  -- A. Last successful direct website intake across all 3 forms
  SELECT max(submitted_at) INTO v_last_direct_intake
  FROM public.form_submissions
  WHERE source_detail IN ('contact_form', 'website_registration_form', 'course_information_request')
     OR source IN ('website', 'Site');

  -- Count breakdown
  SELECT count(*) INTO v_contact_form_intakes
  FROM public.form_submissions
  WHERE source_detail = 'contact_form' AND submitted_at >= v_window_start;

  SELECT count(*) INTO v_course_info_intakes
  FROM public.form_submissions
  WHERE source_detail = 'course_information_request' AND submitted_at >= v_window_start;

  SELECT count(*) INTO v_register_intakes
  FROM public.form_submissions
  WHERE source_detail = 'website_registration_form' AND submitted_at >= v_window_start;

  v_total_website_intakes := v_contact_form_intakes + v_course_info_intakes + v_register_intakes;

  -- B. Last successful HubSpot reconcile
  SELECT max(last_reconciliation_at) INTO v_last_hubspot_reconcile
  FROM public.integration_connections
  WHERE provider = 'hubspot';

  -- C1. Unprocessed website intake events older than 15 minutes
  SELECT count(*) INTO v_unmatched_intakes
  FROM public.lead_intake_events
  WHERE source = 'website'
    AND status != 'processed'
    AND received_at >= v_window_start
    AND received_at < v_window_end;

  -- C2. Failed HubSpot sync events older than 15 minutes
  SELECT count(*) INTO v_unmatched_sync_events
  FROM public.integration_sync_events
  WHERE integration = 'hubspot'
    AND status = 'failed'
    AND created_at >= v_window_start
    AND created_at < v_window_end;

  v_total_anomalies := v_unmatched_intakes + v_unmatched_sync_events;

  IF v_total_anomalies > 0 THEN
    v_is_healthy := false;
    v_status := 'sync_anomaly';
    v_details := format('Found %s un-reconciled website item(s) older than 15 minutes (%s intake, %s sync).', 
                        v_total_anomalies, v_unmatched_intakes, v_unmatched_sync_events);
  ELSIF v_last_hubspot_reconcile IS NOT NULL AND v_last_hubspot_reconcile < now() - interval '30 minutes' THEN
    v_is_healthy := false;
    v_status := 'reconcile_stale';
    v_details := 'HubSpot reconciliation has not completed within the last 30 minutes.';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'healthy', v_is_healthy,
    'last_direct_website_intake_at', v_last_direct_intake,
    'last_hubspot_reconcile_at', v_last_hubspot_reconcile,
    'contact_form_intakes_24h', v_contact_form_intakes,
    'course_info_intakes_24h', v_course_info_intakes,
    'register_intakes_24h', v_register_intakes,
    'total_website_intakes_24h', v_total_website_intakes,
    'unmatched_contacts_older_than_15m', v_total_anomalies,
    'details', v_details,
    'checked_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch(JSONB) TO authenticated, service_role;
