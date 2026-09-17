// =============================================================================
// Revenue KPIs Widget
// =============================================================================

import React from 'react';
import { DollarSign, CheckCircle2, TrendingUp, CreditCard, Scale, Clock } from 'lucide-react';
import type { RevenueKpis } from '../../../types/database';
import { formatCurrency, formatTicket } from '../services/revenue-service';

interface RevenueKpisWidgetProps {
  kpis: RevenueKpis;
  currency?: string;
}

export const RevenueKpisWidget: React.FC<RevenueKpisWidgetProps> = ({
  kpis,
  currency = 'USD',
}) => {
  const cards = [
    {
      title: 'Net Revenue (Receita Líquida)',
      value: formatCurrency(kpis.net_revenue, currency),
      subtitle: `Coletado: ${formatCurrency(kpis.collected_revenue, currency)} • Reembolsos: ${formatCurrency(kpis.refunded_amount, currency)}`,
      icon: DollarSign,
      iconBg: 'bg-emerald-50 text-emerald-600',
      borderAccent: 'border-emerald-200/80',
    },
    {
      title: 'Booked Value (Valor Acordado)',
      value: formatCurrency(kpis.booked_value, currency),
      subtitle: `${kpis.confirmed_enrollments_count} matrícula(s) confirmada(s)`,
      icon: Scale,
      iconBg: 'bg-[#08254f] text-[#449bd5]',
      borderAccent: 'border-slate-200/90',
    },
    {
      title: 'Matrículas Confirmadas',
      value: String(kpis.confirmed_enrollments_count),
      subtitle: `${kpis.paid_enrollments_count} com pagamento liquidado`,
      icon: CheckCircle2,
      iconBg: 'bg-[#125e95] text-white',
      borderAccent: 'border-slate-200/90',
    },
    {
      title: 'Ticket Médio por Matrícula',
      value: formatTicket(kpis.average_ticket, currency),
      subtitle: kpis.avg_collected_per_enrollment !== null
        ? `Média coletada: ${formatCurrency(kpis.avg_collected_per_enrollment, currency)}`
        : 'Sem pagamentos no período',
      icon: TrendingUp,
      iconBg: 'bg-amber-50 text-amber-600',
      borderAccent: 'border-amber-200/80',
    },
    {
      title: 'Outstanding Balance (Saldo a Receber)',
      value: formatCurrency(kpis.outstanding_balance, currency),
      subtitle: 'Contratos confirmados pendentes de quitação',
      icon: CreditCard,
      iconBg: 'bg-indigo-50 text-indigo-600',
      borderAccent: 'border-indigo-200/80',
    },
    {
      title: 'Tempo Médio de Conversão',
      value: kpis.avg_days_to_enrollment !== null ? `${kpis.avg_days_to_enrollment} dias` : 'No data',
      subtitle: 'Do primeiro contato até matrícula confirmada',
      icon: Clock,
      iconBg: 'bg-purple-50 text-purple-600',
      borderAccent: 'border-purple-200/80',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`bg-white rounded-2xl border ${card.borderAccent} p-5 shadow-xs flex flex-col justify-between transition-all hover:shadow-sm`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 font-heading">
                {card.title}
              </span>
              <div className={`p-2 rounded-xl ${card.iconBg} shadow-xs`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            <div>
              <div className="text-2xl font-extrabold text-[#08254f] font-heading tracking-tight mb-1">
                {card.value}
              </div>
              <div className="text-xs text-slate-500 truncate" title={card.subtitle}>
                {card.subtitle}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
