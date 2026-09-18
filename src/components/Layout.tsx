import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Menu } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Layout({ children, title, subtitle, actions }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f8fafc] w-full overflow-x-hidden">
      {/* Responsive Sidebar (Desktop fixed + Mobile slide-over drawer) */}
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Column */}
      <div className="flex-1 lg:ml-64 flex flex-col min-w-0 w-full">
        {/* Mobile Header Bar (< lg) */}
        <header className="lg:hidden sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-4 py-3 flex items-center justify-between min-h-[56px] shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              id="mobile-menu-toggle-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu lateral"
              className="p-2 -ml-1.5 rounded-lg text-slate-700 hover:bg-slate-100 hover:text-[#08254f] transition-colors cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-[#08254f] truncate font-heading leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[10px] text-slate-500 truncate">{subtitle}</p>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </header>

        {/* Desktop Header Bar (>= lg) */}
        <header className="hidden lg:flex sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-8 py-4 shadow-2xs items-center justify-between min-h-[68px]">
          <div>
            <h1 className="text-xl font-bold text-[#08254f] tracking-tight font-heading">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            ) : (
              <p className="text-[11px] text-slate-400 mt-0.5">
                Expert Dental Solutions • Deliverability & Training CRM
              </p>
            )}
          </div>

          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>

        {/* Content Area */}
        <main className="p-4 sm:p-6 lg:p-8 flex-1 min-w-0 w-full">{children}</main>
      </div>
    </div>
  );
}
