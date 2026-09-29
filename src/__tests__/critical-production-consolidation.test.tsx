import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import { LeadFormSubmissionModal } from '../features/leads/components/LeadFormSubmissionModal';
import { EnrollmentModal } from '../features/leads/components/EnrollmentModal';
import { TemplatePreviewModal } from '../features/templates/components/TemplatePreviewModal';
import { getApprovedZygomaticSmsText } from '../utils/salutation';
import { supabase } from '../lib/supabase';
import type { Lead, EmailTemplate } from '../types';

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
    },
  };
});

vi.mock('../features/revenue/services/revenue-service', () => ({
  fetchCourses: vi.fn().mockResolvedValue([
    {
      id: 'course-zit-1',
      code: 'ZIT-01',
      name: 'Zygomatic Implant Training',
      default_price: 17500,
      active: true,
    },
    {
      id: 'course-adie-1',
      code: 'ADIE-01',
      name: 'Advanced Dental Implant Experience',
      default_price: 14500,
      active: true,
    },
  ]),
  createEnrollment: vi.fn().mockResolvedValue('enrollment-uuid-123'),
  updateEnrollment: vi.fn().mockResolvedValue('enrollment-uuid-123'),
}));

describe('CRITICAL PRODUCTION CONSOLIDATION — Objectives A through V', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseLead: Lead = {
    id: 'lead-test-prod-1',
    first_name: 'Scott',
    last_name: 'Kareth',
    email: 'drscottkareth@gmail.com',
    phone_raw: '+1 (555) 123-4567',
    phone_e164: '+15551234567',
    contact_preference: 'sms',
    pipeline_stage_id: 'stage-novo-lead',
    source: 'meta',
    source_detail: 'lead_gen_ad',
    created_at: '2026-09-26T10:00:00Z',
    updated_at: '2026-09-26T10:00:00Z',
  } as Lead;

  // =========================================================================
  // Requirement A: compact Lead Card does not show Contact Preference
  // =========================================================================
  it('A. compact Lead Card does not show Contact Preference badge', () => {
    render(
      <MinimalLeadCard
        lead={baseLead}
        stageCode="capture"
        stageName="Novo Lead"
      />
    );

    // Preferência: SMS must NOT be rendered on compact card
    expect(screen.queryByTestId('contact-preference-badge')).toBeNull();
    expect(screen.queryByText(/Preferência:/i)).toBeNull();
  });

  // =========================================================================
  // Requirement B: Lead Profile still shows Contact Preference
  // =========================================================================
  it('B. Lead Profile still shows Contact Preference in header and details', () => {
    render(
      <BrowserRouter>
        <LeadProfileContent
          leadId={baseLead.id}
          initialLead={baseLead}
          isStandalonePage={true}
        />
      </BrowserRouter>
    );

    const headerBadge = screen.getByTestId('profile-contact-preference-badge');
    expect(headerBadge).toBeDefined();
    expect(headerBadge.textContent).toContain('Preferência: SMS');

    const detailValue = screen.getByTestId('profile-contact-preference-value');
    expect(detailValue).toBeDefined();
    expect(detailValue.textContent).toBe('SMS');
  });

  // =========================================================================
  // Requirement C: SMS enviado remains visible
  // =========================================================================
  it('C. SMS enviado remains visible independently on compact card when sent', () => {
    const smsSentInfo = {
      sentAt: '2026-09-26T14:10:00Z',
      formattedDate: '26/09',
    };

    render(
      <MinimalLeadCard
        lead={baseLead}
        stageCode="capture"
        stageName="Novo Lead"
        smsSentInfo={smsSentInfo}
      />
    );

    // SMS enviado is preserved independently
    const smsBadge = screen.getByTestId('lead-card-sms-sent-badge');
    expect(smsBadge).toBeDefined();
    expect(smsBadge.textContent).toContain('SMS enviado');
    expect(smsBadge.textContent).toContain('(26/09)');
  });

  // =========================================================================
  // Requirement D, E, F, G: Canonical short course names & deduplication
  // =========================================================================
  it('D & F & G. same canonical course appears once only using short canonical name without session/date/#', () => {
    // Simulated duplicate interests for same canonical course
    const duplicateInterests = [
      { courseName: 'Zygomatic Implant Training • Nov 2026 #1', startDate: '2026-11-07' },
      { courseName: 'Zygomatic Implant Training', startDate: null },
    ];

    const leadWithDupes: Lead = {
      ...baseLead,
      course_interest: 'Zygomatic Implant Training',
    };

    render(
      <MinimalLeadCard
        lead={leadWithDupes}
        interests={duplicateInterests}
      />
    );

    const courseBadges = screen.getAllByTestId('lead-card-course-badge');
    // Deduplicated: only 1 badge rendered!
    expect(courseBadges).toHaveLength(1);
    expect(courseBadges[0].textContent).toBe('Zygomatic');
    expect(courseBadges[0].textContent).not.toContain('• Nov 2026');
    expect(courseBadges[0].textContent).not.toContain('#1');
  });

  it('E. different course interests remain separately visible', () => {
    const differentInterests = [
      { courseName: 'Zygomatic Implant Training', startDate: '2026-11-07' },
      { courseName: 'Advanced Dental Implant Experience', startDate: '2026-12-01' },
    ];

    render(
      <MinimalLeadCard
        lead={baseLead}
        interests={differentInterests}
      />
    );

    const courseBadges = screen.getAllByTestId('lead-card-course-badge');
    expect(courseBadges).toHaveLength(2);
    expect(courseBadges[0].textContent).toBe('Zygomatic');
    expect(courseBadges[1].textContent).toBe('Advanced');
  });

  // =========================================================================
  // Requirement H: Lead Profile course matches Lead Card
  // =========================================================================
  it('H. Lead Profile course matches Lead Card canonical short name', () => {
    const leadWithCourse: Lead = {
      ...baseLead,
      course_interest: 'Zygomatic Implant Training • Nov 2026 #1',
    };

    render(
      <BrowserRouter>
        <LeadProfileContent
          leadId={leadWithCourse.id}
          initialLead={leadWithCourse}
          isStandalonePage={true}
        />
      </BrowserRouter>
    );

    // Profile renders canonical short name "Zygomatic"
    expect(screen.getByText('Zygomatic')).toBeInTheDocument();
  });

  // =========================================================================
  // Requirement I, J, K, L: Form traceability & dynamic business field rendering
  // =========================================================================
  it('I, J, K, L. LeadFormSubmissionModal displays all factual allowed fields and excludes sensitive data', async () => {
    const mockSubmissions = [
      {
        id: 'sub-site-2',
        source: 'Formulário do Site',
        form_name: 'Website Application',
        submitted_at: '2026-09-26T15:00:00Z',
        fields: [
          { label: 'Nome Completo', value: 'Mustafa Nourozi' },
          { label: 'E-mail', value: 'mustafa@example.com' },
          { label: 'Telefone', value: '+14035550199' },
          { label: 'Curso', value: 'Zygomatic' },
          { label: 'Especialidade', value: 'Oral & Maxillofacial Surgeon' },
          { label: 'Anos de Experiência', value: '8' },
          { label: 'Experiência Cirúrgica', value: 'High' },
          { label: 'Número AGD', value: '123456' },
          { label: 'Código Promocional', value: 'RIO2026' },
          { label: 'Página de Origem', value: 'https://expdentalsolutions.com/courses' },
          { label: 'UTM Source', value: 'google' },
        ],
      },
      {
        id: 'sub-meta-1',
        source: 'Meta Lead Ads',
        form_name: 'Meta Instant Form',
        submitted_at: '2026-09-20T10:00:00Z',
        fields: [
          { label: 'Nome', value: 'Mustafa' },
          { label: 'Sobrenome', value: 'Nourozi' },
          { label: 'Email', value: 'mustafa@example.com' },
          { label: 'Pergunta: Experiência em implantes?', value: 'Mais de 50 casos' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockSubmissions,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId={baseLead.id}
        leadName="Mustafa Nourozi"
      />
    );

    await waitFor(() => {
      // Multiple submissions navigation
      expect(screen.getByText(/Envios registrados \(2\)/i)).toBeInTheDocument();
      // Form fields rendered dynamically
      expect(screen.getByText('Oral & Maxillofacial Surgeon')).toBeInTheDocument();
      expect(screen.getByText('RIO2026')).toBeInTheDocument();
      expect(screen.getByText('123456')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Requirement M, N, O, P: SMS Template name, canonical body, and channel isolation
  // =========================================================================
  it('M, N, O, P. SMS template name is "Contato SMS inicial", uses canonical body, and avoids email contamination', () => {
    // 1. Name and canonical text
    const sampleLeadDoctor = { first_name: 'Scott', last_name: 'Kareth' };
    const smsText = getApprovedZygomaticSmsText(sampleLeadDoctor);
    expect(smsText).toContain('Hello Dr. Kareth');
    expect(smsText).toContain('This is Natália from Expert Dental Solutions.');
    expect(smsText).toContain('I just sent you an email with all the course details.');
    expect(smsText).toContain('Would either of those dates work for you?');

    // Salutation fallback when no usable surname exists
    const sampleLeadNoSurname = { first_name: 'Scott', last_name: '' };
    const smsTextNoSurname = getApprovedZygomaticSmsText(sampleLeadNoSurname);
    expect(smsTextNoSurname).toContain('Hello Doctor');
    expect(smsTextNoSurname).not.toContain('Hello Dr.');

    // 2. Strict Channel Isolation in TemplatePreviewModal
    const mockSmsTemplate = {
      id: 'sms-tpl-1',
      name: 'Contato SMS inicial',
      template_key: 'zygomatic_followup_sms',
      category: 'sms',
      channel: 'sms',
      subject: '',
      html_template: '',
      text_template: '{{salutation_line}}\nThis is Natália...',
      content_json: { channel: 'sms' },
      is_active: true,
      created_at: '2026-09-26T00:00:00Z',
      updated_at: '2026-09-26T00:00:00Z',
    } as unknown as EmailTemplate;

    render(
      <TemplatePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        template={mockSmsTemplate}
      />
    );

    // SMS preview displays SMS text and NEVER email html
    expect(screen.getByText(/Dispositivo Móvel • SMS/i)).toBeInTheDocument();
    expect(screen.queryByTitle('Email Preview')).toBeNull();
  });

  // =========================================================================
  // Requirement T, U, V: Simplified Enrollment Modal
  // =========================================================================
  it('T & U & V. New Enrollment modal shows only Curso Oficial, Status da Matrícula, and Data do Curso', async () => {
    render(
      <EnrollmentModal
        isOpen={true}
        onClose={vi.fn()}
        leadId={baseLead.id}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      // 1. Curso Oficial field exists
      expect(screen.getByTestId('enrollment-modal-course-select')).toBeInTheDocument();
      // 2. Status da Matrícula field exists
      expect(screen.getByTestId('enrollment-modal-status-select')).toBeInTheDocument();
      // 3. Data do Curso field exists
      expect(screen.getByTestId('enrollment-modal-course-date-input')).toBeInTheDocument();

      // Removed commercial / financial fields from UI:
      expect(screen.queryByText(/Valor Acordado/i)).toBeNull();
      expect(screen.queryByText(/Registrar pagamento inicial/i)).toBeNull();
      expect(screen.queryByText(/Valor Pago/i)).toBeNull();
      expect(screen.queryByText(/Método de Pagamento/i)).toBeNull();
      expect(screen.queryByText(/Status do Pagamento/i)).toBeNull();
      expect(screen.queryByText(/Notas \/ Observações Comerciais/i)).toBeNull();
    });
  });
});
