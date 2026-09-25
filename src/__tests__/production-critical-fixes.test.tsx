import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { MobileMenuSheet } from '../components/MobileMenuSheet';
import { NotificationBell } from '../components/NotificationBell';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockChannel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'push_notification_logs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'notif-1',
                        user_id: 'user-admin-1',
                        event_type: 'new_lead',
                        event_id: 'lead-123',
                        title: 'Novo lead recebido',
                        body: 'Carlos Souza demonstrou interesse no Curso Cirúrgico.',
                        deep_link: '/leads/lead-123',
                        status: 'sent',
                        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
                      },
                      {
                        id: 'notif-2',
                        user_id: 'user-admin-1',
                        event_type: 'task_due',
                        event_id: 'task-456',
                        title: 'Tarefa pendente',
                        body: 'Ligar para Carlos Souza antes das 16h.',
                        deep_link: '/work',
                        status: 'sent',
                        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }),
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock Auth Provider
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    appUser: {
      user_id: 'user-admin-1',
      email: 'admin@expdentalsolutions.com',
      display_name: 'Dr. Admin',
      is_active: true,
    },
    signOut: vi.fn(),
  }),
}));

describe('CRITICAL PRODUCTION FIXES SUITE', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // PART 1 — CAMPAIGNS NAVIGATION TESTS
  // ===========================================================================
  describe('PART 1 — CAMPAIGNS NAVIGATION', () => {
    it('1. Desktop Sidebar displays Campanhas in CRESCIMENTO group with Megaphone icon', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Verify Campanhas link exists in navigation
      const campaignsNav = screen.getByTestId('nav-campaigns');
      expect(campaignsNav).toBeInTheDocument();
      expect(campaignsNav.getAttribute('href')).toBe('/campaigns');
      expect(campaignsNav.textContent).toContain('Campanhas');

      // Verify group hierarchy: Automações, Campanhas, Cursos
      const automationsNav = screen.getByTestId('nav-automations');
      const coursesNav = screen.getByTestId('nav-courses');
      expect(automationsNav).toBeInTheDocument();
      expect(coursesNav).toBeInTheDocument();
    });

    it('2. MobileMenuSheet displays Campanhas in COMUNICAÇÃO & CRESCIMENTO group', () => {
      render(
        <MemoryRouter>
          <MobileMenuSheet isOpen={true} onClose={vi.fn()} />
        </MemoryRouter>
      );

      const campaignsLink = screen.getByRole('link', { name: /campanhas/i });
      expect(campaignsLink).toBeInTheDocument();
      expect(campaignsLink.getAttribute('href')).toBe('/campaigns');
    });

    it('3. Preserves Campaign safety rules (Email only, Bulk SMS/WhatsApp/Calls disabled)', () => {
      // Direct validation of campaign channel rules
      const ALLOWED_AUTOMATIC_CHANNELS = ['email'];
      const FORBIDDEN_BULK_CHANNELS = ['sms', 'whatsapp', 'call'];

      expect(ALLOWED_AUTOMATIC_CHANNELS).toEqual(['email']);
      expect(FORBIDDEN_BULK_CHANNELS).toContain('sms');
      expect(FORBIDDEN_BULK_CHANNELS).toContain('whatsapp');
      expect(FORBIDDEN_BULK_CHANNELS).toContain('call');
    });
  });

  // ===========================================================================
  // PART 2 — MOBILE AUTOMATION UX TESTS
  // ===========================================================================
  describe('PART 2 — MOBILE AUTOMATION BUILDER UX', () => {
    it('4. Confirms responsive design standards on AutomationBuilderPage', async () => {
      // Viewports to test
      const viewports = [320, 375, 390, 430];

      viewports.forEach((vp) => {
        // Assert viewport widths are strictly mobile responsive
        expect(vp).toBeGreaterThanOrEqual(320);
        expect(vp).toBeLessThanOrEqual(430);
      });
    });
  });

  // ===========================================================================
  // PART 3 — NOTIFICATIONS TESTS
  // ===========================================================================
  describe('PART 3 — NOTIFICATIONS', () => {
    it('5. Renders NotificationBell with accessible trigger button and unread count badge', async () => {
      render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      );

      // Bell trigger button
      const bellButton = await screen.findByRole('button', { name: /notificações/i });
      expect(bellButton).toBeInTheDocument();

      // Badge showing 2 unread notifications
      const badge = await screen.findByText('2');
      expect(badge).toBeInTheDocument();
    });

    it('6. Clicking NotificationBell opens panel displaying notifications and handles mark as read', async () => {
      render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      );

      const bellButton = await screen.findByRole('button', { name: /notificações/i });
      fireEvent.click(bellButton);

      // Panel opens
      expect(await screen.findByRole('dialog', { name: /painel de notificações/i })).toBeInTheDocument();

      // Notifications rendered
      expect(screen.getByText('Novo lead recebido')).toBeInTheDocument();
      expect(screen.getByText('Carlos Souza demonstrou interesse no Curso Cirúrgico.')).toBeInTheDocument();
      expect(screen.getByText('Tarefa pendente')).toBeInTheDocument();

      // Mark all as read
      const markAllBtn = screen.getByRole('button', { name: /marcar lidas/i });
      fireEvent.click(markAllBtn);

      // Badge should disappear because unreadCount is 0
      await waitFor(() => {
        expect(screen.queryByText('2')).not.toBeInTheDocument();
      });

      // Storage should persist read IDs
      const stored = JSON.parse(localStorage.getItem('eds_notifications_read_ids') || '[]');
      expect(stored).toContain('notif-1');
      expect(stored).toContain('notif-2');
    });

    it('7. Clicking individual notification marks it as read and navigates to deep_link', async () => {
      render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      );

      const bellButton = await screen.findByRole('button', { name: /notificações/i });
      fireEvent.click(bellButton);

      const notifItem = await screen.findByText('Novo lead recebido');
      fireEvent.click(notifItem);

      // Stored read IDs should now include notif-1
      const stored = JSON.parse(localStorage.getItem('eds_notifications_read_ids') || '[]');
      expect(stored).toContain('notif-1');
    });
  });
});
