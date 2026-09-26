import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as fs from 'fs';
import * as path from 'path';
import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { isTransientNetworkError, resilientFetch } from '../lib/supabase';

// Mock Supabase module
vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase')>();
  return {
    ...actual,
    supabase: {
      auth: {
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
      from: vi.fn(),
    },
  };
});

import { supabase } from '../lib/supabase';

describe('URGENT PRODUCTION INCIDENT — Login "Load failed" Elimination & Resilient Session Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ===========================================================================
  // 1. Root Cause & Translation: "Load failed" Elimination
  // ===========================================================================
  describe('1. Error Sanitization & "Load failed" Elimination', () => {
    it('detects WebKit "Load failed" and browser network drops as transient network errors', () => {
      expect(isTransientNetworkError(new TypeError('Load failed'))).toBe(true);
      expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
      expect(isTransientNetworkError(new Error('Network error'))).toBe(true);
      expect(isTransientNetworkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
      expect(isTransientNetworkError(new Error('Connection closed abruptly'))).toBe(true);
      // Valid credential rejection is NOT a transient network error
      expect(isTransientNetworkError(new Error('Invalid login credentials'))).toBe(false);
    });

    it('resilientFetch retries once on transient network failure before failing', async () => {
      let attempts = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new TypeError('Load failed');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      vi.stubGlobal('fetch', mockFetch);

      const res = await resilientFetch('https://example.com/api', {});
      expect(attempts).toBe(2);
      expect(res.status).toBe(200);
    });

    it('replaces raw WebKit "Load failed" with a polite Portuguese connectivity message', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { user: null, session: null },
        error: { name: 'AuthRetryableFetchError', message: 'Load failed', status: 0 },
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Sign in to your account')).toBeDefined();
      });

      fireEvent.change(screen.getByLabelText(/Email address/i), {
        target: { value: 'info@expdentalsolutions.com' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'AnyPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

      await waitFor(() => {
        const errorEl = document.getElementById('login-error');
        expect(errorEl).not.toBeNull();
        // MUST NOT show literal "Load failed"
        expect(errorEl?.textContent).not.toContain('Load failed');
        // MUST show actionable message and retry button
        expect(errorEl?.textContent).toContain('Não foi possível conectar ao servidor');
        expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeDefined();
      });
    });

    it('displays "Email ou senha inválidos." on invalid credentials (never generic technical errors)', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { user: null, session: null },
        error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400 },
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Sign in to your account')).toBeDefined();
      });

      fireEvent.change(screen.getByLabelText(/Email address/i), {
        target: { value: 'info@expdentalsolutions.com' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'WrongPassword!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

      await waitFor(() => {
        const errorEl = document.getElementById('login-error');
        expect(errorEl?.textContent).toContain('Email ou senha inválidos.');
        // Credential failure should not offer retry connection button
        expect(screen.queryByRole('button', { name: /Tentar novamente/i })).toBeNull();
      });
    });
  });

  // ===========================================================================
  // 2. Session Persistence & Preservation on Network Errors
  // ===========================================================================
  describe('2. Safe Startup Session Preservation (No Unwarranted SignOut)', () => {
    it('DOES NOT call signOut when getSession fails with a network error on app startup', async () => {
      // Simulate opening PWA in the morning where network has a transient glitch
      (supabase.auth.getSession as any).mockRejectedValue(new TypeError('Load failed'));

      function TestConsumer() {
        const { isLoading, session } = useAuth();
        return (
          <div>
            <div data-testid="loading">{String(isLoading)}</div>
            <div data-testid="has-session">{String(!!session)}</div>
          </div>
        );
      }

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      // Crucial: signOut must NOT have been called!
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it('DOES call signOut if the refresh token is explicitly revoked or invalid', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 },
      });

      function TestConsumer() {
        const { isLoading } = useAuth();
        return <div data-testid="loading">{String(isLoading)}</div>;
      }

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      expect(supabase.auth.signOut).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 3. Separation of Auth Failure vs Workspace Load Failure
  // ===========================================================================
  describe('3. Separation of Auth vs Workspace Initialization Failures', () => {
    it('handles secondary query failure cleanly without making valid auth appear as invalid password', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
      // 1. Auth succeeds
      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: {
          user: { id: 'admin-uuid-1', email: 'info@expdentalsolutions.com' },
          session: { access_token: 'fake-jwt', user: { id: 'admin-uuid-1' } },
        },
        error: null,
      });

      // 2. Secondary query for app_user fails due to temporary network glitch
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: new TypeError('Load failed'),
        }),
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Sign in to your account')).toBeDefined();
      });

      fireEvent.change(screen.getByLabelText(/Email address/i), {
        target: { value: 'info@expdentalsolutions.com' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'CorrectPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

      await waitFor(() => {
        const errorEl = document.getElementById('login-error');
        expect(errorEl?.textContent).toContain('Login realizado, mas não foi possível carregar o sistema.');
        expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeDefined();
      });
    });

    it('rejects authenticated users who lack an active app_user record with clear permission notice', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: {
          user: { id: 'unauthorized-uuid-99', email: 'stranger@example.com' },
          session: { access_token: 'fake-jwt', user: { id: 'unauthorized-uuid-99' } },
        },
        error: null,
      });

      // app_user record is null
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Sign in to your account')).toBeDefined();
      });

      fireEvent.change(screen.getByLabelText(/Email address/i), {
        target: { value: 'stranger@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'Password123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

      await waitFor(() => {
        const errorEl = document.getElementById('login-error');
        expect(errorEl?.textContent).toContain('Usuário autenticado, mas sem perfil ativo no sistema.');
      });
    });
  });

  // ===========================================================================
  // 4. ProtectedRoute Resilience
  // ===========================================================================
  describe('4. ProtectedRoute Graceful Recovery', () => {
    it('renders a retryable connection recovery screen on transient workspace error instead of access denied', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            access_token: 'fake-token',
            user: { id: 'valid-user-1', email: 'admin@expdentalsolutions.com' },
          },
        },
        error: null,
      });

      // app_user query fails with network error
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: new TypeError('Load failed'),
        }),
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider>
            <Routes>
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <div data-testid="workspace-content">Workspace Loaded</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Não foi possível carregar o sistema')).toBeDefined();
        expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeDefined();
        // Must NOT falsely claim "Acesso Negado"
        expect(screen.queryByText('Acesso Negado')).toBeNull();
      });
    });
  });

  // ===========================================================================
  // 5. Service Worker & Vercel Caching Audit
  // ===========================================================================
  describe('5. Service Worker & Vercel Cache Configuration Audit', () => {
    it('public/sw.js is at cache version eds-hub-shell-v9', () => {
      const swPath = path.resolve(__dirname, '../../public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf-8');
      expect(swContent).toContain("const CACHE_NAME = 'eds-hub-shell-v9';");
    });

    it('public/sw.js never returns undefined on network failure, preventing Safari Load failed', () => {
      const swPath = path.resolve(__dirname, '../../public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf-8');
      // Verifies fallback response is provided rather than undefined
      expect(swContent).toContain("new Response('Network error or resource unavailable'");
    });

    it('vercel.json enforces no-cache on index.html and sw.js, and immutable cache on assets', () => {
      const vercelPath = path.resolve(__dirname, '../../vercel.json');
      const vercelContent = fs.readFileSync(vercelPath, 'utf-8');
      const vercelJson = JSON.parse(vercelContent);

      const htmlHeader = vercelJson.headers.find((h: any) => h.source === '/(index\\.html)?');
      expect(htmlHeader).toBeDefined();
      expect(htmlHeader.headers).toEqual(
        expect.arrayContaining([
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ])
      );

      const assetsHeader = vercelJson.headers.find((h: any) => h.source === '/assets/(.*)');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader.headers).toEqual(
        expect.arrayContaining([
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ])
      );
    });
  });
});
