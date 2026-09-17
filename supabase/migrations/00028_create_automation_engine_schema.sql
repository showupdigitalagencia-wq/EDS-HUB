-- =============================================================================
-- Migration 00028: Phase 3 Block 2 — Automation Engine Schema & Infrastructure
-- =============================================================================
-- Tables:
-- 1. automations
-- 2. automation_versions
-- 3. automation_steps
-- 4. automation_events (with canonical source_event_key uniqueness)
-- 5. automation_runs (with recursion/loop depth protection)
-- 6. automation_run_steps (with condition & skip auditing)
-- 7. automation_jobs (with atomic claim via FOR UPDATE SKIP LOCKED)
--
-- Alterations:
-- - outbound_messages (nullable intake_event_id, add automation references)
-- - tasks (add automation references, extend task_type)
-- - lead_activities (add automation_started, automation_completed, automation_failed)
--
-- Functions & Triggers:
-- - Atomic claim_automation_jobs
-- - publish_automation_version
-- - Triggers for form_submitted, lead_created, qualification_status_changed,
--   pipeline_stage_changed, tag_added
-- - Updated purge_all_contacts & get_contacts_purge_preview
-- =============================================================================

-- 1. Alter existing tables to support automations

-- 1.1 Outbound Messages: Allow automations to send without intake_event_id
ALTER TABLE public.outbound_messages
  ALTER COLUMN intake_event_id DROP NOT NULL;

ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS automation_run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS automation_run_step_id UUID NULL;

-- 1.2 Tasks: Add automation linkage & expand task_type
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS automation_run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS automation_run_step_id UUID NULL;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('call', 'data_review', 'general'));

-- 1.3 Lead Activities: Add automation milestone activities & linkage
ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS automation_run_id UUID NULL;

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
    'automation_failed'::text
  ]));

-- 2. Core Automation Tables

-- 2.1 automations
CREATE TABLE IF NOT EXISTS public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added'
  )),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID NULL REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.automations IS 'Parent automation definitions with high-level trigger configuration and status.';

-- 2.2 automation_versions
CREATE TABLE IF NOT EXISTS public.automation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ NULL,
  created_by_user_id UUID NULL REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_automation_versions_ver UNIQUE (automation_id, version)
);

COMMENT ON TABLE public.automation_versions IS 'Immutable snapshots of automation steps and configuration per published version.';

-- 2.3 automation_steps
CREATE TABLE IF NOT EXISTS public.automation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_version_id UUID NOT NULL REFERENCES public.automation_versions(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('condition', 'action', 'wait')),
  action_type TEXT NULL CHECK (action_type IS NULL OR action_type IN (
    'send_email', 'send_sms', 'create_call_task', 'create_task',
    'add_tag', 'remove_tag', 'move_pipeline_stage', 'update_qualification_status',
    'wait', 'stop_automation'
  )),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_automation_steps_ver_order UNIQUE (automation_version_id, step_order)
);

COMMENT ON TABLE public.automation_steps IS 'Normalized ordered steps belonging to a specific automation version.';

-- 2.4 automation_events (Event Bus with canonical source_event_key uniqueness)
CREATE TABLE IF NOT EXISTS public.automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added'
  )),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'ignored', 'failed')),
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_automation_events_source_key UNIQUE (source_event_key)
);

COMMENT ON TABLE public.automation_events IS 'Canonical event log for incoming triggers. Guaranteed unique by source_event_key.';

-- 2.5 automation_runs (Runs with recursion/depth protection)
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  automation_version_id UUID NOT NULL REFERENCES public.automation_versions(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  trigger_event_id UUID NULL REFERENCES public.automation_events(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  parent_run_id UUID NULL REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  caused_by_automation_run_id UUID NULL REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  automation_depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'
  )),
  current_step_order INTEGER NOT NULL DEFAULT 1,
  stop_reason TEXT NULL,
  last_error TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.automation_runs IS 'Enrollment execution instance of an automation version for a lead.';

-- Foreign keys on outbound_messages and tasks now that automation_runs exists
ALTER TABLE public.outbound_messages
  DROP CONSTRAINT IF EXISTS fk_outbound_messages_automation_run;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT fk_outbound_messages_automation_run
  FOREIGN KEY (automation_run_id) REFERENCES public.automation_runs(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS fk_tasks_automation_run;
ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_automation_run
  FOREIGN KEY (automation_run_id) REFERENCES public.automation_runs(id) ON DELETE SET NULL;

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS fk_lead_activities_automation_run;
ALTER TABLE public.lead_activities
  ADD CONSTRAINT fk_lead_activities_automation_run
  FOREIGN KEY (automation_run_id) REFERENCES public.automation_runs(id) ON DELETE SET NULL;

-- 2.6 automation_run_steps (Detailed step execution audit)
CREATE TABLE IF NOT EXISTS public.automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_run_id UUID NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  automation_step_id UUID NULL REFERENCES public.automation_steps(id) ON DELETE SET NULL,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('condition', 'action', 'wait')),
  action_type TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'waiting', 'completed', 'skipped', 'failed', 'cancelled'
  )),
  skip_reason_code TEXT NULL,
  skip_reason_message TEXT NULL,
  condition_input JSONB NULL,
  condition_result BOOLEAN NULL,
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT NULL,
  error_message TEXT NULL,
  provider TEXT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  scheduled_resume_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.automation_run_steps IS 'Detailed step-by-step execution log for audits, timelines, and idempotency guards.';

ALTER TABLE public.outbound_messages
  DROP CONSTRAINT IF EXISTS fk_outbound_messages_step_run;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT fk_outbound_messages_step_run
  FOREIGN KEY (automation_run_step_id) REFERENCES public.automation_run_steps(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS fk_tasks_step_run;
ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_step_run
  FOREIGN KEY (automation_run_step_id) REFERENCES public.automation_run_steps(id) ON DELETE SET NULL;

-- 2.7 automation_jobs (Wait / delay queue with atomic claim)
CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_run_id UUID NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  automation_run_step_id UUID NOT NULL REFERENCES public.automation_run_steps(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'cancelled'
  )),
  claimed_at TIMESTAMPTZ NULL,
  claimed_by TEXT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.automation_jobs IS 'Server-side delayed jobs for waiting steps. Processed atomically with FOR UPDATE SKIP LOCKED.';

-- 3. Indexes for High Performance & Idempotency
CREATE INDEX IF NOT EXISTS idx_automations_status ON public.automations(status);
CREATE INDEX IF NOT EXISTS idx_automations_trigger ON public.automations(trigger_type, status);
CREATE INDEX IF NOT EXISTS idx_automation_steps_ver_order ON public.automation_steps(automation_version_id, step_order);
CREATE INDEX IF NOT EXISTS idx_automation_events_status ON public.automation_events(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_automation_events_lead ON public.automation_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_status ON public.automation_runs(automation_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_runs_lead ON public.automation_runs(lead_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_idempotency ON public.automation_runs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run ON public.automation_run_steps(automation_run_id, step_order);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_status_run_at ON public.automation_jobs(status, run_at ASC);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_run ON public.automation_jobs(automation_run_id);

-- 4. Row Level Security Policies
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;

-- 4.1 Deny anonymous access to all automation tables
DROP POLICY IF EXISTS "Deny anon access on automations" ON public.automations;
CREATE POLICY "Deny anon access on automations" ON public.automations
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on automation_versions" ON public.automation_versions;
CREATE POLICY "Deny anon access on automation_versions" ON public.automation_versions
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on automation_steps" ON public.automation_steps;
CREATE POLICY "Deny anon access on automation_steps" ON public.automation_steps
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on automation_events" ON public.automation_events;
CREATE POLICY "Deny anon access on automation_events" ON public.automation_events
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on automation_runs" ON public.automation_runs;
CREATE POLICY "Deny anon access on automation_runs" ON public.automation_runs
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on automation_run_steps" ON public.automation_run_steps;
CREATE POLICY "Deny anon access on automation_run_steps" ON public.automation_run_steps
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Deny anon access on automation_jobs" ON public.automation_jobs;
CREATE POLICY "Deny anon access on automation_jobs" ON public.automation_jobs
  FOR ALL TO anon USING (false);

-- 4.2 Allow active app users to manage automations, versions, and steps
DROP POLICY IF EXISTS "Active app users can manage automations" ON public.automations;
CREATE POLICY "Active app users can manage automations" ON public.automations
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage automation_versions" ON public.automation_versions;
CREATE POLICY "Active app users can manage automation_versions" ON public.automation_versions
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage automation_steps" ON public.automation_steps;
CREATE POLICY "Active app users can manage automation_steps" ON public.automation_steps
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- 4.3 Allow active app users to view and cancel runs
DROP POLICY IF EXISTS "Active app users can view automation_events" ON public.automation_events;
CREATE POLICY "Active app users can view automation_events" ON public.automation_events
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can manage automation_runs" ON public.automation_runs;
CREATE POLICY "Active app users can manage automation_runs" ON public.automation_runs
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can view automation_run_steps" ON public.automation_run_steps;
CREATE POLICY "Active app users can view automation_run_steps" ON public.automation_run_steps
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Active app users can view automation_jobs" ON public.automation_jobs;
CREATE POLICY "Active app users can view automation_jobs" ON public.automation_jobs
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

-- 5. Trigger Functions for Event Capture

-- 5.1 form_submitted
CREATE OR REPLACE FUNCTION public.trg_capture_form_submitted_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.processing_status != 'conflict' THEN
    INSERT INTO public.automation_events (
      event_type,
      lead_id,
      source_table,
      source_record_id,
      source_event_key,
      payload
    ) VALUES (
      'form_submitted',
      NEW.lead_id,
      'form_submissions',
      NEW.id::text,
      'form_submission:' || NEW.id::text,
      jsonb_build_object(
        'form_id', NEW.form_id,
        'form_version', NEW.form_version,
        'source_detail', NEW.source_detail,
        'course_interest', NEW.course_interest,
        'contact_preference', NEW.contact_preference,
        'submitted_data', NEW.submitted_data
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_submissions_capture_event ON public.form_submissions;
CREATE TRIGGER trg_form_submissions_capture_event
  AFTER INSERT ON public.form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_form_submitted_event();

-- 5.2 lead_created
CREATE OR REPLACE FUNCTION public.trg_capture_lead_created_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    source_table,
    source_record_id,
    source_event_key,
    payload
  ) VALUES (
    'lead_created',
    NEW.id,
    'leads',
    NEW.id::text,
    'lead_created:' || NEW.id::text,
    jsonb_build_object(
      'source', NEW.source,
      'source_detail', NEW.source_detail,
      'course_interest', NEW.course_interest,
      'contact_preference', NEW.contact_preference,
      'pipeline_stage_id', NEW.pipeline_stage_id,
      'qualification_status', NEW.qualification_status
    )
  )
  ON CONFLICT (source_event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_capture_created_event ON public.leads;
CREATE TRIGGER trg_leads_capture_created_event
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_lead_created_event();

-- 5.3 qualification_status_changed
CREATE OR REPLACE FUNCTION public.trg_capture_qualification_status_changed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.qualification_status IS DISTINCT FROM NEW.qualification_status THEN
    INSERT INTO public.automation_events (
      event_type,
      lead_id,
      source_table,
      source_record_id,
      source_event_key,
      payload
    ) VALUES (
      'qualification_status_changed',
      NEW.id,
      'leads',
      NEW.id::text,
      'qualification_status:' || NEW.id::text || ':' || COALESCE(NEW.qualification_status, 'none') || ':' || extract(epoch from now())::text,
      jsonb_build_object(
        'old_status', OLD.qualification_status,
        'new_status', NEW.qualification_status,
        'contact_preference', NEW.contact_preference,
        'course_interest', NEW.course_interest
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_capture_qualification_changed_event ON public.leads;
CREATE TRIGGER trg_leads_capture_qualification_changed_event
  AFTER UPDATE OF qualification_status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_qualification_status_changed_event();

-- 5.4 pipeline_stage_changed
CREATE OR REPLACE FUNCTION public.trg_capture_pipeline_stage_changed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- We capture transitions where from_stage_id is present and distinct
  IF NEW.from_stage_id IS NOT NULL AND NEW.from_stage_id IS DISTINCT FROM NEW.to_stage_id THEN
    INSERT INTO public.automation_events (
      event_type,
      lead_id,
      source_table,
      source_record_id,
      source_event_key,
      payload
    ) VALUES (
      'pipeline_stage_changed',
      NEW.lead_id,
      'lead_stage_history',
      NEW.id::text,
      'stage_history:' || NEW.id::text,
      jsonb_build_object(
        'history_id', NEW.id,
        'from_stage_id', NEW.from_stage_id,
        'to_stage_id', NEW.to_stage_id,
        'change_reason', NEW.change_reason
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_stage_history_capture_event ON public.lead_stage_history;
CREATE TRIGGER trg_lead_stage_history_capture_event
  AFTER INSERT ON public.lead_stage_history
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_pipeline_stage_changed_event();

-- 5.5 tag_added
CREATE OR REPLACE FUNCTION public.trg_capture_tag_added_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    source_table,
    source_record_id,
    source_event_key,
    payload
  ) VALUES (
    'tag_added',
    NEW.lead_id,
    'lead_tags',
    NEW.lead_id::text || ':' || NEW.tag_id::text,
    'tag_added:' || NEW.lead_id::text || ':' || NEW.tag_id::text || ':' || extract(epoch from COALESCE(NEW.created_at, now()))::text,
    jsonb_build_object(
      'tag_id', NEW.tag_id
    )
  )
  ON CONFLICT (source_event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_tags_capture_event ON public.lead_tags;
CREATE TRIGGER trg_lead_tags_capture_event
  AFTER INSERT ON public.lead_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_tag_added_event();

-- 6. Atomic Queue Claim & Stale Recovery RPCs (Private, service_role only)

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
  RETURN QUERY
  WITH to_claim AS (
    SELECT id
    FROM public.automation_jobs
    WHERE status = 'pending'
      AND run_at <= now()
    ORDER BY run_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
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

-- 7. Publish Automation Version RPC
CREATE OR REPLACE FUNCTION public.publish_automation_version(
  p_automation_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto RECORD;
  v_draft RECORD;
  v_steps_count INT;
  v_invalid_steps_count INT;
BEGIN
  -- Authorization check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  SELECT * INTO v_auto
  FROM public.automations
  WHERE id = p_automation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Automation not found');
  END IF;

  -- Find the highest version or draft version
  SELECT * INTO v_draft
  FROM public.automation_versions
  WHERE automation_id = p_automation_id
  ORDER BY version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No version found for automation');
  END IF;

  -- Validate trigger
  IF v_auto.trigger_type IS NULL OR trim(v_auto.trigger_type) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trigger type is required');
  END IF;

  -- Validate steps exist
  SELECT count(*) INTO v_steps_count
  FROM public.automation_steps
  WHERE automation_version_id = v_draft.id;

  IF v_steps_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Automation must have at least one step');
  END IF;

  -- Mark existing published versions as archived
  UPDATE public.automation_versions
  SET status = 'archived', updated_at = now()
  WHERE automation_id = p_automation_id
    AND status = 'published'
    AND id IS NOT NULL;

  -- Publish this version
  UPDATE public.automation_versions
  SET status = 'published',
      published_at = now(),
      updated_at = now()
  WHERE id = v_draft.id
    AND id IS NOT NULL;

  -- Update parent automation status to active and current_version
  UPDATE public.automations
  SET status = 'active',
      current_version = v_draft.version,
      updated_at = now()
  WHERE id = p_automation_id
    AND id IS NOT NULL;

  RETURN jsonb_build_object(
    'success', true,
    'automation_id', p_automation_id,
    'version', v_draft.version,
    'version_id', v_draft.id,
    'status', 'active'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_automation_version(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_automation_version(UUID) TO authenticated;

-- 8. Automation Metrics Aggregation RPC
CREATE OR REPLACE FUNCTION public.get_automation_metrics(
  p_automation_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrolled INT := 0;
  v_active INT := 0;
  v_completed INT := 0;
  v_failed INT := 0;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  SELECT count(*) INTO v_enrolled
  FROM public.automation_runs
  WHERE automation_id = p_automation_id;

  SELECT count(*) INTO v_active
  FROM public.automation_runs
  WHERE automation_id = p_automation_id
    AND status IN ('pending', 'running', 'waiting');

  SELECT count(*) INTO v_completed
  FROM public.automation_runs
  WHERE automation_id = p_automation_id
    AND status = 'completed';

  SELECT count(*) INTO v_failed
  FROM public.automation_runs
  WHERE automation_id = p_automation_id
    AND status = 'failed';

  RETURN jsonb_build_object(
    'enrolled', v_enrolled,
    'active', v_active,
    'completed', v_completed,
    'failed', v_failed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_automation_metrics(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_automation_metrics(UUID) TO authenticated;

-- 9. Update purge_all_contacts & get_contacts_purge_preview
CREATE OR REPLACE FUNCTION public.get_contacts_purge_preview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contacts_count int;
  v_activities_count int;
  v_notes_count int;
  v_tasks_count int;
  v_imports_count int;
  v_import_rows_count int;
  v_intake_events_count int;
  v_outbound_messages_count int;
  v_campaign_recipients_count int;
  v_stage_history_count int;
  v_lead_tags_count int;
  v_form_submissions_count int;
  v_automation_runs_count int;
  v_automation_events_count int;
  v_automation_jobs_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Forbidden: active app_user required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_contacts_count FROM public.leads WHERE id IS NOT NULL;
  SELECT count(*) INTO v_activities_count FROM public.lead_activities WHERE id IS NOT NULL;
  SELECT count(*) INTO v_notes_count FROM public.lead_notes WHERE id IS NOT NULL;
  SELECT count(*) INTO v_tasks_count FROM public.tasks WHERE id IS NOT NULL;
  SELECT count(*) INTO v_imports_count FROM public.lead_imports WHERE id IS NOT NULL;
  SELECT count(*) INTO v_import_rows_count FROM public.lead_import_rows WHERE id IS NOT NULL;
  SELECT count(*) INTO v_intake_events_count FROM public.lead_intake_events WHERE id IS NOT NULL;
  SELECT count(*) INTO v_outbound_messages_count FROM public.outbound_messages WHERE id IS NOT NULL;
  SELECT count(*) INTO v_campaign_recipients_count FROM public.campaign_recipients WHERE id IS NOT NULL;
  SELECT count(*) INTO v_stage_history_count FROM public.lead_stage_history WHERE id IS NOT NULL;
  SELECT count(*) INTO v_lead_tags_count FROM public.lead_tags WHERE lead_id IS NOT NULL;
  SELECT count(*) INTO v_form_submissions_count FROM public.form_submissions WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_runs_count FROM public.automation_runs WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_events_count FROM public.automation_events WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_jobs_count FROM public.automation_jobs WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'contacts_count', v_contacts_count,
    'activities_count', v_activities_count,
    'notes_count', v_notes_count,
    'tasks_count', v_tasks_count,
    'imports_count', v_imports_count,
    'import_rows_count', v_import_rows_count,
    'intake_events_count', v_intake_events_count,
    'outbound_messages_count', v_outbound_messages_count,
    'campaign_recipients_count', v_campaign_recipients_count,
    'stage_history_count', v_stage_history_count,
    'lead_tags_count', v_lead_tags_count,
    'form_submissions_count', v_form_submissions_count,
    'automation_runs_count', v_automation_runs_count,
    'automation_events_count', v_automation_events_count,
    'automation_jobs_count', v_automation_jobs_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_all_contacts(
  confirmation_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_leads int;
  v_deleted_activities int;
  v_deleted_notes int;
  v_deleted_tasks int;
  v_deleted_imports int;
  v_deleted_import_rows int;
  v_deleted_intake_events int;
  v_deleted_outbound_messages int;
  v_deleted_campaign_recipients int;
  v_deleted_stage_history int;
  v_deleted_lead_tags int;
  v_deleted_form_submissions int;
  v_deleted_automation_jobs int;
  v_deleted_automation_run_steps int;
  v_deleted_automation_runs int;
  v_deleted_automation_events int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Forbidden: active app_user required' USING ERRCODE = '42501';
  END IF;

  IF confirmation_text IS NULL OR trim(confirmation_text) <> 'DELETE ALL CONTACTS' THEN
    RAISE EXCEPTION 'Invalid confirmation text. You must type DELETE ALL CONTACTS' USING ERRCODE = '22023';
  END IF;

  -- 1. automation_jobs
  DELETE FROM public.automation_jobs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_jobs = ROW_COUNT;

  -- 2. automation_run_steps
  DELETE FROM public.automation_run_steps WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_run_steps = ROW_COUNT;

  -- 3. automation_runs
  DELETE FROM public.automation_runs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_runs = ROW_COUNT;

  -- 4. automation_events
  DELETE FROM public.automation_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_events = ROW_COUNT;

  -- 5. outbound_messages
  DELETE FROM public.outbound_messages WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_outbound_messages = ROW_COUNT;

  -- 6. tasks
  DELETE FROM public.tasks WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;

  -- 7. form_submissions
  DELETE FROM public.form_submissions WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_form_submissions = ROW_COUNT;

  -- 8. lead_activities
  DELETE FROM public.lead_activities WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_activities = ROW_COUNT;

  -- 9. lead_stage_history
  DELETE FROM public.lead_stage_history WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_stage_history = ROW_COUNT;

  -- 10. campaign_recipients
  DELETE FROM public.campaign_recipients WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_campaign_recipients = ROW_COUNT;

  -- 11. lead_tags
  DELETE FROM public.lead_tags WHERE lead_id IS NOT NULL AND tag_id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_lead_tags = ROW_COUNT;

  -- 12. lead_notes
  DELETE FROM public.lead_notes WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_notes = ROW_COUNT;

  -- 13. lead_import_rows
  DELETE FROM public.lead_import_rows WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_import_rows = ROW_COUNT;

  -- 14. lead_imports
  DELETE FROM public.lead_imports WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_imports = ROW_COUNT;

  -- 15. lead_intake_events
  DELETE FROM public.lead_intake_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_intake_events = ROW_COUNT;

  -- 16. leads
  DELETE FROM public.leads WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_leads = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_leads', v_deleted_leads,
    'deleted_activities', v_deleted_activities,
    'deleted_notes', v_deleted_notes,
    'deleted_tasks', v_deleted_tasks,
    'deleted_imports', v_deleted_imports,
    'deleted_import_rows', v_deleted_import_rows,
    'deleted_intake_events', v_deleted_intake_events,
    'deleted_outbound_messages', v_deleted_outbound_messages,
    'deleted_campaign_recipients', v_deleted_campaign_recipients,
    'deleted_stage_history', v_deleted_stage_history,
    'deleted_lead_tags', v_deleted_lead_tags,
    'deleted_form_submissions', v_deleted_form_submissions,
    'deleted_automation_jobs', v_deleted_automation_jobs,
    'deleted_automation_run_steps', v_deleted_automation_run_steps,
    'deleted_automation_runs', v_deleted_automation_runs,
    'deleted_automation_events', v_deleted_automation_events
  );
END;
$$;
