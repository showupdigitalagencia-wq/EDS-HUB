-- =============================================================================
-- Migration 00106: Persist Meta Lead Form Course Mapping
-- =============================================================================
-- Ensures Meta Form 1048470041331302 ("Facebook Lead Ads: Full Arch and Zygomatic - November 2026")
-- is factually mapped to course:ZIT-01 (Zygomatic Implant Training).
-- =============================================================================

INSERT INTO public.integration_field_mappings (
  integration,
  entity_type,
  external_property,
  eds_target,
  target_type,
  direction,
  source_of_truth,
  transform_rule,
  is_active
) VALUES (
  'meta',
  'lead',
  'form:1048470041331302',
  'course:ZIT-01',
  'lead_course_interest',
  'hubspot_to_eds',
  'eds',
  'course_interest_lookup',
  true
)
ON CONFLICT DO NOTHING;
