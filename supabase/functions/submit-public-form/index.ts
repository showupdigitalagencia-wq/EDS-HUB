// =============================================================================
// Edge Function: submit-public-form
// =============================================================================
// Public endpoint for EDS HUB Forms.
// - GET: fetches sanitized public form schema & fields for the active version.
// - POST: validates input, enforces persistent rate limiting & honeypot, executes
//         atomic database transaction via process_form_submission_transaction RPC,
//         and hands off to process-lead-intake.
// Zero direct table write or read permissions for anonymous users.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import type { LeadIntakePayload } from '../_shared/types.ts';

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB limit
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MINUTES = 10;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const url = new URL(req.url);

  // ===========================================================================
  // 1. GET: Fetch sanitized public form definition
  // ===========================================================================
  if (req.method === 'GET') {
    const slug = url.searchParams.get('slug');
    if (!slug) {
      return new Response(
        JSON.stringify({ error: 'Missing slug parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const db = createAdminClient();

      // Retrieve active form
      const { data: form, error: formError } = await db
        .from('forms')
        .select('id, name, slug, description, status, current_version, submit_button_text, success_message, redirect_url')
        .eq('slug', slug)
        .single();

      if (formError || !form || form.status !== 'active') {
        return new Response(
          JSON.stringify({ error: 'Form not found or inactive' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Retrieve fields for current_version
      const { data: fields, error: fieldsError } = await db
        .from('form_fields')
        .select('internal_name, label, field_type, required, placeholder, help_text, options, sort_order, settings')
        .eq('form_id', form.id)
        .eq('version', form.current_version)
        .order('sort_order', { ascending: true });

      if (fieldsError) {
        console.error('[submit-public-form] Error fetching fields:', fieldsError);
        return new Response(
          JSON.stringify({ error: 'Failed to load form fields' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Return sanitized public form configuration
      return new Response(
        JSON.stringify({
          name: form.name,
          slug: form.slug,
          description: form.description,
          version: form.current_version,
          submit_button_text: form.submit_button_text,
          success_message: form.success_message,
          redirect_url: form.redirect_url,
          fields: fields || [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      console.error('[submit-public-form] GET unhandled error:', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // ===========================================================================
  // 2. POST: Submit Form
  // ===========================================================================
  if (req.method === 'POST') {
    // 2.1 Payload size check
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Payload too large (maximum 64KB)' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let rawBodyText: string;
    try {
      rawBodyText = await req.text();
      if (new TextEncoder().encode(rawBodyText).length > MAX_PAYLOAD_BYTES) {
        return new Response(
          JSON.stringify({ error: 'Payload too large (maximum 64KB)' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: 'Could not read request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBodyText);
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      slug,
      idempotency_key,
      external_attempt_id,
      fields = {},
      _hp_company,
    } = payload as {
      slug?: string;
      idempotency_key?: string;
      external_attempt_id?: string;
      fields?: Record<string, unknown>;
      _hp_company?: string;
    };

    if (!slug || typeof slug !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid form slug' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!idempotency_key || typeof idempotency_key !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid idempotency_key' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2.2 Honeypot check: silently accept and discard bots
    if (_hp_company && String(_hp_company).trim().length > 0) {
      console.warn(`[submit-public-form] Bot honeypot triggered on form ${slug}`);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Thank you for your submission!',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2.3 Strict Privacy Guard: NEVER persist medical, dietary, files, signature, emergency contact
    delete fields.medical_conditions;
    delete fields.dietary;
    delete fields.passport;
    delete fields.dental_license;
    delete fields.emergency_phone;
    delete fields.certificate_name;
    delete fields.coat_size;
    delete fields.signature;
    delete fields.email_confirmation;
    delete fields.date;
    delete fields.formData;
    delete fields.raw_form_data;
    delete fields.form_data;

    // 2.4 Terms accepted semantics: only store true upon confirmed application submission
    if ('terms_accepted' in fields) {
      if (fields.terms_accepted === true || fields.terms_accepted === 'true' || fields.terms_accepted === 1 || fields.terms_accepted === '1') {
        fields.terms_accepted = true;
      } else {
        delete fields.terms_accepted;
      }
    }

    // 2.5 Conservative single-name splitting (first token = first_name, remainder = last_name)
    if (fields.name && typeof fields.name === 'string') {
      const trimmedName = fields.name.trim();
      if (trimmedName && !fields.first_name) {
        const spaceIndex = trimmedName.indexOf(' ');
        if (spaceIndex > 0) {
          fields.first_name = trimmedName.substring(0, spaceIndex);
          fields.last_name = trimmedName.substring(spaceIndex + 1).trim();
        } else {
          fields.first_name = trimmedName;
          fields.last_name = '';
        }
      }
    }

    // Bidirectional course field mapping fallback
    if (!fields.course && fields.course_interest) {
      fields.course = fields.course_interest;
    } else if (!fields.course_interest && fields.course) {
      fields.course_interest = fields.course;
    }

    const db = createAdminClient();

    // 2.5 Verify active form
    const { data: form, error: formError } = await db
      .from('forms')
      .select('id, name, slug, status, current_version, success_message, redirect_url, source_detail')
      .eq('slug', slug)
      .single();

    if (formError || !form || form.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Form not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2.6 Persistent IP Rate Limiting
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
      'check_and_record_rate_limit',
      {
        p_form_id: form.id,
        p_ip_hash: ipHash,
        p_max_requests: RATE_LIMIT_MAX_REQUESTS,
        p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
      }
    );

    if (rateLimitErr) {
      console.error('[submit-public-form] Rate limit check error:', rateLimitErr);
    } else if (isWithinRateLimit === false) {
      return new Response(
        JSON.stringify({ error: 'Too many submissions. Please wait a few minutes before trying again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2.7 Field schema validation
    const { data: activeFields, error: activeFieldsErr } = await db
      .from('form_fields')
      .select('internal_name, label, field_type, required, options')
      .eq('form_id', form.id)
      .eq('version', form.current_version);

    if (activeFieldsErr || !activeFields) {
      return new Response(
        JSON.stringify({ error: 'Could not validate form fields' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    for (const field of activeFields) {
      const val = fields[field.internal_name];
      if (field.required) {
        if (val === undefined || val === null || String(val).trim() === '') {
          return new Response(
            JSON.stringify({ error: `Field '${field.label}' is required` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Normalizations & extractions
    const rawEmail = fields.email ? String(fields.email).trim().toLowerCase() : null;
    if (rawEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawEmail)) {
        return new Response(
          JSON.stringify({ error: 'Invalid email address format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let phoneE164: string | null = null;
    if (fields.phone) {
      const cleaned = String(fields.phone).replace(/[^\d+]/g, '');
      if (cleaned.startsWith('+')) {
        phoneE164 = cleaned;
      } else if (cleaned.length === 10) {
        phoneE164 = `+1${cleaned}`;
      } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        phoneE164 = `+${cleaned}`;
      } else if (cleaned.length > 0) {
        phoneE164 = `+${cleaned}`;
      }
    }

    let contactPref: string | null = null;
    if (fields.contact_preference) {
      const p = String(fields.contact_preference).trim().toLowerCase();
      if (['email', 'sms', 'call'].includes(p)) {
        contactPref = p;
      }
    }

    const courseInterest = (fields.course_interest ? String(fields.course_interest).trim() : null) ||
      (fields.course ? String(fields.course).trim() : null);
    const userAgent = req.headers.get('user-agent') || null;
    const effectiveAttemptId = external_attempt_id || fields.external_attempt_id
      ? String(external_attempt_id || fields.external_attempt_id).trim()
      : null;

    // =========================================================================
    // 2.8 Execute Private Atomic PostgreSQL Transaction
    // =========================================================================
    const { data: txResult, error: txError } = await db.rpc(
      'process_form_submission_transaction',
      {
        p_form_slug: form.slug,
        p_idempotency_key: idempotency_key,
        p_submitted_data: fields,
        p_email: rawEmail,
        p_phone_e164: phoneE164,
        p_contact_preference: contactPref,
        p_course_interest: courseInterest,
        p_ip_address: rawIp,
        p_user_agent: userAgent,
        p_external_attempt_id: effectiveAttemptId,
      }
    );

    if (txError) {
      console.error('[submit-public-form] Transaction RPC error:', txError);
      return new Response(
        JSON.stringify({ error: 'Submission transaction failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!txResult || !txResult.success) {
      return new Response(
        JSON.stringify({ error: txResult?.error || 'Submission rejected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const submissionId = txResult.submission_id;
    const leadId = txResult.lead_id;
    const intakeEventId = txResult.intake_event_id;
    const processingStatus = txResult.processing_status;

    // If duplicate idempotency key, return cached outcome
    if (txResult.is_duplicate) {
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          submission_id: submissionId,
          message: txResult.success_message || form.success_message,
          redirect_url: txResult.redirect_url || form.redirect_url,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If conflict detected (email & phone match different leads):
    // Do NOT dispatch automated contact. Return generic success message to visitor.
    if (processingStatus === 'conflict') {
      console.warn(`[submit-public-form] Conflict detected for submission ${submissionId}`);
      return new Response(
        JSON.stringify({
          success: true,
          submission_id: submissionId,
          message: txResult.success_message || form.success_message,
          redirect_url: txResult.redirect_url || form.redirect_url,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 2.7 Forward to Canonical process-lead-intake
    // =========================================================================
    if (intakeEventId && leadId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        const intakePayload: LeadIntakePayload = {
          source: 'form',
          intake_event_id: intakeEventId,
          lead_id: leadId,
          external_event_id: submissionId,
          external_lead_id: leadId,
          first_name: fields.first_name ? String(fields.first_name).trim() : undefined,
          last_name: fields.last_name ? String(fields.last_name).trim() : undefined,
          email: rawEmail || undefined,
          phone: phoneE164 || undefined,
          contact_preference: (contactPref as 'email' | 'sms' | 'call') || 'email',
          raw_payload: fields,
        };

        const intakeResponse = await fetch(
          `${supabaseUrl}/functions/v1/process-lead-intake`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(intakePayload),
          }
        );

        if (!intakeResponse.ok) {
          const errText = await intakeResponse.text();
          console.error(`[submit-public-form] process-lead-intake returned ${intakeResponse.status}: ${errText}`);
          // Update submission status to failed, preserving the submission
          await db
            .from('form_submissions')
            .update({
              processing_status: 'failed',
              processing_error: `Intake failed: ${errText.slice(0, 500)}`,
            })
            .eq('id', submissionId);
        } else {
          // Intake succeeded!
          await db
            .from('form_submissions')
            .update({
              processing_status: 'processed',
              processed_at: new Date().toISOString(),
            })
            .eq('id', submissionId);
        }
      } catch (intakeErr) {
        console.error('[submit-public-form] Error calling process-lead-intake:', intakeErr);
        await db
          .from('form_submissions')
          .update({
            processing_status: 'failed',
            processing_error: intakeErr instanceof Error ? intakeErr.message : 'Intake invocation error',
          })
          .eq('id', submissionId);
      }
    }

    // Return final 200 response to public visitor
    return new Response(
      JSON.stringify({
        success: true,
        submission_id: submissionId,
        message: txResult.success_message || form.success_message,
        redirect_url: txResult.redirect_url || form.redirect_url,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
});
