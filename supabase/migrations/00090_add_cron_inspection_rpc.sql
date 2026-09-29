-- =============================================================================
-- Migration 00090: Add cron job status inspection RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_cron_job_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
DECLARE
  v_jobs JSONB;
  v_runs JSONB;
BEGIN
  SELECT jsonb_agg(to_jsonb(j)) INTO v_jobs
  FROM cron.job j
  WHERE j.jobname = 'hubspot-continuous-reconcile';

  SELECT jsonb_agg(to_jsonb(r)) INTO v_runs
  FROM (
    SELECT *
    FROM cron.job_run_details
    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'hubspot-continuous-reconcile')
    ORDER BY start_time DESC
    LIMIT 10
  ) r;

  RETURN jsonb_build_object(
    'jobs', COALESCE(v_jobs, '[]'::jsonb),
    'runs', COALESCE(v_runs, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_job_status TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_job_status TO authenticated;
