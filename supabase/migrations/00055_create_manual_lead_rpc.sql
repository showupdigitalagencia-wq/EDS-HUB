-- =============================================================================
-- Migration 00055: Create Atomic Manual Lead Creation RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_lead(
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_contact_preference TEXT DEFAULT 'email',
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
  v_target_stage_id UUID := p_stage_id;
  v_item JSONB;
  v_interest_count INT := 0;
  v_clean_email TEXT;
  v_clean_phone TEXT;
  v_phone_e164 TEXT;
  v_session_course_id UUID;
  v_priority INT;
  v_course_id UUID;
  v_course_session_id UUID;
  v_tag_id UUID;
BEGIN
  -- 1. Security Check: Must be active app user
  IF NOT public.is_active_app_user() THEN
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

  -- 3. Resolve stage: Default to Novo Lead (code = 'capture') if not specified
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
    -- Verify target stage exists
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_target_stage_id) THEN
      RAISE EXCEPTION 'Invalid pipeline stage ID: %', v_target_stage_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 4. Validate phone format (e164 helper if starts with +)
  IF v_clean_phone IS NOT NULL AND v_clean_phone ~ '^\+[1-9][0-9]{7,14}$' THEN
    v_phone_e164 := v_clean_phone;
  ELSE
    v_phone_e164 := NULL;
  END IF;

  -- 5. Validate contact preference constraint (safe internal default 'email')
  IF p_contact_preference NOT IN ('email', 'sms', 'call') THEN
    p_contact_preference := 'email';
  END IF;

  -- 6. Validate Interests count <= 3
  IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' THEN
    v_interest_count := jsonb_array_length(p_interests);
    IF v_interest_count > 3 THEN
      RAISE EXCEPTION 'A lead can have at most 3 prioritized course interests (received %)', v_interest_count
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 7. Insert into public.leads (source = 'manual' ensures no Meta automation triggers)
  INSERT INTO public.leads (
    first_name,
    last_name,
    email,
    phone_raw,
    phone_e164,
    contact_preference,
    pipeline_stage_id,
    referred_by,
    source,
    source_detail
  ) VALUES (
    NULLIF(TRIM(p_first_name), ''),
    NULLIF(TRIM(p_last_name), ''),
    v_clean_email,
    v_clean_phone,
    v_phone_e164,
    p_contact_preference,
    v_target_stage_id,
    NULLIF(TRIM(p_referred_by), ''),
    'manual',
    'manual_crm_entry'
  )
  RETURNING id INTO v_lead_id;

  -- 8. Insert stage history
  INSERT INTO public.lead_stage_history (
    lead_id,
    from_stage_id,
    to_stage_id,
    change_reason
  ) VALUES (
    v_lead_id,
    NULL,
    v_target_stage_id,
    'initial_assignment'
  );

  -- 9. Insert activity audit record
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    v_lead_id,
    'lead_created',
    'user',
    'Lead manually created in CRM',
    jsonb_build_object(
      'source', 'manual',
      'referred_by', NULLIF(TRIM(p_referred_by), ''),
      'interests_count', v_interest_count
    )
  );

  -- 10. Process and insert course interests (atomic validation)
  IF v_interest_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_interests)
    LOOP
      v_priority := (v_item->>'priority')::int;
      v_course_id := (v_item->>'course_id')::uuid;
      v_course_session_id := NULLIF(v_item->>'course_session_id', '')::uuid;

      -- Validate priority is 1, 2, or 3
      IF v_priority IS NULL OR v_priority NOT IN (1, 2, 3) THEN
        RAISE EXCEPTION 'Course interest priority must be 1, 2, or 3 (received %)', v_priority
          USING ERRCODE = '22023';
      END IF;

      -- Validate course exists
      IF v_course_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.courses WHERE id = v_course_id) THEN
        RAISE EXCEPTION 'Course % does not exist', v_course_id
          USING ERRCODE = '22023';
      END IF;

      -- Validate course_session belongs to course (CORRECTION 5)
      IF v_course_session_id IS NOT NULL THEN
        SELECT course_id INTO v_session_course_id
        FROM public.course_sessions
        WHERE id = v_course_session_id;

        IF v_session_course_id IS NULL THEN
          RAISE EXCEPTION 'Course session % does not exist', v_course_session_id
            USING ERRCODE = '22023';
        END IF;

        IF v_session_course_id <> v_course_id THEN
          RAISE EXCEPTION 'Course session % belongs to course %, not selected course %',
            v_course_session_id, v_session_course_id, v_course_id
            USING ERRCODE = '22023';
        END IF;
      END IF;

      -- Insert into lead_course_interests
      INSERT INTO public.lead_course_interests (
        lead_id,
        course_id,
        course_session_id,
        priority
      ) VALUES (
        v_lead_id,
        v_course_id,
        v_course_session_id,
        v_priority
      );
    END LOOP;
  END IF;

  -- 11. Attach tags if provided
  IF p_tags IS NOT NULL AND array_length(p_tags, 1) > 0 THEN
    FOREACH v_tag_id IN ARRAY p_tags
    LOOP
      IF EXISTS (SELECT 1 FROM public.tags WHERE id = v_tag_id) THEN
        INSERT INTO public.lead_tags (lead_id, tag_id)
        VALUES (v_lead_id, v_tag_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- 12. Return success
  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id
  );
END;
$$;

-- Security / Permissions
REVOKE ALL ON FUNCTION public.create_manual_lead(text, text, text, text, text, uuid, text, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_lead(text, text, text, text, text, uuid, text, jsonb, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_manual_lead IS
  'Atomically creates a manual lead, initial stage history, activity record, up to 3 validated course interests with course session integrity, and optional tags.';
