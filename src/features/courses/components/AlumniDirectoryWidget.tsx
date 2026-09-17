import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  Search,
  ArrowRight,
  Mail,
  Phone,
  MessageSquare,
} from 'lucide-react';
import type { AlumniDirectoryItem } from '../../../types/database';
import { formatCurrency } from '../../revenue/services/revenue-service';

interface AlumniDirectoryWidgetProps {
  items: AlumniDirectoryItem[];
}

export const AlumniDirectoryWidget: React.FC<AlumniDirectoryWidgetProps> = ({ items }) => {
  const [search, setSearch] = useState('');
  const [repeatOnly, setRepeatOnly] = useState(false);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.student_name.toLowerCase().includes(search.toLowerCase()) ||
        (item.student_email && item.student_email.toLowerCase().includes(search.toLowerCase())) ||
        (item.current_interest && item.current_interest.toLowerCase().includes(search.toLowerCase()));

      if (!matchesSearch) return false;
      if (repeatOnly && !item.is_repeat_student) return false;
      return true;
    });
  }, [items, search, repeatOnly]);

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
            <Award className="w-4 h-4 text-[#08254f]" />
            Diretório de Alumni EDS
          </h3>
          <p className="text-xs text-slate-500">
            Cirurgiões-dentistas formados e integrados à comunidade Alumni de relacionamento contínuo
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar alumni..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#125e95] w-48 sm:w-56"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer bg-white px-2.5 py-1.5 border border-slate-200 rounded-lg">
            <input
              type="checkbox"
              checked={repeatOnly}
              onChange={(e) => setRepeatOnly(e.target.checked)}
              className="rounded border-slate-300 text-[#125e95] focus:ring-[#125e95]"
            />
            <span>Apenas Repeat</span>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f8fafc] text-slate-500 font-semibold border-b border-slate-200/80">
            <tr>
              <th className="py-2.5 px-4">Alumni</th>
              <th className="py-2.5 px-3">Cursos Confirmados</th>
              <th className="py-2.5 px-3">Investimento Total</th>
              <th className="py-2.5 px-3">Última Conclusão</th>
              <th className="py-2.5 px-3">Interesse Atual</th>
              <th className="py-2.5 px-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  Nenhum registro de Alumni encontrado.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.lead_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/leads/${item.lead_id}`}
                        className="font-bold text-slate-800 hover:text-[#125e95] transition-colors"
                      >
                        {item.student_name}
                      </Link>
                      {getContactIcon(item.contact_preference)}
                      {item.is_repeat_student && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">
                          Repeat
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {item.student_email || item.student_phone || '—'}
                    </div>
                  </td>

                  <td className="py-3 px-3 font-semibold text-slate-700">
                    {item.confirmed_enrollments_count} matrícula(s)
                  </td>

                  <td className="py-3 px-3 font-bold text-emerald-700">
                    {formatCurrency(item.total_spend, 'USD')}
                  </td>

                  <td className="py-3 px-3 text-slate-600">
                    {item.last_completed_date ? item.last_completed_date.slice(0, 10) : '—'}
                  </td>

                  <td className="py-3 px-3 text-slate-600">
                    {item.current_interest ? (
                      <span className="font-medium text-slate-700">{item.current_interest}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/leads/${item.lead_id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-[#125e95] bg-[#e1f0fb] hover:bg-[#125e95] hover:text-white transition-all"
                    >
                      Perfil
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
