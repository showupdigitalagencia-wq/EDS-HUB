// =============================================================================
// Canonical Email Resolver (Shared Deno / Edge Function Service)
// =============================================================================
// Unified source of truth for email candidate discovery, syntax validation,
// case-insensitive normalization, deduplication, provenance tracking,
// and divergence detection across ALL ingestion paths (Meta, HubSpot, Web Forms).
// =============================================================================

export interface ResolvedEmailIdentity {
  raw_email: string;
  normalized_email: string;
  source_field: string;
  source: string;
  is_primary: boolean;
  is_valid: boolean;
}

export interface CanonicalEmailResolutionResult {
  primary_email: string | null;
  primary_raw: string | null;
  primary_field: string | null;
  unique_count: number;
  divergence: boolean;
  emails: ResolvedEmailIdentity[];
}

/**
 * Strict syntax validation for an email address.
 * Rejects whitespace, missing @ or dot, leading/trailing dots, and invalid characters.
 */
export function isValidEmailSyntax(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 6 || trimmed.includes(' ')) return false;

  const atIndex = trimmed.indexOf('@');
  if (atIndex < 1) return false;

  const domain = trimmed.slice(atIndex + 1);
  if (domain.length < 3 || !domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;

  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) return false;

  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(trimmed);
}

/**
 * Normalizes email by trimming whitespace and converting to lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Known email field candidates in priority order.
 */
export const KNOWN_EMAIL_PRIORITY_FIELDS: readonly string[] = [
  'email',
  'e-mail',
  'e_mail',
  'primary_email',
  'work_email',
  'confirm_your_email',
  'confirm_email',
  'confirmation_email',
  'email_confirmation',
  'please_confirm_your_email_address',
  'confirme_seu_email',
  'confirme_seu_e_mail',
  'confirmacao_de_email',
  'confirmacao_email',
  'email_confirmacao',
  'secondary_email',
  'alternate_email',
  'personal_email',
  'outro_email',
];

/**
 * Canonical Email Resolver:
 * Accepts any source data object, maps and discovers all candidate email fields,
 * validates, normalizes, deduplicates, and returns factual identities with divergence.
 */
export function resolveCanonicalEmails(
  data: Record<string, unknown> | null | undefined,
  source = 'unknown'
): CanonicalEmailResolutionResult {
  if (!data || typeof data !== 'object') {
    return {
      primary_email: null,
      primary_raw: null,
      primary_field: null,
      unique_count: 0,
      divergence: false,
      emails: [],
    };
  }

  const seenNormalized = new Set<string>();
  const emails: ResolvedEmailIdentity[] = [];
  let primaryEmail: string | null = null;
  let primaryRaw: string | null = null;
  let primaryField: string | null = null;

  // Flatten if data has nested properties (e.g. HubSpot event.properties)
  const flattened: Record<string, unknown> = { ...data };
  if (data.properties && typeof data.properties === 'object' && !Array.isArray(data.properties)) {
    Object.assign(flattened, data.properties);
  }
  if (data.submitted_data && typeof data.submitted_data === 'object' && !Array.isArray(data.submitted_data)) {
    Object.assign(flattened, data.submitted_data);
  }

  // 1. Process known priority fields first
  for (const fieldName of KNOWN_EMAIL_PRIORITY_FIELDS) {
    if (fieldName in flattened) {
      const rawVal = flattened[fieldName];
      if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        if (isValidEmailSyntax(trimmed)) {
          const norm = normalizeEmail(trimmed);
          if (!seenNormalized.has(norm)) {
            seenNormalized.add(norm);
            const isPrimary = emails.length === 0;
            if (isPrimary) {
              primaryEmail = norm;
              primaryRaw = trimmed;
              primaryField = fieldName;
            }

            emails.push({
              raw_email: trimmed,
              normalized_email: norm,
              source_field: fieldName,
              source,
              is_primary: isPrimary,
              is_valid: true,
            });
          }
        }
      }
    }
  }

  // 2. Discover any additional email fields dynamically (safe validation check)
  for (const [key, val] of Object.entries(flattened)) {
    const lowerKey = key.toLowerCase();
    if (KNOWN_EMAIL_PRIORITY_FIELDS.includes(lowerKey)) continue;

    // Only inspect fields if key contains 'email'/'mail' OR value looks like an email
    if (typeof val === 'string' && val.length > 5 && val.includes('@')) {
      const trimmed = val.trim();
      if (isValidEmailSyntax(trimmed)) {
        const norm = normalizeEmail(trimmed);
        if (!seenNormalized.has(norm)) {
          seenNormalized.add(norm);
          const isPrimary = emails.length === 0;
          if (isPrimary) {
            primaryEmail = norm;
            primaryRaw = trimmed;
            primaryField = key;
          }

          emails.push({
            raw_email: trimmed,
            normalized_email: norm,
            source_field: key,
            source,
            is_primary: isPrimary,
            is_valid: true,
          });
        }
      }
    }
  }

  const uniqueCount = emails.length;
  const divergence = uniqueCount > 1;

  return {
    primary_email: primaryEmail,
    primary_raw: primaryRaw,
    primary_field: primaryField,
    unique_count: uniqueCount,
    divergence,
    emails,
  };
}

/**
 * Convenience helper returning all valid normalized email addresses for delivery.
 */
export function resolveEmailRecipients(
  emailOrData?: string | Record<string, unknown> | null,
  secondaryEmail?: string | null
): string[] {
  if (!emailOrData) {
    if (secondaryEmail && isValidEmailSyntax(secondaryEmail)) {
      return [normalizeEmail(secondaryEmail)];
    }
    return [];
  }

  if (typeof emailOrData === 'string') {
    const candidates: string[] = [];
    if (isValidEmailSyntax(emailOrData)) {
      candidates.push(normalizeEmail(emailOrData));
    }
    if (secondaryEmail && isValidEmailSyntax(secondaryEmail)) {
      const normSec = normalizeEmail(secondaryEmail);
      if (!candidates.includes(normSec)) {
        candidates.push(normSec);
      }
    }
    return candidates;
  }

  // If passed an object
  const result = resolveCanonicalEmails(emailOrData);
  return result.emails.map((e) => e.normalized_email);
}
