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
 * Resolves the canonical doctor salutation for approved email templates.
 * Rule:
 * If valid factual surname can be resolved: "[prefix] Dr. [LAST NAME]"
 * If surname cannot be safely resolved: STRICTLY "[prefix] Doctor"
 * Never returns "[prefix] Dr.", "[prefix] Dr. undefined", "[prefix] Dr. null", "[prefix] Dr. -", "[prefix] Dr. xxxxx"
 */
export function resolveDoctorSalutation(
  prefix: 'Hi' | 'Hello',
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
    return `${prefix} Dr. ${safeSurname}`;
  }

  return `${prefix} Doctor`;
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
  return resolveDoctorSalutation('Hello', leadOrLastName, firstNameOrFullName);
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

/**
 * Returns the exact approved SMS copy for the initial contact message ("Contato SMS inicial").
 * Uses canonical doctor salutation:
 * - Valid surname: "Hello Dr. [LAST NAME]"
 * - No valid surname: "Hello Doctor"
 * Never renders "Hello Dr.", "Hello Dr. null", "Hello Dr. undefined", or "Hello Dr. xxxxx".
 */
export function getApprovedZygomaticSmsText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

This is Natália from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings on November 7 to 10, 2026 and March 1 to 4, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;
}

/**
 * Returns the exact approved SMS copy for Intensive + Advanced Implant ("Contato SMS inicial — Intensive + Advanced").
 */
export function getApprovedIntensiveAdvancedSmsText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

This is Natália from Expert Dental Solutions. Thank you for your interest in our Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings on November 11 to 14, 2026 and February 24 to 27, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;
}

/**
 * Returns the exact approved SMS copy for Endodontics ("Contato SMS inicial — Endodontics").
 */
export function getApprovedEndodonticsSmsText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

This is Natália from Expert Dental Solutions. Thank you for your interest in our Endodontic Training in Brazil.

I just sent you an email with all the course details.

We currently have openings for our April 26 to 29 course. Would those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;
}

/**
 * Returns the exact approved SMS copy for Wisdom ("Contato SMS inicial — Wisdom").
 */
export function getApprovedWisdomSmsText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

This is Natália from Expert Dental Solutions. Thank you for your interest in our Wisdom Teeth Training in Brazil.

I just sent you an email with all the course details.

We currently have openings on November 7 to 10, 2026 and March 1 to 4, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;
}

/**
 * Returns the exact approved SMS copy for Rehabilitation ("Contato SMS inicial — Rehabilitation").
 */
export function getApprovedRehabilitationSmsText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

This is Natália from Expert Dental Solutions. Thank you for your interest in our Implant Rehabilitation Training in Brazil.

I just sent you an email with all the course details.

We currently have openings on November 7 to 10, 2026 and March 1 to 4, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;
}

/**
 * Returns the exact approved SMS copy for Periodontal Plastic ("Contato SMS inicial — Periodontal Plastic").
 */
export function getApprovedPeriodontalSmsText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

This is Natália from Expert Dental Solutions. Thank you for your interest in our Periodontal Plastic Surgery Training in Brazil.

I just sent you an email with all the course details.

We currently have openings on November 7 to 10, 2026 and March 1 to 4, 2027. Would either of those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;
}

export interface ApprovedSmsTemplatePackage {
  templateKey: string;
  displayName: string;
  getText: (leadOrSalutation?: any) => string;
}

export const APPROVED_SMS_TEMPLATES: Record<string, ApprovedSmsTemplatePackage> = {
  intensive_advanced_followup_sms: {
    templateKey: 'intensive_advanced_followup_sms',
    displayName: 'Contato SMS inicial — Intensive + Advanced',
    getText: getApprovedIntensiveAdvancedSmsText,
  },
  endodontics_followup_sms: {
    templateKey: 'endodontics_followup_sms',
    displayName: 'Contato SMS inicial — Endodontics',
    getText: getApprovedEndodonticsSmsText,
  },
  zygomatic_followup_sms: {
    templateKey: 'zygomatic_followup_sms',
    displayName: 'Contato SMS inicial — Zygomatic',
    getText: getApprovedZygomaticSmsText,
  },
  wisdom_followup_sms: {
    templateKey: 'wisdom_followup_sms',
    displayName: 'Contato SMS inicial — Wisdom',
    getText: getApprovedWisdomSmsText,
  },
  rehabilitation_followup_sms: {
    templateKey: 'rehabilitation_followup_sms',
    displayName: 'Contato SMS inicial — Rehabilitation',
    getText: getApprovedRehabilitationSmsText,
  },
  periodontal_followup_sms: {
    templateKey: 'periodontal_followup_sms',
    displayName: 'Contato SMS inicial — Periodontal Plastic',
    getText: getApprovedPeriodontalSmsText,
  },
};

// =============================================================================
// APPROVED COURSE EMAIL GENERATORS (PERIODONTAL, ENDODONTICS, IMPLANT, WISDOM, REHABILITATION)
// =============================================================================

/**
 * Returns the exact approved plain text copy for the Periodontal Plastic email.
 */
export function getApprovedPeriodontalText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hi Dr.') || leadOrSalutation === 'Hi Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hi', leadOrSalutation);
  }

  return `${salutationLine}

Thank you for your interest in our courses!

Our Periodontal Plastic Surgery Intensive Training is a 4-Day Hands-On Program with Live Patients, designed to build your skills and confidence in advanced periodontal and peri-implant techniques. From connective tissue grafting to root coverage and aesthetic flap designs, you’ll work directly with patients under expert supervision, mastering the procedures step-by-step.

Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.

Our courses are highly exclusive, with a maximum of ten doctors per session, providing an intimate learning environment.

UPCOMING 2026 DATE

November 7 to 10 2026 | Rio de Janeiro

TUITION: $9,900

UPCOMING 2027 DATE

March 1 to 4, 2027 | Rio de Janeiro

TUITION: $9,900

Early Bird: $400 OFF

Available for the March course through December 31, 2026.

Our course fee includes:

• Accommodation in a four-star hotel with breakfast
• Lunch during the course
• Transportation between the airport, hotel, and university
• A Brazilian dinner on the final day

Our course offer 36 CE credits.

We also offer flexible interest-free payment plans options.

Please see the attached PDF for detailed information of this course.

Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, Dr. Mourao, at your convenience.

Best regards,

Natalia

Expert Dental Solutions`;
}

/**
 * Returns the exact approved HTML copy for the Periodontal Plastic email.
 */
export function getApprovedPeriodontalHtml(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hi Dr.') || leadOrSalutation === 'Hi Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hi', leadOrSalutation);
  }

  return `<p>${salutationLine}</p>
<p>Thank you for your interest in our courses!</p>
<p>Our <b>Periodontal Plastic Surgery Intensive Training</b> is a 4-Day Hands-On Program with Live Patients, designed to build your skills and confidence in advanced periodontal and peri-implant techniques. From connective tissue grafting to root coverage and aesthetic flap designs, you’ll work directly with patients under expert supervision, mastering the procedures step-by-step.</p>
<p>Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.</p>
<p>Our courses are highly exclusive, with a maximum of ten doctors per session, providing an intimate learning environment.</p>
<p><b>UPCOMING 2026 DATE</b></p>
<p>November 7 to 10 2026 | Rio de Janeiro</p>
<p><b>TUITION: $9,900</b></p>
<p><b>UPCOMING 2027 DATE</b></p>
<p>March 1 to 4, 2027 | Rio de Janeiro</p>
<p><b>TUITION: $9,900</b></p>
<p><b>Early Bird: $400 OFF</b></p>
<p>Available for the March course through December 31, 2026.</p>
<p><b>Our course fee includes:</b></p>
<p>• Accommodation in a four-star hotel with breakfast<br/>
• Lunch during the course<br/>
• Transportation between the airport, hotel, and university<br/>
• A Brazilian dinner on the final day</p>
<p><b>Our course offer 36 CE credits.</b></p>
<p>We also offer <b>flexible interest-free payment plans options.</b></p>
<p>Please see the attached PDF for detailed information of this course.</p>
<p>Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, Dr. Mourao, at your convenience.</p>
<p>Best regards,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>`;
}

/**
 * Returns the exact approved plain text copy for the Endodontics email.
 */
export function getApprovedEndodonticText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hi Dr.') || leadOrSalutation === 'Hi Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hi', leadOrSalutation);
  }

  return `${salutationLine}

Thank you for your interest in our Endodontics Intensive Clinical Training.

This program is designed for dentists who want a true high-level clinical immersion in molar endodontics, working directly on live patients with expert mentorship.

What makes this training unique:

• Real patient treatment during all 4 days of the course
• Direct one-on-one mentorship during your procedures
• Experience with multiple rotary and reciprocating systems
• Practice different obturation techniques to refine your workflow
• Customized clinical cases selected according to your experience level
• Highly exclusive program – limited to 8 doctors.
• Lectures will be given through zoom before the training in Brazil

Over 4 intensive days in Rio de Janeiro - Brazil, participants are able to complete multiple molar root canal treatments, gaining confidence in diagnosis, instrumentation, obturation, and management of clinical challenges — all in a fully supervised clinical environment.

📅 Upcoming Date

April 26-29, 2027

💳 Tuition: USD 9,600

🎯 Early bird: USD 500 off if registered by

November 30

The experience also includes:

• 4-star hotel accommodation with breakfast
• Lunch during course days
• Transportation between airport, hotel, and clinic
• Brazilian farewell dinner on the final evening
• 35 CE credits PACE approved

We also offer flexible interest-free payment plans options.

After registration, we schedule a Zoom call with our coordinators to understand your goals and select the most appropriate clinical cases for your training.

Please see the attached PDF for detailed information of this course.

If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.

Best regards,

Natalia

Expert Dental Solutions`;
}

/**
 * Returns the exact approved HTML copy for the Endodontics email.
 */
export function getApprovedEndodonticHtml(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hi Dr.') || leadOrSalutation === 'Hi Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hi', leadOrSalutation);
  }

  return `<p>${salutationLine}</p>
<p>Thank you for your interest in our Endodontics Intensive Clinical Training.</p>
<p>This program is designed for dentists who want a true high-level clinical immersion in molar endodontics, working directly on <b>live patients with expert mentorship</b>.</p>
<p>What makes this training <b>unique</b>:</p>
<p>• <b>Real patient</b> treatment during all 4 days of the course<br/>
• Direct <b>one-on-one mentorship</b> during your procedures<br/>
• Experience with multiple rotary and reciprocating systems<br/>
• Practice different obturation techniques to refine your workflow<br/>
• <b>Customized clinical cases</b> selected according to your experience level<br/>
• <b>Highly exclusive program</b> – limited to 8 doctors.<br/>
• Lectures will be given through zoom before the training in Brazil</p>
<p>Over <b>4 intensive days</b> in Rio de Janeiro - Brazil, participants are able to complete multiple molar root canal treatments, gaining confidence in diagnosis, instrumentation, obturation, and management of clinical challenges — all in a fully supervised clinical environment.</p>
<p>📅 Upcoming Date</p>
<p>April 26-29, 2027</p>
<p>💳 Tuition: USD 9,600</p>
<p>🎯 Early bird: USD 500 off if registered by</p>
<p>November 30</p>
<p><b>The experience also includes:</b></p>
<p>• 4-star hotel accommodation with breakfast<br/>
• Lunch during course days<br/>
• Transportation between airport, hotel, and clinic<br/>
• Brazilian farewell dinner on the final evening<br/>
• <b>35 CE credits PACE approved</b></p>
<p>We also offer <b>flexible interest-free payment plans options.</b></p>
<p>After registration, we schedule a Zoom call with our coordinators to understand your goals and select the most appropriate clinical cases for your training.</p>
<p>Please see the attached PDF for detailed information of this course.</p>
<p>If you would like to discuss details or have questions, we can schedule a <b>call with our course coordinator</b> at your convenience.</p>
<p>Best regards,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>`;
}

/**
 * Returns the exact approved plain text copy for the Intensive + Advanced Implant shared email.
 */
export function getApprovedImplantText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

Thank you for your interest in our Dental Implant Courses in Rio de Janeiro, Brazil.

What makes our courses different is the opportunity to gain real clinical experience with Real Patient Surgeries, One-on-One Mentorship, and training that is 100% customized to your goals and experience level.

We offer two implant courses:

INTENSIVE DENTAL IMPLANT COURSE

Designed for beginner and intermediate dentists who want to build confidence in implant placement.

• Place at least 20 implants on real patients
• You are the main surgeon from start to finish
• One-on-one mentorship throughout the clinical experience
• Cases selected according to your experience and goals

ADVANCED IMPLANT EXPERIENCE

Designed for dentists who want to advance their skills in more complex implant procedures.

• Perform complex surgeries on real patients
• Training is 100% customized to your clinical goals
• Procedures may include sinus lifts, ridge splits, GBR with implant placement, All-on-X, and other advanced cases
• One-on-one mentorship throughout your surgeries

100% CUSTOMIZED EXPERIENCE

After registration, we schedule a Zoom meeting with our coordinators to learn about your experience, goals, and the procedures you would like to focus on.

Our team then selects your patients and clinical cases specifically around those goals.

REAL PATIENT ONE-ON-ONE MENTORSHIP

During the clinical days, you are not rotating between observing, assisting, and operating. You are the main surgeon for your cases, with an experienced instructor by your side providing one-on-one guidance throughout the procedure.

Our courses are intentionally small, with a maximum of 6 participants per course, allowing us to provide a highly personalized clinical experience.

MENTORSHIP DOESN’T END WHEN THE COURSE ENDS

As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.

UPCOMING 2026 DATE

November 11 to 14, 2026 | Rio de Janeiro

TUITION

Intensive Dental Implant Course: $9,400

Advanced Implant Experience: $9,900

UPCOMING 2027 DATE

February 24 to 27, 2027 | Rio de Janeiro

TUITION

Intensive Dental Implant Course: $9,700

Advanced Implant Experience: $10,200

Early Bird: $600 OFF

Available for the February course through December 31, 2026.

YOUR COURSE PACKAGE INCLUDES

• Four-star hotel accommodations with breakfast
• Lunch during the course
• Airport, hotel, and university transportation
• Brazilian dinner on the final day
• 32 CE credits AGD PACE Approved

We also offer flexible interest-free payment plans.

Please see the attached PDF for more detailed information about each course.

If you have any questions, I’d be happy to help. I can also arrange a call with our coordinator, so you can discuss your experience, goals, and which course would be the best fit for you.

Best,

Natalia

Expert Dental Solutions`;
}

/**
 * Returns the exact approved HTML copy for the Intensive + Advanced Implant shared email.
 */
export function getApprovedImplantHtml(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `<p>${salutationLine}</p>
<p>Thank you for your interest in our Dental Implant Courses in Rio de Janeiro, Brazil.</p>
<p>What makes our courses different is the opportunity to gain real clinical experience with <b>Real Patient Surgeries, One-on-One Mentorship, and training that is 100% customized to your goals and experience level.</b></p>
<p>We offer two implant courses:</p>
<p><b>INTENSIVE DENTAL IMPLANT COURSE</b></p>
<p>Designed for beginner and intermediate dentists who want to build confidence in implant placement.</p>
<p>• Place <b>at least 20 implants on real patients</b><br/>
• You are the <b>main surgeon from start to finish</b><br/>
• One-on-one mentorship throughout the clinical experience<br/>
• Cases selected according to your experience and goals</p>
<p><b>ADVANCED IMPLANT EXPERIENCE</b></p>
<p>Designed for dentists who want to advance their skills in more complex implant procedures.</p>
<p>• Perform <b>complex surgeries on real patients</b><br/>
• Training is <b>100% customized to your clinical goals</b><br/>
• Procedures may include sinus lifts, ridge splits, GBR with implant placement, All-on-X, and other advanced cases<br/>
• One-on-one mentorship throughout your surgeries</p>
<p><b>100% CUSTOMIZED EXPERIENCE</b></p>
<p>After registration, we schedule a Zoom meeting with our coordinators to learn about your experience, goals, and the procedures you would like to focus on.</p>
<p>Our team then selects your patients and clinical cases specifically around those goals.</p>
<p><b>REAL PATIENT ONE-ON-ONE MENTORSHIP</b></p>
<p>During the clinical days, you are not rotating between observing, assisting, and operating. <b>You are the main surgeon for your cases</b>, with an experienced instructor by your side providing one-on-one guidance throughout the procedure.</p>
<p>Our courses are intentionally small, with a maximum of <b>6 participants per course</b>, allowing us to provide a highly personalized clinical experience.</p>
<p><b>MENTORSHIP DOESN’T END WHEN THE COURSE ENDS</b></p>
<p>As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.</p>
<p><b>UPCOMING 2026 DATE</b></p>
<p>November 11 to 14, 2026 | Rio de Janeiro</p>
<p><b>TUITION</b></p>
<p>Intensive Dental Implant Course: <b>$9,400</b></p>
<p>Advanced Implant Experience: <b>$9,900</b></p>
<p><b>UPCOMING 2027 DATE</b></p>
<p>February 24 to 27, 2027 | Rio de Janeiro</p>
<p><b>TUITION</b></p>
<p>Intensive Dental Implant Course: <b>$9,700</b></p>
<p>Advanced Implant Experience: <b>$10,200</b></p>
<p><b>Early Bird: $600 OFF</b></p>
<p>Available for the February course through December 31, 2026.</p>
<p><b>YOUR COURSE PACKAGE INCLUDES</b></p>
<p>• Four-star hotel accommodations with breakfast<br/>
• Lunch during the course<br/>
• Airport, hotel, and university transportation<br/>
• Brazilian dinner on the final day<br/>
• 32 CE credits AGD PACE Approved</p>
<p>We also offer <b>flexible interest-free payment plans.</b></p>
<p>Please see the attached PDF for more detailed information about each course.</p>
<p>If you have any questions, I’d be happy to help. I can also arrange a call with our coordinator, so you can discuss your experience, goals, and which course would be the best fit for you.</p>
<p>Best,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>`;
}

/**
 * Returns the exact approved plain text copy for the Wisdom Surgery email.
 */
export function getApprovedWisdomText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `${salutationLine}

Thank you for your interest in our Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!

This is a 4-day intensive clinical course with real patients, designed to give you extensive surgical experience with one-on-one mentorship throughout the entire course.

REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON

During the course, you will:

• Perform at least 16 wisdom teeth extractions on real patients
• Work with fully impacted, partially impacted, and erupted wisdom teeth
• Be the main surgeon from start to finish during all your procedures
• Receive one-on-one mentorship, with your instructor by your side throughout every procedure, assisting you while you perform the extraction
• Train with cases customized to your experience level and clinical goals

100% CUSTOMIZED TO YOUR GOALS

After registration, we schedule a Zoom meeting with our coordinators to discuss your experience, goals, and the types of cases you would like to focus on. Based on this meeting, our team selects patients and cases specifically for your training.

The course takes place at a Federal University in Rio de Janeiro, Brazil, with a maximum of 6 doctors per session to maintain a highly personalized clinical experience.

MENTORSHIP DOESN’T END WHEN THE COURSE ENDS

As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.

NEXT COURSES

November 7–10, 2026

March 1-4, 2027

TUITION

USD 8,200

YOUR COURSE PACKAGE INCLUDES

• Four-star hotel accommodation with breakfast
• Lunch during the course
• Transportation between the airport, hotel, and university
• Brazilian dinner on the final day
• 36 PACE-approved CE credits

We also offer flexible, interest-free payment plan options.

Please see the attached PDF for additional course details.

Please feel free to reach out with any questions. I’d be happy to give you a call, or we can arrange a call with one of our coordinators at your convenience.

Best,

Natalia

Expert Dental Solutions`;
}

/**
 * Returns the exact approved HTML copy for the Wisdom Surgery email.
 */
export function getApprovedWisdomHtml(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hello Dr.') || leadOrSalutation === 'Hello Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hello', leadOrSalutation);
  }

  return `<p>${salutationLine}</p>
<p>Thank you for your interest in our <b>Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!</b></p>
<p>This is a <b>4-day intensive clinical course with real patients</b>, designed to give you extensive surgical experience with <b>one-on-one mentorship throughout the entire course.</b></p>
<p><b>REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON</b></p>
<p>During the course, you will:</p>
<p>• <b>Perform at least 16 wisdom teeth extractions on real patients</b><br/>
• Work with <b>fully impacted, partially impacted, and erupted wisdom teeth</b><br/>
• Be the <b>main surgeon from start to finish</b> during all your procedures<br/>
• Receive <b>one-on-one mentorship</b>, with your instructor by your side throughout every procedure, <b>assisting you while you perform the extraction</b><br/>
• Train with cases <b>customized to your experience level and clinical goals</b></p>
<p><b>100% CUSTOMIZED TO YOUR GOALS</b></p>
<p>After registration, we schedule a <b>Zoom meeting with our coordinators</b> to discuss your experience, goals, and the types of cases you would like to focus on. Based on this meeting, our team selects patients and cases specifically for your training.</p>
<p>The course takes place at a <b>Federal University in Rio de Janeiro, Brazil</b>, with a maximum of <b>6 doctors per session</b> to maintain a highly personalized clinical experience.</p>
<p><b>MENTORSHIP DOESN’T END WHEN THE COURSE ENDS</b></p>
<p>As you begin planning and performing your first cases back in your own office, you will continue to have access to our coordinators for post-course mentorship. You can discuss cases, ask questions, and receive guidance as you apply what you learned in your own practice.</p>
<p><b>NEXT COURSES</b></p>
<p><b>November 7–10, 2026</b></p>
<p><b>March 1-4, 2027</b></p>
<p><b>TUITION</b></p>
<p><b>USD 8,200</b></p>
<p><b>YOUR COURSE PACKAGE INCLUDES</b></p>
<p>• Four-star hotel accommodation with breakfast<br/>
• Lunch during the course<br/>
• Transportation between the airport, hotel, and university<br/>
• Brazilian dinner on the final day<br/>
• <b>36 PACE-approved CE credits</b></p>
<p>We also offer <b>flexible, interest-free payment plan options.</b></p>
<p>Please see the attached PDF for additional course details.</p>
<p>Please feel free to reach out with any questions. I’d be happy to give you a call, or we can arrange a call with one of our coordinators at your convenience.</p>
<p>Best,</p>
<p>Natalia</p>
<p><b>Expert Dental Solutions</b></p>`;
}

/**
 * Returns the exact approved plain text copy for the Rehabilitation email.
 */
export function getApprovedRehabilitationText(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hi Dr.') || leadOrSalutation === 'Hi Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hi', leadOrSalutation);
  }

  return `${salutationLine}

Thank you for your interest in our courses!

Our Advanced Implant Rehabilitation Experience is a four-day live-patient course designed for dentists who want to enhance their skills in implant prosthodontics, from implant uncovering to definitive restoration using both analog and digital workflows.

After registering, we will schedule a Zoom meeting with our coordinators to discuss your background, goals, and expectations, allowing us to customize your training and select the most appropriate clinical cases for your experience level. The course is fully personalized, ensuring every participant gets the most out of the program.

Our courses are highly exclusive, with a maximum of six doctors per session, providing individualized one-on-one mentorship throughout the clinical experience.

During the course, you will gain hands-on experience with:

• Implant uncovering and peri-implant soft tissue management
• Conventional implant impressions
• Digital intraoral scanning
• Single, multiple, and full-arch implant restorations
• Prosthetic try-in, occlusion, and definitive restoration delivery

The course is held at the Fluminense Federal University School of Dentistry in Rio de Janeiro, where participants treat real patients under faculty supervision.

Upcoming Course Date:

• November 7 to 10, 2026, Rio de Janeiro

Tuition:

• USD 9,600

Our course includes:

• Four-star hotel accommodation with breakfast (5 nights)
• Lunch during the course
• Round-trip airport transfers
• Daily transportation between the hotel and the university
• Brazilian dinner on the final day

Our course offers 36 CE Credits and is PACE Approved.

We also offer flexible interest-free payment plan options.

Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, at your convenience.

Best regards,

Natalia

Expert Dental Solutions`;
}

/**
 * Returns the exact approved HTML copy for the Rehabilitation email.
 */
export function getApprovedRehabilitationHtml(leadOrSalutation?: any): string {
  let salutationLine: string;
  if (typeof leadOrSalutation === 'string' && (leadOrSalutation.startsWith('Hi Dr.') || leadOrSalutation === 'Hi Doctor')) {
    salutationLine = leadOrSalutation;
  } else {
    salutationLine = resolveDoctorSalutation('Hi', leadOrSalutation);
  }

  return `<p>${salutationLine}</p>
<p>Thank you for your interest in our courses!</p>
<p>Our <b>Advanced Implant Rehabilitation Experience</b> is a four-day live-patient course designed for dentists who want to enhance their skills in implant prosthodontics, from implant uncovering to definitive restoration using both analog and digital workflows.</p>
<p>After registering, we will schedule a Zoom meeting with our coordinators to discuss your background, goals, and expectations, allowing us to customize your training and select the most appropriate clinical cases for your experience level. The course is fully personalized, ensuring every participant gets the most out of the program.</p>
<p>Our courses are highly exclusive, with a maximum of six doctors per session, providing individualized one-on-one mentorship throughout the clinical experience.</p>
<p>During the course, you will gain hands-on experience with:</p>
<p>• Implant uncovering and peri-implant soft tissue management<br/>
• Conventional implant impressions<br/>
• Digital intraoral scanning<br/>
• Single, multiple, and full-arch implant restorations<br/>
• Prosthetic try-in, occlusion, and definitive restoration delivery</p>
<p>The course is held at the Fluminense Federal University School of Dentistry in Rio de Janeiro, where participants treat real patients under faculty supervision.</p>
<p>Upcoming Course Date:</p>
<p>• November 7 to 10, 2026, Rio de Janeiro</p>
<p>Tuition:</p>
<p>• USD 9,600</p>
<p>Our course includes:</p>
<p>• Four-star hotel accommodation with breakfast (5 nights)<br/>
• Lunch during the course<br/>
• Round-trip airport transfers<br/>
• Daily transportation between the hotel and the university<br/>
• Brazilian dinner on the final day</p>
<p>Our course offers <b>36 CE Credits</b> and is <b>PACE Approved.</b></p>
<p>We also offer flexible interest-free payment plan options.</p>
<p>Please feel free to reach out with any questions! I’d be happy to give you a call, or we can arrange a call with our coordinator, at your convenience.</p>
<p>Best regards,</p>
<p>Natalia</p>
<p>Expert Dental Solutions</p>`;
}

export interface ApprovedTemplatePackage {
  templateKey: string;
  displayName: string;
  subject: string;
  getText: (leadOrSalutation?: any) => string;
  getHtml: (leadOrSalutation?: any) => string;
  attachmentNames: string[];
}

export const APPROVED_COURSE_TEMPLATES: Record<string, ApprovedTemplatePackage> = {
  zygomatic_course_details: {
    templateKey: 'zygomatic_course_details',
    displayName: 'Zygomatic Course Details',
    subject: 'Zygomatic Course Details – Hands-On Training in Rio',
    getText: getApprovedZygomaticText,
    getHtml: getApprovedZygomaticHtml,
    attachmentNames: ['Zygomatic Course (2).pdf'],
  },
  periodontal_course_details: {
    templateKey: 'periodontal_course_details',
    displayName: 'Periodontal Plastic',
    subject: 'Periodontal Plastic Course Details – Hands-On Training in Rio',
    getText: getApprovedPeriodontalText,
    getHtml: getApprovedPeriodontalHtml,
    attachmentNames: ['_Perio and Peri-implant Plastic Surgery.pdf'],
  },
  endodontic_course_details: {
    templateKey: 'endodontic_course_details',
    displayName: 'Endodontics',
    subject: 'Endodontics Course Details, Hands-On Training in Rio',
    getText: getApprovedEndodonticText,
    getHtml: getApprovedEndodonticHtml,
    attachmentNames: ['Endodontics course.pdf'],
  },
  implant_course_details: {
    templateKey: 'implant_course_details',
    displayName: 'Intensive + Advanced Implant',
    subject: 'Implant Course Details – Hands-On Training',
    getText: getApprovedImplantText,
    getHtml: getApprovedImplantHtml,
    attachmentNames: ['Intensive implant .pdf', 'Advanced implant course (1).pdf'],
  },
  wisdom_course_details: {
    templateKey: 'wisdom_course_details',
    displayName: 'Wisdom',
    subject: 'Wisdom Surgery Details – Hands-On Training in Rio',
    getText: getApprovedWisdomText,
    getHtml: getApprovedWisdomHtml,
    attachmentNames: ['Third molar course.pdf'],
  },
  rehabilitation_course_details: {
    templateKey: 'rehabilitation_course_details',
    displayName: 'Rehabilitation',
    subject: 'Implant Rehabilitation Course Details – Hands-On Training',
    getText: getApprovedRehabilitationText,
    getHtml: getApprovedRehabilitationHtml,
    attachmentNames: ['Oral Rehabilitation Course.pdf'],
  },
};


