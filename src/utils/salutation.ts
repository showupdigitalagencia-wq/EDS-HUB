// =============================================================================
// EDS HUB — Salutation & Greeting Resolver (Central Rule)
// =============================================================================
// Single source of truth for computing greeting names and salutations across:
// - First contact emails & automations (Meta, HubSpot, website, manual)
// - Email composer & templates
// - SMS messages & campaigns
//
// CANONICAL GREETING RULES:
// 1. If valid first_name exists:
//    "Hello {{first_name}}," -> "Hello John," / "Hello Maria,"
// 2. If first_name is missing (null, undefined, empty, whitespace) or is a
//    placeholder artifact (e.g. "Doutor(a)", "Doutor", "dr(a)", "null", "undefined"):
//    STRICTLY "Hello Doctor,"
// 3. Never emit:
//    - "Hello ,"
//    - "Hello undefined,"
//    - "Hello null,"
//    - "Hello {{first_name}},"
//    - "Hello Doutor(a),"
// =============================================================================

import { DEFAULT_SALUTATION } from '../lib/constants';

/**
 * Normalizes and validates a lead's first name for safe template rendering.
 * Ensures only genuine, human-like names are used in greetings.
 * If first_name is missing, empty, whitespace, an acronym/code (e.g. "WED"),
 * a placeholder (e.g. "Doutor(a)"), or a technical value, it returns the canonical fallback ("Doctor").
 */
export function resolveSafeFirstName(
  firstName: string | null | undefined,
  fallback: string = 'Doctor'
): string {
  if (!firstName || typeof firstName !== 'string') return fallback;
  const trimmed = firstName.trim();
  if (!trimmed || trimmed.length < 2) return fallback;

  // Reject strings with digits or technical characters
  if (/[0-9_@#$%^&*()+=<>{}[\]|\\/~`!?]/.test(trimmed)) {
    return fallback;
  }

  const lower = trimmed.toLowerCase();

  // 1. Placeholder & Role Blacklist
  const placeholders = new Set([
    'doutor(a)',
    'doutora',
    'doutor',
    'dr(a)',
    'dr(a).',
    'dr.',
    'dra.',
    'dr',
    'dra',
    'doctor',
    'undefined',
    'null',
    'n/a',
    'none',
    'teste',
    'test',
    'lead',
    'contato',
    'contact',
    'user',
    'usuario',
    'admin',
    'cliente',
    'aluno',
    'paciente',
    'info',
    'sac',
    'crm',
    'dev',
    'api',
    'bot',
  ]);

  if (placeholders.has(lower)) {
    return fallback;
  }

  // 2. Calendar / Day-of-week abbreviations (English & Portuguese)
  const calendarAbbreviations = new Set([
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
    'seg',
    'ter',
    'qua',
    'qui',
    'sex',
    'sab',
    'dom',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]);

  if (calendarAbbreviations.has(lower)) {
    return fallback;
  }

  // 3. Technical Acronyms: All-caps short words without lower case that are not standard names
  const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length <= 4;
  if (isAllCaps) {
    const commonAllCapsNames = new Set(['ANA', 'MAX', 'LEO', 'EVA', 'ROY', 'GUY', 'IAN']);
    if (!commonAllCapsNames.has(trimmed)) {
      return fallback;
    }
  }

  // 4. Must contain at least one vowel
  if (!/[aeiouyáàâãéèêíïóôõöúü]/i.test(trimmed)) {
    return fallback;
  }

  // Normalize casing if all uppercase (e.g. "ANA" -> "Ana")
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  return trimmed;
}

/**
 * Returns the canonical greeting line for first-contact emails.
 * Valid name: "Hello John,"
 * Missing/placeholder: "Hello Doctor,"
 */
export function resolveCanonicalGreeting(
  firstName: string | null | undefined,
  salutationWord: string = 'Hello'
): string {
  const safeName = resolveSafeFirstName(firstName, 'Doctor');
  return `${salutationWord} ${safeName},`;
}

/**
 * Resolves the salutation name for a lead.
 *
 * @param lastName - The lead's last name (may be null/undefined/empty)
 * @param firstName - The lead's first name (may be null/undefined/empty)
 * @param defaultSalutation - Fallback when no name is available (defaults to "Doc")
 * @returns The resolved salutation string
 */
export function resolveSalutation(
  lastName: string | null | undefined,
  firstName: string | null | undefined,
  defaultSalutation: string = DEFAULT_SALUTATION,
): string {
  const trimmedLast = lastName?.trim();
  if (trimmedLast && trimmedLast.length > 0) {
    const lower = trimmedLast.toLowerCase();
    if (!['doutor(a)', 'doutor', 'doutora', 'dr(a)', 'dr.', 'dra.'].includes(lower)) {
      return trimmedLast;
    }
  }

  const safeFirst = resolveSafeFirstName(firstName, '');
  if (safeFirst && safeFirst.length > 0) {
    return safeFirst;
  }

  return defaultSalutation;
}
