import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { Loader2, ShieldAlert } from 'lucide-react';

/**
 * Protects routes from unauthenticated or unauthorized users.
 *
 * A user must:
 * 1. Be authenticated via Supabase Auth
 * 2. Have an active record in the app_user table
 *
 * Note: This is UX protection only. The real security is RLS in PostgreSQL.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, appUser, isLoading, isAuthorized, signOut } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500 mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Carregando...</p>
        </div>
      </div>
    );
  }

  // Not authenticated at all → redirect to login preserving intended target
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated but not in app_user → access denied
  if (!appUser || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 px-4">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-50 mb-4">
            <ShieldAlert className="h-7 w-7 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Acesso Negado</h1>
          <p className="text-sm text-gray-500 mb-6">
            Sua conta não possui autorização para acessar o EDS HUB. 
            Por favor, entre em contato com o administrador.
          </p>
          <button
            id="unauthorized-logout"
            onClick={signOut}
            className="rounded-[var(--radius-button)] bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 cursor-pointer"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
