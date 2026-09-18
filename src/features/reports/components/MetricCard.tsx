
import { ArrowUpRight, ArrowDownRight, Minus, Info } from 'lucide-react';
import type { MetricComparison, MetricType } from '../types/reporting';

interface MetricCardProps {
  title: string;
  metric?: MetricComparison<number> | null;
  formattedValue?: string;
  subtitle?: string;
  tooltip?: string;
  isCurrency?: boolean;
  isPercent?: boolean;
}

export function MetricCard({
  title,
  metric,
  formattedValue,
  subtitle,
  tooltip,
  isCurrency = false,
  isPercent = false,
}: MetricCardProps) {
  const current = metric?.current ?? null;
  const changePct = metric?.percent_change ?? null;
  const status = metric?.comparison_status;
  const type: MetricType = metric?.type ?? 'period';

  const formatDisplay = (val: number | null): string => {
    if (val === null || val === undefined) return 'No data';
    if (isCurrency) {
      return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (isPercent) {
      return `${val.toFixed(1)}%`;
    }
    return val.toLocaleString('en-US');
  };

  const displayValue = formattedValue ?? formatDisplay(current);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {title}
            </span>
            {tooltip && (
              <div className="relative group cursor-help">
                <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-48 p-2 bg-slate-900 text-white text-[11px] leading-tight rounded-md shadow-lg z-20 pointer-events-none">
                  {tooltip}
                </div>
              </div>
            )}
          </div>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              type === 'period'
                ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                : type === 'cohort'
                ? 'bg-purple-50 text-purple-700 border border-purple-200/60'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            {type}
          </span>
        </div>

        <div className="text-2xl font-bold text-[#08254f] tracking-tight">
          {displayValue}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
        {status && status !== 'not_applicable' ? (
          <div className="flex items-center gap-1">
            {status === 'positive' && (
              <span className="inline-flex items-center text-emerald-600 font-medium">
                <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                +{changePct}%
              </span>
            )}
            {status === 'negative' && (
              <span className="inline-flex items-center text-rose-600 font-medium">
                <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                {changePct}%
              </span>
            )}
            {status === 'neutral' && (
              <span className="inline-flex items-center text-slate-500 font-medium">
                <Minus className="w-3.5 h-3.5 mr-0.5" />
                0.0%
              </span>
            )}
            {status === 'new' && (
              <span className="inline-flex items-center text-blue-600 font-medium bg-blue-50 px-1.5 py-0.5 rounded text-[11px]">
                New in period
              </span>
            )}
            {status === 'no_comparison' && (
              <span className="text-slate-400">No prior activity</span>
            )}
            <span className="text-slate-400 text-[11px] ml-1">vs prev</span>
          </div>
        ) : (
          <span className="text-slate-400 text-[11px]">
            {subtitle || (type === 'snapshot' ? 'Current status' : 'Period metric')}
          </span>
        )}
      </div>
    </div>
  );
}
