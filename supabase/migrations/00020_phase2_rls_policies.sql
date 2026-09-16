-- =============================================================================
-- Migration 020: Phase 2 Row Level Security Policies
-- =============================================================================
-- Enables RLS on all Phase 2 tables.
-- Uses the proven single-user auth helper: public.is_active_app_user()
-- Anon users: blocked everywhere.
-- Authenticated but not in app_user: blocked.
-- Active app_user: full access.
-- =============================================================================

-- ===================== tags =====================
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_select ON public.tags
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY tags_insert ON public.tags
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY tags_update ON public.tags
  FOR UPDATE USING (public.is_active_app_user());

CREATE POLICY tags_delete ON public.tags
  FOR DELETE USING (public.is_active_app_user());

-- ===================== lead_tags =====================
ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_tags_select ON public.lead_tags
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY lead_tags_insert ON public.lead_tags
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY lead_tags_delete ON public.lead_tags
  FOR DELETE USING (public.is_active_app_user());

-- ===================== lead_notes =====================
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_notes_select ON public.lead_notes
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY lead_notes_insert ON public.lead_notes
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY lead_notes_update ON public.lead_notes
  FOR UPDATE USING (public.is_active_app_user());

CREATE POLICY lead_notes_delete ON public.lead_notes
  FOR DELETE USING (public.is_active_app_user());

-- ===================== lead_imports =====================
ALTER TABLE public.lead_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_imports_select ON public.lead_imports
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY lead_imports_insert ON public.lead_imports
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY lead_imports_update ON public.lead_imports
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== lead_import_rows =====================
ALTER TABLE public.lead_import_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_import_rows_select ON public.lead_import_rows
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY lead_import_rows_insert ON public.lead_import_rows
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY lead_import_rows_update ON public.lead_import_rows
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== email_templates =====================
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_templates_select ON public.email_templates
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY email_templates_insert ON public.email_templates
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY email_templates_update ON public.email_templates
  FOR UPDATE USING (public.is_active_app_user());

CREATE POLICY email_templates_delete ON public.email_templates
  FOR DELETE USING (public.is_active_app_user());

-- ===================== campaigns =====================
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaigns_insert ON public.campaigns
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY campaigns_update ON public.campaigns
  FOR UPDATE USING (public.is_active_app_user());

CREATE POLICY campaigns_delete ON public.campaigns
  FOR DELETE USING (public.is_active_app_user());

-- ===================== campaign_versions =====================
ALTER TABLE public.campaign_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_versions_select ON public.campaign_versions
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaign_versions_insert ON public.campaign_versions
  FOR INSERT WITH CHECK (public.is_active_app_user());

-- ===================== campaign_audiences =====================
ALTER TABLE public.campaign_audiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_audiences_select ON public.campaign_audiences
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaign_audiences_insert ON public.campaign_audiences
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY campaign_audiences_update ON public.campaign_audiences
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== campaign_variants =====================
ALTER TABLE public.campaign_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_variants_select ON public.campaign_variants
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaign_variants_insert ON public.campaign_variants
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY campaign_variants_update ON public.campaign_variants
  FOR UPDATE USING (public.is_active_app_user());

CREATE POLICY campaign_variants_delete ON public.campaign_variants
  FOR DELETE USING (public.is_active_app_user());

-- ===================== campaign_recipients =====================
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_recipients_select ON public.campaign_recipients
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaign_recipients_insert ON public.campaign_recipients
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY campaign_recipients_update ON public.campaign_recipients
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== campaign_test_sends =====================
ALTER TABLE public.campaign_test_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_test_sends_select ON public.campaign_test_sends
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaign_test_sends_insert ON public.campaign_test_sends
  FOR INSERT WITH CHECK (public.is_active_app_user());

-- ===================== campaign_jobs =====================
ALTER TABLE public.campaign_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_jobs_select ON public.campaign_jobs
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY campaign_jobs_insert ON public.campaign_jobs
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY campaign_jobs_update ON public.campaign_jobs
  FOR UPDATE USING (public.is_active_app_user());
