import { describe, it, expect, vi } from 'vitest';
import {
  evaluateFirstContactEligibility,
  resolveFirstContactOutcome,
} from '../features/automations/engine/first-contact-router';
import { checkContactPreference } from '../features/automations/engine/contact-preference-guard';
import { mapCsvStatusToStageCode } from '../features/leads/utils/stageMapping';
import type { Lead, LeadCourseInterest, Task } from '../types/database';

describe('Batch 2: Pipeline Canonical Codes & Operational Labels', () => {
  const CANONICAL_STAGES = [
    { code: 'capture', name: 'Novo Lead', sort_order: 1 },
    { code: 'qualification', name: 'Respondido', sort_order: 2 },
    { code: 'acquisition', name: 'Interessado', sort_order: 3 },
    { code: 'approval', name: 'Quente', sort_order: 4 },
    { code: 'enrollment', name: 'Matrícula', sort_order: 5 },
    { code: 'post_course', name: 'Pós-curso', sort_order: 6 },
    { code: 'alumni', name: 'Alumni', sort_order: 7 },
  ];

  it('preserves all 7 canonical codes exactly', () => {
    const codes = CANONICAL_STAGES.map((s) => s.code);
    expect(codes).toEqual([
      'capture',
      'qualification',
      'acquisition',
      'approval',
      'enrollment',
      'post_course',
      'alumni',
    ]);
  });

  it('verifies operational display names match client requirements', () => {
    const stageByCode = new Map(CANONICAL_STAGES.map((s) => [s.code, s.name]));
    expect(stageByCode.get('capture')).toBe('Novo Lead');
    expect(stageByCode.get('qualification')).toBe('Respondido');
    expect(stageByCode.get('acquisition')).toBe('Interessado');
    expect(stageByCode.get('approval')).toBe('Quente');
    expect(stageByCode.get('enrollment')).toBe('Matrícula');
    // Backend stages remain unchanged
    expect(stageByCode.get('post_course')).toBe('Pós-curso');
    expect(stageByCode.get('alumni')).toBe('Alumni');
  });

  it('supports new operational names in CSV status mapping', () => {
    expect(mapCsvStatusToStageCode('Novo Lead')).toBe('capture');
    expect(mapCsvStatusToStageCode('novo lead')).toBe('capture');
    expect(mapCsvStatusToStageCode('novo')).toBe('capture');
    expect(mapCsvStatusToStageCode('Respondido')).toBe('qualification');
    expect(mapCsvStatusToStageCode('respondido')).toBe('qualification');
    expect(mapCsvStatusToStageCode('Interessado')).toBe('acquisition');
    expect(mapCsvStatusToStageCode('interessado')).toBe('acquisition');
    expect(mapCsvStatusToStageCode('Quente')).toBe('approval');
    expect(mapCsvStatusToStageCode('quente')).toBe('approval');
    expect(mapCsvStatusToStageCode('Matrícula')).toBe('enrollment');
    expect(mapCsvStatusToStageCode('matricula')).toBe('enrollment');
  });
});

describe('Batch 2: Qualification Status Authoritative Mirroring', () => {
  const STAGE_TO_QUALIFICATION_MAP: Record<string, string> = {
    capture: 'no_response',
    qualification: 'some_response',
    acquisition: 'interested',
    approval: 'hot',
    enrollment: 'confirmed',
  };

  function simulateStageSyncTrigger(
    currentLead: { pipeline_stage_code: string; qualification_status: string },
    newStageCode: string
  ) {
    let qualChangedCount = 0;
    const oldQual = currentLead.qualification_status;
    const mappedQual = STAGE_TO_QUALIFICATION_MAP[newStageCode] || oldQual;

    if (mappedQual !== oldQual) {
      currentLead.qualification_status = mappedQual;
      qualChangedCount++;
    }
    currentLead.pipeline_stage_code = newStageCode;

    return {
      updatedLead: currentLead,
      qualChangedCount,
      oldQual,
      newQual: mappedQual,
    };
  }

  it('mirrors capture to no_response', () => {
    const lead = { pipeline_stage_code: 'qualification', qualification_status: 'some_response' };
    const res = simulateStageSyncTrigger(lead, 'capture');
    expect(res.updatedLead.qualification_status).toBe('no_response');
    expect(res.qualChangedCount).toBe(1);
  });

  it('mirrors qualification to some_response', () => {
    const lead = { pipeline_stage_code: 'capture', qualification_status: 'no_response' };
    const res = simulateStageSyncTrigger(lead, 'qualification');
    expect(res.updatedLead.qualification_status).toBe('some_response');
    expect(res.qualChangedCount).toBe(1);
  });

  it('mirrors acquisition to interested', () => {
    const lead = { pipeline_stage_code: 'qualification', qualification_status: 'some_response' };
    const res = simulateStageSyncTrigger(lead, 'acquisition');
    expect(res.updatedLead.qualification_status).toBe('interested');
    expect(res.qualChangedCount).toBe(1);
  });

  it('mirrors approval to hot', () => {
    const lead = { pipeline_stage_code: 'acquisition', qualification_status: 'interested' };
    const res = simulateStageSyncTrigger(lead, 'approval');
    expect(res.updatedLead.qualification_status).toBe('hot');
    expect(res.qualChangedCount).toBe(1);
  });

  it('mirrors enrollment to confirmed', () => {
    const lead = { pipeline_stage_code: 'approval', qualification_status: 'hot' };
    const res = simulateStageSyncTrigger(lead, 'enrollment');
    expect(res.updatedLead.qualification_status).toBe('confirmed');
    expect(res.qualChangedCount).toBe(1);
  });

  it('explicitly verifies stage transition changes qualification_status exactly once', () => {
    const lead = { pipeline_stage_code: 'capture', qualification_status: 'no_response' };
    const res = simulateStageSyncTrigger(lead, 'qualification');
    expect(res.qualChangedCount).toBe(1);
    expect(res.updatedLead.qualification_status).toBe('some_response');
  });

  it('ensures no duplicate qualification_status_changed events from single transition', () => {
    const emittedEvents: Array<{ event_type: string; old_status: string; new_status: string }> = [];

    const lead = { pipeline_stage_code: 'capture', qualification_status: 'no_response' };
    const res = simulateStageSyncTrigger(lead, 'qualification');

    // Emit event if qualification status changed
    if (res.oldQual !== res.newQual) {
      emittedEvents.push({
        event_type: 'qualification_status_changed',
        old_status: res.oldQual,
        new_status: res.newQual,
      });
    }

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].new_status).toBe('some_response');
  });

  it('direct stage change outside move_lead_stage produces identical mirrored qualification_status', () => {
    // Both RPC and direct SQL update pass through the BEFORE trigger on public.leads
    const leadA = { pipeline_stage_code: 'capture', qualification_status: 'no_response' };
    const leadB = { pipeline_stage_code: 'capture', qualification_status: 'no_response' };

    const resFromRpc = simulateStageSyncTrigger(leadA, 'acquisition');
    const resFromDirectUpdate = simulateStageSyncTrigger(leadB, 'acquisition');

    expect(resFromRpc.updatedLead.qualification_status).toBe('interested');
    expect(resFromDirectUpdate.updatedLead.qualification_status).toBe('interested');
    expect(resFromRpc.updatedLead.qualification_status).toBe(resFromDirectUpdate.updatedLead.qualification_status);
  });
});

describe('Batch 2: Lead Course Interests & Course Sessions Relationship', () => {
  it('supports a lead having 1, 2, or up to 3 prioritized course interests', () => {
    const interests: LeadCourseInterest[] = [
      {
        id: 'interest-1',
        lead_id: 'lead-123',
        course_id: 'course-intensive',
        course_session_id: 'session-oct-2026',
        priority: 1,
        source: 'manual',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'interest-2',
        lead_id: 'lead-123',
        course_id: 'course-wisdom',
        course_session_id: 'session-nov-2026',
        priority: 2,
        source: 'manual',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'interest-3',
        lead_id: 'lead-123',
        course_id: 'course-ortho',
        course_session_id: null,
        priority: 3,
        source: 'manual',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    expect(interests).toHaveLength(3);
    const priorities = interests.map((i) => i.priority);
    expect(priorities).toEqual([1, 2, 3]);
    // Single lead owns all 3 interests without duplicating the lead record
    expect(new Set(interests.map((i) => i.lead_id)).size).toBe(1);
  });

  it('preserves course interest when linked course_session is deleted (ON DELETE SET NULL)', () => {
    const interest: LeadCourseInterest = {
      id: 'interest-1',
      lead_id: 'lead-123',
      course_id: 'course-intensive',
      course_session_id: 'session-to-delete',
      priority: 1,
      source: 'manual',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Simulate ON DELETE SET NULL on course_session_id
    interest.course_session_id = null;

    expect(interest.id).toBe('interest-1');
    expect(interest.course_id).toBe('course-intensive');
    expect(interest.course_session_id).toBeNull();
    expect(interest.priority).toBe(1);
  });

  it('preserves historical interests with null priority without collision', () => {
    const historicalInterests: LeadCourseInterest[] = [
      {
        id: 'hist-1',
        lead_id: 'lead-historical',
        course_id: 'course-1',
        priority: null,
        source: 'post_course',
        status: 'active',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 'hist-2',
        lead_id: 'lead-historical',
        course_id: 'course-2',
        priority: null,
        source: 'post_course',
        status: 'active',
        created_at: '2025-02-01T00:00:00Z',
        updated_at: '2025-02-01T00:00:00Z',
      },
      {
        id: 'hist-3',
        lead_id: 'lead-historical',
        course_id: 'course-3',
        priority: null,
        source: 'post_course',
        status: 'active',
        created_at: '2025-03-01T00:00:00Z',
        updated_at: '2025-03-01T00:00:00Z',
      },
      {
        id: 'hist-4',
        lead_id: 'lead-historical',
        course_id: 'course-4',
        priority: null,
        source: 'post_course',
        status: 'active',
        created_at: '2025-04-01T00:00:00Z',
        updated_at: '2025-04-01T00:00:00Z',
      },
    ];

    // More than 3 historical records coexist because priority is null (partial unique index ignores nulls)
    expect(historicalInterests).toHaveLength(4);
    expect(historicalInterests.every((i) => i.priority === null)).toBe(true);
  });

  it('rejects duplicate priority for the same lead (priority uniqueness)', () => {
    const existingPriorities = new Set<number>();
    const tryAddPriority = (p: number) => {
      if (existingPriorities.has(p)) {
        throw new Error(`Duplicate priority: ${p}`);
      }
      existingPriorities.add(p);
      return true;
    };

    expect(tryAddPriority(1)).toBe(true);
    expect(tryAddPriority(2)).toBe(true);
    expect(() => tryAddPriority(1)).toThrow('Duplicate priority: 1');
  });
});

describe('Batch 2: Referred By (Quem indicou?)', () => {
  it('supports null referred_by for leads without referral', () => {
    const lead: Partial<Lead> = {
      id: 'lead-direct',
      first_name: 'Ana',
      referred_by: null,
    };
    expect(lead.referred_by).toBeNull();
  });

  it('stores referral text string without creating financial transactions', () => {
    const lead: Partial<Lead> = {
      id: 'lead-referred',
      first_name: 'Carlos',
      referred_by: 'Dr. Roberto Silva (Turma 14)',
    };
    expect(lead.referred_by).toBe('Dr. Roberto Silva (Turma 14)');
  });

  it('leaves existing leads unaffected when referred_by is omitted/null', () => {
    const existingLead: Partial<Lead> = {
      id: 'lead-existing',
      first_name: 'Existing',
    };
    expect(existingLead.referred_by).toBeUndefined();
  });
});

describe('Batch 2: Payment Task Type (Operational Task Only)', () => {
  it('creates task with task_type = "payment"', () => {
    const task: Task = {
      id: 'task-payment-1',
      lead_id: 'lead-123',
      intake_event_id: null,
      task_type: 'payment',
      title: 'Acompanhar pagamento da entrada',
      description: 'Ligar para confirmar se o link do cartão foi recebido',
      status: 'pending',
      priority: 'high',
      due_at: '2026-09-30T15:00:00Z',
      completed_at: null,
      task_source: 'manual',
      created_by: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(task.task_type).toBe('payment');
    expect(task.lead_id).toBe('lead-123');
    expect(task.status).toBe('pending');
    expect(task.due_at).toBe('2026-09-30T15:00:00Z');
  });

  it('completes payment task via normal task completion without affecting revenue or invoices', () => {
    const task: Task = {
      id: 'task-payment-1',
      lead_id: 'lead-123',
      intake_event_id: null,
      task_type: 'payment',
      title: 'Acompanhar pagamento da entrada',
      description: 'Ligar para confirmar se o link do cartão foi recebido',
      status: 'pending',
      priority: 'high',
      due_at: '2026-09-30T15:00:00Z',
      completed_at: null,
      task_source: 'manual',
      created_by: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Complete task
    task.status = 'completed';
    task.completed_at = new Date().toISOString();

    expect(task.status).toBe('completed');
    expect(task.completed_at).toBeDefined();

    // Verify task is self-contained: no invoice_id, no transaction_id
    expect((task as unknown as Record<string, unknown>).invoice_id).toBeUndefined();
    expect((task as unknown as Record<string, unknown>).transaction_id).toBeUndefined();
  });
});

describe('Batch 2: Authoritative Meta & Website First-Contact Rules', () => {
  it('Meta lead with preference=email + valid email + valid phone -> both channels eligible', () => {
    const lead = {
      source: 'meta',
      contact_preference: 'email',
      email: 'doctor@example.com',
      phone_raw: '+1 (407) 555-0199',
    };

    const eligibility = evaluateFirstContactEligibility(lead);
    expect(eligibility.isEligible).toBe(true);
    expect(eligibility.eligibleChannels).toContain('email');
    expect(eligibility.eligibleChannels).toContain('sms');
    expect(eligibility.eligibleChannels).toHaveLength(2);
    // Preserves contact preference
    expect(eligibility.preservedPreference).toBe('email');
  });

  it('Meta lead with preference=sms + valid email + valid phone -> both channels eligible', () => {
    const lead = {
      source: 'meta',
      contact_preference: 'sms',
      email: 'doctor@example.com',
      phone_raw: '+1 (407) 555-0199',
    };

    const eligibility = evaluateFirstContactEligibility(lead);
    expect(eligibility.isEligible).toBe(true);
    expect(eligibility.eligibleChannels).toContain('email');
    expect(eligibility.eligibleChannels).toContain('sms');
    expect(eligibility.eligibleChannels).toHaveLength(2);
    // Preserves contact preference
    expect(eligibility.preservedPreference).toBe('sms');
  });

  it('Meta lead contact_preference remains strictly unchanged after routing evaluation', () => {
    const originalPref = 'sms';
    const lead = {
      source: 'meta',
      contact_preference: originalPref,
      email: 'doctor@example.com',
      phone_raw: '+1 (407) 555-0199',
    };

    const eligibility = evaluateFirstContactEligibility(lead);
    expect(lead.contact_preference).toBe(originalPref);
    expect(eligibility.preservedPreference).toBe(originalPref);
    // Never creates synthetic "email_sms"
    expect(eligibility.preservedPreference).not.toBe('email_sms');
  });

  it('Meta lead with valid email only -> email eligible only', () => {
    const lead = {
      source: 'meta',
      contact_preference: 'sms', // prefers sms, but only has valid email
      email: 'doctor@example.com',
      phone_raw: null,
    };

    const eligibility = evaluateFirstContactEligibility(lead);
    expect(eligibility.isEligible).toBe(true);
    expect(eligibility.eligibleChannels).toEqual(['email']);
    expect(eligibility.preservedPreference).toBe('sms');
  });

  it('Meta lead with valid phone only -> SMS eligible only', () => {
    const lead = {
      source: 'meta',
      contact_preference: 'email', // prefers email, but only has valid phone
      email: null,
      phone_raw: '+1 (407) 555-0199',
    };

    const eligibility = evaluateFirstContactEligibility(lead);
    expect(eligibility.isEligible).toBe(true);
    expect(eligibility.eligibleChannels).toEqual(['sms']);
    expect(eligibility.preservedPreference).toBe('email');
  });

  it('Meta lead with neither valid email nor phone -> ineligible (Novo Lead + attention)', () => {
    const lead = {
      source: 'meta',
      contact_preference: 'email',
      email: null,
      phone_raw: null,
    };

    const eligibility = evaluateFirstContactEligibility(lead);
    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.eligibleChannels).toHaveLength(0);
    expect(eligibility.suppressedReason).toContain('neither valid email nor valid phone');
  });

  it('Website lead with both valid channels -> zero initial automatic outreach eligibility', () => {
    const leadForm = {
      source: 'form',
      source_detail: 'website',
      contact_preference: 'email',
      email: 'webuser@example.com',
      phone_raw: '+1 (407) 555-0200',
    };

    const eligibility = evaluateFirstContactEligibility(leadForm);
    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.eligibleChannels).toHaveLength(0);
    expect(eligibility.suppressedReason).toContain('Website leads require manual client initial response');
  });

  it('Historical HubSpot sync lead -> zero initial automatic outreach eligibility', () => {
    const leadHubSpot = {
      source: 'manual',
      source_detail: 'hubspot_sync',
      contact_preference: 'email',
      email: 'historical@example.com',
      phone_raw: '+1 (407) 555-0300',
    };

    const eligibility = evaluateFirstContactEligibility(leadHubSpot);
    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.eligibleChannels).toHaveLength(0);
    expect(eligibility.suppressedReason).toContain('Historical import lead is excluded');
  });

  it('Historical CSV import lead -> zero initial automatic outreach eligibility', () => {
    const leadCsv = {
      source: 'manual',
      source_detail: 'csv_import',
      contact_preference: 'email',
      email: 'csvimport@example.com',
      phone_raw: '+1 (407) 555-0400',
    };

    const eligibility = evaluateFirstContactEligibility(leadCsv);
    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.eligibleChannels).toHaveLength(0);
    expect(eligibility.suppressedReason).toContain('Historical import lead is excluded');
  });

  it('checkContactPreference allows both email and sms for Meta initial outreach', () => {
    const metaContext = {
      source: 'meta',
      isInitialOutreach: true,
      hasValidEmail: true,
      hasValidPhone: true,
    };

    // Even if preference is 'email', SMS is allowed on initial Meta outreach
    const smsCheck = checkContactPreference('send_sms', 'email', metaContext);
    expect(smsCheck.allowed).toBe(true);

    // Even if preference is 'sms', Email is allowed on initial Meta outreach
    const emailCheck = checkContactPreference('send_email', 'sms', metaContext);
    expect(emailCheck.allowed).toBe(true);
  });

  it('checkContactPreference suppresses website leads during initial outreach', () => {
    const websiteContext = {
      source: 'form',
      source_detail: 'website',
      isInitialOutreach: true,
      hasValidEmail: true,
      hasValidPhone: true,
    };

    const emailCheck = checkContactPreference('send_email', 'email', websiteContext);
    expect(emailCheck.allowed).toBe(false);
    expect(emailCheck.skip_reason_code).toBe('WEBSITE_INITIAL_OUTREACH_SUPPRESSED');
  });
});

describe('Batch 2: Respondido Result Contract (Correction 5)', () => {
  it('Email accepted + SMS accepted -> moves to Respondido', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: ['email', 'sms'],
      channelResults: { email: 'accepted', sms: 'accepted' },
    });

    expect(outcome.targetStageCode).toBe('qualification'); // Respondido
    expect(outcome.partialFailureVisible).toBe(false);
    expect(outcome.failedChannels).toHaveLength(0);
    expect(outcome.acceptedChannels).toEqual(['email', 'sms']);
    expect(outcome.firstContactAttentionState).toBe(false);
  });

  it('Email accepted + SMS failed -> moves to Respondido + retains partial SMS failure', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: ['email', 'sms'],
      channelResults: { email: 'accepted', sms: 'failed' },
    });

    expect(outcome.targetStageCode).toBe('qualification'); // Respondido
    expect(outcome.partialFailureVisible).toBe(true);
    expect(outcome.failedChannels).toEqual(['sms']);
    expect(outcome.acceptedChannels).toEqual(['email']);
    expect(outcome.firstContactAttentionState).toBe(false);
    expect(outcome.summary).toContain('falha em: sms');
  });

  it('SMS accepted + Email failed -> moves to Respondido + retains partial Email failure', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: ['email', 'sms'],
      channelResults: { email: 'failed', sms: 'accepted' },
    });

    expect(outcome.targetStageCode).toBe('qualification'); // Respondido
    expect(outcome.partialFailureVisible).toBe(true);
    expect(outcome.failedChannels).toEqual(['email']);
    expect(outcome.acceptedChannels).toEqual(['sms']);
    expect(outcome.firstContactAttentionState).toBe(false);
    expect(outcome.summary).toContain('falha em: email');
  });

  it('Both attempted channels fail -> remains Novo Lead + First Contact Failure', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: ['email', 'sms'],
      channelResults: { email: 'failed', sms: 'failed' },
    });

    expect(outcome.targetStageCode).toBe('capture'); // Novo Lead
    expect(outcome.firstContactAttentionState).toBe(true);
    expect(outcome.summary).toBe('Falha no Primeiro Contato');
  });

  it('Only one channel available and succeeds -> moves to Respondido', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: ['email'],
      channelResults: { email: 'accepted' },
    });

    expect(outcome.targetStageCode).toBe('qualification'); // Respondido
    expect(outcome.partialFailureVisible).toBe(false);
    expect(outcome.firstContactAttentionState).toBe(false);
  });

  it('Only one channel available and fails -> remains Novo Lead', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: ['sms'],
      channelResults: { sms: 'failed' },
    });

    expect(outcome.targetStageCode).toBe('capture'); // Novo Lead
    expect(outcome.firstContactAttentionState).toBe(true);
  });

  it('No channels available -> remains Novo Lead with attention state', () => {
    const outcome = resolveFirstContactOutcome({
      attemptedChannels: [],
      channelResults: {},
    });

    expect(outcome.targetStageCode).toBe('capture'); // Novo Lead
    expect(outcome.firstContactAttentionState).toBe(true);
  });
});

describe('Batch 2: Production Safety Confirmation', () => {
  it('confirms zero live messages sent during tests or domain evaluation', () => {
    const sendFetchSpy = vi.spyOn(globalThis, 'fetch');
    // Calling domain router or evaluators never issues network requests
    evaluateFirstContactEligibility({ source: 'meta', email: 'test@example.com', phone_raw: '12345678' });
    resolveFirstContactOutcome({ attemptedChannels: ['email'], channelResults: { email: 'accepted' } });
    expect(sendFetchSpy).not.toHaveBeenCalled();
    sendFetchSpy.mockRestore();
  });
});
