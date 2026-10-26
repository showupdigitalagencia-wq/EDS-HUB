// =============================================================================
// Edge Function: capture-incomplete-enrollment
// =============================================================================
// Public ingestion endpoint for incomplete enrollment attempts from the
// external EDS website.
// - Enforces origin check (production domains only; localhost in dev)
// - Persistent SHA-256 IP-hash rate limiting (10 req / 10 min window)
// - Payload size cap (16 KB)
// - Strict field whitelisting & immediate rejection on blacklisted sensitive keys
// - Zero logging of sensitive values or raw body dumps
// - Atomic execution via capture_incomplete_enrollment_transaction RPC
// - Zero direct table access for anonymous users
// =============================================================================

import { createAdminClient } from '../_shared/supabase-client.ts';
import { sendInternalEnrollmentNotification } from '../_shared/internal-enrollment-notifier.ts';

const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB limit
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MINUTES = 10;

const ALLOWED_PROD_ORIGINS = [
  'https://expdentalsolutions.com',
  'https://www.expdentalsolutions.com',
];

const SENSITIVE_KEY_PATTERNS = [
  'password', 'token', 'secret', 'credit_card', 'card_number', 'cardnumber',
  'pan', 'cvv', 'cvc', 'exp_month', 'exp_year', 'expiry', 'card_expiry',
  'ssn', 'cpf', 'rg', 'passport', 'bank_account', 'routing_number', 'iban'
];

const CANONICAL_COURSE_MAP: Record<string, string> = {
  'IDIT-01': 'Intensive Dental Implant Training',
  'ET-01': 'Endodontics Training',
  'WTT-01': 'Wisdom Teeth Training',
  'ZIT-01': 'Zygomatic Implant Training',
  'ADIE-01': 'Advanced Dental Implant Experience',
  'PST-01': 'Periodontal Surgery Training',
  'AIRE-01': 'Advanced Implant Rehabilitation Experience',
};

const ALLOWED_KEYS = new Set([
  'idempotency_key',
  'external_attempt_id',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'emergency_phone',
  'course',
  'course_name',
  'course_id',
  'course_code',
  'course_session_id',
  'session_code',
  'certificate_name',
  'agd_number',
  'specialty',
  'years_in_practice',
  'surgical_experience',
  'coat_size',
  'heard_from',
  'referral_name',
  'promo_code',
  'source_page',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'status',
  'error_code',
  'failure_category',
  'submit_attempt_count',
  'missing_reason',
  'missing_fields',
]);

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_PROD_ORIGINS.includes(origin)) return true;
  const isDev = Deno.env.get('DENO_ENV') === 'development';
  if (isDev && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
    return true;
  }
  return false;
}

function getCorsHeaders(origin: string | null) {
  const allowed = isOriginAllowed(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? (origin || '') : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin)) {
      return new Response('Forbidden origin', { status: 403 });
    }
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Enforce CORS origin verification on POST
  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 3. Payload size check
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({ error: 'Payload too large (maximum 16KB)' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let rawBodyText: string;
  try {
    rawBodyText = await req.text();
    if (new TextEncoder().encode(rawBodyText).length > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'Payload too large (maximum 16KB)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: 'Could not read request body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBodyText);
  } catch (_e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return new Response(JSON.stringify({ error: 'Payload must be a JSON object' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 4. Blacklist Check: sensitive field names cause immediate rejection with ZERO logging
  const payloadKeys = Object.keys(payload);
  for (const key of payloadKeys) {
    const lowerKey = key.toLowerCase();
    for (const pattern of SENSITIVE_KEY_PATTERNS) {
      if (lowerKey.includes(pattern)) {
        return new Response(JSON.stringify({ error: 'Invalid field present in submission' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
  }

  // 5. Whitelist Sanitization: ignore unknown fields
  const sanitized: Record<string, string | null> = {};
  for (const key of payloadKeys) {
    if (ALLOWED_KEYS.has(key)) {
      const val = payload[key];
      sanitized[key] = val !== undefined && val !== null ? String(val).trim() : null;
    }
  }

  const db = createAdminClient();

  const statusParam = sanitized.status || 'needs_followup';
  const isFailedSubmit = (statusParam === 'submission_failed');

  // 6. Required Fields Validation
  const idempotencyKey = sanitized.idempotency_key;
  if (!idempotencyKey || idempotencyKey.length < 5) {
    return new Response(JSON.stringify({ error: 'Missing or invalid idempotency_key' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const email = sanitized.email;
  const phone = sanitized.phone;
  // For passive typing abandonment (needs_followup), require at least one contact identifier.
  // For explicit submit failure attempts (submission_failed), capture ANY attempt (even name-only or empty form).
  if (!isFailedSubmit && !email && !phone) {
    return new Response(JSON.stringify({ error: 'At least one contact identifier (email or phone) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let courseId = sanitized.course_id;
  let courseCode = sanitized.course_code;
  if (!courseCode && sanitized.course) {
    const rawCourseStr = sanitized.course.toLowerCase();
    for (const [code, name] of Object.entries(CANONICAL_COURSE_MAP)) {
      if (rawCourseStr.includes(code.toLowerCase()) || rawCourseStr.includes(name.toLowerCase())) {
        courseCode = code;
        break;
      }
    }
  }

  // Safe fallback if visitor has not selected a course: query default active course
  if (!courseId && !courseCode) {
    try {
      const { data: defaultCourse } = await db
        .from('courses')
        .select('id, code, name')
        .eq('active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (defaultCourse) {
        courseId = defaultCourse.id;
        courseCode = defaultCourse.code;
      }
    } catch (_err) {
      // ignore
    }
  }

  let firstName = sanitized.first_name;
  let lastName = sanitized.last_name;
  if ((!firstName || firstName === 'Lead') && (sanitized.name || sanitized.full_name)) {
    const rawFullName = (sanitized.name || sanitized.full_name || '').trim();
    const spaceIdx = rawFullName.indexOf(' ');
    if (spaceIdx !== -1) {
      firstName = rawFullName.substring(0, spaceIdx).trim();
      lastName = rawFullName.substring(spaceIdx + 1).trim() || null;
    } else if (rawFullName) {
      firstName = rawFullName;
    }
  }

  const isAnonymous = (!firstName || firstName === 'Lead') && !lastName && !sanitized.name && !sanitized.full_name;
  const leadFullName = isAnonymous
    ? 'Visitante não identificado'
    : ([firstName, lastName].filter(Boolean).join(' ').trim() || (sanitized.name || sanitized.full_name) || 'Visitante não identificado');

  // 6.1 Guard against contact / course info requests:
  // Submissions or visits to /contact or #course-info-form are COURSE INFORMATION REQUESTS,
  // NOT enrollment or registration attempts.
  const srcPage = (sanitized.source_page || '').toLowerCase();
  const attemptIdStr = (sanitized.external_attempt_id || '').toLowerCase();
  if (
    srcPage.includes('/contact') ||
    srcPage.includes('/request-course-information') ||
    srcPage.includes('course-info') ||
    attemptIdStr.includes('course-info') ||
    attemptIdStr.includes('contact')
  ) {
    return new Response(
      JSON.stringify({
        error: 'Course info requests and contact form submissions are not enrollment attempts',
        ignored: true
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 7. Persistent IP Rate Limiting via SHA-256 Hash
  const rawIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip')?.trim() ||
    'unknown-ip';

  const ipHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawIp)
  );
  const ipHash = Array.from(new Uint8Array(ipHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const { data: isWithinRateLimit, error: rateLimitErr } = await db.rpc(
    'check_and_record_incomplete_enrollment_rate_limit',
    {
      p_ip_hash: ipHash,
      p_max_requests: RATE_LIMIT_MAX_REQUESTS,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    }
  );

  if (rateLimitErr) {
    console.error('[capture-incomplete-enrollment] Rate limit check error:', rateLimitErr.message);
  } else if (isWithinRateLimit === false) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please try again later.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const failureCategoryParam = sanitized.failure_category || (payload.failure_category as string) || (sanitized.error_code ? String(sanitized.error_code) : null);
  const attemptCountParam = typeof payload.submit_attempt_count === 'number'
    ? payload.submit_attempt_count
    : (sanitized.submit_attempt_count ? parseInt(sanitized.submit_attempt_count, 10) : 1);

  // 8. Execute Private Atomic PostgreSQL Transaction
  const { data: txResult, error: txError } = await db.rpc(
    'capture_incomplete_enrollment_transaction',
    {
      p_idempotency_key: idempotencyKey,
      p_external_attempt_id: sanitized.external_attempt_id || null,
      p_first_name: isAnonymous ? 'Visitante não identificado' : (firstName || 'Lead'),
      p_last_name: lastName || null,
      p_email: email || null,
      p_phone: phone || null,
      p_course_id: courseId || null,
      p_course_code: courseCode || null,
      p_course_session_id: sanitized.course_session_id || null,
      p_session_code: sanitized.session_code || null,
      p_source_page: sanitized.source_page || null,
      p_utm_source: sanitized.utm_source || null,
      p_utm_medium: sanitized.utm_medium || null,
      p_utm_campaign: sanitized.utm_campaign || null,
      p_utm_term: sanitized.utm_term || null,
      p_utm_content: sanitized.utm_content || null,
      p_status: statusParam,
      p_failure_category: failureCategoryParam,
      p_submit_attempt_count: attemptCountParam,
    }
  );

  if (txError) {
    console.error('[capture-incomplete-enrollment] Transaction RPC error:', txError.message);
    return new Response(
      JSON.stringify({ error: 'Incomplete enrollment capture transaction failed', details: txError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!txResult || !txResult.success) {
    return new Response(
      JSON.stringify({ error: txResult?.error || 'Capture request rejected' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (txResult && txResult.success && txResult.lead_id) {
    const effectiveAttemptCount = txResult.submit_attempt_count || attemptCountParam || 1;

    let courseDisplayName = (payload.course as string) || (payload.course_name as string) || (courseCode ? CANONICAL_COURSE_MAP[courseCode.toUpperCase()] : null) || courseCode || 'Curso não selecionado';
    if (sanitized.course_id) {
      const { data: cData } = await db.from('courses').select('name').eq('id', sanitized.course_id).maybeSingle();
      if (cData?.name) courseDisplayName = cData.name;
    } else if (courseCode && (!courseDisplayName || courseDisplayName === 'Curso não selecionado')) {
      const { data: cData } = await db.from('courses').select('name').eq('code', courseCode).maybeSingle();
      if (cData?.name) courseDisplayName = cData.name;
    }

    // Supplementary push notification for failed submission
    if (isFailedSubmit) {
      try {
        const pushTitle = 'Tentativa de matrícula';
        let pushBody = `${leadFullName} tentou concluir a matrícula para ${courseDisplayName}, mas o envio não foi concluído.`;
        if (failureCategoryParam) {
          pushBody += ` (${failureCategoryParam})`;
        }

        await db.functions.invoke('send-push-notification', {
          body: {
            event_type: 'submission_failed',
            event_id: txResult.lead_id,
            idempotency_key: `submission_failed_push_${sanitized.external_attempt_id || txResult.attempt_id}_${effectiveAttemptCount}`,
            title: pushTitle,
            body: pushBody,
            deep_link: `/leads/${txResult.lead_id}`,
          },
        });
      } catch (pushErr) {
        console.warn('[capture-incomplete-enrollment] Push notification notice:', pushErr);
      }
    }

    // Internal email notification
    try {
      if (isFailedSubmit) {
        // EXPLICIT FAILED SUBMIT: ALWAYS IMMEDIATE DISPATCH
        // Explicit submit clicks that fail validation or server processing must notify immediately.
        // They must never be suppressed by historical registrations.
        const failKey = `internal_email:attempt:fail_${sanitized.external_attempt_id || txResult.attempt_id}_${effectiveAttemptCount}`;
        await sendInternalEnrollmentNotification(db, {
          event_type: 'incomplete_registration',
          idempotency_key: failKey,
          lead_id: txResult.lead_id,
          attempt_id: txResult.attempt_id,
          external_attempt_id: sanitized.external_attempt_id,
          lead_name: leadFullName,
          first_name: isAnonymous ? 'Visitante não identificado' : (firstName || 'Visitante não identificado'),
          last_name: lastName || null,
          email: email || 'Não informado',
          phone: phone || 'Não informado',
          course_code: courseCode,
          course_name: courseDisplayName,
          turma_name: sanitized.session_code,
          source_page: sanitized.source_page,
          status: 'submission_failed',
          failure_category: failureCategoryParam,
          submit_attempt_count: effectiveAttemptCount,
          error_code: sanitized.error_code,
          missing_reason: failureCategoryParam,
          raw_payload: {
            ...payload,
            name: leadFullName,
            failure_category: failureCategoryParam,
            submit_attempt_count: effectiveAttemptCount,
          },
        }, { immediate: true });
      } else {
        // PASSIVE INCOMPLETE ATTEMPT (Form filling without submit action)
        // Check if THIS SPECIFIC attempt already completed registration
        let alreadyCompleted = false;
        const extAttId = sanitized.external_attempt_id;

        if (extAttId) {
          const { data: compByAtt } = await db
            .from('form_submissions')
            .select('id')
            .or(`idempotency_key.eq.comp_${extAttId},submitted_data->>external_attempt_id.eq.${extAttId}`)
            .eq('processing_status', 'processed')
            .limit(1);
          if (compByAtt && compByAtt.length > 0) alreadyCompleted = true;
        }

        if (alreadyCompleted) {
          // Registration for this attempt already completed! Mark attempt resolved and log skipped audit entry
          if (txResult.attempt_id) {
            await db
              .from('incomplete_enrollments')
              .update({ status: 'resolved', resolved_at: new Date().toISOString() })
              .eq('id', txResult.attempt_id);
          }
          await db.from('internal_notification_logs').upsert({
            idempotency_key: `internal_email:attempt:${sanitized.external_attempt_id || txResult.attempt_id || txResult.lead_id}`,
            event_type: 'incomplete_registration',
            lead_id: txResult.lead_id,
            attempt_id: txResult.attempt_id,
            recipient_emails: ['info@expdentalsolutions.com'],
            subject: `Tentativa de matrícula — ${leadFullName} — ${courseDisplayName}`,
            status: 'skipped',
            error_message: 'Registration completed prior to incomplete capture',
            payload_snapshot: payload,
            last_activity_at: new Date().toISOString(),
            scheduled_for: new Date().toISOString(),
          }, { onConflict: 'idempotency_key' });
        } else {
          // INACTIVITY ABANDONMENT: Queue ~10 minutes
          const attemptIdKey = `internal_email:attempt:${sanitized.external_attempt_id || txResult.attempt_id || txResult.lead_id}`;
          await sendInternalEnrollmentNotification(db, {
            event_type: 'incomplete_registration',
            idempotency_key: attemptIdKey,
            lead_id: txResult.lead_id,
            attempt_id: txResult.attempt_id,
            external_attempt_id: sanitized.external_attempt_id,
            lead_name: leadFullName,
            first_name: firstName,
            last_name: lastName,
            email: email,
            phone: phone,
            course_code: courseCode,
            course_name: courseDisplayName,
            turma_name: sanitized.session_code,
            source_page: sanitized.source_page,
            status: sanitized.status || 'needs_followup',
            error_code: sanitized.error_code,
            raw_payload: {
              ...payload,
              name: leadFullName,
            },
          }, { immediate: false, inactivityMinutes: 10 });
        }
      }
    } catch (emailErr) {
      console.warn('[capture-incomplete-enrollment] Internal email notification notice:', emailErr);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      received: true,
      processing_status: txResult.processing_status,
      attempt_id: txResult.attempt_id,
      submit_attempt_count: txResult.submit_attempt_count || 1,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
