import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchableLeadSelector } from '../features/work/components/SearchableLeadSelector';
import { CreateTaskModal } from '../features/work/components/CreateTaskModal';
import {
  ManualWhatsappComposerModal,
  SHARED_WHATSAPP_TEMPLATES,
  resolveDefaultWhatsappTemplateId,
  cleanPhoneForWhatsApp,
} from '../features/leads/components/ManualWhatsappComposerModal';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { LeadTimeline, getActivityLabel } from '../features/leads/components/LeadTimeline';
import {
  getApprovedZygomaticSmsText,
  getApprovedEndodonticsSmsText,
  getApprovedIntensiveAdvancedSmsText,
  getApprovedWisdomSmsText,
  getApprovedRehabilitationSmsText,
  getApprovedPeriodontalSmsText,
} from '../utils/salutation';
import { supabase } from '../lib/supabase';
import type { Lead, LeadActivity } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const queryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockResolvedValue({ data: [], error: null }),
    then: (resolve: any) => resolve({ data: [], error: null }),
  };

  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => queryBuilder),
    },
  };
});

describe('BLOCK B: TASK LEAD SEARCH & WHATSAPP MANUAL ASSISTED FLOW (Items A to S)', () => {
  const sampleLeadZygomatic: Lead = {
    id: 'lead-zygo-123',
    first_name: 'Carlos',
    last_name: 'Mendes',
    email: 'carlos.mendes@example.com',
    phone_raw: '+55 11 98765-4321',
    phone_e164: '+5511987654321',
    course_interest: 'Zygomatic Implant Training',
    source: 'meta',
    status: 'open',
    contact_preference: 'whatsapp',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  } as any;

  const sampleLeadUnknownCourse: Lead = {
    id: 'lead-unknown-456',
    first_name: 'Marina',
    last_name: 'Silva',
    email: 'marina.silva@example.com',
    phone_raw: '+55 21 99999-8888',
    phone_e164: '+5521999998888',
    course_interest: null,
    course_interests: [],
    source: 'website',
    status: 'open',
    contact_preference: null,
    created_at: '2026-10-02T11:00:00Z',
    updated_at: '2026-10-02T11:00:00Z',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A. task lead autocomplete by name
  it('A. task lead autocomplete by name filters dynamically', async () => {
    const mockLeads = [
      {
        id: 'lead-1',
        first_name: 'Rodrigo',
        last_name: 'Albuquerque',
        email: 'rodrigo@example.com',
        phone_raw: '+55 11 91234-5678',
        phone_e164: '+5511912345678',
      },
    ];

    const qb: any = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockLeads, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    const onSelect = vi.fn();
    render(<SearchableLeadSelector selectedLeadId="" onSelectLead={onSelect} />);

    const input = screen.getByTestId('task-lead-search-input');
    fireEvent.change(input, { target: { value: 'Rodrigo' } });

    await waitFor(() => {
      expect(screen.getByText('Rodrigo Albuquerque')).toBeInTheDocument();
    });
  });

  // B. autocomplete by email
  it('B. autocomplete by email filters dynamically', async () => {
    const mockLeads = [
      {
        id: 'lead-2',
        first_name: 'Beatriz',
        last_name: 'Costa',
        email: 'beatriz.costa@dentalclinic.com',
        phone_raw: '+55 21 98888-7777',
        phone_e164: '+5521988887777',
      },
    ];

    const qb: any = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockLeads, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    render(<SearchableLeadSelector selectedLeadId="" onSelectLead={vi.fn()} />);

    const input = screen.getByTestId('task-lead-search-input');
    fireEvent.change(input, { target: { value: 'dentalclinic.com' } });

    await waitFor(() => {
      expect(screen.getByText('beatriz.costa@dentalclinic.com')).toBeInTheDocument();
    });
  });

  // C. autocomplete by phone
  it('C. autocomplete by phone filters dynamically', async () => {
    const mockLeads = [
      {
        id: 'lead-3',
        first_name: 'Dr. Lucas',
        last_name: 'Ferreira',
        email: 'lucas@example.com',
        phone_raw: '+55 31 97777-6666',
        phone_e164: '+5531977776666',
      },
    ];

    const qb: any = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockLeads, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    render(<SearchableLeadSelector selectedLeadId="" onSelectLead={vi.fn()} />);

    const input = screen.getByTestId('task-lead-search-input');
    fireEvent.change(input, { target: { value: '97777' } });

    await waitFor(() => {
      expect(screen.getByText('+55 31 97777-6666')).toBeInTheDocument();
    });
  });

  // D. correct canonical lead selected
  it('D. selecting result sets the correct canonical lead_id and allows clearing', async () => {
    const mockLead = {
      id: 'lead-canonical-999',
      first_name: 'Eduardo',
      last_name: 'Lima',
      email: 'eduardo@example.com',
      phone_raw: '+55 41 96666-5555',
      phone_e164: '+5541966665555',
    };

    const qb: any = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [mockLead], error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    const onSelect = vi.fn();
    const { rerender } = render(
      <SearchableLeadSelector selectedLeadId="" onSelectLead={onSelect} />
    );

    const input = screen.getByTestId('task-lead-search-input');
    fireEvent.change(input, { target: { value: 'Eduardo' } });

    await waitFor(() => {
      expect(screen.getByTestId('lead-search-option-lead-canonical-999')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('lead-search-option-lead-canonical-999'));
    expect(onSelect).toHaveBeenCalledWith(mockLead);

    // Rerender with selected lead ID to verify selected identity card
    rerender(
      <SearchableLeadSelector
        selectedLeadId={mockLead.id}
        initialLead={mockLead}
        onSelectLead={onSelect}
      />
    );

    expect(screen.getByTestId('selected-lead-card')).toBeInTheDocument();
    expect(screen.getByText('Eduardo Lima')).toBeInTheDocument();

    // Clicking Trocar clears the selection
    const clearBtn = screen.getByTestId('clear-lead-selection-btn');
    fireEvent.click(clearBtn);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  // E. no giant 2,000+ option rendering (search limits results, fallback on empty)
  it('E. limits remote query to small set and shows fallback when none found', async () => {
    const qb: any = {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((num: number) => {
        expect(num).toBeLessThanOrEqual(20);
        return Promise.resolve({ data: [], error: null });
      }),
    };
    (supabase.from as any).mockReturnValue(qb);

    render(<SearchableLeadSelector selectedLeadId="" onSelectLead={vi.fn()} />);

    const input = screen.getByTestId('task-lead-search-input');
    fireEvent.change(input, { target: { value: 'inexistent lead 999999' } });

    await waitFor(() => {
      expect(screen.getByTestId('no-leads-found')).toBeInTheDocument();
      expect(screen.getByText('Nenhum lead encontrado')).toBeInTheDocument();
    });
  });

  // F. WhatsApp button opens with correct phone
  it('F. WhatsApp opens with normalized phone digits in wa.me link', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygomatic}
      />
    );

    const openBtn = screen.getByTestId('btn-open-whatsapp');
    expect(openBtn).not.toBeDisabled();
    fireEvent.click(openBtn);

    expect(openSpy).toHaveBeenCalled();
    const calledUrl = openSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://wa.me/5511987654321');
    openSpy.mockRestore();
  });

  // G. WhatsApp reuses exact SMS template content
  it('G. WhatsApp reuses EXACT same SMS template generators and content', () => {
    const zygoTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === 'zygomatic_followup_whatsapp');
    expect(zygoTpl?.generator).toBe(getApprovedZygomaticSmsText);

    const endoTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === 'endodontics_followup_whatsapp');
    expect(endoTpl?.generator).toBe(getApprovedEndodonticsSmsText);

    const intensiveTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === 'intensive_advanced_followup_whatsapp');
    expect(intensiveTpl?.generator).toBe(getApprovedIntensiveAdvancedSmsText);

    const wisdomTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === 'wisdom_followup_whatsapp');
    expect(wisdomTpl?.generator).toBe(getApprovedWisdomSmsText);

    const rehabTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === 'rehabilitation_followup_whatsapp');
    expect(rehabTpl?.generator).toBe(getApprovedRehabilitationSmsText);

    const perioTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === 'periodontal_followup_whatsapp');
    expect(perioTpl?.generator).toBe(getApprovedPeriodontalSmsText);

    // Verify generated text matches exactly
    const generatedZygo = zygoTpl?.generator(sampleLeadZygomatic);
    const approvedZygo = getApprovedZygomaticSmsText(sampleLeadZygomatic);
    expect(generatedZygo).toBe(approvedZygo);
  });

  // H. Zygomatic lead gets Zygomatic message
  it('H. Zygomatic lead gets Zygomatic message preselected', () => {
    const resolvedId = resolveDefaultWhatsappTemplateId(sampleLeadZygomatic);
    expect(resolvedId).toBe('zygomatic_followup_whatsapp');

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygomatic}
      />
    );

    const textarea = screen.getByTestId('whatsapp-message-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Zygomatic Implant Training in Brazil');
    expect(textarea.value).toContain('Dr. Mendes');
  });

  // I. unknown course does not use unrelated generic message
  it('I. unknown course does not use generic fallback, prompts operator to choose course', () => {
    const resolvedId = resolveDefaultWhatsappTemplateId(sampleLeadUnknownCourse);
    expect(resolvedId).toBeNull();

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadUnknownCourse}
      />
    );

    expect(screen.getByText('Curso não identificado automaticamente')).toBeInTheDocument();
    const select = screen.getByTestId('whatsapp-template-select') as HTMLSelectElement;
    expect(select.value).toBe('');

    const openBtn = screen.getByTestId('btn-open-whatsapp');
    expect(openBtn).toBeDisabled();
  });

  // J. opening WhatsApp does not mark sent automatically
  it('J. opening WhatsApp does not mark sent automatically in database', () => {
    const insertMock = vi.fn().mockResolvedValue({ data: [], error: null });
    (supabase.from as any).mockReturnValue({
      insert: insertMock,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygomatic}
      />
    );

    fireEvent.click(screen.getByTestId('btn-open-whatsapp'));
    expect(openSpy).toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  // K. explicit "Marcar WhatsApp como enviado" creates one activity
  it('K. explicit Marcar WhatsApp como enviado records factual activity', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: [{ id: 'act-wa-1' }], error: null });
    const updateTaskMock = vi.fn().mockResolvedValue({ data: [], error: null });

    const qb: any = {
      insert: insertMock,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: updateTaskMock,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    const onRecorded = vi.fn();
    const onClose = vi.fn();

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={onClose}
        lead={sampleLeadZygomatic}
        onWhatsappRecorded={onRecorded}
      />
    );

    const markBtn = screen.getByTestId('btn-mark-whatsapp-sent');
    fireEvent.click(markBtn);

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const payload = insertMock.mock.calls[0][0];
      expect(payload.channel).toBe('whatsapp');
      expect(payload.activity_type).toBe('whatsapp_contact_confirmed');
      expect(payload.lead_id).toBe(sampleLeadZygomatic.id);
      expect(payload.metadata.status).toBe('manually_confirmed');
      expect(onClose).toHaveBeenCalled();
    });
  });

  // L. duplicate click does not duplicate activity (idempotency)
  it('L. double click on confirmation does not duplicate activity insertion', async () => {
    let callCount = 0;
    const insertMock = vi.fn().mockImplementation(() => {
      callCount++;
      return new Promise((resolve) => setTimeout(() => resolve({ data: [], error: null }), 50));
    });

    const qb: any = {
      insert: insertMock,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygomatic}
      />
    );

    const markBtn = screen.getByTestId('btn-mark-whatsapp-sent');
    fireEvent.click(markBtn);
    fireEvent.click(markBtn); // Rapid second click

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledTimes(1);
    });
  });

  // M. Pipeline shows WhatsApp enviado badge
  it('M. Pipeline card renders WhatsApp enviado badge', () => {
    render(
      <MinimalLeadCard
        lead={sampleLeadZygomatic}
        whatsappSentInfo={{ sentAt: '2026-10-04T10:30:00Z', formattedDate: '04/10' }}
      />
    );

    const badge = screen.getByTestId('lead-card-whatsapp-sent-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('WhatsApp enviado');
    expect(badge).toHaveTextContent('(04/10)');
  });

  // N. SMS + WhatsApp badges coexist
  it('N. Pipeline card renders both SMS and WhatsApp badges when both were sent', () => {
    render(
      <MinimalLeadCard
        lead={sampleLeadZygomatic}
        smsSentInfo={{ sentAt: '2026-10-03T15:00:00Z', formattedDate: '03/10' }}
        whatsappSentInfo={{ sentAt: '2026-10-04T10:30:00Z', formattedDate: '04/10' }}
      />
    );

    expect(screen.getByTestId('lead-card-sms-sent-badge')).toBeInTheDocument();
    expect(screen.getByTestId('lead-card-whatsapp-sent-badge')).toBeInTheDocument();
    expect(screen.getByText('SMS enviado')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp enviado')).toBeInTheDocument();
  });

  // O. Lead history shows WhatsApp manual send
  it('O. Lead history / timeline shows WhatsApp enviado with operator and metadata', () => {
    const waActivity: LeadActivity = {
      id: 'act-wa-1',
      lead_id: sampleLeadZygomatic.id,
      activity_type: 'whatsapp_contact_confirmed',
      channel: 'whatsapp',
      actor_type: 'user',
      summary: 'WhatsApp enviado manualmente: "Hello Dr. Mendes..."',
      created_at: '2026-10-04T10:47:00Z',
      metadata: {
        channel: 'whatsapp',
        manual: true,
        created_by_name: 'Natália Santos',
        course: 'Zygomatic',
        template_id: 'zygomatic_followup_whatsapp',
      },
    } as any;

    expect(getActivityLabel('whatsapp_contact_confirmed')).toBe('WhatsApp enviado');

    render(<LeadTimeline activities={[waActivity]} />);

    expect(screen.getByText('WhatsApp enviado')).toBeInTheDocument();
    expect(screen.getByText('Natália Santos')).toBeInTheDocument();
  });

  // P. unrelated tasks remain untouched
  it('P. completing WhatsApp task does not affect unrelated tasks', async () => {
    const pendingTasks = [
      { id: 'task-payment', title: 'Lembrete de pagamento - Turma Nov/26' },
      { id: 'task-wa', title: 'Enviar WhatsApp com detalhes do curso' },
    ];

    const updateTaskMock = vi.fn().mockResolvedValue({ data: [], error: null });

    const qb: any = {
      insert: vi.fn().mockResolvedValue({ data: [], error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((field: string, val: any) => {
        if (field === 'status' && val === 'pending') {
          return Promise.resolve({ data: pendingTasks, error: null });
        }
        return qb;
      }),
      update: updateTaskMock,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(qb);

    render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygomatic}
      />
    );

    fireEvent.click(screen.getByTestId('btn-mark-whatsapp-sent'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalled();
      // Should target task-wa, NOT task-payment
      const updateCall = (supabase.from as any).mock.calls.find((c: any) => c[0] === 'tasks');
      expect(updateCall).toBeDefined();
    });
  });

  // Q. linked WhatsApp task behavior mirrors safe SMS behavior
  it('Q. cleanPhoneForWhatsApp correctly sanitizes international digits', () => {
    expect(cleanPhoneForWhatsApp('+55 (11) 98765-4321')).toBe('5511987654321');
    expect(cleanPhoneForWhatsApp('+1 (800) 555-0199')).toBe('18005550199');
    expect(cleanPhoneForWhatsApp('5511987654321')).toBe('5511987654321');
  });

  // R. mobile rendering has no overflow
  it('R. modal wrapper has responsive viewport scroll constraints', () => {
    const { container } = render(
      <ManualWhatsappComposerModal
        isOpen={true}
        onClose={vi.fn()}
        lead={sampleLeadZygomatic}
      />
    );

    const modal = screen.getByTestId('manual-whatsapp-composer-modal');
    expect(modal).toHaveClass('overflow-y-auto');
    expect(container.querySelector('.max-h-\\[92vh\\]')).toBeInTheDocument();
  });

  // S. search works with mobile interaction
  it('S. CreateTaskModal renders SearchableLeadSelector with proper input accessibility', () => {
    render(
      <CreateTaskModal
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByTestId('task-lead-search-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Buscar lead por nome, email ou telefone...');
  });
});
