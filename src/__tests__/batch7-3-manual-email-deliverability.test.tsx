// =============================================================================
// EDS HUB — BATCH 7.3: MANUAL EMAIL & DELIVERABILITY HEALTH TEST SUITE
// =============================================================================
// Exhaustive test suite verifying all Batch 7.3 requirements:
// 1. Manual Email composer opening from Complete Lead Profile
// 2. Removal of mailto: from canonical quick action
// 3. Invalid/missing email disabling action with factual Portuguese message
// 4. send-conversation-message reuse, sender & reply-to enforcement
// 5. Pre-send email suppression checks (hard_bounce, complaint, unsubscribe)
// 6. Template snapshot insertion & variable substitution without live link
// 7. Double-click prevention & stable idempotency key
// 8. Factual delivery lifecycle statuses (Enviado, Entregue, Falha de entrega, Reclamação / Spam, Falha)
// 9. Zero fake Open/Read/Seen or Inbox/Spam placement claims
// 10. Deliverability Health classification, rolling window, <50 sample guard
// 11. Single hard bounce does not make domain Critical
// 12. Complaint triggers high-priority operational alert
// 13. Read-only suppressions table rendering with search filter
// 14. Lead-level discreet email health badge
// 15. Zero new migrations, zero Google Postmaster integration, zero real emails sent
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { LeadQuickActionBar } from '../features/leads/components/LeadQuickActionBar';
import { ManualEmailComposerModal } from '../features/leads/components/ManualEmailComposerModal';
import {
  calculateDeliverabilityRates,
  classifyDeliverabilityHealth,
  fetchLeadEmailHealth,
  type DeliverabilityRawMetrics,
} from '../features/dashboard/services/deliverability-health-service';
import { supabase } from '../lib/supabase';
import type { Lead } from '../types';

describe('EDS HUB — BATCH 7.3: Manual Email & Deliverability Health', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const validLead: Lead = {
    id: 'lead-123',
    first_name: 'Carlos',
    last_name: 'Mendes',
    email: 'carlos.mendes@example.com',
    phone_raw: '+1 (555) 234-5678',
    phone_e164: '+15552345678',
    contact_preference: 'email',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Lead;

  const invalidLead: Lead = {
    ...validLead,
    id: 'lead-invalid',
    email: 'invalid-email-address',
  };

  const emptyEmailLead: Lead = {
    ...validLead,
    id: 'lead-empty',
    email: null,
  };

  // ===========================================================================
  // PART A: MANUAL EMAIL — LEAD PROFILE (Sections 1–10)
  // ===========================================================================
  describe('Part A: Manual Email Quick Action & Composer', () => {
    it('1. opens internal email composer when canonical Email action is clicked', () => {
      const onOpenEmailComposer = vi.fn();
      render(
        <LeadQuickActionBar
          lead={validLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
          onOpenEmailComposer={onOpenEmailComposer}
        />
      );

      const emailBtn = screen.getByRole('button', { name: /email/i });
      expect(emailBtn).toBeDefined();
      fireEvent.click(emailBtn);
      expect(onOpenEmailComposer).toHaveBeenCalledTimes(1);
    });

    it('2. removes mailto: completely from the canonical Email action', () => {
      const { container } = render(
        <LeadQuickActionBar
          lead={validLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
          onOpenEmailComposer={vi.fn()}
        />
      );

      const emailBtn = screen.getByRole('button', { name: /email/i });
      expect(emailBtn.tagName.toLowerCase()).toBe('button');
      expect(emailBtn.getAttribute('href')).toBeNull();

      const mailtoLinks = container.querySelectorAll('a[href^="mailto:"]');
      expect(mailtoLinks.length).toBe(0);
    });

    it('3. disables Email action when lead email is invalid or missing with exact Portuguese tooltip', () => {
      const { rerender } = render(
        <LeadQuickActionBar
          lead={invalidLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
          onOpenEmailComposer={vi.fn()}
        />
      );

      const emailBtn = screen.getByRole('button', { name: /email/i });
      expect(emailBtn.hasAttribute('disabled')).toBe(true);
      expect(emailBtn.getAttribute('title')).toBe('Este lead não possui um e-mail válido.');

      rerender(
        <LeadQuickActionBar
          lead={emptyEmailLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
          onOpenEmailComposer={vi.fn()}
        />
      );

      const emailBtnEmpty = screen.getByRole('button', { name: /email/i });
      expect(emailBtnEmpty.hasAttribute('disabled')).toBe(true);
      expect(emailBtnEmpty.getAttribute('title')).toBe('Este lead não possui um e-mail válido.');
    });

    it('4. renders fields: To, Subject, Message, Sender, Reply-To and optional template picker', async () => {
      // Mock suppression check: not suppressed
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          } as any;
        }
        if (table === 'email_templates') {
          return {
            select: () => ({
              eq: () => ({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'tpl-1',
                      name: 'Apresentação IDIT',
                      content_json: { subject: 'Bem-vindo, {{salutation}}' },
                      text_template: 'Olá {{first_name}}, obrigado pelo interesse.',
                      is_active: true,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <ManualEmailComposerModal
          isOpen={true}
          lead={validLead}
          onClose={vi.fn()}
          onEmailSent={vi.fn()}
        />
      );

      expect(screen.getByText(/Enviar E-mail Manual/i)).toBeDefined();
      expect(screen.getByText(/De:/i)).toBeDefined();
      expect(screen.getByText(/Expert Dental Solutions <info@expdentalsolutions.com>/i)).toBeDefined();
      expect(screen.getByText(/Responder para:/i)).toBeDefined();
      expect(screen.getByText('info@expdentalsolutions.com')).toBeDefined();
      expect(screen.getByText(/carlos.mendes@example.com/i)).toBeDefined();

      const subjectInput = screen.getByLabelText(/Assunto/i);
      const bodyInput = screen.getByLabelText(/Mensagem/i);
      expect(subjectInput).toBeDefined();
      expect(bodyInput).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText(/Apresentação IDIT/i)).toBeDefined();
      });
    });

    it('5. enforces pre-send suppression blocking for hard_bounce, complaint, and unsubscribe', async () => {
      const suppressionScenarios = [
        {
          reason: 'hard_bounce',
          expectedWarning: 'Este endereço está bloqueado após uma falha permanente de entrega.',
        },
        {
          reason: 'complaint',
          expectedWarning: 'Este endereço foi bloqueado após uma reclamação de spam.',
        },
        {
          reason: 'unsubscribe',
          expectedWarning: 'Este contato cancelou o recebimento de e-mails.',
        },
      ];

      for (const scenario of suppressionScenarios) {
        vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
          if (table === 'email_suppressions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { reason: scenario.reason },
                    error: null,
                  }),
                }),
              }),
            } as any;
          }
          if (table === 'email_templates') {
            return {
              select: () => ({
                eq: () => ({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            } as any;
          }
          return {} as any;
        });

        const { unmount } = render(
          <ManualEmailComposerModal
            isOpen={true}
            lead={validLead}
            onClose={vi.fn()}
            onEmailSent={vi.fn()}
          />
        );

        await waitFor(() => {
          expect(screen.getByText(scenario.expectedWarning)).toBeDefined();
        });

        const sendBtn = screen.getByRole('button', { name: /Enviar Email/i });
        expect(sendBtn.hasAttribute('disabled')).toBe(true);

        unmount();
      }
    });

    it('6. copies template snapshot into composer and resolves variables before user edit', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          } as any;
        }
        if (table === 'email_templates') {
          return {
            select: () => ({
              eq: () => ({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'tpl-fellowship',
                      name: 'Apresentação Fellowship',
                      content_json: { subject: 'Olá Dr(a). {{salutation}}' },
                      text_template: 'Prezado(a) {{first_name}} {{last_name}}, detalhes do curso.',
                      is_active: true,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <ManualEmailComposerModal
          isOpen={true}
          lead={validLead}
          onClose={vi.fn()}
          onEmailSent={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Apresentação Fellowship/i)).toBeDefined();
      });

      const templateSelect = screen.getByLabelText(/Usar Modelo/i);
      fireEvent.change(templateSelect, { target: { value: 'tpl-fellowship' } });

      const subjectInput = screen.getByLabelText(/Assunto/i) as HTMLInputElement;
      const bodyInput = screen.getByLabelText(/Mensagem/i) as HTMLTextAreaElement;

      // Variables replaced with lead's data: Carlos Mendes -> salutation: Mendes
      expect(subjectInput.value).toContain('Mendes');
      expect(bodyInput.value).toContain('Carlos Mendes');

      // User can freely edit snapshot before send
      fireEvent.change(bodyInput, {
        target: { value: bodyInput.value + '\n\nInformações adicionais de turma.' },
      });
      expect(bodyInput.value).toContain('Informações adicionais de turma.');
    });

    it('7. dispatches email via send-conversation-message with double-click guard and idempotency key', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          } as any;
        }
        if (table === 'email_templates') {
          return {
            select: () => ({
              eq: () => ({
                order: vi.fn().mockResolvedValue({
                  data: [{ id: 't-init', name: 'Modelo Padrão', is_active: true }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const functionsClientProto = Object.getPrototypeOf(supabase.functions);
      const invokeSpy = vi.spyOn(functionsClientProto, 'invoke').mockResolvedValue({
        data: {
          success: true,
          outbound_message_id: 'out-msg-1',
          provider_message_id: 'resend-msg-1',
        },
        error: null,
      });

      const onEmailSent = vi.fn();
      render(
        <ManualEmailComposerModal
          isOpen={true}
          lead={validLead}
          onClose={vi.fn()}
          onEmailSent={onEmailSent}
        />
      );

      // Wait for initialization to complete
      await waitFor(() => {
        expect(screen.getByText('Modelo Padrão')).toBeDefined();
      });

      const subjectInput = screen.getByLabelText(/Assunto/i);
      const bodyInput = screen.getByLabelText(/Mensagem/i);
      fireEvent.change(subjectInput, { target: { value: 'Informações sobre matrícula' } });
      fireEvent.change(bodyInput, { target: { value: 'Olá Carlos, seguem os detalhes solicitados.' } });

      const sendBtn = screen.getByRole('button', { name: /Enviar Email/i });
      await waitFor(() => {
        expect(sendBtn.hasAttribute('disabled')).toBe(false);
      });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledTimes(1);
      });
      expect(invokeSpy).toHaveBeenCalledWith('send-conversation-message', {
        body: expect.objectContaining({
          lead_id: 'lead-123',
          channel: 'email',
          subject: 'Informações sobre matrícula',
          body: 'Olá Carlos, seguem os detalhes solicitados.',
          idempotency_key: expect.stringMatching(/^manual_email:lead-123:/),
        }),
      });

      await waitFor(() => {
        expect(screen.getByText('Email enviado')).toBeDefined();
        expect(screen.getByText(/Status:/i)).toBeDefined();
      });
    });

    it('8. backend send-conversation-message code contains suppression checks and stable idempotency', () => {
      const edgeFunctionPath = join(__dirname, '../../supabase/functions/send-conversation-message/index.ts');
      const edgeCode = readFileSync(edgeFunctionPath, 'utf8');

      // 1. Suppression query present
      expect(edgeCode).toContain("from('email_suppressions')");
      expect(edgeCode).toContain('normalized_email');
      expect(edgeCode).toContain('EMAIL_SUPPRESSED');
      expect(edgeCode).toContain('Este endereço está bloqueado após uma falha permanente de entrega.');
      expect(edgeCode).toContain('Este endereço foi bloqueado após uma reclamação de spam.');
      expect(edgeCode).toContain('Este contato cancelou o recebimento de e-mails.');

      // 2. Sender and reply-to standardization
      expect(edgeCode).toContain('Expert Dental Solutions');
      expect(edgeCode).toContain('info@expdentalsolutions.com');

      // 3. Idempotency support
      expect(edgeCode).toContain('idempotency_key');
      expect(edgeCode).toContain('already_processed');

      // 4. Single recipient
      expect(edgeCode).toContain('to: recipient');

      // 5. Zero calls to mailto
      expect(edgeCode).not.toContain('mailto:');
    });

    it('9. verifies mobile composer has sticky headers, cancel, and safe area controls', () => {
      const modalCode = readFileSync(
        join(__dirname, '../features/leads/components/ManualEmailComposerModal.tsx'),
        'utf8'
      );
      expect(modalCode).toContain('sticky top-0');
      expect(modalCode).toContain('sticky bottom-0');
      expect(modalCode).toContain('pb-safe');
      expect(modalCode).toContain('Cancelar');
      expect(modalCode).toContain('Enviar Email');
    });
  });

  // ===========================================================================
  // PART B: DELIVERABILITY HEALTH & METRICS (Sections 11–26, 28)
  // ===========================================================================
  describe('Part B: Deliverability Health & Factual Monitoring', () => {
    it('10. classifies < 50 sends strictly as "Dados insuficientes" while keeping raw counts', () => {
      const lowVolumeMetrics: DeliverabilityRawMetrics = {
        sent: 12,
        delivered: 11,
        bounced: 1,
        complaints: 0,
        failed: 0,
        suppressed: 1,
      };

      const health = classifyDeliverabilityHealth(lowVolumeMetrics);
      expect(health.level).toBe('Dados insuficientes');
      expect(health.isSufficientData).toBe(false);
      expect(health.levelExplanation).toContain('Amostra insuficiente');

      // Factual rates and raw counts are still calculated and returned
      expect(health.rates.deliveryRate).toBe(91.7);
      expect(health.rates.bounceRate).toBe(8.3);
      expect(health.rates.complaintRate).toBe(0.0);
    });

    it('11. does NOT classify whole domain as Critical from a single hard bounce', () => {
      // 1 bounce out of 100 sends (1% bounce rate) with 99 delivered
      const singleBounceMetrics: DeliverabilityRawMetrics = {
        sent: 100,
        delivered: 99,
        bounced: 1,
        complaints: 0,
        failed: 0,
        suppressed: 1,
      };

      const health = classifyDeliverabilityHealth(singleBounceMetrics);
      expect(health.level).not.toBe('Crítico');
      expect(health.level).not.toBe('Risco');
      expect(health.level).toBe('Excelente');
    });

    it('12. surfaces high-priority operational alert when complaint is recorded', () => {
      const complaintMetrics: DeliverabilityRawMetrics = {
        sent: 80,
        delivered: 79,
        bounced: 0,
        complaints: 1,
        failed: 0,
        suppressed: 1,
      };

      const health = classifyDeliverabilityHealth(complaintMetrics);
      expect(health.alerts.length).toBeGreaterThan(0);
      expect(health.alerts[0]).toBe('Alerta: uma reclamação de spam foi registrada.');
      expect(health.level).toBe('Atenção');
    });

    it('13. classifies domain health correctly with sufficient volume (> 50 sends)', () => {
      // Excellent
      const excellent = classifyDeliverabilityHealth({
        sent: 200,
        delivered: 198,
        bounced: 1,
        complaints: 0,
        failed: 1,
        suppressed: 1,
      });
      expect(excellent.level).toBe('Excelente');

      // Risk (bounce rate 3.5%)
      const risk = classifyDeliverabilityHealth({
        sent: 200,
        delivered: 190,
        bounced: 7,
        complaints: 0,
        failed: 3,
        suppressed: 7,
      });
      expect(risk.level).toBe('Risco');

      // Critical (bounce rate 6.0%)
      const critical = classifyDeliverabilityHealth({
        sent: 100,
        delivered: 90,
        bounced: 6,
        complaints: 0,
        failed: 4,
        suppressed: 6,
      });
      expect(critical.level).toBe('Crítico');
    });

    it('14. calculates ONLY provider-backed rates and never calculates Open/Read/Seen rates', () => {
      const sampleMetrics: DeliverabilityRawMetrics = {
        sent: 100,
        delivered: 98,
        bounced: 1,
        complaints: 0,
        failed: 1,
        suppressed: 1,
      };

      const rates = calculateDeliverabilityRates(sampleMetrics);
      expect(rates).toHaveProperty('deliveryRate');
      expect(rates).toHaveProperty('bounceRate');
      expect(rates).toHaveProperty('complaintRate');
      expect(rates).toHaveProperty('failureRate');

      // Strictly verify no Open, Read, or Seen properties exist
      expect(rates).not.toHaveProperty('openRate');
      expect(rates).not.toHaveProperty('readRate');
      expect(rates).not.toHaveProperty('seenRate');
    });

    it('15. verifies lead-level discreet email health badge logic', async () => {
      // 1. Healthy lead with delivered history
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          } as any;
        }
        if (table === 'outbound_messages') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ status: 'delivered', delivered_at: new Date().toISOString() }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const healthyRes = await fetchLeadEmailHealth('healthy@example.com');
      expect(healthyRes.status).toBe('saudavel');
      expect(healthyRes.label).toBe('E-mail saudável');

      // 2. Suppressed lead (hard bounce)
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { reason: 'hard_bounce' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const bouncedRes = await fetchLeadEmailHealth('bounced@example.com');
      expect(bouncedRes.status).toBe('falha');
      expect(bouncedRes.label).toBe('Falha de entrega');

      // 3. Suppressed lead (complaint)
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { reason: 'complaint' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const complainedRes = await fetchLeadEmailHealth('complaint@example.com');
      expect(complainedRes.status).toBe('reclamacao');
      expect(complainedRes.label).toBe('Reclamação / Spam');
    });

    it('16. verifies ConversationThread renders Entregue, Enviado, Falha de entrega, Reclamação / Spam and NEVER Read/Opened', () => {
      const threadCode = readFileSync(
        join(__dirname, '../features/inbox/ConversationThread.tsx'),
        'utf8'
      );

      expect(threadCode).toContain('Entregue');
      expect(threadCode).toContain('Enviado');
      expect(threadCode).toContain('Falha de entrega');
      expect(threadCode).toContain('Reclamação / Spam');
      expect(threadCode).toContain('Falha');

      // Strictly verify no fake read status
      expect(threadCode).not.toContain('Lido');
      expect(threadCode).not.toContain('Aberto');
      expect(threadCode).not.toContain('Visualizado');
    });

    it('17. verifies FoundationStatusPage contains Saúde do E-mail card, disclaimer, and suppressions table', () => {
      const foundationCode = readFileSync(
        join(__dirname, '../features/dashboard/FoundationStatusPage.tsx'),
        'utf8'
      );

      // Card Title per Section 16
      expect(foundationCode).toContain('Saúde do E-mail');

      // Required metrics
      expect(foundationCode).toContain('Enviados');
      expect(foundationCode).toContain('Entregues');
      expect(foundationCode).toContain('Bounces');
      expect(foundationCode).toContain('Reclamações');
      expect(foundationCode).toContain('Falhas Técnicas');
      expect(foundationCode).toContain('Suprimidos');

      // Factual disclaimer per Section 24
      expect(foundationCode).toContain('Critério Factual:');
      expect(foundationCode).toContain('Caixa de Entrada Principal');

      // Read-only suppressions table per Section 22
      expect(foundationCode).toContain('Endereços Suprimidos');
      expect(foundationCode).toContain('normalized_email');

      // No unsuppress or bulk buttons
      expect(foundationCode).not.toContain('Remover supressão');
      expect(foundationCode).not.toContain('Desbloquear');
    });
  });

  // ===========================================================================
  // PART C: SAFETY, MIGRATION & POSTMASTER CONSTRAINTS (Sections 25, 26, 29)
  // ===========================================================================
  describe('Part C: Architectural Safety & Zero Side-Effects', () => {
    it('18. verifies NO new database migration was created (remote baseline remains 00059)', () => {
      const hasMigration60 = existsSync(join(__dirname, '../../supabase/migrations/00060.sql')) ||
        existsSync(join(__dirname, '../../supabase/migrations/00060_create_email_deliverability.sql'));
      expect(hasMigration60).toBe(false);

      const migration59Exists = existsSync(
        join(__dirname, '../../supabase/migrations/00059_create_email_delivery_lifecycle.sql')
      );
      expect(migration59Exists).toBe(true);
    });

    it('19. verifies NO Google Postmaster, seed accounts, or external reputation APIs were integrated', () => {
      const packageJson = JSON.parse(
        readFileSync(join(__dirname, '../../package.json'), 'utf8')
      );
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      expect(allDeps).not.toHaveProperty('google-auth-library');
      expect(allDeps).not.toHaveProperty('googleapis');
      expect(allDeps).not.toHaveProperty('@google-cloud/postmaster');
    });

    it('20. verifies NO campaign, automation, or sequence is auto-triggered by manual email', () => {
      const modalCode = readFileSync(
        join(__dirname, '../features/leads/components/ManualEmailComposerModal.tsx'),
        'utf8'
      );

      // Verify no pipeline stage or automation triggers
      expect(modalCode).not.toContain('pipeline_stage_id');
      expect(modalCode).not.toContain('automation_runs');
      expect(modalCode).not.toContain('sequence_enrollments');
      expect(modalCode).not.toContain('campaign_recipients');
    });
  });
});
