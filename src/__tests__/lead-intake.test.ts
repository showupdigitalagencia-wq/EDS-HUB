// =============================================================================
// Tests T6-T12: Lead Intake Processing Logic
// =============================================================================
// Tests the orchestration logic using mocks for external providers.
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

interface IntakeProcessResult {
  messagesFromResend: number;
  messagesFromTwilio: number;
  tasksCreated: Array<{ type: string; title: string }>;
  stageAdvanced: boolean;
  errors: string[];
}

interface IntakePayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  email_confirmation?: string;
  phone?: string;
  contact_preference: 'email' | 'sms' | 'call';
}

async function processIntake(
  payload: IntakePayload,
  resend: ReturnType<typeof createMockResend>,
  twilio: ReturnType<typeof createMockTwilio>,
  existingSentMessages: Set<string> = new Set(), // idempotency keys already sent
): Promise<IntakeProcessResult> {
  const result: IntakeProcessResult = {
    messagesFromResend: 0,
    messagesFromTwilio: 0,
    tasksCreated: [],
    stageAdvanced: false,
    errors: [],
  };

  const salutation = resolveSalutation(payload.last_name, payload.first_name);

  switch (payload.contact_preference) {
    case 'email': {
      const recipients = resolveEmailRecipients(payload.email, payload.email_confirmation);

      if (recipients.length === 0) {
        result.tasksCreated.push({ type: 'data_review', title: 'Review lead email data' });
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
        } else {
          allSent = false;
          result.errors.push(`Failed: ${recipient}`);
        }
      }

      if (allSent && result.messagesFromResend > 0) {
        result.stageAdvanced = true;
      }
      break;
    }

    case 'sms': {
      if (!payload.phone || !payload.phone.startsWith('+')) {
        result.tasksCreated.push({ type: 'data_review', title: 'Review lead phone data' });
        result.errors.push('No E.164 phone');
        return result;
      }

      const sendResult = await twilio.sendSms({
        to: payload.phone,
        body: `Hello ${salutation}, thank you.`,
      });

      if (sendResult.success) {
        result.messagesFromTwilio++;
        result.stageAdvanced = true;
      } else {
        result.errors.push('SMS failed');
      }
      break;
    }

    case 'call': {
      result.tasksCreated.push({ type: 'call', title: `Call lead — ${salutation}` });
      result.stageAdvanced = true;
      break;
    }
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

  // T6: contact_preference=email → Resend used, Twilio not
  it('T6: email preference uses Resend and not Twilio', async () => {
    const result = await processIntake(
      { email: 'user@example.com', contact_preference: 'email', last_name: 'Smith' },
      resend,
      twilio,
    );

    expect(resend.calls).toHaveLength(1);
    expect(twilio.calls).toHaveLength(0);
    expect(result.messagesFromResend).toBe(1);
    expect(result.messagesFromTwilio).toBe(0);
  });

  // T7: contact_preference=sms → Twilio used, Resend not
  it('T7: sms preference uses Twilio and not Resend', async () => {
    const result = await processIntake(
      { phone: '+15551234567', contact_preference: 'sms', last_name: 'Jones' },
      resend,
      twilio,
    );

    expect(twilio.calls).toHaveLength(1);
    expect(resend.calls).toHaveLength(0);
    expect(result.messagesFromTwilio).toBe(1);
    expect(result.messagesFromResend).toBe(0);
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
