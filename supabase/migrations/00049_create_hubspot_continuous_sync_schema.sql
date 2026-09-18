-- =============================================================================
-- Migration 00049: HubSpot Continuous Sync & Mapping Governance
-- =============================================================================
-- Establishes enterprise continuous sync infrastructure between HubSpot & EDS HUB:
-- 1. integration_connections (singleton connection governance per provider)
-- 2. integration_entity_links (canonical persistent identity: hubspot_id <-> lead_id)
-- 3. integration_field_mappings (centralized field mapping registry)
-- 4. integration_field_mapping_history (versioned audit trail)
-- 5. integration_sync_events (idempotency, payload hashes & audit log)
-- 6. integration_outbox (transactional outbox for EDS -> HubSpot)
-- 7. integration_conflicts (conflict review queue)
-- 8. integration_property_cache (HubSpot CRM properties schema cache)
-- 9. Automatic bidirectional link mirroring with public.leads.hubspot_contact_id
-- 10. Outbox trigger with loop suppression on public.leads
-- 11. Extension of lead_activities & lead_course_interests constraints
-- 12. Atomic processing RPCs (inbound batch, outbox dispatch, conflict resolution, dry-run)
-- 13. RLS policies protecting all integration tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Integration Connections Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                  TEXT NOT NULL UNIQUE, -- 'hubspot'
  status                    TEXT NOT NULL CHECK (status IN ('configuration_required', 'connected', 'degraded', 'disconnected')),
  portal_id                 TEXT NULL,
  account_name              TEXT NULL,
  sync_enabled              BOOLEAN NOT NULL DEFAULT false,
  inbound_webhook_enabled   BOOLEAN NOT NULL DEFAULT false,
  outbound_sync_enabled     BOOLEAN NOT NULL DEFAULT false,
  auto_suppress_automations BOOLEAN NOT NULL DEFAULT true,
  last_health_check_at      TIMESTAMPTZ NULL,
  health_status_message     TEXT NULL,
  last_successful_api_call_at TIMESTAMPTZ NULL,
  last_webhook_at           TIMESTAMPTZ NULL,
  last_sync_at              TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_connections IS
  'Connection state and operational governance for external integrations.';

-- Seed default HubSpot row in Configuration Required state
INSERT INTO public.integration_connections (
  provider,
  status,
  health_status_message
) VALUES (
  'hubspot',
  'configuration_required',
  'HubSpot API credentials not configured. Connection pending setup.'
) ON CONFLICT (provider) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Integration Entity Links Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_entity_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration           TEXT NOT NULL DEFAULT 'hubspot',
  entity_type           TEXT NOT NULL DEFAULT 'lead',
  eds_entity_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  external_entity_id    TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'conflict', 'archived', 'disconnected')),
  last_synced_hash      TEXT NULL,
  external_updated_at   TIMESTAMPTZ NULL,
  conflict_reason       TEXT NULL,
  last_inbound_sync_at  TIMESTAMPTZ NULL,
  last_outbound_sync_at TIMESTAMPTZ NULL,
  linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_entity_links IS
  'Canonical source of truth for persistent identity pairing between HubSpot contacts and EDS leads.';

-- Unique active constraints: Exactly 1 active lead per HubSpot contact, and 1 active HubSpot contact per lead
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_entity_links_active_external
  ON public.integration_entity_links(integration, entity_type, external_entity_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_entity_links_active_eds
  ON public.integration_entity_links(integration, entity_type, eds_entity_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_integration_entity_links_eds
  ON public.integration_entity_links(eds_entity_id);

CREATE INDEX IF NOT EXISTS idx_integration_entity_links_ext
  ON public.integration_entity_links(external_entity_id);

-- -----------------------------------------------------------------------------
-- 3. Integration Field Mappings Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_field_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration       TEXT NOT NULL DEFAULT 'hubspot',
  entity_type       TEXT NOT NULL DEFAULT 'lead',
  external_property TEXT NOT NULL,
  eds_target        TEXT NOT NULL,
  target_type       TEXT NOT NULL DEFAULT 'lead_field' CHECK (target_type IN ('lead_field', 'lead_course_interest', 'integration_metadata')),
  direction         TEXT NOT NULL CHECK (direction IN ('hubspot_to_eds', 'eds_to_hubspot', 'bidirectional')),
  source_of_truth   TEXT NOT NULL CHECK (source_of_truth IN ('hubspot', 'eds', 'bidirectional_newest', 'manual_conflict')),
  transform_rule    TEXT NOT NULL DEFAULT 'none' CHECK (transform_rule IN (
                      'none', 'phone_digits', 'phone_e164', 'email_normalize', 
                      'qualification_status_enum', 'course_interest_lookup', 'boolean_toggle', 'timestamp_utc'
                    )),
  allow_clear       BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  mapping_version   INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_integration_field_mappings UNIQUE (integration, entity_type, external_property, eds_target, mapping_version)
);

COMMENT ON TABLE public.integration_field_mappings IS
  'Centralized registry defining field mapping rules, direction, and source of truth.';

-- -----------------------------------------------------------------------------
-- 4. Integration Field Mapping History Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_field_mapping_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id        UUID NOT NULL REFERENCES public.integration_field_mappings(id) ON DELETE CASCADE,
  external_property TEXT NOT NULL,
  eds_target        TEXT NOT NULL,
  target_type       TEXT NOT NULL,
  direction         TEXT NOT NULL,
  source_of_truth   TEXT NOT NULL,
  transform_rule    TEXT NOT NULL,
  allow_clear       BOOLEAN NOT NULL,
  mapping_version   INTEGER NOT NULL,
  changed_by        UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  change_reason     TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed canonical initial mappings for HubSpot <-> EDS Leads
INSERT INTO public.integration_field_mappings (
  integration, entity_type, external_property, eds_target, target_type,
  direction, source_of_truth, transform_rule, allow_clear, is_active, mapping_version
) VALUES
  ('hubspot', 'lead', 'firstname', 'first_name', 'lead_field', 'bidirectional', 'bidirectional_newest', 'none', false, true, 1),
  ('hubspot', 'lead', 'lastname', 'last_name', 'lead_field', 'bidirectional', 'bidirectional_newest', 'none', false, true, 1),
  ('hubspot', 'lead', 'email', 'email', 'lead_field', 'bidirectional', 'hubspot', 'email_normalize', false, true, 1),
  ('hubspot', 'lead', 'phone', 'phone_raw', 'lead_field', 'bidirectional', 'hubspot', 'phone_digits', false, true, 1),
  ('hubspot', 'lead', 'mobilephone', 'phone_raw', 'lead_field', 'hubspot_to_eds', 'hubspot', 'phone_digits', false, true, 1),
  ('hubspot', 'lead', 'hs_lead_status', 'qualification_status', 'lead_field', 'bidirectional', 'eds', 'qualification_status_enum', false, true, 1),
  ('hubspot', 'lead', 'course_interest', 'course_id', 'lead_course_interest', 'hubspot_to_eds', 'hubspot', 'course_interest_lookup', false, true, 1),
  ('hubspot', 'lead', 'lead_source', 'source_detail', 'lead_field', 'hubspot_to_eds', 'eds', 'none', false, true, 1),
  ('hubspot', 'lead', 'lifecyclestage', 'hubspot_lifecycle_stage', 'integration_metadata', 'hubspot_to_eds', 'hubspot', 'none', false, true, 1)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Integration Sync Events Table (Audit & Idempotency)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_sync_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration               TEXT NOT NULL DEFAULT 'hubspot',
  direction                 TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  entity_type               TEXT NOT NULL DEFAULT 'lead',
  eds_entity_id             UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  external_entity_id        TEXT NULL,
  event_type                TEXT NOT NULL,
  external_event_id         TEXT NULL,
  external_event_timestamp  TIMESTAMPTZ NULL,
  mapping_version           INTEGER NULL,
  payload_hash              TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN (
                              'received', 'processing', 'completed', 'ignored_duplicate', 
                              'ignored_echo', 'ignored_stale', 'conflict', 'failed', 'dead_letter'
                            )),
  attempt_count             INTEGER NOT NULL DEFAULT 0,
  max_attempts              INTEGER NOT NULL DEFAULT 5,
  next_retry_at             TIMESTAMPTZ NULL,
  error_code                TEXT NULL,
  error_message             TEXT NULL,
  change_summary            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at              TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.integration_sync_events IS
  'Immutable log of all inbound webhooks and outbound sync operations with idempotency tracking.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_events_idempotency 
  ON public.integration_sync_events(integration, external_event_id) 
  WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_events_status_date 
  ON public.integration_sync_events(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_events_eds_entity
  ON public.integration_sync_events(eds_entity_id);

-- -----------------------------------------------------------------------------
-- 6. Integration Outbox Table (Transactional Outbox Pattern)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration         TEXT NOT NULL DEFAULT 'hubspot',
  entity_type         TEXT NOT NULL DEFAULT 'lead',
  eds_entity_id       UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  external_entity_id  TEXT NULL,
  event_type          TEXT NOT NULL,
  payload             JSONB NOT NULL,
  payload_hash        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 5,
  next_retry_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error          TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.integration_outbox IS
  'Transactional outbox queue for outbound synchronization from EDS HUB to HubSpot.';

CREATE INDEX IF NOT EXISTS idx_integration_outbox_queue 
  ON public.integration_outbox(status, next_retry_at ASC) 
  WHERE status IN ('pending', 'failed');

-- -----------------------------------------------------------------------------
-- 7. Integration Conflicts Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_conflicts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration         TEXT NOT NULL DEFAULT 'hubspot',
  entity_type         TEXT NOT NULL DEFAULT 'lead',
  eds_entity_id       UUID NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  external_entity_id  TEXT NULL,
  conflict_type       TEXT NOT NULL CHECK (conflict_type IN (
                        'MULTIPLE_EMAIL_MATCH', 'MULTIPLE_PHONE_MATCH', 'EMAIL_COLLISION', 
                        'PHONE_COLLISION', 'MAPPING_VALUE_UNKNOWN', 'TYPE_CONVERSION_FAILED', 
                        'CONCURRENT_FIELD_UPDATE', 'EXTERNAL_ENTITY_MERGED'
                      )),
  conflict_summary    TEXT NOT NULL,
  field_name          TEXT NULL,
  hubspot_data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  eds_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN (
                        'pending_review', 'resolved_hubspot_wins', 'resolved_eds_wins', 
                        'resolved_manual_edit', 'dismissed'
                      )),
  resolution_notes    TEXT NULL,
  resolved_by         UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_conflicts IS
  'Queue for operator review and resolution of ambiguous matches, data collisions, and unmapped enums.';

CREATE INDEX IF NOT EXISTS idx_integration_conflicts_status 
  ON public.integration_conflicts(status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 8. Integration Property Cache Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_property_cache (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration         TEXT NOT NULL DEFAULT 'hubspot',
  property_name       TEXT NOT NULL,
  label               TEXT NOT NULL,
  property_type       TEXT NOT NULL,
  field_type          TEXT NOT NULL,
  options             JSONB NULL,
  is_custom           BOOLEAN NOT NULL DEFAULT false,
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  last_refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_integration_property_cache UNIQUE (integration, property_name)
);

-- -----------------------------------------------------------------------------
-- 9. Mirroring Trigger between integration_entity_links and public.leads.hubspot_contact_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sync_integration_link_to_leads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type = 'lead' THEN
    IF NEW.status = 'active' THEN
      UPDATE public.leads
      SET hubspot_contact_id = NEW.external_entity_id
      WHERE id = NEW.eds_entity_id
        AND (hubspot_contact_id IS DISTINCT FROM NEW.external_entity_id);
    ELSIF NEW.status IN ('archived', 'disconnected') THEN
      UPDATE public.leads
      SET hubspot_contact_id = NULL
      WHERE id = NEW.eds_entity_id
        AND hubspot_contact_id = NEW.external_entity_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_integration_entity_links_leads_mirror ON public.integration_entity_links;
CREATE TRIGGER trg_integration_entity_links_leads_mirror
  AFTER INSERT OR UPDATE OF status, external_entity_id, eds_entity_id
  ON public.integration_entity_links
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_integration_link_to_leads();

-- -----------------------------------------------------------------------------
-- 10. Outbox Capture Trigger on public.leads with Loop Prevention
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_capture_leads_outbox_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origin TEXT;
  v_external_id TEXT;
  v_link_record RECORD;
  v_outbound_payload JSONB := '{}'::jsonb;
  v_payload_hash TEXT;
  v_has_mapped_change BOOLEAN := false;
BEGIN
  -- 1. Loop Prevention: Check transaction-local origin
  v_origin := current_setting('app.sync_origin', true);
  IF v_origin = 'hubspot_sync' THEN
    -- Suppress emission when update was triggered by inbound HubSpot sync
    RETURN NEW;
  END IF;

  -- 2. Find active link for this lead
  SELECT external_entity_id, last_synced_hash INTO v_link_record
  FROM public.integration_entity_links
  WHERE integration = 'hubspot'
    AND entity_type = 'lead'
    AND eds_entity_id = NEW.id
    AND status = 'active'
  LIMIT 1;

  -- 3. Check if mapped outbound / bidirectional fields changed
  -- First Name
  IF OLD.first_name IS DISTINCT FROM NEW.first_name THEN
    v_outbound_payload := jsonb_set(v_outbound_payload, '{firstname}', to_jsonb(COALESCE(NEW.first_name, '')));
    v_has_mapped_change := true;
  END IF;

  -- Last Name
  IF OLD.last_name IS DISTINCT FROM NEW.last_name THEN
    v_outbound_payload := jsonb_set(v_outbound_payload, '{lastname}', to_jsonb(COALESCE(NEW.last_name, '')));
    v_has_mapped_change := true;
  END IF;

  -- Email
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    v_outbound_payload := jsonb_set(v_outbound_payload, '{email}', to_jsonb(COALESCE(NEW.email, '')));
    v_has_mapped_change := true;
  END IF;

  -- Phone
  IF OLD.phone_raw IS DISTINCT FROM NEW.phone_raw THEN
    v_outbound_payload := jsonb_set(v_outbound_payload, '{phone}', to_jsonb(COALESCE(NEW.phone_raw, '')));
    v_has_mapped_change := true;
  END IF;

  -- Qualification Status
  IF OLD.qualification_status IS DISTINCT FROM NEW.qualification_status THEN
    v_outbound_payload := jsonb_set(v_outbound_payload, '{hs_lead_status}', to_jsonb(COALESCE(NEW.qualification_status, '')));
    v_has_mapped_change := true;
  END IF;

  -- If no mapped field changed (e.g. only updated_at or lead_score changed), suppress outbox
  IF NOT v_has_mapped_change THEN
    RETURN NEW;
  END IF;

  -- Compute deterministic SHA-256 payload hash
  v_payload_hash := encode(sha256(v_outbound_payload::text::bytea), 'hex');

  -- If hash identical to last_synced_hash, suppress duplicate
  IF v_link_record.last_synced_hash IS NOT NULL AND v_link_record.last_synced_hash = v_payload_hash THEN
    RETURN NEW;
  END IF;

  -- Enqueue outbox record
  INSERT INTO public.integration_outbox (
    integration,
    entity_type,
    eds_entity_id,
    external_entity_id,
    event_type,
    payload,
    payload_hash,
    status
  ) VALUES (
    'hubspot',
    'lead',
    NEW.id,
    v_link_record.external_entity_id,
    'lead.updated',
    v_outbound_payload,
    v_payload_hash,
    'pending'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_capture_outbox_event ON public.leads;
CREATE TRIGGER trg_leads_capture_outbox_event
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_leads_outbox_event();

-- -----------------------------------------------------------------------------
-- 11. Constraint Extensions (lead_activities & lead_course_interests)
-- -----------------------------------------------------------------------------
-- Extend lead_activities
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'lead_created'::text, 'intake_received'::text, 'email_dispatched'::text, 
    'sms_dispatched'::text, 'call_task_created'::text, 'stage_changed'::text, 
    'processing_failed'::text, 'note_created'::text, 'tag_added'::text, 
    'tag_removed'::text, 'campaign_sent'::text, 'contact_preference_detected'::text, 
    'email_selected'::text, 'sms_selected'::text, 'call_selected'::text, 
    'channel_skipped'::text, 'csv_status_unmapped'::text, 'qualification_status_changed'::text,
    'form_submitted'::text, 'automation_started'::text, 'automation_completed'::text,
    'automation_failed'::text, 'sequence_started'::text, 'sequence_completed'::text, 
    'sequence_failed'::text, 'sequence_stopped'::text, 'email_reply_received'::text, 
    'sms_reply_received'::text, 'enrollment_created'::text, 'enrollment_confirmed'::text,
    'course_session_assigned'::text, 'course_session_changed'::text, 'attendance_recorded'::text, 
    'course_completed'::text, 'student_no_show'::text, 'checklist_item_updated'::text,
    'post_course_followup_created'::text, 'post_course_followup_completed'::text,
    'feedback_requested'::text, 'feedback_received'::text, 'testimonial_requested'::text,
    'testimonial_received'::text, 'future_course_interest_added'::text, 'task_created'::text,
    'task_rescheduled'::text, 'task_completed'::text,
    -- Integration activities:
    'hubspot_contact_linked'::text,
    'hubspot_field_updated'::text,
    'hubspot_outbound_synced'::text,
    'hubspot_sync_conflict'::text
  ]));

-- Extend lead_course_interests source check constraint to allow 'hubspot_sync'
ALTER TABLE public.lead_course_interests
  DROP CONSTRAINT IF EXISTS lead_course_interests_source_check;

ALTER TABLE public.lead_course_interests
  ADD CONSTRAINT lead_course_interests_source_check
  CHECK (source IN ('manual', 'post_course', 'form', 'hubspot_sync'));

-- -----------------------------------------------------------------------------
-- 12. PostgreSQL RPC: process_hubspot_inbound_batch
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_event_id TEXT;
  v_contact_id TEXT;
  v_props JSONB;
  v_event_ts TIMESTAMPTZ;
  v_payload_hash TEXT;
  v_link_rec RECORD;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_qual_status TEXT;
  v_course_interest_val TEXT;
  v_resolved_course_id UUID;
  v_existing_lead RECORD;
  v_change_diff JSONB := '{}'::jsonb;
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_duplicate INT := 0;
  v_ignored_echo INT := 0;
  v_ignored_stale INT := 0;
  v_conflict_count INT := 0;
  v_capture_stage_id UUID;
BEGIN
  -- Set transaction-local sync origin to suppress loop triggers
  PERFORM set_config('app.sync_origin', 'hubspot_sync', true);

  -- Get Capture pipeline stage
  SELECT id INTO v_capture_stage_id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    v_event_id := v_item->>'eventId';
    v_contact_id := COALESCE(v_item->>'objectId', v_item->>'hubspot_contact_id', v_item->>'id');
    v_props := COALESCE(v_item->'properties', v_item->'raw_properties', v_item);
    v_event_ts := COALESCE((v_item->>'occurredAt')::timestamptz, (v_props->>'lastmodifieddate')::timestamptz, now());
    v_payload_hash := encode(sha256(v_props::text::bytea), 'hex');

    -- 1. Idempotency Check on external_event_id
    IF v_event_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.integration_sync_events WHERE integration = 'hubspot' AND external_event_id = v_event_id) THEN
        v_ignored_duplicate := v_ignored_duplicate + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Extract normalized values
    v_email := NULLIF(trim(lower(COALESCE(v_props->>'email', ''))), '');
    v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', ''), '\D', '', 'g'), '');
    v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', '')), '');
    v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', '')), '');
    v_qual_status := NULLIF(trim(COALESCE(v_props->>'hs_lead_status', v_props->>'qualification_status', '')), '');
    v_course_interest_val := NULLIF(trim(COALESCE(v_props->>'course_interest', '')), '');

    -- 2. Find Link / Matching Hierarchy
    v_matched_lead_id := NULL;

    -- Priority 1: Existing active link in integration_entity_links
    SELECT eds_entity_id, last_synced_hash, external_updated_at INTO v_link_rec
    FROM public.integration_entity_links
    WHERE integration = 'hubspot'
      AND entity_type = 'lead'
      AND external_entity_id = v_contact_id
      AND status = 'active'
    LIMIT 1;

    IF v_link_rec.eds_entity_id IS NOT NULL THEN
      v_matched_lead_id := v_link_rec.eds_entity_id;

      -- Check Out-of-Order Stale Event
      IF v_link_rec.external_updated_at IS NOT NULL AND v_event_ts < v_link_rec.external_updated_at THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
          'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'ignored_stale',
          jsonb_build_object('reason', 'Incoming event timestamp is older than recorded version')
        );
        v_ignored_stale := v_ignored_stale + 1;
        CONTINUE;
      END IF;

      -- Check Echo Loop (hash match)
      IF v_link_rec.last_synced_hash IS NOT NULL AND v_link_rec.last_synced_hash = v_payload_hash THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
          'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'ignored_echo',
          jsonb_build_object('reason', 'Payload hash identical to last synced state')
        );
        v_ignored_echo := v_ignored_echo + 1;
        CONTINUE;
      END IF;

    ELSE
      -- Priority 2: Mirrored hubspot_contact_id in public.leads
      SELECT id INTO v_matched_lead_id
      FROM public.leads
      WHERE hubspot_contact_id = v_contact_id
      LIMIT 1;

      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        -- Priority 3: Normalized Unique Email Match
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE lower(trim(email)) = v_email;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          -- Email collision / multiple matches -> Conflict
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_EMAIL_MATCH',
            'Email ' || v_email || ' matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'email', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Priority 4: Normalized Unique Phone Match
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL THEN
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_PHONE_MATCH',
            'Phone matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'phone', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- 3. Execute Update or Create
    v_change_diff := '{}'::jsonb;

    IF v_matched_lead_id IS NOT NULL THEN
      -- UPDATE EXISTING MATCHED LEAD
      SELECT first_name, last_name, email, phone_raw, qualification_status INTO v_existing_lead
      FROM public.leads WHERE id = v_matched_lead_id;

      -- Email Collision Safety Check: If email changed, ensure it doesn't collide with a DIFFERENT lead
      IF v_email IS NOT NULL AND v_existing_lead.email IS DISTINCT FROM v_email THEN
        IF EXISTS (SELECT 1 FROM public.leads WHERE lower(trim(email)) = v_email AND id <> v_matched_lead_id) THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, eds_entity_id, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data, eds_data
          ) VALUES (
            'hubspot', 'lead', v_matched_lead_id, v_contact_id, 'EMAIL_COLLISION',
            'New email from HubSpot collides with a different existing lead',
            'email', v_props, to_jsonb(v_existing_lead)
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Apply non-destructive updates (empty incoming does not overwrite)
      UPDATE public.leads
      SET
        first_name = COALESCE(v_first_name, first_name),
        last_name = COALESCE(v_last_name, last_name),
        email = COALESCE(v_email, email),
        phone_raw = COALESCE(v_phone, phone_raw),
        hubspot_contact_id = v_contact_id,
        updated_at = now()
      WHERE id = v_matched_lead_id;

      -- Upsert active integration_entity_link
      INSERT INTO public.integration_entity_links (
        integration, entity_type, eds_entity_id, external_entity_id,
        status, last_synced_hash, external_updated_at, last_inbound_sync_at
      ) VALUES (
        'hubspot', 'lead', v_matched_lead_id, v_contact_id,
        'active', v_payload_hash, v_event_ts, now()
      ) ON CONFLICT (integration, entity_type, eds_entity_id) WHERE status = 'active'
      DO UPDATE SET
        external_entity_id = EXCLUDED.external_entity_id,
        last_synced_hash = EXCLUDED.last_synced_hash,
        external_updated_at = EXCLUDED.external_updated_at,
        last_inbound_sync_at = EXCLUDED.last_inbound_sync_at,
        updated_at = now();

      -- Course Interest Normalization (lead_course_interests)
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) OR lower(code) = lower(v_course_interest_val)
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
        ELSE
          -- Unknown course value -> conflict
          INSERT INTO public.integration_conflicts (
            integration, entity_type, eds_entity_id, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_matched_lead_id, v_contact_id, 'MAPPING_VALUE_UNKNOWN',
            'Unrecognized course interest value from HubSpot: ' || v_course_interest_val,
            'course_interest', v_props
          );
        END IF;
      END IF;

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'hubspot_field_updated', 'system',
        'Lead updated via HubSpot sync', jsonb_build_object('external_id', v_contact_id)
      );

      v_updated_count := v_updated_count + 1;

    ELSE
      -- CREATE NEW LEAD (Default to capture stage, manual or form source)
      INSERT INTO public.leads (
        first_name, last_name, email, phone_raw, contact_preference,
        source, source_detail, pipeline_stage_id, hubspot_contact_id
      ) VALUES (
        v_first_name, v_last_name, v_email, v_phone, 'email',
        'manual', 'hubspot_sync', v_capture_stage_id, v_contact_id
      ) RETURNING id INTO v_matched_lead_id;

      -- Create active link
      INSERT INTO public.integration_entity_links (
        integration, entity_type, eds_entity_id, external_entity_id,
        status, last_synced_hash, external_updated_at, last_inbound_sync_at
      ) VALUES (
        'hubspot', 'lead', v_matched_lead_id, v_contact_id,
        'active', v_payload_hash, v_event_ts, now()
      );

      -- Course Interest Normalization
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) OR lower(code) = lower(v_course_interest_val)
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active');
        END IF;
      END IF;

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'hubspot_contact_linked', 'system',
        'Lead created and linked from HubSpot', jsonb_build_object('external_id', v_contact_id)
      );

      v_created_count := v_created_count + 1;
    END IF;

    -- Record Successful Sync Event
    INSERT INTO public.integration_sync_events (
      integration, direction, entity_type, eds_entity_id, external_entity_id,
      event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
    ) VALUES (
      'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
      'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'completed',
      jsonb_build_object('created', v_matched_lead_id IS NOT NULL)
    );

  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'created', v_created_count,
    'updated', v_updated_count,
    'conflicts', v_conflict_count,
    'ignored_duplicate', v_ignored_duplicate,
    'ignored_echo', v_ignored_echo,
    'ignored_stale', v_ignored_stale
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. PostgreSQL RPC: resolve_hubspot_conflict
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_hubspot_conflict(
  p_conflict_id UUID,
  p_resolution TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict RECORD;
BEGIN
  SELECT * INTO v_conflict
  FROM public.integration_conflicts
  WHERE id = p_conflict_id
  FOR UPDATE;

  IF v_conflict.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Conflict record not found');
  END IF;

  IF p_resolution NOT IN ('resolved_hubspot_wins', 'resolved_eds_wins', 'dismissed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid resolution status');
  END IF;

  -- Apply Resolution Action if needed
  IF p_resolution = 'resolved_hubspot_wins' AND v_conflict.eds_entity_id IS NOT NULL THEN
    IF v_conflict.field_name = 'email' AND v_conflict.hubspot_data->>'email' IS NOT NULL THEN
      UPDATE public.leads
      SET email = v_conflict.hubspot_data->>'email', updated_at = now()
      WHERE id = v_conflict.eds_entity_id;
    ELSIF v_conflict.field_name = 'phone' AND v_conflict.hubspot_data->>'phone' IS NOT NULL THEN
      UPDATE public.leads
      SET phone_raw = v_conflict.hubspot_data->>'phone', updated_at = now()
      WHERE id = v_conflict.eds_entity_id;
    END IF;
  END IF;

  -- Update Conflict status
  UPDATE public.integration_conflicts
  SET
    status = p_resolution,
    resolution_notes = p_notes,
    resolved_by = auth.uid(),
    resolved_at = now()
  WHERE id = p_conflict_id;

  RETURN jsonb_build_object('success', true, 'status', p_resolution);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. PostgreSQL RPC: execute_hubspot_dry_run
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_hubspot_dry_run(p_contacts JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_contact_id TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_scanned INT := 0;
  v_matched INT := 0;
  v_would_create INT := 0;
  v_would_update INT := 0;
  v_conflicts INT := 0;
  v_skipped INT := 0;
  v_matches UUID[];
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_scanned := v_scanned + 1;
    v_contact_id := COALESCE(v_item->>'id', v_item->>'objectId');
    v_email := NULLIF(trim(lower(COALESCE(v_item->'properties'->>'email', v_item->>'email', ''))), '');
    v_phone := NULLIF(regexp_replace(COALESCE(v_item->'properties'->>'phone', v_item->>'phone', ''), '\D', '', 'g'), '');

    IF v_contact_id IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Check existing active link
    IF EXISTS (
      SELECT 1 FROM public.integration_entity_links 
      WHERE integration = 'hubspot' AND external_entity_id = v_contact_id AND status = 'active'
    ) THEN
      v_matched := v_matched + 1;
      v_would_update := v_would_update + 1;
      CONTINUE;
    END IF;

    -- Check email match
    IF v_email IS NOT NULL THEN
      SELECT array_agg(id) INTO v_matches FROM public.leads WHERE lower(trim(email)) = v_email;
      IF cardinality(v_matches) = 1 THEN
        v_matched := v_matched + 1;
        v_would_update := v_would_update + 1;
        CONTINUE;
      ELSIF cardinality(v_matches) > 1 THEN
        v_conflicts := v_conflicts + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Check phone match
    IF v_phone IS NOT NULL THEN
      SELECT array_agg(id) INTO v_matches FROM public.leads 
      WHERE regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone;
      IF cardinality(v_matches) = 1 THEN
        v_matched := v_matched + 1;
        v_would_update := v_would_update + 1;
        CONTINUE;
      ELSIF cardinality(v_matches) > 1 THEN
        v_conflicts := v_conflicts + 1;
        CONTINUE;
      END IF;
    END IF;

    -- No match found -> would create new lead
    v_would_create := v_would_create + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'matched', v_matched,
    'would_create', v_would_create,
    'would_update', v_would_update,
    'conflicts', v_conflicts,
    'skipped', v_skipped
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. PostgreSQL RPC: get_hubspot_sync_metrics
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hubspot_sync_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD;
  v_linked_count INT;
  v_pending_outbox INT;
  v_sync_errors INT;
  v_conflicts_count INT;
BEGIN
  SELECT * INTO v_conn FROM public.integration_connections WHERE provider = 'hubspot' LIMIT 1;
  
  SELECT count(*) INTO v_linked_count 
  FROM public.integration_entity_links 
  WHERE integration = 'hubspot' AND status = 'active';

  SELECT count(*) INTO v_pending_outbox 
  FROM public.integration_outbox 
  WHERE integration = 'hubspot' AND status IN ('pending', 'processing');

  SELECT count(*) INTO v_sync_errors 
  FROM public.integration_sync_events 
  WHERE integration = 'hubspot' AND status IN ('failed', 'dead_letter');

  SELECT count(*) INTO v_conflicts_count 
  FROM public.integration_conflicts 
  WHERE integration = 'hubspot' AND status = 'pending_review';

  RETURN jsonb_build_object(
    'provider', 'hubspot',
    'status', COALESCE(v_conn.status, 'configuration_required'),
    'portal_id', v_conn.portal_id,
    'account_name', v_conn.account_name,
    'sync_enabled', COALESCE(v_conn.sync_enabled, false),
    'linked_count', v_linked_count,
    'pending_outbox', v_pending_outbox,
    'sync_errors', v_sync_errors,
    'conflicts_count', v_conflicts_count,
    'last_sync_at', v_conn.last_sync_at,
    'last_health_check_at', v_conn.last_health_check_at,
    'health_status_message', v_conn.health_status_message
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_field_mapping_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_property_cache ENABLE ROW LEVEL SECURITY;

-- 16.1 integration_connections
DROP POLICY IF EXISTS "integration_connections_select_active" ON public.integration_connections;
CREATE POLICY "integration_connections_select_active" ON public.integration_connections
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

DROP POLICY IF EXISTS "integration_connections_update_active" ON public.integration_connections;
CREATE POLICY "integration_connections_update_active" ON public.integration_connections
  FOR UPDATE TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- 16.2 integration_entity_links
DROP POLICY IF EXISTS "integration_entity_links_all_active" ON public.integration_entity_links;
CREATE POLICY "integration_entity_links_all_active" ON public.integration_entity_links
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- 16.3 integration_field_mappings
DROP POLICY IF EXISTS "integration_field_mappings_all_active" ON public.integration_field_mappings;
CREATE POLICY "integration_field_mappings_all_active" ON public.integration_field_mappings
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- 16.4 integration_field_mapping_history
DROP POLICY IF EXISTS "integration_field_mapping_history_select_active" ON public.integration_field_mapping_history;
CREATE POLICY "integration_field_mapping_history_select_active" ON public.integration_field_mapping_history
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

-- 16.5 integration_sync_events
DROP POLICY IF EXISTS "integration_sync_events_select_active" ON public.integration_sync_events;
CREATE POLICY "integration_sync_events_select_active" ON public.integration_sync_events
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

-- 16.6 integration_outbox
DROP POLICY IF EXISTS "integration_outbox_all_active" ON public.integration_outbox;
CREATE POLICY "integration_outbox_all_active" ON public.integration_outbox
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- 16.7 integration_conflicts
DROP POLICY IF EXISTS "integration_conflicts_all_active" ON public.integration_conflicts;
CREATE POLICY "integration_conflicts_all_active" ON public.integration_conflicts
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- 16.8 integration_property_cache
DROP POLICY IF EXISTS "integration_property_cache_all_active" ON public.integration_property_cache;
CREATE POLICY "integration_property_cache_all_active" ON public.integration_property_cache
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());
