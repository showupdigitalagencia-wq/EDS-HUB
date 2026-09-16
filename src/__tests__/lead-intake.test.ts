// =============================================================================
// Tests T6-T12 + Contact Preference Rules: Lead Intake Processing Logic
// =============================================================================
// Tests the orchestration logic using mocks for external providers.
// Verifies canonical contact preference enforcement, audit trail, idempotency,
// and administrative review fallbacks.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSalutation } from '../utils/salutation';
import { resolveEmailRecipients } from '../utils/email-validation';

// =============================================================================
// Mock adapters for provider calls
// =============================================================================

interface MockSendResult {
  success: boolean;
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function createMockResend() {
  return {
    calls: [] as Array<{ to: string; subject: string; body: string }>,
    nextResult: { success: true, messageId: 'resend-123', errorCode: null, errorMessage: null } as MockSendResult,
    results: [] as MockSendResult[],
    async sendEmail(params: { to: string; subject: string; html: string }) {
      this.calls.push({ to: params.to, subject: params.subject, body: params.html });
      // Use per-call results if available, otherwise default
      const result = this.results.length > 0 ? this.results.shift()! : { ...this.nextResult };
      return result;
    },
  };
}

function createMockTwilio() {
  return {
    calls: [] as Array<{ to: string; body: string }>,
    nextResult: { success: true, messageId: 'twilio-456', errorCode: null, errorMessage: null } as MockSendResult,
    async sendSms(params: { to: string; body: string }) {
      this.calls.push({ to: params.to, body: params.body });
      return { ...this.nextResult };
    },
  };
}

// =============================================================================
// Simulated intake processing logic
// =============================================================================
// This mirrors the logic in the Edge Function but runs in Node/Vitest context
// with injectable dependencies.
// =============================================================================

interface IntakeActivity {
  activity_type: string;
  channel?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

interface IntakeTask {
  type: string;
  title: string;
  description?: string;
}

interface IntakeProcessResult {
  messagesFromResend: number;
  messagesFromTwilio: number;
  tasksCreated: IntakeTask[];
  activities: IntakeActivity[];
  stageAdvanced: boolean;
  errors: string[];
}

interface IntakePayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  email_confirmation?: string;
  phone?: string;
  contact_preference?: 'email' | 'sms' | 'call' | string;
}

async function processIntake(
  payload: IntakePayload,
  resend: ReturnType<typeof createMockResend>,
  twilio: ReturnType<typeof createMockTwilio>,
  existingSentMessages: Set<string> = new Set(), // idempotency keys already sent
  existingTasks: Set<string> = new Set(), // task keys already created
): Promise<IntakeProcessResult> {
  const result: IntakeProcessResult = {
    messagesFromResend: 0,
    messagesFromTwilio: 0,
    tasksCreated: [],
    activities: [],
    stageAdvanced: false,
    errors: [],
  };

  const salutation = resolveSalutation(payload.last_name, payload.first_name);
  const pref = payload.contact_preference;
  const isValidPreference = pref === 'email' || pref === 'sms' || pref === 'call';

  if (!isValidPreference) {
    // Missing, invalid, or unsupported preference
    result.activities.push(
      {
        activity_type: 'contact_preference_detected',
        summary: `Invalid or missing contact preference detected: "${pref ?? 'none'}"`,
        metadata: { preference: pref ?? null, valid: false },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'email',
        summary: 'Email channel skipped: invalid or missing contact preference',
        metadata: { channel: 'email', reason: 'invalid_or_missing_preference' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'sms',
        summary: 'SMS channel skipped: invalid or missing contact preference',
        metadata: { channel: 'sms', reason: 'invalid_or_missing_preference' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'call',
        summary: 'Call channel skipped: invalid or missing contact preference',
        metadata: { channel: 'call', reason: 'invalid_or_missing_preference' },
      },
    );

    const taskKey = 'task:data_review:contact_preference';
    if (!existingTasks.has(taskKey)) {
      result.tasksCreated.push({
        type: 'data_review',
        title: 'Review lead contact preference',
        description: `Contact preference '${pref || 'none'}' is missing or invalid. Internal data review required before initiating contact.`,
      });
      existingTasks.add(taskKey);
    }

    result.activities.push({
      activity_type: 'processing_failed',
      summary: `Intake processing failed: Invalid or missing contact_preference`,
      metadata: { errors: [`Invalid or missing contact_preference: "${pref ?? 'none'}"`] },
    });

    result.errors.push(`Invalid or missing contact_preference: "${pref ?? 'none'}"`);
    result.stageAdvanced = false;
    return result;
  }

  if (pref === 'email') {
    result.activities.push(
      {
        activity_type: 'contact_preference_detected',
        summary: 'Contact preference detected: email',
        metadata: { preference: 'email', valid: true },
      },
      {
        activity_type: 'email_selected',
        channel: 'email',
        summary: 'Email channel selected based on lead contact preference',
        metadata: { channel: 'email' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'sms',
        summary: 'SMS channel skipped: contact preference is email',
        metadata: { channel: 'sms', reason: 'preference_exclusion', preferred: 'email' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'call',
        summary: 'Call channel skipped: contact preference is email',
        metadata: { channel: 'call', reason: 'preference_exclusion', preferred: 'email' },
      },
    );

    const recipients = resolveEmailRecipients(payload.email, payload.email_confirmation);

    if (recipients.length === 0) {
      const taskKey = 'task:data_review:email';
      if (!existingTasks.has(taskKey)) {
        result.tasksCreated.push({ type: 'data_review', title: 'Review lead email data' });
        existingTasks.add(taskKey);
      }
      result.activities.push({
        activity_type: 'processing_failed',
        summary: 'No valid email address — data review task created',
        metadata: { reason: 'no_valid_email' },
      });
      result.errors.push('No valid email address');
      return result;
    }

    let allSent = true;
    for (const recipient of recipients) {
      const idempotencyKey = `intake:email:${recipient}`;

      // Skip if already sent (idempotency)
      if (existingSentMessages.has(idempotencyKey)) {
        result.messagesFromResend++;
        continue;
      }

      const sendResult = await resend.sendEmail({
        to: recipient,
        subject: `Welcome, ${salutation}`,
        html: `Hello ${salutation}, thank you.`,
      });

      if (sendResult.success) {
        result.messagesFromResend++;
        existingSentMessages.add(idempotencyKey);
        result.activities.push({
          activity_type: 'email_dispatched',
          channel: 'email',
          summary: `Email sent to ${recipient}`,
          metadata: { recipient, provider_message_id: sendResult.messageId },
        });
      } else {
        allSent = false;
        result.errors.push(`Failed: ${recipient}`);
      }
    }

    if (allSent && result.messagesFromResend > 0) {
      result.stageAdvanced = true;
    } else {
      result.activities.push({
        activity_type: 'processing_failed',
        summary: `Intake processing failed: ${result.errors.join('; ')}`,
        metadata: { errors: result.errors },
      });
    }
  } else if (pref === 'sms') {
    result.activities.push(
      {
        activity_type: 'contact_preference_detected',
        summary: 'Contact preference detected: sms',
        metadata: { preference: 'sms', valid: true },
      },
      {
        activity_type: 'sms_selected',
        channel: 'sms',
        summary: 'SMS channel selected based on lead contact preference',
        metadata: { channel: 'sms' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'email',
        summary: 'Email channel skipped: contact preference is sms',
        metadata: { channel: 'email', reason: 'preference_exclusion', preferred: 'sms' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'call',
        summary: 'Call channel skipped: contact preference is sms',
        metadata: { channel: 'call', reason: 'preference_exclusion', preferred: 'sms' },
      },
    );

    if (!payload.phone || !payload.phone.startsWith('+')) {
      const taskKey = 'task:data_review:phone';
      if (!existingTasks.has(taskKey)) {
        result.tasksCreated.push({ type: 'data_review', title: 'Review lead phone data' });
        existingTasks.add(taskKey);
      }
      result.activities.push({
        activity_type: 'processing_failed',
        summary: 'No E.164 phone number — data review task created',
        metadata: { reason: 'no_e164_phone' },
      });
      result.errors.push('No E.164 phone');
      return result;
    }

    const idempotencyKey = `intake:sms:${payload.phone}`;
    if (existingSentMessages.has(idempotencyKey)) {
      result.messagesFromTwilio++;
      result.stageAdvanced = true;
      return result;
    }

    const sendResult = await twilio.sendSms({
      to: payload.phone,
      body: `Hello ${salutation}, thank you.`,
    });

    if (sendResult.success) {
      result.messagesFromTwilio++;
      existingSentMessages.add(idempotencyKey);
      result.activities.push({
        activity_type: 'sms_dispatched',
        channel: 'sms',
        summary: `SMS sent to ${payload.phone}`,
        metadata: { recipient: payload.phone, provider_message_id: sendResult.messageId },
      });
      result.stageAdvanced = true;
    } else {
      result.activities.push({
        activity_type: 'processing_failed',
        channel: 'sms',
        summary: `SMS dispatch failed: ${sendResult.errorMessage}`,
        metadata: { error_code: sendResult.errorCode, error_message: sendResult.errorMessage },
      });
      result.errors.push('SMS failed');
    }
  } else if (pref === 'call') {
    result.activities.push(
      {
        activity_type: 'contact_preference_detected',
        summary: 'Contact preference detected: call',
        metadata: { preference: 'call', valid: true },
      },
      {
        activity_type: 'call_selected',
        channel: 'call',
        summary: 'Call channel selected based on lead contact preference',
        metadata: { channel: 'call' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'email',
        summary: 'Email channel skipped: contact preference is call',
        metadata: { channel: 'email', reason: 'preference_exclusion', preferred: 'call' },
      },
      {
        activity_type: 'channel_skipped',
        channel: 'sms',
        summary: 'SMS channel skipped: contact preference is call',
        metadata: { channel: 'sms', reason: 'preference_exclusion', preferred: 'call' },
      },
    );

    const taskKey = 'task:call';
    if (!existingTasks.has(taskKey)) {
      result.tasksCreated.push({
        type: 'call',
        title: `Call lead — ${salutation}`,
        description: 'Lead prefers phone call. Please reach out.',
      });
      existingTasks.add(taskKey);

      result.activities.push({
        activity_type: 'call_task_created',
        channel: 'call',
        summary: `Call task created for ${salutation}`,
        metadata: { task_type: 'call' },
      });
    }

    result.stageAdvanced = true;
  }

  return result;
}

// =============================================================================
// Test suite
// =============================================================================

describe('Lead Intake Processing', () => {
  let resend: ReturnType<typeof createMockResend>;
  let twilio: ReturnType<typeof createMockTwilio>;

  beforeEach(() => {
    resend = createMockResend();
    twilio = createMockTwilio();
  });

  // T6: contact_preference=email → Resend used, Twilio not, no call task
  it('T6: email preference uses Resend and not Twilio, creates no call task', async () => {
    const result = await processIntake(
      { email: 'user@example.com', contact_preference: 'email', last_name: 'Smith' },
      resend,
      twilio,
    );

    expect(resend.calls).toHaveLength(1);
    expect(twilio.calls).toHaveLength(0);
    expect(result.messagesFromResend).toBe(1);
    expect(result.messagesFromTwilio).toBe(0);
    expect(result.tasksCreated.filter((t) => t.type === 'call')).toHaveLength(0);

    // Audit trail checks
    const activityTypes = result.activities.map((a) => a.activity_type);
    expect(activityTypes).toContain('contact_preference_detected');
    expect(activityTypes).toContain('email_selected');
    expect(activityTypes).toContain('channel_skipped');
    expect(activityTypes).toContain('email_dispatched');

    const skipped = result.activities.filter((a) => a.activity_type === 'channel_skipped');
    expect(skipped).toHaveLength(2);
    expect(skipped.map((s) => s.channel)).toEqual(expect.arrayContaining(['sms', 'call']));
  });

  // T7: contact_preference=sms → Twilio used, Resend not, no call task
  it('T7: sms preference uses Twilio and not Resend, creates no call task', async () => {
    const result = await processIntake(
      { phone: '+15551234567', contact_preference: 'sms', last_name: 'Jones' },
      resend,
      twilio,
    );

    expect(twilio.calls).toHaveLength(1);
    expect(resend.calls).toHaveLength(0);
    expect(result.messagesFromTwilio).toBe(1);
    expect(result.messagesFromResend).toBe(0);
    expect(result.tasksCreated.filter((t) => t.type === 'call')).toHaveLength(0);

    // Audit trail checks
    const activityTypes = result.activities.map((a) => a.activity_type);
    expect(activityTypes).toContain('contact_preference_detected');
    expect(activityTypes).toContain('sms_selected');
    expect(activityTypes).toContain('channel_skipped');
    expect(activityTypes).toContain('sms_dispatched');

    const skipped = result.activities.filter((a) => a.activity_type === 'channel_skipped');
    expect(skipped).toHaveLength(2);
    expect(skipped.map((s) => s.channel)).toEqual(expect.arrayContaining(['email', 'call']));
  });

  // T8: contact_preference=call → no provider used, call task created
  it('T8: call preference creates task without using any provider', async () => {
    const result = await processIntake(
      { contact_preference: 'call', first_name: 'Alice' },
      resend,
      twilio,
    );

    expect(resend.calls).toHaveLength(0);
    expect(twilio.calls).toHaveLength(0);
    expect(result.tasksCreated).toHaveLength(1);
    expect(result.tasksCreated[0].type).toBe('call');

    // Audit trail checks
    const activityTypes = result.activities.map((a) => a.activity_type);
    expect(activityTypes).toContain('contact_preference_detected');
    expect(activityTypes).toContain('call_selected');
    expect(activityTypes).toContain('channel_skipped');
    expect(activityTypes).toContain('call_task_created');

    const skipped = result.activities.filter((a) => a.activity_type === 'channel_skipped');
    expect(skipped).toHaveLength(2);
    expect(skipped.map((s) => s.channel)).toEqual(expect.arrayContaining(['email', 'sms']));
  });

  // Mandatory Rule 4: Missing or invalid preference
  describe('Rule 4: Missing or Invalid Preference Handling', () => {
    it('handles undefined contact_preference: no email, no SMS, no call task, creates data_review task', async () => {
      const result = await processIntake(
        { email: 'user@example.com', phone: '+15551234567', first_name: 'Bob' },
        resend,
        twilio,
      );

      // No provider called
      expect(resend.calls).toHaveLength(0);
      expect(twilio.calls).toHaveLength(0);
      expect(result.messagesFromResend).toBe(0);
      expect(result.messagesFromTwilio).toBe(0);

      // No contact call task created
      expect(result.tasksCreated.filter((t) => t.type === 'call')).toHaveLength(0);

      // Administrative data_review task created
      expect(result.tasksCreated).toHaveLength(1);
      expect(result.tasksCreated[0].type).toBe('data_review');
      expect(result.tasksCreated[0].title).toBe('Review lead contact preference');

      // Stage NOT advanced
      expect(result.stageAdvanced).toBe(false);

      // Audit trail checks
      const prefDetected = result.activities.find((a) => a.activity_type === 'contact_preference_detected');
      expect(prefDetected).toBeDefined();
      expect(prefDetected?.metadata?.valid).toBe(false);

      const skipped = result.activities.filter((a) => a.activity_type === 'channel_skipped');
      expect(skipped).toHaveLength(3);
      expect(skipped.map((s) => s.channel)).toEqual(expect.arrayContaining(['email', 'sms', 'call']));

      const failedActivity = result.activities.find((a) => a.activity_type === 'processing_failed');
      expect(failedActivity).toBeDefined();
    });

    it('handles unsupported contact_preference (e.g. "whatsapp"): no email, no SMS, no call task', async () => {
      const result = await processIntake(
        { email: 'user@example.com', phone: '+15551234567', contact_preference: 'whatsapp' },
        resend,
        twilio,
      );

      expect(resend.calls).toHaveLength(0);
      expect(twilio.calls).toHaveLength(0);
      expect(result.tasksCreated.filter((t) => t.type === 'call')).toHaveLength(0);

      expect(result.tasksCreated).toHaveLength(1);
      expect(result.tasksCreated[0].type).toBe('data_review');
      expect(result.stageAdvanced).toBe(false);

      const skipped = result.activities.filter((a) => a.activity_type === 'channel_skipped');
      expect(skipped).toHaveLength(3);
    });

    it('handles empty string contact_preference: creates administrative data_review task', async () => {
      const result = await processIntake(
        { email: 'user@example.com', contact_preference: '' },
        resend,
        twilio,
      );

      expect(resend.calls).toHaveLength(0);
      expect(twilio.calls).toHaveLength(0);
      expect(result.tasksCreated.filter((t) => t.type === 'data_review')).toHaveLength(1);
      expect(result.stageAdvanced).toBe(false);
    });
  });

  // T9: successful processing → Captura → Qualificação
  it('T9: successful email processing advances stage', async () => {
    const result = await processIntake(
      { email: 'user@example.com', contact_preference: 'email' },
      resend,
      twilio,
    );

    expect(result.stageAdvanced).toBe(true);
  });

  it('T9: successful SMS advances stage', async () => {
    const result = await processIntake(
      { phone: '+15551234567', contact_preference: 'sms' },
      resend,
      twilio,
    );

    expect(result.stageAdvanced).toBe(true);
  });

  it('T9: successful call task creation advances stage', async () => {
    const result = await processIntake(
      { contact_preference: 'call' },
      resend,
      twilio,
    );

    expect(result.stageAdvanced).toBe(true);
  });

  // T10: provider error → lead stays in Captura
  it('T10: email provider error does not advance stage', async () => {
    resend.nextResult = {
      success: false,
      messageId: null,
      errorCode: 'HTTP_500',
      errorMessage: 'Internal error',
    };

    const result = await processIntake(
      { email: 'user@example.com', contact_preference: 'email' },
      resend,
      twilio,
    );

    expect(result.stageAdvanced).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('T10: SMS provider error does not advance stage', async () => {
    twilio.nextResult = {
      success: false,
      messageId: null,
      errorCode: 'HTTP_500',
      errorMessage: 'Twilio error',
    };

    const result = await processIntake(
      { phone: '+15551234567', contact_preference: 'sms' },
      resend,
      twilio,
    );

    expect(result.stageAdvanced).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // T11: duplicate event → no duplication
  it('T11: idempotent event does not send again', async () => {
    const alreadySent = new Set(['intake:email:user@example.com']);

    const result = await processIntake(
      { email: 'user@example.com', contact_preference: 'email' },
      resend,
      twilio,
      alreadySent,
    );

    // No actual Resend calls — message was already sent
    expect(resend.calls).toHaveLength(0);
    expect(result.messagesFromResend).toBe(1); // counted as sent (from prior)
    expect(result.stageAdvanced).toBe(true);
  });

  it('preserves idempotency for call task creation', async () => {
    const existingTasks = new Set(['task:call']);

    const result = await processIntake(
      { contact_preference: 'call', first_name: 'Alice' },
      resend,
      twilio,
      new Set(),
      existingTasks,
    );

    // No duplicate call task created
    expect(result.tasksCreated).toHaveLength(0);
    expect(result.stageAdvanced).toBe(true);
  });

  it('preserves idempotency for administrative data_review task creation', async () => {
    const existingTasks = new Set(['task:data_review:contact_preference']);

    const result = await processIntake(
      { contact_preference: 'unknown' },
      resend,
      twilio,
      new Set(),
      existingTasks,
    );

    // No duplicate data_review task created
    expect(result.tasksCreated).toHaveLength(0);
    expect(result.stageAdvanced).toBe(false);
  });

  // T12: partial failure with 2 emails, then retry
  it('T12: partial failure retry does not re-send the successful one', async () => {
    // First attempt: 2 recipients, first succeeds, second fails
    resend.results = [
      { success: true, messageId: 'msg-1', errorCode: null, errorMessage: null },
      { success: false, messageId: null, errorCode: 'HTTP_429', errorMessage: 'Rate limited' },
    ];

    const sentMessages = new Set<string>();
    const firstResult = await processIntake(
      {
        email: 'alice@example.com',
        email_confirmation: 'bob@example.com',
        contact_preference: 'email',
      },
      resend,
      twilio,
      sentMessages,
    );

    expect(firstResult.messagesFromResend).toBe(1);
    expect(firstResult.stageAdvanced).toBe(false);
    expect(resend.calls).toHaveLength(2);

    // Retry: only the failed recipient should be attempted
    const retryResend = createMockResend();
    retryResend.nextResult = { success: true, messageId: 'msg-2', errorCode: null, errorMessage: null };

    const retryResult = await processIntake(
      {
        email: 'alice@example.com',
        email_confirmation: 'bob@example.com',
        contact_preference: 'email',
      },
      retryResend,
      twilio,
      sentMessages, // alice already in here from first attempt
    );

    // Only bob@example.com should have been sent
    expect(retryResend.calls).toHaveLength(1);
    expect(retryResend.calls[0].to).toBe('bob@example.com');
    expect(retryResult.messagesFromResend).toBe(2); // 1 from cache + 1 new
    expect(retryResult.stageAdvanced).toBe(true);
  });
});
