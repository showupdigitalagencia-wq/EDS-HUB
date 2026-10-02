-- =============================================================================
-- Migration 00100: Universal First Email, Complete Form Traceability, Re-engagement & Pipeline Recency
-- =============================================================================

-- 1. Add and Index last_acquisition_at on public.leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_acquisition_at TIMESTAMPTZ;

UPDATE public.leads
SET last_acquisition_at = COALESCE(last_inbound_activity_at, source_created_at, created_at, now())
WHERE last_acquisition_at IS NULL;

ALTER TABLE public.leads
  ALTER COLUMN last_acquisition_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_leads_last_acquisition_at
  ON public.leads(last_acquisition_at DESC NULLS LAST);

-- 2. Enhanced Complete Form Traceability RPC (get_lead_form_submissions)
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
  v_distinct_emails TEXT[];
  v_lead RECORD;
  v_intake RECORD;
  v_act RECORD;
  v_payload JSONB;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Collect all distinct verified emails from lead_emails for this lead
  SELECT array_agg(DISTINCT raw_email || ' (' || source_field || ')')
  INTO v_distinct_emails
  FROM public.lead_emails
  WHERE lead_id = p_lead_id AND is_valid = true;

  -- 1. Query canonical form_submissions table
  FOR v_rec IN (
    SELECT
      id, form_id, form_name, source, source_detail, submitted_at,
      recovery_state, notes, submitted_data, email, email_confirmation,
      email_mismatch, phone_e164, contact_preference, course_interest,
      intake_event_id
    FROM public.form_submissions
    WHERE lead_id = p_lead_id
    ORDER BY submitted_at DESC
  ) LOOP
    v_source_raw := COALESCE(v_rec.source, 'form');
    v_source_label := CASE 
      WHEN lower(v_source_raw) LIKE '%instagram%' THEN 'Instagram Lead Ads'
      WHEN lower(v_source_raw) LIKE '%facebook%' THEN 'Facebook Lead Ads'
      WHEN lower(v_source_raw) LIKE '%meta%' THEN 'Meta Lead Ads'
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
        IF lower(v_key) IN ('resolved_emails', 'form_version', 'current_version', 'source_detail', 'ip_address', 'user_agent', 'token', 'secret', 'password', 'api_key') THEN
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
                CONTINUE;
              END IF;
            WHEN 'phone', 'phone_number', 'mobilephone', 'telefone', 'whatsapp' THEN v_label := 'Telefone';
            WHEN 'contact_preference', 'preferred_contact_method', 'preferencia_contato' THEN v_label := 'Preferência de contato';
            WHEN 'course_interest', 'curso_de_interesse', 'course', 'curso' THEN v_label := 'Curso de interesse';
            WHEN 'specialty', 'especialidade' THEN v_label := 'Especialidade';
            WHEN 'ad_name' THEN v_label := 'Anúncio';
            WHEN 'campaign_name' THEN v_label := 'Campanha';
            WHEN 'form_name' THEN v_label := 'Nome do formulário';
            WHEN 'leadgen_id' THEN v_label := 'ID do Lead Ad (Meta)';
            WHEN 'page_url', 'form_url' THEN v_label := 'URL do formulário';
            WHEN 'utm_source' THEN v_label := 'UTM Source';
            WHEN 'utm_medium' THEN v_label := 'UTM Medium';
            WHEN 'utm_campaign' THEN v_label := 'UTM Campaign';
            WHEN 'message', 'mensagem' THEN v_label := 'Mensagem';
            ELSE
              v_label := initcap(replace(v_key, '_', ' '));
          END CASE;

          v_fields := v_fields || jsonb_build_object('label', v_label, 'value', trim(v_val));
        END IF;
      END LOOP;
    END IF;

    -- Add primary email and confirmation if not yet in fields
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f->>'label' = 'E-mail') AND v_rec.email IS NOT NULL THEN
      v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_rec.email);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f->>'label' = 'Confirmação de e-mail') AND v_rec.email_confirmation IS NOT NULL THEN
      v_fields := v_fields || jsonb_build_object('label', 'Confirmação de e-mail', 'value', v_rec.email_confirmation);
    END IF;

    v_seen_sub_ids := array_append(v_seen_sub_ids, v_rec.id::text);
    IF v_rec.intake_event_id IS NOT NULL THEN
      v_seen_sub_ids := array_append(v_seen_sub_ids, v_rec.intake_event_id::text);
    END IF;

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

  -- 2. Fallback: Query lead_intake_events for unpersisted forms
  FOR v_intake IN (
    SELECT id, source, received_at, normalized_payload, raw_payload
    FROM public.lead_intake_events
    WHERE lead_id = p_lead_id
      AND status = 'processed'
      AND id::text != ALL(v_seen_sub_ids)
    ORDER BY received_at DESC
  ) LOOP
    v_payload := COALESCE(v_intake.normalized_payload, v_intake.raw_payload);
    IF v_payload IS NOT NULL AND jsonb_typeof(v_payload) = 'object' THEN
      v_source_raw := COALESCE(v_intake.source, 'intake');
      v_source_label := CASE 
        WHEN lower(v_source_raw) LIKE '%meta%' OR lower(v_source_raw) LIKE '%facebook%' OR lower(v_source_raw) LIKE '%instagram%' THEN 'Meta Lead Ads'
        WHEN lower(v_source_raw) = 'website' OR lower(v_source_raw) = 'form' OR lower(v_source_raw) = 'site' THEN 'Site'
        WHEN lower(v_source_raw) = 'hubspot' THEN 'HubSpot'
        ELSE initcap(v_source_raw)
      END;

      v_form_title := COALESCE(
        v_payload->>'form_name',
        v_payload->>'course_title',
        v_payload->>'course_interest',
        'Formulário Meta Lead Ads'
      );

      v_submitted_at := COALESCE((v_payload->>'source_created_at')::timestamptz, v_intake.received_at);
      v_fields := '[]'::jsonb;

      IF (v_payload->>'first_name') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_payload->>'first_name');
      END IF;
      IF (v_payload->>'last_name') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_payload->>'last_name');
      END IF;
      IF (v_payload->>'email') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_payload->>'email');
      END IF;
      IF (v_payload->>'email_confirmation') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Confirmação de e-mail', 'value', v_payload->>'email_confirmation');
      END IF;
      IF (v_payload->>'phone') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_payload->>'phone');
      END IF;
      IF (v_payload->>'contact_preference') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_payload->>'contact_preference');
      END IF;
      IF (v_payload->>'course_interest') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_payload->>'course_interest');
      END IF;
      IF (v_payload->>'ad_name') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Anúncio', 'value', v_payload->>'ad_name');
      END IF;
      IF (v_payload->>'campaign_name') IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Campanha', 'value', v_payload->>'campaign_name');
      END IF;

      IF jsonb_array_length(v_fields) > 0 THEN
        v_seen_sub_ids := array_append(v_seen_sub_ids, v_intake.id::text);
        v_results := v_results || jsonb_build_object(
          'id', v_intake.id,
          'source', v_source_label,
          'source_raw', v_source_raw,
          'form_name', v_form_title,
          'submitted_at', v_submitted_at,
          'recovery_state', 'complete',
          'notes', 'Recuperado do evento de intake original',
          'synchronized_via', 'Intake Direct',
          'fields', v_fields
        );
      END IF;
    END IF;
  END LOOP;

  -- 3. Fallback: If still empty, check lead provenance (Meta Ads, Website, or HubSpot conversion)
  IF jsonb_array_length(v_results) = 0 THEN
    IF lower(COALESCE(v_lead.source, '')) IN ('meta', 'facebook', 'instagram')
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%meta%'
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%lead_ad%'
       OR lower(COALESCE(v_lead.source, '')) = 'form'
       OR lower(COALESCE(v_lead.source_detail, '')) = 'contact_form'
       OR lower(COALESCE(v_lead.source_detail, '')) = 'website'
       OR (v_lead.hubspot_contact_id IS NOT NULL AND v_lead.source != 'manual') THEN

      v_source_raw := COALESCE(v_lead.source, 'meta');
      v_source_label := CASE 
        WHEN lower(v_source_raw) LIKE '%meta%' OR lower(v_source_raw) LIKE '%facebook%' OR lower(v_source_raw) LIKE '%instagram%' THEN 'Meta Lead Ads'
        WHEN lower(v_source_raw) = 'website' OR lower(v_source_raw) = 'form' THEN 'Site'
        WHEN lower(v_source_raw) = 'hubspot' THEN 'HubSpot'
        ELSE initcap(v_source_raw)
      END;

      v_form_title := COALESCE(v_lead.course_interest, 'Formulário de Inscrição / Contato');
      v_submitted_at := COALESCE(v_lead.source_created_at, v_lead.created_at);
      v_fields := '[]'::jsonb;

      IF v_lead.first_name IS NOT NULL AND trim(v_lead.first_name) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_lead.first_name);
      END IF;
      IF v_lead.last_name IS NOT NULL AND trim(v_lead.last_name) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_lead.last_name);
      END IF;
      IF v_lead.email IS NOT NULL AND trim(v_lead.email) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_lead.email);
      END IF;
      IF v_lead.email_confirmation IS NOT NULL AND trim(v_lead.email_confirmation) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Confirmação de e-mail', 'value', v_lead.email_confirmation);
      END IF;
      IF v_lead.phone_raw IS NOT NULL AND trim(v_lead.phone_raw) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_lead.phone_raw);
      END IF;
      IF v_lead.contact_preference IS NOT NULL AND trim(v_lead.contact_preference) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_lead.contact_preference);
      END IF;
      IF v_lead.course_interest IS NOT NULL AND trim(v_lead.course_interest) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_lead.course_interest);
      END IF;

      IF jsonb_array_length(v_fields) > 0 THEN
        v_results := v_results || jsonb_build_object(
          'id', 'recovered-' || v_lead.id,
          'source', v_source_label,
          'source_raw', v_source_raw,
          'form_name', v_form_title,
          'submitted_at', v_submitted_at,
          'recovery_state', 'partially_recovered',
          'notes', 'Recuperado dos dados cadastrais originais da aquisição',
          'synchronized_via', 'Lead Attribution Recovery',
          'fields', v_fields
        );
      END IF;
    END IF;
  END IF;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_form_submissions(UUID) TO authenticated, service_role, anon;

-- 3. Safe Historical Backfill RPC (Zero customer-facing outreach!)
CREATE OR REPLACE FUNCTION public.backfill_lead_form_submissions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_intake RECORD;
  v_payload JSONB;
  v_leads_empty_before INT := 0;
  v_recovered_full INT := 0;
  v_recovered_partial INT := 0;
  v_unrecoverable INT := 0;
  v_sub_data JSONB;
BEGIN
  -- Count leads without form submissions before backfill
  SELECT count(*) INTO v_leads_empty_before
  FROM public.leads l
  WHERE NOT EXISTS (SELECT 1 FROM public.form_submissions fs WHERE fs.lead_id = l.id);

  FOR v_lead IN (
    SELECT l.*
    FROM public.leads l
    WHERE NOT EXISTS (SELECT 1 FROM public.form_submissions fs WHERE fs.lead_id = l.id)
    ORDER BY l.created_at ASC
  ) LOOP
    -- A. Try to recover from lead_intake_events (Full payload)
    SELECT * INTO v_intake
    FROM public.lead_intake_events
    WHERE lead_id = v_lead.id AND status = 'processed'
    ORDER BY received_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_payload := COALESCE(v_intake.normalized_payload, v_intake.raw_payload);
      IF v_payload IS NOT NULL AND jsonb_typeof(v_payload) = 'object' THEN
        INSERT INTO public.form_submissions (
          lead_id,
          intake_event_id,
          idempotency_key,
          form_name,
          source,
          source_detail,
          submitted_at,
          submitted_data,
          email,
          email_confirmation,
          email_mismatch,
          phone_e164,
          contact_preference,
          course_interest,
          recovery_state,
          notes,
          processed_at
        ) VALUES (
          v_lead.id,
          v_intake.id,
          COALESCE(v_intake.idempotency_key, 'intake_backfill_' || v_intake.id),
          COALESCE(v_payload->>'form_name', v_payload->>'course_title', v_payload->>'course_interest', 'Formulário Meta Lead Ads'),
          COALESCE(v_intake.source, v_lead.source, 'meta'),
          COALESCE(v_payload->>'source_detail', v_lead.source_detail, 'meta_lead_ad'),
          COALESCE((v_payload->>'source_created_at')::timestamptz, v_intake.received_at, v_lead.created_at),
          v_payload,
          COALESCE(v_payload->>'email', v_lead.email),
          COALESCE(v_payload->>'email_confirmation', v_lead.email_confirmation),
          COALESCE(v_lead.email_mismatch, false),
          COALESCE(v_lead.phone_e164, v_lead.phone_raw),
          COALESCE(v_payload->>'contact_preference', v_lead.contact_preference),
          COALESCE(v_payload->>'course_interest', v_lead.course_interest),
          'complete',
          'Recuperado com sucesso a partir do payload original de intake',
          now()
        );
        v_recovered_full := v_recovered_full + 1;
        CONTINUE;
      END IF;
    END IF;

    -- B. If Meta Lead Ad or Website contact with lead attributes, recover partial form
    IF lower(COALESCE(v_lead.source, '')) IN ('meta', 'facebook', 'instagram')
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%meta%'
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%lead_ad%'
       OR lower(COALESCE(v_lead.source, '')) = 'form'
       OR lower(COALESCE(v_lead.source_detail, '')) = 'contact_form' THEN

      v_sub_data := jsonb_build_object(
        'first_name', v_lead.first_name,
        'last_name', v_lead.last_name,
        'email', v_lead.email,
        'email_confirmation', v_lead.email_confirmation,
        'phone', v_lead.phone_raw,
        'contact_preference', v_lead.contact_preference,
        'course_interest', v_lead.course_interest,
        'source', v_lead.source,
        'source_detail', v_lead.source_detail
      );

      INSERT INTO public.form_submissions (
        lead_id,
        idempotency_key,
        form_name,
        source,
        source_detail,
        submitted_at,
        submitted_data,
        email,
        email_confirmation,
        email_mismatch,
        phone_e164,
        contact_preference,
        course_interest,
        recovery_state,
        notes,
        processed_at
      ) VALUES (
        v_lead.id,
        'lead_attr_backfill_' || v_lead.id,
        COALESCE(v_lead.course_interest, 'Formulário de Inscrição'),
        COALESCE(v_lead.source, 'meta'),
        COALESCE(v_lead.source_detail, 'lead_ad'),
        COALESCE(v_lead.source_created_at, v_lead.created_at),
        v_sub_data,
        v_lead.email,
        v_lead.email_confirmation,
        COALESCE(v_lead.email_mismatch, false),
        COALESCE(v_lead.phone_e164, v_lead.phone_raw),
        v_lead.contact_preference,
        v_lead.course_interest,
        'partially_recovered',
        'Recuperado a partir do registro cadastral e metadados de aquisição',
        now()
      );
      v_recovered_partial := v_recovered_partial + 1;
      CONTINUE;
    END IF;

    -- C. Pure manual CRM entries or unmapped historical imports without forms
    v_unrecoverable := v_unrecoverable + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'leads_with_empty_forms_before', v_leads_empty_before,
    'historical_forms_recovered_full', v_recovered_full,
    'historical_forms_recovered_partial', v_recovered_partial,
    'forms_without_recoverable_data', v_unrecoverable
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_lead_form_submissions() TO service_role;

-- 4. Persistent Security & RLS for Private Form Processing RPC
-- Ensure process_form_submission_transaction is private to service_role (Edge Functions only),
-- preventing unauthorized direct anonymous/public execution while allowing submit-public-form.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' AND p.proname = 'process_form_submission_transaction'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.process_form_submission_transaction FROM anon, authenticated, public;
    GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO service_role;
  END IF;
END $$;
