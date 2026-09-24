import { useEffect, useCallback, type ReactNode } from 'react';
import { X, ArrowLeft } from 'lucide-react';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  widthClass?: string; // desktop width, default 'max-w-xl w-full'
  showCloseButton?: boolean;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  headerActions,
  footer,
  children,
  widthClass = 'sm:max-w-xl w-full',
  showCloseButton = true,
}: DrawerProps) {
  // Handle ESC key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#061a38]/40 backdrop-blur-xs transition-opacity duration-200 animate-fadeIn"
      />

      {/* Drawer Container */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-0 sm:pl-10">
        <div
          className={`flex flex-col h-full bg-white shadow-2xl transition-transform duration-300 ease-out transform translate-x-0 ${widthClass} border-l border-slate-200/80`}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div
              className="flex items-center justify-between px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-100 bg-white sticky top-0 z-10 shrink-0"
              style={{ paddingTop: 'max(0.875rem, env(safe-area-inset-top, 0px))' }}
            >
              <div className="flex-1 min-w-0 pr-3">
                {typeof title === 'string' ? (
                  <h2 className="text-base sm:text-lg font-bold text-[#08254f] truncate font-heading tracking-tight">
                    {title}
                  </h2>
                ) : (
                  title
                )}
                {subtitle && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate font-sans">
                    {subtitle}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {headerActions}
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    title="Fechar"
                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <ArrowLeft className="h-5 w-5 sm:hidden text-slate-600" />
                    <span className="text-xs font-semibold text-slate-700 sm:hidden">Voltar</span>
                    <X className="h-5 w-5 hidden sm:block text-slate-400" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scrollable Body */}
          <div
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))' }}
          >
            {children}
          </div>

          {/* Optional Footer */}
          {footer && (
            <div
              className="px-5 py-4 border-t border-slate-100 bg-slate-50/80 shrink-0"
              style={{ paddingBottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))' }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
