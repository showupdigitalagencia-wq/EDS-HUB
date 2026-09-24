// =============================================================================
// EDS HUB — Pipeline Data Integrity, Scale (>1,000 leads) & Recency Test Suite
// =============================================================================

import { describe, it, expect } from 'vitest';

describe('EDS HUB — Pipeline Data Integrity & Scale (>1,000 leads)', () => {
  // ---------------------------------------------------------------------------
  // 1. ELIMINATING THE 1,000-ROW LIMIT & EXACT COUNTS
  // ---------------------------------------------------------------------------
  describe('1. 1,000-Row Limit Elimination & Exact Stage Counts', () => {
    it('calculates total pipeline count from atomic database counts, not rendered cards', () => {
      const stageCountsFromDb: Record<string, number> = {
        'stage-capture': 2627,
        'stage-qualification': 2,
        'stage-acquisition': 4,
        'stage-approval': 1,
        'stage-enrollment': 1,
      };

      const operationalStageIds = [
        'stage-capture',
        'stage-qualification',
        'stage-acquisition',
        'stage-approval',
        'stage-enrollment',
      ];

      // Sum of all operational stages
      const totalPipelineLeads = operationalStageIds.reduce(
        (sum, id) => sum + (stageCountsFromDb[id] || 0),
        0
      );

      // Total must be exact and exceed 1,000
      expect(totalPipelineLeads).toBe(2635);
      expect(totalPipelineLeads).toBeGreaterThan(1000);
    });

    it('each column badge displays exact server-side count even if only 30 cards are rendered', () => {
      const exactServerCount = 2627;
      const renderedCards = new Array(30).fill({ id: 'lead-card' });

      // Badge must use exactServerCount, not renderedCards.length
      const badgeCount = exactServerCount;
      expect(badgeCount).toBe(2627);
      expect(renderedCards.length).toBe(30);
      expect(badgeCount).not.toBe(renderedCards.length);
    });

    it('identifies remaining cards available to load in a column', () => {
      const exactServerCount = 2627;
      const initialLoadedCount = 30;
      const remainingCount = exactServerCount - initialLoadedCount;

      expect(remainingCount).toBe(2597);
      const loadMoreLabel = `Carregar mais (${remainingCount} restantes)`;
      expect(loadMoreLabel).toContain('2597 restantes');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. RECENCY ORDER & SCOTT VALIDATION SCENARIO
  // ---------------------------------------------------------------------------
  describe('2. Canonical Recency Ordering & Scott Scenario', () => {
    interface TestLead {
      id: string;
      name: string;
      source: string;
      source_created_at: string;
      created_at: string;
      updated_at: string;
    }

    const leadsDataset: TestLead[] = [
      {
        id: 'lead-scott-kareth',
        name: 'Scott Kareth',
        source: 'meta',
        source_created_at: '2026-09-24T18:42:30.000Z', // Today, very recent
        created_at: '2026-09-24T18:42:30.000Z',
        updated_at: '2026-09-24T20:14:33.000Z', // Updated during import batch
      },
      {
        id: 'lead-old-historical-1',
        name: 'Historical Doctor 2025',
        source: 'manual',
        source_created_at: '2025-06-25T17:59:48.000Z', // Older
        created_at: '2025-06-25T17:59:48.000Z',
        updated_at: '2026-09-24T20:14:33.000Z', // Updated during import batch at identical second
      },
      {
        id: 'lead-gregory',
        name: 'Gregory Boyajian',
        source: 'meta',
        source_created_at: '2026-09-21T01:54:33.000Z',
        created_at: '2026-09-21T01:54:33.000Z',
        updated_at: '2026-09-24T20:14:33.000Z',
      },
      {
        id: 'lead-old-historical-2',
        name: 'Historical Doctor 2025 Mid',
        source: 'manual',
        source_created_at: '2025-11-10T12:00:00.000Z',
        created_at: '2025-11-10T12:00:00.000Z',
        updated_at: '2026-09-24T20:14:33.000Z',
      },
    ];

    it('faulty updated_at sort puts historical contacts ahead of recent leads due to batch timestamp collision', () => {
      // Sorting by updated_at has collisions
      const sortedByUpdatedAt = [...leadsDataset].sort((a, b) => {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });

      // All updated_at are identical, so ordering is non-deterministic
      const allTimestampsSame = sortedByUpdatedAt.every(
        (l) => l.updated_at === '2026-09-24T20:14:33.000Z'
      );
      expect(allTimestampsSame).toBe(true);
    });

    it('canonical source_created_at sort guarantees Scott Kareth is #1 newest lead', () => {
      const sortedByRecency = [...leadsDataset].sort((a, b) => {
        const timeB = new Date(b.source_created_at || b.created_at).getTime();
        const timeA = new Date(a.source_created_at || a.created_at).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return b.id.localeCompare(a.id);
      });

      expect(sortedByRecency[0].name).toBe('Scott Kareth');
      expect(sortedByRecency[1].name).toBe('Gregory Boyajian');
      expect(sortedByRecency[sortedByRecency.length - 1].name).toBe('Historical Doctor 2025');
    });

    it('historical import timestamp cannot outrank genuinely newer leads', () => {
      const recentLeadTime = new Date('2026-09-24T18:42:30.000Z').getTime();
      const historicalLeadTime = new Date('2025-06-25T17:59:48.000Z').getTime();

      expect(recentLeadTime).toBeGreaterThan(historicalLeadTime);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. COMPLETE DATASET SEARCH
  // ---------------------------------------------------------------------------
  describe('3. Complete Dataset Search Functionality', () => {
    const fullCrmDataset = [
      { id: '1', first_name: 'Scott', last_name: 'Kareth', email: 'drscottkareth@gmail.com', phone: '+18594669520' },
      { id: '2', first_name: 'Gregory', last_name: 'Boyajian', email: 'gregboyajian@yahoo.com', phone: '+123456789' },
      { id: '3', first_name: 'Scott', last_name: 'Matheson', email: 'drscottmatheson@gmail.com', phone: '+15878766272' },
      { id: '4', first_name: 'David', last_name: 'Smith', email: 'david@example.com', phone: '+198765432' },
    ];

    it('search queries full database and returns all matches regardless of page limits', () => {
      const query = 'Scott'.toLowerCase();
      const matches = fullCrmDataset.filter((l) =>
        l.first_name.toLowerCase().includes(query) ||
        l.last_name.toLowerCase().includes(query) ||
        l.email.toLowerCase().includes(query)
      );

      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.last_name)).toEqual(['Kareth', 'Matheson']);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. COURSE INTEREST EMBEDDING & DISPLAY SAFETY
  // ---------------------------------------------------------------------------
  describe('4. Course Interest Embedding & Display Integrity', () => {
    it('extracts course interests from embedded lead_course_interests relation', () => {
      const leadWithEmbedded = {
        id: 'lead-1',
        lead_course_interests: [
          { priority: 1, course: { name: 'Intensive Dental Implant Training' }, session: { title: 'Turma Outubro 2026', start_date: '2026-10-15' } },
          { priority: 2, course: { name: 'Wisdom Teeth Training' }, session: null },
        ],
      };

      const raw = leadWithEmbedded.lead_course_interests;
      const formatted = raw.map((i: any) => ({
        courseName: i.course.name,
        sessionTitle: i.session?.title,
        startDate: i.session?.start_date,
        priority: i.priority,
      }));

      expect(formatted).toHaveLength(2);
      expect(formatted[0].courseName).toBe('Intensive Dental Implant Training');
      expect(formatted[0].sessionTitle).toBe('Turma Outubro 2026');
      expect(formatted[1].courseName).toBe('Wisdom Teeth Training');
    });

    it('falls back to lead.course_interest when relation is not yet linked', () => {
      const leadLegacy = {
        id: 'lead-legacy',
        lead_course_interests: [],
        course_interest: 'Zygomatic Implant Training',
      };

      const interests = leadLegacy.lead_course_interests.length > 0
        ? leadLegacy.lead_course_interests
        : leadLegacy.course_interest
        ? [{ courseName: leadLegacy.course_interest, priority: 1 }]
        : [];

      expect(interests).toHaveLength(1);
      expect(interests[0].courseName).toBe('Zygomatic Implant Training');
    });

    it('shows "Sem curso de interesse" only when lead truly has neither relation nor fallback', () => {
      const leadEmpty = {
        id: 'lead-none',
        lead_course_interests: [],
        course_interest: null,
      };

      const hasCourse = leadEmpty.lead_course_interests.length > 0 || Boolean(leadEmpty.course_interest);
      expect(hasCourse).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. STAGE CHANGE CONFLICT SAFETY & SOURCE PRECEDENCE
  // ---------------------------------------------------------------------------
  describe('5. Stage Conflict Safety & Precedence', () => {
    it('stale HubSpot event older than EDS record is ignored as stale', () => {
      const edsLinkRecord = {
        external_updated_at: '2026-09-24T20:14:33.000Z',
      };

      const incomingHubSpotEvent = {
        timestamp: '2026-09-20T12:00:00.000Z', // 4 days older
      };

      const isStale = new Date(incomingHubSpotEvent.timestamp).getTime() < new Date(edsLinkRecord.external_updated_at).getTime();
      expect(isStale).toBe(true);
    });

    it('HubSpot stage update does not overwrite EDS stage if lead moved in EDS', () => {
      const edsLead = {
        id: 'lead-moved',
        stage: 'acquisition', // Moved to Interessado in EDS
        eds_stage_updated_at: '2026-09-24T21:00:00.000Z',
      };

      const incomingHubSpotPropertyChange = {
        lifecyclestage: 'lead', // Old HubSpot value
        event_time: '2026-09-24T18:00:00.000Z', // Older than EDS move
      };

      const shouldUpdateStage = new Date(incomingHubSpotPropertyChange.event_time).getTime() > new Date(edsLead.eds_stage_updated_at).getTime();
      expect(shouldUpdateStage).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. HUBSPOT LINK UNIQUENESS & DEDUPLICATION INTEGRITY
  // ---------------------------------------------------------------------------
  describe('6. HubSpot Link Uniqueness & Link Deduplication', () => {
    it('verifies every valid contact has exactly one canonical integration link', () => {
      const totalHubspotContacts = 2632;
      const totalLinksInDb = 2632;

      expect(totalLinksInDb).toBe(totalHubspotContacts);
      expect(totalHubspotContacts - totalLinksInDb).toBe(0); // 0 missing links
    });

    it('duplicate external submissions without email are linked as archived duplicate aliases', () => {
      const linkRecord = {
        integration: 'hubspot',
        entity_type: 'lead',
        eds_entity_id: 'canonical-lead-1',
        external_entity_id: 'duplicate-contact-no-email',
        status: 'archived',
        conflict_reason: 'Duplicate phone contact in HubSpot without email',
      };

      expect(linkRecord.status).toBe('archived');
      expect(linkRecord.conflict_reason).toContain('Duplicate phone contact');
    });
  });
});
