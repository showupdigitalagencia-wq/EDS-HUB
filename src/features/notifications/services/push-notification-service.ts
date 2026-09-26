// =============================================================================
// Web Push & PWA Notification Service
// =============================================================================
// Manages browser push subscription lifecycle, user preference persistence,
// and device type detection without exposing private credentials.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import { buildTaskDueNotification } from '../utils/task-notification-format';

export interface PushNotificationPreferences {
  id?: string;
  user_id?: string;
  new_leads: boolean;
  sms_preference: boolean;
  inbound_emails: boolean;
  incomplete_registrations: boolean;
  tasks: boolean;
  deliverability_critical: boolean;
}

export const DEFAULT_VAPID_PUBLIC_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_VAPID_PUBLIC_KEY) ||
  'BCbk5QNXjPgU5u77WGz4XksRr9DrZgewKRKKvyTsaNQvEZpdHGuvOIlO56WUGcYza5J8PB3-S7OzyGfPaeST1Dc';

/**
 * Checks if Service Worker and Web Push are supported in this browser context.
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Returns the current Notification permission state.
 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Detects device form factor for subscription auditing.
 */
export function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk/i.test(ua)) {
    return 'tablet';
  }
  if (/mobile|iphone|ipod|blackberry|opera mini|iemobile|wpdesktop|android.*mobile/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

/**
 * Converts a base64url string to Uint8Array for PushManager subscription.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decodeFn =
    typeof window !== 'undefined' && typeof window.atob === 'function'
      ? (s: string) => window.atob(s)
      : typeof atob === 'function'
      ? atob
      : (s: string) => Buffer.from(s, 'base64').toString('binary');
  const rawData = decodeFn(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Compares an existing PushSubscription's applicationServerKey with expected VAPID public key.
 */
export function isApplicationServerKeyMatching(
  serverKey: ArrayBuffer | ArrayBufferLike | null,
  vapidB64: string
): boolean {
  if (!serverKey) return false;
  try {
    const expectedKey = urlBase64ToUint8Array(vapidB64);
    const actualKey = new Uint8Array(serverKey);
    if (actualKey.length !== expectedKey.length) return false;
    for (let i = 0; i < actualKey.length; i++) {
      if (actualKey[i] !== expectedKey[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes the current device to Web Push notifications.
 * Strictly initiated via user interaction.
 */
export async function subscribeToPush(
  vapidPublicKey: string = DEFAULT_VAPID_PUBLIC_KEY
): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Notificações push não são suportadas neste navegador.' };
  }

  // 1. Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      success: false,
      error: permission === 'denied'
        ? 'Permissão de notificação negada no navegador. Habilite nas configurações do dispositivo.'
        : 'Permissão não concedida.',
    };
  }

  try {
    // 2. Ensure Service Worker is ready
    const registration = await navigator.serviceWorker.ready;

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();

    // If subscription exists, verify it matches current VAPID key
    if (subscription) {
      const serverKey = subscription.options?.applicationServerKey;
      const matches = isApplicationServerKeyMatching(serverKey, vapidPublicKey);
      if (!matches) {
        console.warn('[PushService] Existing browser subscription key does not match current VAPID key. Re-subscribing...');
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
      }
    }

    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
      });
    }

    // 3. Extract keys
    const rawKey = subscription.getKey ? subscription.getKey('p256dh') : null;
    const rawAuth = subscription.getKey ? subscription.getKey('auth') : null;

    if (!rawKey || !rawAuth) {
      throw new Error('Falha ao obter chaves criptográficas da inscrição.');
    }

    const p256dh = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(rawKey))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const authKey = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(rawAuth))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 4. Authenticated user ID
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) {
      throw new Error('Usuário não autenticado.');
    }

    // 5. Persist to public.push_subscriptions
    const deviceType = detectDeviceType();
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    // Revoke previous subscriptions for this user on this device type to prevent orphaned duplicates
    await supabase
      .from('push_subscriptions')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('device_type', deviceType)
      .neq('endpoint', subscription.endpoint);

    const { error: dbError } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh,
        auth_key: authKey,
        user_agent: userAgent,
        device_type: deviceType,
        status: 'active',
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );

    if (dbError) throw dbError;

    // 6. Ensure default preferences exist for this user
    await ensureDefaultPreferences(userId);

    return { success: true };
  } catch (err) {
    console.error('[PushService] Subscription error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao ativar notificações push.',
    };
  }
}

/**
 * Unsubscribes the current device from Web Push notifications.
 */
export async function unsubscribeFromPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Push não suportado.' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Mark as revoked on server
      await supabase
        .from('push_subscriptions')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('endpoint', subscription.endpoint);

      await subscription.unsubscribe();
    }

    return { success: true };
  } catch (err) {
    console.error('[PushService] Unsubscribe error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao desativar notificações.',
    };
  }
}

/**
 * Checks if the current browser/device has an active subscription in Supabase.
 */
export async function isCurrentDeviceSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (getNotificationPermission() !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;

    const { data } = await supabase
      .from('push_subscriptions')
      .select('id, status')
      .eq('endpoint', subscription.endpoint)
      .eq('status', 'active')
      .maybeSingle();

    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Checks if the application is running in installed standalone PWA mode.
 * Required for Web Push on iOS (Safari Add to Home Screen).
 */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}

/**
 * Returns the operational state of the Service Worker controlling this client.
 */
export async function getServiceWorkerStatus(): Promise<'active' | 'inactive'> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'inactive';
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.active ? 'active' : 'inactive';
  } catch {
    return 'inactive';
  }
}

export interface DevicePushDiagnostics {
  permission: 'granted' | 'denied' | 'default';
  isRegistered: boolean;
  serviceWorkerStatus: 'active' | 'inactive';
  isStandalone: boolean;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  lastTestStatus: 'sent' | 'failed' | 'waiting';
  lastErrorMessage?: string;
  subscriptionId?: string | null;
}

/**
 * Queries local browser state and remote Supabase logs to produce safe diagnostic info.
 */
export async function getDevicePushDiagnostics(): Promise<DevicePushDiagnostics> {
  const perm = getNotificationPermission();
  const swStatus = await getServiceWorkerStatus();
  const standalone = isStandalonePWA();
  const devType = detectDeviceType();
  const isRegistered = await isCurrentDeviceSubscribed();
  const subId = await getCurrentDeviceSubscriptionId();

  let lastTestStatus: 'sent' | 'failed' | 'waiting' = 'waiting';
  let lastErrorMessage: string | undefined = undefined;

  if (subId) {
    try {
      const { data } = await supabase
        .from('push_notification_logs')
        .select('status, error_message, created_at')
        .eq('subscription_id', subId)
        .eq('event_type', 'system_test')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        if (data.status === 'sent') {
          lastTestStatus = 'sent';
        } else if (data.status === 'failed') {
          lastTestStatus = 'failed';
          lastErrorMessage = data.error_message || 'Falha no envio pelo provedor';
        }
      }
    } catch (err) {
      console.debug('[PushService] Failed to load last test log:', err);
    }
  }

  return {
    permission: perm,
    isRegistered,
    serviceWorkerStatus: swStatus,
    isStandalone: standalone,
    deviceType: devType,
    lastTestStatus,
    lastErrorMessage,
    subscriptionId: subId,
  };
}

/**
 * Re-registers the current device cleanly:
 * 1. Unsubscribes old browser push subscription
 * 2. Deactivates/revokes old database record
 * 3. Registers new PushSubscription with the current rotated VAPID public key
 * 4. Saves new subscription record in Supabase
 */
export async function reregisterCurrentDevice(
  vapidPublicKey: string = DEFAULT_VAPID_PUBLIC_KEY
): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Web Push não é suportado neste navegador.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      success: false,
      error:
        permission === 'denied'
          ? 'Permissão de notificação negada no navegador. Habilite nas configurações do dispositivo.'
          : 'Permissão não concedida.',
    };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();

    if (existingSubscription) {
      // 1. Mark existing subscription revoked in database
      await supabase
        .from('push_subscriptions')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('endpoint', existingSubscription.endpoint);

      // 2. Unsubscribe in the browser
      await existingSubscription.unsubscribe().catch((err) => {
        console.warn('[PushService] Unsubscribe old subscription non-fatal error:', err);
      });
    }

    // 3. Subscribe with the current VAPID public key
    const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
    const newSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedKey as unknown as BufferSource,
    });

    // 4. Extract crypto keys
    const rawKey = newSubscription.getKey ? newSubscription.getKey('p256dh') : null;
    const rawAuth = newSubscription.getKey ? newSubscription.getKey('auth') : null;

    if (!rawKey || !rawAuth) {
      throw new Error('Falha ao obter chaves criptográficas da inscrição.');
    }

    const p256dh = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(rawKey))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const authKey = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(rawAuth))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 5. Authenticated user ID
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) {
      throw new Error('Usuário não autenticado.');
    }

    // 6. Save new active subscription to Supabase
    const deviceType = detectDeviceType();
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    // Revoke previous subscriptions for this user on this device type to prevent orphaned duplicates
    await supabase
      .from('push_subscriptions')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('device_type', deviceType)
      .neq('endpoint', newSubscription.endpoint);

    const { error: dbError } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: newSubscription.endpoint,
        p256dh,
        auth_key: authKey,
        user_agent: userAgent,
        device_type: deviceType,
        status: 'active',
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );

    if (dbError) throw dbError;

    await ensureDefaultPreferences(userId);

    return { success: true };
  } catch (err) {
    console.error('[PushService] Re-registration error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao registrar novamente o dispositivo.',
    };
  }
}

/**
 * Resolves the database UUID of the current device's active subscription.
 */
export async function getCurrentDeviceSubscriptionId(): Promise<string | null> {
  if (!isPushSupported()) return null;
  if (getNotificationPermission() !== 'granted') return null;

  try {
    if (!navigator.serviceWorker) return null;
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return null;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;

    const { data } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscription.endpoint)
      .eq('status', 'active')
      .maybeSingle();

    return data?.id || null;
  } catch {
    return null;
  }
}

/**
 * Sends a real test Web Push notification targeted strictly to the current registered device.
 * Does not notify all devices, does not generate fake CRM leads, tasks, or automations.
 */
export async function sendTestPushNotification(targetSubscriptionId?: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return {
      success: false,
      error: 'Você precisa estar autenticado para testar notificações.',
    };
  }

  const userId = authData.user.id;

  if (!isPushSupported()) {
    return {
      success: false,
      error: 'Web Push não é suportado neste navegador.',
    };
  }

  if (getNotificationPermission() !== 'granted') {
    return {
      success: false,
      error: 'Ative as notificações neste dispositivo para realizar o teste.',
    };
  }

  const subId = targetSubscriptionId || (await getCurrentDeviceSubscriptionId());
  if (!subId) {
    return {
      success: false,
      error: 'Ative as notificações neste dispositivo para realizar o teste.',
    };
  }

  try {
    const idempotencyKey = `test_push_${subId}_${Date.now()}`;
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        event_type: 'system_test',
        event_id: 'test-device-verification',
        idempotency_key: idempotencyKey,
        title: 'Teste de notificação — EDS HUB',
        body: 'Se você recebeu este alerta, as notificações estão funcionando neste dispositivo.',
        deep_link: '/',
        target_user_ids: [userId],
        target_subscription_ids: [subId],
      },
    });

    if (error) {
      console.error('[PushService] Test notification invoke error:', error);
      return {
        success: false,
        error: 'Falha na comunicação com o servidor de notificações.',
      };
    }

    const primaryResult = data?.delivery_results?.[0];

    if (data?.dispatched_count === 0 && data?.skipped_count === 0) {
      return {
        success: false,
        error:
          primaryResult?.error ||
          data?.message ||
          'Provedor rejeitou a entrega da notificação.',
      };
    }

    const providerStatusMsg = primaryResult?.status
      ? `(HTTP ${primaryResult.status})`
      : '';

    return {
      success: true,
      message: `Notificação aceita pelo provedor ${providerStatusMsg} e enviada ao dispositivo.`,
    };
  } catch (err) {
    console.error('[PushService] Test notification exception:', err);
    return {
      success: false,
      error: 'Não foi possível enviar a notificação de teste.',
    };
  }
}

/**
 * Fetches user push notification preferences.
 */
export async function fetchNotificationPreferences(): Promise<PushNotificationPreferences | null> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('push_notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[PushService] Failed to load preferences:', error.message);
    return null;
  }

  if (!data) {
    return ensureDefaultPreferences(userId);
  }

  return data as PushNotificationPreferences;
}

/**
 * Updates push notification category preferences for current admin.
 */
export async function updateNotificationPreferences(
  updates: Partial<PushNotificationPreferences>
): Promise<PushNotificationPreferences> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) throw new Error('Usuário não autenticado');

  const { data, error } = await supabase
    .from('push_notification_preferences')
    .upsert(
      {
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data as PushNotificationPreferences;
}

async function ensureDefaultPreferences(userId: string): Promise<PushNotificationPreferences> {
  const defaults: PushNotificationPreferences = {
    user_id: userId,
    new_leads: true,
    sms_preference: true,
    inbound_emails: true,
    incomplete_registrations: true,
    tasks: true,
    deliverability_critical: true,
  };

  const { data } = await supabase
    .from('push_notification_preferences')
    .upsert(
      {
        ...defaults,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  return (data || defaults) as PushNotificationPreferences;
}

// =============================================================================
// Operational Event Dispatchers (Supplementary Push)
// =============================================================================
// Factual CRM event dispatchers. Push delivery failures are non-blocking
// and will never alter or interrupt CRM transactions.
// =============================================================================

export interface PushNotificationPayload {
  event_type:
    | 'new_lead'
    | 'sms_preference'
    | 'inbound_email'
    | 'incomplete_registration'
    | 'task_due'
    | 'deliverability_critical';
  event_id?: string;
  idempotency_key: string;
  title: string;
  body: string;
  deep_link?: string;
  badge_count?: number;
  target_user_ids?: string[];
}

export async function dispatchPushNotification(
  payload: PushNotificationPayload
): Promise<{ success: boolean; dispatched_count?: number; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: payload,
    });

    if (error) {
      console.warn('[PushService] Push dispatch failed (CRM remains safe):', error.message);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      dispatched_count: data?.dispatched_count ?? 0,
    };
  } catch (err) {
    console.warn('[PushService] Push dispatch error (CRM remains safe):', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao despachar notificação push',
    };
  }
}

/**
 * Event A: New Lead Received
 * Example: "Novo lead recebido" - "John Smith demonstrou interesse em Wisdom Teeth Extraction."
 */
export async function notifyNewLead(params: {
  leadId: string;
  leadName?: string;
  courseName?: string;
}) {
  const name = params.leadName || 'Novo interessado';
  const course = params.courseName || 'curso de especialização';
  return dispatchPushNotification({
    event_type: 'new_lead',
    event_id: params.leadId,
    idempotency_key: `lead_${params.leadId}_${Date.now()}`,
    title: 'Novo lead recebido',
    body: `${name} demonstrou interesse em ${course}.`,
    deep_link: `/leads/${params.leadId}`,
  });
}

/**
 * Event B: Lead Prefers SMS
 * Example: "Lead aguardando contato por SMS" - "John Smith prefere contato por SMS."
 */
export async function notifySmsPreference(params: {
  leadId: string;
  leadName?: string;
}) {
  const name = params.leadName || 'Lead';
  return dispatchPushNotification({
    event_type: 'sms_preference',
    event_id: params.leadId,
    idempotency_key: `sms_pref_${params.leadId}_${Date.now()}`,
    title: 'Lead aguardando contato por SMS',
    body: `${name} prefere contato por SMS.`,
    deep_link: `/leads/${params.leadId}`,
  });
}

/**
 * Event C: New Inbound Email Reply
 * Example: "Nova resposta recebida" - "John Smith respondeu ao seu e-mail."
 */
export async function notifyInboundEmail(params: {
  leadId: string;
  leadName?: string;
  messageId?: string;
}) {
  const name = params.leadName || 'Contato';
  return dispatchPushNotification({
    event_type: 'inbound_email',
    event_id: params.leadId,
    idempotency_key: `inbound_email_${params.messageId || params.leadId}_${Date.now()}`,
    title: 'Nova resposta recebida',
    body: `${name} respondeu ao seu e-mail.`,
    deep_link: `/leads/${params.leadId}?tab=conversations`,
  });
}

/**
 * Event D: New Incomplete Registration
 * Example: "Inscrição não concluída" - "Novo lead precisa de acompanhamento."
 */
export async function notifyIncompleteRegistration(params: {
  leadId: string;
  leadName?: string;
  attemptId?: string;
}) {
  const name = params.leadName || 'Novo lead';
  return dispatchPushNotification({
    event_type: 'incomplete_registration',
    event_id: params.leadId,
    idempotency_key: `incomplete_reg_${params.attemptId || params.leadId}_${Date.now()}`,
    title: 'Inscrição não concluída',
    body: `${name} precisa de acompanhamento.`,
    deep_link: `/leads/${params.leadId}`,
  });
}

/**
 * Event E: Task Due / Overdue
 * Contextual task push identifying task action and lead.
 * Example: "Ligar — Maria Silva"
 */
export async function notifyTaskDue(params: {
  taskId: string;
  taskTitle: string;
  leadId?: string;
  leadName?: string;
  description?: string;
}) {
  const content = buildTaskDueNotification(params);

  return dispatchPushNotification({
    event_type: 'task_due',
    event_id: params.taskId,
    idempotency_key: `task_${params.taskId}_${Date.now()}`,
    title: content.title,
    body: content.body,
    deep_link: content.deepLink,
  });
}

/**
 * Event F: Important Email Deliverability Issue
 * Only for factual critical events (hard bounce, spam complaint, failure).
 * Example: "Alerta de Entregabilidade" - "E-mail para john@... rejeitado permanentemente."
 */
export async function notifyDeliverabilityCritical(params: {
  leadId?: string;
  recipientEmail: string;
  reason?: string;
  eventId?: string;
}) {
  const reasonText = params.reason ? ` (${params.reason})` : '';
  return dispatchPushNotification({
    event_type: 'deliverability_critical',
    event_id: params.leadId,
    idempotency_key: `deliverability_${params.eventId || params.recipientEmail}_${Date.now()}`,
    title: 'Alerta de Entregabilidade',
    body: `E-mail para ${params.recipientEmail} rejeitado permanentemente${reasonText}.`,
    deep_link: params.leadId ? `/leads/${params.leadId}?tab=conversations` : '/work',
  });
}

// =============================================================================
// App Badge API Management
// =============================================================================

export function updateAppBadge(count: number): void {
  if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
    if (count > 0) {
      navigator.setAppBadge(count).catch((err) => {
        console.debug('[AppBadge] setAppBadge unsupported or failed:', err);
      });
    } else {
      clearAppBadge();
    }
  }
}

export function clearAppBadge(): void {
  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    navigator.clearAppBadge().catch((err) => {
      console.debug('[AppBadge] clearAppBadge unsupported or failed:', err);
    });
  }
}

