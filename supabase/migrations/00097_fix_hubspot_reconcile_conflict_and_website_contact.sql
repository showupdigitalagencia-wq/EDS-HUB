-- =============================================================================
-- Migration 00097: Fix HubSpot Inbound Partial Index Conflict & Website Contact Form Intake
-- =============================================================================

-- 1. Ensure 'website' is allowed in public.leads and public.lead_intake_events source check
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('meta', 'google', 'manual', 'test', 'form', 'hubspot', 'website'));

ALTER TABLE public.lead_intake_events DROP CONSTRAINT IF EXISTS lead_intake_events_source_check;
ALTER TABLE public.lead_intake_events ADD CONSTRAINT lead_intake_events_source_check
  CHECK (source IN ('meta', 'google', 'manual', 'test', 'form', 'hubspot', 'website'));

-- 2. Register 'website-contact' form in public.forms
INSERT INTO public.forms (
  id, name, slug, description, status, current_version,
  submit_button_text, success_message, redirect_url,
  default_pipeline_stage_id, source_detail, created_at, updated_at
) VALUES (
  'a3b8c1d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d'::uuid,
  'Contact Us Form',
  'website-contact',
  'Official contact form from https://www.expdentalsolutions.com/contact',
  'active',
  1,
  'Send Message',
  'Thank you for reaching out! Our team will contact you shortly.',
  'https://www.expdentalsolutions.com/thank-you',
  (SELECT id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1),
  'contact_form',
  now(), now()
) ON CONFLICT (slug) DO UPDATE SET
  status = 'active',
  source_detail = 'contact_form',
  updated_at = now();

-- 3. Register form fields for website-contact (version 1)
INSERT INTO public.form_fields (
  form_id, version, internal_name, label, field_type, required, sort_order, created_at, updated_at
) VALUES
  ('a3b8c1d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d'::uuid, 1, 'name', 'Full Name', 'text', true, 1, now(), now()),
  ('a3b8c1d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d'::uuid, 1, 'phone', 'Phone Number', 'phone', true, 2, now(), now()),
  ('a3b8c1d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d'::uuid, 1, 'email', 'Email Address', 'email', true, 3, now(), now()),
  ('a3b8c1d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d'::uuid, 1, 'message', 'Message', 'textarea', false, 4, now(), now())
ON CONFLICT (form_id, version, internal_name) DO UPDATE SET
  required = EXCLUDED.required,
  label = EXCLUDED.label,
  updated_at = now();

-- 4. Update trigger_hubspot_reconcile
CREATE OR REPLACE FUNCTION public.trigger_hubspot_reconcile()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN net.http_post(
    url := 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-key', 'eds_internal_course_materials_mgmt_2026',
      'Authorization', 'Bearer eds_internal_course_materials_mgmt_2026'
    ),
    body := jsonb_build_object(
      'lookback_days', 3,
      'batch_size', 50
    )
  );
END;
$$;

-- 5. Update process_hubspot_inbound_batch
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_count INT := 0;
  v_conflict_count INT := 0;
  v_created_leads JSONB := '[]'::jsonb;
  v_event JSONB;
  v_contact_id TEXT;
  v_event_id TEXT;
  v_event_ts TIMESTAMPTZ;
  v_props JSONB;
  v_email_resolution JSONB;
  v_email TEXT;
  v_email_confirmation TEXT;
  v_email_mismatch BOOLEAN := false;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_course_interest_val TEXT;
  v_raw_course_interest TEXT;
  v_contact_pref TEXT;
  v_source TEXT;
  v_source_detail TEXT;
  v_source_created_at TIMESTAMPTZ;
  v_target_stage_id UUID;
  v_capture_stage_id UUID;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_payload_hash TEXT;
  v_is_update BOOLEAN;
  v_first_conv TEXT;
  v_recent_conv TEXT;
  v_analytics_data_1 TEXT;
  v_origem TEXT;
BEGIN
  -- Resolve default capture stage
  SELECT id INTO v_capture_stage_id
  FROM public.pipeline_stages
  WHERE code = 'capture'
  LIMIT 1;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    BEGIN
      -- Extract contact ID from hs_object_id, objectId, or id
      v_contact_id := NULLIF(trim(COALESCE(
        v_event->'properties'->>'hs_object_id',
        v_event->>'objectId',
        v_event->>'hs_object_id',
        v_event->>'id',
        ''
      )), '');

      IF v_contact_id IS NULL THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      v_event_id := NULLIF(trim(COALESCE(v_event->>'eventId', v_event->>'id', '')), '');
      
      -- Event timestamp
      IF v_event->>'occurredAt' IS NOT NULL THEN
        v_event_ts := to_timestamp((v_event->>'occurredAt')::double precision / 1000.0);
      ELSIF v_event->>'timestamp' IS NOT NULL THEN
        v_event_ts := (v_event->>'timestamp')::timestamptz;
      ELSE
        v_event_ts := now();
      END IF;

      -- Source created_at detection
      v_props := COALESCE(v_event->'properties', '{}'::jsonb);
      IF v_props->>'createdate' IS NOT NULL THEN
        BEGIN
          IF v_props->>'createdate' ~ '^\d+$' THEN
            v_source_created_at := to_timestamp((v_props->>'createdate')::double precision / 1000.0);
          ELSE
            v_source_created_at := (v_props->>'createdate')::timestamptz;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_source_created_at := NULL;
        END;
      ELSE
        v_source_created_at := NULL;
      END IF;

      -- Merge top-level fields into properties if not present
      IF v_event->>'email' IS NOT NULL AND v_props->>'email' IS NULL THEN
        v_props := v_props || jsonb_build_object('email', v_event->>'email');
      END IF;
      IF v_event->>'firstname' IS NOT NULL AND v_props->>'firstname' IS NULL THEN
        v_props := v_props || jsonb_build_object('firstname', v_event->>'firstname');
      END IF;
      IF v_event->>'lastname' IS NOT NULL AND v_props->>'lastname' IS NULL THEN
        v_props := v_props || jsonb_build_object('lastname', v_event->>'lastname');
      END IF;
      IF v_event->>'phone' IS NOT NULL AND v_props->>'phone' IS NULL THEN
        v_props := v_props || jsonb_build_object('phone', v_event->>'phone');
      END IF;

      -- Payload hash
      v_payload_hash := md5(v_props::text);

      -- Canonical Multi-Email Resolution
      v_email_resolution := public.resolve_lead_emails(v_props, 'hubspot');
      v_email := v_email_resolution->>'primary_email';
      v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

      IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
        v_email_confirmation := v_email_resolution->'emails'->1->>'normalized_email';
      ELSE
        v_email_confirmation := v_email;
      END IF;

      v_phone := NULLIF(trim(COALESCE(
        v_props->>'phone',
        v_props->>'mobilephone',
        v_props->>'hs_calculated_phone_number',
        v_props->>'whatsapp',
        v_props->>'telefone',
        v_props->>'celular',
        ''
      )), '');

      v_first_name := NULLIF(trim(COALESCE(
        v_props->>'firstname',
        v_props->>'first_name',
        v_props->>'nome',
        ''
      )), '');

      v_last_name := NULLIF(trim(COALESCE(
        v_props->>'lastname',
        v_props->>'last_name',
        v_props->>'sobrenome',
        ''
      )), '');

      IF v_first_name IS NULL AND v_last_name IS NULL AND v_props->>'hs_full_name_or_email' IS NOT NULL THEN
        v_first_name := trim(v_props->>'hs_full_name_or_email');
      END IF;

      -- Contact Preference
      v_contact_pref := NULLIF(trim(lower(COALESCE(
        v_props->>'what_is_your_preferred_contact_method',
        v_props->>'what_is_your_preferred_method_of_contact',
        v_props->>'preferencia_de_contato',
        v_props->>'contact_preference',
        v_props->>'preferred_contact_method',
        ''
      ))), '');

      IF v_contact_pref IN ('whats', 'zap', 'whatsapp') THEN
        v_contact_pref := 'whatsapp';
      ELSIF v_contact_pref IN ('email', 'e-mail') THEN
        v_contact_pref := 'email';
      ELSIF v_contact_pref IN ('sms', 'text', 'text_message') THEN
        v_contact_pref := 'sms';
      ELSIF v_contact_pref IN ('phone', 'call', 'ligacao', 'telefone', 'phone_call') THEN
        v_contact_pref := 'call';
      ELSE
        v_contact_pref := NULL;
      END IF;

      -- Course Interest
      v_raw_course_interest := NULLIF(trim(COALESCE(
        v_props->>'curso_de_interesse',
        v_props->>'course_interest',
        v_props->>'qual_o_seu_interesse_',
        v_props->>'qual_o_seu_interesse',
        v_props->>'curso_de_interesse_2',
        v_props->>'curso_de_interesse_3',
        v_props->>'course',
        v_event->>'course_interest',
        v_event->>'course',
        ''
      )), '');

      IF v_raw_course_interest IS NULL OR trim(v_raw_course_interest) = '' THEN
        IF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%zygo%' THEN
          v_raw_course_interest := 'Zygomatic';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%wisdom%' OR
              lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%molar%' THEN
          v_raw_course_interest := 'Wisdom';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%endo%' THEN
          v_raw_course_interest := 'Endodontic';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%perio%' THEN
          v_raw_course_interest := 'Periodontal';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%rehab%' OR
              lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%reabilit%' THEN
          v_raw_course_interest := 'Rehabilitation';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%intensiv%' THEN
          v_raw_course_interest := 'Intensive Dental Implant Training';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%advanced%' THEN
          v_raw_course_interest := 'Advanced Dental Implant Experience';
        END IF;
      END IF;

      v_course_interest_val := NULL;
      IF v_raw_course_interest IS NOT NULL THEN
        IF lower(v_raw_course_interest) LIKE '%zygo%' THEN
          v_course_interest_val := 'Zygomatic';
        ELSIF lower(v_raw_course_interest) LIKE '%wisdom%' OR lower(v_raw_course_interest) LIKE '%molar%' THEN
          v_course_interest_val := 'Wisdom';
        ELSIF lower(v_raw_course_interest) LIKE '%endo%' THEN
          v_course_interest_val := 'Endodontic';
        ELSIF lower(v_raw_course_interest) LIKE '%perio%' THEN
          v_course_interest_val := 'Periodontal';
        ELSIF lower(v_raw_course_interest) LIKE '%rehab%' THEN
          v_course_interest_val := 'Rehabilitation';
        ELSIF lower(v_raw_course_interest) LIKE '%intensiv%' OR lower(v_raw_course_interest) LIKE '%implant%' THEN
          v_course_interest_val := 'Implant';
        ELSE
          v_course_interest_val := v_raw_course_interest;
        END IF;
      END IF;

      -- Source attribution (Factual and specific)
      v_first_conv := lower(COALESCE(v_props->>'first_conversion_event_name', ''));
      v_recent_conv := lower(COALESCE(v_props->>'recent_conversion_event_name', ''));
      v_analytics_data_1 := lower(COALESCE(v_props->>'hs_analytics_source_data_1', ''));
      v_origem := lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', ''));

      IF v_first_conv LIKE '%contact%' OR v_recent_conv LIKE '%contact%' OR v_analytics_data_1 LIKE '%contact%' THEN
        v_source := 'website';
        v_source_detail := 'contact_form';
      ELSIF v_first_conv LIKE '%register%' OR v_recent_conv LIKE '%register%' OR v_analytics_data_1 LIKE '%register%' THEN
        v_source := 'website';
        v_source_detail := 'website_registration_form';
      ELSIF v_origem LIKE '%meta%' OR v_origem LIKE '%facebook%' OR v_origem LIKE '%instagram%' OR
            v_first_conv LIKE '%lead ad%' OR v_first_conv LIKE '%facebook%' OR v_recent_conv LIKE '%lead ad%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' THEN
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
      ELSIF v_origem LIKE '%site%' OR v_origem LIKE '%website%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) IN ('organic_search', 'direct_traffic', 'referrals') THEN
        v_source := 'website';
        v_source_detail := 'website';
      ELSE
        v_source := 'hubspot';
        v_source_detail := COALESCE(v_props->>'hs_analytics_source', 'hubspot_sync');
      END IF;

      -- Check for existing lead by hubspot_contact_id or link
      v_matched_lead_id := NULL;

      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- Match by primary or secondary normalized email
      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE lower(email) = v_email
          AND deleted_at IS NULL
        LIMIT 1;

        IF v_matched_lead_id IS NULL THEN
          SELECT lead_id INTO v_matched_lead_id
          FROM public.lead_emails
          WHERE normalized_email = v_email
          LIMIT 1;
        END IF;
      END IF;

      -- Anti-Resurrection Protection
      IF EXISTS (
        SELECT 1 FROM public.leads
        WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(email) = v_email))
          AND deleted_at IS NOT NULL
      ) THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      IF v_matched_lead_id IS NOT NULL THEN
        -- UPDATE EXISTING LEAD (Preserve original created_at & stage!)
        UPDATE public.leads
        SET
          first_name = COALESCE(v_first_name, first_name),
          last_name = COALESCE(v_last_name, last_name),
          email_confirmation = COALESCE(v_email_confirmation, email_confirmation),
          email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
          phone_raw = COALESCE(v_phone, phone_raw),
          contact_preference = COALESCE(v_contact_pref, contact_preference),
          hubspot_contact_id = COALESCE(hubspot_contact_id, v_contact_id),
          source_created_at = COALESCE(source_created_at, v_source_created_at),
          last_inbound_activity_at = now(),
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Sync all resolved email identities into public.lead_emails
        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        -- Upsert link safely
        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
        DO UPDATE SET
          eds_entity_id = EXCLUDED.eds_entity_id,
          updated_at = now();

        v_updated_count := v_updated_count + 1;
      ELSE
        -- CREATE NEW LEAD
        INSERT INTO public.leads (
          source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
          phone_raw, contact_preference, course_interest, course_interests,
          pipeline_stage_id, hubspot_contact_id, source_created_at,
          last_inbound_activity_at, created_at, updated_at
        ) VALUES (
          v_source, v_source_detail, v_first_name, v_last_name, v_email, v_email_confirmation, v_email_mismatch,
          v_phone, v_contact_pref, v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_capture_stage_id, v_contact_id, v_source_created_at,
          now(), now(), now()
        ) RETURNING id INTO v_matched_lead_id;

        -- Sync all resolved email identities into public.lead_emails
        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        -- Create link safely with WHERE status = 'active'
        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
        DO UPDATE SET
          eds_entity_id = EXCLUDED.eds_entity_id,
          updated_at = now();

        -- Activity: lead_created
        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata
        ) VALUES (
          v_matched_lead_id, 'lead_created', 'system',
          'Lead synchronized from HubSpot: ' || COALESCE(v_first_name || ' ' || v_last_name, v_email, 'Novo Lead'),
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', v_source,
            'source_detail', v_source_detail,
            'course', v_course_interest_val
          )
        );

        -- Append to created_leads for caller handoff
        v_created_leads := v_created_leads || jsonb_build_array(jsonb_build_object(
          'lead_id', v_matched_lead_id,
          'hubspot_contact_id', v_contact_id,
          'email', v_email,
          'email_confirmation', v_email_confirmation,
          'email_mismatch', v_email_mismatch,
          'resolved_emails', v_email_resolution->'emails',
          'phone', v_phone,
          'first_name', v_first_name,
          'last_name', v_last_name,
          'source', v_source,
          'source_detail', v_source_detail,
          'source_created_at', v_source_created_at,
          'course_interest', v_course_interest_val,
          'contact_preference', v_contact_pref
        ));

        v_created_count := v_created_count + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Log error explicitly in integration_sync_events
      INSERT INTO public.integration_sync_events (
        integration, direction, entity_type, external_entity_id,
        event_type, external_event_id, external_event_timestamp, payload_hash,
        status, attempt_count, error_code, error_message, change_summary,
        created_at, processed_at
      ) VALUES (
        'hubspot', 'inbound', 'lead', v_contact_id,
        'hubspot_error',
        'error:' || COALESCE(v_contact_id, 'unknown') || ':' || extract(epoch from now())::text,
        v_event_ts, COALESCE(v_payload_hash, 'none'),
        'failed', 1, SQLSTATE, SQLERRM,
        jsonb_build_object('event', v_event),
        now(), now()
      ) ON CONFLICT DO NOTHING;

      v_conflict_count := v_conflict_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'ignored_count', v_ignored_count,
    'conflict_count', v_conflict_count,
    'created_leads', v_created_leads
  );
END;
$$;

-- 6. Update process_form_submission_transaction for website forms
CREATE OR REPLACE FUNCTION public.process_form_submission_transaction(
  p_form_slug TEXT,
  p_idempotency_key TEXT,
  p_submitted_data JSONB,
  p_email TEXT,
  p_phone_e164 TEXT,
  p_contact_preference TEXT,
  p_course_interest TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_external_attempt_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_form RECORD;
  v_existing_sub RECORD;
  v_lead_by_email UUID;
  v_lead_by_phone UUID;
  v_target_lead_id UUID;
  v_email_resolution JSONB;
  v_clean_email TEXT;
  v_clean_email_conf TEXT;
  v_email_mismatch BOOLEAN := false;
  v_clean_phone_raw TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_pref TEXT;
  v_clean_course TEXT;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_intake_event_id UUID;
  v_submission_id UUID;
  v_resolved_course_id UUID;
  v_resolved_incomplete_count INT := 0;
  v_assigned_source TEXT;
  v_assigned_source_detail TEXT;
BEGIN
  -- 1. Fetch Form
  SELECT id, slug, name, current_version, status, default_pipeline_stage_id,
         success_message, redirect_url, source_detail
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug
  LIMIT 1;

  IF NOT FOUND OR v_form.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found or inactive');
  END IF;

  -- 2. Idempotency Check
  SELECT id, lead_id, intake_event_id, processing_status
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'submission_id', v_existing_sub.id,
      'lead_id', v_existing_sub.lead_id,
      'intake_event_id', v_existing_sub.intake_event_id,
      'processing_status', v_existing_sub.processing_status,
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  -- 3. Canonical Multi-Email Resolution
  v_email_resolution := public.resolve_lead_emails(p_submitted_data, 'form');
  v_clean_email := v_email_resolution->>'primary_email';
  v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

  IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
    v_clean_email_conf := v_email_resolution->'emails'->1->>'normalized_email';
  ELSE
    v_clean_email_conf := v_clean_email;
  END IF;

  -- Check existing lead by primary email or lead_emails
  v_lead_by_email := NULL;
  IF v_clean_email IS NOT NULL AND v_clean_email != '' THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE lower(email) = v_clean_email
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_lead_by_email IS NULL THEN
      SELECT lead_id INTO v_lead_by_email
      FROM public.lead_emails
      WHERE normalized_email = v_clean_email
      LIMIT 1;
    END IF;
  END IF;

  v_lead_by_phone := NULL;
  IF p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = trim(p_phone_e164)
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 4. Identity Conflict Protection
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    INSERT INTO public.form_submissions (
      form_id, form_version, form_name, source, lead_id, intake_event_id, submitted_data,
      email, phone_e164, contact_preference, course_interest,
      source_detail, processing_status, processing_error,
      idempotency_key, ip_address, user_agent, submitted_at, processed_at
    ) VALUES (
      v_form.id, v_form.current_version, v_form.name, 'website', NULL, NULL, p_submitted_data,
      v_clean_email, p_phone_e164, p_contact_preference, p_course_interest,
      v_form.source_detail, 'conflict', 'Conflict: email and phone belong to different leads.',
      p_idempotency_key, p_ip_address, p_user_agent, now(), now()
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', false,
      'submission_id', v_submission_id,
      'lead_id', NULL,
      'intake_event_id', NULL,
      'processing_status', 'conflict',
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  -- 5. Resolve target lead
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);
  v_first_name := NULLIF(trim(COALESCE(p_submitted_data->>'first_name', '')), '');
  v_last_name := NULLIF(trim(COALESCE(p_submitted_data->>'last_name', '')), '');

  IF v_first_name IS NULL AND p_submitted_data->>'name' IS NOT NULL THEN
    DECLARE
      v_full_name TEXT := trim(p_submitted_data->>'name');
      v_space_pos INT := position(' ' IN v_full_name);
    BEGIN
      IF v_space_pos > 0 THEN
        v_first_name := substring(v_full_name FROM 1 FOR v_space_pos - 1);
        v_last_name := trim(substring(v_full_name FROM v_space_pos + 1));
      ELSE
        v_first_name := v_full_name;
      END IF;
    END;
  END IF;

  v_clean_phone_raw := NULLIF(trim(COALESCE(p_submitted_data->>'phone', '')), '');
  v_clean_course := NULLIF(trim(COALESCE(p_course_interest, '')), '');
  
  v_pref := NULLIF(trim(lower(COALESCE(p_contact_preference, ''))), '');
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := NULL;
  END IF;

  -- Source determination: Website contact form gets source='website', source_detail='contact_form'
  IF p_form_slug = 'website-contact' THEN
    v_assigned_source := 'website';
    v_assigned_source_detail := 'contact_form';
  ELSE
    v_assigned_source := 'website';
    v_assigned_source_detail := COALESCE(v_form.source_detail, 'website');
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage (Novo Lead / Capture)
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      v_assigned_source, v_assigned_source_detail, v_first_name, v_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
      v_clean_phone_raw, p_phone_e164,
      v_pref, v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL THEN jsonb_build_array(v_clean_course) ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, now(),
      false, NULL, now(), now()
    ) RETURNING id INTO v_target_lead_id;

    -- Sync lead_emails
    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    -- Stage history assignment
    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_assignment'
    );

    -- Activity: lead_created
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'lead_created', 'system',
      'Lead criado via formulário: ' || v_form.name,
      jsonb_build_object(
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'form_name', v_form.name,
        'source', v_assigned_source,
        'source_detail', v_assigned_source_detail,
        'message', p_submitted_data->>'message'
      )
    );
  ELSE
    -- REPEAT SUBMISSION: Update existing lead without changing stage or created_at
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_course_interest;

    IF v_clean_course IS NOT NULL AND v_clean_course != '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
        WHERE lower(trim(elem)) = lower(v_clean_course)
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
      END IF;

      IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
        v_merged_course_interest := v_clean_course;
      END IF;
    END IF;

    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      contact_preference = COALESCE(v_pref, contact_preference),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_inbound_activity_at = now(),
      has_new_submission = true,
      new_submission_at = now(),
      updated_at = now()
    WHERE id = v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      'Novo formulário recebido: ' || v_form.name,
      jsonb_build_object(
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'form_name', v_form.name,
        'message', p_submitted_data->>'message'
      )
    );
  END IF;

  -- 6. Insert form_submissions record
  INSERT INTO public.form_submissions (
    form_id, form_version, form_name, source, lead_id, intake_event_id, submitted_data,
    email, email_confirmation, email_mismatch, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, processing_error,
    idempotency_key, ip_address, user_agent, submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_form.name, v_assigned_source, v_target_lead_id, NULL, p_submitted_data,
    v_clean_email, v_clean_email_conf, v_email_mismatch, p_phone_e164, v_pref, v_clean_course,
    v_assigned_source_detail, 'processed', NULL,
    p_idempotency_key, p_ip_address, p_user_agent, now(), now()
  ) RETURNING id INTO v_submission_id;

  -- 7. Insert lead_intake_events record
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
  ) VALUES (
    v_assigned_source, p_idempotency_key, v_target_lead_id::text,
    'form:' || v_form.id::text || ':' || p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'email', v_clean_email,
      'email_confirmation', v_clean_email_conf,
      'email_mismatch', v_email_mismatch,
      'resolved_emails', v_email_resolution->'emails',
      'phone', p_phone_e164,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'contact_preference', v_pref,
      'course_interest', v_clean_course,
      'source', v_assigned_source,
      'source_detail', v_assigned_source_detail
    ),
    'processed', v_target_lead_id, 1, now()
  ) RETURNING id INTO v_intake_event_id;

  UPDATE public.form_submissions
  SET intake_event_id = v_intake_event_id
  WHERE id = v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processed',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO service_role;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO postgres;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO anon;

