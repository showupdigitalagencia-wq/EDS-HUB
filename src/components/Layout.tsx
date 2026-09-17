import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Layout({ children, title, subtitle, actions }: LayoutProps) {
  return (
    <div className="min-h-screen flex bg-[#f8fafc]">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-8 py-4 shadow-2xs flex items-center justify-between min-h-[68px]">
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
        <div className="p-8 flex-1">{children}</div>
      </main>
    </div>
  );
}
