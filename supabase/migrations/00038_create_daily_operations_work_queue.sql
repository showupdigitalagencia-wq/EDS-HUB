-- =============================================================================
-- Migration 00038: Phase 5 Block 1 — Tasks, Work Queues & Daily Operations
-- =============================================================================
-- 1. Extend app_settings with stale, grace, and hot window thresholds
-- 2. Extend tasks with priority, task_source, and context foreign keys
-- 3. Extend lead_activities with task operation activity types
-- 4. Create performance indexes for work queues
-- 5. Helper function: get_lead_last_meaningful_activity_at
-- 6. Operational Task RPCs: create_crm_task, reschedule_crm_task, complete_crm_task
-- 7. Dashboard Aggregator RPC: get_daily_operations_dashboard
-- 8. Paginated Work Queue RPC: get_daily_operations_queue
-- 9. Security & RLS configuration
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. App Settings Extensions
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS lead_stale_after_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS hot_lead_action_window_hours INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS new_lead_action_grace_hours INTEGER NOT NULL DEFAULT 4;

-- Set default timezone if null
UPDATE public.app_settings
SET timezone = 'America/New_York'
WHERE timezone IS NULL OR timezone = '';


-- -----------------------------------------------------------------------------
-- 2. Tasks Table Extensions
-- -----------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS task_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS enrollment_id UUID NULL REFERENCES public.enrollments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_session_id UUID NULL REFERENCES public.course_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_course_engagement_id UUID NULL REFERENCES public.post_course_engagements(id) ON DELETE SET NULL;

-- Priority check constraint
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_priority_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'critical'));

-- Task source check constraint
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_source_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_source_check
  CHECK (task_source IN ('manual', 'automation', 'system', 'course_operations', 'post_course'));

-- Expand task_type check constraint
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('call', 'data_review', 'general', 'follow_up'));


-- -----------------------------------------------------------------------------
-- 3. Lead Activities Constraint Extension
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'lead_created'::text, 'intake_received'::text, 'email_dispatched'::text, 
    'sms_dispatched'::text, 'call_task_created'::text, 'stage_changed'::text, 
    'processing_failed'::text, 'note_created'::text, 'tag_added'::text, 
    'tag_removed'::text, 'campaign_sent'::text, 'contact_preference_detected'::text, 
    'email_selected'::text, 'sms_selected'::text, 'call_selected'::text, 
    'channel_skipped'::text, 'csv_status_unmapped'::text, 'qualification_status_changed'::text,
    'form_submitted'::text, 'automation_started'::text, 'automation_completed'::text,
    'automation_failed'::text,
    'sequence_started'::text, 'sequence_completed'::text, 'sequence_failed'::text, 'sequence_stopped'::text,
    'email_reply_received'::text, 'sms_reply_received'::text,
    'enrollment_created'::text, 'enrollment_confirmed'::text,
    'course_session_assigned'::text, 'course_session_changed'::text,
    'attendance_recorded'::text, 'course_completed'::text,
    'student_no_show'::text, 'checklist_item_updated'::text,
    'post_course_followup_created'::text,
    'post_course_followup_completed'::text,
    'feedback_requested'::text,
    'feedback_received'::text,
    'testimonial_requested'::text,
    'testimonial_received'::text,
    'future_course_interest_added'::text,
    -- Block 1 Task Operational Activities:
    'task_created'::text,
    'task_rescheduled'::text,
    'task_completed'::text
  ]));


-- -----------------------------------------------------------------------------
-- 4. Indexes for Daily Operations & Work Queues
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_status_due_at_priority
  ON public.tasks(status, due_at ASC, priority);

CREATE INDEX IF NOT EXISTS idx_tasks_lead_status
  ON public.tasks(lead_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_completed_at
  ON public.tasks(completed_at)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_tasks_enrollment_id
  ON public.tasks(enrollment_id)
  WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_course_session_id
  ON public.tasks(course_session_id)
  WHERE course_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_post_course_engagement_id
  ON public.tasks(post_course_engagement_id)
  WHERE post_course_engagement_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. Helper Function: Get Meaningful Commercial Activity Timestamp for Lead
-- Whitelist: emails, sms, replies, call task, stage change, qualification change, notes, forms, enrollments, post-course completed
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lead_last_meaningful_activity_at(p_lead_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    (SELECT created_at FROM public.leads WHERE id = p_lead_id),
    COALESCE(
      (
        SELECT MAX(created_at)
        FROM public.lead_activities
        WHERE lead_id = p_lead_id
          AND activity_type IN (
            'email_dispatched', 'sms_dispatched', 'email_reply_received', 'sms_reply_received',
            'call_task_created', 'stage_changed', 'qualification_status_changed',
            'note_created', 'intake_received', 'form_submitted',
            'enrollment_created', 'enrollment_confirmed',
            'post_course_followup_completed', 'future_course_interest_added',
            'task_created', 'task_completed'
          )
      ),
      '1970-01-01'::timestamptz
    ),
    COALESCE(
      (
        SELECT MAX(completed_at)
        FROM public.tasks
        WHERE lead_id = p_lead_id AND status = 'completed'
      ),
      '1970-01-01'::timestamptz
    )
  );
$$;


-- -----------------------------------------------------------------------------
-- 6. Task Operations RPCs
-- -----------------------------------------------------------------------------

-- 6.1 Create CRM Task
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

  -- Insert task
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
    COALESCE(p_task_source, 'manual'),
    'user',
    p_enrollment_id,
    p_course_session_id,
    p_post_course_engagement_id
  ) RETURNING id INTO v_task_id;

  -- Audit log activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    actor_id,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    'task_created',
    'user',
    auth.uid(),
    'Task created: ' || p_title,
    jsonb_build_object(
      'task_id', v_task_id,
      'task_type', p_task_type,
      'priority', p_priority,
      'due_at', p_due_at,
      'task_source', p_task_source,
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


-- 6.2 Reschedule CRM Task
CREATE OR REPLACE FUNCTION public.reschedule_crm_task(
  p_task_id UUID,
  p_new_due_at TIMESTAMPTZ,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_old_due_at TIMESTAMPTZ;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  v_old_due_at := v_task.due_at;

  UPDATE public.tasks
  SET
    due_at = p_new_due_at,
    updated_at = now()
  WHERE id = p_task_id;

  -- Audit log activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    actor_id,
    summary,
    metadata
  ) VALUES (
    v_task.lead_id,
    'task_rescheduled',
    'user',
    auth.uid(),
    'Task rescheduled: "' || v_task.title || '" to ' || COALESCE(p_new_due_at::text, 'no due date'),
    jsonb_build_object(
      'task_id', p_task_id,
      'old_due_at', v_old_due_at,
      'new_due_at', p_new_due_at,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'old_due_at', v_old_due_at,
    'new_due_at', p_new_due_at
  );
END;
$$;


-- 6.3 Complete CRM Task (Idempotent)
CREATE OR REPLACE FUNCTION public.complete_crm_task(
  p_task_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- If already completed, return idempotent response
  IF v_task.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'already_completed', true
    );
  END IF;

  UPDATE public.tasks
  SET
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  WHERE id = p_task_id;

  -- Audit log activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    actor_id,
    summary,
    metadata
  ) VALUES (
    v_task.lead_id,
    'task_completed',
    'user',
    auth.uid(),
    'Task completed: ' || v_task.title,
    jsonb_build_object(
      'task_id', p_task_id,
      'notes', p_notes,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'already_completed', false
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. Daily Operations Dashboard Aggregator RPC (KPIs & Metrics)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_daily_operations_dashboard()
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

  v_due_today_count INT := 0;
  v_overdue_count INT := 0;
  v_needs_reply_count INT := 0;
  v_hot_leads_count INT := 0;
  v_leads_no_next_action_count INT := 0;
  v_stale_leads_count INT := 0;
  v_course_attention_count INT := 0;
  v_payment_attention_count INT := 0;
  v_post_course_attention_count INT := 0;
  v_completed_today_count INT := 0;
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

  -- Canonical Hot Lead Threshold from lead_score_settings (NO hardcoding 50)
  SELECT COALESCE(hot_min, 50) INTO v_hot_min
  FROM public.lead_score_settings
  LIMIT 1;
  IF v_hot_min IS NULL THEN v_hot_min := 50; END IF;

  -- 1. Tasks Due Today
  SELECT count(*) INTO v_due_today_count
  FROM public.tasks
  WHERE status = 'pending'
    AND due_at >= v_today_start
    AND due_at < v_today_end;

  -- 2. Overdue Tasks
  SELECT count(*) INTO v_overdue_count
  FROM public.tasks
  WHERE status = 'pending'
    AND due_at < now();

  -- 3. Completed Today (Uses completed_at, NOT updated_at)
  SELECT count(*) INTO v_completed_today_count
  FROM public.tasks
  WHERE status = 'completed'
    AND completed_at >= v_today_start
    AND completed_at < v_today_end;

  -- 4. Conversations Needing Reply
  SELECT count(*) INTO v_needs_reply_count
  FROM public.conversations c
  WHERE c.status = 'open'
    AND c.last_message_direction = 'inbound'
    AND c.last_message_at > COALESCE(
      (SELECT MAX(om.created_at) FROM public.outbound_messages om WHERE om.conversation_id = c.id AND om.status IN ('sent', 'delivered')),
      '1970-01-01'::timestamptz
    );

  -- 5. Hot Leads Needing Action (Uses canonical v_hot_min)
  SELECT count(*) INTO v_hot_leads_count
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE s.code IN ('capture', 'qualification', 'acquisition', 'approval')
    AND l.lead_score >= v_hot_min
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id
          AND t.status = 'pending'
          AND t.due_at >= now()
      )
      OR public.get_lead_last_meaningful_activity_at(l.id) < now() - (v_hot_action_window_hours || ' hours')::interval
    );

  -- 6. Leads Without Next Action (Commercial stages, no pending task, outside grace window)
  SELECT count(*) INTO v_leads_no_next_action_count
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE s.code IN ('capture', 'qualification', 'acquisition', 'approval')
    AND (s.code <> 'capture' OR l.created_at + (v_grace_hours || ' hours')::interval <= now())
    AND NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.lead_id = l.id AND t.status = 'pending'
    );

  -- 7. Stale Leads (No meaningful commercial activity for >= stale_days)
  SELECT count(*) INTO v_stale_leads_count
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE s.code IN ('capture', 'qualification', 'acquisition', 'approval')
    AND (s.code <> 'capture' OR l.created_at + (v_grace_hours || ' hours')::interval <= now())
    AND public.get_lead_last_meaningful_activity_at(l.id) < now() - (v_stale_days || ' days')::interval;

  -- 8. Course Operations Attention (Block 4 canonical rules)
  SELECT count(*) INTO v_course_attention_count
  FROM (
    SELECT e.id FROM public.enrollments e
    WHERE e.enrollment_status = 'confirmed' AND e.course_session_id IS NULL
    UNION ALL
    SELECT e.id FROM public.enrollments e
    JOIN public.course_sessions cs ON cs.id = e.course_session_id
    WHERE e.enrollment_status = 'confirmed' AND cs.status = 'cancelled'
    UNION ALL
    SELECT e.id FROM public.enrollments e
    JOIN public.course_sessions cs ON cs.id = e.course_session_id
    WHERE e.enrollment_status = 'confirmed'
      AND cs.status IN ('open', 'confirmed')
      AND cs.start_date <= (CURRENT_DATE + 7)
      AND cs.start_date >= CURRENT_DATE
      AND EXISTS (
        SELECT 1 FROM public.student_checklist_items ci
        WHERE ci.enrollment_id = e.id AND ci.required = true AND ci.status = 'pending'
      )
    UNION ALL
    SELECT p.id FROM public.course_participations p
    WHERE p.attendance_status = 'no_show'
  ) course_att;

  -- 9. Payment Attention (Canonical outstanding balance > 0 on confirmed enrollments)
  SELECT count(*) INTO v_payment_attention_count
  FROM (
    SELECT e.id
    FROM public.enrollments e
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    WHERE e.enrollment_status = 'confirmed'
      AND (e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00)) > 0
  ) pay_att;

  -- 10. Post-Course Attention (Block 5 canonical rules)
  SELECT count(*) INTO v_post_course_attention_count
  FROM (
    SELECT id FROM public.post_course_engagements
    WHERE followup_status = 'pending' AND followup_due_at < now()
    UNION ALL
    SELECT id FROM public.post_course_engagements
    WHERE feedback_status = 'requested'
      AND feedback_requested_at + interval '7 days' < now()
    UNION ALL
    SELECT id FROM public.post_course_engagements
    WHERE feedback_status = 'received' AND testimonial_status = 'not_requested'
    UNION ALL
    SELECT i.id FROM public.lead_course_interests i
    WHERE i.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.lead_id = i.lead_id AND e.course_id = i.course_id AND e.enrollment_status = 'confirmed'
      )
  ) post_att;

  RETURN jsonb_build_object(
    'timezone', v_tz,
    'hot_min_threshold', v_hot_min,
    'stale_after_days', v_stale_days,
    'due_today_count', COALESCE(v_due_today_count, 0),
    'overdue_count', COALESCE(v_overdue_count, 0),
    'completed_today_count', COALESCE(v_completed_today_count, 0),
    'needs_reply_count', COALESCE(v_needs_reply_count, 0),
    'hot_leads_count', COALESCE(v_hot_leads_count, 0),
    'leads_no_next_action_count', COALESCE(v_leads_no_next_action_count, 0),
    'stale_leads_count', COALESCE(v_stale_leads_count, 0),
    'course_attention_count', COALESCE(v_course_attention_count, 0),
    'payment_attention_count', COALESCE(v_payment_attention_count, 0),
    'post_course_attention_count', COALESCE(v_post_course_attention_count, 0),
    'total_actionable_items', COALESCE(
      v_due_today_count + v_overdue_count + v_needs_reply_count + v_hot_leads_count +
      v_course_attention_count + v_payment_attention_count + v_post_course_attention_count,
      0
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. Paginated Work Queue RPC: get_daily_operations_queue
-- Returns strictly enriched, non-duplicated, sorted work items with stable IDs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_daily_operations_queue(
  p_tab TEXT DEFAULT 'today',        -- 'today', 'overdue', 'needs_reply', 'leads', 'courses', 'payments', 'post_course', 'completed'
  p_sub_filter TEXT DEFAULT NULL,    -- for leads: 'hot', 'no_action', 'stale'
  p_priority TEXT DEFAULT NULL,      -- 'critical', 'high', 'normal', 'low'
  p_search TEXT DEFAULT NULL,        -- text search over student name / title
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

  v_items JSONB := '[]'::jsonb;
  v_total_count INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Active app user required';
  END IF;

  -- Settings
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

  v_today_start := (date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz);
  v_today_end := v_today_start + interval '1 day';

  SELECT COALESCE(hot_min, 50) INTO v_hot_min
  FROM public.lead_score_settings
  LIMIT 1;
  IF v_hot_min IS NULL THEN v_hot_min := 50; END IF;

  -- Build Unified Filtered CTE
  WITH raw_work_items AS (
    -- 1. Explicit Tasks
    SELECT
      'task:' || t.id::text AS item_id,
      'TASK'::text AS item_type,
      CASE
        WHEN t.status = 'completed' THEN 'completed'
        WHEN t.status = 'pending' AND t.due_at < now() THEN 'overdue'
        WHEN t.status = 'pending' AND t.due_at >= v_today_start AND t.due_at < v_today_end THEN 'today'
        ELSE 'upcoming'
      END AS queue_category,
      t.priority::text AS priority,
      t.title,
      t.description,
      t.due_at,
      (t.status = 'pending' AND t.due_at < now()) AS is_overdue,
      t.created_at AS detected_at,
      t.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
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
    WHERE
      (p_tab = 'today' AND t.status = 'pending' AND (
        (t.due_at >= v_today_start AND t.due_at < v_today_end) OR (t.due_at < now())
      ))
      OR (p_tab = 'overdue' AND t.status = 'pending' AND t.due_at < now())
      OR (p_tab = 'completed' AND t.status = 'completed' AND t.completed_at >= v_today_start AND t.completed_at < v_today_end)

    UNION ALL

    -- 2. Conversations Needing Reply
    SELECT
      'attention:CONVERSATION_NEEDS_REPLY:conversation:' || c.id::text AS item_id,
      'CONVERSATION_ATTENTION'::text AS item_type,
      'needs_reply'::text AS queue_category,
      'high'::text AS priority,
      'Inbound message awaiting reply: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      c.last_message_preview AS description,
      c.last_message_at AS due_at,
      false AS is_overdue,
      c.last_message_at AS detected_at,
      c.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
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
    WHERE (p_tab = 'today' OR p_tab = 'needs_reply')
      AND c.status = 'open'
      AND c.last_message_direction = 'inbound'
      AND c.last_message_at > COALESCE(
        (SELECT MAX(om.created_at) FROM public.outbound_messages om WHERE om.conversation_id = c.id AND om.status IN ('sent', 'delivered')),
        '1970-01-01'::timestamptz
      )

    UNION ALL

    -- 3. Hot Leads Needing Action (Canonical hot_min threshold)
    SELECT
      'attention:HOT_LEAD_NO_ACTION:lead:' || l.id::text AS item_id,
      'LEAD_ATTENTION'::text AS item_type,
      'hot_leads'::text AS queue_category,
      'high'::text AS priority,
      'Hot Lead Needing Action: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Lead score is ' || l.lead_score || ' in stage ' || s.name || '. No upcoming task or action in ' || v_hot_action_window_hours || 'h.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      public.get_lead_last_meaningful_activity_at(l.id) AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'HOT_LEAD_NO_ACTION'::text AS reason_code,
      l.id::text AS context_id,
      'lead'::text AS context_type,
      jsonb_build_object(
        'type', 'create_task',
        'label', 'Schedule Action',
        'lead_id', l.id,
        'href', '/leads/' || l.id::text
      ) AS primary_action
    FROM public.leads l
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE (p_tab = 'today' OR p_tab = 'leads')
      AND (p_sub_filter IS NULL OR p_sub_filter = 'hot')
      AND s.code IN ('capture', 'qualification', 'acquisition', 'approval')
      AND l.lead_score >= v_hot_min
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.lead_id = l.id AND t.status = 'pending' AND t.due_at >= now()
        )
        OR public.get_lead_last_meaningful_activity_at(l.id) < now() - (v_hot_action_window_hours || ' hours')::interval
      )

    UNION ALL

    -- 4. Leads Without Next Action
    SELECT
      'attention:LEAD_NO_NEXT_ACTION:lead:' || l.id::text AS item_id,
      'LEAD_ATTENTION'::text AS item_type,
      'no_action'::text AS queue_category,
      'normal'::text AS priority,
      'No Scheduled Action: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Lead in ' || s.name || ' stage has no pending tasks scheduled.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      l.created_at AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'LEAD_NO_NEXT_ACTION'::text AS reason_code,
      l.id::text AS context_id,
      'lead'::text AS context_type,
      jsonb_build_object(
        'type', 'create_task',
        'label', 'Create Task',
        'lead_id', l.id,
        'href', '/leads/' || l.id::text
      ) AS primary_action
    FROM public.leads l
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE p_tab = 'leads'
      AND (p_sub_filter IS NULL OR p_sub_filter = 'no_action')
      AND s.code IN ('capture', 'qualification', 'acquisition', 'approval')
      AND (s.code <> 'capture' OR l.created_at + (v_grace_hours || ' hours')::interval <= now())
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id AND t.status = 'pending'
      )

    UNION ALL

    -- 5. Stale Leads
    SELECT
      'attention:STALE_LEAD:lead:' || l.id::text AS item_id,
      'LEAD_ATTENTION'::text AS item_type,
      'stale_leads'::text AS queue_category,
      'normal'::text AS priority,
      'Stale Lead (No activity for ' || ROUND(EXTRACT(EPOCH FROM (now() - public.get_lead_last_meaningful_activity_at(l.id))) / 86400)::int || ' days): ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Last commercial interaction was on ' || public.get_lead_last_meaningful_activity_at(l.id)::date::text || '.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      public.get_lead_last_meaningful_activity_at(l.id) AS detected_at,
      l.id AS lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'STALE_LEAD'::text AS reason_code,
      l.id::text AS context_id,
      'lead'::text AS context_type,
      jsonb_build_object(
        'type', 'create_task',
        'label', 'Re-engage Lead',
        'lead_id', l.id,
        'href', '/leads/' || l.id::text
      ) AS primary_action
    FROM public.leads l
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE p_tab = 'leads'
      AND (p_sub_filter IS NULL OR p_sub_filter = 'stale')
      AND s.code IN ('capture', 'qualification', 'acquisition', 'approval')
      AND (s.code <> 'capture' OR l.created_at + (v_grace_hours || ' hours')::interval <= now())
      AND public.get_lead_last_meaningful_activity_at(l.id) < now() - (v_stale_days || ' days')::interval

    UNION ALL

    -- 6. Course Attention (Block 4 Canonical Reason Codes)
    -- A) ENROLLMENT_WITHOUT_SESSION
    SELECT
      'attention:ENROLLMENT_WITHOUT_SESSION:enrollment:' || e.id::text AS item_id,
      'COURSE_ATTENTION'::text AS item_type,
      'courses'::text AS queue_category,
      'critical'::text AS priority,
      'Confirmed Enrollment Missing Session: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Course: ' || e.course_name_snapshot || '. Confirmed student has no course session assigned.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      e.created_at AS detected_at,
      e.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'ENROLLMENT_WITHOUT_SESSION'::text AS reason_code,
      e.id::text AS context_id,
      'enrollment'::text AS context_type,
      jsonb_build_object(
        'type', 'open_session',
        'label', 'Assign Session',
        'enrollment_id', e.id,
        'href', '/courses/operations'
      ) AS primary_action
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE (p_tab = 'today' OR p_tab = 'courses')
      AND e.enrollment_status = 'confirmed' AND e.course_session_id IS NULL

    UNION ALL

    -- B) SESSION_CANCELLED_REASSIGNMENT_REQUIRED
    SELECT
      'attention:SESSION_CANCELLED_REASSIGNMENT_REQUIRED:enrollment:' || e.id::text AS item_id,
      'COURSE_ATTENTION'::text AS item_type,
      'courses'::text AS queue_category,
      'critical'::text AS priority,
      'Session Cancelled — Student Reassignment Needed: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Assigned session ' || cs.code || ' was cancelled. Student requires immediate reassignment.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      cs.updated_at AS detected_at,
      e.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'SESSION_CANCELLED_REASSIGNMENT_REQUIRED'::text AS reason_code,
      e.id::text AS context_id,
      'enrollment'::text AS context_type,
      jsonb_build_object(
        'type', 'open_session',
        'label', 'Reassign Session',
        'enrollment_id', e.id,
        'href', '/courses/operations'
      ) AS primary_action
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    JOIN public.course_sessions cs ON cs.id = e.course_session_id
    WHERE (p_tab = 'today' OR p_tab = 'courses')
      AND e.enrollment_status = 'confirmed' AND cs.status = 'cancelled'

    UNION ALL

    -- C) UPCOMING_SESSION_UNREADY
    SELECT
      'attention:UPCOMING_SESSION_UNREADY:enrollment:' || e.id::text AS item_id,
      'COURSE_ATTENTION'::text AS item_type,
      'courses'::text AS queue_category,
      CASE WHEN cs.start_date - CURRENT_DATE <= 3 THEN 'critical' ELSE 'high' END AS priority,
      'Unready Student for Imminent Session: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Session ' || cs.code || ' starts in ' || (cs.start_date - CURRENT_DATE) || ' days but student has pending required checklist items.' AS description,
      cs.start_date::timestamptz AS due_at,
      false AS is_overdue,
      cs.start_date::timestamptz AS detected_at,
      e.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'UPCOMING_SESSION_UNREADY'::text AS reason_code,
      cs.id::text AS context_id,
      'session'::text AS context_type,
      jsonb_build_object(
        'type', 'open_session',
        'label', 'View Session Roster',
        'session_id', cs.id,
        'href', '/courses/sessions/' || cs.id::text
      ) AS primary_action
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    JOIN public.course_sessions cs ON cs.id = e.course_session_id
    WHERE (p_tab = 'today' OR p_tab = 'courses')
      AND e.enrollment_status = 'confirmed'
      AND cs.status IN ('open', 'confirmed')
      AND cs.start_date <= (CURRENT_DATE + 7)
      AND cs.start_date >= CURRENT_DATE
      AND EXISTS (
        SELECT 1 FROM public.student_checklist_items ci
        WHERE ci.enrollment_id = e.id AND ci.required = true AND ci.status = 'pending'
      )

    UNION ALL

    -- D) NO_SHOW
    SELECT
      'attention:NO_SHOW:participation:' || p.id::text AS item_id,
      'COURSE_ATTENTION'::text AS item_type,
      'courses'::text AS queue_category,
      'critical'::text AS priority,
      'Student Marked NO SHOW: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Student missed course session ' || cs.code || '. Immediate reschedule or follow-up required.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      p.updated_at AS detected_at,
      e.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'NO_SHOW'::text AS reason_code,
      cs.id::text AS context_id,
      'session'::text AS context_type,
      jsonb_build_object(
        'type', 'open_session',
        'label', 'Handle No-Show',
        'session_id', cs.id,
        'href', '/courses/sessions/' || cs.id::text
      ) AS primary_action
    FROM public.course_participations p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    JOIN public.course_sessions cs ON cs.id = p.course_session_id
    WHERE (p_tab = 'today' OR p_tab = 'courses')
      AND p.attendance_status = 'no_show'

    UNION ALL

    -- 7. Payment Attention (Canonical Block 3 Math)
    SELECT
      'attention:PAYMENT_OUTSTANDING:enrollment:' || e.id::text AS item_id,
      'PAYMENT_ATTENTION'::text AS item_type,
      'payments'::text AS queue_category,
      CASE
        WHEN cs.start_date IS NOT NULL AND cs.start_date <= (CURRENT_DATE + 7) THEN 'high'
        ELSE 'normal'
      END AS priority,
      'Outstanding Balance ($' || (e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00)) || '): ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Course: ' || e.course_name_snapshot || '. Total agreed: $' || e.agreed_amount || ', Paid: $' || COALESCE(paid_sum.paid_amt, 0.00) || '.' AS description,
      cs.start_date::timestamptz AS due_at,
      false AS is_overdue,
      e.created_at AS detected_at,
      e.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'PAYMENT_OUTSTANDING'::text AS reason_code,
      e.id::text AS context_id,
      'enrollment'::text AS context_type,
      jsonb_build_object(
        'type', 'open_enrollment',
        'label', 'Record Payment',
        'enrollment_id', e.id,
        'lead_id', e.lead_id,
        'href', '/leads/' || e.lead_id::text
      ) AS primary_action
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    LEFT JOIN public.course_sessions cs ON cs.id = e.course_session_id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    WHERE p_tab = 'payments'
      AND e.enrollment_status = 'confirmed'
      AND (e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00)) > 0

    UNION ALL

    -- 8. Post-Course Attention (Block 5 Canonical Reasons)
    -- A) POST_COURSE_FOLLOWUP_OVERDUE
    SELECT
      'attention:POST_COURSE_FOLLOWUP_OVERDUE:engagement:' || eng.id::text AS item_id,
      'POST_COURSE_ATTENTION'::text AS item_type,
      'post_course'::text AS queue_category,
      'high'::text AS priority,
      'Overdue Post-Course Follow-up: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Course: ' || e.course_name_snapshot || '. Follow-up was due on ' || eng.followup_due_at::date::text || '.' AS description,
      eng.followup_due_at AS due_at,
      true AS is_overdue,
      eng.followup_due_at AS detected_at,
      eng.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'POST_COURSE_FOLLOWUP_OVERDUE'::text AS reason_code,
      eng.id::text AS context_id,
      'post_course'::text AS context_type,
      jsonb_build_object(
        'type', 'open_engagement',
        'label', 'Conduct Follow-up',
        'engagement_id', eng.id,
        'href', '/courses/post-course'
      ) AS primary_action
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE (p_tab = 'today' OR p_tab = 'post_course')
      AND eng.followup_status = 'pending' AND eng.followup_due_at < now()

    UNION ALL

    -- B) FEEDBACK_PENDING
    SELECT
      'attention:FEEDBACK_PENDING:engagement:' || eng.id::text AS item_id,
      'POST_COURSE_ATTENTION'::text AS item_type,
      'post_course'::text AS queue_category,
      'normal'::text AS priority,
      'Pending Feedback Response: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Course: ' || e.course_name_snapshot || '. Feedback link sent on ' || eng.feedback_requested_at::date::text || '.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      eng.feedback_requested_at AS detected_at,
      eng.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'FEEDBACK_PENDING'::text AS reason_code,
      eng.id::text AS context_id,
      'post_course'::text AS context_type,
      jsonb_build_object(
        'type', 'open_engagement',
        'label', 'View Feedback',
        'engagement_id', eng.id,
        'href', '/courses/post-course'
      ) AS primary_action
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE p_tab = 'post_course'
      AND eng.feedback_status = 'requested'
      AND eng.feedback_requested_at + interval '7 days' < now()

    UNION ALL

    -- C) TESTIMONIAL_REQUEST_DUE
    SELECT
      'attention:TESTIMONIAL_REQUEST_DUE:engagement:' || eng.id::text AS item_id,
      'POST_COURSE_ATTENTION'::text AS item_type,
      'post_course'::text AS queue_category,
      'normal'::text AS priority,
      'Testimonial Request Due: ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Student provided feedback for ' || e.course_name_snapshot || '. Ready for testimonial outreach.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      eng.feedback_received_at AS detected_at,
      eng.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'TESTIMONIAL_REQUEST_DUE'::text AS reason_code,
      eng.id::text AS context_id,
      'post_course'::text AS context_type,
      jsonb_build_object(
        'type', 'open_engagement',
        'label', 'Request Testimonial',
        'engagement_id', eng.id,
        'href', '/courses/post-course'
      ) AS primary_action
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE p_tab = 'post_course'
      AND eng.feedback_status = 'received'
      AND eng.testimonial_status = 'not_requested'

    UNION ALL

    -- D) NEXT_COURSE_OPPORTUNITY
    SELECT
      'attention:NEXT_COURSE_OPPORTUNITY:interest:' || i.id::text AS item_id,
      'POST_COURSE_ATTENTION'::text AS item_type,
      'post_course'::text AS queue_category,
      'normal'::text AS priority,
      'Next Course Opportunity: ' || c.name || ' for ' || COALESCE(l.first_name || ' ' || l.last_name, l.email) AS title,
      'Student expressed active interest. No confirmed enrollment yet.' AS description,
      NULL::timestamptz AS due_at,
      false AS is_overdue,
      i.created_at AS detected_at,
      i.lead_id,
      COALESCE(l.first_name || ' ' || l.last_name, l.email, 'Lead #' || SUBSTRING(l.id::text, 1, 8)) AS lead_name,
      l.email AS lead_email,
      l.phone_e164 AS lead_phone,
      l.contact_preference,
      l.lead_score,
      s.code AS pipeline_stage,
      'NEXT_COURSE_OPPORTUNITY'::text AS reason_code,
      i.id::text AS context_id,
      'post_course'::text AS context_type,
      jsonb_build_object(
        'type', 'open_engagement',
        'label', 'Present Opportunity',
        'lead_id', i.lead_id,
        'href', '/courses/post-course'
      ) AS primary_action
    FROM public.lead_course_interests i
    JOIN public.leads l ON l.id = i.lead_id
    JOIN public.courses c ON c.id = i.course_id
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    WHERE p_tab = 'post_course'
      AND i.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.lead_id = i.lead_id AND e.course_id = i.course_id AND e.enrollment_status = 'confirmed'
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
      -- 1. Overdue first
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
      -- 4. Recent detection / created
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


-- -----------------------------------------------------------------------------
-- 9. Row Level Security & Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_lead_last_meaningful_activity_at TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_crm_task TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_crm_task TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_crm_task TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_operations_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_operations_queue TO authenticated;
