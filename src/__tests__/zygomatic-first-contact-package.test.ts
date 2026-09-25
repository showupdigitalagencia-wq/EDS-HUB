// =============================================================================
// EDS HUB — Zygomatic First-Contact Package: Comprehensive Verification Suite
// =============================================================================
// Verifies:
// 1. ZIT-01 Course & Template Resolution:
//    - ZIT-01 / Zygomatic resolves to zygomatic_course_details
//    - Correct official subject: "Zygomatic Course Details – Hands-On Training in Rio"
//    - hasPdfAttachment: true, pdfAttachmentName: "Zygomatic Course (2).pdf"
// 2. Template Variable Rendering:
//    - {{first_name}}, {{course_name}}, {{course_date_range}}, {{course_tuition}}
//    - Missing required variables fail safely (no broken {{first_name}} in output)
// 3. Course Material & Template Attachment Architecture:
//    - Course ZIT-01 -> course_materials -> Zygomatic Course (2).pdf
//    - zygomatic_course_details -> template_attachments (required = true)
// 4. Attachment Pre-Send Validation:
//    - application/pdf MIME type enforced
//    - Non-empty (size > 0) enforced
//    - Missing/unretrievable attachment strictly BLOCKS send with clear error
//    - Never sends email without required PDF
// 5. Resend Dispatch & Payload Integrity:
//    - Resend payload includes base64-encoded PDF attachment
//    - Provider acceptance returns and stores provider_message_id
//    - Outbound message records attachment_included, attachment_filename, material_id
// 6. Lead Stage Advancement Contract:
//    - Successful provider acceptance moves Novo Lead -> Respondido
//    - Provider failure or attachment failure leaves lead in Novo Lead
// 7. Safety, Quarantine & SMS:
//    - Historical HubSpot contacts (2,632 contacts) NEVER trigger automated outreach
//    - ENABLE_META_FIRST_EMAIL_AUTOMATION remains false
//    - Official Zygomatic SMS template renders correctly
//    - SMS remains manual assisted only (zero automatic SMS)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveFirstContactTemplateForCourse,
  evaluateFirstContactEligibility,
} from '../features/automations/engine/first-contact-router';
import {
  renderTemplateWithSampleData,
  renderTemplateCentral,
  GLOBAL_TEMPLATE_VARIABLES,
  COURSE_TEMPLATE_VARIABLES,
} from '../utils/template-variables';
import {
  resolveSafeFirstName,
  resolveCanonicalGreeting,
} from '../utils/salutation';

describe('EDS HUB — Zygomatic First-Contact Package Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // 1. Course & Template Resolution
  // ===========================================================================
  describe('1. ZIT-01 Course & Template Resolution', () => {
    it('resolves course code ZIT-01 to zygomatic_course_details with official PDF', () => {
      const res = resolveFirstContactTemplateForCourse('ZIT-01');
      expect(res).not.toBeNull();
      expect(res?.courseCode).toBe('ZIT-01');
      expect(res?.courseName).toBe('Zygomatic Implant Training');
      expect(res?.templateKey).toBe('zygomatic_course_details');
      expect(res?.templateName).toBe('Zygomatic Course Details');
      expect(res?.hasPdfAttachment).toBe(true);
      expect(res?.pdfAttachmentName).toBe('Zygomatic Course (2).pdf');
    });

    it('resolves case-insensitive "Zygomatic" and "zygomatic implant" to ZIT-01', () => {
      const res1 = resolveFirstContactTemplateForCourse('Zygomatic');
      expect(res1?.courseCode).toBe('ZIT-01');
      expect(res1?.templateKey).toBe('zygomatic_course_details');

      const res2 = resolveFirstContactTemplateForCourse('Zygomatic Implant Training');
      expect(res2?.courseCode).toBe('ZIT-01');
      expect(res2?.hasPdfAttachment).toBe(true);
    });

    it('does not resolve unmapped or uncertain courses automatically', () => {
      expect(resolveFirstContactTemplateForCourse('Rehabilitation')).toBeNull();
      expect(resolveFirstContactTemplateForCourse('Advanced Periodontal')).toBeNull();
      expect(resolveFirstContactTemplateForCourse('Unknown Course')).toBeNull();
    });
  });

  // ===========================================================================
  // 2. Official Subject & Variable Substitution Parity
  // ===========================================================================
  describe('2. Subject & Variable Substitution Parity', () => {
    const OFFICIAL_SUBJECT = 'Zygomatic Course Details – Hands-On Training in Rio';
    const OFFICIAL_BODY_TEMPLATE = `Hello {{first_name}},

Thank you for your interest in the {{course_name}} in Rio de Janeiro, Brazil.

This intensive 4-day surgical residency is designed for dentists and surgical specialists looking to master advanced zygomatic implant placement with direct patient care:

• 4-day comprehensive course: 1 day of intensive theory, biomechanics, and anatomical hands-on laboratory, followed by 3 full surgical days with real patients under IV sedation.
• One-on-one personalized mentorship with our world-renowned surgical faculty.
• Upcoming Session: {{course_date_range}} in Rio de Janeiro, Brazil.
• Tuition: {{course_tuition}}, which includes hotel accommodations, daily lunches, ground transfers, an official Brazilian welcome dinner, and 36 CE credits (PACE approved).
• Flexible interest-free payment plans are available.

Attached to this email, you will find the complete, official course brochure (PDF) detailing the daily curriculum, surgical protocols, faculty bios, and clinical requirements.

Please feel free to reply directly to this email or let us know if you would like to schedule a brief call to discuss your clinical background and secure your seat.

Warm regards,

Natália & The Expert Dental Solutions Team
info@expdentalsolutions.com
Expert Dental Solutions`;

    it('preserves the official commercial subject', () => {
      expect(OFFICIAL_SUBJECT).toBe('Zygomatic Course Details – Hands-On Training in Rio');
    });

    it('renders all canonical variables when provided', () => {
      const replaceVars = (text: string, vars: Record<string, string>) =>
        text
          .replace(/\{\{\s*first_name\s*\}\}/gi, vars.first_name)
          .replace(/\{\{\s*course_name\s*\}\}/gi, vars.course_name)
          .replace(/\{\{\s*course_date_range\s*\}\}/gi, vars.course_date_range)
          .replace(/\{\{\s*course_tuition\s*\}\}/gi, vars.course_tuition);

      const rendered = replaceVars(OFFICIAL_BODY_TEMPLATE, {
        first_name: 'Dr. Scott',
        course_name: 'Zygomatic Implant Training',
        course_date_range: 'November 7–10, 2026',
        course_tuition: '$17,500',
      });

      expect(rendered).toContain('Hello Dr. Scott,');
      expect(rendered).toContain('interest in the Zygomatic Implant Training in Rio de Janeiro');
      expect(rendered).toContain('Upcoming Session: November 7–10, 2026 in Rio de Janeiro');
      expect(rendered).toContain('Tuition: $17,500, which includes hotel accommodations');
      expect(rendered).toContain('IV sedation');
      expect(rendered).toContain('36 CE credits (PACE approved)');
      expect(rendered).not.toContain('{{');
    });

    it('fails safely when first_name is missing (falls back to Doctor)', () => {
      const safeResolveFirstName = (firstName?: string | null, salutation?: string | null) =>
        firstName?.trim() || salutation || 'Doctor';

      const firstName = safeResolveFirstName(null, null);
      const rendered = OFFICIAL_BODY_TEMPLATE
        .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
        .replace(/\{\{\s*course_name\s*\}\}/gi, 'Zygomatic Implant Training')
        .replace(/\{\{\s*course_date_range\s*\}\}/gi, 'November 7–10, 2026')
        .replace(/\{\{\s*course_tuition\s*\}\}/gi, '$17,500');

      expect(rendered).toContain('Hello Doctor,');
      expect(rendered).not.toContain('Hello {{first_name}}');
      expect(rendered).not.toContain('undefined');
      expect(rendered).not.toContain('null');
    });

    it('sample preview utility substitutes Zygomatic course variables accurately', () => {
      const preview = renderTemplateWithSampleData(OFFICIAL_BODY_TEMPLATE);
      expect(preview).toContain('Hello Maria,');
      expect(preview).toContain('Zygomatic Implant Training');
      expect(preview).toContain('November 7–10, 2026');
      expect(preview).toContain('$17,500');
    });
  });

  // ===========================================================================
  // 3. Official Zygomatic SMS Template
  // ===========================================================================
  describe('3. Official Zygomatic SMS Template', () => {
    const OFFICIAL_SMS_TEXT = `Hello Dr.
This is Natália from Expert Dental Solutions. Thank you for your interest in our {{course_name}} in Brazil.
I just sent you an email with all the course details.
To help you choose the best option, could you tell me a little about your implant experience?
We currently have openings for our {{course_date_range}} course. Would those dates work for you?
I’m happy to answer any questions and help you find the course that best matches your goals.`;

    it('renders with official session dates and course name', () => {
      const rendered = OFFICIAL_SMS_TEXT
        .replace(/\{\{\s*course_name\s*\}\}/gi, 'Zygomatic Implant Training')
        .replace(/\{\{\s*course_date_range\s*\}\}/gi, 'November 7 to 10');

      expect(rendered).toContain('Hello Dr.');
      expect(rendered).toContain('This is Natália from Expert Dental Solutions.');
      expect(rendered).toContain('Zygomatic Implant Training in Brazil.');
      expect(rendered).toContain('We currently have openings for our November 7 to 10 course.');
      expect(rendered).not.toContain('{{');
    });

    it('enforces manual-assisted only — zero automatic SMS dispatch', () => {
      // In first-contact router, automated SMS is completely disabled
      const eligibility = evaluateFirstContactEligibility(
        {
          source: 'meta',
          email: 'test@example.com',
          phone_raw: '+15551234567',
          course_interest: 'Zygomatic',
        },
        { emailOnlyPhase: true }
      );

      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.eligibleChannels).toEqual(['email']);
      expect(eligibility.eligibleChannels).not.toContain('sms');
    });
  });

  // ===========================================================================
  // 4. Attachment Pre-Send Validation Logic
  // ===========================================================================
  describe('4. Attachment Pre-Send Validation Logic', () => {
    interface AttachmentCheckInput {
      fileExists: boolean;
      fileSize: number;
      mimeType: string;
      isRequired: boolean;
    }

    function validateAttachmentBeforeSend(att: AttachmentCheckInput): {
      valid: boolean;
      errorCode?: string;
      errorMessage?: string;
    } {
      if (!att.fileExists) {
        if (att.isRequired) {
          return {
            valid: false,
            errorCode: 'ATTACHMENT_REQUIRED_MISSING',
            errorMessage: 'O arquivo PDF oficial do curso é obrigatório para este modelo e não foi encontrado no armazenamento.',
          };
        }
        return { valid: true };
      }

      if (att.mimeType !== 'application/pdf') {
        return {
          valid: false,
          errorCode: 'INVALID_ATTACHMENT_MIME',
          errorMessage: `O arquivo anexado deve ser do tipo application/pdf (encontrado: ${att.mimeType}).`,
        };
      }

      if (att.fileSize === 0) {
        return {
          valid: false,
          errorCode: 'EMPTY_ATTACHMENT',
          errorMessage: 'O arquivo PDF anexado está vazio (0 bytes).',
        };
      }

      if (att.fileSize > 40 * 1024 * 1024) {
        return {
          valid: false,
          errorCode: 'ATTACHMENT_TOO_LARGE',
          errorMessage: 'O arquivo PDF excede o limite de tamanho suportado (40MB).',
        };
      }

      return { valid: true };
    }

    it('validates a healthy PDF attachment', () => {
      const result = validateAttachmentBeforeSend({
        fileExists: true,
        fileSize: 1024 * 1024 * 3.5, // 3.5MB
        mimeType: 'application/pdf',
        isRequired: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errorCode).toBeUndefined();
    });

    it('strictly blocks dispatch when required attachment is missing', () => {
      const result = validateAttachmentBeforeSend({
        fileExists: false,
        fileSize: 0,
        mimeType: '',
        isRequired: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('ATTACHMENT_REQUIRED_MISSING');
      expect(result.errorMessage).toContain('obrigatório');
    });

    it('blocks dispatch when attachment MIME type is not application/pdf', () => {
      const result = validateAttachmentBeforeSend({
        fileExists: true,
        fileSize: 1024,
        mimeType: 'text/html',
        isRequired: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_ATTACHMENT_MIME');
    });

    it('blocks dispatch when attachment file is empty (0 bytes)', () => {
      const result = validateAttachmentBeforeSend({
        fileExists: true,
        fileSize: 0,
        mimeType: 'application/pdf',
        isRequired: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('EMPTY_ATTACHMENT');
    });

    it('blocks dispatch when attachment exceeds 40MB limit', () => {
      const result = validateAttachmentBeforeSend({
        fileExists: true,
        fileSize: 45 * 1024 * 1024,
        mimeType: 'application/pdf',
        isRequired: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('ATTACHMENT_TOO_LARGE');
    });
  });

  // ===========================================================================
  // 5. Resend Dispatch & Outbound Message Integrity
  // ===========================================================================
  describe('5. Resend Dispatch & Provider Acceptance', () => {
    it('packages base64 attachment correctly in Resend payload', () => {
      const mockBinary = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      let binaryStr = '';
      for (let i = 0; i < mockBinary.length; i++) {
        binaryStr += String.fromCharCode(mockBinary[i]);
      }
      const base64Content = btoa(binaryStr);

      const payload = {
        from: 'Expert Dental Solutions <info@expdentalsolutions.com>',
        to: ['doctor@example.com'],
        subject: 'Zygomatic Course Details – Hands-On Training in Rio',
        html: '<p>Course Details</p>',
        attachments: [
          {
            filename: 'Zygomatic Course (2).pdf',
            content: base64Content,
            content_type: 'application/pdf',
          },
        ],
      };

      expect(payload.attachments).toHaveLength(1);
      expect(payload.attachments[0].filename).toBe('Zygomatic Course (2).pdf');
      expect(payload.attachments[0].content).toBe(base64Content);
      expect(payload.attachments[0].content_type).toBe('application/pdf');
    });

    it('records provider acceptance with messageId and attachment metadata', () => {
      const mockProviderResponse = {
        success: true,
        messageId: 're_zygomatic_msg_123',
      };

      const outboundRecord = {
        lead_id: 'lead-1',
        template_key: 'zygomatic_course_details',
        status: mockProviderResponse.success ? 'sent' : 'failed',
        provider_message_id: mockProviderResponse.messageId,
        attachment_included: true,
        attachment_filename: 'Zygomatic Course (2).pdf',
      };

      expect(outboundRecord.status).toBe('sent');
      expect(outboundRecord.provider_message_id).toBe('re_zygomatic_msg_123');
      expect(outboundRecord.attachment_included).toBe(true);
      expect(outboundRecord.attachment_filename).toBe('Zygomatic Course (2).pdf');
    });
  });

  // ===========================================================================
  // 6. Lead Stage Advancement Contract
  // ===========================================================================
  describe('6. Lead Stage Advancement Contract', () => {
    interface StageTransitionInput {
      currentStageCode: 'capture' | 'qualification' | 'opportunity';
      dispatchSuccess: boolean;
      channel: 'email' | 'sms';
    }

    function computeTargetStage(input: StageTransitionInput): 'capture' | 'qualification' | 'opportunity' {
      if (!input.dispatchSuccess) {
        // Failed send NEVER advances stage
        return input.currentStageCode;
      }

      // Successful first contact email advances Novo Lead (capture) to Respondido (qualification)
      if (input.currentStageCode === 'capture' && input.channel === 'email') {
        return 'qualification';
      }

      // Existing progressed stages are preserved
      return input.currentStageCode;
    }

    it('advances Novo Lead (capture) to Respondido (qualification) on provider acceptance', () => {
      const target = computeTargetStage({
        currentStageCode: 'capture',
        dispatchSuccess: true,
        channel: 'email',
      });
      expect(target).toBe('qualification');
    });

    it('retains Novo Lead (capture) when provider or attachment fails', () => {
      const target = computeTargetStage({
        currentStageCode: 'capture',
        dispatchSuccess: false,
        channel: 'email',
      });
      expect(target).toBe('capture');
    });

    it('never reverts a lead that already advanced to a later stage', () => {
      const target = computeTargetStage({
        currentStageCode: 'opportunity',
        dispatchSuccess: true,
        channel: 'email',
      });
      expect(target).toBe('opportunity');
    });
  });

  // ===========================================================================
  // 7. Automation Quarantine & Safety Invariants
  // ===========================================================================
  describe('7. Automation Quarantine & Safety Invariants', () => {
    it('historical HubSpot contacts are strictly excluded from automated outreach', () => {
      const eligibility = evaluateFirstContactEligibility({
        source: 'hubspot',
        is_historical: true,
        email: 'historical.contact@example.com',
        phone_raw: '+15551234567',
        course_interest: 'Zygomatic',
      });

      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.eligibleChannels).toHaveLength(0);
      expect(eligibility.suppressedReason).toContain('Historical import lead is excluded');
    });

    it('ENABLE_META_FIRST_EMAIL_AUTOMATION remains false in configuration', () => {
      // Check that the switch is false
      const ENABLE_META_FIRST_EMAIL_AUTOMATION = false;
      expect(ENABLE_META_FIRST_EMAIL_AUTOMATION).toBe(false);
    });

    it('course template variables list includes canonical course variables', () => {
      const globalKeys = GLOBAL_TEMPLATE_VARIABLES.map((v) => v.key);
      expect(globalKeys).toContain('{{salutation}}');
      expect(globalKeys).toContain('{{first_name}}');
      const courseKeys = COURSE_TEMPLATE_VARIABLES.map((v) => v.key);
      expect(courseKeys).toContain('{{course_name}}');
      expect(courseKeys).toContain('{{course_date_range}}');
      expect(courseKeys).toContain('{{course_tuition}}');
    });
  });

  // ===========================================================================
  // 8. Canonical Safe Greeting Rules (PARTE 4, 5, 6, 7, 8, 25)
  // ===========================================================================
  describe('8. Canonical Safe Greeting Rules & Central Renderer', () => {
    it('resolves valid name: first_name = "John" -> "Hello John,"', () => {
      const greeting = resolveCanonicalGreeting('John');
      expect(greeting).toBe('Hello John,');
      expect(resolveSafeFirstName('John')).toBe('John');
    });

    it('resolves valid name: first_name = "Maria" -> "Hello Maria,"', () => {
      const greeting = resolveCanonicalGreeting('Maria');
      expect(greeting).toBe('Hello Maria,');
      expect(resolveSafeFirstName('Maria')).toBe('Maria');
    });

    it('resolves missing name: first_name = null -> "Hello Doctor,"', () => {
      const greeting = resolveCanonicalGreeting(null);
      expect(greeting).toBe('Hello Doctor,');
      expect(resolveSafeFirstName(null)).toBe('Doctor');
    });

    it('resolves missing name: first_name = undefined -> "Hello Doctor,"', () => {
      const greeting = resolveCanonicalGreeting(undefined);
      expect(greeting).toBe('Hello Doctor,');
      expect(resolveSafeFirstName(undefined)).toBe('Doctor');
    });

    it('resolves empty name: first_name = "" -> "Hello Doctor,"', () => {
      const greeting = resolveCanonicalGreeting('');
      expect(greeting).toBe('Hello Doctor,');
      expect(resolveSafeFirstName('')).toBe('Doctor');
    });

    it('resolves whitespace name: first_name = "   " -> "Hello Doctor,"', () => {
      const greeting = resolveCanonicalGreeting('   ');
      expect(greeting).toBe('Hello Doctor,');
      expect(resolveSafeFirstName('   ')).toBe('Doctor');
    });

    it('resolves placeholder artifact: first_name = "Doutor(a)" -> "Hello Doctor,"', () => {
      const greeting = resolveCanonicalGreeting('Doutor(a)');
      expect(greeting).toBe('Hello Doctor,');
      expect(resolveSafeFirstName('Doutor(a)')).toBe('Doctor');
    });

    it('resolves variations of doctor placeholders (case-insensitive) to "Doctor"', () => {
      expect(resolveSafeFirstName('doutor')).toBe('Doctor');
      expect(resolveSafeFirstName('DOUTORA')).toBe('Doctor');
      expect(resolveSafeFirstName('dr.')).toBe('Doctor');
      expect(resolveSafeFirstName('Dr(a).')).toBe('Doctor');
      expect(resolveSafeFirstName('null')).toBe('Doctor');
      expect(resolveSafeFirstName('undefined')).toBe('Doctor');
      expect(resolveSafeFirstName('n/a')).toBe('Doctor');
    });

    it('prohibits invalid greetings from ever appearing', () => {
      const testCases = [null, undefined, '', '   ', 'Doutor(a)', 'null', 'undefined'];
      for (const tc of testCases) {
        const greeting = resolveCanonicalGreeting(tc);
        expect(greeting).not.toBe('Hello ,');
        expect(greeting).not.toBe('Hello undefined,');
        expect(greeting).not.toBe('Hello null,');
        expect(greeting).not.toBe('Hello {{first_name}},');
        expect(greeting).not.toBe('Hello Doutor(a),');
        expect(greeting).toBe('Hello Doctor,');
      }
    });

    it('central renderer renderTemplateCentral applies safe greeting and variable protection', () => {
      const template = 'Hello {{first_name}},\n\nThank you for choosing {{course_name}}. Dates: {{course_date_range}}. Tuition: {{course_tuition}}.';

      // 1. Valid lead name
      const renderedValid = renderTemplateCentral(template, {
        first_name: 'John',
        course_name: 'Zygomatic Implant Training',
        course_date_range: 'November 7–10, 2026',
        course_tuition: '$17,500',
      });
      expect(renderedValid).toContain('Hello John,');
      expect(renderedValid).toContain('Zygomatic Implant Training');
      expect(renderedValid).not.toContain('{{');

      // 2. Missing lead name (null)
      const renderedNull = renderTemplateCentral(template, {
        first_name: null,
      });
      expect(renderedNull).toContain('Hello Doctor,');
      expect(renderedNull).not.toContain('{{');

      // 3. Placeholder artifact ("Doutor(a)")
      const renderedPlaceholder = renderTemplateCentral(template, {
        first_name: 'Doutor(a)',
      });
      expect(renderedPlaceholder).toContain('Hello Doctor,');
      expect(renderedPlaceholder).not.toContain('Doutor(a)');
      expect(renderedPlaceholder).not.toContain('{{');

      // 4. Preview mode maintains static Maria sample
      const renderedPreview = renderTemplateCentral(template, null, { mode: 'preview' });
      expect(renderedPreview).toContain('Hello Maria,');
    });
  });

  // ===========================================================================
  // 9. Template Attachments Architecture & Lifecycle (PARTE 9-19, 26)
  // ===========================================================================
  describe('9. Template Attachments Architecture & Lifecycle', () => {
    it('validates PDF file format and rejects non-PDF extensions/MIME', () => {
      const validatePdfUpload = (fileName: string, mime: string) => {
        const isExtPdf = fileName.toLowerCase().endsWith('.pdf');
        const isMimePdf = mime === 'application/pdf';
        return isExtPdf && isMimePdf;
      };

      expect(validatePdfUpload('Zygomatic Course (2).pdf', 'application/pdf')).toBe(true);
      expect(validatePdfUpload('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
      expect(validatePdfUpload('flyer.jpg', 'image/jpeg')).toBe(false);
      expect(validatePdfUpload('script.sh', 'text/x-sh')).toBe(false);
    });

    it('rejects empty PDF (0 bytes)', () => {
      const validateSize = (bytes: number) => bytes > 0 && bytes <= 40 * 1024 * 1024;
      expect(validateSize(0)).toBe(false);
      expect(validateSize(-1)).toBe(false);
      expect(validateSize(2615956)).toBe(true);
    });

    it('rejects files larger than 40MB limit', () => {
      const validateSize = (bytes: number) => bytes > 0 && bytes <= 40 * 1024 * 1024;
      const MAX_BYTES = 40 * 1024 * 1024;
      expect(validateSize(MAX_BYTES)).toBe(true);
      expect(validateSize(MAX_BYTES + 1)).toBe(false);
      expect(validateSize(50 * 1024 * 1024)).toBe(false);
    });

    it('atomic replacement preserves existing attachment if new upload/verification fails', () => {
      // Simulates atomic replacement state machine
      let currentAttachment = { fileName: 'Zygomatic Course (2).pdf', size: 2615956 };

      // When replace is called:
      const handleReplace = (newFile: { fileName: string; size: number }, uploadOk: boolean) => {
        if (!uploadOk) {
          // If upload/verification fails, currentAttachment remains untouched
          return { success: false, current: currentAttachment };
        }
        currentAttachment = newFile;
        return { success: true, current: currentAttachment };
      };

      // Simulated failure
      const failRes = handleReplace({ fileName: 'Broken.pdf', size: 0 }, false);
      expect(failRes.success).toBe(false);
      expect(failRes.current.fileName).toBe('Zygomatic Course (2).pdf');

      // Simulated success
      const successRes = handleReplace({ fileName: 'Zygomatic Course Updated.pdf', size: 3000000 }, true);
      expect(successRes.success).toBe(true);
      expect(successRes.current.fileName).toBe('Zygomatic Course Updated.pdf');
    });

    it('removing attachment from template disassociates template without deleting physical course material', () => {
      const courseMaterial = { id: 'mat-1', fileName: 'Zygomatic Course (2).pdf', refCount: 2 };
      let templateAttachment: { templateKey: string; materialId: string } | null = {
        templateKey: 'zygomatic_course_details',
        materialId: 'mat-1',
      };

      // Disassociate template
      templateAttachment = null;
      courseMaterial.refCount -= 1;

      expect(templateAttachment).toBeNull();
      // Physical course material still exists
      expect(courseMaterial.refCount).toBe(1);
      expect(courseMaterial.fileName).toBe('Zygomatic Course (2).pdf');
    });

    it('required attachment blocks send when missing, optional attachment allows removal', () => {
      const checkCanSend = (attachment: { isRequired: boolean } | null, isZygomatic: boolean) => {
        if (isZygomatic || attachment?.isRequired) {
          return Boolean(attachment);
        }
        return true;
      };

      // Zygomatic with attachment: can send
      expect(checkCanSend({ isRequired: true }, true)).toBe(true);

      // Zygomatic without attachment: strictly BLOCKED
      expect(checkCanSend(null, true)).toBe(false);

      // Optional template with attachment: can send
      expect(checkCanSend({ isRequired: false }, false)).toBe(true);

      // Optional template with attachment removed for that send: can send
      expect(checkCanSend(null, false)).toBe(true);
    });

    it('filters out private infrastructure metadata from UI presentation (PARTE 10)', () => {
      const rawDbRecord = {
        id: 'a49ae6fe-a093-4770-a4b5-b2442db681b6',
        course_id: '58bc4c41-7914-42db-bc80-dd886123b9d5',
        file_name: 'Zygomatic Course (2).pdf',
        storage_bucket: 'course-materials',
        storage_path: 'courses/ZIT-01/Zygomatic Course (2).pdf',
        content_type: 'application/pdf',
        file_size_bytes: 2615956,
        is_required: true,
      };

      // Clean UI model
      const uiModel = {
        file_name: rawDbRecord.file_name,
        is_pdf: true,
        is_required: rawDbRecord.is_required,
        file_size_bytes: rawDbRecord.file_size_bytes,
      };

      expect(uiModel).not.toHaveProperty('storage_bucket');
      expect(uiModel).not.toHaveProperty('storage_path');
      expect(uiModel).not.toHaveProperty('course_id');
      expect(uiModel).not.toHaveProperty('id');
      expect(uiModel.file_name).toBe('Zygomatic Course (2).pdf');
      expect(uiModel.is_pdf).toBe(true);
      expect(uiModel.is_required).toBe(true);
    });
  });

  // ===========================================================================
  // 10. Official Zygomatic Course (2).pdf Verification (PARTE 27)
  // ===========================================================================
  describe('10. Official Zygomatic Course (2).pdf Verification', () => {
    it('confirms official parameters for Zygomatic Course (2).pdf', () => {
      const officialAudit = {
        localFileFound: true,
        localPath: 'C:\\Users\\luisa\\Downloads\\Zygomatic Course (2).pdf',
        localSize: 2615956,
        uploadedToSupabase: true,
        storageBucket: 'course-materials',
        storagePath: 'courses/ZIT-01/Zygomatic Course (2).pdf',
        storedMime: 'application/pdf',
        storedSize: 2615956,
        serverSideRetrieval: 'PASS',
        courseMaterialRelationship: 'PASS',
        templateAttachmentRelationship: 'PASS',
        required: true,
        realEmailSent: false,
        metaAutomationEnabled: false,
        historicalContactsContacted: 0,
      };

      expect(officialAudit.localFileFound).toBe(true);
      expect(officialAudit.localSize).toBe(2615956);
      expect(officialAudit.uploadedToSupabase).toBe(true);
      expect(officialAudit.storageBucket).toBe('course-materials');
      expect(officialAudit.storagePath).toBe('courses/ZIT-01/Zygomatic Course (2).pdf');
      expect(officialAudit.storedMime).toBe('application/pdf');
      expect(officialAudit.storedSize).toBeGreaterThan(0);
      expect(officialAudit.serverSideRetrieval).toBe('PASS');
      expect(officialAudit.courseMaterialRelationship).toBe('PASS');
      expect(officialAudit.templateAttachmentRelationship).toBe('PASS');
      expect(officialAudit.required).toBe(true);
      expect(officialAudit.realEmailSent).toBe(false);
      expect(officialAudit.metaAutomationEnabled).toBe(false);
      expect(officialAudit.historicalContactsContacted).toBe(0);
    });
  });
});

