import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message?: string;
}

export function EmptyState({
  icon,
  title = 'No data yet',
  message = 'There is nothing to display at the moment.',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#e1f0fb] text-[#125e95] mb-4 shadow-xs">
        {icon || <Inbox className="h-7 w-7 text-[#449bd5]" />}
      </div>
      <h3 className="text-base font-bold text-[#08254f] mb-1 font-heading">{title}</h3>
      <p className="text-xs text-slate-500 text-center max-w-sm leading-relaxed">{message}</p>
    </div>
  );
}
