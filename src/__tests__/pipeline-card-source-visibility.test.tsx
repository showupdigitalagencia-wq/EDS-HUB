import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MinimalLeadCard,
  isWebsiteLead,
} from '../features/pipeline/components/MinimalLeadCard';
import type { Lead } from '../types';
import type { LeadDeliverabilityInfo } from '../features/dashboard/services/deliverability-health-service';

// Mock matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function createMockLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-test-uuid',
    first_name: 'Test',
    last_name: 'Lead',
    email: 'test.lead@example.com',
    email_confirmation: null,
    phone_raw: '(11) 99999-9999',
    phone_e164: '+5511999999999',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    qualification_status: null,
    course_interest: 'Cirurgia Avançada',
    course_interests: ['Cirurgia Avançada'],
    source: 'meta',
    source_detail: 'meta_lead_ad',
    source_created_at: '2026-10-06T00:00:00Z',
    created_at: '2026-10-06T00:00:00Z',
    updated_at: '2026-10-06T00:00:00Z',
    ...overrides,
  } as unknown as Lead;
}

const mockSemHistoricoDeliverability: LeadDeliverabilityInfo = {
  status: 'sem_dados',
  label: 'Sem histórico',
  badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
  dotColor: 'bg-slate-400',
  description: 'Nenhum envio recente registrado para este lead.',
  factualStatus: {
    status: 'sem_historico',
    label: 'Sem histórico',
    badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
    dotColor: 'bg-slate-400',
  },
  risk: {
    level: 'sem_historico',
    label: 'Sem histórico',
    color: 'slate',
    badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
    reasons: [],
  },
};

const mockDeliveredDeliverability: LeadDeliverabilityInfo = {
  status: 'saudavel',
  label: 'Saudável',
  badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dotColor: 'bg-emerald-500',
  description: 'E-mail entregue com sucesso à caixa postal.',
  factualStatus: {
    status: 'entregue',
    label: 'Entregue',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotColor: 'bg-emerald-500',
  },
  risk: {
    level: 'baixo',
    label: 'Baixo',
    color: 'emerald',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    reasons: [],
  },
};

describe('Pipeline Lead Card — Source Visibility & Badge Specification', () => {
  // =========================================================================
  // 1. isWebsiteLead Helper Unit Tests
  // =========================================================================
  describe('isWebsiteLead helper', () => {
    it('identifies website/contact_form as website lead', () => {
      expect(isWebsiteLead({ source: 'website', source_detail: 'contact_form' })).toBe(true);
      expect(isWebsiteLead({ source: 'website/contact_form' as any, source_detail: 'contact_form' })).toBe(true);
      expect(isWebsiteLead({ source: 'form', source_detail: 'contact_form' })).toBe(true);
      expect(isWebsiteLead({ source: 'website', source_detail: 'website-contact' })).toBe(true);
    });

    it('identifies website-register as website lead', () => {
      expect(isWebsiteLead({ source: 'form', source_detail: 'website-register' })).toBe(true);
      expect(isWebsiteLead({ source: 'website', source_detail: 'website_registration_form' })).toBe(true);
      expect(isWebsiteLead({ source: 'website', source_detail: 'website/register' })).toBe(true);
      expect(isWebsiteLead({ source: 'website', source_detail: 'website_incomplete_enrollment' })).toBe(true);
      expect(isWebsiteLead({ source: 'website-register' as any })).toBe(true);
    });

    it('identifies Meta lead as NOT website lead', () => {
      expect(isWebsiteLead({ source: 'meta', source_detail: 'meta_lead_ad' })).toBe(false);
      expect(isWebsiteLead({ source: 'meta', source_detail: 'hubspot_historical' })).toBe(false);
      expect(isWebsiteLead({ source: 'meta', source_detail: 'facebook' })).toBe(false);
      expect(isWebsiteLead({ source: 'meta', source_detail: 'instagram' })).toBe(false);
      expect(isWebsiteLead({ source: 'meta', source_detail: 'paid_social' })).toBe(false);
    });

    it('identifies manual lead as NOT website lead', () => {
      expect(isWebsiteLead({ source: 'manual', source_detail: 'manual_crm_entry' })).toBe(false);
      expect(isWebsiteLead({ source: 'manual', source_detail: 'hubspot_historical' })).toBe(false);
      expect(isWebsiteLead({ source: 'manual', source_detail: null })).toBe(false);
    });

    it('safely handles empty or null values', () => {
      expect(isWebsiteLead(null)).toBe(false);
      expect(isWebsiteLead(undefined)).toBe(false);
      expect(isWebsiteLead({ source: null, source_detail: null })).toBe(false);
    });
  });

  // =========================================================================
  // 2. Focused Card Badge Tests
  // =========================================================================
  describe('MinimalLeadCard rendering', () => {
    it('1. website/contact_form -> shows "Site" badge', () => {
      const lead = createMockLead({
        source: 'website',
        source_detail: 'contact_form',
      });

      render(<MinimalLeadCard lead={lead} />);

      const badge = screen.getByTestId('lead-card-source-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('Site');
      expect(badge.getAttribute('title')).toBe('Origem: Site');
    });

    it('2. website-register -> shows "Site" badge', () => {
      const lead = createMockLead({
        source: 'form',
        source_detail: 'website-register',
      });

      render(<MinimalLeadCard lead={lead} />);

      const badge = screen.getByTestId('lead-card-source-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('Site');
    });

    it('3. website_registration_form -> shows "Site" badge', () => {
      const lead = createMockLead({
        source: 'website',
        source_detail: 'website_registration_form',
      });

      render(<MinimalLeadCard lead={lead} />);

      const badge = screen.getByTestId('lead-card-source-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('Site');
    });

    it('4. Meta lead -> NO incorrect Site badge', () => {
      const lead = createMockLead({
        source: 'meta',
        source_detail: 'meta_lead_ad',
      });

      render(<MinimalLeadCard lead={lead} />);

      expect(screen.queryByTestId('lead-card-source-badge')).toBeNull();
      expect(screen.queryByText('Site')).toBeNull();
    });

    it('5. Meta lead with hubspot_historical -> NO incorrect Site badge', () => {
      const lead = createMockLead({
        source: 'meta',
        source_detail: 'hubspot_historical',
      });

      render(<MinimalLeadCard lead={lead} />);

      expect(screen.queryByTestId('lead-card-source-badge')).toBeNull();
      expect(screen.queryByText('Site')).toBeNull();
    });

    it('6. manual lead -> NO incorrect Site badge', () => {
      const lead = createMockLead({
        source: 'manual',
        source_detail: 'manual_crm_entry',
      });

      render(<MinimalLeadCard lead={lead} />);

      expect(screen.queryByTestId('lead-card-source-badge')).toBeNull();
      expect(screen.queryByText('Site')).toBeNull();
    });

    it('7. manual lead without detail -> NO incorrect Site badge', () => {
      const lead = createMockLead({
        source: 'manual',
        source_detail: null,
      });

      render(<MinimalLeadCard lead={lead} />);

      expect(screen.queryByTestId('lead-card-source-badge')).toBeNull();
      expect(screen.queryByText('Site')).toBeNull();
    });

    // =======================================================================
    // 3. Factual Dr Frias Validation Case
    // =======================================================================
    it('8. Dr Frias validation case: visibly shows "Site" badge alongside "Sem histórico"', () => {
      // Replicating Dr Frias read-only database record:
      // first_name: 'Dr frias', source: 'website', source_detail: 'contact_form', email: 'friasdentaloffice@gmail.com'
      const drFriasLead = createMockLead({
        id: '0bdd665d-7a81-45b3-ac37-f1de3834b504',
        first_name: 'Dr frias',
        last_name: null,
        email: 'friasdentaloffice@gmail.com',
        phone_raw: '(787) 341-6682',
        source: 'website',
        source_detail: 'contact_form',
      });

      render(
        <MinimalLeadCard
          lead={drFriasLead}
          deliverabilityHealth={mockSemHistoricoDeliverability}
          attentionState={{
            label: 'Aguardando resposta manual',
            variant: 'neutral',
          }}
        />
      );

      // 1. Shows lead name
      expect(screen.getByText('Dr frias')).toBeDefined();

      // 2. Visibly shows "Site" badge
      const siteBadge = screen.getByTestId('lead-card-source-badge');
      expect(siteBadge).toBeDefined();
      expect(siteBadge.textContent).toBe('Site');

      // 3. Preserves communication status: "Sem histórico" deliverability badge
      const delivBadge = screen.getByTestId('deliverability-health-badge');
      expect(delivBadge).toBeDefined();
      expect(delivBadge.textContent).toContain('Sem histórico');

      // 4. Preserves attention state: "Aguardando resposta manual"
      expect(screen.getByText('Aguardando resposta manual')).toBeDefined();
    });

    // =======================================================================
    // 4. Coexistence with Communication Badges
    // =======================================================================
    it('9. preserves all existing badges (SMS enviado, WhatsApp enviado, E-mail entregue, Risco Baixo) without duplicates', () => {
      const lead = createMockLead({
        first_name: 'Dra. Patricia',
        last_name: 'Mendes',
        source: 'website',
        source_detail: 'contact_form',
        has_new_submission: true,
      });

      render(
        <MinimalLeadCard
          lead={lead}
          deliverabilityHealth={mockDeliveredDeliverability}
          smsSentInfo={{ sentAt: '2026-10-06T08:00:00Z', formattedDate: '08:00' }}
          whatsappSentInfo={{ sentAt: '2026-10-06T08:05:00Z', formattedDate: '08:05' }}
        />
      );

      // Site badge
      expect(screen.getByTestId('lead-card-source-badge').textContent).toBe('Site');

      // Outbound communication badges coexist
      expect(screen.getByTestId('lead-card-sms-sent-badge')).toBeDefined();
      expect(screen.getByTestId('lead-card-sms-sent-badge').textContent).toContain('SMS enviado');

      expect(screen.getByTestId('lead-card-whatsapp-sent-badge')).toBeDefined();
      expect(screen.getByTestId('lead-card-whatsapp-sent-badge').textContent).toContain('WhatsApp enviado');

      expect(screen.getByTestId('deliverability-health-badge')).toBeDefined();
      expect(screen.getByTestId('deliverability-health-badge').textContent).toContain('Entregue');

      expect(screen.getByTestId('deliverability-risk-badge')).toBeDefined();
      expect(screen.getByTestId('deliverability-risk-badge').textContent).toContain('Risco: Baixo');

      // New submission badge
      expect(screen.getByTestId('lead-card-new-submission-badge')).toBeDefined();
      expect(screen.getByTestId('lead-card-new-submission-badge').textContent).toContain('Novo formulário');

      // Exactly ONE source badge rendered (no duplicates)
      const allSourceBadges = screen.getAllByTestId('lead-card-source-badge');
      expect(allSourceBadges.length).toBe(1);
    });

    // =======================================================================
    // 5. Mobile Layout & Overflow Safety
    // =======================================================================
    it('10. long lead name does not break layout or cover drag handle on mobile', () => {
      const lead = createMockLead({
        first_name: 'Dr. Fernando Antonio de Albuquerque Maranhão Cavalcanti',
        last_name: 'Filho',
        source: 'website',
        source_detail: 'contact_form',
      });

      const { container } = render(<MinimalLeadCard lead={lead} />);

      // Name container has min-w-0 and flex-1
      const nameHeading = screen.getByText('Dr. Fernando Antonio de Albuquerque Maranhão Cavalcanti Filho');
      expect(nameHeading.classList.contains('truncate')).toBe(true);

      // Site badge is shrink-0
      const siteBadge = screen.getByTestId('lead-card-source-badge');
      expect(siteBadge.classList.contains('shrink-0')).toBe(true);

      // Drag grip icon exists and is not covered
      const gripIcon = container.querySelector('.lucide-grip-vertical');
      expect(gripIcon).not.toBeNull();
    });
  });
});
