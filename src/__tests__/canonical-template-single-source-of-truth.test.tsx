// =============================================================================
// EDS HUB — Canonical Template Single Source of Truth & SMS Flow Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  fetchCanonicalSmsTemplates,
  invalidateCanonicalTemplateCache,
  resolveDefaultSmsTemplate,
  hydrateTemplateForLead,
  type CanonicalSmsTemplate,
} from '../features/templates/services/canonical-template-service';
import { ManualSmsComposerModal } from '../features/leads/components/ManualSmsComposerModal';
import { TemplatePreviewModal } from '../features/templates/components/TemplatePreviewModal';
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

const sampleLeadWithSurname: Lead = {
  id: 'lead-doc-smith',
  source: 'website',
  external_lead_id: null,
  hubspot_contact_id: null,
  first_name: 'John',
  last_name: 'Smith',
  email: 'john.smith@example.com',
  email_confirmation: null,
  phone_e164: '+15551234567',
  phone_raw: '+1 (555) 123-4567',
  contact_preference: 'sms',
  qualification_status: null,
  course_interest: 'Zygomatic',
  course_interests: ['Zygomatic'],
  pipeline_stage_id: 'stage-1',
  source_created_at: null,
  created_at: '2026-10-08T12:00:00Z',
  updated_at: '2026-10-08T12:00:00Z',
};

const sampleLeadSingleName: Lead = {
  id: 'lead-jamal',
  source: 'website',
  external_lead_id: null,
  hubspot_contact_id: null,
  first_name: 'Jamal',
  last_name: null,
  email: 'jamal@example.com',
  email_confirmation: null,
  phone_e164: '+15559876543',
  phone_raw: '+1 (555) 987-6543',
  contact_preference: 'sms',
  qualification_status: null,
  course_interest: 'Intensive Implant',
  course_interests: ['Intensive Implant'],
  pipeline_stage_id: 'stage-1',
  source_created_at: null,
  created_at: '2026-10-08T12:00:00Z',
  updated_at: '2026-10-08T12:00:00Z',
};

const mockDbTemplates: CanonicalSmsTemplate[] = [
  {
    id: 'db-zygomatic-sms',
    name: 'Contato SMS inicial — Zygomatic',
    template_key: 'zygomatic_followup_sms',
    text_template: 'Hello Dr. [SURNAME]\n\nCanonical database Zygomatic message from email_templates table.',
    category: 'sms',
    is_active: true,
  },
  {
    id: 'db-intensive-sms',
    name: 'Contato SMS inicial — Intensive + Advanced',
    template_key: 'intensive_advanced_followup_sms',
    text_template: 'Hello Dr. [SURNAME]\n\nCanonical database Intensive message for {{first_name}}.',
    category: 'sms',
    is_active: true,
  },
];

describe('Canonical Template Service & Single Source of Truth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCanonicalTemplateCache();
  });

  it('B1: queries public.email_templates for canonical active SMS templates', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockDbTemplates,
            error: null,
          }),
        }),
      }),
    });

    const templates = await fetchCanonicalSmsTemplates(true);
    expect(templates).toHaveLength(2);
    expect(templates[0].id).toBe('db-zygomatic-sms');
    expect(templates[0].text_template).toContain('Canonical database Zygomatic message');
  });

  it('B2: invalidating cache triggers fresh query on next fetch without page reload', async () => {
    let callCount = 0;
    (supabase.from as any).mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockImplementation(async () => {
            callCount++;
            return {
              data: [
                {
                  id: 'db-zygomatic-sms',
                  name: 'Contato SMS inicial — Zygomatic',
                  template_key: 'zygomatic_followup_sms',
                  text_template: `Version ${callCount} text`,
                  category: 'sms',
                  is_active: true,
                },
              ],
              error: null,
            };
          }),
        }),
      }),
    }));

    // First fetch
    const firstFetch = await fetchCanonicalSmsTemplates(false);
    expect(firstFetch[0].text_template).toBe('Version 1 text');

    // Cached fetch without refresh -> same version
    const cachedFetch = await fetchCanonicalSmsTemplates(false);
    expect(cachedFetch[0].text_template).toBe('Version 1 text');
    expect(callCount).toBe(1);

    // Invalidate cache (e.g. after save in TemplateEditorModal)
    invalidateCanonicalTemplateCache();

    // Fetch again without page reload -> returns updated version 2
    const secondFetch = await fetchCanonicalSmsTemplates(false);
    expect(secondFetch[0].text_template).toBe('Version 2 text');
    expect(callCount).toBe(2);
  });

  it('B3: hydrates personalization placeholders correctly (with surname)', () => {
    const rawTemplate = 'Hello Dr. [SURNAME]\n\nDear {{salutation_line}}, course: {{course_name}}. First: {{first_name}}.';
    const hydrated = hydrateTemplateForLead(rawTemplate, sampleLeadWithSurname);

    expect(hydrated).toContain('Hello Dr. Smith');
    expect(hydrated).toContain('First: John');
    expect(hydrated).toContain('course: Zygomatic');
    expect(hydrated).not.toContain('[SURNAME]');
    expect(hydrated).not.toContain('{{');
  });

  it('B3: hydrates personalization placeholders correctly (without surname / single name)', () => {
    const rawTemplate = 'Hello Dr. [SURNAME]\n\nDear {{salutation_line}}, interest: {{course_name}}.';
    const hydrated = hydrateTemplateForLead(rawTemplate, sampleLeadSingleName);

    // Must resolve to "Hello Doctor" rather than "Hello Dr. Jamal" or "Hello Dr. null"
    expect(hydrated).toContain('Hello Doctor');
    expect(hydrated).not.toContain('Hello Dr. Jamal');
    expect(hydrated).not.toContain('[SURNAME]');
    expect(hydrated).not.toContain('{{');
  });

  it('B3: resolves course mapping correctly to select appropriate template', () => {
    const defaultZygo = resolveDefaultSmsTemplate(mockDbTemplates, sampleLeadWithSurname);
    expect(defaultZygo.id).toBe('db-zygomatic-sms');

    const defaultIntensive = resolveDefaultSmsTemplate(mockDbTemplates, sampleLeadSingleName);
    expect(defaultIntensive.id).toBe('db-intensive-sms');
  });
});

describe('ManualSmsComposerModal with Canonical Template Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCanonicalTemplateCache();

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockDbTemplates,
            error: null,
          }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
  });

  it('B2 & B3: loads canonical database template on open and hydrates for lead', async () => {
    render(
      <ManualSmsComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadWithSurname}
      />
    );

    // Message textarea must display canonical text from database hydrated with lead surname
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Digite o texto do SMS...') as HTMLTextAreaElement;
      expect(textarea.value).toContain('Hello Dr. Smith');
      expect(textarea.value).toContain('Canonical database Zygomatic message from email_templates table.');
    });
  });

  it('B4: per-lead edit in textarea is local only and does not mutate templates', async () => {
    render(
      <ManualSmsComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadWithSurname}
      />
    );

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Digite o texto do SMS...') as HTMLTextAreaElement;
      expect(textarea.value).toContain('Hello Dr. Smith');
    });

    const textarea = screen.getByPlaceholderText('Digite o texto do SMS...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Custom message for Dr. Smith only.' } });
    expect(textarea.value).toBe('Custom message for Dr. Smith only.');

    // Canonical template in memory / DB remains untouched
    expect(mockDbTemplates[0].text_template).toContain('Canonical database Zygomatic message');
  });

  it('B5: Abrir no SMS uses the current edited textarea content', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ManualSmsComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadWithSurname}
      />
    );

    await waitFor(() => {
      screen.getByPlaceholderText('Digite o texto do SMS...');
    });

    const textarea = screen.getByPlaceholderText('Digite o texto do SMS...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Special customized note for Dr. Smith.' } });

    const openSmsButton = screen.getByText('Abrir no SMS');
    fireEvent.click(openSmsButton);

    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    const calledUrl = windowOpenSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sms:+15551234567?body=');
    expect(decodeURIComponent(calledUrl)).toContain('Special customized note for Dr. Smith.');

    windowOpenSpy.mockRestore();
  });

  it('B6: Marcar SMS como enviado stores the exact edited content into lead_activities metadata', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const chainableQuery: any = {
      order: vi.fn().mockResolvedValue({ data: mockDbTemplates, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    chainableQuery.eq = vi.fn().mockReturnValue(chainableQuery);

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'lead_activities') {
        return { insert: insertMock };
      }
      return {
        select: vi.fn().mockReturnValue(chainableQuery),
      };
    });

    render(
      <ManualSmsComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadWithSurname}
      />
    );

    await waitFor(() => {
      screen.getByPlaceholderText('Digite o texto do SMS...');
    });

    const textarea = screen.getByPlaceholderText('Digite o texto do SMS...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Exact sent content recorded in timeline.' } });

    const markSentButton = screen.getByText('Marcar SMS como enviado');
    fireEvent.click(markSentButton);

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const payload = insertMock.mock.calls[0][0];
      expect(payload.metadata.content).toBe('Exact sent content recorded in timeline.');
      expect(payload.metadata.channel).toBe('sms');
      expect(payload.metadata.status).toBe('manually_confirmed');
    });
  });
});

describe('TemplatePreviewModal Canonical Source of Truth', () => {
  it('prioritizes saved template.text_template for SMS preview', () => {
    const customTemplate: EmailTemplate = {
      id: 'custom-sms-1',
      name: 'Custom SMS Template',
      description: null,
      template_key: 'zygomatic_followup_sms',
      content_json: { channel: 'sms' },
      text_template: 'Hello Dr. [SURNAME]\n\nSaved edited text from template editor in preview modal.',
      html_template: '',
      category: 'sms',
      is_active: true,
      created_by_user_id: null,
      created_at: '2026-10-08T12:00:00Z',
      updated_at: '2026-10-08T12:00:00Z',
    };

    render(
      <TemplatePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        template={customTemplate}
      />
    );

    // The preview must render the saved text_template (with sample data substituted), not the static constant
    expect(screen.getByText(/Saved edited text from template editor in preview modal/)).toBeDefined();
    expect(screen.getByText(/Hello Dr. Silva/)).toBeDefined();
  });
});
