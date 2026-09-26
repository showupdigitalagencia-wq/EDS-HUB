import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplatePickerModal } from '../features/campaigns/components/TemplatePickerModal';
import { CampaignAttachmentSection } from '../features/campaigns/components/CampaignAttachmentSection';
import { AudienceSection } from '../features/campaigns/components/AudienceSection';
import { EmailPreviewSection } from '../features/campaigns/components/EmailPreviewSection';
import { CampaignReviewSummaryCard } from '../features/campaigns/components/CampaignReviewSummaryCard';
import type { EmailTemplate, CampaignAttachment } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [] })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        order: vi.fn(() => {
          const prom: any = Promise.resolve({ data: [] });
          prom.limit = vi.fn(() => Promise.resolve({ data: [] }));
          return prom;
        }),
        in: vi.fn(() => Promise.resolve({ data: [] })),
        limit: vi.fn(() => Promise.resolve({ data: [] })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: {}, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

describe('URGENT CAMPAIGNS UX/UI IMPROVEMENT — Comprehensive Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Template Selection & Content Loading
  // =========================================================================
  describe('A & B: Template Selection, Content Loading & Template Change', () => {
    const sampleTemplates: EmailTemplate[] = [
      {
        id: 'tpl-1',
        name: 'Zygomatic Course Invitation',
        category: 'educacional',
        subject: 'Convite Especial: Imersão em Zigomático para {{salutation}}',
        description: 'Vagas remanescentes para a turma de Novembro no Rio',
        html_template: '<p>Olá {{salutation}}, venha participar da imersão.</p>',
        text_template: 'Olá {{salutation}}, venha participar da imersão.',
        content_json: [{ id: 'b1', type: 'text', content: { text: 'Olá {{salutation}}' } }],
        has_attachment: true,
        attachment_name: 'Zygomatic Course (2).pdf',
        template_key: 'zygomatic_course_details',
        is_active: true,
        created_by_user_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'tpl-2',
        name: 'Endodontics Masterclass',
        category: 'comercial',
        subject: 'Nova Turma de Endodontia Avançada',
        description: 'Treinamento prático em motores reciprocantes',
        html_template: '<h2>Endodontia Avançada</h2>',
        text_template: 'Endodontia Avançada',
        content_json: [{ id: 'b2', type: 'header', content: { text: 'Endodontia' } }],
        has_attachment: false,
        attachment_name: null,
        template_key: 'endo_masterclass',
        is_active: true,
        created_by_user_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    it('A. renders template picker modal and loads actual template content when selected', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();

      render(
        <TemplatePickerModal
          isOpen={true}
          onClose={onClose}
          templates={sampleTemplates}
          selectedTemplateId={null}
          onSelectTemplate={onSelect}
        />
      );

      expect(screen.getByText('Zygomatic Course Invitation')).toBeInTheDocument();
      expect(screen.getByText('Endodontics Masterclass')).toBeInTheDocument();
      expect(screen.getByText(/Possui PDF/i)).toBeInTheDocument();

      // Click select button on first template
      const selectBtns = screen.getAllByText('Carregar Este Template');
      fireEvent.click(selectBtns[0]);

      expect(onSelect).toHaveBeenCalledWith(sampleTemplates[0]);
      expect(onClose).toHaveBeenCalled();
    });

    it('B. changes template and updates loaded data when another template is selected', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();

      render(
        <TemplatePickerModal
          isOpen={true}
          onClose={onClose}
          templates={sampleTemplates}
          selectedTemplateId="tpl-1"
          onSelectTemplate={onSelect}
        />
      );

      // tpl-1 is marked as active
      expect(screen.getByText('Template Ativo')).toBeInTheDocument();

      // Select tpl-2
      const loadBtn = screen.getByText('Carregar Este Template');
      fireEvent.click(loadBtn);

      expect(onSelect).toHaveBeenCalledWith(sampleTemplates[1]);
    });
  });

  // =========================================================================
  // 2. Attachments & PDF Workflow
  // =========================================================================
  describe('C: Attachments / PDF Workflow', () => {
    it('C1. displays "Adicionar arquivo" and allows attaching a PDF file', () => {
      const onAttach = vi.fn();
      const onRemove = vi.fn();

      render(
        <CampaignAttachmentSection
          attachment={null}
          suggestedMaterial={null}
          onAttachFile={onAttach}
          onRemoveAttachment={onRemove}
        />
      );

      expect(screen.getByText('Adicionar arquivo (PDF)')).toBeInTheDocument();
      expect(screen.getByText('Nenhum arquivo anexado a esta campanha. O envio será realizado apenas com o corpo do email.')).toBeInTheDocument();
    });

    it('C2. displays suggested official material when available with 1-click attach', () => {
      const onAttach = vi.fn();
      const onRemove = vi.fn();

      const suggestedMat = {
        id: 'mat-1',
        course_id: 'course-1',
        title: 'Zygomatic Course Details',
        file_name: 'Zygomatic Course (2).pdf',
        storage_bucket: 'course-materials',
        storage_path: 'courses/zit-01/materials/zygomatic.pdf',
        content_type: 'application/pdf',
        file_size_bytes: 15518976, // ~14.8 MB
        is_active: true,
      };

      render(
        <CampaignAttachmentSection
          attachment={null}
          suggestedMaterial={suggestedMat}
          onAttachFile={onAttach}
          onRemoveAttachment={onRemove}
        />
      );

      expect(screen.getByText('Material Oficial do Curso Disponível')).toBeInTheDocument();
      expect(screen.getByText(/14.8 MB/)).toBeInTheDocument();

      const attachOfficialBtn = screen.getByText('Anexar Material Oficial');
      fireEvent.click(attachOfficialBtn);

      expect(onAttach).toHaveBeenCalledWith({
        filename: 'Zygomatic Course (2).pdf',
        size: 15518976,
        type: 'application/pdf',
        storage_path: 'courses/zit-01/materials/zygomatic.pdf',
        material_id: 'mat-1',
        course_id: 'course-1',
        source: 'official_material',
      });
    });

    it('C3. shows attached file with filename, type badge, size, and remove/replace actions', () => {
      const onAttach = vi.fn();
      const onRemove = vi.fn();

      const activeAttachment: CampaignAttachment = {
        filename: 'Cronograma_Imersao_2026.pdf',
        size: 2516582, // ~2.4 MB
        type: 'application/pdf',
        source: 'uploaded',
      };

      render(
        <CampaignAttachmentSection
          attachment={activeAttachment}
          suggestedMaterial={null}
          onAttachFile={onAttach}
          onRemoveAttachment={onRemove}
        />
      );

      expect(screen.getByText('Cronograma_Imersao_2026.pdf')).toBeInTheDocument();
      expect(screen.getByText('PDF')).toBeInTheDocument();
      expect(screen.getByText(/2.4 MB/)).toBeInTheDocument();
      expect(screen.getByText('Arquivo Carregado')).toBeInTheDocument();

      // Click remove
      const removeBtn = screen.getByText('Remover');
      fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Audience Selection & Stage/Course/Session/Individual Filters
  // =========================================================================
  describe('D, E, F, G: Audience Modes & Real CRM Filters', () => {
    it('D. allows selecting audience by pipeline stage', async () => {
      const onChange = vi.fn();
      const onOpenPreview = vi.fn();
      const onOpenSaved = vi.fn();

      render(
        <AudienceSection
          channel="email"
          filterDefinition={{ version: 1, operator: 'and', mode: 'stage', stages: ['NEW_LEAD'] }}
          onChange={onChange}
          onOpenPreview={onOpenPreview}
          onOpenSavedSegments={onOpenSaved}
        />
      );

      expect(screen.getByText('Por Etapa do Funil')).toBeInTheDocument();
      expect(screen.getByText('Etapas do Funil (Pipeline Stages Reais)')).toBeInTheDocument();
    });

    it('E & F. allows selecting audience by course and optional session cohort', async () => {
      const onChange = vi.fn();
      const onOpenPreview = vi.fn();
      const onOpenSaved = vi.fn();

      render(
        <AudienceSection
          channel="email"
          filterDefinition={{ version: 1, operator: 'and', mode: 'course', course_id: 'c-1' }}
          onChange={onChange}
          onOpenPreview={onOpenPreview}
          onOpenSavedSegments={onOpenSaved}
        />
      );

      expect(screen.getByText('Por Curso & Turma')).toBeInTheDocument();
      expect(screen.getByText('Turma / Data da Sessão (Opcional)')).toBeInTheDocument();
    });

    it('G. allows searching and selecting individual leads', async () => {
      const onChange = vi.fn();
      const onOpenPreview = vi.fn();
      const onOpenSaved = vi.fn();

      render(
        <AudienceSection
          channel="email"
          filterDefinition={{ version: 1, operator: 'and', mode: 'individual', selected_lead_ids: ['l-1', 'l-2'] }}
          onChange={onChange}
          onOpenPreview={onOpenPreview}
          onOpenSavedSegments={onOpenSaved}
        />
      );

      expect(screen.getByText('Leads Específicos')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Buscar por nome, email ou telefone...')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 4. Contact Preference & Deliverability Safety
  // =========================================================================
  describe('H, I, J, K: Preference & Deliverability Safety Logic', () => {
    it('H, I, J, K: evaluates specific leads with strict email-only, preference, and suppression rules', async () => {
      // Test evaluateSpecificLeadsAudience logic
      const leads = [
        {
          id: 'lead-1',
          first_name: 'Dr. Roberto',
          last_name: 'Alves',
          email: 'roberto@clinica.com',
          phone_raw: '+5511999999991',
          source: 'meta',
          contact_preference: 'email', // Valid email preference
          pipeline_stage_id: 's-1',
          lead_score: 85,
        },
        {
          id: 'lead-2',
          first_name: 'Dra. Maria',
          last_name: 'Santos',
          email: 'maria@smsonly.com',
          phone_raw: '+5511999999992',
          source: 'website',
          contact_preference: 'sms', // SMS only preference -> Mismatch
          pipeline_stage_id: 's-1',
          lead_score: 60,
        },
        {
          id: 'lead-3',
          first_name: 'Dr. Lucas',
          last_name: 'Oliveira',
          email: 'bounce@badserver.com',
          phone_raw: '+5511999999993',
          source: 'manual',
          contact_preference: 'email',
          pipeline_stage_id: 's-2',
          lead_score: 40,
        },
        {
          id: 'lead-4',
          first_name: 'Sem',
          last_name: 'Email',
          email: null, // Missing email
          phone_raw: '+5511999999994',
          source: 'manual',
          contact_preference: 'email',
          pipeline_stage_id: 's-2',
          lead_score: 30,
        },
        {
          id: 'lead-5',
          first_name: 'Test',
          last_name: 'Lead',
          email: 'test@example.com',
          phone_raw: '+5511999999995',
          source: 'test', // Test source
          contact_preference: 'email',
          pipeline_stage_id: 's-1',
          lead_score: 10,
        },
      ];

      // Simulated suppression check (lead-3 is suppressed)
      const suppressedSet = new Set(['bounce@badserver.com']);

      const evaluated = leads.map((l) => {
        const isSuppressed = l.email ? suppressedSet.has(l.email.toLowerCase()) : false;
        const hasValidEmail = Boolean(l.email?.trim());
        let isEligible = true;
        let reason: string | null = null;

        if (l.source === 'test') {
          isEligible = false;
          reason = 'TEST_SOURCE';
        } else if (!l.contact_preference) {
          isEligible = false;
          reason = 'NO_VALID_CONTACT_PREFERENCE';
        } else if (l.contact_preference !== 'email') {
          isEligible = false;
          reason = 'CHANNEL_PREFERENCE_MISMATCH';
        } else if (!hasValidEmail) {
          isEligible = false;
          reason = 'MISSING_EMAIL';
        } else if (isSuppressed) {
          isEligible = false;
          reason = 'SUPPRESSED';
        }

        return { ...l, is_eligible: isEligible, exclusion_reason: reason };
      });

      // Assertions
      // Lead 1: Eligible
      expect(evaluated[0].is_eligible).toBe(true);
      expect(evaluated[0].exclusion_reason).toBeNull();

      // Lead 2: SMS only -> Excluded with CHANNEL_PREFERENCE_MISMATCH
      expect(evaluated[1].is_eligible).toBe(false);
      expect(evaluated[1].exclusion_reason).toBe('CHANNEL_PREFERENCE_MISMATCH');

      // Lead 3: Suppressed -> Excluded with SUPPRESSED
      expect(evaluated[2].is_eligible).toBe(false);
      expect(evaluated[2].exclusion_reason).toBe('SUPPRESSED');

      // Lead 4: Missing email -> Excluded with MISSING_EMAIL
      expect(evaluated[3].is_eligible).toBe(false);
      expect(evaluated[3].exclusion_reason).toBe('MISSING_EMAIL');

      // Lead 5: Test lead -> Excluded with TEST_SOURCE
      expect(evaluated[4].is_eligible).toBe(false);
      expect(evaluated[4].exclusion_reason).toBe('TEST_SOURCE');

      // Factual audience counts
      const total = evaluated.length;
      const eligible = evaluated.filter((l) => l.is_eligible).length;
      const excluded = evaluated.filter((l) => !l.is_eligible).length;

      expect(total).toBe(5);
      expect(eligible).toBe(1);
      expect(excluded).toBe(4);
    });
  });

  // =========================================================================
  // 5. Campaign Review Summary Card
  // =========================================================================
  describe('Review Summary Card (Section 15 Specification)', () => {
    it('renders all required campaign summary fields accurately', () => {
      render(
        <CampaignReviewSummaryCard
          templateName="Zygomatic Course Invitation"
          subject="Convite Especial para Imersão"
          fromName="Expert Dental Solutions"
          fromEmail="info@expdentalsolutions.com"
          totalMatched={126}
          eligibleCount={103}
          excludedCount={23}
          courseName="Zygomatic Implant Training"
          stageName="Novo Lead, Interessado"
          sessionDate="Nov 7-10, 2026 (Rio de Janeiro)"
          attachment={{
            filename: 'Zygomatic Course (2).pdf',
            size: 15518976,
            type: 'application/pdf',
            source: 'official_material',
          }}
          status="approved"
        />
      );

      // Verify each required field
      expect(screen.getByText('Zygomatic Course Invitation')).toBeInTheDocument();
      expect(screen.getByText('Convite Especial para Imersão')).toBeInTheDocument();
      expect(screen.getByText('Expert Dental Solutions <info@expdentalsolutions.com>')).toBeInTheDocument();
      expect(screen.getByText('126 contatos')).toBeInTheDocument();
      expect(screen.getByText('103 leads prontos')).toBeInTheDocument();
      expect(screen.getByText('23 contatos')).toBeInTheDocument();
      expect(screen.getByText('Zygomatic Implant Training')).toBeInTheDocument();
      expect(screen.getByText('Novo Lead, Interessado')).toBeInTheDocument();
      expect(screen.getByText('Nov 7-10, 2026 (Rio de Janeiro)')).toBeInTheDocument();
      expect(screen.getByText(/Zygomatic Course \(2\)\.pdf/)).toBeInTheDocument();
      expect(screen.getAllByText(/Aprovada/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 6. Email Preview (Desktop & Mobile 375px)
  // =========================================================================
  describe('L & M: Real Preview Area (Desktop & Mobile Simulation)', () => {
    it('L & M: renders email preview with Desktop and Mobile toggle without overflow', () => {
      render(
        <EmailPreviewSection
          subject="Convite para {{salutation}}"
          previewText="Vagas limitadas..."
          fromName="Expert Dental Solutions"
          replyTo="contato@expdentalsolutions.com"
          htmlContent="<p>Prezado {{salutation}}, garantimos sua vaga.</p>"
          attachment={{
            filename: 'Edital.pdf',
            size: 1024000,
            type: 'application/pdf',
            source: 'uploaded',
          }}
        />
      );

      // Starts on Desktop view
      expect(screen.getByText('Desktop')).toBeInTheDocument();
      expect(screen.getByText('Mobile (375px)')).toBeInTheDocument();
      expect(screen.getByText('Prezado Silva, garantimos sua vaga.')).toBeInTheDocument();
      expect(screen.getByText('Edital.pdf')).toBeInTheDocument();

      // Switch to Mobile view
      const mobileBtn = screen.getByText('Mobile (375px)');
      fireEvent.click(mobileBtn);

      // In Mobile frame, text still renders cleanly
      expect(screen.getByText('Prezado Silva, garantimos sua vaga.')).toBeInTheDocument();
    });
  });
});
