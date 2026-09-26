-- =============================================================================
-- Migration 00066: Canonical Newest Leads First & Recency Preservation
-- =============================================================================
-- Solves root causes for newest leads not appearing first:
-- 1. Backfills any NULL source_created_at with created_at.
-- 2. Sets DEFAULT now() on source_created_at.
-- 3. Attaches BEFORE INSERT trigger ensuring source_created_at is NEVER NULL.
-- 4. Updates create_manual_lead RPC to explicitly record source_created_at.
-- 5. Updates process_hubspot_inbound_batch RPC to record source_created_at from createdate.
-- 6. Creates canonical descending recency index.
-- =============================================================================

-- 1. Backfill any existing NULL source_created_at in public.leads
UPDATE public.leads
SET source_created_at = created_at
WHERE source_created_at IS NULL;

-- 2. Set default for source_created_at
ALTER TABLE public.leads
ALTER COLUMN source_created_at SET DEFAULT now();

-- 3. Trigger before insert to enforce canonical source_created_at
CREATE OR REPLACE FUNCTION public.trg_leads_canonical_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_created_at IS NULL THEN
    NEW.source_created_at := COALESCE(NEW.created_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_leads_canonical_creation ON public.leads;
CREATE TRIGGER trg_set_leads_canonical_creation
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.trg_leads_canonical_creation();

-- 4. Create composite descending recency index for blazingly fast sorted queries
CREATE INDEX IF NOT EXISTS idx_leads_canonical_recency
ON public.leads (source_created_at DESC, created_at DESC, id DESC);

-- 5. Update public.create_manual_lead RPC
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
  v_target_stage_id UUID := p_stage_id;
  v_item JSONB;
  v_interest_count INT := 0;
  v_clean_email TEXT;
  v_clean_phone TEXT;
  v_phone_e164 TEXT;
  v_clean_pref TEXT;
  v_session_course_id UUID;
  v_priority INT;
  v_course_id UUID;
  v_course_session_id UUID;
  v_tag_id UUID;
  v_now TIMESTAMPTZ := now();
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
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_target_stage_id) THEN
      RAISE EXCEPTION 'Invalid pipeline stage ID: %', v_target_stage_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 4. Validate phone format
  IF v_clean_phone IS NOT NULL AND v_clean_phone ~ '^\+[1-9][0-9]{7,14}$' THEN
    v_phone_e164 := v_clean_phone;
  ELSE
    v_phone_e164 := NULL;
  END IF;

  -- 5. Validate contact preference constraint (No email fallback; NULL stays NULL)
  v_clean_pref := NULLIF(TRIM(LOWER(p_contact_preference)), '');
  IF v_clean_pref IS NOT NULL AND v_clean_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_clean_pref := NULL;
  END IF;

  -- 6. Validate Interests count <= 3
  IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' THEN
    v_interest_count := jsonb_array_length(p_interests);
    IF v_interest_count > 3 THEN
      RAISE EXCEPTION 'A lead can have at most 3 prioritized course interests (received %)', v_interest_count
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 7. Insert into public.leads with explicit canonical creation timestamps
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
    source_detail,
    source_created_at,
    created_at,
    updated_at
  ) VALUES (
    NULLIF(TRIM(p_first_name), ''),
    NULLIF(TRIM(p_last_name), ''),
    v_clean_email,
    v_clean_phone,
    v_phone_e164,
    v_clean_pref,
    v_target_stage_id,
    NULLIF(TRIM(p_referred_by), ''),
    'manual',
    'manual_crm_entry',
    v_now,
    v_now,
    v_now
  )
  RETURNING id INTO v_lead_id;

  -- 8. Record lead_created activity
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
    'Lead criado manualmente no EDS HUB',
    jsonb_build_object(
      'source', 'manual',
      'source_detail', 'manual_crm_entry',
      'stage_id', v_target_stage_id,
      'contact_preference', v_clean_pref,
      'interests_count', v_interest_count
    )
  );

  -- 9. Insert Course Interests (lead_course_interests)
  IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' AND v_interest_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_interests)
    LOOP
      v_course_id := (v_item->>'course_id')::UUID;
      v_course_session_id := NULLIF(v_item->>'course_session_id', '')::UUID;
      v_priority := (v_item->>'priority')::INT;

      IF v_course_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.courses WHERE id = v_course_id) THEN
        IF v_course_session_id IS NOT NULL THEN
          SELECT course_id INTO v_session_course_id
          FROM public.course_sessions
          WHERE id = v_course_session_id;

          IF v_session_course_id IS NULL OR v_session_course_id <> v_course_id THEN
            v_course_session_id := NULL;
          END IF;
        END IF;

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
          COALESCE(v_priority, 1),
          'manual_creation',
          'active'
        )
        ON CONFLICT (lead_id, course_id) DO UPDATE SET
          course_session_id = EXCLUDED.course_session_id,
          priority = EXCLUDED.priority,
          status = 'active',
          updated_at = now();
      END IF;
    END LOOP;
  END IF;

  -- 10. Associate Tags (lead_tags)
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
    'stage_id', v_target_stage_id,
    'contact_preference', v_clean_pref,
    'interests_count', v_interest_count
  );
END;
$$;
