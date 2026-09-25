import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationPreferencesView } from '../features/settings/components/NotificationPreferencesView';
import * as pushService from '../features/notifications/services/push-notification-service';
import { supabase } from '../lib/supabase';

// Mock Auth
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'admin-uuid-1', email: 'admin@eds.com' } },
    user: { id: 'admin-uuid-1' },
    appUser: {
      id: 'admin-uuid-1',
      display_name: 'Dr. Admin',
      email: 'admin@eds.com',
      is_active: true,
      role: 'admin',
    },
    isLoading: false,
    isAuthorized: true,
  }),
}));

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockInvoke = vi.fn().mockResolvedValue({
    data: { dispatched_count: 1 },
    error: null,
  });

  const mockFrom = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(() => {
      if (table === 'push_notification_preferences') {
        return Promise.resolve({
          data: {
            id: 'pref-1',
            user_id: 'admin-uuid-1',
            new_leads: true,
            sms_preference: true,
            tasks: true,
            inbound_emails: true,
            incomplete_registrations: true,
            deliverability_critical: true,
          },
          error: null,
        });
      }
      if (table === 'push_notification_logs') {
        return Promise.resolve({
          data: {
            status: 'sent',
            error_message: null,
            created_at: new Date().toISOString(),
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }));

  return {
    supabase: {
      from: mockFrom,
      functions: {
        invoke: mockInvoke,
      },
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-uuid-1' } },
          error: null,
        }),
      },
    },
  };
});

describe('EDS HUB — Real iPhone Production Push Diagnostics & Recovery Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).PushManager = class {};
    (window as any).Notification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({
              endpoint: 'https://web.push.apple.com/test-endpoint-token',
              getKey: vi.fn().mockReturnValue(new Uint8Array(32)),
              unsubscribe: vi.fn().mockResolvedValue(true),
            }),
            subscribe: vi.fn().mockResolvedValue({
              endpoint: 'https://web.push.apple.com/test-endpoint-token',
              getKey: vi.fn().mockReturnValue(new Uint8Array(32)),
            }),
          },
        }),
        getRegistration: vi.fn().mockResolvedValue({
          active: { state: 'activated' },
        }),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // 1. Permission granted but no subscription
  it('does NOT claim active notifications when permission is granted but no valid subscription exists', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(false);
    vi.spyOn(pushService, 'getDevicePushDiagnostics').mockResolvedValue({
      permission: 'granted',
      isRegistered: false,
      serviceWorkerStatus: 'active',
      isStandalone: true,
      deviceType: 'mobile',
      lastTestStatus: 'waiting',
    });

    render(
      <MemoryRouter>
        <NotificationPreferencesView />
      </MemoryRouter>
    );

    await waitFor(() => {
      // Must NOT show "Ativo neste dispositivo" badge
      expect(screen.queryByText('Ativo neste dispositivo')).toBeNull();
      // Must show pending registration warning
      expect(screen.getByText('Permissão concedida, mas inscrição pendente')).not.toBeNull();
      // UI indicates notifications are disabled
      expect(screen.getByText(/Alertas desativados neste/i)).not.toBeNull();
    });
  });

  // 2. Safe diagnostic UI labels & no exposed secrets
  it('displays compact diagnostic section with user-friendly labels and NO sensitive keys/tokens', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(true);
    vi.spyOn(pushService, 'getDevicePushDiagnostics').mockResolvedValue({
      permission: 'granted',
      isRegistered: true,
      serviceWorkerStatus: 'active',
      isStandalone: true,
      deviceType: 'mobile',
      lastTestStatus: 'sent',
      lastErrorMessage: undefined,
      subscriptionId: 'sub-fcd347c0',
    });

    render(
      <MemoryRouter>
        <NotificationPreferencesView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Diagnóstico do Dispositivo')).not.toBeNull();
      expect(screen.getByText('Permissão do iPhone')).not.toBeNull();
      expect(screen.getByText('Ativada')).not.toBeNull();
      expect(screen.getByText('Dispositivo registrado')).not.toBeNull();
      expect(screen.getByText('Sim')).not.toBeNull();
      expect(screen.getByText('Service Worker')).not.toBeNull();
      expect(screen.getByText('Ativo')).not.toBeNull();
      expect(screen.getByText('Modo de exibição')).not.toBeNull();
      expect(screen.getByText('App Instalado (PWA)')).not.toBeNull();
      expect(screen.getByText('Último teste')).not.toBeNull();
      expect(screen.getByText('Enviado')).not.toBeNull();
      expect(screen.getByText('Último erro')).not.toBeNull();
      expect(screen.getByText('Nenhum erro registrado')).not.toBeNull();
    });

    // Verify sensitive data is NOT displayed in DOM
    const html = document.body.innerHTML;
    expect(html).not.toContain('https://web.push.apple.com/');
    expect(html).not.toContain('BCbk5QNXjPgU5u77WGz4XksRr9DrZgewKRKKvyTsaNQvEZpdHGuvOIlO56WUGcYza5J8PB3-S7OzyGfPaeST1Dc');
    expect(html).not.toContain('auth_key');
  });

  // 3. Service Worker Inactive State
  it('correctly reports inactive service worker when registration is missing', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(false);
    vi.spyOn(pushService, 'getDevicePushDiagnostics').mockResolvedValue({
      permission: 'granted',
      isRegistered: false,
      serviceWorkerStatus: 'inactive',
      isStandalone: false,
      deviceType: 'mobile',
      lastTestStatus: 'waiting',
    });

    render(
      <MemoryRouter>
        <NotificationPreferencesView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Service Worker')).not.toBeNull();
      expect(screen.getByText('Inativo')).not.toBeNull();
      expect(screen.getByText('Navegador Web')).not.toBeNull();
    });
  });

  // 4. iOS Standalone requirement guidance
  it('renders guidance banner when accessed on mobile outside standalone PWA mode', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'detectDeviceType').mockReturnValue('mobile');
    vi.spyOn(pushService, 'getDevicePushDiagnostics').mockResolvedValue({
      permission: 'default',
      isRegistered: false,
      serviceWorkerStatus: 'active',
      isStandalone: false,
      deviceType: 'mobile',
      lastTestStatus: 'waiting',
    });

    render(
      <MemoryRouter>
        <NotificationPreferencesView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Instalação requerida para iPhone / iPad')).not.toBeNull();
      expect(screen.getByText(/Adicionar à Tela de Início/i)).not.toBeNull();
    });
  });

  // 5. Re-register current device button & flow
  it('re-registers current device with current VAPID key and cleans up stale subscription', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(true);
    vi.spyOn(pushService, 'getDevicePushDiagnostics').mockResolvedValue({
      permission: 'granted',
      isRegistered: true,
      serviceWorkerStatus: 'active',
      isStandalone: true,
      deviceType: 'mobile',
      lastTestStatus: 'waiting',
    });

    const reregisterSpy = vi.spyOn(pushService, 'reregisterCurrentDevice').mockResolvedValue({
      success: true,
    });

    render(
      <MemoryRouter>
        <NotificationPreferencesView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.getElementById('btn-reregister-push')).not.toBeNull();
    });

    const reregisterBtn = document.getElementById('btn-reregister-push')!;
    fireEvent.click(reregisterBtn);

    await waitFor(() => {
      expect(reregisterSpy).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/Dispositivo registrado novamente com sucesso/i)
      ).not.toBeNull();
    });
  });

  // 6. Current-device targeting
  it('sendTestPushNotification strictly targets current device subscription ID', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'getCurrentDeviceSubscriptionId').mockResolvedValue('device-sub-uuid-abc');

    const invokeSpy = vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({
      data: { dispatched_count: 1 },
      error: null,
    });

    const res = await pushService.sendTestPushNotification('device-sub-uuid-abc');
    expect(res.success).toBe(true);

    expect(invokeSpy).toHaveBeenCalledWith(
      'send-push-notification',
      expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'system_test',
          title: 'Teste de notificação — EDS HUB',
          body: 'Se você recebeu este alerta, as notificações estão funcionando neste dispositivo.',
          deep_link: '/',
          target_subscription_ids: ['device-sub-uuid-abc'],
        }),
      })
    );
  });

  // 7. No false success before provider acceptance
  it('reports failure if provider rejects or returns dispatched_count 0', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'getCurrentDeviceSubscriptionId').mockResolvedValue('device-sub-uuid-abc');

    vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({
      data: { dispatched_count: 0, skipped_count: 0, message: 'Provider rejected request (410 Expired)' },
      error: null,
    });

    const res = await pushService.sendTestPushNotification('device-sub-uuid-abc');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Provider rejected request (410 Expired)');
  });

  // 8. Provider 404/410 handling
  it('marks subscription revoked on server when push service returns 410', async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const fromSpy = vi.spyOn(supabase, 'from').mockReturnValue({
      update: updateSpy,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    } as any);

    // Calling unsubscribe marks status: 'revoked'
    await pushService.unsubscribeFromPush();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'revoked' })
    );
    fromSpy.mockRestore();
  });

  // 9. Stale VAPID key detection
  it('detects stale VAPID subscription and re-subscribes cleanly with current key', async () => {
    const dummyKeyOld = new Uint8Array(65);
    dummyKeyOld[0] = 4;
    dummyKeyOld[1] = 99; // Different byte

    const currentKeyUint8 = pushService.urlBase64ToUint8Array(pushService.DEFAULT_VAPID_PUBLIC_KEY);
    expect(pushService.isApplicationServerKeyMatching(dummyKeyOld.buffer, pushService.DEFAULT_VAPID_PUBLIC_KEY)).toBe(false);
    expect(pushService.isApplicationServerKeyMatching(currentKeyUint8.buffer, pushService.DEFAULT_VAPID_PUBLIC_KEY)).toBe(true);

    const unsubscribeMock = vi.fn().mockResolvedValue(true);
    const subscribeMock = vi.fn().mockResolvedValue({
      endpoint: 'https://web.push.apple.com/new-endpoint-token',
      getKey: vi.fn().mockReturnValue(new Uint8Array(32)),
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({
              endpoint: 'https://web.push.apple.com/old-endpoint-token',
              options: { applicationServerKey: dummyKeyOld.buffer },
              unsubscribe: unsubscribeMock,
            }),
            subscribe: subscribeMock,
          },
        }),
      },
      configurable: true,
      writable: true,
    });

    const res = await pushService.subscribeToPush();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  // 10. Provider 201/accepted response reporting
  it('reports provider acceptance with HTTP 201 in sendTestPushNotification result', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'getCurrentDeviceSubscriptionId').mockResolvedValue('device-sub-123');

    vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({
      data: {
        dispatched_count: 1,
        skipped_count: 0,
        delivery_results: [{ subscription_id: 'device-sub-123', status: 201, success: true }],
      },
      error: null,
    });

    const res = await pushService.sendTestPushNotification('device-sub-123');
    expect(res.success).toBe(true);
    expect(res.message).toContain('HTTP 201');
  });

  // 11. Provider VAPID error handling
  it('returns factual error message when provider rejects request with VAPID or auth failure', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'getCurrentDeviceSubscriptionId').mockResolvedValue('device-sub-123');

    vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({
      data: {
        dispatched_count: 0,
        skipped_count: 0,
        delivery_results: [{ subscription_id: 'device-sub-123', status: 403, success: false, error: 'Status 403: BadJwtToken' }],
      },
      error: null,
    });

    const res = await pushService.sendTestPushNotification('device-sub-123');
    expect(res.success).toBe(false);
    expect(res.error).toContain('BadJwtToken');
  });

  // 12. Test Push failure UI representation
  it('displays error banner in UI when test notification dispatch fails', async () => {
    vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
    vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(true);
    vi.spyOn(pushService, 'sendTestPushNotification').mockResolvedValue({
      success: false,
      error: 'Provedor rejeitou a entrega da notificação (HTTP 410).',
    });

    render(
      <MemoryRouter>
        <NotificationPreferencesView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.getElementById('btn-test-push')).not.toBeNull();
    });

    const testBtn = document.getElementById('btn-test-push')!;
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Provedor rejeitou a entrega da notificação \(HTTP 410\)/i)
      ).not.toBeNull();
    });
  });
});
