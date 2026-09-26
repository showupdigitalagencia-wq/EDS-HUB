// =============================================================================
// Supabase Edge Function: send-push-notification
// =============================================================================
// Responsibilities:
// 1. Validates incoming push notification requests and permissions.
// 2. Implements Web Push payload encryption (RFC 8291 aes128gcm) with VAPID (RFC 8292).
// 3. Delivers to real device push services (Apple APNs, Google FCM, Mozilla).
// 4. Maintains push_subscriptions lifecycle (revokes 410/404 expired subscriptions).
// 5. Enforces strict per-device idempotency and logs to push_notification_logs.
// 6. Supports server-side scheduled checking of due tasks via pg_cron.
// =============================================================================

import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { createVapidToken, encryptWebPushPayload } from '../_shared/web-push-crypto.ts';

interface SendPushRequest {
  event_type: string;
  event_id?: string;
  idempotency_key: string;
  title: string;
  body: string;
  deep_link?: string;
  badge_count?: number;
  target_user_ids?: string[];
  target_subscription_ids?: string[];
  action?: string;
  task_id?: string;
  lead_id?: string;
  data?: Record<string, any>;
}

// Maps system event types to user notification preference columns
const EVENT_PREFERENCE_MAP: Record<string, string> = {
  new_lead: 'new_leads',
  sms_preference: 'sms_lead_preferred',
  inbound_email: 'new_replies',
  incomplete_registration: 'incomplete_registrations',
  task_due: 'tasks',
  deliverability_critical: 'deliverability_alerts',
};

async function sendPushInternal(supabase: any, payload: SendPushRequest) {
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
    return {
      status: 400,
      body: { error: 'Missing required fields: event_type, idempotency_key, title, body' },
    };
  }

  // 1. Load VAPID credentials
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@expdentalsolutions.com';

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('[send-push-notification] Missing VAPID credentials');
    return {
      status: 503,
      body: { error: 'Push service not configured on server (missing VAPID)' },
    };
  }

  // 2. Identify target users (active admins / specified users)
  let candidateUserIds: string[] = [];

  if (target_user_ids && target_user_ids.length > 0) {
    candidateUserIds = target_user_ids;
  } else {
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
    return {
      status: 200,
      body: { success: true, message: 'No eligible target users found', dispatched_count: 0 },
    };
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
        return prefMap.has(uid) ? prefMap.get(uid) === true : true;
      });
    }
  }

  if (eligibleUserIds.length === 0) {
    return {
      status: 200,
      body: { success: true, message: 'All target users disabled notifications for this category', dispatched_count: 0 },
    };
  }

  // 4. Sanitize Notification Content
  const sanitizedTitle = title.slice(0, 100);
  const sanitizedBody = body.slice(0, 240);

  // 5. Fetch all active subscriptions for eligible users
  let subsQuery = supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth_key, device_type, created_at')
    .in('user_id', eligibleUserIds)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (target_subscription_ids && target_subscription_ids.length > 0) {
    subsQuery = subsQuery.in('id', target_subscription_ids);
  }

  const { data: rawSubscriptions, error: subsError } = await subsQuery;

  if (subsError) {
    console.error('[send-push-notification] Error fetching subscriptions:', subsError);
    throw subsError;
  }

  // Deduplicate subscriptions: take newest per device_type
  const seenUserDevice = new Set<string>();
  const subscriptions = (rawSubscriptions || []).filter((sub: { id: string; user_id: string; device_type: string }) => {
    if (target_subscription_ids && target_subscription_ids.includes(sub.id)) return true;
    const key = `${sub.user_id}_${sub.device_type}`;
    if (seenUserDevice.has(key)) return false;
    seenUserDevice.add(key);
    return true;
  });

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
    return {
      status: 200,
      body: {
        success: true,
        message: 'Saved to notification logs (no active device subscriptions for target users)',
        dispatched_count: 0,
      },
    };
  }

  const resolvedTaskId = payload.task_id || (event_type === 'task_due' ? event_id : undefined);
  const resolvedLeadId = payload.lead_id || undefined;

  const pushPayloadJson = JSON.stringify({
    title: sanitizedTitle,
    body: sanitizedBody,
    icon: '/pwa-192x192.png',
    badge: '/favicon.png',
    deep_link: deep_link,
    url: deep_link,
    event_type: event_type,
    event_id: event_id || null,
    task_id: resolvedTaskId,
    lead_id: resolvedLeadId,
    data: {
      url: deep_link,
      deep_link: deep_link,
      eventType: event_type,
      eventId: event_id || null,
      taskId: resolvedTaskId,
      leadId: resolvedLeadId,
      badgeCount: typeof badge_count === 'number' ? badge_count : undefined,
      ...(payload.data || {}),
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

        // Log delivery
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
            error_message: `Push subscription expired or revoked (${pushRes.status})`,
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
          error: `Push service returned ${pushRes.status}: ${errText.slice(0, 100)}`,
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
            error_message: `Push service returned ${pushRes.status}`,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'subscription_id,idempotency_key' }
        );

        if (logErr) {
          console.error('[send-push-notification] Error logging failed push:', logErr);
        }
      }
    } catch (err: any) {
      console.error(`[send-push-notification] Exception for sub ${sub.id}:`, err);
      const errMsg = err instanceof Error ? err.message : 'Unknown network exception';

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

  return {
    status: 200,
    body: {
      success: true,
      event_type,
      idempotency_key,
      dispatched_count: dispatchedCount,
      skipped_count: skippedCount,
      revoked_count: revokedCount,
      total_targets: subscriptions.length,
      delivery_results: deliveryResults,
    },
  };
}

// Helper functions for contextual task notification formatting
function formatContextualTaskTitle(taskTitle?: string | null, leadName?: string | null): string {
  const cleanTitle = (taskTitle || '').trim();
  const cleanLeadName = (leadName || '').trim();

  if (!cleanLeadName) {
    return cleanTitle || 'Tarefa pendente';
  }
  if (!cleanTitle) {
    return cleanLeadName;
  }

  const titleLower = cleanTitle.toLowerCase();
  const leadLower = cleanLeadName.toLowerCase();
  const firstName = cleanLeadName.split(/\s+/)[0]?.toLowerCase();

  // Deduplicate if lead name or first name already present in task title
  if (
    titleLower.includes(leadLower) ||
    (firstName && firstName.length > 2 && titleLower.includes(firstName))
  ) {
    return cleanTitle;
  }

  // Canonical safe format: [Task title] — [Lead name]
  return `${cleanTitle} — ${cleanLeadName}`;
}

function formatContextualTaskBody(description?: string | null): string {
  const cleanDesc = (description || '').trim();
  if (cleanDesc) {
    return cleanDesc.length > 240 ? `${cleanDesc.slice(0, 237)}...` : cleanDesc;
  }
  return 'Tarefa agendada para agora.';
}

function buildTaskDeepLink(taskId?: string | null, leadId?: string | null): string {
  const cleanTaskId = (taskId || '').trim();
  const cleanLeadId = (leadId || '').trim();

  if (cleanLeadId) {
    return cleanTaskId ? `/leads/${cleanLeadId}?taskId=${cleanTaskId}` : `/leads/${cleanLeadId}`;
  }
  return cleanTaskId ? `/work?taskId=${cleanTaskId}` : '/work';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();
    const payload = (await req.json()) as SendPushRequest;

    // Support server-side scheduled check of pending due tasks
    if ((payload as any).event_type === 'check_due_tasks' || (payload as any).action === 'check_due_tasks') {
      const nowIso = new Date().toISOString();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      // Fetch pending tasks due up to now with lead relationship
      const { data: dueTasks, error: dueErr } = await supabase
        .from('tasks')
        .select(`
          id,
          title,
          description,
          status,
          due_at,
          lead_id,
          leads (
            id,
            first_name,
            last_name
          )
        `)
        .eq('status', 'pending')
        .not('due_at', 'is', null)
        .lte('due_at', nowIso)
        .gte('due_at', twoHoursAgo)
        .order('due_at', { ascending: true })
        .limit(20);

      if (dueErr) {
        return new Response(JSON.stringify({ error: dueErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Collect lead IDs for batch fallback resolution if relationship isn't joined
      const missingLeadIds = Array.from(
        new Set(
          (dueTasks || [])
            .filter((t: any) => t.lead_id && !t.leads)
            .map((t: any) => t.lead_id)
        )
      ) as string[];

      const leadMap = new Map<string, { first_name?: string; last_name?: string }>();
      if (missingLeadIds.length > 0) {
        try {
          const { data: leadsData } = await supabase
            .from('leads')
            .select('id, first_name, last_name')
            .in('id', missingLeadIds);
          for (const l of (leadsData || [])) {
            leadMap.set(l.id, l);
          }
        } catch (_leadErr) {
          console.warn('[check_due_tasks] Fallback lead query notice:', _leadErr);
        }
      }

      let checkedCount = 0;
      let dispatchedTasksCount = 0;

      for (const t of dueTasks || []) {
        const idKey = `task_reminder_${t.id}_${t.due_at}`;
        const { data: existing } = await supabase
          .from('push_notification_logs')
          .select('id')
          .eq('idempotency_key', idKey)
          .eq('status', 'sent')
          .maybeSingle();

        if (existing) continue;

        // Resolve real lead name
        const rawLead = (t as any).leads || (t.lead_id ? leadMap.get(t.lead_id) : undefined);
        const leadObj = Array.isArray(rawLead) ? rawLead[0] : rawLead;
        const leadName = leadObj
          ? `${leadObj.first_name || ''} ${leadObj.last_name || ''}`.trim()
          : null;

        const contextualTitle = formatContextualTaskTitle(t.title, leadName);
        const contextualBody = formatContextualTaskBody(t.description);
        const deepLink = buildTaskDeepLink(t.id, t.lead_id);

        // Dispatches task_due in-process directly to APNs / Web Push
        try {
          const pushResult = await sendPushInternal(supabase, {
            event_type: 'task_due',
            event_id: t.id,
            idempotency_key: idKey,
            title: contextualTitle,
            body: contextualBody,
            deep_link: deepLink,
            task_id: t.id,
            lead_id: t.lead_id || undefined,
          });

          if (pushResult && pushResult.body && pushResult.body.dispatched_count > 0) {
            dispatchedTasksCount += pushResult.body.dispatched_count;
          }
        } catch (dispatchErr) {
          console.error('[check_due_tasks] Error dispatching task push:', dispatchErr);
        }
        checkedCount++;
      }

      return new Response(
        JSON.stringify({
          success: true,
          checked_count: checkedCount,
          dispatched_count: dispatchedTasksCount,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await sendPushInternal(supabase, payload);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
