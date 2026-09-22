import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/**
 * Sanitizes technical error messages to avoid exposing Postgres, Supabase,
 * HTTP status codes, or stack traces to non-technical operators.
 */
function sanitizeErrorMessage(rawMessage?: string): string {
  if (!rawMessage) return 'Não foi possível carregar os dados. Tente novamente.';

  const lower = rawMessage.toLowerCase();
  const isTechnical =
    lower.includes('postgres') ||
    lower.includes('supabase') ||
    lower.includes('pgrst') ||
    lower.includes('relation') ||
    lower.includes('column') ||
    lower.includes('sql') ||
    lower.includes('stack') ||
    lower.includes('syntax') ||
    lower.includes('http') ||
    lower.includes('500') ||
    lower.includes('404') ||
    lower.includes('failed to fetch');

  if (isTechnical) {
    console.error('[EDS HUB Operational Error Details]:', rawMessage);
    return 'Não foi possível carregar os dados. Tente novamente.';
  }

  return rawMessage;
}

export function ErrorState({
  title = 'Aviso do Sistema',
  message,
  onRetry,
}: ErrorStateProps) {
  const safeMessage = sanitizeErrorMessage(message);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 mb-3 shadow-2xs border border-rose-100">
        <AlertTriangle className="h-5 w-5 text-rose-600" />
      </div>
      <h3 className="text-sm font-bold text-[#08254f] mb-1 font-heading">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm mb-4 leading-relaxed">{safeMessage}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
          <span>Tentar novamente</span>
        </button>
      )}
    </div>
  );
}
