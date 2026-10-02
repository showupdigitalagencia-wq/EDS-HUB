// =============================================================================
// EDS HUB — Canonical Lead Recency & Sorting Utilities
// =============================================================================
// Establishes the single source of truth for chronological lead ordering:
//
// 1. Canonical Creation Timestamp:
//    - Uses source_created_at if populated (preserves original creation time
//      from HubSpot/Meta/CSV external origins, preventing historical batch-imported
//      leads from jumping ahead of genuinely newer live leads).
//    - Falls back to created_at (for manual creation, website forms, or new live syncs).
//
// 2. Strict Descending Order:
//    - Most recently created leads appear FIRST.
//    - Ties broken deterministically by lead id.
//    - NEVER sorts by updated_at, guaranteeing that editing an old lead does NOT
//      make it jump to the top of the pipeline or contacts list.
// =============================================================================

export interface HasCreationTimestamps {
  id?: string;
  last_acquisition_at?: string | null;
  last_inbound_activity_at?: string | null;
  source_created_at?: string | null;
  created_at?: string | null;
  [key: string]: any;
}

/**
 * Resolves the canonical recency timestamp in milliseconds.
 * Primary ordering rule: original created_at DESC.
 * Falls back to source_created_at if created_at is not populated.
 * Strictly preserves original created_at while ordering newest-created leads first.
 */
export function getLeadCanonicalTimestamp(lead: HasCreationTimestamps): number {
  const created = lead.created_at ? new Date(lead.created_at).getTime() : 0;
  const validCreated = !isNaN(created) ? created : 0;
  if (validCreated > 0) {
    return validCreated;
  }
  const source = lead.source_created_at ? new Date(lead.source_created_at).getTime() : 0;
  const validSource = !isNaN(source) ? source : 0;
  return validSource;
}

/**
 * Resolves the effective acquisition recency timestamp in milliseconds.
 * Prioritizes latest genuine acquisition (last_acquisition_at) so returning leads
 * rise to the top of their current pipeline stage without altering their immutable
 * original created_at timestamp.
 */
export function getLeadEffectiveRecencyTimestamp(lead: HasCreationTimestamps): number {
  if (lead.last_acquisition_at) {
    const acqTime = new Date(lead.last_acquisition_at).getTime();
    if (!isNaN(acqTime) && acqTime > 0) {
      return acqTime;
    }
  }
  return getLeadCanonicalTimestamp(lead);
}

/**
 * Comparator for sorting leads chronologically newest-first.
 * Guaranteed descending order: highest effective acquisition recency first.
 * Deterministic fallback on lead id.
 */
export function compareLeadsNewestFirst<T extends HasCreationTimestamps>(a: T, b: T): number {
  const timeB = getLeadEffectiveRecencyTimestamp(b);
  const timeA = getLeadEffectiveRecencyTimestamp(a);
  if (timeB !== timeA) {
    return timeB - timeA;
  }
  return String(b.id || '').localeCompare(String(a.id || ''));
}
