import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import {
  resolveCanonicalPreference,
  getContactPreferenceLabel,
  formatContactPreferenceLabel,
  toDbContactPreference,
} from '../utils/contact-preference';
import type { Lead } from '../types';
import type { LeadDeliverabilityInfo } from '../features/dashboard/services/deliverability-health-service';

describe('Regression Audit — Canonical Contact Preference Normalization', () => {
  it('correctly maps Email and all its aliases', () => {
    const emailAliases = ['email', 'Email', 'EMAIL', 'e-mail', 'E-Mail', 'mail', 'correio eletrônico'];
    for (const alias of emailAliases) {
      expect(resolveCanonicalPreference(alias)).toBe('email');
      expect(formatContactPreferenceLabel(alias)).toBe('Preferência: Email');
      expect(formatContactPreferenceLabel(alias, { withPrefix: false })).toBe('Email');
      expect(toDbContactPreference(alias)).toBe('email');
    }
  });

  it('correctly maps SMS and all its aliases', () => {
    const smsAliases = ['sms', 'SMS', 'text', 'Text', 'TEXT', 'torpedo', 'mensagem', 'sms / text', 'text_message'];
    for (const alias of smsAliases) {
      expect(resolveCanonicalPreference(alias)).toBe('sms');
      expect(formatContactPreferenceLabel(alias)).toBe('Preferência: SMS');
      expect(formatContactPreferenceLabel(alias, { withPrefix: false })).toBe('SMS');
      expect(toDbContactPreference(alias)).toBe('sms');
    }
  });

  it('correctly maps Call / Phone and all its aliases', () => {
    const callAliases = ['call', 'Call', 'CALL', 'phone', 'Phone', 'PHONE', 'ligação', 'ligacao', 'telefone', 'voz', 'voice', 'call / phone'];
    for (const alias of callAliases) {
      expect(resolveCanonicalPreference(alias)).toBe('call');
      expect(formatContactPreferenceLabel(alias)).toBe('Preferência: Ligação');
      expect(formatContactPreferenceLabel(alias, { withPrefix: false })).toBe('Ligação');
      expect(toDbContactPreference(alias)).toBe('call');
    }
  });

  it('correctly maps WhatsApp and all its aliases', () => {
    const whatsappAliases = ['whatsapp', 'WhatsApp', 'WHATSAPP', 'whats', 'zap', 'wa', 'wpp', 'zapzap'];
    for (const alias of whatsappAliases) {
      expect(resolveCanonicalPreference(alias)).toBe('whatsapp');
      expect(formatContactPreferenceLabel(alias)).toBe('Preferência: WhatsApp');
      expect(formatContactPreferenceLabel(alias, { withPrefix: false })).toBe('WhatsApp');
      expect(toDbContactPreference(alias)).toBe('whatsapp');
    }
  });

  it('correctly maps combined preferences', () => {
    const emailSmsAliases = ['email_sms', 'email+sms', 'email + sms', 'email, sms', 'email & sms', 'email e sms', 'sms + email'];
    for (const alias of emailSmsAliases) {
      expect(resolveCanonicalPreference(alias)).toBe('email_sms');
      expect(formatContactPreferenceLabel(alias)).toBe('Preferência: Email + SMS');
      expect(getContactPreferenceLabel(alias)).toBe('Email + SMS');
      expect(toDbContactPreference(alias)).toBe('email'); // DB constraint safety
    }

    expect(resolveCanonicalPreference('email_whatsapp')).toBe('email_whatsapp');
    expect(formatContactPreferenceLabel('email_whatsapp')).toBe('Preferência: Email + WhatsApp');
    expect(toDbContactPreference('email_whatsapp')).toBe('email');

    expect(resolveCanonicalPreference('sms_whatsapp')).toBe('sms_whatsapp');
    expect(formatContactPreferenceLabel('sms_whatsapp')).toBe('Preferência: SMS + WhatsApp');
    expect(toDbContactPreference('sms_whatsapp')).toBe('sms');
  });

  it('strictly maps true null, empty, unknown, and unspecified to null and Preferência: Não informada', () => {
    const nullAliases = [
      null,
      undefined,
      '',
      '   ',
      'null',
      'undefined',
      'none',
      'unspecified',
      'sem preferência',
      'sem preferencia',
      'sem_preferencia',
      'não informada',
      'nao informada',
      'unknown',
      'no preference',
    ];
    for (const alias of nullAliases) {
      expect(resolveCanonicalPreference(alias)).toBeNull();
      expect(formatContactPreferenceLabel(alias)).toBe('Preferência: Não informada');
      expect(getContactPreferenceLabel(alias)).toBe('Não informada');
      expect(toDbContactPreference(alias)).toBeNull();
    }
  });

  it('ensures toDbContactPreference strictly conforms to DB check constraint', () => {
    const allowedDbValues = ['email', 'sms', 'call', 'whatsapp', null];
    const testCases = [
      'email', 'sms', 'call', 'whatsapp', 'text', 'phone', 'zap', 'email_sms',
      'email_whatsapp', 'sms_whatsapp', null, undefined, '', 'unknown', 'invalid_xyz'
    ];
    for (const tc of testCases) {
      const dbVal = toDbContactPreference(tc);
      expect(allowedDbValues).toContain(dbVal);
    }
  });
});

describe('Regression Audit — Real Production Leads Display', () => {
  const createLead = (overrides: Partial<Lead>): Lead =>
    ({
      id: 'prod-lead-id',
      first_name: 'Lead',
      last_name: 'Teste',
      email: 'lead@exemplo.com',
      phone_raw: '(11) 98765-4321',
      phone_e164: '+5511987654321',
      contact_preference: 'email',
      pipeline_stage_id: 'stage-1',
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
      source: 'meta',
      source_detail: 'hubspot_historical',
      lead_score: 80,
      ...overrides,
    } as unknown as Lead);

  it('renders Real Prod Lead 1 (Gregory Boyajian - Email) with correct badge', () => {
    const lead = createLead({
      id: 'ff8620a2-751d-49c0-9271-40887c8f6a38',
      first_name: 'Gregory',
      last_name: 'Boyajian',
      email: 'gregboyajian@yahoo.com',
      contact_preference: 'email',
      source: 'meta',
      source_detail: 'hubspot_historical',
    });

    render(<MinimalLeadCard lead={lead} />);
    const badge = screen.getByTestId('contact-preference-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('Preferência: Email');
  });

  it('renders Real Prod Lead 2 (Scott Kareth - SMS) with correct badge', () => {
    const lead = createLead({
      id: 'a4822c87-202d-4dca-8a39-f347fbd1155c',
      first_name: 'Scott',
      last_name: 'Kareth',
      email: 'drscottkareth@gmail.com',
      contact_preference: 'sms',
      source: 'meta',
      source_detail: 'hubspot_historical',
    });

    render(<MinimalLeadCard lead={lead} />);
    const badge = screen.getByTestId('contact-preference-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('Preferência: SMS');
  });

  it('renders Real Prod Lead 3 (Latasha Morris - Call) with correct badge', () => {
    const lead = createLead({
      id: '2983951b-1c5a-47bd-88dc-b303cd50ad81',
      first_name: 'Latasha',
      last_name: 'Morris',
      email: 'ciaramorris446@gmail.com',
      contact_preference: 'call',
      source: 'meta',
      source_detail: 'hubspot_historical',
    });

    render(<MinimalLeadCard lead={lead} />);
    const badge = screen.getByTestId('contact-preference-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('Preferência: Ligação');
  });

  it('renders Real Prod Lead 4 (David Smith - WhatsApp) with correct badge', () => {
    const lead = createLead({
      id: '64e5142d-2257-47ca-a7c7-0be2b03c17c7',
      first_name: 'David',
      last_name: 'Smith',
      email: 'newportqi@yahoo.com',
      contact_preference: 'whatsapp',
      source: 'meta',
      source_detail: 'hubspot_historical',
    });

    render(<MinimalLeadCard lead={lead} />);
    const badge = screen.getByTestId('contact-preference-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('Preferência: WhatsApp');
  });

  it('renders Real Prod Lead 5 (Show up Digital - null) as Não informada without corrupting data', () => {
    const lead = createLead({
      id: 'afb8bfac-2b0f-4046-880e-f42b6a587ed3',
      first_name: 'Show',
      last_name: 'up Digital',
      email: 'showupdigitalagencia@gmail.com',
      contact_preference: null,
      source: 'manual',
      source_detail: 'manual_crm_entry',
    });

    render(<MinimalLeadCard lead={lead} />);
    const badge = screen.getByTestId('contact-preference-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('Preferência: Não informada');
  });
});

describe('Regression Audit — Surface Parity & Deliverability Coexistence', () => {
  const sampleLead = {
    id: 'parity-lead-1',
    first_name: 'Wederson',
    last_name: 'Caiafa',
    email: 'wederson@example.com',
    phone_raw: '+55 31 99999-8888',
    phone_e164: '+5531999998888',
    contact_preference: 'whatsapp',
    pipeline_stage_id: 'stage-1',
    created_at: '2026-09-25T12:00:00Z',
    updated_at: '2026-09-25T12:00:00Z',
    source: 'meta',
    source_detail: 'hubspot_historical',
  } as unknown as Lead;

  it('displays matching preference in MinimalLeadCard', () => {
    render(<MinimalLeadCard lead={sampleLead} />);
    const badge = screen.getByTestId('contact-preference-badge');
    expect(badge.textContent).toBe('Preferência: WhatsApp');
  });

  it('displays matching preference in LeadProfileContent header and details', () => {
    render(
      <LeadProfileContent
        leadId={sampleLead.id}
        initialLead={sampleLead}
        isStandalonePage={true}
      />
    );
    const headerBadge = screen.getByTestId('profile-contact-preference-badge');
    expect(headerBadge.textContent).toBe('Preferência: WhatsApp');

    const detailValue = screen.getByTestId('profile-contact-preference-value');
    expect(detailValue.textContent).toBe('WhatsApp');
  });

  it('preserves deliverability status coexistence with contact preference', () => {
    const deliverabilityHealth = {
      lead_id: sampleLead.id,
      email: sampleLead.email!,
      status: 'delivered',
      label: 'Entregue',
      description: 'E-mail entregue com sucesso na caixa de entrada',
      dotColor: 'bg-emerald-500',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      factualStatus: {
        status: 'delivered',
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
    } as unknown as LeadDeliverabilityInfo;

    render(
      <MinimalLeadCard
        lead={sampleLead}
        deliverabilityHealth={deliverabilityHealth}
      />
    );

    // 1. Contact preference badge is visible
    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge.textContent).toBe('Preferência: WhatsApp');

    // 2. Deliverability factual badge is simultaneously visible
    const delivBadge = screen.getByTestId('deliverability-health-badge');
    expect(delivBadge.textContent).toContain('Entregue');

    // 3. Deliverability risk badge is simultaneously visible
    const riskBadge = screen.getByTestId('deliverability-risk-badge');
    expect(riskBadge.textContent).toContain('Risco: Baixo');
  });
});
