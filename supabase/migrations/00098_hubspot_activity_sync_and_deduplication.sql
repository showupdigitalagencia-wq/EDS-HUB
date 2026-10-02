-- =============================================================================
-- Migration 00098: HubSpot Activity Sync, Canonical Architecture & Deduplication
-- =============================================================================

-- 1. Add external_activity_id to lead_activities with unique index
ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS external_activity_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_external_activity_id
  ON public.lead_activities (external_activity_id)
  WHERE external_activity_id IS NOT NULL;

-- 2. Add external_task_id to tasks with unique index
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS external_task_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external_task_id
  ON public.tasks (external_task_id)
  WHERE external_task_id IS NOT NULL;

-- 3. Extend tasks_task_source_check to include 'hubspot'
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_source_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_source_check
  CHECK (task_source IN (
    'manual',
    'automation',
    'system',
    'course_operations',
    'post_course',
    'campaign',
    'incomplete_enrollment',
    'hubspot'
  ));

-- 4. Extend lead_activities_activity_type_check to include HubSpot canonical activities
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type IN (
    'lead_created',
    'lead_field_updated',
    'intake_received',
    'email_dispatched',
    'sms_dispatched',
    'call_task_created',
    'stage_changed',
    'processing_failed',
    'note_created',
    'tag_added',
    'tag_removed',
    'campaign_sent',
    'contact_preference_detected',
    'email_selected',
    'sms_selected',
    'call_selected',
    'channel_skipped',
    'csv_status_unmapped',
    'qualification_status_changed',
    'form_submitted',
    'automation_started',
    'automation_completed',
    'automation_failed',
    'sequence_started',
    'sequence_completed',
    'sequence_failed',
    'sequence_stopped',
    'email_reply_received',
    'sms_reply_received',
    'enrollment_created',
    'enrollment_confirmed',
    'course_session_assigned',
    'course_session_changed',
    'attendance_recorded',
    'course_completed',
    'student_no_show',
    'checklist_item_updated',
    'post_course_followup_created',
    'post_course_followup_completed',
    'feedback_requested',
    'feedback_received',
    'testimonial_requested',
    'testimonial_received',
    'future_course_interest_added',
    'task_created',
    'task_rescheduled',
    'task_completed',
    'hubspot_contact_linked',
    'hubspot_field_updated',
    'hubspot_outbound_synced',
    'hubspot_sync_conflict',
    'call_manual_attempt',
    'whatsapp_contact_attempt',
    'email_manual_attempt',
    'sms_manual_attempt',
    'sms_manual_confirmed',
    'whatsapp_contact_confirmed',
    'incomplete_enrollment_captured',
    'incomplete_enrollment_recovered',
    'incomplete_enrollment_dismissed',
    'email_sent',
    'email_delivered',
    'email_opened',
    'email_clicked',
    'email_delivery_delayed',
    'email_bounced',
    'email_complained',
    'email_failed',
    'email_suppressed',
    'email_unsubscribed',
    'manual_activity_logged',
    'manual_email_sent',
    'manual_sms_sent',
    'manual_call_logged',
    'manual_whatsapp_sent',
    'manual_contact_made',
    'call_logged',
    'meeting_logged',
    'sms_logged',
    'hubspot_activity_synced'
  ));

-- 5. Extend lead_activities_channel_check to allow 'meeting'
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_channel_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_channel_check
  CHECK (
    channel IS NULL OR
    channel IN ('email', 'sms', 'call', 'whatsapp', 'meeting')
  );

-- 6. Add last_activity_sync_at to integration_connections if needed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integration_connections') THEN
    ALTER TABLE public.integration_connections
      ADD COLUMN IF NOT EXISTS last_activity_sync_at TIMESTAMPTZ NULL;
  END IF;
END $$;

-- 7. Batch Idempotent Synchronization RPC
CREATE OR REPLACE FUNCTION public.sync_hubspot_activities_batch(
  p_activities JSONB DEFAULT '[]'::jsonb,
  p_tasks JSONB DEFAULT '[]'::jsonb,
  p_form_submissions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_act_inserted INT := 0;
  v_act_updated INT := 0;
  v_act_ignored INT := 0;
  v_task_inserted INT := 0;
  v_task_updated INT := 0;
  v_task_ignored INT := 0;
  v_forms_inserted INT := 0;
  v_forms_ignored INT := 0;
  v_item JSONB;
  v_lead_id UUID;
  v_ext_id TEXT;
  v_task_ext_id TEXT;
  v_form_key TEXT;
  v_exists BOOLEAN;
BEGIN
  -- 1. Sync Activities
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_activities)
  LOOP
    v_lead_id := (v_item->>'lead_id')::uuid;
    v_ext_id := v_item->>'external_activity_id';

    IF v_lead_id IS NOT NULL AND v_ext_id IS NOT NULL THEN
      -- Check if activity already exists
      SELECT EXISTS(SELECT 1 FROM public.lead_activities WHERE external_activity_id = v_ext_id) INTO v_exists;

      IF v_exists THEN
        -- Update activity metadata idempotently
        UPDATE public.lead_activities
        SET
          summary = COALESCE(v_item->>'summary', summary),
          metadata = COALESCE(v_item->'metadata', metadata)
        WHERE external_activity_id = v_ext_id;
        v_act_updated := v_act_updated + 1;
      ELSE
        INSERT INTO public.lead_activities (
          lead_id,
          external_activity_id,
          activity_type,
          channel,
          actor_type,
          summary,
          metadata,
          created_at
        ) VALUES (
          v_lead_id,
          v_ext_id,
          v_item->>'activity_type',
          v_item->>'channel',
          COALESCE(v_item->>'actor_type', 'system'),
          COALESCE(v_item->>'summary', 'Atividade HubSpot'),
          COALESCE(v_item->'metadata', '{}'::jsonb),
          COALESCE((v_item->>'created_at')::timestamptz, now())
        );
        v_act_inserted := v_act_inserted + 1;
      END IF;
    ELSE
      v_act_ignored := v_act_ignored + 1;
    END IF;
  END LOOP;

  -- 2. Sync Actionable Tasks
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tasks)
  LOOP
    v_lead_id := (v_item->>'lead_id')::uuid;
    v_task_ext_id := v_item->>'external_task_id';

    IF v_lead_id IS NOT NULL AND v_task_ext_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.tasks WHERE external_task_id = v_task_ext_id) INTO v_exists;

      IF v_exists THEN
        UPDATE public.tasks
        SET
          status = COALESCE(v_item->>'status', status),
          completed_at = CASE 
            WHEN v_item->>'status' = 'completed' THEN COALESCE((v_item->>'completed_at')::timestamptz, now())
            ELSE completed_at
          END,
          title = COALESCE(v_item->>'title', title),
          description = COALESCE(v_item->>'description', description),
          due_at = CASE WHEN v_item ? 'due_at' THEN (v_item->>'due_at')::timestamptz ELSE due_at END,
          priority = COALESCE(v_item->>'priority', priority),
          updated_at = now()
        WHERE external_task_id = v_task_ext_id;
        v_task_updated := v_task_updated + 1;
      ELSE
        INSERT INTO public.tasks (
          lead_id,
          external_task_id,
          task_type,
          task_source,
          title,
          description,
          status,
          due_at,
          completed_at,
          priority,
          created_by
        ) VALUES (
          v_lead_id,
          v_task_ext_id,
          COALESCE(v_item->>'task_type', 'general'),
          'hubspot',
          COALESCE(v_item->>'title', 'Tarefa HubSpot'),
          v_item->>'description',
          COALESCE(v_item->>'status', 'pending'),
          (v_item->>'due_at')::timestamptz,
          CASE WHEN v_item->>'status' = 'completed' THEN COALESCE((v_item->>'completed_at')::timestamptz, now()) ELSE NULL END,
          COALESCE(v_item->>'priority', 'normal'),
          'system'
        );
        v_task_inserted := v_task_inserted + 1;
      END IF;
    ELSE
      v_task_ignored := v_task_ignored + 1;
    END IF;
  END LOOP;

  -- 3. Sync Recovered Form Submissions
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_form_submissions)
  LOOP
    v_lead_id := (v_item->>'lead_id')::uuid;
    v_form_key := v_item->>'idempotency_key';

    IF v_lead_id IS NOT NULL AND v_form_key IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.form_submissions WHERE idempotency_key = v_form_key) INTO v_exists;

      IF NOT v_exists THEN
        INSERT INTO public.form_submissions (
          lead_id,
          idempotency_key,
          form_name,
          form_version,
          source,
          source_detail,
          processing_status,
          recovery_state,
          submitted_at,
          submitted_data
        ) VALUES (
          v_lead_id,
          v_form_key,
          COALESCE(v_item->>'form_name', 'HubSpot Conversion Form'),
          1,
          'hubspot',
          'hubspot_conversion',
          'historical_backfill',
          'recovered_from_hubspot',
          COALESCE((v_item->>'submitted_at')::timestamptz, now()),
          COALESCE(v_item->'submitted_data', '{}'::jsonb)
        );
        v_forms_inserted := v_forms_inserted + 1;
      ELSE
        v_forms_ignored := v_forms_ignored + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'activities_inserted', v_act_inserted,
    'activities_updated', v_act_updated,
    'activities_ignored', v_act_ignored,
    'tasks_inserted', v_task_inserted,
    'tasks_updated', v_task_updated,
    'tasks_ignored', v_task_ignored,
    'forms_inserted', v_forms_inserted,
    'forms_ignored', v_forms_ignored
  );
END;
$$;
