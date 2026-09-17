// =============================================================================
// Edge Function: inbound-sms-webhook
// =============================================================================
// Ingestion endpoint for inbound SMS from Twilio.
// Validates Twilio HMAC-SHA1 signature, normalizes phone numbers, invokes the
// private atomic PostgreSQL RPC ingest_inbound_message_transaction, and returns TwiML.
// =============================================================================

import { createAdminClient } from '../_shared/supabase-client.ts';
import { verifyTwilioSignature } from '../_shared/webhook-verifier.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 1. Read Raw Body and parse form data
  const rawBody = await req.text();
  const searchParams = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }

  // 2. Validate Twilio Webhook Signature
  const twilioSignature = req.headers.get('x-twilio-signature') || req.headers.get('X-Twilio-Signature');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') || '';

  const isTestBypass = !authToken && Deno.env.get('ALLOW_UNVERIFIED_WEBHOOKS') === 'true';

  if (!isTestBypass) {
    if (!authToken) {
      return new Response('TWILIO_AUTH_TOKEN not configured', { status: 500 });
    }

    const verification = await verifyTwilioSignature(
      req.url,
      params,
      twilioSignature,
      authToken
    );

    if (!verification.valid) {
      console.warn('Twilio signature verification failed:', verification.error);
      return new Response('Invalid signature', { status: 401 });
    }
  }

  // 3. Normalize SMS Payload
  const fromPhone = (params.From || '').trim();
  const toPhone = (params.To || '').trim();
  const messageBody = params.Body || '(Empty SMS message)';
  const messageSid = params.MessageSid || params.SmsSid || crypto.randomUUID();

  // 4. Ingest via Atomic Transactional RPC
  try {
    const db = createAdminClient();

    const { error: rpcErr } = await db.rpc('ingest_inbound_message_transaction', {
      p_channel: 'sms',
      p_provider: 'twilio',
      p_provider_message_id: messageSid,
      p_from_address: fromPhone,
      p_to_address: toPhone,
      p_subject: null,
      p_body_text: messageBody,
      p_body_html: null,
      p_attachments: [],
      p_raw_metadata: {
        num_media: params.NumMedia || '0',
        account_sid: params.AccountSid,
        received_at: new Date().toISOString(),
      },
      p_in_reply_to: null,
      p_references: null,
      p_provider_thread_id: null,
    });

    if (rpcErr) {
      console.error('Inbound SMS transaction failed:', rpcErr);
      return new Response('Database transaction error', { status: 500 });
    }

    // Return clean standard TwiML response
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err: any) {
    console.error('Unexpected error processing inbound SMS:', err);
    return new Response('Internal error', { status: 500 });
  }
});
