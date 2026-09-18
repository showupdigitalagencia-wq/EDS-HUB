import React from 'react';
import { Link } from 'react-router-dom';
import { Flame, Star, Download, ExternalLink } from 'lucide-react';
import type { DashboardPriorityLead } from '../../../types/database';

interface PriorityLeadsWidgetProps {
  leads: DashboardPriorityLead[];
  onExportCsv?: () => void;
}

export const PriorityLeadsWidget: React.FC<PriorityLeadsWidgetProps> = ({
  leads = [],
  onExportCsv,
}) => {
  const safeLeads = Array.isArray(leads) ? leads : [];
  const getBadgeColor = (category: string) => {
    switch (category) {
      case 'very_hot':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'hot':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'warm':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'cold':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      default:
        return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  const getBadgeLabel = (category: string) => {
    switch (category) {
      case 'very_hot':
        return 'Very Hot';
      case 'hot':
        return 'Hot';
      case 'warm':
        return 'Warm';
      case 'cold':
        return 'Cold';
      default:
        return 'Sem Score';
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-[#fdf2f2] text-[#8a1c1c] shadow-xs">
              <Star className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#08254f] font-heading">
                Leads Prioritários
              </h3>
              <p className="text-xs text-slate-500">
                Classificados por score comercial dinâmico
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              SNAPSHOT
            </span>
            {onExportCsv && (
              <button
                type="button"
                onClick={onExportCsv}
                className="flex items-center gap-1 text-xs font-semibold text-[#8a1c1c] hover:text-[#701414] transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            )}
          </div>
        </div>

        {safeLeads.length === 0 ? (
          <div className="py-12 text-center">
            <Flame className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-600">Nenhum lead com score calculado</p>
            <p className="text-xs text-slate-400 mt-1">Calcule scores nas configurações de Lead Scoring</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-2.5">Lead</th>
                  <th className="pb-2.5">Score</th>
                  <th className="pb-2.5">Estágio</th>
                  <th className="pb-2.5">Interesse</th>
                  <th className="pb-2.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/70">
                {safeLeads.map((lead) => {
                  const fullName =
                    [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                    lead.email ||
                    'Lead sem nome';

                  return (
                    <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3 pr-2">
                        <div className="font-semibold text-slate-900 group-hover:text-[#08254f] transition-colors">{fullName}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                          {lead.email || lead.phone_e164 || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[#08254f] text-sm font-heading">
                            {lead.lead_score ?? '—'}
                          </span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getBadgeColor(
                              lead.lead_score_category
                            )}`}
                          >
                            {getBadgeLabel(lead.lead_score_category)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-700">
                          {lead.stage_name}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-slate-600 max-w-[120px] truncate">
                        {lead.course_interest || '—'}
                      </td>
                      <td className="py-3 pl-2 text-right">
                        <Link
                          to={`/leads/${lead.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#08254f] hover:text-[#8a1c1c] font-semibold transition-colors"
                        >
                          Ver
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

      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
        <span>Exibindo os top {leads.length} leads prioritários</span>
        <Link to="/leads" className="text-[#08254f] hover:text-[#8a1c1c] font-semibold transition-colors">
          Ver todos os leads →
        </Link>
      </div>
    </div>
  );
};
