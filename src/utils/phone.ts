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
//      * UK (+44): +44 followed by 10 digits -> +44XXXXXXXXXX (12 digits total).
//      * Other international: + followed by 8 to 15 digits.
// 2. Unambiguous International Calling Codes Without (+):
//    - UK: 12 digits starting with '44' -> +44XXXXXXXXXX (unambiguous UK).
//    - Brazil: 12 or 13 digits starting with '55' -> +55XXXXXXXXXXX (unambiguous BR).
//    - USA/Canada: 11 digits starting with '1' and area code [2-9] -> +1XXXXXXXXXX (unambiguous US).
//    - International '00' dialing prefix: '00' + 8-15 digits -> +{digits}.
// 3. Ambiguous Local / No Country Code:
//    - If the number does NOT start with '+' and cannot be unambiguously resolved,
//      do NOT guess or fabricate country.
//    - Preserve phone_raw verbatim.
//    - Set phone_e164 to null and mark as ambiguous.
// =============================================================================

export interface PhoneParseResult {
  phone_raw: string | null;
  phone_e164: string | null;
  isValidE164: boolean;
  countryCode: string | null;
  isAmbiguous: boolean;
  formattedDisplay: string | null;
}

export interface PhoneNormalizationOptions {
  sourceCountry?: string | null; // e.g. 'BR', 'UK', 'GB', 'US', 'CA'
}

/**
 * Normalizes an incoming raw phone string safely without inventing country codes.
 * - Explicit '+' numbers are parsed and validated as E.164.
 * - Raw numbers without '+' are preserved verbatim unless reliable source country metadata confirms country.
 * - Brazilian DDDs or national codes are never interpreted as international calling codes blindly.
 */
export function normalizePhoneSafe(
  rawInput?: string | null,
  options?: PhoneNormalizationOptions
): PhoneParseResult {
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
      } else if (digitsOnly.startsWith('44') && (digitsOnly.length === 11 || digitsOnly.length === 12)) {
        countryCode = 'UK';
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

  // 2. Check for international '00' dialing prefix (e.g. 00447833252393)
  if (phone_raw.startsWith('00') && digitsOnly.startsWith('00')) {
    const stripped00 = digitsOnly.slice(2);
    if (stripped00.length >= 8 && stripped00.length <= 15) {
      const e164Candidate = `+${stripped00}`;
      let countryCode = 'INTL';
      if (stripped00.startsWith('1') && stripped00.length === 11) {
        countryCode = 'US/CA';
      } else if (stripped00.startsWith('55') && (stripped00.length === 12 || stripped00.length === 13)) {
        countryCode = 'BR';
      } else if (stripped00.startsWith('44') && (stripped00.length === 11 || stripped00.length === 12)) {
        countryCode = 'UK';
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

  // 3. Country-Assisted Normalization (ONLY if reliable source country metadata exists)
  const normSourceCountry = (options?.sourceCountry || '').trim().toUpperCase();
  if (normSourceCountry) {
    // UK confirmed by source metadata (e.g. country field from HubSpot or form)
    if (normSourceCountry === 'UK' || normSourceCountry === 'GB') {
      if (digitsOnly.startsWith('44') && digitsOnly.length === 12) {
        const e164Candidate = `+${digitsOnly}`;
        return {
          phone_raw,
          phone_e164: e164Candidate,
          isValidE164: true,
          countryCode: 'UK',
          isAmbiguous: false,
          formattedDisplay: formatE164Display(e164Candidate, 'UK'),
        };
      }
      if (digitsOnly.length === 10 && digitsOnly.startsWith('7')) {
        const e164Candidate = `+44${digitsOnly}`;
        return {
          phone_raw,
          phone_e164: e164Candidate,
          isValidE164: true,
          countryCode: 'UK',
          isAmbiguous: false,
          formattedDisplay: formatE164Display(e164Candidate, 'UK'),
        };
      }
    }

    // Brazil confirmed by source metadata
    if (normSourceCountry === 'BR' || normSourceCountry === 'BRAZIL' || normSourceCountry === 'BRASIL') {
      if (digitsOnly.startsWith('55') && (digitsOnly.length === 12 || digitsOnly.length === 13)) {
        const e164Candidate = `+${digitsOnly}`;
        return {
          phone_raw,
          phone_e164: e164Candidate,
          isValidE164: true,
          countryCode: 'BR',
          isAmbiguous: false,
          formattedDisplay: formatE164Display(e164Candidate, 'BR'),
        };
      }
      if (digitsOnly.length === 10 || digitsOnly.length === 11) {
        const e164Candidate = `+55${digitsOnly}`;
        return {
          phone_raw,
          phone_e164: e164Candidate,
          isValidE164: true,
          countryCode: 'BR',
          isAmbiguous: false,
          formattedDisplay: formatE164Display(e164Candidate, 'BR'),
        };
      }
    }

    // US/Canada confirmed by source metadata
    if (normSourceCountry === 'US' || normSourceCountry === 'USA' || normSourceCountry === 'CA' || normSourceCountry === 'CANADA') {
      if (digitsOnly.startsWith('1') && digitsOnly.length === 11 && /^[2-9]/.test(digitsOnly.slice(1))) {
        const e164Candidate = `+${digitsOnly}`;
        return {
          phone_raw,
          phone_e164: e164Candidate,
          isValidE164: true,
          countryCode: 'US/CA',
          isAmbiguous: false,
          formattedDisplay: formatE164Display(e164Candidate, 'US/CA'),
        };
      }
      if (digitsOnly.length === 10 && /^[2-9]/.test(digitsOnly)) {
        const e164Candidate = `+1${digitsOnly}`;
        return {
          phone_raw,
          phone_e164: e164Candidate,
          isValidE164: true,
          countryCode: 'US/CA',
          isAmbiguous: false,
          formattedDisplay: formatE164Display(e164Candidate, 'US/CA'),
        };
      }
    }
  }

  // 4. Raw Number Without Reliable Country Context:
  // Strictly preserve incoming factual value verbatim.
  // DO NOT blindly prepend '+'.
  // DO NOT assume country solely from starting digits.
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
 * Resolves the destination phone number for native SMS links (sms: URI) and external actions.
 * - If lead has an explicit valid E.164 phone (+), preserves and uses it with '+'.
 * - If phone_raw has '+', preserves and uses it with '+'.
 * - If phone is a raw number without '+', uses the factual raw digits WITHOUT inventing '+'.
 * - Never strips an existing '+' and never blindly inserts '+' at click time.
 */
export function resolveSmsDestinationPhone(
  leadOrPhone?: { phone_e164?: string | null; phone_raw?: string | null } | string | null
): string {
  if (!leadOrPhone) return '';

  let phoneE164: string | null = null;
  let phoneRaw: string | null = null;

  if (typeof leadOrPhone === 'string') {
    phoneRaw = leadOrPhone.trim();
  } else {
    phoneE164 = leadOrPhone.phone_e164?.trim() || null;
    phoneRaw = leadOrPhone.phone_raw?.trim() || null;
  }

  // 1. If explicit valid phone_e164 exists with leading '+', return it directly with '+'
  if (phoneE164 && phoneE164.startsWith('+')) {
    const digits = phoneE164.replace(/\D/g, '');
    if (digits.length >= 8) {
      return `+${digits}`;
    }
  }

  // 2. If phoneRaw starts with '+', keep '+' and extract digits
  if (phoneRaw && phoneRaw.startsWith('+')) {
    const digits = phoneRaw.replace(/\D/g, '');
    if (digits.length >= 8) {
      return `+${digits}`;
    }
  }

  // 3. Fallback: preserve factual raw value / digits verbatim WITHOUT adding '+'
  if (phoneRaw) {
    const digits = phoneRaw.replace(/\D/g, '');
    return digits || phoneRaw;
  }

  return '';
}

/**
 * Formats known E.164 phone numbers for clean UI presentation.
 */
export function formatE164Display(e164: string, countryCode: string | null): string {
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

  if (countryCode === 'UK' && digits.length === 12) {
    // +44 7833 252393
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }

  return e164;
}
