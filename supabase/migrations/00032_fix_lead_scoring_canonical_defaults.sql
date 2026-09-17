-- =============================================================================
-- Migration 00032: Fix Lead Scoring Canonical Defaults & Constraints
-- =============================================================================
-- Aligns lead scoring rules with EDS HUB canonical schema:
-- 1. Cleans up non-canonical references (e.g. referral, non-existent stages).
-- 2. Seeds standard canonical pipeline stage rules (qualification, acquisition, approval).
-- 3. Adds strict CHECK constraint to prevent saving non-canonical enum values in rules.
-- =============================================================================

-- 1. Remove non-canonical rules
DELETE FROM public.lead_score_rules
WHERE (field_or_event = 'source' AND operator IN ('equals', 'not_equals') AND (value #>> '{}') NOT IN ('meta', 'google', 'manual', 'test', 'form'))
   OR (field_or_event = 'pipeline_stage' AND operator IN ('equals', 'not_equals') AND (value #>> '{}') NOT IN ('capture', 'qualification', 'acquisition', 'approval', 'enrollment', 'post_course', 'alumni'))
   OR name ILIKE '%referral%'
   OR name = 'Advanced Pipeline Stage';

-- 2. Insert canonical pipeline stage rules if not present
INSERT INTO public.lead_score_rules (name, category, field_or_event, operator, value, points, sort_order, is_active, description)
VALUES
  ('Pipeline: Qualification Stage', 'intent', 'pipeline_stage', 'equals', '"qualification"'::jsonb, 10, 145, true, 'Lead has advanced to initial qualification stage'),
  ('Pipeline: Acquisition Stage', 'intent', 'pipeline_stage', 'equals', '"acquisition"'::jsonb, 20, 150, true, 'Lead is actively evaluating and in sales acquisition'),
  ('Pipeline: Approval Stage', 'intent', 'pipeline_stage', 'equals', '"approval"'::jsonb, 25, 155, true, 'Lead documentation approved; final closing stage')
ON CONFLICT DO NOTHING;

-- 3. Enforce canonical consistency on lead_score_rules via CHECK constraint
ALTER TABLE public.lead_score_rules
DROP CONSTRAINT IF EXISTS chk_lead_score_rules_canonical;

ALTER TABLE public.lead_score_rules
ADD CONSTRAINT chk_lead_score_rules_canonical
CHECK (
  -- Source must be one of the canonical leads.source values
  (field_or_event <> 'source' OR operator NOT IN ('equals', 'not_equals') OR (value #>> '{}') IN ('meta', 'google', 'manual', 'test', 'form'))
  AND
  -- Pipeline stage must be one of the canonical pipeline_stages.code values
  (field_or_event <> 'pipeline_stage' OR operator NOT IN ('equals', 'not_equals') OR (value #>> '{}') IN ('capture', 'qualification', 'acquisition', 'approval', 'enrollment', 'post_course', 'alumni'))
  AND
  -- Qualification status must be one of the canonical qualification_status values
  (field_or_event <> 'qualification_status' OR operator NOT IN ('equals', 'not_equals') OR (value #>> '{}') IN ('no_response', 'some_response', 'interested', 'hot', 'confirmed'))
  AND
  -- Contact preference must be one of the canonical contact_preference values
  (field_or_event <> 'contact_preference' OR operator NOT IN ('equals', 'not_equals') OR (value #>> '{}') IN ('email', 'sms', 'call'))
);

COMMENT ON CONSTRAINT chk_lead_score_rules_canonical ON public.lead_score_rules IS 
'Enforces that scoring rules for source, pipeline_stage, qualification_status, and contact_preference only reference valid EDS HUB canonical schema values.';
