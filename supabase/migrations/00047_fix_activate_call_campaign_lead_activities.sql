-- =============================================================================
-- Migration 00047: Fix activate_call_campaign lead_activities columns
-- =============================================================================
-- public.lead_activities uses `actor_type` and `summary` (not title/description).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.activate_call_campaign(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_audience RECORD;
  v_rec RECORD;
  v_tasks_created INT := 0;
  v_tasks_skipped INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Caller is not an active app user.';
  END IF;

  -- 1. Validate Campaign
  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign % not found.', p_campaign_id;
  END IF;

  IF v_campaign.channel != 'call' THEN
    RAISE EXCEPTION 'Cannot activate call campaign on channel %. Campaign channel must be call.', v_campaign.channel;
  END IF;

  -- 2. Verify Campaign Audience is Prepared
  SELECT * INTO v_audience
  FROM public.campaign_audiences
  WHERE campaign_id = p_campaign_id;

  IF NOT FOUND OR v_audience.snapshot_frozen_at IS NULL THEN
    RAISE EXCEPTION 'Audience snapshot has not been prepared for campaign %. Click Prepare Audience first.', p_campaign_id;
  END IF;

  -- 3. Iterate ONLY Eligible Call Recipients
  FOR v_rec IN 
    SELECT 
      r.lead_id,
      r.phone_e164,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, 'Lead') AS lead_name
    FROM public.campaign_recipients r
    JOIN public.leads l ON l.id = r.lead_id
    WHERE r.campaign_id = p_campaign_id
      AND r.is_eligible = true
      AND r.channel = 'call'
  LOOP
    -- Strict Idempotency: Check if pending task already exists for this lead & campaign
    IF EXISTS (
      SELECT 1 FROM public.tasks
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_rec.lead_id
        AND status = 'pending'
    ) THEN
      v_tasks_skipped := v_tasks_skipped + 1;
    ELSE
      -- Create Deduplicated Task
      INSERT INTO public.tasks (
        lead_id,
        campaign_id,
        task_type,
        task_source,
        title,
        description,
        priority,
        status,
        due_at,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        v_rec.lead_id,
        p_campaign_id,
        'call',
        'campaign',
        'Call Campaign: ' || v_campaign.name || ' — ' || v_rec.lead_name,
        'Outreach scheduled from Call Campaign "' || v_campaign.name || '". Preferred Channel: Call. Phone: ' || COALESCE(v_rec.phone_e164, 'N/A'),
        'normal',
        'pending',
        v_now,
        'system',
        v_now,
        v_now
      );

      -- Record activity in lead audit log using canonical columns
      INSERT INTO public.lead_activities (
        lead_id,
        activity_type,
        actor_type,
        summary,
        metadata,
        created_at
      ) VALUES (
        v_rec.lead_id,
        'call_task_created',
        'system',
        'Call Campaign task scheduled: ' || v_campaign.name,
        jsonb_build_object('campaign_id', p_campaign_id, 'campaign_name', v_campaign.name),
        v_now
      );

      v_tasks_created := v_tasks_created + 1;
    END IF;
  END LOOP;

  -- 4. Update Campaign State
  UPDATE public.campaigns
  SET 
    status = 'sent',
    activated_at = v_now,
    updated_at = v_now
  WHERE id = p_campaign_id;

  -- 5. Mark eligible recipients as sent (dispatched to call queue)
  UPDATE public.campaign_recipients
  SET 
    status = 'sent',
    sent_at = v_now,
    updated_at = v_now
  WHERE campaign_id = p_campaign_id
    AND is_eligible = true;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'tasks_created', v_tasks_created,
    'tasks_skipped_idempotent', v_tasks_skipped,
    'activated_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_call_campaign TO authenticated;
