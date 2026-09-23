import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  error?: string;
  helperText?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, error, helperText, className = '', id, children, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-semibold text-slate-700 font-heading"
          >
            {label}
            {props.required && <span className="text-[#8a1c1c] ml-1">*</span>}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={`w-full h-10 pl-3.5 pr-9 text-xs sm:text-sm bg-white border rounded-xl text-slate-900 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent appearance-none cursor-pointer ${
              error
                ? 'border-red-300 focus:ring-red-500'
                : 'border-slate-200/90 hover:border-slate-300'
            } disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${className}`}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>

          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>

        {error ? (
          <p className="text-[11px] text-red-600 font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-[11px] text-slate-500">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Select.displayName = 'Select';
