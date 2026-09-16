-- =============================================================================
-- Migration 016: lead_imports and lead_import_rows
-- =============================================================================

-- 1. lead_imports
CREATE TABLE public.lead_imports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows          INTEGER NOT NULL DEFAULT 0,
  processed_rows      INTEGER NOT NULL DEFAULT 0,
  created_count       INTEGER NOT NULL DEFAULT 0,
  updated_count       INTEGER NOT NULL DEFAULT 0,
  skipped_count       INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  error_summary       TEXT,
  mapping_config      JSONB NOT NULL DEFAULT '{}',
  created_by_user_id  UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_imports IS 'Audit record of CSV lead import jobs.';
CREATE INDEX idx_lead_imports_created_at ON public.lead_imports(created_at DESC);
CREATE INDEX idx_lead_imports_status ON public.lead_imports(status);

-- 2. lead_import_rows
CREATE TABLE public.lead_import_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       UUID NOT NULL REFERENCES public.lead_imports(id) ON DELETE CASCADE,
  row_number      INTEGER NOT NULL,
  raw_data        JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL
    CHECK (status IN ('created', 'updated', 'skipped', 'failed')),
  lead_id         UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_import_rows IS 'Detailed row-by-row log of imported leads.';
CREATE INDEX idx_lead_import_rows_import_id ON public.lead_import_rows(import_id);
CREATE INDEX idx_lead_import_rows_lead_id ON public.lead_import_rows(lead_id);
