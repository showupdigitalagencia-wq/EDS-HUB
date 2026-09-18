-- =============================================================================
-- Migration 00042: Fix Course Operations Phone Column Reference
-- =============================================================================
-- Fixes column reference in get_course_operations_dashboard and
-- get_course_session_detail where l.phone was referenced instead of
-- COALESCE(l.phone_e164, l.phone_raw).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_course_operations_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_readiness_days INT;
  v_followup_days INT;
  
  -- KPIs
  v_active_sessions_count INT := 0;
  v_upcoming_sessions_count INT := 0;
  v_active_students_count INT := 0;
  v_unassigned_enrollments_count INT := 0;
  v_needs_attention_count INT := 0;

  v_upcoming_sessions JSONB := '[]'::jsonb;
  v_recently_completed JSONB := '[]'::jsonb;
  v_unassigned_students JSONB := '[]'::jsonb;
  v_needs_attention_list JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can view course operations.';
  END IF;

  SELECT 
    COALESCE(course_readiness_window_days, 14) AS course_readiness_window_days,
    COALESCE(post_course_followup_due_days, 2) AS post_course_followup_due_days
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;

  v_readiness_days := COALESCE(v_settings.course_readiness_window_days, 14);
  v_followup_days := COALESCE(v_settings.post_course_followup_due_days, 2);

  -- 1. Operational KPIs
  SELECT count(*) INTO v_active_sessions_count
  FROM public.course_sessions
  WHERE status IN ('draft', 'open', 'confirmed');

  SELECT count(*) INTO v_upcoming_sessions_count
  FROM public.course_sessions
  WHERE status IN ('open', 'confirmed') AND start_date >= CURRENT_DATE;

  SELECT count(DISTINCT e.lead_id) INTO v_active_students_count
  FROM public.enrollments e
  JOIN public.course_sessions s ON s.id = e.course_session_id
  WHERE e.enrollment_status = 'confirmed'
    AND s.status IN ('open', 'confirmed');

  SELECT count(*) INTO v_unassigned_enrollments_count
  FROM public.enrollments
  WHERE enrollment_status = 'confirmed' AND course_session_id IS NULL;

  -- 2. Upcoming Sessions List
  SELECT jsonb_agg(sub) INTO v_upcoming_sessions
  FROM (
    SELECT
      s.id,
      s.code,
      s.title,
      s.status,
      s.start_date,
      s.end_date,
      s.timezone,
      s.capacity,
      s.location,
      s.instructor_name,
      c.id AS course_id,
      c.name AS course_name,
      c.code AS course_code,
      COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed') AS confirmed_students_count,
      CASE
        WHEN s.capacity IS NULL THEN NULL
        ELSE GREATEST(s.capacity - COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed'), 0)
      END AS available_seats,
      COUNT(DISTINCT e.id) FILTER (
        WHERE e.enrollment_status = 'confirmed'
          AND EXISTS (
            SELECT 1 FROM public.student_checklist_items ci
            WHERE ci.enrollment_id = e.id AND ci.required = true AND ci.status = 'pending'
          )
      ) AS unready_students_count
    FROM public.course_sessions s
    JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.enrollments e ON e.course_session_id = s.id AND e.enrollment_status = 'confirmed'
    WHERE s.status IN ('draft', 'open', 'confirmed')
    GROUP BY s.id, c.id
    ORDER BY s.start_date ASC
    LIMIT 50
  ) sub;

  -- 3. Recently Completed Sessions
  SELECT jsonb_agg(sub) INTO v_recently_completed
  FROM (
    SELECT
      s.id,
      s.code,
      s.title,
      s.status,
      s.start_date,
      s.end_date,
      c.name AS course_name,
      COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed') AS total_students,
      COUNT(DISTINCT p.id) FILTER (WHERE p.attendance_status = 'attended') AS attended_count,
      COUNT(DISTINCT p.id) FILTER (WHERE p.completion_status = 'completed') AS completed_count
    FROM public.course_sessions s
    JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.enrollments e ON e.course_session_id = s.id AND e.enrollment_status = 'confirmed'
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id
    WHERE s.status = 'completed' OR (s.status = 'confirmed' AND s.end_date < CURRENT_DATE)
    GROUP BY s.id, c.id
    ORDER BY s.end_date DESC
    LIMIT 10
  ) sub;

  -- 4. Unassigned Students Awaiting Session (Fixed l.phone -> phone_e164/phone_raw)
  SELECT jsonb_agg(sub) INTO v_unassigned_students
  FROM (
    SELECT
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email,
      COALESCE(l.phone_e164, l.phone_raw) AS phone,
      e.course_id,
      e.course_name_snapshot,
      e.enrollment_date,
      e.agreed_amount,
      COALESCE(paid_sum.paid_amt, 0.00) AS net_paid,
      GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) AS outstanding_balance
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    WHERE e.enrollment_status = 'confirmed' AND e.course_session_id IS NULL
    ORDER BY e.enrollment_date ASC
    LIMIT 50
  ) sub;

  -- 5. Operational Needs Attention Aggregator
  SELECT jsonb_agg(sub) INTO v_needs_attention_list
  FROM (
    -- A) ENROLLMENT_WITHOUT_SESSION
    SELECT
      'ENROLLMENT_WITHOUT_SESSION' AS reason_code,
      'critical' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      NULL AS session_code,
      NULL AS session_id,
      'Confirmed enrollment has no course session assigned.' AS message,
      e.created_at AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed' AND e.course_session_id IS NULL

    UNION ALL

    -- B) SESSION_CANCELLED_REASSIGNMENT_REQUIRED
    SELECT
      'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' AS reason_code,
      'critical' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Assigned session ' || s.code || ' was cancelled. Student requires reassignment.' AS message,
      s.updated_at AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.enrollment_status = 'confirmed' AND s.status = 'cancelled'

    UNION ALL

    -- C) UPCOMING_SESSION_UNREADY
    SELECT
      'UPCOMING_SESSION_UNREADY' AS reason_code,
      'warning' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Session starts in ' || (s.start_date - CURRENT_DATE) || ' days but student has pending required checklist items.' AS message,
      s.start_date::timestamptz AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.enrollment_status = 'confirmed'
      AND s.status IN ('open', 'confirmed')
      AND s.start_date <= (CURRENT_DATE + v_readiness_days)
      AND s.start_date >= CURRENT_DATE
      AND EXISTS (
        SELECT 1 FROM public.student_checklist_items ci
        WHERE ci.enrollment_id = e.id AND ci.required = true AND ci.status = 'pending'
      )

    UNION ALL

    -- D) PAYMENT_OUTSTANDING for upcoming session (within window)
    SELECT
      'PAYMENT_OUTSTANDING' AS reason_code,
      'warning' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Session starts in ' || (s.start_date - CURRENT_DATE) || ' days with outstanding tuition balance.' AS message,
      s.start_date::timestamptz AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = e.course_session_id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    WHERE e.enrollment_status = 'confirmed'
      AND s.status IN ('open', 'confirmed')
      AND s.start_date <= (CURRENT_DATE + v_readiness_days)
      AND (e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00)) > 0

    UNION ALL

    -- E) NO_SHOW
    SELECT
      'NO_SHOW' AS reason_code,
      'warning' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Student marked as NO SHOW. Reschedule or follow-up required.' AS message,
      p.updated_at AS detected_at
    FROM public.course_participations p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = p.course_session_id
    WHERE p.attendance_status = 'no_show'

    UNION ALL

    -- F) POST_COURSE_FOLLOWUP_DUE
    SELECT
      'POST_COURSE_FOLLOWUP_DUE' AS reason_code,
      'info' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Course completed ' || ROUND(EXTRACT(EPOCH FROM (now() - p.completed_at)) / 86400)::int || ' days ago. Post-course review due.' AS message,
      p.completed_at AS detected_at
    FROM public.course_participations p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = p.course_session_id
    WHERE p.completion_status = 'completed'
      AND p.completed_at IS NOT NULL
      AND p.completed_at + (v_followup_days || ' days')::interval < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id AND t.title ILIKE '%follow-up%' AND t.status = 'completed'
      )
  ) sub;

  v_needs_attention_count := jsonb_array_length(COALESCE(v_needs_attention_list, '[]'::jsonb));

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'active_sessions_count', v_active_sessions_count,
      'upcoming_sessions_count', v_upcoming_sessions_count,
      'active_students_count', v_active_students_count,
      'unassigned_enrollments_count', v_unassigned_enrollments_count,
      'needs_attention_count', v_needs_attention_count
    ),
    'upcoming_sessions', COALESCE(v_upcoming_sessions, '[]'::jsonb),
    'recently_completed', COALESCE(v_recently_completed, '[]'::jsonb),
    'unassigned_students', COALESCE(v_unassigned_students, '[]'::jsonb),
    'needs_attention', COALESCE(v_needs_attention_list, '[]'::jsonb),
    'settings', jsonb_build_object(
      'readiness_window_days', v_readiness_days,
      'followup_due_days', v_followup_days
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- RPC: get_course_session_detail (Fixed l.phone -> phone_e164/phone_raw)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_course_session_detail(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_course RECORD;
  v_roster JSONB := '[]'::jsonb;
  v_confirmed_count INT := 0;
  v_available_seats INT := NULL;
  v_settings RECORD;
  v_readiness_days INT := 14;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can view session details.';
  END IF;

  SELECT 
    COALESCE(course_readiness_window_days, 14) AS course_readiness_window_days
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;
  v_readiness_days := COALESCE(v_settings.course_readiness_window_days, 14);

  SELECT * INTO v_session
  FROM public.course_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_course
  FROM public.courses
  WHERE id = v_session.course_id;

  SELECT COUNT(*) INTO v_confirmed_count
  FROM public.enrollments
  WHERE course_session_id = p_session_id AND enrollment_status = 'confirmed';

  IF v_session.capacity IS NOT NULL THEN
    v_available_seats := GREATEST(v_session.capacity - v_confirmed_count, 0);
  END IF;

  SELECT jsonb_agg(sub) INTO v_roster
  FROM (
    SELECT
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email AS student_email,
      COALESCE(l.phone_e164, l.phone_raw) AS student_phone,
      e.enrollment_status,
      e.enrollment_date,
      e.agreed_amount,
      e.currency,
      COALESCE(paid_sum.paid_amt, 0.00) AS net_paid,
      GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) AS outstanding_balance,
      CASE
        WHEN GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) = 0 THEN 'paid'
        WHEN COALESCE(paid_sum.paid_amt, 0.00) > 0 THEN 'partial'
        ELSE 'unpaid'
      END AS payment_status_derived,
      COALESCE(p.attendance_status, 'expected') AS attendance_status,
      COALESCE(p.completion_status, 'not_started') AS completion_status,
      COALESCE(p.certificate_issued, false) AS certificate_issued,
      p.completed_at,
      p.id AS participation_id,
      -- Checklist Stats
      COALESCE(chk_stats.total_items, 0) AS checklist_total,
      COALESCE(chk_stats.completed_items, 0) AS checklist_completed,
      COALESCE(chk_stats.pending_items, 0) AS checklist_pending,
      COALESCE(chk_stats.required_pending, 0) AS checklist_required_pending,
      -- Checklist Items Array
      COALESCE(chk_items.items, '[]'::jsonb) AS checklist_items,
      -- Needs Attention Reasons Array
      ARRAY_REMOVE(ARRAY[
        CASE WHEN v_session.status = 'cancelled' THEN 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' ELSE NULL END,
        CASE WHEN GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) > 0 THEN 'PAYMENT_OUTSTANDING' ELSE NULL END,
        CASE WHEN COALESCE(chk_stats.required_pending, 0) > 0 THEN 'MISSING_REQUIRED_ITEM' ELSE NULL END,
        CASE WHEN v_session.start_date <= (CURRENT_DATE + v_readiness_days) AND COALESCE(chk_stats.required_pending, 0) > 0 THEN 'UPCOMING_SESSION_UNREADY' ELSE NULL END,
        CASE WHEN p.attendance_status = 'no_show' THEN 'NO_SHOW' ELSE NULL END
      ], NULL) AS needs_attention_reasons
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    LEFT JOIN (
      SELECT
        enrollment_id,
        count(*) AS total_items,
        count(*) FILTER (WHERE status = 'completed' OR status = 'waived') AS completed_items,
        count(*) FILTER (WHERE status = 'pending') AS pending_items,
        count(*) FILTER (WHERE required = true AND status = 'pending') AS required_pending
      FROM public.student_checklist_items
      GROUP BY enrollment_id
    ) chk_stats ON chk_stats.enrollment_id = e.id
    LEFT JOIN (
      SELECT
        enrollment_id,
        jsonb_agg(jsonb_build_object(
          'id', id,
          'code', code,
          'title', title,
          'category', category,
          'required', required,
          'status', status,
          'due_days_before_session', due_days_before_session,
          'verified_at', verified_at
        ) ORDER BY category, title) AS items
      FROM public.student_checklist_items
      GROUP BY enrollment_id
    ) chk_items ON chk_items.enrollment_id = e.id
    WHERE e.course_session_id = p_session_id AND e.enrollment_status = 'confirmed'
    ORDER BY l.first_name, l.last_name
  ) sub;

  RETURN jsonb_build_object(
    'session', row_to_json(v_session),
    'course', row_to_json(v_course),
    'roster', COALESCE(v_roster, '[]'::jsonb),
    'stats', jsonb_build_object(
      'confirmed_count', v_confirmed_count,
      'available_seats', v_available_seats,
      'capacity', v_session.capacity,
      'readiness_window_days', v_readiness_days
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_operations_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_session_detail(UUID) TO authenticated;
