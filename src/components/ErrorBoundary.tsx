import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import edsLogo from '../assets/eds-logo.png';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('EDS HUB ErrorBoundary:', error, errorInfo);

    // Record error in window for programmatic inspection in tests/CDP
    if (typeof window !== 'undefined') {
      (window as any).__EDS_ERROR__ = {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
      };
    }

    // Auto-recover from chunk loading errors (e.g. after a new production deployment)
    const isChunkLoadFailed =
      error?.name === 'ChunkLoadError' ||
      error?.message?.includes('Loading chunk') ||
      error?.message?.includes('Failed to fetch dynamically imported module');

    if (isChunkLoadFailed) {
      const storageKey = 'eds_chunk_reload_ts';
      const lastReload = sessionStorage.getItem(storageKey);
      const now = Date.now();
      // Only auto-reload if we haven't reloaded in the last 15 seconds
      if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
        sessionStorage.setItem(storageKey, now.toString());
        // Force cache bust on chunk load failure
        window.location.href = window.location.pathname + '?reload=' + Date.now();
      }
    }
  }

  private handleRetry = (): void => {
    sessionStorage.removeItem('eds_chunk_reload_ts');
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = window.location.pathname + '?reload=' + Date.now();
  };

  private handleGoHome = (): void => {
    sessionStorage.removeItem('eds_chunk_reload_ts');
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#041126] via-[#08254f] to-[#061e40] px-4 py-8 relative overflow-hidden">
          {/* Subtle Background Glows */}
          <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#449bd5]/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#8a1c1c]/10 blur-3xl pointer-events-none" />

          <div className="w-full max-w-md relative z-10 text-center">
            {/* Logo */}
            <div className="inline-block p-4 rounded-2xl bg-white shadow-xl mb-6 border border-white/20">
              <img
                src={edsLogo}
                alt="Expert Dental Solutions"
                className="h-10 w-auto max-w-[220px] object-contain"
              />
            </div>

            {/* Error Card */}
            <div
              id="eds-error-boundary-card"
              data-error-name={this.state.error?.name || 'Error'}
              data-error-message={this.state.error?.message || 'Unknown error'}
              className="bg-white/95 backdrop-blur-md rounded-2xl p-6 sm:p-8 shadow-2xl border border-white/20 text-left"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-[#08254f] font-heading">
                    Algo deu errado
                  </h1>
                  <p className="text-xs text-slate-500">
                    Ocorreu um erro inesperado na visualização.
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                A aplicação encontrou uma inconsistência temporária. Nenhuma informação foi perdida.
                Tente recarregar a página para restaurar o estado do sistema.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  id="error-boundary-retry-btn"
                  onClick={this.handleRetry}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#08254f] text-white text-sm font-semibold hover:bg-[#0a336c] transition-colors cursor-pointer shadow-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Recarregar Página
                </button>
                <button
                  type="button"
                  id="error-boundary-home-btn"
                  onClick={this.handleGoHome}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <Home className="w-4 h-4" />
                  Início
                </button>
              </div>
            </div>

            <p className="text-[11px] text-blue-200/60 mt-6">
              EDS HUB • Suporte: Expert Dental Solutions
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
