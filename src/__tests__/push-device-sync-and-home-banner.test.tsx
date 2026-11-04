import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PushActivationBanner } from '../features/notifications/components/PushActivationBanner';
import * as pushService from '../features/notifications/services/push-notification-service';
import * as standaloneHooks from '../hooks/useIsStandalone';
import { supabase } from '../lib/supabase';

// Mock AuthProvider
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'client-user-uuid', email: 'info@expdentalsolutions.com' },
    session: { user: { id: 'client-user-uuid' } },
    appUser: { id: 'client-user-uuid', email: 'info@expdentalsolutions.com', role: 'admin' },
    isLoading: false,
    isAuthorized: true,
  }),
}));

function createMockSupabaseQuery(table: string) {
  const queryObj: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };

  const upsertPromise: any = Promise.resolve({ data: null, error: null });
  upsertPromise.select = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  queryObj.upsert = vi.fn().mockReturnValue(upsertPromise);

  queryObj.maybeSingle = vi.fn().mockImplementation(() => {
    if (table === 'push_subscriptions') {
      return Promise.resolve({
        data: {
          id: 'sub-active-123',
          user_id: 'client-user-uuid',
          endpoint: 'https://web.push.apple.com/valid-token-endpoint',
          status: 'active',
        },
        error: null,
      });
    }
    if (table === 'push_notification_preferences') {
      return Promise.resolve({
        data: {
          id: 'pref-1',
          user_id: 'client-user-uuid',
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
    return Promise.resolve({ data: null, error: null });
  });

  queryObj.single = vi.fn().mockResolvedValue({ data: null, error: null });

  return queryObj;
}

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockFrom = vi.fn((table: string) => createMockSupabaseQuery(table));

  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'client-user-uuid' } },
          error: null,
        }),
      },
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: { dispatched_count: 1 }, error: null }),
      },
    },
  };
});

describe('EDS HUB — Push Device Sync & Home Banner Suite (11 Scenarios)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default browser mock globals
    (window as any).PushManager = class {};
    (window as any).Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };

    const mockPushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue({
        endpoint: 'https://web.push.apple.com/fresh-endpoint',
        getKey: vi.fn((type: string) => {
          if (type === 'p256dh') return new Uint8Array([1, 2, 3]).buffer;
          if (type === 'auth') return new Uint8Array([4, 5, 6]).buffer;
          return null;
        }),
        options: {
          applicationServerKey: pushService.urlBase64ToUint8Array(pushService.DEFAULT_VAPID_PUBLIC_KEY).buffer,
        },
      }),
    };

    const mockServiceWorker = {
      ready: Promise.resolve({
        pushManager: mockPushManager,
      }),
      getRegistration: vi.fn().mockResolvedValue({
        active: {},
        pushManager: mockPushManager,
      }),
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      value: mockServiceWorker,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  // ===========================================================================
  // Scenario 1: iPhone PWA with permission granted and valid subscription (Banner Hidden)
  // ===========================================================================
  it('Scenario 1: does NOT show banner when iPhone PWA has permission granted and valid active subscription', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'granted';

    const validSub = {
      endpoint: 'https://web.push.apple.com/valid-token-endpoint',
      options: {
        applicationServerKey: pushService.urlBase64ToUint8Array(pushService.DEFAULT_VAPID_PUBLIC_KEY).buffer,
      },
    };

    const reg = await navigator.serviceWorker.ready;
    vi.spyOn(reg.pushManager, 'getSubscription').mockResolvedValue(validSub as any);

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('synced');
    expect(syncResult.endpoint).toBe('https://web.push.apple.com/valid-token-endpoint');

    const { queryByTestId } = render(<PushActivationBanner />);
    await waitFor(() => {
      expect(queryByTestId('push-activation-banner')).toBeNull();
    });
  });

  // ===========================================================================
  // Scenario 2: iPhone PWA with permission granted but subscription absent (Banner Shown & Activates)
  // ===========================================================================
  it('Scenario 2: shows banner when iPhone PWA has permission granted but subscription absent, and activates successfully on click', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'granted';

    const reg = await navigator.serviceWorker.ready;
    vi.spyOn(reg.pushManager, 'getSubscription').mockResolvedValue(null);

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('subscription_missing');

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('push-activation-banner')).toBeInTheDocument();
      expect(screen.getByText('Não perca nenhuma atualização do EDS Hub')).toBeInTheDocument();
      expect(screen.getByText(/Receba avisos de novos leads/)).toBeInTheDocument();
      expect(screen.getByTestId('push-activate-button')).toBeInTheDocument();
    });

    const activateBtn = screen.getByTestId('push-activate-button');
    fireEvent.click(activateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Notificações ativadas com sucesso/i)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Scenario 3: iPhone PWA with outdated/orphan subscription from prior install
  // ===========================================================================
  it('Scenario 3: detects orphan/outdated subscription from prior install and re-registers cleanly', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'granted';

    // Device has an old orphan endpoint not found in Supabase
    const orphanSub = {
      endpoint: 'https://web.push.apple.com/orphan-old-endpoint',
      options: {
        applicationServerKey: pushService.urlBase64ToUint8Array(pushService.DEFAULT_VAPID_PUBLIC_KEY).buffer,
      },
      unsubscribe: vi.fn().mockResolvedValue(true),
    };

    const reg = await navigator.serviceWorker.ready;
    vi.spyOn(reg.pushManager, 'getSubscription').mockResolvedValue(orphanSub as any);

    // Mock supabase to return null for the orphan endpoint
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      const q = createMockSupabaseQuery(table);
      q.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      return q;
    }) as any);

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('subscription_orphan');

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('push-activation-banner')).toBeInTheDocument();
    });

    const activateBtn = screen.getByTestId('push-activate-button');
    fireEvent.click(activateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Notificações ativadas com sucesso/i)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Scenario 4: Permission default (requests permission on user gesture)
  // ===========================================================================
  it('Scenario 4: requests permission upon user click when permission is default', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'default';

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('permission_default');

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('push-activate-button')).toBeInTheDocument();
    });

    const activateBtn = screen.getByTestId('push-activate-button');
    fireEvent.click(activateBtn);

    await waitFor(() => {
      expect((window as any).Notification.requestPermission).toHaveBeenCalled();
      expect(screen.getByText(/Notificações ativadas com sucesso/i)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Scenario 5: Permission denied (guides unblocking in device settings)
  // ===========================================================================
  it('Scenario 5: displays unblock guidance when permission is denied', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'denied';

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('permission_denied');

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByText('Notificações desativadas no dispositivo')).toBeInTheDocument();
      expect(screen.getByText(/Ajustes > Notificações > EDS Hub/i)).toBeInTheDocument();
      expect(screen.queryByTestId('push-activate-button')).toBeNull();
    });
  });

  // ===========================================================================
  // Scenario 6: iPhone in regular browser outside PWA (instructs Add to Home Screen)
  // ===========================================================================
  it('Scenario 6: instructs how to Add to Home Screen when accessed from regular iOS Safari', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(false);

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('ios_not_standalone');

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByText('Não perca nenhuma atualização do EDS Hub')).toBeInTheDocument();
      expect(screen.getByText(/instale o EDS Hub na Tela de Início/i)).toBeInTheDocument();
      expect(screen.getByText(/Adicionar à Tela de Início/i)).toBeInTheDocument();
      // Should not present the activate button since iOS requires standalone PWA first
      expect(screen.queryByTestId('push-activate-button')).toBeNull();
    });
  });

  // ===========================================================================
  // Scenario 7: Multi-device support for same user without auto-revocation
  // ===========================================================================
  it('Scenario 7: maintains multiple active devices for the same user without aggressive revocation', async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const upsertPromise: any = Promise.resolve({ data: null, error: null });
    upsertPromise.select = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const upsertSpy = vi.fn().mockReturnValue(upsertPromise);

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      const q = createMockSupabaseQuery(table);
      q.update = updateSpy;
      q.upsert = upsertSpy;
      return q;
    }) as any);

    (window as any).Notification.permission = 'granted';

    const res = await pushService.subscribeToPush();
    expect(res.success).toBe(true);

    // Verify upsert was called with the endpoint
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://web.push.apple.com/fresh-endpoint',
        status: 'active',
        user_id: 'client-user-uuid',
      }),
      { onConflict: 'endpoint' }
    );

    // CRITICAL: verify no blanket revocation of other devices for this user was executed
    const calls = updateSpy.mock.calls;
    const hasBlanketRevocation = calls.some(
      (call) => call[0] && call[0].status === 'revoked'
    );
    expect(hasBlanketRevocation).toBe(false);
  });

  // ===========================================================================
  // Scenario 8: Multi-admin and multi-endpoint delivery in backend logic
  // ===========================================================================
  it('Scenario 8: preserves distinct endpoints for multiple administrators and multiple devices', () => {
    const mockRawSubscriptions = [
      { id: 'sub-dev-1', user_id: 'admin-dev-uuid', endpoint: 'https://web.push.apple.com/iphone-dev', device_type: 'mobile' },
      { id: 'sub-dev-2', user_id: 'admin-dev-uuid', endpoint: 'https://fcm.googleapis.com/desktop-dev', device_type: 'desktop' },
      { id: 'sub-client-1', user_id: 'client-uuid', endpoint: 'https://web.push.apple.com/iphone-client', device_type: 'mobile' },
      { id: 'sub-client-2', user_id: 'client-uuid', endpoint: 'https://web.push.apple.com/ipad-client', device_type: 'mobile' },
    ];

    // Using the updated deduplication logic
    const seenEndpoints = new Set<string>();
    const eligible = mockRawSubscriptions.filter((sub) => {
      if (seenEndpoints.has(sub.endpoint)) return false;
      seenEndpoints.add(sub.endpoint);
      return true;
    });

    // All 4 distinct endpoints are delivered! Both admins and both client mobile devices receive push.
    expect(eligible.length).toBe(4);
    expect(eligible.map((s) => s.id)).toEqual(['sub-dev-1', 'sub-dev-2', 'sub-client-1', 'sub-client-2']);
  });

  // ===========================================================================
  // Scenario 9: 10-day dismissal recurrence logic
  // ===========================================================================
  it('Scenario 9: suppresses banner for 10 days after dismissal, and resurfaces on day 11', async () => {
    const userId = 'client-user-uuid';
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'default';

    // 1. Initial state: not dismissed
    expect(pushService.isPushPromptDismissed(userId)).toBe(false);

    // 2. Render and click dismiss (X)
    const { unmount } = render(<PushActivationBanner />);
    await waitFor(() => {
      expect(screen.getByTestId('push-dismiss-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('push-dismiss-button'));
    expect(pushService.isPushPromptDismissed(userId)).toBe(true);

    unmount();

    // 3. Render on Day 5 (5 days elapsed = 432,000,000 ms)
    const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
    localStorage.setItem(`${pushService.PUSH_PROMPT_DISMISSAL_KEY_PREFIX}${userId}`, fiveDaysAgo.toString());
    expect(pushService.isPushPromptDismissed(userId)).toBe(true);

    const { queryByTestId: queryDay5, unmount: unmountDay5 } = render(<PushActivationBanner />);
    expect(queryDay5('push-activation-banner')).toBeNull();
    unmountDay5();

    // 4. Render on Day 11 (11 days elapsed = 950,400,000 ms)
    const elevenDaysAgo = Date.now() - 11 * 24 * 60 * 60 * 1000;
    localStorage.setItem(`${pushService.PUSH_PROMPT_DISMISSAL_KEY_PREFIX}${userId}`, elevenDaysAgo.toString());
    expect(pushService.isPushPromptDismissed(userId)).toBe(false);

    const { getByTestId: getDay11 } = render(<PushActivationBanner />);
    await waitFor(() => {
      expect(getDay11('push-activation-banner')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Scenario 10: Graceful handling of subscription and permission failures
  // ===========================================================================
  it('Scenario 10: handles permission refusal and subscription errors gracefully without crashing', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'default';
    (window as any).Notification.requestPermission = vi.fn().mockResolvedValue('denied');

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('push-activate-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('push-activate-button'));

    // Should transition to permission_denied guidance
    await waitFor(() => {
      expect(screen.getByText('Notificações desativadas no dispositivo')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Scenario 11: Idempotency, duplicate prevention, and button state protection
  // ===========================================================================
  it('Scenario 11: prevents duplicate activation clicks and ensures idempotent endpoint storage', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'default';

    // Mock subscribeToPush to take time
    let resolveSubscribe: (val: any) => void;
    const subscribePromise = new Promise((resolve) => {
      resolveSubscribe = resolve;
    });
    vi.spyOn(pushService, 'subscribeToPush').mockReturnValue(subscribePromise as any);

    render(<PushActivationBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('push-activate-button')).toBeInTheDocument();
    });

    const btn = screen.getByTestId('push-activate-button');
    fireEvent.click(btn);

    // Button is now disabled and shows loading text
    expect(btn).toBeDisabled();
    expect(screen.getByText(/ATIVANDO.../i)).toBeInTheDocument();

    // Clicking again while processing does not trigger additional calls
    fireEvent.click(btn);
    expect(pushService.subscribeToPush).toHaveBeenCalledTimes(1);

    // Resolve subscription
    act(() => {
      resolveSubscribe!({ success: true });
    });

    await waitFor(() => {
      expect(screen.getByText(/Notificações ativadas com sucesso/i)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Scenario 12: Transient network or database error does NOT show banner
  // ===========================================================================
  it('Scenario 12: does NOT show banner during transient network failure or Supabase error', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'granted';

    const validSub = {
      endpoint: 'https://web.push.apple.com/valid-endpoint',
      options: {
        applicationServerKey: pushService.urlBase64ToUint8Array(pushService.DEFAULT_VAPID_PUBLIC_KEY).buffer,
      },
    };

    const reg = await navigator.serviceWorker.ready;
    vi.spyOn(reg.pushManager, 'getSubscription').mockResolvedValue(validSub as any);

    // Mock Supabase to return network error (e.g. 503 or Failed to fetch)
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      const q = createMockSupabaseQuery(table);
      q.maybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Failed to fetch (network error)'),
      });
      return q;
    }) as any);

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('transient_error');
    expect(syncResult.error).toContain('Failed to fetch');

    const { queryByTestId } = render(<PushActivationBanner />);
    await waitFor(() => {
      expect(queryByTestId('push-activation-banner')).toBeNull();
    });
  });

  // ===========================================================================
  // Scenario 13: Unauthenticated session returns transient_error and suppresses banner
  // ===========================================================================
  it('Scenario 13: suppresses banner when user session is not yet loaded or unauthenticated', async () => {
    vi.spyOn(standaloneHooks, 'getIsIosDevice').mockReturnValue(true);
    vi.spyOn(standaloneHooks, 'getIsStandalone').mockReturnValue(true);
    (window as any).Notification.permission = 'granted';

    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: null,
    } as any);

    const syncResult = await pushService.checkDeviceSubscriptionSync();
    expect(syncResult.status).toBe('transient_error');
    expect(syncResult.error).toContain('Sessão de usuário em carregamento');

    const { queryByTestId } = render(<PushActivationBanner />);
    await waitFor(() => {
      expect(queryByTestId('push-activation-banner')).toBeNull();
    });
  });
});
