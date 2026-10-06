-- =============================================================================
-- Migration 00109: Add tasks waiting_for_response structured field
-- =============================================================================
-- Adds structured operational waiting state to public.tasks:
-- 1. waiting_for_response: BOOLEAN NOT NULL DEFAULT false
--    Identifies pending tasks waiting for customer reply without mutating description
-- 2. waiting_for_response_since: TIMESTAMPTZ
--    Audit timestamp when the task was put into waiting state
-- Non-destructive, preserves all existing tasks, due dates, owners, and relations.
-- =============================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS waiting_for_response BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiting_for_response_since TIMESTAMPTZ;

-- Operational index for Daily Operations work queue queries
CREATE INDEX IF NOT EXISTS idx_tasks_pending_waiting_for_response
  ON public.tasks(status, waiting_for_response)
  WHERE status = 'pending';

COMMENT ON COLUMN public.tasks.waiting_for_response IS
  'Operational sub-state indicating a pending task is waiting for customer response.';

COMMENT ON COLUMN public.tasks.waiting_for_response_since IS
  'Timestamp when the task was placed in waiting for response status.';
