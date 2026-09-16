// =============================================================================
// EDS HUB — Email Validation & Normalization Utilities
// =============================================================================
// Handles email syntax validation, normalization (lowercase + trim),
// and deduplication of email/email_confirmation pairs.
// =============================================================================

/**
 * Basic email syntax validation.
 * Checks for: non-empty, contains @, has local and domain parts,
 * domain has at least one dot, no spaces.
 *
 * This is intentionally simple — we're not trying to implement RFC 5322.
 * The real validation is done by the email provider (Resend).
 */
export function isValidEmailSyntax(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes(' ')) return false;

  // Basic structure: local@domain.tld
  const atIndex = trimmed.indexOf('@');
  if (atIndex < 1) return false; // must have local part

  const domain = trimmed.slice(atIndex + 1);
  if (domain.length === 0) return false;
  if (!domain.includes('.')) return false;

  // Domain must not start or end with dot
  if (domain.startsWith('.') || domain.endsWith('.')) return false;

  // TLD must have at least 2 chars
  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) return false;

  return true;
}

/**
 * Normalizes an email address: trims whitespace and converts to lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Given email and email_confirmation fields from a lead,
 * returns a deduplicated list of valid, normalized email addresses.
 *
 * Rules:
 * - Both values are trimmed and lowercased
 * - Invalid syntax emails are excluded
 * - Duplicates (after normalization) are removed
 * - The result may be 0, 1, or 2 emails
 */
export function resolveEmailRecipients(
  email: string | null | undefined,
  emailConfirmation: string | null | undefined,
): string[] {
  const candidates: string[] = [];

  if (email) {
    const normalized = normalizeEmail(email);
    if (isValidEmailSyntax(normalized)) {
      candidates.push(normalized);
    }
  }

  if (emailConfirmation) {
    const normalized = normalizeEmail(emailConfirmation);
    if (isValidEmailSyntax(normalized) && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }

  return candidates;
}
