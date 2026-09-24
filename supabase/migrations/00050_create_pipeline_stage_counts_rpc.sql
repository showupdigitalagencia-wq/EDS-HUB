-- =============================================================================
-- Migration: 00050_create_pipeline_stage_counts_rpc.sql
-- =============================================================================
-- Fast atomic server-side stage counts for Pipeline Kanban and Contacts summary.
-- Allows the UI to render exact counts for all active CRM leads without loading
-- thousands of full lead objects into the browser.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts()
RETURNS TABLE (
  stage_id UUID,
  stage_code TEXT,
  stage_name TEXT,
  sort_order INT,
  lead_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ps.id AS stage_id,
    ps.code AS stage_code,
    ps.name AS stage_name,
    ps.sort_order,
    COUNT(l.id) AS lead_count
  FROM public.pipeline_stages ps
  LEFT JOIN public.leads l ON l.pipeline_stage_id = ps.id
  GROUP BY ps.id, ps.code, ps.name, ps.sort_order
  ORDER BY ps.sort_order ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts() TO authenticated, anon, service_role;
