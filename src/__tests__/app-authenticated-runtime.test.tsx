import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { SalesDashboardPage } from '../features/dashboard/SalesDashboardPage';
import { RevenueDashboardPage } from '../features/revenue/RevenueDashboardPage';
import { WorkDashboardPage } from '../features/work/WorkDashboardPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { PipelineKanbanPage } from '../features/pipeline/PipelineKanbanPage';

// Mock AuthProvider context with an active app_user
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

describe('Authenticated Full App Integration Tests', () => {
  it('renders authenticated SalesDashboardPage without triggering ErrorBoundary', async () => {
    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <SalesDashboardPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    );

    // Assert ErrorBoundary is NOT rendered
    expect(screen.queryByText('Algo deu errado')).toBeNull();
    // Assert dashboard unique content is present
    expect(screen.getByText('Sales Intelligence Dashboard')).toBeDefined();
  });

  it('renders authenticated RevenueDashboardPage without triggering ErrorBoundary', async () => {
    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/dashboard/revenue']}>
          <Routes>
            <Route
              path="/dashboard/revenue"
              element={
                <ProtectedRoute>
                  <RevenueDashboardPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    );

    expect(screen.queryByText('Algo deu errado')).toBeNull();
    expect(screen.getByText('Revenue & Enrollment Intelligence')).toBeDefined();
  });

  it('renders authenticated WorkDashboardPage without triggering ErrorBoundary', async () => {
    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/work']}>
          <Routes>
            <Route
              path="/work"
              element={
                <ProtectedRoute>
                  <WorkDashboardPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    );

    expect(screen.queryByText('Algo deu errado')).toBeNull();
    expect(screen.getByText('Daily Operations Command Center')).toBeDefined();
  });

  it('renders authenticated ReportsPage without triggering ErrorBoundary', async () => {
    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/reports']}>
          <Routes>
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    );

    expect(screen.queryByText('Algo deu errado')).toBeNull();
    expect(screen.getByText('Executive Analytics & Reports')).toBeDefined();
  });

  it('renders authenticated PipelineKanbanPage without triggering ErrorBoundary', async () => {
    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/pipeline']}>
          <Routes>
            <Route
              path="/pipeline"
              element={
                <ProtectedRoute>
                  <PipelineKanbanPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    );

    expect(screen.queryByText('Algo deu errado')).toBeNull();
    expect(screen.getAllByText('Commercial Pipeline').length).toBeGreaterThan(0);
  });

  it('renders SalesDashboardPage gracefully when RPC throws an error', async () => {
    // Override supabase.rpc to reject
    const { supabase } = await import('../lib/supabase');
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockReturnValue({
      then: vi.fn().mockImplementation((callback) =>
        Promise.resolve(callback({ data: null, error: { message: 'Database connection failed', code: '500' } }))
      ),
    } as any);

    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <SalesDashboardPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    );

    // ErrorBoundary must NOT trigger even if RPC fails
    expect(screen.queryByText('Algo deu errado')).toBeNull();
    rpcSpy.mockRestore();
  });
});
