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
 * Ensures only genuine, human-like names are used in greetings.
 * If first_name is missing, empty, whitespace, an acronym/code (e.g. "WED"),
 * a placeholder (e.g. "Doutor(a)"), or a technical value, it returns the canonical fallback ("Doctor").
 */
export function resolveSafeFirstName(
  firstName: string | null | undefined,
  fallback: string = 'Doctor'
): string {
  if (!firstName || typeof firstName !== 'string') return fallback;
  const trimmed = firstName.trim();
  if (!trimmed || trimmed.length < 2) return fallback;

  // Reject strings with digits or technical characters
  if (/[0-9_@#$%^&*()+=<>{}[\]|\\/~`!?]/.test(trimmed)) {
    return fallback;
  }

  const lower = trimmed.toLowerCase();

  // 1. Placeholder & Role Blacklist
  const placeholders = new Set([
    'doutor(a)',
    'doutora',
    'doutor',
    'dr(a)',
    'dr(a).',
    'dr.',
    'dra.',
    'dr',
    'dra',
    'doctor',
    'undefined',
    'null',
    'n/a',
    'none',
    'teste',
    'test',
    'lead',
    'contato',
    'contact',
    'user',
    'usuario',
    'admin',
    'cliente',
    'aluno',
    'paciente',
    'info',
    'sac',
    'crm',
    'dev',
    'api',
    'bot',
  ]);

  if (placeholders.has(lower)) {
    return fallback;
  }

  // 2. Calendar / Day-of-week abbreviations (English & Portuguese)
  const calendarAbbreviations = new Set([
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
    'seg',
    'ter',
    'qua',
    'qui',
    'sex',
    'sab',
    'dom',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]);

  if (calendarAbbreviations.has(lower)) {
    return fallback;
  }

  // 3. Technical Acronyms: All-caps short words without lower case that are not standard names
  const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length <= 4;
  if (isAllCaps) {
    const commonAllCapsNames = new Set(['ANA', 'MAX', 'LEO', 'EVA', 'ROY', 'GUY', 'IAN']);
    if (!commonAllCapsNames.has(trimmed)) {
      return fallback;
    }
  }

  // 4. Must contain at least one vowel
  if (!/[aeiouyáàâãéèêíïóôõöúü]/i.test(trimmed)) {
    return fallback;
  }

  // Normalize casing if all uppercase (e.g. "ANA" -> "Ana")
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
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

const SURNAME_BLACKLIST = new Set([
  'doutor(a)',
  'doutora',
  'doutor',
  'dr(a)',
  'dr(a).',
  'dr.',
  'dra.',
  'dr',
  'dra',
  'doctor',
  'undefined',
  'null',
  'n/a',
  'none',
  'teste',
  'test',
  'lead',
  'contato',
  'contact',
  'user',
  'usuario',
  'admin',
  'cliente',
  'aluno',
  'paciente',
  'info',
  'sac',
  'crm',
  'dev',
  'api',
  'bot',
  'blank',
  'xxxxx',
  'xxxx',
  'xxx',
  '-',
  '--',
]);

function isValidSurnameCandidate(candidate: string): boolean {
  if (!candidate || candidate.length < 2) return false;
  if (/[0-9_@#$%^&*()+=<>{}[\]|\\/~`!?]/.test(candidate)) return false;
  const lower = candidate.toLowerCase();
  if (SURNAME_BLACKLIST.has(lower)) return false;
  if (!/[aeiouyáàâãéèêíïóôõöúü]/i.test(candidate)) return false;
  return true;
}

function formatSurname(candidate: string): string {
  if (candidate.includes('-')) {
    return candidate
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('-');
  }
  return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
}

/**
 * Resolves and validates a lead's factual surname (last name).
 * If a valid surname exists, returns the properly capitalized surname.
 * If invalid, placeholder, single first name, empty, or missing, returns null.
 */
export function resolveSafeLastName(
  lastName: string | null | undefined,
  fullNameOrFirst?: string | null | undefined
): string | null {
  // 1. Try explicit last_name field first
  if (lastName && typeof lastName === 'string') {
    const trimmed = lastName.trim();
    if (trimmed.length >= 2 && !/[0-9_@#$%^&*()+=<>{}[\]|\\/~`!?]/.test(trimmed)) {
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const candidate = parts[parts.length - 1];
      if (isValidSurnameCandidate(candidate)) {
        return formatSurname(candidate);
      }
    }
  }

  // 2. If no valid last_name, try extracting from full name if present
  if (fullNameOrFirst && typeof fullNameOrFirst === 'string') {
    const trimmed = fullNameOrFirst.trim();
    if (trimmed.length >= 2 && !/[0-9_@#$%^&*()+=<>{}[\]|\\/~`!?]/.test(trimmed)) {
      const parts = trimmed.split(/\s+/).filter(Boolean);
      // Only extract if there are at least 2 tokens (first name + surname)
      if (parts.length >= 2) {
        const candidate = parts[parts.length - 1];
        if (isValidSurnameCandidate(candidate)) {
          return formatSurname(candidate);
        }
      }
    }
  }

  return null;
}

/**
 * Resolves the canonical Zygomatic salutation.
 * Rule:
 * If valid factual surname can be resolved: "Hello Dr. [LAST NAME]"
 * If surname cannot be safely resolved: STRICTLY "Hello Doctor"
 * Never returns "Hello Dr.", "Hello Dr. undefined", "Hello Dr. null", "Hello Dr. -", "Hello Dr. xxxxx"
 */
export function resolveZygomaticSalutation(
  leadOrLastName?: any,
  firstNameOrFullName?: string | null | undefined
): string {
  let lastName: string | null | undefined = null;
  let fullName: string | null | undefined = null;

  if (leadOrLastName && typeof leadOrLastName === 'object') {
    lastName = leadOrLastName.last_name ?? leadOrLastName.lastName;
    fullName = leadOrLastName.full_name ?? leadOrLastName.fullName ?? leadOrLastName.name;
    if (!fullName && leadOrLastName.first_name) {
      fullName = `${leadOrLastName.first_name} ${lastName || ''}`.trim();
    }
  } else if (typeof leadOrLastName === 'string') {
    lastName = leadOrLastName;
    fullName = firstNameOrFullName;
  }

  const safeSurname = resolveSafeLastName(lastName, fullName);
  if (safeSurname) {
    return `Hello Dr. ${safeSurname}`;
  }

  return 'Hello Doctor';
}

/**
 * Returns the exact approved plain text copy for the Zygomatic Course Details email.
 */
export function getApprovedZygomaticText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveZygomaticSalutation(leadOrSalutation);
  }

  return `${salutationLine}

Thank you for your interest in our course!

The goal of our Zygomatic Implant Course is to help you learn or improve your skills in Zygomatic, Pterygoids, Transnasal and Trans-Sinus implants.

This is a four day course:
• One day of theory and hands-on practice
• Three intensive SURGICAL DAYS ON REAL PATIENTS under IV sedation
• One-on-one mentorship throughout the entire course

Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.

Upcoming Course Date:
November 7-10, 2026

Tuition: $17,500

Our course includes:
• Accommodation in a four-star hotel with daily breakfast
• Lunch during the training days
• Transportation between airport, hotel, and university
• A traditional Brazilian dinner on the final evening

Participants will also receive 36 CE credits PACE approved, and we offer flexible interest-free payment plans.

Please see the attached PDF for detailed information of this course.

If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.

You can also hear directly from dentists who have already trained with us. Visit our website to watch participant testimonials and learn more about their experience with Expert Dental Solutions.

https://www.expdentalsolutions.com/course/zygomatic-implant-training

We look forward to welcoming you to this unique experience.

Sincerely,

Natalia

Expert Dental Solutions`;
}

/**
 * Returns the exact approved HTML copy for the Zygomatic Course Details email.
 */
export function getApprovedZygomaticHtml(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveZygomaticSalutation(leadOrSalutation);
  }

  return `<p>${salutationLine}</p>
<p>Thank you for your interest in our course!</p>
<p>The goal of our <b>Zygomatic Implant Course</b> is to help you learn or improve your skills in Zygomatic, Pterygoids, Transnasal and Trans-Sinus implants.</p>
<p>This is a four day course:<br/>
• One day of theory and hands-on practice<br/>
• Three intensive <b>SURGICAL DAYS ON REAL PATIENTS</b> under IV sedation<br/>
• One-on-one mentorship throughout the entire course</p>
<p>Each course takes place in a implant center at a University in <b>Rio de Janeiro, Brazil</b>. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.</p>
<p><b>Upcoming Course Date:</b><br/>
<b>November 7-10, 2026</b></p>
<p><b>Tuition: $17,500</b></p>
<p><b>Our course includes:</b><br/>
• Accommodation in a four-star hotel with daily breakfast<br/>
• Lunch during the training days<br/>
• Transportation between airport, hotel, and university<br/>
• A traditional Brazilian dinner on the final evening</p>
<p>Participants will also receive <b>36 CE credits PACE approved</b>, and we offer <b>flexible interest-free payment plans</b>.</p>
<p>Please see the attached PDF for detailed information of this course.</p>
<p>If you would like to discuss details or have questions, we can schedule a <b>call with our course coordinator</b> at your convenience.</p>
<p>You can also hear directly from dentists who have already trained with us. Visit our website to watch <b>participant testimonials</b> and learn more about their experience with Expert Dental Solutions.</p>
<p><a href="https://www.expdentalsolutions.com/course/zygomatic-implant-training" style="color: #2563eb; text-decoration: underline;" target="_blank" rel="noopener noreferrer">https://www.expdentalsolutions.com/course/zygomatic-implant-training</a></p>
<p>We look forward to welcoming you to this unique experience.</p>
<p>Sincerely,<br/>
Natalia<br/>
Expert Dental Solutions</p>`;
}

