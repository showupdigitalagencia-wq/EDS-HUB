import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  Search,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Phone,
  MessageSquare,
} from 'lucide-react';
import type { PostCourseFollowupQueueItem, PostCourseFollowupStatus } from '../../../types/database';

interface FollowUpQueueWidgetProps {
  items: PostCourseFollowupQueueItem[];
  onOpenEngagementModal: (engagementId: string, initialMode: 'followup' | 'feedback' | 'testimonial' | 'interest') => void;
}

export const FollowUpQueueWidget: React.FC<FollowUpQueueWidgetProps> = ({
  items,
  onOpenEngagementModal,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PostCourseFollowupStatus | 'overdue'>('all');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.student_name.toLowerCase().includes(search.toLowerCase()) ||
        item.course_name.toLowerCase().includes(search.toLowerCase()) ||
        (item.session_code && item.session_code.toLowerCase().includes(search.toLowerCase()));

      if (!matchesSearch) return false;

      if (statusFilter === 'all') return true;
      if (statusFilter === 'overdue') return item.is_overdue && item.followup_status === 'pending';
      return item.followup_status === statusFilter;
    });
  }, [items, search, statusFilter]);

  const getStatusBadge = (status: PostCourseFollowupStatus, isOverdue: boolean) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          Concluído
        </span>
      );
    }
    if (status === 'in_progress') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Clock className="w-3 h-3" />
          Em Andamento
        </span>
      );
    }
    if (status === 'skipped') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          Dispensado
        </span>
      );
    }
    if (isOverdue) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
          <AlertTriangle className="w-3 h-3" />
          Atrasado
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="w-3 h-3" />
        Pendente
      </span>
    );
  };

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
          <h3 className="text-sm font-bold text-slate-800 font-heading">
            Fila de Acompanhamento Pós-Curso
          </h3>
          <p className="text-xs text-slate-500">
            {filteredItems.length} contato(s) para follow-up de satisfação e relacionamento
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
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

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#125e95] text-slate-700 font-medium"
          >
            <option value="all">Todos os Status</option>
            <option value="pending">Pendentes</option>
            <option value="overdue">Apenas Atrasados</option>
            <option value="in_progress">Em Andamento</option>
            <option value="completed">Concluídos</option>
            <option value="skipped">Dispensados</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f8fafc] text-slate-500 font-semibold border-b border-slate-200/80">
            <tr>
              <th className="py-2.5 px-4">Aluno</th>
              <th className="py-2.5 px-3">Curso & Turma</th>
              <th className="py-2.5 px-3">Conclusão</th>
              <th className="py-2.5 px-3">Prazo Follow-Up</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  Nenhum registro de follow-up pós-curso encontrado com os filtros atuais.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.engagement_id} className="hover:bg-slate-50/70 transition-colors">
                  {/* Student */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/leads/${item.lead_id}`}
                        className="font-bold text-slate-800 hover:text-[#125e95] transition-colors"
                      >
                        {item.student_name}
                      </Link>
                      {getContactIcon(item.contact_preference)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                      {item.student_email || item.student_phone || 'Sem contato'}
                    </div>
                  </td>

                  {/* Course & Session */}
                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-700">{item.course_name}</div>
                    {item.session_code && (
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 py-0.5 rounded border border-slate-200">
                        {item.session_code}
                      </span>
                    )}
                  </td>

                  {/* Completion Date */}
                  <td className="py-3 px-3 text-slate-600 font-medium">
                    {item.completed_at ? item.completed_at.slice(0, 10) : '—'}
                  </td>

                  {/* Follow-up Due Date */}
                  <td className="py-3 px-3">
                    <span
                      className={`font-semibold ${
                        item.is_overdue && item.followup_status === 'pending'
                          ? 'text-rose-600 font-bold'
                          : 'text-slate-700'
                      }`}
                    >
                      {item.followup_due_at ? item.followup_due_at.slice(0, 10) : '—'}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-3 px-3">
                    {getStatusBadge(item.followup_status, item.is_overdue)}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => onOpenEngagementModal(item.engagement_id, 'followup')}
                        className="px-2 py-1 rounded text-xs font-semibold text-[#125e95] bg-[#e1f0fb] hover:bg-[#125e95] hover:text-white transition-all"
                      >
                        Atualizar
                      </button>
                      <button
                        onClick={() => onOpenEngagementModal(item.engagement_id, 'feedback')}
                        title="Link de Feedback"
                        className="px-2 py-1 rounded text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-600 hover:text-white transition-all"
                      >
                        Feedback
                      </button>
                    </div>
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
