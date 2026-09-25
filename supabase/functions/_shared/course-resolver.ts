// =============================================================================
// EDS HUB — Central Course Interest Resolver (Deno / Edge Functions)
// =============================================================================
// Single central resolver for mapping incoming signals (Meta forms, ads,
// HubSpot contact fields, website forms, manual selection) to Canonical Courses.
//
// Invariants:
// 1. Never assign a wrong course silently.
// 2. Return 'unmapped' when no factual evidence exists, preserving raw signal.
// 3. One Person = One Lead: support up to 3 prioritized course interests.
// 4. Preserve free course interest without mapping to paid courses.
// =============================================================================

export interface CanonicalCourseDefinition {
  code: string;
  name: string;
  aliases: string[];
  metaFormKeywords: string[];
  hubspotOption: string;
}

export const CANONICAL_COURSES: CanonicalCourseDefinition[] = [
  {
    code: 'IDIT-01',
    name: 'Intensive Dental Implant Training',
    aliases: ['intensive', 'intensive dental implant', 'intensive implant', 'idit', 'idit-01'],
    metaFormKeywords: ['intensive', 'idit'],
    hubspotOption: 'Intensive',
  },
  {
    code: 'ET-01',
    name: 'Endodontics Training',
    aliases: ['endodontic', 'endodontics', 'endo', 'et', 'et-01'],
    metaFormKeywords: ['endodontic', 'endodontics', 'endo'],
    hubspotOption: 'Endodontic',
  },
  {
    code: 'WTT-01',
    name: 'Wisdom Teeth Training',
    aliases: ['wisdom', 'wisdom teeth', 'wisdom teeth extraction', 'wtt', 'wtt-01'],
    metaFormKeywords: ['wisdom', 'wisdom teeth'],
    hubspotOption: 'Wisdom',
  },
  {
    code: 'ZIT-01',
    name: 'Zygomatic Implant Training',
    aliases: ['zygomatic', 'zygoma', 'zygomatic implant', 'zygomatic course', 'zit', 'zit-01'],
    metaFormKeywords: ['zygomatic', 'zygoma'],
    hubspotOption: 'Zygomatic',
  },
  {
    code: 'ADIE-01',
    name: 'Advanced Dental Implant Experience',
    aliases: ['advanced', 'advanced dental implant', 'adie', 'adie-01'],
    metaFormKeywords: ['advanced dental implant', 'adie'],
    hubspotOption: 'Advanced',
  },
  {
    code: 'PST-01',
    name: 'Periodontal Surgery Training',
    aliases: ['periodontal', 'periodontal plastic', 'periodontics', 'pst', 'pst-01'],
    metaFormKeywords: ['periodontal', 'periodontics'],
    hubspotOption: 'Periodontal Plastic',
  },
  {
    code: 'AIRE-01',
    name: 'Advanced Implant Rehabilitation Experience',
    aliases: ['rehabilitation', 'implant rehabilitation', 'aire', 'aire-01'],
    metaFormKeywords: ['rehabilitation', 'aire'],
    hubspotOption: 'Rehabilitation',
  },
  {
    code: 'MA-01',
    name: 'Maxillofacial Anomalies',
    aliases: ['maxillofacial', 'maxillofacial anomalies', 'ma', 'ma-01'],
    metaFormKeywords: ['maxillofacial'],
    hubspotOption: 'Maxillofacial',
  },
  {
    code: 'PRF-01',
    name: 'PRF In-Office',
    aliases: ['prf', 'prf in-office', 'prf-01'],
    metaFormKeywords: ['prf'],
    hubspotOption: 'PRF',
  },
];export interface ResolvedCourseResult {
  status: 'resolved' | 'unmapped' | 'historical_free';
  courseCode: string | null;
  canonicalCode: string | null;
  courseName: string | null;
  rawSignal: string;
  priority?: number;
  preferredDate?: string | null;
  confidence: 'exact_code' | 'exact_name' | 'hubspot_option' | 'form_pattern' | 'unmapped';
}

/**
 * Resolves a single course signal (string, form name, HubSpot field) to a canonical course.
 */
export function resolveCanonicalCourse(
  rawSignal: string | null | undefined,
  priority = 1,
  preferredDate: string | null = null
): ResolvedCourseResult {

  const signal = (rawSignal || '').trim();

  if (!signal) {
    return {
      status: 'unmapped',
      courseCode: null,
      canonicalCode: null,
      courseName: null,
      rawSignal: '',
      priority,
      preferredDate,
      confidence: 'unmapped',
    };
  }

  const lower = signal.toLowerCase();

  // 1. Historical Free Courses safety: preserve without mapping to paid courses
  if (lower === 'free courses' || lower === 'free' || lower.includes('free course')) {
    return {
      status: 'historical_free',
      courseCode: null,
      canonicalCode: null,
      courseName: 'Free Courses (Historical)',
      rawSignal: signal,
      priority,
      preferredDate,
      confidence: 'hubspot_option',
    };
  }

  // 2. Exact Code Match (case-insensitive)
  const byCode = CANONICAL_COURSES.find((c) => c.code.toLowerCase() === lower);
  if (byCode) {
    return {
      status: 'resolved',
      courseCode: byCode.code,
      canonicalCode: byCode.code,
      courseName: byCode.name,
      rawSignal: signal,
      priority,
      preferredDate,
      confidence: 'exact_code',
    };
  }

  // 3. Exact Canonical Name Match
  const byName = CANONICAL_COURSES.find((c) => c.name.toLowerCase() === lower);
  if (byName) {
    return {
      status: 'resolved',
      courseCode: byName.code,
      canonicalCode: byName.code,
      courseName: byName.name,
      rawSignal: signal,
      priority,
      preferredDate,
      confidence: 'exact_name',
    };
  }

  // 4. Exact HubSpot Option Match
  const byHubSpot = CANONICAL_COURSES.find((c) => c.hubspotOption.toLowerCase() === lower);
  if (byHubSpot) {
    return {
      status: 'resolved',
      courseCode: byHubSpot.code,
      canonicalCode: byHubSpot.code,
      courseName: byHubSpot.name,
      rawSignal: signal,
      priority,
      preferredDate,
      confidence: 'hubspot_option',
    };
  }

  // 5. Alias Match
  const byAlias = CANONICAL_COURSES.find((c) =>
    c.aliases.some((alias) => alias === lower)
  );
  if (byAlias) {
    return {
      status: 'resolved',
      courseCode: byAlias.code,
      canonicalCode: byAlias.code,
      courseName: byAlias.name,
      rawSignal: signal,
      priority,
      preferredDate,
      confidence: 'hubspot_option',
    };
  }

  // 6. Form Name / Campaign Pattern Match (word boundary or substring)
  const byFormPattern = CANONICAL_COURSES.find((c) =>
    c.metaFormKeywords.some((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(lower);
    })
  );
  if (byFormPattern) {
    return {
      status: 'resolved',
      courseCode: byFormPattern.code,
      canonicalCode: byFormPattern.code,
      courseName: byFormPattern.name,
      rawSignal: signal,
      priority,
      preferredDate,
      confidence: 'form_pattern',
    };
  }

  // 7. Unmapped Signal — Return unmapped, NEVER assign a guess
  return {
    status: 'unmapped',
    courseCode: null,
    canonicalCode: null,
    courseName: null,
    rawSignal: signal,
    priority,
    preferredDate,
    confidence: 'unmapped',
  };
}

export const resolveCourseSignal = resolveCanonicalCourse;


export interface InboundContactCourseSignals {
  // HubSpot Properties
  curso_de_interesse?: string | null;
  curso_de_interesse_2?: string | null;
  curso_de_interesse_3?: string | null;
  data_do_curso_de_interesse?: string | null;

  // Form / Ad Metadata
  form_name?: string | null;
  form_id?: string | null;
  campaign_name?: string | null;
  ad_name?: string | null;

  // Generic / Manual Signal
  course_interest?: string | null;
}

/**
 * Resolves up to 3 prioritized course interests from an inbound contact.
 * Deduplicates interests so that the same course is not added twice,
 * preserving priority order: Priority 1 > Priority 2 > Priority 3.
 */
export function resolvePrioritizedCourseInterests(
  signals: InboundContactCourseSignals
): ResolvedCourseResult[] {
  const results: ResolvedCourseResult[] = [];
  const seenCodes = new Set<string>();

  const datePref = signals.data_do_curso_de_interesse || null;

  let p1Signal = signals.curso_de_interesse;
  if (!p1Signal && signals.form_name) {
    p1Signal = signals.form_name;
  }
  if (!p1Signal && signals.campaign_name) {
    p1Signal = signals.campaign_name;
  }
  if (!p1Signal && signals.course_interest) {
    p1Signal = signals.course_interest;
  }

  if (p1Signal) {
    const res = resolveCanonicalCourse(p1Signal, 1, datePref);
    results.push(res);
    if (res.courseCode) seenCodes.add(res.courseCode);
  }

  if (signals.curso_de_interesse_2) {
    const res = resolveCanonicalCourse(signals.curso_de_interesse_2, 2, datePref);
    if (!res.courseCode || !seenCodes.has(res.courseCode)) {
      results.push(res);
      if (res.courseCode) seenCodes.add(res.courseCode);
    }
  }

  if (signals.curso_de_interesse_3) {
    const res = resolveCanonicalCourse(signals.curso_de_interesse_3, 3, datePref);
    if (!res.courseCode || !seenCodes.has(res.courseCode)) {
      results.push(res);
      if (res.courseCode) seenCodes.add(res.courseCode);
    }
  }

  return results.slice(0, 3);
}
