import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LeadFormSubmissionModal } from '../features/leads/components/LeadFormSubmissionModal';
import { supabase } from '../lib/supabase';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const queryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
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
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
    },
  };
});

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockImplementation(() => Promise.resolve()),
  },
});

describe('Lead Form Traceability and Historical Recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A & F. Displays historical Meta lead submission with dynamic custom questions & answers', async () => {
    const mockScottKarethSubmissions = [
      {
        id: 'ce26818c-7baa-4f02-a1bb-5f48836c951c',
        source: 'Instagram Lead Ads',
        form_name: 'Full Arch and Zygomatic - November 2026',
        submitted_at: '2026-09-24T18:42:30Z',
        recovery_state: 'complete',
        synchronized_via: 'HubSpot',
        fields: [
          { label: 'Nome', value: 'Scott' },
          { label: 'Sobrenome', value: 'Kareth' },
          { label: 'E-mail', value: 'drscottkareth@gmail.com' },
          { label: 'Telefone', value: '+18594669520' },
          { label: 'Confirmação de e-mail', value: 'Drscottkareth@gmail.com' },
          { label: 'Curso de interesse', value: 'Zygomatic' },
          { label: 'Status de licença profissional', value: 'u.s.-licensed_dentist' },
          { label: 'Método de contato de preferência', value: 'sms' },
          { label: 'Plataforma de origem', value: 'Instagram Lead' },
          { label: 'Campanha', value: 'Organic Facebook lead' },
          { label: 'UTM Source', value: 'facebook' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockScottKarethSubmissions,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="a4822c87-202d-4dca-8a39-f347fbd1155c"
        leadName="Scott Kareth"
      />
    );

    await waitFor(() => {
      // Header check
      expect(screen.getByText('Formulário do Lead')).toBeInTheDocument();
      expect(screen.getByText(/Respostas submetidas por Scott Kareth/i)).toBeInTheDocument();

      // Origin and Source
      expect(screen.getByText('Instagram Lead Ads')).toBeInTheDocument();
      expect(screen.getByText(/Sincronizado via:/i)).toBeInTheDocument();
      expect(screen.getByText('HubSpot')).toBeInTheDocument();

      // Form Name
      expect(screen.getByText('Full Arch and Zygomatic - November 2026')).toBeInTheDocument();

      // Dynamic questions & answers
      expect(screen.getByText('Confirmação de e-mail')).toBeInTheDocument();
      expect(screen.getByText('Drscottkareth@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('Status de licença profissional')).toBeInTheDocument();
      expect(screen.getByText('u.s.-licensed_dentist')).toBeInTheDocument();
      expect(screen.getByText('Método de contato de preferência')).toBeInTheDocument();
      expect(screen.getByText('sms')).toBeInTheDocument();
      expect(screen.getByText('Organic Facebook lead')).toBeInTheDocument();
    });
  });

  it('B. Displays historical Website lead submission with all factual business fields', async () => {
    const mockWebsiteSubmissions = [
      {
        id: 'web-sub-1',
        source: 'Site',
        form_name: '#registerForm .register-form',
        submitted_at: '2026-09-25T04:30:56Z',
        recovery_state: 'complete',
        synchronized_via: 'HubSpot',
        fields: [
          { label: 'Nome', value: 'Mustafa Nourozi' },
          { label: 'E-mail', value: 'mustafa.nourozi@gmail.com' },
          { label: 'Telefone', value: '(062) 211-8607' },
          { label: 'Curso de interesse', value: 'Advanced' },
          { label: 'Data / Turma do curso', value: 'Fev/Mar 2027' },
          { label: 'Página de origem', value: 'https://expdentalsolutions.com/register' },
          { label: 'UTM Source', value: 'expdentalsolutions.com/course/advanced-dental-implant-experience' },
          { label: 'Plataforma de origem', value: 'Indicação' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockWebsiteSubmissions,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="mustafa-id"
        leadName="Mustafa Nourozi"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Site')).toBeInTheDocument();
      expect(screen.getByText('#registerForm .register-form')).toBeInTheDocument();
      expect(screen.getByText('Data / Turma do curso')).toBeInTheDocument();
      expect(screen.getByText('Fev/Mar 2027')).toBeInTheDocument();
      expect(screen.getByText('https://expdentalsolutions.com/register')).toBeInTheDocument();
    });
  });

  it('E. Multiple form submissions: displays all submissions ordered newest first with navigation', async () => {
    const mockMultipleSubmissions = [
      {
        id: 'sub-newest',
        source: 'Instagram Lead Ads',
        form_name: 'Rehabilitation Nov 2026-Revised',
        submitted_at: '2026-09-21T03:36:23Z',
        recovery_state: 'complete',
        fields: [
          { label: 'Nome', value: 'Whitnie' },
          { label: 'Sobrenome', value: 'Broek' },
          { label: 'Curso de interesse', value: 'Intensive' },
          { label: 'Segundo curso de interesse', value: 'Rehabilitation' },
        ],
      },
      {
        id: 'sub-older',
        source: 'Facebook Lead Ads',
        form_name: 'Intensive São Paulo',
        submitted_at: '2026-02-03T22:39:52Z',
        recovery_state: 'complete',
        fields: [
          { label: 'Nome', value: 'Whitnie' },
          { label: 'Sobrenome', value: 'Broek' },
          { label: 'Curso de interesse', value: 'Intensive' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockMultipleSubmissions,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="whitnie-id"
        leadName="Whitnie Broek"
      />
    );

    await waitFor(() => {
      // Submissions count heading
      expect(screen.getByText(/Envios registrados \(2\)/i)).toBeInTheDocument();

      // First submission active
      expect(screen.getByText('Rehabilitation Nov 2026-Revised')).toBeInTheDocument();
      expect(screen.getByText('Segundo curso de interesse')).toBeInTheDocument();

      // Navigation buttons present
      expect(screen.getByText(/Formulário 1.*\(Mais recente\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Formulário 2/i)).toBeInTheDocument();
    });

    // Switch to second submission
    fireEvent.click(screen.getByText(/Formulário 2/i));

    await waitFor(() => {
      expect(screen.getByText('Intensive São Paulo')).toBeInTheDocument();
      expect(screen.getByText('Facebook Lead Ads')).toBeInTheDocument();
    });
  });

  it('G. Partially recovered historical submission displays explicit amber warning banner without fabricating answers', async () => {
    const mockPartiallyRecovered = [
      {
        id: 'fallback-lead-id',
        source: 'Meta Lead Ads',
        form_name: 'Formulário de Inscrição',
        submitted_at: '2026-01-15T12:00:00Z',
        recovery_state: 'partially_recovered',
        notes: 'Formulário histórico parcialmente recuperado. Algumas respostas originais não estão mais disponíveis na fonte.',
        fields: [
          { label: 'Nome', value: 'Historical' },
          { label: 'Sobrenome', value: 'Doctor' },
          { label: 'E-mail', value: 'historical@example.com' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockPartiallyRecovered,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="fallback-lead-id"
        leadName="Historical Doctor"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Formulário histórico parcialmente recuperado')).toBeInTheDocument();
      expect(screen.getByText(/Algumas respostas originais não estão mais disponíveis na fonte/i)).toBeInTheDocument();
      expect(screen.getByText('historical@example.com')).toBeInTheDocument();
    });
  });

  it('H. Excludes prohibited sensitive credentials, tokens, passwords, and medical data', async () => {
    const mockSubmissionWithSensitiveFields = [
      {
        id: 'sub-sensitive',
        source: 'Site',
        form_name: 'Application Form',
        submitted_at: '2026-09-26T12:00:00Z',
        recovery_state: 'complete',
        fields: [
          { label: 'Nome', value: 'Doctor Test' },
          { label: 'E-mail', value: 'doctor@example.com' },
          { label: 'api_key', value: 'super_secret_api_key_123' },
          { label: 'access_token', value: 'bearer_token_xyz' },
          { label: 'session_token', value: 'session_abc' },
          { label: 'password', value: 'plaintextpassword' },
          { label: 'csrf_token', value: 'csrf_123' },
          { label: 'medical_conditions', value: 'private health info' },
          { label: 'dietary', value: 'vegan allergies' },
          { label: 'passport_number', value: 'US12345678' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockSubmissionWithSensitiveFields,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="lead-sensitive"
        leadName="Doctor Test"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Doctor Test')).toBeInTheDocument();
      expect(screen.getByText('doctor@example.com')).toBeInTheDocument();

      // Prohibited items MUST NOT be rendered
      expect(screen.queryByText('super_secret_api_key_123')).toBeNull();
      expect(screen.queryByText('bearer_token_xyz')).toBeNull();
      expect(screen.queryByText('session_abc')).toBeNull();
      expect(screen.queryByText('plaintextpassword')).toBeNull();
      expect(screen.queryByText('csrf_123')).toBeNull();
      expect(screen.queryByText('private health info')).toBeNull();
      expect(screen.queryByText('vegan allergies')).toBeNull();
      expect(screen.queryByText('US12345678')).toBeNull();
    });
  });

  it('Copy button copies field value to clipboard', async () => {
    const mockSub = [
      {
        id: 'sub-copy',
        source: 'Meta Lead Ads',
        form_name: 'Contact Form',
        submitted_at: '2026-09-26T12:00:00Z',
        recovery_state: 'complete',
        fields: [
          { label: 'E-mail', value: 'copytest@example.com' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockSub,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="lead-copy"
        leadName="Copy Test"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('copytest@example.com')).toBeInTheDocument();
    });

    const copyBtn = screen.getByTitle('Copiar valor');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copytest@example.com');
  });
});
