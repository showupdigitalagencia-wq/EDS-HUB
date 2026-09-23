// =============================================================================
// Edge Function: send-conversation-message
// =============================================================================
// Sends manual outbound staff replies from the CRM (Inbox or Lead Detail).
// Enforces app_user authentication, evaluates contact preference with explicit
// confirmation override, dispatches via Resend/Twilio, links to conversation,
// and records outbound_messages and audit activities.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';
import { sendSms } from '../_shared/twilio-adapter.ts';

interface SendMessagePayload {
  lead_id: string;
  conversation_id?: string | null;
  channel: 'email' | 'sms';
  subject?: string | null;
  body: string;
  override_preference_confirmed?: boolean;
  in_reply_to_provider_message_id?: string | null;
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

  // 1. Authorization: Only active app users can send manual replies
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized || !authResult.userId) {
    return new Response(JSON.stringify({ error: authResult.error || 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: SendMessagePayload = await req.json();
    const {
      lead_id,
      conversation_id,
      channel,
      subject,
      body,
      override_preference_confirmed,
      in_reply_to_provider_message_id,
    } = payload;

    if (!lead_id || !channel || !body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: lead_id, channel, body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = createAdminClient();

    // 2. Fetch Lead
    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('id, first_name, last_name, email, phone_raw, phone_e164, contact_preference')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return new Response(
        JSON.stringify({ error: 'Lead not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Contact Preference Guard with Explicit User Confirmation Override
    const leadPref = (lead.contact_preference || 'email').toLowerCase();
    const isChannelMismatch = channel !== leadPref;

    if (isChannelMismatch && !override_preference_confirmed) {
      return new Response(
        JSON.stringify({
          error: 'CONTACT_PREFERENCE_MISMATCH',
          preference_warning: true,
          preferred_channel: leadPref,
          message: `This lead prefers ${leadPref.toUpperCase()}. Send ${channel.toUpperCase()} anyway?`,
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Resolve / Ensure Conversation
    let targetConvId = conversation_id;
    if (!targetConvId) {
      // Find existing or create
      if (channel === 'sms') {
        const { data: existingConv } = await db
          .from('conversations')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('channel', 'sms')
          .maybeSingle();

        if (existingConv) {
          targetConvId = existingConv.id;
        } else {
          const { data: newConv } = await db
            .from('conversations')
            .insert({
              lead_id: lead.id,
              channel: 'sms',
              status: 'open',
              last_message_at: new Date().toISOString(),
              last_message_preview: body.slice(0, 120),
              last_message_direction: 'outbound',
            })
            .select('id')
            .single();
          targetConvId = newConv?.id;
        }
      } else {
        // Email
        const { data: newConv } = await db
          .from('conversations')
          .insert({
            lead_id: lead.id,
            channel: 'email',
            status: 'open',
            subject: subject || 'Message from Expert Dental Solutions',
            last_message_at: new Date().toISOString(),
            last_message_preview: body.slice(0, 120),
            last_message_direction: 'outbound',
          })
          .select('id')
          .single();
        targetConvId = newConv?.id;
      }
    }

    // 5. Dispatch Message
    let providerMessageId: string | null = null;
    let recipient = '';
    const idempotencyKey = `manual_msg:${lead.id}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;

    if (channel === 'email') {
      recipient = lead.email ? lead.email.trim().toLowerCase() : '';
      if (!recipient) {
        return new Response(
          JSON.stringify({ error: 'Lead has no valid email address' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
      const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;
      const replyTo = 'info@expdentalsolutions.com';
      const finalSubject = subject || 'Update from Expert Dental Solutions';
      const htmlBody = body.includes('<p>') ? body : `<p>${body.replace(/\n/g, '<br/>')}</p>`;

      const headers: Record<string, string> = {};
      if (in_reply_to_provider_message_id) {
        headers['In-Reply-To'] = in_reply_to_provider_message_id;
        headers['References'] = in_reply_to_provider_message_id;
      }

      const sendRes = await sendEmail({
        from: sender,
        to: recipient,
        subject: finalSubject,
        html: htmlBody,
        replyTo,
        idempotencyKey,
        headers,
      });

      if (!sendRes.success) {
        return new Response(
          JSON.stringify({ error: sendRes.errorMessage || 'Failed to send email via Resend' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      providerMessageId = sendRes.messageId;
    } else if (channel === 'sms') {
      recipient = lead.phone_e164 || lead.phone_raw || '';
      if (!recipient) {
        return new Response(
          JSON.stringify({ error: 'Lead has no valid phone number' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const sendRes = await sendSms({
        to: recipient,
        body,
      });

      if (!sendRes.success) {
        return new Response(
          JSON.stringify({ error: sendRes.errorMessage || 'Failed to send SMS via Twilio' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      providerMessageId = sendRes.messageId;
    }

    // 6. Record Outbound Message
    const { data: outboundMsg, error: outErr } = await db
      .from('outbound_messages')
      .insert({
        lead_id: lead.id,
        conversation_id: targetConvId,
        channel,
        provider: channel === 'email' ? 'resend' : 'twilio',
        recipient,
        template_key: 'manual_crm_reply',
        subject_snapshot: channel === 'email' ? (subject || null) : null,
        body_snapshot: body,
        status: 'sent',
        provider_message_id: providerMessageId,
        idempotency_key: idempotencyKey,
        attempt_count: 1,
        sent_at: new Date().toISOString(),
        is_manual_reply: true,
        actor_id: authResult.userId,
        in_reply_to_provider_message_id: in_reply_to_provider_message_id || null,
      })
      .select('id')
      .single();

    if (outErr) {
      console.error('Failed to log outbound_messages:', outErr);
    }

    // 7. Update Conversation
    if (targetConvId) {
      await db
        .from('conversations')
        .update({
          status: 'open',
          closed_at: null,
          last_message_at: new Date().toISOString(),
          last_message_preview: body.slice(0, 120),
          last_message_direction: 'outbound',
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetConvId);
    }

    // 8. Log Timeline Activity (actor_type = 'user')
    await db.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: channel === 'email' ? 'email_dispatched' : 'sms_dispatched',
      actor_type: 'user',
      summary: channel === 'email'
        ? `Manual email dispatched: "${(subject || body).slice(0, 50)}..."`
        : `Manual SMS dispatched to ${recipient}`,
      metadata: {
        is_manual_reply: true,
        channel,
        conversation_id: targetConvId,
        outbound_message_id: outboundMsg?.id,
        preference_override: isChannelMismatch,
        preferred_channel: leadPref,
        actor_id: authResult.userId,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        outbound_message_id: outboundMsg?.id,
        conversation_id: targetConvId,
        provider_message_id: providerMessageId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Unexpected error sending conversation message:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
