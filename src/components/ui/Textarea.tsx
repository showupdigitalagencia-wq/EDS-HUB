import { forwardRef, type TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className = '', id, ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold text-slate-700 font-heading"
          >
            {label}
            {props.required && <span className="text-[#8a1c1c] ml-1">*</span>}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          className={`w-full p-3.5 text-xs sm:text-sm bg-white border rounded-xl text-slate-900 placeholder:text-slate-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent ${
            error
              ? 'border-red-300 focus:ring-red-500'
              : 'border-slate-200/90 hover:border-slate-300'
          } disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed leading-relaxed ${className}`}
          {...props}
        />

        {error ? (
          <p className="text-[11px] text-red-600 font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-[11px] text-slate-500">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
