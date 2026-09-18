import React from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, MessageSquare, AlertCircle, ExternalLink } from 'lucide-react';
import type { DashboardTasksMetrics, DashboardSnapshotMetrics } from '../../../types/database';

interface TasksAndConversationsWidgetProps {
  tasks: DashboardTasksMetrics;
  snapshot: DashboardSnapshotMetrics;
}

export const TasksAndConversationsWidget: React.FC<TasksAndConversationsWidgetProps> = ({
  tasks,
  snapshot,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 1. Tasks Management */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#e1f0fb] text-[#125e95] shadow-xs">
                <CheckSquare className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Gestão de Tarefas Operacionais
                </h3>
                <p className="text-xs text-slate-500">
                  Status de tarefas manuais e automatizadas
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              SNAPSHOT
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-2">
            <div className="p-3.5 rounded-xl border border-slate-200/80 bg-[#f8fafc]">
              <p className="text-[11px] text-slate-500 font-medium">Pendentes</p>
              <p className="text-xl font-extrabold text-[#08254f] font-heading mt-1">
                {tasks.pending_tasks}
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-amber-200/80 bg-amber-50/40">
              <p className="text-[11px] text-amber-800 font-semibold">Vencem Hoje</p>
              <p className="text-xl font-extrabold text-amber-900 font-heading mt-1">
                {tasks.due_today}
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-rose-200/80 bg-rose-50/40">
              <p className="text-[11px] text-[#8a1c1c] font-semibold flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-[#8a1c1c]" />
                Atrasadas
              </p>
              <p className="text-xl font-extrabold text-[#8a1c1c] font-heading mt-1">
                {tasks.overdue}
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-emerald-200/80 bg-emerald-50/40">
              <p className="text-[11px] text-emerald-800 font-semibold">Concluídas</p>
              <p className="text-xl font-extrabold text-emerald-800 font-heading mt-1">
                {tasks.completed_all_time}
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400">
            Pending, due today, overdue
          </span>
          <Link
            to="/work"
            className="font-semibold text-[#08254f] hover:text-[#449bd5] flex items-center gap-1 transition-colors"
          >
            <span>Ver Work Queue</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 2. Conversations Status */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Inbox Conversacional CRM
                </h3>
                <p className="text-xs text-slate-500">
                  Atendimento unificado multicanal (Email e SMS)
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              SNAPSHOT
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 my-2">
            <div className="p-4 rounded-xl border border-slate-200/80 bg-[#f8fafc] flex items-center justify-between hover:bg-white hover:shadow-xs transition-all">
              <div>
                <p className="text-xs text-slate-500 font-medium">Conversas Abertas</p>
                <p className="text-2xl font-extrabold text-[#08254f] font-heading mt-1">
                  {snapshot.open_conversations}
                </p>
              </div>
              <MessageSquare className="w-7 h-7 text-slate-300" />
            </div>

            <div className="p-4 rounded-xl border border-[#b4cdeb] bg-[#e1f0fb]/40 flex items-center justify-between hover:bg-white hover:shadow-xs transition-all">
              <div>
                <p className="text-xs text-[#08254f] font-bold">Não Lidas</p>
                <p className="text-2xl font-extrabold text-[#08254f] font-heading mt-1">
                  {snapshot.unread_conversations}
                </p>
              </div>
              <div className="p-2 rounded-full bg-[#08254f] text-white">
                <AlertCircle className="w-4 h-4 text-[#449bd5]" />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            Atualização em tempo real das mensagens recebidas
          </span>
          <Link
            to="/inbox"
            className="inline-flex items-center gap-1 text-xs text-[#08254f] hover:text-[#8a1c1c] font-semibold transition-colors"
          >
            Acessar Inbox
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
};
