-- =============================================================================
-- Migration 00045: Fix Audience Segmentation Pipeline Stage Column (code vs key)
-- =============================================================================
-- public.pipeline_stages uses column `code` (not `key`).
-- This migration updates preview_audience_segment and prepare_campaign_audience_snapshot
-- to correctly reference ps.code.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Update preview_audience_segment
-- -----------------------------------------------------------------------------
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
    ps.code AS stage_code,
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
      ps.code = ANY (SELECT jsonb_array_elements_text(v_stages)) OR
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
      stage_code,
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
-- 2. Update prepare_campaign_audience_snapshot
-- -----------------------------------------------------------------------------
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
        ps.code = ANY (SELECT jsonb_array_elements_text(v_filters->'stages')) OR
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
