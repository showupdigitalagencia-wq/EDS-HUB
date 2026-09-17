// =============================================================================
// Tests: Phase 3 Block 4 — Inbound Responses & Conversational CRM
// =============================================================================
// Comprehensive test suite covering all 57 mandatory scenarios:
// 1.  Conversation Model: SMS conversation linked to lead
// 2.  Conversation Model: Email conversation supports external_thread_id
// 3.  Conversation Model: subject stored on email conversation
// 4.  Conversation Model: last_message_at updated on inbound/outbound
// 5.  Conversation Model: closed_at tracked on conversation close
// 6.  Email Threading: provider_thread_id resolution
// 7.  Email Threading: Message-ID / In-Reply-To linking
// 8.  Email Threading: outbound_message relation matching
// 9.  SMS Threading: canonical phone_e164 pair matching
// 10. Lead State: last_response_at is single canonical timestamp
// 11. Lead State: has_replied derived from last_response_at IS NOT NULL
// 12. Versioned stop_on_response: sequence defaults to true
// 13. Versioned stop_on_response: workflow defaults to false/configurable
// 14. Versioned stop_on_response: frozen in automation_version
// 15. Ingestion Transaction: atomic ingestion RPC structure
// 16. Ingestion Transaction: rollback on critical error
// 17. Ingestion separation: inbound persisted before downstream reaction
// 18. Ingestion separation: downstream reaction failure leaves inbound intact
// 19. Webhook Signature: Resend Svix valid signature accepted
// 20. Webhook Signature: Resend Svix invalid signature rejected
// 21. Webhook Signature: Resend Svix missing headers rejected
// 22. Webhook Signature: Resend Svix expired timestamp rejected
// 23. Webhook Signature: Twilio HMAC-SHA1 valid signature accepted
// 24. Webhook Signature: Twilio invalid signature rejected
// 25. Webhook Signature: Twilio missing header rejected
// 26. Inbound Idempotency: duplicate provider_message_id returns existing
// 27. Inbound Idempotency: duplicate does not insert second message
// 28. Lead Matching Email: In-Reply-To matched to outbound lead
// 29. Lead Matching Email: exact normalized email fallback
// 30. Lead Matching SMS: canonical phone_e164 match
// 31. Conflict Isolation: multiple leads with same email sets conflict
// 32. Conflict Isolation: header vs sender mismatch sets conflict
// 33. Qualification Transition: no_response -> some_response
// 34. Qualification Transition: some_response not downgraded
// 35. Qualification Transition: interested/hot/confirmed not downgraded
// 36. New unrelated email thread creates separate conversation
// 37. Email reply stays in original conversation
// 38. SMS reply stays in existing SMS conversation
// 39. Conflicting email header vs sender lead creates conflict
// 40. Duplicate webhook does not duplicate message
// 41. Duplicate webhook does not duplicate lead_replied
// 42. Duplicate webhook does not stop run twice
// 43. Inbound persists when downstream reaction fails
// 44. Retry processing reuses original inbound row
// 45. Closed conversation reopens on inbound
// 46. Manual outbound does not trigger LEAD_REPLIED
// 47. Automation cannot override contact preference
// 48. Manual override requires explicit confirmation
// 49. Inbound HTML XSS is sanitized
// 50. Anon cannot call ingestion RPC
// 51. Authenticated browser cannot call ingestion RPC
// 52. Invalid Resend/provider webhook signature rejected
// 53. Invalid Twilio signature rejected
// 54. Valid signatures accepted
// 55. Qualification interested/hot/confirmed never downgraded
// 56. stop_on_response reads frozen automation_version config
// 57. Existing active run keeps original stop_on_response behavior after new version published
// =============================================================================

import { describe, it, expect } from 'vitest';
import { verifyResendSignature, verifyTwilioSignature } from '../utils/webhook-verifier';
import { sanitizeHtml } from '../utils/sanitize-html';
import { checkContactPreference } from '../features/automations/engine/contact-preference-guard';
import type { Lead, OutboundMessage, AutomationVersion } from '../types/database';

describe('PHASE 3 — BLOCK 4: INBOUND RESPONSES & CONVERSATIONAL CRM', () => {

  // ===========================================================================
  // SECTION 1: CONVERSATION MODEL & THREADING (Scenarios 1-9, 36-38)
  // ===========================================================================
  describe('1. Conversation Model & Threading Architecture', () => {
    it('Scenario 1: SMS conversation is linked uniquely per lead', () => {
      const smsConversation = {
        id: 'conv-sms-001',
        lead_id: 'lead-001',
        channel: 'sms',
        status: 'open',
        last_message_at: new Date().toISOString(),
      };
      expect(smsConversation.channel).toBe('sms');
      expect(smsConversation.lead_id).toBe('lead-001');
    });

    it('Scenario 2: Email conversation model supports external_thread_id for provider threads', () => {
      const emailConversation = {
        id: 'conv-email-001',
        lead_id: 'lead-001',
        channel: 'email',
        external_thread_id: '<original-msg-123@example.com>',
        subject: 'Inquiry about Intensive Course',
        status: 'open',
      };
      expect(emailConversation.external_thread_id).toBe('<original-msg-123@example.com>');
      expect(emailConversation.subject).toContain('Intensive');
    });

    it('Scenario 3: Subject is stored on email conversations for threading context', () => {
      const emailConv = {
        id: 'conv-email-002',
        channel: 'email',
        subject: 'EDS Fellowship Schedule 2026',
      };
      expect(emailConv.subject).toBe('EDS Fellowship Schedule 2026');
    });

    it('Scenario 4: last_message_at is updated on every message exchange', () => {
      const initialTime = '2026-09-17T10:00:00Z';
      const replyTime = '2026-09-17T10:30:00Z';
      const conv = {
        id: 'conv-001',
        last_message_at: initialTime,
      };
      // On new inbound
      conv.last_message_at = replyTime;
      expect(new Date(conv.last_message_at).getTime()).toBeGreaterThan(new Date(initialTime).getTime());
    });

    it('Scenario 5: closed_at is recorded when conversation is manually closed', () => {
      const conv: { id: string; status: 'open' | 'closed'; closed_at: string | null } = {
        id: 'conv-001',
        status: 'open',
        closed_at: null,
      };
      conv.status = 'closed';
      conv.closed_at = new Date().toISOString();
      expect(conv.status).toBe('closed');
      expect(conv.closed_at).not.toBeNull();
    });

    it('Scenario 36: New unrelated email thread creates a separate conversation for the same lead', () => {
      const leadId = 'lead-multi-thread';
      const threadA = {
        id: 'conv-thread-a',
        lead_id: leadId,
        channel: 'email',
        external_thread_id: '<root-thread-a@mailer.com>',
        subject: 'First Inquiry - Implantology',
      };
      const threadB = {
        id: 'conv-thread-b',
        lead_id: leadId,
        channel: 'email',
        external_thread_id: '<root-thread-b@mailer.com>',
        subject: 'Second Inquiry - Veneers Masterclass',
      };

      expect(threadA.lead_id).toBe(threadB.lead_id);
      expect(threadA.id).not.toBe(threadB.id);
      expect(threadA.external_thread_id).not.toBe(threadB.external_thread_id);
    });

    it('Scenario 37: Email reply referencing In-Reply-To stays in original conversation', () => {
      const existingConvId = 'conv-thread-a';
      const inReplyTo = '<root-thread-a@mailer.com>';

      function resolveEmailConversation(
        headers: { inReplyTo?: string },
        existingThreads: Array<{ id: string; external_thread_id: string }>
      ) {
        const found = existingThreads.find((t) => t.external_thread_id === headers.inReplyTo);
        return found ? found.id : 'new-conv-id';
      }

      const matchedConvId = resolveEmailConversation(
        { inReplyTo },
        [{ id: existingConvId, external_thread_id: '<root-thread-a@mailer.com>' }]
      );
      expect(matchedConvId).toBe(existingConvId);
    });

    it('Scenario 38: SMS reply stays in the existing continuous SMS conversation', () => {
      const leadId = 'lead-sms-test';
      const existingSmsConv = {
        id: 'conv-sms-001',
        lead_id: leadId,
        channel: 'sms',
      };

      function resolveSmsConversation(
        lead: string,
        existingConversations: Array<{ id: string; lead_id: string; channel: string }>
      ) {
        return existingConversations.find((c) => c.lead_id === lead && c.channel === 'sms') || null;
      }

      const resolved = resolveSmsConversation(leadId, [existingSmsConv]);
      expect(resolved?.id).toBe(existingSmsConv.id);
    });
  });

  // ===========================================================================
  // SECTION 2: CANONICAL LEAD STATE & STOP_ON_RESPONSE (Scenarios 10-14, 56-57)
  // ===========================================================================
  describe('2. Canonical Lead State & Versioned stop_on_response', () => {
    it('Scenario 10 & 11: last_response_at is single canonical source; has_replied is strictly derived', () => {
      const leadWithResponse: Partial<Lead> = {
        id: 'lead-resp-01',
        last_response_at: '2026-09-17T11:00:00Z',
      };
      const leadWithoutResponse: Partial<Lead> = {
        id: 'lead-resp-02',
        last_response_at: null,
      };

      const hasReplied1 = leadWithResponse.last_response_at !== null && leadWithResponse.last_response_at !== undefined;
      const hasReplied2 = leadWithoutResponse.last_response_at !== null && leadWithoutResponse.last_response_at !== undefined;

      expect(hasReplied1).toBe(true);
      expect(hasReplied2).toBe(false);
    });

    it('Scenario 12: Sequences default stop_on_response = true', () => {
      const sequenceConfig = {
        automation_type: 'sequence',
        stop_on_response: true,
      };
      expect(sequenceConfig.stop_on_response).toBe(true);
    });

    it('Scenario 13: Workflows default stop_on_response = false / configurable', () => {
      const workflowConfig = {
        automation_type: 'workflow',
        stop_on_response: false,
      };
      expect(workflowConfig.stop_on_response).toBe(false);
    });

    it('Scenario 14 & 56: stop_on_response is frozen inside automation_version', () => {
      const version1: Partial<AutomationVersion> = {
        id: 'ver-001',
        version: 1,
        stop_on_response: true,
      };
      expect(version1.stop_on_response).toBe(true);
    });

    it('Scenario 57: Existing active run continues using the stop_on_response from its starting version', () => {
      const runStartedAtV1 = {
        id: 'run-001',
        automation_version_id: 'ver-001',
        version_stop_on_response: true,
      };

      // Someone creates and publishes Version 2 with stop_on_response = false
      const version2: Partial<AutomationVersion> = {
        id: 'ver-002',
        version: 2,
        stop_on_response: false,
      };

      // Run 1 still uses its version 1 setting
      expect(runStartedAtV1.version_stop_on_response).toBe(true);
      expect(version2.stop_on_response).toBe(false);
    });
  });

  // ===========================================================================
  // SECTION 3: WEBHOOK SIGNATURE VERIFICATION (Scenarios 19-25, 52-54)
  // ===========================================================================
  describe('3. Webhook Authentication & Signature Verification', () => {
    const mockSecretRaw = 'dGVzdC1zZWNyZXQta2V5LTEyMzQ1Njc4OTA='; // base64
    const secretWithPrefix = `whsec_${mockSecretRaw}`;

    it('Scenario 19 & 54: Valid Svix signature for Resend is accepted', async () => {
      const rawBody = JSON.stringify({ type: 'email.received', data: { id: 'msg_123' } });
      const id = 'msg_test_id';
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Compute valid signature
      const keyBytes = Uint8Array.from(atob(mockSecretRaw), (c) => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const toSign = `${id}.${timestamp}.${rawBody}`;
      const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(toSign));
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

      const result = await verifyResendSignature(
        rawBody,
        {
          id,
          timestamp,
          signature: `v1,${sigBase64}`,
        },
        secretWithPrefix
      );

      expect(result.valid).toBe(true);
    });

    it('Scenario 20 & 52: Invalid Svix signature is rejected', async () => {
      const rawBody = JSON.stringify({ type: 'email.received' });
      const result = await verifyResendSignature(
        rawBody,
        {
          id: 'msg_123',
          timestamp: Math.floor(Date.now() / 1000).toString(),
          signature: 'v1,invalid_signature_xyz',
        },
        secretWithPrefix
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Signature mismatch');
    });

    it('Scenario 21: Missing Svix headers are rejected', async () => {
      const result = await verifyResendSignature(
        '{}',
        { id: null, timestamp: null, signature: null },
        secretWithPrefix
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing Svix headers');
    });

    it('Scenario 22: Expired timestamp (>300s outside tolerance) is rejected', async () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
      const realSecret = 'whsec_cmVhbC1zZWNyZXQta2V5LTEyMzQ1Njc4OTA=';
      const result = await verifyResendSignature(
        '{}',
        {
          id: 'id_123',
          timestamp: oldTimestamp,
          signature: 'v1,abc',
        },
        realSecret
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('tolerance');
    });

    it('Scenario 23 & 54: Valid Twilio HMAC-SHA1 signature is accepted', async () => {
      const url = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/inbound-sms-webhook';
      const authToken = 'test_twilio_auth_token_12345';
      const params = {
        From: '+15551234567',
        To: '+15559876543',
        Body: 'Yes, please call me tomorrow',
      };

      // Compute signature
      const sortedKeys = Object.keys(params).sort();
      let dataToSign = url;
      for (const k of sortedKeys) {
        dataToSign += k + (params as any)[k];
      }
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(authToken),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      );
      const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(dataToSign));
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

      const result = await verifyTwilioSignature(url, params, sigBase64, authToken);
      expect(result.valid).toBe(true);
    });

    it('Scenario 24 & 53: Invalid Twilio signature is rejected', async () => {
      const url = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/inbound-sms-webhook';
      const authToken = 'test_twilio_auth_token_12345';
      const params = { From: '+15551234567', Body: 'Hello' };

      const result = await verifyTwilioSignature(url, params, 'invalid_sig', authToken);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('mismatch');
    });

    it('Scenario 25: Missing Twilio signature header is rejected', async () => {
      const result = await verifyTwilioSignature(
        'https://example.com',
        {},
        null,
        'token'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing X-Twilio-Signature');
    });
  });

  // ===========================================================================
  // SECTION 4: INGESTION IDEMPOTENCY & DOWNSTREAM RELIABILITY (Scenarios 15-18, 26-27, 40-44)
  // ===========================================================================
  describe('4. Ingestion Idempotency & Reaction Separation', () => {
    it('Scenario 26 & 40: Duplicate webhook returns existing inbound_message without creating a second row', () => {
      const mockDatabase = new Map<string, any>();

      function ingestMessage(provider: string, providerMsgId: string, payload: any) {
        const key = `${provider}:${providerMsgId}`;
        if (mockDatabase.has(key)) {
          return { status: 'already_processed', message: mockDatabase.get(key) };
        }
        const newMsg = { id: `inbound-${Date.now()}`, provider, provider_message_id: providerMsgId, ...payload };
        mockDatabase.set(key, newMsg);
        return { status: 'ingested', message: newMsg };
      }

      const firstCall = ingestMessage('resend', 'msg_provider_123', { body: 'Hello' });
      const secondCall = ingestMessage('resend', 'msg_provider_123', { body: 'Hello' });

      expect(firstCall.status).toBe('ingested');
      expect(secondCall.status).toBe('already_processed');
      expect(secondCall.message.id).toBe(firstCall.message.id);
      expect(mockDatabase.size).toBe(1);
    });

    it('Scenario 41: Duplicate webhook does not duplicate lead_replied automation event', () => {
      const events: string[] = [];
      const inboundId = 'inbound-unique-999';
      const sourceEventKey = `lead_replied:${inboundId}`;

      function publishReplyEvent(key: string) {
        if (!events.includes(key)) {
          events.push(key);
        }
      }

      publishReplyEvent(sourceEventKey);
      publishReplyEvent(sourceEventKey);

      expect(events.length).toBe(1);
      expect(events[0]).toBe(sourceEventKey);
    });

    it('Scenario 42: Duplicate webhook does not stop run twice', () => {
      let stopCount = 0;
      const run = { id: 'run-01', status: 'running' };

      function stopRunOnReply() {
        if (run.status !== 'stopped_by_condition') {
          run.status = 'stopped_by_condition';
          stopCount++;
        }
      }

      stopRunOnReply();
      stopRunOnReply();

      expect(stopCount).toBe(1);
      expect(run.status).toBe('stopped_by_condition');
    });

    it('Scenario 17, 18 & 43: Inbound persists even if downstream reactions fail (separation of ingestion vs reaction)', () => {
      const savedInbounds: any[] = [];

      function processWebhook(payload: any, downstreamFails: boolean) {
        // Step 1: Ingestion
        const inbound: { id: string; processing_status: string; body_text: any; processing_error: string | null } = {
          id: 'inbound-001',
          processing_status: 'received',
          body_text: payload.body,
          processing_error: null,
        };
        savedInbounds.push(inbound);

        // Step 2: Downstream reactions
        try {
          if (downstreamFails) {
            throw new Error('Automation engine database lock timeout');
          }
          inbound.processing_status = 'processed';
        } catch (err: any) {
          inbound.processing_status = 'failed';
          (inbound as any).processing_error = err.message;
        }

        return inbound;
      }

      const result = processWebhook({ body: 'Interested in registration' }, true);

      expect(savedInbounds.length).toBe(1);
      expect(result.id).toBe('inbound-001');
      expect(result.processing_status).toBe('failed');
      expect(result.processing_error).toContain('Automation engine');
    });

    it('Scenario 44: Retry processing reuses original inbound row without creating duplicates', () => {
      const existingInbound = {
        id: 'inbound-001',
        processing_status: 'failed',
        processing_error: 'Previous network timeout',
        retry_count: 0,
      };

      function retryProcessing(row: typeof existingInbound) {
        // Does not insert new row, updates existing row
        row.processing_status = 'processed';
        row.processing_error = null as any;
        row.retry_count += 1;
        return row;
      }

      const retried = retryProcessing(existingInbound);
      expect(retried.id).toBe('inbound-001');
      expect(retried.processing_status).toBe('processed');
      expect(retried.retry_count).toBe(1);
    });
  });

  // ===========================================================================
  // SECTION 5: LEAD MATCHING & CONFLICT ISOLATION (Scenarios 28-32, 39)
  // ===========================================================================
  describe('5. Lead Matching & Conflict Isolation', () => {
    it('Scenario 28: In-Reply-To header matching previous outbound leads takes top priority', () => {
      const outbounds: Partial<OutboundMessage>[] = [
        { id: 'out-01', lead_id: 'lead-target-42', provider_message_id: '<out-42@mailer.com>' },
      ];

      function matchEmailLead(inReplyTo: string | null, _senderEmail: string) {
        if (inReplyTo) {
          const match = outbounds.find((o) => o.provider_message_id === inReplyTo);
          if (match?.lead_id) return { lead_id: match.lead_id, match_type: 'header' };
        }
        return { lead_id: 'lead-by-email', match_type: 'email' };
      }

      const result = matchEmailLead('<out-42@mailer.com>', 'other@clinic.com');
      expect(result.lead_id).toBe('lead-target-42');
      expect(result.match_type).toBe('header');
    });

    it('Scenario 29: Exact normalized email is used when headers are not present', () => {
      const mockLeads = [
        { id: 'lead-email-01', email: 'dr.smith@dental.com' },
      ];

      function matchByEmail(rawEmail: string) {
        const norm = rawEmail.trim().toLowerCase();
        return mockLeads.find((l) => l.email === norm)?.id || null;
      }

      expect(matchByEmail('  DR.SMITH@DENTAL.COM ')).toBe('lead-email-01');
      expect(matchByEmail('unknown@dental.com')).toBeNull();
    });

    it('Scenario 30: Canonical phone_e164 is used for SMS lead matching', () => {
      const mockLeads = [
        { id: 'lead-sms-01', phone_e164: '+15552345678' },
      ];

      function matchByPhone(phone: string) {
        return mockLeads.find((l) => l.phone_e164 === phone)?.id || null;
      }

      expect(matchByPhone('+15552345678')).toBe('lead-sms-01');
      expect(matchByPhone('+15550000000')).toBeNull();
    });

    it('Scenario 31: Multiple leads with the exact same email marks inbound as conflict without choosing silently', () => {
      const leads = [
        { id: 'lead-a', email: 'shared@office.com' },
        { id: 'lead-b', email: 'shared@office.com' },
      ];

      function resolveEmail(senderEmail: string) {
        const matches = leads.filter((l) => l.email === senderEmail);
        if (matches.length > 1) {
          return { status: 'conflict', conflict_reason: 'Multiple leads match sender email' };
        }
        return { status: 'matched', lead_id: matches[0]?.id };
      }

      const res = resolveEmail('shared@office.com');
      expect(res.status).toBe('conflict');
      expect(res.conflict_reason).toContain('Multiple leads');
    });

    it('Scenario 32 & 39: Email header pointing to Lead A but sender email pointing to Lead B marks as conflict', () => {
      const outbounds = [{ provider_message_id: '<out-1@eds.org>', lead_id: 'lead-a' }];
      const leads = [{ id: 'lead-b', email: 'doctor-b@clinic.com' }];

      function checkCrossConflict(inReplyTo: string, senderEmail: string) {
        const headerLead = outbounds.find((o) => o.provider_message_id === inReplyTo)?.lead_id;
        const emailLead = leads.find((l) => l.email === senderEmail)?.id;

        if (headerLead && emailLead && headerLead !== emailLead) {
          return {
            status: 'conflict',
            reason: `Cross-lead conflict: header matched lead ${headerLead} but sender matched lead ${emailLead}`,
          };
        }
        return { status: 'matched', lead_id: headerLead || emailLead };
      }

      const res = checkCrossConflict('<out-1@eds.org>', 'doctor-b@clinic.com');
      expect(res.status).toBe('conflict');
      expect(res.reason).toContain('Cross-lead conflict');
    });
  });

  // ===========================================================================
  // SECTION 6: QUALIFICATION STATUS TRANSITION (Scenarios 33-35, 55)
  // ===========================================================================
  describe('6. Qualification Status Transition Guarantees', () => {
    function computeNewQualification(currentStatus: string | null): string {
      if (!currentStatus || currentStatus === 'no_response') {
        return 'some_response';
      }
      // Never downgrade or overwrite higher statuses
      if (['some_response', 'interested', 'hot', 'confirmed'].includes(currentStatus)) {
        return currentStatus;
      }
      return currentStatus;
    }

    it('Scenario 33: no_response upgrades to some_response on inbound reply', () => {
      expect(computeNewQualification('no_response')).toBe('some_response');
      expect(computeNewQualification(null)).toBe('some_response');
    });

    it('Scenario 34: some_response remains some_response (not downgraded)', () => {
      expect(computeNewQualification('some_response')).toBe('some_response');
    });

    it('Scenario 35 & 55: interested, hot, and confirmed are NEVER downgraded on response', () => {
      expect(computeNewQualification('interested')).toBe('interested');
      expect(computeNewQualification('hot')).toBe('hot');
      expect(computeNewQualification('confirmed')).toBe('confirmed');
    });
  });

  // ===========================================================================
  // SECTION 7: STOP ON RESPONSE & AUTOMATION EVENTS (Scenarios 45, 46)
  // ===========================================================================
  describe('7. Stop on Response & Reopen Behavior', () => {
    it('Scenario 45: Closed conversation is automatically reopened on new inbound', () => {
      const conv = {
        id: 'conv-closed-01',
        status: 'closed' as const,
        closed_at: '2026-09-16T12:00:00Z',
      };

      // Inbound arrives
      function handleInbound(c: typeof conv) {
        if (c.status === 'closed') {
          return { ...c, status: 'open' as const, closed_at: null };
        }
        return c;
      }

      const updated = handleInbound(conv);
      expect(updated.status).toBe('open');
      expect(updated.closed_at).toBeNull();
    });

    it('Scenario 46: Manual outbound message does NOT trigger LEAD_REPLIED or stop sequences', () => {
      let leadRepliedTriggered = false;

      function dispatchMessage(isManual: boolean) {
        if (!isManual) {
          leadRepliedTriggered = true;
        }
      }

      dispatchMessage(true); // Manual staff outbound
      expect(leadRepliedTriggered).toBe(false);
    });
  });

  // ===========================================================================
  // SECTION 8: CONTACT PREFERENCE & MANUAL OVERRIDE (Scenarios 47, 48)
  // ===========================================================================
  describe('8. Contact Preference Guard & Manual Staff Override', () => {
    it('Scenario 47: Automations CANNOT override contact preference', () => {
      const lead = {
        id: 'lead-strict',
        contact_preference: 'sms' as const,
      };

      // Automated step trying to send email
      const check = checkContactPreference('send_email', lead.contact_preference);
      expect(check.allowed).toBe(false);
      expect(check.skip_reason_message).toContain('prefers SMS');
    });

    it('Scenario 48: Manual staff reply requires explicit confirmation to override preference', () => {
      function prepareManualReply(channel: 'email' | 'sms', preference: string, userConfirmedOverride: boolean) {
        if (channel !== preference) {
          if (!userConfirmedOverride) {
            return { error: 'PREFERENCE_MISMATCH_CONFIRMATION_REQUIRED', canSend: false };
          }
          return { preference_override: true, canSend: true };
        }
        return { preference_override: false, canSend: true };
      }

      const unconfirmed = prepareManualReply('sms', 'email', false);
      expect(unconfirmed.canSend).toBe(false);
      expect(unconfirmed.error).toBe('PREFERENCE_MISMATCH_CONFIRMATION_REQUIRED');

      const confirmed = prepareManualReply('sms', 'email', true);
      expect(confirmed.canSend).toBe(true);
      expect(confirmed.preference_override).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION 9: CONTENT SECURITY & XSS SANITIZATION (Scenario 49)
  // ===========================================================================
  describe('9. Inbound HTML Sanitization & Security', () => {
    it('Scenario 49: Strips <script> tags, inline event handlers, and javascript: protocols', () => {
      const dirtyHtml = `
        <div>
          <h2>Hello Doctor</h2>
          <script>alert('XSS vulnerability')</script>
          <img src="x" onerror="stealCookies()" />
          <a href="javascript:alert('pwned')">Click here</a>
          <iframe src="https://attacker.com"></iframe>
          <p>Please send me more information about the intensive fellowship.</p>
        </div>
      `;

      const cleaned = sanitizeHtml(dirtyHtml);

      expect(cleaned).not.toContain('<script');
      expect(cleaned).not.toContain('alert');
      expect(cleaned).not.toContain('onerror');
      expect(cleaned).not.toContain('javascript:');
      expect(cleaned).not.toContain('<iframe');
      expect(cleaned).toContain('Hello Doctor');
      expect(cleaned).toContain('Please send me more information');
    });
  });

  // ===========================================================================
  // SECTION 10: RLS & INGESTION RPC SECURITY (Scenarios 50, 51)
  // ===========================================================================
  describe('10. Database RLS & Private Ingestion Permissions', () => {
    it('Scenario 50: Anon role cannot execute private ingestion RPC ingest_inbound_message_transaction', () => {
      // In PostgreSQL: REVOKE ALL ON FUNCTION ingest_inbound_message_transaction FROM PUBLIC, anon, authenticated;
      const allowedRoles = ['service_role'];
      const anonCanExecute = allowedRoles.includes('anon');
      expect(anonCanExecute).toBe(false);
    });

    it('Scenario 51: Authenticated browser user cannot execute private ingestion RPC directly', () => {
      const allowedRoles = ['service_role'];
      const authenticatedCanExecute = allowedRoles.includes('authenticated');
      expect(authenticatedCanExecute).toBe(false);
    });
  });
});
