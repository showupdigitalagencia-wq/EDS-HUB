import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface CategoryOption {
  value: string;
  label: string;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'general', label: 'Geral' },
  { value: 'welcome', label: 'Boas-vindas' },
  { value: 'promotional', label: 'Promocional' },
  { value: 'followup', label: 'Follow-up' },
];

interface CategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export function CategorySelect({
  value,
  onChange,
  label = 'Categoria',
  className = '',
}: CategorySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption =
    CATEGORY_OPTIONS.find((opt) => opt.value === value) || CATEGORY_OPTIONS[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
  };

  return (
    <div ref={containerRef} className={`relative space-y-1.5 ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-slate-700 font-heading">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="w-full h-11 px-3.5 bg-white border border-slate-200/90 hover:border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 flex items-center justify-between transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#08254f]/15 focus:border-[#08254f] cursor-pointer shadow-2xs"
      >
        <span className="font-medium text-slate-800 truncate">
          {selectedOption.label}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform duration-200 shrink-0 ml-2 ${
            isOpen ? 'rotate-180 text-[#08254f]' : ''
          }`}
        />
      </button>

      {/* Floating Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {CATEGORY_OPTIONS.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3.5 py-2 text-xs sm:text-sm text-left flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/70 text-[#08254f] font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <Check className="h-4 w-4 text-[#08254f] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
