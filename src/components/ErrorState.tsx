import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-50 text-[#8a1c1c] mb-4 shadow-xs border border-rose-100">
        <AlertTriangle className="h-7 w-7 text-[#8a1c1c]" />
      </div>
      <h3 className="text-base font-bold text-[#08254f] mb-1 font-heading">{title}</h3>
      <p className="text-xs text-slate-500 text-center max-w-sm mb-4 leading-relaxed">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-secondary text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      )}
    </div>
  );
}
