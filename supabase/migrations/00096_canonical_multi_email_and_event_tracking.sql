-- =============================================================================
-- Migration 00096: Canonical Multi-Email Representation, Event Tracking & Divergence
-- =============================================================================
-- 1. Table public.lead_emails: Canonical relational representation of multiple
--    factual email identities per lead (0, 1, 2, 3+ addresses).
-- 2. Schema extensions on outbound_messages: first_opened_at, first_clicked_at.
-- 3. Canonical SQL function public.resolve_lead_emails:
--    Deterministic extraction, syntax validation, case-insensitive normalization,
--    deduplication, provenance tracking, and divergence calculation.
-- 4. Updates process_hubspot_inbound_batch:
--    Fully integrates canonical multi-email discovery across all known HubSpot properties.
-- 5. Updates process_form_submission_transaction:
--    Preserves all submitted emails into public.lead_emails.
-- 6. Updates get_lead_form_submissions:
--    Exposes factual multi-email identities, provenance, and divergence.
-- 7. Helper function backfill_lead_emails:
--    Safely populates lead_emails from existing leads and form submissions with ZERO outreach.
-- =============================================================================

-- 1. Create public.lead_emails table
CREATE TABLE IF NOT EXISTS public.lead_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  raw_email           TEXT NOT NULL,
  normalized_email    TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'unknown',
  source_field        TEXT NOT NULL DEFAULT 'email',
  is_primary          BOOLEAN NOT NULL DEFAULT false,
  is_valid            BOOLEAN NOT NULL DEFAULT true,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lead_emails_lead_normalized UNIQUE (lead_id, normalized_email),
  CONSTRAINT ck_lead_emails_normalized CHECK (normalized_email = lower(trim(normalized_email)))
);

CREATE INDEX IF NOT EXISTS idx_lead_emails_lead_id
  ON public.lead_emails(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_emails_normalized
  ON public.lead_emails(normalized_email);

CREATE INDEX IF NOT EXISTS idx_lead_emails_primary
  ON public.lead_emails(lead_id, is_primary);

COMMENT ON TABLE public.lead_emails IS
  'Canonical multi-email store. Associates 0, 1, 2, 3+ factual valid email addresses with their lead, preserving source, field, validity, and primary status.';

-- Enable RLS on lead_emails
ALTER TABLE public.lead_emails ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lead_emails' AND policyname = 'authenticated_select_lead_emails'
  ) THEN
    CREATE POLICY "authenticated_select_lead_emails"
      ON public.lead_emails FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lead_emails' AND policyname = 'authenticated_all_lead_emails'
  ) THEN
    CREATE POLICY "authenticated_all_lead_emails"
      ON public.lead_emails FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lead_emails' AND policyname = 'anon_select_lead_emails'
  ) THEN
    CREATE POLICY "anon_select_lead_emails"
      ON public.lead_emails FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- 2. Extend outbound_messages with first_opened_at and first_clicked_at
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_first_opened
  ON public.outbound_messages(first_opened_at)
  WHERE first_opened_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_first_clicked
  ON public.outbound_messages(first_clicked_at)
  WHERE first_clicked_at IS NOT NULL;

-- 3. Canonical SQL function: resolve_lead_emails
-- Validates email syntax strictly: non-empty, contains '@', domain has '.', no whitespace
CREATE OR REPLACE FUNCTION public.is_valid_email_syntax(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed TEXT;
  v_at_pos INT;
  v_domain TEXT;
  v_tld TEXT;
BEGIN
  IF p_email IS NULL THEN
    RETURN false;
  END IF;
  v_trimmed := trim(p_email);
  IF length(v_trimmed) < 6 OR v_trimmed LIKE '% %' THEN
    RETURN false;
  END IF;

  v_at_pos := position('@' in v_trimmed);
  IF v_at_pos < 2 THEN
    RETURN false;
  END IF;

  v_domain := substring(v_trimmed from v_at_pos + 1);
  IF length(v_domain) < 3 OR position('.' in v_domain) < 2 THEN
    RETURN false;
  END IF;

  IF v_domain LIKE '.%' OR v_domain LIKE '%.' THEN
    RETURN false;
  END IF;

  -- Verify basic standard email format via regex
  RETURN v_trimmed ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$;

-- Canonical Email Resolver (SQL Version)
-- Extracts all supported email fields from any JSON payload, validates, deduplicates,
-- and calculates divergence and primary email.
CREATE OR REPLACE FUNCTION public.resolve_lead_emails(
  p_data JSONB,
  p_source TEXT DEFAULT 'unknown'
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_resolved JSONB := '[]'::jsonb;
  v_seen_normalized TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
  v_val TEXT;
  v_norm TEXT;
  v_is_primary BOOLEAN;
  v_primary_email TEXT := NULL;
  v_primary_raw TEXT := NULL;
  v_primary_field TEXT := NULL;
  v_unique_count INT := 0;
  v_divergence BOOLEAN := false;
  
  -- Priority ordered candidate field keys
  v_priority_fields TEXT[] := ARRAY[
    'email',
    'e-mail',
    'e_mail',
    'primary_email',
    'work_email',
    'confirm_your_email',
    'confirm_email',
    'confirmation_email',
    'email_confirmation',
    'please_confirm_your_email_address',
    'confirme_seu_email',
    'confirme_seu_e_mail',
    'confirmacao_de_email',
    'confirmacao_email',
    'email_confirmacao',
    'secondary_email',
    'alternate_email',
    'personal_email',
    'outro_email'
  ];
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) != 'object' THEN
    RETURN jsonb_build_object(
      'primary_email', NULL,
      'primary_raw', NULL,
      'primary_field', NULL,
      'unique_count', 0,
      'divergence', false,
      'emails', '[]'::jsonb
    );
  END IF;

  -- 1. Check known priority fields first (preserving order)
  FOREACH v_key IN ARRAY v_priority_fields LOOP
    IF p_data ? v_key THEN
      v_val := trim(COALESCE(p_data->>v_key, ''));
      IF v_val != '' AND public.is_valid_email_syntax(v_val) THEN
        v_norm := lower(v_val);
        IF NOT (v_norm = ANY(v_seen_normalized)) THEN
          v_seen_normalized := array_append(v_seen_normalized, v_norm);
          v_is_primary := (v_unique_count = 0);
          IF v_is_primary THEN
            v_primary_email := v_norm;
            v_primary_raw := v_val;
            v_primary_field := v_key;
          END IF;
          v_unique_count := v_unique_count + 1;

          v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
            'raw_email', v_val,
            'normalized_email', v_norm,
            'source_field', v_key,
            'source', COALESCE(p_source, 'unknown'),
            'is_primary', v_is_primary,
            'is_valid', true
          ));
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. Inspect remaining properties dynamically for valid email values
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(p_data) LOOP
    IF NOT (lower(v_key) = ANY(v_priority_fields)) THEN
      -- Only inspect if key mentions email/mail OR value looks like an email
      IF (lower(v_key) LIKE '%email%' OR lower(v_key) LIKE '%mail%' OR (v_val IS NOT NULL AND position('@' in v_val) > 1)) THEN
        IF v_val IS NOT NULL AND trim(v_val) != '' AND public.is_valid_email_syntax(trim(v_val)) THEN
          v_norm := lower(trim(v_val));
          IF NOT (v_norm = ANY(v_seen_normalized)) THEN
            v_seen_normalized := array_append(v_seen_normalized, v_norm);
            v_is_primary := (v_unique_count = 0);
            IF v_is_primary THEN
              v_primary_email := v_norm;
              v_primary_raw := trim(v_val);
              v_primary_field := v_key;
            END IF;
            v_unique_count := v_unique_count + 1;

            v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
              'raw_email', trim(v_val),
              'normalized_email', v_norm,
              'source_field', v_key,
              'source', COALESCE(p_source, 'unknown'),
              'is_primary', v_is_primary,
              'is_valid', true
            ));
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  v_divergence := (v_unique_count > 1);

  RETURN jsonb_build_object(
    'primary_email', v_primary_email,
    'primary_raw', v_primary_raw,
    'primary_field', v_primary_field,
    'unique_count', v_unique_count,
    'divergence', v_divergence,
    'emails', v_resolved
  );
END;
$$;

-- 4. Helper RPC to upsert resolved emails for a lead
CREATE OR REPLACE FUNCTION public.sync_lead_emails(
  p_lead_id UUID,
  p_resolved_emails JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_raw TEXT;
  v_norm TEXT;
  v_field TEXT;
  v_source TEXT;
  v_is_primary BOOLEAN;
  v_is_valid BOOLEAN;
BEGIN
  IF p_lead_id IS NULL OR p_resolved_emails IS NULL THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_resolved_emails) LOOP
    v_raw := trim(COALESCE(v_item->>'raw_email', ''));
    v_norm := lower(trim(COALESCE(v_item->>'normalized_email', '')));
    v_field := COALESCE(v_item->>'source_field', 'email');
    v_source := COALESCE(v_item->>'source', 'unknown');
    v_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
    v_is_valid := COALESCE((v_item->>'is_valid')::boolean, true);

    IF v_norm != '' THEN
      INSERT INTO public.lead_emails (
        lead_id, raw_email, normalized_email, source, source_field,
        is_primary, is_valid, first_seen_at, last_seen_at, updated_at
      ) VALUES (
        p_lead_id, v_raw, v_norm, v_source, v_field,
        v_is_primary, v_is_valid, now(), now(), now()
      )
      ON CONFLICT (lead_id, normalized_email) DO UPDATE
        SET last_seen_at = now(),
            source_field = CASE WHEN lead_emails.source_field IS NULL OR lead_emails.source_field = 'unknown' THEN EXCLUDED.source_field ELSE lead_emails.source_field END,
            is_primary = (lead_emails.is_primary OR EXCLUDED.is_primary),
            updated_at = now();
    END IF;
  END LOOP;
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
  v_qual_status TEXT;
  v_source_created_at TIMESTAMPTZ;
  v_target_stage_id UUID;
  v_capture_stage_id UUID;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_payload_hash TEXT;
  v_is_update BOOLEAN;
  v_is_form_submission BOOLEAN;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
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

      -- Source created_at detection:
      -- Strictly parse HubSpot 'createdate'. If missing or unparseable, set to NULL (never default to now() or event_ts)
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

      -- Payload hash for change detection
      v_payload_hash := md5(v_props::text);

      -- Canonical Multi-Email Resolution:
      -- Evaluates all candidate properties (email, confirm_your_email, etc.)
      v_email_resolution := public.resolve_lead_emails(v_props, 'hubspot');
      v_email := v_email_resolution->>'primary_email';
      v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

      -- Set secondary email for backward compatibility with email_confirmation column
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

      -- Split full name if firstname contains both and lastname is empty
      IF v_first_name IS NOT NULL AND v_last_name IS NULL AND position(' ' in v_first_name) > 0 THEN
        v_last_name := substring(v_first_name from position(' ' in v_first_name) + 1);
        v_first_name := substring(v_first_name from 1 for position(' ' in v_first_name) - 1);
      END IF;

      -- Contact Preference
      v_contact_pref := NULLIF(lower(trim(COALESCE(
        v_props->>'contact_preference',
        v_props->>'preferencia_de_contato',
        v_props->>'preferred_contact_method',
        v_props->>'what_is_your_preferred_contact_method',
        v_props->>'what_is_your_preferred_method_of_contact',
        ''
      ))), '');

      IF v_contact_pref IS NOT NULL THEN
        IF v_contact_pref IN ('email', 'e-mail', 'mail') THEN
          v_contact_pref := 'email';
        ELSIF v_contact_pref IN ('sms', 'text', 'torpedo') OR v_contact_pref LIKE '%sms%' THEN
          v_contact_pref := 'sms';
        ELSIF v_contact_pref IN ('whatsapp', 'whats', 'zap', 'wa') OR v_contact_pref LIKE '%whats%' OR v_contact_pref LIKE '%zap%' THEN
          v_contact_pref := 'whatsapp';
        ELSIF v_contact_pref IN ('phone', 'call', 'ligacao', 'telefone') OR v_contact_pref LIKE '%phone%' OR v_contact_pref LIKE '%call%' OR v_contact_pref LIKE '%lig%' THEN
          v_contact_pref := 'call';
        ELSE
          v_contact_pref := NULL;
        END IF;
      END IF;

      -- Course Interest extraction & normalization
      v_raw_course_interest := NULLIF(trim(COALESCE(
        v_props->>'course_interest',
        v_props->>'curso_de_interesse',
        v_props->>'curso_de_interesse_2',
        v_props->>'curso_de_interesse_3',
        v_props->>'data_do_curso_de_interesse',
        v_props->>'first_conversion_event_name',
        v_props->>'recent_conversion_event_name',
        ''
      )), '');

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

      -- Source attribution
      v_source := 'hubspot';
      v_source_detail := COALESCE(
        v_props->>'origem_do_lead',
        v_props->>'lead_source',
        v_props->>'hs_analytics_source',
        'hubspot_sync'
      );

      IF lower(v_source_detail) LIKE '%facebook%' OR lower(v_source_detail) LIKE '%meta%' OR lower(v_source_detail) LIKE '%instagram%' OR
         lower(COALESCE(v_props->>'first_conversion_event_name', '')) LIKE '%lead ad%' THEN
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
      END IF;

      -- Check for existing lead by hubspot_contact_id or link
      v_matched_lead_id := NULL;

      SELECT lead_id INTO v_matched_lead_id
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

      -- Match by normalized email (checking primary and lead_emails)
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

      -- Anti-Resurrection Protection: Never resurrect soft-deleted leads
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
          hubspot_contact_id = v_contact_id,
          source_created_at = COALESCE(source_created_at, v_source_created_at),
          last_inbound_activity_at = now(),
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Sync all resolved email identities into public.lead_emails
        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

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

        -- Create link
        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) DO NOTHING;

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

-- 6. Update process_form_submission_transaction
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
BEGIN
  -- 1. Fetch Form
  SELECT id, slug, name, current_version, status, default_pipeline_stage_id,
         success_message, redirect_url, source_detail
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Form not found',
      'error_code', 'FORM_NOT_FOUND'
    );
  END IF;

  IF v_form.status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Form is inactive',
      'error_code', 'FORM_INACTIVE'
    );
  END IF;

  -- 2. Check Idempotency Key (scoped to form_id)
  SELECT id, lead_id, intake_event_id, processing_status, processing_error
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE form_id = v_form.id AND idempotency_key = p_idempotency_key;

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

  -- 3. Canonical Multi-Email Resolution from submitted data + parameters
  v_email_resolution := public.resolve_lead_emails(
    COALESCE(p_submitted_data, '{}'::jsonb) || jsonb_build_object('email', p_email),
    'form'
  );
  v_clean_email := v_email_resolution->>'primary_email';
  v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

  IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
    v_clean_email_conf := v_email_resolution->'emails'->1->>'normalized_email';
  ELSE
    v_clean_email_conf := v_clean_email;
  END IF;

  -- Deduplication search
  IF v_clean_email IS NOT NULL THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE email = v_clean_email
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
  
  -- Relaxed contact_preference
  v_pref := NULLIF(trim(lower(COALESCE(p_contact_preference, ''))), '');
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := NULL;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      'form', 'website', v_first_name, v_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
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
      'Lead created from form: ' || v_form.name,
      jsonb_build_object(
        'source', 'form',
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'source_detail', 'website'
      )
    );
  ELSE
    -- RETURNING LEAD: Update non-destructively, deduplicate courses, and resurface
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_course_interest;

    IF v_clean_course IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
        WHERE lower(trim(elem)) = lower(v_clean_course)
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
        IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
          v_merged_course_interest := v_clean_course;
        ELSE
          v_merged_course_interest := v_merged_course_interest || ', ' || v_clean_course;
        END IF;
      END IF;
    END IF;

    -- Update lead: Preserves original created_at & stage
    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      contact_preference = COALESCE(v_pref, contact_preference),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_inbound_activity_at = now(),
      has_new_submission = true,
      new_submission_at = now(),
      updated_at = now()
    WHERE id = v_target_lead_id;

    -- Sync lead_emails
    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    -- Activity: form_submitted
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      'Lead retornou com novo formulário do site: ' || v_form.name,
      jsonb_build_object(
        'source', 'form',
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'source_detail', 'website',
        'is_returning_lead', true,
        'new_course_interest', v_clean_course
      )
    );
  END IF;

  -- 6. Insert lead_intake_events record
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
  ) VALUES (
    'form', p_idempotency_key, v_target_lead_id::text,
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
      'source_detail', 'website'
    ),
    'processed', v_target_lead_id, 1, now()
  ) RETURNING id INTO v_intake_event_id;

  -- 7. Persist form_submissions record
  INSERT INTO public.form_submissions (
    form_id, form_version, form_name, source, lead_id, intake_event_id, submitted_data,
    email, email_confirmation, email_mismatch, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, idempotency_key,
    ip_address, user_agent, submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_form.name, 'website', v_target_lead_id, v_intake_event_id,
    p_submitted_data || jsonb_build_object(
      'email_confirmation', v_clean_email_conf,
      'email_mismatch', v_email_mismatch,
      'resolved_emails', v_email_resolution->'emails'
    ),
    v_clean_email, v_clean_email_conf, v_email_mismatch, p_phone_e164, v_pref, v_clean_course,
    'website', 'processed', p_idempotency_key,
    p_ip_address, p_user_agent, now(), now()
  ) RETURNING id INTO v_submission_id;

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

-- 7. Update get_lead_form_submissions RPC
CREATE OR REPLACE FUNCTION public.get_lead_form_submissions(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
  v_rec RECORD;
  v_source_label TEXT;
  v_source_raw TEXT;
  v_form_title TEXT;
  v_submitted_at TIMESTAMPTZ;
  v_recovery_state TEXT;
  v_notes TEXT;
  v_sync_via TEXT;
  v_fields JSONB;
  v_key TEXT;
  v_val TEXT;
  v_label TEXT;
  v_seen_sub_ids TEXT[] := ARRAY[]::TEXT[];
  v_divergence_text TEXT;
  v_distinct_emails TEXT[];
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Collect all distinct verified emails from lead_emails for this lead
  SELECT array_agg(DISTINCT raw_email || ' (' || source_field || ')')
  INTO v_distinct_emails
  FROM public.lead_emails
  WHERE lead_id = p_lead_id AND is_valid = true;

  -- 1. Query form_submissions table
  FOR v_rec IN (
    SELECT
      id, form_name, source, source_detail, submitted_at,
      recovery_state, notes, submitted_data, email, email_confirmation,
      email_mismatch, phone_e164, contact_preference, course_interest
    FROM public.form_submissions
    WHERE lead_id = p_lead_id
    ORDER BY submitted_at DESC
  ) LOOP
    v_source_raw := COALESCE(v_rec.source, 'form');
    v_source_label := CASE 
      WHEN lower(v_source_raw) LIKE '%meta%' OR lower(v_source_raw) LIKE '%facebook%' OR lower(v_source_raw) LIKE '%instagram%' THEN 'Meta Lead Ads'
      WHEN lower(v_source_raw) = 'website' OR lower(v_source_raw) = 'form' OR lower(v_source_raw) = 'site' THEN 'Site'
      WHEN lower(v_source_raw) = 'hubspot' THEN 'HubSpot'
      ELSE initcap(v_source_raw)
    END;

    v_form_title := COALESCE(
      v_rec.form_name,
      v_rec.submitted_data->>'form_name',
      v_rec.submitted_data->>'first_conversion_event_name',
      v_rec.course_interest,
      'Formulário'
    );

    v_submitted_at := v_rec.submitted_at;
    v_recovery_state := COALESCE(v_rec.recovery_state, 'complete');
    v_notes := v_rec.notes;
    v_sync_via := NULL;
    v_fields := '[]'::jsonb;

    IF v_rec.submitted_data IS NOT NULL AND jsonb_typeof(v_rec.submitted_data) = 'object' THEN
      FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(v_rec.submitted_data) LOOP
        -- Skip technical internal metadata
        IF lower(v_key) IN ('resolved_emails', 'form_version', 'current_version', 'source_detail', 'ip_address', 'user_agent') THEN
          CONTINUE;
        END IF;

        IF v_val IS NOT NULL AND trim(v_val) != '' THEN
          IF lower(v_key) = 'synchronized_via' THEN
            v_sync_via := trim(v_val);
          END IF;

          CASE lower(v_key)
            WHEN 'first_name', 'firstname' THEN v_label := 'Nome';
            WHEN 'last_name', 'lastname' THEN v_label := 'Sobrenome';
            WHEN 'full_name', 'name' THEN v_label := 'Nome completo';
            WHEN 'email' THEN v_label := 'E-mail';
            WHEN 'confirm_your_email', 'confirm_email', 'please_confirm_your_email_address', 'email_confirmation', 'confirmation_email', 'confirmar_email' THEN v_label := 'Confirmação de e-mail';
            WHEN 'email_mismatch' THEN 
              v_label := 'Divergência de E-mail';
              IF (v_distinct_emails IS NOT NULL AND array_length(v_distinct_emails, 1) > 1) OR lower(trim(v_val)) = 'true' THEN
                IF v_distinct_emails IS NOT NULL AND array_length(v_distinct_emails, 1) > 1 THEN
                  v_val := 'Detectada (' || array_to_string(v_distinct_emails, ' vs ') || ')';
                ELSE
                  v_val := 'Detectada (E-mails diferentes)';
                END IF;
              ELSE
                v_val := 'Não detectada (E-mails iguais)';
              END IF;
            WHEN 'phone', 'phone_number', 'phone_raw', 'mobilephone' THEN v_label := 'Telefone';
            WHEN 'contact_preference', 'preferred_contact_method', 'preferencia_de_contato' THEN v_label := 'Preferência de contato';
            WHEN 'what_is_your_preferred_contact_method' THEN v_label := 'Método de contato de preferência';
            WHEN 'what_is_your_preferred_method_of_contact' THEN v_label := 'Método de contato preferido';
            WHEN 'what_is_your_current_license_status' THEN v_label := 'Status de licença profissional';
            WHEN 'when_would_you_like_to_attend_our_intensive_course' THEN v_label := 'Previsão de participação no curso';
            WHEN 'education_level' THEN v_label := 'Nível de escolaridade';
            WHEN 'course', 'course_interest', 'curso_de_interesse' THEN v_label := 'Curso de interesse';
            WHEN 'curso_de_interesse_2' THEN v_label := 'Segundo curso de interesse';
            WHEN 'curso_de_interesse_3' THEN v_label := 'Terceiro curso de interesse';
            WHEN 'course_session', 'session', 'data_do_curso', 'data_do_curso_de_interesse' THEN v_label := 'Data / Turma do curso';
            ELSE
              v_label := initcap(replace(v_key, '_', ' '));
          END CASE;

          v_fields := v_fields || jsonb_build_object('label', v_label, 'value', trim(v_val));
        END IF;
      END LOOP;
    END IF;

    -- If email_mismatch was not explicitly in submitted_data, append factual divergence status
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f->>'label' = 'Divergência de E-mail') THEN
      IF v_distinct_emails IS NOT NULL AND array_length(v_distinct_emails, 1) > 1 THEN
        v_fields := v_fields || jsonb_build_object(
          'label', 'Divergência de E-mail',
          'value', 'Detectada (' || array_to_string(v_distinct_emails, ' vs ') || ')'
        );
      ELSE
        v_fields := v_fields || jsonb_build_object(
          'label', 'Divergência de E-mail',
          'value', 'Não detectada (E-mails iguais)'
        );
      END IF;
    END IF;

    v_seen_sub_ids := array_append(v_seen_sub_ids, v_rec.id::text);

    v_results := v_results || jsonb_build_object(
      'id', v_rec.id,
      'source', v_source_label,
      'source_raw', v_source_raw,
      'form_name', v_form_title,
      'submitted_at', v_submitted_at,
      'recovery_state', v_recovery_state,
      'notes', v_notes,
      'synchronized_via', v_sync_via,
      'fields', v_fields
    );
  END LOOP;

  RETURN v_results;
END;
$$;

-- 8. Safe Historical Backfill Helper RPC (ZERO customer-facing outreach!)
CREATE OR REPLACE FUNCTION public.backfill_lead_emails()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_sub RECORD;
  v_emails_added INT := 0;
  v_leads_scanned INT := 0;
  v_divergence_updated INT := 0;
  v_res JSONB;
BEGIN
  -- 1. Backfill from public.leads table (email and email_confirmation)
  FOR v_lead IN (
    SELECT id, email, email_confirmation, source, source_detail, created_at
    FROM public.leads
    WHERE deleted_at IS NULL
  ) LOOP
    v_leads_scanned := v_leads_scanned + 1;
    v_res := public.resolve_lead_emails(
      jsonb_build_object('email', v_lead.email, 'email_confirmation', v_lead.email_confirmation),
      COALESCE(v_lead.source, 'leads')
    );

    IF (v_res->>'unique_count')::int > 0 THEN
      PERFORM public.sync_lead_emails(v_lead.id, v_res->'emails');
      v_emails_added := v_emails_added + (v_res->>'unique_count')::int;
      
      IF (v_res->>'divergence')::boolean IS TRUE THEN
        UPDATE public.leads
        SET email_mismatch = true
        WHERE id = v_lead.id AND (email_mismatch IS NULL OR email_mismatch = false);
        v_divergence_updated := v_divergence_updated + 1;
      END IF;
    END IF;
  END LOOP;

  -- 2. Backfill from public.form_submissions.submitted_data
  FOR v_sub IN (
    SELECT lead_id, source, submitted_data
    FROM public.form_submissions
    WHERE lead_id IS NOT NULL AND submitted_data IS NOT NULL
  ) LOOP
    v_res := public.resolve_lead_emails(v_sub.submitted_data, COALESCE(v_sub.source, 'form_submissions'));
    IF (v_res->>'unique_count')::int > 0 THEN
      PERFORM public.sync_lead_emails(v_sub.lead_id, v_res->'emails');
      IF (v_res->>'divergence')::boolean IS TRUE THEN
        UPDATE public.leads
        SET email_mismatch = true
        WHERE id = v_sub.lead_id AND (email_mismatch IS NULL OR email_mismatch = false);
        v_divergence_updated := v_divergence_updated + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'leads_scanned', v_leads_scanned,
    'emails_added', v_emails_added,
    'divergence_updated', v_divergence_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_lead_emails(JSONB, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.sync_lead_emails(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_lead_form_submissions(UUID) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.backfill_lead_emails() TO service_role;
