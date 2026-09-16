// =============================================================================
// EDS HUB — Salutation Resolver
// =============================================================================
// Single source of truth for computing the greeting name.
// Rule:
//   1. If last_name has real content after trim → use last_name
//   2. Else if first_name has real content after trim → use first_name
//   3. Else → use defaultSalutation (defaults to "Doc")
// =============================================================================

import { DEFAULT_SALUTATION } from '../lib/constants';

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
    return trimmedLast;
  }

  const trimmedFirst = firstName?.trim();
  if (trimmedFirst && trimmedFirst.length > 0) {
    return trimmedFirst;
  }

  return defaultSalutation;
}
