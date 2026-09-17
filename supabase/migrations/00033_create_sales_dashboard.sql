-- =============================================================================
-- Migration 00033: Create Sales Intelligence Dashboard Architecture (Phase 4 Block 2)
-- =============================================================================
-- Implements modular, auditable, cohort-based Sales Intelligence backend:
-- 1. Targeted performance indexes for dashboard queries
-- 2. get_dashboard_snapshot() - Total leads, open tasks, open/unread conversations
-- 3. get_dashboard_pipeline(p_start, p_end) - Cohort funnel & current stage distribution
-- 4. get_dashboard_qualification() - Current qualification snapshot distribution
-- 5. get_dashboard_scoring() - Dynamic thresholds & score band distribution
-- 6. get_dashboard_activity(p_start, p_end) - New leads, outbound, inbound, reply rate, FRT, trend
-- 7. get_dashboard_automation(p_start, p_end) - Workflows, sequences, runs, attribution
-- 8. get_dashboard_tasks() - Pending, due today, overdue, completed
-- 9. get_dashboard_demographics() - Primary course interest, canonical sources, preferences
-- 10. get_dashboard_priority_leads(p_limit) - Top scoring leads dynamically thresholded
-- 11. get_dashboard_needs_attention(p_limit) - Explicit actionable criteria with reason codes
-- 12. get_sales_dashboard_metrics(p_start, p_end) - Main modular aggregator RPC
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Performance Composite Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stage_history_to_stage_changed 
  ON public.lead_stage_history(to_stage_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_tasks_status_due_at 
  ON public.tasks(status, due_at);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_sent_status 
  ON public.outbound_messages(status, sent_at);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_automation_run 
  ON public.outbound_messages(automation_run_id) 
  WHERE automation_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_messages_proc_received 
  ON public.inbound_messages(processing_status, received_at);

CREATE INDEX IF NOT EXISTS idx_automation_runs_started_status 
  ON public.automation_runs(status, started_at);


-- -----------------------------------------------------------------------------
-- 2. Helper: get_dashboard_snapshot()
-- Semantics: SNAPSHOT (current CRM state)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads int;
  v_open_tasks int;
  v_open_conversations int;
  v_unread_conversations int;
BEGIN
  SELECT count(*) INTO v_total_leads FROM public.leads;
  
  SELECT count(*) INTO v_open_tasks 
  FROM public.tasks 
  WHERE status = 'pending';
  
  SELECT count(*) INTO v_open_conversations 
  FROM public.conversations 
  WHERE status = 'open';
  
  SELECT count(*) INTO v_unread_conversations 
  FROM public.conversations c
  WHERE c.status = 'open' 
    AND EXISTS (
      SELECT 1 FROM public.inbound_messages im
      WHERE im.conversation_id = c.id
        AND im.read_at IS NULL
    );

  RETURN jsonb_build_object(
    'total_leads', COALESCE(v_total_leads, 0),
    'open_tasks', COALESCE(v_open_tasks, 0),
    'open_conversations', COALESCE(v_open_conversations, 0),
    'unread_conversations', COALESCE(v_unread_conversations, 0)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Helper: get_dashboard_pipeline(p_start_date, p_end_date)
-- Semantics: Current Distribution = SNAPSHOT, Funnel & Movements = PERIOD (COHORT-BASED)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_pipeline(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads int;
  v_current_dist jsonb;
  v_funnel jsonb;
  v_movements_in_period int;
  
  -- Stage IDs for the 5 commercial funnel stages
  v_stage_capture_id uuid;
  v_stage_qual_id uuid;
  v_stage_acq_id uuid;
  v_stage_appr_id uuid;
  v_stage_enroll_id uuid;
  
  -- Cohort Denominators (unique leads that entered stage in period)
  v_denom_capture int := 0;
  v_denom_qual int := 0;
  v_denom_acq int := 0;
  v_denom_appr int := 0;
  v_denom_enroll int := 0;
  
  -- Cohort Numerators (leads from previous stage cohort that reached next stage)
  v_num_qual int := 0;
  v_num_acq int := 0;
  v_num_appr int := 0;
  v_num_enroll int := 0;
  
  v_conv_qual numeric := NULL;
  v_conv_acq numeric := NULL;
  v_conv_appr numeric := NULL;
  v_conv_enroll numeric := NULL;
BEGIN
  SELECT count(*) INTO v_total_leads FROM public.leads;

  -- 1. Current pipeline distribution (SNAPSHOT across all 7 stages)
  WITH stage_counts AS (
    SELECT
      ps.id AS stage_id,
      ps.code AS stage_code,
      ps.name AS stage_name,
      ps.sort_order,
      count(l.id) AS lead_count
    FROM public.pipeline_stages ps
    LEFT JOIN public.leads l ON l.pipeline_stage_id = ps.id
    GROUP BY ps.id, ps.code, ps.name, ps.sort_order
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'stage_id', sc.stage_id,
      'stage_code', sc.stage_code,
      'stage_name', sc.stage_name,
      'sort_order', sc.sort_order,
      'lead_count', sc.lead_count,
      'percentage', CASE 
        WHEN COALESCE(v_total_leads, 0) = 0 THEN 0.0
        ELSE ROUND((sc.lead_count::numeric / v_total_leads::numeric) * 100.0, 1)
      END
    ) ORDER BY sc.sort_order ASC
  )
  INTO v_current_dist
  FROM stage_counts sc;

  -- 2. Stage movements in period
  SELECT count(*) INTO v_movements_in_period
  FROM public.lead_stage_history
  WHERE changed_at >= p_start_date AND changed_at <= p_end_date;

  -- 3. Commercial Funnel (Cohort-based conversion across commercial stages)
  SELECT id INTO v_stage_capture_id FROM public.pipeline_stages WHERE code = 'capture';
  SELECT id INTO v_stage_qual_id FROM public.pipeline_stages WHERE code = 'qualification';
  SELECT id INTO v_stage_acq_id FROM public.pipeline_stages WHERE code = 'acquisition';
  SELECT id INTO v_stage_appr_id FROM public.pipeline_stages WHERE code = 'approval';
  SELECT id INTO v_stage_enroll_id FROM public.pipeline_stages WHERE code = 'enrollment';

  -- A) Stage 1: Capture cohort -> Qual
  WITH cohort_capture AS (
    SELECT lead_id, MIN(changed_at) AS entered_at
    FROM public.lead_stage_history
    WHERE to_stage_id = v_stage_capture_id
      AND changed_at >= p_start_date AND changed_at <= p_end_date
    GROUP BY lead_id
  )
  SELECT 
    count(*),
    count(DISTINCT c.lead_id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.lead_stage_history h
        WHERE h.lead_id = c.lead_id
          AND h.to_stage_id = v_stage_qual_id
          AND h.changed_at >= c.entered_at
      )
    )
  INTO v_denom_capture, v_num_qual
  FROM cohort_capture c;

  IF v_denom_capture > 0 THEN
    v_conv_qual := ROUND((v_num_qual::numeric / v_denom_capture::numeric) * 100.0, 1);
  END IF;

  -- B) Stage 2: Qualification cohort -> Acq
  WITH cohort_qual AS (
    SELECT lead_id, MIN(changed_at) AS entered_at
    FROM public.lead_stage_history
    WHERE to_stage_id = v_stage_qual_id
      AND changed_at >= p_start_date AND changed_at <= p_end_date
    GROUP BY lead_id
  )
  SELECT 
    count(*),
    count(DISTINCT q.lead_id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.lead_stage_history h
        WHERE h.lead_id = q.lead_id
          AND h.to_stage_id = v_stage_acq_id
          AND h.changed_at >= q.entered_at
      )
    )
  INTO v_denom_qual, v_num_acq
  FROM cohort_qual q;

  IF v_denom_qual > 0 THEN
    v_conv_acq := ROUND((v_num_acq::numeric / v_denom_qual::numeric) * 100.0, 1);
  END IF;

  -- C) Stage 3: Acquisition cohort -> Appr
  WITH cohort_acq AS (
    SELECT lead_id, MIN(changed_at) AS entered_at
    FROM public.lead_stage_history
    WHERE to_stage_id = v_stage_acq_id
      AND changed_at >= p_start_date AND changed_at <= p_end_date
    GROUP BY lead_id
  )
  SELECT 
    count(*),
    count(DISTINCT a.lead_id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.lead_stage_history h
        WHERE h.lead_id = a.lead_id
          AND h.to_stage_id = v_stage_appr_id
          AND h.changed_at >= a.entered_at
      )
    )
  INTO v_denom_acq, v_num_appr
  FROM cohort_acq a;

  IF v_denom_acq > 0 THEN
    v_conv_appr := ROUND((v_num_appr::numeric / v_denom_acq::numeric) * 100.0, 1);
  END IF;

  -- D) Stage 4: Approval cohort -> Enroll
  WITH cohort_appr AS (
    SELECT lead_id, MIN(changed_at) AS entered_at
    FROM public.lead_stage_history
    WHERE to_stage_id = v_stage_appr_id
      AND changed_at >= p_start_date AND changed_at <= p_end_date
    GROUP BY lead_id
  )
  SELECT 
    count(*),
    count(DISTINCT ap.lead_id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.lead_stage_history h
        WHERE h.lead_id = ap.lead_id
          AND h.to_stage_id = v_stage_enroll_id
          AND h.changed_at >= ap.entered_at
      )
    )
  INTO v_denom_appr, v_num_enroll
  FROM cohort_appr ap;

  IF v_denom_appr > 0 THEN
    v_conv_enroll := ROUND((v_num_enroll::numeric / v_denom_appr::numeric) * 100.0, 1);
  END IF;

  -- E) Stage 5: Enrollment cohort (unique leads entered in period)
  SELECT count(DISTINCT lead_id) INTO v_denom_enroll
  FROM public.lead_stage_history
  WHERE to_stage_id = v_stage_enroll_id
    AND changed_at >= p_start_date AND changed_at <= p_end_date;

  v_funnel := jsonb_build_array(
    jsonb_build_object(
      'stage_code', 'capture',
      'stage_name', 'Captura',
      'sort_order', 1,
      'unique_leads_entered', v_denom_capture,
      'conversion_from_prev', NULL
    ),
    jsonb_build_object(
      'stage_code', 'qualification',
      'stage_name', 'Qualificação',
      'sort_order', 2,
      'unique_leads_entered', v_denom_qual,
      'conversion_from_prev', v_conv_qual
    ),
    jsonb_build_object(
      'stage_code', 'acquisition',
      'stage_name', 'Aquisição',
      'sort_order', 3,
      'unique_leads_entered', v_denom_acq,
      'conversion_from_prev', v_conv_acq
    ),
    jsonb_build_object(
      'stage_code', 'approval',
      'stage_name', 'Aprovação',
      'sort_order', 4,
      'unique_leads_entered', v_denom_appr,
      'conversion_from_prev', v_conv_appr
    ),
    jsonb_build_object(
      'stage_code', 'enrollment',
      'stage_name', 'Matrícula',
      'sort_order', 5,
      'unique_leads_entered', v_denom_enroll,
      'conversion_from_prev', v_conv_enroll
    )
  );

  RETURN jsonb_build_object(
    'current_distribution', COALESCE(v_current_dist, '[]'::jsonb),
    'funnel', v_funnel,
    'movements_in_period', COALESCE(v_movements_in_period, 0)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Helper: get_dashboard_qualification()
-- Semantics: SNAPSHOT (current leads distribution by qualification_status)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_qualification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads int;
  v_dist jsonb;
  v_confirmed_count int := 0;
BEGIN
  SELECT count(*) INTO v_total_leads FROM public.leads;

  WITH status_keys AS (
    SELECT unnest(ARRAY['hot', 'interested', 'some_response', 'no_response', 'confirmed', 'unassigned']) AS status,
           unnest(ARRAY['Hot', 'Interessado', 'Alguma Resposta', 'Sem Resposta', 'Confirmado', 'Não Definido']) AS label,
           unnest(ARRAY[1, 2, 3, 4, 5, 6]) AS sort_order
  ),
  lead_counts AS (
    SELECT 
      COALESCE(qualification_status, 'unassigned') AS status,
      count(*) AS cnt
    FROM public.leads
    GROUP BY COALESCE(qualification_status, 'unassigned')
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'status', sk.status,
      'label', sk.label,
      'sort_order', sk.sort_order,
      'lead_count', COALESCE(lc.cnt, 0),
      'percentage', CASE 
        WHEN COALESCE(v_total_leads, 0) = 0 THEN 0.0
        ELSE ROUND((COALESCE(lc.cnt, 0)::numeric / v_total_leads::numeric) * 100.0, 1)
      END
    ) ORDER BY sk.sort_order ASC
  )
  INTO v_dist
  FROM status_keys sk
  LEFT JOIN lead_counts lc ON lc.status = sk.status;

  SELECT count(*) INTO v_confirmed_count
  FROM public.leads
  WHERE qualification_status = 'confirmed';

  RETURN jsonb_build_object(
    'distribution', COALESCE(v_dist, '[]'::jsonb),
    'confirmed_count', COALESCE(v_confirmed_count, 0)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. Helper: get_dashboard_scoring()
-- Semantics: SNAPSHOT (current leads distribution by dynamic lead_score_settings)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_scoring()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_total_leads int;
  v_avg_score numeric;
  v_very_hot_count int := 0;
  v_hot_count int := 0;
  v_warm_count int := 0;
  v_cold_count int := 0;
  v_unscored_count int := 0;
  v_hot_and_very_hot_count int := 0;
BEGIN
  -- Read dynamic active thresholds
  SELECT cold_min, cold_max, warm_min, warm_max, hot_min, hot_max, very_hot_min, very_hot_max
  INTO v_settings
  FROM public.lead_score_settings
  LIMIT 1;

  IF v_settings IS NULL THEN
    v_settings := ROW(0, 24, 25, 49, 50, 74, 75, 100);
  END IF;

  SELECT count(*) INTO v_total_leads FROM public.leads;

  SELECT ROUND(AVG(lead_score)::numeric, 1)
  INTO v_avg_score
  FROM public.leads
  WHERE lead_score IS NOT NULL;

  SELECT
    count(*) FILTER (WHERE lead_score >= v_settings.very_hot_min),
    count(*) FILTER (WHERE lead_score >= v_settings.hot_min AND lead_score <= v_settings.hot_max),
    count(*) FILTER (WHERE lead_score >= v_settings.warm_min AND lead_score <= v_settings.warm_max),
    count(*) FILTER (WHERE lead_score >= v_settings.cold_min AND lead_score <= v_settings.cold_max),
    count(*) FILTER (WHERE lead_score IS NULL),
    count(*) FILTER (WHERE lead_score >= v_settings.hot_min)
  INTO
    v_very_hot_count,
    v_hot_count,
    v_warm_count,
    v_cold_count,
    v_unscored_count,
    v_hot_and_very_hot_count
  FROM public.leads;

  RETURN jsonb_build_object(
    'thresholds', jsonb_build_object(
      'cold_min', v_settings.cold_min,
      'cold_max', v_settings.cold_max,
      'warm_min', v_settings.warm_min,
      'warm_max', v_settings.warm_max,
      'hot_min', v_settings.hot_min,
      'hot_max', v_settings.hot_max,
      'very_hot_min', v_settings.very_hot_min,
      'very_hot_max', v_settings.very_hot_max
    ),
    'average_score', COALESCE(v_avg_score, 0.0),
    'hot_and_very_hot_count', COALESCE(v_hot_and_very_hot_count, 0),
    'distribution', jsonb_build_array(
      jsonb_build_object(
        'category', 'very_hot',
        'label', 'Very Hot',
        'min_score', v_settings.very_hot_min,
        'max_score', v_settings.very_hot_max,
        'lead_count', v_very_hot_count,
        'percentage', CASE WHEN v_total_leads = 0 THEN 0.0 ELSE ROUND((v_very_hot_count::numeric / v_total_leads::numeric) * 100.0, 1) END
      ),
      jsonb_build_object(
        'category', 'hot',
        'label', 'Hot',
        'min_score', v_settings.hot_min,
        'max_score', v_settings.hot_max,
        'lead_count', v_hot_count,
        'percentage', CASE WHEN v_total_leads = 0 THEN 0.0 ELSE ROUND((v_hot_count::numeric / v_total_leads::numeric) * 100.0, 1) END
      ),
      jsonb_build_object(
        'category', 'warm',
        'label', 'Warm',
        'min_score', v_settings.warm_min,
        'max_score', v_settings.warm_max,
        'lead_count', v_warm_count,
        'percentage', CASE WHEN v_total_leads = 0 THEN 0.0 ELSE ROUND((v_warm_count::numeric / v_total_leads::numeric) * 100.0, 1) END
      ),
      jsonb_build_object(
        'category', 'cold',
        'label', 'Cold',
        'min_score', v_settings.cold_min,
        'max_score', v_settings.cold_max,
        'lead_count', v_cold_count,
        'percentage', CASE WHEN v_total_leads = 0 THEN 0.0 ELSE ROUND((v_cold_count::numeric / v_total_leads::numeric) * 100.0, 1) END
      ),
      jsonb_build_object(
        'category', 'unscored',
        'label', 'Sem Score',
        'min_score', NULL,
        'max_score', NULL,
        'lead_count', v_unscored_count,
        'percentage', CASE WHEN v_total_leads = 0 THEN 0.0 ELSE ROUND((v_unscored_count::numeric / v_total_leads::numeric) * 100.0, 1) END
      )
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. Helper: get_dashboard_activity(p_start_date, p_end_date)
-- Semantics: PERIOD (Outbound, Inbound, Reply Rate, First Response Time, Daily Trend)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_activity(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_leads_count int;
  v_outbound_sent_count int;
  v_outbound_unique_leads int;
  v_inbound_replies_count int;
  v_inbound_unique_leads int;
  v_reply_rate numeric := NULL;
  v_avg_frt_seconds numeric := NULL;
  v_trend jsonb;
BEGIN
  -- 1. New Leads in period
  SELECT count(*) INTO v_new_leads_count
  FROM public.leads
  WHERE created_at >= p_start_date AND created_at <= p_end_date;

  -- 2. Real Outbound sent in period (emails + sms, excluding failed/pending)
  SELECT count(*), count(DISTINCT lead_id)
  INTO v_outbound_sent_count, v_outbound_unique_leads
  FROM public.outbound_messages
  WHERE status = 'sent'
    AND channel IN ('email', 'sms')
    AND sent_at >= p_start_date AND sent_at <= p_end_date
    AND lead_id IS NOT NULL;

  -- 3. Inbound replies processed in period
  SELECT count(*), count(DISTINCT lead_id)
  INTO v_inbound_replies_count, v_inbound_unique_leads
  FROM public.inbound_messages
  WHERE processing_status = 'processed'
    AND received_at >= p_start_date AND received_at <= p_end_date
    AND lead_id IS NOT NULL;

  -- 4. Reply rate: numerator = unique leads with inbound reply; denominator = unique leads with outbound sent
  IF COALESCE(v_outbound_unique_leads, 0) > 0 THEN
    v_reply_rate := ROUND((v_inbound_unique_leads::numeric / v_outbound_unique_leads::numeric) * 100.0, 1);
  ELSE
    v_reply_rate := NULL; -- No data (do not show misleading 0%)
  END IF;

  -- 5. First Response Time (elapsed from first outbound to first subsequent inbound reply)
  WITH lead_first_outbound AS (
    SELECT lead_id, MIN(sent_at) AS first_outbound_at
    FROM public.outbound_messages
    WHERE status = 'sent'
      AND channel IN ('email', 'sms')
      AND lead_id IS NOT NULL
    GROUP BY lead_id
  ),
  lead_frt AS (
    SELECT
      lfo.lead_id,
      lfo.first_outbound_at,
      MIN(im.received_at) AS first_inbound_at
    FROM lead_first_outbound lfo
    JOIN public.inbound_messages im
      ON im.lead_id = lfo.lead_id
      AND im.processing_status = 'processed'
      AND im.received_at > lfo.first_outbound_at
    WHERE im.received_at >= p_start_date AND im.received_at <= p_end_date
    GROUP BY lfo.lead_id, lfo.first_outbound_at
  )
  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (first_inbound_at - first_outbound_at))))
  INTO v_avg_frt_seconds
  FROM lead_frt;

  -- 6. Activity Daily Trend (Continuous daily buckets with zero-filling)
  WITH date_series AS (
    SELECT generate_series(
      date_trunc('day', p_start_date),
      date_trunc('day', p_end_date),
      interval '1 day'
    ) AS bucket_day
  ),
  daily_leads AS (
    SELECT date_trunc('day', created_at) AS b_day, count(*) AS cnt
    FROM public.leads
    WHERE created_at >= p_start_date AND created_at <= p_end_date
    GROUP BY date_trunc('day', created_at)
  ),
  daily_outbound AS (
    SELECT date_trunc('day', sent_at) AS b_day, count(*) AS cnt
    FROM public.outbound_messages
    WHERE status = 'sent' AND channel IN ('email', 'sms')
      AND sent_at >= p_start_date AND sent_at <= p_end_date
    GROUP BY date_trunc('day', sent_at)
  ),
  daily_inbound AS (
    SELECT date_trunc('day', received_at) AS b_day, count(*) AS cnt
    FROM public.inbound_messages
    WHERE processing_status = 'processed'
      AND received_at >= p_start_date AND received_at <= p_end_date
    GROUP BY date_trunc('day', received_at)
  ),
  daily_movements AS (
    SELECT date_trunc('day', changed_at) AS b_day, count(*) AS cnt
    FROM public.lead_stage_history
    WHERE changed_at >= p_start_date AND changed_at <= p_end_date
    GROUP BY date_trunc('day', changed_at)
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', to_char(ds.bucket_day, 'YYYY-MM-DD'),
      'new_leads', COALESCE(dl.cnt, 0),
      'outbound_messages', COALESCE(dob.cnt, 0),
      'inbound_replies', COALESCE(dib.cnt, 0),
      'stage_movements', COALESCE(dm.cnt, 0)
    ) ORDER BY ds.bucket_day ASC
  )
  INTO v_trend
  FROM date_series ds
  LEFT JOIN daily_leads dl ON dl.b_day = ds.bucket_day
  LEFT JOIN daily_outbound dob ON dob.b_day = ds.bucket_day
  LEFT JOIN daily_inbound dib ON dib.b_day = ds.bucket_day
  LEFT JOIN daily_movements dm ON dm.b_day = ds.bucket_day;

  RETURN jsonb_build_object(
    'new_leads_count', COALESCE(v_new_leads_count, 0),
    'outbound_sent_count', COALESCE(v_outbound_sent_count, 0),
    'outbound_unique_leads', COALESCE(v_outbound_unique_leads, 0),
    'inbound_replies_count', COALESCE(v_inbound_replies_count, 0),
    'inbound_unique_leads', COALESCE(v_inbound_unique_leads, 0),
    'reply_rate', v_reply_rate,
    'avg_first_response_time_seconds', v_avg_frt_seconds,
    'trend', COALESCE(v_trend, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. Helper: get_dashboard_automation(p_start_date, p_end_date)
-- Semantics: Active status = SNAPSHOT, Period runs & Sequence performance = PERIOD
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_automation(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_workflows int;
  v_active_sequences int;
  v_period_runs_total int;
  v_period_runs_completed int;
  v_period_runs_failed int;
  v_seq_perf jsonb;
BEGIN
  -- Snapshot counts
  SELECT count(*) INTO v_active_workflows 
  FROM public.automations 
  WHERE automation_type = 'workflow' AND status = 'active';

  SELECT count(*) INTO v_active_sequences 
  FROM public.automations 
  WHERE automation_type = 'sequence' AND status = 'active';

  -- Period execution
  SELECT count(*) INTO v_period_runs_total
  FROM public.automation_runs
  WHERE started_at >= p_start_date AND started_at <= p_end_date;

  SELECT count(*) INTO v_period_runs_completed
  FROM public.automation_runs
  WHERE status = 'completed'
    AND completed_at >= p_start_date AND completed_at <= p_end_date;

  SELECT count(*) INTO v_period_runs_failed
  FROM public.automation_runs
  WHERE status = 'failed'
    AND (
      (completed_at >= p_start_date AND completed_at <= p_end_date)
      OR
      (started_at >= p_start_date AND started_at <= p_end_date)
    );

  -- Sequence Performance with strict reply attribution
  -- Attribution rule: inbound reply in period -> preceding sequence outbound sent on same conversation/channel
  WITH sequence_outbounds AS (
    SELECT
      om.id AS outbound_id,
      om.lead_id,
      om.conversation_id,
      om.channel,
      om.sent_at,
      ar.automation_id AS sequence_id
    FROM public.outbound_messages om
    JOIN public.automation_runs ar ON ar.id = om.automation_run_id
    JOIN public.automations a ON a.id = ar.automation_id
    WHERE a.automation_type = 'sequence'
      AND om.status = 'sent'
  ),
  attributed_inbounds AS (
    SELECT
      im.id AS inbound_id,
      (
        SELECT so.sequence_id
        FROM sequence_outbounds so
        WHERE (
          (so.conversation_id IS NOT NULL AND so.conversation_id = im.conversation_id)
          OR
          (so.lead_id = im.lead_id AND so.channel = im.channel)
        )
        AND so.sent_at < im.received_at
        ORDER BY so.sent_at DESC
        LIMIT 1
      ) AS sequence_id
    FROM public.inbound_messages im
    WHERE im.processing_status = 'processed'
      AND im.received_at >= p_start_date AND im.received_at <= p_end_date
      AND im.lead_id IS NOT NULL
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'sequence_id', s.id,
      'sequence_name', s.name,
      'status', s.status,
      'active_runs', (
        SELECT count(*) FROM public.automation_runs ar
        WHERE ar.automation_id = s.id AND ar.status IN ('running', 'waiting')
      ),
      'completed_runs', (
        SELECT count(*) FROM public.automation_runs ar
        WHERE ar.automation_id = s.id AND ar.status = 'completed'
          AND ar.completed_at >= p_start_date AND ar.completed_at <= p_end_date
      ),
      'outbound_sent', (
        SELECT count(*) FROM public.outbound_messages om
        JOIN public.automation_runs ar ON ar.id = om.automation_run_id
        WHERE ar.automation_id = s.id AND om.status = 'sent'
          AND om.sent_at >= p_start_date AND om.sent_at <= p_end_date
      ),
      'replies_attributed', (
        SELECT count(*) FROM attributed_inbounds ai
        WHERE ai.sequence_id = s.id
      ),
      'reply_rate', (
        SELECT CASE
          WHEN (
            SELECT count(*) FROM public.outbound_messages om
            JOIN public.automation_runs ar ON ar.id = om.automation_run_id
            WHERE ar.automation_id = s.id AND om.status = 'sent'
              AND om.sent_at >= p_start_date AND om.sent_at <= p_end_date
          ) = 0 THEN NULL
          ELSE ROUND(
            (SELECT count(*) FROM attributed_inbounds ai WHERE ai.sequence_id = s.id)::numeric /
            (SELECT count(*) FROM public.outbound_messages om
             JOIN public.automation_runs ar ON ar.id = om.automation_run_id
             WHERE ar.automation_id = s.id AND om.status = 'sent'
               AND om.sent_at >= p_start_date AND om.sent_at <= p_end_date)::numeric * 100.0,
            1
          )
        END
      )
    ) ORDER BY s.name ASC
  )
  INTO v_seq_perf
  FROM public.automations s
  WHERE s.automation_type = 'sequence';

  RETURN jsonb_build_object(
    'active_workflows', COALESCE(v_active_workflows, 0),
    'active_sequences', COALESCE(v_active_sequences, 0),
    'period_runs_total', COALESCE(v_period_runs_total, 0),
    'period_runs_completed', COALESCE(v_period_runs_completed, 0),
    'period_runs_failed', COALESCE(v_period_runs_failed, 0),
    'sequences_performance', COALESCE(v_seq_perf, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. Helper: get_dashboard_tasks()
-- Semantics: SNAPSHOT (Statuses verified strictly: pending, completed, cancelled)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_tasks int;
  v_due_today int;
  v_overdue int;
  v_completed_all_time int;
BEGIN
  -- 1. Pending tasks (open)
  SELECT count(*) INTO v_pending_tasks
  FROM public.tasks
  WHERE status = 'pending';

  -- 2. Due today (status pending AND due_at within current system day)
  SELECT count(*) INTO v_due_today
  FROM public.tasks
  WHERE status = 'pending'
    AND due_at >= date_trunc('day', now())
    AND due_at < date_trunc('day', now()) + interval '1 day';

  -- 3. Overdue (status pending AND due_at < now())
  SELECT count(*) INTO v_overdue
  FROM public.tasks
  WHERE status = 'pending'
    AND due_at < now();

  -- 4. Completed all-time
  SELECT count(*) INTO v_completed_all_time
  FROM public.tasks
  WHERE status = 'completed';

  RETURN jsonb_build_object(
    'pending_tasks', COALESCE(v_pending_tasks, 0),
    'due_today', COALESCE(v_due_today, 0),
    'overdue', COALESCE(v_overdue, 0),
    'completed_all_time', COALESCE(v_completed_all_time, 0)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. Helper: get_dashboard_demographics()
-- Semantics: SNAPSHOT (Primary Course Interest, Canonical Source, Contact Preference)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_demographics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads int;
  v_courses jsonb;
  v_sources jsonb;
  v_prefs jsonb;
BEGIN
  SELECT count(*) INTO v_total_leads FROM public.leads;

  -- 1. Primary Course Interest (leads.course_interest, no duplicate multi-counting)
  WITH course_counts AS (
    SELECT
      COALESCE(NULLIF(trim(course_interest), ''), 'Não informado') AS course_name,
      count(*) AS cnt
    FROM public.leads
    GROUP BY COALESCE(NULLIF(trim(course_interest), ''), 'Não informado')
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'course_name', cc.course_name,
      'lead_count', cc.cnt,
      'percentage', CASE 
        WHEN COALESCE(v_total_leads, 0) = 0 THEN 0.0
        ELSE ROUND((cc.cnt::numeric / v_total_leads::numeric) * 100.0, 1)
      END
    ) ORDER BY cc.cnt DESC, cc.course_name ASC
  )
  INTO v_courses
  FROM course_counts cc;

  -- 2. Canonical Sources ('meta', 'google', 'manual', 'test', 'form', 'Unknown')
  WITH source_counts AS (
    SELECT
      CASE 
        WHEN source IN ('meta', 'google', 'manual', 'test', 'form') THEN source
        ELSE 'Unknown'
      END AS source_canonical,
      count(*) AS cnt
    FROM public.leads
    GROUP BY 
      CASE 
        WHEN source IN ('meta', 'google', 'manual', 'test', 'form') THEN source
        ELSE 'Unknown'
      END
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'source', sc.source_canonical,
      'lead_count', sc.cnt,
      'percentage', CASE 
        WHEN COALESCE(v_total_leads, 0) = 0 THEN 0.0
        ELSE ROUND((sc.cnt::numeric / v_total_leads::numeric) * 100.0, 1)
      END
    ) ORDER BY sc.cnt DESC, sc.source_canonical ASC
  )
  INTO v_sources
  FROM source_counts sc;

  -- 3. Contact Preference ('email', 'sms', 'call')
  WITH pref_counts AS (
    SELECT
      contact_preference,
      count(*) AS cnt
    FROM public.leads
    GROUP BY contact_preference
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'preference', pc.contact_preference,
      'lead_count', pc.cnt,
      'percentage', CASE 
        WHEN COALESCE(v_total_leads, 0) = 0 THEN 0.0
        ELSE ROUND((pc.cnt::numeric / v_total_leads::numeric) * 100.0, 1)
      END
    ) ORDER BY pc.cnt DESC
  )
  INTO v_prefs
  FROM pref_counts pc;

  RETURN jsonb_build_object(
    'course_interest', COALESCE(v_courses, '[]'::jsonb),
    'sources', COALESCE(v_sources, '[]'::jsonb),
    'contact_preference', COALESCE(v_prefs, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. Helper: get_dashboard_priority_leads(p_limit)
-- Dynamically follows lead_score_settings threshold
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_priority_leads(
  p_limit int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_leads jsonb;
BEGIN
  SELECT cold_min, cold_max, warm_min, warm_max, hot_min, hot_max, very_hot_min, very_hot_max
  INTO v_settings
  FROM public.lead_score_settings
  LIMIT 1;

  IF v_settings IS NULL THEN
    v_settings := ROW(0, 24, 25, 49, 50, 74, 75, 100);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'first_name', l.first_name,
      'last_name', l.last_name,
      'email', l.email,
      'phone_e164', l.phone_e164,
      'lead_score', l.lead_score,
      'lead_score_category', CASE
        WHEN l.lead_score >= v_settings.very_hot_min THEN 'very_hot'
        WHEN l.lead_score >= v_settings.hot_min THEN 'hot'
        WHEN l.lead_score >= v_settings.warm_min THEN 'warm'
        WHEN l.lead_score IS NOT NULL THEN 'cold'
        ELSE 'unscored'
      END,
      'stage_code', ps.code,
      'stage_name', ps.name,
      'qualification_status', l.qualification_status,
      'course_interest', l.course_interest,
      'created_at', l.created_at,
      'updated_at', l.updated_at
    )
  )
  INTO v_leads
  FROM (
    SELECT l.*
    FROM public.leads l
    ORDER BY l.lead_score DESC NULLS LAST, l.created_at DESC
    LIMIT p_limit
  ) l
  JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id;

  RETURN COALESCE(v_leads, '[]'::jsonb);
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. Helper: get_dashboard_needs_attention(p_limit)
-- Transparent criteria with explicit reason_code and reason_label
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_needs_attention(
  p_limit int DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_items jsonb;
BEGIN
  SELECT cold_min, cold_max, warm_min, warm_max, hot_min, hot_max, very_hot_min, very_hot_max
  INTO v_settings
  FROM public.lead_score_settings
  LIMIT 1;

  IF v_settings IS NULL THEN
    v_settings := ROW(0, 24, 25, 49, 50, 74, 75, 100);
  END IF;

  WITH candidate_attention AS (
    -- A) HIGH_SCORE_NO_NEXT_ACTION:
    -- Score >= Hot threshold, no active automation/sequence, no open pending task
    SELECT
      l.id AS lead_id,
      COALESCE(NULLIF(trim(concat(l.first_name, ' ', l.last_name)), ''), l.email, 'Lead') AS lead_name,
      l.email AS lead_email,
      'HIGH_SCORE_NO_NEXT_ACTION' AS reason_code,
      'Lead quente sem próxima ação' AS reason_label,
      l.updated_at AS detected_at,
      format('Score %s sem automação ativa ou tarefa pendente', l.lead_score) AS detail,
      1 AS priority_weight
    FROM public.leads l
    WHERE l.lead_score >= v_settings.hot_min
      AND NOT EXISTS (
        SELECT 1 FROM public.automation_runs ar
        WHERE ar.lead_id = l.id AND ar.status IN ('running', 'waiting')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id AND t.status = 'pending'
      )

    UNION ALL

    -- B) OVERDUE_TASK:
    -- Task status pending AND due_at < now()
    SELECT
      l.id AS lead_id,
      COALESCE(NULLIF(trim(concat(l.first_name, ' ', l.last_name)), ''), l.email, 'Lead') AS lead_name,
      l.email AS lead_email,
      'OVERDUE_TASK' AS reason_code,
      'Tarefa em atraso' AS reason_label,
      t.due_at AS detected_at,
      format('Tarefa "%s" venceu em %s', t.title, to_char(t.due_at, 'DD/MM/YYYY HH24:MI')) AS detail,
      2 AS priority_weight
    FROM public.tasks t
    JOIN public.leads l ON l.id = t.lead_id
    WHERE t.status = 'pending'
      AND t.due_at < now()

    UNION ALL

    -- C) FAILED_AUTOMATION:
    -- Automation run status = failed
    SELECT
      l.id AS lead_id,
      COALESCE(NULLIF(trim(concat(l.first_name, ' ', l.last_name)), ''), l.email, 'Lead') AS lead_name,
      l.email AS lead_email,
      'FAILED_AUTOMATION' AS reason_code,
      'Falha na automação' AS reason_label,
      ar.completed_at AS detected_at,
      format('Falha na execução da automação "%s"', a.name) AS detail,
      3 AS priority_weight
    FROM public.automation_runs ar
    JOIN public.automations a ON a.id = ar.automation_id
    JOIN public.leads l ON l.id = ar.lead_id
    WHERE ar.status = 'failed'

    UNION ALL

    -- D) FAILED_INBOUND:
    -- Inbound message processing_status = failed
    SELECT
      l.id AS lead_id,
      COALESCE(NULLIF(trim(concat(l.first_name, ' ', l.last_name)), ''), l.email, 'Lead') AS lead_name,
      l.email AS lead_email,
      'FAILED_INBOUND' AS reason_code,
      'Falha no processamento inbound' AS reason_label,
      im.received_at AS detected_at,
      format('Erro ao processar resposta via %s: %s', im.channel, COALESCE(im.processing_error, 'Erro desconhecido')) AS detail,
      4 AS priority_weight
    FROM public.inbound_messages im
    JOIN public.leads l ON l.id = im.lead_id
    WHERE im.processing_status = 'failed'

    UNION ALL

    -- E) UNREAD_CONVERSATION:
    -- Open conversation with unread inbound messages
    SELECT
      l.id AS lead_id,
      COALESCE(NULLIF(trim(concat(l.first_name, ' ', l.last_name)), ''), l.email, 'Lead') AS lead_name,
      l.email AS lead_email,
      'UNREAD_CONVERSATION' AS reason_code,
      'Conversa não lida' AS reason_label,
      c.last_message_at AS detected_at,
      format('Mensagem recebida não lida via %s', c.channel) AS detail,
      5 AS priority_weight
    FROM public.conversations c
    JOIN public.leads l ON l.id = c.lead_id
    WHERE c.status = 'open'
      AND EXISTS (
        SELECT 1 FROM public.inbound_messages im
        WHERE im.conversation_id = c.id
          AND im.read_at IS NULL
      )

    UNION ALL

    -- F) NO_RESPONSE_STALE:
    -- qualification_status = 'no_response' AND inactivity > 7 days
    SELECT
      l.id AS lead_id,
      COALESCE(NULLIF(trim(concat(l.first_name, ' ', l.last_name)), ''), l.email, 'Lead') AS lead_name,
      l.email AS lead_email,
      'NO_RESPONSE_STALE' AS reason_code,
      'Lead sem resposta há mais de 7 dias' AS reason_label,
      l.updated_at AS detected_at,
      'Sem resposta e inativo há mais de 7 dias' AS detail,
      6 AS priority_weight
    FROM public.leads l
    WHERE l.qualification_status = 'no_response'
      AND l.updated_at < (now() - interval '7 days')
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'lead_id', ca.lead_id,
      'lead_name', ca.lead_name,
      'lead_email', ca.lead_email,
      'reason_code', ca.reason_code,
      'reason_label', ca.reason_label,
      'detected_at', ca.detected_at,
      'detail', ca.detail
    )
  )
  INTO v_items
  FROM (
    SELECT *
    FROM candidate_attention
    ORDER BY priority_weight ASC, detected_at DESC
    LIMIT p_limit
  ) ca;

  RETURN COALESCE(v_items, '[]'::jsonb);
END;
$$;


-- -----------------------------------------------------------------------------
-- 12. Main Aggregator RPC: get_sales_dashboard_metrics(p_start_date, p_end_date)
-- Clean, modular facade returning unified JSON payload for the frontend
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_dashboard_metrics(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_pipeline jsonb;
  v_qualification jsonb;
  v_scoring jsonb;
  v_activity jsonb;
  v_automation jsonb;
  v_tasks jsonb;
  v_demographics jsonb;
  v_priority_leads jsonb;
  v_needs_attention jsonb;
BEGIN
  -- Authenticated user validation
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: active app user required';
  END IF;

  -- Modular invocations
  v_snapshot := public.get_dashboard_snapshot();
  v_pipeline := public.get_dashboard_pipeline(p_start_date, p_end_date);
  v_qualification := public.get_dashboard_qualification();
  v_scoring := public.get_dashboard_scoring();
  v_activity := public.get_dashboard_activity(p_start_date, p_end_date);
  v_automation := public.get_dashboard_automation(p_start_date, p_end_date);
  v_tasks := public.get_dashboard_tasks();
  v_demographics := public.get_dashboard_demographics();
  v_priority_leads := public.get_dashboard_priority_leads(10);
  v_needs_attention := public.get_dashboard_needs_attention(15);

  RETURN jsonb_build_object(
    'snapshot', v_snapshot,
    'pipeline', v_pipeline,
    'qualification', v_qualification,
    'scoring', v_scoring,
    'activity', v_activity,
    'automation', v_automation,
    'tasks', v_tasks,
    'demographics', v_demographics,
    'priority_leads', v_priority_leads,
    'needs_attention', v_needs_attention,
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'generated_at', now()
  );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_pipeline(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_qualification() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_scoring() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_activity(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_automation(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_demographics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_priority_leads(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_needs_attention(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_dashboard_metrics(timestamptz, timestamptz) TO authenticated;

-- Deny anon
REVOKE EXECUTE ON FUNCTION public.get_sales_dashboard_metrics(timestamptz, timestamptz) FROM anon;
