import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, type AuthErrorType } from './AuthProvider';
import { Loader2, Lock, Mail, ShieldCheck, RefreshCw } from 'lucide-react';
import edsLogo from '../../assets/eds-logo.png';

export function LoginPage() {
  const { signIn, isAuthorized, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<AuthErrorType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fromLocation = (location.state as any)?.from;
  const from = fromLocation?.pathname
    ? `${fromLocation.pathname}${fromLocation.search || ''}`
    : '/';

  // If already authenticated and authorized, redirect to intended target or home
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#08254f]">
        <Loader2 className="h-8 w-8 animate-spin text-[#449bd5]" />
      </div>
    );
  }

  if (isAuthorized) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setErrorType(null);
    setIsSubmitting(true);

    const result = await signIn(email, password);
    if (result.error) {
      setError(result.error);
      setErrorType(result.errorType || 'auth');
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#041126] via-[#08254f] to-[#061e40] px-4 relative overflow-hidden">
      {/* Subtle Background Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#449bd5]/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#8a1c1c]/10 blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-block p-4 rounded-2xl bg-white shadow-lg mb-4 border border-white/20">
            <img
              src={edsLogo}
              alt="Expert Dental Solutions"
              className="h-10 w-auto max-w-[220px] object-contain"
            />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight font-heading">
            EDS HUB
          </h1>
          <p className="text-xs text-blue-200/80 mt-1 max-w-sm mx-auto">
            Hands-on Dental Training with Real Patients • Deliverability CRM
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-white/10 p-8">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
            <div>
              <h2 className="text-base font-bold text-[#08254f] font-heading">
                Sign in to your account
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Enter your credentials to access the workspace
              </p>
            </div>
            <div className="p-2 rounded-lg bg-blue-50 text-[#08254f]">
              <ShieldCheck className="w-5 h-5 text-[#1b7dbf]" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Email address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-[#08254f] focus:ring-1 focus:ring-[#08254f] outline-none"
                  placeholder="name@expdentalsolutions.com"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-[#08254f] focus:ring-1 focus:ring-[#08254f] outline-none"
                  placeholder="••••••••"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {error && (
              <div
                id="login-error"
                className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 font-medium space-y-2"
              >
                <div>{error}</div>
                {(errorType === 'network' || errorType === 'workspace') && (
                  <button
                    type="button"
                    id="login-retry-btn"
                    onClick={() => handleSubmit()}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-red-800 bg-red-100 hover:bg-red-200 rounded-md transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Tentar novamente
                  </button>
                )}
              </div>
            )}

            <button
              id="login-submit"
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#8a1c1c] hover:bg-[#701414] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-blue-200/60 mt-6">
          Expert Dental Solutions • Deliverability CRM Platform
        </p>
      </div>
    </div>
  );
}
