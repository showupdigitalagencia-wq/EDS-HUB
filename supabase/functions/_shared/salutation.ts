// =============================================================================
// Salutation resolver (Deno/Edge Function version)
// =============================================================================
// Identical logic to src/utils/salutation.ts — kept in sync manually.
// =============================================================================

const DEFAULT_SALUTATION = 'Doc';

export function resolveSalutation(
  lastName: string | null | undefined,
  firstName: string | null | undefined,
  defaultSalutation: string = DEFAULT_SALUTATION,
): string {
  const trimmedLast = lastName?.trim();
  if (trimmedLast && trimmedLast.length > 0) {
    return trimmedLast;
  }

  const trimmedFirst = firstName?.trim();
  if (trimmedFirst && trimmedFirst.length > 0) {
    return trimmedFirst;
  }

  return defaultSalutation;
}
