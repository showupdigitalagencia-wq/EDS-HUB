-- =============================================================================
-- Migration 014: tags, lead_tags, and lead_notes
-- =============================================================================

-- 1. tags
CREATE TABLE public.tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tags IS 'Tags for categorizing and segmenting leads.';
CREATE INDEX idx_tags_name ON public.tags(name);

-- 2. lead_tags (many-to-many)
CREATE TABLE public.lead_tags (
  lead_id     UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);

COMMENT ON TABLE public.lead_tags IS 'Associates tags to leads.';
CREATE INDEX idx_lead_tags_tag_id ON public.lead_tags(tag_id);

-- 3. lead_notes
CREATE TABLE public.lead_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  content             TEXT NOT NULL,
  created_by_user_id  UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_notes IS 'Editable notes associated with a lead. Separate from lead_activities.';
CREATE INDEX idx_lead_notes_lead_id ON public.lead_notes(lead_id);
CREATE INDEX idx_lead_notes_created_at ON public.lead_notes(created_at DESC);
