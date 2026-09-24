import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SystemSetupPage } from '../features/settings/SystemSetupPage';
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

// Mock Supabase client
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
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: table === 'app_settings' ? {
        id: 'settings-1',
        company_name: 'Expert Dental Solutions',
        default_salutation: 'Doc',
        timezone: 'America/New_York',
        email_from_name: 'EDS Hub',
        email_sending_domain: 'mail.expertdentalsolutions.com',
        monthly_net_revenue_target: 50000,
        monthly_enrollment_target: 10,
        default_currency: 'USD',
      } : table === 'push_notification_preferences' ? {
        id: 'pref-1',
        user_id: 'admin-uuid-1',
        new_leads: true,
        sms_preference: true,
        tasks: true,
        inbound_emails: true,
        incomplete_registrations: true,
        deliverability_critical: true,
      } : null,
      error: null,
    }),
    single: vi.fn().mockImplementation(() => Promise.resolve({
      data: table === 'app_settings' ? {
        id: 'settings-1',
        company_name: 'Expert Dental Solutions',
        default_salutation: 'Doc',
        timezone: 'America/New_York',
        email_from_name: 'EDS Hub',
        email_sending_domain: 'mail.expertdentalsolutions.com',
        monthly_net_revenue_target: 50000,
        monthly_enrollment_target: 10,
        default_currency: 'USD',
      } : {
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
    })),
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

describe('EDS HUB — Settings Mobile Layout & Test Push Notification', () => {
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
              endpoint: 'https://push.example.com/test',
            }),
          },
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

  // =========================================================================
  // 1. SETTINGS MOBILE NAVIGATION & LAYOUT TESTS
  // =========================================================================
  describe('Settings Mobile Responsive Layout', () => {
    it('renders all 5 settings tabs with correct Portuguese labels and test IDs', async () => {
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <SystemSetupPage />
        </MemoryRouter>
      );

      // Wait for settings to load
      await waitFor(() => {
        expect(document.getElementById('btn-tab-general')).not.toBeNull();
      });

      // Verify all 5 tab buttons exist
      const generalTab = document.getElementById('btn-tab-general');
      const coursesTab = document.getElementById('btn-tab-courses');
      const dataTab = document.getElementById('btn-tab-data-management');
      const integrationsTab = document.getElementById('btn-tab-integrations');
      const notificationsTab = document.getElementById('btn-tab-notifications');

      expect(generalTab).not.toBeNull();
      expect(coursesTab).not.toBeNull();
      expect(dataTab).not.toBeNull();
      expect(integrationsTab).not.toBeNull();
      expect(notificationsTab).not.toBeNull();

      // Verify Portuguese copy
      expect(generalTab?.textContent).toContain('Configurações Gerais');
      expect(coursesTab?.textContent).toContain('Catálogo de Cursos');
      expect(dataTab?.textContent).toContain('Gestão de Dados');
      expect(integrationsTab?.textContent).toContain('Integrações');
      expect(notificationsTab?.textContent).toContain('Notificações no Dispositivo');
    });

    it('navigation bar contains mobile-responsive horizontal scrolling classes to prevent clipping', async () => {
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <SystemSetupPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(document.getElementById('btn-tab-general')).not.toBeNull();
      });

      const navElement = screen.getByRole('navigation', { name: /Seções de Configurações/i });
      expect(navElement).not.toBeNull();

      // Check horizontal scroll classes
      const className = navElement.className;
      expect(className).toContain('overflow-x-auto');
      expect(className).toContain('no-scrollbar');
      expect(className).toContain('scroll-smooth');

      // Check tab items have shrink-0 and whitespace-nowrap to prevent text wrapping/collision
      const tabButtons = navElement.querySelectorAll('button');
      expect(tabButtons.length).toBe(5);

      tabButtons.forEach((btn) => {
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).toContain('whitespace-nowrap');
        expect(btn.className).toContain('min-h-[44px]');
      });
    });

    it('allows switching between all tabs seamlessly on mobile without breaking layout', async () => {
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <SystemSetupPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(document.getElementById('btn-tab-courses')).not.toBeNull();
      });

      // Switch to Course Catalog
      const coursesTab = document.getElementById('btn-tab-courses')!;
      fireEvent.click(coursesTab);
      expect(screen.getByText('Catálogo de Cursos & Preços')).not.toBeNull();

      // Switch to Data Management
      const dataTab = document.getElementById('btn-tab-data-management')!;
      fireEvent.click(dataTab);
      expect(screen.getAllByText('Gestão de Dados').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Excluir Todos os Contatos').length).toBeGreaterThanOrEqual(1);
      expect(document.getElementById('btn-delete-all-contacts')).not.toBeNull();

      // Switch to Notifications
      const notifTab = document.getElementById('btn-tab-notifications')!;
      fireEvent.click(notifTab);
      await waitFor(() => {
        expect(document.getElementById('btn-test-push')).not.toBeNull();
      });
    });
  });

  // =========================================================================
  // 2. NOTIFICATION SETTINGS & TEST PUSH ACTION
  // =========================================================================
  describe('Notification Settings — Test Push Action', () => {
    it('shows guard message when notifications are not enabled on this device', async () => {
      vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
      vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('default');
      vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(false);
      vi.spyOn(pushService, 'fetchNotificationPreferences').mockResolvedValue({
        id: 'pref-1',
        user_id: 'admin-uuid-1',
        new_leads: true,
        sms_preference: true,
        tasks: true,
        inbound_emails: true,
        incomplete_registrations: true,
        deliverability_critical: true,
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
      expect(testBtn.textContent).toContain('Testar notificação');

      // Click test button while unsubscribed
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(screen.getByText('Ative as notificações neste dispositivo para realizar o teste.')).not.toBeNull();
      });
    });

    it('sends real test push when device is subscribed and displays success feedback', async () => {
      vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
      vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
      vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(true);
      vi.spyOn(pushService, 'fetchNotificationPreferences').mockResolvedValue({
        id: 'pref-1',
        user_id: 'admin-uuid-1',
        new_leads: true,
        sms_preference: true,
        tasks: true,
        inbound_emails: true,
        incomplete_registrations: true,
        deliverability_critical: true,
      });

      const sendTestSpy = vi.spyOn(pushService, 'sendTestPushNotification').mockResolvedValue({
        success: true,
        message: 'Notificação de teste enviada com sucesso.',
      });

      render(
        <MemoryRouter>
          <NotificationPreferencesView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Testar notificação neste dispositivo')).not.toBeNull();
      });

      const testBtn = document.getElementById('btn-test-push')!;
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Notificação de teste enviada com sucesso.')).not.toBeNull();
      });
    });

    it('shows failure state when push notification test send fails', async () => {
      vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
      vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
      vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(true);
      vi.spyOn(pushService, 'fetchNotificationPreferences').mockResolvedValue({
        id: 'pref-1',
        user_id: 'admin-uuid-1',
        new_leads: true,
        sms_preference: true,
        tasks: true,
        inbound_emails: true,
        incomplete_registrations: true,
        deliverability_critical: true,
      });

      vi.spyOn(pushService, 'sendTestPushNotification').mockResolvedValue({
        success: false,
        error: 'Não foi possível enviar a notificação de teste.',
      });

      render(
        <MemoryRouter>
          <NotificationPreferencesView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Testar notificação neste dispositivo')).not.toBeNull();
      });

      const testBtn = document.getElementById('btn-test-push')!;
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(screen.getByText('Não foi possível enviar a notificação de teste.')).not.toBeNull();
      });
    });

    it('disables test button while request is in progress to prevent duplicate clicks', async () => {
      vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
      vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
      vi.spyOn(pushService, 'isCurrentDeviceSubscribed').mockResolvedValue(true);
      vi.spyOn(pushService, 'fetchNotificationPreferences').mockResolvedValue({
        id: 'pref-1',
        user_id: 'admin-uuid-1',
        new_leads: true,
        sms_preference: true,
        tasks: true,
        inbound_emails: true,
        incomplete_registrations: true,
        deliverability_critical: true,
      });

      let resolvePromise: (val: any) => void;
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.spyOn(pushService, 'sendTestPushNotification').mockImplementation(() => deferred as any);

      render(
        <MemoryRouter>
          <NotificationPreferencesView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Testar notificação neste dispositivo')).not.toBeNull();
      });

      const testBtn = document.getElementById('btn-test-push') as HTMLButtonElement;
      fireEvent.click(testBtn);

      // Verify button shows loading state and is disabled
      await waitFor(() => {
        expect(testBtn.disabled).toBe(true);
        expect(screen.getByText('Enviando notificação...')).not.toBeNull();
      });

      // Complete the request
      resolvePromise!({ success: true, message: 'Notificação de teste enviada com sucesso.' });

      await waitFor(() => {
        expect(testBtn.disabled).toBe(false);
        expect(screen.getByText('Notificação de teste enviada com sucesso.')).not.toBeNull();
      });
    });
  });

  // =========================================================================
  // 3. INFRASTRUCTURE & SAFETY RULES
  // =========================================================================
  describe('Test Push Infrastructure & Safety Constraints', () => {
    it('sendTestPushNotification targets ONLY current device subscription', async () => {
      vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
      vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
      vi.spyOn(pushService, 'getCurrentDeviceSubscriptionId').mockResolvedValue('sub-device-123');

      const invokeSpy = vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({
        data: { dispatched_count: 1 },
        error: null,
      });

      const result = await pushService.sendTestPushNotification('sub-device-123');

      expect(result.success).toBe(true);
      expect(invokeSpy).toHaveBeenCalledWith(
        'send-push-notification',
        expect.objectContaining({
          body: expect.objectContaining({
            event_type: 'system_test',
            title: 'Teste de notificação — EDS HUB',
            body: 'Se você recebeu este alerta, as notificações do sistema estão funcionando neste dispositivo.',
            target_subscription_ids: ['sub-device-123'],
          }),
        })
      );
    });

    it('test push does NOT create any CRM leads, tasks, or conversations', async () => {
      vi.spyOn(pushService, 'isPushSupported').mockReturnValue(true);
      vi.spyOn(pushService, 'getNotificationPermission').mockReturnValue('granted');
      vi.spyOn(pushService, 'getCurrentDeviceSubscriptionId').mockResolvedValue('sub-device-123');
      const fromMock = supabase.from as any;

      await pushService.sendTestPushNotification('sub-device-123');

      // Ensure no mutations to CRM business entities
      const mutatedTables = fromMock.mock.calls.map((call: any[]) => call[0]);
      expect(mutatedTables).not.toContain('leads');
      expect(mutatedTables).not.toContain('tasks');
      expect(mutatedTables).not.toContain('conversations');
      expect(mutatedTables).not.toContain('notes');
      expect(mutatedTables).not.toContain('pipeline_stages');
    });
  });
});
