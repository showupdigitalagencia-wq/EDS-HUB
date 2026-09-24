// =============================================================================
// Phone Normalization Utility
// =============================================================================
// Safe international phone parsing & E.164 normalization for EDS HUB.
//
// Rules:
// 1. Explicit International (+):
//    - If the phone string already contains a leading '+', extract digits.
//    - Validate minimum & maximum international E.164 length (8 to 15 digits).
//    - Specific known patterns:
//      * US/Canada (+1): +1 followed by 10 digits -> +1XXXXXXXXXX (11 digits total).
//      * Brazil (+55): +55 followed by 10 or 11 digits -> +55XXXXXXXXXX(X) (12 or 13 digits).
//      * Other international: + followed by 8 to 15 digits.
// 2. Ambiguous Local / No Country Code:
//    - If the number does NOT start with '+', do NOT guess or fabricate country.
//    - Preserve phone_raw verbatim.
//    - Set phone_e164 to null and mark as ambiguous.
//    - Awaiting client decision for default country fallback rules.
// =============================================================================

export interface PhoneParseResult {
  phone_raw: string | null;
  phone_e164: string | null;
  isValidE164: boolean;
  countryCode: string | null;
  isAmbiguous: boolean;
  formattedDisplay: string | null;
}

/**
 * Normalizes an incoming raw phone string safely without inventing country codes.
 */
export function normalizePhoneSafe(rawInput?: string | null): PhoneParseResult {
  if (!rawInput || !rawInput.trim()) {
    return {
      phone_raw: null,
      phone_e164: null,
      isValidE164: false,
      countryCode: null,
      isAmbiguous: false,
      formattedDisplay: null,
    };
  }

  const phone_raw = rawInput.trim();
  const digitsOnly = phone_raw.replace(/\D/g, '');

  // 1. Check for explicit international prefix (+)
  if (phone_raw.startsWith('+')) {
    if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
      const e164Candidate = `+${digitsOnly}`;

      // Detect known country prefixes safely
      let countryCode: string | null = null;
      if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
        countryCode = 'US/CA';
      } else if (digitsOnly.startsWith('55') && (digitsOnly.length === 12 || digitsOnly.length === 13)) {
        countryCode = 'BR';
      } else if (digitsOnly.length >= 8) {
        countryCode = 'INTL';
      }

      return {
        phone_raw,
        phone_e164: e164Candidate,
        isValidE164: true,
        countryCode,
        isAmbiguous: false,
        formattedDisplay: formatE164Display(e164Candidate, countryCode),
      };
    }
  }

  // 2. Ambiguous / Local number without (+)
  // Strictly preserve raw, do NOT guess or inject country code
  return {
    phone_raw,
    phone_e164: null,
    isValidE164: false,
    countryCode: null,
    isAmbiguous: true,
    formattedDisplay: phone_raw,
  };
}

/**
 * Formats known E.164 phone numbers for clean UI presentation.
 */
function formatE164Display(e164: string, countryCode: string | null): string {
  const digits = e164.replace(/\D/g, '');

  if (countryCode === 'US/CA' && digits.length === 11) {
    // +1 (AAA) NNN-NNNN
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (countryCode === 'BR') {
    if (digits.length === 13) {
      // +55 (DD) 9NNNN-NNNN (Mobile)
      return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    if (digits.length === 12) {
      // +55 (DD) NNNN-NNNN (Landline)
      return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }
  }

  return e164;
}
