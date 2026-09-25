-- =============================================================================
-- Migration 00063: Final Contact Preference & Manual SMS Activity Schema
-- =============================================================================
-- 1. Relaxes public.leads.contact_preference to support:
--    'email', 'sms', 'call', 'whatsapp', and NULL (unspecified / não informada).
-- 2. Removes NOT NULL and removes any DEFAULT 'email' from contact_preference.
-- 3. Extends public.lead_activities.channel check to include 'whatsapp'.
-- 4. Extends public.lead_activities.activity_type check to include
--    'sms_manual_confirmed' and 'whatsapp_contact_confirmed'.
-- 5. Updates public.create_manual_lead RPC to allow NULL and 'whatsapp' preferences
--    without forced fallback to 'email'.
-- =============================================================================

-- 1. Relax leads.contact_preference constraints
ALTER TABLE public.leads
  ALTER COLUMN contact_preference DROP NOT NULL;

ALTER TABLE public.leads
  ALTER COLUMN contact_preference DROP DEFAULT;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_contact_preference_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_contact_preference_check
  CHECK (contact_preference IS NULL OR contact_preference IN ('email', 'sms', 'call', 'whatsapp'));

COMMENT ON COLUMN public.leads.contact_preference IS
  'Official contact preference: email, sms, call, whatsapp, or NULL (não informada). No forced email fallback.';

-- 2. Relax lead_activities channel check to support 'whatsapp'
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_channel_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_channel_check
  CHECK (channel IS NULL OR channel IN ('email', 'sms', 'call', 'whatsapp'));

-- 3. Extend lead_activities activity_type to include manual confirmed events
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
    'automation_failed'::text, 'sequence_started'::text, 'sequence_completed'::text, 
    'sequence_failed'::text, 'sequence_stopped'::text, 'email_reply_received'::text, 
    'sms_reply_received'::text, 'enrollment_created'::text, 'enrollment_confirmed'::text,
    'course_session_assigned'::text, 'course_session_changed'::text, 'attendance_recorded'::text, 
    'course_completed'::text, 'student_no_show'::text, 'checklist_item_updated'::text,
    'post_course_followup_created'::text, 'post_course_followup_completed'::text,
    'feedback_requested'::text, 'feedback_received'::text, 'testimonial_requested'::text,
    'testimonial_received'::text, 'future_course_interest_added'::text, 'task_created'::text,
    'task_rescheduled'::text, 'task_completed'::text,
    'hubspot_contact_linked'::text,
    'hubspot_field_updated'::text,
    'hubspot_outbound_synced'::text,
    'hubspot_sync_conflict'::text,
    'call_manual_attempt'::text,
    'whatsapp_contact_attempt'::text,
    'email_manual_attempt'::text,
    'sms_manual_attempt'::text,
    -- Manual confirmed activity types
    'sms_manual_confirmed'::text,
    'whatsapp_contact_confirmed'::text
  ]));

-- 4. Update create_manual_lead RPC
CREATE OR REPLACE FUNCTION public.create_manual_lead(
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_contact_preference TEXT DEFAULT NULL,
  p_stage_id UUID DEFAULT NULL,
  p_referred_by TEXT DEFAULT NULL,
  p_interests JSONB DEFAULT '[]'::jsonb,
  p_tags UUID[] DEFAULT '{}'::uuid[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead_id UUID;
  v_target_stage_id UUID := p_stage_id;
  v_item JSONB;
  v_interest_count INT := 0;
  v_clean_email TEXT;
  v_clean_phone TEXT;
  v_phone_e164 TEXT;
  v_clean_pref TEXT;
  v_session_course_id UUID;
  v_priority INT;
  v_course_id UUID;
  v_course_session_id UUID;
  v_tag_id UUID;
BEGIN
  -- 1. Security Check: Must be active app user
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active EDS HUB app user'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate essential identity
  v_clean_email := NULLIF(TRIM(LOWER(p_email)), '');
  v_clean_phone := NULLIF(TRIM(p_phone), '');

  IF NULLIF(TRIM(p_first_name), '') IS NULL 
     AND NULLIF(TRIM(p_last_name), '') IS NULL 
     AND v_clean_email IS NULL 
     AND v_clean_phone IS NULL THEN
    RAISE EXCEPTION 'At least a name, email, or phone number must be provided for manual lead creation'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Resolve stage: Default to Novo Lead (code = 'capture') if not specified
  IF v_target_stage_id IS NULL THEN
    SELECT id INTO v_target_stage_id
    FROM public.pipeline_stages
    WHERE code = 'capture'
    LIMIT 1;

    IF v_target_stage_id IS NULL THEN
      SELECT id INTO v_target_stage_id
      FROM public.pipeline_stages
      ORDER BY sort_order ASC
      LIMIT 1;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_target_stage_id) THEN
      RAISE EXCEPTION 'Invalid pipeline stage ID: %', v_target_stage_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 4. Validate phone format
  IF v_clean_phone IS NOT NULL AND v_clean_phone ~ '^\+[1-9][0-9]{7,14}$' THEN
    v_phone_e164 := v_clean_phone;
  ELSE
    v_phone_e164 := NULL;
  END IF;

  -- 5. Validate contact preference constraint (No email fallback; NULL stays NULL)
  v_clean_pref := NULLIF(TRIM(LOWER(p_contact_preference)), '');
  IF v_clean_pref IS NOT NULL AND v_clean_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_clean_pref := NULL;
  END IF;

  -- 6. Validate Interests count <= 3
  IF p_interests IS NOT NULL AND jsonb_typeof(p_interests) = 'array' THEN
    v_interest_count := jsonb_array_length(p_interests);
    IF v_interest_count > 3 THEN
      RAISE EXCEPTION 'A lead can have at most 3 prioritized course interests (received %)', v_interest_count
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 7. Insert into public.leads
  INSERT INTO public.leads (
    first_name,
    last_name,
    email,
    phone_raw,
    phone_e164,
    contact_preference,
    pipeline_stage_id,
    referred_by,
    source,
    source_detail
  ) VALUES (
    NULLIF(TRIM(p_first_name), ''),
    NULLIF(TRIM(p_last_name), ''),
    v_clean_email,
    v_clean_phone,
    v_phone_e164,
    v_clean_pref,
    v_target_stage_id,
    NULLIF(TRIM(p_referred_by), ''),
    'manual',
    'manual_crm_entry'
  )
  RETURNING id INTO v_lead_id;

  -- 8. Record lead_created activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    v_lead_id,
    'lead_created',
    'user',
    'Lead criado manualmente no EDS HUB',
    jsonb_build_object(
      'source', 'manual',
      'source_detail', 'manual_crm_entry',
      'stage_id', v_target_stage_id,
      'contact_preference', v_clean_pref,
      'interests_count', v_interest_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id
  );
END;
$$;
