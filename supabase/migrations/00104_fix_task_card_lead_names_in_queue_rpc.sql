-- =============================================================================
-- Migration 00104: Fix Task Card Lead Names in Daily Operations Queue RPC
-- =============================================================================
-- Fixes lead_name concatenation in get_daily_operations_queue so that:
-- 1. Leads with only first_name (last_name IS NULL) correctly return first_name
--    instead of evaluating to NULL and falling back to email.
-- 2. Leads with duplicated first_name/last_name (e.g., first_name already includes
--    last_name) are deduplicated.
-- 3. Only leads with no usable name fall back to email.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_daily_operations_queue(
  p_tab TEXT DEFAULT 'today',
  p_sub_filter TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
  v_hot_min INT;
  v_stale_days INT;
  v_grace_hours INT;
  v_hot_action_window_hours INT;
  v_items JSONB;
  v_total_count INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  -- Read organization settings
  SELECT
    COALESCE(NULLIF(timezone, ''), 'America/New_York'),
    COALESCE(lead_stale_after_days, 7),
    COALESCE(hot_lead_action_window_hours, 48),
    COALESCE(new_lead_action_grace_hours, 4)
  INTO v_tz, v_stale_days, v_hot_action_window_hours, v_grace_hours
  FROM public.app_settings
  LIMIT 1;

  IF v_tz IS NULL THEN v_tz := 'America/New_York'; END IF;
  IF v_stale_days IS NULL THEN v_stale_days := 7; END IF;
  IF v_hot_action_window_hours IS NULL THEN v_hot_action_window_hours := 48; END IF;
  IF v_grace_hours IS NULL THEN v_grace_hours := 4; END IF;

  -- Organization calendar day boundaries
  v_today_start := (date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz);
  v_today_end := v_today_start + interval '1 day';

  SELECT COALESCE(hot_min, 50) INTO v_hot_min
  FROM public.lead_score_settings
  LIMIT 1;
  IF v_hot_min IS NULL THEN v_hot_min := 50; END IF;

  WITH raw_work_items AS (
    -- 1. Tasks
    SELECT
      'task:' || t.id::text AS item_id,
      CASE
        WHEN t.task_type = 'payment' THEN 'PAYMENT_ATTENTION'
        WHEN t.course_session_id IS NOT NULL OR t.task_type = 'course_ops' THEN 'COURSE_ATTENTION'
        ELSE 'TASK'
      END AS item_type,
      CASE
        WHEN t.status = 'completed' THEN 'completed'
        WHEN t.due_at < v_today_start THEN 'overdue'
        WHEN t.due_at >= v_today_start AND t.due_at < v_today_end THEN 'today'
        WHEN t.due_at >= v_today_end THEN 'future'
        ELSE 'today'
      END AS queue_category,
      t.priority::text AS priority,
      t.title,
      t.description,
      t.due_at,
      (t.status = 'pending' AND t.due_at < v_today_start) AS is_overdue,
      t.created_at AS detected_at,
      t.lead_id,
      COALESCE(
        NULLIF(trim(concat_ws(' ', l.first_name, CASE WHEN l.last_name IS NOT NULL AND l.first_name ILIKE '%' || l.last_name THEN NULL ELSE l.last_name END)), ''),
        l.email,
        'Lead #' || SUBSTRING(l.id::text, 1, 8)
      ) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      NULL::text AS reason_code,
      t.id::text AS context_id,
      'task'::text AS context_type,
      jsonb_build_object(
        'type', 'complete_task',
        'label', 'Complete Task',
        'task_id', t.id,
        'lead_id', t.lead_id
      ) AS primary_action
    FROM public.tasks t
    JOIN public.leads l ON l.id = t.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE l.deleted_at IS NULL
      AND (
        -- TODAY: ONLY tasks whose calendar day = today in business timezone
        (p_tab = 'today' AND t.status = 'pending' AND t.due_at >= v_today_start AND t.due_at < v_today_end)
        -- OVERDUE: ONLY incomplete tasks with due date < today (yesterday, 2 days ago, older)
        OR (p_tab = 'overdue' AND t.status = 'pending' AND t.due_at < v_today_start)
        -- FUTURE: ONLY pending tasks with due date > today (tomorrow, next week, etc.)
        OR (p_tab = 'future' AND t.status = 'pending' AND t.due_at >= v_today_end)
        -- COMPLETED: completed tasks
        OR (p_tab = 'completed' AND t.status = 'completed' AND t.completed_at >= v_today_start AND t.completed_at < v_today_end)
        -- PAYMENTS: payments tasks
        OR (p_tab = 'payments' AND t.task_type = 'payment' AND t.status = 'pending')
        -- COURSES: course operations tasks
        OR (p_tab = 'courses' AND (t.course_session_id IS NOT NULL OR t.task_type = 'course_ops') AND t.status = 'pending')
      )

    UNION ALL

    -- 2. Conversations Needing Reply
    SELECT
      'attention:CONVERSATION_NEEDS_REPLY:conversation:' || c.id::text AS item_id,
      'CONVERSATION_ATTENTION'::text AS item_type,
      'needs_reply'::text AS queue_category,
      'high'::text AS priority,
      'Inbound message awaiting reply: ' || COALESCE(NULLIF(trim(concat_ws(' ', l.first_name, CASE WHEN l.last_name IS NOT NULL AND l.first_name ILIKE '%' || l.last_name THEN NULL ELSE l.last_name END)), ''), l.email) AS title,
      c.last_message_preview AS description,
      c.last_message_at AS due_at,
      false AS is_overdue,
      c.last_message_at AS detected_at,
      c.lead_id,
      COALESCE(
        NULLIF(trim(concat_ws(' ', l.first_name, CASE WHEN l.last_name IS NOT NULL AND l.first_name ILIKE '%' || l.last_name THEN NULL ELSE l.last_name END)), ''),
        l.email,
        'Lead #' || SUBSTRING(l.id::text, 1, 8)
      ) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'CONVERSATION_NEEDS_REPLY'::text AS reason_code,
      c.id::text AS context_id,
      'conversation'::text AS context_type,
      jsonb_build_object(
        'type', 'open_inbox',
        'label', 'Reply in Inbox',
        'href', '/inbox?thread=' || c.id::text
      ) AS primary_action
    FROM public.conversations c
    JOIN public.leads l ON l.id = c.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE l.deleted_at IS NULL
      AND (p_tab = 'needs_reply')
      AND c.status = 'open'
      AND c.last_message_direction = 'inbound'
      AND c.last_message_at > COALESCE(
        (SELECT MAX(om.created_at) FROM public.outbound_messages om WHERE om.conversation_id = c.id AND om.status IN ('sent', 'delivered')),
        '1970-01-01'::timestamptz
      )
  ),
  filtered_items AS (
    SELECT *
    FROM raw_work_items
    WHERE (p_priority IS NULL OR priority = p_priority)
      AND (
        p_search IS NULL OR p_search = '' OR
        title ILIKE '%' || p_search || '%' OR
        lead_name ILIKE '%' || p_search || '%' OR
        lead_email ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', f.item_id,
          'type', f.item_type,
          'category', f.queue_category,
          'priority', f.priority,
          'title', f.title,
          'description', f.description,
          'due_at', f.due_at,
          'is_overdue', f.is_overdue,
          'detected_at', f.detected_at,
          'lead_id', f.lead_id,
          'lead_name', f.lead_name,
          'lead_email', f.lead_email,
          'lead_phone', f.lead_phone,
          'contact_preference', f.contact_preference,
          'lead_score', f.lead_score,
          'pipeline_stage', f.pipeline_stage,
          'reason_code', f.reason_code,
          'context_id', f.context_id,
          'context_type', f.context_type,
          'primary_action', f.primary_action
        )
      ),
      '[]'::jsonb
    ),
    COUNT(*) OVER()
  INTO v_items, v_total_count
  FROM (
    SELECT * FROM filtered_items
    ORDER BY
      -- PART 9 TASK SORTING:
      -- OVERDUE: most recently overdue first (due_at DESC: yesterday, 2 days ago, older)
      CASE WHEN p_tab = 'overdue' THEN due_at END DESC NULLS LAST,
      -- TODAY: earliest due time first (due_at ASC)
      CASE WHEN p_tab = 'today' THEN due_at END ASC NULLS LAST,
      -- FUTURE: nearest due date first (due_at ASC)
      CASE WHEN p_tab = 'future' THEN due_at END ASC NULLS LAST,
      -- Fallbacks for other tabs
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      due_at ASC NULLS LAST,
      detected_at DESC,
      item_id ASC
    LIMIT p_limit
    OFFSET p_offset
  ) f;

  RETURN jsonb_build_object(
    'tab', p_tab,
    'total_count', COALESCE(v_total_count, 0),
    'limit', p_limit,
    'offset', p_offset,
    'items', v_items
  );
END;
$$;
