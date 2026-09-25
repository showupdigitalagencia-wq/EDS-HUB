// =============================================================================
// EDS HUB — Template Variables & Communication Utilities
// =============================================================================
// Single source of truth for template channel detection, variable definitions,
// sample preview substitution with resolver parity, and encoding-aware SMS estimation.
// =============================================================================

import { resolveSalutation, resolveSafeFirstName } from './salutation';
export { resolveCanonicalGreeting, resolveSafeFirstName, resolveSalutation } from './salutation';

export type TemplateChannel = 'email' | 'sms';

/**
 * Safely extracts the channel from an email_templates record.
 * Handles:
 * - New templates with content_json.channel === 'sms' | 'email'
 * - Legacy templates where content_json is an EmailBlock[] array (treated as 'email')
 */
export function getTemplateChannel(
  template: { content_json?: unknown; category?: string; channel?: string; type?: string } | null | undefined
): TemplateChannel {
  if (!template) return 'email';
  const anyTpl = template as Record<string, unknown>;
  if (anyTpl.channel === 'sms' || anyTpl.category === 'sms' || anyTpl.type === 'sms') return 'sms';
  if (anyTpl.channel === 'email' || anyTpl.category === 'email' || anyTpl.type === 'email') return 'email';
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
];

/**
 * Course-specific template variables for first contact and course communications.
 */
export const COURSE_TEMPLATE_VARIABLES: TemplateVariable[] = [
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

export const ALL_TEMPLATE_VARIABLES: TemplateVariable[] = [
  ...GLOBAL_TEMPLATE_VARIABLES,
  ...COURSE_TEMPLATE_VARIABLES,
];

/**
 * Campaign-specific variable set (campaign-send-batch explicitly supports {{last_name}}).
 */
export const CAMPAIGN_SPECIFIC_VARIABLES: TemplateVariable[] = [
  ...ALL_TEMPLATE_VARIABLES,
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

export interface TemplateLeadVariables {
  first_name?: string | null;
  last_name?: string | null;
  course_name?: string | null;
  course_date_range?: string | null;
  course_tuition?: string | null;
  salutation?: string | null;
}

export interface RenderTemplateOptions {
  strictVariables?: boolean;
  mode?: 'live' | 'preview';
  context?: 'global' | 'campaign';
}

/**
 * Canonical central template renderer used across all lead origins (Meta, HubSpot, website, manual).
 * Enforces:
 * 1. Valid first_name -> "Hello John," / "Hello Maria,"
 * 2. Missing/empty/placeholder ("Doutor(a)") -> STRICTLY "Hello Doctor,"
 * 3. Never leaves unresolved {{first_name}} in output email.
 * 4. Strips unmapped {{...}} safely or fails if strictVariables is set.
 */
export function renderTemplateCentral(
  text: string | null | undefined,
  leadVars?: TemplateLeadVariables | null,
  options: RenderTemplateOptions = {}
): string {
  if (!text) return '';

  if (options.mode === 'preview') {
    return renderTemplateWithSampleData(text, options.context);
  }

  const safeFirstName = resolveSafeFirstName(leadVars?.first_name, 'Doctor');
  const safeSalutation = resolveSalutation(leadVars?.last_name, leadVars?.first_name, 'Doctor');
  const courseName = leadVars?.course_name || 'Zygomatic Implant Training';
  const courseDateRange = leadVars?.course_date_range || 'November 7–10, 2026';
  const courseTuition = leadVars?.course_tuition || '$17,500';

  let output = text
    .replace(/\{\{\s*salutation\s*\}\}/gi, safeSalutation)
    .replace(/\{\{\s*first_name\s*\}\}/gi, safeFirstName)
    .replace(/\{\{\s*course_name\s*\}\}/gi, courseName)
    .replace(/\{\{\s*course_date_range\s*\}\}/gi, courseDateRange)
    .replace(/\{\{\s*course_tuition\s*\}\}/gi, courseTuition);

  if (options.context === 'campaign' && leadVars?.last_name) {
    output = output.replace(/\{\{\s*last_name\s*\}\}/gi, leadVars.last_name.trim());
  }

  // Safety check: ensure no unresolved variable tags remain
  if (options.strictVariables) {
    const unmappedMatch = output.match(/\{\{\s*[\w.]+\s*\}\}/g);
    if (unmappedMatch && unmappedMatch.length > 0) {
      throw new Error(`Unresolved template variables found: ${unmappedMatch.join(', ')}`);
    }
  }

  // Safe cleanup of any unmapped variables so {{...}} never reaches the recipient
  output = output.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');

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
