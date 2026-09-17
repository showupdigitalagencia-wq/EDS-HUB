import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-[#08254f]" />
      <p className="text-xs font-semibold text-slate-500 mt-3 font-heading">{message}</p>
    </div>
  );
}
