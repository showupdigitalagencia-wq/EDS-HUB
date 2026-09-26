import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import {
  resolveCanonicalPreference,
  getContactPreferenceLabel,
  formatContactPreferenceLabel,
  getContactPreferenceBadgeClasses,
} from '../utils/contact-preference';
import type { Lead } from '../types';
import type { LeadDeliverabilityInfo } from '../features/dashboard/services/deliverability-health-service';

describe('Contact Preference Resolver & Formatter Unit Tests', () => {
  it('resolves Email canonical preference', () => {
    expect(resolveCanonicalPreference('email')).toBe('email');
    expect(resolveCanonicalPreference('EMAIL')).toBe('email');
    expect(resolveCanonicalPreference('e-mail')).toBe('email');
    expect(resolveCanonicalPreference('mail')).toBe('email');
    expect(formatContactPreferenceLabel('email')).toBe('Preferência: Email');
    expect(formatContactPreferenceLabel('email', { withPrefix: false })).toBe('Email');
  });

  it('resolves SMS canonical preference', () => {
    expect(resolveCanonicalPreference('sms')).toBe('sms');
    expect(resolveCanonicalPreference('SMS')).toBe('sms');
    expect(resolveCanonicalPreference('text')).toBe('sms');
    expect(resolveCanonicalPreference('text_message')).toBe('sms');
    expect(formatContactPreferenceLabel('sms')).toBe('Preferência: SMS');
    expect(formatContactPreferenceLabel('sms', { withPrefix: false })).toBe('SMS');
  });

  it('resolves Ligação / Call canonical preference', () => {
    expect(resolveCanonicalPreference('call')).toBe('call');
    expect(resolveCanonicalPreference('phone')).toBe('call');
    expect(resolveCanonicalPreference('telefone')).toBe('call');
    expect(resolveCanonicalPreference('ligação')).toBe('call');
    expect(resolveCanonicalPreference('ligacao')).toBe('call');
    expect(formatContactPreferenceLabel('call')).toBe('Preferência: Ligação');
    expect(formatContactPreferenceLabel('ligacao')).toBe('Preferência: Ligação');
  });

  it('resolves WhatsApp canonical preference', () => {
    expect(resolveCanonicalPreference('whatsapp')).toBe('whatsapp');
    expect(resolveCanonicalPreference('whats')).toBe('whatsapp');
    expect(resolveCanonicalPreference('zap')).toBe('whatsapp');
    expect(resolveCanonicalPreference('wa')).toBe('whatsapp');
    expect(formatContactPreferenceLabel('whatsapp')).toBe('Preferência: WhatsApp');
    expect(formatContactPreferenceLabel('zap')).toBe('Preferência: WhatsApp');
  });

  it('resolves compound Email + SMS preference', () => {
    expect(resolveCanonicalPreference('email_sms')).toBe('email_sms');
    expect(resolveCanonicalPreference('email+sms')).toBe('email_sms');
    expect(resolveCanonicalPreference('email + sms')).toBe('email_sms');
    expect(resolveCanonicalPreference('email, sms')).toBe('email_sms');
    expect(resolveCanonicalPreference('email & sms')).toBe('email_sms');
    expect(resolveCanonicalPreference('email e sms')).toBe('email_sms');
    expect(resolveCanonicalPreference('sms + email')).toBe('email_sms');
    expect(formatContactPreferenceLabel('email_sms')).toBe('Preferência: Email + SMS');
    expect(formatContactPreferenceLabel('email + sms')).toBe('Preferência: Email + SMS');
    expect(getContactPreferenceLabel('email_sms')).toBe('Email + SMS');
  });

  it('resolves Unknown / Null / Sem preferência to null and formats as Preferência: Não informada', () => {
    expect(resolveCanonicalPreference(null)).toBeNull();
    expect(resolveCanonicalPreference(undefined)).toBeNull();
    expect(resolveCanonicalPreference('')).toBeNull();
    expect(resolveCanonicalPreference('   ')).toBeNull();
    expect(resolveCanonicalPreference('none')).toBeNull();
    expect(resolveCanonicalPreference('unspecified')).toBeNull();
    expect(resolveCanonicalPreference('sem preferência')).toBeNull();
    expect(resolveCanonicalPreference('sem preferencia')).toBeNull();
    expect(resolveCanonicalPreference('sem_preferencia')).toBeNull();
    expect(resolveCanonicalPreference('não informada')).toBeNull();
    expect(resolveCanonicalPreference('nao informada')).toBeNull();
    expect(resolveCanonicalPreference('unknown')).toBeNull();
    expect(resolveCanonicalPreference('random_unknown_channel')).toBeNull();

    expect(formatContactPreferenceLabel(null)).toBe('Preferência: Não informada');
    expect(formatContactPreferenceLabel(undefined)).toBe('Preferência: Não informada');
    expect(formatContactPreferenceLabel('')).toBe('Preferência: Não informada');
    expect(formatContactPreferenceLabel('sem preferência')).toBe('Preferência: Não informada');
    expect(formatContactPreferenceLabel('unknown')).toBe('Preferência: Não informada');
  });

  it('provides appropriate color badges for all canonical preference variants', () => {
    expect(getContactPreferenceBadgeClasses('email').badge).toBeDefined();
    expect(getContactPreferenceBadgeClasses('sms').badge).toBeDefined();
    expect(getContactPreferenceBadgeClasses('whatsapp').badge).toBeDefined();
    expect(getContactPreferenceBadgeClasses('call').badge).toBeDefined();
    expect(getContactPreferenceBadgeClasses('email_sms').badge).toBeDefined();
    expect(getContactPreferenceBadgeClasses(null).badge).toBeDefined();
  });
});

describe('MinimalLeadCard — Contact Preference & Deliverability Coexistence', () => {
  const createMockLead = (overrides: Partial<Lead> = {}): Lead =>
    ({
      id: 'lead-test-123',
      first_name: 'Maria',
      last_name: 'Silva',
      email: 'maria.silva@email.com',
      phone_raw: '(11) 98765-4321',
      phone_e164: '+5511987654321',
      contact_preference: 'email',
      pipeline_stage_id: 'stage-capture',
      qualification_status: 'unqualified',
      source: 'meta',
      source_detail: 'facebook_lead_ad',
      source_created_at: '2026-09-26T00:00:00Z',
      created_at: '2026-09-26T00:00:00Z',
      updated_at: '2026-09-26T00:00:00Z',
      ...overrides,
    } as unknown as Lead);

  const mockDeliverabilityHealth: LeadDeliverabilityInfo = {
    status: 'saudavel',
    label: 'Saudável',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotColor: 'bg-emerald-500',
    description: 'E-mail entregue com sucesso à caixa postal do destinatário.',
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

  it('1. shows contact preference AND deliverability status simultaneously on active pipeline cards', () => {
    const lead = createMockLead({ contact_preference: 'email' });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="capture"
        stageName="Captura"
        deliverabilityHealth={mockDeliverabilityHealth}
      />
    );

    // Both badges coexist simultaneously
    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge).toBeDefined();
    expect(prefBadge.textContent).toContain('Preferência: Email');

    const delivBadge = screen.getByTestId('deliverability-health-badge');
    expect(delivBadge).toBeDefined();
    expect(delivBadge.textContent).toContain('Entregue');

    const riskBadge = screen.getByTestId('deliverability-risk-badge');
    expect(riskBadge).toBeDefined();
    expect(riskBadge.textContent).toContain('Risco: Baixo');
  });

  it('2. displays SMS contact preference on card', () => {
    const lead = createMockLead({ contact_preference: 'sms' });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="qualification"
        stageName="Qualificação"
        deliverabilityHealth={mockDeliverabilityHealth}
      />
    );

    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge.textContent).toContain('Preferência: SMS');
  });

  it('3. displays Ligação contact preference on card', () => {
    const lead = createMockLead({ contact_preference: 'call' });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="acquisition"
        stageName="Aquisição"
        deliverabilityHealth={mockDeliverabilityHealth}
      />
    );

    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge.textContent).toContain('Preferência: Ligação');
  });

  it('4. displays WhatsApp contact preference on card', () => {
    const lead = createMockLead({ contact_preference: 'whatsapp' });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="approval"
        stageName="Aprovação"
        deliverabilityHealth={mockDeliverabilityHealth}
      />
    );

    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge.textContent).toContain('Preferência: WhatsApp');
  });

  it('5. displays Email + SMS contact preference on card', () => {
    const lead = createMockLead({ contact_preference: 'email_sms' as any });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="capture"
        stageName="Captura"
        deliverabilityHealth={mockDeliverabilityHealth}
      />
    );

    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge.textContent).toContain('Preferência: Email + SMS');
  });

  it('6. displays "Preferência: Não informada" when preference is null, undefined, empty, or unknown', () => {
    const cases = [null, undefined, '', 'sem preferência', 'unknown'];
    for (const val of cases) {
      const lead = createMockLead({ contact_preference: val as any });
      const { unmount } = render(
        <MinimalLeadCard
          lead={lead}
          stageCode="capture"
          stageName="Captura"
        />
      );

      const prefBadge = screen.getByTestId('contact-preference-badge');
      expect(prefBadge).toBeDefined();
      expect(prefBadge.textContent).toContain('Preferência: Não informada');
      unmount();
    }
  });

  it('7. contact preference remains visible on closed stages (enrollment) even when deliverability is hidden', () => {
    const lead = createMockLead({ contact_preference: 'email' });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="enrollment"
        stageName="Matrícula"
        deliverabilityHealth={mockDeliverabilityHealth}
      />
    );

    // Contact preference must remain visible on closed leads
    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge).toBeDefined();
    expect(prefBadge.textContent).toContain('Preferência: Email');

    // Deliverability health is hidden on closed leads as per business rule
    expect(screen.queryByTestId('deliverability-health-badge')).toBeNull();
  });

  it('8. works seamlessly across leads from different sources (Meta, HubSpot, Manual, Form)', () => {
    const sources = ['meta', 'hubspot', 'manual', 'form'] as const;
    for (const src of sources) {
      const lead = createMockLead({
        source: src as any,
        contact_preference: 'whatsapp',
      });
      const { unmount } = render(
        <MinimalLeadCard
          lead={lead}
          stageCode="capture"
          stageName="Captura"
          deliverabilityHealth={mockDeliverabilityHealth}
        />
      );

      const prefBadge = screen.getByTestId('contact-preference-badge');
      expect(prefBadge.textContent).toContain('Preferência: WhatsApp');
      unmount();
    }
  });

  it('9. contact preference is visible when lead has no email or phone', () => {
    const lead = createMockLead({
      email: null as any,
      phone_raw: null as any,
      phone_e164: null as any,
      contact_preference: null,
    });
    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="capture"
        stageName="Captura"
      />
    );

    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge).toBeDefined();
    expect(prefBadge.textContent).toContain('Preferência: Não informada');
  });
});
