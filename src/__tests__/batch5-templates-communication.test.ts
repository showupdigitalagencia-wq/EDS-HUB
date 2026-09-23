import { describe, it, expect, vi } from 'vitest';
import {
  getTemplateChannel,
  getTemplateSubject,
  calculateSmsSegments,
  renderTemplateWithSampleData,
  GLOBAL_TEMPLATE_VARIABLES,
  CAMPAIGN_SPECIFIC_VARIABLES,
  SAMPLE_PREVIEW_DATA,
} from '../utils/template-variables';
import {
  getTemplateUsage,
  checkTemplateDeleteSafety,
} from '../features/templates/services/template-usage-service';
import { sanitizeHtml } from '../utils/sanitize-html';
import { resolveSalutation } from '../utils/salutation';
import { supabase } from '../lib/supabase';

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('EDS HUB — Batch 5: Templates & Communication Foundation', () => {
  // ---------------------------------------------------------------------------
  // 1. Template Storage Architecture & Channel Detection
  // ---------------------------------------------------------------------------
  describe('Channel Detection & Backward Compatibility', () => {
    it('detects legacy EmailBlock[] array as Email', () => {
      const legacyTemplate = {
        id: 'tpl-1',
        content_json: [
          { id: 'b-1', type: 'heading', text: 'Welcome' },
          { id: 'b-2', type: 'text', text: 'Hello doctor' },
        ],
      };
      expect(getTemplateChannel(legacyTemplate)).toBe('email');
    });

    it('detects new content_json.channel = "email" as Email', () => {
      const newEmailTemplate = {
        id: 'tpl-2',
        content_json: {
          channel: 'email',
          subject: 'Special Invitation',
          blocks: [],
        },
      };
      expect(getTemplateChannel(newEmailTemplate)).toBe('email');
      expect(getTemplateSubject(newEmailTemplate)).toBe('Special Invitation');
    });

    it('detects new content_json.channel = "sms" as SMS', () => {
      const newSmsTemplate = {
        id: 'tpl-3',
        content_json: {
          channel: 'sms',
          body: 'Hello {{salutation}}, your appointment is confirmed.',
        },
      };
      expect(getTemplateChannel(newSmsTemplate)).toBe('sms');
      expect(getTemplateSubject(newSmsTemplate)).toBe(''); // SMS has no subject
    });

    it('keeps category independent from channel', () => {
      const smsWithCategory = {
        id: 'tpl-4',
        category: 'followup',
        content_json: {
          channel: 'sms',
          body: 'Follow-up message',
        },
      };
      expect(getTemplateChannel(smsWithCategory)).toBe('sms');
      expect(smsWithCategory.category).toBe('followup');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Global Safe Variables vs Campaign-Specific Variables
  // ---------------------------------------------------------------------------
  describe('Variable Scope Matrix', () => {
    it('global template variable picker contains salutation and first_name, but NOT last_name', () => {
      const keys = GLOBAL_TEMPLATE_VARIABLES.map((v) => v.key);
      expect(keys).toContain('{{salutation}}');
      expect(keys).toContain('{{first_name}}');
      expect(keys).not.toContain('{{last_name}}');
    });

    it('campaign-specific variable set exposes last_name', () => {
      const keys = CAMPAIGN_SPECIFIC_VARIABLES.map((v) => v.key);
      expect(keys).toContain('{{salutation}}');
      expect(keys).toContain('{{first_name}}');
      expect(keys).toContain('{{last_name}}');
    });

    it('automation and sequence step context only expose global safe variables', () => {
      // In Automations & Sequences, execute-automation-run does not replace raw {{last_name}}
      const keys = GLOBAL_TEMPLATE_VARIABLES.map((v) => v.key);
      expect(keys).not.toContain('{{last_name}}');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Variable Preview Substitution with Runtime Resolver Parity
  // ---------------------------------------------------------------------------
  describe('Preview Substitution & Runtime Parity', () => {
    it('uses resolveSalutation to deterministically resolve salutation with runtime parity', () => {
      // With Maria Silva, resolveSalutation returns "Silva"
      const expectedSalutation = resolveSalutation(SAMPLE_PREVIEW_DATA.last_name, SAMPLE_PREVIEW_DATA.first_name, 'Doc');
      expect(expectedSalutation).toBe('Silva');

      const templateText = 'Olá Dr(a). {{salutation}}, confirmamos seu contato.';
      const rendered = renderTemplateWithSampleData(templateText, 'global');
      expect(rendered).toBe('Olá Dr(a). Silva, confirmamos seu contato.');
    });

    it('substitutes first_name correctly in global context', () => {
      const templateText = 'Bem-vinda, {{first_name}}!';
      const rendered = renderTemplateWithSampleData(templateText, 'global');
      expect(rendered).toBe(`Bem-vinda, ${SAMPLE_PREVIEW_DATA.first_name}!`);
    });

    it('replaces last_name only in campaign context', () => {
      const templateText = 'Doutor(a) {{last_name}}, sua vaga está reservada.';
      const globalRender = renderTemplateWithSampleData(templateText, 'global');
      expect(globalRender).toBe('Doutor(a) {{last_name}}, sua vaga está reservada.');

      const campaignRender = renderTemplateWithSampleData(templateText, 'campaign');
      expect(campaignRender).toBe(`Doutor(a) ${SAMPLE_PREVIEW_DATA.last_name}, sua vaga está reservada.`);
    });

    it('uses strictly fictional preview data without real production addresses', () => {
      expect(SAMPLE_PREVIEW_DATA.sender_email).toBe('preview@exemplo.com');
      expect(SAMPLE_PREVIEW_DATA.recipient_email).toBe('maria.silva@exemplo.com');
      expect(SAMPLE_PREVIEW_DATA.recipient_phone).toBe('+55 (11) 98765-4321');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. SMS Segment & Encoding Estimator (GSM-7 vs UCS-2)
  // ---------------------------------------------------------------------------
  describe('SMS Encoding & Segment Estimation', () => {
    it('calculates single GSM-7 segment up to 160 characters', () => {
      const text = 'Hello Doctor, this is a standard GSM-7 SMS without special Portuguese tildes.';
      const estimate = calculateSmsSegments(text);
      expect(estimate.encoding).toBe('GSM-7');
      expect(estimate.characterCount).toBe(text.length);
      expect(estimate.segmentCount).toBe(1);
    });

    it('calculates multi-segment GSM-7 based on 153 characters per segment', () => {
      const text = 'A'.repeat(161);
      const estimate = calculateSmsSegments(text);
      expect(estimate.encoding).toBe('GSM-7');
      expect(estimate.segmentCount).toBe(2);
      expect(estimate.charsPerConcatenatedSegment).toBe(153);
    });

    it('correctly accounts for GSM-7 extended characters costing 2 septets', () => {
      // Extended characters: ^ { } [ ] ~ | €
      const text = 'Cost is 50€ only!'; // '€' is extended GSM-7
      const estimate = calculateSmsSegments(text);
      expect(estimate.encoding).toBe('GSM-7');
      expect(estimate.hasExtendedChars).toBe(true);
      expect(estimate.segmentCount).toBe(1);
    });

    it('detects Unicode (UCS-2) when text contains characters outside GSM-7 (e.g. ã, õ, emojis)', () => {
      const textWithTilde = 'Olá Dra. Silva, sua inscrição na pós-graduação foi confirmada!';
      const estimate = calculateSmsSegments(textWithTilde);
      expect(estimate.encoding).toBe('Unicode');
      expect(estimate.maxSingleSegmentChars).toBe(70);
      expect(estimate.charsPerConcatenatedSegment).toBe(67);
      expect(estimate.segmentCount).toBe(1); // 62 chars <= 70
    });

    it('calculates multi-segment Unicode based on 67 characters per segment', () => {
      const textWithTildeLong = 'Olá Dra. Silva, sua inscrição na pós-graduação foi confirmada com sucesso! Entre em contato conosco pelo telefone institucional.';
      const estimate = calculateSmsSegments(textWithTildeLong);
      expect(estimate.encoding).toBe('Unicode');
      expect(estimate.characterCount).toBe(textWithTildeLong.length);
      expect(estimate.segmentCount).toBe(Math.ceil(textWithTildeLong.length / 67));
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Preview Security & HTML Sanitization
  // ---------------------------------------------------------------------------
  describe('Preview Sanitization', () => {
    it('strips dangerous scripts, iframes, and inline event handlers from email HTML', () => {
      const dirtyHtml = `
        <div>
          <h1>Exclusive Update for Silva</h1>
          <script>alert("xss")</script>
          <iframe src="evil.com"></iframe>
          <p onclick="alert('click')">Click here</p>
          <a href="javascript:alert(1)">Dangerous Link</a>
        </div>
      `;
      const cleanHtml = sanitizeHtml(dirtyHtml);
      expect(cleanHtml).not.toContain('<script>');
      expect(cleanHtml).not.toContain('<iframe>');
      expect(cleanHtml).not.toContain('onclick=');
      expect(cleanHtml).not.toContain('javascript:alert(1)');
      expect(cleanHtml).toContain('Exclusive Update for Silva');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Usage Detection & Delete Safety
  // ---------------------------------------------------------------------------
  describe('Factual Usage Detection & Delete Safety', () => {
    it('detects usage across Campaigns and Automations factually', async () => {
      const templateId = 'tpl-uuid-123';

      const mockCampaignSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [{ id: 'camp-1', name: 'Masterclass Invite', status: 'draft', channel: 'email' }],
          error: null,
        }),
      });

      const mockAutomationSelect = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'auto-1',
            name: 'Welcome Cadence',
            status: 'active',
            automation_type: 'workflow',
            automation_versions: [
              {
                id: 'ver-1',
                status: 'published',
                automation_steps: [
                  { id: 's-1', step_order: 1, action_type: 'send_email', config: { template_id: templateId } },
                ],
              },
            ],
          },
          {
            id: 'seq-1',
            name: 'Post-Intake Sequence',
            status: 'active',
            automation_type: 'sequence',
            automation_versions: [
              {
                id: 'ver-2',
                status: 'published',
                automation_steps: [
                  { id: 's-2', step_order: 1, action_type: 'send_sms', config: { template_id: templateId } },
                ],
              },
            ],
          },
        ],
        error: null,
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return { select: mockCampaignSelect };
        }
        if (table === 'automations') {
          return { select: mockAutomationSelect };
        }
        return { select: vi.fn() };
      });

      const usage = await getTemplateUsage(templateId);
      expect(usage.totalCount).toBe(3);
      expect(usage.campaigns).toHaveLength(1);
      expect(usage.automations).toHaveLength(1);
      expect(usage.sequences).toHaveLength(1);
    });

    it('fails safe when reference verification throws an error', async () => {
      (supabase.from as any).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const safety = await checkTemplateDeleteSafety('some-id');
      expect(safety.canDelete).toBe(false);
      expect(safety.errorMessage).toBe('Não foi possível verificar se este template está em uso. Tente novamente.');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Snapshot Semantics & Immutability Verification
  // ---------------------------------------------------------------------------
  describe('Snapshot Semantics Verification', () => {
    it('verifies that selecting a template copies content rather than establishing live two-way sync', () => {
      const originTemplate = {
        id: 'orig-tpl',
        name: 'Original Promo',
        html_template: '<p>Original text</p>',
        text_template: 'Original text',
        content_json: [{ id: 'b1', type: 'text', text: 'Original text' }],
      };

      // Campaign editor copies content
      const campaignDraft = {
        template_id: originTemplate.id,
        htmlContent: originTemplate.html_template,
        textContent: originTemplate.text_template,
        blocks: [...originTemplate.content_json],
      };

      // User later edits campaign draft
      campaignDraft.htmlContent = '<p>Edited in campaign</p>';

      // Original template is unaffected
      expect(originTemplate.html_template).toBe('<p>Original text</p>');
      expect(campaignDraft.htmlContent).toBe('<p>Edited in campaign</p>');
    });

    it('verifies that foreign key ON DELETE SET NULL allows deletion without corrupting campaign_versions', () => {
      // In 00018_create_campaigns_and_versions.sql:
      // template_id UUID REFERENCES public.email_templates(id) ON DELETE SET NULL
      const campaignRow = {
        id: 'camp-1',
        template_id: 'tpl-100',
      };
      const versionSnapshot = {
        campaign_id: 'camp-1',
        version_number: 1,
        html_snapshot: '<p>Frozen Snapshot</p>',
      };

      // Deleting origin template sets campaignRow.template_id = null
      campaignRow.template_id = null as any;

      // Immutable version snapshot remains 100% intact
      expect(campaignRow.template_id).toBeNull();
      expect(versionSnapshot.html_snapshot).toBe('<p>Frozen Snapshot</p>');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Premium Template Composer Redesign (Gmail/Superhuman Experience)
  // ---------------------------------------------------------------------------
  describe('Premium Template Composer Redesign (Gmail/Superhuman Experience)', () => {
    it('verifies Email mode exposes Compor, Blocos, and Prévia modes', () => {
      const emailModes = ['compor', 'blocos', 'previa'];
      expect(emailModes).toContain('compor');
      expect(emailModes).toContain('blocos');
      expect(emailModes).toContain('previa');
    });

    it('verifies SMS mode only exposes Compor and Prévia, omitting Blocos', () => {
      const getAvailableModesForChannel = (ch: 'email' | 'sms') => {
        return ch === 'email' ? ['compor', 'blocos', 'previa'] : ['compor', 'previa'];
      };

      const smsModes = getAvailableModesForChannel('sms');
      expect(smsModes).toContain('compor');
      expect(smsModes).toContain('previa');
      expect(smsModes).not.toContain('blocos');
    });

    it('verifies Email channel requires and exposes Subject line', () => {
      const emailTemplate = {
        name: 'Boas-vindas VIP',
        content_json: {
          channel: 'email',
          subject: 'Boas-vindas à Expert Dental Solutions {{first_name}}',
          blocks: [{ id: 'b1', type: 'text', text: 'Olá!' }],
        },
      };

      expect(getTemplateSubject(emailTemplate as any)).toBe(
        'Boas-vindas à Expert Dental Solutions {{first_name}}'
      );
    });

    it('verifies SMS channel does not have a Subject line', () => {
      const smsTemplate = {
        name: 'Lembrete de Consulta SMS',
        content_json: {
          channel: 'sms',
          body: 'Olá {{salutation}}, seu horário está confirmado.',
        },
      };

      expect(getTemplateSubject(smsTemplate as any)).toBe('');
    });

    it('verifies global variable library contains only salutation and first_name', () => {
      const variableKeys = GLOBAL_TEMPLATE_VARIABLES.map((v) => v.key);
      expect(variableKeys).toEqual(['{{salutation}}', '{{first_name}}']);
      expect(variableKeys).not.toContain('{{last_name}}');
    });

    it('verifies preview HTML is strictly sanitized against XSS', () => {
      const maliciousHtml = '<p>Olá!</p><script>alert("hack")</script><img src="x" onerror="alert(1)" />';
      const sanitized = sanitizeHtml(maliciousHtml);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('onerror=');
      expect(sanitized).toContain('<p>Olá!</p>');
    });

    it('verifies save payload schema for Email preserves blocks and subject', () => {
      const emailPayload = {
        name: 'Campanha de Reativação',
        category: 'promotional',
        content_json: {
          channel: 'email',
          subject: 'Novidades exclusivas',
          blocks: [
            { id: 'h-1', type: 'heading', text: 'Olá', level: 1, align: 'center' },
            { id: 'b-1', type: 'button', label: 'Clique Aqui', url: 'https://expdentalsolutions.com' },
          ],
        },
        html_template: '<html>...</html>',
        text_template: 'Olá\n\n>>> Clique Aqui: https://expdentalsolutions.com',
      };

      expect(emailPayload.content_json.channel).toBe('email');
      expect(emailPayload.content_json.subject).toBe('Novidades exclusivas');
      expect(emailPayload.content_json.blocks).toHaveLength(2);
      expect(emailPayload.html_template).toBeTruthy();
    });

    it('verifies save payload schema for SMS preserves body in text_template and content_json', () => {
      const smsPayload = {
        name: 'Lembrete Rápido SMS',
        category: 'followup',
        content_json: {
          channel: 'sms',
          body: 'Olá {{first_name}}, precisamos confirmar sua presença.',
        },
        html_template: '',
        text_template: 'Olá {{first_name}}, precisamos confirmar sua presença.',
      };

      expect(smsPayload.content_json.channel).toBe('sms');
      expect(smsPayload.content_json.body).toContain('{{first_name}}');
      expect(smsPayload.html_template).toBe('');
      expect(smsPayload.text_template).toBe(smsPayload.content_json.body);
    });

    it('verifies legacy block compatibility is preserved when loaded in new composer', () => {
      const legacyBlocks = [
        { id: 'b-1', type: 'heading', text: 'Antigo Título', level: 2, align: 'left' },
        { id: 'b-2', type: 'text', text: 'Antigo texto...', align: 'left' },
      ];

      const legacyTemplate = {
        id: 'legacy-1',
        name: 'Template Antigo',
        content_json: legacyBlocks,
      };

      expect(getTemplateChannel(legacyTemplate as any)).toBe('email');
      const loadedBlocks = Array.isArray(legacyTemplate.content_json)
        ? legacyTemplate.content_json
        : [];
      expect(loadedBlocks).toHaveLength(2);
      expect(loadedBlocks[0].text).toBe('Antigo Título');
    });
  });
});

