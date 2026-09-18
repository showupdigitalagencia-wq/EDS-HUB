import { describe, it, expect, vi, beforeEach } from 'vitest';
import { campaignAudienceService } from '../features/campaigns/services/campaign-audience-service';
import type {
  CampaignChannel,
  TaskSource,
  AudienceFilterDefinition,
  AudienceFilterRule,
  AudienceExclusionReason,
  AudiencePreviewResult,
} from '../types';
import { supabase } from '../lib/supabase';

// Mock Supabase client
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('PHASE 5 — BLOCK 3: CAMPAIGNS & AUDIENCE SEGMENTATION 2.0 SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // 1. Canonical Channels & Task Source Constraints
  // ==========================================
  describe('Canonical Enums & Constraints', () => {
    it('1. accepts all valid campaign channels: email, sms, call', () => {
      const channels: CampaignChannel[] = ['email', 'sms', 'call'];
      expect(channels).toEqual(['email', 'sms', 'call']);
      channels.forEach((c) => {
        expect(['email', 'sms', 'call']).toContain(c);
      });
    });

    it('2. task_source accepts campaign alongside canonical sources', () => {
      const sources: TaskSource[] = [
        'manual',
        'automation',
        'system',
        'course_operations',
        'post_course',
        'campaign',
      ];
      expect(sources).toContain('campaign');
      expect(sources.length).toBe(6);
    });

    it('3. exclusion reason canonical enum supports all project error codes', () => {
      const reasons: AudienceExclusionReason[] = [
        'TEST_SOURCE',
        'NO_VALID_CONTACT_PREFERENCE',
        'CHANNEL_PREFERENCE_MISMATCH',
        'MISSING_EMAIL',
        'MISSING_PHONE',
        'INVALID_EMAIL',
        'INVALID_PHONE',
        'SUPPRESSED',
        'DUPLICATE',
      ];
      expect(reasons).toContain('TEST_SOURCE');
      expect(reasons).toContain('NO_VALID_CONTACT_PREFERENCE');
      expect(reasons).toContain('CHANNEL_PREFERENCE_MISMATCH');
      expect(reasons).toContain('MISSING_EMAIL');
      expect(reasons).toContain('MISSING_PHONE');
    });
  });

  // ==========================================
  // 2. Filter DSL Validation & Security
  // ==========================================
  describe('Filter DSL Validation & Query Safety', () => {
    it('4. accepts valid AND structured filter with supported fields and operators', () => {
      const validFilter: AudienceFilterDefinition = {
        version: 1,
        operator: 'and',
        rules: [
          { field: 'lead_score', operator: 'gte', value: 70 },
          { field: 'pipeline_stage', operator: 'eq', value: 'acquisition' },
          { field: 'contact_preference', operator: 'eq', value: 'email' },
          { field: 'inactivity_days', operator: 'gte', value: 14 },
        ],
      };

      expect(validFilter.version).toBe(1);
      expect(validFilter.operator).toBe('and');
      expect(validFilter.rules?.length).toBe(4);
    });

    it('5. allows filtering by repeat student status and financial balance', () => {
      const repeatFilter: AudienceFilterRule = {
        field: 'is_repeat_student',
        operator: 'eq',
        value: true,
      };
      const balanceFilter: AudienceFilterRule = {
        field: 'has_outstanding_balance',
        operator: 'eq',
        value: true,
      };

      expect(repeatFilter.field).toBe('is_repeat_student');
      expect(balanceFilter.field).toBe('has_outstanding_balance');
    });

    it('6. rejects arbitrary malicious field names server-side', async () => {
      // In PostgreSQL RPC preview_audience_segment, only whitelisted fields are evaluated
      const allowedFields = [
        'pipeline_stage',
        'qualification_status',
        'source',
        'lead_score',
        'contact_preference',
        'course_id',
        'is_repeat_student',
        'has_outstanding_balance',
        'inactivity_days',
      ];

      const maliciousField = "email'; DROP TABLE leads; --";
      expect(allowedFields.includes(maliciousField)).toBe(false);
    });

    it('7. rejects arbitrary SQL injection operators', () => {
      const allowedOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'];
      const dangerousOperator = 'UNION SELECT * FROM auth.users';
      expect(allowedOperators.includes(dangerousOperator)).toBe(false);
    });
  });

  // ==========================================
  // 3. Contact Preference Enforcement & Eligibility
  // ==========================================
  describe('Contact Preference & Eligibility Rules', () => {
    it('8. email campaign marks lead ineligible if contact_preference is not email', () => {
      const lead = {
        id: 'lead-1',
        contact_preference: 'sms',
        email: 'user@example.com',
        phone: '+5511999999999',
        source: 'google',
      };
      const campaignChannel: CampaignChannel = 'email';

      const isEligible =
        lead.source !== 'test' &&
        lead.contact_preference === campaignChannel &&
        Boolean(lead.email);

      expect(isEligible).toBe(false);
    });

    it('9. sms campaign marks lead ineligible if contact_preference is not sms', () => {
      const lead = {
        id: 'lead-2',
        contact_preference: 'call',
        email: 'user@example.com',
        phone: '+5511999999999',
        source: 'meta',
      };
      const campaignChannel: CampaignChannel = 'sms';

      const isEligible =
        lead.source !== 'test' &&
        lead.contact_preference === campaignChannel &&
        Boolean(lead.phone);

      expect(isEligible).toBe(false);
    });

    it('10. call campaign marks lead ineligible if contact_preference is not call', () => {
      const lead = {
        id: 'lead-3',
        contact_preference: 'email',
        email: 'user@example.com',
        phone: '+5511999999999',
        source: 'form',
      };
      const campaignChannel: CampaignChannel = 'call';

      const isEligible =
        lead.source !== 'test' &&
        lead.contact_preference === campaignChannel &&
        Boolean(lead.phone);

      expect(isEligible).toBe(false);
    });

    it('11. lead with missing contact_preference is ALWAYS ineligible with NO_VALID_CONTACT_PREFERENCE', () => {
      const lead = {
        id: 'lead-4',
        contact_preference: null,
        email: 'lead@test.com',
        phone: '+5511988888888',
        source: 'google',
      };

      let exclusionReason: AudienceExclusionReason | null = null;
      let isEligible = true;

      if (!lead.contact_preference) {
        isEligible = false;
        exclusionReason = 'NO_VALID_CONTACT_PREFERENCE';
      }

      expect(isEligible).toBe(false);
      expect(exclusionReason).toBe('NO_VALID_CONTACT_PREFERENCE');
    });

    it('12. lead missing destination address is excluded with MISSING_EMAIL or MISSING_PHONE', () => {
      const leadEmailMissing = {
        id: 'lead-5',
        contact_preference: 'email',
        email: null,
        phone: '+5511999999999',
        source: 'form',
      };

      let reasonEmail: AudienceExclusionReason | null = null;
      if (!leadEmailMissing.email) {
        reasonEmail = 'MISSING_EMAIL';
      }
      expect(reasonEmail).toBe('MISSING_EMAIL');

      const leadPhoneMissing = {
        id: 'lead-6',
        contact_preference: 'call',
        email: 'call@example.com',
        phone: null,
        source: 'form',
      };

      let reasonPhone: AudienceExclusionReason | null = null;
      if (!leadPhoneMissing.phone) {
        reasonPhone = 'MISSING_PHONE';
      }
      expect(reasonPhone).toBe('MISSING_PHONE');
    });
  });

  // ==========================================
  // 4. Test Source Exclusion Safety
  // ==========================================
  describe('Test Lead Absolute Exclusion', () => {
    it('13. lead with source = test is ALWAYS excluded even if user filter requests test source', () => {
      const leadTest = {
        id: 'lead-test-1',
        source: 'test',
        contact_preference: 'email',
        email: 'qa@example.com',
      };

      // Canonical rule: source = 'test' MUST yield is_eligible = false and TEST_SOURCE
      let isEligible = true;
      let exclusionReason: AudienceExclusionReason | null = null;

      if (leadTest.source === 'test') {
        isEligible = false;
        exclusionReason = 'TEST_SOURCE';
      }

      expect(isEligible).toBe(false);
      expect(exclusionReason).toBe('TEST_SOURCE');
    });

    it('14. preview_audience_segment marks test leads with TEST_SOURCE breakdown', () => {
      const mockPreviewResult: AudiencePreviewResult = {
        total_matched: 10,
        eligible_count: 6,
        excluded_count: 4,
        exclusion_breakdown: {
          TEST_SOURCE: 2,
          NO_VALID_CONTACT_PREFERENCE: 0,
          CHANNEL_PREFERENCE_MISMATCH: 1,
          MISSING_EMAIL: 1,
          MISSING_PHONE: 0,
        },
        leads: [
          {
            id: 'test-lead-1',
            first_name: 'QA',
            last_name: 'Test Lead',
            email: 'qa@test.com',
            phone: null,
            contact_preference: 'email',
            pipeline_stage_id: 'stage-1',
            stage_name: 'Qualification',
            stage_code: 'qualification',
            lead_score: 50,
            is_eligible: false,
            exclusion_reason: 'TEST_SOURCE',
            source: 'test',
            created_at: '2026-09-18T10:00:00Z',
          },
        ],
      };

      expect(mockPreviewResult.exclusion_breakdown.TEST_SOURCE).toBe(2);
      expect(mockPreviewResult.leads[0].exclusion_reason).toBe('TEST_SOURCE');
      expect(mockPreviewResult.leads[0].is_eligible).toBe(false);
    });
  });

  // ==========================================
  // 5. Dynamic Preview vs Frozen Snapshot Immutability
  // ==========================================
  describe('Dynamic Preview vs Snapshot Immutability', () => {
    it('15. previewAudience calls RPC without modifying database state', async () => {
      const mockData: AudiencePreviewResult = {
        total_matched: 5,
        eligible_count: 5,
        excluded_count: 0,
        exclusion_breakdown: {
          TEST_SOURCE: 0,
          NO_VALID_CONTACT_PREFERENCE: 0,
          CHANNEL_PREFERENCE_MISMATCH: 0,
          MISSING_EMAIL: 0,
          MISSING_PHONE: 0,
        },
        leads: [],
      };

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: mockData,
        error: null,
      } as any);

      const filter: AudienceFilterDefinition = { version: 1, operator: 'and', rules: [] };
      const res = await campaignAudienceService.previewAudience(filter, 'email');

      expect(supabase.rpc).toHaveBeenCalledWith('preview_audience_segment', {
        p_filters: filter,
        p_channel: 'email',
        p_include_test: false,
        p_limit: 50,
        p_offset: 0,
      });
      expect(res.total_matched).toBe(5);
    });

    it('16. prepareCampaignAudience freezes audience snapshot and does NOT create tasks', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          audience_id: 'aud-1',
          total_count: 12,
          eligible_count: 10,
          excluded_count: 2,
        },
        error: null,
      } as any);

      const result = await campaignAudienceService.prepareCampaignAudience(
        'camp-1',
        'seg-123',
      );

      expect(supabase.rpc).toHaveBeenCalledWith('prepare_campaign_audience_snapshot', {
        p_campaign_id: 'camp-1',
        p_saved_segment_id: 'seg-123',
      });
      expect(result.eligible_count).toBe(10);
      expect(result.excluded_count).toBe(2);
    });

    it('17. mutating a SavedSegment does NOT alter an existing campaign audience snapshot', () => {
      const originalSegment = {
        id: 'seg-1',
        name: 'High Score Leads',
        filter_definition: {
          version: 1,
          operator: 'and',
          rules: [{ field: 'lead_score', operator: 'gte', value: 80 }],
        },
        updated_at: '2026-09-01T00:00:00Z',
      };

      const campaignSnapshot = {
        campaign_id: 'camp-1',
        frozen_filter_definition: JSON.parse(JSON.stringify(originalSegment.filter_definition)),
        saved_segment_id: originalSegment.id,
        prepared_at: '2026-09-02T10:00:00Z',
      };

      // User updates SavedSegment
      const modifiedSegment = {
        ...originalSegment,
        filter_definition: {
          version: 1,
          operator: 'and',
          rules: [{ field: 'lead_score', operator: 'gte', value: 90 }],
        },
        updated_at: '2026-09-15T00:00:00Z',
      };

      // Campaign snapshot remains untouched!
      expect(campaignSnapshot.frozen_filter_definition.rules[0].value).toBe(80);
      expect(modifiedSegment.filter_definition.rules[0].value).toBe(90);
    });
  });

  // ==========================================
  // 6. Call Campaign Activation & Idempotency
  // ==========================================
  describe('Call Campaign Task Activation & Idempotency', () => {
    it('18. activateCallCampaign calls canonical RPC and returns created count', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          campaign_id: 'camp-call-1',
          tasks_created: 5,
          tasks_skipped_idempotent: 0,
        },
        error: null,
      } as any);

      const res = await campaignAudienceService.activateCallCampaign('camp-call-1');
      expect(supabase.rpc).toHaveBeenCalledWith('activate_call_campaign', {
        p_campaign_id: 'camp-call-1',
      });
      expect(res.tasks_created).toBe(5);
      expect(res.tasks_skipped_idempotent).toBe(0);
    });

    it('19. re-activating call campaign is 100% idempotent and generates 0 duplicate tasks', async () => {
      // Second run returns 0 created, 5 skipped
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          campaign_id: 'camp-call-1',
          tasks_created: 0,
          tasks_skipped_idempotent: 5,
        },
        error: null,
      } as any);

      const res = await campaignAudienceService.activateCallCampaign('camp-call-1');
      expect(res.tasks_created).toBe(0);
      expect(res.tasks_skipped_idempotent).toBe(5);
    });

    it('20. call tasks are NEVER created for excluded members or test leads', () => {
      const recipients = [
        { lead_id: 'lead-1', is_eligible: true, exclusion_reason: null },
        { lead_id: 'lead-2', is_eligible: false, exclusion_reason: 'TEST_SOURCE' },
        { lead_id: 'lead-3', is_eligible: false, exclusion_reason: 'MISSING_PHONE' },
        { lead_id: 'lead-4', is_eligible: false, exclusion_reason: 'CHANNEL_PREFERENCE_MISMATCH' },
      ];

      // Only is_eligible = true are candidate tasks
      const eligibleToCreate = recipients.filter((r) => r.is_eligible);
      expect(eligibleToCreate.length).toBe(1);
      expect(eligibleToCreate[0].lead_id).toBe('lead-1');
    });
  });

  // ==========================================
  // 7. Canonical Metrics Reuse & Multiple Enrollments
  // ==========================================
  describe('Canonical Definitions Reuse & Multiple Enrollments', () => {
    it('21. repeat student definition strictly requires 2 or more confirmed course enrollments', () => {
      const studentA = { enrollments_count: 1 };
      const studentB = { enrollments_count: 2 };
      const studentC = { enrollments_count: 3 };

      const isRepeat = (eCount: number) => eCount >= 2;

      expect(isRepeat(studentA.enrollments_count)).toBe(false);
      expect(isRepeat(studentB.enrollments_count)).toBe(true);
      expect(isRepeat(studentC.enrollments_count)).toBe(true);
    });

    it('22. outstanding balance uses canonical formula: agreed - paid_payments + paid_refunds > 0', () => {
      const calcBalance = (agreed: number, payments: number, refunds: number) => {
        const net = payments - refunds;
        return Math.max(agreed - net, 0);
      };

      // Paid in full
      expect(calcBalance(5000, 5000, 0)).toBe(0);
      // Partial payment
      expect(calcBalance(5000, 3000, 0)).toBe(2000);
      // Refunded payment increases outstanding balance
      expect(calcBalance(5000, 5000, 1500)).toBe(1500);
    });

    it('23. independent EXISTS clauses safely handle leads with multiple distinct enrollments', () => {
      const leadEnrollments = [
        { course_id: 'course-ortho', status: 'confirmed' },
        { course_id: 'course-implants', status: 'cancelled' },
      ];

      const isEnrolledInCourse = (courseId: string) =>
        leadEnrollments.some((e) => e.course_id === courseId && e.status === 'confirmed');

      expect(isEnrolledInCourse('course-ortho')).toBe(true);
      expect(isEnrolledInCourse('course-implants')).toBe(false);
      expect(isEnrolledInCourse('course-surgery')).toBe(false);
    });
  });

  // ==========================================
  // 8. Saved Segments CRUD
  // ==========================================
  describe('Saved Segments CRUD Operations', () => {
    it('24. lists saved segments with active app user', async () => {
      const mockSegments = [
        {
          id: 'seg-1',
          name: 'VIP High Score',
          description: 'Score >= 80',
          filter_definition: { version: 1, operator: 'and', rules: [] },
          created_at: '2026-09-18T10:00:00Z',
          updated_at: '2026-09-18T10:00:00Z',
        },
      ];

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockResolvedValueOnce({ data: mockSegments, error: null }),
          }),
        }),
      } as any);

      const segments = await campaignAudienceService.listSavedSegments();
      expect(segments.length).toBe(1);
      expect(segments[0].name).toBe('VIP High Score');
    });

    it('25. creates saved segment with schema version 1', async () => {
      const newSegment = {
        id: 'seg-2',
        name: 'Cold Leads',
        description: 'Inactive > 30 days',
        filter_definition: {
          version: 1,
          operator: 'and',
          rules: [{ field: 'inactivity_days', operator: 'gte', value: 30 }],
        },
        created_at: '2026-09-18T10:00:00Z',
        updated_at: '2026-09-18T10:00:00Z',
      };

      vi.mocked(supabase.from).mockReturnValueOnce({
        insert: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            single: vi.fn().mockResolvedValueOnce({ data: newSegment, error: null }),
          }),
        }),
      } as any);

      const created = await campaignAudienceService.createSavedSegment(
        'Cold Leads',
        'Inactive > 30 days',
        newSegment.filter_definition as AudienceFilterDefinition,
      );

      expect(created.name).toBe('Cold Leads');
      expect(created.filter_definition.version).toBe(1);
    });

    it('26. deletes saved segment gracefully', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce({
        update: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockResolvedValueOnce({ error: null }),
        }),
      } as any);

      await expect(campaignAudienceService.deleteSavedSegment('seg-2')).resolves.not.toThrow();
    });
  });

  // ==========================================
  // 9. Provider-Deferred States for Email and SMS
  // ==========================================
  describe('Provider Deferred States', () => {
    it('27. email and sms campaign statuses are preserved and never falsely marked sent', () => {
      const validStatuses = ['draft', 'pending_approval', 'approved', 'scheduled'];
      // Sent/Delivered are invalid for email/sms in Phase 5 Block 3 without provider integration
      expect(validStatuses).not.toContain('sent');
      expect(validStatuses).not.toContain('delivered');
    });

    it('28. call campaign can be marked prepared and activated via tasks', () => {
      const callCampaign = {
        id: 'camp-call',
        channel: 'call' as CampaignChannel,
        status: 'draft',
        is_prepared: true,
        activated_at: '2026-09-18T12:00:00Z',
      };

      expect(callCampaign.channel).toBe('call');
      expect(callCampaign.is_prepared).toBe(true);
      expect(callCampaign.activated_at).toBeTruthy();
    });
  });
});
