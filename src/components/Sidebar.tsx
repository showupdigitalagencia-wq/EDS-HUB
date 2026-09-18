import { useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import {
  LayoutDashboard,
  Users,
  Kanban,
  Mail,
  FileText,
  Settings,
  LogOut,
  ClipboardList,
  Workflow,
  GitFork,
  Inbox,
  Target,
  Activity,
  DollarSign,
  GraduationCap,
  Award,
  CheckSquare,
  BarChart3,
  X,
} from 'lucide-react';
import edsLogo from '../assets/eds-logo.png';

interface NavGroup {
  label: string;
  items: Array<{
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const navigationGroups: NavGroup[] = [
  {
    label: 'MAIN',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Work', href: '/work', icon: CheckSquare },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
      { name: 'Revenue', href: '/dashboard/revenue', icon: DollarSign },
      { name: 'Inbox', href: '/inbox', icon: Inbox },
      { name: 'Leads', href: '/leads', icon: Users },
      { name: 'Pipeline', href: '/pipeline', icon: Kanban },
    ],
  },
  {
    label: 'COURSES',
    items: [
      { name: 'Course Operations', href: '/courses/operations', icon: GraduationCap },
      { name: 'Post-Course & Alumni', href: '/courses/post-course', icon: Award },
    ],
  },
  {
    label: 'ENGAGEMENT',
    items: [
      { name: 'Forms', href: '/forms', icon: ClipboardList },
      { name: 'Automations', href: '/automations', icon: Workflow },
      { name: 'Sequences', href: '/sequences', icon: GitFork },
      { name: 'Campaigns', href: '/campaigns', icon: Mail },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { name: 'Templates', href: '/templates', icon: FileText },
      { name: 'Lead Scoring', href: '/scoring', icon: Target },
      { name: 'Foundation Status', href: '/foundation', icon: Activity },
      { name: 'Settings', href: '/settings', icon: Settings },
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

  // Close on Escape key press
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
      {/* Brand Header with Official Logo */}
      <div className="px-5 py-4 border-b border-white/10 bg-[#061e40] flex items-center justify-between">
        <NavLink to="/" onClick={handleNavClick} className="flex items-center gap-2 group block">
          <img
            src={edsLogo}
            alt="Expert Dental Solutions"
            className="h-8 sm:h-9 w-auto max-w-[170px] sm:max-w-[190px] object-contain transition-transform group-hover:scale-[1.02]"
          />
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

      {/* Navigation Groups */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {navigationGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 text-[10px] font-bold text-blue-200/60 uppercase tracking-widest">
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
                  id={`nav-${item.href.replace('/', '') || 'home'}`}
                  onClick={handleNavClick}
                  className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-white/12 text-white font-semibold shadow-xs'
                      : 'text-slate-300 hover:bg-white/6 hover:text-white'
                  }`}
                >
                  {/* Active Indicator Accent */}
                  {isActive && (
                    <span className="absolute left-0 inset-y-1.5 w-1 bg-[#8a1c1c] rounded-r-full" />
                  )}

                  <item.icon
                    className={`h-4 w-4 transition-colors ${
                      isActive ? 'text-[#449bd5]' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span>{item.name}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User Footer Profile */}
      <div className="border-t border-white/10 p-3 bg-[#061e40]">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/5 border border-white/5 mb-2">
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
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* 1. Desktop Fixed Sidebar (visible only on >= lg) */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-[#08254f] text-white flex-col z-30 shadow-xl border-r border-[#0d3368]">
        {renderNavContent(false)}
      </aside>

      {/* 2. Mobile Drawer & Backdrop Overlay (visible only on < lg when open) */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            id="mobile-sidebar-backdrop"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300"
            aria-hidden="true"
          />

          {/* Drawer */}
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
