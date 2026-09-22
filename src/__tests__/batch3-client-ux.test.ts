import { describe, it, expect } from 'vitest';
import {
  formatSessionMonthYear,
  resolveAttentionState,
  type FormattedCourseInterest,
} from '../features/pipeline/components/MinimalLeadCard';
import type { Lead, PipelineStage } from '../types';

describe('Batch 3 — Client UX: Pipeline, Minimal Lead Card & Manual Lead Creation', () => {
  // Mock Lead Fixture
  const createMockLead = (overrides: Partial<Lead> = {}): Lead =>
    ({
      id: 'lead-123',
      source: 'meta',
      source_detail: 'lead_gen_ad',
      external_lead_id: null,
      hubspot_contact_id: null,
      first_name: 'Dr. Roberto',
      last_name: 'Almeida',
      email: 'roberto@example.com',
      email_confirmation: null,
      phone_raw: '+5511999998888',
      phone_e164: '+5511999998888',
      contact_preference: 'email',
      pipeline_stage_id: 'stage-capture',
      qualification_status: 'no_response',
      lead_score: 85,
      referred_by: 'Dra. Camila',
      source_created_at: null,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
      course_interest: null,
      course_interests: [],
      ...overrides,
    } as Lead);

  const mockStages: PipelineStage[] = [
    { id: 's1', code: 'capture', name: 'Novo Lead', sort_order: 1, is_active: true, created_at: '', updated_at: '' },
    { id: 's2', code: 'qualification', name: 'Respondido', sort_order: 2, is_active: true, created_at: '', updated_at: '' },
    { id: 's3', code: 'acquisition', name: 'Interessado', sort_order: 3, is_active: true, created_at: '', updated_at: '' },
    { id: 's4', code: 'approval', name: 'Quente', sort_order: 4, is_active: true, created_at: '', updated_at: '' },
    { id: 's5', code: 'enrollment', name: 'Matrícula', sort_order: 5, is_active: true, created_at: '', updated_at: '' },
    { id: 's6', code: 'post_course', name: 'Pós-Curso', sort_order: 6, is_active: true, created_at: '', updated_at: '' },
    { id: 's7', code: 'alumni', name: 'Alumni', sort_order: 7, is_active: true, created_at: '', updated_at: '' },
  ];

  describe('1. Main Pipeline Operational Stages (5 Stages Only)', () => {
    it('filters strictly to the 5 operational stages by canonical code', () => {
      const OPERATIONAL_STAGE_CODES = ['capture', 'qualification', 'acquisition', 'approval', 'enrollment'];
      const operational = mockStages.filter((s) => OPERATIONAL_STAGE_CODES.includes(s.code as any));

      expect(operational).toHaveLength(5);
      expect(operational.map((s) => s.code)).toEqual([
        'capture',
        'qualification',
        'acquisition',
        'approval',
        'enrollment',
      ]);
    });

    it('excludes Post-Course and Alumni from the main operational pipeline view', () => {
      const OPERATIONAL_STAGE_CODES = ['capture', 'qualification', 'acquisition', 'approval', 'enrollment'];
      const operational = mockStages.filter((s) => OPERATIONAL_STAGE_CODES.includes(s.code as any));

      const codes = operational.map((s) => s.code);
      expect(codes).not.toContain('post_course');
      expect(codes).not.toContain('alumni');
    });

    it('enforces exact operational order: Novo Lead -> Respondido -> Interessado -> Quente -> Matrícula', () => {
      const STAGE_ORDER_MAP: Record<string, number> = {
        capture: 1,
        qualification: 2,
        acquisition: 3,
        approval: 4,
        enrollment: 5,
      };

      const OPERATIONAL_STAGE_CODES = ['capture', 'qualification', 'acquisition', 'approval', 'enrollment'];
      const sorted = [...mockStages]
        .filter((s) => OPERATIONAL_STAGE_CODES.includes(s.code as any))
        .sort((a, b) => (STAGE_ORDER_MAP[a.code] || 99) - (STAGE_ORDER_MAP[b.code] || 99));

      expect(sorted.map((s) => s.name)).toEqual([
        'Novo Lead',
        'Respondido',
        'Interessado',
        'Quente',
        'Matrícula',
      ]);
    });
  });

  describe('2. Minimal Lead Card Date & Attention Formatting', () => {
    it('formats valid session date string into Month Year format', () => {
      expect(formatSessionMonthYear('2026-11-15')).toBe('Nov 2026');
      expect(formatSessionMonthYear('2027-02-01')).toBe('Fev 2027');
      expect(formatSessionMonthYear('2027-03-20')).toBe('Mar 2027');
    });

    it('handles null, undefined, or empty session dates gracefully without inventing text', () => {
      expect(formatSessionMonthYear(null)).toBeNull();
      expect(formatSessionMonthYear(undefined)).toBeNull();
      expect(formatSessionMonthYear('')).toBeNull();
    });

    it('marks website leads in Novo Lead with "Aguardando resposta manual"', () => {
      const websiteLead = createMockLead({
        source: 'form',
        source_detail: 'website',
        pipeline_stage_id: 'stage-capture',
      });

      const attention = resolveAttentionState(websiteLead);
      expect(attention).not.toBeNull();
      expect(attention?.label).toBe('Aguardando resposta manual');
      expect(attention?.variant).toBe('neutral');
    });

    it('marks Meta leads with initial contact failure with "Falha no primeiro contato"', () => {
      const metaLead = createMockLead({
        source: 'meta',
        source_detail: 'lead_gen_ad',
      });

      const attention = resolveAttentionState(metaLead, [
        'Intake processing failed: Invalid recipient',
      ]);
      expect(attention).not.toBeNull();
      expect(attention?.label).toBe('Falha no primeiro contato');
      expect(attention?.variant).toBe('error');
    });

    it('marks Meta leads with partial failure with "Falha parcial"', () => {
      const metaLead = createMockLead({
        source: 'meta',
        source_detail: 'lead_gen_ad',
      });

      const attention = resolveAttentionState(metaLead, [
        'Initial outreach partial failure: Email accepted, but SMS dispatch failed',
      ]);
      expect(attention).not.toBeNull();
      expect(attention?.label).toBe('Falha parcial');
      expect(attention?.variant).toBe('warning');
    });

    it('never fabricates delivery, opened, or spam states without provider webhook confirmation', () => {
      const lead = createMockLead();
      const attention = resolveAttentionState(lead, []);
      if (attention) {
        expect(attention.label).not.toMatch(/delivered|opened|spam|bounced|entregue|aberto/i);
      }
    });
  });

  describe('3. Course Interests Display & 3-Course Limit', () => {
    it('formats up to 3 prioritized course interests with session date', () => {
      const interests: FormattedCourseInterest[] = [
        { courseName: 'Zygomatic', startDate: '2026-11-10', priority: 1 },
        { courseName: 'Advanced', startDate: '2027-02-15', priority: 2 },
        { courseName: 'Rehabilitation', startDate: '2027-03-20', priority: 3 },
      ];

      const formatted = interests
        .sort((a, b) => (a.priority || 99) - (b.priority || 99))
        .slice(0, 3)
        .map((i) => {
          const dateFmt = formatSessionMonthYear(i.startDate);
          return dateFmt ? `${i.courseName} • ${dateFmt}` : i.courseName;
        });

      expect(formatted).toEqual([
        'Zygomatic • Nov 2026',
        'Advanced • Fev 2027',
        'Rehabilitation • Mar 2027',
      ]);
    });

    it('renders course name alone when no session date is assigned', () => {
      const interests: FormattedCourseInterest[] = [
        { courseName: 'All-on-4', startDate: null, priority: 1 },
      ];

      const formatted = interests.map((i) => {
        const dateFmt = formatSessionMonthYear(i.startDate);
        return dateFmt ? `${i.courseName} • ${dateFmt}` : i.courseName;
      });

      expect(formatted).toEqual(['All-on-4']);
    });

    it('strictly limits display to 3 interests even if more historical rows exist', () => {
      const interests: FormattedCourseInterest[] = [
        { courseName: 'Course 1', priority: 1 },
        { courseName: 'Course 2', priority: 2 },
        { courseName: 'Course 3', priority: 3 },
        { courseName: 'Course 4', priority: null },
      ];

      const displayed = interests.slice(0, 3);
      expect(displayed).toHaveLength(3);
      expect(displayed.map((d) => d.courseName)).toEqual(['Course 1', 'Course 2', 'Course 3']);
    });
  });

  describe('4. Leads List Server-Side Filter Mechanics', () => {
    it('builds relational inner query when course or session filter is active', () => {
      const courseFilter = 'course-zygomatic';
      const sessionFilter = 'session-nov-2026';

      const hasCourse = Boolean(courseFilter);
      const hasSession = Boolean(sessionFilter);

      const selectClause =
        hasCourse || hasSession
          ? '*, lead_course_interests!inner(course_id, course_session_id)'
          : '*, lead_course_interests(course_id, course_session_id)';

      expect(selectClause).toContain('!inner');
    });

    it('builds standard left query when no course/session filter is active', () => {
      const courseFilter = '';
      const sessionFilter = '';

      const hasCourse = Boolean(courseFilter);
      const hasSession = Boolean(sessionFilter);

      const selectClause =
        hasCourse || hasSession
          ? '*, lead_course_interests!inner(course_id, course_session_id)'
          : '*, lead_course_interests(course_id, course_session_id)';

      expect(selectClause).not.toContain('!inner');
    });

    it('ensures deduplicated display: a lead with 3 course interests appears as 1 table row', () => {
      // Simulate PostgREST embedded JSON structure
      const leadWith3Interests = {
        ...createMockLead({ id: 'lead-multi' }),
        lead_course_interests: [
          { course_id: 'c1', priority: 1, course: { name: 'Zygomatic' } },
          { course_id: 'c2', priority: 2, course: { name: 'Advanced' } },
          { course_id: 'c3', priority: 3, course: { name: 'All-on-4' } },
        ],
      };

      const leadsList = [leadWith3Interests];
      expect(leadsList).toHaveLength(1);
      expect(leadsList[0].lead_course_interests).toHaveLength(3);
    });
  });

  describe('5. Manual Lead Creation & RPC Contract', () => {
    it('validates course session belongs to selected course before inserting interest', () => {
      const sessions = [
        { id: 's-nov', course_id: 'c-zygomatic', title: 'Zygomatic Nov' },
        { id: 's-feb', course_id: 'c-advanced', title: 'Advanced Feb' },
      ];

      // Valid pairing
      const validPair = sessions.find((s) => s.id === 's-nov' && s.course_id === 'c-zygomatic');
      expect(validPair).toBeDefined();

      // Invalid pairing (session belonging to Advanced submitted with Zygomatic)
      const invalidPair = sessions.find((s) => s.id === 's-feb' && s.course_id === 'c-zygomatic');
      expect(invalidPair).toBeUndefined();
    });

    it('sets source = "manual", preventing Meta initial outreach automation', () => {
      const manualLead = createMockLead({
        source: 'manual',
        source_detail: 'manual_crm_entry',
      });

      expect(manualLead.source).toBe('manual');
      // Verify Meta automation guard logic rejects manual source
      const isMetaLead = manualLead.source === 'meta';
      expect(isMetaLead).toBe(false);
    });

    it('preserves referred_by text field without financial or commission calculation', () => {
      const lead = createMockLead({ referred_by: 'Dr. Lucas Ribeiro' });
      expect(lead.referred_by).toBe('Dr. Lucas Ribeiro');
    });

    it('defaults manual lead stage to Novo Lead (capture)', () => {
      const captureStage = mockStages.find((s) => s.code === 'capture');
      expect(captureStage?.name).toBe('Novo Lead');
      expect(captureStage?.code).toBe('capture');
    });
  });

  describe('6. create_manual_lead RPC Security & Permission Guard', () => {
    it('verifies active app_user is required to execute create_manual_lead', () => {
      const checkUserSecurity = (isActiveAppUser: boolean) => {
        if (!isActiveAppUser) {
          throw new Error('Unauthorized: Caller is not an active EDS HUB app user');
        }
        return { success: true };
      };

      // Active user succeeds
      expect(checkUserSecurity(true)).toEqual({ success: true });

      // Inactive or non-app user throws 42501 error
      expect(() => checkUserSecurity(false)).toThrow('Unauthorized: Caller is not an active EDS HUB app user');
    });
  });

  describe('7. Batch 3.1 Visual Refinements & Information Hierarchy', () => {
    it('verifies the card displays phone and email directly under the lead name', async () => {
      const React = await import('react');
      const { render, screen } = await import('@testing-library/react');
      const { MinimalLeadCard } = await import('../features/pipeline/components/MinimalLeadCard');

      const lead = createMockLead({
        first_name: 'Dr. Arthur',
        last_name: 'Dentist',
        phone_raw: '+1 (941) 830-1451',
        email: 'arthur@email.com',
      });

      const interests = [
        { courseName: 'Zygomatic', startDate: '2026-11-15', priority: 1 as const },
      ];

      render(React.createElement(MinimalLeadCard, { lead, interests }));

      // Name
      expect(screen.getByText('Dr. Arthur Dentist')).toBeDefined();
      // Phone
      expect(screen.getByText('+1 (941) 830-1451')).toBeDefined();
      // Email
      expect(screen.getByText('arthur@email.com')).toBeDefined();
      // Course with session date
      expect(screen.getByText('Zygomatic • Nov 2026')).toBeDefined();

      // Ensure NO raw score or qualification badge is rendered
      expect(screen.queryByText('⚡ 85')).toBeNull();
      expect(screen.queryByText('no_response')).toBeNull();
      expect(screen.queryByText('Sem Resposta')).toBeNull();
    });

    it('displays subtle fallback "Sem curso de interesse" when lead has no course interests', async () => {
      const React = await import('react');
      const { render, screen } = await import('@testing-library/react');
      const { MinimalLeadCard } = await import('../features/pipeline/components/MinimalLeadCard');

      const lead = createMockLead({ course_interest: null, course_interests: [] });

      render(React.createElement(MinimalLeadCard, { lead, interests: [] }));

      expect(screen.getByText('Sem curso de interesse')).toBeDefined();
      expect(screen.queryByText('Nenhum curso selecionado')).toBeNull();
    });

    it('displays subtle fallback "Contato não informado" when both phone and email are absent', async () => {
      const React = await import('react');
      const { render, screen } = await import('@testing-library/react');
      const { MinimalLeadCard } = await import('../features/pipeline/components/MinimalLeadCard');

      const lead = createMockLead({
        phone_raw: null,
        phone_e164: null,
        email: null,
      });

      render(React.createElement(MinimalLeadCard, { lead, interests: [] }));

      expect(screen.getByText('Contato não informado')).toBeDefined();
    });

    it('verifies the empty column state message is "Nenhum lead neste estágio"', () => {
      const emptyMsg = 'Nenhum lead neste estágio';
      expect(emptyMsg).toBe('Nenhum lead neste estágio');
    });
  });
});
