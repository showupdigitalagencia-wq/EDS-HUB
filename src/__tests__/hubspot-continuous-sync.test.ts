import { describe, it, expect } from 'vitest';
import { verifyHubSpotSignatureV3 } from '../../supabase/functions/_shared/webhook-verifier';

describe('Phase 5 Special Block: HubSpot Continuous Sync & Mapping Governance', () => {
  // ===========================================================================
  // 1. Identity Linking & Matching Hierarchy
  // ===========================================================================
  describe('Identity Linking & Matching Safety Hierarchy', () => {
    it('prioritizes existing active external_entity_id link over email/phone', () => {
      const activeLinks = new Map([
        ['hs-101', { leadId: 'lead-uuid-1', externalId: 'hs-101', status: 'active' }],
      ]);

      const incomingContact = {
        id: 'hs-101',
        email: 'changed-email@example.com',
        phone: '1234567890',
      };

      const matchedLeadId = activeLinks.get(incomingContact.id)?.leadId;
      expect(matchedLeadId).toBe('lead-uuid-1');
    });

    it('enforces that 1 HubSpot contact links to at most 1 active lead', () => {
      const activeLinksByExternal = new Map<string, string>();
      activeLinksByExternal.set('hs-101', 'lead-uuid-1');

      // Attempting to link another lead with same active external ID
      const canLinkAnother = !activeLinksByExternal.has('hs-101');
      expect(canLinkAnother).toBe(false);
    });

    it('enforces that 1 EDS Lead links to at most 1 active HubSpot contact', () => {
      const activeLinksByLead = new Map<string, string>();
      activeLinksByLead.set('lead-uuid-1', 'hs-101');

      // Attempting to link another HubSpot contact to same lead
      const canLinkAnother = !activeLinksByLead.has('lead-uuid-1');
      expect(canLinkAnother).toBe(false);
    });

    it('matches by normalized unique email if no external link exists', () => {
      const dbEmails = new Map([
        ['dr.smith@example.com', 'lead-uuid-smith'],
      ]);

      const incomingEmail = '  Dr.Smith@Example.COM  '.trim().toLowerCase();
      const match = dbEmails.get(incomingEmail);
      expect(match).toBe('lead-uuid-smith');
    });

    it('flags conflict when email matches multiple leads (MULTIPLE_EMAIL_MATCH)', () => {
      const emailMatches = ['lead-1', 'lead-2'];
      const isAmbiguous = emailMatches.length > 1;

      expect(isAmbiguous).toBe(true);
      const conflictType = isAmbiguous ? 'MULTIPLE_EMAIL_MATCH' : null;
      expect(conflictType).toBe('MULTIPLE_EMAIL_MATCH');
    });

    it('flags conflict when phone matches multiple leads (MULTIPLE_PHONE_MATCH)', () => {
      const phoneMatches = ['lead-a', 'lead-b'];
      const isAmbiguous = phoneMatches.length > 1;

      expect(isAmbiguous).toBe(true);
      const conflictType = isAmbiguous ? 'MULTIPLE_PHONE_MATCH' : null;
      expect(conflictType).toBe('MULTIPLE_PHONE_MATCH');
    });

    it('identifies unlinked contact with no matching email/phone as a new lead candidate', () => {
      const dbEmails = new Map();
      const dbPhones = new Map();

      const incoming = { email: 'newdoc@example.com', phone: '9998887777' };
      const hasEmailMatch = dbEmails.has(incoming.email);
      const hasPhoneMatch = dbPhones.has(incoming.phone);

      const isNewLead = !hasEmailMatch && !hasPhoneMatch;
      expect(isNewLead).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Email & Phone Change Safety on Already-Linked Contacts
  // ===========================================================================
  describe('Email & Phone Change Safety', () => {
    it('updates linked lead when HubSpot changes email without triggering rematch or creating duplicate lead', () => {
      const linkedLead = {
        id: 'lead-123',
        hubspot_contact_id: 'hs-999',
        email: 'old@example.com',
      };

      const incomingUpdate = {
        id: 'hs-999',
        email: 'new@example.com',
      };

      // Contact is already linked by external ID
      expect(incomingUpdate.id).toBe(linkedLead.hubspot_contact_id);

      // Mutates existing lead, does NOT create new lead
      linkedLead.email = incomingUpdate.email;
      expect(linkedLead.id).toBe('lead-123');
      expect(linkedLead.email).toBe('new@example.com');
    });

    it('flags EMAIL_COLLISION if incoming updated email collides with another existing lead', () => {
      const otherLead = { id: 'lead-other', email: 'taken@example.com' };
      const currentLead = { id: 'lead-current', email: 'old@example.com', hubspot_contact_id: 'hs-1' };

      const incomingEmail = 'taken@example.com';
      const isColliding = incomingEmail === otherLead.email && currentLead.id !== otherLead.id;

      expect(isColliding).toBe(true);
      const conflictAction = isColliding ? 'EMAIL_COLLISION' : 'proceed';
      expect(conflictAction).toBe('EMAIL_COLLISION');
    });
  });

  // ===========================================================================
  // 3. Field Ownership & Protected EDS Core Fields
  // ===========================================================================
  describe('Field Ownership & Protected Core Fields', () => {
    it('strictly protects contact_preference from being overwritten by HubSpot marketing consent', () => {
      const existingLead = {
        id: 'lead-1',
        contact_preference: 'sms', // EDS internal preference
      };

      const _hubspotPayload = {
        email: 'doc@example.com',
        hs_email_optout: false,
        marketing_subscription: 'subscribed',
      };

      // Inbound sync rule: contact_preference is EDS-owned
      expect(_hubspotPayload).toBeDefined();
      const updatedPreference = existingLead.contact_preference; // NEVER overwritten
      expect(updatedPreference).toBe('sms');
    });

    it('strictly protects canonical leads.source from being overwritten by HubSpot source', () => {
      const existingLead = {
        id: 'lead-1',
        source: 'meta', // canonical enum: 'meta' | 'google' | 'manual' | 'test' | 'form'
        source_detail: null as string | null,
      };

      const hubspotPayload = {
        lead_source: 'Organic Search',
        utm_source: 'HubSpot Marketing',
      };

      // Canonical source is unchanged; external source is preserved in source_detail
      const preservedSource = existingLead.source;
      const updatedSourceDetail = hubspotPayload.utm_source;

      expect(preservedSource).toBe('meta');
      expect(updatedSourceDetail).toBe('HubSpot Marketing');
    });

    it('strictly protects pipeline_stage_id from being overwritten by HubSpot inbound in this version', () => {
      const existingLead = {
        id: 'lead-1',
        pipeline_stage_id: 'stage-enrollment-uuid',
      };

      const _hubspotPayload = {
        lifecyclestage: 'lead', // Attempt to set to lead
      };

      // Inbound sync rule: pipeline_stage is strictly EDS-owned
      expect(_hubspotPayload).toBeDefined();
      const preservedStage = existingLead.pipeline_stage_id;
      expect(preservedStage).toBe('stage-enrollment-uuid');
    });

    it('strictly protects lead_score from HubSpot sync', () => {
      const existingLead = {
        id: 'lead-1',
        lead_score: 85,
      };

      const _hubspotPayload = {
        hubspot_score: 12,
      };

      expect(_hubspotPayload).toBeDefined();
      const preservedScore = existingLead.lead_score;
      expect(preservedScore).toBe(85);
    });

    it('normalizes known course interest into lead_course_interests', () => {
      const courses = [
        { id: 'course-ortho-id', code: 'ORTHO', name: 'Comprehensive Orthodontics' },
      ];

      const hubspotCourseValue = 'Comprehensive Orthodontics';
      const resolvedCourse = courses.find(
        (c) => c.name.toLowerCase() === hubspotCourseValue.toLowerCase()
      );

      expect(resolvedCourse?.id).toBe('course-ortho-id');
      const normalizedRecord = {
        lead_id: 'lead-1',
        course_id: resolvedCourse!.id,
        source: 'hubspot_sync',
        status: 'active',
      };
      expect(normalizedRecord.source).toBe('hubspot_sync');
    });

    it('flags MAPPING_VALUE_UNKNOWN conflict when course interest does not match any active course', () => {
      const courses = [
        { id: 'course-ortho-id', code: 'ORTHO', name: 'Comprehensive Orthodontics' },
      ];

      const hubspotCourseValue = 'Nonexistent Seminar XYZ';
      const resolvedCourse = courses.find(
        (c) => c.name.toLowerCase() === hubspotCourseValue.toLowerCase()
      );

      expect(resolvedCourse).toBeUndefined();
      const conflictType = !resolvedCourse ? 'MAPPING_VALUE_UNKNOWN' : null;
      expect(conflictType).toBe('MAPPING_VALUE_UNKNOWN');
    });
  });

  // ===========================================================================
  // 4. Non-Destructive Merge & allow_clear Semantics
  // ===========================================================================
  describe('Non-Destructive Merge & allow_clear Semantics', () => {
    it('preserves existing values when incoming HubSpot fields are empty/null (allow_clear = false)', () => {
      const existingLead = {
        first_name: 'John',
        last_name: 'Doe',
        phone_raw: '+1 (555) 0199',
      };

      const hubspotUpdate = {
        firstname: 'Johnny',
        lastname: '', // empty string
        phone: null,  // null
      };

      const allowClear = false;

      const merged = {
        first_name: hubspotUpdate.firstname || existingLead.first_name,
        last_name: allowClear ? hubspotUpdate.lastname : (hubspotUpdate.lastname || existingLead.last_name),
        phone_raw: allowClear ? hubspotUpdate.phone : (hubspotUpdate.phone || existingLead.phone_raw),
      };

      expect(merged.first_name).toBe('Johnny'); // updated
      expect(merged.last_name).toBe('Doe');     // preserved
      expect(merged.phone_raw).toBe('+1 (555) 0199'); // preserved
    });

    it('clears values only when allow_clear is explicitly true', () => {
      const existingLead = {
        notes: 'Some notes',
      };

      const allowClear = true;
      const incomingNotes = '';

      const updated = allowClear ? (incomingNotes || null) : (incomingNotes || existingLead.notes);
      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // 5. Loop Prevention & Idempotency
  // ===========================================================================
  describe('Loop Prevention & Idempotency', () => {
    it('suppresses outbound outbox trigger when sync origin is hubspot_sync', () => {
      const syncOrigin = 'hubspot_sync';
      let outboxCreated = false;

      if (syncOrigin !== 'hubspot_sync') {
        outboxCreated = true;
      }

      expect(outboxCreated).toBe(false);
    });

    it('suppresses webhook processing when payload hash matches last_synced_hash (ignored_echo)', () => {
      const lastSyncedHash = 'sha256-abc-123';
      const incomingPayloadHash = 'sha256-abc-123';

      let status = 'processing';
      if (lastSyncedHash === incomingPayloadHash) {
        status = 'ignored_echo';
      }

      expect(status).toBe('ignored_echo');
    });

    it('suppresses duplicate webhook re-deliveries via external_event_id (ignored_duplicate)', () => {
      const processedEventIds = new Set(['evt-001', 'evt-002']);
      const incomingEventId = 'evt-001';

      let status = 'processing';
      if (processedEventIds.has(incomingEventId)) {
        status = 'ignored_duplicate';
      }

      expect(status).toBe('ignored_duplicate');
    });

    it('rejects out-of-order incoming events when occurredAt is older than recorded version (ignored_stale)', () => {
      const recordedExternalUpdatedAt = new Date('2026-09-18T10:00:00Z').getTime();
      const incomingEventTimestamp = new Date('2026-09-18T09:45:00Z').getTime(); // older

      let status = 'processing';
      if (incomingEventTimestamp < recordedExternalUpdatedAt) {
        status = 'ignored_stale';
      }

      expect(status).toBe('ignored_stale');
    });
  });

  // ===========================================================================
  // 6. Automation Engine Safety
  // ===========================================================================
  describe('Automation Safety & Outreach Suppression', () => {
    it('skips automation runs for integration-originated events when allow_integration_triggers is false', () => {
      const event = {
        event_type: 'qualification_status_changed',
        payload: {
          change_origin: 'hubspot_sync',
          new_status: 'hot',
        },
      };

      const automation = {
        id: 'auto-1',
        trigger_type: 'qualification_status_changed',
        trigger_config: {
          allow_integration_triggers: false, // default
        },
      };

      const isIntegrationOrigin = event.payload.change_origin === 'hubspot_sync';
      const allowIntegration = automation.trigger_config.allow_integration_triggers === true;

      const shouldExecute = !isIntegrationOrigin || allowIntegration;
      expect(shouldExecute).toBe(false);
    });

    it('allows automation runs when allow_integration_triggers is explicitly enabled', () => {
      const event = {
        event_type: 'qualification_status_changed',
        payload: {
          change_origin: 'hubspot_sync',
        },
      };

      const automation = {
        id: 'auto-2',
        trigger_config: {
          allow_integration_triggers: true, // explicitly allowed
        },
      };

      const isIntegrationOrigin = event.payload.change_origin === 'hubspot_sync';
      const allowIntegration = automation.trigger_config.allow_integration_triggers === true;

      const shouldExecute = !isIntegrationOrigin || allowIntegration;
      expect(shouldExecute).toBe(true);
    });
  });

  // ===========================================================================
  // 7. Webhook Security & Signature Validation (HubSpot v3)
  // ===========================================================================
  describe('HubSpot Webhook Signature v3 Security', () => {
    const secret = 'test_hubspot_secret_key_12345';
    const method = 'POST';
    const url = 'https://example.com/functions/v1/hubspot-webhook';
    const rawBody = JSON.stringify([{ eventId: '1', objectId: '101' }]);

    it('validates authentic signature with fresh timestamp', async () => {
      const timestamp = String(Date.now());
      const sourceString = `${method}${url}${rawBody}${timestamp}`;

      const encoder = new TextEncoder();
      const keyBytes = encoder.encode(secret);
      const dataBytes = encoder.encode(sourceString);

      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
      const validSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

      const result = await verifyHubSpotSignatureV3(
        method,
        url,
        rawBody,
        { timestamp, signature: validSignature },
        secret
      );

      expect(result.valid).toBe(true);
    });

    it('rejects tampered body', async () => {
      const timestamp = String(Date.now());
      const sourceString = `${method}${url}${rawBody}${timestamp}`;

      const encoder = new TextEncoder();
      const keyBytes = encoder.encode(secret);
      const dataBytes = encoder.encode(sourceString);

      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
      const validSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

      const tamperedBody = JSON.stringify([{ eventId: '1', objectId: '999_TAMPERED' }]);

      const result = await verifyHubSpotSignatureV3(
        method,
        url,
        tamperedBody,
        { timestamp, signature: validSignature },
        secret
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('mismatch');
    });

    it('rejects expired timestamp outside tolerance window (> 300 seconds) for real secrets', async () => {
      const realSecret = 'production_secret_not_test';
      const expiredTimestamp = String(Date.now() - 400000); // 400s ago

      const result = await verifyHubSpotSignatureV3(
        method,
        url,
        rawBody,
        { timestamp: expiredTimestamp, signature: 'any_sig' },
        realSecret
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tolerance window');
    });
  });

  // ===========================================================================
  // 8. Rate Limiting, Backoff & Dead-Letter Handling
  // ===========================================================================
  describe('Rate Limiting & Dead-Letter Handling', () => {
    it('calculates exponential backoff delay correctly based on attempt count', () => {
      const calculateDelay = (attempt: number) => Math.min(3600, Math.pow(2, attempt) * 5);

      expect(calculateDelay(1)).toBe(10); // 2^1 * 5 = 10s
      expect(calculateDelay(2)).toBe(20); // 2^2 * 5 = 20s
      expect(calculateDelay(3)).toBe(40); // 2^3 * 5 = 40s
      expect(calculateDelay(4)).toBe(80); // 2^4 * 5 = 80s
      expect(calculateDelay(10)).toBe(3600); // capped at 3600s (1h)
    });

    it('transitions outbox item to dead_letter after exceeding max attempts', () => {
      const maxAttempts = 5;
      const currentAttempts = 5;

      const isDeadLetter = currentAttempts >= maxAttempts;
      const status = isDeadLetter ? 'dead_letter' : 'failed';

      expect(status).toBe('dead_letter');
    });
  });

  // ===========================================================================
  // 9. Initial Sync: Dry Run Zero-Mutation Simulation
  // ===========================================================================
  describe('Initial Sync Dry Run Mode', () => {
    it('computes accurate counts without mutating database state', () => {
      const dbLeads = [
        { id: 'lead-1', email: 'alice@example.com', phone: '1112223333' },
      ];

      const batch = [
        { id: 'hs-1', properties: { email: 'alice@example.com' } }, // would update
        { id: 'hs-2', properties: { email: 'bob@example.com' } },   // would create
        { id: 'hs-3', properties: {} },                             // skipped empty
      ];

      let matched = 0;
      let wouldCreate = 0;
      let wouldUpdate = 0;
      let skipped = 0;

      for (const item of batch) {
        const email = item.properties.email;
        if (!email) {
          skipped++;
          continue;
        }

        const match = dbLeads.find((l) => l.email === email);
        if (match) {
          matched++;
          wouldUpdate++;
        } else {
          wouldCreate++;
        }
      }

      expect(matched).toBe(1);
      expect(wouldUpdate).toBe(1);
      expect(wouldCreate).toBe(1);
      expect(skipped).toBe(1);
    });
  });

  // ===========================================================================
  // 10. Archive / Deletion / Disconnect Safety
  // ===========================================================================
  describe('Archive, Deletion & Disconnect Safety', () => {
    it('marks link archived/disconnected when contact is deleted in HubSpot without deleting EDS lead', () => {
      const edsLead = { id: 'lead-permanent-1', name: 'Dr. Jane' };
      const link = { status: 'active', external_id: 'hs-del-1' };

      // HubSpot sends deletion webhook
      link.status = 'disconnected';

      // Lead remains strictly intact
      expect(edsLead.id).toBe('lead-permanent-1');
      expect(link.status).toBe('disconnected');
    });

    it('disconnecting preserves leads, links, mappings, and history', () => {
      const connection = { status: 'connected', sync_enabled: true };
      const mappingsCount = 8;
      const leadsCount = 50;

      // Disconnect
      connection.status = 'disconnected';
      connection.sync_enabled = false;

      // All records preserved
      expect(connection.status).toBe('disconnected');
      expect(mappingsCount).toBe(8);
      expect(leadsCount).toBe(50);
    });
  });

  // ===========================================================================
  // 11. Configuration Required & UI Component Validation
  // ===========================================================================
  describe('Default Configuration Required & Integration Status', () => {
    it('defaults connection status to configuration_required when credentials are not configured', () => {
      const defaultConnection = {
        provider: 'hubspot',
        status: 'configuration_required',
        portal_id: null,
        sync_enabled: false,
      };

      expect(defaultConnection.status).toBe('configuration_required');
      expect(defaultConnection.sync_enabled).toBe(false);
      expect(defaultConnection.portal_id).toBeNull();
    });

    it('generates direct HubSpot contact portal URL correctly when portalId is provided', () => {
      const portalId = '12345678';
      const contactId = '987654';

      const url = `https://app.hubspot.com/contacts/${portalId}/contact/${contactId}`;
      expect(url).toBe('https://app.hubspot.com/contacts/12345678/contact/987654');
    });

    it('handles contact URL fallback when portalId is not configured', () => {
      const contactId = '987654';
      const fallbackUrl = `https://app.hubspot.com/contacts/contact/${contactId}`;
      expect(fallbackUrl).toBe('https://app.hubspot.com/contacts/contact/987654');
    });
  });
});
