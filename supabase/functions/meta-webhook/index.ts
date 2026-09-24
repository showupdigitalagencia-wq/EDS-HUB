// =============================================================================
// Edge Function: meta-webhook
// =============================================================================
// Canonical Ingestion Endpoint for Meta Lead Ads (Facebook & Instagram).
//
// Features:
// 1. Webhook Handshake Verification (GET):
//    Handles hub.mode='subscribe', verifies hub.verify_token against server secret,
//    returns hub.challenge.
// 2. Webhook Event Reception (POST):
//    Verifies HMAC-SHA256 signature (X-Hub-Signature-256) with META_APP_SECRET.
//    Supports batch entries and extracts leadgen events safely.
// 3. Event Idempotency & Deduplication:
//    Guarantees no duplicate leads on webhook retries via lead_intake_events
//    unique idempotency_key (meta:leadgen:<id>) and leads unique index.
// 4. Graph API Lead Retrieval (Server-side):
//    Fetches CRM-safe fields (first_name, last_name, full_name, email, phone_number).
//    Gracefully handles pending credentials prior to client authorization.
// 5. Phone Normalization:
//    Preserves raw phone; normalizes to E.164 only when country code is explicit (+).
// 6. Lead Matching & Conflict Protection:
//    Matches by Meta lead ID, email, and phone_e164.
//    Prevents auto-merge if email and phone match two different existing leads.
// 7. Pipeline & Automation Governance:
//    Default stage is strictly 'Novo Lead' (capture).
//    Automated outreach is disabled (ENABLE_META_FIRST_EMAIL_AUTOMATION=false).
//    Zero SMS, zero automatic enrollment.
// 8. Security & Logging:
//    No secrets in logs or frontend. Structured operational logging only.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { verifyMetaSignature } from '../_shared/webhook-verifier.ts';

interface MetaLeadgenValue {
  ad_id?: string;
  form_id?: string;
  leadgen_id: string;
  created_time?: number;
  page_id?: string;
  adgroup_id?: string; // Ad set ID
}

interface MetaWebhookChange {
  field: string;
  value: MetaLeadgenValue;
}

interface MetaWebhookEntry {
  id: string;
  time: number;
  changes: MetaWebhookChange[];
}

interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

interface MetaGraphFieldData {
  name: string;
  values: string[];
}

interface MetaGraphLeadResponse {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: MetaGraphFieldData[];
  platform?: string; // 'fb' | 'ig'
}

Deno.serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const url = new URL(req.url);

  // ===========================================================================
  // 1. Webhook Verification Handshake (GET)
  // ===========================================================================
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedVerifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '';

    if (mode === 'subscribe') {
      if (expectedVerifyToken && token === expectedVerifyToken) {
        console.log('[meta-webhook] Handshake verified successfully');
        return new Response(challenge || '', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      console.warn('[meta-webhook] Handshake verification failed: verify_token mismatch or unconfigured');
      return new Response('Forbidden: verify_token mismatch', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Bad request: invalid hub.mode', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // ===========================================================================
  // 2. Webhook Event Reception (POST)
  // ===========================================================================
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-hub-signature-256') || req.headers.get('X-Hub-Signature-256');
  const appSecret = Deno.env.get('META_APP_SECRET') || '';
  const allowUnverified = Deno.env.get('ALLOW_UNVERIFIED_WEBHOOKS') === 'true';

  // Signature validation
  if (!allowUnverified) {
    if (!appSecret) {
      console.error('[meta-webhook] META_APP_SECRET is not configured on server');
      return new Response(
        JSON.stringify({ error: 'META_APP_SECRET is not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const verification = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
    if (!verification.valid) {
      console.warn('[meta-webhook] Webhook signature verification failed:', verification.error);
      return new Response(
        JSON.stringify({ error: 'Invalid webhook signature', details: verification.error }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // Parse JSON Body
  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_err) {
    return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (payload.object !== 'page') {
    // Acknowledge non-page objects (e.g. user, permissions) safely
    return new Response(JSON.stringify({ success: true, message: 'Non-page object event acknowledged' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Extract leadgen changes
  const leadgenItems: MetaLeadgenValue[] = [];
  if (Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      if (Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'leadgen' && change.value?.leadgen_id) {
            leadgenItems.push({
              ...change.value,
              page_id: change.value.page_id || entry.id,
            });
          }
        }
      }
    }
  }

  if (leadgenItems.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No leadgen changes found in payload' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createAdminClient();
  const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
  const results = [];

  for (const item of leadgenItems) {
    const leadgenId = String(item.leadgen_id).trim();
    const formId = item.form_id ? String(item.form_id).trim() : null;
    const pageId = item.page_id ? String(item.page_id).trim() : null;
    const adId = item.ad_id ? String(item.ad_id).trim() : null;
    const adgroupId = item.adgroup_id ? String(item.adgroup_id).trim() : null;

    const idempotencyKey = `meta:leadgen:${leadgenId}`;

    console.log(`[meta-webhook] Processing leadgen event: leadgen_id=${leadgenId} form_id=${formId || 'none'}`);

    // --- 3. Idempotency Check ---
    const { data: existingEvent } = await db
      .from('lead_intake_events')
      .select('id, status, lead_id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingEvent && (existingEvent.status === 'processed' || existingEvent.status === 'duplicate')) {
      console.log(`[meta-webhook] Leadgen event already processed (idempotency key matched): ${idempotencyKey}`);
      results.push({
        leadgen_id: leadgenId,
        status: 'duplicate',
        lead_id: existingEvent.lead_id,
      });
      continue;
    }

    // Register / update lead_intake_event
    let intakeEventId: string;
    if (existingEvent) {
      intakeEventId = existingEvent.id;
      await db
        .from('lead_intake_events')
        .update({
          status: 'processing',
          attempt_count: 2,
        })
        .eq('id', intakeEventId);
    } else {
      const { data: newEvent, error: insertEventErr } = await db
        .from('lead_intake_events')
        .insert({
          source: 'meta',
          external_lead_id: leadgenId,
          external_event_id: leadgenId,
          idempotency_key: idempotencyKey,
          status: 'processing',
          raw_payload: {
            leadgen_id: leadgenId,
            form_id: formId,
            page_id: pageId,
            ad_id: adId,
            adset_id: adgroupId,
            created_time: item.created_time,
          },
          normalized_payload: {
            leadgen_id: leadgenId,
            form_id: formId,
            page_id: pageId,
          },
          attempt_count: 1,
        })
        .select('id')
        .single();

      if (insertEventErr) {
        if (insertEventErr.code === '23505') {
          // Race condition duplicate
          results.push({ leadgen_id: leadgenId, status: 'duplicate' });
          continue;
        }
        console.error('[meta-webhook] Failed to insert lead_intake_event:', insertEventErr);
        continue;
      }
      intakeEventId = newEvent.id;
    }

    // --- 4. Fetch Lead Data via Graph API ---
    let graphLead: MetaGraphLeadResponse | null = null;
    let graphFetchError: string | null = null;

    if (pageAccessToken) {
      try {
        const graphUrl = `https://graph.facebook.com/v21.0/${leadgenId}?fields=id,created_time,ad_id,form_id,field_data,platform&access_token=${encodeURIComponent(pageAccessToken)}`;
        const graphRes = await fetch(graphUrl, { method: 'GET' });
        if (graphRes.ok) {
          graphLead = await graphRes.json();
        } else {
          const errText = await graphRes.text();
          graphFetchError = `Graph API returned ${graphRes.status}: ${errText.substring(0, 200)}`;
          console.error(`[meta-webhook] Graph API error for ${leadgenId}:`, graphFetchError);
        }
      } catch (err: any) {
        graphFetchError = `Graph API fetch failed: ${err.message}`;
        console.error(`[meta-webhook] Network error fetching ${leadgenId}:`, err);
      }
    } else {
      console.info('[meta-webhook] META_PAGE_ACCESS_TOKEN not yet configured. Event recorded; lead field retrieval pending client authorization.');
    }

    // If Graph API data could not be fetched (e.g. pre-auth meeting state)
    if (!graphLead || !graphLead.field_data) {
      await db
        .from('lead_intake_events')
        .update({
          status: 'received',
          last_error: graphFetchError || 'Pending Meta Page Access Token authorization',
          processed_at: new Date().toISOString(),
        })
        .eq('id', intakeEventId);

      results.push({
        leadgen_id: leadgenId,
        status: 'received',
        note: 'Lead event captured; field data retrieval pending client authorization',
      });
      continue;
    }

    // --- 5. Extract CRM-Safe Fields ---
    const fieldMap: Record<string, string> = {};
    for (const f of graphLead.field_data) {
      if (Array.isArray(f.values) && f.values.length > 0) {
        fieldMap[f.name.toLowerCase().trim()] = String(f.values[0]).trim();
      }
    }

    const rawEmail = fieldMap['email'] || null;
    const cleanEmail = rawEmail && rawEmail.includes('@') ? rawEmail.toLowerCase().trim() : null;

    const rawPhone = fieldMap['phone_number'] || fieldMap['phone'] || null;
    // Phone Normalization: preserve raw; normalize to E.164 only if country safely determinable (+)
    let phoneE164: string | null = null;
    if (rawPhone) {
      const trimmedPhone = rawPhone.trim();
      if (trimmedPhone.startsWith('+')) {
        const digits = trimmedPhone.replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
          phoneE164 = `+${digits}`;
        }
      }
    }

    let firstName = fieldMap['first_name'] || null;
    let lastName = fieldMap['last_name'] || null;
    const fullName = fieldMap['full_name'] || null;

    if (!firstName && !lastName && fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.slice(1).join(' ') || null;
    }

    // Platform detection (factual attribution)
    const platformRaw = (graphLead.platform || '').toLowerCase();
    const sourceDetail = platformRaw === 'ig' ? 'instagram' : platformRaw === 'fb' ? 'facebook' : 'meta_lead_ads';

    // --- 6. Course / Form Mapping Layer ---
    const resolvedCourse = await resolveCourseFromMetaForm(db, formId);

    // --- 7. Lead Matching & Deduplication ---
    // Check 7.1: By source + external_lead_id
    const { data: leadByExternalId } = await db
      .from('leads')
      .select('id, pipeline_stage_id, email, phone_e164, external_lead_id, source')
      .eq('source', 'meta')
      .eq('external_lead_id', leadgenId)
      .maybeSingle();

    // Check 7.2: By normalized email
    let leadByEmail: { id: string; pipeline_stage_id: string; email: string; phone_e164: string | null; external_lead_id: string | null; source: string } | null = null;
    if (cleanEmail) {
      const { data } = await db
        .from('leads')
        .select('id, pipeline_stage_id, email, phone_e164, external_lead_id, source')
        .eq('email', cleanEmail)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      leadByEmail = data;
    }

    // Check 7.3: By normalized E164 phone
    let leadByPhone: { id: string; pipeline_stage_id: string; email: string; phone_e164: string | null; external_lead_id: string | null; source: string } | null = null;
    if (phoneE164) {
      const { data } = await db
        .from('leads')
        .select('id, pipeline_stage_id, email, phone_e164, external_lead_id, source')
        .eq('phone_e164', phoneE164)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      leadByPhone = data;
    }

    // Collision check: Email matches Lead A, Phone matches Lead B
    if (leadByEmail && leadByPhone && leadByEmail.id !== leadByPhone.id) {
      console.warn(`[meta-webhook] Lead conflict detected: email matches ${leadByEmail.id}, phone matches ${leadByPhone.id}. Blocking auto-merge.`);
      
      await db.from('tasks').insert({
        task_type: 'data_review',
        title: 'Meta Lead Conflict: Email & Phone Mismatch',
        description: `Incoming Meta lead (${leadgenId}) has email matching lead ${leadByEmail.id} and phone matching lead ${leadByPhone.id}. Manual review required before merging.`,
        status: 'pending',
        created_by: 'system',
      });

      await db
        .from('lead_intake_events')
        .update({
          status: 'failed',
          last_error: 'Conflict: email and phone belong to two different existing leads. Auto-merge prevented.',
          processed_at: new Date().toISOString(),
        })
        .eq('id', intakeEventId);

      results.push({ leadgen_id: leadgenId, status: 'conflict', error: 'Collision prevented' });
      continue;
    }

    const matchedLead = leadByExternalId || leadByEmail || leadByPhone;
    let targetLeadId: string;
    let isNewLead = false;

    // Get Capture stage ('Novo Lead')
    const { data: captureStage } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('code', 'capture')
      .single();

    if (!captureStage) {
      throw new Error('Pipeline stage "capture" (Novo Lead) not found');
    }

    if (!matchedLead) {
      // --- 8. Create New Lead in Novo Lead ---
      isNewLead = true;
      const { data: newLead, error: createLeadErr } = await db
        .from('leads')
        .insert({
          source: 'meta',
          source_detail: sourceDetail,
          external_lead_id: leadgenId,
          first_name: firstName,
          last_name: lastName,
          email: cleanEmail,
          email_confirmation: cleanEmail,
          phone_raw: rawPhone,
          phone_e164: phoneE164,
          contact_preference: 'email',
          pipeline_stage_id: captureStage.id, // Strictly Novo Lead
          course_interest: resolvedCourse?.courseName || null,
          course_interests: resolvedCourse?.courseName ? [resolvedCourse.courseName] : [],
        })
        .select('id')
        .single();

      if (createLeadErr) {
        if (createLeadErr.code === '23505') {
          // Concurrency duplicate
          results.push({ leadgen_id: leadgenId, status: 'duplicate' });
          continue;
        }
        console.error('[meta-webhook] Failed to create lead:', createLeadErr);
        throw createLeadErr;
      }

      targetLeadId = newLead.id;

      // Stage history log
      await db.from('lead_stage_history').insert({
        lead_id: targetLeadId,
        from_stage_id: null,
        to_stage_id: captureStage.id,
        change_reason: 'initial_assignment',
        intake_event_id: intakeEventId,
      });

      // Lead activity
      await db.from('lead_activities').insert({
        lead_id: targetLeadId,
        intake_event_id: intakeEventId,
        activity_type: 'lead_created',
        actor_type: 'system',
        summary: `Lead created from Meta Lead Ads (${sourceDetail})`,
        metadata: {
          source: 'meta',
          source_detail: sourceDetail,
          platform: platformRaw || 'meta',
          leadgen_id: leadgenId,
          form_id: formId,
          page_id: pageId,
          ad_id: adId,
          adset_id: adgroupId,
          course_interest: resolvedCourse?.courseName || null,
          unmapped_form: !resolvedCourse && Boolean(formId),
        },
      });

      // Attach normalized course interest if mapped
      if (resolvedCourse?.courseId) {
        await db.from('lead_course_interests').insert({
          lead_id: targetLeadId,
          course_id: resolvedCourse.courseId,
          course_session_id: resolvedCourse.courseSessionId || null,
          priority: 1,
          source: 'form',
          status: 'active',
        });
      }

      // If form was present but could not be safely mapped to a course:
      if (formId && !resolvedCourse) {
        const { data: existingTask } = await db
          .from('tasks')
          .select('id')
          .eq('lead_id', targetLeadId)
          .eq('task_type', 'data_review')
          .eq('status', 'pending')
          .maybeSingle();

        if (!existingTask) {
          await db.from('tasks').insert({
            lead_id: targetLeadId,
            intake_event_id: intakeEventId,
            task_type: 'data_review',
            title: 'Review Unmapped Meta Lead Form',
            description: `Lead submitted via Meta Form ID "${formId}". No course mapping configured. Please confirm course interest manually.`,
            status: 'pending',
            created_by: 'system',
          });
        }
      }
    } else {
      // Existing lead — non-destructive update
      targetLeadId = matchedLead.id;

      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (!matchedLead.phone_e164 && phoneE164) {
        updateData.phone_e164 = phoneE164;
      }

      // Attach Meta external_lead_id if not already present on existing lead
      if (!matchedLead.external_lead_id && leadgenId) {
        updateData.external_lead_id = leadgenId;
      }

      await db
        .from('leads')
        .update(updateData)
        .eq('id', targetLeadId);

      // Attach normalized course interest if mapped and not already linked
      if (resolvedCourse?.courseId) {
        const { data: existingInterest } = await db
          .from('lead_course_interests')
          .select('id')
          .eq('lead_id', targetLeadId)
          .eq('course_id', resolvedCourse.courseId)
          .maybeSingle();

        if (!existingInterest) {
          await db.from('lead_course_interests').insert({
            lead_id: targetLeadId,
            course_id: resolvedCourse.courseId,
            course_session_id: resolvedCourse.courseSessionId || null,
            priority: 1,
            source: 'form',
            status: 'active',
          });
        }
      }

      await db.from('lead_activities').insert({
        lead_id: targetLeadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: `Additional intake received from Meta Lead Ads (${sourceDetail})`,
        metadata: {
          leadgen_id: leadgenId,
          form_id: formId,
          source: 'meta',
        },
      });
    }

    // Update lead_intake_event
    await db
      .from('lead_intake_events')
      .update({
        lead_id: targetLeadId,
        status: 'processed',
        processed_at: new Date().toISOString(),
        normalized_payload: {
          first_name: firstName,
          last_name: lastName,
          email: cleanEmail,
          phone_raw: rawPhone,
          phone_e164: phoneE164,
          course_interest: resolvedCourse?.courseName || null,
          form_id: formId,
          page_id: pageId,
          ad_id: adId,
          platform: sourceDetail,
        },
      })
      .eq('id', intakeEventId);

    // Operational log: strictly no secrets, no raw passwords/tokens
    console.log(`[meta-webhook] Lead processed successfully: lead_id=${targetLeadId} is_new=${isNewLead} stage=Novo Lead`);

    results.push({
      leadgen_id: leadgenId,
      lead_id: targetLeadId,
      status: 'processed',
      is_new: isNewLead,
      stage: 'capture',
    });
  }

  return new Response(JSON.stringify({ success: true, processed: results }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// =============================================================================
// Helper: Resolve Course from Meta Form Mapping Layer
// =============================================================================
// Does NOT guess. If unmapped, returns null safely.
// =============================================================================
async function resolveCourseFromMetaForm(
  db: any,
  formId: string | null
): Promise<{ courseId: string; courseName: string; courseCode: string; courseSessionId?: string | null } | null> {
  if (!formId) return null;

  // 1. Check integration_field_mappings or forms metadata
  const { data: mapping } = await db
    .from('integration_field_mappings')
    .select('eds_target, transform_rule')
    .eq('integration', 'meta')
    .eq('external_property', `form:${formId}`)
    .eq('is_active', true)
    .maybeSingle();

  let targetCourseCode: string | null = null;
  if (mapping && mapping.eds_target) {
    targetCourseCode = mapping.eds_target.replace(/^course:/, '').trim();
  }

  // Fallback to null if no explicit mapping
  if (!targetCourseCode) {
    return null;
  }

  // Lookup course catalog
  const { data: course } = await db
    .from('courses')
    .select('id, name, code')
    .eq('active', true)
    .or(`code.eq.${targetCourseCode},name.ilike.${targetCourseCode}`)
    .maybeSingle();

  if (!course) {
    return null;
  }

  return {
    courseId: course.id,
    courseName: course.name,
    courseCode: course.code,
  };
}
