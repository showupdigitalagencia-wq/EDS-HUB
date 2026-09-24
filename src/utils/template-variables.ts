// =============================================================================
// EDS HUB — Template Variables & Communication Utilities
// =============================================================================
// Single source of truth for template channel detection, variable definitions,
// sample preview substitution with resolver parity, and encoding-aware SMS estimation.
// =============================================================================

import { resolveSalutation } from './salutation';

export type TemplateChannel = 'email' | 'sms';

/**
 * Safely extracts the channel from an email_templates record.
 * Handles:
 * - New templates with content_json.channel === 'sms' | 'email'
 * - Legacy templates where content_json is an EmailBlock[] array (treated as 'email')
 */
export function getTemplateChannel(template: { content_json?: unknown } | null | undefined): TemplateChannel {
  if (!template) return 'email';
  const cj = template.content_json;
  if (typeof cj === 'object' && cj !== null && !Array.isArray(cj)) {
    const channel = (cj as { channel?: string }).channel;
    if (channel === 'sms') return 'sms';
    if (channel === 'email') return 'email';
  }
  // Default for legacy EmailBlock[] arrays or undefined
  return 'email';
}

/**
 * Safely extracts the default subject from an email template, if present.
 */
export function getTemplateSubject(template: { content_json?: unknown } | null | undefined): string {
  if (!template) return '';
  const cj = template.content_json;
  if (typeof cj === 'object' && cj !== null && !Array.isArray(cj)) {
    return (cj as { subject?: string }).subject || '';
  }
  return '';
}

export interface TemplateVariable {
  key: string;
  label: string;
  description: string;
}

/**
 * Canonical global reusable variables compatible across Campaigns, Automations, and Sequences.
 * Note: {{last_name}} is intentionally omitted here because execute-automation-run does not
 * replace {{last_name}} in raw automation steps.
 */
export const GLOBAL_TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    key: '{{salutation}}',
    label: 'Saudação',
    description: 'Nome de saudação do lead (ex: Silva ou Maria)',
  },
  {
    key: '{{first_name}}',
    label: 'Primeiro Nome',
    description: 'Primeiro nome cadastrado (ex: Maria)',
  },
  {
    key: '{{course_name}}',
    label: 'Nome do Curso',
    description: 'Nome do curso de interesse (ex: Zygomatic Implant Training)',
  },
  {
    key: '{{course_date_range}}',
    label: 'Datas do Curso',
    description: 'Período da próxima turma (ex: November 7–10, 2026)',
  },
  {
    key: '{{course_tuition}}',
    label: 'Valor do Curso',
    description: 'Investimento do curso (ex: $17,500)',
  },
];

/**
 * Campaign-specific variable set (campaign-send-batch explicitly supports {{last_name}}).
 */
export const CAMPAIGN_SPECIFIC_VARIABLES: TemplateVariable[] = [
  ...GLOBAL_TEMPLATE_VARIABLES,
  {
    key: '{{last_name}}',
    label: 'Sobrenome',
    description: 'Sobrenome do lead (suportado exclusivamente em campanhas de email)',
  },
];

/**
 * Standard fictional preview data. Production lead records are never queried.
 */
export const SAMPLE_PREVIEW_DATA = {
  first_name: 'Maria',
  last_name: 'Silva',
  sender_name: 'Expert Dental Solutions',
  sender_email: 'preview@exemplo.com',
  recipient_email: 'maria.silva@exemplo.com',
  recipient_phone: '+55 (11) 98765-4321',
  course_name: 'Zygomatic Implant Training',
  course_date_range: 'November 7–10, 2026',
  course_tuition: '$17,500',
};

/**
 * Substitutes variables in template text using deterministic sample data.
 * Mimics actual production runtime resolver (resolveSalutation).
 */
export function renderTemplateWithSampleData(
  text: string | null | undefined,
  context: 'global' | 'campaign' = 'global',
): string {
  if (!text) return '';

  // Parity with runtime resolveSalutation('Silva', 'Maria', 'Doc') -> "Silva"
  const salutation = resolveSalutation(SAMPLE_PREVIEW_DATA.last_name, SAMPLE_PREVIEW_DATA.first_name, 'Doc');

  let output = text
    .replace(/\{\{\s*salutation\s*\}\}/gi, salutation)
    .replace(/\{\{\s*first_name\s*\}\}/gi, SAMPLE_PREVIEW_DATA.first_name)
    .replace(/\{\{\s*course_name\s*\}\}/gi, SAMPLE_PREVIEW_DATA.course_name)
    .replace(/\{\{\s*course_date_range\s*\}\}/gi, SAMPLE_PREVIEW_DATA.course_date_range)
    .replace(/\{\{\s*course_tuition\s*\}\}/gi, SAMPLE_PREVIEW_DATA.course_tuition);

  if (context === 'campaign') {
    output = output.replace(/\{\{\s*last_name\s*\}\}/gi, SAMPLE_PREVIEW_DATA.last_name);
  }

  return output;
}

// GSM-7 Basic Character Set (7-bit ASCII subset and special characters)
const GSM_7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

// GSM-7 Extended Characters (take 2 septets / escape sequence)
const GSM_7_EXTENDED = '^{}\\[~]|€';

export interface SmsSegmentEstimate {
  characterCount: number;
  encoding: 'GSM-7' | 'Unicode';
  segmentCount: number;
  maxSingleSegmentChars: number;
  charsPerConcatenatedSegment: number;
  remainingInCurrentSegment: number;
  hasExtendedChars: boolean;
}

/**
 * Calculates informational SMS segment and character counts.
 * Detects whether GSM-7 or Unicode (UCS-2) encoding is required.
 */
export function calculateSmsSegments(text: string): SmsSegmentEstimate {
  if (!text || text.length === 0) {
    return {
      characterCount: 0,
      encoding: 'GSM-7',
      segmentCount: 0,
      maxSingleSegmentChars: 160,
      charsPerConcatenatedSegment: 153,
      remainingInCurrentSegment: 160,
      hasExtendedChars: false,
    };
  }

  let isGsm7 = true;
  let hasExtendedChars = false;
  let totalSeptets = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (GSM_7_EXTENDED.includes(char)) {
      hasExtendedChars = true;
      totalSeptets += 2;
    } else if (GSM_7_BASIC.includes(char)) {
      totalSeptets += 1;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (isGsm7) {
    const maxSingle = 160;
    const concatPerSeg = 153;
    const segmentCount = totalSeptets <= maxSingle ? 1 : Math.ceil(totalSeptets / concatPerSeg);
    const capacity = segmentCount === 1 ? maxSingle : segmentCount * concatPerSeg;
    const remaining = capacity - totalSeptets;

    return {
      characterCount: text.length,
      encoding: 'GSM-7',
      segmentCount,
      maxSingleSegmentChars: maxSingle,
      charsPerConcatenatedSegment: concatPerSeg,
      remainingInCurrentSegment: Math.max(0, remaining),
      hasExtendedChars,
    };
  }

  // Unicode / UCS-2 encoding (e.g. for 'ã', 'õ', emojis)
  const codePoints = Array.from(text);
  const characterCount = codePoints.length;
  const maxSingle = 70;
  const concatPerSeg = 67;
  const segmentCount = characterCount <= maxSingle ? 1 : Math.ceil(characterCount / concatPerSeg);
  const capacity = segmentCount === 1 ? maxSingle : segmentCount * concatPerSeg;
  const remaining = capacity - characterCount;

  return {
    characterCount,
    encoding: 'Unicode',
    segmentCount,
    maxSingleSegmentChars: maxSingle,
    charsPerConcatenatedSegment: concatPerSeg,
    remainingInCurrentSegment: Math.max(0, remaining),
    hasExtendedChars: false,
  };
}
