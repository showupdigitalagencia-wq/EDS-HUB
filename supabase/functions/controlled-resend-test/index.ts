// =============================================================================
// Edge Function: controlled-resend-test
// =============================================================================
// Performs exactly ONE controlled live test email send through the real EDS HUB
// Resend production infrastructure to wedersonalmeida2414@gmail.com.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';

const TARGET_RECIPIENT = 'wedersonalmeida2414@gmail.com';
const IDEMPOTENCY_KEY = 'controlled_test:wedersonalmeida2414@gmail.com:batch7_2_single_v1';
const TEST_LEAD_ID = '00000000-0000-4000-8000-000000007201';
const STAGE_ID_NOVO_LEAD = 'fe2a6162-1574-409f-975e-d2b5bafb9862';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Pre-flight Check: Remote Environment Secrets
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
  const resendWebhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');

  const preflightMissing: string[] = [];
  if (!resendApiKey) preflightMissing.push('RESEND_API_KEY');
  if (!resendFromEmail) preflightMissing.push('RESEND_FROM_EMAIL');
  if (!resendWebhookSecret) preflightMissing.push('RESEND_WEBHOOK_SECRET');

  if (preflightMissing.length > 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Pre-flight failed: Missing secrets [${preflightMissing.join(', ')}]`,
        code: 'PRE_FLIGHT_FAILED',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const db = createAdminClient();

  // 2. Check if already sent under stable idempotency key (Strictly Once Guard)
  const { data: existingOutbound } = await db
    .from('outbound_messages')
    .select('id, provider_message_id, status, sent_at, delivered_at, provider_status')
    .eq('idempotency_key', IDEMPOTENCY_KEY)
    .maybeSingle();

  if (existingOutbound && existingOutbound.provider_message_id) {
    return new Response(
      JSON.stringify({
        success: true,
        already_sent: true,
        message: 'Email was already sent with this idempotency key. Duplicate send blocked.',
        outbound_message_id: existingOutbound.id,
        provider_message_id: existingOutbound.provider_message_id,
        status: existingOutbound.status,
        sent_at: existingOutbound.sent_at,
        delivered_at: existingOutbound.delivered_at,
        provider_status: existingOutbound.provider_status,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 3. Ensure isolated test lead exists in public.leads for foreign key integrity
  // Note: source is 'test', which is strictly suppressed from all automations
  await db.from('leads').upsert(
    {
      id: TEST_LEAD_ID,
      first_name: 'Wederson',
      last_name: 'Almeida',
      email: TARGET_RECIPIENT,
      source: 'test',
      source_detail: 'controlled_resend_test',
      contact_preference: 'email',
      pipeline_stage_id: STAGE_ID_NOVO_LEAD,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  // 4. Suppression check
  const { data: suppression } = await db
    .from('email_suppressions')
    .select('reason')
    .eq('normalized_email', TARGET_RECIPIENT.toLowerCase().trim())
    .maybeSingle();

  if (suppression) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Recipient ${TARGET_RECIPIENT} is suppressed (${suppression.reason})`,
        code: 'EMAIL_SUPPRESSED',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 5. Create pending outbound_messages record
  const subject = 'EDS HUB Email Test';
  const bodyText = 'This is a controlled email delivery test from EDS HUB.';
  const bodyHtml = `<p>${bodyText}</p>`;
  const fromSender = 'Expert Dental Solutions <info@expdentalsolutions.com>';
  const replyTo = 'info@expdentalsolutions.com';

  const { data: insertedMsg, error: insertErr } = await db
    .from('outbound_messages')
    .insert({
      lead_id: TEST_LEAD_ID,
      channel: 'email',
      provider: 'resend',
      recipient: TARGET_RECIPIENT,
      template_key: 'controlled_resend_test',
      subject_snapshot: subject,
      body_snapshot: bodyText,
      status: 'pending',
      idempotency_key: IDEMPOTENCY_KEY,
      attempt_count: 1,
    })
    .select('id')
    .single();

  if (insertErr || !insertedMsg) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Failed to create outbound message record: ${insertErr?.message}`,
        code: 'DB_INSERT_FAILED',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const outboundMessageId = insertedMsg.id;

  // 6. Send Real Single Email via Resend Adapter
  const sendResult = await sendEmail({
    from: fromSender,
    to: TARGET_RECIPIENT,
    subject,
    html: bodyHtml,
    text: bodyText,
    replyTo,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

  const nowIso = new Date().toISOString();

  if (!sendResult.success) {
    await db
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_code: sendResult.errorCode || 'RESEND_REJECTED',
        error_message: sendResult.errorMessage || 'Send rejected by Resend',
        failed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', outboundMessageId);

    return new Response(
      JSON.stringify({
        success: false,
        send_accepted: false,
        error: sendResult.errorMessage,
        code: sendResult.errorCode,
        outbound_message_id: outboundMessageId,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 7. Update outbound_messages to 'sent'
  await db
    .from('outbound_messages')
    .update({
      status: 'sent',
      provider_message_id: sendResult.messageId,
      provider_status: 'sent',
      sent_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', outboundMessageId);

  return new Response(
    JSON.stringify({
      success: true,
      send_accepted: true,
      provider_message_id: sendResult.messageId,
      outbound_message_id: outboundMessageId,
      status: 'sent',
      sent_at: nowIso,
      recipient: TARGET_RECIPIENT,
      sender: fromSender,
      subject,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
