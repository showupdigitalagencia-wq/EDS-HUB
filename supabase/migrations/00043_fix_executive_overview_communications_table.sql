-- =============================================================================
-- Migration 00043: Fix Executive Overview Communications Table Reference
-- =============================================================================
-- Replaces erroneous reference to non-existent public.communications table
-- with canonical public.outbound_messages and public.inbound_messages tables.
-- =============================================================================

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

  -- 7. Reply Rate (Canonical outbound_messages and inbound_messages)
  SELECT 
    COUNT(DISTINCT lead_id)
  INTO v_curr_outbound_leads
  FROM public.outbound_messages om
  WHERE om.status = 'sent' AND om.channel IN ('email', 'sms')
    AND om.sent_at >= v_bounds.curr_start_ts AND om.sent_at < v_bounds.curr_end_ts
    AND om.lead_id IS NOT NULL
    AND (p_include_test = true OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = om.lead_id AND l.source = 'test'));

  SELECT 
    COUNT(DISTINCT lead_id)
  INTO v_curr_replied_leads
  FROM public.inbound_messages im
  WHERE im.processing_status = 'processed'
    AND im.received_at >= v_bounds.curr_start_ts AND im.received_at < v_bounds.curr_end_ts
    AND im.lead_id IS NOT NULL
    AND (p_include_test = true OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = im.lead_id AND l.source = 'test'));

  IF v_curr_outbound_leads > 0 THEN
    v_curr_reply_rate := ROUND((LEAST(v_curr_replied_leads, v_curr_outbound_leads)::numeric / v_curr_outbound_leads::numeric) * 100.0, 1);
  END IF;

  SELECT 
    COUNT(DISTINCT lead_id)
  INTO v_prev_outbound_leads
  FROM public.outbound_messages om
  WHERE om.status = 'sent' AND om.channel IN ('email', 'sms')
    AND om.sent_at >= v_bounds.prev_start_ts AND om.sent_at < v_bounds.prev_end_ts
    AND om.lead_id IS NOT NULL
    AND (p_include_test = true OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = om.lead_id AND l.source = 'test'));

  SELECT 
    COUNT(DISTINCT lead_id)
  INTO v_prev_replied_leads
  FROM public.inbound_messages im
  WHERE im.processing_status = 'processed'
    AND im.received_at >= v_bounds.prev_start_ts AND im.received_at < v_bounds.prev_end_ts
    AND im.lead_id IS NOT NULL
    AND (p_include_test = true OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = im.lead_id AND l.source = 'test'));

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
  
  SELECT COALESCE(jsonb_agg(to_jsonb(t_item) ORDER BY t_item.date ASC), '[]'::jsonb)
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

GRANT EXECUTE ON FUNCTION public.get_reports_executive_overview(DATE, DATE, BOOLEAN) TO authenticated;
