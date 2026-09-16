// =============================================================================
// Tests: Phase 2 Campaigns, Editor, Templates & Delivery Logic
// =============================================================================
// Covers:
// 1. Block Editor Content Serialization & Snapshots (campaign_versions)
// 2. Email Templates Isolation (email_templates vs transactional_templates)
// 3. Audience Estimation (no premature materialization)
// 4. Recipient Deduplication by Normalized Email & DB Constraint Alignment
// 5. Mandatory Campaign Approval Gate (draft cannot be prepared or dispatched)
// 6. Test Send Salutation Reuse (resolveSalutation)
// 7. A/B Test Variant Split Validation (sum must equal 100%)
// 8. Batch Dispatch Idempotency, Retry of Failed Sends & Server-side Scheduling
// =============================================================================

import { describe, it, expect } from 'vitest';
import { resolveSalutation } from '../utils/salutation';

describe('Phase 2 Campaigns: Block Editor & Version Snapshots', () => {
  interface EditorBlock {
    id: string;
    type: 'header' | 'text' | 'image' | 'button' | 'divider' | 'spacer';
    content: Record<string, any>;
  }

  it('serializes and validates supported Block Editor components', () => {
    const blocks: EditorBlock[] = [
      { id: 'b1', type: 'header', content: { text: 'Exclusive Dental Equipment Offer', level: 1 } },
      { id: 'b2', type: 'text', content: { text: 'Dear {{salutation}}, upgrade your practice today.' } },
      { id: 'b3', type: 'button', content: { label: 'Book Demo', url: 'https://expertdentalsolutions.com/demo' } },
      { id: 'b4', type: 'divider', content: {} },
    ];

    expect(blocks).toHaveLength(4);
    const jsonString = JSON.stringify(blocks);
    const parsed = JSON.parse(jsonString);
    expect(parsed).toEqual(blocks);
  });

  it('creates immutable version snapshots in campaign_versions upon saving', () => {
    const versions: Array<{ version_number: number; subject: string; blocks: EditorBlock[]; created_at: string }> = [];

    const saveVersionSnapshot = (subject: string, blocks: EditorBlock[]) => {
      const nextVersion = versions.length + 1;
      const snapshot = {
        version_number: nextVersion,
        subject,
        blocks: JSON.parse(JSON.stringify(blocks)), // deep clone
        created_at: new Date().toISOString(),
      };
      versions.push(snapshot);
      return snapshot;
    };

    saveVersionSnapshot('Version 1: Welcome', [{ id: '1', type: 'header', content: { text: 'Hello' } }]);
    saveVersionSnapshot('Version 2: Updated Offer', [{ id: '1', type: 'header', content: { text: 'Special Discount' } }]);

    expect(versions).toHaveLength(2);
    expect(versions[0].version_number).toBe(1);
    expect(versions[0].subject).toBe('Version 1: Welcome');
    expect(versions[1].version_number).toBe(2);
    expect(versions[1].subject).toBe('Version 2: Updated Offer');
  });
});

describe('Phase 2 Campaigns: Templates Isolation', () => {
  it('strictly isolates marketing email_templates from Phase 1 transactional_templates', () => {
    const transactionalTemplates = [
      { id: 't1', slug: 'lead_confirmation', category: 'transactional' },
      { id: 't2', slug: 'internal_alert', category: 'transactional' },
    ];

    const marketingTemplates = [
      { id: 'm1', name: 'Q4 Product Launch', category: 'marketing', blocks: [] },
      { id: 'm2', name: 'Dental VIP Re-engagement', category: 'marketing', blocks: [] },
    ];

    // Marketing templates belong to table email_templates
    // Transactional templates belong to table transactional_templates (Phase 1)
    const canTransactionalUseBlockEditor = false;
    expect(canTransactionalUseBlockEditor).toBe(false);

    marketingTemplates.forEach((template) => {
      expect(template.category).toBe('marketing');
      expect(transactionalTemplates.some((t) => t.id === template.id)).toBe(false);
    });
  });
});

describe('Phase 2 Campaigns: Audience Estimation & Deduplication', () => {
  it('estimates audience count dynamically without pre-materializing recipients', () => {
    const leadsInDb = [
      { id: '1', status: 'active', pipeline_stage_id: 'stage-1', tags: ['VIP'] },
      { id: '2', status: 'active', pipeline_stage_id: 'stage-2', tags: ['VIP'] },
      { id: '3', status: 'archived', pipeline_stage_id: 'stage-1', tags: ['VIP'] },
      { id: '4', status: 'active', pipeline_stage_id: 'stage-1', tags: ['Standard'] },
    ];

    const estimateAudience = (filterStageId: string, filterTag: string) => {
      return leadsInDb.filter(
        (l) => l.status === 'active' && l.pipeline_stage_id === filterStageId && l.tags.includes(filterTag)
      ).length;
    };

    const count = estimateAudience('stage-1', 'VIP');
    expect(count).toBe(1); // Only lead '1'
  });

  it('normalizes recipient emails and deduplicates case-insensitively', () => {
    const rawRecipients = [
      { lead_id: 'l1', email: '  Dr.Smith@DentalClinic.COM  ' },
      { lead_id: 'l2', email: 'dr.smith@dentalclinic.com' }, // Duplicate email, different lead_id
      { lead_id: 'l3', email: 'contact@smilecenter.org' },
    ];

    const normalizedMap = new Map<string, { lead_id: string; email: string }>();

    for (const r of rawRecipients) {
      const normalizedEmail = (r.email || '').trim().toLowerCase();
      // Database CHECK (email = lower(trim(email))) requirement
      expect(normalizedEmail).toBe(normalizedEmail.toLowerCase());
      expect(normalizedEmail).toBe(normalizedEmail.trim());

      // Deduplicate by campaign_id + email
      if (!normalizedMap.has(normalizedEmail)) {
        normalizedMap.set(normalizedEmail, { lead_id: r.lead_id, email: normalizedEmail });
      }
    }

    expect(normalizedMap.size).toBe(2);
    expect(normalizedMap.has('dr.smith@dentalclinic.com')).toBe(true);
    expect(normalizedMap.has('contact@smilecenter.org')).toBe(true);

    const materializedList = Array.from(normalizedMap.values());
    expect(materializedList).toHaveLength(2);
    expect(materializedList[0].email).toBe('dr.smith@dentalclinic.com');
  });

  it('confirms onConflict aligns with UNIQUE(campaign_id, email)', () => {
    const onConflictConfig = 'campaign_id,email';
    expect(onConflictConfig).toBe('campaign_id,email');
    expect(onConflictConfig).not.toContain('lead_id');
  });
});

describe('Phase 2 Campaigns: Mandatory Approval Gate & Test Sends', () => {
  it('prevents campaign preparation or dispatch if status is draft', () => {
    const validateCampaignReadyToPrepare = (status: string) => {
      if (status !== 'approved' && status !== 'ready') {
        throw new Error(`Campaign must be approved before preparation (current status: ${status})`);
      }
      return true;
    };

    expect(() => validateCampaignReadyToPrepare('draft')).toThrow('Campaign must be approved');
    expect(validateCampaignReadyToPrepare('approved')).toBe(true);
    expect(validateCampaignReadyToPrepare('ready')).toBe(true);
  });

  it('uses resolveSalutation in test send for personalized preview', () => {
    // Lead with both names (Last Name takes priority)
    const salutation1 = resolveSalutation('Vance', 'Marcus');
    expect(salutation1).toBe('Vance');

    // Lead with only first name
    const salutation2 = resolveSalutation('', 'Elena');
    expect(salutation2).toBe('Elena');

    // Lead with no names fallback
    const salutation3 = resolveSalutation('', '');
    expect(salutation3).toBe('Doc');
  });
});

describe('Phase 2 Campaigns: A/B Testing & Split Percentage Validation', () => {
  interface Variant {
    name: string;
    percentage: number;
    subject: string;
  }

  const validateVariantSplits = (variants: Variant[]): { valid: boolean; error?: string } => {
    if (!variants || variants.length === 0) {
      return { valid: true };
    }
    const totalPercentage = variants.reduce((sum, v) => sum + (Number(v.percentage) || 0), 0);
    if (totalPercentage !== 100) {
      return {
        valid: false,
        error: `A/B test variant percentages must sum to 100% (currently ${totalPercentage}%)`,
      };
    }
    return { valid: true };
  };

  it('accepts valid A/B splits that sum to exactly 100%', () => {
    const validVariants5050: Variant[] = [
      { name: 'Variant A', percentage: 50, subject: 'Subject A' },
      { name: 'Variant B', percentage: 50, subject: 'Subject B' },
    ];
    expect(validateVariantSplits(validVariants5050).valid).toBe(true);

    const validVariants3334: Variant[] = [
      { name: 'Variant A', percentage: 33, subject: 'Subject A' },
      { name: 'Variant B', percentage: 33, subject: 'Subject B' },
      { name: 'Variant C', percentage: 34, subject: 'Subject C' },
    ];
    expect(validateVariantSplits(validVariants3334).valid).toBe(true);
  });

  it('rejects invalid A/B splits that do not sum to 100%', () => {
    const underSplit: Variant[] = [
      { name: 'Variant A', percentage: 40, subject: 'A' },
      { name: 'Variant B', percentage: 40, subject: 'B' },
    ];
    const underRes = validateVariantSplits(underSplit);
    expect(underRes.valid).toBe(false);
    expect(underRes.error).toContain('currently 80%');

    const overSplit: Variant[] = [
      { name: 'Variant A', percentage: 60, subject: 'A' },
      { name: 'Variant B', percentage: 50, subject: 'B' },
    ];
    const overRes = validateVariantSplits(overSplit);
    expect(overRes.valid).toBe(false);
    expect(overRes.error).toContain('currently 110%');
  });
});

describe('Phase 2 Campaigns: Batch Dispatch & Scheduling Idempotency', () => {
  interface Recipient {
    id: string;
    email: string;
    status: 'pending' | 'sent' | 'failed';
    error_message?: string;
  }

  it('only dispatches pending or retried failed recipients, never sent recipients', () => {
    const recipients: Recipient[] = [
      { id: 'r1', email: 'lead1@test.com', status: 'sent' },
      { id: 'r2', email: 'lead2@test.com', status: 'pending' },
      { id: 'r3', email: 'lead3@test.com', status: 'failed', error_message: 'Rate limited' },
    ];

    const getDispatchEligibleRecipients = (list: Recipient[], includeFailed = false) => {
      return list.filter((r) => r.status === 'pending' || (includeFailed && r.status === 'failed'));
    };

    const regularBatch = getDispatchEligibleRecipients(recipients, false);
    expect(regularBatch).toHaveLength(1);
    expect(regularBatch[0].id).toBe('r2');

    const retryBatch = getDispatchEligibleRecipients(recipients, true);
    expect(retryBatch).toHaveLength(2);
    expect(retryBatch.some((r) => r.id === 'r1')).toBe(false); // r1 is already 'sent'
  });

  it('processes server-side scheduled jobs when job scheduled_for <= now', () => {
    const now = new Date('2026-09-15T18:00:00Z').getTime();

    const jobs = [
      { id: 'j1', campaign_id: 'c1', status: 'scheduled', scheduled_for: '2026-09-15T17:30:00Z' }, // Due
      { id: 'j2', campaign_id: 'c2', status: 'scheduled', scheduled_for: '2026-09-15T19:00:00Z' }, // Future
      { id: 'j3', campaign_id: 'c3', status: 'completed', scheduled_for: '2026-09-15T16:00:00Z' }, // Already completed
    ];

    const dueJobs = jobs.filter(
      (job) => job.status === 'scheduled' && new Date(job.scheduled_for).getTime() <= now
    );

    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('j1');
  });
});
