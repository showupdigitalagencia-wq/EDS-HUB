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

const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB limit
const RATE_LIMIT_MAX_REQUESTS = 10;
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

const ALLOWED_KEYS = new Set([
  'idempotency_key',
  'external_attempt_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'course_id',
  'course_code',
  'course_session_id',
  'session_code',
  'source_page',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
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
  if (!email && !phone) {
    return new Response(JSON.stringify({ error: 'At least one contact identifier (email or phone) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const courseId = sanitized.course_id;
  const courseCode = sanitized.course_code;
  if (!courseId && !courseCode) {
    return new Response(JSON.stringify({ error: 'Course identifier (course_id or course_code) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createAdminClient();

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

  // 8. Execute Private Atomic PostgreSQL Transaction
  const { data: txResult, error: txError } = await db.rpc(
    'capture_incomplete_enrollment_transaction',
    {
      p_idempotency_key: idempotencyKey,
      p_external_attempt_id: sanitized.external_attempt_id || null,
      p_first_name: sanitized.first_name || 'Lead',
      p_last_name: sanitized.last_name || null,
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
    }
  );

  if (txError) {
    console.error('[capture-incomplete-enrollment] Transaction RPC error:', txError.message);
    return new Response(
      JSON.stringify({ error: 'Incomplete enrollment capture transaction failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!txResult || !txResult.success) {
    return new Response(
      JSON.stringify({ error: txResult?.error || 'Capture request rejected' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      received: true,
      processing_status: txResult.processing_status,
      attempt_id: txResult.attempt_id,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
