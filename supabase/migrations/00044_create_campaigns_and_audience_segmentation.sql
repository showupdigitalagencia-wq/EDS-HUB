-- =============================================================================
-- Migration 00044: Phase 5 Block 3 - Campaigns & Audience Segmentation 2.0
-- =============================================================================
-- 1. Create public.saved_segments table with RLS
-- 2. Expand public.campaigns channel check to ('email', 'sms', 'call')
-- 3. Extend public.campaign_audiences with snapshot freezing fields
-- 4. Extend public.campaign_recipients with multi-channel, eligibility & exclusion audit
-- 5. Extend public.tasks task_source check to include 'campaign' and add campaign_id
-- 6. Canonical Server-Side RPC: preview_audience_segment
-- 7. Canonical Server-Side RPC: prepare_campaign_audience_snapshot (NO TASKS CREATED)
-- 8. Canonical Server-Side RPC: activate_call_campaign (IDEMPOTENT TASK CREATION)
-- 9. Performance Indexes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Create public.saved_segments Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  filter_definition JSONB NOT NULL DEFAULT '{"version": 1, "operator": "and", "conditions": []}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saved_segments IS
  'Reusable, versionable audience filter definitions evaluated dynamically server-side.';

CREATE INDEX IF NOT EXISTS idx_saved_segments_active 
  ON public.saved_segments(is_active);

CREATE INDEX IF NOT EXISTS idx_saved_segments_name 
  ON public.saved_segments(lower(name));

-- Enable RLS
ALTER TABLE public.saved_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_segments_select_active" ON public.saved_segments;
CREATE POLICY "saved_segments_select_active" ON public.saved_segments
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

DROP POLICY IF EXISTS "saved_segments_all_active" ON public.saved_segments;
CREATE POLICY "saved_segments_all_active" ON public.saved_segments
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());


-- -----------------------------------------------------------------------------
-- 2. Expand public.campaigns Channel Check Constraint & Add activated_at
-- -----------------------------------------------------------------------------
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_channel_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_channel_check
  CHECK (channel IN ('email', 'sms', 'call'));

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL;


-- -----------------------------------------------------------------------------
-- 3. Extend public.campaign_audiences for Snapshot Freezing & Metadata
-- -----------------------------------------------------------------------------
ALTER TABLE public.campaign_audiences
  ADD COLUMN IF NOT EXISTS saved_segment_id UUID NULL REFERENCES public.saved_segments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot_frozen_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS snapshot_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_matched_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligible_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excluded_count INTEGER NOT NULL DEFAULT 0;


-- -----------------------------------------------------------------------------
-- 4. Extend public.campaign_recipients for Multi-Channel, Eligibility & Exclusion Audit
-- -----------------------------------------------------------------------------
-- Allow email to be nullable when channel is 'sms' or 'call' or for excluded leads
ALTER TABLE public.campaign_recipients
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT NULL,
  ADD COLUMN IF NOT EXISTS is_eligible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_stage_id UUID NULL REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot_lead_score INTEGER NULL,
  ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Channel check constraint on campaign_recipients
ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_channel_check;

ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_channel_check
  CHECK (channel IN ('email', 'sms', 'call'));

-- Align uniqueness to (campaign_id, lead_id)
ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS uq_campaign_recipient_email;

ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS uq_campaign_recipient_lead;

ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT uq_campaign_recipient_lead
  UNIQUE (campaign_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_eligible 
  ON public.campaign_recipients(campaign_id, is_eligible);


-- -----------------------------------------------------------------------------
-- 5. Extend public.tasks with 'campaign' Source and campaign_id Link
-- -----------------------------------------------------------------------------
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_source_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_source_check
  CHECK (task_source IN ('manual', 'automation', 'system', 'course_operations', 'post_course', 'campaign'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS campaign_id UUID NULL REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_campaign_lead 
  ON public.tasks(campaign_id, lead_id) 
  WHERE campaign_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 6. RPC: preview_audience_segment
-- -----------------------------------------------------------------------------
-- Evaluates structured JSON DSL conditions server-side, calculates eligibility
-- per channel and contact preference, and returns counts + sample leads.
CREATE OR REPLACE FUNCTION public.preview_audience_segment(
  p_filters JSONB,
  p_channel TEXT,
  p_include_test BOOLEAN DEFAULT false,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_matched INT := 0;
  v_eligible_count INT := 0;
  v_excluded_count INT := 0;
  v_cnt_test INT := 0;
  v_cnt_no_pref INT := 0;
  v_cnt_pref_mismatch INT := 0;
  v_cnt_missing_email INT := 0;
  v_cnt_missing_phone INT := 0;
  v_leads_json JSONB := '[]'::jsonb;
  
  -- Filter variables extracted from p_filters
  v_stages JSONB;
  v_sources JSONB;
  v_qual_statuses JSONB;
  v_min_score INT;
  v_max_score INT;
  v_days_inactivity INT;
  v_enrolled_course_id UUID;
  v_not_enrolled_course_id UUID;
  v_completed_course_id UUID;
  v_repeat_student BOOLEAN;
  v_has_balance BOOLEAN;
  v_course_interest_id UUID;
  v_contact_preferences JSONB;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Caller is not an active app user.';
  END IF;

  IF p_channel NOT IN ('email', 'sms', 'call') THEN
    RAISE EXCEPTION 'Invalid campaign channel: %. Must be email, sms, or call.', p_channel;
  END IF;

  -- Extract filter parameters
  v_stages := p_filters->'stages';
  v_sources := p_filters->'sources';
  v_qual_statuses := p_filters->'qualification_statuses';
  v_min_score := (p_filters->>'min_score')::INT;
  v_max_score := (p_filters->>'max_score')::INT;
  v_days_inactivity := (p_filters->>'days_since_last_activity')::INT;
  
  IF p_filters->>'enrolled_course_id' IS NOT NULL AND (p_filters->>'enrolled_course_id') != '' THEN
    v_enrolled_course_id := (p_filters->>'enrolled_course_id')::UUID;
  END IF;

  IF p_filters->>'not_enrolled_course_id' IS NOT NULL AND (p_filters->>'not_enrolled_course_id') != '' THEN
    v_not_enrolled_course_id := (p_filters->>'not_enrolled_course_id')::UUID;
  END IF;

  IF p_filters->>'completed_course_id' IS NOT NULL AND (p_filters->>'completed_course_id') != '' THEN
    v_completed_course_id := (p_filters->>'completed_course_id')::UUID;
  END IF;

  IF p_filters->>'repeat_student' IS NOT NULL THEN
    v_repeat_student := (p_filters->>'repeat_student')::BOOLEAN;
  END IF;

  IF p_filters->>'has_outstanding_balance' IS NOT NULL THEN
    v_has_balance := (p_filters->>'has_outstanding_balance')::BOOLEAN;
  END IF;

  IF p_filters->>'course_interest_id' IS NOT NULL AND (p_filters->>'course_interest_id') != '' THEN
    v_course_interest_id := (p_filters->>'course_interest_id')::UUID;
  END IF;

  v_contact_preferences := p_filters->'contact_preferences';

  -- Temporary table of matched leads with eligibility calculation
  DROP TABLE IF EXISTS temp_matched_leads;
  CREATE TEMP TABLE temp_matched_leads ON COMMIT DROP AS
  SELECT 
    l.id,
    l.first_name,
    l.last_name,
    l.email,
    COALESCE(l.phone_e164, l.phone_raw) AS phone,
    l.source,
    l.contact_preference,
    l.pipeline_stage_id,
    ps.name AS stage_name,
    ps.key AS stage_key,
    l.lead_score,
    l.created_at,
    -- Strict Canonical Eligibility Determination
    CASE
      WHEN l.source = 'test' THEN false
      WHEN l.contact_preference IS NULL OR trim(l.contact_preference) = '' THEN false
      WHEN l.contact_preference != p_channel THEN false
      WHEN p_channel = 'email' AND (l.email IS NULL OR trim(l.email) = '') THEN false
      WHEN p_channel IN ('sms', 'call') AND COALESCE(l.phone_e164, l.phone_raw) IS NULL THEN false
      ELSE true
    END AS is_eligible,
    -- Canonical Exclusion Reason
    CASE
      WHEN l.source = 'test' THEN 'TEST_SOURCE'
      WHEN l.contact_preference IS NULL OR trim(l.contact_preference) = '' THEN 'NO_VALID_CONTACT_PREFERENCE'
      WHEN l.contact_preference != p_channel THEN 'CHANNEL_PREFERENCE_MISMATCH'
      WHEN p_channel = 'email' AND (l.email IS NULL OR trim(l.email) = '') THEN 'MISSING_EMAIL'
      WHEN p_channel IN ('sms', 'call') AND COALESCE(l.phone_e164, l.phone_raw) IS NULL THEN 'MISSING_PHONE'
      ELSE NULL
    END AS exclusion_reason
  FROM public.leads l
  LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
  WHERE 
    -- 1. Stage filter
    (v_stages IS NULL OR jsonb_array_length(v_stages) = 0 OR 
      ps.key = ANY (SELECT jsonb_array_elements_text(v_stages)) OR
      l.pipeline_stage_id::text = ANY (SELECT jsonb_array_elements_text(v_stages)))
    -- 2. Source filter
    AND (v_sources IS NULL OR jsonb_array_length(v_sources) = 0 OR 
      l.source = ANY (SELECT jsonb_array_elements_text(v_sources)))
    -- 3. Qualification status filter
    AND (v_qual_statuses IS NULL OR jsonb_array_length(v_qual_statuses) = 0 OR 
      l.qualification_status = ANY (SELECT jsonb_array_elements_text(v_qual_statuses)))
    -- 4. Lead score range
    AND (v_min_score IS NULL OR l.lead_score >= v_min_score)
    AND (v_max_score IS NULL OR l.lead_score <= v_max_score)
    -- 5. Meaningful commercial inactivity
    AND (v_days_inactivity IS NULL OR 
      public.get_lead_last_meaningful_activity_at(l.id) <= now() - (v_days_inactivity || ' days')::interval)
    -- 6. Enrolled course (independent EXISTS)
    AND (v_enrolled_course_id IS NULL OR EXISTS (
      SELECT 1 FROM public.enrollments e 
      WHERE e.lead_id = l.id AND e.course_id = v_enrolled_course_id AND e.enrollment_status = 'confirmed'
    ))
    -- 7. Not enrolled course (independent NOT EXISTS)
    AND (v_not_enrolled_course_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.enrollments e 
      WHERE e.lead_id = l.id AND e.course_id = v_not_enrolled_course_id AND e.enrollment_status = 'confirmed'
    ))
    -- 8. Completed course
    AND (v_completed_course_id IS NULL OR EXISTS (
      SELECT 1 FROM public.enrollments e 
      JOIN public.course_participations p ON p.enrollment_id = e.id
      WHERE e.lead_id = l.id AND e.course_id = v_completed_course_id AND p.attendance_status = 'completed'
    ))
    -- 9. Repeat student (>= 2 confirmed enrollments)
    AND (v_repeat_student IS NULL OR (
      (SELECT COUNT(*) >= 2 FROM public.enrollments e2 WHERE e2.lead_id = l.id AND e2.enrollment_status = 'confirmed') = v_repeat_student
    ))
    -- 10. Future course interest
    AND (v_course_interest_id IS NULL OR EXISTS (
      SELECT 1 FROM public.lead_course_interests i 
      WHERE i.lead_id = l.id AND i.course_id = v_course_interest_id AND i.status = 'active'
    ))
    -- 11. Outstanding balance (canonical formula: agreed - paid payments + paid refunds > 0)
    AND (v_has_balance IS NULL OR (
      EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.lead_id = l.id AND e.enrollment_status = 'confirmed'
          AND (
            e.agreed_amount - 
            COALESCE((SELECT SUM(p.amount) FROM public.enrollment_payments p WHERE p.enrollment_id = e.id AND p.payment_type = 'payment' AND p.payment_status = 'paid'), 0) +
            COALESCE((SELECT SUM(r.amount) FROM public.enrollment_payments r WHERE r.enrollment_id = e.id AND r.payment_type = 'refund' AND r.payment_status = 'paid'), 0)
          ) > 0
      ) = v_has_balance
    ))
    -- 12. Contact preference filter
    AND (v_contact_preferences IS NULL OR jsonb_array_length(v_contact_preferences) = 0 OR 
      l.contact_preference = ANY (SELECT jsonb_array_elements_text(v_contact_preferences)));

  -- Aggregate counts
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE is_eligible = true),
    COUNT(*) FILTER (WHERE is_eligible = false),
    COUNT(*) FILTER (WHERE exclusion_reason = 'TEST_SOURCE'),
    COUNT(*) FILTER (WHERE exclusion_reason = 'NO_VALID_CONTACT_PREFERENCE'),
    COUNT(*) FILTER (WHERE exclusion_reason = 'CHANNEL_PREFERENCE_MISMATCH'),
    COUNT(*) FILTER (WHERE exclusion_reason = 'MISSING_EMAIL'),
    COUNT(*) FILTER (WHERE exclusion_reason = 'MISSING_PHONE')
  INTO 
    v_total_matched,
    v_eligible_count,
    v_excluded_count,
    v_cnt_test,
    v_cnt_no_pref,
    v_cnt_pref_mismatch,
    v_cnt_missing_email,
    v_cnt_missing_phone
  FROM temp_matched_leads;

  -- Select paginated sample
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_leads_json
  FROM (
    SELECT 
      id,
      first_name,
      last_name,
      email,
      phone,
      source,
      contact_preference,
      pipeline_stage_id,
      stage_name,
      stage_key,
      lead_score,
      is_eligible,
      exclusion_reason,
      created_at
    FROM temp_matched_leads
    ORDER BY is_eligible DESC, lead_score DESC, created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'total_matched', v_total_matched,
    'eligible_count', v_eligible_count,
    'excluded_count', v_excluded_count,
    'exclusion_breakdown', jsonb_build_object(
      'TEST_SOURCE', v_cnt_test,
      'NO_VALID_CONTACT_PREFERENCE', v_cnt_no_pref,
      'CHANNEL_PREFERENCE_MISMATCH', v_cnt_pref_mismatch,
      'MISSING_EMAIL', v_cnt_missing_email,
      'MISSING_PHONE', v_cnt_missing_phone
    ),
    'leads', v_leads_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_audience_segment TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. RPC: prepare_campaign_audience_snapshot
-- -----------------------------------------------------------------------------
-- Idempotently materializes campaign_recipients (eligible + excluded audit),
-- freezes snapshot metadata and timestamps.
-- MANDATORY: DOES NOT CREATE ANY TASKS OR DISPATCH MESSAGES.
CREATE OR REPLACE FUNCTION public.prepare_campaign_audience_snapshot(
  p_campaign_id UUID,
  p_saved_segment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_filters JSONB;
  v_segment_name TEXT := 'Custom Filter';
  v_preview_res JSONB;
  v_total_matched INT := 0;
  v_eligible_count INT := 0;
  v_excluded_count INT := 0;
  v_inserted_count INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Caller is not an active app user.';
  END IF;

  -- 1. Validate Campaign
  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign % not found.', p_campaign_id;
  END IF;

  IF v_campaign.status NOT IN ('draft', 'pending_approval', 'approved', 'scheduled') THEN
    RAISE EXCEPTION 'Cannot prepare audience for campaign in status %.', v_campaign.status;
  END IF;

  -- 2. Resolve Filters (from saved_segment if provided, else from campaign_audiences)
  IF p_saved_segment_id IS NOT NULL THEN
    SELECT filter_definition, name INTO v_filters, v_segment_name
    FROM public.saved_segments
    WHERE id = p_saved_segment_id AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Saved segment % not found or inactive.', p_saved_segment_id;
    END IF;
  ELSE
    SELECT filter_definition INTO v_filters
    FROM public.campaign_audiences
    WHERE campaign_id = p_campaign_id;

    IF v_filters IS NULL THEN
      v_filters := '{"version": 1, "operator": "and", "conditions": []}'::jsonb;
    END IF;
  END IF;

  -- 3. Execute Server-Side Match using temporary table logic
  DROP TABLE IF EXISTS temp_snapshot_recipients;
  CREATE TEMP TABLE temp_snapshot_recipients ON COMMIT DROP AS
  WITH eval AS (
    SELECT 
      l.id AS lead_id,
      l.email,
      COALESCE(l.phone_e164, l.phone_raw) AS phone_e164,
      l.pipeline_stage_id,
      l.lead_score,
      v_campaign.channel AS channel,
      -- Strict Eligibility
      CASE
        WHEN l.source = 'test' THEN false
        WHEN l.contact_preference IS NULL OR trim(l.contact_preference) = '' THEN false
        WHEN l.contact_preference != v_campaign.channel THEN false
        WHEN v_campaign.channel = 'email' AND (l.email IS NULL OR trim(l.email) = '') THEN false
        WHEN v_campaign.channel IN ('sms', 'call') AND COALESCE(l.phone_e164, l.phone_raw) IS NULL THEN false
        ELSE true
      END AS is_eligible,
      -- Exclusion Reason
      CASE
        WHEN l.source = 'test' THEN 'TEST_SOURCE'
        WHEN l.contact_preference IS NULL OR trim(l.contact_preference) = '' THEN 'NO_VALID_CONTACT_PREFERENCE'
        WHEN l.contact_preference != v_campaign.channel THEN 'CHANNEL_PREFERENCE_MISMATCH'
        WHEN v_campaign.channel = 'email' AND (l.email IS NULL OR trim(l.email) = '') THEN 'MISSING_EMAIL'
        WHEN v_campaign.channel IN ('sms', 'call') AND COALESCE(l.phone_e164, l.phone_raw) IS NULL THEN 'MISSING_PHONE'
        ELSE NULL
      END AS exclusion_reason
    FROM public.leads l
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE 
      -- Stage
      (v_filters->'stages' IS NULL OR jsonb_array_length(v_filters->'stages') = 0 OR 
        ps.key = ANY (SELECT jsonb_array_elements_text(v_filters->'stages')) OR
        l.pipeline_stage_id::text = ANY (SELECT jsonb_array_elements_text(v_filters->'stages')))
      -- Source
      AND (v_filters->'sources' IS NULL OR jsonb_array_length(v_filters->'sources') = 0 OR 
        l.source = ANY (SELECT jsonb_array_elements_text(v_filters->'sources')))
      -- Qualification status
      AND (v_filters->'qualification_statuses' IS NULL OR jsonb_array_length(v_filters->'qualification_statuses') = 0 OR 
        l.qualification_status = ANY (SELECT jsonb_array_elements_text(v_filters->'qualification_statuses')))
      -- Lead score range
      AND (v_filters->>'min_score' IS NULL OR l.lead_score >= (v_filters->>'min_score')::INT)
      AND (v_filters->>'max_score' IS NULL OR l.lead_score <= (v_filters->>'max_score')::INT)
      -- Meaningful inactivity
      AND (v_filters->>'days_since_last_activity' IS NULL OR 
        public.get_lead_last_meaningful_activity_at(l.id) <= now() - ((v_filters->>'days_since_last_activity')::INT || ' days')::interval)
      -- Enrolled course
      AND ((v_filters->>'enrolled_course_id' IS NULL OR (v_filters->>'enrolled_course_id') = '') OR EXISTS (
        SELECT 1 FROM public.enrollments e 
        WHERE e.lead_id = l.id AND e.course_id = (v_filters->>'enrolled_course_id')::UUID AND e.enrollment_status = 'confirmed'
      ))
      -- Not enrolled course
      AND ((v_filters->>'not_enrolled_course_id' IS NULL OR (v_filters->>'not_enrolled_course_id') = '') OR NOT EXISTS (
        SELECT 1 FROM public.enrollments e 
        WHERE e.lead_id = l.id AND e.course_id = (v_filters->>'not_enrolled_course_id')::UUID AND e.enrollment_status = 'confirmed'
      ))
      -- Completed course
      AND ((v_filters->>'completed_course_id' IS NULL OR (v_filters->>'completed_course_id') = '') OR EXISTS (
        SELECT 1 FROM public.enrollments e 
        JOIN public.course_participations p ON p.enrollment_id = e.id
        WHERE e.lead_id = l.id AND e.course_id = (v_filters->>'completed_course_id')::UUID AND p.attendance_status = 'completed'
      ))
      -- Repeat student
      AND (v_filters->>'repeat_student' IS NULL OR (
        (SELECT COUNT(*) >= 2 FROM public.enrollments e2 WHERE e2.lead_id = l.id AND e2.enrollment_status = 'confirmed') = (v_filters->>'repeat_student')::BOOLEAN
      ))
      -- Future course interest
      AND ((v_filters->>'course_interest_id' IS NULL OR (v_filters->>'course_interest_id') = '') OR EXISTS (
        SELECT 1 FROM public.lead_course_interests i 
        WHERE i.lead_id = l.id AND i.course_id = (v_filters->>'course_interest_id')::UUID AND i.status = 'active'
      ))
      -- Outstanding balance
      AND (v_filters->>'has_outstanding_balance' IS NULL OR (
        EXISTS (
          SELECT 1 FROM public.enrollments e
          WHERE e.lead_id = l.id AND e.enrollment_status = 'confirmed'
            AND (
              e.agreed_amount - 
              COALESCE((SELECT SUM(p.amount) FROM public.enrollment_payments p WHERE p.enrollment_id = e.id AND p.payment_type = 'payment' AND p.payment_status = 'paid'), 0) +
              COALESCE((SELECT SUM(r.amount) FROM public.enrollment_payments r WHERE r.enrollment_id = e.id AND r.payment_type = 'refund' AND r.payment_status = 'paid'), 0)
            ) > 0
        ) = (v_filters->>'has_outstanding_balance')::BOOLEAN
      ))
      -- Contact preference
      AND (v_filters->'contact_preferences' IS NULL OR jsonb_array_length(v_filters->'contact_preferences') = 0 OR 
        l.contact_preference = ANY (SELECT jsonb_array_elements_text(v_filters->'contact_preferences')))
  )
  SELECT * FROM eval;

  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE is_eligible = true),
    COUNT(*) FILTER (WHERE is_eligible = false)
  INTO v_total_matched, v_eligible_count, v_excluded_count
  FROM temp_snapshot_recipients;

  -- 4. Atomically Clear Previous Snapshot & Insert New Snapshot
  DELETE FROM public.campaign_recipients
  WHERE campaign_id = p_campaign_id;

  INSERT INTO public.campaign_recipients (
    campaign_id,
    lead_id,
    email,
    phone_e164,
    channel,
    is_eligible,
    exclusion_reason,
    status,
    snapshot_stage_id,
    snapshot_lead_score,
    prepared_at
  )
  SELECT 
    p_campaign_id,
    lead_id,
    email,
    phone_e164,
    channel,
    is_eligible,
    exclusion_reason,
    CASE WHEN is_eligible THEN 'pending' ELSE 'skipped' END,
    pipeline_stage_id,
    lead_score,
    v_now
  FROM temp_snapshot_recipients
  ON CONFLICT (campaign_id, lead_id) DO UPDATE
  SET 
    email = EXCLUDED.email,
    phone_e164 = EXCLUDED.phone_e164,
    channel = EXCLUDED.channel,
    is_eligible = EXCLUDED.is_eligible,
    exclusion_reason = EXCLUDED.exclusion_reason,
    status = EXCLUDED.status,
    snapshot_stage_id = EXCLUDED.snapshot_stage_id,
    snapshot_lead_score = EXCLUDED.snapshot_lead_score,
    prepared_at = EXCLUDED.prepared_at;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- 5. Freeze campaign_audiences Record
  INSERT INTO public.campaign_audiences (
    campaign_id,
    saved_segment_id,
    filter_definition,
    estimated_recipient_count,
    snapshot_frozen_at,
    snapshot_metadata,
    total_matched_count,
    eligible_count,
    excluded_count,
    updated_at
  ) VALUES (
    p_campaign_id,
    p_saved_segment_id,
    v_filters,
    v_eligible_count,
    v_now,
    jsonb_build_object(
      'saved_segment_id', p_saved_segment_id,
      'saved_segment_name', v_segment_name,
      'frozen_at', v_now,
      'channel', v_campaign.channel,
      'filter_definition_snapshot', v_filters
    ),
    v_total_matched,
    v_eligible_count,
    v_excluded_count,
    v_now
  )
  ON CONFLICT (campaign_id) DO UPDATE
  SET 
    saved_segment_id = EXCLUDED.saved_segment_id,
    filter_definition = EXCLUDED.filter_definition,
    estimated_recipient_count = EXCLUDED.estimated_recipient_count,
    snapshot_frozen_at = EXCLUDED.snapshot_frozen_at,
    snapshot_metadata = EXCLUDED.snapshot_metadata,
    total_matched_count = EXCLUDED.total_matched_count,
    eligible_count = EXCLUDED.eligible_count,
    excluded_count = EXCLUDED.excluded_count,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'channel', v_campaign.channel,
    'snapshot_frozen_at', v_now,
    'total_matched', v_total_matched,
    'eligible_count', v_eligible_count,
    'excluded_count', v_excluded_count,
    'recipients_materialized', v_inserted_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.prepare_campaign_audience_snapshot TO authenticated;


-- -----------------------------------------------------------------------------
-- 8. RPC: activate_call_campaign
-- -----------------------------------------------------------------------------
-- Explicit action: ONLY creates deduplicated tasks in public.tasks for eligible call leads.
-- Idempotent: Never creates duplicate tasks if executed multiple times.
CREATE OR REPLACE FUNCTION public.activate_call_campaign(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_audience RECORD;
  v_rec RECORD;
  v_tasks_created INT := 0;
  v_tasks_skipped INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Caller is not an active app user.';
  END IF;

  -- 1. Validate Campaign
  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign % not found.', p_campaign_id;
  END IF;

  IF v_campaign.channel != 'call' THEN
    RAISE EXCEPTION 'Cannot activate call campaign on channel %. Campaign channel must be call.', v_campaign.channel;
  END IF;

  -- 2. Verify Campaign Audience is Prepared
  SELECT * INTO v_audience
  FROM public.campaign_audiences
  WHERE campaign_id = p_campaign_id;

  IF NOT FOUND OR v_audience.snapshot_frozen_at IS NULL THEN
    RAISE EXCEPTION 'Audience snapshot has not been prepared for campaign %. Click Prepare Audience first.', p_campaign_id;
  END IF;

  -- 3. Iterate ONLY Eligible Call Recipients
  FOR v_rec IN 
    SELECT 
      r.lead_id,
      r.phone_e164,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, 'Lead') AS lead_name
    FROM public.campaign_recipients r
    JOIN public.leads l ON l.id = r.lead_id
    WHERE r.campaign_id = p_campaign_id
      AND r.is_eligible = true
      AND r.channel = 'call'
  LOOP
    -- Strict Idempotency: Check if pending task already exists for this lead & campaign
    IF EXISTS (
      SELECT 1 FROM public.tasks
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_rec.lead_id
        AND status = 'pending'
    ) THEN
      v_tasks_skipped := v_tasks_skipped + 1;
    ELSE
      -- Create Deduplicated Task
      INSERT INTO public.tasks (
        lead_id,
        campaign_id,
        task_type,
        task_source,
        title,
        description,
        priority,
        status,
        due_at,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        v_rec.lead_id,
        p_campaign_id,
        'call',
        'campaign',
        'Call Campaign: ' || v_campaign.name || ' — ' || v_rec.lead_name,
        'Outreach scheduled from Call Campaign "' || v_campaign.name || '". Preferred Channel: Call. Phone: ' || COALESCE(v_rec.phone_e164, 'N/A'),
        'normal',
        'pending',
        v_now,
        'system',
        v_now,
        v_now
      );

      -- Record activity in lead audit log
      INSERT INTO public.lead_activities (
        lead_id,
        activity_type,
        title,
        description,
        metadata,
        created_at
      ) VALUES (
        v_rec.lead_id,
        'call_task_created',
        'Call Campaign Task Scheduled',
        'Task created from Call Campaign: ' || v_campaign.name,
        jsonb_build_object('campaign_id', p_campaign_id, 'campaign_name', v_campaign.name),
        v_now
      );

      v_tasks_created := v_tasks_created + 1;
    END IF;
  END LOOP;

  -- 4. Update Campaign State
  UPDATE public.campaigns
  SET 
    status = 'sent',
    activated_at = v_now,
    updated_at = v_now
  WHERE id = p_campaign_id;

  -- 5. Mark eligible recipients as sent (dispatched to call queue)
  UPDATE public.campaign_recipients
  SET 
    status = 'sent',
    sent_at = v_now,
    updated_at = v_now
  WHERE campaign_id = p_campaign_id
    AND is_eligible = true;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'tasks_created', v_tasks_created,
    'tasks_skipped_idempotent', v_tasks_skipped,
    'activated_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_call_campaign TO authenticated;
