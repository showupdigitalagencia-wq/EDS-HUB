// =============================================================================
// EDS HUB — Central Contact Preference Resolver & Formatter
// =============================================================================
// Single Source of Truth for Contact Preference handling across EDS HUB:
// - Supported canonical preferences: 'email' | 'sms' | 'call' | 'whatsapp' | null
// - Official UI labels:
//     email    -> Email
//     sms      -> SMS
//     call     -> Ligação
//     whatsapp -> WhatsApp
//     null     -> Não informada
// - STRICT INVARIANT: Absence of preference (null/undefined/'') MUST NEVER
//   fall back to 'email'. Having an email != preferring email.
// =============================================================================

export type CanonicalContactPreference = 'email' | 'sms' | 'call' | 'whatsapp' | 'email_sms' | null;

/**
 * Resolves any raw preference value (from DB, HubSpot, Meta, Forms, CSV)
 * to one of the canonical values or null (unspecified / não informada).
 * Absolutely no fallback to 'email' when unspecified.
 */
export function resolveCanonicalPreference(raw?: string | null): CanonicalContactPreference {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const norm = raw.trim().toLowerCase();
  if (
    !norm ||
    norm === 'null' ||
    norm === 'undefined' ||
    norm === 'none' ||
    norm === 'unspecified' ||
    norm === 'não informada' ||
    norm === 'nao informada' ||
    norm === 'sem preferência' ||
    norm === 'sem preferencia' ||
    norm === 'sem_preferencia' ||
    norm === 'sem_preferência' ||
    norm === 'no preference' ||
    norm === 'unknown'
  ) {
    return null;
  }

  // Compound: Email + SMS
  if (
    norm === 'email_sms' ||
    norm === 'email+sms' ||
    norm === 'email/sms' ||
    norm === 'email + sms' ||
    norm === 'email, sms' ||
    norm === 'email & sms' ||
    norm === 'email e sms' ||
    norm === 'sms + email' ||
    norm === 'sms, email' ||
    (norm.includes('email') && norm.includes('sms'))
  ) {
    return 'email_sms';
  }

  // Email
  if (norm === 'email' || norm === 'e-mail' || norm === 'mail') {
    return 'email';
  }

  // SMS
  if (norm === 'sms' || norm === 'text' || norm === 'text_message' || norm === 'sms / text' || norm.includes('sms')) {
    return 'sms';
  }

  // WhatsApp
  if (norm === 'whatsapp' || norm === 'whats' || norm === 'zap' || norm === 'wa' || norm.includes('whatsapp') || norm.includes('whats') || norm.includes('zap')) {
    return 'whatsapp';
  }

  // Call / Phone
  if (norm === 'call' || norm === 'phone' || norm === 'telefone' || norm === 'ligação' || norm === 'ligacao' || norm === 'phone / call' || norm.includes('call') || norm.includes('phone') || norm.includes('lig')) {
    return 'call';
  }

  return null;
}

/**
 * Returns the exact standalone Portuguese label for a contact preference.
 * Values: 'Email', 'SMS', 'Ligação', 'WhatsApp', 'Email + SMS', 'Não informada'.
 */
export function getContactPreferenceLabel(preference?: string | null): string {
  const canonical = resolveCanonicalPreference(preference);
  switch (canonical) {
    case 'email':
      return 'Email';
    case 'sms':
      return 'SMS';
    case 'call':
      return 'Ligação';
    case 'whatsapp':
      return 'WhatsApp';
    case 'email_sms':
      return 'Email + SMS';
    case null:
    default:
      return 'Não informada';
  }
}

/**
 * Formats a canonical or raw preference into human-readable Portuguese label.
 * Defaults withPrefix=true for card/badge display ('Preferência: Email', etc.)
 *
 * @param preference Raw or canonical preference string
 * @param options.withPrefix If false, returns standalone label ('Email', etc.)
 */
export function formatContactPreferenceLabel(
  preference?: string | null,
  options?: { withPrefix?: boolean }
): string {
  const withPrefix = options?.withPrefix ?? true;
  const label = getContactPreferenceLabel(preference);
  return withPrefix ? `Preferência: ${label}` : label;
}

/**
 * Returns Tailwind color classes tailored for each preference badge.
 */
export function getContactPreferenceBadgeClasses(preference?: string | null): {
  bg: string;
  text: string;
  border: string;
  badge: string;
} {
  const canonical = resolveCanonicalPreference(preference);
  switch (canonical) {
    case 'email':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'sms':
      return {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
        badge: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    case 'whatsapp':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        border: 'border-emerald-300',
        badge: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      };
    case 'call':
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        border: 'border-amber-200',
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    case 'email_sms':
      return {
        bg: 'bg-indigo-50',
        text: 'text-indigo-700',
        border: 'border-indigo-200',
        badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      };
    case null:
    default:
      return {
        bg: 'bg-slate-100',
        text: 'text-slate-600',
        border: 'border-slate-200',
        badge: 'bg-slate-100 text-slate-600 border-slate-200',
      };
  }
}
