import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { ButtonVariant } from './Button';

export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: IconButtonSize;
  isLoading?: boolean;
  'aria-label': string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      icon,
      className = '',
      disabled,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      'inline-flex items-center justify-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-95 disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 cursor-pointer select-none shrink-0';

    const variantClasses: Record<ButtonVariant, string> = {
      primary:
        'bg-[#08254f] text-white hover:bg-[#061a38] active:bg-[#041226] focus-visible:ring-[#08254f] shadow-xs',
      crimson:
        'bg-[#8a1c1c] text-white hover:bg-[#731717] active:bg-[#5c1212] focus-visible:ring-[#8a1c1c] shadow-xs',
      secondary:
        'bg-white text-slate-700 border border-slate-200/90 hover:bg-slate-50/90 active:bg-slate-100 focus-visible:ring-[#08254f] shadow-2xs',
      ghost:
        'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800 active:bg-slate-200/80 focus-visible:ring-slate-400',
      danger:
        'bg-red-50 text-red-700 border border-red-200/80 hover:bg-red-100 active:bg-red-200 focus-visible:ring-red-500 shadow-2xs',
      whatsapp:
        'bg-[#25D366] text-white hover:bg-[#20ba59] active:bg-[#1da850] focus-visible:ring-[#25D366] shadow-xs',
    };

    const sizeClasses: Record<IconButtonSize, string> = {
      sm: 'w-8 h-8 rounded-lg text-xs',
      md: 'w-10 h-10 rounded-xl text-sm',
      lg: 'w-11 h-11 rounded-xl text-base',
    };

    return (
      <button
        ref={ref}
        aria-label={ariaLabel}
        disabled={disabled || isLoading}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
