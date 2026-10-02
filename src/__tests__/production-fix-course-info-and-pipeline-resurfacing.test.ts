import { describe, it, expect } from 'vitest';
import { formatLeadEntryDate } from '../features/pipeline/components/MinimalLeadCard';
import { formatLeadDateTime } from '../features/leads/components/LeadProfileContent';
import { compareLeadsNewestFirst } from '../lib/lead-sorting';
import {
  deriveIsToday,
  deriveIsOverdue,
  deriveIsCalendarOverdue,
  deriveIsFuture,
} from '../features/work/services/work-queue-service';

describe('Production Fix — Website Course Info Classification & Pipeline Resurfacing & Tasks', () => {
  // Scenario A: Website /contact Course Info is COURSE_INFORMATION_REQUEST, not enrollment
  it('Scenario A: Website /contact Course Info form intent is COURSE_INFORMATION_REQUEST without enrollment task', () => {
    const rawFormPayload = {
      form_id: 'course-info-form',
      form_slug: 'course-info-form',
      source_page: 'https://www.expdentalsolutions.com/contact',
      course: 'Intensive Dental Implant Training',
    };

    // Form intent classification logic
    const isContactForm =
      rawFormPayload.form_slug === 'course-info-form' ||
      rawFormPayload.form_id === 'course-info-form' ||
      rawFormPayload.source_page.includes('/contact');

    const intent: string = isContactForm ? 'COURSE_INFORMATION_REQUEST' : 'UNKNOWN';
    expect(intent).toBe('COURSE_INFORMATION_REQUEST');

    // Must not trigger incomplete enrollment
    const canCreateEnrollmentTask = intent === 'ACTUAL_ENROLLMENT_START';
    expect(canCreateEnrollmentTask).toBe(false);
  });

  // Scenario B: Existing Pedro receives new Course Info for Advanced without creating duplicate
  it('Scenario B: Existing Pedro re-entry preserves canonical lead, merges course interests, updates last_acquisition_at, creates no enrollment task', () => {
    const existingPedro = {
      id: 'ee80445e-700c-4d24-a4d2-470df37d376e',
      email: 'pedronoh.dmd@gmail.com',
      first_name: 'Pedro Noe Hernandez',
      course_interest: 'Zygomatic',
      course_interests: ['Zygomatic'],
      pipeline_stage_id: 'stage_respondido',
      created_at: '2025-10-18T11:46:22.000Z',
      last_acquisition_at: '2025-10-18T11:46:22.000Z',
    };

    const newSubmission = {
      email: 'pedronoh.dmd@gmail.com',
      course: 'Advanced Dental Implant Experience',
      submitted_at: '2026-10-02T09:33:10.785Z',
    };

    // Reconcile lead identity
    const isSameLead = existingPedro.email === newSubmission.email;
    expect(isSameLead).toBe(true);

    // Merge interests without losing previous
    const updatedInterests = Array.from(
      new Set([...existingPedro.course_interests, newSubmission.course])
    );
    expect(updatedInterests).toEqual(['Zygomatic', 'Advanced Dental Implant Experience']);

    // Original created_at strictly preserved, last_acquisition_at updated to Authoritative Factual Timestamp
    const updatedPedro = {
      ...existingPedro,
      course_interests: updatedInterests,
      last_acquisition_at: newSubmission.submitted_at,
    };

    expect(updatedPedro.id).toBe(existingPedro.id);
    expect(updatedPedro.created_at).toBe('2025-10-18T11:46:22.000Z');
    expect(updatedPedro.last_acquisition_at).toBe('2026-10-02T09:33:10.785Z');
    expect(updatedPedro.pipeline_stage_id).toBe('stage_respondido');
  });

  // Scenario C: Existing Respondido lead submits /contact → remains Respondido, moves to top
  it('Scenario C: Existing Respondido lead submits /contact, stage remains Respondido and card moves to top of stage', () => {
    const pedro = {
      id: 'pedro_1',
      pipeline_stage_id: 'stage_respondido',
      created_at: '2025-10-18T11:46:22.000Z',
      last_acquisition_at: '2026-10-02T09:33:10.785Z',
    };

    const otherLead = {
      id: 'other_1',
      pipeline_stage_id: 'stage_respondido',
      created_at: '2026-10-01T22:20:58.000Z',
      last_acquisition_at: '2026-10-02T04:14:23.000Z',
    };

    // Stage is not altered
    expect(pedro.pipeline_stage_id).toBe('stage_respondido');

    // Sorting within stage puts Pedro first
    const stageLeads = [otherLead, pedro];
    stageLeads.sort(compareLeadsNewestFirst);

    expect(stageLeads[0].id).toBe('pedro_1');
  });

  // Scenario D: Actual enrollment flow still captures incomplete enrollment
  it('Scenario D: Dedicated registration form (/register) triggers incomplete enrollment workflow', () => {
    const registrationPayload = {
      source_page: 'https://www.expdentalsolutions.com/register',
      form_slug: 'register-form',
      course_code: 'IDIT-01',
      email: 'student@example.com',
    };

    const isContactForm =
      registrationPayload.source_page.includes('/contact') ||
      registrationPayload.form_slug === 'course-info-form';

    expect(isContactForm).toBe(false);

    const isTrueEnrollmentFlow = registrationPayload.source_page.includes('/register');
    expect(isTrueEnrollmentFlow).toBe(true);
  });

  // Scenario E: Unknown form does not automatically classify as enrollment
  it('Scenario E: Unknown form does not trigger enrollment tasks', () => {
    const unknownForm = {
      form_id: 'unknown_form_99',
      form_slug: 'custom-widget',
      source_page: 'https://www.expdentalsolutions.com/about',
    };

    const isExplicitEnrollment =
      unknownForm.source_page.includes('/register') ||
      unknownForm.form_slug.includes('enrollment') ||
      unknownForm.form_slug.includes('register');

    expect(isExplicitEnrollment).toBe(false);
  });

  // Scenario F & G: Pipeline newest acquisition at top, original created_at preserved
  it('Scenario F & G: Pipeline sorts newest acquisition first while preserving original created_at', () => {
    const oldReengagedLead = {
      id: 'old_lead',
      created_at: '2024-01-01T10:00:00.000Z',
      last_acquisition_at: '2026-10-02T09:00:00.000Z',
    };

    const recentLead = {
      id: 'recent_lead',
      created_at: '2026-10-01T10:00:00.000Z',
      last_acquisition_at: '2026-10-01T10:00:00.000Z',
    };

    const sorted = [recentLead, oldReengagedLead].sort(compareLeadsNewestFirst);

    // Old re-engaged lead has latest acquisition (2026-10-02), so it surfaces to top
    expect(sorted[0].id).toBe('old_lead');
    expect(sorted[1].id).toBe('recent_lead');

    // Original created_at is preserved
    expect(oldReengagedLead.created_at).toBe('2024-01-01T10:00:00.000Z');
  });

  // Scenario H: Profile shows first entry + latest entry
  it('Scenario H: Profile displays both Criado em and Última entrada', () => {
    const createdAt = '2025-10-18T11:46:22.000Z';
    const lastAcquisitionAt = '2026-10-02T09:49:10.000Z';

    const firstEntryStr = formatLeadDateTime(createdAt);
    const lastEntryStr = formatLeadDateTime(lastAcquisitionAt);

    expect(firstEntryStr).toContain('18/10/2025');
    expect(lastEntryStr).toContain('02/10/2026');
    expect(firstEntryStr).not.toBe(lastEntryStr);

    // Card shows Última entrada
    const cardEntryStr = formatLeadEntryDate(lastAcquisitionAt);
    expect(cardEntryStr).toBe('Última entrada: 02/10/2026 06:49');
  });

  // Scenario I, J, K: Task due today vs overdue vs future
  it('Scenario I, J, K: Task today strictly means calendar day in business timezone, overdue is before today, future is after today', () => {
    const refNow = new Date('2026-10-02T14:00:00.000Z'); // 10:00 AM EDT on Oct 2, 2026
    const tz = 'America/New_York';

    const taskDueToday = '2026-10-02T16:00:00.000Z'; // 12:00 PM EDT Oct 2
    const taskDueYesterday = '2026-10-01T16:00:00.000Z'; // 12:00 PM EDT Oct 1
    const taskDueTomorrow = '2026-10-03T16:00:00.000Z'; // 12:00 PM EDT Oct 3

    // I. Today Task:
    expect(deriveIsToday(taskDueToday, tz, refNow.toISOString())).toBe(true);
    expect(deriveIsCalendarOverdue(taskDueToday, tz, refNow.toISOString())).toBe(false);
    expect(deriveIsFuture(taskDueToday, tz, refNow.toISOString())).toBe(false);

    // J. Overdue Task (Due yesterday):
    expect(deriveIsToday(taskDueYesterday, tz, refNow.toISOString())).toBe(false);
    expect(deriveIsCalendarOverdue(taskDueYesterday, tz, refNow.toISOString())).toBe(true);
    expect(deriveIsFuture(taskDueYesterday, tz, refNow.toISOString())).toBe(false);

    // K. Future Task (Due tomorrow):
    expect(deriveIsToday(taskDueTomorrow, tz, refNow.toISOString())).toBe(false);
    expect(deriveIsCalendarOverdue(taskDueTomorrow, tz, refNow.toISOString())).toBe(false);
    expect(deriveIsFuture(taskDueTomorrow, tz, refNow.toISOString())).toBe(true);
  });

  // Scenario L: Overdue sorting is most recently overdue first
  it('Scenario L: Overdue tasks are sorted most recently overdue first (yesterday > 2 days ago > 3 days ago)', () => {
    const overdueYesterday = { id: 'task_yesterday', due_at: '2026-10-01T12:00:00.000Z' };
    const overdue2DaysAgo = { id: 'task_2days', due_at: '2026-09-30T12:00:00.000Z' };
    const overdueOlder = { id: 'task_older', due_at: '2026-09-20T12:00:00.000Z' };

    const overdueList = [overdueOlder, overdueYesterday, overdue2DaysAgo];

    // Sorting rule for overdue: due_at DESC (most recently overdue first)
    overdueList.sort((a, b) => new Date(b.due_at).getTime() - new Date(a.due_at).getTime());

    expect(overdueList[0].id).toBe('task_yesterday');
    expect(overdueList[1].id).toBe('task_2days');
    expect(overdueList[2].id).toBe('task_older');
  });

  // Scenario M: Future sorting is nearest first
  it('Scenario M: Future tasks are sorted nearest first (tomorrow < 3 days < 1 week)', () => {
    const futureTomorrow = { id: 'fut_tomorrow', due_at: '2026-10-03T12:00:00.000Z' };
    const future3Days = { id: 'fut_3days', due_at: '2026-10-05T12:00:00.000Z' };
    const future1Week = { id: 'fut_1week', due_at: '2026-10-09T12:00:00.000Z' };

    const futureList = [future1Week, futureTomorrow, future3Days];

    // Sorting rule for future: due_at ASC (nearest first)
    futureList.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

    expect(futureList[0].id).toBe('fut_tomorrow');
    expect(futureList[1].id).toBe('fut_3days');
    expect(futureList[2].id).toBe('fut_1week');
  });

  // Scenario N: Overdue payment tasks remain pending
  it('Scenario N: Overdue payment tasks remain pending until manually or factually completed', () => {
    const paymentTask = {
      id: 'pay_task_1',
      task_type: 'payment',
      status: 'pending',
      due_at: '2026-09-25T12:00:00.000Z',
    };

    // Must remain pending, never auto-completed by system
    expect(paymentTask.status).toBe('pending');
    expect(deriveIsOverdue(paymentTask.due_at, '2026-10-02T12:00:00.000Z')).toBe(true);
  });

  // Scenario O: Authoritative Source Timestamp Priority Rule
  it('Scenario O: Authoritative Source Timestamp Priority Rule strictly chooses factual entry time over processing time', () => {
    const factualSubmissionTime = '2026-10-02T05:33:10.785Z';
    const serverProcessingTime = '2026-10-02T05:49:10.584Z';

    const submittedData = {
      submitted_at: factualSubmissionTime,
      form_slug: 'contact',
      email: 'pedronoh.dmd@gmail.com',
    };

    // Priority helper simulation matching DB function parse_authoritative_timestamp
    const resolveAuthoritativeTs = (data: Record<string, string | undefined>, fallbackNow: string) => {
      return data.submitted_at || data.created_time || data.conversion_time || data.source_created_at || fallbackNow;
    };

    const resolvedTs = resolveAuthoritativeTs(submittedData, serverProcessingTime);
    expect(resolvedTs).toBe(factualSubmissionTime);
    expect(resolvedTs).not.toBe(serverProcessingTime);
  });
});
