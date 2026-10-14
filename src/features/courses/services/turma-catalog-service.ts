// =============================================================================
// EDS HUB — Global Standardized Turma / Course Date Catalog Service
// =============================================================================
// 1. Single global standardized option catalog for all canonical courses:
//    - Nov/25
//    - Feb/26
//    - May/26
//    - Jun/26 SP
//    - Jun/26 Endo
//    - Aug/26
//    - Oct/26
//    - Nov/26
//    - Feb/Mar 2027
//    - Apr/27 - Endo
//    - Apr/27
//    - May/27
//    - Aug/27
//    - Nov/27
//    - Outras
//
// 2. Preserves labels EXACTLY without inventing arbitrary dates (e.g. Feb/Mar 2027, Apr/27 - Endo).
// 3. Allows creating custom human-readable labels via "Outras" that persist globally across courses.
// 4. Integrates seamlessly with existing course_sessions architecture without competing structures.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type { CourseSession } from '../../../types/database';

export const STANDARD_TURMA_OPTIONS = [
  'Nov/25',
  'Feb/26',
  'May/26',
  'Jun/26 SP',
  'Jun/26 Endo',
  'Aug/26',
  'Oct/26',
  'Nov/26',
  'Feb/Mar 2027',
  'Apr/27 - Endo',
  'Apr/27',
  'May/27',
  'Aug/27',
  'Nov/27',
] as const;

export const OUTRAS_LABEL = 'Outras';

/**
 * Checks whether a string is a UUID
 */
export function isUuid(str: string | null | undefined): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

// In-memory cache for dynamic options
let cachedGlobalOptions: string[] | null = null;

/**
 * In the simplified label-only architecture, turma dates are NOT fabricated.
 * Start and end dates remain strictly null unless explicitly provided factually.
 */
export function parseRepresentativeDates(_label: string): { startDate: string | null; endDate: string | null } {
  return { startDate: null, endDate: null };
}

/**
 * Loads the global unified list of human-readable turma labels:
 * 1. Standard options (exact order)
 * 2. Custom options from app_settings (excluding UUIDs)
 * 3. Any session titles from course_sessions (excluding UUIDs)
 */
export async function fetchGlobalTurmaOptions(): Promise<string[]> {
  try {
    const customFromSettings: string[] = [];
    const customFromSessions: string[] = [];

    // 1. Fetch custom options from app_settings
    try {
      const { data: settings } = await supabase
        .from('app_settings')
        .select('custom_turma_options')
        .single();

      if (settings?.custom_turma_options && Array.isArray(settings.custom_turma_options)) {
        customFromSettings.push(
          ...settings.custom_turma_options.filter(
            (s: any) => typeof s === 'string' && s.trim() && !isUuid(s.trim()) && s.trim() !== OUTRAS_LABEL
          )
        );
      }
    } catch (_err) {
      // Ignore if column not queryable in older mocks
    }

    // 2. Fetch distinct session titles from course_sessions
    try {
      const { data: sessions } = await supabase
        .from('course_sessions')
        .select('title');

      if (sessions && Array.isArray(sessions)) {
        for (const s of sessions) {
          if (s?.title && typeof s.title === 'string') {
            const trimmed = s.title.trim();
            if (trimmed && !isUuid(trimmed) && trimmed !== OUTRAS_LABEL) {
              customFromSessions.push(trimmed);
            }
          }
        }
      }
    } catch (_err) {
      // Ignore
    }

    const merged = new Set<string>(STANDARD_TURMA_OPTIONS);
    for (const opt of [...customFromSettings, ...customFromSessions]) {
      if (opt && opt !== OUTRAS_LABEL && !isUuid(opt)) {
        merged.add(opt);
      }
    }

    cachedGlobalOptions = Array.from(merged);
    return cachedGlobalOptions;
  } catch (err) {
    console.error('Failed to fetch global turma options:', err);
    return [...STANDARD_TURMA_OPTIONS];
  }
}

/**
 * Atomically saves a newly added custom turma option (e.g. 'Jan/28') to app_settings
 * and updates memory cache so it becomes available across the app immediately.
 * Strictly rejects any UUID string from being saved as a custom option.
 */
export async function saveCustomTurmaOption(label: string): Promise<string[]> {
  const trimmed = label.trim();
  if (!trimmed || trimmed === OUTRAS_LABEL || isUuid(trimmed)) {
    return cachedGlobalOptions || [...STANDARD_TURMA_OPTIONS];
  }

  try {
    // 1. Try atomic RPC if available
    try {
      const { data: rpcRes } = await supabase.rpc('save_custom_turma_option', {
        p_label: trimmed,
      });
      if (Array.isArray(rpcRes)) {
        const set = new Set<string>([
          ...STANDARD_TURMA_OPTIONS,
          ...rpcRes.filter((o: string) => !isUuid(o)),
        ]);
        cachedGlobalOptions = Array.from(set);
        return cachedGlobalOptions;
      }
    } catch (_rpcErr) {
      // Fallback to direct app_settings query/update
    }

    // 2. Direct app_settings fallback
    const { data: current } = await supabase
      .from('app_settings')
      .select('custom_turma_options')
      .single();

    const existingArray: string[] = Array.isArray(current?.custom_turma_options)
      ? current.custom_turma_options.filter((o: string) => !isUuid(o))
      : [];

    if (!existingArray.includes(trimmed)) {
      const updated = [...existingArray, trimmed];
      await supabase
        .from('app_settings')
        .update({ custom_turma_options: updated })
        .eq('singleton_key', 1);
    }

    const set = new Set<string>([...STANDARD_TURMA_OPTIONS, ...existingArray, trimmed]);
    cachedGlobalOptions = Array.from(set);
    return cachedGlobalOptions;
  } catch (err) {
    console.warn('Failed to save custom turma option:', err);
    const set = new Set<string>([...(cachedGlobalOptions || STANDARD_TURMA_OPTIONS), trimmed]);
    cachedGlobalOptions = Array.from(set);
    return cachedGlobalOptions;
  }
}

/**
 * Finds an existing course session for a course matching a turma label, or creates one safely.
 * Strict rules:
 * - If passed an existing session UUID, resolves and returns the existing session.
 * - NEVER creates a session whose title is a UUID.
 * - Idempotently reuses existing course session for course_id + exact human-readable label.
 */
export async function ensureCourseSessionForLabel(
  courseId: string,
  turmaLabel: string
): Promise<CourseSession> {
  const trimmed = turmaLabel.trim();
  if (!courseId) {
    throw new Error('Course ID is required to ensure a course session.');
  }
  if (!trimmed) {
    throw new Error('Turma label is required.');
  }

  // Handle case where input is already a UUID (resolve existing session, NEVER insert UUID title)
  if (isUuid(trimmed)) {
    const { data: sessionById, error: fetchErr } = await supabase
      .from('course_sessions')
      .select('*')
      .eq('id', trimmed)
      .maybeSingle();

    if (sessionById) {
      return sessionById as CourseSession;
    }
    if (fetchErr) {
      console.warn('Error fetching session by UUID:', fetchErr);
    }
    throw new Error(`Invalid turma identifier: UUID ${trimmed} does not match any session.`);
  }

  // 1. Try atomic database helper if available
  try {
    const { data: rpcSessionId } = await supabase.rpc('ensure_course_session_for_label', {
      p_course_id: courseId,
      p_turma_label: trimmed,
    });
    if (rpcSessionId) {
      const { data: found } = await supabase
        .from('course_sessions')
        .select('*')
        .eq('id', rpcSessionId)
        .single();
      if (found) return found as CourseSession;
    }
  } catch (_rpcErr) {
    // Fallback to client-side find or insert
  }

  // 2. Client-side check for existing session for this course matching title
  const { data: existingSessions } = await supabase
    .from('course_sessions')
    .select('*')
    .eq('course_id', courseId);

  const matched = (existingSessions || []).find(
    (s: any) =>
      s.title && s.title.trim().toLowerCase() === trimmed.toLowerCase()
  );

  if (matched) {
    return matched as CourseSession;
  }

  // 3. Insert new label-only session for this course with null dates (never fake dates)
  const cleanTag = trimmed.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'TURMA';
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const sessionCode = `CS-${cleanTag}-${randomSuffix}`;

  const { data: inserted, error: insertErr } = await supabase
    .from('course_sessions')
    .insert({
      course_id: courseId,
      code: sessionCode,
      title: trimmed,
      status: 'open',
      start_date: null,
      end_date: null,
      timezone: 'America/New_York',
      location: 'Orlando, FL',
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    // If insert failed due to race condition, re-query
    const { data: recheck } = await supabase
      .from('course_sessions')
      .select('*')
      .eq('course_id', courseId)
      .eq('title', trimmed)
      .maybeSingle();

    if (recheck) return recheck as CourseSession;
    throw insertErr || new Error(`Failed to create course session for ${trimmed}`);
  }

  return inserted as CourseSession;
}
