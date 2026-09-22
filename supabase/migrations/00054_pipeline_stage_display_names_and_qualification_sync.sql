-- =============================================================================
-- Migration 00054: Pipeline Stage Display Names & Single-Source Qualification Sync
-- =============================================================================
-- 1. Updates operational pipeline stage display names (canonical codes preserved):
--    - capture -> 'Novo Lead'
--    - qualification -> 'Respondido'
--    - acquisition -> 'Interessado'
--    - approval -> 'Quente'
--    - enrollment -> 'Matrícula'
--    (post_course and alumni remain in backend)
-- 2. Creates single authoritative source of truth for qualification_status mirroring
--    via trigger: trg_leads_sync_qualification_status on public.leads.
-- 3. Updates move_lead_stage RPC to rely entirely on this trigger without performing
--    duplicate or competing qualification updates.
-- =============================================================================

-- 1. Update operational display names
UPDATE public.pipeline_stages SET name = 'Novo Lead', updated_at = now() WHERE code = 'capture';
UPDATE public.pipeline_stages SET name = 'Respondido', updated_at = now() WHERE code = 'qualification';
UPDATE public.pipeline_stages SET name = 'Interessado', updated_at = now() WHERE code = 'acquisition';
UPDATE public.pipeline_stages SET name = 'Quente', updated_at = now() WHERE code = 'approval';
UPDATE public.pipeline_stages SET name = 'Matrícula', updated_at = now() WHERE code = 'enrollment';

-- 2. Authoritative Single-Source Trigger Function for Qualification Status Mirroring
CREATE OR REPLACE FUNCTION public.trg_sync_qualification_status_from_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_code TEXT;
BEGIN
  -- Only evaluate when pipeline_stage_id is set on insert or modified on update
  IF (TG_OP = 'INSERT' AND NEW.pipeline_stage_id IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND NEW.pipeline_stage_id IS DISTINCT FROM OLD.pipeline_stage_id) THEN
    
    SELECT code INTO v_stage_code
    FROM public.pipeline_stages
    WHERE id = NEW.pipeline_stage_id;

    IF v_stage_code = 'capture' THEN
      NEW.qualification_status := 'no_response';
    ELSIF v_stage_code = 'qualification' THEN
      NEW.qualification_status := 'some_response';
    ELSIF v_stage_code = 'acquisition' THEN
      NEW.qualification_status := 'interested';
    ELSIF v_stage_code = 'approval' THEN
      NEW.qualification_status := 'hot';
    ELSIF v_stage_code = 'enrollment' THEN
      NEW.qualification_status := 'confirmed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_sync_qualification_status_from_stage() IS
  'Authoritative background synchronization of qualification_status from pipeline_stage_id without recursion.';

-- Attach BEFORE trigger to public.leads
DROP TRIGGER IF EXISTS trg_leads_sync_qualification_status ON public.leads;

CREATE TRIGGER trg_leads_sync_qualification_status
  BEFORE INSERT OR UPDATE OF pipeline_stage_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_qualification_status_from_stage();

-- 3. Update move_lead_stage RPC to let the trigger manage qualification_status atomically
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
  v_new_qual_status TEXT;
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

  -- 1. Update lead stage only.
  -- The BEFORE UPDATE trigger trg_leads_sync_qualification_status automatically
  -- mirrors qualification_status in this exact single atomic row update.
  UPDATE public.leads
  SET pipeline_stage_id = p_new_stage_id,
      updated_at = now()
  WHERE id = p_lead_id
  RETURNING qualification_status INTO v_new_qual_status;

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
      'qualification_status', v_new_qual_status,
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
    'qualification_status', v_new_qual_status,
    'changed', true
  );
END;
$$;

COMMENT ON FUNCTION public.move_lead_stage(UUID, UUID, TEXT) IS
  'Atomically moves a lead to a new pipeline stage, mirrors qualification_status via trigger, and logs history and activity.';
