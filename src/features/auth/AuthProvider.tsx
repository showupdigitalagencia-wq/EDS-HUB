import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isTransientNetworkError } from '../../lib/supabase';
import type { AppUser } from '../../types';

export type AuthErrorType = 'auth' | 'network' | 'workspace' | 'permission' | null;

export interface SignInResult {
  error: string | null;
  errorType?: AuthErrorType;
}

export type AppUserErrorState = 'network' | 'not_found' | 'inactive' | null;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  isLoading: boolean;
  isAuthorized: boolean;
  appUserError: AppUserErrorState;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  retryLoadAppUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [appUserError, setAppUserError] = useState<AppUserErrorState>(null);

  const fetchAppUserDirect = useCallback(async (userId: string): Promise<{
    appUser: AppUser | null;
    errorType: AppUserErrorState;
  }> => {
    try {
      const { data, error } = await supabase
        .from('app_user')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[AuthProvider] fetchAppUser database error:', error);
        if (isTransientNetworkError(error)) {
          setAppUserError('network');
          return { appUser: null, errorType: 'network' };
        }
        setAppUserError('not_found');
        return { appUser: null, errorType: 'not_found' };
      }

      if (!data) {
        setAppUser(null);
        setAppUserError('not_found');
        return { appUser: null, errorType: 'not_found' };
      }

      if (!data.is_active) {
        setAppUser(data as AppUser);
        setAppUserError('inactive');
        return { appUser: data as AppUser, errorType: 'inactive' };
      }

      setAppUser(data as AppUser);
      setAppUserError(null);
      return { appUser: data as AppUser, errorType: null };
    } catch (err) {
      console.warn('[AuthProvider] fetchAppUser exception:', err);
      setAppUserError('network');
      return { appUser: null, errorType: 'network' };
    }
  }, []);

  const retryLoadAppUser = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    try {
      await fetchAppUserDirect(session.user.id);
    } finally {
      setIsLoading(false);
    }
  }, [session, fetchAppUserDirect]);

  useEffect(() => {
    let isMounted = true;
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    }, 6000);

    const initializeAuth = async () => {
      try {
        const { data: { session: s }, error: sessionError } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (sessionError) {
          console.warn('[AuthProvider] getSession returned error:', sessionError);
          const msg = (sessionError.message || '').toLowerCase();
          // ONLY clear session if refresh token is explicitly rejected or revoked by server
          if (
            msg.includes('invalid refresh token') ||
            msg.includes('refresh_token_not_found') ||
            msg.includes('invalid_grant') ||
            sessionError.status === 400
          ) {
            try {
              await supabase.auth.signOut().catch(() => {});
            } catch {
              // Ignore signOut errors
            }
            if (isMounted) {
              setSession(null);
              setAppUser(null);
            }
          }
          // Do NOT sign out on network/transient errors! Maintain local session for auto-reconnect
          return;
        }

        if (s?.user) {
          setSession(s);
          await fetchAppUserDirect(s.user.id);
        } else {
          setSession(null);
          setAppUser(null);
        }
      } catch (err) {
        // Do NOT call signOut on unexpected network error during getSession!
        console.warn('[AuthProvider] getSession network/transient error, maintaining session:', err);
      } finally {
        if (isMounted) {
          clearTimeout(timeoutId);
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const { data } = supabase.auth.onAuthStateChange(
        async (event, s) => {
          if (!isMounted) return;

          if (event === 'SIGNED_OUT') {
            setSession(null);
            setAppUser(null);
            setAppUserError(null);
            setIsLoading(false);
            return;
          }

          setSession(s);
          if (s?.user) {
            try {
              await fetchAppUserDirect(s.user.id);
            } catch (err) {
              console.warn('[AuthProvider] onAuthStateChange fetchAppUser error:', err);
            }
          } else {
            setAppUser(null);
          }
          setIsLoading(false);
        }
      );
      subscription = data.subscription;
    } catch (syncErr) {
      console.error('[AuthProvider] synchronous onAuthStateChange error:', syncErr);
    }

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      subscription?.unsubscribe();
    };
  }, [fetchAppUserDirect]);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      return { error: 'Informe seu e-mail e senha.', errorType: 'auth' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });

      if (error) {
        const errorMsg = (error.message || '').toLowerCase();
        const status = error.status;

        // Check for invalid credentials
        if (
          errorMsg.includes('invalid login credentials') ||
          errorMsg.includes('invalid credentials') ||
          (status === 400 && !errorMsg.includes('load failed'))
        ) {
          return { error: 'Email ou senha inválidos.', errorType: 'auth' };
        }

        // Check for rate limiting
        if (status === 429 || errorMsg.includes('too many') || errorMsg.includes('rate limit')) {
          return {
            error: 'Muitas tentativas de acesso. Aguarde alguns instantes e tente novamente.',
            errorType: 'network',
          };
        }

        // Check for WebKit "Load failed", Chromium "Failed to fetch", or connection drop
        if (isTransientNetworkError(error) || status === 0 || status === 503) {
          return {
            error: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
            errorType: 'network',
          };
        }

        return { error: 'Não foi possível realizar o login. Tente novamente.', errorType: 'auth' };
      }

      if (!data?.session || !data?.user) {
        return { error: 'Não foi possível obter a sessão de acesso.', errorType: 'auth' };
      }

      setSession(data.session);

      // Verify app_user synchronously before finishing login to prevent UI limbo
      const userProfileResult = await fetchAppUserDirect(data.user.id);

      if (userProfileResult.errorType === 'network') {
        return {
          error: 'Login realizado, mas não foi possível carregar o sistema. Tente novamente.',
          errorType: 'workspace',
        };
      }

      if (!userProfileResult.appUser || !userProfileResult.appUser.is_active) {
        return {
          error: 'Usuário autenticado, mas sem perfil ativo no sistema. Contate o administrador.',
          errorType: 'permission',
        };
      }

      setAppUser(userProfileResult.appUser);
      setAppUserError(null);
      return { error: null, errorType: null };
    } catch (unexpectedError) {
      console.error('[AuthProvider] signIn unexpected error:', unexpectedError);
      if (isTransientNetworkError(unexpectedError)) {
        return {
          error: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
          errorType: 'network',
        };
      }
      return { error: 'Ocorreu um erro inesperado ao realizar o login. Tente novamente.', errorType: 'auth' };
    }
  }, [fetchAppUserDirect]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore signOut network errors
    }
    setSession(null);
    setAppUser(null);
    setAppUserError(null);
  }, []);

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    appUser,
    isLoading,
    isAuthorized: !!session?.user && !!appUser?.is_active,
    appUserError,
    signIn,
    signOut,
    retryLoadAppUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
