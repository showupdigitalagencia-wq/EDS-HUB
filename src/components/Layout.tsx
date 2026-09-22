import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileMenuSheet } from './MobileMenuSheet';
import { useAuth } from '../features/auth/AuthProvider';
import { Search } from 'lucide-react';
import edsLogo from '../assets/eds-logo.png';

interface LayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function Layout({ children, title, subtitle, eyebrow, actions }: LayoutProps) {
  const { appUser } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f7f9fc] w-full overflow-x-hidden text-slate-800">
      {/* 1. Desktop Fixed Sidebar (~240px) */}
      <Sidebar
        mobileOpen={false}
        onCloseMobile={() => {}}
      />

      {/* 2. Main Workspace */}
      <div className="flex-1 lg:ml-60 flex flex-col min-w-0 w-full min-h-screen">
        {/* A. Mobile Top Bar (< lg) */}
        <header className="lg:hidden sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-2.5 flex items-center justify-between min-h-[56px] shadow-2xs">
          <NavLink to="/" className="flex items-center gap-2">
            <img
              src={edsLogo}
              alt="Expert Dental Solutions"
              className="h-7 w-auto max-w-[130px] object-contain"
            />
          </NavLink>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#08254f] text-white flex items-center justify-center text-xs font-bold shadow-xs">
              {appUser?.display_name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
          </div>
        </header>

        {/* B. Desktop Top Bar (>= lg) */}
        <header className="hidden lg:flex sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-8 py-3.5 shadow-2xs items-center justify-between min-h-[58px]">
          {/* Global Search Placeholder */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              readOnly
              placeholder="Buscar no EDS HUB..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-600 placeholder:text-slate-400 focus:outline-none focus:bg-white cursor-pointer transition-colors"
            />
          </div>

          {/* User Profile Pill */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
              <div className="w-7 h-7 rounded-full bg-[#08254f] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                {appUser?.display_name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <span className="text-xs font-semibold text-slate-700 font-heading">
                {appUser?.display_name || 'Admin'}
              </span>
            </div>
          </div>
        </header>

        {/* C. Standardized Page Header Area */}
        <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 max-w-7xl mx-auto">
            <div>
              {eyebrow && (
                <p className="text-[10px] font-bold tracking-widest text-[#449bd5] uppercase font-heading mb-1">
                  {eyebrow}
                </p>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold text-[#08254f] tracking-tight font-heading">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
                  {subtitle}
                </p>
              )}
            </div>

            {actions && (
              <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto">{actions}</div>
            )}
          </div>
        </div>

        {/* D. Main Content Area with Mobile Safe Area Clearance */}
        <main className="p-4 sm:p-6 lg:p-8 flex-1 min-w-0 w-full pb-24 lg:pb-10 max-w-7xl mx-auto">
          {children}
        </main>
      </div>

      {/* 3. Fixed Mobile Bottom Navigation Bar (< lg) */}
      <MobileBottomNav
        onOpenMenu={() => setMobileMenuOpen(true)}
        isMenuOpen={mobileMenuOpen}
      />

      {/* 4. Mobile Menu Drawer / Sheet */}
      <MobileMenuSheet
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
    </div>
  );
}
