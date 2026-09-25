import { useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileMenuSheet } from './MobileMenuSheet';
import { MobileHeader } from './MobileHeader';
import { useAuth } from '../features/auth/AuthProvider';
import { useSafeBackNavigation } from '../hooks/useSafeBackNavigation';
import { IosInstallPrompt } from './IosInstallPrompt';

import { NotificationBell } from './NotificationBell';

interface LayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  backTo?: string;
  onBack?: () => void;
  hideBottomNav?: boolean;
}

export function Layout({
  children,
  title,
  subtitle,
  eyebrow,
  actions,
  backTo,
  onBack,
  hideBottomNav = false,
}: LayoutProps) {
  const { appUser } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const safeBack = useSafeBackNavigation(backTo || '/');

  const handleBackClick = () => {
    if (onBack) {
      onBack();
    } else if (backTo) {
      safeBack();
    }
  };

  const hasBack = Boolean(backTo || onBack);
  // Never hide mobile bottom navigation unless a top back button is guaranteed to be present
  const shouldHideBottomNav = hideBottomNav && hasBack;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f7f9fc] w-full overflow-x-hidden text-slate-800">
      {/* 1. Desktop Fixed Sidebar (~240px) */}
      <Sidebar
        mobileOpen={false}
        onCloseMobile={() => {}}
      />

      {/* 2. Main Workspace */}
      <div className="flex-1 lg:ml-60 flex flex-col min-w-0 w-full min-h-screen">
        {/* A. Standardized Mobile Top Bar (< lg) with Guaranteed Back Navigation */}
        <MobileHeader
          title={title}
          subtitle={subtitle}
          backTo={backTo}
          onBack={onBack}
          actions={actions}
        />

        {/* B. Desktop Top Bar (>= lg) - Clean Executive Header with Global Safe Back */}
        <header className="hidden lg:flex sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-8 py-3.5 shadow-2xs items-center justify-between min-h-[58px]">
          {/* Breadcrumb / Workspace Context & Back Button */}
          <div className="flex items-center gap-2.5">
            {hasBack && (
              <button
                type="button"
                onClick={handleBackClick}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200/80 text-slate-600 hover:text-[#08254f] hover:bg-slate-50 transition-colors text-xs font-semibold cursor-pointer shadow-2xs mr-1"
                title="Voltar"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#08254f]" />
                <span>Voltar</span>
              </button>
            )}
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-heading">
              EDS HUB
            </span>
            {hasBack && (
              <>
                <span className="text-slate-300 font-medium">/</span>
                <span className="text-xs font-medium text-slate-600 truncate max-w-xs">
                  {title}
                </span>
              </>
            )}
          </div>

          {/* User Profile Pill & Notification Bell */}
          <div className="flex items-center gap-3">
            <NotificationBell />
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
        <main className="p-4 sm:p-6 lg:p-8 flex-1 min-w-0 w-full max-w-7xl mx-auto pb-[calc(5.5rem+env(safe-area-inset-bottom,1rem))] lg:pb-10">
          <IosInstallPrompt />
          {children}
        </main>
      </div>

      {/* 3. Fixed Mobile Bottom Navigation Bar (< lg) */}
      {!shouldHideBottomNav && (
        <MobileBottomNav
          onOpenMenu={() => setMobileMenuOpen(true)}
          isMenuOpen={mobileMenuOpen}
        />
      )}

      {/* 4. Mobile Menu Drawer / Sheet */}
      <MobileMenuSheet
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
    </div>
  );
}
