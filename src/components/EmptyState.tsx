import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title = 'Nenhum dado encontrado',
  message = 'Não há registros disponíveis no momento.',
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3 shadow-2xs border border-slate-200/60">
        {icon || <Inbox className="h-5 w-5 text-slate-400" />}
      </div>
      <h3 className="text-sm font-bold text-[#08254f] mb-1 font-heading">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm leading-relaxed">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
