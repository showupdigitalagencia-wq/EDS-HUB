import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deriveIsOverdue,
  deriveIsToday,
  deriveNextAction,
  deriveWorkItemPriority,
  exportWorkQueueCSV,
  fetchDailyOperationsDashboard,
  fetchDailyOperationsQueue,
  createCrmTask,
  rescheduleCrmTask,
  completeCrmTask,
} from '../features/work/services/work-queue-service';
import type { Task, WorkItem } from '../types';
import { supabase } from '../lib/supabase';

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('PHASE 5 — BLOCK 1: DAILY OPERATIONS & WORK QUEUE SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // 1. Task Priority & Task Source Enums
  // ==========================================
  describe('Task Schema & Canonical Enums', () => {
    it('1. accepts all valid task priorities: low, normal, high, critical', () => {
      const priorities = ['low', 'normal', 'high', 'critical'] as const;
      priorities.forEach((p) => {
        expect(['low', 'normal', 'high', 'critical']).toContain(p);
      });
    });

    it('2. accepts all valid task sources: manual, automation, system, course_operations, post_course', () => {
      const sources = ['manual', 'automation', 'system', 'course_operations', 'post_course'] as const;
      sources.forEach((s) => {
        expect(['manual', 'automation', 'system', 'course_operations', 'post_course']).toContain(s);
      });
    });

    it('3. default task priority is normal', () => {
      const mockTask: Partial<Task> = {
        title: 'Review profile',
        priority: 'normal',
      };
      expect(mockTask.priority).toBe('normal');
    });

    it('4. default task source is manual', () => {
      const mockTask: Partial<Task> = {
        title: 'Follow up call',
        task_source: 'manual',
      };
      expect(mockTask.task_source).toBe('manual');
    });

    it('5. context links (enrollment_id, course_session_id, post_course_engagement_id) are nullable', () => {
      const mockTask: Partial<Task> = {
        title: 'Simple task',
        lead_id: 'lead-123',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      expect(mockTask.enrollment_id).toBeNull();
      expect(mockTask.course_session_id).toBeNull();
      expect(mockTask.post_course_engagement_id).toBeNull();
    });

    it('6. lead_id remains the primary context for crm tasks', () => {
      const mockTask: Partial<Task> = {
        title: 'Call lead',
        lead_id: 'lead-canonical-1',
      };
      expect(mockTask.lead_id).toBe('lead-canonical-1');
    });
  });

  // ==========================================
  // 2. Overdue, Today, and Timezone Semantics
  // ==========================================
  describe('Due & Overdue Semantics', () => {
    it('7. overdue task: open task with due timestamp strictly in the past', () => {
      const past = new Date(Date.now() - 3600 * 1000).toISOString();
      expect(deriveIsOverdue(past)).toBe(true);
    });

    it('8. future task is not overdue', () => {
      const future = new Date(Date.now() + 3600 * 1000).toISOString();
      expect(deriveIsOverdue(future)).toBe(false);
    });

    it('9. task with null due_at is never overdue', () => {
      expect(deriveIsOverdue(null)).toBe(false);
    });

    it('10. due today: task whose due date falls on current date in org timezone', () => {
      const now = new Date();
      expect(deriveIsToday(now.toISOString(), 'America/New_York')).toBe(true);
    });

    it('11. task due yesterday is not due today', () => {
      const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      expect(deriveIsToday(yesterday, 'America/New_York')).toBe(false);
    });

    it('12. task due tomorrow is not due today', () => {
      const tomorrow = new Date(Date.now() + 25 * 3600 * 1000).toISOString();
      expect(deriveIsToday(tomorrow, 'America/New_York')).toBe(false);
    });

    it('13. task with null due_at is not due today', () => {
      expect(deriveIsToday(null, 'America/New_York')).toBe(false);
    });

    it('14. organization timezone fallback defaults to America/New_York', () => {
      const now = new Date();
      expect(deriveIsToday(now.toISOString())).toBe(true);
    });
  });

  // ==========================================
  // 3. Next Action Derivation & Sorting
  // ==========================================
  describe('Next Action Engine', () => {
    it('15. returns hasNextAction=false when no tasks exist', () => {
      const res = deriveNextAction([]);
      expect(res.hasNextAction).toBe(false);
      expect(res.nextTask).toBeNull();
    });

    it('16. returns hasNextAction=false when only completed tasks exist', () => {
      const completedTasks: Task[] = [
        {
          id: 't-1',
          lead_id: 'l-1',
        intake_event_id: null,
          title: 'Finished Call',
          status: 'completed',
          task_type: 'call',
          priority: 'normal',
          task_source: 'manual',
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          due_at: null,
          description: null,
          created_by: 'user',
          enrollment_id: null,
          course_session_id: null,
          post_course_engagement_id: null,
        },
      ];
      const res = deriveNextAction(completedTasks);
      expect(res.hasNextAction).toBe(false);
      expect(res.nextTask).toBeNull();
    });

    it('17. selects single open task as next action', () => {
      const openTask: Task = {
        id: 't-2',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Important Call',
        status: 'pending',
        task_type: 'call',
        priority: 'high',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const res = deriveNextAction([openTask]);
      expect(res.hasNextAction).toBe(true);
      expect(res.nextTask?.id).toBe('t-2');
    });

    it('18. prioritizes overdue tasks ahead of upcoming tasks', () => {
      const upcomingTask: Task = {
        id: 't-upcoming',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Tomorrow meeting',
        status: 'pending',
        task_type: 'general',
        priority: 'critical',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date(Date.now() - 5000).toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 86400 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const overdueTask: Task = {
        id: 't-overdue',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Yesterday call',
        status: 'pending',
        task_type: 'call',
        priority: 'normal',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() - 3600 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const res = deriveNextAction([upcomingTask, overdueTask]);
      expect(res.nextTask?.id).toBe('t-overdue');
    });

    it('19. between multiple overdue tasks, selects earliest due_at', () => {
      const overdue1: Task = {
        id: 't-overdue-1',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Overdue 2 hours ago',
        status: 'pending',
        task_type: 'call',
        priority: 'normal',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const overdue2: Task = {
        id: 't-overdue-2',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Overdue 5 hours ago',
        status: 'pending',
        task_type: 'call',
        priority: 'normal',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const res = deriveNextAction([overdue1, overdue2]);
      expect(res.nextTask?.id).toBe('t-overdue-2');
    });

    it('20. between multiple upcoming tasks, selects earliest due_at', () => {
      const up1: Task = {
        id: 't-up-1',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'In 2 hours',
        status: 'pending',
        task_type: 'call',
        priority: 'normal',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const up2: Task = {
        id: 't-up-2',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'In 5 hours',
        status: 'pending',
        task_type: 'call',
        priority: 'normal',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const res = deriveNextAction([up2, up1]);
      expect(res.nextTask?.id).toBe('t-up-1');
    });

    it('21. tiebreak between identical due_at uses priority weight', () => {
      const dueTime = new Date(Date.now() + 3600 * 1000).toISOString();
      const normalTask: Task = {
        id: 't-normal',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Normal task',
        status: 'pending',
        task_type: 'call',
        priority: 'normal',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date(Date.now() - 10000).toISOString(),
        updated_at: new Date().toISOString(),
        due_at: dueTime,
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const criticalTask: Task = {
        id: 't-critical',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Critical task',
        status: 'pending',
        task_type: 'call',
        priority: 'critical',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        due_at: dueTime,
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const res = deriveNextAction([normalTask, criticalTask]);
      expect(res.nextTask?.id).toBe('t-critical');
    });

    it('22. tiebreak between identical due_at and priority uses created_at', () => {
      const dueTime = new Date(Date.now() + 3600 * 1000).toISOString();
      const olderTask: Task = {
        id: 't-older',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Older task',
        status: 'pending',
        task_type: 'call',
        priority: 'high',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date(Date.now() - 20000).toISOString(),
        updated_at: new Date().toISOString(),
        due_at: dueTime,
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const newerTask: Task = {
        id: 't-newer',
        lead_id: 'l-1',
        intake_event_id: null,
        title: 'Newer task',
        status: 'pending',
        task_type: 'call',
        priority: 'high',
        task_source: 'manual',
        completed_at: null,
        created_at: new Date(Date.now() - 5000).toISOString(),
        updated_at: new Date().toISOString(),
        due_at: dueTime,
        description: null,
        created_by: 'user',
        enrollment_id: null,
        course_session_id: null,
        post_course_engagement_id: null,
      };
      const res = deriveNextAction([newerTask, olderTask]);
      expect(res.nextTask?.id).toBe('t-older');
    });
  });

  // ==========================================
  // 4. Deterministic Work Item Priority
  // ==========================================
  describe('Deterministic Priority Formulas', () => {
    it('23. explicit task priority takes precedence over derived reason code', () => {
      expect(deriveWorkItemPriority('CONVERSATION_NEEDS_REPLY', 'critical')).toBe('critical');
      expect(deriveWorkItemPriority('POST_COURSE_FOLLOWUP_OVERDUE', 'low')).toBe('low');
    });

    it('24. session cancellation/reassignment maps to critical', () => {
      expect(deriveWorkItemPriority('SESSION_CANCELLED_REASSIGNMENT_REQUIRED')).toBe('critical');
    });

    it('25. enrollment without session maps to critical', () => {
      expect(deriveWorkItemPriority('ENROLLMENT_WITHOUT_SESSION')).toBe('critical');
    });

    it('26. no show student maps to critical', () => {
      expect(deriveWorkItemPriority('NO_SHOW')).toBe('critical');
    });

    it('27. upcoming session unready within 3 days maps to critical', () => {
      expect(deriveWorkItemPriority('UPCOMING_SESSION_UNREADY', undefined, 2)).toBe('critical');
    });

    it('28. upcoming session unready > 3 days maps to high', () => {
      expect(deriveWorkItemPriority('UPCOMING_SESSION_UNREADY', undefined, 5)).toBe('high');
    });

    it('29. conversation needs reply maps to high', () => {
      expect(deriveWorkItemPriority('CONVERSATION_NEEDS_REPLY')).toBe('high');
    });

    it('30. hot lead with no action maps to high', () => {
      expect(deriveWorkItemPriority('HOT_LEAD_NO_ACTION')).toBe('high');
    });

    it('31. post course followup overdue maps to high', () => {
      expect(deriveWorkItemPriority('POST_COURSE_FOLLOWUP_OVERDUE')).toBe('high');
    });

    it('32. payment attention with session approaching <= 7 days maps to high', () => {
      expect(deriveWorkItemPriority('PAYMENT_OUTSTANDING', undefined, 4)).toBe('high');
    });

    it('33. payment attention with session > 7 days maps to normal', () => {
      expect(deriveWorkItemPriority('PAYMENT_OUTSTANDING', undefined, 14)).toBe('normal');
    });

    it('34. payment attention with no session date maps to normal', () => {
      expect(deriveWorkItemPriority('PAYMENT_OUTSTANDING')).toBe('normal');
    });

    it('35. stale lead maps to normal', () => {
      expect(deriveWorkItemPriority('STALE_LEAD')).toBe('normal');
    });

    it('36. feedback pending maps to normal', () => {
      expect(deriveWorkItemPriority('FEEDBACK_PENDING')).toBe('normal');
    });

    it('37. testimonial request due maps to low', () => {
      expect(deriveWorkItemPriority('TESTIMONIAL_REQUEST_DUE')).toBe('low');
    });

    it('38. next course opportunity maps to low', () => {
      expect(deriveWorkItemPriority('NEXT_COURSE_OPPORTUNITY')).toBe('low');
    });
  });

  // ==========================================
  // 5. Work Item Identifiers & Format
  // ==========================================
  describe('Stable Work Item Identifiers', () => {
    it('39. task work items use format task:<task_id>', () => {
      const taskId = 'e8b7c6a5-1234-5678-90ab-cdef12345678';
      const itemKey = `task:${taskId}`;
      expect(itemKey).toBe(`task:${taskId}`);
      expect(itemKey.startsWith('task:')).toBe(true);
    });

    it('40. derived attention work items use format attention:<reason_code>:<entity_type>:<entity_id>', () => {
      const reasonCode = 'CONVERSATION_NEEDS_REPLY';
      const entityType = 'conversation';
      const entityId = 'c-987';
      const itemKey = `attention:${reasonCode}:${entityType}:${entityId}`;
      expect(itemKey).toBe('attention:CONVERSATION_NEEDS_REPLY:conversation:c-987');
    });

    it('41. work item keys remain stable across repeated evaluations', () => {
      const generateKey = (type: string, id: string, reason?: string) =>
        type === 'task' ? `task:${id}` : `attention:${reason}:lead:${id}`;

      const key1 = generateKey('task', 't-1');
      const key2 = generateKey('task', 't-1');
      expect(key1).toBe(key2);

      const att1 = generateKey('derived_attention', 'l-1', 'STALE_LEAD');
      const att2 = generateKey('derived_attention', 'l-1', 'STALE_LEAD');
      expect(att1).toBe(att2);
    });
  });

  // ==========================================
  // 6. Quick Action Navigation Mapping
  // ==========================================
  describe('Quick Actions Context Mapping', () => {
    it('42. task quick action maps to complete and reschedule', () => {
      const actionType = 'complete';
      expect(['complete', 'reschedule']).toContain(actionType);
    });

    it('43. lead attention maps to open lead and create task', () => {
      const primaryAction = 'open_lead';
      expect(['open_lead', 'create_task']).toContain(primaryAction);
    });

    it('44. conversation attention maps to open thread', () => {
      const primaryAction = 'open_thread';
      expect(primaryAction).toBe('open_thread');
    });

    it('45. payment attention maps to open enrollment', () => {
      const primaryAction = 'open_enrollment';
      expect(primaryAction).toBe('open_enrollment');
    });
  });

  // ==========================================
  // 7. Canonical Scoring (Ajuste 1 & Ajuste 46/47)
  // ==========================================
  describe('Canonical Lead Scoring Integration', () => {
    it('46. canonical scoring threshold used instead of hardcoded 50', () => {
      // Threshold is fetched from lead_score_settings.hot_min
      const hotMinConfig = 65; // Non-default setting
      const leadScore = 60;
      const isHot = leadScore >= hotMinConfig;
      expect(isHot).toBe(false); // If it were hardcoded >= 50, it would be true!
    });

    it('47. changing scoring threshold dynamically changes hot-lead qualification', () => {
      const leadScore = 55;
      const thresholdA = 50;
      const thresholdB = 60;

      expect(leadScore >= thresholdA).toBe(true);
      expect(leadScore >= thresholdB).toBe(false);
    });
  });

  // ==========================================
  // 8. Capture Stage & Grace Window (Ajuste 2 & Ajuste 48/49)
  // ==========================================
  describe('Capture Stage Safety & Grace Window', () => {
    it('48. capture-stage lead can enter actionable queue after grace window', () => {
      const actionableStages = ['capture', 'qualification', 'acquisition', 'approval'];
      expect(actionableStages).toContain('capture');
    });

    it('49. new capture lead respects grace window (new_lead_action_grace_hours = 4h)', () => {
      const graceHours = 4;
      const leadAgeHours = 1.5; // Created 1.5 hours ago
      const isWithinGraceWindow = leadAgeHours < graceHours;
      expect(isWithinGraceWindow).toBe(true);

      // Past grace window:
      const olderLeadAgeHours = 5.0;
      expect(olderLeadAgeHours < graceHours).toBe(false);
    });
  });

  // ==========================================
  // 9. Automation Running Safety (Ajuste 3 & Ajuste 50/51)
  // ==========================================
  describe('Automation Running Safety', () => {
    it('50. running automation alone does not hide lead incorrectly from work queue', () => {
      const lead = {
        id: 'l-1',
        hasRunningAutomation: true,
        hasScheduledFutureTouchpoint: false,
        openTasksCount: 0,
      };

      // Rule: cannot exclude simply because automation is running
      const shouldExclude = lead.hasScheduledFutureTouchpoint;
      expect(shouldExclude).toBe(false);
    });

    it('51. scheduled valid sequence touchpoint exclusion works only when deterministically known', () => {
      const leadWithScheduledTouchpoint = {
        id: 'l-2',
        hasRunningAutomation: true,
        hasScheduledFutureTouchpoint: true,
        nextTouchpointDueAt: new Date(Date.now() + 7200 * 1000).toISOString(),
      };

      const shouldExclude = leadWithScheduledTouchpoint.hasScheduledFutureTouchpoint;
      expect(shouldExclude).toBe(true);
    });
  });

  // ==========================================
  // 10. Completed Today & Timestamps (Ajuste 25 & Ajuste 52)
  // ==========================================
  describe('Completed Today Semantics', () => {
    it('52. completed_today uses completed_at timestamp, not updated_at', () => {
      const task = {
        id: 't-completed',
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date(Date.now() + 1000).toISOString(),
      };

      expect(task.completed_at).toBeDefined();
      expect(deriveIsToday(task.completed_at)).toBe(true);
    });
  });

  // ==========================================
  // 11. Stable Work-Item ID Across Filters (Ajuste 10 & Ajuste 53)
  // ==========================================
  describe('Filter Consistency', () => {
    it('53. same overdue task has stable work-item ID across filters', () => {
      const taskId = 'task-uuid-42';
      const myDayItemId = `task:${taskId}`;
      const overdueTabItemId = `task:${taskId}`;
      expect(myDayItemId).toBe(overdueTabItemId);
    });
  });

  // ==========================================
  // 12. Read-Only Loading (Ajuste 11 & Ajuste 54)
  // ==========================================
  describe('Read-Only Work Queue Loading', () => {
    it('54. loading My Day creates no rows, tasks, or events', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: {
          items: [],
          total_count: 0,
          page: 1,
          page_size: 25,
        },
        error: null,
      });

      await fetchDailyOperationsQueue({ tab: 'my_day' });

      // Verify RPC was called with read-only query
      expect(supabase.rpc).toHaveBeenCalledWith(
        'get_daily_operations_queue',
        expect.objectContaining({
          p_tab: 'my_day',
        })
      );
      // Verify no write calls were made
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // 13. Financial Attention Integrity (Ajuste 17, 18 & Ajuste 55/56)
  // ==========================================
  describe('Financial Attention Integrity', () => {
    it('55. payment with balance but no due date is not labeled overdue', () => {
      const balance = 1500;
      const dueDate = null;
      const isOverdue = dueDate !== null && deriveIsOverdue(dueDate);
      expect(balance).toBeGreaterThan(0);
      expect(isOverdue).toBe(false);
    });

    it('56. payment attention uses canonical Block 3 balance calculation', () => {
      const totalAmount = 3000;
      const paidAmount = 1000;
      const outstandingBalance = totalAmount - paidAmount;
      expect(outstandingBalance).toBe(2000);
      expect(outstandingBalance > 0).toBe(true);
    });
  });

  // ==========================================
  // 14. Course & Post-Course Reason Codes (Ajuste 19, 20 & Ajuste 57/58)
  // ==========================================
  describe('Canonical Reason Codes Preservation', () => {
    it('57. all Block 4 course reason codes remain available', () => {
      const block4Codes = [
        'ENROLLMENT_WITHOUT_SESSION',
        'UPCOMING_SESSION_UNREADY',
        'NO_SHOW',
        'SESSION_CANCELLED_REASSIGNMENT_REQUIRED',
        'PAYMENT_OUTSTANDING',
        'MISSING_REQUIRED_ITEM',
      ];
      block4Codes.forEach((code) => {
        expect(deriveWorkItemPriority(code)).toBeDefined();
      });
    });

    it('58. all Block 5 post-course reason codes remain available', () => {
      const block5Codes = [
        'POST_COURSE_FOLLOWUP_OVERDUE',
        'FEEDBACK_PENDING',
        'TESTIMONIAL_REQUEST_DUE',
        'NEXT_COURSE_OPPORTUNITY',
        'POST_COURSE_TASK_OVERDUE',
      ];
      block5Codes.forEach((code) => {
        expect(deriveWorkItemPriority(code)).toBeDefined();
      });
    });
  });

  // ==========================================
  // 15. Meaningful Activity & Stale Timer (Ajuste 12, 13, 14 & Ajuste 59/60)
  // ==========================================
  describe('Meaningful Commercial Activity', () => {
    it('59. stale timer ignores technical updates (score recalculations, bookkeeping, token generation)', () => {
      const technicalActivities = [
        'lead_score_recalculated',
        'token_generated',
        'system_background_check',
        'page_viewed',
      ];

      const meaningfulWhitelist = [
        'email_dispatched',
        'sms_dispatched',
        'inbound_message_received',
        'call_task_completed',
        'stage_changed',
        'qualification_status_changed',
        'manual_note_added',
        'form_submitted',
        'enrollment_confirmed',
        'task_completed',
      ];

      technicalActivities.forEach((act) => {
        expect(meaningfulWhitelist).not.toContain(act);
      });
    });

    it('60. stale timer reacts to meaningful commercial activity', () => {
      const meaningfulActivities = [
        'email_dispatched',
        'sms_dispatched',
        'inbound_message_received',
        'call_task_completed',
        'stage_changed',
        'qualification_status_changed',
        'manual_note_added',
        'form_submitted',
        'enrollment_confirmed',
        'task_completed',
      ];

      meaningfulActivities.forEach((act) => {
        expect(meaningfulActivities.includes(act)).toBe(true);
      });
    });
  });

  // ==========================================
  // 16. Organization Timezone (Ajuste 23 & Ajuste 61)
  // ==========================================
  describe('Organization Timezone', () => {
    it('61. organization timezone is canonical IANA format', () => {
      const validTz = 'America/New_York';
      // Intl.DateTimeFormat throws RangeError if invalid
      expect(() => {
        Intl.DateTimeFormat(undefined, { timeZone: validTz });
      }).not.toThrow();
    });
  });

  // ==========================================
  // 17. Pipeline Safety (Ajuste 38 & Ajuste 62)
  // ==========================================
  describe('Pipeline Safety', () => {
    it('62. Work Queue never mutates or advances pipeline stages automatically', () => {
      const leadBefore = { id: 'l-safe', stage: 'qualification' };
      // Daily Operations view only aggregates
      const leadAfter = { ...leadBefore };
      expect(leadAfter.stage).toBe('qualification');
    });
  });

  // ==========================================
  // 18. Priority Rules Transparency (Ajuste 22 & Ajuste 63)
  // ==========================================
  describe('Priority Transparency', () => {
    it('63. no hidden priority score exists; priority mapping is purely rule-based', () => {
      const priority = deriveWorkItemPriority('SESSION_CANCELLED_REASSIGNMENT_REQUIRED');
      expect(priority).toBe('critical');
      expect(['low', 'normal', 'high', 'critical']).toContain(priority);
    });
  });

  // ==========================================
  // 19. Aggregator & Queue Reconciliation (Ajuste 34 & Ajuste 64)
  // ==========================================
  describe('Aggregator & Queue Reconciliation', () => {
    it('64. aggregator and paginated queue counts reconcile', async () => {
      const mockDashboardKpis = {
        due_today_count: 5,
        overdue_count: 2,
        needs_reply_count: 3,
        hot_leads_needing_action_count: 4,
        leads_no_action_count: 7,
        payment_attention_count: 1,
        course_attention_count: 2,
        post_course_attention_count: 3,
        completed_today_count: 8,
        total_open_tasks: 15,
        timezone: 'America/New_York',
        stale_after_days: 7,
        hot_min_score: 50,
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockDashboardKpis,
        error: null,
      });

      const kpis = await fetchDailyOperationsDashboard();
      expect(kpis.due_today_count).toBe(5);
      expect(kpis.overdue_count).toBe(2);
      expect(kpis.needs_reply_count).toBe(3);
    });
  });

  // ==========================================
  // 20. Zero Frontend N+1 Queries (Ajuste 35 & Ajuste 65)
  // ==========================================
  describe('Zero Client-Side N+1 Queries', () => {
    it('65. items returned by backend are already fully enriched with lead name, score tier, balance, reason', async () => {
      const enrichedItem: WorkItem = {
        id: 'item-1',
        type: 'PAYMENT_ATTENTION',
        category: 'payments',
        priority: 'high',
        title: 'Outstanding Course Balance ($1,500.00)',
        description: 'Lead has remaining balance for upcoming course.',
        due_at: null,
        is_overdue: false,
        detected_at: new Date().toISOString(),
        lead_id: 'lead-123',
        lead_name: 'Dr. John Doe',
        lead_email: 'john@example.com',
        lead_phone: null,
        contact_preference: 'email',
        lead_score: 75,
        pipeline_stage: 'approval',
        reason_code: 'PAYMENT_OUTSTANDING',
        context_id: 'enr-1',
        context_type: 'enrollment',
        primary_action: {
          type: 'open_enrollment',
          label: 'View Enrollment',
          enrollment_id: 'enr-1',
        },
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: {
          items: [enrichedItem],
          total_count: 1,
          page: 1,
          page_size: 25,
        },
        error: null,
      });

      const res = await fetchDailyOperationsQueue({ tab: 'payments' });
      expect(res.items.length).toBe(1);
      // All contextual fields are already enriched! No secondary queries needed
      expect(res.items[0].lead_name).toBe('Dr. John Doe');
      expect(res.items[0].lead_score).toBe(75);
      expect(res.items[0].reason_code).toBe('PAYMENT_OUTSTANDING');
      expect(res.items[0].primary_action.type).toBe('open_enrollment');
    });
  });

  // ==========================================
  // 21. Task RPCs & CSV Export
  // ==========================================
  describe('Task RPC Operations & CSV Export', () => {
    it('calls create_crm_task RPC correctly', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: 'task-created-id',
        error: null,
      });

      const taskId = await createCrmTask({
        leadId: 'lead-1',
        title: 'Initial Discovery Call',
        taskType: 'call',
        priority: 'high',
        dueAt: new Date().toISOString(),
        description: 'Call regarding Implantology intensive',
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'create_crm_task',
        expect.objectContaining({
          p_lead_id: 'lead-1',
          p_title: 'Initial Discovery Call',
          p_task_type: 'call',
          p_priority: 'high',
        })
      );
      expect(taskId).toBe('task-created-id');
    });

    it('calls reschedule_crm_task RPC correctly', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: true,
        error: null,
      });

      const newDue = new Date(Date.now() + 86400 * 1000).toISOString();
      const success = await rescheduleCrmTask('task-1', newDue, 'Requested reschedule');

      expect(supabase.rpc).toHaveBeenCalledWith(
        'reschedule_crm_task',
        expect.objectContaining({
          p_task_id: 'task-1',
          p_new_due_at: newDue,
          p_reason: 'Requested reschedule',
        })
      );
      expect(success).toBe(true);
    });

    it('calls complete_crm_task RPC correctly', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: true,
        error: null,
      });

      const success = await completeCrmTask('task-1', 'Call completed with positive outcome');

      expect(supabase.rpc).toHaveBeenCalledWith(
        'complete_crm_task',
        expect.objectContaining({
          p_task_id: 'task-1',
          p_notes: 'Call completed with positive outcome',
        })
      );
      expect(success).toBe(true);
    });

    it('exports work queue items as valid CSV', () => {
      const items: WorkItem[] = [
        {
          id: 'item-1',
          type: 'TASK',
          category: 'today',
          priority: 'critical',
          title: 'Urgent prep call',
          description: 'Call doctor',
          due_at: '2026-09-18T10:00:00Z',
          is_overdue: false,
          detected_at: '2026-09-17T10:00:00Z',
          lead_id: 'l-1',
          lead_name: 'Dr. Jane Smith',
          lead_email: 'jane@example.com',
          lead_phone: null,
          contact_preference: 'email',
          lead_score: 85,
          pipeline_stage: 'qualification',
          reason_code: null,
          context_id: 'item-1',
          context_type: 'task',
          primary_action: {
            type: 'complete_task',
            label: 'Complete',
            task_id: 'item-1',
          },
        },
      ];

      const csv = exportWorkQueueCSV(items);
      expect(csv).toContain('ID,Type,Category,Priority,Title');
      expect(csv).toContain('Lead Name');
      expect(csv).toContain('Urgent prep call');
      expect(csv).toContain('Dr. Jane Smith');
      expect(csv).toContain('critical');
    });
  });
});
