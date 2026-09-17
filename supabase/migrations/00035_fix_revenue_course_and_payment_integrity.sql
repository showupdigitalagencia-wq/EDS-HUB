-- =============================================================================
-- Migration 00035: Fix Revenue Course Catalog and Payment Integrity
-- 1. Correct course catalog to reflect real Expert Dental Solutions courses with NULL prices
-- 2. Add refund transaction modeling (payment_type, parent_payment_id)
-- 3. Add explicit idempotency keys to enrollments and enrollment_payments
-- 4. Update transactional RPCs and revenue aggregator with corrected formulas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Correct Seeded Courses (Safe replacement without deleting referenced data)
-- -----------------------------------------------------------------------------

-- Archive / remove unverified seeded courses if not referenced by any enrollment
DELETE FROM public.courses 
WHERE code IN ('comprehensive-esthetics', 'full-arch-mastery', 'surgical-foundations', 'intensive-residency', 'wisdom-teeth', 'CE-01', 'FAM-01', 'SF-01', 'IR-01', 'WTE-01')
  AND NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.course_id = courses.id);

-- If any of the old courses were referenced by an enrollment, mark them inactive instead of deleting
UPDATE public.courses
SET active = false
WHERE code IN ('comprehensive-esthetics', 'full-arch-mastery', 'surgical-foundations', 'intensive-residency', 'wisdom-teeth', 'CE-01', 'FAM-01', 'SF-01', 'IR-01', 'WTE-01');

-- Insert the 9 verified courses from the official Expert Dental Solutions site
-- All prices set to NULL as per official request (to be configured in Settings/Admin)
INSERT INTO public.courses (code, name, default_price, currency, active)
VALUES
  ('IDIT-01', 'Intensive Dental Implant Training', NULL, 'USD', true),
  ('ADIE-01', 'Advanced Dental Implant Experience', NULL, 'USD', true),
  ('AIRE-01', 'Advanced Implant Rehabilitation Experience', NULL, 'USD', true),
  ('ZIT-01', 'Zygomatic Implant Training', NULL, 'USD', true),
  ('WTT-01', 'Wisdom Teeth Training', NULL, 'USD', true),
  ('ET-01', 'Endodontics Training', NULL, 'USD', true),
  ('PST-01', 'Periodontal Surgery Training', NULL, 'USD', true),
  ('MA-01', 'Maxillofacial Anomalies', NULL, 'USD', true),
  ('PRF-01', 'PRF In-Office', NULL, 'USD', true)
ON CONFLICT (code) DO UPDATE
SET 
  name = EXCLUDED.name,
  active = EXCLUDED.active;

-- -----------------------------------------------------------------------------
-- 2. Explicit Idempotency Keys on Enrollments and Payments
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'enrollments' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.enrollments ADD COLUMN idempotency_key text NULL UNIQUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'enrollment_payments' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.enrollment_payments ADD COLUMN idempotency_key text NULL UNIQUE;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Refund Accounting Columns on Enrollment Payments
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'enrollment_payments' AND column_name = 'payment_type'
  ) THEN
    ALTER TABLE public.enrollment_payments 
    ADD COLUMN payment_type text NOT NULL DEFAULT 'payment' 
    CHECK (payment_type IN ('payment', 'refund'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'enrollment_payments' AND column_name = 'parent_payment_id'
  ) THEN
    ALTER TABLE public.enrollment_payments 
    ADD COLUMN parent_payment_id uuid NULL REFERENCES public.enrollment_payments(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_enrollment_payments_parent ON public.enrollment_payments(parent_payment_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_payments_type_status ON public.enrollment_payments(payment_type, payment_status);

-- -----------------------------------------------------------------------------
-- 4. Update RPC: create_enrollment_transaction (with explicit idempotency_key)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_enrollment_transaction(uuid, uuid, text, numeric, text, date, text, text, text, numeric, text, text, date, text);

CREATE OR REPLACE FUNCTION public.create_enrollment_transaction(
  p_lead_id uuid,
  p_course_id uuid,
  p_agreed_amount numeric,
  p_currency text DEFAULT 'USD',
  p_enrollment_status text DEFAULT 'confirmed',
  p_enrollment_date date DEFAULT CURRENT_DATE,
  p_source text DEFAULT 'manual',
  p_notes text DEFAULT NULL,
  p_initial_payment_amount numeric DEFAULT NULL,
  p_initial_payment_method text DEFAULT NULL,
  p_initial_payment_ref text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_lead_record record;
  v_course_record record;
  v_enrollment_id uuid;
  v_payment_id uuid;
  v_current_stage_order integer;
  v_enrollment_stage_id uuid;
  v_enrollment_stage_order integer;
  v_alumni_stage_order integer;
BEGIN
  -- 1. Verify Caller is an Active App User
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  -- 2. Explicit Idempotency Check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) != '' THEN
    SELECT id INTO v_enrollment_id 
    FROM public.enrollments 
    WHERE idempotency_key = trim(p_idempotency_key);
    
    IF v_enrollment_id IS NOT NULL THEN
      -- Return existing enrollment ID immediately without duplicate writes or events
      RETURN v_enrollment_id;
    END IF;
  END IF;

  -- 3. Fallback duplicate check: same lead, course, and amount within last 60 seconds
  SELECT id INTO v_enrollment_id
  FROM public.enrollments
  WHERE lead_id = p_lead_id
    AND course_id = p_course_id
    AND agreed_amount = p_agreed_amount
    AND created_at >= (now() - interval '60 seconds');

  IF v_enrollment_id IS NOT NULL THEN
    RETURN v_enrollment_id;
  END IF;

  -- 4. Validate Lead
  SELECT * INTO v_lead_record FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead with id % not found.', p_lead_id;
  END IF;

  -- 5. Validate Course
  SELECT * INTO v_course_record FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course with id % not found.', p_course_id;
  END IF;
  IF NOT v_course_record.active THEN
    RAISE EXCEPTION 'Course "%" is currently inactive.', v_course_record.name;
  END IF;

  -- 6. Validate Data
  IF p_agreed_amount < 0 THEN
    RAISE EXCEPTION 'Agreed amount must be greater than or equal to zero.';
  END IF;
  IF p_enrollment_status NOT IN ('pending', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid enrollment status "%". Allowed: pending, confirmed, cancelled.', p_enrollment_status;
  END IF;
  IF p_currency IS NULL OR length(trim(p_currency)) != 3 THEN
    RAISE EXCEPTION 'Invalid currency "%". Must be a 3-letter ISO code.', p_currency;
  END IF;

  -- 7. Insert Enrollment
  INSERT INTO public.enrollments (
    lead_id,
    course_id,
    course_name_snapshot,
    agreed_amount,
    currency,
    enrollment_status,
    enrollment_date,
    source,
    notes,
    idempotency_key
  ) VALUES (
    p_lead_id,
    p_course_id,
    v_course_record.name,
    p_agreed_amount,
    upper(trim(p_currency)),
    p_enrollment_status,
    p_enrollment_date,
    p_source,
    p_notes,
    CASE WHEN p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) != '' THEN trim(p_idempotency_key) ELSE NULL END
  ) RETURNING id INTO v_enrollment_id;

  -- 8. Record Initial History
  INSERT INTO public.enrollment_history (
    enrollment_id,
    lead_id,
    actor_id,
    actor_email,
    event_type,
    old_values,
    new_values
  ) VALUES (
    v_enrollment_id,
    p_lead_id,
    v_caller_id,
    NULL,
    'enrollment_created',
    NULL,
    jsonb_build_object(
      'course_id', p_course_id,
      'course_name', v_course_record.name,
      'status', p_enrollment_status,
      'agreed_amount', p_agreed_amount,
      'currency', upper(trim(p_currency))
    )
  );

  -- 9. Record Initial Payment if provided
  IF p_initial_payment_amount IS NOT NULL AND p_initial_payment_amount > 0 THEN
    INSERT INTO public.enrollment_payments (
      enrollment_id,
      amount,
      currency,
      payment_status,
      payment_type,
      payment_date,
      payment_method,
      external_reference,
      notes,
      idempotency_key
    ) VALUES (
      v_enrollment_id,
      p_initial_payment_amount,
      upper(trim(p_currency)),
      'paid',
      'payment',
      p_enrollment_date,
      COALESCE(p_initial_payment_method, 'credit_card'),
      p_initial_payment_ref,
      'Initial payment recorded upon enrollment creation.',
      CASE WHEN p_idempotency_key IS NOT NULL THEN trim(p_idempotency_key) || ':initial_payment' ELSE NULL END
    ) RETURNING id INTO v_payment_id;

    -- Record payment audit history
    INSERT INTO public.enrollment_history (
      enrollment_id,
      lead_id,
      actor_id,
      actor_email,
      event_type,
      old_values,
      new_values
    ) VALUES (
      v_enrollment_id,
      p_lead_id,
      v_caller_id,
      NULL,
      'payment_added',
      NULL,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'amount', p_initial_payment_amount,
        'currency', upper(trim(p_currency)),
        'payment_type', 'payment'
      )
    );
  END IF;

  -- 10. Pipeline Move if confirmed
  IF p_enrollment_status = 'confirmed' THEN
    SELECT id, sort_order INTO v_enrollment_stage_id, v_enrollment_stage_order
    FROM public.pipeline_stages
    WHERE code = 'enrollment';

    SELECT sort_order INTO v_current_stage_order
    FROM public.pipeline_stages
    WHERE id = v_lead_record.pipeline_stage_id;

    SELECT sort_order INTO v_alumni_stage_order
    FROM public.pipeline_stages
    WHERE code = 'alumni';

    -- Only advance if current stage is prior to enrollment (no downgrade from post_course or alumni)
    IF v_enrollment_stage_id IS NOT NULL 
       AND (v_lead_record.pipeline_stage_id IS NULL OR v_current_stage_order < v_enrollment_stage_order) THEN
       
      UPDATE public.leads
      SET 
        pipeline_stage_id = v_enrollment_stage_id,
        updated_at = now()
      WHERE id = p_lead_id;

      INSERT INTO public.lead_stage_history (
        lead_id,
        from_stage_id,
        to_stage_id,
        change_reason,
        changed_by_user_id
      ) VALUES (
        p_lead_id,
        v_lead_record.pipeline_stage_id,
        v_enrollment_stage_id,
        'enrollment_confirmed',
        v_caller_id
      );

      INSERT INTO public.lead_activities (
        lead_id,
        activity_type,
        actor_type,
        summary,
        metadata
      ) VALUES (
        p_lead_id,
        'enrollment_confirmed',
        'user',
        'Lead transitioned to Enrollment stage following confirmed course enrollment.',
        jsonb_build_object(
          'enrollment_id', v_enrollment_id,
          'course_name', v_course_record.name,
          'agreed_amount', p_agreed_amount,
          'changed_by_user_id', v_caller_id
        )
      );
    END IF;
  END IF;

  RETURN v_enrollment_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Update RPC: record_enrollment_payment (with idempotency, type, and parent)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_enrollment_payment(uuid, numeric, text, text, date, text, text, text, text);

CREATE OR REPLACE FUNCTION public.record_enrollment_payment(
  p_enrollment_id uuid,
  p_amount numeric,
  p_currency text DEFAULT 'USD',
  p_payment_method text DEFAULT 'credit_card',
  p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_status text DEFAULT 'paid',
  p_external_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_payment_type text DEFAULT 'payment',
  p_parent_payment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_enrollment_record record;
  v_payment_id uuid;
  v_parent_record record;
  v_already_refunded numeric;
BEGIN
  -- 1. Check permissions
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  -- 2. Explicit Idempotency Check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) != '' THEN
    SELECT id INTO v_payment_id 
    FROM public.enrollment_payments 
    WHERE idempotency_key = trim(p_idempotency_key);
    
    IF v_payment_id IS NOT NULL THEN
      RETURN v_payment_id;
    END IF;
  END IF;

  -- 3. Validate Enrollment
  SELECT * INTO v_enrollment_record FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  -- 4. Validate Amount & Status
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment/Refund amount must be strictly greater than zero.';
  END IF;
  IF p_payment_status NOT IN ('pending', 'paid', 'refunded', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid payment status "%".', p_payment_status;
  END IF;
  IF p_payment_type NOT IN ('payment', 'refund') THEN
    RAISE EXCEPTION 'Invalid payment_type "%". Must be "payment" or "refund".', p_payment_type;
  END IF;

  -- 5. Refund Specific Validations
  IF p_payment_type = 'refund' THEN
    IF p_parent_payment_id IS NULL THEN
      RAISE EXCEPTION 'Refund requires a valid parent_payment_id referencing the original payment.';
    END IF;

    SELECT * INTO v_parent_record FROM public.enrollment_payments WHERE id = p_parent_payment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent payment % not found.', p_parent_payment_id;
    END IF;
    IF v_parent_record.payment_type != 'payment' THEN
      RAISE EXCEPTION 'Parent payment must be of type "payment", cannot refund a refund.';
    END IF;
    IF v_parent_record.payment_status != 'paid' THEN
      RAISE EXCEPTION 'Parent payment is not in "paid" status. Cannot refund unpaid transactions.';
    END IF;

    -- Calculate already refunded sum for this parent payment
    SELECT COALESCE(SUM(amount), 0) INTO v_already_refunded
    FROM public.enrollment_payments
    WHERE parent_payment_id = p_parent_payment_id
      AND payment_type = 'refund'
      AND payment_status = 'paid';

    IF (v_already_refunded + p_amount) > v_parent_record.amount THEN
      RAISE EXCEPTION 'Refund amount (%) exceeds remaining refundable balance (%).', 
        p_amount, (v_parent_record.amount - v_already_refunded);
    END IF;
  END IF;

  -- 6. Insert Payment Record
  INSERT INTO public.enrollment_payments (
    enrollment_id,
    amount,
    currency,
    payment_status,
    payment_type,
    parent_payment_id,
    payment_date,
    payment_method,
    external_reference,
    notes,
    idempotency_key
  ) VALUES (
    p_enrollment_id,
    p_amount,
    upper(trim(p_currency)),
    p_payment_status,
    p_payment_type,
    p_parent_payment_id,
    p_payment_date,
    p_payment_method,
    p_external_ref,
    p_notes,
    CASE WHEN p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) != '' THEN trim(p_idempotency_key) ELSE NULL END
  ) RETURNING id INTO v_payment_id;

  -- 7. Audit History
  INSERT INTO public.enrollment_history (
    enrollment_id,
    lead_id,
    actor_id,
    actor_email,
    event_type,
    old_values,
    new_values
  ) VALUES (
    p_enrollment_id,
    v_enrollment_record.lead_id,
    v_caller_id,
    NULL,
    CASE WHEN p_payment_type = 'refund' THEN 'payment_status_changed' ELSE 'payment_added' END,
    NULL,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'amount', p_amount,
      'currency', upper(trim(p_currency)),
      'payment_type', p_payment_type,
      'parent_payment_id', p_parent_payment_id
    )
  );

  RETURN v_payment_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Helper RPC: record_enrollment_refund
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_enrollment_refund(
  p_parent_payment_id uuid,
  p_amount numeric,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent record;
BEGIN
  SELECT * INTO v_parent FROM public.enrollment_payments WHERE id = p_parent_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent payment % not found.', p_parent_payment_id;
  END IF;

  RETURN public.record_enrollment_payment(
    p_enrollment_id => v_parent.enrollment_id,
    p_amount => p_amount,
    p_currency => v_parent.currency,
    p_payment_method => v_parent.payment_method,
    p_payment_date => CURRENT_DATE,
    p_payment_status => 'paid',
    p_external_ref => 'Refund for payment ' || p_parent_payment_id::text,
    p_notes => p_reason,
    p_idempotency_key => p_idempotency_key,
    p_payment_type => 'refund',
    p_parent_payment_id => p_parent_payment_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Update RPC: get_revenue_dashboard_metrics (with corrected refund accounting)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_revenue_dashboard_metrics(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
  v_caller_id UUID;
  
  -- KPIs
  v_booked_value NUMERIC(12,2) := 0.00;
  v_collected_revenue NUMERIC(12,2) := 0.00;
  v_refunded_amount NUMERIC(12,2) := 0.00;
  v_net_revenue NUMERIC(12,2) := 0.00;
  v_outstanding_balance NUMERIC(12,2) := 0.00;
  
  v_confirmed_enrollments_count INT := 0;
  v_paid_enrollments_count INT := 0;
  v_average_ticket NUMERIC(12,2) := NULL;
  v_avg_collected_per_enrollment NUMERIC(12,2) := NULL;

  -- Cohort conversion
  v_leads_created_in_period INT := 0;
  v_leads_created_enrolled INT := 0;
  v_lead_to_enrollment_rate NUMERIC(5,2) := NULL;

  v_leads_entered_approval_count INT := 0;
  v_leads_approval_enrolled INT := 0;
  v_approval_to_enrollment_rate NUMERIC(5,2) := NULL;

  -- Time to enrollment
  v_avg_days_to_enrollment NUMERIC(6,1) := NULL;

  -- Settings & Targets
  v_settings RECORD;
  v_revenue_progress_pct NUMERIC(5,1) := NULL;
  v_enrollment_progress_pct NUMERIC(5,1) := NULL;

  -- Breakdowns
  v_course_performance JSONB := '[]'::jsonb;
  v_source_performance JSONB := '[]'::jsonb;
  v_approved_not_enrolled JSONB := '[]'::jsonb;
  v_velocity JSONB := '[]'::jsonb;
BEGIN
  -- 1. Check Caller is Active App User
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  v_start_date := p_start_date::date;
  v_end_date := p_end_date::date;

  SELECT 
    monthly_net_revenue_target,
    monthly_enrollment_target,
    COALESCE(default_currency, 'USD') AS default_currency
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;

  -- 1. Booked Value & Confirmed Enrollments in period (USD only)
  SELECT 
    COALESCE(SUM(agreed_amount), 0.00),
    COUNT(*)
  INTO v_booked_value, v_confirmed_enrollments_count
  FROM public.enrollments
  WHERE enrollment_status = 'confirmed'
    AND enrollment_date >= v_start_date
    AND enrollment_date <= v_end_date
    AND currency = 'USD';

  -- 2. Gross Collected Revenue & Refunded Amount in period (USD only)
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' AND p.payment_type = 'payment' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_type = 'refund' OR p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END), 0.00)
  INTO v_collected_revenue, v_refunded_amount
  FROM public.enrollment_payments p
  WHERE p.payment_date >= v_start_date
    AND p.payment_date <= v_end_date
    AND p.currency = 'USD';

  v_net_revenue := v_collected_revenue - v_refunded_amount;

  -- 3. Paid enrollments count (confirmed enrollments with net paid > 0)
  SELECT COUNT(DISTINCT e.id)
  INTO v_paid_enrollments_count
  FROM public.enrollments e
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= v_start_date
    AND e.enrollment_date <= v_end_date
    AND EXISTS (
      SELECT 1 FROM public.enrollment_payments p
      WHERE p.enrollment_id = e.id AND p.payment_status = 'paid' AND p.payment_type = 'payment'
    );

  -- 4. Outstanding Balance for confirmed enrollments in period
  SELECT COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00)), 0.00)
  INTO v_outstanding_balance
  FROM public.enrollments e
  LEFT JOIN (
    SELECT 
      enrollment_id, 
      SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
               WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
               ELSE 0 END) AS paid_amt
    FROM public.enrollment_payments
    GROUP BY enrollment_id
  ) paid_sum ON paid_sum.enrollment_id = e.id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= v_start_date
    AND e.enrollment_date <= v_end_date
    AND e.currency = 'USD';

  -- 5. Average Ticket & Average Collected
  IF v_confirmed_enrollments_count > 0 THEN
    v_average_ticket := ROUND((v_booked_value / v_confirmed_enrollments_count)::numeric, 2);
  ELSE
    v_average_ticket := NULL;
  END IF;

  IF v_paid_enrollments_count > 0 THEN
    v_avg_collected_per_enrollment := ROUND((v_net_revenue / v_paid_enrollments_count)::numeric, 2);
  ELSE
    v_avg_collected_per_enrollment := NULL;
  END IF;

  -- 6. Cohort 1: Lead -> Enrollment Conversion
  SELECT COUNT(*)
  INTO v_leads_created_in_period
  FROM public.leads
  WHERE created_at >= p_start_date AND created_at <= p_end_date;

  SELECT COUNT(DISTINCT l.id)
  INTO v_leads_created_enrolled
  FROM public.leads l
  JOIN public.enrollments e ON e.lead_id = l.id
  WHERE l.created_at >= p_start_date AND l.created_at <= p_end_date
    AND e.enrollment_status = 'confirmed';

  IF v_leads_created_in_period > 0 THEN
    v_lead_to_enrollment_rate := ROUND(((v_leads_created_enrolled::numeric / v_leads_created_in_period::numeric) * 100.0), 2);
  ELSE
    v_lead_to_enrollment_rate := NULL;
  END IF;

  -- 7. Cohort 2: Approval -> Enrollment Conversion
  SELECT COUNT(DISTINCT h.lead_id)
  INTO v_leads_entered_approval_count
  FROM public.lead_stage_history h
  JOIN public.pipeline_stages s ON s.id = h.to_stage_id
  WHERE s.code = 'approval'
    AND h.changed_at >= p_start_date
    AND h.changed_at <= p_end_date;

  SELECT COUNT(DISTINCT h.lead_id)
  INTO v_leads_approval_enrolled
  FROM public.lead_stage_history h
  JOIN public.pipeline_stages s ON s.id = h.to_stage_id
  JOIN public.enrollments e ON e.lead_id = h.lead_id
  WHERE s.code = 'approval'
    AND h.changed_at >= p_start_date
    AND h.changed_at <= p_end_date
    AND e.enrollment_status = 'confirmed';

  IF v_leads_entered_approval_count > 0 THEN
    v_approval_to_enrollment_rate := ROUND(((v_leads_approval_enrolled::numeric / v_leads_entered_approval_count::numeric) * 100.0), 2);
  ELSE
    v_approval_to_enrollment_rate := NULL;
  END IF;

  -- 8. Time to Enrollment (days from lead creation to confirmed enrollment_date)
  SELECT ROUND(AVG(e.enrollment_date - l.created_at::date)::numeric, 1)
  INTO v_avg_days_to_enrollment
  FROM public.enrollments e
  JOIN public.leads l ON l.id = e.lead_id
  WHERE e.enrollment_status = 'confirmed'
    AND e.enrollment_date >= v_start_date
    AND e.enrollment_date <= v_end_date;

  -- 9. Goals Progress
  IF v_settings.monthly_net_revenue_target > 0 THEN
    v_revenue_progress_pct := LEAST(ROUND(((v_net_revenue / v_settings.monthly_net_revenue_target) * 100.0)::numeric, 1), 999.9);
  END IF;

  IF v_settings.monthly_enrollment_target > 0 THEN
    v_enrollment_progress_pct := LEAST(ROUND(((v_confirmed_enrollments_count::numeric / v_settings.monthly_enrollment_target::numeric) * 100.0), 1), 999.9);
  END IF;

  -- 10. Course Performance
  SELECT jsonb_agg(c_row) INTO v_course_performance
  FROM (
    SELECT 
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      c.default_price,
      c.currency,
      -- Interested leads
      (
        SELECT count(*) FROM public.leads l
        WHERE l.course_interest = c.name 
           OR (l.course_interests IS NOT NULL AND jsonb_typeof(l.course_interests) = 'array' AND l.course_interests ? c.name)
      ) AS interested_leads_count,
      -- Confirmed enrollments in period
      COUNT(e.id) AS confirmed_enrollments_count,
      -- Booked value in period
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_value,
      -- Collected revenue in period
      COALESCE(SUM(COALESCE(p_stats.collected, 0.00)), 0.00) AS collected_revenue,
      -- Net revenue in period
      COALESCE(SUM(COALESCE(p_stats.net, 0.00)), 0.00) AS net_revenue,
      -- Outstanding balance
      COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(p_stats.net, 0.00), 0.00)), 0.00) AS outstanding_balance,
      -- Average Ticket
      CASE 
        WHEN COUNT(e.id) > 0 THEN ROUND((COALESCE(SUM(e.agreed_amount), 0.00) / COUNT(e.id))::numeric, 2)
        ELSE NULL
      END AS average_ticket
    FROM public.courses c
    LEFT JOIN public.enrollments e ON e.course_id = c.id
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= v_start_date
      AND e.enrollment_date <= v_end_date
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount ELSE 0 END) AS collected,
        SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                 WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                 ELSE 0 END) AS net
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id
    ) p_stats ON true
    WHERE c.active = true
    GROUP BY c.id, c.code, c.name, c.default_price, c.currency, c.sort_order
    ORDER BY c.sort_order ASC, booked_value DESC
  ) c_row;

  -- 11. Source Performance
  SELECT jsonb_agg(s_row) INTO v_source_performance
  FROM (
    SELECT 
      src.source_name AS source,
      (SELECT count(*) FROM public.leads WHERE source = src.source_name) AS total_leads,
      COUNT(e.id) AS confirmed_enrollments,
      COALESCE(SUM(e.agreed_amount), 0.00) AS booked_value,
      COALESCE(SUM(COALESCE(p_sub.net_amount, 0.00)), 0.00) AS net_revenue,
      CASE 
        WHEN (SELECT count(*) FROM public.leads WHERE source = src.source_name) > 0 
        THEN ROUND(((COUNT(e.id)::numeric / (SELECT count(*) FROM public.leads WHERE source = src.source_name)::numeric) * 100.0), 2)
        ELSE NULL
      END AS conversion_rate,
      CASE 
        WHEN COUNT(e.id) > 0 THEN ROUND((COALESCE(SUM(e.agreed_amount), 0.00) / COUNT(e.id))::numeric, 2)
        ELSE NULL
      END AS average_ticket
    FROM (
      VALUES ('form'), ('meta'), ('google'), ('manual'), ('test')
    ) AS src(source_name)
    LEFT JOIN public.enrollments e ON e.source = src.source_name
      AND e.enrollment_status = 'confirmed'
      AND e.enrollment_date >= v_start_date
      AND e.enrollment_date <= v_end_date
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount 
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount 
                      ELSE 0 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id
    ) p_sub ON true
    GROUP BY src.source_name
    ORDER BY net_revenue DESC
  ) s_row;

  -- 12. Approved, Not Enrolled List
  SELECT jsonb_agg(ane_row) INTO v_approved_not_enrolled
  FROM (
    SELECT 
      l.id,
      l.first_name,
      l.last_name,
      l.email,
      l.phone_raw,
      l.course_interest,
      l.lead_score,
      l.qualification_status,
      EXTRACT(DAY FROM (now() - COALESCE(h.approval_entered_at, l.updated_at)))::int AS days_in_approval,
      (
        SELECT t.title FROM public.tasks t 
        WHERE t.lead_id = l.id AND t.status = 'pending' 
        ORDER BY t.due_at ASC NULLS LAST LIMIT 1
      ) AS next_action
    FROM public.leads l
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id AND s.code = 'approval'
    LEFT JOIN LATERAL (
      SELECT MIN(changed_at) AS approval_entered_at
      FROM public.lead_stage_history
      WHERE lead_id = l.id AND to_stage_id = s.id
    ) h ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.lead_id = l.id AND e.enrollment_status = 'confirmed'
    )
    ORDER BY l.lead_score DESC NULLS LAST, days_in_approval DESC
    LIMIT 20
  ) ane_row;

  -- 13. Enrollment Velocity
  SELECT jsonb_agg(v_entry) INTO v_velocity
  FROM (
    SELECT 
      to_char(date_trunc('week', enrollment_date), 'YYYY-MM-DD') AS period_start,
      to_char(date_trunc('week', enrollment_date) + interval '6 days', 'YYYY-MM-DD') AS period_end,
      COUNT(*) AS confirmed_enrollments,
      SUM(agreed_amount) AS booked_value
    FROM public.enrollments
    WHERE enrollment_status = 'confirmed'
      AND enrollment_date >= v_start_date
      AND enrollment_date <= v_end_date
    GROUP BY date_trunc('week', enrollment_date)
    ORDER BY date_trunc('week', enrollment_date) ASC
  ) v_entry;

  -- Return Combined JSONB Structure
  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'booked_value', v_booked_value,
      'gross_collected', v_collected_revenue,
      'collected_revenue', v_collected_revenue,
      'refunded_amount', v_refunded_amount,
      'net_revenue', v_net_revenue,
      'outstanding_balance', v_outstanding_balance,
      'confirmed_enrollments_count', v_confirmed_enrollments_count,
      'paid_enrollments_count', v_paid_enrollments_count,
      'average_ticket', v_average_ticket,
      'avg_collected_per_enrollment', v_avg_collected_per_enrollment,
      'avg_days_to_enrollment', v_avg_days_to_enrollment
    ),
    'cohorts', jsonb_build_object(
      'lead_to_enrollment_rate', v_lead_to_enrollment_rate,
      'leads_created_in_period', v_leads_created_in_period,
      'leads_created_enrolled', v_leads_created_enrolled,
      'approval_to_enrollment_rate', v_approval_to_enrollment_rate,
      'leads_entered_approval_count', v_leads_entered_approval_count,
      'leads_approval_enrolled', v_leads_approval_enrolled
    ),
    'goals', jsonb_build_object(
      'monthly_net_revenue_target', v_settings.monthly_net_revenue_target,
      'monthly_enrollment_target', v_settings.monthly_enrollment_target,
      'default_currency', v_settings.default_currency,
      'revenue_progress_pct', v_revenue_progress_pct,
      'enrollment_progress_pct', v_enrollment_progress_pct
    ),
    'course_performance', COALESCE(v_course_performance, '[]'::jsonb),
    'source_performance', COALESCE(v_source_performance, '[]'::jsonb),
    'approved_not_enrolled', COALESCE(v_approved_not_enrolled, '[]'::jsonb),
    'velocity', COALESCE(v_velocity, '[]'::jsonb)
  );
END;
$$;

-- Revoke anon permissions from RPCs
REVOKE EXECUTE ON FUNCTION public.create_enrollment_transaction(uuid, uuid, numeric, text, text, date, text, text, numeric, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_enrollment_transaction(uuid, uuid, numeric, text, text, date, text, text, numeric, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_enrollment_payment(uuid, numeric, text, text, date, text, text, text, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_enrollment_payment(uuid, numeric, text, text, date, text, text, text, text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_enrollment_refund(uuid, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_enrollment_refund(uuid, numeric, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_revenue_dashboard_metrics(timestamp with time zone, timestamp with time zone) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_dashboard_metrics(timestamp with time zone, timestamp with time zone) TO authenticated;
