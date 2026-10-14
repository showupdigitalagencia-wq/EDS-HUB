-- =============================================================================
-- Migration 00113: Inbound Queue, Reschedule Task Fix, Turma UUID Hardening & Recovery
-- =============================================================================
-- Solves 4 core production issues:
-- 1. Returning leads & Global Attention Queue:
--    - Adds new_inbound_count to public.leads.
--    - Global attention queue tracks all leads with has_new_submission = true.
--    - Preserves commercial stage strictly on return.
--    - Updates acknowledge_lead_new_submission to clear unread state.
-- 2. Task Reschedule:
--    - Removes non-existent actor_id column insert on public.lead_activities
--      in reschedule_crm_task and complete_crm_task.
--    - Tracks actor in metadata->'user_id' / metadata->'actor_id' canonically.
-- 3. Turma Catalog & Session Reuse:
--    - Prevents UUIDs from being stored in app_settings.custom_turma_options.
--    - Hardens ensure_course_session_for_label to resolve existing session by UUID
--      or human title and NEVER create a session titled with a UUID.
--    - Ensures strict session reuse by course_id + exact normalized human label.
--    - Safely remaps and cleans existing UUID junk without orphaning enrollments.
-- 4. Website Contact Us & Soft-Deleted Recovery:
--    - Sets has_new_submission = true and new_inbound_count = 1 on new website submissions.
--    - Restores soft-deleted leads upon new inbound form submissions in HubSpot sync.
-- =============================================================================

-- 1. Add new_inbound_count column to public.leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS new_inbound_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_new_inbound_queue
  ON public.leads(has_new_submission, last_acquisition_at DESC)
  WHERE has_new_submission = true;

-- Backfill any existing unacknowledged submission with count 1
UPDATE public.leads
SET new_inbound_count = 1
WHERE has_new_submission = true AND (new_inbound_count IS NULL OR new_inbound_count = 0);

-- 2. Update acknowledge_lead_new_submission RPC
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
      updated_at = now()
  WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_lead_new_submission(UUID) TO authenticated, service_role;

-- 3. Fix Task Reschedule & Complete RPCs (Issue 2)
-- Remove non-existent actor_id from lead_activities insert. Store user_id in metadata.
CREATE OR REPLACE FUNCTION public.reschedule_crm_task(
  p_task_id UUID,
  p_new_due_at TIMESTAMPTZ,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_old_due_at TIMESTAMPTZ;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  v_old_due_at := v_task.due_at;

  UPDATE public.tasks
  SET
    due_at = p_new_due_at,
    updated_at = now()
  WHERE id = p_task_id;

  -- Audit log activity: omit actor_id column; canonical actor is in metadata
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    v_task.lead_id,
    'task_rescheduled',
    'user',
    'Task rescheduled: "' || v_task.title || '" to ' || COALESCE(p_new_due_at::text, 'no due date'),
    jsonb_build_object(
      'task_id', p_task_id,
      'old_due_at', v_old_due_at,
      'new_due_at', p_new_due_at,
      'reason', p_reason,
      'user_id', auth.uid(),
      'actor_id', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'old_due_at', v_old_due_at,
    'new_due_at', p_new_due_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_crm_task(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_crm_task(
  p_task_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Idempotency check
  IF v_task.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'already_completed', true
    );
  END IF;

  UPDATE public.tasks
  SET
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  WHERE id = p_task_id;

  -- Audit log activity: omit actor_id column; canonical actor is in metadata
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    v_task.lead_id,
    'task_completed',
    'user',
    'Task completed: ' || v_task.title,
    jsonb_build_object(
      'task_id', p_task_id,
      'notes', p_notes,
      'idempotency_key', p_idempotency_key,
      'user_id', auth.uid(),
      'actor_id', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'already_completed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_crm_task(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 4. Turma Catalog & Session Reuse Functions (Issue 3)
DROP FUNCTION IF EXISTS public.save_custom_turma_option(TEXT);
CREATE OR REPLACE FUNCTION public.save_custom_turma_option(p_label TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trimmed TEXT := trim(p_label);
  v_current JSONB;
  v_updated JSONB;
BEGIN
  IF v_trimmed IS NULL OR v_trimmed = '' OR v_trimmed = 'Outras' THEN
    SELECT COALESCE(custom_turma_options, '[]'::jsonb) INTO v_current
    FROM public.app_settings WHERE singleton_key = 1;
    RETURN v_current;
  END IF;

  -- Strictly reject UUIDs from ever entering the global custom turma options catalog
  IF v_trimmed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT COALESCE(custom_turma_options, '[]'::jsonb) INTO v_current
    FROM public.app_settings WHERE singleton_key = 1;
    RETURN v_current;
  END IF;

  SELECT COALESCE(custom_turma_options, '[]'::jsonb) INTO v_current
  FROM public.app_settings WHERE singleton_key = 1;

  IF v_current IS NULL THEN
    v_current := '[]'::jsonb;
  END IF;

  -- Filter out any existing UUID junk from current array
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_current
  FROM jsonb_array_elements_text(v_current) elem
  WHERE elem !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_current) elem
    WHERE lower(trim(elem)) = lower(v_trimmed)
  ) THEN
    v_updated := v_current || jsonb_build_array(v_trimmed);
    UPDATE public.app_settings
    SET custom_turma_options = v_updated,
        updated_at = now()
    WHERE singleton_key = 1;
    RETURN v_updated;
  END IF;

  RETURN v_current;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_custom_turma_option(TEXT) TO authenticated, service_role;

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

  -- If passed a UUID, resolve directly against existing course_sessions
  IF v_trimmed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_existing_id
    FROM public.course_sessions
    WHERE id = v_trimmed::UUID;

    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;

    -- Never insert a session whose title is a UUID!
    RAISE EXCEPTION 'Invalid turma label: UUID % is not a valid session identifier', v_trimmed;
  END IF;

  -- 1. Check if matching session already exists for this course by exact human label
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
  v_clean_tag := upper(regexp_replace(v_trimmed, '[^a-zA-Z0-9]', '', 'g'));
  IF v_clean_tag = '' THEN
    v_clean_tag := 'TURMA';
  END IF;
  v_code := COALESCE(v_course.code, 'CS') || '-' || v_clean_tag;

  -- Ensure code uniqueness
  IF EXISTS (SELECT 1 FROM public.course_sessions WHERE code = v_code) THEN
    v_code := v_code || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  -- 4. Insert new course session with exact human-readable label in title and NULL dates
  INSERT INTO public.course_sessions (
    course_id, code, title, status, start_date, end_date, timezone, location, created_by_user_id
  ) VALUES (
    p_course_id, v_code, v_trimmed, 'open', NULL, NULL, 'America/New_York', 'Orlando, FL', auth.uid()
  ) RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_course_session_for_label(UUID, TEXT) TO authenticated, service_role;

-- 5. Data remediation: Clean existing UUID junk safely (Issue 3)
DO $$
DECLARE
  v_curr JSONB;
  v_clean JSONB;
  r RECORD;
  v_target_session_id UUID;
BEGIN
  -- 5a. Clean app_settings.custom_turma_options
  SELECT custom_turma_options INTO v_curr FROM public.app_settings WHERE singleton_key = 1;
  IF v_curr IS NOT NULL AND jsonb_typeof(v_curr) = 'array' THEN
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_clean
    FROM jsonb_array_elements_text(v_curr) elem
    WHERE elem !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND elem != 'Outras';

    UPDATE public.app_settings
    SET custom_turma_options = v_clean
    WHERE singleton_key = 1;
  END IF;

  -- 5b. Remap and clean course_sessions where title is a UUID
  FOR r IN
    SELECT id, course_id, code, title
    FROM public.course_sessions
    WHERE title ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  LOOP
    -- Check if a legitimate session exists for the same course with human title
    SELECT id INTO v_target_session_id
    FROM public.course_sessions
    WHERE course_id = r.course_id
      AND id <> r.id
      AND title !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_target_session_id IS NOT NULL THEN
      -- Remap enrollments and course interests to avoid orphaning
      UPDATE public.enrollments
      SET course_session_id = v_target_session_id
      WHERE course_session_id = r.id;

      UPDATE public.lead_course_interests
      SET course_session_id = v_target_session_id
      WHERE course_session_id = r.id;

      UPDATE public.course_sessions
      SET title = 'Turma Arquivada (' || COALESCE(r.code, 'Dup') || ')',
          status = 'cancelled'
      WHERE id = r.id;
    ELSE
      -- No legitimate session exists; fix the title to a human-readable title
      UPDATE public.course_sessions
      SET title = 'Turma ' || COALESCE(r.code, 'Geral')
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

-- 6. Update process_form_submission_transaction (Issues 1 & 4)
CREATE OR REPLACE FUNCTION public.process_form_submission_transaction(
  p_form_slug TEXT,
  p_submitted_data JSONB,
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_email_confirmation TEXT,
  p_phone_raw TEXT,
  p_phone_e164 TEXT,
  p_contact_preference TEXT,
  p_course_interest TEXT,
  p_form_source TEXT DEFAULT NULL,
  p_form_source_detail TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_form RECORD;
  v_authoritative_ts TIMESTAMPTZ := now();
  v_assigned_source TEXT;
  v_assigned_source_detail TEXT;
  v_intent TEXT;
  v_activity_summary TEXT;
  v_target_lead_id UUID;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_email_resolution JSONB;
  v_clean_email TEXT;
  v_clean_email_conf TEXT;
  v_email_mismatch BOOLEAN;
  v_pref TEXT;
  v_clean_course TEXT;
  v_clean_phone_raw TEXT;
BEGIN
  -- 1. Validate Form Definition
  SELECT id, slug, name, default_pipeline_stage_id, default_source, default_source_detail
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug AND status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Form % not found or not published', p_form_slug;
  END IF;

  -- 2. Resolve Multi-Email Canonical Logic
  v_email_resolution := public.resolve_intake_emails(p_email, p_email_confirmation);
  v_clean_email := v_email_resolution->>'primary_email';
  v_clean_email_conf := v_email_resolution->>'confirmation_email';
  v_email_mismatch := (v_email_resolution->>'is_mismatch')::boolean;

  -- 3. Source & Intent Classification
  v_assigned_source := 'website';
  IF p_form_source IS NOT NULL AND lower(trim(p_form_source)) IN ('meta', 'meta lead ads', 'instagram', 'facebook') THEN
    v_assigned_source := 'meta';
  END IF;

  IF p_form_source_detail IS NOT NULL AND trim(p_form_source_detail) != '' THEN
    v_assigned_source_detail := trim(p_form_source_detail);
  ELSIF v_form.slug = 'contact' THEN
    v_assigned_source_detail := 'Website Contact Us Form';
  ELSIF v_form.slug = 'course-info' THEN
    v_assigned_source_detail := 'Website Course Info Modal';
  ELSE
    v_assigned_source_detail := COALESCE(v_form.default_source_detail, v_form.name);
  END IF;

  IF v_form.slug = 'contact' THEN
    v_intent := 'contact_request';
    v_activity_summary := 'Mensagem enviada via formulário Fale Conosco';
  ELSE
    v_intent := 'course_info';
    v_activity_summary := 'Interesse registrado via formulário ' || v_form.name;
  END IF;

  v_pref := COALESCE(NULLIF(trim(p_contact_preference), ''), 'email');
  v_clean_course := NULLIF(trim(p_course_interest), '');
  v_clean_phone_raw := NULLIF(trim(p_phone_raw), '');

  -- 4. Deduplication
  IF v_clean_email IS NOT NULL THEN
    v_target_lead_id := public.find_canonical_lead_by_email(v_clean_email);
  END IF;

  IF v_target_lead_id IS NULL AND p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_target_lead_id
    FROM public.leads
    WHERE phone_e164 = p_phone_e164
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage (Novo Lead / Capture)
    -- Marked as new inbound acquisition (has_new_submission = true, new_inbound_count = 1)
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_acquisition_at, last_inbound_activity_at,
      has_new_submission, new_submission_at, new_inbound_count, created_at, updated_at
    ) VALUES (
      v_assigned_source, v_assigned_source_detail, p_first_name, p_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
      v_clean_phone_raw, p_phone_e164,
      v_pref, v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL THEN jsonb_build_array(v_clean_course) ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, v_authoritative_ts, v_authoritative_ts,
      true, v_authoritative_ts, 1, v_authoritative_ts, now()
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
      archived = false,
      first_name = COALESCE(p_first_name, first_name),
      last_name = COALESCE(p_last_name, last_name),
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
      new_inbound_count = COALESCE(new_inbound_count, 0) + 1,
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

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_target_lead_id,
    'authoritative_timestamp', v_authoritative_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 7. Update process_hubspot_inbound_batch (Issue 4 - Soft Delete Recovery & Inbound Count)
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
  v_is_course_info BOOLEAN;
  v_is_form_submission BOOLEAN;
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

      -- 3. Source & Attribution
      v_source := lower(trim(COALESCE(v_props->>'hs_analytics_source', 'other')));
      IF v_source LIKE '%paid_search%' OR v_source LIKE '%google%' THEN
        v_source := 'google';
      ELSIF v_source LIKE '%paid_social%' OR v_source LIKE '%facebook%' OR v_source LIKE '%instagram%' OR v_source LIKE '%meta%' THEN
        v_source := 'meta';
      ELSIF v_source LIKE '%organic%' OR v_source LIKE '%referral%' OR v_source LIKE '%direct%' THEN
        v_source := 'website';
      ELSE
        v_source := 'website';
      END IF;

      v_source_detail := NULLIF(trim(COALESCE(
        v_props->>'hs_analytics_source_data_1',
        v_props->>'hs_analytics_source_data_2',
        v_props->>'utm_campaign',
        v_props->>'utm_source',
        ''
      )), '');

      -- 4. Course Interest
      v_course_interest_raw := NULLIF(trim(COALESCE(
        v_props->>'course_interest',
        v_props->>'curso_de_interesse',
        v_props->>'what_course_are_you_interested_in_',
        v_props->>'curso',
        ''
      )), '');

      v_course_interest_val := v_course_interest_raw;

      -- 5. Contact Preference
      v_contact_pref := lower(trim(COALESCE(v_props->>'contact_preference', v_props->>'preferencia_de_contato', '')));
      IF v_contact_pref NOT IN ('email', 'sms', 'phone', 'whatsapp') THEN
        v_contact_pref := 'email';
      END IF;

      -- 6. Authoritative Timestamps
      v_source_created_at := NULLIF(trim(v_props->>'createdate'), '')::timestamptz;
      v_first_conv_date := NULLIF(trim(v_props->>'first_conversion_date'), '')::timestamptz;
      v_recent_conv_date := NULLIF(trim(v_props->>'recent_conversion_date'), '')::timestamptz;

      v_authoritative_ts := GREATEST(
        COALESCE(v_recent_conv_date, '-infinity'::timestamptz),
        COALESCE(v_first_conv_date, '-infinity'::timestamptz),
        COALESCE(v_source_created_at, '-infinity'::timestamptz),
        now()
      );

      -- 7. Form conversion event detection
      v_first_conv := lower(trim(COALESCE(v_props->>'first_conversion_event_name', '')));
      v_recent_conv := lower(trim(COALESCE(v_props->>'recent_conversion_event_name', '')));

      v_is_course_info := (
        v_first_conv LIKE '%course%' OR v_first_conv LIKE '%curso%'
        OR v_recent_conv LIKE '%course%' OR v_recent_conv LIKE '%curso%'
      );

      v_is_form_submission := (v_first_conv != '' OR v_recent_conv != '');

      IF v_is_course_info THEN
        v_intent := 'course_info';
        v_activity_summary := 'Interesse em curso via formulário HubSpot';
      ELSIF v_is_form_submission THEN
        v_intent := 'form_submission';
        v_activity_summary := 'Formulário HubSpot preenchido';
      ELSE
        v_intent := 'contact_sync';
        v_activity_summary := 'Contato sincronizado do HubSpot';
      END IF;

      -- 8. Deduplication / Canonical Lead Matching
      v_matched_lead_id := NULL;

      -- 8a. Match by integration_entity_links
      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      -- 8b. Match by leads.hubspot_contact_id
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- 8c. Match by primary or confirmation email
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

      -- 8d. Match by normalized phone
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
           OR regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') LIKE '%' || substring(v_phone from length(v_phone) - 7))
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- 8e. Soft-Deleted Lead Recovery Check (Anti-resurrection vs genuine new inbound submission)
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(email) = v_email))
          AND deleted_at IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_matched_lead_id IS NOT NULL THEN
          -- If this contact has an active form conversion event, un-delete and restore!
          IF v_is_form_submission OR v_is_course_info THEN
            UPDATE public.leads
            SET deleted_at = NULL,
                archived = false,
                updated_at = now()
            WHERE id = v_matched_lead_id;
          ELSE
            -- Pure background sync of deleted lead without new submission: ignore
            v_ignored_count := v_ignored_count + 1;
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- 9. Lead Processing (Update vs Create)
      IF v_matched_lead_id IS NOT NULL THEN
        -- UPDATE RETURNING LEAD: Strictly preserve stage! Accumulate courses! Advance acquisition!
        SELECT course_interest, course_interests
        INTO v_existing_lead_course, v_existing_course_interests
        FROM public.leads
        WHERE id = v_matched_lead_id;

        -- Accumulate course_interests JSONB
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

        -- Accumulate course_interest string
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
          has_new_submission = true,
          new_submission_at = GREATEST(COALESCE(new_submission_at, '-infinity'::timestamptz), v_authoritative_ts),
          new_inbound_count = COALESCE(new_inbound_count, 0) + 1,
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Relational lead_course_interests linking for returning lead
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

        -- Safe integration_entity_links Upsert
        SELECT id, external_entity_id INTO v_existing_active_link
        FROM public.integration_entity_links
        WHERE integration = 'hubspot'
          AND entity_type = 'lead'
          AND eds_entity_id = v_matched_lead_id
          AND status = 'active'
        LIMIT 1;

        IF v_existing_active_link.id IS NOT NULL AND v_existing_active_link.external_entity_id <> v_contact_id THEN
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'archived', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO NOTHING;
        ELSE
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO UPDATE SET
            eds_entity_id = EXCLUDED.eds_entity_id,
            updated_at = now();
        END IF;

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
            'form_name', COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name')
          ),
          v_authoritative_ts
        );

        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), NULLIF(trim(v_props->>'first_conversion_event_name'), ''), 'HubSpot Form Submission'),
            CASE WHEN v_source = 'website' THEN 'Site' WHEN v_source = 'meta' THEN 'Meta Lead Ads' ELSE initcap(v_source) END,
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

      -- CREATE NEW LEAD
      ELSE
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
          v_matched_lead_id, NULL, v_capture_stage_id, 'initial_assignment'
        );

        SELECT id, external_entity_id INTO v_existing_active_link
        FROM public.integration_entity_links
        WHERE integration = 'hubspot'
          AND entity_type = 'lead'
          AND eds_entity_id = v_matched_lead_id
          AND status = 'active'
        LIMIT 1;

        IF v_existing_active_link.id IS NOT NULL AND v_existing_active_link.external_entity_id <> v_contact_id THEN
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'archived', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO NOTHING;
        ELSE
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO UPDATE SET
            eds_entity_id = EXCLUDED.eds_entity_id,
            updated_at = now();
        END IF;

        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), NULLIF(trim(v_props->>'first_conversion_event_name'), ''), 'HubSpot Form Submission'),
            CASE WHEN v_source = 'website' THEN 'Site' WHEN v_source = 'meta' THEN 'Meta Lead Ads' ELSE initcap(v_source) END,
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
              v_matched_lead_id,
              v_resolved_course_id,
              1,
              'hubspot',
              'active',
              now(),
              now()
            ) ON CONFLICT (lead_id, course_id) DO NOTHING;
          END IF;
        END IF;

        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata, created_at
        ) VALUES (
          v_matched_lead_id, 'lead_created', 'system',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', v_source,
            'source_detail', v_source_detail,
            'course', v_course_interest_val,
            'intent', v_intent,
            'form_name', COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name')
          ),
          v_authoritative_ts
        );

        v_processed_count := v_processed_count + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
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

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch(JSONB) TO authenticated, service_role;
