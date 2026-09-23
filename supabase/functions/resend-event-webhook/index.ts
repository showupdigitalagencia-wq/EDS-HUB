// =============================================================================
// Edge Function: resend-event-webhook
// =============================================================================
// Ingestion endpoint for Resend delivery lifecycle events:
// - email.sent
// - email.delivered
// - email.delivery_delayed
// - email.bounced
// - email.complained
//
// Validates Svix signature, guarantees event idempotency, updates factual
// delivery statuses and timestamps on outbound_messages and campaign_recipients,
// and records factual suppressions (hard bounces, complaints).
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

  // 1. Read Raw Body (strictly required for exact Svix signature verification)
  const rawBody = await req.text();

  // 2. Validate Resend (Svix) Webhook Signature
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';

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

  // 3. Parse Payload
  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch (_err) {
    return new Response(JSON.stringify({ error: 'Malformed JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const data = payload.data || {};
  const eventType = String(payload.type || '').trim().toLowerCase();
  const providerEventId = String(payload.id || data.id || svixId || crypto.randomUUID());
  const providerMessageId = String(data.email_id || data.id || data.message_id || '');
  const occurredAt = payload.created_at || data.created_at || new Date().toISOString();

  // Extract recipient email
  let recipientEmail = '';
  if (Array.isArray(data.to) && data.to.length > 0) {
    recipientEmail = String(data.to[0]).trim().toLowerCase();
  } else if (typeof data.to === 'string') {
    recipientEmail = data.to.trim().toLowerCase();
  }

  const db = createAdminClient();

  // 4. Event Idempotency Check via email_provider_event_logs
  const { data: existingLog } = await db
    .from('email_provider_event_logs')
    .select('id')
    .eq('provider_event_id', providerEventId)
    .maybeSingle();

  if (existingLog) {
    return new Response(
      JSON.stringify({ success: true, message: 'Event already processed', event_id: providerEventId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 5. Match Outbound Message & Campaign Recipient by provider_message_id
  let outboundMessageId: string | null = null;
  let campaignRecipientId: string | null = null;

  if (providerMessageId) {
    const { data: outboundMatch } = await db
      .from('outbound_messages')
      .select('id, recipient')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();

    if (outboundMatch) {
      outboundMessageId = outboundMatch.id;
      if (!recipientEmail && outboundMatch.recipient) {
        recipientEmail = outboundMatch.recipient.trim().toLowerCase();
      }
    }

    const { data: campaignMatch } = await db
      .from('campaign_recipients')
      .select('id, email')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();

    if (campaignMatch) {
      campaignRecipientId = campaignMatch.id;
      if (!recipientEmail && campaignMatch.email) {
        recipientEmail = campaignMatch.email.trim().toLowerCase();
      }
    }
  }

  // Fallback recipient from raw payload if still empty
  if (!recipientEmail) {
    recipientEmail = 'unknown@expdentalsolutions.com';
  }

  // 6. Process Specific Factual Event Types
  const isDelivered = eventType === 'email.delivered';
  const isBounced = eventType === 'email.bounced';
  const isComplained = eventType === 'email.complained';
  const isDeliveryDelayed = eventType === 'email.delivery_delayed';
  const isFailed = eventType === 'email.failed';
  const isSent = eventType === 'email.sent';

  if (isDelivered) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'delivered',
          delivered_at: occurredAt,
          provider_status: 'delivered',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'delivered',
          delivered_at: occurredAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }
  } else if (isBounced) {
    const bounceMessage = data.bounce?.message || 'Email delivery bounced';

    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'bounced',
          bounced_at: occurredAt,
          failed_at: occurredAt,
          provider_status: 'bounced',
          error_code: 'BOUNCED',
          error_message: bounceMessage.substring(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'bounced',
          bounced_at: occurredAt,
          failed_at: occurredAt,
          error_code: 'BOUNCED',
          error_message: bounceMessage.substring(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }

    // Record suppression on hard bounce
    if (recipientEmail && recipientEmail !== 'unknown@expdentalsolutions.com') {
      await db
        .from('email_suppressions')
        .upsert(
          {
            normalized_email: recipientEmail,
            reason: 'hard_bounce',
            provider: 'resend',
            provider_event_id: providerEventId,
            source_message_id: providerMessageId || null,
            metadata: {
              bounce_type: data.bounce?.type || 'hard_bounce',
              occurred_at: occurredAt,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'normalized_email' }
        );
    }
  } else if (isComplained) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'complained',
          complained_at: occurredAt,
          provider_status: 'complained',
          error_code: 'COMPLAINT',
          error_message: 'Recipient reported message as spam',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'complained',
          complained_at: occurredAt,
          error_code: 'COMPLAINT',
          error_message: 'Recipient reported message as spam',
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }

    // Suppress immediately upon spam complaint
    if (recipientEmail && recipientEmail !== 'unknown@expdentalsolutions.com') {
      await db
        .from('email_suppressions')
        .upsert(
          {
            normalized_email: recipientEmail,
            reason: 'complaint',
            provider: 'resend',
            provider_event_id: providerEventId,
            source_message_id: providerMessageId || null,
            metadata: { occurred_at: occurredAt },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'normalized_email' }
        );
    }
  } else if (isFailed) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'failed',
          failed_at: occurredAt,
          provider_status: 'failed',
          error_code: 'DELIVERY_FAILED',
          error_message: (data.error || 'Delivery failed').substring(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'failed',
          failed_at: occurredAt,
          error_code: 'DELIVERY_FAILED',
          error_message: (data.error || 'Delivery failed').substring(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }
  } else if (isSent) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'sent',
          sent_at: occurredAt,
          provider_status: 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'sent',
          sent_at: occurredAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }
  }

  // 7. Persist Event to email_provider_event_logs
  // Store operational metadata only — no API keys, no auth headers, no full email bodies
  const operationalMetadata: Record<string, any> = {
    event_type: eventType,
    occurred_at: occurredAt,
    svix_id: svixId,
  };

  if (isBounced && data.bounce) {
    operationalMetadata.bounce_type = data.bounce.type || 'unknown';
  }

  await db.from('email_provider_event_logs').insert({
    provider: 'resend',
    provider_event_id: providerEventId,
    provider_message_id: providerMessageId || providerEventId,
    event_type: eventType,
    outbound_message_id: outboundMessageId,
    campaign_recipient_id: campaignRecipientId,
    recipient_email: recipientEmail,
    occurred_at: occurredAt,
    metadata: operationalMetadata,
  });

  return new Response(
    JSON.stringify({
      success: true,
      event_type: eventType,
      provider_event_id: providerEventId,
      provider_message_id: providerMessageId,
      matched_outbound: Boolean(outboundMessageId),
      matched_campaign_recipient: Boolean(campaignRecipientId),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
