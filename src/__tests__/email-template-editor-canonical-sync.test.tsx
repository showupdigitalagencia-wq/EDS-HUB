import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TemplateEditorModal } from '../features/templates/components/TemplateEditorModal';
import { TemplatePreviewModal } from '../features/templates/components/TemplatePreviewModal';
import {
  sanitizeRichText,
  htmlToPlainText,
} from '../utils/rich-text-sanitizer';
import {
  APPROVED_COURSE_TEMPLATES,
  resolveApprovedCourseTemplateKey,
  resolveDoctorSalutation,
  resolveDoctorGreeting,
} from '../utils/salutation';
import type { EmailTemplate } from '../types';

// Mock Supabase with vi.hoisted to prevent hoisting error
const { mockUpdate, mockEq, mockInsert, mockSelect, mockInvoke } = vi.hoisted(() => ({
  mockUpdate: vi.fn().mockReturnThis(),
  mockEq: vi.fn().mockResolvedValue({ error: null }),
  mockInsert: vi.fn().mockResolvedValue({ error: null }),
  mockSelect: vi.fn().mockReturnThis(),
  mockInvoke: vi.fn().mockResolvedValue({
    data: {
      has_attachment: true,
      attachment: {
        file_name: 'Third molar course.pdf',
        display_name: 'Third molar course.pdf',
        is_required: true,
        file_size_bytes: 102400,
        is_pdf: true,
      },
    },
    error: null,
  }),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
    })),
    functions: {
      invoke: mockInvoke,
    },
  },
}));

vi.mock('../features/templates/services/template-usage-service', () => ({
  getTemplateUsage: vi.fn().mockResolvedValue({
    totalCount: 0,
    campaigns: [],
    automations: [],
    sequences: [],
  }),
}));

describe('Email Template Editor Canonical Sync & Rich-Text Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Mock Wisdom Teeth template as seeded in DB
  const wisdomTemplateFromDb: EmailTemplate = {
    id: 'tpl-wisdom-123',
    name: 'Wisdom',
    description: 'Official first-contact email for Wisdom course',
    category: 'course_details',
    template_key: 'wisdom_course_details',
    has_attachment: true,
    attachment_name: 'Third molar course.pdf',
    is_active: true,
    created_by_user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content_json: {
      channel: 'email',
      subject: 'Wisdom Surgery Details – Hands-On Training in Rio',
      has_attachment: true,
      attachment_name: 'Third molar course.pdf',
      template_key: 'wisdom_course_details',
    },
    html_template: `
      <p>Hello Dr. {{salutation}}</p>
      <p>Thank you for your interest in our <b>Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!</b></p>
      <p>This is a <b>4-day intensive clinical course with real patients</b>, designed to give you extensive surgical experience with <b>one-on-one mentorship throughout the entire course.</b></p>
      <p><b>REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON</b></p>
      <p>During the course, you will:</p>
      <p>• <b>Perform at least 16 wisdom teeth extractions on real patients</b><br/>
      • Work with <b>fully impacted, partially impacted, and erupted wisdom teeth</b><br/>
      • Be the <b>main surgeon from start to finish</b> during all your procedures</p>
    `,
    text_template: `Hello Dr. {{salutation}}

Thank you for your interest in our Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!

This is a 4-day intensive clinical course with real patients.`,
  };

  // ---------------------------------------------------------------------------
  // 1. HYDRATION: Editor opens with real content, no empty state
  // ---------------------------------------------------------------------------
  describe('1. Hydration & Canonical Content Loading', () => {
    it('hydrates Wisdom Teeth template with real approved body, avoiding empty state', () => {
      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={vi.fn()}
          editingTemplate={wisdomTemplateFromDb}
          onSaveSuccess={vi.fn()}
        />
      );

      // Verify the subject input contains the real subject
      const subjectInput = screen.getByPlaceholderText(/atualização importante/i) as HTMLInputElement;
      expect(subjectInput.value).toBe('Wisdom Surgery Details – Hands-On Training in Rio');

      // Verify the body area does NOT show empty state
      expect(screen.queryByText('Nenhum conteúdo no corpo do email.')).toBeNull();

      // Verify real copy from html_template is present in the editor
      expect(screen.getByText(/Wisdom Teeth Extraction Course/i)).toBeDefined();
      expect(screen.getByText(/4-day intensive clinical course/i)).toBeDefined();
    });

    it('hydrates subject and body for all 6 active course templates without empty state', () => {
      const activeKeys = [
        'zygomatic_course_details',
        'periodontal_course_details',
        'endodontic_course_details',
        'implant_course_details',
        'wisdom_course_details',
        'rehabilitation_course_details',
      ];

      for (const key of activeKeys) {
        const pkg = APPROVED_COURSE_TEMPLATES[key];
        expect(pkg).toBeDefined();

        const tpl: EmailTemplate = {
          id: `tpl-${key}`,
          name: pkg.displayName,
          description: null,
          category: 'course_details',
          template_key: key,
          has_attachment: true,
          attachment_name: pkg.attachmentNames[0],
          is_active: true,
          created_by_user_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          content_json: { channel: 'email', subject: pkg.subject, template_key: key },
          html_template: pkg.getHtml('Dr. {{salutation}}'),
          text_template: pkg.getText('Dr. {{salutation}}'),
        };

        const { unmount } = render(
          <TemplateEditorModal
            isOpen={true}
            onClose={vi.fn()}
            editingTemplate={tpl}
            onSaveSuccess={vi.fn()}
          />
        );

        // Subject hydrated
        const subjectInput = screen.getByPlaceholderText(/atualização importante/i) as HTMLInputElement;
        expect(subjectInput.value).toBe(pkg.subject);

        // Body NOT empty
        expect(screen.queryByText('Nenhum conteúdo no corpo do email.')).toBeNull();

        unmount();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. RICH TEXT PASTE & FORMATTING PRESERVATION
  // ---------------------------------------------------------------------------
  describe('2. Rich Text Paste & Semantic Preservation', () => {
    it('preserves bold, italic, underline, lists, and links on paste sanitization', () => {
      const pastedCopy = `
        <p><strong>Hello Doctor,</strong></p>
        <p>Thank you for your interest in our <em>Wisdom Teeth</em> course.</p>
        <p>You will have:</p>
        <ul>
          <li>Hands-on training</li>
          <li><u>Real patients</u></li>
          <li>Individual guidance</li>
        </ul>
        <p>Visit us at <a href="https://expdentalsolutions.com">EDS Website</a></p>
      `;

      const sanitized = sanitizeRichText(pastedCopy);

      expect(sanitized).toContain('<strong>Hello Doctor,</strong>');
      expect(sanitized).toContain('<em>Wisdom Teeth</em>');
      expect(sanitized).toContain('<u>Real patients</u>');
      expect(sanitized).toContain('<ul>');
      expect(sanitized).toContain('<li>Hands-on training</li>');
      expect(sanitized).toContain('<a href="https://expdentalsolutions.com" target="_blank" rel="noopener noreferrer">EDS Website</a>');
    });

    it('generates clean plain-text fallback matching readable format', () => {
      const richHtml = '<strong>Hello Doctor</strong><br><br><ul><li>Real patients</li><li>Hands-on training</li></ul>';
      const plain = htmlToPlainText(richHtml);

      expect(plain).toBe('Hello Doctor\n\n• Real patients\n• Hands-on training');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. SECURITY & XSS PROTECTION
  // ---------------------------------------------------------------------------
  describe('3. XSS Protection', () => {
    it('strips <script>, onerror, javascript: hrefs, and malicious styles', () => {
      const dangerous = `
        <p>Valid text</p>
        <script>alert(1)</script>
        <img src=x onerror=alert(1)>
        <a href="javascript:alert(1)">Dangerous Link</a>
        <div style="background-image: url(javascript:alert(1));">Styled div</div>
      `;

      const clean = sanitizeRichText(dangerous);

      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('alert(1)');
      expect(clean).not.toContain('onerror');
      expect(clean).not.toContain('javascript:');
      expect(clean).toContain('Valid text');
      expect(clean).toContain('Dangerous Link');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. PERSONALIZATION & GREETING RULES
  // ---------------------------------------------------------------------------
  describe('4. Personalization & Greeting Rules', () => {
    it('preserves placeholders inside formatted text', () => {
      const richInput = '<p><strong>Hello Dr. {{last_name}},</strong></p>';
      const clean = sanitizeRichText(richInput);
      expect(clean).toBe('<p><strong>Hello Dr. {{last_name}},</strong></p>');
    });

    it('enforces greeting business rules: reliable full name vs single/unreliable name', () => {
      // Reliable full name -> Dr. [LastName]
      expect(resolveDoctorSalutation('Hello', { first_name: 'John', last_name: 'Smith' })).toBe('Hello Dr. Smith');
      expect(resolveDoctorGreeting({ first_name: 'John', last_name: 'Smith' })).toBe('Hello Dr. Smith,');

      // Single name -> Hello Doctor
      expect(resolveDoctorSalutation('Hello', { first_name: 'Jamal' })).toBe('Hello Doctor');
      expect(resolveDoctorGreeting({ first_name: 'Jamal' })).toBe('Hello Doctor,');

      // Unreliable placeholder -> Hello Doctor
      expect(resolveDoctorSalutation('Hello', { first_name: 'Doutor(a)', last_name: 'Doutor' })).toBe('Hello Doctor');
      expect(resolveDoctorGreeting({ first_name: 'Doutor(a)' })).toBe('Hello Doctor,');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. FUNCTIONAL SAVE & CANONICAL DB PERSISTENCE
  // ---------------------------------------------------------------------------
  describe('5. Functional Save Updates Canonical Record', () => {
    it('saves updated content into email_templates table preserving blocks and html', async () => {
      const onSaveSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={onClose}
          editingTemplate={wisdomTemplateFromDb}
          onSaveSuccess={onSaveSuccess}
        />
      );

      // Click Salvar Template
      const saveBtn = screen.getByRole('button', { name: /salvar template/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });

      // Verify update payload sent to supabase.from('email_templates').update(...)
      const updateCallArgs = mockUpdate.mock.calls[0][0];
      expect(updateCallArgs.name).toBe('Wisdom');
      expect(updateCallArgs.template_key).toBe('wisdom_course_details');
      expect(updateCallArgs.content_json.blocks.length).toBeGreaterThan(0);
      expect(updateCallArgs.html_template).toContain('Wisdom Teeth');
      expect(updateCallArgs.has_attachment).toBe(true);
      expect(updateCallArgs.attachment_name).toBe('Third molar course.pdf');

      expect(onSaveSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. PREVIEW MATCHES SEND CONTENT
  // ---------------------------------------------------------------------------
  describe('6. Preview Mode Parity', () => {
    it('renders saved canonical html in TemplatePreviewModal', () => {
      const customHtmlTemplate: EmailTemplate = {
        ...wisdomTemplateFromDb,
        html_template: '<p>Custom Edited Copy for Wisdom Course</p>',
      };

      render(
        <TemplatePreviewModal
          isOpen={true}
          onClose={vi.fn()}
          template={customHtmlTemplate}
        />
      );

      expect(screen.getByTitle('Email Preview')).toBeDefined();
      const iframe = screen.getByTitle('Email Preview') as HTMLIFrameElement;
      const srcDocContent = iframe.getAttribute('srcdoc') || (iframe as any).srcdoc || '';
      expect(srcDocContent).toContain('Custom Edited Copy for Wisdom Course');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. COURSE MAPPING & ATTACHMENTS PRESERVATION
  // ---------------------------------------------------------------------------
  describe('7. Course Mapping & Attachment Safeguards', () => {
    it('maps courses factually to approved template keys without generic fallback', () => {
      expect(resolveApprovedCourseTemplateKey('Wisdom')).toBe('wisdom_course_details');
      expect(resolveApprovedCourseTemplateKey('Third Molar Extraction')).toBe('wisdom_course_details');
      expect(resolveApprovedCourseTemplateKey('Zygomatic')).toBe('zygomatic_course_details');
      expect(resolveApprovedCourseTemplateKey('Periodontal Plastic')).toBe('periodontal_course_details');
      expect(resolveApprovedCourseTemplateKey('Endodontic Training')).toBe('endodontic_course_details');
      expect(resolveApprovedCourseTemplateKey('Intensive Implant')).toBe('implant_course_details');
      expect(resolveApprovedCourseTemplateKey('Rehabilitation')).toBe('rehabilitation_course_details');

      // Ambiguous / unmapped course strictly returns null (no generic fallback)
      expect(resolveApprovedCourseTemplateKey('Unknown Random Course')).toBeNull();
      expect(resolveApprovedCourseTemplateKey('')).toBeNull();
      expect(resolveApprovedCourseTemplateKey(null)).toBeNull();
    });

    it('preserves required attachment relation and flags', () => {
      const wisdomPkg = APPROVED_COURSE_TEMPLATES['wisdom_course_details'];
      expect(wisdomPkg.attachmentNames).toContain('Third molar course.pdf');
    });
  });
});
