import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingScreen } from '../components/LoadingScreen';
import { Sidebar } from '../components/Sidebar';
import { Layout } from '../components/Layout';

// Mock AuthProvider context for Sidebar and Layout tests
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-id' } },
    user: { id: 'test-user-id' },
    appUser: {
      id: 'app-user-1',
      display_name: 'Dr. Test Coordinator',
      email: 'coordinator@example.com',
      is_active: true,
      role: 'admin',
    },
    isLoading: false,
    isAuthorized: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// Component that throws intentionally
function CrashingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test crash inside component');
  }
  return <div>Component rendered successfully</div>;
}

describe('Phase 5 — Responsive & Stability Suite', () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. ErrorBoundary
  // ---------------------------------------------------------------------------
  describe('Global ErrorBoundary', () => {
    it('renders children normally when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div>Child content</div>
        </ErrorBoundary>
      );
      expect(screen.getByText('Child content')).toBeInTheDocument();
    });

    it('catches render errors and displays branded recovery UI', () => {
      render(
        <ErrorBoundary>
          <CrashingComponent shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
      expect(screen.getByText(/A aplicação encontrou uma inconsistência temporária/i)).toBeInTheDocument();
      expect(screen.getByText('Recarregar Página')).toBeInTheDocument();
      expect(screen.getByText('Início')).toBeInTheDocument();
      // Does not expose raw exception stack to the end user
      expect(screen.queryByText(/at CrashingComponent/i)).not.toBeInTheDocument();
    });

    it('renders custom fallback if provided', () => {
      render(
        <ErrorBoundary fallback={<div>Custom Error View</div>}>
          <CrashingComponent shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom Error View')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. LoadingScreen
  // ---------------------------------------------------------------------------
  describe('Branded LoadingScreen', () => {
    it('renders default branded message and logo', () => {
      render(<LoadingScreen />);
      expect(screen.getByText('Carregando EDS HUB...')).toBeInTheDocument();
      expect(screen.getByAltText('Expert Dental Solutions')).toBeInTheDocument();
    });

    it('renders custom message when specified', () => {
      render(<LoadingScreen message="Inicializando sessão de segurança..." />);
      expect(screen.getByText('Inicializando sessão de segurança...')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Responsive Navigation & Mobile Drawer
  // ---------------------------------------------------------------------------
  describe('Responsive Sidebar & Mobile Navigation', () => {
    it('renders desktop sidebar navigation groups and items', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Verify core navigation links exist
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Work')).toBeInTheDocument();
      expect(screen.getByText('Reports')).toBeInTheDocument();
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Course Operations')).toBeInTheDocument();
      expect(screen.getByText('Post-Course & Alumni')).toBeInTheDocument();
      expect(screen.getByText('Forms')).toBeInTheDocument();
      expect(screen.getByText('Automations')).toBeInTheDocument();
      expect(screen.getByText('Lead Scoring')).toBeInTheDocument();
    });

    it('renders mobile drawer when mobileOpen is true', () => {
      const handleClose = vi.fn();
      render(
        <MemoryRouter>
          <Sidebar mobileOpen={true} onCloseMobile={handleClose} />
        </MemoryRouter>
      );

      // Backdrop and close button must exist
      const backdrop = document.getElementById('mobile-sidebar-backdrop');
      expect(backdrop).toBeInTheDocument();

      const closeBtn = document.getElementById('mobile-sidebar-close-btn');
      expect(closeBtn).toBeInTheDocument();

      // Clicking backdrop calls onCloseMobile
      fireEvent.click(backdrop!);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('closes mobile drawer when Escape key is pressed', () => {
      const handleClose = vi.fn();
      render(
        <MemoryRouter>
          <Sidebar mobileOpen={true} onCloseMobile={handleClose} />
        </MemoryRouter>
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('locks body scroll when mobile drawer is opened', () => {
      const { rerender } = render(
        <MemoryRouter>
          <Sidebar mobileOpen={true} onCloseMobile={vi.fn()} />
        </MemoryRouter>
      );

      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <MemoryRouter>
          <Sidebar mobileOpen={false} onCloseMobile={vi.fn()} />
        </MemoryRouter>
      );

      expect(document.body.style.overflow).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Responsive Layout Component
  // ---------------------------------------------------------------------------
  describe('Responsive Layout Header and Viewport Structure', () => {
    it('renders page title and children with responsive classes', () => {
      render(
        <MemoryRouter>
          <Layout title="Test Operations View" subtitle="Subheader info">
            <div>Main page body content</div>
          </Layout>
        </MemoryRouter>
      );

      // Both mobile and desktop headers contain the title
      const titleEls = screen.getAllByText('Test Operations View');
      expect(titleEls.length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText('Main page body content')).toBeInTheDocument();

      // Hamburger button exists for mobile viewports
      const hamburger = document.getElementById('mobile-menu-toggle-btn');
      expect(hamburger).toBeInTheDocument();
      expect(hamburger).toHaveAttribute('aria-label', 'Abrir menu lateral');
    });

    it('opens mobile drawer when hamburger button is clicked', () => {
      render(
        <MemoryRouter>
          <Layout title="Responsive View">
            <div>Content</div>
          </Layout>
        </MemoryRouter>
      );

      const hamburger = document.getElementById('mobile-menu-toggle-btn')!;
      expect(document.getElementById('mobile-sidebar-backdrop')).not.toBeInTheDocument();

      fireEvent.click(hamburger);

      expect(document.getElementById('mobile-sidebar-backdrop')).toBeInTheDocument();
      expect(document.getElementById('mobile-sidebar-drawer')).toBeInTheDocument();
    });
  });
});
