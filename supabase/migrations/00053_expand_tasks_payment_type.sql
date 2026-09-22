-- =============================================================================
-- Migration 00053: Expand Tasks task_type check constraint for Payment tasks
-- =============================================================================
-- Extends public.tasks.task_type check constraint to include 'payment'.
-- Existing types remain valid: 'call', 'data_review', 'general', 'follow_up'.
-- Payment is an operational reminder task type only; does NOT affect finance/revenue.
-- =============================================================================

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('call', 'data_review', 'general', 'follow_up', 'payment'));

COMMENT ON COLUMN public.tasks.task_type IS
  'Task type: call, data_review, general, follow_up, or payment reminder.';
