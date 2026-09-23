/**
 * =============================================================================
 * Tests: Batch 7.4 — Two-Way Email Conversations UI & Threading Suite
 * =============================================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeadConversationsCard } from '../features/leads/LeadConversationsCard';
import { supabase } from '../lib/supabase';
import type { Lead } from '../types';

// Mock Supabase client
vi.mock('../lib/supabase', () => {
  const channelMock = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };

  return {
    supabase: {
      from: vi.fn(),
      channel: vi.fn(() => channelMock),
      removeChannel: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      },
    },
  };
});

function createChainableMock(resolvedData: any, error: any = null) {
  const queryObj: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: resolvedData, error }),
    single: vi.fn().mockResolvedValue({ data: resolvedData, error }),
    then: (resolve: any) => resolve({ data: resolvedData, error }),
  };
  return queryObj;
}

const mockLead: Lead = {
  id: 'lead-test-74',
  first_name: 'Wederson',
  last_name: 'Almeida',
  email: 'wedersonalmeida2414@gmail.com',
  phone_raw: '(11) 98765-4321',
  phone_e164: '+5511987654321',
  source: 'website',
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-01T10:00:00Z',
} as unknown as Lead;

describe('Batch 7.4: Two-Way Email Conversations UI & Threading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders inbound reply with `<Lead Name> · E-mail` and status `Recebido` (never `Entregue`)', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'inbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'in-001',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  provider_message_id: 'resend_in_123',
                  from_address: 'wedersonalmeida2414@gmail.com',
                  to_address: 'info@expdentalsolutions.com',
                  subject: 'Re: Proposta Comercial',
                  body_text: 'Sim, tenho interesse em agendar a visita.',
                  body_html: null,
                  received_at: '2026-09-23T15:00:00Z',
                  read_at: '2026-09-23T15:05:00Z',
                  created_at: '2026-09-23T15:00:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadConversationsCard lead={mockLead} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('message-sender-in-001')).toHaveTextContent('Wederson Almeida · E-mail');
      const statusBadge = screen.getByTestId('delivery-status-in-001');
      expect(statusBadge).toHaveTextContent('Recebido');
      expect(statusBadge).not.toHaveTextContent('Entregue');
    });
  });

  it('displays outbound email and inbound reply in the same thread group', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'outbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'out-001',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  recipient: 'wedersonalmeida2414@gmail.com',
                  subject_snapshot: 'Proposta Comercial - Imersão',
                  body_snapshot: 'Olá Wederson, segue nossa proposta.',
                  status: 'delivered',
                  sent_at: '2026-09-23T14:00:00Z',
                  delivered_at: '2026-09-23T14:01:00Z',
                  is_manual_reply: true,
                  created_at: '2026-09-23T14:00:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      if (table === 'inbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'in-001',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  provider_message_id: 'resend_in_123',
                  from_address: 'wedersonalmeida2414@gmail.com',
                  to_address: 'info@expdentalsolutions.com',
                  subject: 'Re: Proposta Comercial - Imersão',
                  body_text: 'Excelente, aceito as condições!',
                  body_html: null,
                  received_at: '2026-09-23T15:00:00Z',
                  read_at: '2026-09-23T15:05:00Z',
                  created_at: '2026-09-23T15:00:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadConversationsCard lead={mockLead} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('timeline-message-out-001')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-message-in-001')).toBeInTheDocument();
      expect(screen.getByTestId('delivery-status-out-001')).toHaveTextContent('Entregue');
      expect(screen.getByTestId('delivery-status-in-001')).toHaveTextContent('Recebido');
    });
  });

  it('renders "Nova resposta" badge for unread inbound email', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'inbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'in-unread-1',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  provider_message_id: 'resend_in_unread',
                  from_address: 'wedersonalmeida2414@gmail.com',
                  to_address: 'info@expdentalsolutions.com',
                  subject: 'Re: Fellowship',
                  body_text: 'Nova dúvida sobre o curso.',
                  body_html: null,
                  received_at: '2026-09-23T16:00:00Z',
                  read_at: null, // Unread
                  created_at: '2026-09-23T16:00:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadConversationsCard lead={mockLead} />
      </MemoryRouter>
    );

    await waitFor(() => {
      const badge = screen.getByTestId('nova-resposta-badge-in-unread-1');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Nova resposta');
    });
  });

  it('cleans quotes: displays fresh reply and reveals quoted text upon clicking toggle', async () => {
    const rawEmailBody = `Gostaria de fechar minha matrícula ainda hoje.

> Em 23 de Setembro de 2026, Expert Dental Solutions escreveu:
> Temos uma condição especial para inscrições antecipadas.`;

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'inbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'in-quote-1',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  provider_message_id: 'resend_quote_1',
                  from_address: 'wedersonalmeida2414@gmail.com',
                  to_address: 'info@expdentalsolutions.com',
                  subject: 'Re: Condição Especial',
                  body_text: rawEmailBody,
                  body_html: null,
                  received_at: '2026-09-23T16:30:00Z',
                  read_at: '2026-09-23T16:35:00Z',
                  created_at: '2026-09-23T16:30:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadConversationsCard lead={mockLead} />
      </MemoryRouter>
    );

    await waitFor(() => {
      const bodyContainer = screen.getByTestId('message-body-in-quote-1');
      expect(bodyContainer).toHaveTextContent('Gostaria de fechar minha matrícula ainda hoje.');
      // Quoted text should not be visible before toggle
      expect(screen.queryByTestId('quoted-text-in-quote-1')).not.toBeInTheDocument();
    });

    // Click toggle to view quoted text
    const toggleBtn = screen.getByTestId('toggle-quote-in-quote-1');
    expect(toggleBtn).toHaveTextContent('Ver histórico citado');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('quoted-text-in-quote-1')).toBeInTheDocument();
    expect(screen.getByTestId('quoted-text-in-quote-1')).toHaveTextContent('Temos uma condição especial');
    expect(toggleBtn).toHaveTextContent('Ocultar histórico citado');
  });

  it('renders "Este e-mail possui anexo" when attachment metadata is present', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'inbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'in-att-1',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  provider_message_id: 'resend_att_1',
                  from_address: 'wedersonalmeida2414@gmail.com',
                  to_address: 'info@expdentalsolutions.com',
                  subject: 'Comprovante de pagamento',
                  body_text: 'Segue em anexo meu comprovante.',
                  body_html: null,
                  attachments: [{ filename: 'comprovante.pdf', size: 104857 }],
                  received_at: '2026-09-23T17:00:00Z',
                  read_at: '2026-09-23T17:05:00Z',
                  created_at: '2026-09-23T17:00:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadConversationsCard lead={mockLead} />
      </MemoryRouter>
    );

    await waitFor(() => {
      const attNotice = screen.getByTestId('attachment-notice-in-att-1');
      expect(attNotice).toBeInTheDocument();
      expect(attNotice).toHaveTextContent('Este e-mail possui anexo:');
      expect(attNotice).toHaveTextContent('comprovante.pdf');
    });
  });

  it('provides a "Responder" action on inbound messages that opens the internal composer with Re: subject', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'inbound_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({
              data: [
                {
                  id: 'in-reply-action-1',
                  lead_id: mockLead.id,
                  conversation_id: 'conv-001',
                  channel: 'email',
                  provider: 'resend',
                  provider_message_id: 'resend_reply_action_1',
                  from_address: 'wedersonalmeida2414@gmail.com',
                  to_address: 'info@expdentalsolutions.com',
                  subject: 'Dúvidas sobre o Curso de Prótese',
                  body_text: 'Qual o horário das aulas práticas?',
                  body_html: null,
                  received_at: '2026-09-23T17:30:00Z',
                  read_at: '2026-09-23T17:35:00Z',
                  created_at: '2026-09-23T17:30:00Z',
                },
              ],
              error: null,
            }),
        };
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadConversationsCard lead={mockLead} />
      </MemoryRouter>
    );

    await waitFor(() => {
      const responderBtn = screen.getByTestId('responder-btn-in-reply-action-1');
      expect(responderBtn).toBeInTheDocument();
      fireEvent.click(responderBtn);
    });

    // Modal should now be open with pre-filled Re: subject
    await waitFor(() => {
      const modalTitle = screen.getByRole('dialog');
      expect(modalTitle).toBeInTheDocument();
      const subjectInput = screen.getByLabelText(/Assunto/i) as HTMLInputElement;
      expect(subjectInput.value).toBe('Re: Dúvidas sobre o Curso de Prótese');
    });
  });

  it('renders gracefully at mobile viewport width (390px) without overflow', async () => {
    (supabase.from as any).mockImplementation((_table: string) => createChainableMock([]));

    const { container } = render(
      <MemoryRouter>
        <div style={{ width: '390px' }}>
          <LeadConversationsCard lead={mockLead} />
        </div>
      </MemoryRouter>
    );

    await waitFor(() => {
      const card = screen.getByTestId('lead-conversations-card');
      expect(card).toBeInTheDocument();
      expect(container.querySelector('.overflow-hidden')).toBeInTheDocument();
    });
  });
});
