-- =============================================================================
-- Migration 009: tasks
-- =============================================================================

CREATE TABLE public.tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  intake_event_id UUID REFERENCES public.lead_intake_events(id) ON DELETE SET NULL,
  task_type       TEXT NOT NULL CHECK (task_type IN ('call', 'data_review')),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  due_at          TIMESTAMPTZ,
  created_by      TEXT NOT NULL DEFAULT 'system'
    CHECK (created_by IN ('system', 'user')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

COMMENT ON TABLE public.tasks IS
  'Tasks created by the system (call, data_review) or by the user.';

CREATE INDEX idx_tasks_lead_id ON public.tasks(lead_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_type_status ON public.tasks(task_type, status);
