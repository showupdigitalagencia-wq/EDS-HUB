import { describe, it, expect, vi } from 'vitest';
import {
  EDS_OFFICIAL_LOGO_URL,
  cleanSubjectParam,
  formatEdsSubject,
  renderEdsEmailHtml,
  buildContactUsEmail,
  buildCourseInfoEmail,
  buildIncompleteAttemptEmail,
  buildCompletedRegistrationEmail,
  sendInternalEnrollmentNotification,
} from '../../supabase/functions/_shared/internal-enrollment-notifier.ts';

vi.mock('../../supabase/functions/_shared/resend-adapter.ts', () => ({
  sendEmail: vi.fn().mockResolvedValue({
    success: true,
    messageId: 'msg_test_123',
    errorCode: null,
    errorMessage: null,
  }),
}));

describe('EDS Email Visual Identity & Subject Standardization', () => {
  // ===========================================================================
  // 1. BRAND ASSET AUDIT & LOGO COMPLIANCE
  // ===========================================================================
  describe('Official Brand Asset & Logo Compliance', () => {
    it('uses the trusted absolute HTTPS logo from expdentalsolutions.com', () => {
      expect(EDS_OFFICIAL_LOGO_URL).toBe(
        'https://www.expdentalsolutions.com/storage/site/fJOJt2KVIZpwj4mHb7QQ.png'
      );
      expect(EDS_OFFICIAL_LOGO_URL).toMatch(/^https:\/\//);
      expect(EDS_OFFICIAL_LOGO_URL).toContain('expdentalsolutions.com');
    });

    it('embeds the official logo with proper alt text and dimensions in all emails', () => {
      const email = buildContactUsEmail(
        {
          idempotency_key: 'test_contact_logo',
          lead_name: 'Dr. John Doe',
          email: 'john@example.com',
        },
        'https://hub.expdentalsolutions.com/leads/123'
      );

      expect(email.html).toContain(EDS_OFFICIAL_LOGO_URL);
      expect(email.html).toContain('alt="Expert Dental Solutions"');
      expect(email.html).toContain('Expert Dental Solutions');
      expect(email.html).toContain('max-width: 600px');
    });
  });

  // ===========================================================================
  // 2. SUBJECT STANDARDIZATION & PURITY RULES
  // ===========================================================================
  describe('Subject Standardization & Clean Param Rules', () => {
    it('cleans invalid, null, undefined, and UUID parameters', () => {
      expect(cleanSubjectParam(undefined)).toBeNull();
      expect(cleanSubjectParam(null)).toBeNull();
      expect(cleanSubjectParam('')).toBeNull();
      expect(cleanSubjectParam('   ')).toBeNull();
      expect(cleanSubjectParam('undefined')).toBeNull();
      expect(cleanSubjectParam('null')).toBeNull();
      expect(cleanSubjectParam('nil')).toBeNull();
      expect(cleanSubjectParam('n/a')).toBeNull();
      expect(cleanSubjectParam('não informada')).toBeNull();
      expect(cleanSubjectParam('não informado')).toBeNull();
      expect(cleanSubjectParam('curso não especificado')).toBeNull();
      expect(cleanSubjectParam('curso')).toBeNull();
      expect(cleanSubjectParam('turma não informada')).toBeNull();
      // UUID must be stripped
      expect(cleanSubjectParam('550e8400-e29b-41d4-a716-446655440000')).toBeNull();

      // Factual values preserved
      expect(cleanSubjectParam('Dr. John Doe')).toBe('Dr. John Doe');
      expect(cleanSubjectParam('Zygomatic Implant Training')).toBe('Zygomatic Implant Training');
      expect(cleanSubjectParam('Turma Maio 2026')).toBe('Turma Maio 2026');
    });

    it('formats subjects without hanging separators when parameters are omitted', () => {
      // All present
      expect(
        formatEdsSubject('[EDS] Nova matrícula concluída', 'Dr. John Doe', 'Zygomatic Implant Training', 'Maio 2026')
      ).toBe('[EDS] Nova matrícula concluída — Dr. John Doe — Zygomatic Implant Training — Maio 2026');

      // Turma missing
      expect(
        formatEdsSubject('[EDS] Nova matrícula concluída', 'Dr. John Doe', 'Zygomatic Implant Training', null)
      ).toBe('[EDS] Nova matrícula concluída — Dr. John Doe — Zygomatic Implant Training');

      // Course and Turma missing
      expect(
        formatEdsSubject('[EDS] Novo contato pelo site', 'Dr. John Doe', null, null)
      ).toBe('[EDS] Novo contato pelo site — Dr. John Doe');

      // UUID passed as course -> stripped, no hanging separator
      expect(
        formatEdsSubject('[EDS] Matrícula não concluída', 'Dr. Jane Smith', 'e0325983-a740-42bc-9d33-40eeb27c6ce7', undefined)
      ).toBe('[EDS] Matrícula não concluída — Dr. Jane Smith');
    });
  });

  // ===========================================================================
  // 3. CONTACT US INTERNAL EMAIL
  // ===========================================================================
  describe('Contact Us Internal Email', () => {
    it('builds standardized subject and responsive HTML with safe escaping', () => {
      const email = buildContactUsEmail(
        {
          idempotency_key: 'test_contact_us_1',
          lead_name: 'Dr. Jane Contact',
          email: 'jane@contact.com',
          phone: '+1 305 555 0100',
          message: 'Gostaria de saber mais sobre as datas presenciais em Miami.',
          source_page: 'https://www.expdentalsolutions.com/contact',
          utm_source: 'google',
          utm_campaign: 'spring_2026',
          raw_payload: {
            clinic_name: 'Contact Dental Clinic',
            _token: 'secret_csrf_token',
            'g-recaptcha-response': 'secret_captcha_token',
          },
        },
        'https://hub.expdentalsolutions.com/leads/lead-001'
      );

      // Standardized subject
      expect(email.subject).toBe('[EDS] Novo contato pelo site — Dr. Jane Contact');

      // Header & Visual Elements
      expect(email.html).toContain(EDS_OFFICIAL_LOGO_URL);
      expect(email.html).toContain('Novo contato pelo site');
      expect(email.html).toContain('Website Contact');
      expect(email.html).toContain('Dr. Jane Contact');

      // Sections
      expect(email.html).toContain('Dados do Contato');
      expect(email.html).toContain('jane@contact.com');
      expect(email.html).toContain('+1 305 555 0100');
      expect(email.html).toContain('Mensagem do Visitante');
      expect(email.html).toContain('Gostaria de saber mais sobre as datas presenciais em Miami.');
      expect(email.html).toContain('Contact Dental Clinic');
      expect(email.html).toContain('Origem e Rastreamento');
      expect(email.html).toContain('google');
      expect(email.html).toContain('spring_2026');

      // Security: Technical secrets must NOT be exposed
      expect(email.html).not.toContain('secret_csrf_token');
      expect(email.html).not.toContain('secret_captcha_token');

      // CTA button & Footer
      expect(email.html).toContain('Abrir lead no EDS HUB');
      expect(email.html).toContain('https://hub.expdentalsolutions.com/leads/lead-001');
      expect(email.html).toContain('Notificação operacional automática do CRM EDS HUB.');
    });
  });

  // ===========================================================================
  // 4. REQUEST COURSE INFORMATION INTERNAL EMAIL
  // ===========================================================================
  describe('Request Course Information Internal Email', () => {
    it('builds standardized subject and responsive layout with canonical course title', () => {
      const email = buildCourseInfoEmail(
        {
          idempotency_key: 'test_course_info_1',
          lead_name: 'Dr. Arthur Conan',
          email: 'arthur@bakerstreet.com',
          phone: '+1 415 555 0122',
          course: 'IDIT-01',
          message: 'Tenho interesse no treinamento intensivo de implantes.',
          source_page: 'https://www.expdentalsolutions.com/request-course-information',
          utm_source: 'meta',
          utm_campaign: 'implants_promo',
        },
        'https://hub.expdentalsolutions.com/leads/lead-002'
      );

      // Standardized subject
      expect(email.subject).toBe('[EDS] Pedido de informações — Dr. Arthur Conan — Intensive Dental Implant Training');

      // Header & Event Title
      expect(email.html).toContain(EDS_OFFICIAL_LOGO_URL);
      expect(email.html).toContain('Novo pedido de informações sobre curso');
      expect(email.html).toContain('Informações de Curso');

      // Lead & Course
      expect(email.html).toContain('Dr. Arthur Conan');
      expect(email.html).toContain('Intensive Dental Implant Training');
      expect(email.html).toContain('arthur@bakerstreet.com');
      expect(email.html).toContain('+1 415 555 0122');
      expect(email.html).toContain('Tenho interesse no treinamento intensivo de implantes.');

      // CTA
      expect(email.html).toContain('Abrir lead no EDS HUB');
    });

    it('omits course parameter in subject cleanly when course is missing or generic', () => {
      const email = buildCourseInfoEmail(
        {
          idempotency_key: 'test_course_info_2',
          lead_name: 'Dr. Arthur Conan',
          course: '',
        },
        'https://hub.expdentalsolutions.com/leads/lead-002'
      );

      expect(email.subject).toBe('[EDS] Pedido de informações — Dr. Arthur Conan');
      expect(email.subject).not.toContain('—  —');
      expect(email.subject).not.toContain('undefined');
    });
  });

  // ===========================================================================
  // 5. INCOMPLETE REGISTRATION INTERNAL EMAIL
  // ===========================================================================
  describe('Incomplete Registration Internal Email', () => {
    it('builds standardized subject with diagnostic fields and CTA', () => {
      const email = buildIncompleteAttemptEmail(
        {
          event_type: 'incomplete_registration',
          idempotency_key: 'internal_email:attempt:att_test_100',
          lead_name: 'Dr. Bruce Banner',
          email: 'banner@gamma.org',
          phone: '+1 212 555 0199',
          course_name: 'Zygomatic Implant Training',
          turma_name: 'Cohort Outubro 2026',
          status: 'needs_followup',
          missing_reason: 'Formulário abandonado no passo 2',
          raw_payload: {
            specialty: 'Maxillofacial Surgery',
            years_in_practice: '10+ years',
            emergency_phone: '+1 212 555 0100',
            country: 'USA',
            city: 'New York',
            state: 'NY',
            heard_from: 'Recomendação de colega',
            referral_name: 'Dr. Tony Stark',
            promo_code: 'AVENGERS10',
          },
        },
        'https://hub.expdentalsolutions.com/leads/lead-banner'
      );

      // Standardized subject
      expect(email.subject).toBe('[EDS] Matrícula não concluída — Dr. Bruce Banner — Zygomatic Implant Training');

      // Visual header & badge
      expect(email.html).toContain(EDS_OFFICIAL_LOGO_URL);
      expect(email.html).toContain('Tentativa de matrícula não concluída');
      expect(email.html).toContain('Tentativa Incompleta');

      // Lead card
      expect(email.html).toContain('Dr. Bruce Banner');
      expect(email.html).toContain('Zygomatic Implant Training');
      expect(email.html).toContain('Cohort Outubro 2026');

      // Data sections
      expect(email.html).toContain('Dados do Contato');
      expect(email.html).toContain('banner@gamma.org');
      expect(email.html).toContain('+1 212 555 0199');
      expect(email.html).toContain('+1 212 555 0100'); // Emergency phone
      expect(email.html).toContain('USA (New York, NY)');
      expect(email.html).toContain('Formulário abandonado no passo 2');
      expect(email.html).toContain('Maxillofacial Surgery');
      expect(email.html).toContain('Dr. Tony Stark');
      expect(email.html).toContain('AVENGERS10');

      // CTA button
      expect(email.html).toContain('Acompanhar tentativa no EDS HUB');
      expect(email.html).toContain('https://hub.expdentalsolutions.com/leads/lead-banner');
    });
  });

  // ===========================================================================
  // 6. COMPLETED REGISTRATION SPECIAL RULE (LARAVEL-ONLY ISOLATION)
  // ===========================================================================
  describe('Completed Registration Laravel Isolation & Template', () => {
    it('completed registration email builder formats standardized subject with turma', () => {
      const email = buildCompletedRegistrationEmail(
        {
          event_type: 'completed_registration',
          idempotency_key: 'comp_att_123',
          lead_name: 'Dr. Stephen Strange',
          email: 'strange@sanctum.org',
          phone: '+1 212 555 0133',
          course_name: 'Endodontics Training',
          turma_name: 'Turma Novembro 2026',
          raw_payload: {
            specialty: 'Endodontist',
            years_in_practice: '15+ years',
            emergency_phone: '+1 212 555 0111',
          },
        },
        'https://hub.expdentalsolutions.com/leads/lead-strange',
        'https://hub.expdentalsolutions.com/leads/lead-strange/documents'
      );

      // Subject with course and turma
      expect(email.subject).toBe('[EDS] Nova matrícula concluída — Dr. Stephen Strange — Endodontics Training — Turma Novembro 2026');

      // Visual header & badge
      expect(email.html).toContain(EDS_OFFICIAL_LOGO_URL);
      expect(email.html).toContain('Nova matrícula concluída');
      expect(email.html).toContain('Matrícula Confirmada');

      // Canonical rule: No false document storage claims or access button in EDS Hub operational alert
      expect(email.html).not.toContain('Acessar Documentos Seguros');
      expect(email.html).not.toContain('Documentos & Anexos de Matrícula');
      expect(email.html).toContain('Notificação operacional do EDS Hub.');
      expect(email.html).toContain('https://hub.expdentalsolutions.com/leads/lead-strange');
    });

    it('sendInternalEnrollmentNotification dispatches operational alert for completed_registration', async () => {
      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'app_user') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ email: 'info@expdentalsolutions.com' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'internal_notification_logs') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === 'lead_activities') {
            return {
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }),
      };

      const result = await sendInternalEnrollmentNotification(mockDb, {
        event_type: 'completed_registration',
        idempotency_key: 'comp_attempt_999',
        lead_id: 'lead-999',
        lead_name: 'Dr. Stephen Strange',
        course_name: 'Endodontics Training',
      });

      expect(result.success).toBe(true);
      expect(result.recipients).toEqual(['info@expdentalsolutions.com']);
      expect(result.subject).toContain('[EDS] Nova matrícula concluída — Dr. Stephen Strange — Endodontics Training');
    });
  });

  // ===========================================================================
  // 7. MOBILE RESPONSIVENESS & EMAIL CLIENT SAFETY
  // ===========================================================================
  describe('Mobile Responsiveness & Email Client Safety', () => {
    it('includes responsive container class, viewport meta, and inline table layout', () => {
      const html = renderEdsEmailHtml({
        subject: '[EDS] Teste Responsivo',
        eventTitle: 'Teste de Layout',
        leadName: 'Dr. Mobile Test',
        sections: [
          {
            title: 'Seção de Teste',
            rows: [{ label: 'Campo 1', value: 'Valor 1' }],
          },
        ],
      });

      expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1.0"');
      expect(html).toContain('class="eds-container"');
      expect(html).toContain('max-width: 600px');
      expect(html).toContain('role="presentation"');
      expect(html).toContain('style="margin: 0; padding: 0;');
    });

    it('safely escapes HTML in lead names and user inputs to prevent injection', () => {
      const email = buildContactUsEmail(
        {
          idempotency_key: 'test_contact_xss',
          lead_name: 'Dr. Evil <script>alert("xss")</script>',
          email: 'evil@villain.com',
          message: '<b>Malicious payload</b> <img src=x onerror=alert(1)>',
        },
        'https://hub.expdentalsolutions.com/leads/123'
      );

      expect(email.html).not.toContain('<script>alert("xss")</script>');
      expect(email.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(email.html).toContain('&lt;b&gt;Malicious payload&lt;/b&gt;');
      expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });
});
