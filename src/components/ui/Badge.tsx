import { type HTMLAttributes, type ReactNode } from 'react';

export type BadgeVariant = 'navy' | 'crimson' | 'success' | 'warning' | 'neutral' | 'info' | 'purple';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ReactNode;
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: BadgeProps) {
  const baseClasses =
    'inline-flex items-center font-medium font-heading transition-colors border select-none';

  const variantClasses: Record<BadgeVariant, string> = {
    navy: 'bg-[#08254f]/10 text-[#08254f] border-[#08254f]/20',
    crimson: 'bg-[#8a1c1c]/10 text-[#8a1c1c] border-[#8a1c1c]/20',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
    warning: 'bg-amber-50 text-amber-800 border-amber-200/80',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200/80',
    info: 'bg-sky-50 text-sky-800 border-sky-200/80',
    purple: 'bg-purple-50 text-purple-800 border-purple-200/80',
  };

  const sizeClasses: Record<BadgeSize, string> = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1 rounded-md',
    md: 'text-xs px-2.5 py-0.5 gap-1.5 rounded-full',
  };

  return (
    <span
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
}
