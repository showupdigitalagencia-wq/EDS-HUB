-- =============================================================================
-- Migration 00052: Lead Course Interests Sessions, Priority & Referral Tracking
-- =============================================================================
-- 1. Adds referred_by TEXT NULL to public.leads ("Quem indicou?")
-- 2. Links public.lead_course_interests to public.course_sessions (course_session_id)
-- 3. Adds priority SMALLINT (1, 2, 3) to public.lead_course_interests with partial
--    uniqueness per lead (allows multiple NULLs for historical compatibility).
-- =============================================================================

-- 1. Add referred_by to public.leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS referred_by TEXT NULL;

COMMENT ON COLUMN public.leads.referred_by IS
  'Informational tracking of who referred this lead (Quem indicou?).';

-- 2. Add course_session_id to public.lead_course_interests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_course_interests' AND column_name = 'course_session_id'
  ) THEN
    ALTER TABLE public.lead_course_interests
      ADD COLUMN course_session_id UUID NULL REFERENCES public.course_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.lead_course_interests.course_session_id IS
  'Optional reference to a specific course session / date. On session deletion, set null to preserve lead interest.';

-- 3. Add priority to public.lead_course_interests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_course_interests' AND column_name = 'priority'
  ) THEN
    ALTER TABLE public.lead_course_interests
      ADD COLUMN priority SMALLINT NULL;
  END IF;
END $$;

ALTER TABLE public.lead_course_interests
  DROP CONSTRAINT IF EXISTS chk_lead_course_interests_priority;

ALTER TABLE public.lead_course_interests
  ADD CONSTRAINT chk_lead_course_interests_priority
  CHECK (priority IS NULL OR priority IN (1, 2, 3));

COMMENT ON COLUMN public.lead_course_interests.priority IS
  'Lead interest priority ordering (1 = primary, 2 = secondary, 3 = tertiary). Nullable for historical records.';

-- 4. Partial unique index to enforce unique priority 1, 2, 3 per lead (allows unlimited unprioritized/historical records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_course_interests_lead_priority
  ON public.lead_course_interests(lead_id, priority)
  WHERE priority IS NOT NULL;

-- 5. Performance index on course_session_id
CREATE INDEX IF NOT EXISTS idx_lead_course_interests_course_session
  ON public.lead_course_interests(course_session_id);
