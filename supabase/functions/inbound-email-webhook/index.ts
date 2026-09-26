// =============================================================================
// Edge Function: inbound-email-webhook
// =============================================================================
// Ingestion endpoint for inbound emails from Resend.
// Validates Svix webhook signature, normalizes email data, detects automated
// reply loops (out-of-office, bounces, mailer-daemon), and invokes the
// atomic PostgreSQL RPC ingest_inbound_message_transaction.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { verifyResendSignature } from '../_shared/webhook-verifier.ts';

/**
 * Detects automated responses, out-of-office replies, delivery notifications,
 * and mailer loops using standard RFC headers and subject conventions.
 */
function detectAutoReply(
  headers: Record<string, string>,
  subject: string | null,
  fromAddress: string
): { isAutoReply: boolean; reason?: string } {
  // 1. Auto-Submitted header (RFC 3834)
  const autoSubmitted = (
    headers['auto-submitted'] ||
    headers['Auto-Submitted'] ||
    ''
  ).toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') {
    return { isAutoReply: true, reason: `Auto-Submitted: ${autoSubmitted}` };
  }

  // 2. X-Autoreply header
  const xAutoreply = (
    headers['x-autoreply'] ||
    headers['X-Autoreply'] ||
    ''
  ).toLowerCase();
  if (xAutoreply === 'yes') {
    return { isAutoReply: true, reason: 'X-Autoreply: yes' };
  }

  // 3. Precedence header
  const precedence = (
    headers['precedence'] ||
    headers['Precedence'] ||
    ''
  ).toLowerCase();
  if (['bulk', 'junk', 'auto_reply'].includes(precedence)) {
    return { isAutoReply: true, reason: `Precedence: ${precedence}` };
  }

  // 4. X-Auto-Response-Suppress header (Microsoft Exchange)
  const xAutoResponseSuppress = (
    headers['x-auto-response-suppress'] ||
    headers['X-Auto-Response-Suppress'] ||
    ''
  ).toLowerCase();
  if (xAutoResponseSuppress && xAutoResponseSuppress !== 'none') {
    return { isAutoReply: true, reason: `X-Auto-Response-Suppress: ${xAutoResponseSuppress}` };
  }

  // 5. System sender (mailer-daemon, postmaster, noreply, bounce)
  if (/^(mailer-daemon|postmaster|noreply|no-reply|bounce)@/i.test(fromAddress)) {
    return { isAutoReply: true, reason: `System sender: ${fromAddress}` };
  }

  // 6. Subject indicators for Out of Office, vacation, bounce, delivery failures
  const sub = (subject || '').trim();
  const autoSubjectRegex = /^(out of office|automatic reply|resposta autom[áa]tica|auto-reply|ausente|undelivered mail|delivery status notification|returned mail|failure notice)/i;
  if (autoSubjectRegex.test(sub)) {
    return { isAutoReply: true, reason: `Automated subject pattern: ${sub.slice(0, 40)}` };
  }

  return { isAutoReply: false };
}

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
  } catch (_err: any) {
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
  const headers = (data.headers || {}) as Record<string, string>;
  let inReplyTo = headers['in-reply-to'] || headers['In-Reply-To'] || data.in_reply_to || null;
  let references = headers['references'] || headers['References'] || data.references || null;

  if (inReplyTo) {
    // Strip < > if present in Message-ID
    inReplyTo = inReplyTo.replace(/[<>]/g, '').trim();
  }
  if (references) {
    references = references.replace(/[<>]/g, '').trim();
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

  // Loop & Auto-Reply Protection
  const autoReplyCheck = detectAutoReply(headers, subject, fromAddress);

  // 4. Ingest via Atomic Transactional RPC
  try {
    const db = createAdminClient();

    // If auto-reply is detected, we still ingest into inbound_messages for CRM visibility,
    // but we tag raw_metadata with is_auto_reply: true.
    // If it's a system sender / bounce, ingest_inbound_message_transaction flags HEADER_SENDER_MISMATCH.
    // If it's an out-of-office autoreply from the lead, we must ensure it doesn't trigger automated sequences.
    const rawMetadata: Record<string, any> = {
      event_type: payload.type || 'email.received',
      svix_id: svixId,
      received_at: new Date().toISOString(),
      is_auto_reply: autoReplyCheck.isAutoReply,
    };

    if (autoReplyCheck.isAutoReply) {
      rawMetadata.auto_reply_reason = autoReplyCheck.reason;
    }

    // When an auto-reply is detected from a lead, to prevent qualification status modification
    // or automated response triggers, we handle ingestion directly with safe metadata.
    if (autoReplyCheck.isAutoReply) {
      // 1. Idempotency check: If already ingested, return existing row
      const { data: existing } = await db
        .from('inbound_messages')
        .select('id, processing_status, lead_id, conversation_id')
        .eq('provider', 'resend')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            already_processed: true,
            inbound_message_id: existing.id,
            lead_id: existing.lead_id,
            conversation_id: existing.conversation_id,
            processing_status: existing.processing_status,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 2. Resolve matching lead if any
      let matchedLeadId: string | null = null;
      let matchedConvId: string | null = null;

      if (inReplyTo) {
        const { data: matchedOut } = await db
          .from('outbound_messages')
          .select('lead_id, conversation_id')
          .or(`provider_message_id.eq.${inReplyTo},idempotency_key.eq.${inReplyTo}`)
          .maybeSingle();

        if (matchedOut) {
          // Verify sender doesn't conflict
          const { data: leadCheck } = await db
            .from('leads')
            .select('id')
            .eq('id', matchedOut.lead_id)
            .ilike('email', fromAddress)
            .maybeSingle();

          if (leadCheck) {
            matchedLeadId = matchedOut.lead_id;
            matchedConvId = matchedOut.conversation_id;
          }
        }
      }

      if (!matchedLeadId) {
        const { data: leads } = await db
          .from('leads')
          .select('id')
          .ilike('email', fromAddress);

        if (leads && leads.length === 1) {
          matchedLeadId = leads[0].id;
        }
      }

      // 3. Resolve or update conversation if lead found
      if (matchedLeadId) {
        if (!matchedConvId) {
          const { data: conv } = await db
            .from('conversations')
            .select('id')
            .eq('lead_id', matchedLeadId)
            .eq('channel', 'email')
            .maybeSingle();
          matchedConvId = conv?.id || null;
        }

        if (matchedConvId) {
          await db
            .from('conversations')
            .update({
              last_message_at: new Date().toISOString(),
              last_message_preview: `[Auto-resposta] ${bodyText.slice(0, 100)}`,
              last_message_direction: 'inbound',
              updated_at: new Date().toISOString(),
            })
            .eq('id', matchedConvId);
        }
      }

      // 4. Ingest inbound message without triggering lead_replied or qualification transition
      const { data: newInbound, error: insErr } = await db
        .from('inbound_messages')
        .insert({
          lead_id: matchedLeadId,
          conversation_id: matchedConvId,
          channel: 'email',
          provider: 'resend',
          provider_message_id: providerMessageId,
          provider_thread_id: providerThreadId,
          from_address: fromAddress,
          to_address: toAddress,
          subject: subject,
          body_text: bodyText,
          body_html: bodyHtml,
          attachments: attachmentsMeta,
          raw_metadata: rawMetadata,
          processing_status: 'processed',
          received_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insErr) {
        console.error('Failed to insert auto-reply inbound message:', insErr);
        return new Response(
          JSON.stringify({ error: 'Database insert error', details: insErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          inbound_message_id: newInbound?.id,
          lead_id: matchedLeadId,
          conversation_id: matchedConvId,
          is_auto_reply: true,
          processing_status: 'processed',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Standard human reply path via atomic RPC
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
      p_raw_metadata: rawMetadata,
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

    // Supplementary push notification for inbound email reply
    if (rpcResult && (rpcResult as any).success && (rpcResult as any).lead_id) {
      try {
        const { data: leadData } = await db
          .from('leads')
          .select('id, first_name, last_name')
          .eq('id', (rpcResult as any).lead_id)
          .maybeSingle();

        const leadName = leadData
          ? `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim()
          : fromAddress;

        await db.functions.invoke('send-push-notification', {
          body: {
            event_type: 'inbound_email',
            event_id: (rpcResult as any).inbound_message_id || (rpcResult as any).lead_id,
            idempotency_key: `inbound_${(rpcResult as any).inbound_message_id || Date.now()}`,
            title: 'Nova resposta recebida',
            body: `${leadName} respondeu ao seu e-mail.`,
            deep_link: `/leads/${(rpcResult as any).lead_id}?tab=conversations`,
          },
        });
      } catch (pushErr) {
        console.warn('[inbound-email-webhook] Push notification notice:', pushErr);
      }
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

