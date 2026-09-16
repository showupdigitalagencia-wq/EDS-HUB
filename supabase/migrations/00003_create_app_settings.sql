-- =============================================================================
-- Migration 003: app_settings
-- =============================================================================
-- Singleton settings table for the application.
-- =============================================================================

CREATE TABLE public.app_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key   INTEGER NOT NULL DEFAULT 1
    CONSTRAINT app_settings_singleton CHECK (singleton_key = 1)
    CONSTRAINT app_settings_singleton_unique UNIQUE,
  company_name    TEXT NOT NULL DEFAULT 'Expert Dental Solutions',
  default_salutation TEXT NOT NULL DEFAULT 'Doc',
  timezone        TEXT,
  email_from_name TEXT,
  email_sending_domain TEXT,
  resend_domain_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_settings IS
  'Singleton application settings. Only one row allowed via singleton_key constraint.';

-- Insert default settings row
INSERT INTO public.app_settings (company_name, default_salutation)
VALUES ('Expert Dental Solutions', 'Doc');
