-- =============================================================================
-- Migration 00031: Create Lead Scoring Foundation (Phase 4 Block 1)
-- =============================================================================
-- Implements deterministic, explainable, rule-based Lead Scoring:
-- 1. lead_score_rules: Declarative scoring rules (fit, intent, engagement)
-- 2. lead_score_settings: Threshold configuration with gap/overlap validation
-- 3. lead_score_history: Idempotent audit log of score changes
-- 4. lead_score_recalculation_jobs: Resilient batch recalculation jobs
-- 5. leads: Adds lead_score (0-100) and lead_score_updated_at
-- 6. Server-side RPCs: calculate_lead_score, recalculate_lead_score,
--    start_lead_score_recalculation_job, process_lead_score_recalculation_batch
-- 7. Contacts purge integration
-- 8. Row Level Security policies
-- =============================================================================

-- 1. Create lead_score_rules table
CREATE TABLE IF NOT EXISTS public.lead_score_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fit', 'intent', 'engagement')),
  field_or_event TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN (
    'equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists',
    'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'
  )),
  value JSONB NOT NULL DEFAULT '""'::jsonb,
  points INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_score_rules_active_cat
  ON public.lead_score_rules(is_active, category, sort_order);

COMMENT ON TABLE public.lead_score_rules IS
  'Configurable declarative scoring rules for evaluating lead priority (fit, intent, engagement).';


-- 2. Create lead_score_settings table (Thresholds and Global Consistency)
CREATE TABLE IF NOT EXISTS public.lead_score_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cold_min INTEGER NOT NULL DEFAULT 0,
  cold_max INTEGER NOT NULL DEFAULT 24,
  warm_min INTEGER NOT NULL DEFAULT 25,
  warm_max INTEGER NOT NULL DEFAULT 49,
  hot_min INTEGER NOT NULL DEFAULT 50,
  hot_max INTEGER NOT NULL DEFAULT 74,
  very_hot_min INTEGER NOT NULL DEFAULT 75,
  very_hot_max INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Enforce strict non-overlapping, contiguous 0-100 coverage
  CONSTRAINT chk_lead_score_settings_consistency CHECK (
    cold_min = 0 AND
    cold_max = warm_min - 1 AND
    warm_max = hot_min - 1 AND
    hot_max = very_hot_min - 1 AND
    very_hot_max = 100 AND
    cold_min <= cold_max AND
    warm_min <= warm_max AND
    hot_min <= hot_max AND
    very_hot_min <= very_hot_max
  )
);

COMMENT ON TABLE public.lead_score_settings IS
  'Threshold configuration for lead score label classification. Strictly contiguous across 0-100.';

-- Seed default settings (single row)
INSERT INTO public.lead_score_settings (
  id, cold_min, cold_max, warm_min, warm_max, hot_min, hot_max, very_hot_min, very_hot_max
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  0, 24, 25, 49, 50, 74, 75, 100
) ON CONFLICT (id) DO NOTHING;


-- 3. Create lead_score_history table
CREATE TABLE IF NOT EXISTS public.lead_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  old_score INTEGER NOT NULL,
  new_score INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  trigger_event_id UUID NULL REFERENCES public.automation_events(id) ON DELETE SET NULL,
  matched_rules_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_score_history_lead
  ON public.lead_score_history(lead_id, created_at DESC);

-- Unique constraint for idempotent event recalculations
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_score_history_trigger_event
  ON public.lead_score_history(lead_id, trigger_event_id)
  WHERE trigger_event_id IS NOT NULL;

COMMENT ON TABLE public.lead_score_history IS
  'Audit log of lead score changes with full snapshot of matched rules and delta.';


-- 4. Create lead_score_recalculation_jobs table
CREATE TABLE IF NOT EXISTS public.lead_score_recalculation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  total_leads INTEGER NOT NULL DEFAULT 0,
  processed_leads INTEGER NOT NULL DEFAULT 0,
  failed_leads INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 100,
  last_processed_id UUID NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_score_jobs_status
  ON public.lead_score_recalculation_jobs(status, created_at DESC);

COMMENT ON TABLE public.lead_score_recalculation_jobs IS
  'Background batch jobs for bulk recalculation of all lead scores across database.';


-- 5. Alter leads table: add lead_score and lead_score_updated_at
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_score INTEGER NOT NULL DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
  ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_leads_score ON public.leads(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score_updated_at ON public.leads(lead_score_updated_at);


-- 6. Seed Transparent Default Scoring Rules
INSERT INTO public.lead_score_rules (name, category, field_or_event, operator, value, points, sort_order, is_active, description)
VALUES
  -- FIT RULES
  ('Course Interest Declared', 'fit', 'course_interest', 'exists', '""'::jsonb, 10, 10, true, 'Lead specified an educational course of interest'),
  ('Phone Number Available', 'fit', 'phone_exists', 'exists', '""'::jsonb, 10, 20, true, 'Valid phone number on record'),
  ('Email Address Available', 'fit', 'email_exists', 'exists', '""'::jsonb, 5, 30, true, 'Valid email on record'),
  ('Contact Preference Chosen', 'fit', 'contact_preference', 'exists', '""'::jsonb, 5, 40, true, 'Preferred outreach channel registered'),
  ('Direct Form Ingestion', 'fit', 'source', 'equals', '"form"'::jsonb, 10, 50, true, 'Originates from inbound web inquiry form'),

  -- INTENT RULES
  ('Confirmed Registration Status', 'intent', 'qualification_status', 'equals', '"confirmed"'::jsonb, 40, 100, true, 'Highest sales signal: confirmed interest'),
  ('Hot Qualification Status', 'intent', 'qualification_status', 'equals', '"hot"'::jsonb, 30, 110, true, 'Lead is highly qualified and ready to convert'),
  ('Interested Qualification Status', 'intent', 'qualification_status', 'equals', '"interested"'::jsonb, 20, 120, true, 'Lead expressed positive interest'),
  ('Some Response Qualification Status', 'intent', 'qualification_status', 'equals', '"some_response"'::jsonb, 10, 130, true, 'Lead replied or gave initial feedback'),
  ('Inbound Response Received', 'intent', 'last_response_at', 'exists', '""'::jsonb, 15, 140, true, 'Lead has sent at least one inbound response'),
  ('Advanced Pipeline Stage', 'intent', 'pipeline_stage', 'in', '["acquisition", "approval", "enrollment"]'::jsonb, 15, 150, true, 'Progressed to advanced sales pipeline stage'),

  -- ENGAGEMENT RULES
  ('Recent Activity (Past 3 Days)', 'engagement', 'days_since_last_activity', 'less_or_equal', '3'::jsonb, 10, 200, true, 'Lead interacted within the last 72 hours'),
  ('Active Recent Week', 'engagement', 'days_since_last_activity', 'less_or_equal', '7'::jsonb, 5, 210, true, 'Lead interacted within the last 7 days'),
  ('Inbound Messages Exchanged', 'engagement', 'inbound_message_count', 'greater_or_equal', '1'::jsonb, 10, 220, true, 'Lead has reciprocal messages in conversational CRM'),

  -- DECAY / NEGATIVE RULES
  ('Inactive for Over 30 Days', 'engagement', 'days_since_last_activity', 'greater_than', '30'::jsonb, -15, 300, true, 'Engagement decay: no timeline activity in 30 days'),
  ('Unresponsive Over 14 Days', 'intent', 'days_since_last_response', 'greater_than', '14'::jsonb, -10, 310, true, 'Response decay: no response for more than 14 days')
ON CONFLICT DO NOTHING;


-- 7. Server-Side Function: Helper to Derive Label
CREATE OR REPLACE FUNCTION public.get_lead_score_label(p_score INTEGER)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_score <= s.cold_max THEN 'cold'
    WHEN p_score <= s.warm_max THEN 'warm'
    WHEN p_score <= s.hot_max THEN 'hot'
    ELSE 'very_hot'
  END
  FROM public.lead_score_settings s
  LIMIT 1;
$$;


-- 8. Server-Side Function: calculate_lead_score
-- Evaluates active rules against lead data, tags, inbounds, and activities.
CREATE OR REPLACE FUNCTION public.calculate_lead_score(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_pipeline_stage_code TEXT;
  v_inbound_count INT;
  v_last_activity_at TIMESTAMPTZ;
  v_days_since_activity NUMERIC;
  v_days_since_response NUMERIC;
  v_rule RECORD;
  v_matched BOOLEAN;
  v_matched_rules JSONB := '[]'::jsonb;
  v_unmatched_rules JSONB := '[]'::jsonb;
  v_fit_pts INT := 0;
  v_intent_pts INT := 0;
  v_engagement_pts INT := 0;
  v_raw_total INT := 0;
  v_clamped_score INT := 0;
  v_label TEXT;
BEGIN
  -- 1. Fetch lead
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Lead not found', 'lead_id', p_lead_id);
  END IF;

  -- 2. Fetch pipeline stage code
  SELECT code INTO v_pipeline_stage_code 
  FROM public.pipeline_stages 
  WHERE id = v_lead.pipeline_stage_id;

  -- 3. Fetch inbound messages count
  SELECT count(*) INTO v_inbound_count
  FROM public.inbound_messages
  WHERE lead_id = p_lead_id;

  -- 4. Compute last_activity_at (canonical greatest of activities, inbounds, outbounds, lead creation)
  SELECT GREATEST(
    COALESCE((SELECT max(created_at) FROM public.lead_activities WHERE lead_id = p_lead_id), v_lead.created_at),
    COALESCE((SELECT max(received_at) FROM public.inbound_messages WHERE lead_id = p_lead_id), v_lead.created_at),
    COALESCE((SELECT max(created_at) FROM public.outbound_messages WHERE lead_id = p_lead_id), v_lead.created_at),
    v_lead.created_at
  ) INTO v_last_activity_at;

  -- Compute days elapsed
  v_days_since_activity := EXTRACT(EPOCH FROM (now() - v_last_activity_at)) / 86400.0;
  IF v_lead.last_response_at IS NOT NULL THEN
    v_days_since_response := EXTRACT(EPOCH FROM (now() - v_lead.last_response_at)) / 86400.0;
  ELSE
    v_days_since_response := EXTRACT(EPOCH FROM (now() - v_lead.created_at)) / 86400.0;
  END IF;

  -- 5. Iterate through all active rules in sort order
  FOR v_rule IN
    SELECT * FROM public.lead_score_rules 
    WHERE is_active = true 
    ORDER BY sort_order ASC, created_at ASC
  LOOP
    v_matched := false;

    CASE v_rule.field_or_event
      -- Qualification status
      WHEN 'qualification_status' THEN
        IF v_rule.operator = 'equals' THEN
          v_matched := (v_lead.qualification_status = (v_rule.value #>> '{}'));
        ELSIF v_rule.operator = 'not_equals' THEN
          v_matched := (v_lead.qualification_status IS DISTINCT FROM (v_rule.value #>> '{}'));
        ELSIF v_rule.operator = 'in' THEN
          v_matched := (v_rule.value @> to_jsonb(v_lead.qualification_status));
        END IF;

      -- Pipeline stage
      WHEN 'pipeline_stage' THEN
        IF v_rule.operator = 'equals' THEN
          v_matched := (v_pipeline_stage_code = (v_rule.value #>> '{}'));
        ELSIF v_rule.operator = 'not_equals' THEN
          v_matched := (v_pipeline_stage_code IS DISTINCT FROM (v_rule.value #>> '{}'));
        ELSIF v_rule.operator = 'in' THEN
          v_matched := (v_rule.value @> to_jsonb(v_pipeline_stage_code));
        END IF;

      -- Source
      WHEN 'source' THEN
        IF v_rule.operator = 'equals' THEN
          v_matched := (v_lead.source::text = (v_rule.value #>> '{}'));
        ELSIF v_rule.operator = 'not_equals' THEN
          v_matched := (v_lead.source::text IS DISTINCT FROM (v_rule.value #>> '{}'));
        ELSIF v_rule.operator = 'in' THEN
          v_matched := (v_rule.value @> to_jsonb(v_lead.source::text));
        END IF;

      -- Course interest
      WHEN 'course_interest' THEN
        IF v_rule.operator = 'exists' THEN
          v_matched := (v_lead.course_interest IS NOT NULL AND trim(v_lead.course_interest) <> '');
        ELSIF v_rule.operator = 'not_exists' THEN
          v_matched := (v_lead.course_interest IS NULL OR trim(v_lead.course_interest) = '');
        ELSIF v_rule.operator = 'equals' THEN
          v_matched := (lower(trim(COALESCE(v_lead.course_interest, ''))) = lower(trim(v_rule.value #>> '{}')));
        END IF;

      -- Contact preference
      WHEN 'contact_preference' THEN
        IF v_rule.operator = 'exists' THEN
          v_matched := (v_lead.contact_preference IS NOT NULL);
        ELSIF v_rule.operator = 'equals' THEN
          v_matched := (v_lead.contact_preference::text = (v_rule.value #>> '{}'));
        END IF;

      -- Email exists
      WHEN 'email_exists' THEN
        IF v_rule.operator = 'exists' THEN
          v_matched := (v_lead.email IS NOT NULL AND trim(v_lead.email) <> '');
        ELSIF v_rule.operator = 'not_exists' THEN
          v_matched := (v_lead.email IS NULL OR trim(v_lead.email) = '');
        END IF;

      -- Phone exists
      WHEN 'phone_exists' THEN
        IF v_rule.operator = 'exists' THEN
          v_matched := (v_lead.phone_e164 IS NOT NULL AND trim(v_lead.phone_e164) <> '');
        ELSIF v_rule.operator = 'not_exists' THEN
          v_matched := (v_lead.phone_e164 IS NULL OR trim(v_lead.phone_e164) = '');
        END IF;

      -- Last response
      WHEN 'last_response_at' THEN
        IF v_rule.operator = 'exists' THEN
          v_matched := (v_lead.last_response_at IS NOT NULL);
        ELSIF v_rule.operator = 'not_exists' THEN
          v_matched := (v_lead.last_response_at IS NULL);
        END IF;

      -- Inbound message count
      WHEN 'inbound_message_count' THEN
        IF v_rule.operator = 'greater_than' THEN
          v_matched := (v_inbound_count > (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'greater_or_equal' THEN
          v_matched := (v_inbound_count >= (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'equals' THEN
          v_matched := (v_inbound_count = (v_rule.value #>> '{}')::numeric);
        END IF;

      -- Days since last activity
      WHEN 'days_since_last_activity' THEN
        IF v_rule.operator = 'less_or_equal' THEN
          v_matched := (v_days_since_activity <= (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'less_than' THEN
          v_matched := (v_days_since_activity < (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'greater_than' THEN
          v_matched := (v_days_since_activity > (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'greater_or_equal' THEN
          v_matched := (v_days_since_activity >= (v_rule.value #>> '{}')::numeric);
        END IF;

      -- Days since last response
      WHEN 'days_since_last_response' THEN
        IF v_rule.operator = 'greater_than' THEN
          v_matched := (v_days_since_response > (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'greater_or_equal' THEN
          v_matched := (v_days_since_response >= (v_rule.value #>> '{}')::numeric);
        ELSIF v_rule.operator = 'less_or_equal' THEN
          v_matched := (v_days_since_response <= (v_rule.value #>> '{}')::numeric);
        END IF;

      ELSE
        v_matched := false;
    END CASE;

    IF v_matched THEN
      v_raw_total := v_raw_total + v_rule.points;
      IF v_rule.category = 'fit' THEN
        v_fit_pts := v_fit_pts + v_rule.points;
      ELSIF v_rule.category = 'intent' THEN
        v_intent_pts := v_intent_pts + v_rule.points;
      ELSIF v_rule.category = 'engagement' THEN
        v_engagement_pts := v_engagement_pts + v_rule.points;
      END IF;

      v_matched_rules := v_matched_rules || jsonb_build_object(
        'rule_id', v_rule.id,
        'name', v_rule.name,
        'category', v_rule.category,
        'points', v_rule.points,
        'description', v_rule.description
      );
    ELSE
      v_unmatched_rules := v_unmatched_rules || jsonb_build_object(
        'rule_id', v_rule.id,
        'name', v_rule.name,
        'category', v_rule.category,
        'points', v_rule.points
      );
    END IF;
  END LOOP;

  -- 6. Clamp total between 0 and 100
  v_clamped_score := LEAST(100, GREATEST(0, v_raw_total));
  v_label := public.get_lead_score_label(v_clamped_score);

  RETURN jsonb_build_object(
    'lead_id', p_lead_id,
    'raw_total', v_raw_total,
    'score', v_clamped_score,
    'label', v_label,
    'fit_subtotal', v_fit_pts,
    'intent_subtotal', v_intent_pts,
    'engagement_subtotal', v_engagement_pts,
    'matched_rules', v_matched_rules,
    'unmatched_rules', v_unmatched_rules
  );
END;
$$;


-- 9. Server-Side Function: recalculate_lead_score (Row-locked & Concurrency-safe)
CREATE OR REPLACE FUNCTION public.recalculate_lead_score(
  p_lead_id UUID,
  p_reason TEXT DEFAULT 'manual_recalculation',
  p_trigger_event_id UUID DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calculation JSONB;
  v_current_score INT;
  v_new_score INT;
  v_delta INT;
  v_history_id UUID := NULL;
BEGIN
  -- If dry run, simply return the calculation without locks or writes
  IF p_dry_run THEN
    RETURN public.calculate_lead_score(p_lead_id);
  END IF;

  -- 1. Concurrency safety: acquire row-level lock on lead
  SELECT lead_score INTO v_current_score
  FROM public.leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Lead not found', 'lead_id', p_lead_id);
  END IF;

  -- 2. Execute calculation
  v_calculation := public.calculate_lead_score(p_lead_id);
  v_new_score := (v_calculation->>'score')::integer;
  v_delta := v_new_score - v_current_score;

  -- 3. Update lead score if changed OR if first calculation
  UPDATE public.leads
  SET 
    lead_score = v_new_score,
    lead_score_updated_at = now()
  WHERE id = p_lead_id;

  -- 4. Idempotent history recording: record ONLY if score actually changed
  -- and if trigger_event hasn't already recorded this change
  IF v_delta <> 0 THEN
    IF p_trigger_event_id IS NOT NULL THEN
      -- Check if already logged for this event
      IF NOT EXISTS (
        SELECT 1 FROM public.lead_score_history 
        WHERE lead_id = p_lead_id AND trigger_event_id = p_trigger_event_id
      ) THEN
        INSERT INTO public.lead_score_history (
          lead_id, old_score, new_score, delta, reason, trigger_event_id, matched_rules_snapshot
        ) VALUES (
          p_lead_id, v_current_score, v_new_score, v_delta, p_reason, p_trigger_event_id, v_calculation->'matched_rules'
        ) RETURNING id INTO v_history_id;
      END IF;
    ELSE
      INSERT INTO public.lead_score_history (
        lead_id, old_score, new_score, delta, reason, matched_rules_snapshot
      ) VALUES (
        p_lead_id, v_current_score, v_new_score, v_delta, p_reason, v_calculation->'matched_rules'
      ) RETURNING id INTO v_history_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'old_score', v_current_score,
    'new_score', v_new_score,
    'delta', v_delta,
    'history_recorded', (v_history_id IS NOT NULL),
    'history_id', v_history_id,
    'calculation', v_calculation
  );
END;
$$;


-- 10. Server-Side Function: start_lead_score_recalculation_job
CREATE OR REPLACE FUNCTION public.start_lead_score_recalculation_job(
  p_batch_size INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_leads INT;
  v_job_id UUID;
BEGIN
  -- Count total leads
  SELECT count(*) INTO v_total_leads FROM public.leads;

  -- Create job
  INSERT INTO public.lead_score_recalculation_jobs (
    status, total_leads, processed_leads, failed_leads, batch_size, started_at
  ) VALUES (
    'processing', v_total_leads, 0, 0, GREATEST(10, LEAST(500, p_batch_size)), now()
  ) RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'total_leads', v_total_leads,
    'batch_size', p_batch_size,
    'status', 'processing'
  );
END;
$$;


-- 11. Server-Side Function: process_lead_score_recalculation_batch
-- Processes a chunk of leads for a job, advancing cursor safely.
CREATE OR REPLACE FUNCTION public.process_lead_score_recalculation_batch(
  p_job_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job RECORD;
  v_lead_id UUID;
  v_batch_count INT := 0;
  v_failed_count INT := 0;
  v_last_id UUID := NULL;
  v_more_remaining BOOLEAN := false;
BEGIN
  -- Get job with row lock
  SELECT * INTO v_job 
  FROM public.lead_score_recalculation_jobs 
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Job not found', 'job_id', p_job_id);
  END IF;

  IF v_job.status IN ('completed', 'cancelled', 'failed') THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'status', v_job.status, 'message', 'Job is already finished');
  END IF;

  -- Fetch next batch using cursor pagination (last_processed_id)
  FOR v_lead_id IN
    SELECT id FROM public.leads
    WHERE (v_job.last_processed_id IS NULL OR id > v_job.last_processed_id)
    ORDER BY id ASC
    LIMIT v_job.batch_size
  LOOP
    BEGIN
      PERFORM public.recalculate_lead_score(v_lead_id, 'batch_recalculation', NULL, false);
      v_batch_count := v_batch_count + 1;
      v_last_id := v_lead_id;
    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
      v_last_id := v_lead_id;
    END;
  END LOOP;

  -- Check if more leads remain
  IF v_last_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.leads WHERE id > v_last_id
    ) INTO v_more_remaining;
  ELSE
    v_more_remaining := false;
  END IF;

  -- Update job progress
  UPDATE public.lead_score_recalculation_jobs
  SET
    processed_leads = processed_leads + v_batch_count,
    failed_leads = failed_leads + v_failed_count,
    last_processed_id = COALESCE(v_last_id, last_processed_id),
    status = CASE WHEN v_more_remaining THEN 'processing' ELSE 'completed' END,
    completed_at = CASE WHEN v_more_remaining THEN NULL ELSE now() END,
    updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'batch_processed', v_batch_count,
    'batch_failed', v_failed_count,
    'has_more', v_more_remaining,
    'status', CASE WHEN v_more_remaining THEN 'processing' ELSE 'completed' END
  );
END;
$$;


-- 12. Update purge_all_contacts and get_contacts_purge_preview
CREATE OR REPLACE FUNCTION public.get_contacts_purge_preview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_leads_count int;
  v_tasks_count int;
  v_notes_count int;
  v_lead_tags_count int;
  v_stage_history_count int;
  v_activities_count int;
  v_intake_events_count int;
  v_outbound_messages_count int;
  v_form_submissions_count int;
  v_automation_events_count int;
  v_automation_runs_count int;
  v_automation_jobs_count int;
  v_conversations_count int;
  v_inbound_messages_count int;
  v_lead_score_history_count int;
  v_lead_score_jobs_count int;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Active app user privileges required.';
  END IF;

  SELECT count(*) INTO v_leads_count FROM public.leads WHERE id IS NOT NULL;
  SELECT count(*) INTO v_tasks_count FROM public.tasks WHERE id IS NOT NULL;
  SELECT count(*) INTO v_notes_count FROM public.lead_notes WHERE id IS NOT NULL;
  SELECT count(*) INTO v_lead_tags_count FROM public.lead_tags WHERE id IS NOT NULL;
  SELECT count(*) INTO v_stage_history_count FROM public.lead_stage_history WHERE id IS NOT NULL;
  SELECT count(*) INTO v_activities_count FROM public.lead_activities WHERE id IS NOT NULL;
  SELECT count(*) INTO v_intake_events_count FROM public.lead_intake_events WHERE id IS NOT NULL;
  SELECT count(*) INTO v_outbound_messages_count FROM public.outbound_messages WHERE id IS NOT NULL;
  SELECT count(*) INTO v_form_submissions_count FROM public.form_submissions WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_events_count FROM public.automation_events WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_runs_count FROM public.automation_runs WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_jobs_count FROM public.automation_jobs WHERE id IS NOT NULL;
  SELECT count(*) INTO v_conversations_count FROM public.conversations WHERE id IS NOT NULL;
  SELECT count(*) INTO v_inbound_messages_count FROM public.inbound_messages WHERE id IS NOT NULL;
  SELECT count(*) INTO v_lead_score_history_count FROM public.lead_score_history WHERE id IS NOT NULL;
  SELECT count(*) INTO v_lead_score_jobs_count FROM public.lead_score_recalculation_jobs WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'leads_count', v_leads_count,
    'tasks_count', v_tasks_count,
    'notes_count', v_notes_count,
    'lead_tags_count', v_lead_tags_count,
    'stage_history_count', v_stage_history_count,
    'activities_count', v_activities_count,
    'intake_events_count', v_intake_events_count,
    'outbound_messages_count', v_outbound_messages_count,
    'form_submissions_count', v_form_submissions_count,
    'automation_events_count', v_automation_events_count,
    'automation_runs_count', v_automation_runs_count,
    'automation_jobs_count', v_automation_jobs_count,
    'conversations_count', v_conversations_count,
    'inbound_messages_count', v_inbound_messages_count,
    'lead_score_history_count', v_lead_score_history_count,
    'lead_score_jobs_count', v_lead_score_jobs_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_all_contacts(confirmation_text text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_leads int;
  v_deleted_tasks int;
  v_deleted_notes int;
  v_deleted_lead_tags int;
  v_deleted_stage_history int;
  v_deleted_activities int;
  v_deleted_intake_events int;
  v_deleted_outbound_messages int;
  v_deleted_form_submissions int;
  v_deleted_automation_events int;
  v_deleted_automation_runs int;
  v_deleted_automation_jobs int;
  v_deleted_conversations int;
  v_deleted_inbound_messages int;
  v_deleted_lead_score_history int;
  v_deleted_lead_score_jobs int;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Active app user privileges required.';
  END IF;

  IF confirmation_text IS NULL OR confirmation_text <> 'DELETE ALL CONTACTS PERMANENTLY' THEN
    RAISE EXCEPTION 'Invalid confirmation text. Operation aborted.';
  END IF;

  -- Delete child tables first
  DELETE FROM public.lead_score_history WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_lead_score_history = ROW_COUNT;

  DELETE FROM public.lead_score_recalculation_jobs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_lead_score_jobs = ROW_COUNT;

  DELETE FROM public.inbound_messages WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_inbound_messages = ROW_COUNT;

  DELETE FROM public.conversations WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_conversations = ROW_COUNT;

  DELETE FROM public.automation_jobs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_jobs = ROW_COUNT;

  DELETE FROM public.automation_runs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_runs = ROW_COUNT;

  DELETE FROM public.automation_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_events = ROW_COUNT;

  DELETE FROM public.form_submissions WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_form_submissions = ROW_COUNT;

  DELETE FROM public.outbound_messages WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_outbound_messages = ROW_COUNT;

  DELETE FROM public.lead_activities WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_activities = ROW_COUNT;

  DELETE FROM public.lead_stage_history WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_stage_history = ROW_COUNT;

  DELETE FROM public.lead_notes WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_notes = ROW_COUNT;

  DELETE FROM public.tasks WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;

  DELETE FROM public.lead_tags WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_lead_tags = ROW_COUNT;

  DELETE FROM public.lead_intake_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_intake_events = ROW_COUNT;

  DELETE FROM public.leads WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_leads = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_leads', v_deleted_leads,
    'deleted_tasks', v_deleted_tasks,
    'deleted_notes', v_deleted_notes,
    'deleted_lead_tags', v_deleted_lead_tags,
    'deleted_stage_history', v_deleted_stage_history,
    'deleted_activities', v_deleted_activities,
    'deleted_intake_events', v_deleted_intake_events,
    'deleted_outbound_messages', v_deleted_outbound_messages,
    'deleted_form_submissions', v_deleted_form_submissions,
    'deleted_automation_events', v_deleted_automation_events,
    'deleted_automation_runs', v_deleted_automation_runs,
    'deleted_automation_jobs', v_deleted_automation_jobs,
    'deleted_conversations', v_deleted_conversations,
    'deleted_inbound_messages', v_deleted_inbound_messages,
    'deleted_lead_score_history', v_deleted_lead_score_history,
    'deleted_lead_score_jobs', v_deleted_lead_score_jobs
  );
END;
$$;


-- 13. Row Level Security Policies
ALTER TABLE public.lead_score_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_score_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_score_recalculation_jobs ENABLE ROW LEVEL SECURITY;

-- Deny anon completely
DROP POLICY IF EXISTS "Deny anon on lead_score_rules" ON public.lead_score_rules;
CREATE POLICY "Deny anon on lead_score_rules" ON public.lead_score_rules
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon on lead_score_settings" ON public.lead_score_settings;
CREATE POLICY "Deny anon on lead_score_settings" ON public.lead_score_settings
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon on lead_score_history" ON public.lead_score_history;
CREATE POLICY "Deny anon on lead_score_history" ON public.lead_score_history
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon on lead_score_recalculation_jobs" ON public.lead_score_recalculation_jobs;
CREATE POLICY "Deny anon on lead_score_recalculation_jobs" ON public.lead_score_recalculation_jobs
  FOR ALL TO anon USING (false);

-- Active app users can view and manage
DROP POLICY IF EXISTS "Active app users can view lead_score_rules" ON public.lead_score_rules;
CREATE POLICY "Active app users can view lead_score_rules" ON public.lead_score_rules
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage lead_score_rules" ON public.lead_score_rules;
CREATE POLICY "Active app users can manage lead_score_rules" ON public.lead_score_rules
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can view lead_score_settings" ON public.lead_score_settings;
CREATE POLICY "Active app users can view lead_score_settings" ON public.lead_score_settings
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage lead_score_settings" ON public.lead_score_settings;
CREATE POLICY "Active app users can manage lead_score_settings" ON public.lead_score_settings
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can view lead_score_history" ON public.lead_score_history;
CREATE POLICY "Active app users can view lead_score_history" ON public.lead_score_history
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can view recalculation_jobs" ON public.lead_score_recalculation_jobs;
CREATE POLICY "Active app users can view recalculation_jobs" ON public.lead_score_recalculation_jobs
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage recalculation_jobs" ON public.lead_score_recalculation_jobs;
CREATE POLICY "Active app users can manage recalculation_jobs" ON public.lead_score_recalculation_jobs
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

-- Revoke RPC execution from anon
REVOKE ALL ON FUNCTION public.calculate_lead_score(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recalculate_lead_score(UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_lead_score_recalculation_job(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_lead_score_recalculation_batch(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.calculate_lead_score(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_lead_score(UUID, TEXT, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_lead_score_recalculation_job(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_lead_score_recalculation_batch(UUID) TO authenticated, service_role;
