import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Carregando informações...' }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center mb-3 text-[#08254f] shadow-2xs border border-slate-200/60">
        <Loader2 className="h-5 w-5 animate-spin text-[#449bd5]" />
      </div>
      <p className="text-xs font-semibold text-slate-600 font-heading">{message}</p>
    </div>
  );
}
