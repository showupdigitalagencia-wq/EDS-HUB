import type { ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertCircle, HelpCircle, Loader2 } from 'lucide-react';

export type StatusVariant = 'success' | 'error' | 'warning' | 'unknown' | 'loading';

interface StatusCardProps {
  id?: string;
  title: string;
  value: string;
  variant: StatusVariant;
  detail?: string;
  icon?: ReactNode;
}

const variantStyles: Record<StatusVariant, { bg: string; text: string; iconColor: string }> = {
  success: { bg: 'bg-emerald-50', text: 'text-emerald-700', iconColor: 'text-emerald-500' },
  error: { bg: 'bg-red-50', text: 'text-red-700', iconColor: 'text-red-500' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-700', iconColor: 'text-amber-500' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-500', iconColor: 'text-gray-400' },
  loading: { bg: 'bg-brand-50', text: 'text-brand-600', iconColor: 'text-brand-500' },
};

const defaultIcons: Record<StatusVariant, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5" />,
  error: <XCircle className="h-5 w-5" />,
  warning: <AlertCircle className="h-5 w-5" />,
  unknown: <HelpCircle className="h-5 w-5" />,
  loading: <Loader2 className="h-5 w-5 animate-spin" />,
};

export function StatusCard({ id, title, value, variant, detail, icon }: StatusCardProps) {
  const styles = variantStyles[variant];

  return (
    <div
      id={id}
      className="bg-white rounded-[var(--radius-card)] shadow-[var(--shadow-card)] border border-gray-100 p-5 hover:shadow-[var(--shadow-card-hover)] transition-shadow duration-200"
    >
      <div className="flex items-start gap-3">
        <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${styles.bg} ${styles.iconColor}`}>
          {icon || defaultIcons[variant]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className={`text-sm font-semibold mt-0.5 ${styles.text}`}>{value}</p>
          {detail && (
            <p className="text-xs text-gray-400 mt-1 truncate">{detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}
