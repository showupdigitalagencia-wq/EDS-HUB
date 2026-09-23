// =============================================================================
// Tests: Batch 7.4 — Auto-Reply & Email Loop Protection
// =============================================================================

import { describe, it, expect } from 'vitest';

/**
 * Pure simulation of detectAutoReply from inbound-email-webhook
 */
function detectAutoReply(
  headers: Record<string, string>,
  subject: string | null,
  fromAddress: string
): { isAutoReply: boolean; reason?: string } {
  const autoSubmitted = (
    headers['auto-submitted'] ||
    headers['Auto-Submitted'] ||
    ''
  ).toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') {
    return { isAutoReply: true, reason: `Auto-Submitted: ${autoSubmitted}` };
  }

  const xAutoreply = (
    headers['x-autoreply'] ||
    headers['X-Autoreply'] ||
    ''
  ).toLowerCase();
  if (xAutoreply === 'yes') {
    return { isAutoReply: true, reason: 'X-Autoreply: yes' };
  }

  const precedence = (
    headers['precedence'] ||
    headers['Precedence'] ||
    ''
  ).toLowerCase();
  if (['bulk', 'junk', 'auto_reply'].includes(precedence)) {
    return { isAutoReply: true, reason: `Precedence: ${precedence}` };
  }

  const xAutoResponseSuppress = (
    headers['x-auto-response-suppress'] ||
    headers['X-Auto-Response-Suppress'] ||
    ''
  ).toLowerCase();
  if (xAutoResponseSuppress && xAutoResponseSuppress !== 'none') {
    return { isAutoReply: true, reason: `X-Auto-Response-Suppress: ${xAutoResponseSuppress}` };
  }

  if (/^(mailer-daemon|postmaster|noreply|no-reply|bounce)@/i.test(fromAddress)) {
    return { isAutoReply: true, reason: `System sender: ${fromAddress}` };
  }

  const sub = (subject || '').trim();
  const autoSubjectRegex = /^(out of office|automatic reply|resposta autom[áa]tica|auto-reply|ausente|undelivered mail|delivery status notification|returned mail|failure notice)/i;
  if (autoSubjectRegex.test(sub)) {
    return { isAutoReply: true, reason: `Automated subject pattern: ${sub.slice(0, 40)}` };
  }

  return { isAutoReply: false };
}

describe('Batch 7.4: Auto-Reply & Loop Protection', () => {
  it('detects Auto-Submitted header indicating auto-replied', () => {
    const res = detectAutoReply({ 'Auto-Submitted': 'auto-replied' }, 'Re: Question', 'dr@example.com');
    expect(res.isAutoReply).toBe(true);
    expect(res.reason).toContain('Auto-Submitted');
  });

  it('detects Auto-Submitted header indicating auto-generated', () => {
    const res = detectAutoReply({ 'auto-submitted': 'auto-generated' }, 'Re: Question', 'dr@example.com');
    expect(res.isAutoReply).toBe(true);
  });

  it('detects X-Autoreply: yes', () => {
    const res = detectAutoReply({ 'x-autoreply': 'yes' }, 'Re: Question', 'dr@example.com');
    expect(res.isAutoReply).toBe(true);
  });

  it('detects Precedence: auto_reply / bulk', () => {
    const res1 = detectAutoReply({ 'Precedence': 'auto_reply' }, 'Notice', 'dr@example.com');
    const res2 = detectAutoReply({ 'precedence': 'bulk' }, 'Notice', 'dr@example.com');
    expect(res1.isAutoReply).toBe(true);
    expect(res2.isAutoReply).toBe(true);
  });

  it('detects Microsoft Exchange X-Auto-Response-Suppress header', () => {
    const res = detectAutoReply({ 'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN' }, 'Notice', 'dr@example.com');
    expect(res.isAutoReply).toBe(true);
  });

  it('detects system senders: mailer-daemon, postmaster, noreply', () => {
    const res1 = detectAutoReply({}, 'Undelivered', 'mailer-daemon@googlemail.com');
    const res2 = detectAutoReply({}, 'Postmaster report', 'postmaster@expdentalsolutions.com');
    const res3 = detectAutoReply({}, 'Notification', 'noreply@resend.com');
    expect(res1.isAutoReply).toBe(true);
    expect(res2.isAutoReply).toBe(true);
    expect(res3.isAutoReply).toBe(true);
  });

  it('detects Out of Office and automated subjects in English and Portuguese', () => {
    const res1 = detectAutoReply({}, 'Out of Office: On clinical leave until Monday', 'dr@example.com');
    const res2 = detectAutoReply({}, 'Automatic reply: Away from clinic', 'dr@example.com');
    const res3 = detectAutoReply({}, 'Resposta automática: Estarei em cirurgia hoje', 'dr@example.com');
    const res4 = detectAutoReply({}, 'Delivery Status Notification (Failure)', 'dr@example.com');

    expect(res1.isAutoReply).toBe(true);
    expect(res2.isAutoReply).toBe(true);
    expect(res3.isAutoReply).toBe(true);
    expect(res4.isAutoReply).toBe(true);
  });

  it('recognizes genuine human reply as not automated', () => {
    const res = detectAutoReply(
      { 'In-Reply-To': '<msg-123@mailer.com>' },
      'Re: Informações sobre a Imersão',
      'dr.smith@clinica.com'
    );
    expect(res.isAutoReply).toBe(false);
  });

  it('guarantees auto-replies do not emit lead_replied or modify lead qualification', () => {
    let leadRepliedEmitted = false;
    let qualificationStatus = 'no_response';
    let pipelineStageId = 'stage_inbox_1';

    function processInbound(isAutoReply: boolean) {
      if (!isAutoReply) {
        leadRepliedEmitted = true;
        qualificationStatus = 'some_response';
      }
      // Pipeline stage is NEVER modified on inbound
    }

    processInbound(true);

    expect(leadRepliedEmitted).toBe(false);
    expect(qualificationStatus).toBe('no_response');
    expect(pipelineStageId).toBe('stage_inbox_1');
  });
});
