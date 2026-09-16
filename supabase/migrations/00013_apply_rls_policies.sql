-- =============================================================================
-- Migration 013: Row Level Security Policies
-- =============================================================================
-- Enables RLS on ALL public tables and creates policies.
-- All policies use the is_active_app_user() helper function.
-- Anon users: blocked everywhere (auth.uid() is NULL → function returns false).
-- Authenticated but not in app_user: blocked (function returns false).
-- =============================================================================

-- ===================== app_user =====================
ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON public.app_user
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY app_user_update ON public.app_user
  FOR UPDATE USING (public.is_active_app_user() AND user_id = auth.uid());

-- ===================== app_settings =====================
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_select ON public.app_settings
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY app_settings_update ON public.app_settings
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== pipeline_stages =====================
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_stages_select ON public.pipeline_stages
  FOR SELECT USING (public.is_active_app_user());

-- ===================== leads =====================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_select ON public.leads
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY leads_insert ON public.leads
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY leads_update ON public.leads
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== lead_intake_events =====================
ALTER TABLE public.lead_intake_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY intake_events_select ON public.lead_intake_events
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY intake_events_insert ON public.lead_intake_events
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY intake_events_update ON public.lead_intake_events
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== transactional_templates =====================
ALTER TABLE public.transactional_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY templates_select ON public.transactional_templates
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY templates_update ON public.transactional_templates
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== outbound_messages =====================
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbound_messages_select ON public.outbound_messages
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY outbound_messages_insert ON public.outbound_messages
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY outbound_messages_update ON public.outbound_messages
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== tasks =====================
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (public.is_active_app_user());

-- ===================== lead_activities (append-only) =====================
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_select ON public.lead_activities
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY activities_insert ON public.lead_activities
  FOR INSERT WITH CHECK (public.is_active_app_user());
-- No UPDATE or DELETE policies — append-only

-- ===================== lead_stage_history (append-only) =====================
ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY stage_history_select ON public.lead_stage_history
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY stage_history_insert ON public.lead_stage_history
  FOR INSERT WITH CHECK (public.is_active_app_user());
-- No UPDATE or DELETE policies — append-only

-- ===================== email_domain_status =====================
ALTER TABLE public.email_domain_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY domain_status_select ON public.email_domain_status
  FOR SELECT USING (public.is_active_app_user());

CREATE POLICY domain_status_insert ON public.email_domain_status
  FOR INSERT WITH CHECK (public.is_active_app_user());

CREATE POLICY domain_status_update ON public.email_domain_status
  FOR UPDATE USING (public.is_active_app_user());
