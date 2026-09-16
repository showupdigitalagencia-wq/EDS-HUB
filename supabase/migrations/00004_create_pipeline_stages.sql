-- =============================================================================
-- Migration 004: pipeline_stages
-- =============================================================================
-- Pipeline stages with reproducible seed data.
-- Exactly 7 stages in the specified order.
-- =============================================================================

CREATE TABLE public.pipeline_stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pipeline_stages IS
  'Pipeline stages for lead progression. Order defined by sort_order.';

CREATE INDEX idx_pipeline_stages_sort_order ON public.pipeline_stages(sort_order);

-- Seed the 7 pipeline stages (idempotent via ON CONFLICT)
INSERT INTO public.pipeline_stages (code, name, sort_order) VALUES
  ('capture',       'Captura',       1),
  ('qualification', 'Qualificação',  2),
  ('acquisition',   'Aquisição',     3),
  ('approval',      'Aprovação',     4),
  ('enrollment',    'Matrícula',     5),
  ('post_course',   'Pós-curso',     6),
  ('alumni',        'Alumni',        7)
ON CONFLICT (code) DO NOTHING;
