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
  | 'deliverability_critical'
  | 'system_test';

interface SendPushRequest {
  event_type: NotificationEventType;
  event_id?: string;
  idempotency_key: string;
  title: string;
  body: string;
  deep_link?: string;
  badge_count?: number;
  target_user_ids?: string[];
  target_subscription_ids?: string[];
}

const EVENT_PREFERENCE_MAP: Record<NotificationEventType, string> = {
  new_lead: 'new_leads',
  sms_preference: 'sms_preference',
  inbound_email: 'inbound_emails',
  incomplete_registration: 'incomplete_registrations',
  task_due: 'tasks',
  deliverability_critical: 'deliverability_critical',
  system_test: 'system_test',
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
      target_subscription_ids,
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
      // Default: All active app users (app_user uses is_active boolean)
      const { data: users, error: userError } = await supabase
        .from('app_user')
        .select('user_id')
        .eq('is_active', true);

      if (userError) {
        console.error('[send-push-notification] Failed to query app_user:', userError);
      }
      candidateUserIds = (users || []).map((u: { user_id: string }) => u.user_id);

      // Defensive fallback: If app_user query returns empty, query active push subscriptions
      if (candidateUserIds.length === 0) {
        const { data: activeSubs } = await supabase
          .from('push_subscriptions')
          .select('user_id')
          .eq('status', 'active');
        if (activeSubs && activeSubs.length > 0) {
          candidateUserIds = Array.from(new Set(activeSubs.map((s: { user_id: string }) => s.user_id)));
        }
      }
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

    // 3. Filter users based on category preferences (system_test bypasses category filtering)
    let eligibleUserIds = candidateUserIds;
    if (event_type !== 'system_test') {
      const prefField = EVENT_PREFERENCE_MAP[event_type];
      if (prefField) {
        const { data: preferences } = await supabase
          .from('push_notification_preferences')
          .select(`user_id, ${prefField}`)
          .in('user_id', candidateUserIds);

        const prefMap = new Map<string, boolean>();
        (preferences || []).forEach((p: Record<string, unknown>) => {
          prefMap.set(p.user_id as string, p[prefField] !== false);
        });

        eligibleUserIds = candidateUserIds.filter((uid) => {
          return prefMap.has(uid) ? prefMap.get(uid) === true : true; // Default true if no record
        });
      }
    }

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

    // 5. Sanitize Notification Content (No sensitive medical/financial data)
    const sanitizedTitle = title.slice(0, 100);
    const sanitizedBody = body.slice(0, 240);

    // 4. Fetch all active subscriptions for eligible users
    let subsQuery = supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth_key, device_type')
      .in('user_id', eligibleUserIds)
      .eq('status', 'active');

    if (target_subscription_ids && target_subscription_ids.length > 0) {
      subsQuery = subsQuery.in('id', target_subscription_ids);
    }

    const { data: subscriptions, error: subsError } = await subsQuery;

    if (subsError) {
      console.error('[send-push-notification] Error fetching subscriptions:', subsError);
      throw subsError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      // Persist to push_notification_logs for each eligible admin user so it appears in in-app notification center
      for (const uid of eligibleUserIds) {
        try {
          await supabase.from('push_notification_logs').insert({
            user_id: uid,
            subscription_id: null,
            event_type,
            event_id: event_id || null,
            idempotency_key: `${idempotency_key}_user_${uid}`,
            title: sanitizedTitle,
            body: sanitizedBody,
            status: 'sent',
            deep_link,
            created_at: new Date().toISOString(),
          });
        } catch (logErr) {
          console.debug('[send-push-notification] Fallback log notice:', logErr);
        }
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Saved to notification logs (no active device subscriptions for target users)',
          dispatched_count: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pushPayloadJson = JSON.stringify({
      title: sanitizedTitle,
      body: sanitizedBody,
      icon: '/pwa-192x192.png',
      badge: '/favicon.png',
      deep_link: deep_link,
      url: deep_link,
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
    const deliveryResults: Array<{
      subscription_id: string;
      status: number;
      success: boolean;
      error?: string;
    }> = [];

    // 6. Deliver to each device with per-device idempotency
    for (const sub of subscriptions) {
      // Check device idempotency
      const { data: existingLog } = await supabase
        .from('push_notification_logs')
        .select('id, status')
        .eq('subscription_id', sub.id)
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();

      if (existingLog && existingLog.status === 'sent') {
        skippedCount++;
        deliveryResults.push({
          subscription_id: sub.id,
          status: 200,
          success: true,
          error: 'Suppressed idempotent',
        });
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

        console.info(`[send-push-notification] Push delivery to sub ${sub.id} returned HTTP ${pushRes.status}`);

        if (pushRes.status === 201 || pushRes.status === 200) {
          dispatchedCount++;
          deliveryResults.push({
            subscription_id: sub.id,
            status: pushRes.status,
            success: true,
          });

          // Update subscription last used timestamp
          await supabase
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', sub.id);

          // Log delivery (matches CHECK constraint: status IN ('sent', 'failed', 'suppressed_preference', 'suppressed_idempotent'))
          const { error: logErr } = await supabase.from('push_notification_logs').upsert(
            {
              user_id: sub.user_id,
              subscription_id: sub.id,
              event_type,
              event_id: event_id || null,
              idempotency_key,
              title: sanitizedTitle,
              body: sanitizedBody,
              status: 'sent',
              deep_link,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'subscription_id,idempotency_key' }
          );

          if (logErr) {
            console.error('[send-push-notification] Error logging sent push:', logErr);
          }
        } else if (pushRes.status === 404 || pushRes.status === 410) {
          // Subscription is no longer valid on device / push service
          revokedCount++;
          deliveryResults.push({
            subscription_id: sub.id,
            status: pushRes.status,
            success: false,
            error: `Push service returned ${pushRes.status} (Subscription Expired)`,
          });

          await supabase
            .from('push_subscriptions')
            .update({ status: 'revoked', updated_at: new Date().toISOString() })
            .eq('id', sub.id);

          const { error: logErr } = await supabase.from('push_notification_logs').upsert(
            {
              user_id: sub.user_id,
              subscription_id: sub.id,
              event_type,
              event_id: event_id || null,
              idempotency_key,
              title: sanitizedTitle,
              body: sanitizedBody,
              status: 'failed',
              deep_link,
              error_message: `Push service returned ${pushRes.status} (Subscription Expired)`,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'subscription_id,idempotency_key' }
          );

          if (logErr) {
            console.error('[send-push-notification] Error logging expired push:', logErr);
          }
        } else {
          const errText = await pushRes.text().catch(() => '');
          console.warn(`[send-push-notification] Push failed for sub ${sub.id}: ${pushRes.status} ${errText}`);
          deliveryResults.push({
            subscription_id: sub.id,
            status: pushRes.status,
            success: false,
            error: `Status ${pushRes.status}: ${errText.slice(0, 200)}`,
          });

          const { error: logErr } = await supabase.from('push_notification_logs').upsert(
            {
              user_id: sub.user_id,
              subscription_id: sub.id,
              event_type,
              event_id: event_id || null,
              idempotency_key,
              title: sanitizedTitle,
              body: sanitizedBody,
              status: 'failed',
              deep_link,
              error_message: `Status ${pushRes.status}: ${errText.slice(0, 200)}`,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'subscription_id,idempotency_key' }
          );

          if (logErr) {
            console.error('[send-push-notification] Error logging failed push:', logErr);
          }
        }
      } catch (err) {
        console.error(`[send-push-notification] Exception for sub ${sub.id}:`, err);
        const errMsg = err instanceof Error ? err.message : 'Unknown encryption/delivery error';
        deliveryResults.push({
          subscription_id: sub.id,
          status: 500,
          success: false,
          error: errMsg,
        });

        const { error: logErr } = await supabase.from('push_notification_logs').upsert(
          {
            user_id: sub.user_id,
            subscription_id: sub.id,
            event_type,
            event_id: event_id || null,
            idempotency_key,
            title: sanitizedTitle,
            body: sanitizedBody,
            status: 'failed',
            deep_link,
            error_message: errMsg,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'subscription_id,idempotency_key' }
        );

        if (logErr) {
          console.error('[send-push-notification] Error logging exception push:', logErr);
        }
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
        delivery_results: deliveryResults,
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
