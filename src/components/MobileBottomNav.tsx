import { NavLink, useLocation } from 'react-router-dom';
import { Home, Users, Kanban, CheckSquare, Menu } from 'lucide-react';

interface MobileBottomNavProps {
  onOpenMenu: () => void;
  isMenuOpen?: boolean;
}

/**
 * Mobile Bottom Navigation Bar (Fixed to bottom, safe-area aware)
 * Exact items in exact order:
 * 1. Início (/) - Opens Dashboard
 * 2. Contatos (/leads)
 * 3. Pipeline (/pipeline)
 * 4. Tarefas (/work)
 * 5. Menu (Triggers slide-over sheet)
 */
export function MobileBottomNav({ onOpenMenu, isMenuOpen = false }: MobileBottomNavProps) {
  const location = useLocation();

  const isHomeActive = location.pathname === '/' || location.pathname === '/dashboard';
  const isContactsActive = location.pathname.startsWith('/leads');
  const isPipelineActive = location.pathname.startsWith('/pipeline');
  const isTasksActive = location.pathname.startsWith('/work') || location.pathname.startsWith('/tasks');

  return (
    <nav
      id="mobile-bottom-nav"
      aria-label="Navegação móvel principal"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_16px_rgba(8,37,79,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="grid grid-cols-5 h-16 items-center px-1 max-w-lg mx-auto">
        {/* 1. Início */}
        <NavLink
          to="/"
          id="mobile-nav-home"
          className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition-all duration-150 ${
            isHomeActive
              ? 'text-[#08254f] font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isHomeActive ? 'bg-[#08254f]/10 text-[#08254f]' : ''
            }`}
          >
            <Home className="h-5 w-5" />
          </div>
          <span className="text-[11px] tracking-tight mt-0.5">Início</span>
        </NavLink>

        {/* 2. Contatos */}
        <NavLink
          to="/leads"
          id="mobile-nav-contacts"
          className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition-all duration-150 ${
            isContactsActive
              ? 'text-[#08254f] font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isContactsActive ? 'bg-[#08254f]/10 text-[#08254f]' : ''
            }`}
          >
            <Users className="h-5 w-5" />
          </div>
          <span className="text-[11px] tracking-tight mt-0.5">Contatos</span>
        </NavLink>

        {/* 2. Pipeline */}
        <NavLink
          to="/pipeline"
          id="mobile-nav-pipeline"
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all duration-150 ${
            isPipelineActive
              ? 'text-[#08254f] font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isPipelineActive ? 'bg-[#08254f]/10 text-[#08254f]' : ''
            }`}
          >
            <Kanban className="h-5 w-5" />
          </div>
          <span className="text-[11px] tracking-tight mt-0.5">Pipeline</span>
        </NavLink>

        {/* 3. Tarefas */}
        <NavLink
          to="/work"
          id="mobile-nav-tasks"
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all duration-150 ${
            isTasksActive
              ? 'text-[#08254f] font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isTasksActive ? 'bg-[#08254f]/10 text-[#08254f]' : ''
            }`}
          >
            <CheckSquare className="h-5 w-5" />
          </div>
          <span className="text-[11px] tracking-tight mt-0.5">Tarefas</span>
        </NavLink>

        {/* 4. Menu (Opens Secondary Drawer) */}
        <button
          type="button"
          id="mobile-nav-menu"
          onClick={onOpenMenu}
          aria-expanded={isMenuOpen}
          aria-label="Abrir menu secundário"
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all duration-150 cursor-pointer ${
            isMenuOpen
              ? 'text-[#08254f] font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isMenuOpen ? 'bg-[#08254f]/10 text-[#08254f]' : ''
            }`}
          >
            <Menu className="h-5 w-5" />
          </div>
          <span className="text-[11px] tracking-tight mt-0.5">Menu</span>
        </button>
      </div>
    </nav>
  );
}
