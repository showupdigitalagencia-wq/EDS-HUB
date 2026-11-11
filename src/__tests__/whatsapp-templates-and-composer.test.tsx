// =============================================================================
// EDS HUB — Independent WhatsApp Templates & Composer Test Suite
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  fetchCanonicalWhatsappTemplates,
  resolveDefaultWhatsappTemplate,
  invalidateCanonicalTemplateCache,
  hydrateTemplateForLead,
} from '../features/templates/services/canonical-template-service';
import { getTemplateChannel } from '../utils/template-variables';
import { TemplatePreviewModal } from '../features/templates/components/TemplatePreviewModal';
import { TemplateEditorModal } from '../features/templates/components/TemplateEditorModal';
import {
  ManualWhatsappComposerModal,
  SHARED_WHATSAPP_TEMPLATES,
  resolveDefaultWhatsappTemplateId,
  detectMatchingCourseFamilies,
  adjustWhatsappTextForEmailConfirmation,
} from '../features/leads/components/ManualWhatsappComposerModal';
import { supabase } from '../lib/supabase';
import type { Lead, EmailTemplate } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const fromMock = vi.fn();
  return {
    supabase: {
      from: fromMock,
      functions: {
        invoke: vi.fn(),
      },
    },
  };
});

const sampleLeadZygo: Lead = {
  id: 'lead-zygo-123',
  source: 'website',
  external_lead_id: null,
  hubspot_contact_id: null,
  first_name: 'Carlos',
  last_name: 'Mendes',
  email: 'carlos.mendes@example.com',
  email_confirmation: null,
  phone_e164: '+5511987654321',
  phone_raw: '+55 (11) 98765-4321',
  contact_preference: 'whatsapp',
  qualification_status: null,
  course_interest: 'Zygomatic',
  course_interests: ['Zygomatic'],
  pipeline_stage_id: 'stage-capture',
  source_created_at: null,
  created_at: '2026-10-10T12:00:00Z',
  updated_at: '2026-10-10T12:00:00Z',
};

const sampleLeadEndo: Lead = {
  id: 'lead-endo-456',
  source: 'meta',
  external_lead_id: null,
  hubspot_contact_id: null,
  first_name: 'Fernanda',
  last_name: 'Lima',
  email: 'fernanda.lima@example.com',
  email_confirmation: null,
  phone_e164: '+5521999998888',
  phone_raw: '+55 21 99999-8888',
  contact_preference: 'whatsapp',
  qualification_status: null,
  course_interest: 'Endodontics',
  course_interests: ['Endodontics'],
  pipeline_stage_id: 'stage-capture',
  source_created_at: null,
  created_at: '2026-10-10T12:00:00Z',
  updated_at: '2026-10-10T12:00:00Z',
};

const sampleLeadMultiCourse: Lead = {
  id: 'lead-multi-789',
  source: 'meta',
  external_lead_id: null,
  hubspot_contact_id: null,
  first_name: 'Roberto',
  last_name: 'Alves',
  email: 'roberto.alves@example.com',
  email_confirmation: null,
  phone_e164: '+5531988887777',
  phone_raw: '+55 31 98888-7777',
  contact_preference: 'whatsapp',
  qualification_status: null,
  course_interest: 'Zygomatic / Endodontics',
  course_interests: ['Zygomatic', 'Endodontics'],
  pipeline_stage_id: 'stage-capture',
  source_created_at: null,
  created_at: '2026-10-10T12:00:00Z',
  updated_at: '2026-10-10T12:00:00Z',
};

describe('1. Channel Detection (getTemplateChannel)', () => {
  it('identifies WhatsApp templates accurately without collision with SMS or Email', () => {
    // By category
    expect(getTemplateChannel({ category: 'whatsapp', content_json: {} } as any)).toBe('whatsapp');

    // By content_json.channel
    expect(
      getTemplateChannel({
        category: 'general',
        content_json: { channel: 'whatsapp', body: 'Olá' },
      } as any)
    ).toBe('whatsapp');

    // By template_key
    expect(
      getTemplateChannel({
        category: 'general',
        template_key: 'zygomatic_followup_whatsapp',
      } as any)
    ).toBe('whatsapp');

    // By name containing whatsapp
    expect(
      getTemplateChannel({
        name: 'Contato WhatsApp Oficial',
        category: 'general',
      } as any)
    ).toBe('whatsapp');

    // Email remains email
    expect(
      getTemplateChannel({
        category: 'course_info',
        html_template: '<p>Hi</p>',
        content_json: { channel: 'email' },
      } as any)
    ).toBe('email');

    // SMS remains SMS
    expect(
      getTemplateChannel({
        category: 'sms',
        text_template: 'SMS message',
      } as any)
    ).toBe('sms');
  });
});

describe('2. Canonical WhatsApp Template Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCanonicalTemplateCache();
  });

  it('provides complete fallback templates covering all 6 courses when database is unpopulated', async () => {
    // Supabase query returns empty array
    const qb: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    const templates = await fetchCanonicalWhatsappTemplates(true);
    expect(templates.length).toBeGreaterThanOrEqual(6);

    const keys = templates.map((t) => t.template_key);
    expect(keys).toContain('intensive_advanced_followup_whatsapp');
    expect(keys).toContain('zygomatic_followup_whatsapp');
    expect(keys).toContain('endodontics_followup_whatsapp');
    expect(keys).toContain('wisdom_followup_whatsapp');
    expect(keys).toContain('rehabilitation_followup_whatsapp');
    expect(keys).toContain('periodontal_followup_whatsapp');

    // Resolves course interest accurately
    const resolvedZygo = resolveDefaultWhatsappTemplate(templates, sampleLeadZygo);
    expect(resolvedZygo?.template_key).toBe('zygomatic_followup_whatsapp');

    const resolvedEndo = resolveDefaultWhatsappTemplate(templates, sampleLeadEndo);
    expect(resolvedEndo?.template_key).toBe('endodontics_followup_whatsapp');
  });

  it('queries public.email_templates and loads custom WhatsApp templates when available', async () => {
    const mockDbTemplates = [
      {
        id: 'tpl-wa-custom-1',
        name: 'Custom Zygomatic WhatsApp',
        template_key: 'zygomatic_followup_whatsapp',
        text_template: 'Olá Dr. [SURNAME], este é o texto customizado do banco para Zygomatic.',
        category: 'whatsapp',
        content_json: { channel: 'whatsapp' },
        is_active: true,
      },
    ];

    const qb: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockDbTemplates, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    const templates = await fetchCanonicalWhatsappTemplates(true);
    expect(templates.length).toBe(1);
    expect(templates[0].id).toBe('tpl-wa-custom-1');
    expect(templates[0].text_template).toContain('texto customizado do banco');

    const hydrated = hydrateTemplateForLead(templates[0].text_template, sampleLeadZygo);
    expect(hydrated).toBe('Olá Dr. Mendes, este é o texto customizado do banco para Zygomatic.');
  });
});

describe('3. Template Preview Modal (WhatsApp Mode)', () => {
  it('renders realistic WhatsApp preview WITHOUT fake blue checks or delivery ticks', () => {
    const sampleWhatsappTemplate: EmailTemplate = {
      id: 'tpl-preview-wa',
      name: 'WhatsApp - Contato Inicial',
      description: 'Modelo de mensagem WhatsApp para novos contatos',
      category: 'whatsapp',
      template_key: 'custom_wa_lead',
      subject: null,
      html_template: '',
      text_template: 'Olá, Dr(a). {{first_name}}! Recebemos seu interesse na EDS.',
      content_json: { channel: 'whatsapp', body: 'Olá, Dr(a). {{first_name}}! Recebemos seu interesse na EDS.' },
      is_active: true,
      has_attachment: false,
      attachment_name: null,
      created_by_user_id: null,
      created_at: '2026-10-10T12:00:00Z',
      updated_at: '2026-10-10T12:00:00Z',
    };

    render(
      <TemplatePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        template={sampleWhatsappTemplate}
      />
    );

    // Verify WhatsApp badge and phone chrome header
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Envio Manual Assistido')).toBeInTheDocument();

    // Verify message bubble rendered
    expect(screen.getByText(/Recebemos seu interesse na EDS/)).toBeInTheDocument();

    // STRICT CHECK: Ensure NO misleading delivered/read ticks exist in DOM
    expect(screen.queryByText(/✓✓/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/entregue/i)).not.toBeInTheDocument();
    expect(screen.getByText('Sem envio real')).toBeInTheDocument();
    expect(screen.getByText('Pré-visualização do texto')).toBeInTheDocument();
  });
});

describe('4. Template Editor Modal (WhatsApp Mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows creating a new WhatsApp template and saving to email_templates with channel=whatsapp', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: [{ id: 'new-wa-id' }], error: null });
    (supabase.from as any).mockReturnValue({
      insert: insertMock,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <TemplateEditorModal
        isOpen={true}
        onClose={onClose}
        editingTemplate={null}
        onSaveSuccess={onSave}
      />
    );

    // Click on WhatsApp channel card
    const whatsappChannelBtn = screen.getByText('WhatsApp');
    fireEvent.click(whatsappChannelBtn);

    // Fill Template Name
    const nameInput = screen.getByPlaceholderText('Ex: Contato Inicial WhatsApp');
    fireEvent.change(nameInput, { target: { value: 'Template WhatsApp Teste' } });

    // Fill WhatsApp Body
    const textarea = screen.getByPlaceholderText(/Ex: Olá, Dr\(a\)\./i);
    fireEvent.change(textarea, {
      target: { value: 'Olá, Dr(a). {{first_name}}! Mensagem WhatsApp de teste.' },
    });

    // Click Save Template
    const saveBtn = screen.getByRole('button', { name: /Salvar Template/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
    });

    const insertedData = insertMock.mock.calls[0][0];
    expect(insertedData.name).toBe('Template WhatsApp Teste');
    expect(insertedData.category).toBe('whatsapp');
    expect(insertedData.content_json).toEqual({
      channel: 'whatsapp',
      body: 'Olá, Dr(a). {{first_name}}! Mensagem WhatsApp de teste.',
    });
    expect(insertedData.text_template).toBe('Olá, Dr(a). {{first_name}}! Mensagem WhatsApp de teste.');
    expect(insertedData.html_template).toBe('');
    expect(onSave).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('5. Manual WhatsApp Composer Modal Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies SHARED_WHATSAPP_TEMPLATES and resolution helper integrity', () => {
    expect(SHARED_WHATSAPP_TEMPLATES.length).toBe(6);
    expect(resolveDefaultWhatsappTemplateId(sampleLeadZygo)).toBe('zygomatic_followup_whatsapp');
    expect(resolveDefaultWhatsappTemplateId(sampleLeadEndo)).toBe('endodontics_followup_whatsapp');
  });

  it('hydrates default course template and allows opening WhatsApp wa.me link without auto-dispatch', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygo}
      />
    );

    // Verify template pre-selection
    const select = screen.getByTestId('whatsapp-template-select') as HTMLSelectElement;
    expect(select.value).toBe('zygomatic_followup_whatsapp');

    // Verify textarea has hydrated surname
    const textarea = screen.getByTestId('whatsapp-message-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Dr. Mendes');
    expect(textarea.value).toContain('Zygomatic Implant Training in Brazil');

    // Open WhatsApp
    const openBtn = screen.getByTestId('btn-open-whatsapp');
    fireEvent.click(openBtn);

    expect(openSpy).toHaveBeenCalled();
    const calledUrl = openSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://wa.me/5511987654321');
    expect(calledUrl).toContain(encodeURIComponent('Dr. Mendes'));

    openSpy.mockRestore();
  });

  it('handles multiple course ambiguity by requiring operator to select course before loading template', () => {
    // Lead with both Zygomatic and Endodontics
    const matching = detectMatchingCourseFamilies(sampleLeadMultiCourse);
    expect(matching).toContain('zygomatic_followup_whatsapp');
    expect(matching).toContain('endodontics_followup_whatsapp');
    expect(matching.length).toBe(2);

    // Ambiguidade detectada -> resolveDefaultWhatsappTemplateId DEVE retornar null
    const resolvedId = resolveDefaultWhatsappTemplateId(sampleLeadMultiCourse);
    expect(resolvedId).toBeNull();

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadMultiCourse}
      />
    );

    // Dropdown starts unselected
    const select = screen.getByTestId('whatsapp-template-select') as HTMLSelectElement;
    expect(select.value).toBe('');

    // Ambiguity callout displayed
    expect(screen.getByText('Lead com interesse em múltiplos cursos')).toBeInTheDocument();

    // Button disabled until explicit choice
    const openBtn = screen.getByTestId('btn-open-whatsapp');
    expect(openBtn).toBeDisabled();

    // Selecting course loads and enables button
    fireEvent.change(select, { target: { value: 'zygomatic_followup_whatsapp' } });
    expect(select.value).toBe('zygomatic_followup_whatsapp');
    const textarea = screen.getByTestId('whatsapp-message-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Zygomatic Implant Training in Brazil');
    expect(openBtn).not.toBeDisabled();
  });

  it('adjusts text regarding email sent: suppresses claim when email was not confirmed sent', () => {
    const rawTemplateText = `Hello Dr. [SURNAME]\n\nThis is Natália from Expert Dental Solutions. Thank you for your interest in our Implant Training in Brazil.\n\nI just sent you an email with all the course details.\n\nTo help you choose the best option, could you tell me a little about your implant experience?`;

    // 1. When email is confirmed sent -> sentence is preserved
    const textWithEmail = adjustWhatsappTextForEmailConfirmation(rawTemplateText, true);
    expect(textWithEmail).toContain('I just sent you an email with all the course details.');

    // 2. When email is NOT confirmed sent (e.g. WhatsApp preference) -> sentence is suppressed
    const textWithoutEmail = adjustWhatsappTextForEmailConfirmation(rawTemplateText, false);
    expect(textWithoutEmail).not.toContain('I just sent you an email with all the course details.');
    expect(textWithoutEmail).toContain('Thank you for your interest in our Implant Training in Brazil.');
    expect(textWithoutEmail).toContain('To help you choose the best option');
  });
});
