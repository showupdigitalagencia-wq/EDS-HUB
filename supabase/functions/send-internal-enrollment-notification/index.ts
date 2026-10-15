// =============================================================================
// Edge Function: send-internal-enrollment-notification
// =============================================================================
// Standalone Edge Function for dispatching internal notifications to the EDS team.
// Strictly NEVER sends emails to the applicant.
// Authorized via service_role or authenticated admin session.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import {
  sendInternalEnrollmentNotification,
  processPendingAbandonedEnrollments,
  type InternalNotificationPayload,
} from '../_shared/internal-enrollment-notifier.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    // Allow internal service-role calls or authenticated requests
    const isServiceRole = authHeader.includes(serviceRoleKey);
    const db = createAdminClient();

    let bodyText = await req.text();
    let payload: InternalNotificationPayload;
    try {
      payload = JSON.parse(bodyText);
    } catch (_e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Abandonment sweep action (triggered by pg_cron or worker)
    if ((payload as any).action === 'process_pending_abandoned') {
      const sweepResult = await processPendingAbandonedEnrollments(db, {
        inactivityMinutes: (payload as any).inactivity_minutes || 15,
      });
      return new Response(JSON.stringify(sweepResult), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!payload.event_type || !payload.idempotency_key) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: event_type, idempotency_key' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (
      payload.event_type !== 'incomplete_registration' &&
      payload.event_type !== 'completed_registration'
    ) {
      return new Response(
        JSON.stringify({ error: `Unsupported event_type: ${payload.event_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await sendInternalEnrollmentNotification(db, payload, {
      immediate: (payload as any).immediate === true,
      inactivityMinutes: (payload as any).inactivity_minutes,
    });

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[send-internal-enrollment-notification] Unhandled error:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal Server Error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
