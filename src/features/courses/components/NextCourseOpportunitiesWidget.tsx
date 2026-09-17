import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Search,
  Mail,
  Phone,
  MessageSquare,
  PlusCircle,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import type { NextCourseOpportunityItem } from '../../../types/database';
import { formatCurrency } from '../../revenue/services/revenue-service';

interface NextCourseOpportunitiesWidgetProps {
  items: NextCourseOpportunityItem[];
  onOpenRecordInterestModal?: () => void;
}

export const NextCourseOpportunitiesWidget: React.FC<NextCourseOpportunitiesWidgetProps> = ({
  items,
  onOpenRecordInterestModal,
}) => {
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      return (
        item.student_name.toLowerCase().includes(search.toLowerCase()) ||
        item.target_course_name.toLowerCase().includes(search.toLowerCase()) ||
        (item.completed_course_name &&
          item.completed_course_name.toLowerCase().includes(search.toLowerCase()))
      );
    });
  }, [items, search]);

  const getContactIcon = (pref: string) => {
    switch (pref) {
      case 'sms':
        return (
          <span title="Preferência: SMS">
            <MessageSquare className="w-3 h-3 text-purple-600" />
          </span>
        );
      case 'call':
        return (
          <span title="Preferência: Ligação">
            <Phone className="w-3 h-3 text-amber-600" />
          </span>
        );
      default:
        return (
          <span title="Preferência: E-mail">
            <Mail className="w-3 h-3 text-blue-600" />
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
      {/* Header & Controls */}
      <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
        <div>
          <h3 className="text-sm font-bold text-slate-800 font-heading flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            Oportunidades Comerciais de Próximo Curso
          </h3>
          <p className="text-xs text-slate-500">
            Alunos que concluíram um curso e expressaram interesse explícito em novos programas da EDS
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar aluno ou curso..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#125e95] w-48 sm:w-56"
            />
          </div>

          {onOpenRecordInterestModal && (
            <button
              onClick={onOpenRecordInterestModal}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-xs"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Novo Interesse
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f8fafc] text-slate-500 font-semibold border-b border-slate-200/80">
            <tr>
              <th className="py-2.5 px-4">Aluno</th>
              <th className="py-2.5 px-3">Curso Anterior</th>
              <th className="py-2.5 px-3">Interesse Futuro</th>
              <th className="py-2.5 px-3">Valor Sugerido</th>
              <th className="py-2.5 px-3">Origem & Data</th>
              <th className="py-2.5 px-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  Nenhuma oportunidade de próximo curso aberta no momento.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.interest_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`/leads/${item.lead_id}`}
                        className="font-bold text-slate-800 hover:text-[#125e95] transition-colors"
                      >
                        {item.student_name}
                      </Link>
                      {getContactIcon(item.contact_preference)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                      {item.student_email || item.student_phone || '—'}
                    </div>
                  </td>

                  <td className="py-3 px-3 text-slate-600 font-medium">
                    {item.completed_course_name || '—'}
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-bold text-emerald-800 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                      {item.target_course_name}
                    </div>
                    {item.notes && (
                      <p className="text-[11px] text-slate-500 line-clamp-1 italic">
                        "{item.notes}"
                      </p>
                    )}
                  </td>

                  <td className="py-3 px-3 font-semibold text-slate-700">
                    {item.default_price != null ? formatCurrency(item.default_price, 'USD') : '—'}
                  </td>

                  <td className="py-3 px-3">
                    <span className="capitalize text-slate-700 font-semibold text-[11px]">
                      {item.source}
                    </span>
                    <div className="text-[10px] text-slate-400">
                      {item.created_at ? item.created_at.slice(0, 10) : ''}
                    </div>
                  </td>

                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/leads/${item.lead_id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-[#125e95] bg-[#e1f0fb] hover:bg-[#125e95] hover:text-white transition-all"
                    >
                      Abrir Lead
                      <ArrowRight className="w-3 h-3" />
                    </Link>
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
