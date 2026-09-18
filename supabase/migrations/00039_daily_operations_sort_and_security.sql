-- =============================================================================
-- Migration 00039: Phase 5 Block 1 — Daily Operations Final Integrity Hardening
-- =============================================================================
-- 1. Server-side task_source spoof protection in create_crm_task:
--    User/client creation of tasks through create_crm_task strictly forces
--    task_source = 'manual', ignoring any spoofed client parameter.
-- 2. Server-side sort order alignment in get_daily_operations_queue:
--    1. OVERDUE FIRST (is_overdue DESC)
--    2. Priority deterministic order (critical -> high -> normal -> low)
--    3. Earliest due date (due_at ASC NULLS LAST)
--    4. Oldest waiting / created_at (detected_at ASC)
--    5. Deterministic ID tiebreaker (item_id ASC)
-- =============================================================================

-- 1. Update create_crm_task with server-side spoof protection
CREATE OR REPLACE FUNCTION public.create_crm_task(
  p_lead_id UUID,
  p_title TEXT,
  p_task_type TEXT DEFAULT 'general',
  p_due_at TIMESTAMPTZ DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_description TEXT DEFAULT NULL,
  p_task_source TEXT DEFAULT 'manual',
  p_enrollment_id UUID DEFAULT NULL,
  p_course_session_id UUID DEFAULT NULL,
  p_post_course_engagement_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_id UUID;
  v_lead public.leads%ROWTYPE;
BEGIN
  -- Verify caller is active app user
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  -- Validate lead exists
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  -- Idempotency check if key provided
  IF p_idempotency_key IS NOT NULL THEN
    SELECT (metadata->>'task_id')::uuid INTO v_task_id
    FROM public.lead_activities
    WHERE lead_id = p_lead_id
      AND activity_type = 'task_created'
      AND metadata->>'idempotency_key' = p_idempotency_key
    LIMIT 1;

    IF v_task_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'task_id', v_task_id,
        'already_existed', true
      );
    END IF;
  END IF;

  -- Insert task (ALWAYS force task_source = 'manual' for user-created tasks)
  INSERT INTO public.tasks (
    lead_id,
    task_type,
    title,
    description,
    status,
    due_at,
    priority,
    task_source,
    created_by,
    enrollment_id,
    course_session_id,
    post_course_engagement_id
  ) VALUES (
    p_lead_id,
    p_task_type,
    p_title,
    p_description,
    'pending',
    p_due_at,
    COALESCE(p_priority, 'normal'),
    'manual', -- Strictly enforced server-side: manual creation cannot spoof source
    'user',
    p_enrollment_id,
    p_course_session_id,
    p_post_course_engagement_id
  ) RETURNING id INTO v_task_id;

  -- Record audit activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    'task_created',
    'user',
    'Follow-up task created: ' || p_title,
    jsonb_build_object(
      'task_id', v_task_id,
      'title', p_title,
      'task_type', p_task_type,
      'priority', COALESCE(p_priority, 'normal'),
      'task_source', 'manual',
      'due_at', p_due_at,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'task_id', v_task_id,
    'already_existed', false
  );
END;
$$;


-- 2. Update get_daily_operations_queue with oldest waiting sort (detected_at ASC)
CREATE OR REPLACE FUNCTION public.get_daily_operations_queue(
  p_tab TEXT DEFAULT 'today',
  p_sub_filter TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_org_today DATE;
  v_stale_days INTEGER;
  v_hot_window_hours INTEGER;
  v_grace_hours INTEGER;
  v_hot_min INTEGER;
  v_items JSONB;
  v_total_count INTEGER;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  SELECT COALESCE(timezone, 'America/New_York'),
         COALESCE(lead_stale_after_days, 7),
         COALESCE(hot_lead_action_window_hours, 48),
         COALESCE(new_lead_action_grace_hours, 4)
  INTO v_tz, v_stale_days, v_hot_window_hours, v_grace_hours
  FROM public.app_settings
  LIMIT 1;

  v_tz := COALESCE(v_tz, 'America/New_York');
  v_stale_days := COALESCE(v_stale_days, 7);
  v_hot_window_hours := COALESCE(v_hot_window_hours, 48);
  v_grace_hours := COALESCE(v_grace_hours, 4);

  SELECT COALESCE(hot_min, 50) INTO v_hot_min
  FROM public.lead_score_settings
  LIMIT 1;
  v_hot_min := COALESCE(v_hot_min, 50);

  v_org_today := (now() AT TIME ZONE v_tz)::date;

  WITH raw_work_items AS (
    -- TAB: today (Due Today)
    SELECT
      'task:' || t.id::text AS item_id,
      'TASK' AS item_type,
      'today' AS queue_category,
      t.priority AS priority,
      t.title AS title,
      t.description AS description,
      t.due_at AS due_at,
      (t.due_at < now()) AS is_overdue,
      t.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      NULL AS reason_code,
      t.id::text AS context_id,
      'task' AS context_type,
      jsonb_build_object(
        'type', 'complete_task',
        'label', 'Complete Task',
        'task_id', t.id
      ) AS primary_action
    FROM public.tasks t
    LEFT JOIN public.leads l ON l.id = t.lead_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE p_tab = 'today'
      AND t.status = 'pending'
      AND t.due_at IS NOT NULL
      AND (t.due_at AT TIME ZONE v_tz)::date = v_org_today

    UNION ALL

    -- TAB: overdue (Open tasks past due date)
    SELECT
      'task:' || t.id::text AS item_id,
      'TASK' AS item_type,
      'overdue' AS queue_category,
      t.priority AS priority,
      t.title AS title,
      t.description AS description,
      t.due_at AS due_at,
      TRUE AS is_overdue,
      t.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      NULL AS reason_code,
      t.id::text AS context_id,
      'task' AS context_type,
      jsonb_build_object(
        'type', 'complete_task',
        'label', 'Complete Task',
        'task_id', t.id
      ) AS primary_action
    FROM public.tasks t
    LEFT JOIN public.leads l ON l.id = t.lead_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE p_tab = 'overdue'
      AND t.status = 'pending'
      AND t.due_at IS NOT NULL
      AND t.due_at < now()

    UNION ALL

    -- TAB: needs_reply (Unreplied inbound conversations)
    SELECT
      'attention:CONVERSATION_NEEDS_REPLY:conversation:' || c.id::text AS item_id,
      'CONVERSATION_ATTENTION' AS item_type,
      'needs_reply' AS queue_category,
      'high' AS priority,
      'Conversation awaiting reply' AS title,
      'Lead sent message with no outbound response yet' AS description,
      c.last_message_at AS due_at,
      FALSE AS is_overdue,
      c.last_message_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      'CONVERSATION_NEEDS_REPLY' AS reason_code,
      c.id::text AS context_id,
      'conversation' AS context_type,
      jsonb_build_object(
        'type', 'open_inbox',
        'label', 'Open Conversation',
        'href', '/conversations?id=' || c.id::text
      ) AS primary_action
    FROM public.conversations c
    JOIN public.leads l ON l.id = c.lead_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE p_tab = 'needs_reply'
      AND c.status = 'open'
      AND c.unread_count > 0

    UNION ALL

    -- TAB: hot_leads (Dynamic canonical hot threshold)
    SELECT
      'attention:HOT_LEAD_NO_ACTION:lead:' || l.id::text AS item_id,
      'LEAD_ATTENTION' AS item_type,
      'hot_leads' AS queue_category,
      'high' AS priority,
      'Hot Lead requiring immediate commercial touchpoint' AS title,
      'Lead score is >= ' || v_hot_min || ' with no active upcoming task' AS description,
      NULL AS due_at,
      FALSE AS is_overdue,
      l.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      'HOT_LEAD_NO_ACTION' AS reason_code,
      l.id::text AS context_id,
      'lead' AS context_type,
      jsonb_build_object(
        'type', 'open_lead',
        'label', 'Open Lead',
        'lead_id', l.id,
        'href', '/leads/' || l.id::text
      ) AS primary_action
    FROM public.leads l
    JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    JOIN public.lead_scores s ON s.lead_id = l.id
    WHERE p_tab = 'hot_leads'
      AND ps.code IN ('capture', 'qualification', 'acquisition', 'approval')
      AND s.score >= v_hot_min
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id
          AND t.status = 'pending'
          AND (t.due_at IS NULL OR t.due_at >= now())
      )

    UNION ALL

    -- TAB: no_action (Actionable stages with no next action beyond grace window)
    SELECT
      'attention:LEAD_NO_NEXT_ACTION:lead:' || l.id::text AS item_id,
      'LEAD_ATTENTION' AS item_type,
      'no_action' AS queue_category,
      'normal' AS priority,
      'Lead in actionable stage without next scheduled action' AS title,
      'No pending tasks assigned to advance pipeline' AS description,
      NULL AS due_at,
      FALSE AS is_overdue,
      l.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      'LEAD_NO_NEXT_ACTION' AS reason_code,
      l.id::text AS context_id,
      'lead' AS context_type,
      jsonb_build_object(
        'type', 'create_task',
        'label', 'Schedule Action',
        'lead_id', l.id
      ) AS primary_action
    FROM public.leads l
    JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    WHERE p_tab = 'no_action'
      AND ps.code IN ('capture', 'qualification', 'acquisition', 'approval')
      AND (
        ps.code != 'capture' OR
        l.created_at < now() - (v_grace_hours || ' hours')::interval
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id AND t.status = 'pending'
      )

    UNION ALL

    -- TAB: stale_leads (Meaningful commercial inactivity)
    SELECT
      'attention:STALE_LEAD:lead:' || l.id::text AS item_id,
      'LEAD_ATTENTION' AS item_type,
      'stale_leads' AS queue_category,
      'normal' AS priority,
      'Stale Lead: Inactive for more than ' || v_stale_days || ' days' AS title,
      'No meaningful commercial activity logged recently' AS description,
      NULL AS due_at,
      FALSE AS is_overdue,
      l.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      'STALE_LEAD' AS reason_code,
      l.id::text AS context_id,
      'lead' AS context_type,
      jsonb_build_object(
        'type', 'open_lead',
        'label', 'Review Lead',
        'lead_id', l.id,
        'href', '/leads/' || l.id::text
      ) AS primary_action
    FROM public.leads l
    JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    WHERE p_tab = 'stale_leads'
      AND ps.code IN ('capture', 'qualification', 'acquisition', 'approval')
      AND public.get_lead_last_meaningful_activity_at(l.id) < now() - (v_stale_days || ' days')::interval

    UNION ALL

    -- TAB: courses (Block 4 Course Operations Needs Attention)
    SELECT
      'attention:' || na.reason_code || ':session:' || cs.id::text AS item_id,
      'COURSE_ATTENTION' AS item_type,
      'courses' AS queue_category,
      CASE
        WHEN na.reason_code = 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' THEN 'critical'
        WHEN na.reason_code = 'NO_SHOW' THEN 'critical'
        WHEN na.reason_code = 'UPCOMING_SESSION_UNREADY' THEN 'critical'
        ELSE 'high'
      END AS priority,
      'Course Operational Attention: ' || replace(na.reason_code, '_', ' ') AS title,
      na.description AS description,
      cs.start_date::timestamptz AS due_at,
      (cs.start_date <= current_date) AS is_overdue,
      na.detected_at AS detected_at,
      NULL AS lead_id,
      NULL AS lead_name,
      NULL AS lead_email,
      NULL AS lead_phone,
      NULL AS contact_preference,
      NULL AS lead_score,
      NULL AS pipeline_stage,
      na.reason_code AS reason_code,
      cs.id::text AS context_id,
      'session' AS context_type,
      jsonb_build_object(
        'type', 'open_session',
        'label', 'View Session',
        'session_id', cs.id,
        'href', '/courses/sessions/' || cs.id::text
      ) AS primary_action
    FROM public.course_sessions cs
    CROSS JOIN LATERAL (
      SELECT 'UPCOMING_SESSION_UNREADY' AS reason_code,
             'Session starts soon and checklist requirements remain unfulfilled' AS description,
             cs.created_at AS detected_at
      WHERE cs.status = 'confirmed' AND cs.start_date BETWEEN current_date AND current_date + INTERVAL '3 days'
      UNION ALL
      SELECT 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' AS reason_code,
             'Session was cancelled and students need reassignment' AS description,
             cs.updated_at AS detected_at
      WHERE cs.status = 'cancelled'
    ) na
    WHERE p_tab = 'courses'

    UNION ALL

    -- TAB: payments (Canonical Block 3 Financial Attention)
    SELECT
      'attention:PAYMENT_OUTSTANDING:enrollment:' || e.id::text AS item_id,
      'PAYMENT_ATTENTION' AS item_type,
      'payments' AS queue_category,
      CASE
        WHEN cs.start_date IS NOT NULL AND cs.start_date <= current_date + INTERVAL '7 days' THEN 'high'
        ELSE 'normal'
      END AS priority,
      'Outstanding Course Balance ($' || to_char(e.final_price - e.amount_paid, 'FM999,999.00') || ')' AS title,
      'Confirmed enrollment has remaining balance' AS description,
      NULL AS due_at,
      FALSE AS is_overdue,
      e.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      'PAYMENT_OUTSTANDING' AS reason_code,
      e.id::text AS context_id,
      'enrollment' AS context_type,
      jsonb_build_object(
        'type', 'open_enrollment',
        'label', 'View Enrollment',
        'enrollment_id', e.id
      ) AS primary_action
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    LEFT JOIN public.course_sessions cs ON cs.id = e.course_session_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE p_tab = 'payments'
      AND e.enrollment_status = 'confirmed'
      AND (e.final_price - e.amount_paid) > 0

    UNION ALL

    -- TAB: post_course (Block 5 Post-Course Alumni Attention)
    SELECT
      'attention:POST_COURSE_FOLLOWUP_OVERDUE:engagement:' || pce.id::text AS item_id,
      'POST_COURSE_ATTENTION' AS item_type,
      'post_course' AS queue_category,
      'high' AS priority,
      'Post-Course Follow-Up Overdue' AS title,
      'Alumnus follow-up date has passed without logged completion' AS description,
      pce.followup_due_at AS due_at,
      TRUE AS is_overdue,
      pce.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      'POST_COURSE_FOLLOWUP_OVERDUE' AS reason_code,
      pce.id::text AS context_id,
      'post_course' AS context_type,
      jsonb_build_object(
        'type', 'open_engagement',
        'label', 'View Engagement',
        'engagement_id', pce.id
      ) AS primary_action
    FROM public.post_course_engagements pce
    JOIN public.leads l ON l.id = pce.lead_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE p_tab = 'post_course'
      AND pce.followup_status = 'pending'
      AND pce.followup_due_at IS NOT NULL
      AND pce.followup_due_at < now()

    UNION ALL

    -- TAB: completed (Completed Today)
    SELECT
      'task:' || t.id::text AS item_id,
      'TASK' AS item_type,
      'completed' AS queue_category,
      t.priority AS priority,
      t.title AS title,
      t.description AS description,
      t.due_at AS due_at,
      FALSE AS is_overdue,
      t.completed_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, l.last_name, l.email, 'Unknown Lead') AS lead_name,
      l.email AS lead_email,
      l.phone_raw AS lead_phone,
      l.contact_preference AS contact_preference,
      COALESCE(s.score, 0) AS lead_score,
      ps.name AS pipeline_stage,
      NULL AS reason_code,
      t.id::text AS context_id,
      'task' AS context_type,
      jsonb_build_object(
        'type', 'open_lead',
        'label', 'View Lead',
        'lead_id', l.id,
        'href', '/leads/' || l.id::text
      ) AS primary_action
    FROM public.tasks t
    LEFT JOIN public.leads l ON l.id = t.lead_id
    LEFT JOIN public.lead_scores s ON s.lead_id = l.id
    LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
    WHERE p_tab = 'completed'
      AND t.status = 'completed'
      AND t.completed_at IS NOT NULL
      AND (t.completed_at AT TIME ZONE v_tz)::date = v_org_today
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
      -- 1. OVERDUE FIRST
      is_overdue DESC,
      -- 2. Priority deterministic order
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      -- 3. Earliest due date
      due_at ASC NULLS LAST,
      -- 4. Oldest waiting / created_at
      detected_at ASC,
      -- 5. Deterministic ID tiebreaker
      item_id ASC
    LIMIT p_limit
    OFFSET p_offset
  ) f;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'total_count', COALESCE(v_total_count, 0),
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;
