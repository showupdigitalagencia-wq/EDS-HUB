-- =============================================================================
-- Migration 017: email_templates
-- =============================================================================
-- Reusable email templates for campaigns and marketing.
-- Completely separate from transactional_templates (which belongs to Phase 1 intake).
-- =============================================================================

CREATE TABLE public.email_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT NOT NULL DEFAULT 'general',
  content_json        JSONB NOT NULL DEFAULT '[]',
  html_template       TEXT NOT NULL DEFAULT '',
  text_template       TEXT NOT NULL DEFAULT '',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id  UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_templates IS 'Marketing email templates with visual block editor content.';
CREATE INDEX idx_email_templates_category ON public.email_templates(category);
CREATE INDEX idx_email_templates_is_active ON public.email_templates(is_active);
