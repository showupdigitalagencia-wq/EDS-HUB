import { useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import {
  Inbox,
  ClipboardList,
  Workflow,
  GraduationCap,
  FileText,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import edsLogo from '../assets/eds-logo.png';

interface MobileMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SecondaryNavGroup {
  label: string;
  items: Array<{
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const secondaryGroups: SecondaryNavGroup[] = [
  {
    label: 'COMUNICAÇÃO & CRESCIMENTO',
    items: [
      { name: 'Conversas', href: '/inbox', icon: Inbox },
      { name: 'Formulários', href: '/forms', icon: ClipboardList },
      { name: 'Automações', href: '/automations', icon: Workflow },
      { name: 'Cursos', href: '/courses/operations', icon: GraduationCap },
    ],
  },
  {
    label: 'SISTEMA',
    items: [
      { name: 'Templates', href: '/templates', icon: FileText },
      { name: 'Configurações', href: '/settings', icon: Settings },
    ],
  },
];

export function MobileMenuSheet({ isOpen, onClose }: MobileMenuSheetProps) {
  const { appUser, signOut } = useAuth();
  const location = useLocation();

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        id="mobile-menu-backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200"
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        id="mobile-menu-drawer"
        role="dialog"
        aria-label="Menu secundário"
        aria-modal="true"
        className="relative ml-auto w-80 max-w-[85vw] bg-[#08254f] text-white flex flex-col z-50 shadow-2xl h-full animate-in slide-in-from-right duration-200"
      >
        {/* Header with Official Logo & Close */}
        <div
          className="px-5 py-4 border-b border-white/10 bg-[#061a38] flex items-center justify-between"
          style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top, 0px) + 0.75rem))' }}
        >
          <img
            src={edsLogo}
            alt="Expert Dental Solutions"
            className="h-8 w-auto max-w-[150px] object-contain"
          />
          <button
            type="button"
            id="mobile-menu-close-btn"
            onClick={onClose}
            aria-label="Fechar menu"
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Navigation Groups */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {secondaryGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 text-[10px] font-bold text-blue-200/60 uppercase tracking-wider">
                {group.label}
              </p>
              {group.items.map((item) => {
                const isActive =
                  item.href === '/'
                    ? location.pathname === '/' || location.pathname === '/dashboard'
                    : location.pathname.startsWith(item.href);

                return (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    id={`menu-item-${item.href.replace('/', '') || 'home'}`}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-white/12 text-white font-semibold shadow-xs'
                        : 'text-slate-300 hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    <item.icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-[#449bd5]' : 'text-slate-400'
                      }`}
                    />
                    <span>{item.name}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer Profile & Logout */}
        <div
          className="border-t border-white/10 p-3 bg-[#061a38]"
          style={{ paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem))' }}
        >
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/5 border border-white/5 mb-2">
            <div className="w-8 h-8 rounded-full bg-[#449bd5] text-white flex items-center justify-center text-xs font-bold shadow-xs">
              {appUser?.display_name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate font-heading">
                {appUser?.display_name || 'Administrator'}
              </p>
              <p className="text-[10px] text-slate-300 truncate">
                {appUser?.email || ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            id="mobile-menu-logout"
            onClick={() => {
              signOut();
              onClose();
            }}
            className="flex items-center justify-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-[#8a1c1c]/20 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5 text-slate-400" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </div>
  );
}
