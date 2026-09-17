// =============================================================================
// Commercial Goals Widget
// =============================================================================

import React from 'react';
import { Target, ArrowUpRight } from 'lucide-react';
import type { RevenueGoals, RevenueKpis } from '../../../types/database';
import { formatCurrency } from '../services/revenue-service';
import { Link } from 'react-router-dom';

interface CommercialGoalsWidgetProps {
  goals: RevenueGoals;
  kpis: RevenueKpis;
}

export const CommercialGoalsWidget: React.FC<CommercialGoalsWidgetProps> = ({
  goals,
  kpis,
}) => {
  const currency = goals.default_currency || 'USD';
  const revTarget = goals.monthly_net_revenue_target || 50000;
  const enrTarget = goals.monthly_enrollment_target || 10;

  const revProgress = Math.min(Math.round((kpis.net_revenue / revTarget) * 100), 999);
  const enrProgress = Math.min(Math.round((kpis.confirmed_enrollments_count / enrTarget) * 100), 999);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#08254f] font-heading">
              Metas Comerciais do Mês
            </h3>
            <p className="text-xs text-slate-500">
              Acompanhamento de receita líquida e novas matrículas
            </p>
          </div>
        </div>

        <Link
          to="/settings?tab=commercial"
          className="text-xs font-semibold text-[#125e95] hover:text-[#08254f] flex items-center gap-1 transition-colors"
        >
          Configurar Metas
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Grid of Two Goals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Revenue Goal */}
        <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Meta de Receita Líquida
            </span>
            <span className="text-xs font-extrabold text-[#125e95]">
              {revProgress}% atingida
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-xl font-extrabold text-[#08254f] font-heading">
              {formatCurrency(kpis.net_revenue, currency)}
            </div>
            <div className="text-xs text-slate-500">
              Meta: <span className="font-semibold text-slate-700">{formatCurrency(revTarget, currency)}</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                revProgress >= 100 ? 'bg-emerald-500' : 'bg-[#125e95]'
              }`}
              style={{ width: `${Math.min(revProgress, 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {kpis.net_revenue >= revTarget
                ? '🎉 Meta mensal superada!'
                : `Faltam ${formatCurrency(Math.max(revTarget - kpis.net_revenue, 0), currency)}`}
            </span>
            <span>Ref: Mês Atual</span>
          </div>
        </div>

        {/* 2. Enrollment Goal */}
        <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Meta de Matrículas Confirmadas
            </span>
            <span className="text-xs font-extrabold text-[#125e95]">
              {enrProgress}% atingida
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-xl font-extrabold text-[#08254f] font-heading">
              {kpis.confirmed_enrollments_count} <span className="text-xs font-medium text-slate-500">alunos</span>
            </div>
            <div className="text-xs text-slate-500">
              Meta: <span className="font-semibold text-slate-700">{enrTarget} alunos</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                enrProgress >= 100 ? 'bg-emerald-500' : 'bg-[#449bd5]'
              }`}
              style={{ width: `${Math.min(enrProgress, 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {kpis.confirmed_enrollments_count >= enrTarget
                ? '🏆 Meta de alunos alcançada!'
                : `Faltam ${Math.max(enrTarget - kpis.confirmed_enrollments_count, 0)} matrícula(s)`}
            </span>
            <span>Ref: Mês Atual</span>
          </div>
        </div>
      </div>
    </div>
  );
};
