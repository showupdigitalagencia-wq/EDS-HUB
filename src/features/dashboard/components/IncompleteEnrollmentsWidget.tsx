import React from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, ExternalLink, CheckCircle2 } from 'lucide-react';
import type { PendingIncompleteEnrollmentItem } from '../../leads/services/incomplete-enrollment-service';

interface IncompleteEnrollmentsWidgetProps {
  items: PendingIncompleteEnrollmentItem[];
  loading?: boolean;
}

export const IncompleteEnrollmentsWidget: React.FC<IncompleteEnrollmentsWidgetProps> = ({
  items = [],
  loading = false,
}) => {
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <div
      id="incomplete-enrollments-widget"
      className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between"
    >
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-[#e1f0fb] text-[#125e95] shadow-xs">
              <FileCheck2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#08254f] font-heading">
                Inscrições Não Concluídas
              </h3>
              <p className="text-xs text-slate-500">
                Tentativas de inscrição pendentes de acompanhamento comercial
              </p>
            </div>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            OPERAÇÃO
          </span>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3 py-4 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded-xl" />
            ))}
          </div>
        ) : safeItems.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">Tudo em dia!</p>
            <p className="text-xs text-slate-400 mt-1">
              Nenhuma inscrição pendente de acompanhamento.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-2.5">Lead</th>
                  <th className="pb-2.5">Curso / Turma</th>
                  <th className="pb-2.5">Data</th>
                  <th className="pb-2.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/70">
                {safeItems.map((item) => {
                  const leadName = item.lead
                    ? `${item.lead.first_name || ''} ${item.lead.last_name || ''}`.trim() || 'Lead sem nome'
                    : 'Lead sem identificação';
                  const courseName = item.course?.name || item.course?.code || 'Curso de Odontologia';
                  const formattedDate = item.created_at
                    ? new Date(item.created_at).toLocaleDateString('pt-BR')
                    : '—';

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3 pr-2">
                        <div className="font-semibold text-slate-900 group-hover:text-[#08254f] transition-colors">
                          {leadName}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[150px]">
                          {item.lead?.email || item.lead?.phone_e164 || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <span className="font-medium text-slate-700 block truncate max-w-[180px]">
                          {courseName}
                        </span>
                        {item.course_session?.title && (
                          <span className="text-[10px] text-slate-400 block truncate max-w-[180px]">
                            {item.course_session.title}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-slate-500 whitespace-nowrap">
                        {formattedDate}
                      </td>
                      <td className="py-3 pl-2 text-right">
                        <Link
                          to={`/leads/${item.lead_id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#08254f] hover:text-[#8a1c1c] font-semibold transition-colors"
                        >
                          Resolver
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
        <span>{safeItems.length} {safeItems.length === 1 ? 'caso pendente' : 'casos pendentes'}</span>
        <Link
          to="/leads"
          className="text-[11px] text-[#08254f] hover:text-[#449bd5] font-semibold"
        >
          Ver todos os leads
        </Link>
      </div>
    </div>
  );
};
