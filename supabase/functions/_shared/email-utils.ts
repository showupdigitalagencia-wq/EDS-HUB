// =============================================================================
// Email utilities (Deno/Edge Function version)
// =============================================================================
// Identical logic to src/utils/email-validation.ts
// =============================================================================

export {
  isValidEmailSyntax,
  normalizeEmail,
  resolveCanonicalEmails,
  resolveEmailRecipients,
  KNOWN_EMAIL_PRIORITY_FIELDS,
} from './canonical-email-resolver.ts';

export type {
  ResolvedEmailIdentity,
  CanonicalEmailResolutionResult,
} from './canonical-email-resolver.ts';

export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
