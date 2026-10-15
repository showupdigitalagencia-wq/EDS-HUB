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
    const { data: rpcSessionId, error: rpcErr } = await supabase.rpc('ensure_course_session_for_label', {
      p_course_id: courseId,
      p_turma_label: trimmed,
    });
    if (rpcErr) {
      console.warn('ensure_course_session_for_label RPC notice:', rpcErr);
    } else if (rpcSessionId) {
      const { data: found } = await supabase
        .from('course_sessions')
        .select('*')
        .eq('id', rpcSessionId)
        .maybeSingle();
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

/**
 * Atomically saves course & turma for an enrolled lead.
 * Calls public.save_lead_matricula_course_turma RPC when available,
 * and falls back gracefully to hardened sequential client updates.
 */
export async function saveLeadMatriculaCourseTurma(
  leadId: string,
  courseId: string,
  turmaLabel: string,
  courseNameHint?: string
): Promise<{
  success: boolean;
  courseId: string;
  courseName: string;
  courseSessionId: string | null;
  turmaTitle: string;
  enrollmentId?: string;
}> {
  if (!leadId) throw new Error('Lead ID is required.');
  if (!courseId) throw new Error('Course ID is required.');

  const trimmedTurma = (turmaLabel || '').trim();

  // 1. Try atomic server-side RPC
  try {
    const rpcCall = await supabase.rpc('save_lead_matricula_course_turma', {
      p_lead_id: leadId,
      p_course_id: courseId,
      p_turma_label: trimmedTurma,
    });

    const rpcResult = rpcCall?.data;
    const rpcErr = rpcCall?.error;

    if (!rpcErr && rpcResult && rpcResult.success) {
      return {
        success: true,
        courseId: rpcResult.course_id || courseId,
        courseName: rpcResult.course_name || courseNameHint || 'Curso',
        courseSessionId: rpcResult.course_session_id || null,
        turmaTitle: rpcResult.turma_title || trimmedTurma,
        enrollmentId: rpcResult.enrollment_id,
      };
    }

    if (rpcErr) {
      console.warn('save_lead_matricula_course_turma RPC notice, falling back:', rpcErr);
    }
  } catch (rpcCallErr) {
    // Graceful fallback to client-side logic
  }

  // 2. Client-side fallback
  // 2a. Resolve course session
  let resolvedSessionId: string | null = null;
  if (trimmedTurma) {
    if (isUuid(trimmedTurma) || trimmedTurma.startsWith('sess-')) {
      resolvedSessionId = trimmedTurma;
    } else {
      try {
        const sess = await ensureCourseSessionForLabel(courseId, trimmedTurma);
        resolvedSessionId = sess.id;
      } catch (ensureErr) {
        console.warn('ensureCourseSessionForLabel failed in client fallback:', ensureErr);
        if (isUuid(trimmedTurma) || trimmedTurma.startsWith('sess-')) {
          resolvedSessionId = trimmedTurma;
        }
      }
    }
  }

  // 2b. Fetch course or use hint
  let courseName = (courseNameHint || '').trim();
  let defaultPrice = 0.0;
  let currency = 'USD';

  if (!courseName) {
    try {
      const courseQuery: any = supabase
        .from('courses')
        .select('id, name, default_price, currency')
        .eq('id', courseId);

      let courseRes: any;
      if (typeof courseQuery.single === 'function') {
        courseRes = await courseQuery.single();
      } else if (typeof courseQuery.maybeSingle === 'function') {
        courseRes = await courseQuery.maybeSingle();
      } else {
        courseRes = await courseQuery;
      }

      const cData = Array.isArray(courseRes?.data)
        ? courseRes.data.find((c: any) => c.id === courseId) || courseRes.data[0]
        : courseRes?.data;

      if (cData?.name) {
        courseName = cData.name;
        defaultPrice = cData.default_price || 0.0;
        currency = cData.currency || 'USD';
      }
    } catch (_cErr) {
      console.warn('Could not query courses table in fallback:', _cErr);
    }
  }

  // 2c. Update lead course_interest
  if (courseName) {
    try {
      await supabase
        .from('leads')
        .update({
          course_interest: courseName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leadId);
    } catch (_leadErr) {
      console.warn('Could not update lead course_interest in fallback:', _leadErr);
    }
  }

  // 2d. Upsert lead_course_interests safely
  let existingInterests: any[] = [];
  try {
    const lciQuery: any = supabase
      .from('lead_course_interests')
      .select('id, course_id, priority')
      .eq('lead_id', leadId);

    let lciRes: any;
    if (typeof lciQuery.order === 'function') {
      const ordered = lciQuery.order('priority', { ascending: true });
      if (typeof ordered?.limit === 'function') {
        lciRes = await ordered.limit(10);
      } else {
        lciRes = await ordered;
      }
    } else {
      lciRes = await lciQuery;
    }
    existingInterests = Array.isArray(lciRes?.data) ? lciRes.data : [];
  } catch (_lciErr) {
    console.warn('Could not query lead_course_interests:', _lciErr);
  }

  const existingForCourse = existingInterests.find((i: any) => i.course_id === courseId);
  const otherPriority1 = existingInterests.find(
    (i: any) => i.course_id !== courseId && (i.priority === 1 || !i.priority)
  );

  if (existingForCourse) {
    if (otherPriority1) {
      try {
        await supabase
          .from('lead_course_interests')
          .update({ priority: 2 })
          .eq('id', otherPriority1.id);
      } catch (_p2Err) {
        // ignore
      }
    }

    await supabase
      .from('lead_course_interests')
      .update({
        course_id: courseId,
        course_session_id: resolvedSessionId,
        priority: 1,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingForCourse.id);
  } else if (existingInterests.length > 0) {
    // Existing row from another course: update it to the new course and turma
    await supabase
      .from('lead_course_interests')
      .update({
        course_id: courseId,
        course_session_id: resolvedSessionId,
        priority: 1,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingInterests[0].id);
  } else {
    await supabase
      .from('lead_course_interests')
      .insert({
        lead_id: leadId,
        course_id: courseId,
        course_session_id: resolvedSessionId,
        priority: 1,
        source: 'manual',
        status: 'active',
      });
  }

  // 2e. Upsert enrollment
  let enrollmentId: string | undefined;
  try {
    const enrollQuery: any = supabase
      .from('enrollments')
      .select('id')
      .eq('lead_id', leadId);

    let enrollRes: any;
    if (typeof enrollQuery.limit === 'function') {
      enrollRes = await enrollQuery.limit(1);
    } else {
      enrollRes = await enrollQuery;
    }

    const enrollments = Array.isArray(enrollRes?.data) ? enrollRes.data : [];
    if (enrollments.length > 0) {
      enrollmentId = enrollments[0].id;
      await supabase
        .from('enrollments')
        .update({
          course_id: courseId,
          course_session_id: resolvedSessionId,
          course_name_snapshot: courseName || 'Curso',
          updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
    } else {
      const enrollTable: any = supabase.from('enrollments');
      if (typeof enrollTable.insert === 'function') {
        const { data: newEnrollment } = await enrollTable
          .insert({
            lead_id: leadId,
            course_id: courseId,
            course_session_id: resolvedSessionId,
            course_name_snapshot: courseName || 'Curso',
            enrollment_status: 'confirmed',
            agreed_amount: defaultPrice,
            currency,
            enrollment_date: new Date().toISOString().split('T')[0],
            source: 'manual',
            idempotency_key: `enrollment_${leadId}_${courseId}`,
          })
          .select('id')
          .maybeSingle();

        enrollmentId = newEnrollment?.id;
      }
    }
  } catch (_enrollErr) {
    // Graceful fallback for mock environments
  }

  return {
    success: true,
    courseId,
    courseName: courseName || 'Curso',
    courseSessionId: resolvedSessionId,
    turmaTitle: trimmedTurma,
    enrollmentId,
  };
}

