// =============================================================================
// Salutation & Greeting Resolver (Deno / Edge Function version)
// =============================================================================
// Identical canonical logic to src/utils/salutation.ts — kept in sync.
//
// Rules:
// 1. Valid first_name -> "Hello John," / "Hello Maria,"
// 2. Missing/empty/placeholder ("Doutor(a)") -> STRICTLY "Hello Doctor,"
// 3. Never emit "Hello ,", "Hello undefined,", "Hello null,", "Hello {{first_name}},", "Hello Doutor(a),"
// =============================================================================

const DEFAULT_SALUTATION = 'Doc';

export function resolveSafeFirstName(
  firstName: string | null | undefined,
  fallback: string = 'Doctor'
): string {
  if (!firstName || typeof firstName !== 'string') return fallback;
  const trimmed = firstName.trim();
  if (!trimmed) return fallback;

  const lower = trimmed.toLowerCase();
  const placeholders = [
    'doutor(a)',
    'doutora',
    'doutor',
    'dr(a)',
    'dr(a).',
    'dr.',
    'dra.',
    'dr',
    'dra',
    'undefined',
    'null',
    'n/a',
    'none',
  ];

  if (placeholders.includes(lower)) {
    return fallback;
  }

  return trimmed;
}

export function resolveCanonicalGreeting(
  firstName: string | null | undefined,
  salutationWord: string = 'Hello'
): string {
  const safeName = resolveSafeFirstName(firstName, 'Doctor');
  return `${salutationWord} ${safeName},`;
}

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
