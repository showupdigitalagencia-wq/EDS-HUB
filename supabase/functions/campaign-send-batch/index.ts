// =============================================================================
// Edge Function: campaign-send-batch
// =============================================================================
// Processes a small batch of pending recipients for a campaign via Resend,
// personalizing content and updating status atomically without full-list locking.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';
import { resolveSalutation } from '../_shared/salutation.ts';
import { escapeHtml } from '../_shared/email-utils.ts';

interface SendBatchPayload {
  campaign_id?: string;
  batch_size?: number;
  process_scheduled?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Verify authorization
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const payload: SendBatchPayload = await req.json();
    const db = createAdminClient();

    let targetCampaignId = payload.campaign_id;

    // Server-side scheduling support (runs without browser being open)
    if (!targetCampaignId && payload.process_scheduled) {
      const nowIso = new Date().toISOString();
      const { data: scheduledJob } = await db
        .from('campaign_jobs')
        .select('campaign_id')
        .eq('status', 'pending')
        .lte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!scheduledJob) {
        return new Response(
          JSON.stringify({ success: true, message: 'No scheduled campaign jobs due for execution.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      targetCampaignId = scheduledJob.campaign_id;
    }

    if (!targetCampaignId) {
      return new Response(
        JSON.stringify({ error: 'Missing campaign_id (or process_scheduled)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const batchSize = Math.min(Math.max(Number(payload.batch_size) || 20, 1), 50);

    // 2. Fetch campaign
    const { data: campaign, error: campError } = await db
      .from('campaigns')
      .select('*')
      .eq('id', targetCampaignId)
      .single();

    if (campError || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const allowedStatuses = ['approved', 'scheduled', 'sending'];
    if (!allowedStatuses.includes(campaign.status)) {
      return new Response(
        JSON.stringify({
          error: `Cannot send batch: Campaign status is '${campaign.status}'. Must be approved, scheduled, or sending.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Set campaign status to 'sending'
    if (campaign.status !== 'sending') {
      await db
        .from('campaigns')
        .update({ status: 'sending', updated_at: new Date().toISOString() })
        .eq('id', payload.campaign_id);
    }

    // 3. Load active versions and variants for content rendering
    const { data: latestVersion } = await db
      .from('campaign_versions')
      .select('*')
      .eq('campaign_id', payload.campaign_id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: variants } = await db
      .from('campaign_variants')
      .select('*')
      .eq('campaign_id', payload.campaign_id);

    const variantMap: Record<string, { subject: string; html_snapshot: string }> = {};
    if (variants) {
      for (const v of variants) {
        variantMap[v.variant_key] = {
          subject: v.subject,
          html_snapshot: v.html_snapshot,
        };
      }
    }

    // 4. Fetch next batch of pending recipients
    const { data: recipients, error: recError } = await db
      .from('campaign_recipients')
      .select('id, lead_id, email, variant, status')
      .eq('campaign_id', payload.campaign_id)
      .eq('status', 'pending')
      .limit(batchSize);

    if (recError) {
      throw recError;
    }

    if (!recipients || recipients.length === 0) {
      // All recipients processed! Mark campaign as 'sent'
      await db
        .from('campaigns')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', payload.campaign_id);

      await db
        .from('campaign_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('campaign_id', payload.campaign_id)
        .eq('status', 'pending');

      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          remaining_pending: 0,
          campaign_status: 'sent',
          message: 'All recipients have already been processed.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Requirement 17: Campaign physical address requirement for CAN-SPAM compliance
    const physicalAddress = campaign.physical_address || Deno.env.get('COMPANY_PHYSICAL_ADDRESS');
    if (!physicalAddress) {
      return new Response(
        JSON.stringify({
          error: 'Campaign sending blocked: Company physical address is required for CAN-SPAM compliance. Configure company address before activating marketing campaigns.',
          code: 'PHYSICAL_ADDRESS_REQUIRED',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
    const fromName = campaign.from_name || 'Expert Dental Solutions';
    const sender = `${fromName} <${fromEmail}>`;
    const replyTo = 'info@expdentalsolutions.com';
    const intraBatchDelayMs = Math.max(Number(Deno.env.get('CAMPAIGN_SEND_DELAY_MS')) || 100, 50);

    let sentCount = 0;
    let failedCount = 0;

    // 5. Send individually to each recipient in the batch
    for (const recipient of recipients) {
      // Re-check recipient status to prevent race conditions
      const { data: currentRec } = await db
        .from('campaign_recipients')
        .select('status')
        .eq('id', recipient.id)
        .single();

      if (currentRec?.status === 'sent') {
        continue; // Already sent — skip
      }

      // Check if recipient is suppressed
      const normalizedRecipient = recipient.email.toLowerCase().trim();
      const { data: suppression } = await db
        .from('email_suppressions')
        .select('reason')
        .eq('normalized_email', normalizedRecipient)
        .maybeSingle();

      if (suppression) {
        await db
          .from('campaign_recipients')
          .update({
            status: 'skipped',
            error_code: 'EMAIL_SUPPRESSED',
            error_message: `Recipient email is suppressed (${suppression.reason})`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipient.id);

        failedCount++;
        continue;
      }

      // Fetch lead details for personalization
      const { data: lead } = await db
        .from('leads')
        .select('first_name, last_name')
        .eq('id', recipient.lead_id)
        .single();

      const salutation = resolveSalutation(
        lead?.last_name || null,
        lead?.first_name || null,
        'Doc',
      );

      // Determine subject and HTML based on variant or base version
      let subject = campaign.subject;
      let html = latestVersion?.html_snapshot || '<p>Expert Dental Solutions Campaign</p>';

      if (recipient.variant && variantMap[recipient.variant]) {
        subject = variantMap[recipient.variant].subject || subject;
        html = variantMap[recipient.variant].html_snapshot || html;
      }

      // Replace variables safely with HTML entity escaping for HTML body
      const firstName = lead?.first_name || '';
      const lastName = lead?.last_name || '';

      subject = subject
        .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
        .replace(/\{\{\s*last_name\s*\}\}/gi, lastName)
        .replace(/\{\{\s*salutation\s*\}\}/gi, salutation);

      html = html
        .replace(/\{\{\s*first_name\s*\}\}/gi, escapeHtml(firstName))
        .replace(/\{\{\s*last_name\s*\}\}/gi, escapeHtml(lastName))
        .replace(/\{\{\s*salutation\s*\}\}/gi, escapeHtml(salutation));

      const idempotencyKey = `campaign:${campaign.id}:${recipient.id}`;

      // Throttling pacing between sequential sends
      await new Promise((resolve) => setTimeout(resolve, intraBatchDelayMs));

      const sendResult = await sendEmail({
        from: sender,
        to: recipient.email,
        subject,
        html,
        replyTo,
        idempotencyKey,
      });

      if (sendResult.success) {
        await db
          .from('campaign_recipients')
          .update({
            status: 'sent',
            provider_message_id: sendResult.messageId,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipient.id);

        // Audit log in lead_activities
        await db.from('lead_activities').insert({
          lead_id: recipient.lead_id,
          activity_type: 'campaign_sent',
          channel: 'email',
          actor_type: 'system',
          summary: `Campaign "${campaign.name}" email sent to ${recipient.email}`,
          metadata: {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            provider_message_id: sendResult.messageId,
          },
        });

        sentCount++;
      } else {
        await db
          .from('campaign_recipients')
          .update({
            status: 'failed',
            error_code: sendResult.errorCode,
            error_message: sendResult.errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipient.id);

        failedCount++;
      }
    }

    // 6. Check remaining pending recipients
    const { count: remainingPending } = await db
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', payload.campaign_id)
      .eq('status', 'pending');

    let finalCampaignStatus = 'sending';
    if (remainingPending === 0) {
      finalCampaignStatus = 'sent';
      await db
        .from('campaigns')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', payload.campaign_id);

      await db
        .from('campaign_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('campaign_id', payload.campaign_id)
        .eq('status', 'pending');
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaign_id: payload.campaign_id,
        processed_in_batch: recipients.length,
        sent: sentCount,
        failed: failedCount,
        remaining_pending: remainingPending || 0,
        campaign_status: finalCampaignStatus,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown send batch error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
