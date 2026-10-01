// =============================================================================
// EDS HUB — Email Validation & Normalization Utilities
// =============================================================================
// Canonical multi-email discovery, normalization, validation and deduplication.
// =============================================================================

export {
  isValidEmailSyntax,
  normalizeEmail,
  resolveCanonicalEmails,
  resolveEmailRecipients,
  KNOWN_EMAIL_PRIORITY_FIELDS,
} from './canonical-email-resolver';

export type {
  ResolvedEmailIdentity,
  CanonicalEmailResolutionResult,
} from './canonical-email-resolver';

/**
 * HTML escapes user-supplied dynamic variables before template substitution.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
