-- =============================================================================
-- Migration 007: transactional_templates
-- =============================================================================
-- Templates for automatic messages (NOT the Campaign Builder).
-- =============================================================================

CREATE TABLE public.transactional_templates (
  key               TEXT PRIMARY KEY,
  channel           TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  subject_template  TEXT,
  body_template     TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transactional_templates IS
  'Templates for automated transactional messages. Supports {{salutation}} variable. NOT the Campaign Builder.';

-- Seed initial templates (idempotent)
INSERT INTO public.transactional_templates (key, channel, subject_template, body_template) VALUES
  (
    'lead_intake_email',
    'email',
    'Welcome, {{salutation}} — we received your information',
    'Hello {{salutation}},

Thank you for your interest. We have received your information and a member of our team will be in touch with you shortly.

If you have any questions in the meantime, feel free to reply to this email.

Best regards,
Expert Dental Solutions'
  ),
  (
    'lead_intake_sms',
    'sms',
    NULL,
    'Hello {{salutation}}, thank you for your interest in Expert Dental Solutions. We received your information and will be in touch shortly.'
  )
ON CONFLICT (key) DO NOTHING;
