import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ensureCourseSessionForLabel,
  saveLeadMatriculaCourseTurma,
  parseRepresentativeDates,
} from '../features/courses/services/turma-catalog-service';
import { MatriculaCourseTurmaModal } from '../features/leads/components/MatriculaCourseTurmaModal';
import { supabase } from '../lib/supabase';

// Mock Supabase client
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('Part C: Course + Turma Save & Modal Hardening', () => {
  let mockSessions: any[];
  let mockInterests: any[];
  let mockEnrollments: any[];
  let mockLeads: Map<string, any>;

  const COURSE_ADVANCED_ID = 'c-advanced-dental-implant';
  const COURSE_ADVANCED_NAME = 'Advanced Dental Implant Experience';
  const COURSE_ZYGOMATIC_ID = 'c-zygomatic-implant';
  const COURSE_ZYGOMATIC_NAME = 'Zygomatic Implant Training';

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessions = [
      {
        id: 'sess-uuid-existing-febmar27',
        course_id: COURSE_ADVANCED_ID,
        title: 'Feb/Mar 2027',
        code: 'CS-FEBMAR2027-1111',
        status: 'open',
        start_date: null,
        end_date: null,
      },
    ];

    mockInterests = [];
    mockEnrollments = [];
    mockLeads = new Map([
      [
        'lead-101',
        {
          id: 'lead-101',
          first_name: 'Dr. Jane',
          last_name: 'Implantologist',
          course_interest: null,
        },
      ],
    ]);

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') {
        const courses = [
          {
            id: COURSE_ADVANCED_ID,
            name: COURSE_ADVANCED_NAME,
            code: 'ADIE-01',
            default_price: 12500,
            currency: 'USD',
            active: true,
          },
          {
            id: COURSE_ZYGOMATIC_ID,
            name: COURSE_ZYGOMATIC_NAME,
            code: 'ZIT-01',
            default_price: 15000,
            currency: 'USD',
            active: true,
          },
        ];
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: any) => {
            if (col === 'active') {
              return Promise.resolve({ data: courses.filter((c) => c.active === val), error: null });
            }
            const found = courses.filter((c: any) => c[col] === val);
            return {
              data: found,
              error: null,
              single: vi.fn().mockResolvedValue({ data: found[0] || null, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: found[0] || null, error: null }),
              then: (resolve: any) => resolve({ data: found, error: null }),
            };
          }),
          then: (resolve: any) => resolve({ data: courses, error: null }),
        };
        return chain;
      }

      if (table === 'course_sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: string) => {
            const queryObj: any = {
              _filters: [(s: any) => s[col] === val],
              eq: vi.fn((col2: string, val2: string) => {
                queryObj._filters.push((s: any) => s[col2] === val2);
                return queryObj;
              }),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockImplementation(() => {
                const matches = mockSessions.filter((s) => queryObj._filters.every((f: any) => f(s)));
                return Promise.resolve({ data: matches, error: null });
              }),
              maybeSingle: vi.fn().mockImplementation(async () => {
                const matches = mockSessions.filter((s) => queryObj._filters.every((f: any) => f(s)));
                return { data: matches[0] || null, error: null };
              }),
              then: (resolve: any) => {
                const matches = mockSessions.filter((s) => queryObj._filters.every((f: any) => f(s)));
                resolve({ data: matches, error: null });
              },
            };
            return queryObj;
          }),
          insert: vi.fn((data: any) => {
            const newRow = {
              id: data.id || `sess-uuid-gen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              ...data,
            };
            mockSessions.push(newRow);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: newRow, error: null }),
                maybeSingle: vi.fn().mockResolvedValue({ data: newRow, error: null }),
              }),
            };
          }),
        };
      }

      if (table === 'lead_course_interests') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((_col: string, leadId: string) => {
              const matches = mockInterests.filter((i) => i.lead_id === leadId);
              return {
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: matches, error: null }),
                }),
                data: matches,
                error: null,
              };
            }),
          }),
          insert: vi.fn((data: any) => {
            const row = { id: `lci-${Date.now()}-${Math.random()}`, ...data };
            mockInterests.push(row);
            return Promise.resolve({ data: row, error: null });
          }),
          update: vi.fn((data: any) => ({
            eq: vi.fn((col: string, val: any) => {
              mockInterests = mockInterests.map((item) => (item[col] === val ? { ...item, ...data } : item));
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      if (table === 'enrollments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((_col: string, leadId: string) => {
              const matches = mockEnrollments.filter((e) => e.lead_id === leadId);
              return {
                limit: vi.fn().mockResolvedValue({ data: matches, error: null }),
                data: matches,
                error: null,
              };
            }),
          }),
          insert: vi.fn((data: any) => {
            const row = { id: `enr-${Date.now()}-${Math.random()}`, ...data };
            mockEnrollments.push(row);
            return {
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              }),
            };
          }),
          update: vi.fn((data: any) => ({
            eq: vi.fn((col: string, val: any) => {
              mockEnrollments = mockEnrollments.map((item) => (item[col] === val ? { ...item, ...data } : item));
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      if (table === 'leads') {
        return {
          update: vi.fn((data: any) => ({
            eq: vi.fn((col: string, val: any) => {
              const current = mockLeads.get(val);
              if (current && col === 'id') {
                mockLeads.set(val, { ...current, ...data });
              }
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      return { select: vi.fn().mockReturnThis() };
    });

    (supabase.rpc as any).mockImplementation((fn: string, params: any) => {
      if (fn === 'save_lead_matricula_course_turma') {
        // Atomic RPC emulation
        const matched = mockSessions.find(
          (s) => s.course_id === params.p_course_id && s.title.toLowerCase() === params.p_turma_label.toLowerCase()
        );
        let sessionId = matched?.id;
        if (!sessionId && params.p_turma_label) {
          sessionId = `sess-uuid-gen-${params.p_course_id}-${params.p_turma_label}`;
          mockSessions.push({
            id: sessionId,
            course_id: params.p_course_id,
            title: params.p_turma_label,
            status: 'open',
            start_date: null,
            end_date: null,
          });
        }
        return Promise.resolve({
          data: {
            success: true,
            course_id: params.p_course_id,
            course_name: params.p_course_id === COURSE_ADVANCED_ID ? COURSE_ADVANCED_NAME : COURSE_ZYGOMATIC_NAME,
            course_session_id: sessionId,
            turma_title: params.p_turma_label,
            enrollment_id: 'enr-rpc-saved',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  // ---------------------------------------------------------------------------
  // A: Advanced Dental Implant Experience + Feb/Mar 2027 -> SAVE PASS
  // ---------------------------------------------------------------------------
  it('A: saves Advanced Dental Implant Experience + Feb/Mar 2027 successfully', async () => {
    const result = await saveLeadMatriculaCourseTurma(
      'lead-101',
      COURSE_ADVANCED_ID,
      'Feb/Mar 2027',
      COURSE_ADVANCED_NAME
    );

    expect(result.success).toBe(true);
    expect(result.courseId).toBe(COURSE_ADVANCED_ID);
    expect(result.courseName).toBe(COURSE_ADVANCED_NAME);
    expect(result.turmaTitle).toBe('Feb/Mar 2027');
    expect(result.courseSessionId).toBe('sess-uuid-existing-febmar27');
  });

  // ---------------------------------------------------------------------------
  // B: Existing course + existing turma -> same session reused
  // ---------------------------------------------------------------------------
  it('B: existing course + existing turma reuses canonical session without duplicates', async () => {
    const initialSessionCount = mockSessions.length;

    const res1 = await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Feb/Mar 2027');
    const res2 = await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Feb/Mar 2027');

    expect(res1.courseSessionId).toBe('sess-uuid-existing-febmar27');
    expect(res2.courseSessionId).toBe('sess-uuid-existing-febmar27');
    expect(mockSessions.length).toBe(initialSessionCount); // No duplicate sessions created!
  });

  // ---------------------------------------------------------------------------
  // C: Repeat save -> no duplicate enrollment
  // ---------------------------------------------------------------------------
  it('C: repeat save does not duplicate enrollment', async () => {
    await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Feb/Mar 2027');
    const firstEnrollmentId = mockEnrollments[0]?.id;

    await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Feb/Mar 2027');
    // RPC or service upsert updates the existing enrollment
    expect(mockEnrollments.length).toBeLessThanOrEqual(1);
    if (mockEnrollments.length === 1 && firstEnrollmentId) {
      expect(mockEnrollments[0].id).toBe(firstEnrollmentId);
    }
  });

  // ---------------------------------------------------------------------------
  // D: Different course + same human label -> correct course-specific session
  // ---------------------------------------------------------------------------
  it('D: different course + same human label resolves to course-specific session', async () => {
    const resAdvanced = await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Nov/26');
    const resZygomatic = await saveLeadMatriculaCourseTurma('lead-101', COURSE_ZYGOMATIC_ID, 'Nov/26');

    expect(resAdvanced.courseId).toBe(COURSE_ADVANCED_ID);
    expect(resZygomatic.courseId).toBe(COURSE_ZYGOMATIC_ID);
    expect(resAdvanced.courseSessionId).not.toBe(resZygomatic.courseSessionId);
  });

  // ---------------------------------------------------------------------------
  // E: Outras / custom turma -> existing intended behavior preserved
  // ---------------------------------------------------------------------------
  it('E: custom turma label preserves null dates without inventing fake dates', async () => {
    const dates = parseRepresentativeDates('Feb/Mar 2027');
    expect(dates.startDate).toBeNull();
    expect(dates.endDate).toBeNull();

    const customDates = parseRepresentativeDates('Outras Custom Oct 2028');
    expect(customDates.startDate).toBeNull();
    expect(customDates.endDate).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // F: Lead profile -> human-readable turma
  // ---------------------------------------------------------------------------
  it('F: turmaTitle returned to UI is strictly human-readable (never raw UUID)', async () => {
    const res = await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Feb/Mar 2027');
    expect(res.turmaTitle).toBe('Feb/Mar 2027');
    expect(res.turmaTitle).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  // ---------------------------------------------------------------------------
  // G & H: Modal UI Desktop & Mobile
  // ---------------------------------------------------------------------------
  it('G & H: MatriculaCourseTurmaModal submits with Course and Turma', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <MatriculaCourseTurmaModal
        isOpen={true}
        onClose={handleClose}
        leadId="lead-101"
        currentCourseId={COURSE_ADVANCED_ID}
        currentCourseSessionId="sess-uuid-existing-febmar27"
        onSuccess={handleSuccess}
      />
    );

    // Course selector displays
    const courseSelect = await screen.findByTestId('matricula-course-select');
    expect(courseSelect).toHaveValue(COURSE_ADVANCED_ID);

    // Turma selector displays
    const turmaSelect = await screen.findByTestId('matricula-turma-select');
    expect(turmaSelect).toBeInTheDocument();

    // Click Save
    const saveButton = screen.getByTestId('salvar-matricula-curso-turma-button');
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalled();
      expect(handleClose).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // I: Existing enrollments preserved
  // ---------------------------------------------------------------------------
  it('I: existing legitimate enrollments are preserved and updated cleanly', async () => {
    mockEnrollments.push({
      id: 'enr-legitimate-001',
      lead_id: 'lead-101',
      course_id: COURSE_ADVANCED_ID,
      course_session_id: 'sess-uuid-existing-febmar27',
      course_name_snapshot: COURSE_ADVANCED_NAME,
      enrollment_status: 'confirmed',
    });

    const res = await saveLeadMatriculaCourseTurma('lead-101', COURSE_ADVANCED_ID, 'Feb/Mar 2027');
    expect(res.success).toBe(true);
    expect(mockEnrollments.length).toBe(1);
    expect(mockEnrollments[0].id).toBe('enr-legitimate-001');
  });

  // ---------------------------------------------------------------------------
  // J: No raw UUID visible
  // ---------------------------------------------------------------------------
  it('J: ensureCourseSessionForLabel NEVER creates a session whose title is a UUID', async () => {
    const rawUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    // If passed a UUID that matches no session, it should throw an error, NOT create a session with title=UUID
    await expect(ensureCourseSessionForLabel(COURSE_ADVANCED_ID, rawUuid)).rejects.toThrow(
      /Invalid turma identifier: UUID/
    );

    // Ensure no session with UUID title was added
    expect(mockSessions.some((s) => s.title === rawUuid)).toBe(false);
  });
});
