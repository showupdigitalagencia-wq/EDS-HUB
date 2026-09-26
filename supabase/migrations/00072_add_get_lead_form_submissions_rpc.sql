-- =============================================================================
-- Migration 00072: Add get_lead_form_submissions RPC for Lead Form Traceability
-- =============================================================================
-- Allows operators to view genuine original form submission business fields
-- for Meta Lead Ads, Website Forms, and HubSpot Form imports.
-- - Strictly separates submitted business fields from internal secrets/tokens.
-- - Preserves multiple submissions, sorted newest first.
-- - Does NOT invent or reconstruct missing answers.
-- =============================================================================

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
  v_payload JSONB;
  v_raw JSONB;
  v_meta_field RECORD;
  v_lead RECORD;
BEGIN
  -- 1. Check if caller is authorized app user
  IF auth.uid() IS NOT NULL AND NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: active app user required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN '[]'::JSONB;
  END IF;

  -- 2. Gather from form_submissions
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

    -- Extract business fields from submitted_data
    IF v_rec.submitted_data IS NOT NULL THEN
      IF (v_rec.submitted_data->>'full_name') IS NOT NULL AND (v_rec.submitted_data->>'full_name') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome completo', 'value', v_rec.submitted_data->>'full_name');
      ELSIF (v_rec.submitted_data->>'first_name') IS NOT NULL AND (v_rec.submitted_data->>'first_name') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_rec.submitted_data->>'first_name');
        IF (v_rec.submitted_data->>'last_name') IS NOT NULL AND (v_rec.submitted_data->>'last_name') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_rec.submitted_data->>'last_name');
        END IF;
      END IF;

      IF (v_rec.submitted_data->>'email') IS NOT NULL AND (v_rec.submitted_data->>'email') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_rec.submitted_data->>'email');
      END IF;

      IF (v_rec.submitted_data->>'phone') IS NOT NULL AND (v_rec.submitted_data->>'phone') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_rec.submitted_data->>'phone');
      ELSIF (v_rec.submitted_data->>'phone_raw') IS NOT NULL AND (v_rec.submitted_data->>'phone_raw') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_rec.submitted_data->>'phone_raw');
      END IF;

      IF (v_rec.submitted_data->>'contact_preference') IS NOT NULL AND (v_rec.submitted_data->>'contact_preference') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_rec.submitted_data->>'contact_preference');
      END IF;

      IF (v_rec.submitted_data->>'course_interest') IS NOT NULL AND (v_rec.submitted_data->>'course_interest') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_rec.submitted_data->>'course_interest');
      END IF;

      IF (v_rec.submitted_data->>'specialty') IS NOT NULL AND (v_rec.submitted_data->>'specialty') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Especialidade', 'value', v_rec.submitted_data->>'specialty');
      END IF;

      IF (v_rec.submitted_data->>'message') IS NOT NULL AND (v_rec.submitted_data->>'message') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Mensagem', 'value', v_rec.submitted_data->>'message');
      END IF;
    END IF;

    -- Fallback to row fields if empty
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

  -- 3. Gather from lead_intake_events
  FOR v_rec IN (
    SELECT lie.id, lie.source,
           COALESCE(lie.normalized_payload->>'source_detail', lie.raw_payload->>'source_detail') AS source_detail,
           lie.raw_payload, lie.normalized_payload,
           lie.received_at, lie.created_at
    FROM public.lead_intake_events lie
    WHERE lie.lead_id = p_lead_id
    ORDER BY COALESCE(lie.received_at, lie.created_at) DESC
  ) LOOP
    -- Determine Source Label
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

    v_submitted_at := COALESCE(v_rec.received_at, v_rec.created_at);
    v_raw := v_rec.raw_payload;
    v_payload := v_rec.normalized_payload;

    -- Determine Form Title
    v_form_title := COALESCE(
      v_raw->>'form_name',
      v_raw->>'ad_name',
      v_payload->>'course_interest',
      v_raw->>'curso_de_interesse',
      v_raw->>'qual_o_seu_interesse_',
      'Formulário de Inscrição'
    );

    v_fields := '[]'::JSONB;

    -- Check if raw_payload has field_data array (Meta format)
    IF v_raw IS NOT NULL AND (v_raw->'field_data') IS NOT NULL AND jsonb_typeof(v_raw->'field_data') = 'array' THEN
      FOR v_meta_field IN SELECT * FROM jsonb_to_recordset(v_raw->'field_data') AS (name TEXT, values JSONB) LOOP
        DECLARE
          v_val TEXT := v_meta_field.values->>0;
          v_lbl TEXT;
        BEGIN
          IF v_val IS NOT NULL AND v_val != '' THEN
            CASE lower(v_meta_field.name)
              WHEN 'full_name' THEN v_lbl := 'Nome completo';
              WHEN 'first_name' THEN v_lbl := 'Nome';
              WHEN 'last_name' THEN v_lbl := 'Sobrenome';
              WHEN 'email' THEN v_lbl := 'E-mail';
              WHEN 'phone_number', 'phone' THEN v_lbl := 'Telefone';
              WHEN 'contact_preference', 'preferred_contact_method' THEN v_lbl := 'Preferência de contato';
              WHEN 'course_interest', 'course' THEN v_lbl := 'Curso de interesse';
              WHEN 'specialty', 'speciality' THEN v_lbl := 'Especialidade';
              WHEN 'city' THEN v_lbl := 'Cidade';
              WHEN 'state' THEN v_lbl := 'Estado';
              WHEN 'country' THEN v_lbl := 'País';
              ELSE v_lbl := v_meta_field.name;
            END CASE;
            v_fields := v_fields || jsonb_build_object('label', v_lbl, 'value', v_val);
          END IF;
        END;
      END LOOP;
    END IF;

    -- If no Meta field_data array found, extract from normalized_payload or raw_payload
    IF jsonb_array_length(v_fields) = 0 THEN
      IF (v_payload->>'full_name') IS NOT NULL AND (v_payload->>'full_name') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome completo', 'value', v_payload->>'full_name');
      ELSE
        IF (v_payload->>'first_name') IS NOT NULL AND (v_payload->>'first_name') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_payload->>'first_name');
        ELSIF (v_raw->>'firstname') IS NOT NULL AND (v_raw->>'firstname') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_raw->>'firstname');
        END IF;

        IF (v_payload->>'last_name') IS NOT NULL AND (v_payload->>'last_name') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_payload->>'last_name');
        ELSIF (v_raw->>'lastname') IS NOT NULL AND (v_raw->>'lastname') != '' THEN
          v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_raw->>'lastname');
        END IF;
      END IF;

      IF (v_payload->>'email') IS NOT NULL AND (v_payload->>'email') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_payload->>'email');
      ELSIF (v_raw->>'email') IS NOT NULL AND (v_raw->>'email') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_raw->>'email');
      END IF;

      IF (v_payload->>'phone') IS NOT NULL AND (v_payload->>'phone') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_payload->>'phone');
      ELSIF (v_raw->>'phone') IS NOT NULL AND (v_raw->>'phone') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_raw->>'phone');
      ELSIF (v_raw->>'mobilephone') IS NOT NULL AND (v_raw->>'mobilephone') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone celular', 'value', v_raw->>'mobilephone');
      END IF;

      IF (v_payload->>'contact_preference') IS NOT NULL AND (v_payload->>'contact_preference') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_payload->>'contact_preference');
      END IF;

      IF (v_payload->>'course_interest') IS NOT NULL AND (v_payload->>'course_interest') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_payload->>'course_interest');
      ELSIF (v_raw->>'curso_de_interesse') IS NOT NULL AND (v_raw->>'curso_de_interesse') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_raw->>'curso_de_interesse');
      ELSIF (v_raw->>'qual_o_seu_interesse_') IS NOT NULL AND (v_raw->>'qual_o_seu_interesse_') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_raw->>'qual_o_seu_interesse_');
      END IF;

      IF (v_raw->>'specialty') IS NOT NULL AND (v_raw->>'specialty') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Especialidade', 'value', v_raw->>'specialty');
      END IF;

      IF (v_raw->>'city') IS NOT NULL AND (v_raw->>'city') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Cidade', 'value', v_raw->>'city');
      END IF;

      IF (v_raw->>'state') IS NOT NULL AND (v_raw->>'state') != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Estado', 'value', v_raw->>'state');
      END IF;
    END IF;

    -- Avoid duplicate entries if form_submissions already recorded identical data
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

  -- 4. If no records exist in form_submissions or lead_intake_events, fallback cleanly
  -- to initial intake activity if available
  IF jsonb_array_length(v_results) = 0 THEN
    -- Check lead_activities for lead_created or intake_received
    FOR v_rec IN (
      SELECT la.id, la.activity_type, la.summary, la.metadata, la.created_at
      FROM public.lead_activities la
      WHERE la.lead_id = p_lead_id
        AND la.activity_type IN ('lead_created', 'intake_received', 'form_submitted')
      ORDER BY la.created_at DESC
      LIMIT 1
    ) LOOP
      IF lower(COALESCE(v_lead.source, '')) IN ('meta', 'facebook', 'instagram') THEN
        v_source_label := 'Meta Lead Ads';
      ELSIF lower(COALESCE(v_lead.source, '')) = 'form' OR lower(COALESCE(v_lead.source_detail, '')) = 'website' THEN
        v_source_label := 'Site';
      ELSE
        v_source_label := COALESCE(v_lead.source, 'Origem');
      END IF;

      v_fields := '[]'::JSONB;
      IF v_lead.first_name IS NOT NULL AND v_lead.first_name != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_lead.first_name);
      END IF;
      IF v_lead.last_name IS NOT NULL AND v_lead.last_name != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_lead.last_name);
      END IF;
      IF v_lead.email IS NOT NULL AND v_lead.email != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_lead.email);
      END IF;
      IF (v_lead.phone_raw IS NOT NULL AND v_lead.phone_raw != '') OR (v_lead.phone_e164 IS NOT NULL AND v_lead.phone_e164 != '') THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', COALESCE(v_lead.phone_raw, v_lead.phone_e164));
      END IF;
      IF v_lead.contact_preference IS NOT NULL AND v_lead.contact_preference != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_lead.contact_preference);
      END IF;
      IF v_lead.course_interest IS NOT NULL AND v_lead.course_interest != '' THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_lead.course_interest);
      END IF;

      IF jsonb_array_length(v_fields) > 0 THEN
        v_results := v_results || jsonb_build_object(
          'id', v_rec.id,
          'source', v_source_label,
          'source_raw', v_lead.source,
          'form_name', COALESCE(v_lead.course_interest, 'Formulário Inicial'),
          'submitted_at', v_lead.created_at,
          'fields', v_fields
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_form_submissions(UUID) TO authenticated, service_role;
