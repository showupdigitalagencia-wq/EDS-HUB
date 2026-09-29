-- Migration 00087: Add incomplete_enrollment to tasks_task_source_check
-- =============================================================================

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_source_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_source_check
  CHECK (task_source IN (
    'manual',
    'automation',
    'system',
    'course_operations',
    'post_course',
    'campaign',
    'incomplete_enrollment'
  ));
