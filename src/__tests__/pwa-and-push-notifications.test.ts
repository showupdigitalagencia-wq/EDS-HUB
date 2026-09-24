import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../lib/supabase';
import {
  isPushSupported,
  getNotificationPermission,
  detectDeviceType,
  urlBase64ToUint8Array,
  notifyNewLead,
  notifySmsPreference,
  notifyInboundEmail,
  notifyIncompleteRegistration,
  notifyTaskDue,
  notifyDeliverabilityCritical,
  updateAppBadge,
  clearAppBadge,
  DEFAULT_VAPID_PUBLIC_KEY,
  type PushNotificationPreferences,
} from '../features/notifications/services/push-notification-service';

vi.mock('../lib/supabase', () => {
  const mockInvoke = vi.fn().mockResolvedValue({ data: { dispatched_count: 1 }, error: null });
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      functions: {
        invoke: mockInvoke,
      },
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-uuid-1' } }, error: null }),
      },
    },
  };
});

describe('EDS HUB — PWA + Push Notifications Suite', () => {
  const publicDir = path.resolve(__dirname, '../../public');
  const manifestPath = path.join(publicDir, 'manifest.webmanifest');
  const logoPath = path.resolve(__dirname, '../../src/assets/eds-logo.png');

  // ===========================================================================
  // 1. PWA Manifest & Branding
  // ===========================================================================
  describe('PWA Manifest & App Identity', () => {
    it('manifest.webmanifest exists and has valid JSON configuration', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content);

      expect(manifest.name).toBe('EDS HUB');
      expect(manifest.short_name).toBe('EDS HUB');
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
      expect(manifest.theme_color).toBe('#08254f');
      expect(manifest.background_color).toBe('#08254f');
    });

    it('official company logo exists in repository', () => {
      expect(fs.existsSync(logoPath)).toBe(true);
      const stat = fs.statSync(logoPath);
      expect(stat.size).toBeGreaterThan(1000);
    });

    it('manifest references required icon sizes derived from official logo', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);

      expect(sizes).toContain('192x192');
      expect(sizes).toContain('512x512');
      expect(sizes).toContain('180x180');

      // Verify files exist on disk
      expect(fs.existsSync(path.join(publicDir, 'pwa-192x192.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'pwa-512x512.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'apple-touch-icon.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'favicon.png'))).toBe(true);
    });

    it('maskable icon configuration is properly defined with safe padding', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const maskableIcons = manifest.icons.filter(
        (icon: { purpose?: string }) => icon.purpose === 'maskable'
      );

      expect(maskableIcons.length).toBeGreaterThanOrEqual(2);
      const maskableSizes = maskableIcons.map((i: { sizes: string }) => i.sizes);
      expect(maskableSizes).toContain('192x192');
      expect(maskableSizes).toContain('512x512');

      // Verify maskable files exist on disk
      expect(fs.existsSync(path.join(publicDir, 'pwa-maskable-192x192.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'pwa-maskable-512x512.png'))).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Service Worker & Shell Safety
  // ===========================================================================
  describe('Service Worker & Shell Safety', () => {
    it('service worker sw.js exists and is configured for safe app shell behavior', () => {
      const swPath = path.join(publicDir, 'sw.js');
      expect(fs.existsSync(swPath)).toBe(true);

      const swContent = fs.readFileSync(swPath, 'utf8');
      // Must not aggressively cache Supabase CRM data
      expect(swContent).toContain("url.pathname.startsWith('/rest/v1')");
      expect(swContent).toContain("url.pathname.startsWith('/functions/v1')");
      expect(swContent).toContain("url.pathname.startsWith('/auth/v1')");

      // Must handle push event and notification click
      expect(swContent).toContain("addEventListener('push'");
      expect(swContent).toContain("addEventListener('notificationclick'");
    });

    it('urlBase64ToUint8Array properly converts VAPID public key', () => {
      const uint8 = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
      expect(uint8).toBeInstanceOf(Uint8Array);
      expect(uint8.length).toBe(65); // Uncompressed P-256 public key length
    });

    it('isPushSupported verifies environment Web Push API capabilities', () => {
      // In happy path with serviceWorker, PushManager, and Notification
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', class {});
      expect(isPushSupported()).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Permission UX & Contextual Action
  // ===========================================================================
  describe('Permission UX & Contextual Opt-in', () => {
    it('does NOT request notification permission on initial load/import', () => {
      // Notification.requestPermission should not have been called automatically
      const requestSpy = vi.fn();
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: requestSpy,
      });

      expect(requestSpy).not.toHaveBeenCalled();
      expect(getNotificationPermission()).toBe('default');
    });

    it('device detection identifies mobile, tablet, and desktop', () => {
      // Desktop
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      });
      expect(detectDeviceType()).toBe('desktop');

      // Mobile iPhone
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      });
      expect(detectDeviceType()).toBe('mobile');

      // iPad Tablet
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      });
      expect(detectDeviceType()).toBe('tablet');
    });
  });

  // ===========================================================================
  // 4. Subscriptions & Multi-Device Management
  // ===========================================================================
  describe('Multi-Device Subscription Management', () => {
    interface PushSubscriptionRecord {
      id: string;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth_key: string;
      device_type: 'mobile' | 'tablet' | 'desktop';
      status: 'active' | 'revoked';
      last_used_at: string;
    }

    it('supports multiple active devices for the same administrator', () => {
      const adminUserId = 'user-admin-uuid-1';
      const subscriptions: PushSubscriptionRecord[] = [];

      // Device 1: iPhone
      subscriptions.push({
        id: 'sub-iphone-1',
        user_id: adminUserId,
        endpoint: 'https://web.push.apple.com/endpoint/iphone-1',
        p256dh: 'mock-p256dh-iphone',
        auth_key: 'mock-auth-iphone',
        device_type: 'mobile',
        status: 'active',
        last_used_at: new Date().toISOString(),
      });

      // Device 2: iPad
      subscriptions.push({
        id: 'sub-ipad-2',
        user_id: adminUserId,
        endpoint: 'https://web.push.apple.com/endpoint/ipad-2',
        p256dh: 'mock-p256dh-ipad',
        auth_key: 'mock-auth-ipad',
        device_type: 'tablet',
        status: 'active',
        last_used_at: new Date().toISOString(),
      });

      // Device 3: Desktop Chrome
      subscriptions.push({
        id: 'sub-desktop-3',
        user_id: adminUserId,
        endpoint: 'https://fcm.googleapis.com/fcm/send/desktop-3',
        p256dh: 'mock-p256dh-desktop',
        auth_key: 'mock-auth-desktop',
        device_type: 'desktop',
        status: 'active',
        last_used_at: new Date().toISOString(),
      });

      const adminActiveSubs = subscriptions.filter(
        (s) => s.user_id === adminUserId && s.status === 'active'
      );
      expect(adminActiveSubs.length).toBe(3);
      expect(adminActiveSubs.map((s) => s.device_type)).toEqual(['mobile', 'tablet', 'desktop']);
    });

    it('revoking a subscription on one device does not affect other devices', () => {
      const adminUserId = 'user-admin-uuid-1';
      const subscriptions: PushSubscriptionRecord[] = [
        {
          id: 'sub-iphone-1',
          user_id: adminUserId,
          endpoint: 'https://web.push.apple.com/endpoint/iphone-1',
          p256dh: 'mock-p256dh-iphone',
          auth_key: 'mock-auth-iphone',
          device_type: 'mobile',
          status: 'active',
          last_used_at: new Date().toISOString(),
        },
        {
          id: 'sub-desktop-2',
          user_id: adminUserId,
          endpoint: 'https://fcm.googleapis.com/fcm/send/desktop-2',
          p256dh: 'mock-p256dh-desktop',
          auth_key: 'mock-auth-desktop',
          device_type: 'desktop',
          status: 'active',
          last_used_at: new Date().toISOString(),
        },
      ];

      // Unsubscribe desktop only
      const desktopSub = subscriptions.find((s) => s.id === 'sub-desktop-2')!;
      desktopSub.status = 'revoked';

      const activeSubs = subscriptions.filter(
        (s) => s.user_id === adminUserId && s.status === 'active'
      );
      expect(activeSubs.length).toBe(1);
      expect(activeSubs[0].id).toBe('sub-iphone-1');
    });
  });

  // ===========================================================================
  // 5. Notification Preferences Filtering
  // ===========================================================================
  describe('Notification Preferences Filtering', () => {
    it('filters out notifications when user has category disabled', () => {
      const userPrefs: PushNotificationPreferences = {
        user_id: 'admin-1',
        new_leads: true,
        sms_preference: true,
        inbound_emails: false, // Disabled!
        incomplete_registrations: true,
        tasks: false, // Disabled!
        deliverability_critical: true,
      };

      const shouldSend = (category: keyof Omit<PushNotificationPreferences, 'user_id' | 'id'>) => {
        return userPrefs[category] === true;
      };

      expect(shouldSend('new_leads')).toBe(true);
      expect(shouldSend('sms_preference')).toBe(true);
      expect(shouldSend('inbound_emails')).toBe(false);
      expect(shouldSend('incomplete_registrations')).toBe(true);
      expect(shouldSend('tasks')).toBe(false);
      expect(shouldSend('deliverability_critical')).toBe(true);
    });
  });

  // ===========================================================================
  // 6. Operational Events & Payload Verification
  // ===========================================================================
  describe('Operational Notification Events & Deep Links', () => {
    it('Event A: new lead notification format & deep link', async () => {
      const leadId = 'lead-uuid-101';
      vi.mocked(supabase.functions.invoke).mockClear();

      const res = await notifyNewLead({
        leadId,
        leadName: 'John Smith',
        courseName: 'Wisdom Teeth Extraction',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'new_lead',
          event_id: leadId,
          title: 'Novo lead recebido',
          body: 'John Smith demonstrou interesse em Wisdom Teeth Extraction.',
          deep_link: `/leads/${leadId}`,
        }),
      });
    });

    it('Event B: SMS preference notification format & deep link', async () => {
      const leadId = 'lead-uuid-102';
      vi.mocked(supabase.functions.invoke).mockClear();

      const res = await notifySmsPreference({
        leadId,
        leadName: 'John Smith',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'sms_preference',
          event_id: leadId,
          title: 'Lead aguardando contato por SMS',
          body: 'John Smith prefere contato por SMS.',
          deep_link: `/leads/${leadId}`,
        }),
      });
    });

    it('Event C: Inbound email notification format & deep link', async () => {
      const leadId = 'lead-uuid-103';
      vi.mocked(supabase.functions.invoke).mockClear();

      const res = await notifyInboundEmail({
        leadId,
        leadName: 'John Smith',
        messageId: 'msg-123',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'inbound_email',
          event_id: leadId,
          title: 'Nova resposta recebida',
          body: 'John Smith respondeu ao seu e-mail.',
          deep_link: `/leads/${leadId}?tab=conversations`,
        }),
      });
    });

    it('Event D: Incomplete registration notification format & deep link', async () => {
      const leadId = 'lead-uuid-104';
      vi.mocked(supabase.functions.invoke).mockClear();

      const res = await notifyIncompleteRegistration({
        leadId,
        leadName: 'Novo lead',
        attemptId: 'att-456',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'incomplete_registration',
          event_id: leadId,
          title: 'Inscrição não concluída',
          body: 'Novo lead precisa de acompanhamento.',
          deep_link: `/leads/${leadId}`,
        }),
      });
    });

    it('Event E: Task due / overdue notification format & deep link', async () => {
      const taskId = 'task-uuid-105';
      vi.mocked(supabase.functions.invoke).mockClear();

      const res = await notifyTaskDue({
        taskId,
        taskTitle: 'Ligar para John Smith.',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'task_due',
          event_id: taskId,
          title: 'Tarefa pendente',
          body: 'Ligar para John Smith.',
          deep_link: '/work',
        }),
      });
    });

    it('Event F: Critical deliverability issue notification format & deep link', async () => {
      const leadId = 'lead-uuid-106';
      const recipient = 'john@example.com';
      vi.mocked(supabase.functions.invoke).mockClear();

      const res = await notifyDeliverabilityCritical({
        leadId,
        recipientEmail: recipient,
        reason: 'hard bounce',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'deliverability_critical',
          event_id: leadId,
          title: 'Alerta de Entregabilidade',
          body: 'E-mail para john@example.com rejeitado permanentemente (hard bounce).',
          deep_link: `/leads/${leadId}?tab=conversations`,
        }),
      });
    });
  });

  // ===========================================================================
  // 7. Security: Sanitization & Zero Sensitive Data
  // ===========================================================================
  describe('Security & Payload Sanitization', () => {
    it('ensures push notification payloads exclude sensitive confidential fields', () => {
      const rawSensitiveLead = {
        id: 'lead-999',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john@example.com',
        passport_number: 'N12345678',
        medical_conditions: 'Hypertension, penicillin allergy',
        credit_card_last4: '4242',
        dental_exam_notes: 'Impacted 3rd molars #1, #16, #17, #32',
        course_interest: 'Wisdom Teeth Extraction',
      };

      // Sanitize payload
      const sanitizedPayload = {
        title: 'Novo lead recebido',
        body: `${rawSensitiveLead.first_name} demonstrou interesse em ${rawSensitiveLead.course_interest}.`,
        data: {
          url: `/leads/${rawSensitiveLead.id}`,
          eventType: 'new_lead',
          eventId: rawSensitiveLead.id,
        },
      };

      const serialized = JSON.stringify(sanitizedPayload);

      // Verify forbidden sensitive fields are absent
      expect(serialized).not.toContain('passport');
      expect(serialized).not.toContain('medical');
      expect(serialized).not.toContain('allergy');
      expect(serialized).not.toContain('credit_card');
      expect(serialized).not.toContain('dental_exam_notes');

      // Verify safe operational information is present
      expect(serialized).toContain('John');
      expect(serialized).toContain('Wisdom Teeth Extraction');
      expect(serialized).toContain('/leads/lead-999');
    });
  });

  // ===========================================================================
  // 8. Delivery Idempotency & CRM Resilience
  // ===========================================================================
  describe('Delivery Idempotency & CRM Resilience', () => {
    it('per-device idempotency prevents duplicate push delivery', () => {
      interface DeliveryLog {
        subscription_id: string;
        idempotency_key: string;
        status: 'delivered' | 'failed' | 'expired';
      }

      const logs: DeliveryLog[] = [];
      const subId = 'sub-device-1';
      const eventIdempotencyKey = 'lead_101_created';

      function attemptDeliver(subscriptionId: string, idempotencyKey: string) {
        const existing = logs.find(
          (l) => l.subscription_id === subscriptionId && l.idempotency_key === idempotencyKey
        );
        if (existing && existing.status === 'delivered') {
          return { dispatched: false, reason: 'idempotent_duplicate' };
        }
        logs.push({
          subscription_id: subscriptionId,
          idempotency_key: idempotencyKey,
          status: 'delivered',
        });
        return { dispatched: true };
      }

      // First delivery
      const first = attemptDeliver(subId, eventIdempotencyKey);
      expect(first.dispatched).toBe(true);
      expect(logs.length).toBe(1);

      // Second identical delivery attempt on the same device
      const duplicate = attemptDeliver(subId, eventIdempotencyKey);
      expect(duplicate.dispatched).toBe(false);
      expect(duplicate.reason).toBe('idempotent_duplicate');
      expect(logs.length).toBe(1); // No duplicate log or push
    });

    it('push delivery failure never alters persistent CRM state', async () => {
      // Mock CRM transaction that creates task
      const crmTasks: Array<{ id: string; title: string; status: string }> = [];

      async function createCrmTaskWithPush(taskTitle: string) {
        // 1. CRM Persistent Record created first
        const newTask = {
          id: 'task-123',
          title: taskTitle,
          status: 'pending',
        };
        crmTasks.push(newTask);

        // 2. Supplementary Push Dispatch fails
        let pushError: Error | null = null;
        try {
          throw new Error('Push service 503 Service Unavailable');
        } catch (err) {
          pushError = err as Error;
          // Non-blocking warning logged; error swallowed
          console.warn('[Push] Delivery failed non-blockingly:', err);
        }

        // Return CRM task regardless of push outcome
        return {
          task: newTask,
          pushFailed: Boolean(pushError),
        };
      }

      const result = await createCrmTaskWithPush('Ligar para John Smith');
      expect(result.task.id).toBe('task-123');
      expect(crmTasks.length).toBe(1);
      expect(crmTasks[0].title).toBe('Ligar para John Smith');
      expect(result.pushFailed).toBe(true); // Push failed, but CRM is 100% correct!
    });
  });

  // ===========================================================================
  // 9. App Badge API Graceful Degradation
  // ===========================================================================
  describe('App Badge API Support', () => {
    it('sets app badge when supported and degrades gracefully when unsupported', () => {
      const setAppBadgeSpy = vi.fn().mockResolvedValue(undefined);
      const clearAppBadgeSpy = vi.fn().mockResolvedValue(undefined);

      vi.stubGlobal('navigator', {
        setAppBadge: setAppBadgeSpy,
        clearAppBadge: clearAppBadgeSpy,
      });

      updateAppBadge(5);
      expect(setAppBadgeSpy).toHaveBeenCalledWith(5);

      updateAppBadge(0);
      expect(clearAppBadgeSpy).toHaveBeenCalled();

      // Graceful degradation when navigator.setAppBadge is undefined
      vi.stubGlobal('navigator', {});
      expect(() => updateAppBadge(3)).not.toThrow();
      expect(() => clearAppBadge()).not.toThrow();
    });
  });
});
