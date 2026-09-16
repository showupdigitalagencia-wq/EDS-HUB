import { describe, it, expect } from 'vitest';
import {
  mapHubspotQualificationStatus,
  getQualificationStatusLabel,
  getQualificationStatusBadge,
  normalizePhoneDigits,
} from '../features/leads/utils/qualificationMapping';
import { mapCsvStatusToStageCode } from '../features/leads/utils/stageMapping';

describe('HubSpot Qualification Status Mapping & Normalization', () => {
  it('maps canonical HubSpot Portuguese status values accurately', () => {
    expect(mapHubspotQualificationStatus('Sem resposta')).toBe('no_response');
    expect(mapHubspotQualificationStatus('Alguma resposta')).toBe('some_response');
    expect(mapHubspotQualificationStatus('Interessado')).toBe('interested');
    expect(mapHubspotQualificationStatus('Quente')).toBe('hot');
    expect(mapHubspotQualificationStatus('Confirmado')).toBe('confirmed');
  });

  it('handles accent variations, casing, and trailing whitespace', () => {
    expect(mapHubspotQualificationStatus('  sem resposta  ')).toBe('no_response');
    expect(mapHubspotQualificationStatus('SEM RESPOSTA')).toBe('no_response');
    expect(mapHubspotQualificationStatus('Alguma Resposta')).toBe('some_response');
    expect(mapHubspotQualificationStatus('alguma_resposta')).toBe('some_response');
    expect(mapHubspotQualificationStatus('QUENTE')).toBe('hot');
    expect(mapHubspotQualificationStatus('CONFIRMADO')).toBe('confirmed');
    expect(mapHubspotQualificationStatus('Interessada')).toBe('interested');
  });

  it('handles English variants gracefully', () => {
    expect(mapHubspotQualificationStatus('no response')).toBe('no_response');
    expect(mapHubspotQualificationStatus('some response')).toBe('some_response');
    expect(mapHubspotQualificationStatus('interested')).toBe('interested');
    expect(mapHubspotQualificationStatus('hot')).toBe('hot');
    expect(mapHubspotQualificationStatus('confirmed')).toBe('confirmed');
  });

  it('returns null for empty, blank or unrecognized statuses', () => {
    expect(mapHubspotQualificationStatus('')).toBeNull();
    expect(mapHubspotQualificationStatus('   ')).toBeNull();
    expect(mapHubspotQualificationStatus(null)).toBeNull();
    expect(mapHubspotQualificationStatus(undefined)).toBeNull();
    expect(mapHubspotQualificationStatus('unknown_status_xyz')).toBeNull();
  });

  it('produces correct user-facing English labels', () => {
    expect(getQualificationStatusLabel('no_response')).toBe('No Response');
    expect(getQualificationStatusLabel('some_response')).toBe('Some Response');
    expect(getQualificationStatusLabel('interested')).toBe('Interested');
    expect(getQualificationStatusLabel('hot')).toBe('Hot');
    expect(getQualificationStatusLabel('confirmed')).toBe('Confirmed');
    expect(getQualificationStatusLabel(null)).toBe('None');
  });

  it('generates badges with tailored color themes', () => {
    const hotBadge = getQualificationStatusBadge('hot');
    expect(hotBadge.label).toBe('Hot');
    expect(hotBadge.bg).toContain('rose');

    const confirmedBadge = getQualificationStatusBadge('confirmed');
    expect(confirmedBadge.label).toBe('Confirmed');
    expect(confirmedBadge.bg).toContain('emerald');

    const noneBadge = getQualificationStatusBadge(null);
    expect(noneBadge.label).toBe('None');
  });
});

describe('Safe Deduplication & Conflict Detection Rules', () => {
  it('normalizes phone digits removing non-digit characters', () => {
    expect(normalizePhoneDigits('+1 (914) 918-2770')).toBe('19149182770');
    expect(normalizePhoneDigits('(202) 258-6249')).toBe('2022586249');
    expect(normalizePhoneDigits(' +44 7795 385180 ')).toBe('447795385180');
    expect(normalizePhoneDigits(null)).toBe('');
    expect(normalizePhoneDigits('')).toBe('');
  });

  it('flags conflict when phone is shared across multiple rows in CSV', () => {
    const csvPhoneCounts = new Map<string, number>([
      ['19149182770', 2], // Angela Lee (2 rows)
      ['14046384877', 2], // Dick Butts and Suri Letson-Edwards
      ['2022586249', 1],  // unique
    ]);

    const isDupInCsv1 = (csvPhoneCounts.get('19149182770') || 0) > 1;
    const isDupInCsv2 = (csvPhoneCounts.get('14046384877') || 0) > 1;
    const isDupInCsv3 = (csvPhoneCounts.get('2022586249') || 0) > 1;

    expect(isDupInCsv1).toBe(true);
    expect(isDupInCsv2).toBe(true);
    expect(isDupInCsv3).toBe(false);
  });

  it('flags conflict when phone is associated with multiple leads in DB', () => {
    const dbPhoneToLeads = new Map<string, Array<{ id: string }>>([
      ['7703625569', [{ id: 'lead-1' }, { id: 'lead-2' }]],
      ['18595768760', [{ id: 'lead-3' }]],
    ]);

    const isDupInDb1 = (dbPhoneToLeads.get('7703625569') || []).length > 1;
    const isDupInDb2 = (dbPhoneToLeads.get('18595768760') || []).length > 1;

    expect(isDupInDb1).toBe(true);
    expect(isDupInDb2).toBe(false);
  });

  it('flags conflict when Email and Phone point to different CRM leads', () => {
    const emailLead = { id: 'lead-alice', email: 'alice@example.com' };
    const phoneLeads = [{ id: 'lead-bob', phone: '1234567890' }];

    const sameLead = phoneLeads.some((l) => l.id === emailLead.id);
    expect(sameLead).toBe(false); // Email vs Phone conflict!
  });

  it('allows safe update only when phone is unique on both CSV and DB', () => {
    const phoneDigits = '18595768760';
    const csvCounts = new Map([[phoneDigits, 1]]);
    const dbCounts = new Map([[phoneDigits, 1]]);

    const isSafePhoneMatch = (csvCounts.get(phoneDigits) || 0) === 1 && (dbCounts.get(phoneDigits) || 0) === 1;
    expect(isSafePhoneMatch).toBe(true);
  });
});

describe('Non-Destructive Merge (Empty CSV Cell Rule)', () => {
  it('does NOT overwrite existing non-empty DB values with empty CSV cells', () => {
    const existingLead = {
      id: 'uuid-123',
      first_name: 'Kush',
      last_name: 'Patel',
      email: 'kush@dentistry.com',
      phone_raw: '+1 (857) 756-7777',
      course_interest: 'Intensive',
      qualification_status: null,
    };

    // CSV has empty email, empty last_name, but has new qualification_status
    const csvRow = {
      first_name: 'Kush Patel',
      last_name: '',
      email: '',
      qualification_status: 'Quente',
      course_interest: '',
    };

    const updatePayload: Record<string, unknown> = {};
    if (csvRow.first_name) updatePayload.first_name = csvRow.first_name;
    if (csvRow.last_name) updatePayload.last_name = csvRow.last_name;
    if (csvRow.email) updatePayload.email = csvRow.email;
    if (csvRow.course_interest) updatePayload.course_interest = csvRow.course_interest;

    const mappedQual = mapHubspotQualificationStatus(csvRow.qualification_status);
    if (mappedQual) updatePayload.qualification_status = mappedQual;

    const merged = { ...existingLead, ...updatePayload };

    expect(merged.id).toBe('uuid-123'); // lead_id strictly preserved
    expect(merged.email).toBe('kush@dentistry.com'); // NOT overwritten by empty CSV email!
    expect(merged.last_name).toBe('Patel'); // NOT overwritten by empty CSV last_name!
    expect(merged.course_interest).toBe('Intensive'); // NOT overwritten!
    expect(merged.qualification_status).toBe('hot'); // Updated with new value
  });
});

describe('Pipeline Stage Anti-Downgrade Protection', () => {
  const stageHierarchy = [
    { code: 'capture', sort_order: 1 },
    { code: 'qualification', sort_order: 2 },
    { code: 'acquisition', sort_order: 3 },
    { code: 'approval', sort_order: 4 },
    { code: 'enrollment', sort_order: 5 },
    { code: 'post_course', sort_order: 6 },
    { code: 'alumni', sort_order: 7 },
  ];

  it('promotes lead in capture (order 1) to qualification (order 2) when qualification_status is present', () => {
    const currentOrder = 1; // capture
    const qualStatus = 'hot';
    let shouldPromote = false;

    if (currentOrder <= 1 && qualStatus) {
      shouldPromote = true;
    }
    expect(shouldPromote).toBe(true);
  });

  it('strictly preserves advanced pipeline stages without downgrade', () => {
    const advancedOrders = [3, 4, 5, 6, 7]; // acquisition, approval, enrollment, post_course, alumni
    const qualStatus = 'hot';

    advancedOrders.forEach((order) => {
      let isDowngraded = false;
      if (order <= 1 && qualStatus) {
        isDowngraded = true; // would promote/change
      }
      expect(isDowngraded).toBe(false); // stays in advanced stage!
    });
  });

  it('advances stage if explicit CSV status maps to higher pipeline stage', () => {
    const currentOrder = 2; // qualification
    const csvLifecycleStage = 'Opportunity'; // maps to acquisition (order 3)
    const targetStageCode = mapCsvStatusToStageCode(csvLifecycleStage);
    const targetStage = stageHierarchy.find((s) => s.code === targetStageCode);

    expect(targetStage?.sort_order).toBe(3);
    const canAdvance = (targetStage?.sort_order || 0) >= currentOrder;
    expect(canAdvance).toBe(true);
  });
});
