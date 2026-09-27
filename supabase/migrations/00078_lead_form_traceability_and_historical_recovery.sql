-- =============================================================================
-- Migration 00078: Complete Historical + Future Lead Form Traceability
-- =============================================================================
-- 1. Modifies public.form_submissions to support external and historical forms:
--    - Makes form_id NULLABLE (for external Meta & HubSpot forms without internal forms table row)
--    - Adds form_name, source, external_form_id, external_submission_id, recovery_state, notes
--    - Updates idempotency_key constraint for universal unique deduplication
-- 2. Hardens trigger trg_capture_form_submitted_event to suppress automations on historical backfills
-- 3. Updates get_lead_form_submissions RPC with multi-source fallback resolution:
--    - Resolves form_submissions (both website and external Meta/HubSpot)
--    - Resolves lead_intake_events
--    - Resolves factual historical fallback for form-originated leads
--    - Excludes sensitive prohibited keys
--    - Renders all fields dynamically with human-readable labels
-- 4. Updates process_hubspot_inbound_batch to persist form_submissions on inbound HubSpot events
-- =============================================================================

-- 1. Relax form_id constraint & add traceability columns to public.form_submissions
ALTER TABLE public.form_submissions 
  ALTER COLUMN form_id DROP NOT NULL;

ALTER TABLE public.form_submissions 
  DROP CONSTRAINT IF EXISTS form_submissions_processing_status_check;

ALTER TABLE public.form_submissions 
  ADD CONSTRAINT form_submissions_processing_status_check 
  CHECK (processing_status = ANY (ARRAY['received'::text, 'processing'::text, 'processed'::text, 'conflict'::text, 'failed'::text, 'historical_backfill'::text]));

ALTER TABLE public.form_submissions 
  ADD COLUMN IF NOT EXISTS form_name TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS external_form_id TEXT,
  ADD COLUMN IF NOT EXISTS external_submission_id TEXT,
  ADD COLUMN IF NOT EXISTS recovery_state TEXT DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Replace compound unique constraint with unique index on idempotency_key
ALTER TABLE public.form_submissions 
  DROP CONSTRAINT IF EXISTS form_submissions_form_idempotency_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submissions_idempotency_key 
  ON public.form_submissions(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_form_submissions_lead_submitted 
  ON public.form_submissions(lead_id, submitted_at DESC);

-- 2. Update trigger trg_capture_form_submitted_event to suppress automations on backfills
CREATE OR REPLACE FUNCTION public.trg_capture_form_submitted_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strict suppression for historical imports, syncs, and backfills
  IF current_setting('app.sync_origin', true) IN ('hubspot_sync', 'hubspot_historical', 'hubspot_reconcile', 'backfill', 'historical_backfill')
     OR NEW.source_detail IN ('hubspot_historical', 'backfill', 'historical_backfill')
     OR NEW.processing_status = 'historical_backfill' THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO public.automation_events (
      event_type,
      lead_id,
      source_table,
      source_record_id,
      source_event_key,
      payload
    ) VALUES (
      'form_submitted',
      NEW.lead_id,
      'form_submissions',
      NEW.id::text,
      'form_submission:' || NEW.id::text,
      jsonb_build_object(
        'form_id', NEW.form_id,
        'form_name', NEW.form_name,
        'form_version', NEW.form_version,
        'source', NEW.source,
        'source_detail', NEW.source_detail,
        'course_interest', NEW.course_interest,
        'contact_preference', NEW.contact_preference,
        'submitted_data', NEW.submitted_data
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Replace get_lead_form_submissions RPC with Dynamic Full Business Field & Multi-Source Resolution
CREATE OR REPLACE FUNCTION public.get_lead_form_submissions(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results JSONB := '[]'::JSONB;
  v_rec RECORD;
  v_fields JSONB;
  v_source_label TEXT;
  v_source_raw TEXT;
  v_form_title TEXT;
  v_submitted_at TIMESTAMPTZ;
  v_raw JSONB;
  v_payload JSONB;
  v_key TEXT;
  v_val TEXT;
  v_label TEXT;
  v_lead RECORD;
  v_seen_sub_ids TEXT[] := ARRAY[]::TEXT[];
  v_sync_via TEXT;
  v_recovery_state TEXT;
  v_notes TEXT;
  v_prohibited CONSTANT TEXT[] := ARRAY[
    'medical_conditions', 'medical_condition', 'dietary', 'dietary_restrictions',
    'allergies', 'allergy', 'passport', 'passport_number', 'passport_file',
    'dental_license_file', 'license_file', 'emergency_phone', 'emergency_contact',
    'signature', 'password', 'payment', 'credit_card', 'card_number', 'cvv',
    'token', 'secret', 'csrf', 'session_id', 'cookie', 'raw_form_data', 'raw_data',
    'api_key', 'access_token', 'headers', 'authorization'
  ];
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: active app user required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN '[]'::JSONB;
  END IF;

  -- 1. Form Submissions (Canonical form_submissions table)
  FOR v_rec IN (
    SELECT fs.id, fs.form_id, fs.form_name, fs.source, fs.source_detail,
           fs.submitted_data, fs.submitted_at, fs.course_interest, fs.email,
           fs.phone_e164, fs.contact_preference, fs.recovery_state, fs.notes,
           f.name AS catalog_form_name, f.slug AS catalog_form_slug
    FROM public.form_submissions fs
    LEFT JOIN public.forms f ON f.id = fs.form_id
    WHERE fs.lead_id = p_lead_id
    ORDER BY fs.submitted_at DESC
  ) LOOP
    v_source_raw := COALESCE(v_rec.source, v_rec.source_detail, 'form');
    
    -- Format Factual Source Label
    IF lower(v_source_raw) LIKE '%instagram%' THEN
      v_source_label := 'Instagram Lead Ads';
    ELSIF lower(v_source_raw) LIKE '%facebook%' THEN
      v_source_label := 'Facebook Lead Ads';
    ELSIF lower(v_source_raw) LIKE '%meta%' THEN
      v_source_label := 'Meta Lead Ads';
    ELSIF lower(v_source_raw) LIKE '%website%' OR lower(v_source_raw) = 'form' OR lower(v_source_raw) = 'site' THEN
      v_source_label := 'Site';
    ELSIF lower(v_source_raw) LIKE '%hubspot%' THEN
      v_source_label := 'HubSpot';
    ELSE
      v_source_label := COALESCE(v_rec.source, 'Site');
    END IF;

    v_form_title := COALESCE(
      v_rec.form_name,
      v_rec.catalog_form_name,
      v_rec.catalog_form_slug,
      v_rec.course_interest,
      'Formulário de Inscrição'
    );
    v_submitted_at := v_rec.submitted_at;
    v_fields := '[]'::JSONB;
    v_sync_via := NULL;
    v_recovery_state := COALESCE(v_rec.recovery_state, 'complete');
    v_notes := v_rec.notes;

    -- Dynamically iterate over submitted_data keys
    IF v_rec.submitted_data IS NOT NULL AND jsonb_typeof(v_rec.submitted_data) = 'object' THEN
      FOR v_key, v_val IN SELECT key, value#>>'{}' FROM jsonb_each(v_rec.submitted_data) LOOP
        -- Skip prohibited / sensitive keys
        IF lower(v_key) = ANY(v_prohibited) OR lower(v_key) LIKE '%password%' OR lower(v_key) LIKE '%token%' OR lower(v_key) LIKE '%secret%' THEN
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
            WHEN 'confirm_your_email', 'confirm_email', 'please_confirm_your_email_address' THEN v_label := 'Confirmação de e-mail';
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
            WHEN 'specialty', 'speciality', 'especialidade' THEN v_label := 'Especialidade';
            WHEN 'years_in_practice', 'tempo_de_formado' THEN v_label := 'Anos de prática';
            WHEN 'surgical_experience', 'experiencia_cirurgica' THEN v_label := 'Experiência cirúrgica';
            WHEN 'agd_number', 'numero_agd' THEN v_label := 'Número AGD';
            WHEN 'heard_from', 'como_conheceu' THEN v_label := 'Como soube de nós';
            WHEN 'referral_name', 'indicado_por' THEN v_label := 'Indicado por';
            WHEN 'promo_code', 'cupom' THEN v_label := 'Código promocional';
            WHEN 'terms_accepted' THEN v_label := 'Termos aceitos';
            WHEN 'source_page', 'page_url' THEN v_label := 'Página de origem';
            WHEN 'utm_source' THEN v_label := 'UTM Source';
            WHEN 'utm_medium' THEN v_label := 'UTM Medium';
            WHEN 'utm_campaign', 'campaign', 'campaign_name' THEN v_label := 'Campanha';
            WHEN 'ad_name', 'anuncio' THEN v_label := 'Anúncio';
            WHEN 'utm_content' THEN v_label := 'UTM Content';
            WHEN 'utm_term' THEN v_label := 'UTM Term';
            WHEN 'source_platform', 'origem_do_lead' THEN v_label := 'Plataforma de origem';
            WHEN 'synchronized_via' THEN v_label := 'Sincronizado via';
            WHEN 'message', 'mensagem' THEN v_label := 'Mensagem';
            WHEN 'city', 'cidade' THEN v_label := 'Cidade';
            WHEN 'state', 'estado' THEN v_label := 'Estado';
            WHEN 'country', 'pais', 'ip_country' THEN v_label := 'País';
            ELSE
              v_label := initcap(replace(v_key, '_', ' '));
          END CASE;

          v_fields := v_fields || jsonb_build_object('label', v_label, 'value', trim(v_val));
        END IF;
      END LOOP;
    END IF;

    -- Fallback row fields if empty
    IF jsonb_array_length(v_fields) = 0 THEN
      IF v_rec.email IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_rec.email);
      END IF;
      IF v_rec.phone_e164 IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_rec.phone_e164);
      END IF;
      IF v_rec.course_interest IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_rec.course_interest);
      END IF;
      IF v_rec.contact_preference IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_rec.contact_preference);
      END IF;
    END IF;

    v_seen_sub_ids := array_append(v_seen_sub_ids, v_rec.id::text);

    v_results := v_results || jsonb_build_object(
      'id', v_rec.id,
      'source', v_source_label,
      'source_raw', v_source_raw,
      'form_name', v_form_title,
      'submitted_at', v_submitted_at,
      'synchronized_via', v_sync_via,
      'recovery_state', v_recovery_state,
      'notes', v_notes,
      'fields', v_fields
    );
  END LOOP;

  -- 2. Lead Intake Events (Meta Lead Ads, Website, HubSpot fallback)
  FOR v_rec IN (
    SELECT lie.id, lie.source,
           COALESCE(lie.normalized_payload->>'source_detail', lie.raw_payload->>'source_detail') AS source_detail,
           lie.raw_payload, lie.normalized_payload,
           lie.received_at
    FROM public.lead_intake_events lie
    WHERE lie.lead_id = p_lead_id
    ORDER BY lie.received_at DESC
  ) LOOP
    -- Only include if not already represented in results
    IF NOT (v_rec.id::text = ANY(v_seen_sub_ids)) THEN
      IF lower(COALESCE(v_rec.source, '')) IN ('meta', 'facebook', 'instagram', 'fb', 'ig') OR
         lower(COALESCE(v_rec.source_detail, '')) IN ('meta', 'facebook', 'instagram', 'meta_ad') THEN
        v_source_label := 'Meta Lead Ads';
      ELSIF lower(COALESCE(v_rec.source, '')) = 'form' OR lower(COALESCE(v_rec.source_detail, '')) = 'website' THEN
        v_source_label := 'Site';
      ELSIF lower(COALESCE(v_rec.source, '')) = 'hubspot' OR lower(COALESCE(v_rec.source_detail, '')) LIKE '%hubspot%' THEN
        v_source_label := 'HubSpot';
      ELSE
        v_source_label := COALESCE(v_rec.source, 'Site');
      END IF;

      v_submitted_at := v_rec.received_at;
      v_raw := v_rec.raw_payload;
      v_payload := v_rec.normalized_payload;

      v_form_title := COALESCE(
        v_raw->>'form_name',
        v_raw->>'ad_name',
        v_payload->>'course_interest',
        v_raw->>'curso_de_interesse',
        v_raw->>'qual_o_seu_interesse_',
        'Formulário de Inscrição'
      );

      v_fields := '[]'::JSONB;

      -- Meta format: field_data array
      IF v_raw IS NOT NULL AND (v_raw->'field_data') IS NOT NULL AND jsonb_typeof(v_raw->'field_data') = 'array' THEN
        DECLARE
          v_meta_row RECORD;
        BEGIN
          FOR v_meta_row IN SELECT * FROM jsonb_to_recordset(v_raw->'field_data') AS (name TEXT, values JSONB) LOOP
            IF v_meta_row.name IS NOT NULL THEN
              IF lower(v_meta_row.name) = ANY(v_prohibited) OR lower(v_meta_row.name) LIKE '%password%' OR lower(v_meta_row.name) LIKE '%token%' THEN
                CONTINUE;
              END IF;

              v_val := v_meta_row.values->>0;
              IF v_val IS NOT NULL AND trim(v_val) != '' THEN
                CASE lower(v_meta_row.name)
                  WHEN 'full_name' THEN v_label := 'Nome completo';
                  WHEN 'first_name' THEN v_label := 'Nome';
                  WHEN 'last_name' THEN v_label := 'Sobrenome';
                  WHEN 'email' THEN v_label := 'E-mail';
                  WHEN 'phone_number', 'phone' THEN v_label := 'Telefone';
                  WHEN 'contact_preference', 'preferred_contact_method' THEN v_label := 'Preferência de contato';
                  WHEN 'course_interest', 'course' THEN v_label := 'Curso de interesse';
                  WHEN 'specialty', 'speciality' THEN v_label := 'Especialidade';
                  WHEN 'city' THEN v_label := 'Cidade';
                  WHEN 'state' THEN v_label := 'Estado';
                  WHEN 'country' THEN v_label := 'País';
                  ELSE
                    v_label := initcap(replace(v_meta_row.name, '_', ' '));
                END CASE;

                v_fields := v_fields || jsonb_build_object('label', v_label, 'value', trim(v_val));
              END IF;
            END IF;
          END LOOP;
        END;
      END IF;

      -- Campaign / Ad attribution
      IF v_raw IS NOT NULL THEN
        IF (v_raw->>'ad_name') IS NOT NULL AND (v_raw->>'ad_name') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Anúncio', 'value', v_raw->>'ad_name');
        END IF;
        IF (v_raw->>'campaign_name') IS NOT NULL AND (v_raw->>'campaign_name') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Campanha', 'value', v_raw->>'campaign_name');
        END IF;
      END IF;

      -- Dynamic fallback from raw_payload or normalized_payload
      IF jsonb_array_length(v_fields) = 0 AND v_raw IS NOT NULL AND jsonb_typeof(v_raw) = 'object' THEN
        FOR v_key, v_val IN SELECT key, value#>>'{}' FROM jsonb_each(v_raw) LOOP
          IF lower(v_key) = ANY(v_prohibited) OR lower(v_key) LIKE '%password%' OR lower(v_key) LIKE '%token%' OR lower(v_key) LIKE '%secret%' THEN
            CONTINUE;
          END IF;

          IF v_val IS NOT NULL AND trim(v_val) != '' AND length(v_val) < 500 AND NOT (v_val LIKE '{%' OR v_val LIKE '[%') THEN
            CASE lower(v_key)
              WHEN 'firstname', 'first_name' THEN v_label := 'Nome';
              WHEN 'lastname', 'last_name' THEN v_label := 'Sobrenome';
              WHEN 'full_name', 'name' THEN v_label := 'Nome completo';
              WHEN 'email' THEN v_label := 'E-mail';
              WHEN 'phone', 'phone_number', 'mobilephone' THEN v_label := 'Telefone';
              WHEN 'contact_preference' THEN v_label := 'Preferência de contato';
              WHEN 'course_interest', 'curso_de_interesse', 'qual_o_seu_interesse_' THEN v_label := 'Curso de interesse';
              WHEN 'specialty', 'speciality' THEN v_label := 'Especialidade';
              WHEN 'city' THEN v_label := 'Cidade';
              WHEN 'state' THEN v_label := 'Estado';
              ELSE
                v_label := initcap(replace(v_key, '_', ' '));
            END CASE;

            v_fields := v_fields || jsonb_build_object('label', v_label, 'value', trim(v_val));
          END IF;
        END LOOP;
      END IF;

      IF jsonb_array_length(v_fields) > 0 THEN
        v_results := v_results || jsonb_build_object(
          'id', v_rec.id,
          'source', v_source_label,
          'source_raw', v_rec.source,
          'form_name', v_form_title,
          'submitted_at', v_submitted_at,
          'recovery_state', 'complete',
          'fields', v_fields
        );
      END IF;
    END IF;
  END LOOP;

  -- 3. Factual Historical Fallback for Form-Originated Leads
  -- If NO submission was recorded, but lead metadata proves that lead originated from a form:
  IF jsonb_array_length(v_results) = 0 THEN
    IF lower(COALESCE(v_lead.source, '')) IN ('meta', 'facebook', 'instagram')
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%meta%'
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%instagram%'
       OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%facebook%'
       OR lower(COALESCE(v_lead.source, '')) = 'form'
       OR lower(COALESCE(v_lead.source_detail, '')) = 'website'
       OR (v_lead.hubspot_contact_id IS NOT NULL AND v_lead.source != 'manual') THEN

      IF lower(COALESCE(v_lead.source, '')) IN ('meta', 'facebook', 'instagram')
         OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%meta%'
         OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%instagram%'
         OR lower(COALESCE(v_lead.source_detail, '')) LIKE '%facebook%' THEN
        v_source_label := 'Meta Lead Ads';
      ELSIF lower(COALESCE(v_lead.source, '')) = 'form' OR lower(COALESCE(v_lead.source_detail, '')) = 'website' THEN
        v_source_label := 'Site';
      ELSE
        v_source_label := 'Meta Lead Ads';
      END IF;

      v_form_title := COALESCE(v_lead.course_interest, 'Formulário de Inscrição');
      v_submitted_at := COALESCE(v_lead.source_created_at, v_lead.created_at);
      v_fields := '[]'::JSONB;

      IF v_lead.first_name IS NOT NULL AND trim(v_lead.first_name) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', trim(v_lead.first_name));
      END IF;
      IF v_lead.last_name IS NOT NULL AND trim(v_lead.last_name) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', trim(v_lead.last_name));
      END IF;
      IF v_lead.email IS NOT NULL AND trim(v_lead.email) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', trim(v_lead.email));
      END IF;
      IF COALESCE(v_lead.phone_e164, v_lead.phone_raw) IS NOT NULL AND trim(COALESCE(v_lead.phone_e164, v_lead.phone_raw)) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', trim(COALESCE(v_lead.phone_e164, v_lead.phone_raw)));
      END IF;
      IF v_lead.course_interest IS NOT NULL AND trim(v_lead.course_interest) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', trim(v_lead.course_interest));
      END IF;
      IF v_lead.contact_preference IS NOT NULL AND trim(v_lead.contact_preference) != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', upper(trim(v_lead.contact_preference)));
      END IF;
      IF v_lead.hubspot_contact_id IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Sincronizado via', 'value', 'HubSpot (ID: ' || v_lead.hubspot_contact_id || ')');
      END IF;

      IF jsonb_array_length(v_fields) > 0 THEN
        v_results := v_results || jsonb_build_object(
          'id', v_lead.id,
          'source', v_source_label,
          'source_raw', v_lead.source,
          'form_name', v_form_title,
          'submitted_at', v_submitted_at,
          'synchronized_via', CASE WHEN v_lead.hubspot_contact_id IS NOT NULL THEN 'HubSpot' ELSE NULL END,
          'recovery_state', 'partially_recovered',
          'notes', 'Formulário histórico parcialmente recuperado. Algumas respostas originais não estão mais disponíveis na fonte.',
          'fields', v_fields
        );
      END IF;
    END IF;
  END IF;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_form_submissions(UUID) TO authenticated, service_role, anon;

-- 4. Idempotency constraint for upserts
ALTER TABLE public.form_submissions 
  DROP CONSTRAINT IF EXISTS form_submissions_idempotency_key_key;
ALTER TABLE public.form_submissions 
  ADD CONSTRAINT form_submissions_idempotency_key_key UNIQUE USING INDEX idx_form_submissions_idempotency_key;

-- 5. Helper RPC to page unbackfilled form leads
CREATE OR REPLACE FUNCTION public.get_unbackfilled_form_leads(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone_e164 TEXT,
  phone_raw TEXT,
  source TEXT,
  source_detail TEXT,
  course_interest TEXT,
  hubspot_contact_id TEXT,
  source_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    l.id,
    l.first_name,
    l.last_name,
    l.email,
    l.phone_e164,
    l.phone_raw,
    l.source,
    l.source_detail,
    l.course_interest,
    l.hubspot_contact_id,
    l.source_created_at,
    l.created_at
  FROM public.leads l
  WHERE l.hubspot_contact_id IS NOT NULL
    AND l.deleted_at IS NULL
    AND (l.source IN ('meta', 'form', 'website') OR l.source_detail ILIKE '%meta%' OR l.source_detail ILIKE '%form%' OR l.source_detail ILIKE '%lead%')
    AND NOT EXISTS (
      SELECT 1 FROM public.form_submissions fs 
      WHERE fs.lead_id = l.id
    )
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_unbackfilled_form_leads(INT) TO service_role, authenticated, anon;

-- 6. Inbound sync alignment: update process_hubspot_inbound_batch to save form_submissions
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_event_id TEXT;
  v_contact_id TEXT;
  v_props JSONB;
  v_event_ts TIMESTAMPTZ;
  v_payload_hash TEXT;
  v_link_rec RECORD;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_qual_status TEXT;
  v_course_interest_val TEXT;
  v_resolved_course_id UUID;
  v_existing_lead RECORD;
  v_change_diff JSONB := '{}'::jsonb;
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_duplicate INT := 0;
  v_ignored_echo INT := 0;
  v_ignored_stale INT := 0;
  v_ignored_deleted INT := 0;
  v_conflict_count INT := 0;
  v_capture_stage_id UUID;
  v_target_stage_id UUID;
  v_source TEXT;
  v_source_detail TEXT;
  v_contact_pref TEXT;
  v_raw_analytics_1 TEXT;
  v_raw_analytics_src TEXT;
  v_is_update BOOLEAN := false;
BEGIN
  -- Set transaction-local sync origin to suppress loop triggers
  PERFORM set_config('app.sync_origin', 'hubspot_sync', true);

  -- Get default Capture pipeline stage ('Novo Lead')
  SELECT id INTO v_capture_stage_id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    v_is_update := false;
    v_event_id := v_item->>'eventId';
    v_contact_id := COALESCE(v_item->>'objectId', v_item->>'hubspot_contact_id', v_item->>'id');
    v_props := COALESCE(v_item->'properties', v_item->'raw_properties', v_item);
    v_event_ts := COALESCE((v_item->>'occurredAt')::timestamptz, (v_props->>'lastmodifieddate')::timestamptz, (v_props->>'createdate')::timestamptz, now());
    v_payload_hash := encode(sha256(v_props::text::bytea), 'hex');

    -- 1. Idempotency Check on external_event_id
    IF v_event_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.integration_sync_events WHERE integration = 'hubspot' AND external_event_id = v_event_id) THEN
        v_ignored_duplicate := v_ignored_duplicate + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Extract normalized values
    v_email := NULLIF(trim(lower(COALESCE(v_props->>'email', ''))), '');
    v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', ''), '\D', '', 'g'), '');
    v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', '')), '');
    v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', '')), '');
    v_qual_status := NULLIF(trim(COALESCE(v_props->>'status_de_qualificacao', v_props->>'hs_lead_status', v_props->>'qualification_status', '')), '');
    v_course_interest_val := NULLIF(trim(COALESCE(v_props->>'curso_de_interesse', v_props->>'course_interest', '')), '');

    -- Contact preference extraction (do NOT default to email)
    v_contact_pref := NULLIF(trim(lower(COALESCE(v_props->>'contact_preference', v_props->>'preferencia_de_contato', v_props->>'preferred_contact_method', ''))), '');
    IF v_contact_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
      v_contact_pref := NULL;
    END IF;

    -- Website vs HubSpot source attribution
    v_raw_analytics_1 := lower(COALESCE(v_props->>'hs_analytics_source_data_1', ''));
    v_raw_analytics_src := lower(COALESCE(v_props->>'hs_analytics_source', ''));
    IF v_raw_analytics_1 LIKE '%expdentalsolutions.com%' OR v_raw_analytics_1 LIKE '%website%' OR v_raw_analytics_src LIKE '%website%' THEN
      v_source := 'form';
      v_source_detail := 'website';
    ELSE
      v_source := 'hubspot';
      v_source_detail := 'continuous_sync';
    END IF;

    -- Pipeline stage resolution from status_de_qualificacao
    v_target_stage_id := NULL;
    IF v_qual_status IS NOT NULL THEN
      IF lower(v_qual_status) IN ('confirmado', 'confirmed', 'matricula', 'matrícula') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'enrollment' LIMIT 1;
      ELSIF lower(v_qual_status) IN ('quente', 'hot', 'approval') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'approval' LIMIT 1;
      ELSIF lower(v_qual_status) IN ('interessado', 'interested', 'acquisition') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'acquisition' LIMIT 1;
      ELSIF lower(v_qual_status) IN ('alguma resposta', 'some_response', 'qualification') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'qualification' LIMIT 1;
      END IF;
    END IF;
    IF v_target_stage_id IS NULL THEN
      v_target_stage_id := v_capture_stage_id;
    END IF;

    -- 2. ANTI-RESURRECTION CHECK FOR SOFT-DELETED LEADS
    IF EXISTS (
      SELECT 1 FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'archived'
    ) OR EXISTS (
      SELECT 1 FROM public.leads
      WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(trim(email)) = v_email))
        AND deleted_at IS NOT NULL
    ) THEN
      INSERT INTO public.integration_sync_events (
        integration, direction, entity_type, eds_entity_id, external_entity_id,
        event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
      ) VALUES (
        'hubspot', 'inbound', 'lead', NULL, v_contact_id,
        'contact.ignored_deleted', v_event_id, v_event_ts, v_payload_hash, 'ignored_deleted',
        jsonb_build_object('reason', 'Lead is deleted/archived in EDS HUB. Inbound recreation blocked.')
      );
      v_ignored_deleted := v_ignored_deleted + 1;
      CONTINUE;
    END IF;

    -- 3. Find Link / Matching Hierarchy
    v_matched_lead_id := NULL;

    -- Priority 1: Existing active link in integration_entity_links
    SELECT eds_entity_id, last_synced_hash, external_updated_at INTO v_link_rec
    FROM public.integration_entity_links
    WHERE integration = 'hubspot'
      AND entity_type = 'lead'
      AND external_entity_id = v_contact_id
      AND status = 'active'
    LIMIT 1;

    IF v_link_rec.eds_entity_id IS NOT NULL THEN
      v_matched_lead_id := v_link_rec.eds_entity_id;

      -- Check Out-of-Order Stale Event
      IF v_link_rec.external_updated_at IS NOT NULL AND v_event_ts < v_link_rec.external_updated_at THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
          'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'ignored_stale',
          jsonb_build_object('reason', 'Incoming event timestamp is older than recorded version')
        );
        v_ignored_stale := v_ignored_stale + 1;
        CONTINUE;
      END IF;

      -- Check Echo Loop (hash match)
      IF v_link_rec.last_synced_hash IS NOT NULL AND v_link_rec.last_synced_hash = v_payload_hash THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
          'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'ignored_echo',
          jsonb_build_object('reason', 'Payload hash identical to last synced state')
        );
        v_ignored_echo := v_ignored_echo + 1;
        CONTINUE;
      END IF;

    ELSE
      -- Priority 2: Mirrored hubspot_contact_id in public.leads (active only)
      SELECT id INTO v_matched_lead_id
      FROM public.leads
      WHERE hubspot_contact_id = v_contact_id
        AND deleted_at IS NULL
      LIMIT 1;

      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        -- Priority 3: Normalized Unique Email Match (active only)
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE lower(trim(email)) = v_email
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_EMAIL_MATCH',
            'Email ' || v_email || ' matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'email', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Priority 4: Normalized Unique Phone Match (active only)
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL THEN
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_PHONE_MATCH',
            'Phone matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'phone', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- 4. Execute Update or Create
    v_change_diff := '{}'::jsonb;

    IF v_matched_lead_id IS NOT NULL THEN
      -- UPDATE EXISTING MATCHED LEAD
      v_is_update := true;
      SELECT first_name, last_name, email, phone_raw, qualification_status, pipeline_stage_id INTO v_existing_lead
      FROM public.leads WHERE id = v_matched_lead_id AND deleted_at IS NULL;

      -- Email Collision Safety Check
      IF v_email IS NOT NULL AND v_existing_lead.email IS DISTINCT FROM v_email THEN
        IF EXISTS (SELECT 1 FROM public.leads WHERE lower(trim(email)) = v_email AND id <> v_matched_lead_id AND deleted_at IS NULL) THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, eds_entity_id, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data, eds_data
          ) VALUES (
            'hubspot', 'lead', v_matched_lead_id, v_contact_id, 'EMAIL_COLLISION',
            'New email from HubSpot collides with a different existing lead',
            'email', v_props, to_jsonb(v_existing_lead)
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Apply non-destructive updates
      UPDATE public.leads
      SET
        first_name = COALESCE(v_first_name, first_name),
        last_name = COALESCE(v_last_name, last_name),
        email = COALESCE(v_email, email),
        phone_raw = COALESCE(v_phone, phone_raw),
        contact_preference = COALESCE(v_contact_pref, contact_preference),
        hubspot_contact_id = v_contact_id,
        updated_at = now()
      WHERE id = v_matched_lead_id;

      -- Upsert active integration_entity_link
      INSERT INTO public.integration_entity_links (
        integration, entity_type, eds_entity_id, external_entity_id,
        status, last_synced_hash, external_updated_at, last_inbound_sync_at
      ) VALUES (
        'hubspot', 'lead', v_matched_lead_id, v_contact_id,
        'active', v_payload_hash, v_event_ts, now()
      ) ON CONFLICT (integration, entity_type, eds_entity_id) WHERE status = 'active'
      DO UPDATE SET
        external_entity_id = EXCLUDED.external_entity_id,
        last_synced_hash = EXCLUDED.last_synced_hash,
        external_updated_at = EXCLUDED.external_updated_at,
        last_inbound_sync_at = EXCLUDED.last_inbound_sync_at,
        updated_at = now();

      -- Course Interest Normalization
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) 
           OR lower(code) = lower(v_course_interest_val)
           OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'hubspot_field_updated', 'system',
        'Lead updated via HubSpot sync', jsonb_build_object('external_id', v_contact_id)
      );

      v_updated_count := v_updated_count + 1;

    ELSE
      -- CREATE NEW LEAD
      v_is_update := false;
      INSERT INTO public.leads (
        first_name, last_name, email, phone_raw, contact_preference,
        source, source_detail, pipeline_stage_id, hubspot_contact_id,
        source_created_at, created_at, updated_at
      ) VALUES (
        v_first_name, v_last_name, v_email, v_phone, v_contact_pref,
        v_source, v_source_detail, v_target_stage_id, v_contact_id,
        COALESCE(v_event_ts, now()), now(), now()
      ) RETURNING id INTO v_matched_lead_id;

      -- Create initial active link
      INSERT INTO public.integration_entity_links (
        integration, entity_type, eds_entity_id, external_entity_id,
        status, last_synced_hash, external_updated_at, last_inbound_sync_at
      ) VALUES (
        'hubspot', 'lead', v_matched_lead_id, v_contact_id,
        'active', v_payload_hash, v_event_ts, now()
      );

      -- Course Interest Normalization for new lead
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) 
           OR lower(code) = lower(v_course_interest_val)
           OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'lead_created', 'system',
        'Lead imported via HubSpot inbound sync (' || v_source_detail || ')', jsonb_build_object('external_id', v_contact_id, 'source', v_source, 'source_detail', v_source_detail)
      );

      v_created_count := v_created_count + 1;
    END IF;

    -- Store form_submissions and lead_intake_events record for form/website attribution traceability
    IF v_source = 'form' OR v_source = 'meta' OR v_props->>'curso_de_interesse' IS NOT NULL OR v_props->>'course_interest' IS NOT NULL THEN
      INSERT INTO public.form_submissions (
        lead_id,
        form_name,
        source,
        submitted_at,
        submitted_data,
        email,
        phone_e164,
        contact_preference,
        course_interest,
        source_detail,
        processing_status,
        recovery_state,
        idempotency_key
      ) VALUES (
        v_matched_lead_id,
        COALESCE(v_props->>'form_name', v_course_interest_val, 'Formulário de Inscrição'),
        CASE 
          WHEN lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' THEN 'Instagram Lead Ads'
          WHEN lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' THEN 'Facebook Lead Ads'
          WHEN v_source = 'form' THEN 'Site'
          ELSE 'Meta Lead Ads'
        END,
        COALESCE(v_event_ts, now()),
        v_props,
        v_email,
        v_phone,
        v_contact_pref,
        v_course_interest_val,
        v_source_detail,
        'completed',
        'complete',
        'hubspot_form_sub:' || v_contact_id || ':' || COALESCE(v_event_id, 'initial')
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      INSERT INTO public.lead_intake_events (
        source, external_event_id, external_lead_id, idempotency_key,
        raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
      ) VALUES (
        CASE WHEN v_source = 'form' THEN 'form' ELSE 'meta' END,
        v_contact_id, v_contact_id,
        'hubspot_intake:' || v_contact_id || ':' || COALESCE(v_event_id, 'initial'),
        v_props,
        jsonb_build_object(
          'first_name', v_first_name,
          'last_name', v_last_name,
          'email', v_email,
          'phone', v_phone,
          'contact_preference', v_contact_pref,
          'course_interest', v_course_interest_val,
          'source_detail', v_source_detail
        ),
        'processed', v_matched_lead_id, 1, COALESCE(v_event_ts, now())
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- Record Successful Sync Event
    INSERT INTO public.integration_sync_events (
      integration, direction, entity_type, eds_entity_id, external_entity_id,
      event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
    ) VALUES (
      'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
      'contact.synced', v_event_id, v_event_ts, v_payload_hash, 'completed',
      jsonb_build_object('action', CASE WHEN v_is_update THEN 'update' ELSE 'create' END)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'ignored_duplicate', v_ignored_duplicate,
    'ignored_echo', v_ignored_echo,
    'ignored_stale', v_ignored_stale,
    'ignored_deleted', v_ignored_deleted,
    'conflict_count', v_conflict_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO service_role;

