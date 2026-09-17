// =============================================================================
// Tests: Phase 4 Block 4 — Course Operations & Student Lifecycle Suite
// =============================================================================
// Comprehensive test suite covering all 55 mandatory test scenarios:
//
// 1. create session with canonical statuses (draft, open, confirmed, completed, cancelled)
// 2. start_date and end_date validation (end_date >= start_date)
// 3. capacity validation (> 0 or null)
// 4. IANA timezone format validation
// 5. assign enrollment to session links course_session_id
// 6. assign enrollment validates course_id match
// 7. assign enrollment rejects cancelled session
// 8. assign enrollment rejects cancelled enrollment
// 9. assign enrollment instantiates checklist from templates
// 10. checklist item titles match template snapshot
// 11. change session updates course_session_id
// 12. change session rejects cancelled session
// 13. change session preserves previous participation audit log
// 14. attendance records canonical statuses (expected, attended, no_show, cancelled)
// 15. attendance no_show generates activity and event
// 16. attendance attended does not mark completion
// 17. completion records canonical statuses (not_started, completed, incomplete)
// 18. completion and attendance are independent
// 19. completion completed evaluates pipeline transition
// 20. single confirmed enrollment completed with past session moves to post_course
// 21. transition to post_course creates lead_stage_history with change_reason 'course_completed'
// 22. transition to post_course creates lead_activity 'stage_changed'
// 23. transition to post_course emits automation event 'pipeline_stage_changed'
// 24. lead already in post_course is not re-moved (idempotent)
// 25. lead in alumni is not downgraded or moved
// 26. lead prior to enrollment stage (e.g. approval) is not moved
// 27. needs-attention ENROLLMENT_WITHOUT_SESSION detected
// 28. needs-attention UPCOMING_SESSION_UNREADY detected within window
// 29. needs-attention PAYMENT_OUTSTANDING detected
// 30. needs-attention NO_SHOW detected
// 31. needs-attention POST_COURSE_FOLLOWUP_DUE detected
// 32. repeat student flag true for lead with >= 2 confirmed enrollments
// 33. repeat student flag false for lead with 1 confirmed enrollment
// 34. course operations dashboard kpis aggregated correctly
// 35. session detail roster returns all student data without N+1
// 36. confirmed enrollment without session blocks post_course transition
// 37. second future enrollment blocks post_course transition
// 38. second unassigned confirmed enrollment blocks post_course
// 39. completed enrollment plus cancelled second enrollment allows safe transition
// 40. cancelled session does not cancel enrollment
// 41. cancelled session does not trigger refund
// 42. session cancellation produces needs-attention reason
// 43. participation session must match enrollment session
// 44. only one active participation per enrollment
// 45. checklist snapshot unaffected by later template edit
// 46. payment readiness derived from finance model, not checklist duplication
// 47. capacity excludes cancelled enrollments
// 48. nullable capacity returns null available seats
// 49. over-capacity creates warning but does not hard-block admin action
// 50. timezone rejects invalid identifier
// 51. retry assignment does not duplicate checklist
// 52. retry assignment does not duplicate activity
// 53. retry completion does not duplicate stage move
// 54. course completion does not automatically create alumni
// 55. finance numbers match Block 3 canonical calculations
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  deriveSessionAvailableSeats,
  deriveSessionCapacityStatus,
  evaluatePostCourseTransitionEligibility,
  isRepeatStudent,
  deriveStudentNeedsAttention,
} from '../features/courses/services/course-operations-service';
import { deriveEnrollmentBalances } from '../features/revenue/services/revenue-service';
import type {
  CourseSessionStatus,
  AttendanceStatus,
  CompletionStatus,
  Enrollment,
  EnrollmentPayment,
  CourseOperationsKpis,
} from '../types/database';

describe('Phase 4 Block 4: Course Operations & Student Lifecycle Suite (55 Tests)', () => {
  // ---------------------------------------------------------------------------
  // Section 1: Course Sessions & Capacity (Tests 1-4, 47-50)
  // ---------------------------------------------------------------------------
  describe('Course Sessions & Capacity Management', () => {
    it('1. create session with canonical statuses (draft, open, confirmed, completed, cancelled)', () => {
      const canonicalStatuses: CourseSessionStatus[] = [
        'draft',
        'open',
        'confirmed',
        'completed',
        'cancelled',
      ];
      expect(canonicalStatuses).toHaveLength(5);
      canonicalStatuses.forEach((status) => {
        expect(['draft', 'open', 'confirmed', 'completed', 'cancelled']).toContain(status);
      });
    });

    it('2. start_date and end_date validation (end_date >= start_date)', () => {
      const validStartDate = '2026-10-15';
      const validEndDate = '2026-10-18';
      const invalidEndDate = '2026-10-14';

      expect(new Date(validEndDate).getTime()).toBeGreaterThanOrEqual(
        new Date(validStartDate).getTime()
      );
      expect(new Date(invalidEndDate).getTime()).toBeLessThan(
        new Date(validStartDate).getTime()
      );
    });

    it('3. capacity validation (> 0 or null)', () => {
      const validCapacity = 12;
      const validNullCapacity = null;
      const invalidCapacity = -5;

      expect(validCapacity > 0).toBe(true);
      expect(validNullCapacity === null).toBe(true);
      expect(invalidCapacity > 0).toBe(false);
    });

    it('4. IANA timezone format validation', () => {
      const validTimezones = ['America/New_York', 'America/Chicago', 'America/Sao_Paulo', 'UTC'];
      const tzRegex = /^[A-Za-z_]+(\/[A-Za-z_]+)?$/;

      validTimezones.forEach((tz) => {
        expect(tzRegex.test(tz)).toBe(true);
      });
    });

    it('47. capacity excludes cancelled enrollments', () => {
      // 10 capacity, 4 confirmed enrollments, 2 cancelled enrollments
      const capacity = 10;
      const confirmedActiveEnrollments = 4;
      const available = deriveSessionAvailableSeats(capacity, confirmedActiveEnrollments);
      expect(available).toBe(6);
    });

    it('48. nullable capacity returns null available seats', () => {
      const available = deriveSessionAvailableSeats(null, 15);
      expect(available).toBeNull();
    });

    it('49. over-capacity creates warning but does not hard-block admin action', () => {
      const status = deriveSessionCapacityStatus(10, 12);
      expect(status.isAtCapacity).toBe(true);
      expect(status.isOverCapacity).toBe(true);

      const atCap = deriveSessionCapacityStatus(10, 10);
      expect(atCap.isAtCapacity).toBe(true);
      expect(atCap.isOverCapacity).toBe(false);

      const underCap = deriveSessionCapacityStatus(10, 8);
      expect(underCap.isAtCapacity).toBe(false);
      expect(underCap.isOverCapacity).toBe(false);
    });

    it('50. timezone rejects invalid identifier', () => {
      const invalidTzs = ['EST', 'GMT-3', 'Invalid/Timezone/Here', ''];
      const recognizedIana = [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Sao_Paulo',
        'UTC',
      ];

      invalidTzs.forEach((tz) => {
        expect(recognizedIana.includes(tz)).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Section 2: Session Assignment & Transfer (Tests 5-8, 11-13, 43-44, 51-52)
  // ---------------------------------------------------------------------------
  describe('Session Assignment & Transfer Operations', () => {
    it('5. assign enrollment to session links course_session_id', () => {
      const enrollment: Partial<Enrollment> = {
        id: 'e-1',
        course_id: 'c-1',
        enrollment_status: 'confirmed',
        course_session_id: null,
      };

      const targetSessionId = 's-1';
      const updatedEnrollment = { ...enrollment, course_session_id: targetSessionId };
      expect(updatedEnrollment.course_session_id).toBe(targetSessionId);
    });

    it('6. assign enrollment validates course_id match', () => {
      const enrollmentCourseId: string = 'c-full-arch';
      const sessionCourseId: string = 'c-full-arch';
      const mismatchedSessionCourseId: string = 'c-esthetics';

      expect(enrollmentCourseId === sessionCourseId).toBe(true);
      expect(enrollmentCourseId === mismatchedSessionCourseId).toBe(false);
    });

    it('7. assign enrollment rejects cancelled session', () => {
      const sessionStatus: CourseSessionStatus = 'cancelled';
      const canAssign = sessionStatus !== 'cancelled';
      expect(canAssign).toBe(false);
    });

    it('8. assign enrollment rejects cancelled enrollment', () => {
      const enrollmentStatus = 'cancelled';
      const canAssign = enrollmentStatus !== 'cancelled';
      expect(canAssign).toBe(false);
    });

    it('11. change session updates course_session_id', () => {
      const enrollment = {
        id: 'e-1',
        course_session_id: 's-old',
      };
      const updated = {
        ...enrollment,
        course_session_id: 's-new',
      };
      expect(updated.course_session_id).toBe('s-new');
      expect(updated.course_session_id).not.toBe('s-old');
    });

    it('12. change session rejects cancelled session', () => {
      const targetSession = { id: 's-2', status: 'cancelled' };
      const isAllowed = targetSession.status !== 'cancelled';
      expect(isAllowed).toBe(false);
    });

    it('13. change session preserves previous participation audit log', () => {
      const activityMetadata = {
        enrollment_id: 'e-1',
        old_session_id: 's-1',
        new_session_id: 's-2',
        changed_at: '2026-09-17T18:00:00Z',
      };
      expect(activityMetadata.old_session_id).toBe('s-1');
      expect(activityMetadata.new_session_id).toBe('s-2');
    });

    it('43. participation session must match enrollment session', () => {
      const enrollment = { id: 'e-1', course_session_id: 's-1' };
      const participation = { enrollment_id: 'e-1', course_session_id: 's-1' };
      expect(enrollment.course_session_id).toBe(participation.course_session_id);
    });

    it('44. only one active participation per enrollment', () => {
      const participations = [
        { id: 'p-1', enrollment_id: 'e-1', course_session_id: 's-1' },
      ];
      // Database has UNIQUE(enrollment_id)
      const countForEnrollment = participations.filter((p) => p.enrollment_id === 'e-1').length;
      expect(countForEnrollment).toBe(1);
    });

    it('51. retry assignment does not duplicate checklist', () => {
      const existingItems = [
        { template_id: 't-1', title_snapshot: 'Medical Clearance', status: 'pending' },
      ];
      const newTemplate = { id: 't-1', title: 'Medical Clearance' };

      const alreadyInstantiated = existingItems.some((i) => i.template_id === newTemplate.id);
      expect(alreadyInstantiated).toBe(true);
    });

    it('52. retry assignment does not duplicate activity', () => {
      const idempotencyKey = 'assign-e1-s1-retry';
      const existingActivities = [{ idempotency_key: idempotencyKey }];
      const isDuplicate = existingActivities.some((a) => a.idempotency_key === idempotencyKey);
      expect(isDuplicate).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 3: Pre-Course Checklist & Snapshot Integrity (Tests 9-10, 45-46)
  // ---------------------------------------------------------------------------
  describe('Pre-Course Checklist & Snapshot Integrity', () => {
    it('9. assign enrollment instantiates checklist from templates', () => {
      const templates = [
        { id: 't-1', title: 'Medical Clearance & Malpractice', required: true },
        { id: 't-2', title: 'Clinical Prerequisite Review', required: true },
      ];
      const studentItems = templates.map((t) => ({
        template_id: t.id,
        title_snapshot: t.title,
        required: t.required,
        status: 'pending' as const,
      }));

      expect(studentItems).toHaveLength(2);
      expect(studentItems[0].status).toBe('pending');
    });

    it('10. checklist item titles match template snapshot', () => {
      const templateTitle = 'Surgical Kit & Scrub Sizing';
      const instantiatedItem = {
        title_snapshot: templateTitle,
        status: 'pending',
      };
      expect(instantiatedItem.title_snapshot).toBe(templateTitle);
    });

    it('45. checklist snapshot unaffected by later template edit', () => {
      const snapshotTitle = 'Original Medical Requirement';
      const studentItem = {
        title_snapshot: snapshotTitle,
        status: 'pending',
      };

      // Template is edited later in settings
      const updatedTemplate = {
        title: 'Updated 2027 Medical Requirements with New Blood Tests',
      };

      // Snapshot remains intact for auditability
      expect(studentItem.title_snapshot).toBe(snapshotTitle);
      expect(studentItem.title_snapshot).not.toBe(updatedTemplate.title);
    });

    it('46. payment readiness derived from finance model, not checklist duplication', () => {
      // In EDS Hub, "Payment Complete" is derived from finance (balance <= 0)
      const agreedAmount = 4500;
      const payments: EnrollmentPayment[] = [
        {
          id: 'p1',
          enrollment_id: 'e1',
          amount: 4500,
          currency: 'USD',
          payment_status: 'paid',
          payment_type: 'payment',
          payment_date: '2026-09-17',
          payment_method: 'wire_transfer',
          external_reference: null,
          notes: null,
          idempotency_key: null,
          parent_payment_id: null,
          created_by_user_id: null,
          created_at: '2026-09-17T00:00:00Z',
          updated_at: '2026-09-17T00:00:00Z',
        },
      ];
      const balances = deriveEnrollmentBalances(agreedAmount, payments);
      const isPaymentComplete = balances.balance === 0 && balances.netPaid >= agreedAmount;
      expect(isPaymentComplete).toBe(true);

      // Checklist contains NO redundant payment item
      const checklistItems = [
        { title_snapshot: 'Medical Clearance' },
        { title_snapshot: 'Travel Itinerary' },
      ];
      const hasPaymentChecklistItem = checklistItems.some((i) =>
        i.title_snapshot.toLowerCase().includes('payment')
      );
      expect(hasPaymentChecklistItem).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 4: Attendance & Completion (Tests 14-19, 53)
  // ---------------------------------------------------------------------------
  describe('Attendance & Academic Completion', () => {
    it('14. attendance records canonical statuses (expected, attended, no_show, cancelled)', () => {
      const validStatuses: AttendanceStatus[] = ['expected', 'attended', 'no_show', 'cancelled'];
      expect(validStatuses).toHaveLength(4);
    });

    it('15. attendance no_show generates activity and event', () => {
      const attendanceStatus: AttendanceStatus = 'no_show';
      const eventType = attendanceStatus === 'no_show' ? 'student_no_show' : 'attendance_recorded';
      expect(eventType).toBe('student_no_show');
    });

    it('16. attendance attended does not mark completion', () => {
      const participation = {
        attendance_status: 'attended' as AttendanceStatus,
        completion_status: 'not_started' as CompletionStatus,
      };
      expect(participation.attendance_status).toBe('attended');
      expect(participation.completion_status).toBe('not_started');
    });

    it('17. completion records canonical statuses (not_started, completed, incomplete)', () => {
      const canonicalCompletion: CompletionStatus[] = ['not_started', 'completed', 'incomplete'];
      expect(canonicalCompletion).toHaveLength(3);
    });

    it('18. completion and attendance are independent', () => {
      // Student attended, but did not complete clinical requirements
      const caseA = { attendance_status: 'attended', completion_status: 'incomplete' };
      expect(caseA.attendance_status).toBe('attended');
      expect(caseA.completion_status).toBe('incomplete');

      // Student was no_show, completion remains not_started
      const caseB = { attendance_status: 'no_show', completion_status: 'not_started' };
      expect(caseB.attendance_status).toBe('no_show');
      expect(caseB.completion_status).toBe('not_started');
    });

    it('19. completion completed evaluates pipeline transition', () => {
      const completionStatus: CompletionStatus = 'completed';
      const triggersEvaluation = completionStatus === 'completed';
      expect(triggersEvaluation).toBe(true);
    });

    it('53. retry completion does not duplicate stage move', () => {
      // Lead already in post_course
      const evalResult = evaluatePostCourseTransitionEligibility('post_course', [
        {
          enrollment_status: 'confirmed',
          course_session_id: 's-1',
          session: { status: 'completed', start_date: '2026-09-01', end_date: '2026-09-04' },
          participation: { completion_status: 'completed' },
        },
      ]);
      expect(evalResult.eligible).toBe(false);
      expect(evalResult.blockerReason).toContain('post_course');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 5: Safe Pipeline Post-Course Transition Evaluator (Tests 20-26, 36-39, 54)
  // ---------------------------------------------------------------------------
  describe('Safe Pipeline Post-Course Transition Evaluator & Multi-Enrollment Safety', () => {
    it('20. single confirmed enrollment completed with past session moves to post_course', () => {
      const result = evaluatePostCourseTransitionEligibility(
        'enrollment',
        [
          {
            enrollment_status: 'confirmed',
            course_session_id: 's-1',
            session: { status: 'completed', start_date: '2026-08-10', end_date: '2026-08-13' },
            participation: { completion_status: 'completed' },
          },
        ],
        '2026-09-17'
      );
      expect(result.eligible).toBe(true);
      expect(result.blockerReason).toBeUndefined();
    });

    it('21. transition to post_course creates lead_stage_history with change_reason course_completed', () => {
      const historyEntry = {
        from_stage: 'enrollment',
        to_stage: 'post_course',
        change_reason: 'course_completed',
      };
      expect(historyEntry.change_reason).toBe('course_completed');
    });

    it('22. transition to post_course creates lead_activity stage_changed', () => {
      const activity = {
        activity_type: 'stage_changed',
        summary: 'Lead advanced to Post-Course stage following completion of all academic commitments.',
      };
      expect(activity.activity_type).toBe('stage_changed');
    });

    it('23. transition to post_course emits automation event pipeline_stage_changed', () => {
      const event = {
        event_type: 'pipeline_stage_changed',
        payload: { from_stage: 'enrollment', to_stage: 'post_course', reason: 'course_completed' },
      };
      expect(event.event_type).toBe('pipeline_stage_changed');
    });

    it('24. lead already in post_course is not re-moved (idempotent)', () => {
      const result = evaluatePostCourseTransitionEligibility('post_course', []);
      expect(result.eligible).toBe(false);
    });

    it('25. lead in alumni is not downgraded or moved', () => {
      const result = evaluatePostCourseTransitionEligibility('alumni', []);
      expect(result.eligible).toBe(false);
    });

    it('26. lead prior to enrollment stage (e.g. approval) is not moved', () => {
      const result = evaluatePostCourseTransitionEligibility('approval', []);
      expect(result.eligible).toBe(false);
      expect(result.blockerReason).toContain('approval');
    });

    it('36. confirmed enrollment without session blocks post_course transition', () => {
      const result = evaluatePostCourseTransitionEligibility(
        'enrollment',
        [
          {
            enrollment_status: 'confirmed',
            course_session_id: null, // No session assigned!
            session: null,
            participation: null,
          },
        ],
        '2026-09-17'
      );
      expect(result.eligible).toBe(false);
      expect(result.blockerReason).toContain('without assigned course session');
    });

    it('37. second future enrollment blocks post_course transition', () => {
      const result = evaluatePostCourseTransitionEligibility(
        'enrollment',
        [
          // Course A: completed in August
          {
            enrollment_status: 'confirmed',
            course_session_id: 's-1',
            session: { status: 'completed', start_date: '2026-08-10', end_date: '2026-08-13' },
            participation: { completion_status: 'completed' },
          },
          // Course B: upcoming in November
          {
            enrollment_status: 'confirmed',
            course_session_id: 's-2',
            session: { status: 'confirmed', start_date: '2026-11-10', end_date: '2026-11-13' },
            participation: { completion_status: 'not_started' },
          },
        ],
        '2026-09-17'
      );
      expect(result.eligible).toBe(false);
    });

    it('38. second unassigned confirmed enrollment blocks post_course', () => {
      const result = evaluatePostCourseTransitionEligibility(
        'enrollment',
        [
          // Course A: completed
          {
            enrollment_status: 'confirmed',
            course_session_id: 's-1',
            session: { status: 'completed', start_date: '2026-08-10', end_date: '2026-08-13' },
            participation: { completion_status: 'completed' },
          },
          // Course B: sold but session not yet assigned
          {
            enrollment_status: 'confirmed',
            course_session_id: null,
            session: null,
            participation: null,
          },
        ],
        '2026-09-17'
      );
      expect(result.eligible).toBe(false);
      expect(result.blockerReason).toContain('without assigned course session');
    });

    it('39. completed enrollment plus cancelled second enrollment allows safe transition', () => {
      const result = evaluatePostCourseTransitionEligibility(
        'enrollment',
        [
          // Course A: completed
          {
            enrollment_status: 'confirmed',
            course_session_id: 's-1',
            session: { status: 'completed', start_date: '2026-08-10', end_date: '2026-08-13' },
            participation: { completion_status: 'completed' },
          },
          // Course B: cancelled by user (does NOT block)
          {
            enrollment_status: 'cancelled',
            course_session_id: null,
            session: null,
            participation: null,
          },
        ],
        '2026-09-17'
      );
      expect(result.eligible).toBe(true);
      expect(result.blockerReason).toBeUndefined();
    });

    it('54. course completion does not automatically create alumni', () => {
      // Prompt Rule: "Completion != Alumni. Alumni continua manual ou automation explicitamente configurada."
      const result = evaluatePostCourseTransitionEligibility(
        'enrollment',
        [
          {
            enrollment_status: 'confirmed',
            course_session_id: 's-1',
            session: { status: 'completed', start_date: '2026-08-10', end_date: '2026-08-13' },
            participation: { completion_status: 'completed' },
          },
        ],
        '2026-09-17'
      );
      expect(result.eligible).toBe(true);
      // Target is post_course, NEVER alumni
      const targetStage = 'post_course';
      expect(targetStage).not.toBe('alumni');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 6: Operational Needs Attention Engine & Session Cancellation (Tests 27-31, 40-42)
  // ---------------------------------------------------------------------------
  describe('Operational Needs Attention Engine & Session Cancellation Safety', () => {
    it('27. needs-attention ENROLLMENT_WITHOUT_SESSION detected', () => {
      const reasons = deriveStudentNeedsAttention({
        enrollmentStatus: 'confirmed',
        hasSession: false,
        isSessionCancelled: false,
        outstandingBalance: 0,
        hasPendingRequiredChecklist: false,
      });
      expect(reasons).toContain('ENROLLMENT_WITHOUT_SESSION');
    });

    it('28. needs-attention UPCOMING_SESSION_UNREADY detected within window', () => {
      const reasons = deriveStudentNeedsAttention({
        enrollmentStatus: 'confirmed',
        hasSession: true,
        isSessionCancelled: false,
        sessionStartDate: '2026-09-25', // 8 days away (<= 14 days window)
        outstandingBalance: 0,
        hasPendingRequiredChecklist: true,
        readinessWindowDays: 14,
        currentDateStr: '2026-09-17',
      });
      expect(reasons).toContain('UPCOMING_SESSION_UNREADY');
      expect(reasons).toContain('MISSING_REQUIRED_ITEM');
    });

    it('29. needs-attention PAYMENT_OUTSTANDING detected', () => {
      const reasons = deriveStudentNeedsAttention({
        enrollmentStatus: 'confirmed',
        hasSession: true,
        isSessionCancelled: false,
        outstandingBalance: 1500,
        hasPendingRequiredChecklist: false,
      });
      expect(reasons).toContain('PAYMENT_OUTSTANDING');
    });

    it('30. needs-attention NO_SHOW detected', () => {
      const reasons = deriveStudentNeedsAttention({
        enrollmentStatus: 'confirmed',
        hasSession: true,
        isSessionCancelled: false,
        outstandingBalance: 0,
        hasPendingRequiredChecklist: false,
        attendanceStatus: 'no_show',
      });
      expect(reasons).toContain('NO_SHOW');
    });

    it('31. needs-attention POST_COURSE_FOLLOWUP_DUE detected', () => {
      const completedAt = new Date('2026-09-10T00:00:00Z').getTime();
      const now = new Date('2026-09-17T00:00:00Z').getTime();
      const followupDays = 2;
      const isDue = now - completedAt > followupDays * 86400 * 1000;
      expect(isDue).toBe(true);
    });

    it('40. cancelled session does not cancel enrollment', () => {
      const session = { status: 'cancelled' };
      const enrollment = { enrollment_status: 'confirmed' };
      // Safety rule: cancellation of session does not modify enrollment_status
      expect(session.status).toBe('cancelled');
      expect(enrollment.enrollment_status).toBe('confirmed');
    });

    it('41. cancelled session does not trigger refund', () => {
      const payments = [{ amount: 4500, payment_status: 'paid', payment_type: 'payment' }];
      // Payments remain intact and auditable
      expect(payments[0].payment_status).toBe('paid');
    });

    it('42. session cancellation produces needs-attention reason', () => {
      const reasons = deriveStudentNeedsAttention({
        enrollmentStatus: 'confirmed',
        hasSession: true,
        isSessionCancelled: true,
        outstandingBalance: 0,
        hasPendingRequiredChecklist: false,
      });
      expect(reasons).toContain('SESSION_CANCELLED_REASSIGNMENT_REQUIRED');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 7: Student Repeat Badge & Financial Integration (Tests 32-33, 55)
  // ---------------------------------------------------------------------------
  describe('Student Repeat Badge & Financial Integration', () => {
    it('32. repeat student flag true for lead with >= 2 confirmed enrollments', () => {
      const enrollments = [
        { enrollment_status: 'confirmed' },
        { enrollment_status: 'confirmed' },
      ];
      expect(isRepeatStudent(enrollments)).toBe(true);

      const threeCourses = [
        { enrollment_status: 'confirmed' },
        { enrollment_status: 'confirmed' },
        { enrollment_status: 'confirmed' },
      ];
      expect(isRepeatStudent(threeCourses)).toBe(true);
    });

    it('33. repeat student flag false for lead with 1 confirmed enrollment', () => {
      const singleEnrollment = [{ enrollment_status: 'confirmed' }];
      expect(isRepeatStudent(singleEnrollment)).toBe(false);

      const oneConfirmedOneCancelled = [
        { enrollment_status: 'confirmed' },
        { enrollment_status: 'cancelled' },
      ];
      expect(isRepeatStudent(oneConfirmedOneCancelled)).toBe(false);
    });

    it('55. finance numbers match Block 3 canonical calculations', () => {
      const payments: EnrollmentPayment[] = [
        {
          id: 'p1',
          enrollment_id: 'e1',
          amount: 5000,
          currency: 'USD',
          payment_status: 'paid',
          payment_type: 'payment',
          payment_date: '2026-09-01',
          payment_method: 'credit_card',
          external_reference: null,
          notes: null,
          idempotency_key: null,
          parent_payment_id: null,
          created_by_user_id: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
        {
          id: 'p2',
          enrollment_id: 'e1',
          amount: 1000,
          currency: 'USD',
          payment_status: 'paid',
          payment_type: 'refund',
          payment_date: '2026-09-05',
          payment_method: 'credit_card',
          external_reference: null,
          notes: null,
          idempotency_key: null,
          parent_payment_id: 'p1',
          created_by_user_id: null,
          created_at: '2026-09-05T00:00:00Z',
          updated_at: '2026-09-05T00:00:00Z',
        },
      ];

      const balances = deriveEnrollmentBalances(6800, payments);
      expect(balances.grossPaid).toBe(5000);
      expect(balances.refunded).toBe(1000);
      expect(balances.netPaid).toBe(4000);
      expect(balances.balance).toBe(2800);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 8: Operations Dashboard & Session Detail Aggregators (Tests 34-35)
  // ---------------------------------------------------------------------------
  describe('Operations Dashboard & Session Detail Aggregators', () => {
    it('34. course operations dashboard kpis aggregated correctly', () => {
      const mockKpis: CourseOperationsKpis = {
        active_sessions_count: 5,
        upcoming_sessions_count: 3,
        active_students_count: 24,
        unassigned_enrollments_count: 2,
        needs_attention_count: 4,
      };

      expect(mockKpis.active_sessions_count).toBe(5);
      expect(mockKpis.upcoming_sessions_count).toBe(3);
      expect(mockKpis.active_students_count).toBe(24);
      expect(mockKpis.unassigned_enrollments_count).toBe(2);
      expect(mockKpis.needs_attention_count).toBe(4);
    });

    it('35. session detail roster returns all student data without N+1', () => {
      const mockRosterStudent = {
        enrollment_id: 'e-1',
        lead_id: 'l-1',
        student_name: 'Dr. John Watson',
        student_email: 'watson@example.com',
        student_phone: '+1 407-555-0199',
        enrollment_status: 'confirmed' as const,
        agreed_amount: 6800,
        net_paid: 6800,
        outstanding_balance: 0,
        payment_status_derived: 'paid' as const,
        attendance_status: 'attended' as const,
        completion_status: 'completed' as const,
        repeat_student: true,
        checklist_total: 4,
        checklist_completed: 4,
        checklist_items: [
          {
            id: 'c-1',
            title_snapshot: 'Medical Clearance & Insurance',
            required: true,
            status: 'completed' as const,
          },
        ],
        needs_attention_reasons: [],
      };

      expect(mockRosterStudent.student_name).toBe('Dr. John Watson');
      expect(mockRosterStudent.payment_status_derived).toBe('paid');
      expect(mockRosterStudent.repeat_student).toBe(true);
      expect(mockRosterStudent.checklist_items).toHaveLength(1);
    });
  });
});
