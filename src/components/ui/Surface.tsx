import { type HTMLAttributes, type ReactNode } from 'react';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'white' | 'slate' | 'highlight';
  elevation?: 'flat' | 'card' | 'elevated';
}

export function Surface({
  children,
  variant = 'white',
  elevation = 'card',
  className = '',
  ...props
}: SurfaceProps) {
  const variantClasses = {
    white: 'bg-white border-slate-200/80',
    slate: 'bg-slate-50/70 border-slate-200/70',
    highlight: 'bg-[#08254f]/5 border-[#08254f]/15',
  };

  const elevationClasses = {
    flat: 'border',
    card: 'border shadow-2xs',
    elevated: 'border shadow-md',
  };

  return (
    <div
      className={`rounded-2xl ${variantClasses[variant]} ${elevationClasses[elevation]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
