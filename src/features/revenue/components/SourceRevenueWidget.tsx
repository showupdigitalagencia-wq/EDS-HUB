// =============================================================================
// Source Revenue Widget
// =============================================================================

import React from 'react';
import { Share2, Download } from 'lucide-react';
import type { SourceRevenuePerformance } from '../../../types/database';
import { formatCurrency, formatTicket, formatRate } from '../services/revenue-service';
import { exportSourceRevenueCsv } from '../utils/revenue-export';

interface SourceRevenueWidgetProps {
  sources: SourceRevenuePerformance[];
  currency?: string;
  periodLabel?: string;
}

export const SourceRevenueWidget: React.FC<SourceRevenueWidgetProps> = ({
  sources,
  currency = 'USD',
  periodLabel = '30d',
}) => {
  const handleExport = () => {
    exportSourceRevenueCsv(sources, periodLabel);
  };

  const getSourceBadge = (src: string) => {
    switch (src) {
      case 'meta':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'google':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'form':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'manual':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'test':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
            <Share2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#08254f] font-heading">
              Receita & Conversão por Origem
            </h3>
            <p className="text-[11px] text-slate-500">
              Atribuição direta de canais de aquisição a matrículas e faturamento
            </p>
          </div>
        </div>

        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200/80 hover:bg-slate-50 shadow-2xs transition-all"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          Exportar CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f8fafc] text-slate-500 font-semibold border-b border-slate-200/80">
            <tr>
              <th className="py-3 px-4">Canal / Fonte Canônica</th>
              <th className="py-3 px-4 text-center">Total de Leads</th>
              <th className="py-3 px-4 text-center">Matrículas</th>
              <th className="py-3 px-4 text-center">Conversão</th>
              <th className="py-3 px-4 text-right">Booked Value</th>
              <th className="py-3 px-4 text-right">Receita Líquida</th>
              <th className="py-3 px-4 text-right">Ticket Médio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
            {sources.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                  Nenhum registro de canal de origem encontrado.
                </td>
              </tr>
            ) : (
              sources.map((s) => (
                <tr key={s.source} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold capitalize border ${getSourceBadge(
                        s.source
                      )}`}
                    >
                      {s.source}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                      {s.total_leads}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-[#125e95]/10 text-[#125e95]">
                      {s.confirmed_enrollments}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center font-bold text-slate-800">
                    {formatRate(s.conversion_rate)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-semibold text-slate-800">
                    {formatCurrency(s.booked_value, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-emerald-600">
                    {formatCurrency(s.net_revenue, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-extrabold text-[#08254f]">
                    {formatTicket(s.average_ticket, currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
