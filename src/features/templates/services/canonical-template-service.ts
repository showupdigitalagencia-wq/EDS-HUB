// =============================================================================
// EDS HUB — Canonical Template Single Source of Truth Service
// =============================================================================
// Connects UI composers (Manual SMS, Manual WhatsApp, etc.) directly to the
// canonical templates stored in the public.email_templates table.
//
// Guarantees:
// 1. Templates page (email_templates table) is the sole content authority.
// 2. Immediate propagation: saving a template updates the modal without reload.
// 3. Hydration with personalization placeholders ({{first_name}}, {{salutation_line}},
//    [SURNAME], {{course_name}}, etc.) done dynamically without mutating canonical record.
// 4. Per-lead manual edits remain strictly local.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import {
  resolveSalutation,
  resolveSafeFirstName,
  resolveSafeLastName,
  resolveZygomaticSalutation,
} from '../../../utils/salutation';
import type { Lead } from '../../../types';

export interface CanonicalSmsTemplate {
  id: string;
  name: string;
  template_key: string | null;
  text_template: string;
  category: string;
  is_active: boolean;
  updated_at?: string;
}

// Fallback templates used strictly if database table is empty or network fails
export const DEFAULT_FALLBACK_SMS_TEMPLATES: CanonicalSmsTemplate[] = [
  {
    id: 'intensive_advanced_followup_sms',
    name: 'Contato SMS inicial — Intensive + Advanced',
    template_key: 'intensive_advanced_followup_sms',
    text_template: `Hello Dr. [SURNAME]

This is Natália from Expert Dental Solutions. Thank you for your interest in our Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings on November 11 to 14, 2026 and February 24 to 27, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`,
    category: 'sms',
    is_active: true,
  },
  {
    id: 'endodontics_followup_sms',
    name: 'Contato SMS inicial — Endodontics',
    template_key: 'endodontics_followup_sms',
    text_template: `Hello Dr. [SURNAME]

This is Natália from Expert Dental Solutions. Thank you for your interest in our Endodontics Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your endodontics experience?

Would you like to review the dates and program details together?

I’m happy to answer any questions and help you find the course that best matches your goals.`,
    category: 'sms',
    is_active: true,
  },
  {
    id: 'zygomatic_followup_sms',
    name: 'Contato SMS inicial — Zygomatic',
    template_key: 'zygomatic_followup_sms',
    text_template: `Hello Dr. [SURNAME]

This is Natália from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings on November 7 to 10, 2026 and March 1 to 4, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`,
    category: 'sms',
    is_active: true,
  },
  {
    id: 'wisdom_followup_sms',
    name: 'Contato SMS inicial — Wisdom',
    template_key: 'wisdom_followup_sms',
    text_template: `Hello Dr. [SURNAME]

This is Natália from Expert Dental Solutions. Thank you for your interest in our Wisdom Teeth Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your surgical extraction experience?

Would you like to review upcoming dates together?

I’m happy to answer any questions and help you find the course that best matches your goals.`,
    category: 'sms',
    is_active: true,
  },
  {
    id: 'rehabilitation_followup_sms',
    name: 'Contato SMS inicial — Rehabilitation',
    template_key: 'rehabilitation_followup_sms',
    text_template: `Hello Dr. [SURNAME]

This is Natália from Expert Dental Solutions. Thank you for your interest in our Oral Rehabilitation Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your prosthetic and rehabilitation experience?

Would you like to review the upcoming dates together?

I’m happy to answer any questions and help you find the course that best matches your goals.`,
    category: 'sms',
    is_active: true,
  },
  {
    id: 'periodontal_followup_sms',
    name: 'Contato SMS inicial — Periodontal Plastic',
    template_key: 'periodontal_followup_sms',
    text_template: `Hello Dr. [SURNAME]

This is Natália from Expert Dental Solutions. Thank you for your interest in our Periodontal Plastic Surgery Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your soft-tissue grafting experience?

Would you like to review the upcoming dates together?

I’m happy to answer any questions and help you find the course that best matches your goals.`,
    category: 'sms',
    is_active: true,
  },
  {
    id: 'general_inquiry_sms',
    name: 'Contato Inicial — Geral',
    template_key: 'general_inquiry_sms',
    text_template: `Hello {{first_name}}, thank you for your interest in Expert Dental Solutions. We received your request and would love to answer your questions regarding our hands-on surgical programs.`,
    category: 'sms',
    is_active: true,
  },
];

let cachedSmsTemplates: CanonicalSmsTemplate[] | null = null;

/**
 * Invalidates in-memory template cache so any subsequent modal open
 * immediately refetches the canonical rows from public.email_templates.
 */
export function invalidateCanonicalTemplateCache(): void {
  cachedSmsTemplates = null;
}

/**
 * Fetches canonical active SMS templates from public.email_templates.
 * If forceRefresh is true or cache is empty, queries Supabase directly.
 */
export async function fetchCanonicalSmsTemplates(forceRefresh: boolean = false): Promise<CanonicalSmsTemplate[]> {
  if (!forceRefresh && cachedSmsTemplates && cachedSmsTemplates.length > 0) {
    return cachedSmsTemplates;
  }

  try {
    const fromBuilder = supabase.from('email_templates');
    if (!fromBuilder || typeof fromBuilder.select !== 'function') {
      return cachedSmsTemplates || DEFAULT_FALLBACK_SMS_TEMPLATES;
    }

    let query: any = fromBuilder.select('id, name, template_key, text_template, category, content_json, is_active, updated_at');
    if (query && typeof query.eq === 'function') {
      query = query.eq('is_active', true);
    }
    if (query && typeof query.order === 'function') {
      query = query.order('name');
    }

    const res = await query;
    if (res && res.error) throw res.error;

    const rows = res?.data || [];
    const smsRows = rows.filter((r: any) => {
      const isSmsCategory = r.category === 'sms';
      const isSmsChannel = (r.content_json as any)?.channel === 'sms';
      const isSmsKey = typeof r.template_key === 'string' && r.template_key.includes('sms');
      const hasSmsInName = typeof r.name === 'string' && r.name.toLowerCase().includes('sms');
      return isSmsCategory || isSmsChannel || isSmsKey || hasSmsInName;
    });

    if (smsRows.length > 0) {
      const mapped: CanonicalSmsTemplate[] = smsRows.map((r: any) => ({
        id: r.id,
        name: r.name,
        template_key: r.template_key || null,
        text_template: r.text_template || (r.content_json as any)?.body || '',
        category: r.category || 'sms',
        is_active: r.is_active ?? true,
        updated_at: r.updated_at,
      }));
      cachedSmsTemplates = mapped;
      return mapped;
    }
  } catch (err) {
    console.warn('[canonical-template-service] Failed to fetch SMS templates from database, falling back:', err);
  }

  cachedSmsTemplates = DEFAULT_FALLBACK_SMS_TEMPLATES;
  return DEFAULT_FALLBACK_SMS_TEMPLATES;
}

/**
 * Resolves which SMS template to select by default based on the lead's course interest.
 */
export function resolveDefaultSmsTemplate(
  templates: CanonicalSmsTemplate[],
  lead: Lead
): CanonicalSmsTemplate {
  const tpls = templates && templates.length > 0 ? templates : DEFAULT_FALLBACK_SMS_TEMPLATES;
  const interestStr = `${lead.course_interest || ''} ${JSON.stringify(lead.course_interests || [])}`.toLowerCase();

  const findMatch = (keySub: string, nameSub: string) =>
    tpls.find(
      (t) =>
        (t.template_key && t.template_key.toLowerCase().includes(keySub)) ||
        t.name.toLowerCase().includes(nameSub)
    );

  if (interestStr.includes('zygoma')) {
    const match = findMatch('zygomatic', 'zygomatic');
    if (match) return match;
  }
  if (interestStr.includes('endo')) {
    const match = findMatch('endodontic', 'endodontic');
    if (match) return match;
  }
  if (interestStr.includes('wisdom') || interestStr.includes('molar')) {
    const match = findMatch('wisdom', 'wisdom');
    if (match) return match;
  }
  if (interestStr.includes('rehab')) {
    const match = findMatch('rehabilitation', 'rehabilitation');
    if (match) return match;
  }
  if (interestStr.includes('perio')) {
    const match = findMatch('periodontal', 'periodontal');
    if (match) return match;
  }
  if (interestStr.includes('implant') || interestStr.includes('intensive') || interestStr.includes('advanced')) {
    const match = findMatch('intensive', 'intensive') || findMatch('implant', 'implant');
    if (match) return match;
  }

  // Fallback to Zygomatic or first available
  return (
    tpls.find(
      (t) =>
        (t.template_key && t.template_key.includes('zygomatic')) ||
        t.name.toLowerCase().includes('zygomatic')
    ) || tpls[0]
  );
}

/**
 * Hydrates a canonical template text with personalization variables for a specific lead.
 *
 * Supported variables:
 * - {{first_name}}
 * - {{last_name}}
 * - {{salutation}}
 * - {{salutation_line}}
 * - {{course_name}}
 * - {{course_date_range}}
 * - {{course_tuition}}
 * - Hello Dr. [SURNAME] / Hi Dr. [SURNAME] / [SURNAME]
 *
 * Never mutates canonical database records.
 */
export function hydrateTemplateForLead(
  rawTemplateText: string | null | undefined,
  lead: Lead
): string {
  if (!rawTemplateText) return '';

  let text = rawTemplateText;

  // 1. Resolve safe name tokens
  const safeFirstName = resolveSafeFirstName(lead.first_name, 'Doctor');
  const safeLastName = lead.last_name ? lead.last_name.trim() : '';
  const safeSurname = resolveSafeLastName(lead.last_name, lead.first_name);
  const safeSalutation = resolveSalutation(lead.last_name, lead.first_name, 'Doctor');
  const zygomaticSalutation = resolveZygomaticSalutation(lead);

  const courseName = lead.course_interest || 'Zygomatic Implant Training';
  const courseDateRange = 'November 7–10, 2026';
  const courseTuition = '$17,500';

  // 2. Handle [SURNAME] placeholder pattern:
  // "Hello Dr. [SURNAME]" -> with surname: "Hello Dr. Smith", without surname: "Hello Doctor"
  // "Hi Dr. [SURNAME]" -> with surname: "Hi Dr. Smith", without surname: "Hi Doctor"
  // "[SURNAME]" -> with surname: "Smith", without surname: "Doctor"
  if (safeSurname) {
    text = text.replace(/\[SURNAME\]/gi, safeSurname);
  } else {
    text = text
      .replace(/Hello Dr\.\s*\[SURNAME\]/gi, 'Hello Doctor')
      .replace(/Hi Dr\.\s*\[SURNAME\]/gi, 'Hi Doctor')
      .replace(/\[SURNAME\]/gi, 'Doctor');
  }

  // 3. Handle standard double-curly brackets variables
  text = text
    .replace(/\{\{\s*salutation_line\s*\}\}/gi, zygomaticSalutation)
    .replace(/\{\{\s*salutation\s*\}\}/gi, safeSalutation)
    .replace(/\{\{\s*first_name\s*\}\}/gi, safeFirstName)
    .replace(/\{\{\s*last_name\s*\}\}/gi, safeLastName)
    .replace(/\{\{\s*course_name\s*\}\}/gi, courseName)
    .replace(/\{\{\s*course_date_range\s*\}\}/gi, courseDateRange)
    .replace(/\{\{\s*course_tuition\s*\}\}/gi, courseTuition);

  // 4. Strip any unmapped {{...}} placeholders safely so raw syntax never leaks to recipients
  text = text.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');

  return text;
}
