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
  last_inbound_activity_at?: string | null;
  source_created_at?: string | null;
  created_at?: string | null;
  [key: string]: any;
}

/**
 * Resolves the canonical recency timestamp in milliseconds.
 * Prioritizes last_inbound_activity_at (resurfacing returning leads with new form submissions),
 * then source_created_at, falling back to created_at.
 * Preserves original created_at while ensuring newly active inbound submissions move to the top!
 */
export function getLeadCanonicalTimestamp(lead: HasCreationTimestamps): number {
  const ts = lead.last_inbound_activity_at || lead.source_created_at || lead.created_at;
  if (!ts) return 0;
  const time = new Date(ts).getTime();
  return isNaN(time) ? 0 : time;
}

/**
 * Comparator for sorting leads chronologically newest-first.
 * Guaranteed descending order: newest lead first.
 * Deterministic fallback on lead id.
 */
export function compareLeadsNewestFirst<T extends HasCreationTimestamps>(a: T, b: T): number {
  const timeB = getLeadCanonicalTimestamp(b);
  const timeA = getLeadCanonicalTimestamp(a);
  if (timeB !== timeA) {
    return timeB - timeA;
  }
  return String(b.id || '').localeCompare(String(a.id || ''));
}
