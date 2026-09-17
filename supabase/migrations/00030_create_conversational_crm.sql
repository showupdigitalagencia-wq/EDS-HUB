-- =============================================================================
-- Migration 00030: Phase 3 Block 4 — Inbound Responses & Conversational CRM
-- =============================================================================
-- 1. Create conversations table (threaded by lead + channel / thread root)
-- 2. Create inbound_messages table (safe metadata, idempotency)
-- 3. Update outbound_messages (conversation_id, is_manual_reply, actor_id)
-- 4. Update leads (last_response_at)
-- 5. Update automations & automation_versions (stop_on_response)
-- 6. Update lead_activities activity_type constraint (email_reply_received, sms_reply_received)
-- 7. Create private transactional RPC ingest_inbound_message_transaction
-- 8. Create conversation helper RPCs (mark_conversation_read, close_conversation, reopen_conversation, get_conversation_metrics)
-- 9. Update purge_all_contacts & get_contacts_purge_preview
-- 10. Configure RLS policies
-- =============================================================================

-- 1. Create conversations table
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  external_thread_id TEXT NULL,
  subject TEXT NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview TEXT NULL,
  last_message_direction TEXT NULL CHECK (last_message_direction IN ('inbound', 'outbound')),
  closed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SMS: 1 persistent conversation per lead
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_lead_sms 
  ON public.conversations(lead_id) 
  WHERE channel = 'sms';

-- Email: multi-thread indexing
CREATE INDEX IF NOT EXISTS idx_conversations_lead_channel 
  ON public.conversations(lead_id, channel);

CREATE INDEX IF NOT EXISTS idx_conversations_external_thread 
  ON public.conversations(external_thread_id) 
  WHERE external_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at 
  ON public.conversations(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_status 
  ON public.conversations(status);

COMMENT ON TABLE public.conversations IS
  'Unified conversational CRM threads between EDS HUB and leads. Single continuous thread for SMS; thread-aware for email.';


-- 2. Create inbound_messages table
CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  conversation_id UUID NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'twilio')),
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'conflict', 'failed')),
  conflict_reason TEXT NULL,
  processing_error TEXT NULL,
  read_at TIMESTAMPTZ NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_inbound_provider_message UNIQUE(provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_lead 
  ON public.inbound_messages(lead_id);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_conversation 
  ON public.inbound_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_read_at 
  ON public.inbound_messages(read_at);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_processing 
  ON public.inbound_messages(processing_status);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_received_at 
  ON public.inbound_messages(received_at DESC);

COMMENT ON TABLE public.inbound_messages IS
  'Inbound messages received via Resend (email) or Twilio (SMS). Idempotent on (provider, provider_message_id).';


-- 3. Update outbound_messages
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_manual_reply BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actor_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS in_reply_to_provider_message_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_conversation 
  ON public.outbound_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_provider_msg_id 
  ON public.outbound_messages(provider_message_id);


-- 4. Update leads: last_response_at
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_leads_last_response_at 
  ON public.leads(last_response_at) 
  WHERE last_response_at IS NOT NULL;


-- 5. Update automations and automation_versions: stop_on_response
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS stop_on_response BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.automation_versions
  ADD COLUMN IF NOT EXISTS stop_on_response BOOLEAN NOT NULL DEFAULT true;


-- 6. Update lead_activities activity_type check constraint
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
    'email_reply_received'::text, 'sms_reply_received'::text
  ]));


-- 7. Private Transactional Ingestion RPC
CREATE OR REPLACE FUNCTION public.ingest_inbound_message_transaction(
  p_channel TEXT,
  p_provider TEXT,
  p_provider_message_id TEXT,
  p_from_address TEXT,
  p_to_address TEXT,
  p_subject TEXT,
  p_body_text TEXT,
  p_body_html TEXT DEFAULT NULL,
  p_attachments JSONB DEFAULT '[]'::jsonb,
  p_raw_metadata JSONB DEFAULT '{}'::jsonb,
  p_in_reply_to TEXT DEFAULT NULL,
  p_references TEXT DEFAULT NULL,
  p_provider_thread_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_matched_lead_id UUID := NULL;
  v_matched_conv_id UUID := NULL;
  v_candidate_leads UUID[];
  v_is_conflict BOOLEAN := false;
  v_conflict_reason TEXT := NULL;
  v_inbound_id UUID;
  v_conv_id UUID;
  v_current_qual TEXT;
  v_run RECORD;
  v_lead_name TEXT;
  v_clean_phone TEXT;
BEGIN
  -- 1. Idempotency check: If already ingested, return existing row
  SELECT id, processing_status, lead_id, conversation_id
  INTO v_existing
  FROM public.inbound_messages
  WHERE provider = p_provider AND provider_message_id = p_provider_message_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'already_processed', true,
      'inbound_message_id', v_existing.id,
      'lead_id', v_existing.lead_id,
      'conversation_id', v_existing.conversation_id,
      'processing_status', v_existing.processing_status
    );
  END IF;

  -- 2. Lead Matching Logic
  IF p_channel = 'email' THEN
    -- Priority 1: In-Reply-To or References matching previous outbound message
    IF p_in_reply_to IS NOT NULL AND length(trim(p_in_reply_to)) > 0 THEN
      SELECT om.lead_id, om.conversation_id
      INTO v_matched_lead_id, v_matched_conv_id
      FROM public.outbound_messages om
      WHERE om.provider_message_id = trim(p_in_reply_to)
         OR om.idempotency_key = trim(p_in_reply_to)
      LIMIT 1;
    END IF;

    IF v_matched_lead_id IS NULL AND p_references IS NOT NULL AND length(trim(p_references)) > 0 THEN
      SELECT om.lead_id, om.conversation_id
      INTO v_matched_lead_id, v_matched_conv_id
      FROM public.outbound_messages om
      WHERE position(om.provider_message_id in p_references) > 0
      ORDER BY om.created_at DESC
      LIMIT 1;
    END IF;

    -- Verify that the header-matched lead doesn't conflict with sender email
    IF v_matched_lead_id IS NOT NULL THEN
      PERFORM 1 FROM public.leads 
      WHERE id = v_matched_lead_id AND lower(email) = lower(trim(p_from_address));
      
      IF NOT FOUND THEN
        -- Conflicting header vs sender lead!
        v_is_conflict := true;
        v_conflict_reason := 'HEADER_SENDER_MISMATCH: References point to lead ' || v_matched_lead_id || ' but sender is ' || p_from_address;
        v_matched_lead_id := NULL;
        v_matched_conv_id := NULL;
      END IF;
    END IF;

    -- Priority 2: Direct match by normalized sender email
    IF v_matched_lead_id IS NULL AND NOT v_is_conflict THEN
      SELECT array_agg(id)
      INTO v_candidate_leads
      FROM public.leads
      WHERE lower(email) = lower(trim(p_from_address));

      IF array_length(v_candidate_leads, 1) = 1 THEN
        v_matched_lead_id := v_candidate_leads[1];
      ELSIF array_length(v_candidate_leads, 1) > 1 THEN
        v_is_conflict := true;
        v_conflict_reason := 'AMBIGUOUS_EMAIL_MATCH: Multiple leads match sender ' || p_from_address;
      END IF;
    END IF;

  ELSIF p_channel = 'sms' THEN
    -- Normalize phone
    v_clean_phone := trim(p_from_address);

    -- Priority 1: Match phone_e164 or phone_raw
    SELECT array_agg(id)
    INTO v_candidate_leads
    FROM public.leads
    WHERE phone_e164 = v_clean_phone 
       OR phone_raw = v_clean_phone
       OR replace(replace(replace(replace(phone_raw, ' ', ''), '-', ''), '(', ''), ')', '') = v_clean_phone;

    IF array_length(v_candidate_leads, 1) = 1 THEN
      v_matched_lead_id := v_candidate_leads[1];
    ELSIF array_length(v_candidate_leads, 1) > 1 THEN
      v_is_conflict := true;
      v_conflict_reason := 'AMBIGUOUS_PHONE_MATCH: Multiple leads match phone ' || v_clean_phone;
    END IF;
  END IF;

  -- 3. Resolve / Create Conversation
  IF v_matched_lead_id IS NOT NULL AND NOT v_is_conflict THEN
    IF p_channel = 'sms' THEN
      -- SMS: Continuous conversation per lead
      SELECT id INTO v_conv_id
      FROM public.conversations
      WHERE lead_id = v_matched_lead_id AND channel = 'sms'
      LIMIT 1;

      IF v_conv_id IS NOT NULL THEN
        UPDATE public.conversations
        SET status = 'open',
            closed_at = NULL,
            last_message_at = now(),
            last_message_preview = left(p_body_text, 120),
            last_message_direction = 'inbound',
            updated_at = now()
        WHERE id = v_conv_id;
      ELSE
        INSERT INTO public.conversations (
          lead_id, channel, status, external_thread_id,
          last_message_at, last_message_preview, last_message_direction
        )
        VALUES (
          v_matched_lead_id, 'sms', 'open', v_clean_phone,
          now(), left(p_body_text, 120), 'inbound'
        )
        RETURNING id INTO v_conv_id;
      END IF;

    ELSE
      -- EMAIL: Thread-aware conversation
      IF v_matched_conv_id IS NOT NULL THEN
        v_conv_id := v_matched_conv_id;
        UPDATE public.conversations
        SET status = 'open',
            closed_at = NULL,
            last_message_at = now(),
            last_message_preview = left(p_body_text, 120),
            last_message_direction = 'inbound',
            updated_at = now()
        WHERE id = v_conv_id;
      ELSE
        -- Check if there's an existing conversation with matching external_thread_id
        IF p_in_reply_to IS NOT NULL OR p_provider_thread_id IS NOT NULL THEN
          SELECT id INTO v_conv_id
          FROM public.conversations
          WHERE lead_id = v_matched_lead_id 
            AND channel = 'email'
            AND (external_thread_id = p_in_reply_to OR external_thread_id = p_provider_thread_id)
          LIMIT 1;
        END IF;

        IF v_conv_id IS NOT NULL THEN
          UPDATE public.conversations
          SET status = 'open',
              closed_at = NULL,
              last_message_at = now(),
              last_message_preview = left(p_body_text, 120),
              last_message_direction = 'inbound',
              updated_at = now()
          WHERE id = v_conv_id;
        ELSE
          -- Create a new separate email conversation thread
          INSERT INTO public.conversations (
            lead_id, channel, status, external_thread_id, subject,
            last_message_at, last_message_preview, last_message_direction
          )
          VALUES (
            v_matched_lead_id, 'email', 'open',
            COALESCE(p_provider_thread_id, p_in_reply_to, p_provider_message_id),
            p_subject,
            now(), left(p_body_text, 120), 'inbound'
          )
          RETURNING id INTO v_conv_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 4. Ingest Inbound Message
  INSERT INTO public.inbound_messages (
    lead_id, conversation_id, channel, provider, provider_message_id,
    provider_thread_id, from_address, to_address, subject, body_text,
    body_html, attachments, raw_metadata, processing_status, conflict_reason,
    received_at
  )
  VALUES (
    v_matched_lead_id, v_conv_id, p_channel, p_provider, p_provider_message_id,
    p_provider_thread_id, p_from_address, p_to_address, p_subject, p_body_text,
    p_body_html, p_attachments, p_raw_metadata,
    CASE 
      WHEN v_is_conflict THEN 'conflict'
      WHEN v_matched_lead_id IS NULL THEN 'received'
      ELSE 'processed'
    END,
    v_conflict_reason,
    now()
  )
  RETURNING id INTO v_inbound_id;

  -- 5. Downstream Reactions (Only for valid matched lead without conflict)
  IF v_matched_lead_id IS NOT NULL AND NOT v_is_conflict THEN
    -- 5.1 Update Lead canonical last_response_at
    UPDATE public.leads
    SET last_response_at = now(),
        updated_at = now()
    WHERE id = v_matched_lead_id;

    -- 5.2 Qualification Status Transition: no_response -> some_response
    SELECT qualification_status INTO v_current_qual
    FROM public.leads
    WHERE id = v_matched_lead_id;

    IF v_current_qual = 'no_response' OR v_current_qual IS NULL THEN
      UPDATE public.leads
      SET qualification_status = 'some_response',
          updated_at = now()
      WHERE id = v_matched_lead_id;

      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      )
      VALUES (
        v_matched_lead_id, 'qualification_status_changed', 'system',
        'Qualification updated to Some Response (Inbound ' || upper(p_channel) || ')',
        jsonb_build_object(
          'qualification_status', 'some_response',
          'previous_status', v_current_qual,
          'trigger', 'inbound_message',
          'channel', p_channel,
          'inbound_message_id', v_inbound_id
        )
      );
    END IF;

    -- 5.3 Stop Active Sequences configured with stop_on_response = true
    FOR v_run IN (
      SELECT r.id, r.automation_id, a.name AS auto_name
      FROM public.automation_runs r
      JOIN public.automation_versions v ON r.automation_version_id = v.id
      JOIN public.automations a ON r.automation_id = a.id
      WHERE r.lead_id = v_matched_lead_id
        AND r.status IN ('pending', 'running', 'waiting', 'paused')
        AND v.stop_on_response = true
    ) LOOP
      -- Cancel all remaining pending jobs for this run
      UPDATE public.automation_jobs
      SET status = 'cancelled'
      WHERE automation_run_id = v_run.id AND status = 'pending';

      -- Set run status to stopped_by_condition
      UPDATE public.automation_runs
      SET status = 'stopped_by_condition',
          run_control_status = 'stopped',
          stop_reason_code = 'LEAD_REPLIED',
          stop_reason_message = 'Lead replied via ' || upper(p_channel),
          completed_at = now(),
          updated_at = now()
      WHERE id = v_run.id;

      -- Log sequence_stopped activity milestone
      INSERT INTO public.lead_activities (
        lead_id, automation_run_id, activity_type, actor_type, summary, metadata
      )
      VALUES (
        v_matched_lead_id, v_run.id, 'sequence_stopped', 'system',
        'Sequence "' || v_run.auto_name || '" stopped: Lead replied via ' || upper(p_channel),
        jsonb_build_object(
          'stop_reason_code', 'LEAD_REPLIED',
          'channel', p_channel,
          'inbound_message_id', v_inbound_id,
          'conversation_id', v_conv_id
        )
      );
    END LOOP;

    -- 5.4 Emit lead_replied Automation Event
    INSERT INTO public.automation_events (
      event_type, lead_id, source_table, source_record_id, source_event_key, payload, status
    )
    VALUES (
      'lead_replied',
      v_matched_lead_id,
      'inbound_messages',
      v_inbound_id,
      'lead_replied:' || v_inbound_id,
      jsonb_build_object(
        'lead_id', v_matched_lead_id,
        'channel', p_channel,
        'inbound_message_id', v_inbound_id,
        'conversation_id', v_conv_id
      ),
      'pending'
    )
    ON CONFLICT (source_event_key) DO NOTHING;

    -- 5.5 Emit Timeline Activity Milestone (safe summary, no full raw body)
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    )
    VALUES (
      v_matched_lead_id,
      CASE WHEN p_channel = 'email' THEN 'email_reply_received' ELSE 'sms_reply_received' END,
      'system',
      CASE 
        WHEN p_channel = 'email' THEN 'Email reply received: ' || left(COALESCE(p_subject, '(No Subject)'), 60)
        ELSE 'SMS reply received from ' || p_from_address
      END,
      jsonb_build_object(
        'channel', p_channel,
        'inbound_message_id', v_inbound_id,
        'conversation_id', v_conv_id,
        'provider_message_id', p_provider_message_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inbound_message_id', v_inbound_id,
    'conversation_id', v_conv_id,
    'lead_id', v_matched_lead_id,
    'processing_status', CASE 
      WHEN v_is_conflict THEN 'conflict'
      WHEN v_matched_lead_id IS NULL THEN 'received'
      ELSE 'processed'
    END,
    'conflict_reason', v_conflict_reason
  );
END;
$$;

-- Security: Revoke all public / client access to private ingestion RPC
REVOKE ALL ON FUNCTION public.ingest_inbound_message_transaction FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_inbound_message_transaction TO service_role;


-- 8. Conversation Helper RPCs

-- 8.1 Mark Conversation Read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INT;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.inbound_messages
  SET read_at = now(),
      updated_at = now()
  WHERE conversation_id = p_conversation_id 
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'marked_read_count', v_updated_count);
END;
$$;

-- 8.2 Close Conversation
CREATE OR REPLACE FUNCTION public.close_conversation(p_conversation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.conversations
  SET status = 'closed',
      closed_at = now(),
      updated_at = now()
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'status', 'closed');
END;
$$;

-- 8.3 Reopen Conversation
CREATE OR REPLACE FUNCTION public.reopen_conversation(p_conversation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.conversations
  SET status = 'open',
      closed_at = NULL,
      updated_at = now()
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'status', 'open');
END;
$$;

-- 8.4 Get Conversation Metrics
CREATE OR REPLACE FUNCTION public.get_conversation_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_replies INT;
  v_email_replies INT;
  v_sms_replies INT;
  v_open_conversations INT;
  v_unread_conversations INT;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT count(*) INTO v_total_replies 
  FROM public.inbound_messages WHERE processing_status = 'processed';

  SELECT count(*) INTO v_email_replies 
  FROM public.inbound_messages WHERE processing_status = 'processed' AND channel = 'email';

  SELECT count(*) INTO v_sms_replies 
  FROM public.inbound_messages WHERE processing_status = 'processed' AND channel = 'sms';

  SELECT count(*) INTO v_open_conversations 
  FROM public.conversations WHERE status = 'open';

  SELECT count(DISTINCT conversation_id) INTO v_unread_conversations 
  FROM public.inbound_messages WHERE read_at IS NULL AND conversation_id IS NOT NULL;

  RETURN jsonb_build_object(
    'total_replies', v_total_replies,
    'email_replies', v_email_replies,
    'sms_replies', v_sms_replies,
    'open_conversations', v_open_conversations,
    'unread_conversations', v_unread_conversations
  );
END;
$$;


-- 9. Update purge_all_contacts & get_contacts_purge_preview
CREATE OR REPLACE FUNCTION public.get_contacts_purge_preview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leads_count int;
  v_activities_count int;
  v_import_rows_count int;
  v_intake_events_count int;
  v_outbound_messages_count int;
  v_tasks_count int;
  v_notes_count int;
  v_tags_count int;
  v_campaigns_count int;
  v_campaign_leads_count int;
  v_form_submissions_count int;
  v_automation_runs_count int;
  v_automation_jobs_count int;
  v_automation_events_count int;
  v_conversations_count int;
  v_inbound_messages_count int;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied: caller is not an active app user.';
  END IF;

  SELECT count(*) INTO v_leads_count FROM public.leads WHERE id IS NOT NULL;
  SELECT count(*) INTO v_activities_count FROM public.lead_activities WHERE id IS NOT NULL;
  SELECT count(*) INTO v_import_rows_count FROM public.lead_import_rows WHERE id IS NOT NULL;
  SELECT count(*) INTO v_intake_events_count FROM public.lead_intake_events WHERE id IS NOT NULL;
  SELECT count(*) INTO v_outbound_messages_count FROM public.outbound_messages WHERE id IS NOT NULL;
  SELECT count(*) INTO v_tasks_count FROM public.tasks WHERE id IS NOT NULL;
  SELECT count(*) INTO v_notes_count FROM public.lead_notes WHERE id IS NOT NULL;
  SELECT count(*) INTO v_tags_count FROM public.lead_tag_assignments WHERE id IS NOT NULL;
  SELECT count(*) INTO v_campaigns_count FROM public.campaigns WHERE id IS NOT NULL;
  SELECT count(*) INTO v_campaign_leads_count FROM public.campaign_leads WHERE id IS NOT NULL;
  SELECT count(*) INTO v_form_submissions_count FROM public.form_submissions WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_runs_count FROM public.automation_runs WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_jobs_count FROM public.automation_jobs WHERE id IS NOT NULL;
  SELECT count(*) INTO v_automation_events_count FROM public.automation_events WHERE id IS NOT NULL;
  SELECT count(*) INTO v_conversations_count FROM public.conversations WHERE id IS NOT NULL;
  SELECT count(*) INTO v_inbound_messages_count FROM public.inbound_messages WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'leads_count', v_leads_count,
    'lead_activities_count', v_activities_count,
    'lead_import_rows_count', v_import_rows_count,
    'lead_intake_events_count', v_intake_events_count,
    'outbound_messages_count', v_outbound_messages_count,
    'tasks_count', v_tasks_count,
    'lead_notes_count', v_notes_count,
    'lead_tag_assignments_count', v_tags_count,
    'campaigns_count', v_campaigns_count,
    'campaign_leads_count', v_campaign_leads_count,
    'form_submissions_count', v_form_submissions_count,
    'automation_runs_count', v_automation_runs_count,
    'automation_jobs_count', v_automation_jobs_count,
    'automation_events_count', v_automation_events_count,
    'conversations_count', v_conversations_count,
    'inbound_messages_count', v_inbound_messages_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_all_contacts(
  confirmation_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_text CONSTANT TEXT := 'DELETE ALL CONTACTS';
  v_deleted_leads int;
  v_deleted_activities int;
  v_deleted_import_rows int;
  v_deleted_intake_events int;
  v_deleted_outbound_messages int;
  v_deleted_tasks int;
  v_deleted_notes int;
  v_deleted_tags int;
  v_deleted_campaigns int;
  v_deleted_campaign_leads int;
  v_deleted_form_submissions int;
  v_deleted_automation_runs int;
  v_deleted_automation_jobs int;
  v_deleted_automation_events int;
  v_deleted_conversations int;
  v_deleted_inbound_messages int;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied: caller is not an active app user.';
  END IF;

  IF confirmation_text IS NULL OR trim(confirmation_text) != v_expected_text THEN
    RAISE EXCEPTION 'Confirmation text does not match. Expected "%", got "%".',
      v_expected_text, coalesce(confirmation_text, '');
  END IF;

  -- 1. inbound_messages
  DELETE FROM public.inbound_messages WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_inbound_messages = ROW_COUNT;

  -- 2. outbound_messages
  DELETE FROM public.outbound_messages WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_outbound_messages = ROW_COUNT;

  -- 3. conversations
  DELETE FROM public.conversations WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_conversations = ROW_COUNT;

  -- 4. automation_jobs
  DELETE FROM public.automation_jobs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_jobs = ROW_COUNT;

  -- 5. automation_run_steps & runs
  DELETE FROM public.automation_run_steps WHERE id IS NOT NULL;
  DELETE FROM public.automation_runs WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_runs = ROW_COUNT;

  -- 6. automation_events
  DELETE FROM public.automation_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_automation_events = ROW_COUNT;

  -- 7. tasks
  DELETE FROM public.tasks WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;

  -- 8. lead_notes
  DELETE FROM public.lead_notes WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_notes = ROW_COUNT;

  -- 9. lead_tag_assignments
  DELETE FROM public.lead_tag_assignments WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_tags = ROW_COUNT;

  -- 10. campaign_leads
  DELETE FROM public.campaign_leads WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_campaign_leads = ROW_COUNT;

  -- 11. form_submissions
  DELETE FROM public.form_submissions WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_form_submissions = ROW_COUNT;

  -- 12. lead_activities
  DELETE FROM public.lead_activities WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_activities = ROW_COUNT;

  -- 13. lead_intake_events
  DELETE FROM public.lead_intake_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_intake_events = ROW_COUNT;

  -- 14. lead_import_rows
  DELETE FROM public.lead_import_rows WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_import_rows = ROW_COUNT;

  -- 15. leads
  DELETE FROM public.leads WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_leads = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_leads', v_deleted_leads,
    'deleted_activities', v_deleted_activities,
    'deleted_import_rows', v_deleted_import_rows,
    'deleted_intake_events', v_deleted_intake_events,
    'deleted_outbound_messages', v_deleted_outbound_messages,
    'deleted_tasks', v_deleted_tasks,
    'deleted_notes', v_deleted_notes,
    'deleted_tags', v_deleted_tags,
    'deleted_campaigns', 0,
    'deleted_campaign_leads', v_deleted_campaign_leads,
    'deleted_form_submissions', v_deleted_form_submissions,
    'deleted_automation_runs', v_deleted_automation_runs,
    'deleted_automation_jobs', v_deleted_automation_jobs,
    'deleted_automation_events', v_deleted_automation_events,
    'deleted_conversations', v_deleted_conversations,
    'deleted_inbound_messages', v_deleted_inbound_messages
  );
END;
$$;


-- 10. Configure RLS Policies
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

-- Conversations RLS
CREATE POLICY "conversations_select"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (public.is_active_app_user());

CREATE POLICY "conversations_insert"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_app_user());

CREATE POLICY "conversations_update"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (public.is_active_app_user());

CREATE POLICY "conversations_delete"
  ON public.conversations FOR DELETE
  TO authenticated
  USING (public.is_active_app_user());

-- Inbound Messages RLS
CREATE POLICY "inbound_messages_select"
  ON public.inbound_messages FOR SELECT
  TO authenticated
  USING (public.is_active_app_user());

CREATE POLICY "inbound_messages_update"
  ON public.inbound_messages FOR UPDATE
  TO authenticated
  USING (public.is_active_app_user());
