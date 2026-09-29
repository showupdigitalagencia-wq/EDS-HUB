-- =============================================================================
-- Migration 00079: Returning Lead Resurfacing, Course Deduplication & Approved Templates
-- =============================================================================
-- 1. Adds last_inbound_activity_at, has_new_submission, new_submission_at to public.leads.
-- 2. Backfills last_inbound_activity_at preserving original created_at.
-- 3. Updates process_form_submission_transaction:
--    - Merges course interests without duplicates
--    - Sets last_inbound_activity_at = now() on new form submission
--    - Sets has_new_submission = true and preserves current pipeline stage
-- 4. Updates process_hubspot_inbound_batch:
--    - Updates last_inbound_activity_at and has_new_submission on returning inbound form events
-- 5. Seeds approved transactional and email templates:
--    - Periodontal Plastic (periodontal_course_details)
--    - Endodontics (endodontic_course_details)
--    - Intensive + Advanced Implant shared template (implant_course_details)
--    - Wisdom (wisdom_course_details)
--    - Rehabilitation (rehabilitation_course_details)
--    - Preserves existing Zygomatic template untouched!
-- =============================================================================

-- 1. Add Recency & New Submission Columns to Leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_inbound_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_new_submission BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS new_submission_at TIMESTAMPTZ;

-- Backfill last_inbound_activity_at using source_created_at or created_at
UPDATE public.leads
SET last_inbound_activity_at = COALESCE(source_created_at, created_at, now())
WHERE last_inbound_activity_at IS NULL;

ALTER TABLE public.leads
  ALTER COLUMN last_inbound_activity_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_leads_last_inbound_activity_at
  ON public.leads(last_inbound_activity_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_leads_has_new_submission
  ON public.leads(has_new_submission)
  WHERE has_new_submission = true;

-- RPC to acknowledge and clear new submission badge
CREATE OR REPLACE FUNCTION public.acknowledge_lead_new_submission(p_lead_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.leads
  SET has_new_submission = false
  WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_lead_new_submission(UUID) TO authenticated, service_role;

-- 2. Update process_form_submission_transaction with Resurfacing & Course Merging
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
  v_clean_course TEXT;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
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
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = trim(p_phone_e164)
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 4. Identity Conflict Protection
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
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

  -- 5. Resolve target lead
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);
  v_first_name := NULLIF(trim(COALESCE(p_submitted_data->>'first_name', '')), '');
  v_last_name := NULLIF(trim(COALESCE(p_submitted_data->>'last_name', '')), '');

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
  v_clean_course := NULLIF(trim(COALESCE(p_course_interest, '')), '');
  
  -- Relaxed contact_preference
  v_pref := NULLIF(trim(lower(COALESCE(p_contact_preference, ''))), '');
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := NULL;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage with initial activity timestamp
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      'form', 'website', v_first_name, v_last_name, v_clean_email, v_clean_email,
      v_clean_phone_raw, p_phone_e164,
      v_pref, v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL 
           THEN jsonb_build_array(v_clean_course) 
           ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, now(),
      false, NULL, now(), now()
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
        'source_detail', 'website'
      )
    );
  ELSE
    -- RETURNING LEAD: Update non-destructively, deduplicate courses, and resurface to top of stage
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_course_interest;

    IF v_clean_course IS NOT NULL THEN
      -- Check canonical identity match against existing interests
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
        WHERE lower(trim(elem)) = lower(v_clean_course)
           OR (lower(v_clean_course) = 'zygomatic' AND lower(trim(elem)) LIKE '%zygoma%')
           OR (lower(v_clean_course) LIKE '%zygoma%' AND lower(trim(elem)) = 'zygomatic')
           OR (lower(v_clean_course) = 'wisdom' AND lower(trim(elem)) LIKE '%wisdom%')
           OR (lower(v_clean_course) LIKE '%wisdom%' AND lower(trim(elem)) = 'wisdom')
           OR (lower(v_clean_course) = 'endodontic' AND lower(trim(elem)) LIKE '%endo%')
           OR (lower(v_clean_course) = 'endodontics' AND lower(trim(elem)) LIKE '%endo%')
           OR (lower(v_clean_course) LIKE '%endo%' AND (lower(trim(elem)) = 'endodontic' OR lower(trim(elem)) = 'endodontics'))
           OR (lower(v_clean_course) = 'periodontal' AND lower(trim(elem)) LIKE '%perio%')
           OR (lower(v_clean_course) = 'periodontal plastic' AND lower(trim(elem)) LIKE '%perio%')
           OR (lower(v_clean_course) LIKE '%perio%' AND (lower(trim(elem)) = 'periodontal' OR lower(trim(elem)) = 'periodontal plastic'))
           OR (lower(v_clean_course) = 'rehabilitation' AND lower(trim(elem)) LIKE '%rehab%')
           OR (lower(v_clean_course) LIKE '%rehab%' AND lower(trim(elem)) = 'rehabilitation')
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
        IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
          v_merged_course_interest := v_clean_course;
        ELSE
          v_merged_course_interest := v_merged_course_interest || ', ' || v_clean_course;
        END IF;
      END IF;
    END IF;

    -- Update lead: Preserves original created_at and pipeline_stage_id! Resurfaces via last_inbound_activity_at!
    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      contact_preference = COALESCE(v_pref, contact_preference),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_inbound_activity_at = now(),
      has_new_submission = true,
      new_submission_at = now(),
      updated_at = now()
    WHERE id = v_target_lead_id;

    -- Activity: returning_lead_form_submitted
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      'Lead retornou com novo formulário do site: ' || v_form.name,
      jsonb_build_object(
        'source', 'form',
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'source_detail', 'website',
        'is_returning_lead', true,
        'new_course_interest', v_clean_course
      )
    );
  END IF;

  -- 6. Course Interest Relational Linking (lead_course_interests)
  IF v_clean_course IS NOT NULL THEN
    SELECT id INTO v_resolved_course_id
    FROM public.courses
    WHERE lower(name) = lower(v_clean_course)
       OR lower(code) = lower(v_clean_course)
       OR lower(name) LIKE '%' || lower(v_clean_course) || '%'
       OR lower(v_clean_course) LIKE '%' || lower(code) || '%'
    LIMIT 1;

    IF v_resolved_course_id IS NOT NULL THEN
      INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
      VALUES (v_target_lead_id, v_resolved_course_id, 'form', 'active')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- 7. Insert lead_intake_events record
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
  ) VALUES (
    'form', p_idempotency_key, v_target_lead_id::text,
    'form:' || v_form.id::text || ':' || p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'email', v_clean_email,
      'phone', p_phone_e164,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'contact_preference', v_pref,
      'course_interest', v_clean_course,
      'source_detail', 'website'
    ),
    'processed', v_target_lead_id, 1, now()
  ) RETURNING id INTO v_intake_event_id;

  -- 8. Persist form_submissions record with full factual fields
  INSERT INTO public.form_submissions (
    form_id, form_version, lead_id, intake_event_id, submitted_data,
    email, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, idempotency_key,
    ip_address, user_agent, submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_target_lead_id, v_intake_event_id, p_submitted_data,
    v_clean_email, p_phone_e164, v_pref, v_clean_course,
    'website', 'success', p_idempotency_key,
    p_ip_address, p_user_agent, now(), now()
  ) RETURNING id INTO v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'success',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO service_role;

-- 3. Update process_hubspot_inbound_batch to Resurface Returning Leads
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event JSONB;
  v_event_id TEXT;
  v_contact_id TEXT;
  v_event_type TEXT;
  v_event_ts TIMESTAMPTZ;
  v_props JSONB;
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_contact_pref TEXT;
  v_raw_course_interest TEXT;
  v_course_interest_val TEXT;
  v_source TEXT;
  v_source_detail TEXT;
  v_payload_hash TEXT;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_existing_lead RECORD;
  v_existing_course_interests JSONB;
  v_existing_course_interest TEXT;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
  v_is_form_submission BOOLEAN;
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_conflict_count INT := 0;
  v_error_count INT := 0;
  v_is_update BOOLEAN;
  v_target_stage_id UUID;
  v_deleted_audit RECORD;
BEGIN
  SELECT id INTO v_target_stage_id
  FROM public.pipeline_stages
  WHERE is_default = true OR code = 'capture' OR name = 'Novo Lead'
  ORDER BY display_order ASC
  LIMIT 1;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    BEGIN
      v_event_id := v_event->>'event_id';
      v_contact_id := v_event->>'contact_id';
      v_event_type := v_event->>'event_type';
      v_event_ts := COALESCE((v_event->>'occurred_at')::timestamptz, now());
      v_props := v_event->'properties';

      IF v_props IS NULL THEN
        CONTINUE;
      END IF;

      -- Check Anti-Resurrection: If contact was deleted in EDS HUB, ignore
      SELECT id, deleted_at, lead_id INTO v_deleted_audit
      FROM public.lead_deletion_audit
      WHERE hubspot_contact_id = v_contact_id
      LIMIT 1;

      IF v_deleted_audit.id IS NOT NULL THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_deleted_audit.lead_id, v_contact_id,
          'contact.ignored_deleted', v_event_id, v_event_ts, md5(v_props::text), 'completed',
          jsonb_build_object('reason', 'Anti-resurrection: contact was permanently deleted in EDS HUB', 'deleted_at', v_deleted_audit.deleted_at)
        );
        CONTINUE;
      END IF;

      -- Normalize core fields
      v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', '')), '');
      v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', '')), '');
      v_email := NULLIF(lower(trim(COALESCE(v_props->>'email', ''))), '');
      v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', ''), '\D', '', 'g'), '');
      
      v_raw_course_interest := COALESCE(
        v_props->>'curso_de_interesse',
        v_props->>'course_interest',
        v_props->>'qual_o_seu_interesse_',
        v_props->>'qual_o_seu_interesse'
      );
      v_course_interest_val := NULLIF(trim(COALESCE(v_raw_course_interest, '')), '');

      v_contact_pref := NULLIF(trim(lower(COALESCE(
        v_props->>'what_is_your_preferred_contact_method',
        v_props->>'what_is_your_preferred_method_of_contact',
        v_props->>'preferencia_de_contato',
        ''
      ))), '');

      IF v_contact_pref IN ('whats', 'zap', 'whatsapp') THEN
        v_contact_pref := 'whatsapp';
      ELSIF v_contact_pref IN ('email', 'e-mail') THEN
        v_contact_pref := 'email';
      ELSIF v_contact_pref IN ('sms', 'text') THEN
        v_contact_pref := 'sms';
      ELSIF v_contact_pref IN ('phone', 'call', 'ligacao', 'telefone') THEN
        v_contact_pref := 'call';
      ELSE
        v_contact_pref := NULL;
      END IF;

      -- Source attribution
      IF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%meta%' OR
         lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' OR
         lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' OR
         lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' THEN
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
      ELSIF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%site%' OR
            lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%website%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'organic_search' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'direct_traffic' THEN
        v_source := 'form';
        v_source_detail := 'website';
      ELSE
        v_source := 'hubspot';
        v_source_detail := 'hubspot_sync';
      END IF;

      v_is_form_submission := (v_source = 'form' OR v_source = 'meta' OR v_course_interest_val IS NOT NULL);
      v_payload_hash := md5(v_props::text);

      -- Deduplication Priority
      v_matched_lead_id := NULL;

      -- Priority 1: hubspot_contact_id
      SELECT id INTO v_matched_lead_id
      FROM public.leads
      WHERE hubspot_contact_id = v_contact_id
        AND deleted_at IS NULL
      LIMIT 1;

      -- Priority 2: integration_entity_links
      IF v_matched_lead_id IS NULL THEN
        SELECT eds_entity_id INTO v_matched_lead_id
        FROM public.integration_entity_links
        WHERE integration = 'hubspot'
          AND entity_type = 'lead'
          AND external_entity_id = v_contact_id
          AND status = 'active'
        LIMIT 1;
      END IF;

      -- Priority 3: Email Match
      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE lower(trim(email)) = v_email
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        END IF;
      END IF;

      -- Priority 4: Phone Match
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL THEN
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        END IF;
      END IF;

      -- Execute Update or Create
      IF v_matched_lead_id IS NOT NULL THEN
        -- UPDATE EXISTING MATCHED LEAD
        v_is_update := true;
        SELECT course_interest, course_interests
        INTO v_existing_course_interest, v_existing_course_interests
        FROM public.leads
        WHERE id = v_matched_lead_id;

        v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
        v_merged_course_interest := v_existing_course_interest;

        IF v_course_interest_val IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
            WHERE lower(trim(elem)) = lower(v_course_interest_val)
               OR (lower(v_course_interest_val) = 'zygomatic' AND lower(trim(elem)) LIKE '%zygoma%')
               OR (lower(v_course_interest_val) LIKE '%zygoma%' AND lower(trim(elem)) = 'zygomatic')
               OR (lower(v_course_interest_val) = 'wisdom' AND lower(trim(elem)) LIKE '%wisdom%')
               OR (lower(v_course_interest_val) LIKE '%wisdom%' AND lower(trim(elem)) = 'wisdom')
               OR (lower(v_course_interest_val) = 'endodontic' AND lower(trim(elem)) LIKE '%endo%')
               OR (lower(v_course_interest_val) = 'endodontics' AND lower(trim(elem)) LIKE '%endo%')
               OR (lower(v_course_interest_val) LIKE '%endo%' AND (lower(trim(elem)) = 'endodontic' OR lower(trim(elem)) = 'endodontics'))
               OR (lower(v_course_interest_val) = 'periodontal' AND lower(trim(elem)) LIKE '%perio%')
               OR (lower(v_course_interest_val) = 'periodontal plastic' AND lower(trim(elem)) LIKE '%perio%')
               OR (lower(v_course_interest_val) LIKE '%perio%' AND (lower(trim(elem)) = 'periodontal' OR lower(trim(elem)) = 'periodontal plastic'))
               OR (lower(v_course_interest_val) = 'rehabilitation' AND lower(trim(elem)) LIKE '%rehab%')
               OR (lower(v_course_interest_val) LIKE '%rehab%' AND lower(trim(elem)) = 'rehabilitation')
          ) THEN
            v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);
            IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
              v_merged_course_interest := v_course_interest_val;
            ELSE
              v_merged_course_interest := v_merged_course_interest || ', ' || v_course_interest_val;
            END IF;
          END IF;
        END IF;

        UPDATE public.leads
        SET
          first_name = COALESCE(v_first_name, first_name),
          last_name = COALESCE(v_last_name, last_name),
          email = COALESCE(v_email, email),
          phone_raw = COALESCE(v_phone, phone_raw),
          contact_preference = COALESCE(v_contact_pref, contact_preference),
          course_interest = v_merged_course_interest,
          course_interests = v_merged_course_interests,
          hubspot_contact_id = v_contact_id,
          last_inbound_activity_at = CASE WHEN v_is_form_submission THEN now() ELSE last_inbound_activity_at END,
          has_new_submission = CASE WHEN v_is_form_submission THEN true ELSE has_new_submission END,
          new_submission_at = CASE WHEN v_is_form_submission THEN now() ELSE new_submission_at END,
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Upsert entity link
        INSERT INTO public.integration_entity_links (
          integration, entity_type, eds_entity_id, external_entity_id,
          status, last_synced_hash, external_updated_at, last_inbound_sync_at
        ) VALUES (
          'hubspot', 'lead', v_matched_lead_id, v_contact_id,
          'active', v_payload_hash, v_event_ts, now()
        ) ON CONFLICT (integration, entity_type, eds_entity_id) WHERE status = 'active'
        DO UPDATE SET
          external_entity_id = EXCLUDED.external_entity_id,
          last_synced_hash = EXCLUDED.last_synced_hash,
          external_updated_at = EXCLUDED.external_updated_at,
          last_inbound_sync_at = EXCLUDED.last_inbound_sync_at,
          updated_at = now();

        v_updated_count := v_updated_count + 1;
      ELSE
        -- CREATE NEW LEAD
        v_is_update := false;
        INSERT INTO public.leads (
          first_name, last_name, email, phone_raw, contact_preference,
          course_interest, course_interests,
          source, source_detail, pipeline_stage_id, hubspot_contact_id,
          last_inbound_activity_at, has_new_submission, new_submission_at,
          source_created_at, created_at, updated_at
        ) VALUES (
          v_first_name, v_last_name, v_email, v_phone, v_contact_pref,
          v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_source, v_source_detail, v_target_stage_id, v_contact_id,
          COALESCE(v_event_ts, now()), false, NULL,
          COALESCE(v_event_ts, now()), now(), now()
        ) RETURNING id INTO v_matched_lead_id;

        INSERT INTO public.integration_entity_links (
          integration, entity_type, eds_entity_id, external_entity_id,
          status, last_synced_hash, external_updated_at, last_inbound_sync_at
        ) VALUES (
          'hubspot', 'lead', v_matched_lead_id, v_contact_id,
          'active', v_payload_hash, v_event_ts, now()
        );

        v_created_count := v_created_count + 1;
      END IF;

      -- Relational Course Linking
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) 
           OR lower(code) = lower(v_course_interest_val)
           OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      -- Store form_submissions record for traceability
      IF v_is_form_submission THEN
        INSERT INTO public.form_submissions (
          lead_id,
          form_name,
          source,
          submitted_at,
          submitted_data,
          email,
          phone_e164,
          contact_preference,
          course_interest,
          source_detail,
          processing_status,
          recovery_state,
          idempotency_key
        ) VALUES (
          v_matched_lead_id,
          COALESCE(v_props->>'form_name', v_course_interest_val, 'Formulário de Inscrição'),
          CASE 
            WHEN lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' THEN 'Instagram Lead Ads'
            WHEN lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' THEN 'Facebook Lead Ads'
            WHEN v_source = 'form' THEN 'Site'
            ELSE 'Meta Lead Ads'
          END,
          COALESCE(v_event_ts, now()),
          v_props,
          v_email,
          v_phone,
          v_contact_pref,
          v_course_interest_val,
          v_source_detail,
          'completed',
          'complete',
          'hubspot_form_sub:' || v_contact_id || ':' || COALESCE(v_event_id, 'initial')
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'created', v_created_count,
    'updated', v_updated_count,
    'conflicts', v_conflict_count,
    'errors', v_error_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO authenticated, service_role;

-- 4. Seed Transactional Templates for the Approved Courses
INSERT INTO public.transactional_templates (key, channel, subject_template, body_template, is_active)
VALUES
  (
    'periodontal_course_details',
    'email',
    'Periodontal Plastic Course Details – Hands-On Training in Rio',
    'Hi Dr. {{salutation}}

Thank you for your interest in our courses!

Our Periodontal Plastic Surgery Intensive Training is a 4-Day Hands-On Program with Live Patients, designed to build your skills and confidence in advanced periodontal and peri-implant techniques. From connective tissue grafting to root coverage and aesthetic flap designs, you’ll work directly with patients under expert supervision, mastering the procedures step-by-step.

Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.

Our courses are highly exclusive, with a maximum of ten doctors per session, providing an intimate learning environment.

UPCOMING 2026 DATE

November 7 to 10 2026 | Rio de Janeiro

TUITION: $9,900

UPCOMING 2027 DATE

March 1 to 4, 2027 | Rio de Janeiro

TUITION: $9,900

Early Bird: $400 OFF

Available for the March course through December 31, 2026.

Our course fee includes:

• Accommodation in a four-star hotel with breakfast
• Lunch during the course
• Transportation between the airport, hotel, and university
• A Brazilian dinner on the final day

Our course offer 36 CE credits.

We also offer flexible interest-free payment plans options.

Please see the attached PDF for detailed information of this course.

Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, Dr. Mourao, at your convenience.

Best regards,

Natalia

Expert Dental Solutions',
    true
  ),
  (
    'endodontic_course_details',
    'email',
    'Endodontics Course Details, Hands-On Training in Rio',
    'Hi Dr. {{salutation}}

Thank you for your interest in our Endodontics Intensive Clinical Training.

This program is designed for dentists who want a true high-level clinical immersion in molar endodontics, working directly on live patients with expert mentorship.

What makes this training unique:

• Real patient treatment during all 4 days of the course
• Direct one-on-one mentorship during your procedures
• Experience with multiple rotary and reciprocating systems
• Practice different obturation techniques to refine your workflow
• Customized clinical cases selected according to your experience level
• Highly exclusive program – limited to 8 doctors.
• Lectures will be given through zoom before the training in Brazil

Over 4 intensive days in Rio de Janeiro - Brazil, participants are able to complete multiple molar root canal treatments, gaining confidence in diagnosis, instrumentation, obturation, and management of clinical challenges — all in a fully supervised clinical environment.

📅 Upcoming Date

April 26-29, 2027

💳 Tuition: USD 9,600

🎯 Early bird: USD 500 off if registered by

November 30

The experience also includes:

• 4-star hotel accommodation with breakfast
• Lunch during course days
• Transportation between airport, hotel, and clinic
• Brazilian farewell dinner on the final evening
• 35 CE credits PACE approved

We also offer flexible interest-free payment plans options.

After registration, we schedule a Zoom call with our coordinators to understand your goals and select the most appropriate clinical cases for your training.

Please see the attached PDF for detailed information of this course.

If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.

Best regards,

Natalia

Expert Dental Solutions',
    true
  ),
  (
    'implant_course_details',
    'email',
    'Implant Course Details – Hands-On Training',
    'Hello Dr. {{salutation}}

Thank you for your interest in our Dental Implant Courses in Rio de Janeiro, Brazil.

What makes our courses different is the opportunity to gain real clinical experience with Real Patient Surgeries, One-on-One Mentorship, and training that is 100% customized to your goals and experience level.

We offer two implant courses:

INTENSIVE DENTAL IMPLANT COURSE

Designed for beginner and intermediate dentists who want to build confidence in implant placement.

• Place at least 20 implants on real patients
• You are the main surgeon from start to finish
• One-on-one mentorship throughout the clinical experience
• Cases selected according to your experience and goals

ADVANCED IMPLANT EXPERIENCE

Designed for dentists who want to advance their skills in more complex implant procedures.

• Perform complex surgeries on real patients
• Training is 100% customized to your clinical goals
• Procedures may include sinus lifts, ridge splits, GBR with implant placement, All-on-X, and other advanced cases
• One-on-one mentorship throughout your surgeries

100% CUSTOMIZED EXPERIENCE

After registration, we schedule a Zoom meeting with our coordinators to learn about your experience, goals, and the procedures you would like to focus on.

Our team then selects your patients and clinical cases specifically around those goals.

REAL PATIENT ONE-ON-ONE MENTORSHIP

During the clinical days, you are not rotating between observing, assisting, and operating. You are the main surgeon for your cases, with an experienced instructor by your side providing one-on-one guidance throughout the procedure.

Our courses are intentionally small, with a maximum of 6 participants per course, allowing us to provide a highly personalized clinical experience.

MENTORSHIP DOESN’T END WHEN THE COURSE ENDS

As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.

UPCOMING 2026 DATE

November 11 to 14, 2026 | Rio de Janeiro

TUITION

Intensive Dental Implant Course: $9,400

Advanced Implant Experience: $9,900

UPCOMING 2027 DATE

February 24 to 27, 2027 | Rio de Janeiro

TUITION

Intensive Dental Implant Course: $9,700

Advanced Implant Experience: $10,200

Early Bird: $600 OFF

Available for the February course through December 31, 2026.

YOUR COURSE PACKAGE INCLUDES

• Four-star hotel accommodations with breakfast
• Lunch during the course
• Airport, hotel, and university transportation
• Brazilian dinner on the final day
• 32 CE credits AGD PACE Approved

We also offer flexible interest-free payment plans.

Please see the attached PDF for more detailed information about each course.

If you have any questions, I’d be happy to help. I can also arrange a call with our coordinator, so you can discuss your experience, goals, and which course would be the best fit for you.

Best,

Natalia

Expert Dental Solutions',
    true
  ),
  (
    'wisdom_course_details',
    'email',
    'Wisdom Surgery Details – Hands-On Training in Rio',
    'Hello Dr. {{salutation}}

Thank you for your interest in our Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!

This is a 4-day intensive clinical course with real patients, designed to give you extensive surgical experience with one-on-one mentorship throughout the entire course.

REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON

During the course, you will:

• Perform at least 16 wisdom teeth extractions on real patients
• Work with fully impacted, partially impacted, and erupted wisdom teeth
• Be the main surgeon from start to finish during all your procedures
• Receive one-on-one mentorship, with your instructor by your side throughout every procedure, assisting you while you perform the extraction
• Train with cases customized to your experience level and clinical goals

100% CUSTOMIZED TO YOUR GOALS

After registration, we schedule a Zoom meeting with our coordinators to discuss your experience, goals, and the types of cases you would like to focus on. Based on this meeting, our team selects patients and cases specifically for your training.

The course takes place at a Federal University in Rio de Janeiro, Brazil, with a maximum of 6 doctors per session to maintain a highly personalized clinical experience.

MENTORSHIP DOESN’T END WHEN THE COURSE ENDS

As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.

NEXT COURSES

November 7–10, 2026

March 1-4, 2027

TUITION

USD 8,200

YOUR COURSE PACKAGE INCLUDES

• Four-star hotel accommodation with breakfast
• Lunch during the course
• Transportation between the airport, hotel, and university
• Brazilian dinner on the final day
• 36 PACE-approved CE credits

We also offer flexible, interest-free payment plan options.

Please see the attached PDF for additional course details.

Please feel free to reach out with any questions. I’d be happy to give you a call, or we can arrange a call with one of our coordinators at your convenience.

Best,

Natalia

Expert Dental Solutions',
    true
  ),
  (
    'rehabilitation_course_details',
    'email',
    'Implant Rehabilitation Course Details – Hands-On Training',
    'Hi Dr. {{salutation}}

Thank you for your interest in our courses!

Our Advanced Implant Rehabilitation Experience is a four-day live-patient course designed for dentists who want to enhance their skills in implant prosthodontics, from implant uncovering to definitive restoration using both analog and digital workflows.

After registering, we will schedule a Zoom meeting with our coordinators to discuss your background, goals, and expectations, allowing us to customize your training and select the most appropriate clinical cases for your experience level. The course is fully personalized, ensuring every participant gets the most out of the program.

Our courses are highly exclusive, with a maximum of six doctors per session, providing individualized one-on-one mentorship throughout the clinical experience.

During the course, you will gain hands-on experience with:

• Implant uncovering and peri-implant soft tissue management
• Conventional implant impressions
• Digital intraoral scanning
• Single, multiple, and full-arch implant restorations
• Prosthetic try-in, occlusion, and definitive restoration delivery

The course is held at the Fluminense Federal University School of Dentistry in Rio de Janeiro, where participants treat real patients under faculty supervision.

Upcoming Course Date:

• November 7 to 10, 2026, Rio de Janeiro

Tuition:

• USD 9,600

Our course includes:

• Four-star hotel accommodation with breakfast (5 nights)
• Lunch during the course
• Round-trip airport transfers
• Daily transportation between the hotel and the university
• Brazilian dinner on the final day

Our course offers 36 CE Credits and is PACE Approved.

We also offer flexible interest-free payment plan options.

Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, at your convenience.

Best regards,

Natalia

Expert Dental Solutions',
    true
  )
ON CONFLICT (key) DO UPDATE SET
  channel = EXCLUDED.channel,
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  is_active = true,
  updated_at = now();

-- 5. Seed public.email_templates for UI Preview & Staff Composer
DELETE FROM public.email_templates
WHERE name IN ('Periodontal Plastic', 'Endodontics', 'Intensive + Advanced Implant', 'Wisdom', 'Rehabilitation')
   OR template_key IN ('periodontal_course_details', 'endodontic_course_details', 'implant_course_details', 'wisdom_course_details', 'rehabilitation_course_details');

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_name ON public.email_templates(name);

INSERT INTO public.email_templates (
  name,
  category,
  template_key,
  has_attachment,
  attachment_name,
  is_active,
  content_json,
  text_template,
  html_template
)
VALUES
  (
    'Periodontal Plastic',
    'email',
    'periodontal_course_details',
    true,
    '_Perio and Peri-implant Plastic Surgery.pdf',
    true,
    jsonb_build_object(
      'channel', 'email',
      'subject', 'Periodontal Plastic Course Details – Hands-On Training in Rio',
      'has_attachment', true,
      'attachment_name', '_Perio and Peri-implant Plastic Surgery.pdf',
      'template_key', 'periodontal_course_details'
    ),
    'Hi Dr. {{salutation}}

Thank you for your interest in our courses!

Our Periodontal Plastic Surgery Intensive Training is a 4-Day Hands-On Program with Live Patients, designed to build your skills and confidence in advanced periodontal and peri-implant techniques. From connective tissue grafting to root coverage and aesthetic flap designs, you’ll work directly with patients under expert supervision, mastering the procedures step-by-step.

Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.

Our courses are highly exclusive, with a maximum of ten doctors per session, providing an intimate learning environment.

UPCOMING 2026 DATE

November 7 to 10 2026 | Rio de Janeiro

TUITION: $9,900

UPCOMING 2027 DATE

March 1 to 4, 2027 | Rio de Janeiro

TUITION: $9,900

Early Bird: $400 OFF

Available for the March course through December 31, 2026.

Our course fee includes:

• Accommodation in a four-star hotel with breakfast
• Lunch during the course
• Transportation between the airport, hotel, and university
• A Brazilian dinner on the final day

Our course offer 36 CE credits.

We also offer flexible interest-free payment plans options.

Please see the attached PDF for detailed information of this course.

Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, Dr. Mourao, at your convenience.

Best regards,

Natalia

Expert Dental Solutions',
    '<p>Hi Dr. {{salutation}}</p>
<p>Thank you for your interest in our courses!</p>
<p>Our <b>Periodontal Plastic Surgery Intensive Training</b> is a 4-Day Hands-On Program with Live Patients, designed to build your skills and confidence in advanced periodontal and peri-implant techniques. From connective tissue grafting to root coverage and aesthetic flap designs, you’ll work directly with patients under expert supervision, mastering the procedures step-by-step.</p>
<p>Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.</p>
<p>Our courses are highly exclusive, with a maximum of ten doctors per session, providing an intimate learning environment.</p>
<p><b>UPCOMING 2026 DATE</b></p>
<p>November 7 to 10 2026 | Rio de Janeiro</p>
<p><b>TUITION: $9,900</b></p>
<p><b>UPCOMING 2027 DATE</b></p>
<p>March 1 to 4, 2027 | Rio de Janeiro</p>
<p><b>TUITION: $9,900</b></p>
<p><b>Early Bird: $400 OFF</b></p>
<p>Available for the March course through December 31, 2026.</p>
<p><b>Our course fee includes:</b></p>
<p>• Accommodation in a four-star hotel with breakfast<br/>
• Lunch during the course<br/>
• Transportation between the airport, hotel, and university<br/>
• A Brazilian dinner on the final day</p>
<p><b>Our course offer 36 CE credits.</b></p>
<p>We also offer <b>flexible interest-free payment plans options.</b></p>
<p>Please see the attached PDF for detailed information of this course.</p>
<p>Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, Dr. Mourao, at your convenience.</p>
<p>Best regards,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>'
  ),
  (
    'Endodontics',
    'email',
    'endodontic_course_details',
    true,
    'Endodontics course.pdf',
    true,
    jsonb_build_object(
      'channel', 'email',
      'subject', 'Endodontics Course Details, Hands-On Training in Rio',
      'has_attachment', true,
      'attachment_name', 'Endodontics course.pdf',
      'template_key', 'endodontic_course_details'
    ),
    'Hi Dr. {{salutation}}

Thank you for your interest in our Endodontics Intensive Clinical Training.

This program is designed for dentists who want a true high-level clinical immersion in molar endodontics, working directly on live patients with expert mentorship.

What makes this training unique:

• Real patient treatment during all 4 days of the course
• Direct one-on-one mentorship during your procedures
• Experience with multiple rotary and reciprocating systems
• Practice different obturation techniques to refine your workflow
• Customized clinical cases selected according to your experience level
• Highly exclusive program – limited to 8 doctors.
• Lectures will be given through zoom before the training in Brazil

Over 4 intensive days in Rio de Janeiro - Brazil, participants are able to complete multiple molar root canal treatments, gaining confidence in diagnosis, instrumentation, obturation, and management of clinical challenges — all in a fully supervised clinical environment.

📅 Upcoming Date

April 26-29, 2027

💳 Tuition: USD 9,600

🎯 Early bird: USD 500 off if registered by

November 30

The experience also includes:

• 4-star hotel accommodation with breakfast
• Lunch during course days
• Transportation between airport, hotel, and clinic
• Brazilian farewell dinner on the final evening
• 35 CE credits PACE approved

We also offer flexible interest-free payment plans options.

After registration, we schedule a Zoom call with our coordinators to understand your goals and select the most appropriate clinical cases for your training.

Please see the attached PDF for detailed information of this course.

If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.

Best regards,

Natalia

Expert Dental Solutions',
    '<p>Hi Dr. {{salutation}}</p>
<p>Thank you for your interest in our Endodontics Intensive Clinical Training.</p>
<p>This program is designed for dentists who want a true high-level clinical immersion in molar endodontics, working directly on <b>live patients with expert mentorship</b>.</p>
<p>What makes this training <b>unique</b>:</p>
<p>• <b>Real patient</b> treatment during all 4 days of the course<br/>
• Direct <b>one-on-one mentorship</b> during your procedures<br/>
• Experience with multiple rotary and reciprocating systems<br/>
• Practice different obturation techniques to refine your workflow<br/>
• <b>Customized clinical cases</b> selected according to your experience level<br/>
• <b>Highly exclusive program</b> – limited to 8 doctors.<br/>
• Lectures will be given through zoom before the training in Brazil</p>
<p>Over <b>4 intensive days</b> in Rio de Janeiro - Brazil, participants are able to complete multiple molar root canal treatments, gaining confidence in diagnosis, instrumentation, obturation, and management of clinical challenges — all in a fully supervised clinical environment.</p>
<p>📅 Upcoming Date</p>
<p>April 26-29, 2027</p>
<p>💳 Tuition: USD 9,600</p>
<p>🎯 Early bird: USD 500 off if registered by</p>
<p>November 30</p>
<p><b>The experience also includes:</b></p>
<p>• 4-star hotel accommodation with breakfast<br/>
• Lunch during course days<br/>
• Transportation between airport, hotel, and clinic<br/>
• Brazilian farewell dinner on the final evening<br/>
• <b>35 CE credits PACE approved</b></p>
<p>We also offer <b>flexible interest-free payment plans options.</b></p>
<p>After registration, we schedule a Zoom call with our coordinators to understand your goals and select the most appropriate clinical cases for your training.</p>
<p>Please see the attached PDF for detailed information of this course.</p>
<p>If you would like to discuss details or have questions, we can schedule a <b>call with our course coordinator</b> at your convenience.</p>
<p>Best regards,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>'
  ),
  (
    'Intensive + Advanced Implant',
    'email',
    'implant_course_details',
    true,
    'Intensive implant .pdf, Advanced implant course (1).pdf',
    true,
    jsonb_build_object(
      'channel', 'email',
      'subject', 'Implant Course Details – Hands-On Training',
      'has_attachment', true,
      'attachment_name', 'Intensive implant .pdf, Advanced implant course (1).pdf',
      'template_key', 'implant_course_details'
    ),
    'Hello Dr. {{salutation}}

Thank you for your interest in our Dental Implant Courses in Rio de Janeiro, Brazil.

What makes our courses different is the opportunity to gain real clinical experience with Real Patient Surgeries, One-on-One Mentorship, and training that is 100% customized to your goals and experience level.

We offer two implant courses:

INTENSIVE DENTAL IMPLANT COURSE

Designed for beginner and intermediate dentists who want to build confidence in implant placement.

• Place at least 20 implants on real patients
• You are the main surgeon from start to finish
• One-on-one mentorship throughout the clinical experience
• Cases selected according to your experience and goals

ADVANCED IMPLANT EXPERIENCE

Designed for dentists who want to advance their skills in more complex implant procedures.

• Perform complex surgeries on real patients
• Training is 100% customized to your clinical goals
• Procedures may include sinus lifts, ridge splits, GBR with implant placement, All-on-X, and other advanced cases
• One-on-one mentorship throughout your surgeries

100% CUSTOMIZED EXPERIENCE

After registration, we schedule a Zoom meeting with our coordinators to learn about your experience, goals, and the procedures you would like to focus on.

Our team then selects your patients and clinical cases specifically around those goals.

REAL PATIENT ONE-ON-ONE MENTORSHIP

During the clinical days, you are not rotating between observing, assisting, and operating. You are the main surgeon for your cases, with an experienced instructor by your side providing one-on-one guidance throughout the procedure.

Our courses are intentionally small, with a maximum of 6 participants per course, allowing us to provide a highly personalized clinical experience.

MENTORSHIP DOESN’T END WHEN THE COURSE ENDS

As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.

UPCOMING 2026 DATE

November 11 to 14, 2026 | Rio de Janeiro

TUITION

Intensive Dental Implant Course: $9,400

Advanced Implant Experience: $9,900

UPCOMING 2027 DATE

February 24 to 27, 2027 | Rio de Janeiro

TUITION

Intensive Dental Implant Course: $9,700

Advanced Implant Experience: $10,200

Early Bird: $600 OFF

Available for the February course through December 31, 2026.

YOUR COURSE PACKAGE INCLUDES

• Four-star hotel accommodations with breakfast
• Lunch during the course
• Airport, hotel, and university transportation
• Brazilian dinner on the final day
• 32 CE credits AGD PACE Approved

We also offer flexible interest-free payment plans.

Please see the attached PDF for more detailed information about each course.

If you have any questions, I’d be happy to help. I can also arrange a call with our coordinator, so you can discuss your experience, goals, and which course would be the best fit for you.

Best,

Natalia

Expert Dental Solutions',
    '<p>Hello Dr. {{salutation}}</p>
<p>Thank you for your interest in our Dental Implant Courses in Rio de Janeiro, Brazil.</p>
<p>What makes our courses different is the opportunity to gain real clinical experience with <b>Real Patient Surgeries, One-on-One Mentorship, and training that is 100% customized to your goals and experience level.</b></p>
<p>We offer two implant courses:</p>
<p><b>INTENSIVE DENTAL IMPLANT COURSE</b></p>
<p>Designed for beginner and intermediate dentists who want to build confidence in implant placement.</p>
<p>• Place <b>at least 20 implants on real patients</b><br/>
• You are the <b>main surgeon from start to finish</b><br/>
• One-on-one mentorship throughout the clinical experience<br/>
• Cases selected according to your experience and goals</p>
<p><b>ADVANCED IMPLANT EXPERIENCE</b></p>
<p>Designed for dentists who want to advance their skills in more complex implant procedures.</p>
<p>• Perform <b>complex surgeries on real patients</b><br/>
• Training is <b>100% customized to your clinical goals</b><br/>
• Procedures may include sinus lifts, ridge splits, GBR with implant placement, All-on-X, and other advanced cases<br/>
• One-on-one mentorship throughout your surgeries</p>
<p><b>100% CUSTOMIZED EXPERIENCE</b></p>
<p>After registration, we schedule a Zoom meeting with our coordinators to learn about your experience, goals, and the procedures you would like to focus on.</p>
<p>Our team then selects your patients and clinical cases specifically around those goals.</p>
<p><b>REAL PATIENT ONE-ON-ONE MENTORSHIP</b></p>
<p>During the clinical days, you are not rotating between observing, assisting, and operating. <b>You are the main surgeon for your cases</b>, with an experienced instructor by your side providing one-on-one guidance throughout the procedure.</p>
<p>Our courses are intentionally small, with a maximum of <b>6 participants per course</b>, allowing us to provide a highly personalized clinical experience.</p>
<p><b>MENTORSHIP DOESN’T END WHEN THE COURSE ENDS</b></p>
<p>As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.</p>
<p><b>UPCOMING 2026 DATE</b></p>
<p>November 11 to 14, 2026 | Rio de Janeiro</p>
<p><b>TUITION</b></p>
<p>Intensive Dental Implant Course: <b>$9,400</b></p>
<p>Advanced Implant Experience: <b>$9,900</b></p>
<p><b>UPCOMING 2027 DATE</b></p>
<p>February 24 to 27, 2027 | Rio de Janeiro</p>
<p><b>TUITION</b></p>
<p>Intensive Dental Implant Course: <b>$9,700</b></p>
<p>Advanced Implant Experience: <b>$10,200</b></p>
<p><b>Early Bird: $600 OFF</b></p>
<p>Available for the February course through December 31, 2026.</p>
<p><b>YOUR COURSE PACKAGE INCLUDES</b></p>
<p>• Four-star hotel accommodations with breakfast<br/>
• Lunch during the course<br/>
• Airport, hotel, and university transportation<br/>
• Brazilian dinner on the final day<br/>
• 32 CE credits AGD PACE Approved</p>
<p>We also offer <b>flexible interest-free payment plans.</b></p>
<p>Please see the attached PDF for more detailed information about each course.</p>
<p>If you have any questions, I’d be happy to help. I can also arrange a call with our coordinator, so you can discuss your experience, goals, and which course would be the best fit for you.</p>
<p>Best,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>'
  ),
  (
    'Wisdom',
    'email',
    'wisdom_course_details',
    true,
    'Third molar course.pdf',
    true,
    jsonb_build_object(
      'channel', 'email',
      'subject', 'Wisdom Surgery Details – Hands-On Training in Rio',
      'has_attachment', true,
      'attachment_name', 'Third molar course.pdf',
      'template_key', 'wisdom_course_details'
    ),
    'Hello Dr. {{salutation}}

Thank you for your interest in our Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!

This is a 4-day intensive clinical course with real patients, designed to give you extensive surgical experience with one-on-one mentorship throughout the entire course.

REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON

During the course, you will:

• Perform at least 16 wisdom teeth extractions on real patients
• Work with fully impacted, partially impacted, and erupted wisdom teeth
• Be the main surgeon from start to finish during all your procedures
• Receive one-on-one mentorship, with your instructor by your side throughout every procedure, assisting you while you perform the extraction
• Train with cases customized to your experience level and clinical goals

100% CUSTOMIZED TO YOUR GOALS

After registration, we schedule a Zoom meeting with our coordinators to discuss your experience, goals, and the types of cases you would like to focus on. Based on this meeting, our team selects patients and cases specifically for your training.

The course takes place at a Federal University in Rio de Janeiro, Brazil, with a maximum of 6 doctors per session to maintain a highly personalized clinical experience.

MENTORSHIP DOESN’T END WHEN THE COURSE ENDS

As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.

NEXT COURSES

November 7–10, 2026

March 1-4, 2027

TUITION

USD 8,200

YOUR COURSE PACKAGE INCLUDES

• Four-star hotel accommodation with breakfast
• Lunch during the course
• Transportation between the airport, hotel, and university
• Brazilian dinner on the final day
• 36 PACE-approved CE credits

We also offer flexible, interest-free payment plan options.

Please see the attached PDF for additional course details.

Please feel free to reach out with any questions. I’d be happy to give you a call, or we can arrange a call with one of our coordinators at your convenience.

Best,

Natalia

Expert Dental Solutions',
    '<p>Hello Dr. {{salutation}}</p>
<p>Thank you for your interest in our <b>Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!</b></p>
<p>This is a <b>4-day intensive clinical course with real patients</b>, designed to give you extensive surgical experience with <b>one-on-one mentorship throughout the entire course.</b></p>
<p><b>REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON</b></p>
<p>During the course, you will:</p>
<p>• <b>Perform at least 16 wisdom teeth extractions on real patients</b><br/>
• Work with <b>fully impacted, partially impacted, and erupted wisdom teeth</b><br/>
• Be the <b>main surgeon from start to finish</b> during all your procedures<br/>
• Receive <b>one-on-one mentorship</b>, with your instructor by your side throughout every procedure, <b>assisting you while you perform the extraction</b><br/>
• Train with cases <b>customized to your experience level and clinical goals</b></p>
<p><b>100% CUSTOMIZED TO YOUR GOALS</b></p>
<p>After registration, we schedule a <b>Zoom meeting with our coordinators</b> to discuss your experience, goals, and the types of cases you would like to focus on. Based on this meeting, our team selects patients and cases specifically for your training.</p>
<p>The course takes place at a <b>Federal University in Rio de Janeiro, Brazil</b>, with a maximum of <b>6 doctors per session</b> to maintain a highly personalized clinical experience.</p>
<p><b>MENTORSHIP DOESN’T END WHEN THE COURSE ENDS</b></p>
<p>As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.</p>
<p><b>NEXT COURSES</b></p>
<p><b>November 7–10, 2026</b></p>
<p><b>March 1-4, 2027</b></p>
<p><b>TUITION</b></p>
<p><b>USD 8,200</b></p>
<p><b>YOUR COURSE PACKAGE INCLUDES</b></p>
<p>• Four-star hotel accommodation with breakfast<br/>
• Lunch during the course<br/>
• Transportation between the airport, hotel, and university<br/>
• Brazilian dinner on the final day<br/>
• <b>36 PACE-approved CE credits</b></p>
<p>We also offer <b>flexible, interest-free payment plan options.</b></p>
<p>Please see the attached PDF for additional course details.</p>
<p>Please feel free to reach out with any questions. I’d be happy to give you a call, or we can arrange a call with one of our coordinators at your convenience.</p>
<p>Best,</p>
<p>Natalia</p>
<p><b>Expert Dental Solutions</b></p>'
  ),
  (
    'Rehabilitation',
    'email',
    'rehabilitation_course_details',
    true,
    'Oral Rehabilitation Course.pdf',
    true,
    jsonb_build_object(
      'channel', 'email',
      'subject', 'Implant Rehabilitation Course Details – Hands-On Training',
      'has_attachment', true,
      'attachment_name', 'Oral Rehabilitation Course.pdf',
      'template_key', 'rehabilitation_course_details'
    ),
    'Hi Dr. {{salutation}}

Thank you for your interest in our courses!

Our Advanced Implant Rehabilitation Experience is a four-day live-patient course designed for dentists who want to enhance their skills in implant prosthodontics, from implant uncovering to definitive restoration using both analog and digital workflows.

After registering, we will schedule a Zoom meeting with our coordinators to discuss your background, goals, and expectations, allowing us to customize your training and select the most appropriate clinical cases for your experience level. The course is fully personalized, ensuring every participant gets the most out of the program.

Our courses are highly exclusive, with a maximum of six doctors per session, providing individualized one-on-one mentorship throughout the clinical experience.

During the course, you will gain hands-on experience with:

• Implant uncovering and peri-implant soft tissue management
• Conventional implant impressions
• Digital intraoral scanning
• Single, multiple, and full-arch implant restorations
• Prosthetic try-in, occlusion, and definitive restoration delivery

The course is held at the Fluminense Federal University School of Dentistry in Rio de Janeiro, where participants treat real patients under faculty supervision.

Upcoming Course Date:

• November 7 to 10, 2026, Rio de Janeiro

Tuition:

• USD 9,600

Our course includes:

• Four-star hotel accommodation with breakfast (5 nights)
• Lunch during the course
• Round-trip airport transfers
• Daily transportation between the hotel and the university
• Brazilian dinner on the final day

Our course offers 36 CE Credits and is PACE Approved.

We also offer flexible interest-free payment plan options.

Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, at your convenience.

Best regards,

Natalia

Expert Dental Solutions',
    '<p>Hi Dr. {{salutation}}</p>
<p>Thank you for your interest in our courses!</p>
<p>Our <b>Advanced Implant Rehabilitation Experience</b> is a four-day live-patient course designed for dentists who want to enhance their skills in implant prosthodontics, from implant uncovering to definitive restoration using both analog and digital workflows.</p>
<p>After registering, we will schedule a Zoom meeting with our coordinators to discuss your background, goals, and expectations, allowing us to customize your training and select the most appropriate clinical cases for your experience level. The course is fully personalized, ensuring every participant gets the most out of the program.</p>
<p>Our courses are highly exclusive, with a maximum of six doctors per session, providing individualized one-on-one mentorship throughout the clinical experience.</p>
<p>During the course, you will gain hands-on experience with:</p>
<p>• Implant uncovering and peri-implant soft tissue management<br/>
• Conventional implant impressions<br/>
• Digital intraoral scanning<br/>
• Single, multiple, and full-arch implant restorations<br/>
• Prosthetic try-in, occlusion, and definitive restoration delivery</p>
<p>The course is held at the Fluminense Federal University School of Dentistry in Rio de Janeiro, where participants treat real patients under faculty supervision.</p>
<p>Upcoming Course Date:</p>
<p>• November 7 to 10, 2026, Rio de Janeiro</p>
<p>Tuition:</p>
<p>• USD 9,600</p>
<p>Our course includes:</p>
<p>• Four-star hotel accommodation with breakfast (5 nights)<br/>
• Lunch during the course<br/>
• Round-trip airport transfers<br/>
• Daily transportation between the hotel and the university<br/>
• Brazilian dinner on the final day</p>
<p>Our course offers <b>36 CE Credits</b> and is <b>PACE Approved.</b></p>
<p>We also offer flexible interest-free payment plan options.</p>
<p>Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, at your convenience.</p>
<p>Best regards,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>'
  )
ON CONFLICT (name) DO UPDATE SET
  category = EXCLUDED.category,
  template_key = EXCLUDED.template_key,
  has_attachment = EXCLUDED.has_attachment,
  attachment_name = EXCLUDED.attachment_name,
  is_active = true,
  content_json = EXCLUDED.content_json,
  text_template = EXCLUDED.text_template,
  html_template = EXCLUDED.html_template,
  updated_at = now();
