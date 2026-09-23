import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSafeBackNavigation } from '../hooks/useSafeBackNavigation';
import { useAuth } from '../features/auth/AuthProvider';
import edsLogo from '../assets/eds-logo.png';

export interface MobileHeaderProps {
  title?: string;
  subtitle?: string;
  backTo?: string;
  onBack?: () => void;
  actions?: ReactNode;
  showLogo?: boolean;
}

export function MobileHeader({
  title,
  subtitle,
  backTo,
  onBack,
  actions,
  showLogo = true,
}: MobileHeaderProps) {
  const { appUser } = useAuth();
  const safeBack = useSafeBackNavigation(backTo || '/');

  const handleBackClick = () => {
    if (onBack) {
      onBack();
    } else if (backTo) {
      safeBack();
    }
  };

  const hasBack = Boolean(backTo || onBack);

  return (
    <header className="lg:hidden sticky top-0 z-30 bg-white/98 backdrop-blur-md border-b border-slate-200/80 px-3.5 py-2.5 flex items-center justify-between min-h-[56px] shadow-2xs">
      {/* Left side: Back button or Logo */}
      <div className="flex items-center gap-2 min-w-0">
        {hasBack ? (
          <button
            type="button"
            onClick={handleBackClick}
            aria-label="Voltar"
            className="flex items-center gap-1.5 min-h-[44px] min-w-[44px] -ml-2 px-2 text-slate-700 hover:text-[#08254f] active:text-[#08254f] hover:bg-slate-100 rounded-xl transition-colors cursor-pointer select-none"
          >
            <ArrowLeft className="h-5 w-5 shrink-0 text-[#08254f]" />
            <span className="text-xs font-semibold font-heading">Voltar</span>
          </button>
        ) : showLogo ? (
          <NavLink to="/" className="flex items-center gap-2">
            <img
              src={edsLogo}
              alt="Expert Dental Solutions"
              className="h-7 w-auto max-w-[130px] object-contain"
            />
          </NavLink>
        ) : null}

        {/* Center/Title when Back button is present */}
        {hasBack && title && (
          <div className="min-w-0 pl-1">
            <h1 className="text-sm font-bold text-[#08254f] truncate font-heading tracking-tight leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-slate-500 truncate leading-none mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right side: Actions (on secondary screens with Back) or User avatar */}
      <div className="flex items-center gap-2 shrink-0">
        {hasBack && actions}
        {!hasBack && (
          <div className="w-7 h-7 rounded-full bg-[#08254f] text-white flex items-center justify-center text-xs font-bold shadow-xs">
            {appUser?.display_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
        )}
      </div>
    </header>
  );
}
