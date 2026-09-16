// =============================================================================
// Edge Function: system-status
// =============================================================================
// Returns provider configuration status without exposing secrets.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authResult = await verifyAuth(req.headers.get('Authorization'));
  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || null;
  const fromNumberConfigured = !!Deno.env.get('TWILIO_FROM_NUMBER');

  // Check if provider env vars are configured (boolean / public info only — never expose secrets)
  const status = {
    resend: {
      api_key_configured: !!Deno.env.get('RESEND_API_KEY'),
      from_email_configured: !!fromEmail,
      from_email: fromEmail,
      domain: 'expdentalsolutions.com',
      domain_status: 'verified',
      spf_status: 'verified',
      dkim_status: 'verified',
      dmarc_status: 'unknown',
    },
    twilio: {
      account_sid_configured: !!Deno.env.get('TWILIO_ACCOUNT_SID'),
      auth_token_configured: !!Deno.env.get('TWILIO_AUTH_TOKEN'),
      from_number_configured: fromNumberConfigured,
      from_number_status: fromNumberConfigured ? 'Configured' : 'Pending',
      sms_sending_enabled: fromNumberConfigured,
      operational_status: fromNumberConfigured ? 'Operational' : 'Disabled (Pending number)',
    },
    supabase: {
      url_configured: !!Deno.env.get('SUPABASE_URL'),
      service_role_configured: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    },
  };

  return new Response(
    JSON.stringify(status),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
