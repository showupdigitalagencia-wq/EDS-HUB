import React from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  MessageSquareReply,
  CheckSquare,
  AlertCircle,
  FileCheck2,
} from 'lucide-react';
import type { SalesDashboardMetrics } from '../../../types/database';

interface KpiCardsSectionProps {
  metrics: SalesDashboardMetrics;
  incompleteCount?: number;
}

export const KpiCardsSection: React.FC<KpiCardsSectionProps> = ({
  metrics,
  incompleteCount = 0,
}) => {
  const { snapshot, activity, tasks } = metrics || {};
  const overdueCount = tasks?.overdue ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {/* 1. Novos Leads */}
      <Link
        to="/leads"
        id="kpi-novos-leads"
        className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all relative overflow-hidden group block"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 uppercase tracking-wider">
            PERÍODO
          </span>
          <div className="p-2 rounded-xl bg-[#e1f0fb] text-[#125e95] group-hover:scale-105 transition-transform">
            <Users className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Novos Leads</p>
        <p className="text-2xl font-extrabold text-[#08254f] mt-1 font-heading tracking-tight">
          {(activity?.new_leads_count ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Total no CRM: <span className="font-semibold text-slate-700">{snapshot?.total_leads ?? 0}</span>
        </p>
      </Link>

      {/* 2. Tarefas de Hoje */}
      <Link
        to="/work"
        id="kpi-tarefas-hoje"
        className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all relative overflow-hidden group block"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            HOJE
          </span>
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600 group-hover:scale-105 transition-transform">
            <CheckSquare className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Tarefas de Hoje</p>
        <p className="text-2xl font-extrabold text-[#08254f] mt-1 font-heading tracking-tight">
          {tasks?.due_today ?? 0}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Pendentes totais: <span className="font-semibold text-slate-700">{tasks?.pending_tasks ?? 0}</span>
        </p>
      </Link>

      {/* 3. Tarefas Atrasadas */}
      <Link
        to="/work"
        id="kpi-tarefas-atrasadas"
        className={`bg-white rounded-2xl border p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group block ${
          overdueCount > 0 ? 'border-rose-200 bg-rose-50/20' : 'border-slate-200/90'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
              overdueCount > 0
                ? 'bg-rose-100 text-[#8a1c1c] border border-rose-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
            }`}
          >
            {overdueCount > 0 ? 'ATRASADAS' : 'EM DIA'}
          </span>
          <div
            className={`p-2 rounded-xl transition-transform group-hover:scale-105 ${
              overdueCount > 0
                ? 'bg-[#fdf2f2] text-[#8a1c1c]'
                : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            <AlertCircle className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Tarefas Atrasadas</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span
            className={`text-2xl font-extrabold font-heading tracking-tight ${
              overdueCount > 0 ? 'text-[#8a1c1c]' : 'text-[#08254f]'
            }`}
          >
            {overdueCount}
          </span>
          {overdueCount === 0 && (
            <span className="text-[11px] font-semibold text-emerald-700">Tudo em dia</span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          {overdueCount > 0 ? 'Requer atenção imediata' : 'Nenhuma tarefa atrasada'}
        </p>
      </Link>

      {/* 4. Novas Respostas */}
      <Link
        to="/inbox"
        id="kpi-novas-respostas"
        className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all relative overflow-hidden group block"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200/80 uppercase tracking-wider">
            PERÍODO
          </span>
          <div className="p-2 rounded-xl bg-[#f0f5fb] text-[#08254f] group-hover:scale-105 transition-transform">
            <MessageSquareReply className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Novas Respostas</p>
        <p className="text-2xl font-extrabold text-[#08254f] mt-1 font-heading tracking-tight">
          {(activity?.inbound_replies_count ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Não lidas no Inbox: <span className="font-semibold text-slate-700">{snapshot?.unread_conversations ?? 0}</span>
        </p>
      </Link>

      {/* 5. Inscrições Não Concluídas */}
      <div
        id="kpi-inscricoes-pendentes"
        className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all relative overflow-hidden group block"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            OPERAÇÃO
          </span>
          <div className="p-2 rounded-xl bg-[#f8fafc] text-[#08254f] group-hover:scale-105 transition-transform">
            <FileCheck2 className="w-4 h-4 text-[#449bd5]" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Inscrições Não Concluídas</p>
        <p className="text-2xl font-extrabold text-[#08254f] mt-1 font-heading tracking-tight">
          {incompleteCount}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          {incompleteCount === 0 ? 'Nenhuma pendência' : 'Aguardando contato'}
        </p>
      </div>
    </div>
  );
};
