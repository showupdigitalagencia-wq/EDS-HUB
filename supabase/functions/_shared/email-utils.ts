// =============================================================================
// Email utilities (Deno/Edge Function version)
// =============================================================================
// Identical logic to src/utils/email-validation.ts
// =============================================================================

export function isValidEmailSyntax(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes(' ')) return false;

  const atIndex = trimmed.indexOf('@');
  if (atIndex < 1) return false;

  const domain = trimmed.slice(atIndex + 1);
  if (domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;

  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) return false;

  return true;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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

export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
