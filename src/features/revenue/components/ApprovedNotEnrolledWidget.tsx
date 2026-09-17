// =============================================================================
// Approved Not Enrolled Widget
// =============================================================================

import React from 'react';
import { UserCheck, Download, ExternalLink, Clock, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ApprovedNotEnrolledLead } from '../../../types/database';
import { exportApprovedNotEnrolledCsv } from '../utils/revenue-export';

interface ApprovedNotEnrolledWidgetProps {
  leads: ApprovedNotEnrolledLead[];
}

export const ApprovedNotEnrolledWidget: React.FC<ApprovedNotEnrolledWidgetProps> = ({
  leads,
}) => {
  const handleExport = () => {
    exportApprovedNotEnrolledCsv(leads);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-700 shadow-xs border border-amber-200/60">
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#08254f] font-heading flex items-center gap-2">
              Approved, Not Enrolled ({leads.length})
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                Oportunidades em Aberto
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Leads que atingiram o estágio de Aprovação mas ainda não concluíram matrícula
            </p>
          </div>
        </div>

        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200/80 hover:bg-slate-50 shadow-2xs transition-all"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          Exportar Fila
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f8fafc] text-slate-500 font-semibold border-b border-slate-200/80">
            <tr>
              <th className="py-3 px-4">Lead</th>
              <th className="py-3 px-4">Curso de Interesse</th>
              <th className="py-3 px-4 text-center">Score</th>
              <th className="py-3 px-4 text-center">Qualificação</th>
              <th className="py-3 px-4 text-center">Dias em Aprovação</th>
              <th className="py-3 px-4">Próxima Ação / Tarefa</th>
              <th className="py-3 px-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                  Nenhum lead aguardando matrícula no estágio de Aprovação. Fila zerada! 🎉
                </td>
              </tr>
            ) : (
              leads.map((l) => {
                const fullName = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead sem nome';
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4">
                      <Link
                        to={`/leads/${l.id}`}
                        className="font-bold text-[#08254f] hover:text-[#125e95] flex items-center gap-1.5 group"
                      >
                        {fullName}
                        <ExternalLink className="w-3 h-3 text-slate-300 group-hover:text-[#125e95]" />
                      </Link>
                      <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                        {l.email || l.phone_raw || 'Sem contato direto'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-800">
                      {l.course_interest || <span className="text-slate-400 italic">Não declarado</span>}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-[#08254f]/10 text-[#08254f]">
                        {l.lead_score ?? '—'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold capitalize bg-slate-100 text-slate-600">
                        {l.qualification_status?.replace(/_/g, ' ') || '—'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          l.days_in_approval > 14
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : l.days_in_approval > 7
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {l.days_in_approval}d
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 max-w-[200px] truncate">
                      {l.next_action || (
                        <span className="text-rose-500 text-[11px] font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Sem tarefa pendente
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/leads/${l.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#125e95] bg-[#e1f0fb] hover:bg-[#125e95] hover:text-white transition-all"
                      >
                        Matricular
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
