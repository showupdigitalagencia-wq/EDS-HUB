-- =============================================================================
-- Migration 00040: Phase 5 Block 2 — Executive Reporting & Analytics Layer
-- =============================================================================
-- 1. Performance Indexes for Analytics Queries
-- 2. Organization Timezone & Period Calculator Helper: calculate_report_period_bounds
-- 3. Trend Granularity Helper: get_report_bucket_interval
-- 4. Safe Percent Change Calculation Helper: calculate_percent_change
-- 5. RPC 1: get_reports_executive_overview
-- 6. RPC 2: get_reports_funnel
-- 7. RPC 3: get_reports_revenue
-- 8. RPC 4: get_reports_sources
-- 9. RPC 5: get_reports_courses
-- 10. RPC 6: get_reports_engagement
-- 11. RPC 7: get_reports_post_course
-- 12. Security Grants & Permissions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Performance Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_source_created_at 
  ON public.leads(source, created_at);

CREATE INDEX IF NOT EXISTS idx_enrollments_status_source_date 
  ON public.enrollments(enrollment_status, source, enrollment_date);

CREATE INDEX IF NOT EXISTS idx_enrollment_payments_date_type_status 
  ON public.enrollment_payments(payment_date, payment_type, payment_status);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_status_skip 
  ON public.automation_run_steps(status, skip_reason_code) 
  WHERE status = 'skipped';

CREATE INDEX IF NOT EXISTS idx_form_submissions_lead_date 
  ON public.form_submissions(form_id, submitted_at, lead_id);


-- -----------------------------------------------------------------------------
-- 2. Organization Timezone & Period Calculator Helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_report_period_bounds(
  p_start_date DATE,
  p_end_date DATE,
  p_override_tz TEXT DEFAULT NULL
)
RETURNS TABLE (
  org_tz TEXT,
  curr_start_ts TIMESTAMPTZ,
  curr_end_ts TIMESTAMPTZ,
  prev_start_ts TIMESTAMPTZ,
  prev_end_ts TIMESTAMPTZ,
  duration_days INT,
  prev_start_date DATE,
  prev_end_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_duration INT;
  v_prev_start DATE;
  v_prev_end DATE;
  v_c_start TIMESTAMPTZ;
  v_c_end TIMESTAMPTZ;
  v_p_start TIMESTAMPTZ;
  v_p_end TIMESTAMPTZ;
BEGIN
  IF p_override_tz IS NOT NULL AND trim(p_override_tz) != '' THEN
    v_tz := p_override_tz;
  ELSE
    SELECT COALESCE(NULLIF(timezone, ''), 'America/New_York')
    INTO v_tz
    FROM public.app_settings
    LIMIT 1;
    v_tz := COALESCE(v_tz, 'America/New_York');
  END IF;

  v_duration := p_end_date - p_start_date + 1;
  IF v_duration < 1 THEN
    v_duration := 1;
  END IF;

  v_prev_end := p_start_date - 1;
  v_prev_start := p_start_date - v_duration;

  -- Semi-open interval [start, end)
  v_c_start := (p_start_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_c_end := ((p_end_date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  v_p_start := (v_prev_start::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_p_end := ((v_prev_end + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  RETURN QUERY SELECT 
    v_tz,
    v_c_start,
    v_c_end,
    v_p_start,
    v_p_end,
    v_duration,
    v_prev_start,
    v_prev_end;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Trend Granularity Helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_bucket_interval(
  p_start_date DATE,
  p_end_date DATE,
  p_override TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_duration INT;
BEGIN
  IF p_override IS NOT NULL AND p_override IN ('daily', 'weekly', 'monthly') THEN
    RETURN CASE p_override
      WHEN 'daily' THEN '1 day'
      WHEN 'weekly' THEN '1 week'
      WHEN 'monthly' THEN '1 month'
    END;
  END IF;

  v_duration := p_end_date - p_start_date + 1;
  IF v_duration <= 31 THEN
    RETURN '1 day';
  ELSIF v_duration <= 180 THEN
    RETURN '1 week';
  ELSE
    RETURN '1 month';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Helper: Safe Percent Change Calculation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_percent_change(
  p_current NUMERIC,
  p_previous NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_diff NUMERIC;
  v_pct NUMERIC;
BEGIN
  IF p_previous IS NULL OR p_previous = 0 THEN
    IF p_current IS NOT NULL AND p_current > 0 THEN
      RETURN jsonb_build_object(
        'current', p_current,
        'previous', p_previous,
        'percent_change', NULL,
        'comparison_status', 'new'
      );
    ELSE
      RETURN jsonb_build_object(
        'current', COALESCE(p_current, 0),
        'previous', p_previous,
        'percent_change', NULL,
        'comparison_status', 'no_comparison'
      );
    END IF;
  END IF;

  v_diff := p_current - p_previous;
  v_pct := ROUND((v_diff / abs(p_previous)) * 100.0, 1);

  RETURN jsonb_build_object(
    'current', p_current,
    'previous', p_previous,
    'percent_change', v_pct,
    'comparison_status', CASE 
      WHEN v_pct > 0 THEN 'positive'
      WHEN v_pct < 0 THEN 'negative'
      ELSE 'neutral'
    END
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. RPC 1: get_reports_executive_overview
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_executive_overview(
  p_start_date DATE,
  p_end_date DATE,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  v_curr_leads_created INT := 0;
  v_prev_leads_created INT := 0;
  
  v_curr_confirmed_enrollments INT := 0;
  v_prev_confirmed_enrollments INT := 0;
  
  v_curr_gross_collected NUMERIC(12,2) := 0.00;
  v_prev_gross_collected NUMERIC(12,2) := 0.00;
  
  v_curr_refunded NUMERIC(12,2) := 0.00;
  v_prev_refunded NUMERIC(12,2) := 0.00;
  
  v_curr_net_revenue NUMERIC(12,2) := 0.00;
  v_prev_net_revenue NUMERIC(12,2) := 0.00;
  
  v_curr_booked_value NUMERIC(12,2) := 0.00;
  v_prev_booked_value NUMERIC(12,2) := 0.00;

  v_current_outstanding NUMERIC(12,2) := 0.00;
  v_current_hot_leads INT := 0;
  v_current_active_leads INT := 0;

  -- Conversion rates
  v_curr_cohort_leads_enrolled INT := 0;
  v_prev_cohort_leads_enrolled INT := 0;
  v_curr_conv_rate NUMERIC(5,2) := NULL;
  v_prev_conv_rate NUMERIC(5,2) := NULL;

  -- Repeat students
  v_curr_repeat_enrollments INT := 0;
  v_curr_new_enrollments INT := 0;
  v_curr_repeat_rate NUMERIC(5,2) := NULL;

  -- Reply rates
  v_curr_outbound_leads INT := 0;
  v_curr_replied_leads INT := 0;
  v_curr_reply_rate NUMERIC(5,2) := NULL;
  v_prev_outbound_leads INT := 0;
  v_prev_replied_leads INT := 0;
  v_prev_reply_rate NUMERIC(5,2) := NULL;

  -- Thresholds
  v_hot_min INT := 50;

  -- Output collections
  v_top_courses JSONB := '[]'::jsonb;
  v_top_sources JSONB := '[]'::jsonb;
  v_trend JSONB := '[]'::jsonb;
  v_bucket_interval TEXT;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  SELECT COALESCE(hot_min, 50) INTO v_hot_min 
  FROM public.lead_score_settings 
  LIMIT 1;

  -- 1. Leads Created (Current & Previous)
  SELECT COUNT(*) INTO v_curr_leads_created
  FROM public.leads l
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  SELECT COUNT(*) INTO v_prev_leads_created
  FROM public.leads l
  WHERE l.created_at >= v_bounds.prev_start_ts AND l.created_at < v_bounds.prev_end_ts
    AND (p_include_test = true OR l.source != 'test');

  -- 2. Confirmed Enrollments in period (using canonical confirmation date)
  WITH canonical_enrollments AS (
    SELECT 
      e.id,
      e.lead_id,
      e.course_id,
      e.agreed_amount,
      e.currency,
      e.source,
      COALESCE(
        (
          SELECT MIN(eh.created_at) 
          FROM public.enrollment_history eh 
          WHERE eh.enrollment_id = e.id 
            AND (
              (eh.event_type = 'enrollment_created' AND eh.new_values->>'status' = 'confirmed')
              OR (eh.event_type = 'enrollment_status_changed' AND eh.new_values->>'status' = 'confirmed')
            )
        ),
        (e.enrollment_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_bounds.org_tz,
        e.created_at
      ) AS confirmed_at,
      ROW_NUMBER() OVER (
        PARTITION BY e.lead_id 
        ORDER BY 
          COALESCE(
            (SELECT MIN(eh.created_at) FROM public.enrollment_history eh WHERE eh.enrollment_id = e.id AND eh.new_values->>'status' = 'confirmed'),
            (e.enrollment_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_bounds.org_tz,
            e.created_at
          ) ASC, 
          e.id ASC
      ) AS student_enrollment_order
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
  )
  SELECT 
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts),
    COALESCE(SUM(ce.agreed_amount) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts AND ce.currency = 'USD'), 0.00),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts AND ce.student_enrollment_order = 1),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts AND ce.student_enrollment_order > 1),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.prev_start_ts AND ce.confirmed_at < v_bounds.prev_end_ts),
    COALESCE(SUM(ce.agreed_amount) FILTER (WHERE ce.confirmed_at >= v_bounds.prev_start_ts AND ce.confirmed_at < v_bounds.prev_end_ts AND ce.currency = 'USD'), 0.00)
  INTO 
    v_curr_confirmed_enrollments,
    v_curr_booked_value,
    v_curr_new_enrollments,
    v_curr_repeat_enrollments,
    v_prev_confirmed_enrollments,
    v_prev_booked_value
  FROM canonical_enrollments ce;

  IF v_curr_confirmed_enrollments > 0 THEN
    v_curr_repeat_rate := ROUND((v_curr_repeat_enrollments::numeric / v_curr_confirmed_enrollments::numeric) * 100.0, 1);
  END IF;

  -- 3. Financial Collections & Refunds (USD only, canonical Block 3 reconciliation)
  -- Current Period
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END), 0.00)
  INTO v_curr_gross_collected, v_curr_refunded
  FROM public.enrollment_payments p
  JOIN public.enrollments e ON e.id = p.enrollment_id
  JOIN public.leads l ON l.id = e.lead_id
  WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
    AND p.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  v_curr_net_revenue := v_curr_gross_collected - v_curr_refunded;

  -- Previous Period
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END), 0.00)
  INTO v_prev_gross_collected, v_prev_refunded
  FROM public.enrollment_payments p
  JOIN public.enrollments e ON e.id = p.enrollment_id
  JOIN public.leads l ON l.id = e.lead_id
  WHERE p.payment_date >= v_bounds.prev_start_date AND p.payment_date <= v_bounds.prev_end_date
    AND p.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  v_prev_net_revenue := v_prev_gross_collected - v_prev_refunded;

  -- 4. Current Outstanding Balance (Snapshot of all active confirmed enrollments)
  SELECT COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(paid_sum.net_paid, 0.00), 0.00)), 0.00)
  INTO v_current_outstanding
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  LEFT JOIN (
    SELECT 
      enrollment_id,
      SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
               WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
               ELSE 0.00 END) AS net_paid
    FROM public.enrollment_payments
    GROUP BY enrollment_id
  ) paid_sum ON paid_sum.enrollment_id = e.id
  WHERE e.enrollment_status = 'confirmed'
    AND e.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  -- 5. Current Hot Leads & Active Leads (Snapshot)
  SELECT 
    COUNT(*) FILTER (WHERE l.lead_score >= v_hot_min),
    COUNT(*) FILTER (WHERE s.code NOT IN ('post_course', 'alumni'))
  INTO v_current_hot_leads, v_current_active_leads
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE (p_include_test = true OR l.source != 'test');

  -- 6. Cohort Conversion to Enrollment
  SELECT COUNT(DISTINCT l.id) INTO v_curr_cohort_leads_enrolled
  FROM public.leads l
  JOIN public.enrollments e ON e.lead_id = l.id
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND e.enrollment_status = 'confirmed'
    AND (p_include_test = true OR (l.source != 'test' AND e.source != 'test'));

  IF v_curr_leads_created > 0 THEN
    v_curr_conv_rate := ROUND((v_curr_cohort_leads_enrolled::numeric / v_curr_leads_created::numeric) * 100.0, 2);
  END IF;

  SELECT COUNT(DISTINCT l.id) INTO v_prev_cohort_leads_enrolled
  FROM public.leads l
  JOIN public.enrollments e ON e.lead_id = l.id
  WHERE l.created_at >= v_bounds.prev_start_ts AND l.created_at < v_bounds.prev_end_ts
    AND e.enrollment_status = 'confirmed'
    AND (p_include_test = true OR (l.source != 'test' AND e.source != 'test'));

  IF v_prev_leads_created > 0 THEN
    v_prev_conv_rate := ROUND((v_prev_cohort_leads_enrolled::numeric / v_prev_leads_created::numeric) * 100.0, 2);
  END IF;

  -- 7. Reply Rates (Reconciling Sales Dashboard logic)
  SELECT count(DISTINCT om.lead_id) INTO v_curr_outbound_leads
  FROM public.outbound_messages om
  JOIN public.leads l ON l.id = om.lead_id
  WHERE om.status = 'sent' AND om.channel IN ('email', 'sms')
    AND om.sent_at >= v_bounds.curr_start_ts AND om.sent_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  SELECT count(DISTINCT im.lead_id) INTO v_curr_replied_leads
  FROM public.inbound_messages im
  JOIN public.leads l ON l.id = im.lead_id
  WHERE im.processing_status = 'processed'
    AND im.received_at >= v_bounds.curr_start_ts AND im.received_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND EXISTS (
      SELECT 1 FROM public.outbound_messages om
      WHERE om.lead_id = im.lead_id AND om.status = 'sent' AND om.sent_at < im.received_at
    );

  IF v_curr_outbound_leads > 0 THEN
    v_curr_reply_rate := ROUND((v_curr_replied_leads::numeric / v_curr_outbound_leads::numeric) * 100.0, 1);
  END IF;

  SELECT count(DISTINCT om.lead_id) INTO v_prev_outbound_leads
  FROM public.outbound_messages om
  JOIN public.leads l ON l.id = om.lead_id
  WHERE om.status = 'sent' AND om.channel IN ('email', 'sms')
    AND om.sent_at >= v_bounds.prev_start_ts AND om.sent_at < v_bounds.prev_end_ts
    AND (p_include_test = true OR l.source != 'test');

  SELECT count(DISTINCT im.lead_id) INTO v_prev_replied_leads
  FROM public.inbound_messages im
  JOIN public.leads l ON l.id = im.lead_id
  WHERE im.processing_status = 'processed'
    AND im.received_at >= v_bounds.prev_start_ts AND im.received_at < v_bounds.prev_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND EXISTS (
      SELECT 1 FROM public.outbound_messages om
      WHERE om.lead_id = im.lead_id AND om.status = 'sent' AND om.sent_at < im.received_at
    );

  IF v_prev_outbound_leads > 0 THEN
    v_prev_reply_rate := ROUND((v_prev_replied_leads::numeric / v_prev_outbound_leads::numeric) * 100.0, 1);
  END IF;

  -- 8. Top Courses (Sorted by Net Revenue in period)
  SELECT jsonb_agg(c_row) INTO v_top_courses
  FROM (
    SELECT 
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      COUNT(DISTINCT e.id) AS confirmed_enrollments,
      COUNT(DISTINCT e.lead_id) AS unique_students,
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_revenue,
      COALESCE(SUM(COALESCE(p_stats.net_amount, 0.00)), 0.00) AS net_revenue
    FROM public.courses c
    LEFT JOIN public.enrollments e ON e.course_id = c.id 
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
      AND (p_include_test = true OR e.source != 'test')
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                      ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id AND payment_date >= p_start_date AND payment_date <= p_end_date
    ) p_stats ON true
    WHERE c.active = true
    GROUP BY c.id, c.code, c.name, c.sort_order
    ORDER BY net_revenue DESC, confirmed_enrollments DESC
    LIMIT 5
  ) c_row;

  -- 9. Top Sources (Sorted by Net Revenue in period)
  SELECT jsonb_agg(s_row) INTO v_top_sources
  FROM (
    SELECT 
      src.source_name AS source,
      (
        SELECT COUNT(*) FROM public.leads l 
        WHERE l.source = src.source_name 
          AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
      ) AS leads_created,
      COUNT(DISTINCT e.id) AS confirmed_enrollments,
      COALESCE(SUM(COALESCE(p_sub.net_amount, 0.00)), 0.00) AS net_revenue,
      CASE 
        WHEN (SELECT COUNT(*) FROM public.leads l WHERE l.source = src.source_name AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts) > 0 
        THEN ROUND(
          (
            COUNT(DISTINCT l_coh.id)::numeric / 
            (SELECT COUNT(*) FROM public.leads l WHERE l.source = src.source_name AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts)::numeric
          ) * 100.0, 2
        )
        ELSE NULL
      END AS cohort_conversion_rate
    FROM (
      VALUES ('meta'), ('google'), ('manual'), ('form'), ('test')
    ) AS src(source_name)
    LEFT JOIN public.enrollments e ON e.source = src.source_name
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                      ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id AND payment_date >= p_start_date AND payment_date <= p_end_date
    ) p_sub ON true
    LEFT JOIN public.leads l_coh ON l_coh.source = src.source_name
      AND l_coh.created_at >= v_bounds.curr_start_ts AND l_coh.created_at < v_bounds.curr_end_ts
      AND EXISTS (SELECT 1 FROM public.enrollments e2 WHERE e2.lead_id = l_coh.id AND e2.enrollment_status = 'confirmed')
    WHERE (p_include_test = true OR src.source_name != 'test')
    GROUP BY src.source_name
    ORDER BY net_revenue DESC, leads_created DESC
  ) s_row;

  -- 10. Daily / Granular Trend
  v_bucket_interval := public.get_report_bucket_interval(p_start_date, p_end_date, 'daily');

  WITH date_series AS (
    SELECT generate_series(
      date_trunc('day', v_bounds.curr_start_ts),
      date_trunc('day', v_bounds.curr_end_ts - interval '1 second'),
      '1 day'::interval
    ) AS bucket_ts
  ),
  daily_leads AS (
    SELECT date_trunc('day', l.created_at AT TIME ZONE v_bounds.org_tz) AS d_ts, COUNT(*) AS cnt
    FROM public.leads l
    WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
      AND (p_include_test = true OR l.source != 'test')
    GROUP BY d_ts
  ),
  daily_revenue AS (
    SELECT 
      (p.payment_date::text || ' 00:00:00')::timestamp AS d_ts,
      SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END) AS gross,
      SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount 
               WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN -p.amount 
               ELSE 0.00 END) AS net
    FROM public.enrollment_payments p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
      AND p.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    GROUP BY d_ts
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', to_char(ds.bucket_ts, 'YYYY-MM-DD'),
      'leads_created', COALESCE(dl.cnt, 0),
      'gross_collected', COALESCE(dr.gross, 0.00),
      'net_revenue', COALESCE(dr.net, 0.00)
    ) ORDER BY ds.bucket_ts ASC
  )
  INTO v_trend
  FROM date_series ds
  LEFT JOIN daily_leads dl ON dl.d_ts = ds.bucket_ts
  LEFT JOIN daily_revenue dr ON dr.d_ts = ds.bucket_ts;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'comparison_start', v_bounds.prev_start_date,
      'comparison_end', v_bounds.prev_end_date,
      'duration_days', v_bounds.duration_days,
      'include_test', p_include_test,
      'currency', 'USD',
      'generated_at', now()
    ),
    'kpis', jsonb_build_object(
      'leads_created', jsonb_set(
        public.calculate_percent_change(v_curr_leads_created, v_prev_leads_created),
        '{type}', '"period"'
      ),
      'confirmed_enrollments', jsonb_set(
        public.calculate_percent_change(v_curr_confirmed_enrollments, v_prev_confirmed_enrollments),
        '{type}', '"period"'
      ),
      'gross_collected', jsonb_set(
        public.calculate_percent_change(v_curr_gross_collected, v_prev_gross_collected),
        '{type}', '"period"'
      ),
      'net_revenue', jsonb_set(
        public.calculate_percent_change(v_curr_net_revenue, v_prev_net_revenue),
        '{type}', '"period"'
      ),
      'booked_revenue', jsonb_set(
        public.calculate_percent_change(v_curr_booked_value, v_prev_booked_value),
        '{type}', '"period"'
      ),
      'refunded_amount', jsonb_set(
        public.calculate_percent_change(v_curr_refunded, v_prev_refunded),
        '{type}', '"period"'
      ),
      'current_outstanding_balance', jsonb_build_object(
        'current', v_current_outstanding,
        'type', 'snapshot',
        'comparison_status', 'not_applicable'
      ),
      'current_hot_leads', jsonb_build_object(
        'current', v_current_hot_leads,
        'type', 'snapshot',
        'comparison_status', 'not_applicable'
      ),
      'current_active_leads', jsonb_build_object(
        'current', v_current_active_leads,
        'type', 'snapshot',
        'comparison_status', 'not_applicable'
      ),
      'cohort_conversion_rate', jsonb_build_object(
        'current', v_curr_conv_rate,
        'previous', v_prev_conv_rate,
        'type', 'cohort'
      ),
      'repeat_student_rate', jsonb_build_object(
        'current', v_curr_repeat_rate,
        'new_enrollments', v_curr_new_enrollments,
        'repeat_enrollments', v_curr_repeat_enrollments,
        'type', 'period'
      ),
      'reply_rate', jsonb_build_object(
        'current', v_curr_reply_rate,
        'previous', v_prev_reply_rate,
        'outbound_leads', v_curr_outbound_leads,
        'replied_leads', v_curr_replied_leads,
        'type', 'period'
      )
    ),
    'top_courses', COALESCE(v_top_courses, '[]'::jsonb),
    'top_sources', COALESCE(v_top_sources, '[]'::jsonb),
    'revenue_trend', COALESCE(v_trend, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. RPC 2: get_reports_funnel
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_funnel(
  p_start_date DATE,
  p_end_date DATE,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  v_cohort_total INT := 0;
  
  v_stage_capture_id UUID;
  v_stage_qual_id UUID;
  v_stage_acq_id UUID;
  v_stage_appr_id UUID;
  v_stage_enroll_id UUID;
  
  v_reached_capture INT := 0;
  v_reached_qual INT := 0;
  v_reached_acq INT := 0;
  v_reached_appr INT := 0;
  v_reached_enroll INT := 0;

  v_current_pipeline JSONB := '[]'::jsonb;
  v_qualification_snapshot JSONB := '[]'::jsonb;
  v_scoring_snapshot JSONB;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  -- Stage IDs
  SELECT id INTO v_stage_capture_id FROM public.pipeline_stages WHERE code = 'capture';
  SELECT id INTO v_stage_qual_id FROM public.pipeline_stages WHERE code = 'qualification';
  SELECT id INTO v_stage_acq_id FROM public.pipeline_stages WHERE code = 'acquisition';
  SELECT id INTO v_stage_appr_id FROM public.pipeline_stages WHERE code = 'approval';
  SELECT id INTO v_stage_enroll_id FROM public.pipeline_stages WHERE code = 'enrollment';

  -- 1. Cohort Base: leads created in period
  SELECT count(*) INTO v_cohort_total
  FROM public.leads l
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  -- 2. Funnel Stages Reached
  v_reached_capture := v_cohort_total;

  SELECT count(DISTINCT l.id) INTO v_reached_qual
  FROM public.leads l
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND (
      EXISTS (
        SELECT 1 FROM public.lead_stage_history h 
        WHERE h.lead_id = l.id AND h.to_stage_id = v_stage_qual_id
      )
      OR l.pipeline_stage_id = v_stage_qual_id
      OR EXISTS (
        SELECT 1 FROM public.pipeline_stages cur_stg 
        WHERE cur_stg.id = l.pipeline_stage_id AND cur_stg.sort_order >= 2
      )
    );

  SELECT count(DISTINCT l.id) INTO v_reached_acq
  FROM public.leads l
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND (
      EXISTS (
        SELECT 1 FROM public.lead_stage_history h 
        WHERE h.lead_id = l.id AND h.to_stage_id = v_stage_acq_id
      )
      OR l.pipeline_stage_id = v_stage_acq_id
      OR EXISTS (
        SELECT 1 FROM public.pipeline_stages cur_stg 
        WHERE cur_stg.id = l.pipeline_stage_id AND cur_stg.sort_order >= 3
      )
    );

  SELECT count(DISTINCT l.id) INTO v_reached_appr
  FROM public.leads l
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND (
      EXISTS (
        SELECT 1 FROM public.lead_stage_history h 
        WHERE h.lead_id = l.id AND h.to_stage_id = v_stage_appr_id
      )
      OR l.pipeline_stage_id = v_stage_appr_id
      OR EXISTS (
        SELECT 1 FROM public.pipeline_stages cur_stg 
        WHERE cur_stg.id = l.pipeline_stage_id AND cur_stg.sort_order >= 4
      )
    );

  SELECT count(DISTINCT l.id) INTO v_reached_enroll
  FROM public.leads l
  WHERE l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND (
      EXISTS (
        SELECT 1 FROM public.lead_stage_history h 
        WHERE h.lead_id = l.id AND h.to_stage_id = v_stage_enroll_id
      )
      OR l.pipeline_stage_id = v_stage_enroll_id
      OR EXISTS (
        SELECT 1 FROM public.enrollments e 
        WHERE e.lead_id = l.id AND e.enrollment_status = 'confirmed'
      )
      OR EXISTS (
        SELECT 1 FROM public.pipeline_stages cur_stg 
        WHERE cur_stg.id = l.pipeline_stage_id AND cur_stg.sort_order >= 5
      )
    );

  -- 3. Current Pipeline Snapshot
  WITH current_counts AS (
    SELECT 
      ps.id, ps.code, ps.name, ps.sort_order,
      COUNT(l.id) AS lead_count
    FROM public.pipeline_stages ps
    LEFT JOIN public.leads l ON l.pipeline_stage_id = ps.id 
      AND (p_include_test = true OR l.source != 'test')
    GROUP BY ps.id, ps.code, ps.name, ps.sort_order
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'stage_id', cc.id,
      'stage_code', cc.code,
      'stage_name', cc.name,
      'sort_order', cc.sort_order,
      'lead_count', cc.lead_count,
      'type', 'snapshot'
    ) ORDER BY cc.sort_order ASC
  )
  INTO v_current_pipeline
  FROM current_counts cc;

  -- 4. Qualification Status Snapshot
  SELECT jsonb_agg(q_row) INTO v_qualification_snapshot
  FROM (
    SELECT 
      COALESCE(qualification_status, 'unassigned') AS status,
      COUNT(*) AS lead_count
    FROM public.leads
    WHERE (p_include_test = true OR source != 'test')
    GROUP BY COALESCE(qualification_status, 'unassigned')
    ORDER BY lead_count DESC
  ) q_row;

  -- 5. Lead Scoring Snapshot
  v_scoring_snapshot := public.get_dashboard_scoring();

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'include_test', p_include_test,
      'generated_at', now()
    ),
    'cohort_funnel', jsonb_build_object(
      'cohort_total_leads', v_cohort_total,
      'stages', jsonb_build_array(
        jsonb_build_object(
          'stage_code', 'capture',
          'stage_name', 'Capture',
          'sort_order', 1,
          'reached_count', v_reached_capture,
          'conversion_from_prev', NULL,
          'conversion_from_cohort', CASE WHEN v_cohort_total > 0 THEN 100.0 ELSE NULL END
        ),
        jsonb_build_object(
          'stage_code', 'qualification',
          'stage_name', 'Qualification',
          'sort_order', 2,
          'reached_count', v_reached_qual,
          'conversion_from_prev', CASE WHEN v_reached_capture > 0 THEN ROUND((v_reached_qual::numeric / v_reached_capture::numeric) * 100.0, 1) ELSE NULL END,
          'conversion_from_cohort', CASE WHEN v_cohort_total > 0 THEN ROUND((v_reached_qual::numeric / v_cohort_total::numeric) * 100.0, 1) ELSE NULL END
        ),
        jsonb_build_object(
          'stage_code', 'acquisition',
          'stage_name', 'Acquisition',
          'sort_order', 3,
          'reached_count', v_reached_acq,
          'conversion_from_prev', CASE WHEN v_reached_qual > 0 THEN ROUND((v_reached_acq::numeric / v_reached_qual::numeric) * 100.0, 1) ELSE NULL END,
          'conversion_from_cohort', CASE WHEN v_cohort_total > 0 THEN ROUND((v_reached_acq::numeric / v_cohort_total::numeric) * 100.0, 1) ELSE NULL END
        ),
        jsonb_build_object(
          'stage_code', 'approval',
          'stage_name', 'Approval',
          'sort_order', 4,
          'reached_count', v_reached_appr,
          'conversion_from_prev', CASE WHEN v_reached_acq > 0 THEN ROUND((v_reached_appr::numeric / v_reached_acq::numeric) * 100.0, 1) ELSE NULL END,
          'conversion_from_cohort', CASE WHEN v_cohort_total > 0 THEN ROUND((v_reached_appr::numeric / v_cohort_total::numeric) * 100.0, 1) ELSE NULL END
        ),
        jsonb_build_object(
          'stage_code', 'enrollment',
          'stage_name', 'Enrollment',
          'sort_order', 5,
          'reached_count', v_reached_enroll,
          'conversion_from_prev', CASE WHEN v_reached_appr > 0 THEN ROUND((v_reached_enroll::numeric / v_reached_appr::numeric) * 100.0, 1) ELSE NULL END,
          'conversion_from_cohort', CASE WHEN v_cohort_total > 0 THEN ROUND((v_reached_enroll::numeric / v_cohort_total::numeric) * 100.0, 1) ELSE NULL END
        )
      )
    ),
    'current_pipeline_snapshot', COALESCE(v_current_pipeline, '[]'::jsonb),
    'qualification_snapshot', COALESCE(v_qualification_snapshot, '[]'::jsonb),
    'scoring_snapshot', v_scoring_snapshot
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. RPC 3: get_reports_revenue
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_revenue(
  p_start_date DATE,
  p_end_date DATE,
  p_granularity TEXT DEFAULT NULL,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  v_bucket_int TEXT;
  
  v_gross_collected NUMERIC(12,2) := 0.00;
  v_refunded_amount NUMERIC(12,2) := 0.00;
  v_net_revenue NUMERIC(12,2) := 0.00;
  v_booked_revenue NUMERIC(12,2) := 0.00;
  v_current_outstanding NUMERIC(12,2) := 0.00;
  
  v_confirmed_count INT := 0;
  v_avg_ticket NUMERIC(12,2) := NULL;
  v_refund_count INT := 0;
  v_refund_rate NUMERIC(5,2) := NULL;

  -- Previous period
  v_prev_gross NUMERIC(12,2) := 0.00;
  v_prev_refunded NUMERIC(12,2) := 0.00;
  v_prev_net NUMERIC(12,2) := 0.00;
  v_prev_booked NUMERIC(12,2) := 0.00;

  v_series JSONB := '[]'::jsonb;
  v_payment_methods JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);
  v_bucket_int := public.get_report_bucket_interval(p_start_date, p_end_date, p_granularity);

  -- 1. Cash Collected & Refunds (Current Period, USD)
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END), 0.00),
    COUNT(*) FILTER (WHERE p.payment_type = 'refund' OR p.payment_status = 'refunded')
  INTO v_gross_collected, v_refunded_amount, v_refund_count
  FROM public.enrollment_payments p
  JOIN public.enrollments e ON e.id = p.enrollment_id
  JOIN public.leads l ON l.id = e.lead_id
  WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
    AND p.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  v_net_revenue := v_gross_collected - v_refunded_amount;

  IF v_gross_collected > 0 THEN
    v_refund_rate := ROUND((v_refunded_amount / v_gross_collected) * 100.0, 1);
  END IF;

  -- 2. Booked Value & Confirmed Enrollments in period
  SELECT 
    COALESCE(SUM(e.agreed_amount), 0.00),
    COUNT(*)
  INTO v_booked_revenue, v_confirmed_count
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
    AND e.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  IF v_confirmed_count > 0 THEN
    v_avg_ticket := ROUND(v_booked_revenue / v_confirmed_count, 2);
  END IF;

  -- 3. Previous Period Cash Metrics
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END), 0.00)
  INTO v_prev_gross, v_prev_refunded
  FROM public.enrollment_payments p
  JOIN public.enrollments e ON e.id = p.enrollment_id
  JOIN public.leads l ON l.id = e.lead_id
  WHERE p.payment_date >= v_bounds.prev_start_date AND p.payment_date <= v_bounds.prev_end_date
    AND p.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  v_prev_net := v_prev_gross - v_prev_refunded;

  SELECT COALESCE(SUM(e.agreed_amount), 0.00)
  INTO v_prev_booked
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= v_bounds.prev_start_date AND e.enrollment_date <= v_bounds.prev_end_date
    AND e.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  -- 4. Current Outstanding Balance (Snapshot across all confirmed enrollments)
  SELECT COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(paid_sum.net_paid, 0.00), 0.00)), 0.00)
  INTO v_current_outstanding
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  LEFT JOIN (
    SELECT 
      enrollment_id,
      SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
               WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
               ELSE 0.00 END) AS net_paid
    FROM public.enrollment_payments
    GROUP BY enrollment_id
  ) paid_sum ON paid_sum.enrollment_id = e.id
  WHERE e.enrollment_status = 'confirmed'
    AND e.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  -- 5. Time Series (Continuous buckets with zero-filling)
  WITH bucket_series AS (
    SELECT generate_series(
      date_trunc(
        CASE WHEN v_bucket_int = '1 day' THEN 'day' WHEN v_bucket_int = '1 week' THEN 'week' ELSE 'month' END,
        v_bounds.curr_start_ts
      ),
      date_trunc(
        CASE WHEN v_bucket_int = '1 day' THEN 'day' WHEN v_bucket_int = '1 week' THEN 'week' ELSE 'month' END,
        v_bounds.curr_end_ts - interval '1 second'
      ),
      v_bucket_int::interval
    ) AS b_start
  ),
  bucket_payments AS (
    SELECT 
      date_trunc(
        CASE WHEN v_bucket_int = '1 day' THEN 'day' WHEN v_bucket_int = '1 week' THEN 'week' ELSE 'month' END,
        (p.payment_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_bounds.org_tz
      ) AS b_date,
      SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END) AS gross,
      SUM(CASE WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END) AS ref
    FROM public.enrollment_payments p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
      AND p.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    GROUP BY b_date
  ),
  bucket_booked AS (
    SELECT 
      date_trunc(
        CASE WHEN v_bucket_int = '1 day' THEN 'day' WHEN v_bucket_int = '1 week' THEN 'week' ELSE 'month' END,
        (e.enrollment_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_bounds.org_tz
      ) AS b_date,
      SUM(e.agreed_amount) AS booked
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
      AND e.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    GROUP BY b_date
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'period_start', to_char(bs.b_start, 'YYYY-MM-DD'),
      'gross_collected', COALESCE(bp.gross, 0.00),
      'refunded_amount', COALESCE(bp.ref, 0.00),
      'net_revenue', COALESCE(bp.gross, 0.00) - COALESCE(bp.ref, 0.00),
      'booked_revenue', COALESCE(bb.booked, 0.00)
    ) ORDER BY bs.b_start ASC
  )
  INTO v_series
  FROM bucket_series bs
  LEFT JOIN bucket_payments bp ON bp.b_date = bs.b_start
  LEFT JOIN bucket_booked bb ON bb.b_date = bs.b_start;

  -- 6. Payment Methods Breakdown
  SELECT jsonb_agg(pm_row) INTO v_payment_methods
  FROM (
    SELECT 
      COALESCE(p.payment_method, 'other') AS method,
      COUNT(*) AS payment_count,
      SUM(p.amount) AS total_amount
    FROM public.enrollment_payments p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
      AND p.payment_status = 'paid' AND p.payment_type = 'payment'
      AND p.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    GROUP BY COALESCE(p.payment_method, 'other')
    ORDER BY total_amount DESC
  ) pm_row;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'comparison_start', v_bounds.prev_start_date,
      'comparison_end', v_bounds.prev_end_date,
      'granularity', v_bucket_int,
      'currency', 'USD',
      'include_test', p_include_test,
      'generated_at', now()
    ),
    'summary', jsonb_build_object(
      'gross_collected', jsonb_set(
        public.calculate_percent_change(v_gross_collected, v_prev_gross),
        '{type}', '"period"'
      ),
      'refunded_amount', jsonb_set(
        public.calculate_percent_change(v_refunded_amount, v_prev_refunded),
        '{type}', '"period"'
      ),
      'net_revenue', jsonb_set(
        public.calculate_percent_change(v_net_revenue, v_prev_net),
        '{type}', '"period"'
      ),
      'booked_revenue', jsonb_set(
        public.calculate_percent_change(v_booked_revenue, v_prev_booked),
        '{type}', '"period"'
      ),
      'current_outstanding_balance', jsonb_build_object(
        'current', v_current_outstanding,
        'type', 'snapshot',
        'comparison_status', 'not_applicable'
      ),
      'average_ticket', jsonb_build_object(
        'current', v_avg_ticket,
        'type', 'period'
      ),
      'refund_rate', jsonb_build_object(
        'current', v_refund_rate,
        'refund_count', v_refund_count,
        'type', 'period'
      )
    ),
    'time_series', COALESCE(v_series, '[]'::jsonb),
    'payment_methods', COALESCE(v_payment_methods, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. RPC 4: get_reports_sources
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_sources(
  p_start_date DATE,
  p_end_date DATE,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  v_sources_data JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  SELECT jsonb_agg(s_item) INTO v_sources_data
  FROM (
    SELECT 
      src.source_name AS source,
      (
        SELECT COUNT(*) 
        FROM public.leads l 
        WHERE l.source = src.source_name 
          AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
      ) AS leads_created,
      (
        SELECT COUNT(DISTINCT l.id)
        FROM public.leads l
        WHERE l.source = src.source_name
          AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
          AND (
            EXISTS (
              SELECT 1 FROM public.lead_stage_history h 
              JOIN public.pipeline_stages ps ON ps.id = h.to_stage_id
              WHERE h.lead_id = l.id AND ps.code = 'qualification'
            )
            OR l.pipeline_stage_id IN (SELECT id FROM public.pipeline_stages WHERE sort_order >= 2)
          )
      ) AS qualified_leads,
      (
        SELECT COUNT(DISTINCT l.id)
        FROM public.leads l
        WHERE l.source = src.source_name
          AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
          AND EXISTS (
            SELECT 1 FROM public.enrollments e 
            WHERE e.lead_id = l.id AND e.enrollment_status = 'confirmed'
          )
      ) AS cohort_leads_enrolled,
      CASE 
        WHEN (
          SELECT COUNT(*) FROM public.leads l 
          WHERE l.source = src.source_name 
            AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
        ) > 0 
        THEN ROUND(
          (
            (
              SELECT COUNT(DISTINCT l.id)
              FROM public.leads l
              WHERE l.source = src.source_name
                AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
                AND EXISTS (SELECT 1 FROM public.enrollments e WHERE e.lead_id = l.id AND e.enrollment_status = 'confirmed')
            )::numeric 
            / 
            (
              SELECT COUNT(*) FROM public.leads l 
              WHERE l.source = src.source_name 
                AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
            )::numeric
          ) * 100.0, 2
        )
        ELSE NULL
      END AS cohort_conversion_rate,
      COUNT(DISTINCT e.id) AS enrollments_confirmed_in_period,
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_revenue,
      COALESCE(SUM(COALESCE(p_stats.gross_amount, 0.00)), 0.00) AS gross_collected,
      COALESCE(SUM(COALESCE(p_stats.ref_amount, 0.00)), 0.00) AS refunded_amount,
      COALESCE(SUM(COALESCE(p_stats.net_amount, 0.00)), 0.00) AS net_revenue,
      COALESCE(
        (
          SELECT SUM(GREATEST(e_snap.agreed_amount - COALESCE(paid_snap.net_paid, 0.00), 0.00))
          FROM public.enrollments e_snap
          JOIN public.leads l_snap ON l_snap.id = e_snap.lead_id
          LEFT JOIN (
            SELECT enrollment_id,
                   SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                            WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                            ELSE 0.00 END) AS net_paid
            FROM public.enrollment_payments
            GROUP BY enrollment_id
          ) paid_snap ON paid_snap.enrollment_id = e_snap.id
          WHERE e_snap.enrollment_status = 'confirmed'
            AND l_snap.source = src.source_name
            AND e_snap.currency = 'USD'
        ),
        0.00
      ) AS current_outstanding_balance
    FROM (
      VALUES ('meta'), ('google'), ('manual'), ('form'), ('test')
    ) AS src(source_name)
    LEFT JOIN public.enrollments e ON e.source = src.source_name
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
      AND e.currency = 'USD'
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount ELSE 0.00 END) AS gross_amount,
        SUM(CASE WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN amount ELSE 0.00 END) AS ref_amount,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                 ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id AND payment_date >= p_start_date AND payment_date <= p_end_date
    ) p_stats ON true
    WHERE (p_include_test = true OR src.source_name != 'test')
    GROUP BY src.source_name
    ORDER BY net_revenue DESC, leads_created DESC
  ) s_item;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'include_test', p_include_test,
      'currency', 'USD',
      'generated_at', now()
    ),
    'sources', COALESCE(v_sources_data, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. RPC 5: get_reports_courses
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_courses(
  p_start_date DATE,
  p_end_date DATE,
  p_course_id UUID DEFAULT NULL,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  v_courses_data JSONB := '[]'::jsonb;
  v_sessions_data JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  -- 1. Course-level performance
  SELECT jsonb_agg(c_item) INTO v_courses_data
  FROM (
    SELECT 
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      c.default_price,
      c.currency,
      COUNT(DISTINCT e.id) AS confirmed_enrollments,
      COUNT(DISTINCT e.lead_id) AS unique_students,
      COUNT(DISTINCT e.id) FILTER (
        WHERE (
          SELECT COUNT(*) 
          FROM public.enrollments e_prev 
          WHERE e_prev.lead_id = e.lead_id 
            AND e_prev.enrollment_status = 'confirmed' 
            AND (e_prev.enrollment_date < e.enrollment_date OR (e_prev.enrollment_date = e.enrollment_date AND e_prev.id < e.id))
        ) = 0
      ) AS new_students,
      COUNT(DISTINCT e.id) FILTER (
        WHERE (
          SELECT COUNT(*) 
          FROM public.enrollments e_prev 
          WHERE e_prev.lead_id = e.lead_id 
            AND e_prev.enrollment_status = 'confirmed' 
            AND (e_prev.enrollment_date < e.enrollment_date OR (e_prev.enrollment_date = e.enrollment_date AND e_prev.id < e.id))
        ) > 0
      ) AS repeat_students,
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_revenue,
      COALESCE(SUM(COALESCE(p_stats.gross_amount, 0.00)), 0.00) AS gross_collected,
      COALESCE(SUM(COALESCE(p_stats.ref_amount, 0.00)), 0.00) AS refunded_amount,
      COALESCE(SUM(COALESCE(p_stats.net_amount, 0.00)), 0.00) AS net_revenue,
      COALESCE(
        (
          SELECT SUM(GREATEST(e_snap.agreed_amount - COALESCE(paid_snap.net_paid, 0.00), 0.00))
          FROM public.enrollments e_snap
          JOIN public.leads l_snap ON l_snap.id = e_snap.lead_id
          LEFT JOIN (
            SELECT enrollment_id,
                   SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                            WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                            ELSE 0.00 END) AS net_paid
            FROM public.enrollment_payments
            GROUP BY enrollment_id
          ) paid_snap ON paid_snap.enrollment_id = e_snap.id
          WHERE e_snap.enrollment_status = 'confirmed'
            AND e_snap.course_id = c.id
            AND e_snap.currency = 'USD'
            AND (p_include_test = true OR (e_snap.source != 'test' AND l_snap.source != 'test'))
        ),
        0.00
      ) AS current_outstanding_balance,
      CASE 
        WHEN (
          SELECT COUNT(*) 
          FROM public.course_participations cp 
          JOIN public.enrollments ep ON ep.id = cp.enrollment_id
          WHERE ep.course_id = c.id 
            AND cp.attendance_status IN ('attended', 'no_show')
        ) > 0 
        THEN ROUND(
          (
            (SELECT COUNT(*) FROM public.course_participations cp JOIN public.enrollments ep ON ep.id = cp.enrollment_id WHERE ep.course_id = c.id AND cp.attendance_status = 'attended')::numeric 
            / 
            (SELECT COUNT(*) FROM public.course_participations cp JOIN public.enrollments ep ON ep.id = cp.enrollment_id WHERE ep.course_id = c.id AND cp.attendance_status IN ('attended', 'no_show'))::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS attendance_rate,
      CASE 
        WHEN (
          SELECT COUNT(*) 
          FROM public.course_participations cp 
          JOIN public.enrollments ep ON ep.id = cp.enrollment_id
          WHERE ep.course_id = c.id 
            AND cp.completion_status IN ('completed', 'incomplete')
        ) > 0 
        THEN ROUND(
          (
            (SELECT COUNT(*) FROM public.course_participations cp JOIN public.enrollments ep ON ep.id = cp.enrollment_id WHERE ep.course_id = c.id AND cp.completion_status = 'completed')::numeric 
            / 
            (SELECT COUNT(*) FROM public.course_participations cp JOIN public.enrollments ep ON ep.id = cp.enrollment_id WHERE ep.course_id = c.id AND cp.completion_status IN ('completed', 'incomplete'))::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS completion_rate
    FROM public.courses c
    LEFT JOIN public.enrollments e ON e.course_id = c.id
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
      AND (p_include_test = true OR e.source != 'test')
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount ELSE 0.00 END) AS gross_amount,
        SUM(CASE WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN amount ELSE 0.00 END) AS ref_amount,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                 ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id AND payment_date >= p_start_date AND payment_date <= p_end_date
    ) p_stats ON true
    WHERE c.active = true
      AND (p_course_id IS NULL OR c.id = p_course_id)
    GROUP BY c.id, c.code, c.name, c.default_price, c.currency, c.sort_order
    ORDER BY net_revenue DESC, confirmed_enrollments DESC
  ) c_item;

  -- 2. Sessions performance
  SELECT jsonb_agg(sess_item) INTO v_sessions_data
  FROM (
    SELECT 
      s.id AS session_id,
      s.code AS session_code,
      s.title AS session_title,
      s.course_id,
      c.name AS course_name,
      s.status,
      s.start_date,
      s.end_date,
      s.capacity,
      COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed') AS assigned_enrollments,
      CASE 
        WHEN COUNT(DISTINCT cp.id) FILTER (WHERE cp.attendance_status IN ('attended', 'no_show')) > 0 
        THEN ROUND(
          (
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.attendance_status = 'attended')::numeric / 
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.attendance_status IN ('attended', 'no_show'))::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS attendance_rate,
      CASE 
        WHEN COUNT(DISTINCT cp.id) FILTER (WHERE cp.completion_status IN ('completed', 'incomplete')) > 0 
        THEN ROUND(
          (
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.completion_status = 'completed')::numeric / 
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.completion_status IN ('completed', 'incomplete'))::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS completion_rate,
      COALESCE(SUM(COALESCE(p_sess.net_amount, 0.00)), 0.00) AS net_revenue
    FROM public.course_sessions s
    JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.enrollments e ON e.course_session_id = s.id 
      AND (p_include_test = true OR e.source != 'test')
    LEFT JOIN public.course_participations cp ON cp.enrollment_id = e.id
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                      ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id
    ) p_sess ON true
    WHERE (p_course_id IS NULL OR s.course_id = p_course_id)
      AND (
        (s.start_date >= p_start_date AND s.start_date <= p_end_date)
        OR (s.end_date >= p_start_date AND s.end_date <= p_end_date)
        OR (s.status IN ('open', 'confirmed') AND s.start_date >= CURRENT_DATE)
      )
    GROUP BY s.id, s.code, s.title, s.course_id, c.name, s.status, s.start_date, s.end_date, s.capacity
    ORDER BY s.start_date ASC
  ) sess_item;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'course_filter_id', p_course_id,
      'include_test', p_include_test,
      'currency', 'USD',
      'generated_at', now()
    ),
    'courses', COALESCE(v_courses_data, '[]'::jsonb),
    'sessions', COALESCE(v_sessions_data, '[]'::jsonb)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. RPC 6: get_reports_engagement
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_engagement(
  p_start_date DATE,
  p_end_date DATE,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  
  -- Conversations
  v_outbound_sent INT := 0;
  v_outbound_leads INT := 0;
  v_inbound_replies INT := 0;
  v_replied_leads INT := 0;
  v_reply_rate NUMERIC(5,2) := NULL;
  v_avg_frt_seconds NUMERIC(10,1) := NULL;
  v_median_frt_seconds NUMERIC(10,1) := NULL;
  v_open_conversations_needing_reply INT := 0;

  -- Automations
  v_runs_total INT := 0;
  v_runs_completed INT := 0;
  v_runs_failed INT := 0;
  v_actions_total INT := 0;
  v_actions_completed INT := 0;
  v_actions_failed INT := 0;
  v_actions_skipped INT := 0;
  v_actions_blocked_pref INT := 0;
  v_retries_total INT := 0;
  v_active_sequences INT := 0;

  -- Forms
  v_forms_data JSONB := '[]'::jsonb;

  -- Tasks
  v_tasks_completed INT := 0;
  v_current_overdue_tasks INT := 0;
  v_current_due_today INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  -- 1. Conversations & Reply Metrics
  SELECT count(*), count(DISTINCT om.lead_id)
  INTO v_outbound_sent, v_outbound_leads
  FROM public.outbound_messages om
  JOIN public.leads l ON l.id = om.lead_id
  WHERE om.status = 'sent' AND om.channel IN ('email', 'sms')
    AND om.sent_at >= v_bounds.curr_start_ts AND om.sent_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  SELECT count(*), count(DISTINCT im.lead_id)
  INTO v_inbound_replies, v_replied_leads
  FROM public.inbound_messages im
  JOIN public.leads l ON l.id = im.lead_id
  WHERE im.processing_status = 'processed'
    AND im.received_at >= v_bounds.curr_start_ts AND im.received_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test')
    AND EXISTS (
      SELECT 1 FROM public.outbound_messages om 
      WHERE om.lead_id = im.lead_id AND om.status = 'sent' AND om.sent_at < im.received_at
    );

  IF v_outbound_leads > 0 THEN
    v_reply_rate := ROUND((v_replied_leads::numeric / v_outbound_leads::numeric) * 100.0, 1);
  END IF;

  WITH lead_first_outbound AS (
    SELECT om.lead_id, MIN(om.sent_at) AS first_outbound_at
    FROM public.outbound_messages om
    JOIN public.leads l ON l.id = om.lead_id
    WHERE om.status = 'sent' AND om.channel IN ('email', 'sms')
      AND (p_include_test = true OR l.source != 'test')
    GROUP BY om.lead_id
  ),
  lead_frt AS (
    SELECT 
      lfo.lead_id,
      EXTRACT(EPOCH FROM (MIN(im.received_at) - lfo.first_outbound_at)) AS response_seconds
    FROM lead_first_outbound lfo
    JOIN public.inbound_messages im ON im.lead_id = lfo.lead_id
      AND im.processing_status = 'processed'
      AND im.received_at > lfo.first_outbound_at
    WHERE im.received_at >= v_bounds.curr_start_ts AND im.received_at < v_bounds.curr_end_ts
    GROUP BY lfo.lead_id, lfo.first_outbound_at
  )
  SELECT 
    ROUND(AVG(response_seconds)::numeric, 1),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_seconds)::numeric, 1)
  INTO v_avg_frt_seconds, v_median_frt_seconds
  FROM lead_frt;

  SELECT count(*) INTO v_open_conversations_needing_reply
  FROM public.conversations c
  JOIN public.leads l ON l.id = c.lead_id
  WHERE c.status = 'open' AND c.last_message_direction = 'inbound'
    AND (p_include_test = true OR l.source != 'test');

  -- 2. Automation Engine Metrics
  SELECT 
    count(*),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status = 'failed')
  INTO v_runs_total, v_runs_completed, v_runs_failed
  FROM public.automation_runs ar
  JOIN public.leads l ON l.id = ar.lead_id
  WHERE ar.started_at >= v_bounds.curr_start_ts AND ar.started_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  SELECT 
    count(*),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'skipped'),
    count(*) FILTER (WHERE status = 'skipped' AND skip_reason_code = 'contact_preference_blocked'),
    COALESCE(SUM(retry_count), 0)
  INTO v_actions_total, v_actions_completed, v_actions_failed, v_actions_skipped, v_actions_blocked_pref, v_retries_total
  FROM public.automation_run_steps ars
  JOIN public.automation_runs ar ON ar.id = ars.automation_run_id
  JOIN public.leads l ON l.id = ar.lead_id
  WHERE ars.created_at >= v_bounds.curr_start_ts AND ars.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  SELECT count(*) INTO v_active_sequences
  FROM public.automations
  WHERE automation_type = 'sequence' AND status = 'active';

  -- 3. Forms Performance
  SELECT jsonb_agg(f_item) INTO v_forms_data
  FROM (
    SELECT 
      f.id AS form_id,
      f.title AS form_title,
      f.slug AS form_slug,
      COUNT(fs.id) AS submissions_count,
      COUNT(DISTINCT fs.lead_id) AS unique_leads_created,
      COUNT(DISTINCT fs.lead_id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.enrollments e 
          WHERE e.lead_id = fs.lead_id AND e.enrollment_status = 'confirmed'
        )
      ) AS cohort_leads_enrolled,
      CASE 
        WHEN COUNT(DISTINCT fs.lead_id) > 0 
        THEN ROUND(
          (
            COUNT(DISTINCT fs.lead_id) FILTER (
              WHERE EXISTS (SELECT 1 FROM public.enrollments e WHERE e.lead_id = fs.lead_id AND e.enrollment_status = 'confirmed')
            )::numeric / 
            COUNT(DISTINCT fs.lead_id)::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS cohort_conversion_rate
    FROM public.forms f
    LEFT JOIN public.form_submissions fs ON fs.form_id = f.id
      AND fs.submitted_at >= v_bounds.curr_start_ts AND fs.submitted_at < v_bounds.curr_end_ts
    GROUP BY f.id, f.title, f.slug
    ORDER BY submissions_count DESC
  ) f_item;

  -- 4. Tasks Metrics
  SELECT count(*) INTO v_tasks_completed
  FROM public.tasks t
  WHERE t.status = 'completed'
    AND t.completed_at >= v_bounds.curr_start_ts AND t.completed_at < v_bounds.curr_end_ts;

  SELECT 
    count(*) FILTER (WHERE status = 'pending' AND due_at < now()),
    count(*) FILTER (WHERE status = 'pending' AND (due_at AT TIME ZONE v_bounds.org_tz)::date = (now() AT TIME ZONE v_bounds.org_tz)::date)
  INTO v_current_overdue_tasks, v_current_due_today
  FROM public.tasks;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'include_test', p_include_test,
      'generated_at', now()
    ),
    'conversations', jsonb_build_object(
      'outbound_sent_count', v_outbound_sent,
      'outbound_unique_leads', v_outbound_leads,
      'inbound_replies_count', v_inbound_replies,
      'replied_unique_leads', v_replied_leads,
      'reply_rate', v_reply_rate,
      'avg_first_response_time_seconds', v_avg_frt_seconds,
      'median_first_response_time_seconds', v_median_frt_seconds,
      'open_conversations_needing_reply', v_open_conversations_needing_reply
    ),
    'automations', jsonb_build_object(
      'runs_total', v_runs_total,
      'runs_completed', v_runs_completed,
      'runs_failed', v_runs_failed,
      'actions_total', v_actions_total,
      'actions_completed', v_actions_completed,
      'actions_failed', v_actions_failed,
      'actions_skipped', v_actions_skipped,
      'actions_blocked_by_preference', v_actions_blocked_pref,
      'retries_total', v_retries_total,
      'active_sequences_count', v_active_sequences
    ),
    'forms', COALESCE(v_forms_data, '[]'::jsonb),
    'tasks', jsonb_build_object(
      'tasks_completed_in_period', v_tasks_completed,
      'current_overdue_tasks', v_current_overdue_tasks,
      'current_tasks_due_today', v_current_due_today
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. RPC 7: get_reports_post_course
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_post_course(
  p_start_date DATE,
  p_end_date DATE,
  p_include_test BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds RECORD;
  
  v_completed_students_period INT := 0;
  v_followups_due INT := 0;
  v_followups_completed INT := 0;
  v_followup_completion_rate NUMERIC(5,2) := NULL;
  
  v_feedback_requested INT := 0;
  v_feedback_received INT := 0;
  v_feedback_rate NUMERIC(5,2) := NULL;
  
  v_testimonials_requested INT := 0;
  v_testimonials_received INT := 0;
  v_testimonial_rate NUMERIC(5,2) := NULL;
  
  v_repeat_students_count INT := 0;
  v_total_confirmed_students INT := 0;
  v_repeat_student_rate NUMERIC(5,2) := NULL;

  v_alumni_current_count INT := 0;
  v_testimonial_opps_count INT := 0;
  v_next_course_opps_count INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  -- 1. Completed Students in period
  SELECT count(DISTINCT e.lead_id) INTO v_completed_students_period
  FROM public.course_participations cp
  JOIN public.enrollments e ON e.id = cp.enrollment_id
  JOIN public.leads l ON l.id = e.lead_id
  WHERE cp.completion_status = 'completed'
    AND cp.completed_at >= v_bounds.curr_start_ts AND cp.completed_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  -- 2. Post-Course Follow-Ups (Reconciling Block 5)
  SELECT 
    count(*) FILTER (WHERE pce.followup_status IN ('completed', 'pending')),
    count(*) FILTER (WHERE pce.followup_status = 'completed')
  INTO v_followups_due, v_followups_completed
  FROM public.post_course_engagements pce
  JOIN public.leads l ON l.id = pce.lead_id
  WHERE pce.created_at >= v_bounds.curr_start_ts AND pce.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR l.source != 'test');

  IF v_followups_due > 0 THEN
    v_followup_completion_rate := ROUND((v_followups_completed::numeric / v_followups_due::numeric) * 100.0, 1);
  END IF;

  -- 3. Feedback Response Rate (Reconciling Block 5)
  SELECT 
    count(*) FILTER (WHERE feedback_status IN ('requested', 'received', 'declined')),
    count(*) FILTER (WHERE feedback_status = 'received')
  INTO v_feedback_requested, v_feedback_received
  FROM public.post_course_engagements pce
  JOIN public.leads l ON l.id = pce.lead_id
  WHERE (p_include_test = true OR l.source != 'test');

  IF v_feedback_requested > 0 THEN
    v_feedback_rate := ROUND((v_feedback_received::numeric / v_feedback_requested::numeric) * 100.0, 1);
  END IF;

  -- 4. Testimonial Response Rate (Reconciling Block 5)
  SELECT 
    count(*) FILTER (WHERE testimonial_status IN ('requested', 'received', 'declined')),
    count(*) FILTER (WHERE testimonial_status = 'received')
  INTO v_testimonials_requested, v_testimonials_received
  FROM public.post_course_engagements pce
  JOIN public.leads l ON l.id = pce.lead_id
  WHERE (p_include_test = true OR l.source != 'test');

  IF v_testimonials_requested > 0 THEN
    v_testimonial_rate := ROUND((v_testimonials_received::numeric / v_testimonials_requested::numeric) * 100.0, 1);
  END IF;

  -- 5. Repeat Students Snapshot (Reconciling Block 5)
  WITH student_counts AS (
    SELECT e.lead_id, count(*) AS conf_count
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    GROUP BY e.lead_id
  )
  SELECT 
    count(*) FILTER (WHERE conf_count >= 2),
    count(*)
  INTO v_repeat_students_count, v_total_confirmed_students
  FROM student_counts;

  IF v_total_confirmed_students > 0 THEN
    v_repeat_student_rate := ROUND((v_repeat_students_count::numeric / v_total_confirmed_students::numeric) * 100.0, 1);
  END IF;

  -- 6. Alumni Snapshot
  SELECT count(*) INTO v_alumni_current_count
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE s.code = 'alumni'
    AND (p_include_test = true OR l.source != 'test');

  -- 7. Opportunities Snapshots (Reconciling Block 5)
  SELECT count(*) INTO v_testimonial_opps_count
  FROM public.post_course_engagements eng
  JOIN public.leads l ON l.id = eng.lead_id
  WHERE eng.feedback_status = 'received'
    AND eng.testimonial_status = 'not_requested'
    AND (p_include_test = true OR l.source != 'test');

  SELECT count(*) INTO v_next_course_opps_count
  FROM public.lead_course_interests i
  JOIN public.leads l ON l.id = i.lead_id
  WHERE i.status = 'active'
    AND (p_include_test = true OR l.source != 'test')
    AND NOT EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.lead_id = i.lead_id
        AND e.course_id = i.course_id
        AND e.enrollment_status = 'confirmed'
    );

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'include_test', p_include_test,
      'generated_at', now()
    ),
    'metrics', jsonb_build_object(
      'completed_students_in_period', jsonb_build_object(
        'current', v_completed_students_period,
        'type', 'period'
      ),
      'followup_completion_rate', jsonb_build_object(
        'current', v_followup_completion_rate,
        'followups_completed', v_followups_completed,
        'followups_due', v_followups_due,
        'type', 'cohort'
      ),
      'feedback_response_rate', jsonb_build_object(
        'current', v_feedback_rate,
        'feedback_received', v_feedback_received,
        'feedback_requested', v_feedback_requested,
        'type', 'snapshot'
      ),
      'testimonial_response_rate', jsonb_build_object(
        'current', v_testimonial_rate,
        'testimonials_received', v_testimonials_received,
        'testimonials_requested', v_testimonials_requested,
        'type', 'snapshot'
      ),
      'repeat_student_rate', jsonb_build_object(
        'current', v_repeat_student_rate,
        'repeat_students', v_repeat_students_count,
        'total_confirmed_students', v_total_confirmed_students,
        'type', 'snapshot'
      ),
      'alumni_current_count', jsonb_build_object(
        'current', v_alumni_current_count,
        'type', 'snapshot'
      ),
      'testimonial_opportunities_count', jsonb_build_object(
        'current', v_testimonial_opps_count,
        'type', 'snapshot'
      ),
      'next_course_opportunities_count', jsonb_build_object(
        'current', v_next_course_opps_count,
        'type', 'snapshot'
      )
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 12. Security Grants & Access Control
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.calculate_report_period_bounds(DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_report_period_bounds(DATE, DATE, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_report_bucket_interval(DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_bucket_interval(DATE, DATE, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.calculate_percent_change(NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_percent_change(NUMERIC, NUMERIC) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_executive_overview(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_executive_overview(DATE, DATE, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_funnel(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_funnel(DATE, DATE, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_revenue(DATE, DATE, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_revenue(DATE, DATE, TEXT, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_sources(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_sources(DATE, DATE, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_courses(DATE, DATE, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_courses(DATE, DATE, UUID, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_engagement(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_engagement(DATE, DATE, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_post_course(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_post_course(DATE, DATE, BOOLEAN) TO authenticated, service_role;
