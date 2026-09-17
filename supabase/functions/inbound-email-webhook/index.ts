// =============================================================================
// Edge Function: inbound-email-webhook
// =============================================================================
// Ingestion endpoint for inbound emails from Resend.
// Validates Svix webhook signature, normalizes email data, and invokes the
// private atomic PostgreSQL RPC ingest_inbound_message_transaction.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { verifyResendSignature } from '../_shared/webhook-verifier.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1. Read Raw Body (Required for exact Svix signature validation)
  const rawBody = await req.text();

  // 2. Validate Resend (Svix) Webhook Signature
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';

  // Skip signature check ONLY if specifically configured in development/test environment
  const isTestBypass = !webhookSecret && Deno.env.get('ALLOW_UNVERIFIED_WEBHOOKS') === 'true';

  if (!isTestBypass) {
    if (!webhookSecret) {
      return new Response(
        JSON.stringify({ error: 'RESEND_WEBHOOK_SECRET is not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const verification = await verifyResendSignature(
      rawBody,
      { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret
    );

    if (!verification.valid) {
      return new Response(
        JSON.stringify({ error: 'Invalid webhook signature', details: verification.error }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // 3. Parse and Normalize Payload
  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Malformed JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const data = payload.data || payload;

  // Extract from address (handles formats like "Dr. John Doe <john@example.com>" or "john@example.com")
  const rawFrom = String(data.from || '');
  const emailMatch = rawFrom.match(/<([^>]+)>/) || [null, rawFrom];
  const fromAddress = (emailMatch[1] || rawFrom).trim().toLowerCase();

  // Extract to address
  let toAddress = '';
  if (Array.isArray(data.to)) {
    toAddress = String(data.to[0] || '').trim().toLowerCase();
  } else if (typeof data.to === 'string') {
    toAddress = data.to.trim().toLowerCase();
  }

  const subject = data.subject || null;
  const bodyText = data.text || (data.html ? data.html.replace(/<[^>]*>/g, '') : '') || '(Empty email message)';
  const bodyHtml = data.html || null;
  const providerMessageId = data.email_id || data.message_id || data.id || svixId || crypto.randomUUID();
  const providerThreadId = data.thread_id || null;

  // Extract threading headers
  const headers = data.headers || {};
  let inReplyTo = headers['in-reply-to'] || headers['In-Reply-To'] || data.in_reply_to || null;
  let references = headers['references'] || headers['References'] || data.references || null;

  if (inReplyTo) {
    // Strip < > if present in Message-ID
    inReplyTo = inReplyTo.replace(/[<>]/g, '').trim();
  }

  // Extract attachments metadata (safe metadata only, no heavy blobs)
  const attachmentsMeta: Array<{ filename: string; mime_type: string; size?: number; provider_attachment_id?: string }> = [];
  if (Array.isArray(data.attachments)) {
    for (const att of data.attachments) {
      attachmentsMeta.push({
        filename: att.filename || 'attachment',
        mime_type: att.content_type || att.mime_type || 'application/octet-stream',
        size: Number(att.size) || 0,
        provider_attachment_id: att.id || undefined,
      });
    }
  }

  // 4. Ingest via Atomic Transactional RPC
  try {
    const db = createAdminClient();

    const { data: rpcResult, error: rpcErr } = await db.rpc('ingest_inbound_message_transaction', {
      p_channel: 'email',
      p_provider: 'resend',
      p_provider_message_id: providerMessageId,
      p_from_address: fromAddress,
      p_to_address: toAddress,
      p_subject: subject,
      p_body_text: bodyText,
      p_body_html: bodyHtml,
      p_attachments: attachmentsMeta,
      p_raw_metadata: {
        event_type: payload.type || 'email.received',
        svix_id: svixId,
        received_at: new Date().toISOString(),
      },
      p_in_reply_to: inReplyTo,
      p_references: references,
      p_provider_thread_id: providerThreadId,
    });

    if (rpcErr) {
      console.error('Inbound email transaction failed:', rpcErr);
      return new Response(
        JSON.stringify({ error: 'Database transaction error', details: rpcErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(rpcResult), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Unexpected error processing inbound email:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
