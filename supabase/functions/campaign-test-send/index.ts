// =============================================================================
// Edge Function: campaign-test-send
// =============================================================================
// Sends a single test email for previewing a campaign without creating recipients.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';
import { resolveSalutation } from '../_shared/salutation.ts';

interface TestSendPayload {
  campaign_id: string;
  test_email: string;
  subject?: string;
  html_content?: string;
  version_id?: string;
  variant_key?: 'A' | 'B';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Verify authorization (must be active app_user)
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const payload: TestSendPayload = await req.json();

    if (!payload.campaign_id || !payload.test_email) {
      return new Response(
        JSON.stringify({ error: 'Missing campaign_id or test_email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const db = createAdminClient();

    // 2. Load campaign details
    const { data: campaign, error: campError } = await db
      .from('campaigns')
      .select('*')
      .eq('id', payload.campaign_id)
      .single();

    if (campError || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let subject = payload.subject || campaign.subject || 'Campaign Test Preview';
    let html = payload.html_content || '<p>No content provided</p>';

    // If version_id was provided and no raw html sent, try loading snapshot
    if (payload.version_id && !payload.html_content) {
      const { data: version } = await db
        .from('campaign_versions')
        .select('subject, html_snapshot')
        .eq('id', payload.version_id)
        .single();

      if (version) {
        subject = version.subject || subject;
        html = version.html_snapshot || html;
      }
    }

    // Replace test personalization variables using official resolveSalutation
    const testFirstName = 'Test';
    const testLastName = 'Doctor';
    const salutation = resolveSalutation(testLastName, testFirstName, 'Doc');

    subject = subject
      .replace(/\{\{\s*first_name\s*\}\}/gi, testFirstName)
      .replace(/\{\{\s*last_name\s*\}\}/gi, testLastName)
      .replace(/\{\{\s*salutation\s*\}\}/gi, salutation);

    html = html
      .replace(/\{\{\s*first_name\s*\}\}/gi, testFirstName)
      .replace(/\{\{\s*last_name\s*\}\}/gi, testLastName)
      .replace(/\{\{\s*salutation\s*\}\}/gi, salutation);

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'no-reply@expdentalsolutions.com';
    const fromName = campaign.from_name || 'Expert Dental Solutions';
    const sender = `${fromName} <${fromEmail}>`;

    const idempotencyKey = `test-send:${payload.campaign_id}:${Date.now()}`;

    // 3. Send via Resend
    const result = await sendEmail({
      from: sender,
      to: payload.test_email.trim().toLowerCase(),
      subject: `[TEST] ${subject}`,
      html: html,
      idempotencyKey,
    });

    // 4. Log in campaign_test_sends
    await db.from('campaign_test_sends').insert({
      campaign_id: payload.campaign_id,
      campaign_version_id: payload.version_id || null,
      recipient_email: payload.test_email.trim().toLowerCase(),
      provider_message_id: result.messageId,
      status: result.success ? 'sent' : 'failed',
      error_message: result.errorMessage,
    });

    return new Response(
      JSON.stringify({
        success: result.success,
        messageId: result.messageId,
        error: result.errorMessage,
      }),
      { status: result.success ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown test send error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
