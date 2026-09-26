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
  let outboundLeadId: string | null = null;
  let campaignRecipientId: string | null = null;

  if (providerMessageId) {
    const { data: outboundMatch } = await db
      .from('outbound_messages')
      .select('id, recipient, lead_id, opened_at, clicked_at, open_count, click_count, last_clicked_url')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();

    if (outboundMatch) {
      outboundMessageId = outboundMatch.id;
      outboundLeadId = outboundMatch.lead_id || null;
      if (!recipientEmail && outboundMatch.recipient) {
        recipientEmail = outboundMatch.recipient.trim().toLowerCase();
      }
    }

    const { data: campaignMatch } = await db
      .from('campaign_recipients')
      .select('id, email, opened_at, clicked_at, open_count, click_count')
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
  const isOpened = eventType === 'email.opened';
  const isClicked = eventType === 'email.clicked';
  const isBounced = eventType === 'email.bounced';
  const isComplained = eventType === 'email.complained';
  const isDeliveryDelayed = eventType === 'email.delivery_delayed';
  const isFailed = eventType === 'email.failed';
  const isSent = eventType === 'email.sent';
  const isSuppressed = eventType === 'email.suppressed' || eventType === 'suppression.added';

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

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_delivered',
        actor_type: 'system',
        summary: 'E-mail entregue com sucesso',
        metadata: { provider: 'resend', occurred_at: occurredAt, provider_message_id: providerMessageId },
      });
    }
  } else if (isOpened) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'opened',
          opened_at: occurredAt,
          last_opened_at: occurredAt,
          open_count: 1,
          provider_status: 'opened',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'opened',
          opened_at: occurredAt,
          last_opened_at: occurredAt,
          open_count: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_opened',
        actor_type: 'system',
        summary: 'Abertura detectada',
        metadata: { provider: 'resend', occurred_at: occurredAt, provider_message_id: providerMessageId },
      });
    }
  } else if (isClicked) {
    const clickUrl = data.click?.link || '';
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'clicked',
          clicked_at: occurredAt,
          last_clicked_at: occurredAt,
          click_count: 1,
          last_clicked_url: clickUrl || null,
          provider_status: 'clicked',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'clicked',
          clicked_at: occurredAt,
          last_clicked_at: occurredAt,
          click_count: 1,
          last_clicked_url: clickUrl || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_clicked',
        actor_type: 'system',
        summary: clickUrl ? `Clique detectado: ${clickUrl}` : 'Clique detectado',
        metadata: {
          provider: 'resend',
          link: clickUrl,
          user_agent: data.click?.userAgent,
          ip: data.click?.ipAddress,
          occurred_at: occurredAt,
          provider_message_id: providerMessageId,
        },
      });
    }
  } else if (isDeliveryDelayed) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'delayed',
          delivery_delayed_at: occurredAt,
          provider_status: 'delivery_delayed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboundMessageId);
    }

    if (campaignRecipientId) {
      await db
        .from('campaign_recipients')
        .update({
          status: 'delayed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_delivery_delayed',
        actor_type: 'system',
        summary: 'Entrega de e-mail temporariamente adiada pelo servidor',
        metadata: { provider: 'resend', occurred_at: occurredAt, provider_message_id: providerMessageId },
      });
    }
  } else if (isBounced) {
    const bounceMessage = data.bounce?.message || 'Email delivery bounced';
    const bounceType = String(data.bounce?.type || '').toLowerCase();
    const isSoftBounce = bounceType.includes('soft');

    if (isSoftBounce) {
      // Soft Bounce: temporary issue, DO NOT permanently suppress
      if (outboundMessageId) {
        await db
          .from('outbound_messages')
          .update({
            status: 'failed',
            failed_at: occurredAt,
            provider_status: 'soft_bounce',
            bounce_type: 'soft_bounce',
            error_code: 'SOFT_BOUNCE',
            error_message: bounceMessage.substring(0, 200),
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
            bounce_type: 'soft_bounce',
            error_code: 'SOFT_BOUNCE',
            error_message: bounceMessage.substring(0, 200),
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaignRecipientId);
      }

      if (outboundLeadId) {
        await db.from('lead_activities').insert({
          lead_id: outboundLeadId,
          activity_type: 'email_bounced',
          actor_type: 'system',
          summary: `Falha temporária de entrega (Soft Bounce): ${bounceMessage.substring(0, 100)}`,
          metadata: { provider: 'resend', bounce_type: 'soft_bounce', occurred_at: occurredAt },
        });
      }
    } else {
      // Hard Bounce: permanent failure, SUPPRESS recipient
      if (outboundMessageId) {
        await db
          .from('outbound_messages')
          .update({
            status: 'bounced',
            bounced_at: occurredAt,
            failed_at: occurredAt,
            provider_status: 'bounced',
            bounce_type: 'hard_bounce',
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
            bounce_type: 'hard_bounce',
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

      if (outboundLeadId) {
        await db.from('lead_activities').insert({
          lead_id: outboundLeadId,
          activity_type: 'email_bounced',
          actor_type: 'system',
          summary: `E-mail não entregue (Hard Bounce): ${bounceMessage.substring(0, 100)}`,
          metadata: { provider: 'resend', bounce_type: data.bounce?.type || 'hard_bounce', occurred_at: occurredAt },
        });
      }

      // Non-blocking critical deliverability notification for hard bounce
      try {
        let leadName: string | null = null;
        if (outboundLeadId) {
          const { data: leadRec } = await db
            .from('leads')
            .select('first_name, last_name')
            .eq('id', outboundLeadId)
            .maybeSingle();
          if (leadRec) {
            leadName = [leadRec.first_name, leadRec.last_name].filter(Boolean).join(' ') || null;
          }
        }

        await db.functions.invoke('send-push-notification', {
          body: {
            event_type: 'deliverability_critical',
            event_id: outboundLeadId || providerMessageId || providerEventId,
            idempotency_key: `bounce_${providerEventId}`,
            title: leadName ? `Hard bounce — ${leadName}` : 'Alerta de Entregabilidade: Hard Bounce',
            body: leadName
              ? 'O endereço rejeitou permanentemente o email. Novos envios foram bloqueados.'
              : `E-mail para ${recipientEmail} rejeitado permanentemente (Hard Bounce).`,
            deep_link: outboundLeadId ? `/leads/${outboundLeadId}?tab=conversas` : '/reports',
          },
        });
      } catch (pushErr) {
        console.warn('[resend-event-webhook] Critical deliverability push notice:', pushErr);
      }
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

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_complained',
        actor_type: 'system',
        summary: 'Destinatário reportou e-mail como spam',
        metadata: { provider: 'resend', occurred_at: occurredAt },
      });
    }

    // Non-blocking critical deliverability notification for spam complaint
    try {
      let leadName: string | null = null;
      if (outboundLeadId) {
        const { data: leadRec } = await db
          .from('leads')
          .select('first_name, last_name')
          .eq('id', outboundLeadId)
          .maybeSingle();
        if (leadRec) {
          leadName = [leadRec.first_name, leadRec.last_name].filter(Boolean).join(' ') || null;
        }
      }

      await db.functions.invoke('send-push-notification', {
        body: {
          event_type: 'deliverability_critical',
          event_id: outboundLeadId || providerMessageId || providerEventId,
          idempotency_key: `complaint_${providerEventId}`,
          title: leadName ? `Spam detectado — ${leadName}` : 'Alerta de Entregabilidade: Spam',
          body: leadName
            ? 'O email deste lead foi marcado como spam e os próximos envios foram bloqueados.'
            : `E-mail para ${recipientEmail} reportado como spam (Reclamação).`,
          deep_link: outboundLeadId ? `/leads/${outboundLeadId}?tab=conversas` : '/reports',
        },
      });
    } catch (pushErr) {
      console.warn('[resend-event-webhook] Critical deliverability complaint push notice:', pushErr);
    }
  } else if (isSuppressed) {
    if (outboundMessageId) {
      await db
        .from('outbound_messages')
        .update({
          status: 'failed',
          failed_at: occurredAt,
          provider_status: 'suppressed',
          error_code: 'PROVIDER_SUPPRESSED',
          error_message: 'Destinatário suprimido no provedor de e-mail',
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
          error_code: 'PROVIDER_SUPPRESSED',
          error_message: 'Destinatário suprimido no provedor de e-mail',
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignRecipientId);
    }

    if (recipientEmail && recipientEmail !== 'unknown@expdentalsolutions.com') {
      await db
        .from('email_suppressions')
        .upsert(
          {
            normalized_email: recipientEmail,
            reason: 'manual',
            provider: 'resend',
            provider_event_id: providerEventId,
            source_message_id: providerMessageId || null,
            metadata: { provider_suppressed: true, occurred_at: occurredAt },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'normalized_email' }
        );
    }

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_suppressed',
        actor_type: 'system',
        summary: 'Envio bloqueado: destinatário suprimido pelo provedor',
        metadata: { provider: 'resend', occurred_at: occurredAt },
      });
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

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_failed',
        actor_type: 'system',
        summary: `Falha técnica no envio: ${(data.error || 'Erro do provedor').substring(0, 100)}`,
        metadata: { provider: 'resend', occurred_at: occurredAt },
      });
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

    if (outboundLeadId) {
      await db.from('lead_activities').insert({
        lead_id: outboundLeadId,
        activity_type: 'email_sent',
        actor_type: 'system',
        summary: 'E-mail enviado',
        metadata: { provider: 'resend', occurred_at: occurredAt, provider_message_id: providerMessageId },
      });
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
