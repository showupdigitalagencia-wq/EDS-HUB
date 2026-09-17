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
  const { snapshot, activity, qualification, scoring, tasks } = metrics;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {/* 1. New Leads */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 uppercase tracking-wider border border-emerald-200">
            PERÍODO
          </span>
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
            <Users className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">Novos Leads</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {activity.new_leads_count.toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          Total no CRM: <span className="font-semibold text-gray-600">{snapshot.total_leads}</span>
        </p>
      </div>

      {/* 2. Replies Received & Reply Rate */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 uppercase tracking-wider border border-emerald-200">
            PERÍODO
          </span>
          <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
            <MessageSquareReply className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">Respostas Recebidas</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {activity.inbound_replies_count.toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          Taxa: <span className="font-semibold text-purple-700">{formatRate(activity.reply_rate)}</span>
        </p>
      </div>

      {/* 3. Hot / Very Hot */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 uppercase tracking-wider border border-blue-200">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
            <Flame className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">Hot / Very Hot</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {scoring.hot_and_very_hot_count.toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          Threshold: <span className="font-semibold text-gray-600">≥{scoring.thresholds.hot_min} pts</span>
        </p>
      </div>

      {/* 4. Confirmed */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 uppercase tracking-wider border border-blue-200">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">Confirmados</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {qualification.confirmed_count.toLocaleString('pt-BR')}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          Qualificação comercial
        </p>
      </div>

      {/* 5. Average Score */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 uppercase tracking-wider border border-blue-200">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">Score Médio</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {scoring.average_score.toFixed(1)}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          FRT: <span className="font-semibold text-gray-600">{formatFirstResponseTime(activity.avg_first_response_time_seconds)}</span>
        </p>
      </div>

      {/* 6. Tasks Due */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 uppercase tracking-wider border border-blue-200">
            SNAPSHOT
          </span>
          <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">Tarefas Hoje / Atrasadas</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-2xl font-bold text-gray-900">{tasks.due_today}</span>
          {tasks.overdue > 0 && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
              {tasks.overdue} atrasada{tasks.overdue > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          Pendentes totais: <span className="font-semibold text-gray-600">{tasks.pending_tasks}</span>
        </p>
      </div>
    </div>
  );
};
