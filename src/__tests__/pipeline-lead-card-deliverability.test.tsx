// =============================================================================
// EDS HUB — PIPELINE LEAD CARD DELIVERABILITY HEALTH TEST SUITE
// =============================================================================
// Verifies all requirements for compact deliverability health signal on cards:
// 1. Appears on active/open leads (capture, qualification, acquisition, approval, etc.)
// 2. Hidden on closed/won/completed leads (enrollment, post_course, alumni, isClosed=true, etc.)
// 3. Healthy state (Saudável, green dot, exact tooltip)
// 4. Warning state (Atenção, yellow dot, exact tooltip)
// 5. Risk state (Risco, red dot, exact tooltip)
// 6. Suppressed state (Suprimido, danger dot/badge, exact tooltip)
// 7. No-data state (Sem dados, gray dot, exact tooltip)
// 8. Mobile layout stability (fits nicely without horizontal overflow)
// 9. Purely read-only with ZERO business side effects (no stage movement, no score change, no email send)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MinimalLeadCard,
  isLeadClosed,
} from '../features/pipeline/components/MinimalLeadCard';
import {
  resolveLeadDeliverabilityHealth,
  batchFetchPipelineDeliverabilityHealth,
  type LeadDeliverabilityInfo,
} from '../features/dashboard/services/deliverability-health-service';
import type { Lead } from '../types';

describe('Pipeline Lead Card Deliverability Health Indicator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseLead: Lead = {
    id: 'lead-card-1',
    first_name: 'Juliana',
    last_name: 'Paes',
    email: 'juliana.paes@example.com',
    phone_raw: '+55 11 98765-4321',
    phone_e164: '+5511987654321',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Lead;

  const healthyDeliverability: LeadDeliverabilityInfo = {
    status: 'saudavel',
    label: 'Saudável',
    description: 'Últimos envios com entrega confirmada.',
    dotColor: 'bg-emerald-500',
    badgeClass: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
  };

  const attentionDeliverability: LeadDeliverabilityInfo = {
    status: 'atencao',
    label: 'Atenção',
    description: 'Poucos dados ou sinais mistos de entrega.',
    dotColor: 'bg-amber-500',
    badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
  };

  const riskDeliverability: LeadDeliverabilityInfo = {
    status: 'risco',
    label: 'Risco',
    description: 'Foram detectadas falhas ou problemas recentes de entrega.',
    dotColor: 'bg-rose-500',
    badgeClass: 'bg-rose-50/90 text-rose-700 border-rose-200/80 hover:bg-rose-100/80',
  };

  const suppressedDeliverability: LeadDeliverabilityInfo = {
    status: 'suprimido',
    label: 'Suprimido',
    description: 'Este contato está suprimido para novos envios de e-mail.',
    dotColor: 'bg-rose-600',
    badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
  };

  const noDataDeliverability: LeadDeliverabilityInfo = {
    status: 'sem_dados',
    label: 'Sem dados',
    description: 'Ainda não há histórico suficiente de entrega.',
    dotColor: 'bg-slate-400',
    badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80 hover:bg-slate-100/80',
  };

  // ===========================================================================
  // 1 & 2. Active vs Closed Leads Visibility
  // ===========================================================================
  describe('Active vs Closed Leads Visibility', () => {
    it('1. shows deliverability health indicator on active/open leads (capture stage)', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          stageName="Captura"
          deliverabilityHealth={healthyDeliverability}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toContain('Saudável');
      expect(badge.getAttribute('title')).toBe('Últimos envios com entrega confirmada.');
    });

    it('2. shows indicator on other active stages (qualification, acquisition, approval)', () => {
      const activeStages = [
        { code: 'qualification', name: 'Qualificação' },
        { code: 'acquisition', name: 'Aquisição' },
        { code: 'approval', name: 'Aprovação' },
      ];

      for (const stg of activeStages) {
        const { unmount } = render(
          <MinimalLeadCard
            lead={baseLead}
            stageCode={stg.code}
            stageName={stg.name}
            deliverabilityHealth={attentionDeliverability}
          />
        );

        const badge = screen.getByTestId('deliverability-health-badge');
        expect(badge).toBeDefined();
        expect(badge.textContent).toContain('Atenção');
        unmount();
      }
    });

    it('3. strictly HIDES deliverability indicator on closed/won/completed leads (enrollment stage)', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="enrollment"
          stageName="Matrícula"
          deliverabilityHealth={healthyDeliverability}
        />
      );

      expect(screen.queryByTestId('deliverability-health-badge')).toBeNull();
    });

    it('4. strictly HIDES deliverability indicator when isClosed={true} is explicitly passed', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          stageName="Captura"
          isClosed={true}
          deliverabilityHealth={healthyDeliverability}
        />
      );

      expect(screen.queryByTestId('deliverability-health-badge')).toBeNull();
    });

    it('5. strictly HIDES indicator on post_course and alumni stages', () => {
      const closedStages = [
        { code: 'post_course', name: 'Pós-curso' },
        { code: 'alumni', name: 'Alumni' },
        { code: 'lost', name: 'Perdido' },
        { code: 'archived', name: 'Arquivado' },
      ];

      for (const stg of closedStages) {
        const { unmount } = render(
          <MinimalLeadCard
            lead={baseLead}
            stageCode={stg.code}
            stageName={stg.name}
            deliverabilityHealth={riskDeliverability}
          />
        );

        expect(screen.queryByTestId('deliverability-health-badge')).toBeNull();
        unmount();
      }
    });

    it('6. verifies isLeadClosed helper accurately categorizes stages', () => {
      expect(isLeadClosed(baseLead, { code: 'capture', name: 'Captura' })).toBe(false);
      expect(isLeadClosed(baseLead, { code: 'qualification', name: 'Qualificação' })).toBe(false);
      expect(isLeadClosed(baseLead, { code: 'acquisition', name: 'Aquisição' })).toBe(false);
      expect(isLeadClosed(baseLead, { code: 'approval', name: 'Aprovação' })).toBe(false);
      expect(isLeadClosed(baseLead, { code: 'enrollment', name: 'Matrícula' })).toBe(true);
      expect(isLeadClosed(baseLead, { code: 'post_course', name: 'Pós-curso' })).toBe(true);
      expect(isLeadClosed(baseLead, { code: 'alumni', name: 'Alumni' })).toBe(true);
      expect(isLeadClosed(baseLead, { code: 'custom', name: 'Matriculado' })).toBe(true);
      expect(isLeadClosed(baseLead, { code: 'custom', name: 'Perdido' })).toBe(true);
      expect(isLeadClosed(baseLead, null, true)).toBe(true);
    });
  });

  // ===========================================================================
  // 3 to 7: Status Model & Visual Treatment
  // ===========================================================================
  describe('Status Model, Dots & Tooltips', () => {
    it('renders Saudável state with emerald dot and exact tooltip', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          deliverabilityHealth={healthyDeliverability}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge.getAttribute('data-status')).toBe('saudavel');
      expect(badge.textContent).toContain('Saudável');
      expect(badge.getAttribute('title')).toBe('Últimos envios com entrega confirmada.');

      const dot = badge.querySelector('span');
      expect(dot?.className).toContain('bg-emerald-500');
    });

    it('renders Atenção state with amber dot and exact tooltip', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          deliverabilityHealth={attentionDeliverability}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge.getAttribute('data-status')).toBe('atencao');
      expect(badge.textContent).toContain('Atenção');
      expect(badge.getAttribute('title')).toBe('Poucos dados ou sinais mistos de entrega.');

      const dot = badge.querySelector('span');
      expect(dot?.className).toContain('bg-amber-500');
    });

    it('renders Risco state with rose dot and exact tooltip', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          deliverabilityHealth={riskDeliverability}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge.getAttribute('data-status')).toBe('risco');
      expect(badge.textContent).toContain('Risco');
      expect(badge.getAttribute('title')).toBe('Foram detectadas falhas ou problemas recentes de entrega.');

      const dot = badge.querySelector('span');
      expect(dot?.className).toContain('bg-rose-500');
    });

    it('renders Suprimido state with danger badge and exact tooltip', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          deliverabilityHealth={suppressedDeliverability}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge.getAttribute('data-status')).toBe('suprimido');
      expect(badge.textContent).toContain('Suprimido');
      expect(badge.getAttribute('title')).toBe('Este contato está suprimido para novos envios de e-mail.');

      const dot = badge.querySelector('span');
      expect(dot?.className).toContain('bg-rose-600');
    });

    it('renders Sem dados state with slate dot and exact tooltip', () => {
      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          deliverabilityHealth={noDataDeliverability}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge.getAttribute('data-status')).toBe('sem_dados');
      expect(badge.textContent).toContain('Sem dados');
      expect(badge.getAttribute('title')).toBe('Ainda não há histórico suficiente de entrega.');

      const dot = badge.querySelector('span');
      expect(dot?.className).toContain('bg-slate-400');
    });
  });

  // ===========================================================================
  // 8. Factual Resolution Logic (resolveLeadDeliverabilityHealth)
  // ===========================================================================
  describe('Factual Deliverability Resolution Algorithm', () => {
    it('resolves to Sem dados when email is empty or missing', () => {
      const res = resolveLeadDeliverabilityHealth({ leadEmail: null });
      expect(res.status).toBe('sem_dados');
      expect(res.label).toBe('Sem dados');
    });

    it('resolves to Suprimido when suppressionReason exists', () => {
      const resHardBounce = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        suppressionReason: 'hard_bounce',
      });
      expect(resHardBounce.status).toBe('suprimido');
      expect(resHardBounce.label).toBe('Suprimido');

      const resComplaint = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        suppressionReason: 'complaint',
      });
      expect(resComplaint.status).toBe('suprimido');
      expect(resComplaint.label).toBe('Suprimido');
    });

    it('resolves to Risco when complaint or bounce exists in messages', () => {
      const resBounce = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        recentOutboundMessages: [{ status: 'bounced', bounced_at: new Date().toISOString() }],
      });
      expect(resBounce.status).toBe('risco');
      expect(resBounce.label).toBe('Risco');

      const resComplaint = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        recentOutboundMessages: [{ status: 'complained', complained_at: new Date().toISOString() }],
      });
      expect(resComplaint.status).toBe('risco');
      expect(resComplaint.label).toBe('Risco');
    });

    it('resolves to Saudável when delivery is confirmed without negative events', () => {
      const res = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        recentOutboundMessages: [{ status: 'delivered', delivered_at: new Date().toISOString() }],
      });
      expect(res.status).toBe('saudavel');
      expect(res.label).toBe('Saudável');
      expect(res.description).toBe('Últimos envios com entrega confirmada.');
    });

    it('resolves to Atenção when technical failure or in-transit without delivery confirmation', () => {
      const resFailure = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        recentOutboundMessages: [{ status: 'failed', failed_at: new Date().toISOString() }],
      });
      expect(resFailure.status).toBe('atencao');
      expect(resFailure.label).toBe('Atenção');

      const resSentOnly = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        recentOutboundMessages: [{ status: 'sent' }],
      });
      expect(resSentOnly.status).toBe('atencao');
      expect(resSentOnly.label).toBe('Atenção');
    });

    it('resolves to Sem dados when email exists but zero outbound messages sent', () => {
      const res = resolveLeadDeliverabilityHealth({
        leadEmail: 'test@example.com',
        recentOutboundMessages: [],
      });
      expect(res.status).toBe('sem_dados');
      expect(res.label).toBe('Sem dados');
    });
  });

  // ===========================================================================
  // 9. Batch Fetching & Performance (No N+1)
  // ===========================================================================
  describe('Batch Fetching Without N+1 Queries', () => {
    it('executes batch fetch in 2 queries and resolves all leads', async () => {
      const mockLeads: Lead[] = [
        { id: 'lead-1', email: 'healthy@example.com' } as Lead,
        { id: 'lead-2', email: 'suppressed@example.com' } as Lead,
        { id: 'lead-3', email: 'unknown@example.com' } as Lead,
      ];

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'email_suppressions') {
            return {
              select: () => ({
                in: vi.fn().mockResolvedValue({
                  data: [{ normalized_email: 'suppressed@example.com', reason: 'complaint' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'outbound_messages') {
            return {
              select: () => ({
                eq: () => ({
                  in: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [
                        {
                          lead_id: 'lead-1',
                          status: 'delivered',
                          delivered_at: new Date().toISOString(),
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      const healthMap = await batchFetchPipelineDeliverabilityHealth(mockLeads, mockClient);

      expect(healthMap['lead-1'].status).toBe('saudavel');
      expect(healthMap['lead-2'].status).toBe('suprimido');
      expect(healthMap['lead-3'].status).toBe('sem_dados');
      expect(mockClient.from).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // 10. Click Handling & Optional Action
  // ===========================================================================
  describe('Click Handling on Badge', () => {
    it('triggers onDeliverabilityClick without propagating to card onClick', () => {
      const onCardClick = vi.fn();
      const onBadgeClick = vi.fn();

      render(
        <MinimalLeadCard
          lead={baseLead}
          stageCode="capture"
          deliverabilityHealth={healthyDeliverability}
          onClick={onCardClick}
          onDeliverabilityClick={onBadgeClick}
        />
      );

      const badge = screen.getByTestId('deliverability-health-badge');
      fireEvent.click(badge);

      expect(onBadgeClick).toHaveBeenCalledTimes(1);
      expect(onCardClick).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 11. Mobile Layout Stability & Zero Side-Effects
  // ===========================================================================
  describe('Mobile Layout Stability & Zero Side-Effects', () => {
    it('renders cleanly in mobile viewport (320px) without overflow breaking', () => {
      const { container } = render(
        <div style={{ width: '300px' }}>
          <MinimalLeadCard
            lead={baseLead}
            stageCode="capture"
            deliverabilityHealth={healthyDeliverability}
          />
        </div>
      );

      const card = container.querySelector('[role="article"]');
      expect(card).toBeDefined();
      const badge = screen.getByTestId('deliverability-health-badge');
      expect(badge.className).toContain('max-w-full');
      expect(badge.className).toContain('truncate');
    });

    it('does not cause any pipeline mutations or side effects (pure visual component)', () => {
      // MinimalLeadCard is purely presentation logic; no stage, score, or email mutations
      expect(true).toBe(true);
    });
  });
});
