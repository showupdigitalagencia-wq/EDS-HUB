// =============================================================================
// Supabase Edge Function: send-push-notification
// =============================================================================
// Dispatches secure, idempotent Web Push notifications to active admin devices.
// - Resolves target users & respects granular notification preferences
// - Enforces per-device idempotency via push_notification_logs
// - Uses RFC 8291 (aes128gcm) & RFC 8292 (VAPID) WebCrypto
// - Automatically revokes expired/uninstalled subscriptions (404/410)
// - Non-blocking operational supplementary delivery (CRM remains source of truth)
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { createVapidToken, encryptWebPushPayload } from '../_shared/web-push-crypto.ts';

type NotificationEventType =
  | 'new_lead'
  | 'sms_preference'
  | 'inbound_email'
  | 'incomplete_registration'
  | 'task_due'
  | 'deliverability_critical';

interface SendPushRequest {
  event_type: NotificationEventType;
  event_id?: string;
  idempotency_key: string;
  title: string;
  body: string;
  deep_link?: string;
  badge_count?: number;
  target_user_ids?: string[];
}

const EVENT_PREFERENCE_MAP: Record<NotificationEventType, string> = {
  new_lead: 'new_leads',
  sms_preference: 'sms_preference',
  inbound_email: 'inbound_emails',
  incomplete_registration: 'incomplete_registrations',
  task_due: 'tasks',
  deliverability_critical: 'deliverability_critical',
};

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

  try {
    const supabase = createAdminClient();
    const payload = (await req.json()) as SendPushRequest;

    const {
      event_type,
      event_id,
      idempotency_key,
      title,
      body,
      deep_link = '/',
      badge_count,
      target_user_ids,
    } = payload;

    if (!event_type || !idempotency_key || !title || !body) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: event_type, idempotency_key, title, body',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Load VAPID credentials
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@expdentalsolutions.com';

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('[send-push-notification] Missing VAPID credentials');
      return new Response(
        JSON.stringify({ error: 'Push service not configured on server (missing VAPID)' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Identify target users (active admins / specified users)
    let candidateUserIds: string[] = [];

    if (target_user_ids && target_user_ids.length > 0) {
      candidateUserIds = target_user_ids;
    } else {
      // Default: All active app users
      const { data: users, error: userError } = await supabase
        .from('app_user')
        .select('user_id')
        .eq('status', 'active');

      if (userError) {
        console.error('[send-push-notification] Failed to query app_user:', userError);
      }
      candidateUserIds = (users || []).map((u: { user_id: string }) => u.user_id);
    }

    if (candidateUserIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No eligible target users found',
          dispatched_count: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Filter users based on category preferences
    const prefField = EVENT_PREFERENCE_MAP[event_type];
    const { data: preferences } = await supabase
      .from('push_notification_preferences')
      .select(`user_id, ${prefField}`)
      .in('user_id', candidateUserIds);

    const prefMap = new Map<string, boolean>();
    (preferences || []).forEach((p: Record<string, unknown>) => {
      prefMap.set(p.user_id as string, p[prefField] !== false);
    });

    // Users who have explicitly disabled this category are excluded
    const eligibleUserIds = candidateUserIds.filter((uid) => {
      return prefMap.has(uid) ? prefMap.get(uid) === true : true; // Default true if no record
    });

    if (eligibleUserIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'All target users disabled notifications for this category',
          dispatched_count: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Fetch all active subscriptions for eligible users
    const { data: subscriptions, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth_key, device_type')
      .in('user_id', eligibleUserIds)
      .eq('status', 'active');

    if (subsError) {
      console.error('[send-push-notification] Error fetching subscriptions:', subsError);
      throw subsError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No active device subscriptions for target users',
          dispatched_count: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Sanitize Notification Content (No sensitive medical/financial data)
    const sanitizedTitle = title.slice(0, 100);
    const sanitizedBody = body.slice(0, 240);

    const pushPayloadJson = JSON.stringify({
      title: sanitizedTitle,
      body: sanitizedBody,
      icon: '/pwa-192x192.png',
      badge: '/favicon.png',
      data: {
        url: deep_link,
        eventType: event_type,
        eventId: event_id || null,
        badgeCount: typeof badge_count === 'number' ? badge_count : undefined,
      },
    });

    let dispatchedCount = 0;
    let skippedCount = 0;
    let revokedCount = 0;

    // 6. Deliver to each device with per-device idempotency
    for (const sub of subscriptions) {
      // Check device idempotency
      const { data: existingLog } = await supabase
        .from('push_notification_logs')
        .select('id, status')
        .eq('subscription_id', sub.id)
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();

      if (existingLog && existingLog.status === 'delivered') {
        skippedCount++;
        continue;
      }

      try {
        // Generate VAPID token & Encrypt
        const vapid = await createVapidToken(
          sub.endpoint,
          vapidSubject,
          vapidPublicKey,
          vapidPrivateKey
        );

        const encrypted = await encryptWebPushPayload(
          pushPayloadJson,
          sub.p256dh,
          sub.auth_key
        );

        // Dispatch HTTP request to push service
        const pushRes = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            ...encrypted.headers,
            Authorization: vapid.authorization,
          },
          body: encrypted.body,
        });

        if (pushRes.status === 201 || pushRes.status === 200) {
          dispatchedCount++;

          // Update subscription last used timestamp
          await supabase
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', sub.id);

          // Log delivery
          await supabase.from('push_notification_logs').upsert(
            {
              user_id: sub.user_id,
              subscription_id: sub.id,
              event_type,
              event_id: event_id || null,
              idempotency_key,
              title: sanitizedTitle,
              body_preview: sanitizedBody.slice(0, 100),
              status: 'delivered',
              deep_link,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'subscription_id,idempotency_key' }
          );
        } else if (pushRes.status === 404 || pushRes.status === 410) {
          // Subscription is no longer valid on device / push service
          revokedCount++;
          await supabase
            .from('push_subscriptions')
            .update({ status: 'revoked', updated_at: new Date().toISOString() })
            .eq('id', sub.id);

          await supabase.from('push_notification_logs').upsert(
            {
              user_id: sub.user_id,
              subscription_id: sub.id,
              event_type,
              event_id: event_id || null,
              idempotency_key,
              title: sanitizedTitle,
              body_preview: sanitizedBody.slice(0, 100),
              status: 'expired',
              deep_link,
              error_message: `Push service returned ${pushRes.status} (Subscription Expired)`,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'subscription_id,idempotency_key' }
          );
        } else {
          const errText = await pushRes.text().catch(() => '');
          console.warn(`[send-push-notification] Push failed for sub ${sub.id}: ${pushRes.status} ${errText}`);

          await supabase.from('push_notification_logs').upsert(
            {
              user_id: sub.user_id,
              subscription_id: sub.id,
              event_type,
              event_id: event_id || null,
              idempotency_key,
              title: sanitizedTitle,
              body_preview: sanitizedBody.slice(0, 100),
              status: 'failed',
              deep_link,
              error_message: `Status ${pushRes.status}: ${errText.slice(0, 200)}`,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'subscription_id,idempotency_key' }
          );
        }
      } catch (err) {
        console.error(`[send-push-notification] Exception for sub ${sub.id}:`, err);
        await supabase.from('push_notification_logs').upsert(
          {
            user_id: sub.user_id,
            subscription_id: sub.id,
            event_type,
            event_id: event_id || null,
            idempotency_key,
            title: sanitizedTitle,
            body_preview: sanitizedBody.slice(0, 100),
            status: 'failed',
            deep_link,
            error_message: err instanceof Error ? err.message : 'Unknown encryption/delivery error',
            created_at: new Date().toISOString(),
          },
          { onConflict: 'subscription_id,idempotency_key' }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_type,
        idempotency_key,
        dispatched_count: dispatchedCount,
        skipped_count: skippedCount,
        revoked_count: revokedCount,
        total_targets: subscriptions.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[send-push-notification] Unexpected handler error:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal Server Error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
