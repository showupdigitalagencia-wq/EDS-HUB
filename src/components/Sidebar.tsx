import { useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import {
  Kanban,
  Users,
  CheckSquare,
  LayoutDashboard,
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

interface NavGroup {
  label: string;
  isPrimary?: boolean;
  items: Array<{
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    testId?: string;
  }>;
}

const navigationGroups: NavGroup[] = [
  {
    label: 'OPERACIONAL',
    isPrimary: true,
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard, testId: 'nav-home' },
      { name: 'Contatos', href: '/leads', icon: Users, testId: 'nav-leads' },
      { name: 'Pipeline', href: '/pipeline', icon: Kanban, testId: 'nav-pipeline' },
      { name: 'Tarefas', href: '/work', icon: CheckSquare, testId: 'nav-work' },
      { name: 'Conversas', href: '/inbox', icon: Inbox, testId: 'nav-inbox' },
    ],
  },
  {
    label: 'CRESCIMENTO',
    items: [
      { name: 'Formulários', href: '/forms', icon: ClipboardList, testId: 'nav-forms' },
      { name: 'Automações', href: '/automations', icon: Workflow, testId: 'nav-automations' },
      { name: 'Cursos', href: '/courses/operations', icon: GraduationCap, testId: 'nav-courses' },
    ],
  },
  {
    label: 'SISTEMA',
    items: [
      { name: 'Templates', href: '/templates', icon: FileText, testId: 'nav-templates' },
      { name: 'Configurações', href: '/settings', icon: Settings, testId: 'nav-settings' },
    ],
  },
];

export interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const { appUser, signOut } = useAuth();
  const location = useLocation();

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen && onCloseMobile) {
        onCloseMobile();
      }
    },
    [mobileOpen, onCloseMobile]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [mobileOpen]);

  const handleNavClick = () => {
    if (mobileOpen && onCloseMobile) {
      onCloseMobile();
    }
  };

  const renderNavContent = (isMobile: boolean) => (
    <>
      {/* 1. Branded Sidebar Header Area with Prominent Official Logo */}
      <div className="px-6 py-5 border-b border-white/10 bg-[#061a38] flex items-center justify-between">
        <NavLink to="/" onClick={handleNavClick} className="flex flex-col gap-1.5 group block">
          <img
            src={edsLogo}
            alt="Expert Dental Solutions"
            className="h-9 sm:h-10 w-auto max-w-[180px] sm:max-w-[195px] object-contain transition-transform group-hover:scale-[1.02]"
          />
          <p className="text-[10px] tracking-wider uppercase font-semibold text-blue-200/60 font-heading pl-0.5">
            Expert Dental Solutions
          </p>
        </NavLink>
        {isMobile && onCloseMobile && (
          <button
            type="button"
            id="mobile-sidebar-close-btn"
            onClick={onCloseMobile}
            aria-label="Fechar menu lateral"
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 2. Grouped Navigation with Clear Hierarchy */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {navigationGroups.map((group) => {
          const isPrimary = Boolean(group.isPrimary);

          return (
            <div key={group.label} className="space-y-1">
              <p
                className={`px-3 text-[10px] font-bold uppercase tracking-wider ${
                  isPrimary ? 'text-blue-200/90 font-heading' : 'text-slate-400/60'
                }`}
              >
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
                    id={item.testId}
                    onClick={handleNavClick}
                    className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-all duration-150 ${
                      isActive
                        ? 'bg-white/14 text-white font-semibold shadow-xs'
                        : isPrimary
                        ? 'text-slate-200 hover:bg-white/8 hover:text-white font-medium'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    {/* Active Accent Indicator */}
                    {isActive && (
                      <span className="absolute left-0 inset-y-2 w-1 bg-[#8a1c1c] rounded-r-full" />
                    )}

                    <item.icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isActive
                          ? 'text-[#449bd5]'
                          : isPrimary
                          ? 'text-slate-300 group-hover:text-white'
                          : 'text-slate-500 group-hover:text-slate-300'
                      }`}
                    />
                    <span className="truncate">{item.name}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* 3. Elegant Sidebar Footer Area */}
      <div className="border-t border-white/10 p-3.5 bg-[#061a38]">
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
          id="sidebar-logout"
          type="button"
          onClick={() => {
            signOut();
            handleNavClick();
          }}
          className="flex items-center justify-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-[#8a1c1c]/20 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5 text-slate-400 group-hover:text-white" />
          <span>Sair</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar (visible only on >= lg, width ~240px) */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 bg-[#08254f] text-white flex-col z-30 shadow-xl border-r border-[#061a38]">
        {renderNavContent(false)}
      </aside>

      {/* Mobile Drawer Overlay (if opened via secondary drawer triggers) */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            id="mobile-sidebar-backdrop"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200"
            aria-hidden="true"
          />
          <aside
            id="mobile-sidebar-drawer"
            className="relative w-72 max-w-[85vw] bg-[#08254f] text-white flex flex-col z-50 shadow-2xl h-full"
          >
            {renderNavContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
