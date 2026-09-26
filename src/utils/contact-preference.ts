// =============================================================================
// EDS HUB — Central Contact Preference Resolver & Formatter
// =============================================================================
// Single Source of Truth for Contact Preference handling across EDS HUB:
// - Supported canonical preferences: 'email' | 'sms' | 'call' | 'whatsapp' | 'email_sms' | 'email_whatsapp' | 'sms_whatsapp' | null
// - Official UI labels:
//     email          -> Email
//     sms            -> SMS
//     call           -> Ligação
//     whatsapp       -> WhatsApp
//     email_sms      -> Email + SMS
//     email_whatsapp -> Email + WhatsApp
//     sms_whatsapp   -> SMS + WhatsApp
//     null           -> Não informada
// - STRICT INVARIANT: Absence of preference (null/undefined/'') MUST NEVER
//   fall back to 'email'. Having an email != preferring email.
// =============================================================================

export type CanonicalContactPreference =
  | 'email'
  | 'sms'
  | 'call'
  | 'whatsapp'
  | 'email_sms'
  | 'email_whatsapp'
  | 'sms_whatsapp'
  | null;

/**
 * Resolves any raw preference value (from DB, HubSpot, Meta, Forms, CSV, manual)
 * to one of the canonical values or null (unspecified / não informada).
 * Absolutely no forced fallback to 'email' when unspecified.
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

  // Compound 1: Email + SMS
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
    norm === 'sms e email' ||
    (norm.includes('email') && (norm.includes('sms') || norm.includes('text')))
  ) {
    return 'email_sms';
  }

  // Compound 2: Email + WhatsApp
  if (
    norm === 'email_whatsapp' ||
    norm === 'email+whatsapp' ||
    norm === 'email/whatsapp' ||
    norm === 'email + whatsapp' ||
    norm === 'email, whatsapp' ||
    norm === 'email & whatsapp' ||
    norm === 'email e whatsapp' ||
    (norm.includes('email') && (norm.includes('whatsapp') || norm.includes('whats') || norm.includes('zap') || norm.includes('wpp')))
  ) {
    return 'email_whatsapp';
  }

  // Compound 3: SMS + WhatsApp
  if (
    norm === 'sms_whatsapp' ||
    norm === 'sms+whatsapp' ||
    norm === 'sms/whatsapp' ||
    norm === 'sms + whatsapp' ||
    norm === 'sms, whatsapp' ||
    norm === 'sms & whatsapp' ||
    norm === 'sms e whatsapp' ||
    ((norm.includes('sms') || norm.includes('text')) && (norm.includes('whatsapp') || norm.includes('whats') || norm.includes('zap') || norm.includes('wpp')))
  ) {
    return 'sms_whatsapp';
  }

  // WhatsApp (prioritize before phone/call in case of 'whatsapp call')
  if (
    norm === 'whatsapp' ||
    norm === 'whats' ||
    norm === 'zap' ||
    norm === 'wa' ||
    norm === 'wpp' ||
    norm.includes('whatsapp') ||
    norm.includes('whats') ||
    norm.includes('zap') ||
    norm.includes('wpp')
  ) {
    return 'whatsapp';
  }

  // Email
  if (
    norm === 'email' ||
    norm === 'e-mail' ||
    norm === 'mail' ||
    norm.includes('email') ||
    norm.includes('e-mail') ||
    norm.includes('correio')
  ) {
    return 'email';
  }

  // SMS / Text
  if (
    norm === 'sms' ||
    norm === 'text' ||
    norm === 'text_message' ||
    norm === 'sms / text' ||
    norm === 'sms/text' ||
    norm === 'text/sms' ||
    norm === 'torpedo' ||
    norm === 'mensagem' ||
    norm.includes('sms') ||
    norm.includes('text') ||
    norm.includes('torpedo')
  ) {
    return 'sms';
  }

  // Call / Phone
  if (
    norm === 'call' ||
    norm === 'phone' ||
    norm === 'telefone' ||
    norm === 'ligação' ||
    norm === 'ligacao' ||
    norm === 'phone / call' ||
    norm === 'call / phone' ||
    norm === 'voz' ||
    norm === 'voice' ||
    norm.includes('call') ||
    norm.includes('phone') ||
    norm.includes('lig') ||
    norm.includes('tel') ||
    norm.includes('voz') ||
    norm.includes('voice')
  ) {
    return 'call';
  }

  return null;
}

/**
 * Returns the exact standalone Portuguese label for a contact preference.
 * Values: 'Email', 'SMS', 'Ligação', 'WhatsApp', 'Email + SMS', 'Email + WhatsApp', 'SMS + WhatsApp', 'Não informada'.
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
    case 'email_whatsapp':
      return 'Email + WhatsApp';
    case 'sms_whatsapp':
      return 'SMS + WhatsApp';
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
    case 'email_whatsapp':
      return {
        bg: 'bg-teal-50',
        text: 'text-teal-700',
        border: 'border-teal-200',
        badge: 'bg-teal-50 text-teal-700 border-teal-200',
      };
    case 'sms_whatsapp':
      return {
        bg: 'bg-cyan-50',
        text: 'text-cyan-700',
        border: 'border-cyan-200',
        badge: 'bg-cyan-50 text-cyan-700 border-cyan-200',
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

/**
 * Safely converts any canonical or raw preference to a value that satisfies the
 * PostgreSQL check constraint:
 * CHECK (contact_preference IS NULL OR contact_preference IN ('email', 'sms', 'call', 'whatsapp'))
 */
export function toDbContactPreference(
  preference?: string | null
): 'email' | 'sms' | 'call' | 'whatsapp' | null {
  const canonical = resolveCanonicalPreference(preference);
  if (canonical === 'email' || canonical === 'sms' || canonical === 'call' || canonical === 'whatsapp') {
    return canonical;
  }
  if (canonical === 'email_sms' || canonical === 'email_whatsapp') {
    return 'email';
  }
  if (canonical === 'sms_whatsapp') {
    return 'sms';
  }
  return null;
}

