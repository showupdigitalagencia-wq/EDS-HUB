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
  ShieldCheck,
  ClipboardList,
  Workflow,
  GitFork,
} from 'lucide-react';

const navigation = [
  { name: 'Foundation Status', href: '/', icon: LayoutDashboard },
  { name: 'Leads', href: '/leads', icon: Users },
  { name: 'Pipeline', href: '/pipeline', icon: Kanban },
  { name: 'Forms', href: '/forms', icon: ClipboardList },
  { name: 'Automations', href: '/automations', icon: Workflow },
  { name: 'Sequences', href: '/sequences', icon: GitFork },
  { name: 'Campaigns', href: '/campaigns', icon: Mail },
  { name: 'Templates', href: '/templates', icon: FileText },
  { name: 'System Setup', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const { appUser, signOut } = useAuth();
  const location = useLocation();

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200 flex flex-col z-20">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-base font-bold text-gray-900 tracking-tight">EDS HUB</span>
          <p className="text-[10px] text-gray-400 leading-tight -mt-0.5">Deliverability CRM</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <NavLink
              key={item.href}
              to={item.href}
              id={`nav-${item.href.replace('/', '') || 'home'}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-brand-50 text-brand-700 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon className={`h-[18px] w-[18px] ${isActive ? 'text-brand-600' : 'text-gray-400'}`} />
              {item.name}
            </NavLink>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 px-4 py-4">
        <div className="flex items-center gap-3 mb-3 px-2">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700">
            {appUser?.display_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {appUser?.display_name || 'User'}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {appUser?.email || ''}
            </p>
          </div>
        </div>
        <button
          id="sidebar-logout"
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
