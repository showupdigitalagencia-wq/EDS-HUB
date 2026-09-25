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
import { resolveSafeFirstName, resolveSalutation } from '../_shared/salutation.ts';

interface SendMessagePayload {
  lead_id: string;
  conversation_id?: string | null;
  channel: 'email' | 'sms';
  subject?: string | null;
  body: string;
  override_preference_confirmed?: boolean;
  in_reply_to_provider_message_id?: string | null;
  idempotency_key?: string | null;
  template_key?: string | null;
  include_attachment?: boolean;
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
    const status = authResult.statusCode || (authResult.userId ? 403 : 401);
    return new Response(JSON.stringify({ error: authResult.error || 'Unauthorized' }), {
      status,
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
      idempotency_key,
      template_key,
      include_attachment,
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
      .select('id, first_name, last_name, email, phone_raw, phone_e164, contact_preference, pipeline_stage_id, course_interest')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return new Response(
        JSON.stringify({ error: 'Lead not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure template variables and greetings are safely resolved server-side
    const safeFirstName = resolveSafeFirstName(lead.first_name, 'Doctor');
    const safeSalutation = resolveSalutation(lead.last_name, lead.first_name, 'Doctor');
    const safeLastName = lead.last_name ? lead.last_name.trim() : '';
    const isZygomaticTpl = template_key === 'zygomatic_course_details';
    const safeCourseName = isZygomaticTpl
      ? 'Zygomatic Implant Training'
      : ((lead as any).course_interest || 'Intensive Dental Implant Training');

    const renderVariables = (text: string) => text
      .replace(/\{\{\s*salutation\s*\}\}/gi, safeSalutation || 'Doctor')
      .replace(/\{\{\s*first_name\s*\}\}/gi, safeFirstName)
      .replace(/\{\{\s*last_name\s*\}\}/gi, safeLastName)
      .replace(/\{\{\s*course_name\s*\}\}/gi, safeCourseName)
      .replace(/\{\{\s*course_date_range\s*\}\}/gi, 'November 7–10, 2026')
      .replace(/\{\{\s*course_tuition\s*\}\}/gi, '$17,500')
      .replace(/\{\{\s*[\w.]+\s*\}\}/g, '');

    const effectiveBody = renderVariables(body.trim());
    const effectiveSubject = renderVariables(subject || (channel === 'email' ? 'Update from Expert Dental Solutions' : ''));

    // 3. Contact Preference Guard with Explicit User Confirmation Override
    const leadPref = (lead.contact_preference || '').toLowerCase();
    const isChannelMismatch = Boolean(leadPref && channel !== leadPref);

    if (isChannelMismatch && !override_preference_confirmed) {
      return new Response(
        JSON.stringify({
          error: 'CONTACT_PREFERENCE_MISMATCH',
          preference_warning: true,
          preferred_channel: leadPref || 'unspecified',
          message: `This lead prefers ${leadPref ? leadPref.toUpperCase() : 'an unspecified channel'}. Send ${channel.toUpperCase()} anyway?`,
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
              last_message_preview: effectiveBody.slice(0, 120),
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
          .select('id')
          .eq('lead_id', lead.id)
          .eq('channel', 'email')
          .maybeSingle();

        if (newConv) {
          targetConvId = newConv.id;
        } else {
          const { data: createdConv } = await db
            .from('conversations')
            .insert({
              lead_id: lead.id,
              channel: 'email',
              status: 'open',
              subject: effectiveSubject || 'Message from Expert Dental Solutions',
              last_message_at: new Date().toISOString(),
              last_message_preview: effectiveBody.slice(0, 120),
              last_message_direction: 'outbound',
            })
            .select('id')
            .single();
          targetConvId = createdConv?.id;
        }
      }
    }

    // 5. Dispatch Message
    let providerMessageId: string | null = null;
    let recipient = '';
    const effectiveIdempotencyKey = idempotency_key?.trim() ||
      `manual_msg:${lead.id}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;

    // Double-send protection: check if an outbound message with this idempotency key already exists
    if (idempotency_key?.trim()) {
      const { data: existingMsg } = await db
        .from('outbound_messages')
        .select('id, provider_message_id, conversation_id, status')
        .eq('idempotency_key', effectiveIdempotencyKey)
        .maybeSingle();

      if (existingMsg) {
        return new Response(
          JSON.stringify({
            success: true,
            outbound_message_id: existingMsg.id,
            conversation_id: existingMsg.conversation_id,
            provider_message_id: existingMsg.provider_message_id,
            already_processed: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Strict Channel Isolation: Ensure template matches the channel
    if (template_key) {
      const { data: tplRecord } = await db
        .from('email_templates')
        .select('id, name, template_key, category, content_json')
        .eq('template_key', template_key)
        .maybeSingle();

      if (tplRecord) {
        const cj = tplRecord.content_json as Record<string, unknown> | null;
        const isSmsTpl =
          tplRecord.category === 'sms' ||
          cj?.channel === 'sms' ||
          (tplRecord as Record<string, unknown>).channel === 'sms';

        if (channel === 'email' && isSmsTpl) {
          return new Response(
            JSON.stringify({
              error: 'TEMPLATE_CHANNEL_MISMATCH',
              message: 'Modelos de SMS não podem ser enviados via e-mail.',
            }),
            { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (channel === 'sms' && !isSmsTpl) {
          return new Response(
            JSON.stringify({
              error: 'TEMPLATE_CHANNEL_MISMATCH',
              message: 'Modelos de e-mail não podem ser enviados via SMS.',
            }),
            { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Strict SMS Rule: SMS must have no attachments
    if (channel === 'sms') {
      if (include_attachment === true) {
        return new Response(
          JSON.stringify({
            error: 'SMS_ATTACHMENTS_NOT_SUPPORTED',
            message: 'SMS não suporta anexos ou arquivos PDF.',
          }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Attachment tracking across all channels (declared in outer function scope)
    let attachmentMetadata = {
      included: false,
      filename: null as string | null,
      materialId: null as string | null,
    };

    if (channel === 'email') {
      recipient = lead.email ? lead.email.trim().toLowerCase() : '';
      if (!recipient) {
        return new Response(
          JSON.stringify({ error: 'Lead has no valid email address' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check suppression table before sending
      const { data: suppression } = await db
        .from('email_suppressions')
        .select('reason')
        .eq('normalized_email', recipient)
        .maybeSingle();

      if (suppression) {
        let warning = 'Este endereço de e-mail está suprimido para envios.';
        if (suppression.reason === 'hard_bounce') {
          warning = 'Este endereço está bloqueado após uma falha permanente de entrega.';
        } else if (suppression.reason === 'complaint') {
          warning = 'Este endereço foi bloqueado após uma reclamação de spam.';
        } else if (suppression.reason === 'unsubscribe') {
          warning = 'Este contato cancelou o recebimento de e-mails.';
        }

        return new Response(
          JSON.stringify({
            error: 'EMAIL_SUPPRESSED',
            reason: suppression.reason,
            message: warning,
          }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
      const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;
      const replyTo = 'info@expdentalsolutions.com';
      const finalSubject = effectiveSubject;
      const htmlBody = effectiveBody.includes('<p>') ? effectiveBody : `<p>${effectiveBody.replace(/\n/g, '<br/>')}</p>`;

      const headers: Record<string, string> = {};
      if (in_reply_to_provider_message_id) {
        headers['In-Reply-To'] = in_reply_to_provider_message_id;
        headers['References'] = in_reply_to_provider_message_id;
      }

      // Attachment handling and verification
      const attachmentsToSend: Array<{ filename: string; content: string; contentType?: string }> = [];

      const requestedTemplateKey = template_key || null;
      const shouldIncludeAttachment = include_attachment !== false;

      if (requestedTemplateKey && shouldIncludeAttachment) {
        // Query template_attachments join course_materials
        const { data: tmplAtt } = await db
          .from('template_attachments')
          .select('is_required, display_name, material_id')
          .eq('template_key', requestedTemplateKey)
          .maybeSingle();

        if (tmplAtt && tmplAtt.material_id) {
          const { data: material } = await db
            .from('course_materials')
            .select('id, title, file_name, storage_bucket, storage_path, content_type, is_active')
            .eq('id', tmplAtt.material_id)
            .single();

          if (material && material.is_active) {
            // Attempt to retrieve PDF binary from Supabase Storage
            const { data: fileData, error: downloadErr } = await db.storage
              .from(material.storage_bucket)
              .download(material.storage_path);

            if (downloadErr || !fileData) {
              console.error('Attachment download failed:', downloadErr);
              if (tmplAtt.is_required || requestedTemplateKey === 'zygomatic_course_details') {
                return new Response(
                  JSON.stringify({
                    error: 'ATTACHMENT_REQUIRED_MISSING',
                    message: `O arquivo PDF oficial do curso (${material.file_name}) é obrigatório para este modelo e não foi encontrado no armazenamento. O envio foi cancelado para garantir a integridade comercial.`,
                  }),
                  { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            } else {
              // Validate MIME type
              const mimeType = fileData.type || material.content_type || 'application/pdf';
              if (mimeType !== 'application/pdf') {
                return new Response(
                  JSON.stringify({
                    error: 'INVALID_ATTACHMENT_MIME',
                    message: `O arquivo anexado deve ser do tipo application/pdf (encontrado: ${mimeType}).`,
                  }),
                  { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }

              // Validate non-empty
              if (fileData.size === 0) {
                return new Response(
                  JSON.stringify({
                    error: 'EMPTY_ATTACHMENT',
                    message: 'O arquivo PDF anexado está vazio (0 bytes).',
                  }),
                  { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }

              // Validate size (max 40MB for Resend)
              if (fileData.size > 40 * 1024 * 1024) {
                return new Response(
                  JSON.stringify({
                    error: 'ATTACHMENT_TOO_LARGE',
                    message: 'O arquivo PDF excede o limite de tamanho suportado (40MB).',
                  }),
                  { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }

              // Convert ArrayBuffer to base64
              const arrayBuffer = await fileData.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, chunk as any);
              }
              const base64Content = btoa(binary);

              attachmentsToSend.push({
                filename: material.file_name || 'Zygomatic Course Details.pdf',
                content: base64Content,
                contentType: 'application/pdf',
              });

              attachmentMetadata = {
                included: true,
                filename: material.file_name,
                materialId: material.id,
              };
            }
          }
        } else if (requestedTemplateKey === 'zygomatic_course_details') {
          return new Response(
            JSON.stringify({
              error: 'ATTACHMENT_REQUIRED_MISSING',
              message: 'O anexo oficial do curso (PDF) é obrigatório para este modelo e não foi encontrado configurado no sistema.',
            }),
            { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const sendRes = await sendEmail({
        from: sender,
        to: recipient,
        subject: finalSubject,
        html: htmlBody,
        replyTo,
        idempotencyKey: effectiveIdempotencyKey,
        headers,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
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
        body: effectiveBody,
      });

      if (!sendRes.success) {
        return new Response(
          JSON.stringify({ error: sendRes.errorMessage || 'Failed to send SMS via Twilio' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      providerMessageId = sendRes.messageId;
    }

    // 6. Record Outbound Message with attachment metadata
    const { data: outboundMsg, error: outErr } = await db
      .from('outbound_messages')
      .insert({
        lead_id: lead.id,
        conversation_id: targetConvId,
        channel,
        provider: channel === 'email' ? 'resend' : 'twilio',
        recipient,
        template_key: template_key || 'manual_crm_reply',
        subject_snapshot: channel === 'email' ? (effectiveSubject || null) : null,
        body_snapshot: effectiveBody,
        status: 'sent',
        provider_message_id: providerMessageId,
        idempotency_key: effectiveIdempotencyKey,
        attempt_count: 1,
        sent_at: new Date().toISOString(),
        is_manual_reply: true,
        actor_id: authResult.userId,
        in_reply_to_provider_message_id: in_reply_to_provider_message_id || null,
        attachment_included: attachmentMetadata.included,
        attachment_filename: attachmentMetadata.filename,
        attachment_material_id: attachmentMetadata.materialId,
        metadata: {
          template_key: template_key || null,
          attachment_included: attachmentMetadata.included,
          attachment_filename: attachmentMetadata.filename,
          attachment_material_id: attachmentMetadata.materialId,
        },
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
          last_message_preview: effectiveBody.slice(0, 120),
          last_message_direction: 'outbound',
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetConvId);
    }

    // 8. Stage Advancement: If this email dispatch was to a Novo Lead (capture), advance to Respondido (qualification)
    if (channel === 'email' && lead.pipeline_stage_id) {
      const { data: captureStage } = await db
        .from('pipeline_stages')
        .select('id')
        .eq('code', 'capture')
        .maybeSingle();

      const { data: qualificationStage } = await db
        .from('pipeline_stages')
        .select('id')
        .eq('code', 'qualification')
        .maybeSingle();

      if (captureStage && qualificationStage && lead.pipeline_stage_id === captureStage.id) {
        await db
          .from('leads')
          .update({
            pipeline_stage_id: qualificationStage.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        await db.from('lead_stage_history').insert({
          lead_id: lead.id,
          from_stage_id: captureStage.id,
          to_stage_id: qualificationStage.id,
          change_reason: 'manual_first_contact_email',
        });

        await db.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'stage_changed',
          actor_type: 'user',
          summary: 'Lead advanced from Novo Lead to Respondido after successful email dispatch',
          metadata: {
            from: 'capture',
            to: 'qualification',
            provider_message_id: providerMessageId,
            template_key: template_key || null,
          },
        });
      }
    }

    // 9. Log Timeline Activity (actor_type = 'user')
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
        template_key: template_key || null,
        attachment_included: attachmentMetadata.included,
        attachment_filename: attachmentMetadata.filename,
        attachment_material_id: attachmentMetadata.materialId,
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
      JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Não foi possível enviar a mensagem. Tente novamente em instantes.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
