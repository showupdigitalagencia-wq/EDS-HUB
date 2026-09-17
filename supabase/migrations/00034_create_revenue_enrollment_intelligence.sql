-- =============================================================================
-- Migration 00034: Create Revenue & Enrollment Intelligence (Phase 4 Block 3)
-- =============================================================================
-- Implements:
-- 1. courses table (canonical catalog & default pricing)
-- 2. enrollments table (commercial outcomes & agreed values)
-- 3. enrollment_payments table (auditable payments, partials, refunds)
-- 4. enrollment_history table (change log & audit trail)
-- 5. app_settings revenue & enrollment targets
-- 6. Performance indexes
-- 7. RLS policies (active app users only, anon blocked)
-- 8. Transactional RPCs:
--    - create_enrollment_transaction
--    - update_enrollment_transaction
--    - record_enrollment_payment
--    - update_enrollment_payment_status
-- 9. Aggregator RPC: get_revenue_dashboard_metrics(p_start_date, p_end_date)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Courses Catalog Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  description TEXT NULL,
  default_price NUMERIC(10,2) NULL CHECK (default_price IS NULL OR default_price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Canonical Courses (EDS Core Curriculum)
INSERT INTO public.courses (code, name, description, default_price, currency, sort_order)
VALUES
  ('comprehensive-esthetics', 'Comprehensive Esthetics', 'Advanced aesthetic and restorative dentistry program', 4500.00, 'USD', 1),
  ('full-arch-mastery', 'Full Arch Mastery', 'Full arch implant reconstruction and surgical protocols', 6800.00, 'USD', 2),
  ('surgical-foundations', 'Surgical Foundations', 'Essential dental surgical procedures and bone grafting', 3200.00, 'USD', 3),
  ('intensive-residency', 'Intensive Residency', 'Comprehensive clinical and hands-on surgical residency', 8500.00, 'USD', 4),
  ('wisdom-teeth', 'Wisdom Teeth Extraction', 'Specialized surgical extraction and impaction management', 2900.00, 'USD', 5)
ON CONFLICT (code) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. Enrollments Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  course_name_snapshot TEXT NOT NULL,
  enrollment_status TEXT NOT NULL CHECK (enrollment_status IN ('pending', 'confirmed', 'cancelled')),
  agreed_amount NUMERIC(10,2) NOT NULL CHECK (agreed_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT NOT NULL CHECK (source IN ('form', 'meta', 'google', 'manual', 'test')),
  notes TEXT NULL,
  idempotency_key TEXT NULL UNIQUE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 3. Enrollment Payments Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'refunded', 'cancelled')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NULL CHECK (payment_method IN ('credit_card', 'wire_transfer', 'check', 'cash', 'financing', 'other') OR payment_method IS NULL),
  external_reference TEXT NULL,
  notes TEXT NULL,
  idempotency_key TEXT NULL UNIQUE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 4. Enrollment History / Audit Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'enrollment_created',
    'enrollment_status_changed',
    'course_changed',
    'agreed_amount_changed',
    'payment_added',
    'payment_status_changed',
    'notes_updated'
  )),
  old_values JSONB NULL,
  new_values JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 5. Extend App Settings with Commercial Targets & Lead Activities Types
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS monthly_net_revenue_target NUMERIC(12,2) NOT NULL DEFAULT 50000.00,
  ADD COLUMN IF NOT EXISTS monthly_enrollment_target INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN (
    'initial_assignment',
    'auto_after_intake',
    'manual',
    'csv_import_stage_mapping',
    'enrollment_confirmed'
  ));

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
    'email_reply_received'::text, 'sms_reply_received'::text,
    'enrollment_created'::text, 'enrollment_confirmed'::text
  ]));


-- -----------------------------------------------------------------------------
-- 6. Performance Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_courses_active_sort ON public.courses(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead_id ON public.enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON public.enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON public.enrollments(enrollment_status);
CREATE INDEX IF NOT EXISTS idx_enrollments_date ON public.enrollments(enrollment_date);
CREATE INDEX IF NOT EXISTS idx_enrollments_created_at ON public.enrollments(created_at);
CREATE INDEX IF NOT EXISTS idx_enrollment_payments_enrollment_id ON public.enrollment_payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_payments_status ON public.enrollment_payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_enrollment_payments_date ON public.enrollment_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_enrollment_history_enrollment ON public.enrollment_history(enrollment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrollment_history_lead ON public.enrollment_history(lead_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- 7. Row Level Security (RLS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_history ENABLE ROW LEVEL SECURITY;

-- Courses: Read for all authenticated, write for active app users
DROP POLICY IF EXISTS "courses_select_auth" ON public.courses;
CREATE POLICY "courses_select_auth" ON public.courses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "courses_manage_active" ON public.courses;
CREATE POLICY "courses_manage_active" ON public.courses
  FOR ALL TO authenticated USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- Enrollments: Active app users only. Anon blocked.
DROP POLICY IF EXISTS "enrollments_all_active" ON public.enrollments;
CREATE POLICY "enrollments_all_active" ON public.enrollments
  FOR ALL TO authenticated USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- Payments: Active app users only. Anon blocked.
DROP POLICY IF EXISTS "payments_all_active" ON public.enrollment_payments;
CREATE POLICY "payments_all_active" ON public.enrollment_payments
  FOR ALL TO authenticated USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- History: Active app users only. Anon blocked.
DROP POLICY IF EXISTS "enrollment_history_select_active" ON public.enrollment_history;
CREATE POLICY "enrollment_history_select_active" ON public.enrollment_history
  FOR SELECT TO authenticated USING (public.is_active_app_user());


-- -----------------------------------------------------------------------------
-- 8. Transactional RPC: create_enrollment_transaction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_enrollment_transaction(
  p_lead_id UUID,
  p_course_id UUID,
  p_enrollment_status TEXT,
  p_agreed_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD',
  p_enrollment_date DATE DEFAULT CURRENT_DATE,
  p_source TEXT DEFAULT 'manual',
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_initial_payment_amount NUMERIC DEFAULT NULL,
  p_initial_payment_status TEXT DEFAULT 'paid',
  p_initial_payment_method TEXT DEFAULT NULL,
  p_initial_payment_date DATE DEFAULT CURRENT_DATE,
  p_initial_payment_ref TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_course RECORD;
  v_final_agreed_amount NUMERIC;
  v_enrollment_id UUID;
  v_payment_id UUID;
  v_current_stage_id UUID;
  v_current_stage_code TEXT;
  v_enrollment_stage_id UUID;
  v_stage_moved BOOLEAN := false;
BEGIN
  -- 1. Security Check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active app users can create enrollments.';
  END IF;

  v_actor_id := auth.uid();
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

  -- 2. Validate Lead
  SELECT pipeline_stage_id INTO v_current_stage_id FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found.', p_lead_id;
  END IF;

  SELECT code INTO v_current_stage_code FROM public.pipeline_stages WHERE id = v_current_stage_id;

  -- 3. Validate Course
  SELECT id, name, default_price, currency INTO v_course FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course % not found.', p_course_id;
  END IF;

  -- 4. Idempotency Check (returns existing enrollment if same key provided)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_enrollment_id FROM public.enrollments WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'enrollment_id', v_enrollment_id,
        'idempotent_replay', true,
        'stage_moved', false
      );
    END IF;
  END IF;

  -- 5. Validate Amount & Currency
  v_final_agreed_amount := COALESCE(p_agreed_amount, v_course.default_price, 0.00);
  IF v_final_agreed_amount < 0 THEN
    RAISE EXCEPTION 'Agreed amount cannot be negative.';
  END IF;

  IF p_enrollment_status NOT IN ('pending', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid enrollment status: %', p_enrollment_status;
  END IF;

  -- 6. Insert Enrollment
  INSERT INTO public.enrollments (
    lead_id,
    course_id,
    course_name_snapshot,
    enrollment_status,
    agreed_amount,
    currency,
    enrollment_date,
    source,
    notes,
    idempotency_key,
    created_by_user_id
  ) VALUES (
    p_lead_id,
    p_course_id,
    v_course.name,
    p_enrollment_status,
    v_final_agreed_amount,
    COALESCE(p_currency, 'USD'),
    COALESCE(p_enrollment_date, CURRENT_DATE),
    COALESCE(p_source, 'manual'),
    p_notes,
    p_idempotency_key,
    v_actor_id
  ) RETURNING id INTO v_enrollment_id;

  -- 7. Audit History for Creation
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
    v_actor_id,
    v_actor_email,
    'enrollment_created',
    NULL,
    jsonb_build_object(
      'course_id', p_course_id,
      'course_name', v_course.name,
      'enrollment_status', p_enrollment_status,
      'agreed_amount', v_final_agreed_amount,
      'currency', COALESCE(p_currency, 'USD'),
      'enrollment_date', COALESCE(p_enrollment_date, CURRENT_DATE)
    )
  );

  -- 8. Optional Initial Payment
  IF p_initial_payment_amount IS NOT NULL AND p_initial_payment_amount > 0 THEN
    INSERT INTO public.enrollment_payments (
      enrollment_id,
      amount,
      currency,
      payment_status,
      payment_date,
      payment_method,
      external_reference,
      notes,
      created_by_user_id
    ) VALUES (
      v_enrollment_id,
      p_initial_payment_amount,
      COALESCE(p_currency, 'USD'),
      COALESCE(p_initial_payment_status, 'paid'),
      COALESCE(p_initial_payment_date, CURRENT_DATE),
      p_initial_payment_method,
      p_initial_payment_ref,
      'Initial payment recorded with enrollment',
      v_actor_id
    ) RETURNING id INTO v_payment_id;

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
      v_actor_id,
      v_actor_email,
      'payment_added',
      NULL,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'amount', p_initial_payment_amount,
        'payment_status', COALESCE(p_initial_payment_status, 'paid'),
        'payment_method', p_initial_payment_method
      )
    );
  END IF;

  -- 9. Pipeline Stage Integration
  -- Only move if enrollment_status = 'confirmed' AND lead is currently in an earlier stage
  IF p_enrollment_status = 'confirmed' THEN
    SELECT id INTO v_enrollment_stage_id FROM public.pipeline_stages WHERE code = 'enrollment';
    
    -- Check if current stage is eligible (capture, qualification, acquisition, approval)
    IF v_current_stage_code IN ('capture', 'qualification', 'acquisition', 'approval') AND v_enrollment_stage_id IS NOT NULL THEN
      UPDATE public.leads
      SET pipeline_stage_id = v_enrollment_stage_id,
          updated_at = now()
      WHERE id = p_lead_id;

      INSERT INTO public.lead_stage_history (
        lead_id,
        from_stage_id,
        to_stage_id,
        changed_by_user_id,
        change_reason
      ) VALUES (
        p_lead_id,
        v_current_stage_id,
        v_enrollment_stage_id,
        v_actor_id,
        'enrollment_confirmed'
      );

      v_stage_moved := true;
    END IF;
    -- If already in enrollment, post_course, or alumni: DO NOT DOWNGRADE/TOUCH STAGE
  END IF;

  -- 10. Record Lead Activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    CASE WHEN p_enrollment_status = 'confirmed' THEN 'enrollment_confirmed' ELSE 'enrollment_created' END,
    'user',
    'Matrícula ' || p_enrollment_status || ': ' || v_course.name || ' ($' || v_final_agreed_amount || ')',
    jsonb_build_object(
      'enrollment_id', v_enrollment_id,
      'course_id', p_course_id,
      'course_name', v_course.name,
      'enrollment_status', p_enrollment_status,
      'agreed_amount', v_final_agreed_amount,
      'initial_payment_id', v_payment_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', v_enrollment_id,
    'payment_id', v_payment_id,
    'stage_moved', v_stage_moved
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. Transactional RPC: update_enrollment_transaction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_enrollment_transaction(
  p_enrollment_id UUID,
  p_enrollment_status TEXT,
  p_agreed_amount NUMERIC,
  p_course_id UUID,
  p_enrollment_date DATE,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_old RECORD;
  v_course RECORD;
  v_current_stage_id UUID;
  v_current_stage_code TEXT;
  v_enrollment_stage_id UUID;
  v_stage_moved BOOLEAN := false;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active app users can update enrollments.';
  END IF;

  v_actor_id := auth.uid();
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

  SELECT * INTO v_old FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  SELECT id, name INTO v_course FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course % not found.', p_course_id;
  END IF;

  IF p_agreed_amount < 0 THEN
    RAISE EXCEPTION 'Agreed amount cannot be negative.';
  END IF;

  -- 1. Status Changed Audit
  IF v_old.enrollment_status IS DISTINCT FROM p_enrollment_status THEN
    INSERT INTO public.enrollment_history (
      enrollment_id, lead_id, actor_id, actor_email, event_type, old_values, new_values
    ) VALUES (
      p_enrollment_id, v_old.lead_id, v_actor_id, v_actor_email,
      'enrollment_status_changed',
      jsonb_build_object('enrollment_status', v_old.enrollment_status),
      jsonb_build_object('enrollment_status', p_enrollment_status)
    );
  END IF;

  -- 2. Agreed Amount Changed Audit
  IF v_old.agreed_amount IS DISTINCT FROM p_agreed_amount THEN
    INSERT INTO public.enrollment_history (
      enrollment_id, lead_id, actor_id, actor_email, event_type, old_values, new_values
    ) VALUES (
      p_enrollment_id, v_old.lead_id, v_actor_id, v_actor_email,
      'agreed_amount_changed',
      jsonb_build_object('agreed_amount', v_old.agreed_amount),
      jsonb_build_object('agreed_amount', p_agreed_amount)
    );
  END IF;

  -- 3. Course Changed Audit
  IF v_old.course_id IS DISTINCT FROM p_course_id THEN
    INSERT INTO public.enrollment_history (
      enrollment_id, lead_id, actor_id, actor_email, event_type, old_values, new_values
    ) VALUES (
      p_enrollment_id, v_old.lead_id, v_actor_id, v_actor_email,
      'course_changed',
      jsonb_build_object('course_id', v_old.course_id, 'course_name', v_old.course_name_snapshot),
      jsonb_build_object('course_id', p_course_id, 'course_name', v_course.name)
    );
  END IF;

  -- 4. Update the Enrollment
  UPDATE public.enrollments
  SET course_id = p_course_id,
      course_name_snapshot = v_course.name,
      enrollment_status = p_enrollment_status,
      agreed_amount = p_agreed_amount,
      enrollment_date = p_enrollment_date,
      notes = p_notes,
      updated_at = now()
  WHERE id = p_enrollment_id;

  -- 5. Stage Movement Logic (Only if newly transitioned to 'confirmed')
  IF p_enrollment_status = 'confirmed' AND v_old.enrollment_status != 'confirmed' THEN
    SELECT pipeline_stage_id INTO v_current_stage_id FROM public.leads WHERE id = v_old.lead_id;
    SELECT code INTO v_current_stage_code FROM public.pipeline_stages WHERE id = v_current_stage_id;
    SELECT id INTO v_enrollment_stage_id FROM public.pipeline_stages WHERE code = 'enrollment';

    IF v_current_stage_code IN ('capture', 'qualification', 'acquisition', 'approval') AND v_enrollment_stage_id IS NOT NULL THEN
      UPDATE public.leads
      SET pipeline_stage_id = v_enrollment_stage_id,
          updated_at = now()
      WHERE id = v_old.lead_id;

      INSERT INTO public.lead_stage_history (
        lead_id, from_stage_id, to_stage_id, changed_by_user_id, change_reason
      ) VALUES (
        v_old.lead_id, v_current_stage_id, v_enrollment_stage_id, v_actor_id,
        'enrollment_confirmed'
      );
      v_stage_moved := true;
    END IF;
  END IF;
  -- If cancelled: REVERSE STATE SAFETY: NEVER downgrade lead automatically!

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', p_enrollment_id,
    'stage_moved', v_stage_moved
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. Transactional RPC: record_enrollment_payment
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_enrollment_payment(
  p_enrollment_id UUID,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD',
  p_payment_status TEXT DEFAULT 'paid',
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_payment_method TEXT DEFAULT NULL,
  p_external_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_enrollment RECORD;
  v_payment_id UUID;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active app users can record payments.';
  END IF;

  v_actor_id := auth.uid();
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

  SELECT * INTO v_enrollment FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  IF p_payment_status NOT IN ('pending', 'paid', 'refunded', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid payment status: %', p_payment_status;
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_payment_id FROM public.enrollment_payments WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  INSERT INTO public.enrollment_payments (
    enrollment_id,
    amount,
    currency,
    payment_status,
    payment_date,
    payment_method,
    external_reference,
    notes,
    idempotency_key,
    created_by_user_id
  ) VALUES (
    p_enrollment_id,
    p_amount,
    COALESCE(p_currency, v_enrollment.currency),
    p_payment_status,
    COALESCE(p_payment_date, CURRENT_DATE),
    p_payment_method,
    p_external_reference,
    p_notes,
    p_idempotency_key,
    v_actor_id
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.enrollment_history (
    enrollment_id, lead_id, actor_id, actor_email, event_type, old_values, new_values
  ) VALUES (
    p_enrollment_id, v_enrollment.lead_id, v_actor_id, v_actor_email,
    'payment_added',
    NULL,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'amount', p_amount,
      'currency', COALESCE(p_currency, v_enrollment.currency),
      'payment_status', p_payment_status,
      'payment_date', COALESCE(p_payment_date, CURRENT_DATE),
      'payment_method', p_payment_method
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. Transactional RPC: update_enrollment_payment_status
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_enrollment_payment_status(
  p_payment_id UUID,
  p_payment_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_payment RECORD;
  v_enrollment RECORD;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active app users can update payments.';
  END IF;

  v_actor_id := auth.uid();
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

  SELECT * INTO v_payment FROM public.enrollment_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found.', p_payment_id;
  END IF;

  SELECT * INTO v_enrollment FROM public.enrollments WHERE id = v_payment.enrollment_id;

  IF p_payment_status NOT IN ('pending', 'paid', 'refunded', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid payment status: %', p_payment_status;
  END IF;

  IF v_payment.payment_status IS DISTINCT FROM p_payment_status THEN
    UPDATE public.enrollment_payments
    SET payment_status = p_payment_status,
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_payment_id;

    INSERT INTO public.enrollment_history (
      enrollment_id, lead_id, actor_id, actor_email, event_type, old_values, new_values
    ) VALUES (
      v_payment.enrollment_id, v_enrollment.lead_id, v_actor_id, v_actor_email,
      'payment_status_changed',
      jsonb_build_object('payment_id', p_payment_id, 'payment_status', v_payment.payment_status),
      jsonb_build_object('payment_id', p_payment_id, 'payment_status', p_payment_status, 'notes', p_notes)
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;


-- -----------------------------------------------------------------------------
-- 12. Main Aggregator RPC: get_revenue_dashboard_metrics
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
  v_revenue_progress_pct NUMERIC(5,2) := NULL;
  v_enrollment_progress_pct NUMERIC(5,2) := NULL;

  -- JSON arrays
  v_course_performance JSONB := '[]'::jsonb;
  v_source_performance JSONB := '[]'::jsonb;
  v_approved_not_enrolled JSONB := '[]'::jsonb;
  v_velocity JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active app users can access revenue metrics.';
  END IF;

  v_start_date := (p_start_date AT TIME ZONE 'UTC')::date;
  v_end_date := (p_end_date AT TIME ZONE 'UTC')::date;

  -- Load Settings
  SELECT monthly_net_revenue_target, monthly_enrollment_target, default_currency
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;

  -- 1. Booked Value & Confirmed Enrollments in period (USD only for uniform metrics)
  SELECT 
    COALESCE(SUM(agreed_amount), 0.00),
    COUNT(*)
  INTO v_booked_value, v_confirmed_enrollments_count
  FROM public.enrollments
  WHERE enrollment_status = 'confirmed'
    AND enrollment_date >= v_start_date
    AND enrollment_date <= v_end_date
    AND currency = 'USD';

  -- 2. Collected Revenue & Refunded Amount in period (USD only)
  SELECT
    COALESCE(SUM(CASE WHEN p.payment_status = 'paid' THEN p.amount ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN p.payment_status = 'refunded' THEN p.amount ELSE 0.00 END), 0.00)
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
      WHERE p.enrollment_id = e.id AND p.payment_status = 'paid'
    );

  -- 4. Outstanding Balance for confirmed enrollments in period
  SELECT COALESCE(SUM(GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00)), 0.00)
  INTO v_outstanding_balance
  FROM public.enrollments e
  LEFT JOIN (
    SELECT enrollment_id, SUM(CASE WHEN payment_status = 'paid' THEN amount WHEN payment_status = 'refunded' THEN -amount ELSE 0 END) AS paid_amt
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
        SUM(CASE WHEN payment_status = 'paid' THEN amount ELSE 0 END) AS collected,
        SUM(CASE WHEN payment_status = 'paid' THEN amount WHEN payment_status = 'refunded' THEN -amount ELSE 0 END) AS net
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
      SELECT SUM(CASE WHEN payment_status = 'paid' THEN amount WHEN payment_status = 'refunded' THEN -amount ELSE 0 END) AS net_amount
      FROM public.enrollment_payments
      WHERE enrollment_id = e.id
    ) p_sub ON true
    GROUP BY src.source_name
    ORDER BY net_revenue DESC
  ) s_row;

  -- 12. Approved, Not Enrolled List (Snapshot: leads currently in approval without confirmed enrollment)
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

  -- 13. Enrollment Velocity (grouped by week/month in period)
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

-- Grant permissions to authenticated and service_role, revoke from anon/public
REVOKE EXECUTE ON FUNCTION public.create_enrollment_transaction FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_enrollment_transaction TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_enrollment_transaction FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_enrollment_transaction TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.record_enrollment_payment FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_enrollment_payment TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_enrollment_payment_status FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_enrollment_payment_status TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_revenue_dashboard_metrics FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_dashboard_metrics TO authenticated, service_role;
