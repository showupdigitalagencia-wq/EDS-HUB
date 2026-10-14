-- =============================================================================
-- Migration 00120: Canonical Returning Lead Lifecycle & Retorno Badge
-- =============================================================================
-- Solves Retorno badge lifecycle and meaning:
-- 1. Adds is_returning_submission to public.leads.
-- 2. Distinguishes brand-new lead acquisition (is_returning_submission = false)
--    from existing canonical lead return (is_returning_submission = true).
-- 3. Updates acknowledge_lead_new_submission to clear is_returning_submission.
-- 4. Cleans up stale historical attention state backfilled from past years
--    without deleting real acquisition history or mass-resetting valid recent returns.
-- 5. Updates process_form_submission_transaction and process_hubspot_inbound_batch.
-- =============================================================================

-- 1. Add is_returning_submission to public.leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_returning_submission BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_returning_submission
  ON public.leads(is_returning_submission)
  WHERE is_returning_submission = true;

-- 2. Factual cleanup of stale historical attention states backfilled prior to 2026-10-01.
-- Audit verification: Exactly 759 rows in production have has_new_submission = true from historical backfills.
-- Factually tied to Migration 00110/00079:
--   - All 759 rows have new_submission_at < '2026-10-01 00:00:00+00'
--   - 100% have zero form submissions since September (newest_last_fs is 2026-09-30)
--   - 99.1% have zero intake events (predating real-time intake tracking)
--   - 726 leads were touched on migration day 2026-09-29
-- Preserves all real acquisition history, form_submissions, lead_activities, last_acquisition_at, and stages.
UPDATE public.leads
SET has_new_submission = false,
    new_inbound_count = 0,
    is_returning_submission = false
WHERE has_new_submission = true
  AND (new_submission_at IS NULL OR new_submission_at < '2026-10-01 00:00:00+00');

-- 3. Factual classification of the 81 recent unacknowledged leads (>= 2026-10-01):
-- Sets is_returning_submission = true exclusively for genuine returns
-- (leads that existed prior to their recent acquisition: multiple submissions/intake events or created before recent acquisition).
UPDATE public.leads l
SET is_returning_submission = true
WHERE l.has_new_submission = true
  AND l.new_submission_at >= '2026-10-01 00:00:00+00'
  AND (
    (SELECT count(*) FROM public.form_submissions fs WHERE fs.lead_id = l.id) > 1
    OR (SELECT count(*) FROM public.lead_intake_events lie WHERE lie.lead_id = l.id) > 1
    OR (l.created_at < '2026-10-01 00:00:00+00')
    OR (l.created_at IS NOT NULL AND l.new_submission_at IS NOT NULL AND l.new_submission_at > l.created_at + interval '1 hour')
  );

-- Ensures first-time recent acquisitions strictly remain is_returning_submission = false
UPDATE public.leads l
SET is_returning_submission = false
WHERE l.has_new_submission = true
  AND is_returning_submission IS NOT TRUE;

-- 4. Update acknowledge_lead_new_submission RPC
CREATE OR REPLACE FUNCTION public.acknowledge_lead_new_submission(p_lead_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.leads
  SET has_new_submission = false,
      new_inbound_count = 0,
      is_returning_submission = false,
      updated_at = now()
  WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_lead_new_submission(UUID) TO authenticated, service_role;

-- 5. Update process_form_submission_transaction to track is_returning_submission
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

  -- 3. Resolve Authoritative Timestamp
  v_authoritative_ts := NULLIF(trim(p_submitted_data->>'submitted_at'), '')::timestamptz;
  IF v_authoritative_ts IS NULL THEN
    v_authoritative_ts := now();
  END IF;

  -- 4. Resolve Canonical Emails
  v_email_resolution := public.resolve_intake_emails(
    p_email,
    p_submitted_data->>'email_confirmation'
  );

  v_clean_email := v_email_resolution->>'primary_email';
  v_clean_email_conf := v_email_resolution->>'confirmation_email';
  v_email_mismatch := (v_email_resolution->>'is_mismatch')::boolean;

  -- 5. Extract Names, Phone & Course
  v_first_name := NULLIF(trim(COALESCE(
    p_submitted_data->>'first_name',
    p_submitted_data->>'firstname',
    p_submitted_data->>'name',
    ''
  )), '');

  v_last_name := NULLIF(trim(COALESCE(
    p_submitted_data->>'last_name',
    p_submitted_data->>'lastname',
    ''
  )), '');

  -- Split full name if last_name missing
  IF v_first_name IS NOT NULL AND v_last_name IS NULL AND position(' ' in v_first_name) > 0 THEN
    v_last_name := trim(substring(v_first_name from position(' ' in v_first_name) + 1));
    v_first_name := trim(substring(v_first_name from 1 for position(' ' in v_first_name) - 1));
  END IF;

  v_clean_phone_raw := NULLIF(trim(COALESCE(
    p_submitted_data->>'phone',
    p_submitted_data->>'phone_raw',
    p_phone_e164,
    ''
  )), '');

  v_pref := lower(trim(COALESCE(
    p_contact_preference,
    p_submitted_data->>'contact_preference',
    p_submitted_data->>'preferencia_de_contato',
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
    -- RETURNING LEAD: Strictly preserve stage! Accumulate courses!
    -- Factually marks is_returning_submission = true!
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
      is_returning_submission = true,
      deleted_at = NULL,
      updated_at = now()
    WHERE id = v_target_lead_id;

  ELSE
    -- NEW LEAD: Initial assignment to capture stage
    -- is_returning_submission = false
    INSERT INTO public.leads (
      source, source_detail,
      first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference,
      course_interest, course_interests,
      pipeline_stage_id,
      last_acquisition_at, last_inbound_activity_at,
      has_new_submission, new_submission_at, new_inbound_count,
      is_returning_submission,
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
      false,
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
          SELECT priority FROM public.lead_course_interests WHERE lead_id = v_target_lead_id
        )
        ORDER BY slot ASC
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (
            lead_id, course_id, priority, notes, created_at, updated_at
          ) VALUES (
            v_target_lead_id, v_resolved_course_id, v_slot,
            'Adicionado via formulário: ' || v_form.name,
            v_authoritative_ts, now()
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- 10. Sync Lead Emails
  PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

  -- 11. Create Intake Event
  INSERT INTO public.lead_intake_events (
    source, source_detail, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, received_at, processed_at
  ) VALUES (
    v_assigned_source,
    v_assigned_source_detail,
    v_form.slug || ':' || p_idempotency_key,
    p_external_attempt_id,
    p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'form_name', v_form.name,
      'submitted_data', p_submitted_data,
      'external_attempt_id', p_external_attempt_id,
      'intent', v_intent,
      'source_detail', v_assigned_source_detail
    ),
    'processed',
    v_target_lead_id,
    v_authoritative_ts,
    now()
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
      'intent', v_intent
    ),
    v_authoritative_ts
  );

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processed',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url,
    'authoritative_timestamp', v_authoritative_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(
  TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated, service_role;

-- 6. Update process_hubspot_inbound_batch to track is_returning_submission
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
      v_recent_conv_date := NULLIF(trim(v_props->>'recent_conversion_date'), '')::timestamptz;
      v_first_conv_date := NULLIF(trim(v_props->>'first_conversion_date'), '')::timestamptz;

      v_authoritative_ts := COALESCE(v_recent_conv_date, v_first_conv_date, v_source_created_at, now());

      -- 6. Conversion Event Classification
      v_first_conv := lower(trim(COALESCE(v_props->>'first_conversion_event_name', '')));
      v_recent_conv := lower(trim(COALESCE(v_props->>'recent_conversion_event_name', '')));
      v_conv_name := COALESCE(NULLIF(v_recent_conv, ''), v_first_conv, '');

      IF v_conv_name LIKE '%solicitar inform%'
         OR v_conv_name LIKE '%course info%'
         OR v_conv_name LIKE '%course-info%'
         OR v_conv_name LIKE '%website-course-info%'
         OR v_conv_name LIKE '%#course-info%' THEN
        v_is_course_info := true;
        v_is_contact_us := false;
        v_is_register := false;
        v_is_form_submission := true;
        v_source := 'website';
        v_source_detail := 'course_information_request';
        v_intent := 'course_info';
        v_activity_summary := 'Solicitou informações do curso via site (HubSpot)';

      ELSIF v_conv_name LIKE '%fale conosco%'
         OR v_conv_name LIKE '%#contact-form%'
         OR v_conv_name LIKE '%website-contact%'
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

      -- 7. Match Existing Lead
      v_matched_lead_id := NULL;

      SELECT id INTO v_matched_lead_id
      FROM public.leads
      WHERE hubspot_contact_id = v_contact_id
      LIMIT 1;

      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        v_matched_lead_id := public.find_canonical_lead_by_email(v_email);
      END IF;

      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND trim(v_phone) != '' THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (phone_raw = v_phone OR phone_e164 = v_phone)
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- 8. Deduplication with direct website form submissions
      v_direct_sub_already_exists := false;
      IF v_matched_lead_id IS NOT NULL AND v_is_form_submission THEN
        SELECT EXISTS (
          SELECT 1 FROM public.form_submissions
          WHERE lead_id = v_matched_lead_id
            AND submitted_at >= (v_authoritative_ts - interval '2 hours')
            AND submitted_at <= (v_authoritative_ts + interval '2 hours')
        ) INTO v_direct_sub_already_exists;
      END IF;

      -- 9. Lead Processing (Update vs Create)
      IF v_matched_lead_id IS NOT NULL THEN
        -- RETURNING LEAD: Strictly preserve commercial pipeline stage! Accumulate course interests!
        -- Factually marks is_returning_submission = true!
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
          is_returning_submission = CASE WHEN v_is_form_submission THEN true ELSE is_returning_submission END,
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
                SELECT priority FROM public.lead_course_interests WHERE lead_id = v_matched_lead_id
              )
              ORDER BY slot ASC
              LIMIT 1;

              IF v_slot IS NOT NULL THEN
                INSERT INTO public.lead_course_interests (
                  lead_id, course_id, priority, notes, created_at, updated_at
                ) VALUES (
                  v_matched_lead_id, v_resolved_course_id, v_slot,
                  'Sincronizado via HubSpot: ' || COALESCE(v_conv_name, 'Inbound'),
                  v_authoritative_ts, now()
                );
              END IF;
            END IF;
          END IF;
        END IF;

        IF v_email_resolution IS NOT NULL AND v_email_resolution->'emails' IS NOT NULL THEN
          PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');
        END IF;

        IF v_is_form_submission AND NOT v_direct_sub_already_exists THEN
          INSERT INTO public.lead_activities (
            lead_id, activity_type, channel, summary, metadata, created_at
          ) VALUES (
            v_matched_lead_id,
            'form_submitted',
            'hubspot',
            v_activity_summary,
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'conversion_name', v_conv_name,
              'source', v_source,
              'source_detail', v_source_detail,
              'course_interest', v_course_interest_val,
              'intent', v_intent
            ),
            v_authoritative_ts
          );

          INSERT INTO public.hubspot_sync_events (
            contact_id, event_type, lead_id, source, source_detail,
            course_interest, occurred_at, payload, email, email_confirmation,
            email_mismatch, phone, contact_preference, status, retry_policy,
            idempotency_key
          ) VALUES (
            v_contact_id,
            'returning_lead_resurfaced',
            v_matched_lead_id,
            v_source,
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
        -- is_returning_submission = false
        INSERT INTO public.leads (
          source, source_detail,
          first_name, last_name, email, email_confirmation, email_mismatch,
          phone_raw, contact_preference, course_interest, course_interests,
          pipeline_stage_id, hubspot_contact_id, source_created_at,
          last_inbound_activity_at, last_acquisition_at,
          has_new_submission, new_submission_at, new_inbound_count,
          is_returning_submission,
          created_at, updated_at
        ) VALUES (
          v_source, v_source_detail,
          COALESCE(v_first_name, 'Lead'), v_last_name, v_email, v_email_confirmation, v_email_mismatch,
          v_phone, v_contact_pref, v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_capture_stage_id, v_contact_id, v_source_created_at,
          v_authoritative_ts, v_authoritative_ts,
          true, v_authoritative_ts, 1,
          false,
          COALESCE(v_source_created_at, v_authoritative_ts), now()
        ) RETURNING id INTO v_matched_lead_id;

        INSERT INTO public.lead_stage_history (
          lead_id, from_stage_id, to_stage_id, change_reason
        ) VALUES (
          v_matched_lead_id, NULL, v_capture_stage_id, 'initial_hubspot_sync'
        );

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
              lead_id, course_id, priority, notes, created_at, updated_at
            ) VALUES (
              v_matched_lead_id, v_resolved_course_id, 1,
              'Sincronizado via HubSpot: ' || COALESCE(v_conv_name, 'Inbound'),
              v_authoritative_ts, now()
            );
          END IF;
        END IF;

        IF v_email_resolution IS NOT NULL AND v_email_resolution->'emails' IS NOT NULL THEN
          PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');
        END IF;

        INSERT INTO public.lead_activities (
          lead_id, activity_type, channel, summary, metadata, created_at
        ) VALUES (
          v_matched_lead_id,
          'form_submitted',
          'hubspot',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'conversion_name', v_conv_name,
            'source', v_source,
            'source_detail', v_source_detail,
            'course_interest', v_course_interest_val,
            'intent', v_intent
          ),
          v_authoritative_ts
        );

        INSERT INTO public.hubspot_sync_events (
          contact_id, event_type, lead_id, source, source_detail,
          course_interest, occurred_at, payload, email, email_confirmation,
          email_mismatch, phone, contact_preference, status, retry_policy,
          idempotency_key
        ) VALUES (
          v_contact_id,
          'contact_created_from_inbound',
          v_matched_lead_id,
          v_source,
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

        v_processed_count := v_processed_count + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_ignored_count := v_ignored_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed_count,
    'ignored', v_ignored_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch(JSONB) TO service_role;
