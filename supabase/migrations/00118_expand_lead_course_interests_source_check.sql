-- =============================================================================
-- Migration 00118: Expand lead_course_interests source check constraint
-- =============================================================================
-- Expands lead_course_interests_source_check to include 'website' so that
-- direct website form submissions can record course interests with proper attribution.
-- =============================================================================

ALTER TABLE public.lead_course_interests
  DROP CONSTRAINT IF EXISTS lead_course_interests_source_check;

ALTER TABLE public.lead_course_interests
  ADD CONSTRAINT lead_course_interests_source_check
  CHECK (source IN ('manual', 'post_course', 'form', 'hubspot', 'hubspot_sync', 'meta', 'website'));
