import { type ReactNode } from 'react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  variant?: 'pills' | 'underline';
  className?: string;
}

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  variant = 'pills',
  className = '',
}: TabsProps<T>) {
  if (variant === 'underline') {
    return (
      <div className={`flex border-b border-slate-200 gap-6 ${className}`}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 py-3 px-1 text-xs sm:text-sm font-semibold border-b-2 font-heading transition-all duration-150 cursor-pointer ${
                isActive
                  ? 'border-[#08254f] text-[#08254f]'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                    isActive
                      ? 'bg-[#08254f]/10 text-[#08254f]'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Default 'pills' segmented control style
  return (
    <div
      className={`inline-flex p-1 bg-slate-100/90 rounded-xl border border-slate-200/60 gap-1 overflow-x-auto scrollbar-none ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold font-heading transition-all duration-150 whitespace-nowrap cursor-pointer select-none ${
              isActive
                ? 'bg-white text-[#08254f] shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  isActive
                    ? 'bg-[#08254f]/10 text-[#08254f]'
                    : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
