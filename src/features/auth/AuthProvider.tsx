import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import type { AppUser } from '../../types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  isLoading: boolean;
  isAuthorized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAppUser = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('app_user')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      setAppUser(null);
      return;
    }

    setAppUser(data as AppUser);
  }, []);

  useEffect(() => {
    let isMounted = true;
    // Safety timeout: Never let the auth loader freeze the screen indefinitely
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    }, 5000);

    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (!isMounted) return;
        setSession(s);
        if (s?.user) {
          fetchAppUser(s.user.id)
            .catch((err) => {
              console.warn('[AuthProvider] fetchAppUser error:', err);
              if (isMounted) setAppUser(null);
            })
            .finally(() => {
              if (isMounted) {
                clearTimeout(timeoutId);
                setIsLoading(false);
              }
            });
        } else {
          clearTimeout(timeoutId);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('[AuthProvider] getSession error:', err);
        if (isMounted) {
          clearTimeout(timeoutId);
          setIsLoading(false);
        }
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        if (!isMounted) return;
        setSession(s);
        if (s?.user) {
          try {
            await fetchAppUser(s.user.id);
          } catch (err) {
            console.warn('[AuthProvider] onAuthStateChange fetchAppUser error:', err);
            if (isMounted) setAppUser(null);
          }
        } else {
          setAppUser(null);
        }
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [fetchAppUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAppUser(null);
  }, []);

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    appUser,
    isLoading,
    isAuthorized: !!session?.user && !!appUser?.is_active,
    signIn,
    signOut,
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
