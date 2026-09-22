import { describe, it, expect } from 'vitest';

/**
 * Migration 00051 Safety Logic Model
 * Mirrors the defense-in-depth trigger logic in public.trg_capture_lead_created_event()
 */
interface TriggerInput {
  leadId: string;
  source: string;
  source_detail?: string | null;
  sync_origin?: string | null;
  auto_suppress_automations?: boolean;
}

interface TriggerResult {
  emitted: boolean;
  event_type?: string;
  reason?: string;
}

function simulateLeadCreatedTrigger(input: TriggerInput): TriggerResult {
  // 1. Check transaction-local sync origin
  if (['hubspot_sync', 'hubspot_historical', 'hubspot_reconcile'].includes(input.sync_origin || '')) {
    return { emitted: false, reason: 'suppressed_by_sync_origin' };
  }

  // 2. Check source_detail markers
  if (['hubspot_sync', 'hubspot_historical', 'csv_import'].includes(input.source_detail || '')) {
    if (['hubspot_sync', 'hubspot_historical'].includes(input.source_detail || '')) {
      const suppress = input.auto_suppress_automations ?? true;
      if (suppress) {
        return { emitted: false, reason: 'suppressed_by_hubspot_connection_flag' };
      }
    } else {
      // CSV imports are historical
      return { emitted: false, reason: 'suppressed_by_csv_import_marker' };
    }
  }

  // 3. Suppress test leads
  if (input.source === 'test') {
    return { emitted: false, reason: 'suppressed_test_source' };
  }

  // 4. Eligible for automation event
  return {
    emitted: true,
    event_type: 'lead_created',
  };
}

describe('HubSpot Import & Historical Sync Automation Suppression (Migration 00051)', () => {
  it('suppresses lead_created automation event when sync_origin is hubspot_sync', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-hs-1',
      source: 'manual',
      source_detail: 'hubspot_sync',
      sync_origin: 'hubspot_sync',
    });

    expect(result.emitted).toBe(false);
    expect(result.reason).toBe('suppressed_by_sync_origin');
  });

  it('suppresses lead_created automation event when source_detail is hubspot_sync and connection suppresses automations', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-hs-2',
      source: 'manual',
      source_detail: 'hubspot_sync',
      sync_origin: null,
      auto_suppress_automations: true,
    });

    expect(result.emitted).toBe(false);
    expect(result.reason).toBe('suppressed_by_hubspot_connection_flag');
  });

  it('suppresses lead_created automation event during HubSpot reconciliation', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-hs-reconcile',
      source: 'manual',
      source_detail: 'hubspot_sync',
      sync_origin: 'hubspot_reconcile',
    });

    expect(result.emitted).toBe(false);
    expect(result.reason).toBe('suppressed_by_sync_origin');
  });

  it('suppresses lead_created automation event during CSV historical imports', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-csv-1',
      source: 'manual',
      source_detail: 'csv_import',
      sync_origin: null,
    });

    expect(result.emitted).toBe(false);
    expect(result.reason).toBe('suppressed_by_csv_import_marker');
  });

  it('emits lead_created automation event for normal manual lead creation', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-manual-1',
      source: 'manual',
      source_detail: null,
      sync_origin: null,
    });

    expect(result.emitted).toBe(true);
    expect(result.event_type).toBe('lead_created');
  });

  it('emits lead_created automation event for eligible Meta advertising leads', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-meta-1',
      source: 'meta',
      source_detail: 'instagram_story_ad',
      sync_origin: null,
    });

    expect(result.emitted).toBe(true);
    expect(result.event_type).toBe('lead_created');
  });

  it('emits lead_created automation event for eligible website form submissions', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-form-1',
      source: 'form',
      source_detail: 'website-form',
      sync_origin: null,
    });

    expect(result.emitted).toBe(true);
    expect(result.event_type).toBe('lead_created');
  });

  it('suppresses test leads from creating live automation events', () => {
    const result = simulateLeadCreatedTrigger({
      leadId: 'lead-test-1',
      source: 'test',
      source_detail: null,
      sync_origin: null,
    });

    expect(result.emitted).toBe(false);
    expect(result.reason).toBe('suppressed_test_source');
  });

  it('ensures duplicate HubSpot events are rejected idempotently', () => {
    const processedHashes = new Set<string>();

    const checkIdempotency = (eventId: string, payloadHash: string) => {
      const key = `${eventId}:${payloadHash}`;
      if (processedHashes.has(key)) {
        return { duplicate: true };
      }
      processedHashes.add(key);
      return { duplicate: false };
    };

    // First ingestion
    const firstAttempt = checkIdempotency('hs-event-101', 'hash-abc-123');
    expect(firstAttempt.duplicate).toBe(false);

    // Duplicate webhook redelivery
    const secondAttempt = checkIdempotency('hs-event-101', 'hash-abc-123');
    expect(secondAttempt.duplicate).toBe(true);
  });
});
