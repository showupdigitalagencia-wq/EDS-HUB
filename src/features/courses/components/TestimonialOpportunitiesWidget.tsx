import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  Sparkles,
  Search,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Clock,
} from 'lucide-react';
import type { TestimonialOpportunityItem, TestimonialStatus, TestimonialConsentStatus } from '../../../types/database';

interface TestimonialOpportunitiesWidgetProps {
  items: TestimonialOpportunityItem[];
  onOpenEngagementModal: (engagementId: string, initialMode: 'followup' | 'feedback' | 'testimonial' | 'interest') => void;
}

export const TestimonialOpportunitiesWidget: React.FC<TestimonialOpportunitiesWidgetProps> = ({
  items,
  onOpenEngagementModal,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_requested' | 'requested' | 'received'>('all');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.student_name.toLowerCase().includes(search.toLowerCase()) ||
        item.course_name.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      return item.testimonial_status === statusFilter;
    });
  }, [items, search, statusFilter]);

  const getConsentBadge = (consent: TestimonialConsentStatus) => {
    switch (consent) {
      case 'granted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            Autorizado
          </span>
        );
      case 'declined':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <ShieldAlert className="w-3 h-3 text-rose-600" />
            Recusado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <ShieldQuestion className="w-3 h-3 text-slate-400" />
            Consent. Pendente
          </span>
        );
    }
  };

  const getTestimonialStatusBadge = (status: TestimonialStatus) => {
    switch (status) {
      case 'received':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Award className="w-3 h-3 text-amber-600" />
            Recebido
          </span>
        );
      case 'requested':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3" />
            Solicitado
          </span>
        );
      case 'declined':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            Declinou
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Sparkles className="w-3 h-3" />
            Oportunidade
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
            <Award className="w-4 h-4 text-amber-500" />
            Oportunidades de Depoimento & Feedback
          </h3>
          <p className="text-xs text-slate-500">
            Alunos que completaram o curso e enviaram avaliações para solicitação de depoimento
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

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#125e95] text-slate-700 font-medium"
          >
            <option value="all">Todos</option>
            <option value="not_requested">Oportunidades (Não Solicitados)</option>
            <option value="requested">Solicitados</option>
            <option value="received">Recebidos</option>
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
              <th className="py-2.5 px-3">Feedback Recebido</th>
              <th className="py-2.5 px-3">Status Depoimento</th>
              <th className="py-2.5 px-3">Consentimento Publicação</th>
              <th className="py-2.5 px-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  Nenhuma oportunidade ou depoimento encontrado com os filtros selecionados.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.engagement_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4">
                    <Link
                      to={`/leads/${item.lead_id}`}
                      className="font-bold text-slate-800 hover:text-[#125e95] transition-colors"
                    >
                      {item.student_name}
                    </Link>
                    <div className="text-[11px] text-slate-400">{item.student_email || '—'}</div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-700">{item.course_name}</div>
                    {item.session_code && (
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 py-0.5 rounded border border-slate-200">
                        {item.session_code}
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    <div className="text-slate-700 font-medium">
                      {item.feedback_received_at ? item.feedback_received_at.slice(0, 10) : '—'}
                    </div>
                    {item.feedback_notes && (
                      <p className="text-[11px] text-slate-500 line-clamp-1 italic max-w-[220px]">
                        "{item.feedback_notes}"
                      </p>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    {getTestimonialStatusBadge(item.testimonial_status)}
                  </td>

                  <td className="py-3 px-3">
                    {getConsentBadge(item.testimonial_consent_status)}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => onOpenEngagementModal(item.engagement_id, 'testimonial')}
                      className="px-2.5 py-1 rounded text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-600 hover:text-white transition-all border border-amber-200"
                    >
                      Gerenciar Depoimento
                    </button>
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
