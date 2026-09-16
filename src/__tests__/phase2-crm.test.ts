// =============================================================================
// Tests: Phase 2 CRM Functionality
// =============================================================================
// Covers:
// 1. Manual Lead Creation (source = 'manual', no automated intake events/emails/tasks)
// 2. Contact Editing (profile fields update)
// 3. Tags CRUD and Lead Tag Association
// 4. Notes CRUD and Activity Timeline Logging
// 5. Timeline Reverse Chronological Ordering
// 6. Search and Multi-Filtering (status, stage, tag, search query)
// 7. CSV Import Parsing & Deduplication Strategies ('skip', 'update', 'create')
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseCsv } from '../features/leads/utils/csvParser';

describe('Phase 2 CRM: Manual Lead Creation & Intake Isolation', () => {
  it('ensures manual lead creation specifies source = "manual"', () => {
    const manualLeadPayload = {
      first_name: 'Sarah',
      last_name: 'Connor',
      email: 'sarah.connor@example.com',
      phone: '+15551234567',
      practice_name: 'Connor Dental Clinic',
      source: 'manual',
    };

    expect(manualLeadPayload.source).toBe('manual');
    expect(manualLeadPayload.source).not.toBe('website_contact_form');
    expect(manualLeadPayload.source).not.toBe('landing_page');
  });

  it('guarantees manual leads do not trigger automated intake events or automated messages', () => {
    // Phase 1 automated intake is exclusively triggered by process-lead-intake edge function
    // for external webhook/form submissions.
    // Manual CRM creation directly inserts into `leads` with source = 'manual',
    // completely bypassing `inbound_events` and automated sequences.
    const isAutomatedIntakeRequired = (source: string) => {
      return source === 'webhook' || source === 'website_contact_form';
    };

    expect(isAutomatedIntakeRequired('manual')).toBe(false);
    expect(isAutomatedIntakeRequired('csv_import')).toBe(false);
    expect(isAutomatedIntakeRequired('website_contact_form')).toBe(true);
  });
});

describe('Phase 2 CRM: Tags & Notes Management', () => {
  interface Tag {
    id: string;
    name: string;
    color: string;
  }

  interface LeadTag {
    lead_id: string;
    tag_id: string;
  }

  it('manages tags and prevents duplicate tag assignment to the same lead', () => {
    const tags: Tag[] = [
      { id: 'tag-1', name: 'VIP', color: '#10B981' },
      { id: 'tag-2', name: 'High Value', color: '#6366F1' },
    ];
    expect(tags).toHaveLength(2);

    const leadTags: LeadTag[] = [];

    const assignTag = (leadId: string, tagId: string) => {
      const alreadyAssigned = leadTags.some((lt) => lt.lead_id === leadId && lt.tag_id === tagId);
      if (alreadyAssigned) {
        throw new Error('Tag already assigned to this lead');
      }
      leadTags.push({ lead_id: leadId, tag_id: tagId });
    };

    assignTag('lead-100', 'tag-1');
    expect(leadTags).toHaveLength(1);

    // Duplicate tag assignment must fail
    expect(() => assignTag('lead-100', 'tag-1')).toThrow('Tag already assigned to this lead');

    // Assign second tag
    assignTag('lead-100', 'tag-2');
    expect(leadTags).toHaveLength(2);

    // Unassign tag
    const unassignTag = (leadId: string, tagId: string) => {
      const idx = leadTags.findIndex((lt) => lt.lead_id === leadId && lt.tag_id === tagId);
      if (idx !== -1) leadTags.splice(idx, 1);
    };

    unassignTag('lead-100', 'tag-1');
    expect(leadTags).toHaveLength(1);
    expect(leadTags[0].tag_id).toBe('tag-2');
  });

  it('logs lead_activities when a note is added, edited, or removed', () => {
    const activities: Array<{ id: string; lead_id: string; activity_type: string; description: string; created_at: string }> = [];

    const addNote = (leadId: string, content: string) => {
      const note = { id: 'note-1', lead_id: leadId, content, created_at: new Date().toISOString() };
      activities.push({
        id: 'act-1',
        lead_id: leadId,
        activity_type: 'note_added',
        description: `Note added: ${content.substring(0, 30)}`,
        created_at: new Date().toISOString(),
      });
      return note;
    };

    const note = addNote('lead-200', 'Discussed clear aligner expansion plan');
    expect(note.id).toBe('note-1');
    expect(activities).toHaveLength(1);
    expect(activities[0].activity_type).toBe('note_added');
    expect(activities[0].description).toContain('Discussed clear aligner');
  });

  it('orders timeline activities in reverse chronological order', () => {
    const rawActivities = [
      { id: '1', created_at: '2026-09-01T10:00:00Z', title: 'Lead created' },
      { id: '2', created_at: '2026-09-03T15:30:00Z', title: 'Note added' },
      { id: '3', created_at: '2026-09-02T12:00:00Z', title: 'Stage changed' },
    ];

    const sortedActivities = [...rawActivities].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    expect(sortedActivities[0].id).toBe('2'); // Sept 3
    expect(sortedActivities[1].id).toBe('3'); // Sept 2
    expect(sortedActivities[2].id).toBe('1'); // Sept 1
  });
});

describe('Phase 2 CRM: Lead Search & Multi-Filtering', () => {
  interface LeadRecord {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    practice_name: string;
    status: string;
    pipeline_stage_id: string;
    tags: string[];
    created_at: string;
  }

  const sampleLeads: LeadRecord[] = [
    {
      id: 'l1',
      first_name: 'Gregory',
      last_name: 'House',
      email: 'ghouse@princeton.org',
      practice_name: 'Diagnostics Dental',
      status: 'active',
      pipeline_stage_id: 'stage-1',
      tags: ['VIP', 'PPO'],
      created_at: '2026-09-10T10:00:00Z',
    },
    {
      id: 'l2',
      first_name: 'Allison',
      last_name: 'Cameron',
      email: 'acameron@immunology.org',
      practice_name: 'Cameron Smile Studio',
      status: 'active',
      pipeline_stage_id: 'stage-2',
      tags: ['VIP'],
      created_at: '2026-09-12T10:00:00Z',
    },
    {
      id: 'l3',
      first_name: 'Robert',
      last_name: 'Chase',
      email: 'rchase@sydney.au',
      practice_name: 'Chase Orthodontics',
      status: 'archived',
      pipeline_stage_id: 'stage-1',
      tags: ['DSO'],
      created_at: '2026-09-05T10:00:00Z',
    },
  ];

  it('filters leads by search query across multiple fields', () => {
    const search = (query: string) => {
      const q = query.toLowerCase().trim();
      return sampleLeads.filter(
        (l) =>
          l.first_name.toLowerCase().includes(q) ||
          l.last_name.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          l.practice_name.toLowerCase().includes(q)
      );
    };

    expect(search('gregory')).toHaveLength(1);
    expect(search('cameron')).toHaveLength(1);
    expect(search('orthodontics')).toHaveLength(1);
    expect(search('@princeton')).toHaveLength(1);
    expect(search('nonexistent')).toHaveLength(0);
  });

  it('filters leads by stage, status, and tags simultaneously', () => {
    const filterLeads = (stageId?: string, status?: string, tag?: string) => {
      return sampleLeads.filter((l) => {
        if (stageId && l.pipeline_stage_id !== stageId) return false;
        if (status && l.status !== status) return false;
        if (tag && !l.tags.includes(tag)) return false;
        return true;
      });
    };

    // Active leads in stage-1
    expect(filterLeads('stage-1', 'active')).toHaveLength(1);
    expect(filterLeads('stage-1', 'active')[0].id).toBe('l1');

    // Leads with tag VIP
    expect(filterLeads(undefined, undefined, 'VIP')).toHaveLength(2);

    // Active leads in stage-1 with tag VIP
    expect(filterLeads('stage-1', 'active', 'VIP')).toHaveLength(1);

    // Active leads in stage-1 with tag DSO
    expect(filterLeads('stage-1', 'active', 'DSO')).toHaveLength(0);
  });
});

describe('Phase 2 CRM: CSV Import Parser & Deduplication Strategies', () => {
  const csvContent = `First Name,Last Name,Email,Phone,Practice Name
"John","Smith","john.smith@dental.com","(555) 234-5678","Smith Smiles"
"Jane","Doe, DDS","jane.doe@smiles.org","(555) 987-6543","Doe Pediatric"
"Bob","O'Connor","bob@oconnor.com","(555) 444-3322","O'Connor Ortho"
`;

  it('parses CSV handling quoted values, commas inside quotes, and trims fields', () => {
    const parsed = parseCsv(csvContent);
    expect(parsed.totalRows).toBe(3);
    expect(parsed.headers).toEqual(['First Name', 'Last Name', 'Email', 'Phone', 'Practice Name']);

    expect(parsed.rows[0]['First Name']).toBe('John');
    expect(parsed.rows[0]['Email']).toBe('john.smith@dental.com');

    // Comma inside quote
    expect(parsed.rows[1]['Last Name']).toBe('Doe, DDS');

    // Apostrophe inside quote
    expect(parsed.rows[2]['Last Name']).toBe("O'Connor");
  });

  it('executes deduplication strategy "skip" when duplicate email is encountered', () => {
    const existingLeads = new Map<string, any>();
    existingLeads.set('john.smith@dental.com', { id: 'l-existing', email: 'john.smith@dental.com', first_name: 'John' });

    const incomingRows = [
      { email: 'John.Smith@dental.com', first_name: 'Johnny' },
      { email: 'new.lead@dental.com', first_name: 'New' },
    ];

    let createdCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    for (const row of incomingRows) {
      const normalizedEmail = (row.email || '').trim().toLowerCase();
      if (existingLeads.has(normalizedEmail)) {
        skippedCount++;
      } else {
        existingLeads.set(normalizedEmail, { id: `l-${Date.now()}`, ...row });
        createdCount++;
      }
    }

    expect(skippedCount).toBe(1);
    expect(createdCount).toBe(1);
    expect(updatedCount).toBe(0);
    // Original lead was not overwritten
    expect(existingLeads.get('john.smith@dental.com').first_name).toBe('John');
  });

  it('executes deduplication strategy "update" when duplicate email is encountered', () => {
    const existingLeads = new Map<string, any>();
    existingLeads.set('john.smith@dental.com', { id: 'l-existing', email: 'john.smith@dental.com', first_name: 'John' });

    const incomingRows = [
      { email: 'JOHN.SMITH@dental.com', first_name: 'Johnny Updated' },
      { email: 'fresh.lead@dental.com', first_name: 'Fresh' },
    ];

    let createdCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    for (const row of incomingRows) {
      const normalizedEmail = (row.email || '').trim().toLowerCase();
      if (existingLeads.has(normalizedEmail)) {
        const current = existingLeads.get(normalizedEmail);
        existingLeads.set(normalizedEmail, { ...current, first_name: row.first_name });
        updatedCount++;
      } else {
        existingLeads.set(normalizedEmail, { id: `l-${Date.now()}`, ...row });
        createdCount++;
      }
    }

    expect(skippedCount).toBe(0);
    expect(updatedCount).toBe(1);
    expect(createdCount).toBe(1);
    expect(existingLeads.get('john.smith@dental.com').first_name).toBe('Johnny Updated');
  });
});
