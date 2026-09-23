// =============================================================================
// Tests: Batch 7.4 — Inbound Lead & Thread Matching Logic
// =============================================================================

import { describe, it, expect } from 'vitest';

interface OutboundMessageRecord {
  id: string;
  lead_id: string;
  conversation_id: string;
  provider_message_id: string;
}

interface LeadRecord {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Pure simulation of the factual matching priority implemented in
 * ingest_inbound_message_transaction (00030).
 */
function resolveInboundMatch(params: {
  inReplyTo?: string | null;
  references?: string | null;
  fromAddress: string;
  fromDisplayName?: string;
  outbounds: OutboundMessageRecord[];
  leads: LeadRecord[];
}): {
  leadId: string | null;
  conversationId: string | null;
  status: 'processed' | 'conflict' | 'received';
  conflictReason?: string;
} {
  const normFrom = params.fromAddress.trim().toLowerCase();
  let matchedLeadId: string | null = null;
  let matchedConvId: string | null = null;
  let isConflict = false;
  let conflictReason: string | undefined;

  // Priority 1: In-Reply-To matching outbound
  if (params.inReplyTo && params.inReplyTo.trim().length > 0) {
    const cleanInReply = params.inReplyTo.replace(/[<>]/g, '').trim();
    const found = params.outbounds.find((o) => o.provider_message_id === cleanInReply);
    if (found) {
      matchedLeadId = found.lead_id;
      matchedConvId = found.conversation_id;
    }
  }

  // Priority 1.5: References matching outbound
  if (!matchedLeadId && params.references && params.references.trim().length > 0) {
    const cleanRefs = params.references.replace(/[<>]/g, '').trim();
    const found = params.outbounds.find((o) => cleanRefs.includes(o.provider_message_id));
    if (found) {
      matchedLeadId = found.lead_id;
      matchedConvId = found.conversation_id;
    }
  }

  // Verify header-matched lead doesn't conflict with sender address
  if (matchedLeadId) {
    const lead = params.leads.find((l) => l.id === matchedLeadId);
    if (!lead || lead.email.toLowerCase() !== normFrom) {
      isConflict = true;
      conflictReason = `HEADER_SENDER_MISMATCH: References point to lead ${matchedLeadId} but sender is ${params.fromAddress}`;
      matchedLeadId = null;
      matchedConvId = null;
    }
  }

  // Priority 2: Direct match by normalized sender email
  if (!matchedLeadId && !isConflict) {
    const candidateLeads = params.leads.filter((l) => l.email.toLowerCase() === normFrom);
    if (candidateLeads.length === 1) {
      matchedLeadId = candidateLeads[0].id;
    } else if (candidateLeads.length > 1) {
      isConflict = true;
      conflictReason = `AMBIGUOUS_EMAIL_MATCH: Multiple leads match sender ${params.fromAddress}`;
    }
  }

  // Pure display name alone is NEVER checked
  // (params.fromDisplayName is completely ignored for matching)

  if (isConflict) {
    return { leadId: null, conversationId: null, status: 'conflict', conflictReason };
  }

  if (matchedLeadId) {
    return { leadId: matchedLeadId, conversationId: matchedConvId, status: 'processed' };
  }

  return { leadId: null, conversationId: null, status: 'received' };
}

describe('Batch 7.4: Inbound Lead & Thread Matching Logic', () => {
  const mockLeads: LeadRecord[] = [
    { id: 'lead_wederson', first_name: 'Wederson', last_name: 'Almeida', email: 'wederson@gmail.com' },
    { id: 'lead_other', first_name: 'Dr. John', last_name: 'Doe', email: 'john@example.com' },
    { id: 'lead_shared_1', first_name: 'Ana', last_name: 'Silva', email: 'contato@clinica.com' },
    { id: 'lead_shared_2', first_name: 'Carlos', last_name: 'Santos', email: 'contato@clinica.com' },
  ];

  const mockOutbounds: OutboundMessageRecord[] = [
    {
      id: 'out_001',
      lead_id: 'lead_wederson',
      conversation_id: 'conv_wederson_1',
      provider_message_id: 'resend_msg_abc123',
    },
  ];

  it('matches exact outbound message ID via In-Reply-To header', () => {
    const match = resolveInboundMatch({
      inReplyTo: '<resend_msg_abc123>',
      fromAddress: 'wederson@gmail.com',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('processed');
    expect(match.leadId).toBe('lead_wederson');
    expect(match.conversationId).toBe('conv_wederson_1');
  });

  it('matches previous outbound message ID contained inside References header', () => {
    const match = resolveInboundMatch({
      references: '<parent_msg_999> <resend_msg_abc123>',
      fromAddress: 'wederson@gmail.com',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('processed');
    expect(match.leadId).toBe('lead_wederson');
    expect(match.conversationId).toBe('conv_wederson_1');
  });

  it('flags HEADER_SENDER_MISMATCH when header points to one lead but sender is another address', () => {
    const match = resolveInboundMatch({
      inReplyTo: 'resend_msg_abc123',
      fromAddress: 'stranger@spoofed.com',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('conflict');
    expect(match.leadId).toBeNull();
    expect(match.conflictReason).toContain('HEADER_SENDER_MISMATCH');
  });

  it('falls back safely to unique normalized sender email when headers are absent', () => {
    const match = resolveInboundMatch({
      fromAddress: '  JOHN@EXAMPLE.COM ',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('processed');
    expect(match.leadId).toBe('lead_other');
  });

  it('flags AMBIGUOUS_EMAIL_MATCH when multiple leads share the same email address without guessing', () => {
    const match = resolveInboundMatch({
      fromAddress: 'contato@clinica.com',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('conflict');
    expect(match.leadId).toBeNull();
    expect(match.conflictReason).toContain('AMBIGUOUS_EMAIL_MATCH');
  });

  it('records unknown sender as received with lead_id = null without inventing records', () => {
    const match = resolveInboundMatch({
      fromAddress: 'completely_unknown@externalsite.com',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('received');
    expect(match.leadId).toBeNull();
    expect(match.conversationId).toBeNull();
  });

  it('never matches based purely on display name', () => {
    const match = resolveInboundMatch({
      fromAddress: 'attacker@random.com',
      fromDisplayName: 'Wederson Almeida',
      outbounds: mockOutbounds,
      leads: mockLeads,
    });

    expect(match.status).toBe('received');
    expect(match.leadId).toBeNull();
    expect(match.leadId).not.toBe('lead_wederson');
  });
});
