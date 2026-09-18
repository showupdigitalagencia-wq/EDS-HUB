-- =============================================================================
-- Migration 00048: Enforce Permanent Call Campaign Idempotency
-- =============================================================================
-- Guarantees that for a given campaign snapshot, exactly one call task can ever
-- be created per recipient, even if the previously generated task is completed
-- or closed. Re-running activate_call_campaign is strictly and permanently idempotent.
-- =============================================================================

-- 1. Add activated_at to public.campaign_recipients for snapshot audit tracking
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL;

-- 2. Partial unique index to enforce database-level single task per (campaign_id, lead_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_campaign_lead_permanent
  ON public.tasks(campaign_id, lead_id)
  WHERE campaign_id IS NOT NULL;

-- 3. Replace activate_call_campaign with permanent idempotency semantics
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
      r.activated_at,
      COALESCE(l.first_name || ' ' || l.last_name, l.first_name, 'Lead') AS lead_name
    FROM public.campaign_recipients r
    JOIN public.leads l ON l.id = r.lead_id
    WHERE r.campaign_id = p_campaign_id
      AND r.is_eligible = true
      AND r.channel = 'call'
  LOOP
    -- Permanent Idempotency Check:
    -- Never generate a second task if a task was ever created for this campaign + lead,
    -- or if the recipient has already been activated in this snapshot.
    IF v_rec.activated_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.tasks
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_rec.lead_id
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

      -- Record recipient activation timestamp
      UPDATE public.campaign_recipients
      SET activated_at = v_now,
          status = 'activated'
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_rec.lead_id;

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

  -- 4. Update campaign status if still in draft
  UPDATE public.campaigns
  SET status = CASE WHEN status = 'draft' THEN 'scheduled' ELSE status END,
      updated_at = v_now
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'tasks_created', v_tasks_created,
    'tasks_skipped_idempotent', v_tasks_skipped,
    'activated_at', v_now
  );
END;
$$;
