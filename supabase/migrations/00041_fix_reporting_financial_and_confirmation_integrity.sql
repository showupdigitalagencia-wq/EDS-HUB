-- =============================================================================
-- Migration 00041: Fix Reporting Financial and Confirmation Integrity
-- =============================================================================
-- 1. Canonical Refund Source:
--    Refunded Amount = SUM(amount) WHERE payment_type = 'refund' AND payment_status = 'paid'
--    Gross Collected = SUM(amount) WHERE payment_type = 'payment' AND payment_status = 'paid'
--    Net Revenue = Gross Collected - Refunded Amount
--    Prevents double counting from original payments marked with payment_status = 'refunded'.
-- 2. Legacy Confirmation Fallback Transparency:
--    Differentiate confirmation_timestamp_source: 'history' vs 'legacy_fallback'.
--    Track and expose legacy_confirmation_fallback_count in report metadata.
-- 3. Exact 1:1 Reconciled Revenue Dashboard Metrics and Reporting RPCs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Update public.get_revenue_dashboard_metrics (Reconciled Canonical Refunds)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_revenue_dashboard_metrics(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date;
  v_end_date date;
  v_booked_value numeric(12, 2) := 0;
  v_confirmed_enrollments_count integer := 0;
  v_collected_revenue numeric(12, 2) := 0;
  v_refunded_amount numeric(12, 2) := 0;
  v_net_revenue numeric(12, 2) := 0;
  v_paid_enrollments_count integer := 0;
  v_outstanding_balance numeric(12, 2) := 0;
  v_average_ticket numeric(12, 2) := NULL;
  v_average_collected numeric(12, 2) := NULL;
  v_course_performance jsonb := '[]'::jsonb;
  v_recent_transactions jsonb := '[]'::jsonb;
  v_org_tz text := 'America/New_York';
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Caller is not an active app user.';
  END IF;

  SELECT COALESCE(timezone, 'America/New_York') INTO v_org_tz
  FROM public.app_settings
  LIMIT 1;

  IF p_start_date IS NULL THEN
    v_start_date := (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE v_org_tz))::date;
  ELSE
    v_start_date := (p_start_date AT TIME ZONE v_org_tz)::date;
  END IF;

  IF p_end_date IS NULL THEN
    v_end_date := ((date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE v_org_tz) + interval '1 month' - interval '1 day'))::date;
  ELSE
    v_end_date := (p_end_date AT TIME ZONE v_org_tz)::date;
  END IF;

  -- 1. Booked Value & Confirmed Enrollments in period (USD only)
  SELECT 
    COALESCE(SUM(agreed_amount), 0.00),
    COUNT(*)
  INTO v_booked_value, v_confirmed_enrollments_count
  FROM public.enrollments
  WHERE enrollment_status = 'confirmed'
    AND enrollment_date >= v_start_date
    AND enrollment_date <= v_end_date
    AND currency = 'USD';

  -- 2. Gross Collected Revenue & Refunded Amount in period (USD only)
  -- Strictly separate payment records from refund transaction records
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN p.amount ELSE 0.00 END), 0.00)
  INTO v_collected_revenue, v_refunded_amount
  FROM public.enrollment_payments p
  WHERE p.payment_date >= v_start_date
    AND p.payment_date <= v_end_date
    AND p.currency = 'USD';

  v_net_revenue := v_collected_revenue - v_refunded_amount;

  -- 3. Paid enrollments count (confirmed enrollments with net paid > 0)
  SELECT COUNT(DISTINCT e.id)
  INTO v_paid_enrollments_count
  FROM public.enrollments e
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= v_start_date
    AND e.enrollment_date <= v_end_date
    AND EXISTS (
      SELECT 1 FROM public.enrollment_payments p
      WHERE p.enrollment_id = e.id AND p.payment_status = 'paid' AND p.payment_type = 'payment'
    );

  -- 4. Outstanding Balance for confirmed enrollments in period
  SELECT COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00)), 0.00)
  INTO v_outstanding_balance
  FROM public.enrollments e
  LEFT JOIN (
    SELECT 
      enrollment_id, 
      SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
               WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
               ELSE 0 END) AS paid_amt
    FROM public.enrollment_payments
    GROUP BY enrollment_id
  ) paid_sum ON paid_sum.enrollment_id = e.id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= v_start_date
    AND e.enrollment_date <= v_end_date
    AND e.currency = 'USD';

  -- 5. Average Ticket & Average Collected
  IF v_confirmed_enrollments_count > 0 THEN
    v_average_ticket := ROUND((v_booked_value / v_confirmed_enrollments_count)::numeric, 2);
  ELSE
    v_average_ticket := NULL;
  END IF;

  IF v_paid_enrollments_count > 0 THEN
    v_average_collected := ROUND((v_collected_revenue / v_paid_enrollments_count)::numeric, 2);
  ELSE
    v_average_collected := NULL;
  END IF;

  -- 6. Course Revenue Performance Breakdown
  SELECT COALESCE(jsonb_agg(c_row), '[]'::jsonb)
  INTO v_course_performance
  FROM (
    SELECT
      c.id AS course_id,
      c.name AS course_name,
      c.code AS course_code,
      c.currency,
      COUNT(e.id) AS confirmed_enrollments,
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_value,
      COALESCE(SUM(p_agg.collected), 0.00) AS collected_revenue,
      COALESCE(SUM(p_agg.net_revenue), 0.00) AS net_revenue,
      COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(p_agg.net_revenue, 0.00), 0.00)), 0.00) AS outstanding_balance
    FROM public.courses c
    LEFT JOIN public.enrollments e ON e.course_id = c.id
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= v_start_date
      AND e.enrollment_date <= v_end_date
      AND e.currency = 'USD'
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount ELSE 0 END) AS collected,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
                 ELSE 0 END) AS net_revenue
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id
        AND payment_date >= v_start_date
        AND payment_date <= v_end_date
    ) p_agg ON true
    WHERE c.active = true
    GROUP BY c.id, c.name, c.code, c.currency
    ORDER BY net_revenue DESC, confirmed_enrollments DESC
  ) c_row;

  -- 7. Recent Transactions (last 10 in period)
  SELECT COALESCE(jsonb_agg(t_row), '[]'::jsonb)
  INTO v_recent_transactions
  FROM (
    SELECT
      p.id AS payment_id,
      p.enrollment_id,
      p.amount,
      p.currency,
      p.payment_status,
      p.payment_type,
      p.payment_date,
      p.payment_method,
      l.first_name || ' ' || l.last_name AS student_name,
      c.name AS course_name
    FROM public.enrollment_payments p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.courses c ON c.id = e.course_id
    WHERE p.payment_date >= v_start_date
      AND p.payment_date <= v_end_date
    ORDER BY p.payment_date DESC, p.created_at DESC
    LIMIT 10
  ) t_row;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', v_start_date,
      'end_date', v_end_date
    ),
    'booked_value', v_booked_value,
    'confirmed_enrollments_count', v_confirmed_enrollments_count,
    'collected_revenue', v_collected_revenue,
    'refunded_amount', v_refunded_amount,
    'net_revenue', v_net_revenue,
    'paid_enrollments_count', v_paid_enrollments_count,
    'outstanding_balance', v_outstanding_balance,
    'average_ticket', v_average_ticket,
    'average_collected', v_average_collected,
    'course_performance', v_course_performance,
    'recent_transactions', v_recent_transactions
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. Update public.get_reports_executive_overview
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

  -- Fallback transparency tracking
  v_legacy_confirmation_fallback_count INT := 0;

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

  -- 2. Confirmed Enrollments in period (using canonical confirmation date + source transparency)
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
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM public.enrollment_history eh 
          WHERE eh.enrollment_id = e.id 
            AND (
              (eh.event_type = 'enrollment_created' AND eh.new_values->>'status' = 'confirmed')
              OR (eh.event_type = 'enrollment_status_changed' AND eh.new_values->>'status' = 'confirmed')
            )
        ) THEN 'history'
        ELSE 'legacy_fallback'
      END AS confirmation_timestamp_source,
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
    COALESCE(SUM(ce.agreed_amount) FILTER (WHERE ce.confirmed_at >= v_bounds.prev_start_ts AND ce.confirmed_at < v_bounds.prev_end_ts AND ce.currency = 'USD'), 0.00),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts AND ce.confirmation_timestamp_source = 'legacy_fallback')
  INTO 
    v_curr_confirmed_enrollments,
    v_curr_booked_value,
    v_curr_new_enrollments,
    v_curr_repeat_enrollments,
    v_prev_confirmed_enrollments,
    v_prev_booked_value,
    v_legacy_confirmation_fallback_count
  FROM canonical_enrollments ce;

  IF v_curr_confirmed_enrollments > 0 THEN
    v_curr_repeat_rate := ROUND((v_curr_repeat_enrollments::numeric / v_curr_confirmed_enrollments::numeric) * 100.0, 1);
  END IF;

  -- 3. Financial Collections & Refunds (USD only, canonical Block 3 reconciliation)
  -- Current Period
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN p.amount ELSE 0.00 END), 0.00)
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
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN p.amount ELSE 0.00 END), 0.00)
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
               WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount
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
    v_curr_conv_rate := ROUND((v_curr_cohort_leads_enrolled::numeric / v_curr_leads_created::numeric) * 100.0, 1);
  END IF;

  SELECT COUNT(DISTINCT l.id) INTO v_prev_cohort_leads_enrolled
  FROM public.leads l
  JOIN public.enrollments e ON e.lead_id = l.id
  WHERE l.created_at >= v_bounds.prev_start_ts AND l.created_at < v_bounds.prev_end_ts
    AND e.enrollment_status = 'confirmed'
    AND (p_include_test = true OR (l.source != 'test' AND e.source != 'test'));

  IF v_prev_leads_created > 0 THEN
    v_prev_conv_rate := ROUND((v_prev_cohort_leads_enrolled::numeric / v_prev_leads_created::numeric) * 100.0, 1);
  END IF;

  -- 7. Reply Rate (Canonical Sales Intelligence logic)
  SELECT 
    COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'outbound' AND status = 'sent'),
    COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'inbound')
  INTO v_curr_outbound_leads, v_curr_replied_leads
  FROM public.communications c
  WHERE c.created_at >= v_bounds.curr_start_ts AND c.created_at < v_bounds.curr_end_ts
    AND (p_include_test = true OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id AND l.source = 'test'));

  IF v_curr_outbound_leads > 0 THEN
    v_curr_reply_rate := ROUND((LEAST(v_curr_replied_leads, v_curr_outbound_leads)::numeric / v_curr_outbound_leads::numeric) * 100.0, 1);
  END IF;

  SELECT 
    COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'outbound' AND status = 'sent'),
    COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'inbound')
  INTO v_prev_outbound_leads, v_prev_replied_leads
  FROM public.communications c
  WHERE c.created_at >= v_bounds.prev_start_ts AND c.created_at < v_bounds.prev_end_ts
    AND (p_include_test = true OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id AND l.source = 'test'));

  IF v_prev_outbound_leads > 0 THEN
    v_prev_reply_rate := ROUND((LEAST(v_prev_replied_leads, v_prev_outbound_leads)::numeric / v_prev_outbound_leads::numeric) * 100.0, 1);
  END IF;

  -- 8. Top 5 Courses by Net Revenue (Canonical course_id link)
  SELECT COALESCE(jsonb_agg(c_item), '[]'::jsonb)
  INTO v_top_courses
  FROM (
    SELECT 
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      COUNT(DISTINCT e.id) AS confirmed_enrollments,
      COUNT(DISTINCT e.lead_id) AS unique_students,
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_revenue,
      COALESCE(
        (
          SELECT SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                          WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
                          ELSE 0.00 END)
          FROM public.enrollment_payments p
          JOIN public.enrollments ep ON ep.id = p.enrollment_id
          WHERE ep.course_id = c.id
            AND p.payment_date >= p_start_date AND p.payment_date <= p_end_date
            AND p.currency = 'USD'
        ),
        0.00
      ) AS net_revenue
    FROM public.courses c
    LEFT JOIN public.enrollments e ON e.course_id = c.id 
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
      AND (p_include_test = true OR e.source != 'test')
    WHERE c.active = true
    GROUP BY c.id, c.code, c.name
    ORDER BY net_revenue DESC, confirmed_enrollments DESC
    LIMIT 5
  ) c_item;

  -- 9. Top 5 Sources by Net Revenue
  SELECT COALESCE(jsonb_agg(s_item), '[]'::jsonb)
  INTO v_top_sources
  FROM (
    SELECT 
      src.source_name AS source,
      COUNT(DISTINCT l.id) AS leads_created,
      COUNT(DISTINCT e.id) AS confirmed_enrollments,
      COALESCE(
        (
          SELECT SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                          WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
                          ELSE 0.00 END)
          FROM public.enrollment_payments p
          JOIN public.enrollments ep ON ep.id = p.enrollment_id
          JOIN public.leads lp ON lp.id = ep.lead_id
          WHERE lp.source = src.source_name
            AND p.payment_date >= p_start_date AND p.payment_date <= p_end_date
            AND p.currency = 'USD'
        ),
        0.00
      ) AS net_revenue,
      CASE 
        WHEN COUNT(DISTINCT l.id) > 0 THEN
          ROUND((COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN l.id END)::numeric / COUNT(DISTINCT l.id)::numeric) * 100.0, 1)
        ELSE NULL
      END AS cohort_conversion_rate
    FROM (
      VALUES ('meta'), ('google'), ('manual'), ('form'), ('test')
    ) AS src(source_name)
    LEFT JOIN public.leads l ON l.source = src.source_name 
      AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    LEFT JOIN public.enrollments e ON e.lead_id = l.id AND e.enrollment_status = 'confirmed'
    WHERE (p_include_test = true OR src.source_name != 'test')
    GROUP BY src.source_name
    ORDER BY net_revenue DESC, leads_created DESC
    LIMIT 5
  ) s_item;

  -- 10. Revenue Trend Series
  v_bucket_interval := public.get_report_bucket_interval(p_start_date, p_end_date);
  
  SELECT COALESCE(jsonb_agg(t_item ORDER BY t_item->>'date' ASC), '[]'::jsonb)
  INTO v_trend
  FROM (
    SELECT 
      b_series.b_date::text AS date,
      COALESCE(l_agg.leads_count, 0) AS leads_created,
      COALESCE(p_agg.gross_collected, 0.00) AS gross_collected,
      COALESCE(p_agg.net_revenue, 0.00) AS net_revenue
    FROM (
      SELECT generate_series(p_start_date::timestamp, p_end_date::timestamp, v_bucket_interval::interval)::date AS b_date
    ) b_series
    LEFT JOIN (
      SELECT created_at::date AS l_date, COUNT(*) AS leads_count
      FROM public.leads
      WHERE created_at >= v_bounds.curr_start_ts AND created_at < v_bounds.curr_end_ts
        AND (p_include_test = true OR source != 'test')
      GROUP BY l_date
    ) l_agg ON l_agg.l_date = b_series.b_date
    LEFT JOIN (
      SELECT 
        p.payment_date AS p_date,
        SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END) AS gross_collected,
        SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount 
                 WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN -p.amount 
                 ELSE 0.00 END) AS net_revenue
      FROM public.enrollment_payments p
      JOIN public.enrollments e ON e.id = p.enrollment_id
      JOIN public.leads l ON l.id = e.lead_id
      WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
        AND p.currency = 'USD'
        AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
      GROUP BY p.payment_date
    ) p_agg ON p_agg.p_date = b_series.b_date
  ) t_item;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'comparison_start', v_bounds.prev_start_date,
      'comparison_end', v_bounds.prev_end_date,
      'include_test', p_include_test,
      'currency', 'USD',
      'legacy_confirmation_fallback_count', v_legacy_confirmation_fallback_count,
      'generated_at', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    ),
    'kpis', jsonb_build_object(
      'leads_created', public.calculate_percent_change(v_curr_leads_created, v_prev_leads_created) || jsonb_build_object('type', 'period'),
      'confirmed_enrollments', public.calculate_percent_change(v_curr_confirmed_enrollments, v_prev_confirmed_enrollments) || jsonb_build_object('type', 'period'),
      'gross_collected', public.calculate_percent_change(v_curr_gross_collected, v_prev_gross_collected) || jsonb_build_object('type', 'period'),
      'refunded_amount', public.calculate_percent_change(v_curr_refunded, v_prev_refunded) || jsonb_build_object('type', 'period'),
      'net_revenue', public.calculate_percent_change(v_curr_net_revenue, v_prev_net_revenue) || jsonb_build_object('type', 'period'),
      'booked_revenue', public.calculate_percent_change(v_curr_booked_value, v_prev_booked_value) || jsonb_build_object('type', 'period'),
      'current_outstanding_balance', jsonb_build_object('current', v_current_outstanding, 'type', 'snapshot'),
      'current_hot_leads', jsonb_build_object('current', v_current_hot_leads, 'type', 'snapshot'),
      'current_active_leads', jsonb_build_object('current', v_current_active_leads, 'type', 'snapshot'),
      'cohort_conversion_rate', public.calculate_percent_change(v_curr_conv_rate, v_prev_conv_rate) || jsonb_build_object('type', 'cohort'),
      'repeat_student_rate', jsonb_build_object('current', v_curr_repeat_rate, 'type', 'cohort'),
      'reply_rate', public.calculate_percent_change(v_curr_reply_rate, v_prev_reply_rate) || jsonb_build_object('type', 'period')
    ),
    'top_courses', v_top_courses,
    'top_sources', v_top_sources,
    'revenue_trend', v_trend
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Update public.get_reports_revenue
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
  
  -- Current Period Financials
  v_gross_collected NUMERIC(12,2) := 0.00;
  v_refunded_amount NUMERIC(12,2) := 0.00;
  v_net_revenue NUMERIC(12,2) := 0.00;
  v_booked_revenue NUMERIC(12,2) := 0.00;
  v_current_outstanding NUMERIC(12,2) := 0.00;
  v_confirmed_count INT := 0;
  v_avg_ticket NUMERIC(12,2) := NULL;
  v_refund_count INT := 0;
  v_refund_rate NUMERIC(5,2) := NULL;

  -- Previous Period Financials
  v_prev_gross NUMERIC(12,2) := 0.00;
  v_prev_refunded NUMERIC(12,2) := 0.00;
  v_prev_net NUMERIC(12,2) := 0.00;
  v_prev_booked NUMERIC(12,2) := 0.00;
  v_prev_confirmed INT := 0;
  v_prev_avg_ticket NUMERIC(12,2) := NULL;

  -- Fallback transparency
  v_legacy_confirmation_fallback_count INT := 0;

  v_time_series JSONB := '[]'::jsonb;
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
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN p.amount ELSE 0.00 END), 0.00),
    COUNT(*) FILTER (WHERE p.payment_status = 'paid' AND p.payment_type = 'refund')
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

  -- 2. Booked Value & Confirmed Enrollments in period (with canonical confirmation date)
  WITH canonical_enrollments AS (
    SELECT 
      e.id,
      e.agreed_amount,
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
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM public.enrollment_history eh 
          WHERE eh.enrollment_id = e.id 
            AND (
              (eh.event_type = 'enrollment_created' AND eh.new_values->>'status' = 'confirmed')
              OR (eh.event_type = 'enrollment_status_changed' AND eh.new_values->>'status' = 'confirmed')
            )
        ) THEN 'history'
        ELSE 'legacy_fallback'
      END AS confirmation_timestamp_source
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed'
      AND e.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
  )
  SELECT 
    COALESCE(SUM(ce.agreed_amount) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts), 0.00),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.curr_start_ts AND ce.confirmed_at < v_bounds.curr_end_ts AND ce.confirmation_timestamp_source = 'legacy_fallback')
  INTO v_booked_revenue, v_confirmed_count, v_legacy_confirmation_fallback_count
  FROM canonical_enrollments ce;

  IF v_confirmed_count > 0 THEN
    v_avg_ticket := ROUND(v_booked_revenue / v_confirmed_count, 2);
  END IF;

  -- 3. Previous Period Cash Metrics
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN p.amount ELSE 0.00 END), 0.00)
  INTO v_prev_gross, v_prev_refunded
  FROM public.enrollment_payments p
  JOIN public.enrollments e ON e.id = p.enrollment_id
  JOIN public.leads l ON l.id = e.lead_id
  WHERE p.payment_date >= v_bounds.prev_start_date AND p.payment_date <= v_bounds.prev_end_date
    AND p.currency = 'USD'
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'));

  v_prev_net := v_prev_gross - v_prev_refunded;

  WITH canonical_enrollments_prev AS (
    SELECT 
      e.id,
      e.agreed_amount,
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
      ) AS confirmed_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed'
      AND e.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
  )
  SELECT 
    COALESCE(SUM(ce.agreed_amount) FILTER (WHERE ce.confirmed_at >= v_bounds.prev_start_ts AND ce.confirmed_at < v_bounds.prev_end_ts), 0.00),
    COUNT(*) FILTER (WHERE ce.confirmed_at >= v_bounds.prev_start_ts AND ce.confirmed_at < v_bounds.prev_end_ts)
  INTO v_prev_booked, v_prev_confirmed
  FROM canonical_enrollments_prev ce;

  IF v_prev_confirmed > 0 THEN
    v_prev_avg_ticket := ROUND(v_prev_booked / v_prev_confirmed, 2);
  END IF;

  -- 4. Current Outstanding Balance (Snapshot across all confirmed enrollments)
  SELECT COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(paid_sum.net_paid, 0.00), 0.00)), 0.00)
  INTO v_current_outstanding
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  LEFT JOIN (
    SELECT 
      enrollment_id,
      SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
               WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount
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
      SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'refund' THEN p.amount ELSE 0.00 END) AS ref
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
  SELECT COALESCE(jsonb_agg(ts_row ORDER BY ts_row->>'period_start' ASC), '[]'::jsonb)
  INTO v_time_series
  FROM (
    SELECT 
      to_char(bs.b_start, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS period_start,
      COALESCE(bp.gross, 0.00) AS gross_collected,
      COALESCE(bp.ref, 0.00) AS refunded_amount,
      COALESCE(bp.gross, 0.00) - COALESCE(bp.ref, 0.00) AS net_revenue,
      COALESCE(bb.booked, 0.00) AS booked_revenue
    FROM bucket_series bs
    LEFT JOIN bucket_payments bp ON bp.b_date = bs.b_start
    LEFT JOIN bucket_booked bb ON bb.b_date = bs.b_start
  ) ts_row;

  -- 6. Payment Methods Breakdown
  SELECT COALESCE(jsonb_agg(pm_row ORDER BY pm_row->>'total_amount' DESC), '[]'::jsonb)
  INTO v_payment_methods
  FROM (
    SELECT 
      p.payment_method AS method,
      COUNT(*) AS payment_count,
      COALESCE(SUM(p.amount), 0.00) AS total_amount
    FROM public.enrollment_payments p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    WHERE p.payment_date >= p_start_date AND p.payment_date <= p_end_date
      AND p.payment_status = 'paid'
      AND p.payment_type = 'payment'
      AND p.currency = 'USD'
      AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    GROUP BY p.payment_method
  ) pm_row;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'comparison_start', v_bounds.prev_start_date,
      'comparison_end', v_bounds.prev_end_date,
      'granularity', v_bucket_int,
      'include_test', p_include_test,
      'currency', 'USD',
      'legacy_confirmation_fallback_count', v_legacy_confirmation_fallback_count,
      'generated_at', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    ),
    'summary', jsonb_build_object(
      'gross_collected', public.calculate_percent_change(v_gross_collected, v_prev_gross) || jsonb_build_object('type', 'period'),
      'refunded_amount', public.calculate_percent_change(v_refunded_amount, v_prev_refunded) || jsonb_build_object('type', 'period'),
      'net_revenue', public.calculate_percent_change(v_net_revenue, v_prev_net) || jsonb_build_object('type', 'period'),
      'booked_revenue', public.calculate_percent_change(v_booked_revenue, v_prev_booked) || jsonb_build_object('type', 'period'),
      'current_outstanding_balance', jsonb_build_object('current', v_current_outstanding, 'type', 'snapshot'),
      'average_ticket', public.calculate_percent_change(v_avg_ticket, v_prev_avg_ticket) || jsonb_build_object('type', 'period'),
      'refund_rate', jsonb_build_object('current', v_refund_rate, 'refund_count', v_refund_count, 'type', 'period')
    ),
    'time_series', v_time_series,
    'payment_methods', v_payment_methods
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Update public.get_reports_sources
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
  v_sources_list JSONB := '[]'::jsonb;
  v_legacy_confirmation_fallback_count INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  -- Count legacy fallback for sources report
  SELECT COUNT(*)
  INTO v_legacy_confirmation_fallback_count
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    AND NOT EXISTS (
      SELECT 1 FROM public.enrollment_history eh 
      WHERE eh.enrollment_id = e.id 
        AND (
          (eh.event_type = 'enrollment_created' AND eh.new_values->>'status' = 'confirmed')
          OR (eh.event_type = 'enrollment_status_changed' AND eh.new_values->>'status' = 'confirmed')
        )
    );

  SELECT COALESCE(jsonb_agg(s_item), '[]'::jsonb)
  INTO v_sources_list
  FROM (
    SELECT 
      src.source_name AS source,
      COUNT(DISTINCT l.id) AS leads_created,
      COUNT(DISTINCT CASE WHEN l.qualification_status IN ('qualified', 'highly_qualified') OR l.pipeline_stage_id IS NOT NULL THEN l.id END) AS qualified_leads,
      COUNT(DISTINCT CASE WHEN e_cohort.id IS NOT NULL THEN l.id END) AS cohort_leads_enrolled,
      CASE 
        WHEN COUNT(DISTINCT l.id) > 0 THEN
          ROUND((COUNT(DISTINCT CASE WHEN e_cohort.id IS NOT NULL THEN l.id END)::numeric / COUNT(DISTINCT l.id)::numeric) * 100.0, 1)
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
                            WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount
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
    LEFT JOIN public.leads l ON l.source = src.source_name 
      AND l.created_at >= v_bounds.curr_start_ts AND l.created_at < v_bounds.curr_end_ts
    LEFT JOIN public.enrollments e_cohort ON e_cohort.lead_id = l.id AND e_cohort.enrollment_status = 'confirmed'
    LEFT JOIN public.enrollments e ON e.source = src.source_name
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
      AND e.currency = 'USD'
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount ELSE 0.00 END) AS gross_amount,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'refund' THEN amount ELSE 0.00 END) AS ref_amount,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
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
      'legacy_confirmation_fallback_count', v_legacy_confirmation_fallback_count,
      'generated_at', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    ),
    'sources', v_sources_list
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. Update public.get_reports_courses
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
  v_courses_list JSONB := '[]'::jsonb;
  v_sessions_list JSONB := '[]'::jsonb;
  v_legacy_confirmation_fallback_count INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT * INTO v_bounds FROM public.calculate_report_period_bounds(p_start_date, p_end_date);

  -- Count legacy fallback for courses report
  SELECT COUNT(*)
  INTO v_legacy_confirmation_fallback_count
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= p_start_date AND e.enrollment_date <= p_end_date
    AND (p_course_id IS NULL OR e.course_id = p_course_id)
    AND (p_include_test = true OR (e.source != 'test' AND l.source != 'test'))
    AND NOT EXISTS (
      SELECT 1 FROM public.enrollment_history eh 
      WHERE eh.enrollment_id = e.id 
        AND (
          (eh.event_type = 'enrollment_created' AND eh.new_values->>'status' = 'confirmed')
          OR (eh.event_type = 'enrollment_status_changed' AND eh.new_values->>'status' = 'confirmed')
        )
    );

  -- 1. Courses Performance (Canonical course_id link, USD/Multi-Currency Safe)
  SELECT COALESCE(jsonb_agg(c_item), '[]'::jsonb)
  INTO v_courses_list
  FROM (
    SELECT 
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      c.default_price,
      c.currency,
      COUNT(DISTINCT e.id) AS confirmed_enrollments,
      COUNT(DISTINCT e.lead_id) AS unique_students,
      COUNT(DISTINCT CASE WHEN ord.order_num = 1 THEN e.id END) AS new_students,
      COUNT(DISTINCT CASE WHEN ord.order_num > 1 THEN e.id END) AS repeat_students,
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
                            WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount
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
      SELECT ROW_NUMBER() OVER (
        PARTITION BY ep_all.lead_id 
        ORDER BY 
          COALESCE(
            (SELECT MIN(eh.created_at) FROM public.enrollment_history eh WHERE eh.enrollment_id = ep_all.id AND eh.new_values->>'status' = 'confirmed'),
            (ep_all.enrollment_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_bounds.org_tz,
            ep_all.created_at
          ) ASC, 
          ep_all.id ASC
      ) AS order_num
      FROM public.enrollments ep_all
      WHERE ep_all.id = e.id
    ) ord ON true
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount ELSE 0.00 END) AS gross_amount,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'refund' THEN amount ELSE 0.00 END) AS ref_amount,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
                 ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id AND payment_date >= p_start_date AND payment_date <= p_end_date
    ) p_stats ON true
    WHERE c.active = true
      AND (p_course_id IS NULL OR c.id = p_course_id)
    GROUP BY c.id, c.code, c.name, c.default_price, c.currency, c.sort_order
    ORDER BY net_revenue DESC, confirmed_enrollments DESC
  ) c_item;

  -- 2. Sessions Performance
  SELECT COALESCE(jsonb_agg(s_item), '[]'::jsonb)
  INTO v_sessions_list
  FROM (
    SELECT 
      cs.id AS session_id,
      cs.session_code,
      cs.title AS session_title,
      c.id AS course_id,
      c.name AS course_name,
      cs.status,
      cs.start_date,
      cs.end_date,
      cs.capacity,
      COUNT(DISTINCT e.id) AS assigned_enrollments,
      CASE 
        WHEN (
          SELECT COUNT(*) 
          FROM public.course_participations cp 
          WHERE cp.course_session_id = cs.id 
            AND cp.attendance_status IN ('attended', 'no_show')
        ) > 0 
        THEN ROUND(
          (
            (SELECT COUNT(*) FROM public.course_participations cp WHERE cp.course_session_id = cs.id AND cp.attendance_status = 'attended')::numeric 
            / 
            (SELECT COUNT(*) FROM public.course_participations cp WHERE cp.course_session_id = cs.id AND cp.attendance_status IN ('attended', 'no_show'))::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS attendance_rate,
      CASE 
        WHEN (
          SELECT COUNT(*) 
          FROM public.course_participations cp 
          WHERE cp.course_session_id = cs.id 
            AND cp.completion_status IN ('completed', 'incomplete')
        ) > 0 
        THEN ROUND(
          (
            (SELECT COUNT(*) FROM public.course_participations cp WHERE cp.course_session_id = cs.id AND cp.completion_status = 'completed')::numeric 
            / 
            (SELECT COUNT(*) FROM public.course_participations cp WHERE cp.course_session_id = cs.id AND cp.completion_status IN ('completed', 'incomplete'))::numeric
          ) * 100.0, 1
        )
        ELSE NULL
      END AS completion_rate,
      COALESCE(SUM(COALESCE(p_stats.net_amount, 0.00)), 0.00) AS net_revenue
    FROM public.course_sessions cs
    JOIN public.courses c ON c.id = cs.course_id
    LEFT JOIN public.enrollments e ON e.course_session_id = cs.id
      AND e.enrollment_status = 'confirmed'
      AND (p_include_test = true OR e.source != 'test')
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_status = 'paid' AND payment_type = 'refund' THEN -amount 
                 ELSE 0.00 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id AND payment_date >= p_start_date AND payment_date <= p_end_date
    ) p_stats ON true
    WHERE (p_course_id IS NULL OR cs.course_id = p_course_id)
    GROUP BY cs.id, cs.session_code, cs.title, c.id, c.name, cs.status, cs.start_date, cs.end_date, cs.capacity
    ORDER BY cs.start_date DESC
  ) s_item;

  RETURN jsonb_build_object(
    'metadata', jsonb_build_object(
      'timezone', v_bounds.org_tz,
      'period_start', p_start_date,
      'period_end', p_end_date,
      'course_filter_id', p_course_id,
      'include_test', p_include_test,
      'currency', 'USD',
      'legacy_confirmation_fallback_count', v_legacy_confirmation_fallback_count,
      'generated_at', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    ),
    'courses', v_courses_list,
    'sessions', v_sessions_list
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Permissions and RLS Grants
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_revenue_dashboard_metrics(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_dashboard_metrics(timestamptz, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_executive_overview(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_executive_overview(DATE, DATE, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_revenue(DATE, DATE, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_revenue(DATE, DATE, TEXT, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_sources(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_sources(DATE, DATE, BOOLEAN) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reports_courses(DATE, DATE, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reports_courses(DATE, DATE, UUID, BOOLEAN) TO authenticated, service_role;
