import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'crimson' | 'secondary' | 'ghost' | 'danger' | 'whatsapp';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = '',
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    // Base styles
    const baseClasses =
      'inline-flex items-center justify-center font-medium font-heading transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 cursor-pointer select-none';

    // Variant classes
    const variantClasses: Record<ButtonVariant, string> = {
      primary:
        'bg-[#08254f] text-white hover:bg-[#061a38] active:bg-[#041226] focus-visible:ring-[#08254f] shadow-xs',
      crimson:
        'bg-[#8a1c1c] text-white hover:bg-[#731717] active:bg-[#5c1212] focus-visible:ring-[#8a1c1c] shadow-xs',
      secondary:
        'bg-white text-slate-700 border border-slate-200/90 hover:bg-slate-50/90 active:bg-slate-100 focus-visible:ring-[#08254f] shadow-2xs',
      ghost:
        'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200/80 focus-visible:ring-slate-400',
      danger:
        'bg-red-50 text-red-700 border border-red-200/80 hover:bg-red-100 active:bg-red-200 focus-visible:ring-red-500 shadow-2xs',
      whatsapp:
        'bg-[#25D366] text-white hover:bg-[#20ba59] active:bg-[#1da850] focus-visible:ring-[#25D366] shadow-xs',
    };

    // Size classes
    const sizeClasses: Record<ButtonSize, string> = {
      sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
      md: 'h-10 px-4 text-xs sm:text-sm gap-2 rounded-xl',
      lg: 'h-11 px-5 text-sm sm:text-base gap-2.5 rounded-xl',
    };

    const widthClass = fullWidth ? 'w-full' : '';

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          leftIcon && <span className="shrink-0 inline-flex items-center">{leftIcon}</span>
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon && (
          <span className="shrink-0 inline-flex items-center">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
