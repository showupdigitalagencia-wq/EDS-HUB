-- =============================================================================
-- Migration 015: Phase 2 Schema Extensions & Move Lead Stage RPC
-- =============================================================================
-- 1. Extend lead_stage_history change_reason to include 'manual'.
-- 2. Extend lead_activities activity_type to include Phase 2 activities.
-- 3. Create transactional move_lead_stage RPC function for atomic stage change.
--    (Pre-condition: public.lead_notes already exists from Migration 014)
-- =============================================================================

-- 1. Extend lead_stage_history change_reason check constraint
ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN ('initial_assignment', 'auto_after_intake', 'manual'));

-- 2. Extend lead_activities activity_type check constraint
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type IN (
    'lead_created', 'intake_received', 'email_dispatched',
    'sms_dispatched', 'call_task_created', 'stage_changed',
    'processing_failed', 'note_created', 'tag_added', 'tag_removed', 'campaign_sent'
  ));

-- 3. Atomic RPC function for manual stage movement in Kanban
CREATE OR REPLACE FUNCTION public.move_lead_stage(
  p_lead_id UUID,
  p_new_stage_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stage_id UUID;
  v_from_stage_name TEXT;
  v_to_stage_name TEXT;
  v_user_id UUID;
BEGIN
  -- Authorization check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active app_user';
  END IF;

  v_user_id := auth.uid();

  -- Lock lead row and get current stage
  SELECT pipeline_stage_id INTO v_current_stage_id
  FROM public.leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found with id %', p_lead_id;
  END IF;

  -- If stage is identical, no-op
  IF v_current_stage_id = p_new_stage_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'lead_id', p_lead_id,
      'stage_id', p_new_stage_id,
      'changed', false
    );
  END IF;

  -- Validate destination stage exists
  SELECT name INTO v_to_stage_name
  FROM public.pipeline_stages
  WHERE id = p_new_stage_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination pipeline stage not found or inactive: %', p_new_stage_id;
  END IF;

  -- Get origin stage name
  SELECT name INTO v_from_stage_name
  FROM public.pipeline_stages
  WHERE id = v_current_stage_id;

  -- 1. Update lead stage
  UPDATE public.leads
  SET pipeline_stage_id = p_new_stage_id,
      updated_at = now()
  WHERE id = p_lead_id;

  -- 2. Insert immutable history
  INSERT INTO public.lead_stage_history (
    lead_id,
    from_stage_id,
    to_stage_id,
    change_reason,
    changed_by_user_id
  ) VALUES (
    p_lead_id,
    v_current_stage_id,
    p_new_stage_id,
    'manual',
    v_user_id
  );

  -- 3. Insert activity audit log
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    'stage_changed',
    'user',
    format('Lead moved from %s to %s manually', COALESCE(v_from_stage_name, 'Unknown'), v_to_stage_name),
    jsonb_build_object(
      'from_stage_id', v_current_stage_id,
      'to_stage_id', p_new_stage_id,
      'from_stage_name', v_from_stage_name,
      'to_stage_name', v_to_stage_name,
      'note', p_note
    )
  );

  -- 4. If an optional note was provided, save to lead_notes
  IF p_note IS NOT NULL AND trim(p_note) <> '' THEN
    INSERT INTO public.lead_notes (
      lead_id,
      content,
      created_by_user_id
    ) VALUES (
      p_lead_id,
      trim(p_note),
      v_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'from_stage_id', v_current_stage_id,
    'to_stage_id', p_new_stage_id,
    'changed', true
  );
END;
$$;

COMMENT ON FUNCTION public.move_lead_stage(UUID, UUID, TEXT) IS
  'Atomically moves a lead to a new pipeline stage, records stage history and logs activity.';
