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
 * If first_name is missing, empty, only whitespace, or a placeholder like "Doutor(a)",
 * it returns the canonical fallback ("Doctor").
 */
export function resolveSafeFirstName(
  firstName: string | null | undefined,
  fallback: string = 'Doctor'
): string {
  if (!firstName || typeof firstName !== 'string') return fallback;
  const trimmed = firstName.trim();
  if (!trimmed) return fallback;

  // Placeholder blacklist (case-insensitive)
  const lower = trimmed.toLowerCase();
  const placeholders = [
    'doutor(a)',
    'doutora',
    'doutor',
    'dr(a)',
    'dr(a).',
    'dr.',
    'dra.',
    'dr',
    'dra',
    'undefined',
    'null',
    'n/a',
    'none',
  ];

  if (placeholders.includes(lower)) {
    return fallback;
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
