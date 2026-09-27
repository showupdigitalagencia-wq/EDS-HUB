-- =============================================================================
-- Migration 00077: Production Consolidation, SMS Template Fix, Form Traceability,
-- and Controlled One-Time Pipeline Baseline Reset
-- =============================================================================

-- 1. Extend lead_stage_history change_reason to include 'baseline_reset'
ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN (
    'initial_assignment',
    'auto_after_intake',
    'manual',
    'csv_import_stage_mapping',
    'enrollment_confirmed',
    'course_completed',
    'post_course_transition',
    'alumni_transition',
    'baseline_reset'
  ));

-- 2. Create audit table for the controlled one-time baseline reset
CREATE TABLE IF NOT EXISTS public.pipeline_baseline_reset_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_stage_id UUID NOT NULL,
  to_stage_id UUID NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Controlled One-Time Pipeline Baseline Reset:
-- Freeze the target active leads currently in Novo Lead (capture: fe2a6162-1574-409f-975e-d2b5bafb9862)
-- and move ONLY that frozen set to Respondido (qualification: 5dd772b7-4ce8-425d-ac9a-46811a76d5fe)
DO $$
DECLARE
  v_capture_id CONSTANT UUID := 'fe2a6162-1574-409f-975e-d2b5bafb9862';
  v_qual_id CONSTANT UUID := '5dd772b7-4ce8-425d-ac9a-46811a76d5fe';
  v_count INTEGER;
BEGIN
  -- Snapshot frozen lead IDs
  INSERT INTO public.pipeline_baseline_reset_audit (lead_id, from_stage_id, to_stage_id)
  SELECT id, v_capture_id, v_qual_id
  FROM public.leads
  WHERE pipeline_stage_id = v_capture_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Baseline reset snapshot: % leads frozen for movement from Novo Lead to Respondido', v_count;

  -- Move only the frozen set
  UPDATE public.leads
  SET
    pipeline_stage_id = v_qual_id,
    qualification_status = 'some_response',
    updated_at = now()
  WHERE id IN (SELECT lead_id FROM public.pipeline_baseline_reset_audit);

  -- Record stage history entries for auditability
  INSERT INTO public.lead_stage_history (
    lead_id,
    from_stage_id,
    to_stage_id,
    change_reason,
    changed_at
  )
  SELECT
    lead_id,
    from_stage_id,
    to_stage_id,
    'baseline_reset',
    now()
  FROM public.pipeline_baseline_reset_audit;
END $$;

-- 4. Correct SMS Template Name and Canonical Body in public.email_templates
UPDATE public.email_templates
SET
  name = 'Contato SMS inicial',
  text_template = '{{salutation_line}}
This is Natália from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings for our November 7 to 10 course. Would those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.',
  html_template = '',
  category = 'sms',
  content_json = jsonb_build_object('channel', 'sms'),
  updated_at = now()
WHERE template_key = 'zygomatic_followup_sms' OR (category = 'sms' AND name ILIKE '%zygomatic%');

-- 5. Correct SMS Template in public.transactional_templates
UPDATE public.transactional_templates
SET
  body_template = '{{salutation_line}}
This is Natália from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings for our November 7 to 10 course. Would those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.',
  updated_at = now()
WHERE key = 'zygomatic_followup_sms';

-- 6. Replace get_lead_form_submissions RPC with Dynamic Full Business Field Extraction
-- Excludes sensitive/prohibited fields and formats all business fields dynamically.
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
  v_form_title TEXT;
  v_submitted_at TIMESTAMPTZ;
  v_raw JSONB;
  v_payload JSONB;
  v_key TEXT;
  v_val TEXT;
  v_label TEXT;
  v_lead RECORD;
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

  -- 1. Form Submissions (Website Forms)
  FOR v_rec IN (
    SELECT fs.id, fs.form_id, fs.submitted_data, fs.submitted_at, fs.source_detail,
           fs.course_interest, fs.email, fs.phone_e164, fs.contact_preference,
           f.name AS form_name, f.slug AS form_slug
    FROM public.form_submissions fs
    LEFT JOIN public.forms f ON f.id = fs.form_id
    WHERE fs.lead_id = p_lead_id
    ORDER BY fs.submitted_at DESC
  ) LOOP
    v_source_label := 'Site';
    v_form_title := COALESCE(v_rec.form_name, v_rec.form_slug, v_rec.course_interest, 'Formulário do Site');
    v_submitted_at := v_rec.submitted_at;
    v_fields := '[]'::JSONB;

    -- Dynamically iterate over submitted_data keys
    IF v_rec.submitted_data IS NOT NULL AND jsonb_typeof(v_rec.submitted_data) = 'object' THEN
      FOR v_key, v_val IN SELECT key, value#>>'{}' FROM jsonb_each(v_rec.submitted_data) LOOP
        -- Skip prohibited / sensitive keys
        IF lower(v_key) = ANY(v_prohibited) OR lower(v_key) LIKE '%password%' OR lower(v_key) LIKE '%token%' OR lower(v_key) LIKE '%secret%' THEN
          CONTINUE;
        END IF;

        IF v_val IS NOT NULL AND trim(v_val) != '' THEN
          CASE lower(v_key)
            WHEN 'first_name' THEN v_label := 'Nome';
            WHEN 'last_name' THEN v_label := 'Sobrenome';
            WHEN 'full_name', 'name' THEN v_label := 'Nome completo';
            WHEN 'email' THEN v_label := 'E-mail';
            WHEN 'phone', 'phone_number', 'phone_raw' THEN v_label := 'Telefone';
            WHEN 'contact_preference', 'preferred_contact_method' THEN v_label := 'Preferência de contato';
            WHEN 'course', 'course_interest', 'curso_de_interesse' THEN v_label := 'Curso de interesse';
            WHEN 'course_session', 'session', 'data_do_curso' THEN v_label := 'Data / Turma do curso';
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
            WHEN 'utm_campaign' THEN v_label := 'UTM Campaign';
            WHEN 'utm_content' THEN v_label := 'UTM Content';
            WHEN 'utm_term' THEN v_label := 'UTM Term';
            WHEN 'message', 'mensagem' THEN v_label := 'Mensagem';
            WHEN 'city', 'cidade' THEN v_label := 'Cidade';
            WHEN 'state', 'estado' THEN v_label := 'Estado';
            WHEN 'country', 'pais' THEN v_label := 'País';
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

    v_results := v_results || jsonb_build_object(
      'id', v_rec.id,
      'source', v_source_label,
      'source_raw', 'form',
      'form_name', v_form_title,
      'submitted_at', v_submitted_at,
      'fields', v_fields
    );
  END LOOP;

  -- 2. Lead Intake Events (Meta Lead Ads, Website, HubSpot)
  FOR v_rec IN (
    SELECT lie.id, lie.source,
           COALESCE(lie.normalized_payload->>'source_detail', lie.raw_payload->>'source_detail') AS source_detail,
           lie.raw_payload, lie.normalized_payload,
           lie.received_at
    FROM public.lead_intake_events lie
    WHERE lie.lead_id = p_lead_id
    ORDER BY lie.received_at DESC
  ) LOOP
    IF lower(COALESCE(v_rec.source, '')) IN ('meta', 'facebook', 'instagram', 'fb', 'ig') OR
       lower(COALESCE(v_rec.source_detail, '')) IN ('meta', 'facebook', 'instagram', 'meta_ad') THEN
      v_source_label := 'Meta Lead Ads';
    ELSIF lower(COALESCE(v_rec.source, '')) = 'form' OR lower(COALESCE(v_rec.source_detail, '')) = 'website' THEN
      v_source_label := 'Site';
    ELSIF lower(COALESCE(v_rec.source, '')) = 'hubspot' OR lower(COALESCE(v_rec.source_detail, '')) LIKE '%hubspot%' THEN
      v_source_label := 'HubSpot';
    ELSE
      v_source_label := COALESCE(v_rec.source, 'Origem Externa');
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

    -- Also extract campaign/ad attribution from raw_payload if available
    IF v_raw IS NOT NULL THEN
      IF (v_raw->>'ad_name') IS NOT NULL AND (v_raw->>'ad_name') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Anúncio', 'value', v_raw->>'ad_name');
      END IF;
      IF (v_raw->>'campaign_name') IS NOT NULL AND (v_raw->>'campaign_name') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Campanha', 'value', v_raw->>'campaign_name');
      END IF;
    END IF;

    -- If no field_data array was present, dynamically extract from raw_payload or normalized_payload
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
        'fields', v_fields
      );
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
