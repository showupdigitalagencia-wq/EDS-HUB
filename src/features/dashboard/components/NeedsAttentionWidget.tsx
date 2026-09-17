import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, ExternalLink } from 'lucide-react';
import type { DashboardNeedsAttentionItem } from '../../../types/database';

interface NeedsAttentionWidgetProps {
  items: DashboardNeedsAttentionItem[];
  onExportCsv?: () => void;
}

export const NeedsAttentionWidget: React.FC<NeedsAttentionWidgetProps> = ({
  items,
  onExportCsv,
}) => {
  const getReasonBadge = (code: string) => {
    switch (code) {
      case 'HIGH_SCORE_NO_NEXT_ACTION':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'OVERDUE_TASK':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'FAILED_AUTOMATION':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'FAILED_INBOUND':
        return 'bg-pink-100 text-pink-800 border-pink-200';
      case 'UNREAD_CONVERSATION':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'NO_RESPONSE_STALE':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Precisam de Atenção
              </h3>
              <p className="text-xs text-gray-500">
                Gargalos operacionais e tarefas pendentes no CRM
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              SNAPSHOT
            </span>
            {onExportCsv && (
              <button
                type="button"
                onClick={onExportCsv}
                className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">Tudo em dia!</p>
            <p className="text-xs text-gray-400 mt-1">
              Nenhum lead com tarefas atrasadas, falhas ou ações pendentes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wider font-semibold">
                  <th className="pb-2">Lead</th>
                  <th className="pb-2">Motivo</th>
                  <th className="pb-2">Detalhes</th>
                  <th className="pb-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item, idx) => (
                  <tr key={`${item.lead_id}-${item.reason_code}-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 pr-2">
                      <div className="font-semibold text-gray-900">{item.lead_name}</div>
                      <div className="text-[11px] text-gray-400 truncate max-w-[140px]">
                        {item.lead_email || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${getReasonBadge(
                          item.reason_code
                        )}`}
                        title={item.reason_code}
                      >
                        {item.reason_label}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-gray-600 max-w-[180px] truncate" title={item.detail}>
                      {item.detail}
                    </td>
                    <td className="py-3 pl-2 text-right">
                      <Link
                        to={`/leads/${item.lead_id}`}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Resolver
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>{items.length} itens requerendo intervenção</span>
        <span className="text-[11px]">Critérios determinísticos server-side</span>
      </div>
    </div>
  );
};
