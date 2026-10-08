-- =============================================================================
-- Migration 00112: Global Standardized Turma Catalog, Label-Only Sessions,
--                  and Website Direct Intake Hardening
-- =============================================================================
-- 1. Adds custom_turma_options TEXT[] to public.app_settings for persistence of
--    user-created human-readable cohort labels (e.g. via 'Outras') without requiring
--    code deployments.
-- 2. Creates RPC public.save_custom_turma_option(p_label TEXT) to atomically
--    persist custom turma labels to the global catalog.
-- 3. Supports pure label-only course_sessions:
--    - Alters course_sessions start_date and end_date to be NULLABLE.
--    - Updates chk_course_sessions_dates to allow NULL dates.
--    - Replaces ensure_course_session_for_label to NEVER fabricate fake/approximate
--      dates; new simplified sessions have start_date = NULL and end_date = NULL.
-- 4. Updates process_form_submission_transaction:
--    - Restores soft-deleted leads (deleted_at = NULL) upon returning form submission.
--    - Matches leads across both active and soft-deleted records so returning leads
--      properly resurface at the top of their current stage rather than remaining invisible.
--    - Aligns website-contact and website-register with canonical 'website' source.
-- 5. Updates check_website_sync_health():
--    - Evaluates form_submissions processing_status = 'failed'.
--    - Flags any website lead submissions where the lead is soft-deleted.
--    - Checks last successful direct intake where processing_status = 'processed'.
-- 6. Reconciles production incident state:
--    - Restores soft-deleted lead 265c081e-36c6-40aa-b474-204b064d2e40 to deleted_at = NULL.
--    - Sets form_submission 481cd541-7287-481d-b1ab-711f36fd0339 to processed.
-- =============================================================================

-- 1. Extend app_settings with custom_turma_options
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS custom_turma_options TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.app_settings.custom_turma_options IS
  'Standardized human-readable turma/cohort labels created dynamically by users (e.g. Jan/28). Available globally across all courses.';

-- 2. Atomic RPC to persist custom turma options
CREATE OR REPLACE FUNCTION public.save_custom_turma_option(p_label TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trimmed TEXT := trim(p_label);
  v_current TEXT[];
BEGIN
  IF v_trimmed IS NULL OR v_trimmed = '' THEN
    RAISE EXCEPTION 'Turma label cannot be empty';
  END IF;

  SELECT COALESCE(custom_turma_options, '{}'::TEXT[]) INTO v_current
  FROM public.app_settings
  LIMIT 1;

  IF NOT (v_current @> ARRAY[v_trimmed]) THEN
    UPDATE public.app_settings
    SET custom_turma_options = array_append(v_current, v_trimmed),
        updated_at = now()
    WHERE singleton_key = 1;
    v_current := array_append(v_current, v_trimmed);
  END IF;

  RETURN v_current;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_custom_turma_option(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_custom_turma_option(TEXT) TO authenticated, service_role;

-- 3. Label-only course_sessions: Support nullable dates without fabricating factual dates
ALTER TABLE public.course_sessions ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE public.course_sessions ALTER COLUMN end_date DROP NOT NULL;

ALTER TABLE public.course_sessions DROP CONSTRAINT IF EXISTS chk_course_sessions_dates;
ALTER TABLE public.course_sessions ADD CONSTRAINT chk_course_sessions_dates
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);

-- Helper to find or create a course session for a given course and human-readable turma label
CREATE OR REPLACE FUNCTION public.ensure_course_session_for_label(
  p_course_id UUID,
  p_turma_label TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id UUID;
  v_course RECORD;
  v_trimmed TEXT := trim(p_turma_label);
  v_code TEXT;
  v_clean_tag TEXT;
BEGIN
  IF v_trimmed IS NULL OR v_trimmed = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Check if matching session already exists for this course
  SELECT id INTO v_existing_id
  FROM public.course_sessions
  WHERE course_id = p_course_id
    AND lower(trim(title)) = lower(v_trimmed)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- 2. Fetch course code
  SELECT id, code, name INTO v_course
  FROM public.courses
  WHERE id = p_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course % not found', p_course_id;
  END IF;

  -- 3. Label-only cohorts: NEVER fabricate exact dates. Keep start_date and end_date NULL.
  -- 4. Generate unique session code
  v_clean_tag := upper(regexp_replace(v_trimmed, '[^a-zA-Z0-9]', '', 'g'));
  v_code := COALESCE(v_course.code, 'TURMA') || '-' || v_clean_tag;

  -- Ensure code uniqueness
  IF EXISTS (SELECT 1 FROM public.course_sessions WHERE code = v_code) THEN
    v_code := v_code || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  -- 5. Insert new course session with exact human-readable label in title and NULL dates
  INSERT INTO public.course_sessions (
    course_id, code, title, status, start_date, end_date, timezone, location, created_by_user_id
  ) VALUES (
    p_course_id, v_code, v_trimmed, 'open', NULL, NULL, 'America/New_York', 'Orlando, FL', auth.uid()
  ) RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_course_session_for_label(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ensure_course_session_for_label(UUID, TEXT) TO authenticated, service_role;

-- 4. Update process_form_submission_transaction to restore soft-deleted leads and align website sources
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

  -- 4. Canonical Multi-Email Resolution
  v_email_resolution := public.resolve_lead_emails(p_submitted_data, 'form');
  v_clean_email := v_email_resolution->>'primary_email';
  v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

  IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
    v_clean_email_conf := v_email_resolution->'emails'->1->>'normalized_email';
  ELSE
    v_clean_email_conf := v_clean_email;
  END IF;

  -- Check existing lead by primary email or lead_emails (prioritizing active leads)
  v_lead_by_email := NULL;
  IF v_clean_email IS NOT NULL AND v_clean_email != '' THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE lower(email) = v_clean_email
    ORDER BY (CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END), created_at ASC
    LIMIT 1;

    IF v_lead_by_email IS NULL THEN
      SELECT lead_id INTO v_lead_by_email
      FROM public.lead_emails
      WHERE normalized_email = v_clean_email
      LIMIT 1;
    END IF;
  END IF;

  -- Check existing lead by phone
  v_lead_by_phone := NULL;
  IF p_phone_e164 IS NOT NULL AND p_phone_e164 != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = p_phone_e164
    ORDER BY (CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END), created_at ASC
    LIMIT 1;
  END IF;

  -- Deduplication / Target resolution
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);

  -- 5. Prepare Lead Attributes
  v_clean_phone_raw := NULLIF(trim(COALESCE(p_submitted_data->>'phone', p_submitted_data->>'phone_raw', '')), '');
  v_first_name := NULLIF(trim(COALESCE(p_submitted_data->>'first_name', p_submitted_data->>'firstname', p_submitted_data->>'name', 'Lead')), '');
  v_last_name := NULLIF(trim(COALESCE(p_submitted_data->>'last_name', p_submitted_data->>'lastname', '')), '');

  v_pref := lower(NULLIF(trim(COALESCE(p_contact_preference, p_submitted_data->>'contact_preference', 'email')), ''));
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := 'email';
  END IF;

  v_clean_course := NULLIF(trim(COALESCE(p_course_interest, p_submitted_data->>'course_interest', p_submitted_data->>'course', '')), '');

  -- 6. Intent Classification
  IF v_form.slug IN ('contact', 'contact-form', 'fale-conosco', 'course-info', 'course-information', 'website-contact')
     OR v_form.name ILIKE '%course info%'
     OR v_form.name ILIKE '%request course information%'
     OR v_form.name ILIKE '%contact%'
     OR v_form.source_detail = 'contact_form' THEN
    v_assigned_source := 'website';
    v_assigned_source_detail := 'contact_form';
    IF v_clean_course IS NOT NULL AND v_clean_course != '' THEN
      v_intent := 'COURSE_INFORMATION_REQUEST';
      v_activity_summary := 'Solicitou informações sobre ' || v_clean_course;
    ELSE
      v_intent := 'GENERAL_CONTACT';
      v_activity_summary := 'Entrou em contato pelo formulário do site';
    END IF;
  ELSIF v_form.slug IN ('registration', 'matricula', 'checkout', 'website-register') OR v_form.source_detail = 'website_registration_form' THEN
    v_assigned_source := 'website';
    v_assigned_source_detail := 'website_registration_form';
    v_intent := 'COMPLETED_ENROLLMENT';
    v_activity_summary := 'Inscrição concluída no site: ' || COALESCE(v_clean_course, 'Curso');
  ELSE
    v_assigned_source := 'website';
    v_assigned_source_detail := COALESCE(v_form.source_detail, 'website');
    v_intent := 'UNKNOWN';
    v_activity_summary := 'Formulário recebido: ' || v_form.name;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage (Novo Lead / Capture)
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_acquisition_at, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      v_assigned_source, v_assigned_source_detail, v_first_name, v_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
      v_clean_phone_raw, p_phone_e164,
      v_pref, v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL THEN jsonb_build_array(v_clean_course) ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, v_authoritative_ts, v_authoritative_ts,
      false, NULL, v_authoritative_ts, now()
    ) RETURNING id INTO v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_assignment'
    );

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata, created_at
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      v_activity_summary,
      jsonb_build_object(
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'form_name', v_form.name,
        'source', v_assigned_source,
        'source_detail', v_assigned_source_detail,
        'course', v_clean_course,
        'intent', v_intent,
        'message', p_submitted_data->>'message'
      ),
      v_authoritative_ts
    );
  ELSE
    -- REPEAT SUBMISSION: Update existing lead, resurface card to TOP of current stage via Authoritative Timestamp!
    -- Strictly preserve original created_at and pipeline stage.
    -- RESTORE SOFT-DELETED LEADS (deleted_at = NULL) so returning leads immediately resurface!
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_course_interest;

    IF v_clean_course IS NOT NULL AND v_clean_course != '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
        WHERE lower(trim(elem)) = lower(trim(v_clean_course))
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
      END IF;

      IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
        v_merged_course_interest := v_clean_course;
      END IF;
    END IF;

    UPDATE public.leads
    SET
      deleted_at = NULL, -- Clear soft delete so lead is visible in all views
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      contact_preference = COALESCE(v_pref, contact_preference),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_acquisition_at = v_authoritative_ts,
      last_inbound_activity_at = v_authoritative_ts,
      has_new_submission = true,
      new_submission_at = v_authoritative_ts,
      updated_at = now()
    WHERE id = v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata, created_at
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      v_activity_summary,
      jsonb_build_object(
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'form_name', v_form.name,
        'source', v_assigned_source,
        'source_detail', v_assigned_source_detail,
        'course', v_clean_course,
        'intent', v_intent,
        'message', p_submitted_data->>'message'
      ),
      v_authoritative_ts
    );
  END IF;

  -- 7. Register Intake Event & Form Submission
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, received_at, processed_at
  ) VALUES (
    v_assigned_source, v_form.slug || ':' || p_idempotency_key, p_external_attempt_id, p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'email', v_clean_email,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'phone', p_phone_e164,
      'course_interest', v_clean_course,
      'intent', v_intent
    ),
    'processed', v_target_lead_id, v_authoritative_ts, now()
  ) RETURNING id INTO v_intake_event_id;

  INSERT INTO public.form_submissions (
    form_id, form_name, source, source_detail, course_interest,
    submitted_at, submitted_data, processed_at, lead_id,
    intake_event_id, idempotency_key, email, email_confirmation,
    email_mismatch, phone_e164, processing_status, recovery_state
  ) VALUES (
    v_form.id, v_form.name, v_assigned_source, v_assigned_source_detail, v_clean_course,
    v_authoritative_ts, p_submitted_data, now(), v_target_lead_id,
    v_intake_event_id, p_idempotency_key, v_clean_email, v_clean_email_conf,
    v_email_mismatch, p_phone_e164, 'processed', 'none'
  ) RETURNING id INTO v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processed',
    'last_acquisition_at', v_authoritative_ts,
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 5. Update check_website_sync_health to detect failed submissions, deleted leads, and reconcile lags
CREATE OR REPLACE FUNCTION public.check_website_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_direct_intake TIMESTAMPTZ;
  v_last_hubspot_reconcile TIMESTAMPTZ;
  v_unmatched_intakes INT := 0;
  v_unmatched_sync_events INT := 0;
  v_failed_form_submissions INT := 0;
  v_soft_deleted_website_leads INT := 0;
  v_total_anomalies INT := 0;
  v_is_healthy BOOLEAN := true;
  v_status TEXT := 'healthy';
  v_details TEXT := 'All website intake and HubSpot reconciliation channels operational.';
  v_window_start TIMESTAMPTZ := now() - interval '24 hours';
  v_window_end TIMESTAMPTZ := now() - interval '15 minutes';
BEGIN
  -- A. Last successful direct website intake (must be 'processed')
  SELECT max(submitted_at) INTO v_last_direct_intake
  FROM public.form_submissions
  WHERE (source_detail IN ('contact_form', 'website_registration_form') OR source IN ('website', 'Site'))
    AND processing_status = 'processed';

  -- B. Last successful HubSpot reconcile
  SELECT max(last_reconciliation_at) INTO v_last_hubspot_reconcile
  FROM public.integration_connections
  WHERE provider = 'hubspot';

  -- C1. Website intake events in EDS HUB not processed after >15 minutes (within last 24h)
  SELECT count(*) INTO v_unmatched_intakes
  FROM public.lead_intake_events
  WHERE source = 'website'
    AND status != 'processed'
    AND received_at >= v_window_start
    AND received_at < v_window_end;

  -- C2. Website form submissions that failed processing (within last 24h)
  SELECT count(*) INTO v_failed_form_submissions
  FROM public.form_submissions
  WHERE (source = 'website' OR source_detail IN ('contact_form', 'website_registration_form'))
    AND processing_status = 'failed'
    AND submitted_at >= v_window_start;

  -- C3. Website form submissions attached to a soft-deleted lead (within last 24h)
  SELECT count(*) INTO v_soft_deleted_website_leads
  FROM public.form_submissions fs
  JOIN public.leads l ON l.id = fs.lead_id
  WHERE (fs.source = 'website' OR fs.source_detail IN ('contact_form', 'website_registration_form'))
    AND l.deleted_at IS NOT NULL
    AND fs.submitted_at >= v_window_start;

  -- C4. Website sync events with HubSpot older than 15 minutes that failed (within last 24h)
  SELECT count(*) INTO v_unmatched_sync_events
  FROM public.integration_sync_events
  WHERE integration = 'hubspot'
    AND status = 'failed'
    AND created_at >= v_window_start
    AND created_at < v_window_end;

  v_total_anomalies := v_unmatched_intakes + v_failed_form_submissions + v_soft_deleted_website_leads + v_unmatched_sync_events;

  IF v_total_anomalies > 0 THEN
    v_is_healthy := false;
    v_status := 'sync_anomaly';
    v_details := format('Found %s un-reconciled website item(s) (%s failed submissions, %s soft-deleted leads, %s pending intakes, %s failed sync).', 
                        v_total_anomalies, v_failed_form_submissions, v_soft_deleted_website_leads, v_unmatched_intakes, v_unmatched_sync_events);
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
    'total_anomalies', v_total_anomalies,
    'failed_form_submissions', v_failed_form_submissions,
    'soft_deleted_website_leads', v_soft_deleted_website_leads,
    'unprocessed_intakes', v_unmatched_intakes,
    'failed_sync_events', v_unmatched_sync_events,
    'details', v_details,
    'checked_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_website_sync_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_website_sync_health() TO authenticated, service_role;

-- 6. Self-heal the production incident lead and submission
UPDATE public.leads
SET deleted_at = NULL,
    updated_at = now()
WHERE id = '265c081e-36c6-40aa-b474-204b064d2e40' AND deleted_at IS NOT NULL;

UPDATE public.form_submissions
SET processing_status = 'processed',
    processing_error = NULL,
    processed_at = now()
WHERE id = '481cd541-7287-481d-b1ab-711f36fd0339';
