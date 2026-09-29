-- Migration 00085: Safe priority allocation in create_manual_lead
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_lead(
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_contact_preference TEXT DEFAULT NULL,
  p_stage_id UUID DEFAULT NULL,
  p_referred_by TEXT DEFAULT NULL,
  p_interests JSONB DEFAULT '[]'::jsonb,
  p_tags UUID[] DEFAULT '{}'::uuid[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead_id UUID;
  v_matched_lead_id UUID := NULL;
  v_target_stage_id UUID := p_stage_id;
  v_item JSONB;
  v_interest_count INT := 0;
  v_clean_email TEXT;
  v_clean_phone TEXT;
  v_phone_digits TEXT;
  v_phone_e164 TEXT;
  v_clean_pref TEXT;
  v_session_course_id UUID;
  v_course_id UUID;
  v_course_session_id UUID;
  v_course_name TEXT;
  v_tag_id UUID;
  v_now TIMESTAMPTZ := now();
  v_existing_lead RECORD;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_existing_course_priority INT;
  v_target_priority INT;
BEGIN
  -- 1. Security Check: Must be active app user or service_role
  IF auth.role() <> 'service_role' AND NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active EDS HUB app user'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate essential identity
  v_clean_email := NULLIF(TRIM(LOWER(p_email)), '');
  v_clean_phone := NULLIF(TRIM(p_phone), '');

  IF NULLIF(TRIM(p_first_name), '') IS NULL 
     AND NULLIF(TRIM(p_last_name), '') IS NULL 
     AND v_clean_email IS NULL 
     AND v_clean_phone IS NULL THEN
    RAISE EXCEPTION 'At least a name, email, or phone number must be provided for manual lead creation'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Extract phone digits for matching
  IF v_clean_phone IS NOT NULL THEN
    v_phone_digits := regexp_replace(v_clean_phone, '\D', '', 'g');
    IF v_clean_phone ~ '^\+[1-9][0-9]{7,14}$' THEN
      v_phone_e164 := v_clean_phone;
    ELSIF length(v_phone_digits) = 10 THEN
      v_phone_e164 := '+1' || v_phone_digits;
    ELSIF length(v_phone_digits) = 11 AND v_phone_digits LIKE '1%' THEN
      v_phone_e164 := '+' || v_phone_digits;
    ELSE
      v_phone_e164 := '+' || v_phone_digits;
    END IF;
  ELSE
    v_phone_digits := NULL;
    v_phone_e164 := NULL;
  END IF;

  -- 4. Validate contact preference constraint (No email fallback; NULL stays NULL)
  v_clean_pref := NULLIF(TRIM(LOWER(p_contact_preference)), '');
  IF v_clean_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_clean_pref := NULL;
  END IF;

  -- 5. Validate Interests count <= 3
  IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' THEN
    v_interest_count := jsonb_array_length(p_interests);
    IF v_interest_count > 3 THEN
      RAISE EXCEPTION 'A lead can have at most 3 prioritized course interests (received %)', v_interest_count
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 6. Canonical Deduplication Check (Priority: Email -> Phone)
  IF v_clean_email IS NOT NULL THEN
    SELECT id INTO v_matched_lead_id
    FROM public.leads
    WHERE lower(trim(email)) = v_clean_email
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_matched_lead_id IS NULL AND v_phone_digits IS NOT NULL AND length(v_phone_digits) >= 8 THEN
    SELECT id INTO v_matched_lead_id
    FROM public.leads
    WHERE regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone_digits
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 7. Execute Upsert / Non-destructive Lead Creation
  IF v_matched_lead_id IS NOT NULL THEN
    -- MATCHED EXISTING LEAD: Non-destructive update & resurface to top of stage
    v_lead_id := v_matched_lead_id;

    SELECT course_interest, course_interests, contact_preference, pipeline_stage_id, first_name, last_name, email, phone_raw, phone_e164
    INTO v_existing_lead
    FROM public.leads
    WHERE id = v_lead_id;

    v_merged_course_interests := COALESCE(v_existing_lead.course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_lead.course_interest;

    -- Merge incoming course interests into JSON array
    IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' AND v_interest_count > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_interests)
      LOOP
        v_course_id := (v_item->>'course_id')::UUID;
        IF v_course_id IS NOT NULL THEN
          SELECT name INTO v_course_name FROM public.courses WHERE id = v_course_id;
          IF v_course_name IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
              WHERE lower(trim(elem)) = lower(trim(v_course_name))
                 OR (lower(v_course_name) LIKE '%zygoma%' AND lower(trim(elem)) LIKE '%zygoma%')
                 OR (lower(v_course_name) LIKE '%wisdom%' AND lower(trim(elem)) LIKE '%wisdom%')
                 OR (lower(v_course_name) LIKE '%endo%' AND lower(trim(elem)) LIKE '%endo%')
                 OR (lower(v_course_name) LIKE '%perio%' AND lower(trim(elem)) LIKE '%perio%')
                 OR (lower(v_course_name) LIKE '%rehab%' AND lower(trim(elem)) LIKE '%rehab%')
            ) THEN
              v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_name);
              IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
                v_merged_course_interest := v_course_name;
              ELSE
                v_merged_course_interest := v_merged_course_interest || ', ' || v_course_name;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- Update lead: PRESERVES created_at! PRESERVES pipeline_stage_id unless p_stage_id explicitly provided!
    -- PRESERVES contact_preference if incoming manual value is null!
    UPDATE public.leads
    SET
      first_name = COALESCE(NULLIF(TRIM(p_first_name), ''), first_name),
      last_name = COALESCE(NULLIF(TRIM(p_last_name), ''), last_name),
      email = COALESCE(v_clean_email, email),
      phone_raw = COALESCE(v_clean_phone, phone_raw),
      phone_e164 = COALESCE(v_phone_e164, phone_e164),
      contact_preference = COALESCE(v_clean_pref, contact_preference),
      pipeline_stage_id = COALESCE(p_stage_id, pipeline_stage_id),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_inbound_activity_at = v_now,
      updated_at = v_now
    WHERE id = v_lead_id;

    -- Record activity
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_lead_id, 'lead_field_updated', 'user',
      'Lead atualizado manualmente no EDS HUB (dados complementares)',
      jsonb_build_object(
        'source', 'manual',
        'is_existing', true,
        'contact_preference', COALESCE(v_clean_pref, v_existing_lead.contact_preference),
        'interests_count', v_interest_count
      )
    );
  ELSE
    -- BRAND NEW LEAD: Resolve default stage
    IF v_target_stage_id IS NULL THEN
      SELECT id INTO v_target_stage_id
      FROM public.pipeline_stages
      WHERE code = 'capture'
      LIMIT 1;

      IF v_target_stage_id IS NULL THEN
        SELECT id INTO v_target_stage_id
        FROM public.pipeline_stages
        ORDER BY sort_order ASC
        LIMIT 1;
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_target_stage_id) THEN
        RAISE EXCEPTION 'Invalid pipeline stage ID: %', v_target_stage_id
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Build initial course interests from p_interests
    v_merged_course_interests := '[]'::jsonb;
    v_merged_course_interest := NULL;
    IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' AND v_interest_count > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_interests)
      LOOP
        v_course_id := (v_item->>'course_id')::UUID;
        IF v_course_id IS NOT NULL THEN
          SELECT name INTO v_course_name FROM public.courses WHERE id = v_course_id;
          IF v_course_name IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
              WHERE lower(trim(elem)) = lower(trim(v_course_name))
            ) THEN
              v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_name);
              IF v_merged_course_interest IS NULL THEN
                v_merged_course_interest := v_course_name;
              ELSE
                v_merged_course_interest := v_merged_course_interest || ', ' || v_course_name;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- Insert into public.leads with explicit canonical creation timestamps
    INSERT INTO public.leads (
      first_name,
      last_name,
      email,
      phone_raw,
      phone_e164,
      contact_preference,
      course_interest,
      course_interests,
      pipeline_stage_id,
      referred_by,
      source,
      source_detail,
      source_created_at,
      last_inbound_activity_at,
      created_at,
      updated_at
    ) VALUES (
      NULLIF(TRIM(p_first_name), ''),
      NULLIF(TRIM(p_last_name), ''),
      v_clean_email,
      v_clean_phone,
      v_phone_e164,
      v_clean_pref,
      v_merged_course_interest,
      v_merged_course_interests,
      v_target_stage_id,
      NULLIF(TRIM(p_referred_by), ''),
      'manual',
      'manual_crm_entry',
      v_now,
      v_now,
      v_now,
      v_now
    )
    RETURNING id INTO v_lead_id;

    -- Record lead_created activity
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_lead_id, 'lead_created', 'user',
      'Lead criado manualmente no EDS HUB',
      jsonb_build_object(
        'source', 'manual',
        'source_detail', 'manual_crm_entry',
        'stage_id', v_target_stage_id,
        'contact_preference', v_clean_pref,
        'interests_count', v_interest_count
      )
    );
  END IF;

  -- 8. Insert Course Interests into relational store (lead_course_interests)
  IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' AND v_interest_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_interests)
    LOOP
      v_course_id := (v_item->>'course_id')::UUID;
      v_course_session_id := NULLIF(v_item->>'course_session_id', '')::UUID;

      IF v_course_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.courses WHERE id = v_course_id) THEN
        IF v_course_session_id IS NOT NULL THEN
          SELECT course_id INTO v_session_course_id
          FROM public.course_sessions
          WHERE id = v_course_session_id;

          IF v_session_course_id IS NULL OR v_session_course_id <> v_course_id THEN
            v_course_session_id := NULL;
          END IF;
        END IF;

        -- Check if (lead_id, course_id) already exists to preserve its priority
        SELECT priority INTO v_existing_course_priority
        FROM public.lead_course_interests
        WHERE lead_id = v_lead_id AND course_id = v_course_id;

        IF v_existing_course_priority IS NOT NULL THEN
          v_target_priority := v_existing_course_priority;
        ELSE
          -- Assign lowest available priority from (1, 2, 3) not yet used by this lead
          SELECT min(p) INTO v_target_priority
          FROM unnest(ARRAY[1, 2, 3]) AS p
          WHERE p NOT IN (
            SELECT priority FROM public.lead_course_interests
            WHERE lead_id = v_lead_id AND priority IS NOT NULL
          );
        END IF;

        -- Safe ON CONFLICT using the verified unique index
        INSERT INTO public.lead_course_interests (
          lead_id,
          course_id,
          course_session_id,
          priority,
          source,
          status
        ) VALUES (
          v_lead_id,
          v_course_id,
          v_course_session_id,
          v_target_priority,
          'manual',
          'active'
        )
        ON CONFLICT (lead_id, course_id) DO UPDATE SET
          course_session_id = COALESCE(EXCLUDED.course_session_id, lead_course_interests.course_session_id),
          status = 'active',
          updated_at = now();
      END IF;
    END LOOP;
  END IF;

  -- 9. Associate Tags (lead_tags)
  IF p_tags IS NOT NULL AND cardinality(p_tags) > 0 THEN
    FOREACH v_tag_id IN ARRAY p_tags
    LOOP
      IF EXISTS (SELECT 1 FROM public.tags WHERE id = v_tag_id) THEN
        INSERT INTO public.lead_tags (lead_id, tag_id)
        VALUES (v_lead_id, v_tag_id)
        ON CONFLICT (lead_id, tag_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id,
    'is_existing', v_matched_lead_id IS NOT NULL,
    'stage_id', v_target_stage_id,
    'contact_preference', v_clean_pref,
    'interests_count', v_interest_count
  );
END;
$$;
