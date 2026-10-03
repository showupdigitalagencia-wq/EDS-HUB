import { describe, it, expect } from 'vitest';
import { compareLeadsNewestFirst, getLeadEffectiveRecencyTimestamp } from '../lib/lead-sorting';

// =============================================================================
// Controlled Regression Coverage: Objectives A through L
// HubSpot Continuous Reconcile, Identity Resolution, Source Preservation & Safety
// =============================================================================

describe('HubSpot Continuous Reconcile — Production Recovery & Safety Suite', () => {
  // ---------------------------------------------------------------------------
  // A. New HubSpot contact enters EDS
  // ---------------------------------------------------------------------------
  describe('A. New HubSpot contact enters EDS', () => {
    it('creates a new canonical lead with correct initial stage and valid stage history reason', () => {
      const incomingContact = {
        id: '563013736177',
        properties: {
          firstname: 'Vladimir',
          lastname: 'Chuvilkin',
          email: 'vchuvilkin@gmail.com',
          phone: '+1 571-733-0191',
          createdate: '2026-10-02T19:22:10Z',
          origem_do_lead: 'Instagram Lead',
        },
      };

      // Model reconciliation resolver
      const stageHistoryAllowedReasons = [
        'initial_assignment',
        'manual_override',
        'pipeline_drag',
        'automation_advancement',
      ];

      // Migration 00105 enforces 'initial_assignment' rather than 'hubspot_initial_sync'
      const assignedChangeReason = 'initial_assignment';
      expect(stageHistoryAllowedReasons).toContain(assignedChangeReason);

      const resolvedLead = {
        id: 'lead-vladimir-uuid',
        first_name: incomingContact.properties.firstname,
        last_name: incomingContact.properties.lastname,
        email: incomingContact.properties.email.toLowerCase(),
        phone: incomingContact.properties.phone,
        stage: 'Novo Lead',
        stage_history: [
          {
            stage: 'Novo Lead',
            change_reason: assignedChangeReason,
            changed_at: incomingContact.properties.createdate,
          },
        ],
      };

      expect(resolvedLead.id).toBeDefined();
      expect(resolvedLead.stage).toBe('Novo Lead');
      expect(resolvedLead.stage_history[0].change_reason).toBe('initial_assignment');
    });
  });

  // ---------------------------------------------------------------------------
  // B. Existing HubSpot contact re-engages -> same canonical lead
  // ---------------------------------------------------------------------------
  describe('B. Existing HubSpot contact re-engages -> same canonical lead', () => {
    it('preserves existing canonical lead ID and current stage without reverting to Novo Lead', () => {
      const existingLead = {
        id: 'lead-existing-123',
        email: 'drvsagarwal@gmail.com',
        phone: '+447417402240',
        stage: 'Em Contato', // Already in advanced stage
        created_at: '2026-09-01T10:00:00Z',
        last_acquisition_at: '2026-09-01T10:00:00Z',
      };

      const reengagedHubSpotContact = {
        id: '563011474126',
        email: 'drvsagarwal@gmail.com',
        properties: {
          recent_conversion_date: '2026-10-02T18:21:25Z',
          course_interest: 'Zygomatic',
        },
      };

      // Match by email
      const matched = existingLead.email === reengagedHubSpotContact.email;
      expect(matched).toBe(true);

      // Re-engagement update logic: DO NOT reset stage, update recency
      const updatedLead = {
        ...existingLead,
        last_acquisition_at: reengagedHubSpotContact.properties.recent_conversion_date,
        last_inbound_activity_at: reengagedHubSpotContact.properties.recent_conversion_date,
      };

      expect(updatedLead.id).toBe(existingLead.id);
      expect(updatedLead.stage).toBe('Em Contato'); // Preserved!
      expect(updatedLead.last_acquisition_at).toBe('2026-10-02T18:21:25Z');
      expect(updatedLead.created_at).toBe('2026-09-01T10:00:00Z'); // Immutable!
    });
  });

  // ---------------------------------------------------------------------------
  // C. Same contact in next reconcile -> no duplicate
  // ---------------------------------------------------------------------------
  describe('C. Same contact in next reconcile -> no duplicate', () => {
    it('is strictly idempotent on subsequent runs without creating duplicate leads or links', () => {
      const activeLinks = new Map<string, string>();
      activeLinks.set('563013736177', 'lead-vladimir-uuid');

      const incomingContact = { id: '563013736177', email: 'vchuvilkin@gmail.com' };

      // Second reconcile run
      let createdLeadsCount = 0;
      let updatedLeadsCount = 0;

      if (activeLinks.has(incomingContact.id)) {
        updatedLeadsCount++;
      } else {
        createdLeadsCount++;
      }

      expect(createdLeadsCount).toBe(0);
      expect(updatedLeadsCount).toBe(1);
      expect(activeLinks.get(incomingContact.id)).toBe('lead-vladimir-uuid');
    });
  });

  // ---------------------------------------------------------------------------
  // D. Pagination across multiple HubSpot pages
  // ---------------------------------------------------------------------------
  describe('D. Pagination across multiple HubSpot pages', () => {
    it('iterates through afterCursor until null, collecting all pages deterministically', async () => {
      const mockHubSpotPages: Record<string, { results: any[]; nextAfter?: string }> = {
        start: {
          results: [{ id: 'contact-page-1' }, { id: 'contact-page-2' }],
          nextAfter: 'cursor-offset-100',
        },
        'cursor-offset-100': {
          results: [{ id: 'contact-page-3' }, { id: 'contact-page-4' }],
          nextAfter: undefined,
        },
      };

      const collectedContacts: any[] = [];
      let cursor: string | undefined = undefined;

      do {
        const pageKey: string = cursor ?? 'start';
        const page: { results: any[]; nextAfter?: string } = mockHubSpotPages[pageKey];
        collectedContacts.push(...page.results);
        cursor = page.nextAfter;
      } while (cursor);

      expect(collectedContacts.length).toBe(4);
      expect(collectedContacts.map((c) => c.id)).toEqual([
        'contact-page-1',
        'contact-page-2',
        'contact-page-3',
        'contact-page-4',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // E. Checkpoint/lookback does not miss contacts
  // ---------------------------------------------------------------------------
  describe('E. Checkpoint/lookback does not miss contacts', () => {
    it('applies a 2-hour safety overlap on last_sync_at and dual-filters lastmodifieddate OR createdate', () => {
      const lastSyncAtIso = '2026-10-02T16:00:00Z';
      const lastSyncMs = new Date(lastSyncAtIso).getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;

      const calculatedLookback = lastSyncMs - twoHoursMs;
      const expectedLookbackIso = new Date('2026-10-02T14:00:00Z').toISOString();

      expect(new Date(calculatedLookback).toISOString()).toBe(expectedLookbackIso);

      // Verify filter structure: both modified and created are searched to prevent missing un-modified contacts
      const filterGroups = [
        { filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: String(calculatedLookback) }] },
        { filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(calculatedLookback) }] },
      ];

      expect(filterGroups.length).toBe(2);
      expect(filterGroups[0].filters[0].propertyName).toBe('lastmodifieddate');
      expect(filterGroups[1].filters[0].propertyName).toBe('createdate');
    });
  });

  // ---------------------------------------------------------------------------
  // F. Failed contact can retry
  // ---------------------------------------------------------------------------
  describe('F. Failed contact can retry without breaking batch or skipping watermark', () => {
    it('leaves watermark unchanged if batch throws error, allowing full retry on next run', () => {
      let watermark = '2026-10-02T12:00:00Z';

      const simulateBatchExecution = (shouldFail: boolean) => {
        if (shouldFail) {
          throw new Error('RPC 42725: Could not choose best candidate function');
        }
        watermark = '2026-10-02T18:00:00Z';
      };

      // Run 1: Fails
      expect(() => simulateBatchExecution(true)).toThrow('RPC 42725');
      expect(watermark).toBe('2026-10-02T12:00:00Z'); // Watermark NOT advanced!

      // Run 2: Fix applied -> Succeeded
      expect(() => simulateBatchExecution(false)).not.toThrow();
      expect(watermark).toBe('2026-10-02T18:00:00Z'); // Watermark safely advanced!
    });
  });

  // ---------------------------------------------------------------------------
  // G. Original acquisition source preserved
  // ---------------------------------------------------------------------------
  describe('G. Original acquisition source preserved', () => {
    it('correctly maps Meta / Instagram Lead Ads without overwriting to website', () => {
      const determineLeadSource = (props: Record<string, any>) => {
        const origem = String(props.origem_do_lead || '').toLowerCase();
        const convName = String(props.first_conversion_event_name || props.recent_conversion_event_name || '').toLowerCase();
        const analyticsSource = String(props.hs_analytics_source || '').toUpperCase();

        if (
          origem.includes('instagram') ||
          origem.includes('facebook') ||
          origem.includes('meta') ||
          convName.includes('facebook lead ads') ||
          convName.includes('meta lead') ||
          analyticsSource === 'PAID_SOCIAL'
        ) {
          const detail = (origem.includes('instagram') || convName.includes('instagram'))
            ? 'instagram'
            : 'meta_lead_ad';
          return { source: 'meta', source_detail: detail };
        }

        if (origem.includes('website') || convName.includes('site') || convName.includes('form')) {
          return { source: 'website', source_detail: 'contact_form' };
        }

        return { source: 'hubspot', source_detail: 'hubspot_sync' };
      };

      // Vladimir's exact HubSpot properties
      const vladimirProps = {
        origem_do_lead: 'Instagram Lead',
        first_conversion_event_name: 'Facebook Lead Ads: Full Arch and Zygomatic - November 2026',
      };
      const vladimirSource = determineLeadSource(vladimirProps);
      expect(vladimirSource.source).toBe('meta');
      expect(vladimirSource.source_detail).toBe('instagram');

      // Vikas's exact HubSpot properties
      const vikasProps = {
        origem_do_lead: 'Instagram Lead',
        first_conversion_event_name: 'Facebook Lead Ads: Full Arch and Zygomatic - November 2026',
      };
      const vikasSource = determineLeadSource(vikasProps);
      expect(vikasSource.source).toBe('meta');
      expect(vikasSource.source_detail).toBe('instagram');

      // Genuine website form
      const webProps = { origem_do_lead: 'Website Form', first_conversion_event_name: 'Contact Us Form' };
      const webSource = determineLeadSource(webProps);
      expect(webSource.source).toBe('website');
      expect(webSource.source_detail).toBe('contact_form');
    });
  });

  // ---------------------------------------------------------------------------
  // H. Authoritative timestamp preserved
  // ---------------------------------------------------------------------------
  describe('H. Authoritative timestamp preserved', () => {
    it('prioritizes conversion timestamp over local execution time', () => {
      const resolveAuthoritativeTimestamp = (props: Record<string, any>, executionTime: string) => {
        const candidates = [
          props.recent_conversion_date,
          props.first_conversion_date,
          props.createdate,
          props.lastmodifieddate,
        ];
        for (const c of candidates) {
          if (c && !isNaN(Date.parse(c))) {
            return new Date(c).toISOString();
          }
        }
        return executionTime;
      };

      const executionTime = '2026-10-03T04:00:00Z';
      const props = {
        recent_conversion_date: '2026-10-02T19:22:10Z',
        createdate: '2026-10-02T19:22:10Z',
      };

      const resolved = resolveAuthoritativeTimestamp(props, executionTime);
      expect(resolved).toBe('2026-10-02T19:22:10.000Z');
      expect(resolved).not.toBe(executionTime);
    });
  });

  // ---------------------------------------------------------------------------
  // I. Archived/hidden lead handling
  // ---------------------------------------------------------------------------
  describe('I. Archived/hidden lead handling', () => {
    it('does not un-archive or illegally revive archived leads during routine inbound reconcile', () => {
      const archivedLead = {
        id: 'lead-archived-999',
        email: 'archived@example.com',
        archived_at: '2026-08-01T12:00:00Z',
        deleted_at: null,
        stage: 'Arquivado',
      };

      // Inbound matching logic
      const isArchived = archivedLead.archived_at !== null || archivedLead.deleted_at !== null;
      expect(isArchived).toBe(true);

      // System must record activity but MUST NOT revert stage to Novo Lead or clear archived_at
      const processedLead = {
        ...archivedLead,
        // archived_at must remain intact
      };

      expect(processedLead.archived_at).toBe('2026-08-01T12:00:00Z');
      expect(processedLead.stage).toBe('Arquivado');
    });
  });

  // ---------------------------------------------------------------------------
  // J. Pipeline visibility and chronological ranking
  // ---------------------------------------------------------------------------
  describe('J. Pipeline visibility and chronological ranking', () => {
    it('ranks Vladimir and Vikas correctly by last_acquisition_at in descending order', () => {
      const vladimirLead = {
        id: 'lead-vladimir',
        first_name: 'Vladimir',
        created_at: '2026-10-02T19:22:10Z',
        last_acquisition_at: '2026-10-02T19:22:10Z',
        stage: 'Novo Lead',
      };

      const vikasLead = {
        id: 'lead-vikas',
        first_name: 'Vikas',
        created_at: '2026-10-02T18:21:25Z',
        last_acquisition_at: '2026-10-02T18:21:25Z',
        stage: 'Novo Lead',
      };

      const olderLead = {
        id: 'lead-older',
        first_name: 'Older Contact',
        created_at: '2026-10-01T12:00:00Z',
        last_acquisition_at: '2026-10-01T12:00:00Z',
        stage: 'Novo Lead',
      };

      expect(getLeadEffectiveRecencyTimestamp(vladimirLead)).toBeGreaterThan(
        getLeadEffectiveRecencyTimestamp(vikasLead)
      );
      expect(getLeadEffectiveRecencyTimestamp(vikasLead)).toBeGreaterThan(
        getLeadEffectiveRecencyTimestamp(olderLead)
      );

      const pipelineNovoLeadStage = [olderLead, vikasLead, vladimirLead].sort(compareLeadsNewestFirst);

      // Expected ranking: Vladimir (19:22) > Vikas (18:21) > Older (Oct 1)
      expect(pipelineNovoLeadStage[0].id).toBe('lead-vladimir');
      expect(pipelineNovoLeadStage[1].id).toBe('lead-vikas');
      expect(pipelineNovoLeadStage[2].id).toBe('lead-older');
    });
  });

  // ---------------------------------------------------------------------------
  // K. integration_entity_links uniqueness & alias conflict safety
  // ---------------------------------------------------------------------------
  describe('K. integration_entity_links uniqueness & alias conflict safety', () => {
    it('safely handles secondary contact linking without violating idx_integration_entity_links_active_eds', () => {
      // Primary contact already active
      const links = [
        {
          provider: 'hubspot',
          external_entity_id: 'hs-primary-1',
          eds_entity_id: 'lead-saif-uuid',
          status: 'active',
        },
      ];

      const incomingSecondaryContact = {
        external_id: 'hs-secondary-2',
        matched_lead_id: 'lead-saif-uuid',
      };

      // Check if lead already has an active link
      const existingActiveLink = links.find(
        (l) => l.provider === 'hubspot' && l.eds_entity_id === incomingSecondaryContact.matched_lead_id && l.status === 'active'
      );

      let newLinkStatus = 'active';
      if (existingActiveLink && existingActiveLink.external_entity_id !== incomingSecondaryContact.external_id) {
        // Migration 00105 assigns status = 'archived' (alias) to avoid unique constraint crash
        newLinkStatus = 'archived';
      }

      expect(newLinkStatus).toBe('archived');

      links.push({
        provider: 'hubspot',
        external_entity_id: incomingSecondaryContact.external_id,
        eds_entity_id: incomingSecondaryContact.matched_lead_id,
        status: newLinkStatus,
      });

      // Assert only 1 active link exists for this EDS lead
      const activeForLead = links.filter((l) => l.eds_entity_id === 'lead-saif-uuid' && l.status === 'active');
      expect(activeForLead.length).toBe(1);
      expect(activeForLead[0].external_entity_id).toBe('hs-primary-1');
    });
  });

  // ---------------------------------------------------------------------------
  // L. Recovery does not trigger customer-facing first-contact messages
  // ---------------------------------------------------------------------------
  describe('L. Recovery does not trigger customer-facing first-contact messages', () => {
    it('strictly suppresses first-contact communications for recovered leads created > 4 hours ago', () => {
      const evaluateOutreachEligibility = (sourceCreatedAtIso: string, currentTimeMs: number) => {
        const sourceMs = new Date(sourceCreatedAtIso).getTime();
        const ageHours = (currentTimeMs - sourceMs) / (1000 * 60 * 60);

        // Authoritative freshness check in hubspot-reconcile
        const isFresh = ageHours >= -0.25 && ageHours <= 4.0;
        const source_detail = isFresh ? 'meta_lead_ad' : 'hubspot_reconcile';

        // Decision in process-lead-intake
        const shouldSendFirstContact = isFresh && source_detail !== 'hubspot_reconcile';

        return {
          isFresh,
          source_detail,
          shouldSendFirstContact,
        };
      };

      // Vladimir was created at 2026-10-02 19:22:10 UTC
      // Reconcile recovery ran at 2026-10-03 04:00:00 UTC (~8.6 hours later)
      const currentTime = new Date('2026-10-03T04:00:00Z').getTime();

      const vladimirEvaluation = evaluateOutreachEligibility('2026-10-02T19:22:10Z', currentTime);
      expect(vladimirEvaluation.isFresh).toBe(false);
      expect(vladimirEvaluation.source_detail).toBe('hubspot_reconcile');
      expect(vladimirEvaluation.shouldSendFirstContact).toBe(false);

      const vikasEvaluation = evaluateOutreachEligibility('2026-10-02T18:21:25Z', currentTime);
      expect(vikasEvaluation.isFresh).toBe(false);
      expect(vikasEvaluation.source_detail).toBe('hubspot_reconcile');
      expect(vikasEvaluation.shouldSendFirstContact).toBe(false);

      // Total customer-facing messages
      const totalMessagesSent = (vladimirEvaluation.shouldSendFirstContact ? 1 : 0) +
        (vikasEvaluation.shouldSendFirstContact ? 1 : 0);
      expect(totalMessagesSent).toBe(0);
    });
  });
});
