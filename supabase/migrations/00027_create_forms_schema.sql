-- =============================================================================
-- Migration 00027: Phase 3 Block 1 - Forms Module Schema & Transaction Infrastructure
-- =============================================================================

-- 1. Canonical source check expansion in leads and lead_intake_events
ALTER TABLE public.leads 
  DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE public.leads 
  ADD CONSTRAINT leads_source_check 
  CHECK (source = ANY (ARRAY['meta'::text, 'google'::text, 'manual'::text, 'test'::text, 'form'::text]));

ALTER TABLE public.lead_intake_events 
  DROP CONSTRAINT IF EXISTS lead_intake_events_source_check;

ALTER TABLE public.lead_intake_events 
  ADD CONSTRAINT lead_intake_events_source_check 
  CHECK (source = ANY (ARRAY['meta'::text, 'google'::text, 'manual'::text, 'test'::text, 'form'::text]));

-- 2. Add 'form_submitted' to lead_activities activity_type constraint
ALTER TABLE public.lead_activities 
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities 
  ADD CONSTRAINT lead_activities_activity_type_check 
  CHECK (activity_type = ANY (ARRAY[
    'lead_created'::text, 'intake_received'::text, 'email_dispatched'::text, 
    'sms_dispatched'::text, 'call_task_created'::text, 'stage_changed'::text, 
    'processing_failed'::text, 'note_created'::text, 'tag_added'::text, 
    'tag_removed'::text, 'campaign_sent'::text, 'contact_preference_detected'::text, 
    'email_selected'::text, 'sms_selected'::text, 'call_selected'::text, 
    'channel_skipped'::text, 'csv_status_unmapped'::text, 'qualification_status_changed'::text,
    'form_submitted'::text
  ]));

-- 3. Forms Table
CREATE TABLE IF NOT EXISTS public.forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  success_message TEXT NOT NULL DEFAULT 'Thank you for your submission! We will get in touch shortly.',
  redirect_url TEXT NULL,
  source_detail TEXT NULL DEFAULT 'website-form',
  default_pipeline_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  default_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  duplicate_update_enabled BOOLEAN NOT NULL DEFAULT true,
  current_version INTEGER NOT NULL DEFAULT 1,
  submit_button_text TEXT NOT NULL DEFAULT 'Submit',
  created_by_user_id UUID NULL REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Form Fields Table (Versioned)
CREATE TABLE IF NOT EXISTS public.form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'first_name', 'last_name', 'email', 'phone', 
    'contact_preference', 'course_interest', 
    'text', 'textarea', 'select', 'radio', 'checkbox', 'hidden'
  )),
  internal_name TEXT NOT NULL,
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  placeholder TEXT NULL,
  help_text TEXT NULL,
  options JSONB NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT form_fields_form_version_name_key UNIQUE (form_id, version, internal_name)
);

-- 5. Form Submissions Table
CREATE TABLE IF NOT EXISTS public.form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  form_version INTEGER NOT NULL DEFAULT 1,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  intake_event_id UUID NULL REFERENCES public.lead_intake_events(id) ON DELETE SET NULL,
  submitted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  email TEXT NULL,
  phone_e164 TEXT NULL,
  contact_preference TEXT NULL,
  course_interest TEXT NULL,
  source_detail TEXT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN (
    'received', 'processing', 'processed', 'conflict', 'failed'
  )),
  processing_error TEXT NULL,
  idempotency_key TEXT NOT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,
  CONSTRAINT form_submissions_form_idempotency_key UNIQUE (form_id, idempotency_key)
);

-- 6. Rate Limits Table
CREATE TABLE IF NOT EXISTS public.form_submission_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT form_submission_rate_limits_key UNIQUE (form_id, ip_hash, window_start)
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_forms_slug ON public.forms(slug);
CREATE INDEX IF NOT EXISTS idx_forms_status ON public.forms(status);
CREATE INDEX IF NOT EXISTS idx_form_fields_form_ver_sort ON public.form_fields(form_id, version, sort_order);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_date ON public.form_submissions(form_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_lead ON public.form_submissions(lead_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON public.form_submissions(processing_status);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_idempotency ON public.form_submissions(form_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.form_submission_rate_limits(form_id, ip_hash, window_start);

-- 8. Row Level Security Policies
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submission_rate_limits ENABLE ROW LEVEL SECURITY;

-- Anonymous users have NO direct table access
DROP POLICY IF EXISTS "Deny anon access on forms" ON public.forms;
CREATE POLICY "Deny anon access on forms" ON public.forms
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on form_fields" ON public.form_fields;
CREATE POLICY "Deny anon access on form_fields" ON public.form_fields
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on form_submissions" ON public.form_submissions;
CREATE POLICY "Deny anon access on form_submissions" ON public.form_submissions
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on form_submission_rate_limits" ON public.form_submission_rate_limits;
CREATE POLICY "Deny anon access on form_submission_rate_limits" ON public.form_submission_rate_limits
  FOR ALL TO anon USING (false);

-- Active authenticated app users have management access
DROP POLICY IF EXISTS "Active app users can manage forms" ON public.forms;
CREATE POLICY "Active app users can manage forms" ON public.forms
  FOR ALL TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage form_fields" ON public.form_fields;
CREATE POLICY "Active app users can manage form_fields" ON public.form_fields
  FOR ALL TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

DROP POLICY IF EXISTS "Active app users can read form_submissions" ON public.form_submissions;
CREATE POLICY "Active app users can read form_submissions" ON public.form_submissions
  FOR SELECT TO authenticated
  USING (is_active_app_user());

DROP POLICY IF EXISTS "Active app users can read rate_limits" ON public.form_submission_rate_limits;
CREATE POLICY "Active app users can read rate_limits" ON public.form_submission_rate_limits
  FOR SELECT TO authenticated
  USING (is_active_app_user());

-- 9. Persistent Rate Limit Check Function
CREATE OR REPLACE FUNCTION public.check_and_record_rate_limit(
  p_form_id UUID,
  p_ip_hash TEXT,
  p_max_requests INT DEFAULT 10,
  p_window_minutes INT DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INT;
BEGIN
  -- Bucket window start time based on p_window_minutes
  v_window_start := to_timestamp(floor(extract(epoch from now()) / (p_window_minutes * 60)) * (p_window_minutes * 60));

  INSERT INTO public.form_submission_rate_limits (
    form_id, ip_hash, window_start, request_count, updated_at
  ) VALUES (
    p_form_id, p_ip_hash, v_window_start, 1, now()
  )
  ON CONFLICT (form_id, ip_hash, window_start)
  DO UPDATE SET 
    request_count = form_submission_rate_limits.request_count + 1,
    updated_at = now()
  RETURNING request_count INTO v_current_count;

  RETURN v_current_count <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_record_rate_limit FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_rate_limit TO service_role;

-- 10. Atomic Form Submission Transaction Function (Private, service_role only)
CREATE OR REPLACE FUNCTION public.process_form_submission_transaction(
  p_form_slug TEXT,
  p_idempotency_key TEXT,
  p_submitted_data JSONB,
  p_email TEXT,
  p_phone_e164 TEXT,
  p_contact_preference TEXT,
  p_course_interest TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- 3. Lead Deduplication Search
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

  -- 4. Check for Conflict between Email and Phone matches
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    -- Conflict detected: do NOT merge, do NOT create intake, do NOT alter leads
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
  v_clean_phone_raw := NULLIF(trim(COALESCE(p_submitted_data->>'phone', '')), '');
  v_pref := COALESCE(p_contact_preference, 'email');
  IF v_pref NOT IN ('email', 'sms', 'call') THEN
    v_pref := 'email';
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- Create new lead with canonical source = 'form'
    INSERT INTO public.leads (
      source, first_name, last_name, email, email_confirmation,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, created_at, updated_at
    ) VALUES (
      'form', v_first_name, v_last_name, v_clean_email, v_clean_email,
      v_clean_phone_raw, p_phone_e164,
      v_pref, p_course_interest,
      CASE WHEN p_course_interest IS NOT NULL AND trim(p_course_interest) != '' 
           THEN ARRAY[trim(p_course_interest)] 
           ELSE ARRAY[]::text[] END,
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
    -- Non-destructive merge on existing lead if duplicate_update_enabled is true
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
          WHEN p_course_interest IS NOT NULL AND trim(p_course_interest) != '' AND NOT (course_interests @> ARRAY[trim(p_course_interest)])
          THEN array_append(course_interests, trim(p_course_interest))
          ELSE course_interests
        END,
        updated_at = now()
      WHERE id = v_target_lead_id AND id IS NOT NULL;
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

  -- 7. Associate default tags
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

  -- 10. Return success details for post-transaction processing
  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processing',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_form_submission_transaction FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO service_role;

-- 11. Archive or Delete Form RPC (enforcing archive if submissions exist)
CREATE OR REPLACE FUNCTION public.archive_or_delete_form(p_form_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: active app user required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_sub_count FROM public.form_submissions WHERE form_id = p_form_id;
  IF v_sub_count > 0 THEN
    UPDATE public.forms 
    SET status = 'inactive', updated_at = now() 
    WHERE id = p_form_id AND id IS NOT NULL;
    RETURN jsonb_build_object('action', 'archived', 'message', 'Form archived to preserve submission history.');
  ELSE
    DELETE FROM public.forms 
    WHERE id = p_form_id AND id IS NOT NULL;
    RETURN jsonb_build_object('action', 'deleted', 'message', 'Form permanently deleted.');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_or_delete_form FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_or_delete_form TO authenticated;
