-- =============================================================================
-- Migration 00029: Phase 3 Block 3 — Follow-Up Sequences & Automation History UX
-- =============================================================================
-- Enhancements to existing Automation Engine:
-- 1. Add automation_type ('workflow' | 'sequence') and stop_conditions to automations
-- 2. Add stop_conditions to automation_versions
-- 3. Add run_control_status and expand status on automation_runs
-- 4. Create partial unique index uq_active_run_per_automation_lead
-- 5. Add milestone activity types to lead_activities
-- 6. RPCs: manual_enroll_lead_in_sequence, pause_automation_run,
--          resume_automation_run, stop_automation_run, get_sequence_metrics
-- 7. Update claim_automation_jobs to protect paused runs
-- =============================================================================

-- 1. Alter automations table
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS automation_type TEXT NOT NULL DEFAULT 'workflow';

ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_automation_type_check;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_automation_type_check
  CHECK (automation_type IN ('workflow', 'sequence'));

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS stop_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS enrollment_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_trigger_type_check;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_trigger_type_check
  CHECK (trigger_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added', 'manual_enrollment'
  ));

-- 2. Alter automation_events table
ALTER TABLE public.automation_events
  DROP CONSTRAINT IF EXISTS automation_events_event_type_check;

ALTER TABLE public.automation_events
  ADD CONSTRAINT automation_events_event_type_check
  CHECK (event_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added', 'manual_enrollment'
  ));

-- 3. Alter automation_versions table
ALTER TABLE public.automation_versions
  ADD COLUMN IF NOT EXISTS stop_conditions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. Alter automation_runs table
ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS run_control_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.automation_runs
  DROP CONSTRAINT IF EXISTS automation_runs_run_control_status_check;

ALTER TABLE public.automation_runs
  ADD CONSTRAINT automation_runs_run_control_status_check
  CHECK (run_control_status IN ('active', 'paused', 'stopped'));

ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS stop_reason_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS stop_reason_message TEXT NULL;

ALTER TABLE public.automation_runs
  DROP CONSTRAINT IF EXISTS automation_runs_status_check;

ALTER TABLE public.automation_runs
  ADD CONSTRAINT automation_runs_status_check
  CHECK (status IN (
    'pending', 'running', 'waiting', 'paused',
    'completed', 'failed', 'cancelled', 'stopped_by_condition'
  ));

-- 4.1 Ironclad Database-level Protection against duplicate active enrollment
-- The same lead cannot have two active runs (pending, running, waiting, paused) for the same automation!
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_run_per_automation_lead
  ON public.automation_runs(automation_id, lead_id)
  WHERE status IN ('pending', 'running', 'waiting', 'paused');

-- 5. Alter lead_activities table
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
    'sequence_started'::text, 'sequence_completed'::text, 'sequence_failed'::text, 'sequence_stopped'::text
  ]));

-- 6. Update claim_automation_jobs to protect paused runs
CREATE OR REPLACE FUNCTION public.claim_automation_jobs(
  p_worker_id TEXT,
  p_batch_size INT DEFAULT 10,
  p_lease_minutes INT DEFAULT 10
)
RETURNS TABLE (
  job_id UUID,
  automation_run_id UUID,
  automation_run_step_id UUID,
  lead_id UUID,
  run_at TIMESTAMPTZ,
  attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Stale Job Recovery: jobs stuck in 'processing' longer than p_lease_minutes
  UPDATE public.automation_jobs
  SET status = 'pending',
      claimed_at = NULL,
      claimed_by = NULL,
      updated_at = now()
  WHERE status = 'processing'
    AND claimed_at < (now() - (p_lease_minutes || ' minutes')::interval)
    AND attempts < 5
    AND id IS NOT NULL;

  -- Fail jobs that exceeded 5 retry attempts
  UPDATE public.automation_jobs
  SET status = 'failed',
      last_error = 'MAX_ATTEMPTS_EXCEEDED: Stale job exceeded 5 retry attempts',
      updated_at = now()
  WHERE status = 'processing'
    AND claimed_at < (now() - (p_lease_minutes || ' minutes')::interval)
    AND attempts >= 5
    AND id IS NOT NULL;

  -- 2. Atomic Claim with FOR UPDATE SKIP LOCKED
  -- CRITICAL: Only claim jobs where the associated run is active ('waiting' and run_control_status = 'active')!
  RETURN QUERY
  WITH to_claim AS (
    SELECT j.id
    FROM public.automation_jobs j
    JOIN public.automation_runs r ON r.id = j.automation_run_id
    WHERE j.status = 'pending'
      AND j.run_at <= now()
      AND r.status = 'waiting'
      AND r.run_control_status = 'active'
    ORDER BY j.run_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.automation_jobs j
  SET status = 'processing',
      claimed_at = now(),
      claimed_by = p_worker_id,
      attempts = j.attempts + 1,
      updated_at = now()
  FROM to_claim
  WHERE j.id = to_claim.id
    AND j.id IS NOT NULL
  RETURNING j.id, j.automation_run_id, j.automation_run_step_id, j.lead_id, j.run_at, j.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_jobs(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_jobs(TEXT, INT, INT) TO service_role;

-- 7. RPC: manual_enroll_lead_in_sequence
CREATE OR REPLACE FUNCTION public.manual_enroll_lead_in_sequence(
  p_lead_id UUID,
  p_sequence_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq RECORD;
  v_version RECORD;
  v_existing_run RECORD;
  v_new_run_id UUID;
  v_idempotency_key TEXT;
  v_lead RECORD;
BEGIN
  -- 1. Authorization
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  -- 2. Validate lead
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lead not found');
  END IF;

  -- 3. Validate sequence
  SELECT * INTO v_seq FROM public.automations WHERE id = p_sequence_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sequence not found');
  END IF;

  IF v_seq.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sequence is not active (currently ' || v_seq.status || ')');
  END IF;

  -- 4. Fetch published version
  SELECT * INTO v_version 
  FROM public.automation_versions 
  WHERE automation_id = p_sequence_id AND status = 'published'
  ORDER BY version DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No published version available for sequence');
  END IF;

  -- 5. Guard against duplicate active enrollment
  SELECT id, status INTO v_existing_run
  FROM public.automation_runs
  WHERE automation_id = p_sequence_id
    AND lead_id = p_lead_id
    AND status IN ('pending', 'running', 'waiting', 'paused');

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Lead is already enrolled in this sequence.',
      'existing_run_id', v_existing_run.id,
      'status', v_existing_run.status
    );
  END IF;

  -- 6. Insert new run
  v_idempotency_key := 'manual:' || p_sequence_id || ':' || p_lead_id || ':' || extract(epoch from now())::text;

  INSERT INTO public.automation_runs (
    automation_id,
    automation_version_id,
    lead_id,
    idempotency_key,
    automation_depth,
    status,
    run_control_status,
    current_step_order,
    started_at
  ) VALUES (
    p_sequence_id,
    v_version.id,
    p_lead_id,
    v_idempotency_key,
    0,
    'pending',
    'active',
    1,
    now()
  ) RETURNING id INTO v_new_run_id;

  -- 7. Log milestone in lead_activities
  INSERT INTO public.lead_activities (
    lead_id,
    automation_run_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    v_new_run_id,
    CASE WHEN v_seq.automation_type = 'sequence' THEN 'sequence_started' ELSE 'automation_started' END,
    'user',
    'Enrolled in ' || v_seq.name || ' (v' || v_version.version || ')',
    jsonb_build_object(
      'automation_id', p_sequence_id,
      'automation_type', v_seq.automation_type,
      'version', v_version.version,
      'enrolled_by', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_new_run_id,
    'automation_id', p_sequence_id,
    'version', v_version.version,
    'message', 'Enrolled successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manual_enroll_lead_in_sequence(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_enroll_lead_in_sequence(UUID, UUID) TO authenticated;

-- 8. RPC: pause_automation_run
CREATE OR REPLACE FUNCTION public.pause_automation_run(
  p_run_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  SELECT * INTO v_run FROM public.automation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run not found');
  END IF;

  IF v_run.status IN ('completed', 'cancelled', 'failed', 'stopped_by_condition') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot pause a run that is already ' || v_run.status);
  END IF;

  IF v_run.status = 'paused' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Run is already paused');
  END IF;

  UPDATE public.automation_runs
  SET status = 'paused',
      run_control_status = 'paused',
      updated_at = now()
  WHERE id = p_run_id AND id IS NOT NULL;

  RETURN jsonb_build_object('success', true, 'run_id', p_run_id, 'status', 'paused');
END;
$$;

REVOKE ALL ON FUNCTION public.pause_automation_run(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pause_automation_run(UUID) TO authenticated;

-- 9. RPC: resume_automation_run
CREATE OR REPLACE FUNCTION public.resume_automation_run(
  p_run_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_job RECORD;
  v_has_pending_job BOOLEAN := false;
  v_job_expired BOOLEAN := false;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  SELECT * INTO v_run FROM public.automation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run not found');
  END IF;

  IF v_run.status != 'paused' AND v_run.run_control_status != 'paused' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run is not paused (currently ' || v_run.status || ')');
  END IF;

  -- Check if there is an existing pending wait job
  SELECT * INTO v_job 
  FROM public.automation_jobs 
  WHERE automation_run_id = p_run_id AND status = 'pending'
  ORDER BY run_at ASC LIMIT 1;

  IF FOUND THEN
    v_has_pending_job := true;
    IF v_job.run_at <= now() THEN
      v_job_expired := true;
    END IF;
  END IF;

  -- Resume state
  UPDATE public.automation_runs
  SET status = CASE WHEN v_has_pending_job THEN 'waiting' ELSE 'running' END,
      run_control_status = 'active',
      updated_at = now()
  WHERE id = p_run_id AND id IS NOT NULL;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id,
    'status', CASE WHEN v_has_pending_job THEN 'waiting' ELSE 'running' END,
    'has_pending_job', v_has_pending_job,
    'job_expired', v_job_expired,
    'message', 'Run resumed successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resume_automation_run(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_automation_run(UUID) TO authenticated;

-- 10. RPC: stop_automation_run
CREATE OR REPLACE FUNCTION public.stop_automation_run(
  p_run_id UUID,
  p_reason_code TEXT DEFAULT 'MANUAL_STOP',
  p_reason_message TEXT DEFAULT 'Stopped by user'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_auto RECORD;
  v_target_status TEXT;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  SELECT * INTO v_run FROM public.automation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run not found');
  END IF;

  IF v_run.status IN ('completed', 'cancelled', 'failed', 'stopped_by_condition') THEN
    RETURN jsonb_build_object('success', true, 'message', 'Run is already ' || v_run.status);
  END IF;

  SELECT * INTO v_auto FROM public.automations WHERE id = v_run.automation_id;

  v_target_status := CASE WHEN p_reason_code = 'MANUAL_STOP' THEN 'cancelled' ELSE 'stopped_by_condition' END;

  -- 1. Cancel all pending / processing jobs
  UPDATE public.automation_jobs
  SET status = 'cancelled',
      updated_at = now()
  WHERE automation_run_id = p_run_id 
    AND status IN ('pending', 'processing')
    AND id IS NOT NULL;

  -- 2. Update run
  UPDATE public.automation_runs
  SET status = v_target_status,
      run_control_status = 'stopped',
      stop_reason = p_reason_message,
      stop_reason_code = p_reason_code,
      stop_reason_message = p_reason_message,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_run_id AND id IS NOT NULL;

  -- 3. Log milestone
  INSERT INTO public.lead_activities (
    lead_id,
    automation_run_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    v_run.lead_id,
    p_run_id,
    CASE WHEN v_auto.automation_type = 'sequence' THEN 'sequence_stopped' ELSE 'automation_completed' END,
    'user',
    'Sequence stopped: ' || COALESCE(v_auto.name, 'Sequence') || ' (' || p_reason_message || ')',
    jsonb_build_object(
      'stop_reason_code', p_reason_code,
      'stop_reason_message', p_reason_message,
      'stopped_by', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id,
    'status', v_target_status,
    'stop_reason_code', p_reason_code,
    'message', 'Run stopped successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stop_automation_run(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_automation_run(UUID, TEXT, TEXT) TO authenticated;

-- 11. RPC: get_sequence_metrics
CREATE OR REPLACE FUNCTION public.get_sequence_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active INT := 0;
  v_waiting INT := 0;
  v_paused INT := 0;
  v_completed INT := 0;
  v_failed INT := 0;
  v_stopped INT := 0;
  v_emails INT := 0;
  v_sms INT := 0;
  v_tasks INT := 0;
  v_skipped INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  SELECT count(*) INTO v_active
  FROM public.automation_runs r
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND r.status = 'running';

  SELECT count(*) INTO v_waiting
  FROM public.automation_runs r
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND r.status = 'waiting';

  SELECT count(*) INTO v_paused
  FROM public.automation_runs r
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND r.status = 'paused';

  SELECT count(*) INTO v_completed
  FROM public.automation_runs r
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND r.status = 'completed';

  SELECT count(*) INTO v_failed
  FROM public.automation_runs r
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND r.status = 'failed';

  SELECT count(*) INTO v_stopped
  FROM public.automation_runs r
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND r.status IN ('stopped_by_condition', 'cancelled');

  SELECT count(*) INTO v_emails
  FROM public.automation_run_steps rs
  JOIN public.automation_runs r ON r.id = rs.automation_run_id
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND rs.action_type = 'send_email' AND rs.status = 'completed';

  SELECT count(*) INTO v_sms
  FROM public.automation_run_steps rs
  JOIN public.automation_runs r ON r.id = rs.automation_run_id
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND rs.action_type = 'send_sms' AND rs.status = 'completed';

  SELECT count(*) INTO v_tasks
  FROM public.automation_run_steps rs
  JOIN public.automation_runs r ON r.id = rs.automation_run_id
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND rs.action_type IN ('create_task', 'create_call_task') AND rs.status = 'completed';

  SELECT count(*) INTO v_skipped
  FROM public.automation_run_steps rs
  JOIN public.automation_runs r ON r.id = rs.automation_run_id
  JOIN public.automations a ON a.id = r.automation_id
  WHERE a.automation_type = 'sequence' AND rs.status = 'skipped';

  RETURN jsonb_build_object(
    'active_runs', v_active,
    'waiting_runs', v_waiting,
    'paused_runs', v_paused,
    'completed_runs', v_completed,
    'failed_runs', v_failed,
    'stopped_by_condition_runs', v_stopped,
    'emails_sent', v_emails,
    'sms_sent', v_sms,
    'tasks_created', v_tasks,
    'actions_skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sequence_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sequence_metrics() TO authenticated;
