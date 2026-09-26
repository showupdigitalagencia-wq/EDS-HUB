-- =============================================================================
-- Migration 00064: Server-Side Task Reminder Scheduler (pg_cron + pg_net)
-- =============================================================================
-- Guarantees that task due notifications are evaluated on the server every minute,
-- even when EDS HUB is completely closed / not running on client devices.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Stored procedure to trigger Edge Function check_due_tasks
CREATE OR REPLACE FUNCTION public.check_due_task_reminders()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS '
BEGIN
  RETURN net.http_post(
    url := ''https://xogcexclqiornuscsdmn.supabase.co/functions/v1/send-push-notification'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw''
    ),
    body := jsonb_build_object(
      ''event_type'', ''check_due_tasks''
    )
  );
END;
';

-- 2. Schedule cron job to run every minute
SELECT cron.schedule(
  'check-due-task-reminders',
  '* * * * *',
  'SELECT public.check_due_task_reminders();'
);
