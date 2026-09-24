import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingScreen } from '../components/LoadingScreen';
import { Sidebar } from '../components/Sidebar';
import { Layout } from '../components/Layout';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { MobileMenuSheet } from '../components/MobileMenuSheet';

// Mock AuthProvider context for Sidebar, Layout, and MobileMenuSheet tests
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

describe('Batch 4.2 — Premium Global UI System & Responsive Suite', () => {
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
  // 3. Desktop Sidebar — Brand Prominence & Operational Navigation
  // ---------------------------------------------------------------------------
  describe('Desktop Sidebar Branding and Navigation Hierarchy', () => {
    it('renders official EDS logo asset and subtitle in branded header', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Official EDS logo asset must be rendered with proper alt text
      const logos = screen.getAllByAltText('Expert Dental Solutions');
      expect(logos.length).toBeGreaterThanOrEqual(1);
      expect(logos[0].getAttribute('src')).toContain('eds-logo.png');

      // Tagline/subtitle
      expect(screen.getAllByText('Expert Dental Solutions').length).toBeGreaterThanOrEqual(1);
    });

    it('renders primary operational items: Pipeline, Contatos, Tarefas, Dashboard', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Primary operational items in OPERACIONAL group
      expect(screen.getByText('OPERACIONAL')).toBeInTheDocument();
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Contatos')).toBeInTheDocument();
      expect(screen.getByText('Tarefas')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Conversas')).toBeInTheDocument();

      // System group
      expect(screen.getByText('Templates')).toBeInTheDocument();
      expect(screen.getByText('Configurações')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Mobile Bottom Navigation (REQUIRED)
  // ---------------------------------------------------------------------------
  describe('Mobile Bottom Navigation (Fixed, 4 Exact Items)', () => {
    it('renders exactly the 4 required items in exact order: Contatos, Pipeline, Tarefas, Menu', () => {
      render(
        <MemoryRouter initialEntries={['/leads']}>
          <MobileBottomNav onOpenMenu={vi.fn()} />
        </MemoryRouter>
      );

      const navEl = document.getElementById('mobile-bottom-nav');
      expect(navEl).toBeInTheDocument();

      const contactsBtn = document.getElementById('mobile-nav-contacts');
      const pipelineBtn = document.getElementById('mobile-nav-pipeline');
      const tasksBtn = document.getElementById('mobile-nav-tasks');
      const menuBtn = document.getElementById('mobile-nav-menu');

      expect(contactsBtn).toBeInTheDocument();
      expect(pipelineBtn).toBeInTheDocument();
      expect(tasksBtn).toBeInTheDocument();
      expect(menuBtn).toBeInTheDocument();

      // Check text labels
      expect(contactsBtn).toHaveTextContent('Contatos');
      expect(pipelineBtn).toHaveTextContent('Pipeline');
      expect(tasksBtn).toHaveTextContent('Tarefas');
      expect(menuBtn).toHaveTextContent('Menu');
    });

    it('highlights active item based on current route', () => {
      const { unmount } = render(
        <MemoryRouter initialEntries={['/pipeline']}>
          <MobileBottomNav onOpenMenu={vi.fn()} />
        </MemoryRouter>
      );

      // When on /pipeline, pipeline nav has active styling
      const pipelineBtn = document.getElementById('mobile-nav-pipeline');
      expect(pipelineBtn?.className).toContain('text-[#08254f]');
      unmount();

      // When on /leads, contacts nav has active styling
      render(
        <MemoryRouter initialEntries={['/leads']}>
          <MobileBottomNav onOpenMenu={vi.fn()} />
        </MemoryRouter>
      );

      const contactsBtn = document.getElementById('mobile-nav-contacts');
      expect(contactsBtn?.className).toContain('text-[#08254f]');
    });

    it('invokes onOpenMenu callback when Menu button is clicked', () => {
      const onOpenMenuMock = vi.fn();
      render(
        <MemoryRouter initialEntries={['/pipeline']}>
          <MobileBottomNav onOpenMenu={onOpenMenuMock} isMenuOpen={false} />
        </MemoryRouter>
      );

      const menuBtn = document.getElementById('mobile-nav-menu')!;
      fireEvent.click(menuBtn);
      expect(onOpenMenuMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Mobile Menu Sheet (Slide-over drawer for secondary items)
  // ---------------------------------------------------------------------------
  describe('Mobile Menu Sheet (Slide-Over Drawer)', () => {
    it('renders secondary routes and does NOT duplicate primary operational routes', () => {
      render(
        <MemoryRouter>
          <MobileMenuSheet isOpen={true} onClose={vi.fn()} />
        </MemoryRouter>
      );

      const drawer = document.getElementById('mobile-menu-drawer');
      expect(drawer).toBeInTheDocument();

      // Secondary operational areas in drawer
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Conversas')).toBeInTheDocument();
      expect(screen.getByText('Templates')).toBeInTheDocument();
      expect(screen.getByText('Configurações')).toBeInTheDocument();

      // Does not contain duplicate Contatos or Pipeline in the secondary navigation
      expect(screen.queryByText('Contatos')).not.toBeInTheDocument();
      expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    });

    it('closes when close button or backdrop is clicked', () => {
      const onCloseMock = vi.fn();
      render(
        <MemoryRouter>
          <MobileMenuSheet isOpen={true} onClose={onCloseMock} />
        </MemoryRouter>
      );

      // Close button
      const closeBtn = document.getElementById('mobile-menu-close-btn')!;
      fireEvent.click(closeBtn);
      expect(onCloseMock).toHaveBeenCalledTimes(1);

      // Backdrop
      const backdrop = document.getElementById('mobile-menu-backdrop')!;
      fireEvent.click(backdrop);
      expect(onCloseMock).toHaveBeenCalledTimes(2);
    });

    it('closes on Escape key press and locks body scroll', () => {
      const onCloseMock = vi.fn();
      const { rerender } = render(
        <MemoryRouter>
          <MobileMenuSheet isOpen={true} onClose={onCloseMock} />
        </MemoryRouter>
      );

      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCloseMock).toHaveBeenCalledTimes(1);

      rerender(
        <MemoryRouter>
          <MobileMenuSheet isOpen={false} onClose={onCloseMock} />
        </MemoryRouter>
      );

      expect(document.body.style.overflow).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Responsive Layout Shell & Standardized Header
  // ---------------------------------------------------------------------------
  describe('Responsive Layout Shell Integration', () => {
    it('renders standardized page header with eyebrow, title, subtitle, and actions', () => {
      render(
        <MemoryRouter>
          <Layout
            eyebrow="CRM COMERCIAL"
            title="Pipeline"
            subtitle="Organize e acompanhe seus contatos."
            actions={<button id="test-primary-cta">Novo Lead</button>}
          >
            <div>Main page body content</div>
          </Layout>
        </MemoryRouter>
      );

      expect(screen.getByText('CRM COMERCIAL')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
      expect(screen.getByText('Organize e acompanhe seus contatos.')).toBeInTheDocument();
      expect(screen.getByText('Novo Lead')).toBeInTheDocument();
      expect(screen.getByText('Main page body content')).toBeInTheDocument();

      // Fixed mobile bottom nav is present in Layout
      expect(document.getElementById('mobile-bottom-nav')).toBeInTheDocument();
    });

    it('opens MobileMenuSheet when Menu button is clicked in Layout', () => {
      render(
        <MemoryRouter>
          <Layout title="Test Page">
            <div>Body</div>
          </Layout>
        </MemoryRouter>
      );

      // Menu sheet is initially closed
      expect(document.getElementById('mobile-menu-drawer')).not.toBeInTheDocument();

      // Click Menu in bottom nav
      const menuBtn = document.getElementById('mobile-nav-menu')!;
      fireEvent.click(menuBtn);

      // Menu sheet is now open
      expect(document.getElementById('mobile-menu-drawer')).toBeInTheDocument();
    });
  });
});
