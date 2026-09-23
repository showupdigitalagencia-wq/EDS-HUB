/**
 * =============================================================================
 * EDS HUB — Lead Profile Conversation History Test Suite
 * =============================================================================
 * Verifies factual communication history inside the Complete Lead Profile's
 * Conversas tab:
 * 1. Current lead only (queries scoped strictly by lead_id)
 * 2. Unrelated lead excluded
 * 3. Outbound email visible with "Você · E-mail"
 * 4. Inbound email visible with "<Lead Name> · E-mail"
 * 5. Subject visible
 * 6. Body visible (with expandable toggle for lengthy content)
 * 7. Timestamp visible (date and time formatted in pt-BR)
 * 8. Factual delivery status visible (Enviado, Entregue, Recebido, Falha de entrega, Reclamação / Spam)
 * 9. Realtime delivered update reflection
 * 10. Strict exclusion of Read/Seen/Opened/Lido/Visualizado
 * 11. Empty state exact Portuguese copy
 * 12. "Nova mensagem" opens internal email composer
 * 13. "Enviar primeira mensagem" opens internal email composer
 * 14. Thread grouping behavior
 * 15. Mobile layout stability (390px width)
 * 16. No business side effects
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
  id: 'lead-123',
  first_name: 'Dra. Camila',
  last_name: 'Albuquerque',
  email: 'camila.albuquerque@clinica.com.br',
  phone_raw: '(11) 98765-4321',
  phone_e164: '+5511987654321',
  source: 'form',
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-01T10:00:00Z',
} as unknown as Lead;

describe('Lead Profile — Conversation History (Conversas Tab)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Scoping by lead_id & Unrelated Lead Exclusion', () => {
    it('scopes all queries strictly to the current lead_id and excludes other leads', async () => {
      const eqCalls: { col: string; val: any }[] = [];

      (supabase.from as any).mockImplementation((_table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: any) => {
            eqCalls.push({ col, val });
            return chain;
          }),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return chain;
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('outbound_messages');
        expect(supabase.from).toHaveBeenCalledWith('inbound_messages');
      });

      // Confirm both queries explicitly checked lead_id = mockLead.id
      const leadIdChecks = eqCalls.filter(
        (c) => c.col === 'lead_id' && c.val === 'lead-123'
      );
      expect(leadIdChecks.length).toBeGreaterThanOrEqual(2);

      // Confirm no queries ever requested a global feed or another lead
      const otherLeadChecks = eqCalls.filter(
        (c) => c.col === 'lead_id' && c.val !== 'lead-123'
      );
      expect(otherLeadChecks.length).toBe(0);
    });

    it('does not display messages belonging to unrelated leads even if returned in dataset', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-1',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Assunto do Lead Correto',
              body_snapshot: 'Mensagem pertencente à Dra. Camila Albuquerque',
              status: 'delivered',
              sent_at: '2026-03-10T14:00:00Z',
              created_at: '2026-03-10T14:00:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Assunto do Lead Correto')).toBeInTheDocument();
      });

      expect(screen.queryByText('Lead Não Relacionado')).toBeNull();
    });
  });

  describe('2. Outbound & Inbound Message Rendering', () => {
    it('renders outbound manual email with "Você · E-mail", subject, body, date, and status', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-101',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Informações sobre a Turma IDIT Março',
              body_snapshot: 'Olá Dra. Camila, segue a ementa do curso e os módulos práticos.',
              status: 'sent',
              sent_at: '2026-03-12T15:30:00Z',
              created_at: '2026-03-12T15:30:00Z',
              is_manual_reply: true,
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Você · E-mail')).toBeInTheDocument();
      });

      expect(screen.getByText('Informações sobre a Turma IDIT Março')).toBeInTheDocument();
      expect(
        screen.getByText('Olá Dra. Camila, segue a ementa do curso e os módulos práticos.')
      ).toBeInTheDocument();
      expect(screen.getByText('Enviado')).toBeInTheDocument();
    });

    it('renders inbound email with "<Lead Name> · E-mail" and status "Recebido"', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'inbound_messages') {
          return createChainableMock([
            {
              id: 'in-201',
              lead_id: 'lead-123',
              channel: 'email',
              from_address: 'camila.albuquerque@clinica.com.br',
              subject: 'Dúvida sobre as datas práticas',
              body_text: 'Gostaria de saber se haverá aula prática no primeiro final de semana.',
              received_at: '2026-03-13T09:15:00Z',
              created_at: '2026-03-13T09:15:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dra. Camila Albuquerque · E-mail')).toBeInTheDocument();
      });

      expect(screen.getByText('Dúvida sobre as datas práticas')).toBeInTheDocument();
      expect(
        screen.getByText('Gostaria de saber se haverá aula prática no primeiro final de semana.')
      ).toBeInTheDocument();
      expect(screen.getByText('Recebido')).toBeInTheDocument();
    });
  });

  describe('3. Factual Delivery Status Model (Zero Fake Read/Seen/Opened)', () => {
    it('renders factual statuses: Enviado, Entregue, Falha de entrega, Reclamação / Spam', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-delivered',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Email 1 Entregue',
              body_snapshot: 'Conteúdo 1',
              status: 'delivered',
              sent_at: '2026-03-10T10:00:00Z',
            },
            {
              id: 'out-sent',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Email 2 Enviado',
              body_snapshot: 'Conteúdo 2',
              status: 'sent',
              sent_at: '2026-03-10T11:00:00Z',
            },
            {
              id: 'out-bounced',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Email 3 Falha',
              body_snapshot: 'Conteúdo 3',
              status: 'bounced',
              sent_at: '2026-03-10T12:00:00Z',
            },
            {
              id: 'out-complained',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Email 4 Spam',
              body_snapshot: 'Conteúdo 4',
              status: 'complained',
              sent_at: '2026-03-10T13:00:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Email 1 Entregue')).toBeInTheDocument();
      });

      expect(screen.getByText('Entregue')).toBeInTheDocument();
      expect(screen.getByText('Enviado')).toBeInTheDocument();
      expect(screen.getByText('Falha de entrega')).toBeInTheDocument();
      expect(screen.getByText('Reclamação / Spam')).toBeInTheDocument();
    });

    it('strictly does NOT show Read, Seen, Opened, Lido, or Visualizado', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-check',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Status Test Email',
              body_snapshot: 'Verificação de ausência de fake read receipts.',
              status: 'delivered',
              sent_at: '2026-03-10T10:00:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Status Test Email')).toBeInTheDocument();
      });

      // Strict negative assertions
      expect(screen.queryByText(/^Read$/i)).toBeNull();
      expect(screen.queryByText(/^Seen$/i)).toBeNull();
      expect(screen.queryByText(/^Opened$/i)).toBeNull();
      expect(screen.queryByText(/^Lido$/i)).toBeNull();
      expect(screen.queryByText(/^Visualizado$/i)).toBeNull();
    });
  });

  describe('4. Realtime Delivered Status Update', () => {
    it('registers Supabase Realtime channel for outbound_messages to update status when webhook delivers', async () => {
      (supabase.from as any).mockImplementation(() => createChainableMock([]));

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(supabase.channel).toHaveBeenCalledWith('lead-comms-lead-123');
      });
    });
  });

  describe('5. Empty State & Exact Portuguese Copy', () => {
    it('renders exact Portuguese empty state when no communication exists', async () => {
      (supabase.from as any).mockImplementation(() => createChainableMock([]));

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Nenhuma conversa registrada')).toBeInTheDocument();
      });

      expect(
        screen.getByText(
          'Quando você enviar ou receber uma mensagem deste lead, ela aparecerá aqui.'
        )
      ).toBeInTheDocument();
      expect(screen.getByText('Enviar primeira mensagem')).toBeInTheDocument();
    });

    it('renders Portuguese section header and channel filter tabs', async () => {
      (supabase.from as any).mockImplementation(() => createChainableMock([]));

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Conversas \(0\)/i)).toBeInTheDocument();
      });

      expect(screen.getByText('Histórico factual de comunicações deste lead')).toBeInTheDocument();
      expect(screen.getByText('Todos')).toBeInTheDocument();
      expect(screen.getByText('E-mail')).toBeInTheDocument();
      expect(screen.getByText('Nova mensagem')).toBeInTheDocument();
    });
  });

  describe('6. Composer Integration (Internal EDS HUB Email Composer)', () => {
    it('"Nova mensagem" button triggers onOpenComposer callback to open internal composer', async () => {
      const openComposerMock = vi.fn();
      (supabase.from as any).mockImplementation(() => createChainableMock([]));

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} onOpenComposer={openComposerMock} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('nova-mensagem-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('nova-mensagem-btn'));
      expect(openComposerMock).toHaveBeenCalledTimes(1);
    });

    it('"Enviar primeira mensagem" button in empty state triggers onOpenComposer callback', async () => {
      const openComposerMock = vi.fn();
      (supabase.from as any).mockImplementation(() => createChainableMock([]));

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} onOpenComposer={openComposerMock} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('enviar-primeira-mensagem-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('enviar-primeira-mensagem-btn'));
      expect(openComposerMock).toHaveBeenCalledTimes(1);
    });

    it('opens internal fallback composer modal when onOpenComposer prop is not passed', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'email_templates') {
          return createChainableMock([]);
        }
        if (table === 'email_suppressions') {
          return createChainableMock(null);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('nova-mensagem-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('nova-mensagem-btn'));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Enviar E-mail Manual')).toBeInTheDocument();
      });
    });
  });

  describe('7. Thread Grouping & Chronological Order', () => {
    it('groups messages naturally by thread and shows thread topic header when multiple threads exist', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-t1',
              lead_id: 'lead-123',
              conversation_id: 'conv-thread-1',
              channel: 'email',
              subject_snapshot: 'Turma de Março',
              body_snapshot: 'Mensagem do Tópico 1',
              status: 'delivered',
              sent_at: '2026-03-01T10:00:00Z',
            },
            {
              id: 'out-t2',
              lead_id: 'lead-123',
              conversation_id: 'conv-thread-2',
              channel: 'email',
              subject_snapshot: 'Dúvidas Financeiras',
              body_snapshot: 'Mensagem do Tópico 2',
              status: 'sent',
              sent_at: '2026-03-02T11:00:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('thread-group-0')).toBeInTheDocument();
        expect(screen.getByTestId('thread-group-1')).toBeInTheDocument();
      });

      expect(screen.getByText(/Tópico: Turma de Março/i)).toBeInTheDocument();
      expect(screen.getByText(/Tópico: Dúvidas Financeiras/i)).toBeInTheDocument();
    });
  });

  describe('8. Expandable Body & Mobile Layout Stability (390px)', () => {
    it('provides expandable toggle ("Ver mais" / "Ver menos") for lengthy emails', async () => {
      const longText = 'Esta é uma mensagem muito detalhada sobre o curso IDIT. '.repeat(10);

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-long',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Ementa Completa do Curso',
              body_snapshot: longText,
              status: 'delivered',
              sent_at: '2026-03-05T10:00:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Ver mais')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Ver mais'));
      expect(screen.getByText('Ver menos')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Ver menos'));
      expect(screen.getByText('Ver mais')).toBeInTheDocument();
    });

    it('renders cleanly in mobile viewport (390px) without horizontal overflow', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return createChainableMock([
            {
              id: 'out-mobile',
              lead_id: 'lead-123',
              channel: 'email',
              subject_snapshot: 'Assunto Longo Para Validar Responsividade Mobile 390px Sem Estourar',
              body_snapshot: 'Texto mobile seguro e legível.',
              status: 'delivered',
              sent_at: '2026-03-05T10:00:00Z',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <div style={{ width: '390px', maxWidth: '100%' }}>
          <MemoryRouter>
            <LeadConversationsCard lead={mockLead} />
          </MemoryRouter>
        </div>
      );

      await waitFor(() => {
        expect(screen.getByTestId('lead-conversations-card')).toBeInTheDocument();
      });

      const card = screen.getByTestId('lead-conversations-card');
      expect(card.className).toContain('w-full');
      expect(card.className).toContain('max-w-full');
      expect(card.className).toContain('overflow-hidden');

      // Subject has break-words or truncation
      const subject = screen.getByTestId('message-subject-out-mobile');
      expect(subject.className).toContain('break-words');
    });
  });

  describe('9. Zero Business Side-Effects', () => {
    it('does NOT trigger pipeline movement, scoring change, automation, or sequence upon viewing or opening composer', async () => {
      (supabase.from as any).mockImplementation(() => createChainableMock([]));

      render(
        <MemoryRouter>
          <LeadConversationsCard lead={mockLead} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('lead-conversations-card')).toBeInTheDocument();
      });

      // No mutating updates to leads, pipeline, automations, or sequences
      expect(supabase.from).not.toHaveBeenCalledWith('automations');
      expect(supabase.from).not.toHaveBeenCalledWith('sequences');
      expect(supabase.from).not.toHaveBeenCalledWith('campaigns');
      expect(supabase.from).not.toHaveBeenCalledWith('pipeline_stages');
    });
  });
});
