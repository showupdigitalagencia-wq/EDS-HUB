// =============================================================================
// Course Revenue Widget
// =============================================================================

import React from 'react';
import { BookOpen, Download } from 'lucide-react';
import type { CourseRevenuePerformance } from '../../../types/database';
import { formatCurrency, formatTicket } from '../services/revenue-service';
import { exportCourseRevenueCsv } from '../utils/revenue-export';

interface CourseRevenueWidgetProps {
  courses: CourseRevenuePerformance[];
  currency?: string;
  periodLabel?: string;
}

export const CourseRevenueWidget: React.FC<CourseRevenueWidgetProps> = ({
  courses,
  periodLabel = '30d',
}) => {
  const handleExport = () => {
    exportCourseRevenueCsv(courses, periodLabel);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#08254f] font-heading">
              Performance Financeira por Curso
            </h3>
            <p className="text-[11px] text-slate-500">
              Desempenho de vendas, receita líquida e ticket médio por programa oficial
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
              <th className="py-3 px-4">Curso Oficial</th>
              <th className="py-3 px-4 text-center">Preço Base</th>
              <th className="py-3 px-4 text-center">Interessados</th>
              <th className="py-3 px-4 text-center">Matrículas</th>
              <th className="py-3 px-4 text-right">Booked Value</th>
              <th className="py-3 px-4 text-right">Receita Líquida</th>
              <th className="py-3 px-4 text-right">Saldo a Receber</th>
              <th className="py-3 px-4 text-right">Ticket Médio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
            {courses.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                  Nenhum curso cadastrado no catálogo.
                </td>
              </tr>
            ) : (
              courses.map((c) => (
                <tr key={c.course_id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-[#08254f] font-heading">{c.course_name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{c.course_code}</div>
                  </td>
                  <td className="py-3.5 px-4 text-center text-slate-600">
                    {c.default_price !== null ? formatCurrency(c.default_price, c.currency) : 'N/A'}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                      {c.interested_leads_count}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-[#125e95]/10 text-[#125e95]">
                      {c.confirmed_enrollments_count}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-semibold text-slate-800">
                    {formatCurrency(c.booked_value, c.currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-emerald-600">
                    {formatCurrency(c.net_revenue, c.currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right text-amber-600 font-semibold">
                    {formatCurrency(c.outstanding_balance, c.currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-extrabold text-[#08254f]">
                    {formatTicket(c.average_ticket, c.currency)}
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
