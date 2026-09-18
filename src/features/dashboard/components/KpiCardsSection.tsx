import React from 'react';
import {
  Users,
  MessageSquareReply,
  Flame,
  CheckCircle2,
  TrendingUp,
  Clock,
} from 'lucide-react';
import type { SalesDashboardMetrics } from '../../../types/database';
import { formatRate, formatFirstResponseTime } from '../services/dashboard-service';

interface KpiCardsSectionProps {
  metrics: SalesDashboardMetrics;
}

export const KpiCardsSection: React.FC<KpiCardsSectionProps> = ({ metrics }) => {
  const { snapshot, activity, qualification, scoring, tasks } = metrics || {};

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {/* 1. New Leads */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group">
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
      </div>

      {/* 2. Replies Received & Reply Rate */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 uppercase tracking-wider">
            PERÍODO
          </span>
          <div className="p-2 rounded-xl bg-[#f0f5fb] text-[#08254f] group-hover:scale-105 transition-transform">
            <MessageSquareReply className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Respostas Recebidas</p>
        <p className="text-2xl font-extrabold text-[#08254f] mt-1 font-heading tracking-tight">
          {(activity?.inbound_replies_count ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          Taxa: <span className="font-semibold text-[#08254f]">{formatRate(activity?.reply_rate)}</span>
        </p>
      </div>

      {/* 3. Hot / Very Hot */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-xl bg-[#fdf2f2] text-[#8a1c1c] group-hover:scale-105 transition-transform">
            <Flame className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Hot / Very Hot</p>
        <p className="text-2xl font-extrabold text-[#8a1c1c] mt-1 font-heading tracking-tight">
          {(scoring?.hot_and_very_hot_count ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Threshold: <span className="font-semibold text-slate-700">≥{scoring?.thresholds?.hot_min ?? 50} pts</span>
        </p>
      </div>

      {/* 4. Confirmed */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 group-hover:scale-105 transition-transform">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Confirmados</p>
        <p className="text-2xl font-extrabold text-emerald-700 mt-1 font-heading tracking-tight">
          {(qualification?.confirmed_count ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Qualificação comercial
        </p>
      </div>

      {/* 5. Average Score */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-xl bg-[#e1f0fb] text-[#449bd5] group-hover:scale-105 transition-transform">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Score Médio</p>
        <p className="text-2xl font-extrabold text-[#08254f] mt-1 font-heading tracking-tight">
          {(scoring?.average_score ?? 0).toFixed(1)}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          FRT: <span className="font-semibold text-slate-700">{formatFirstResponseTime(activity?.avg_first_response_time_seconds)}</span>
        </p>
      </div>

      {/* 6. Tasks Due */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all relative overflow-hidden group">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600 group-hover:scale-105 transition-transform">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Tarefas Hoje / Atrasadas</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-2xl font-extrabold text-[#08254f] font-heading tracking-tight">{tasks?.due_today ?? 0}</span>
          {(tasks?.overdue ?? 0) > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fdf2f2] text-[#8a1c1c] border border-red-200">
              {tasks?.overdue} atrasada{(tasks?.overdue ?? 0) > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Pendentes totais: <span className="font-semibold text-slate-700">{tasks?.pending_tasks ?? 0}</span>
        </p>
      </div>
    </div>
  );
};
