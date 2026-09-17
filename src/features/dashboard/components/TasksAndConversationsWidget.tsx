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
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <CheckSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Gestão de Tarefas Operacionais
                </h3>
                <p className="text-xs text-gray-500">
                  Status de tarefas manuais e automatizadas
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              SNAPSHOT
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-2">
            <div className="p-3 rounded-lg border border-gray-100 bg-gray-50">
              <p className="text-[11px] text-gray-500 font-medium">Pendentes</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {tasks.pending_tasks}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-amber-100 bg-amber-50/50">
              <p className="text-[11px] text-amber-700 font-medium">Vencem Hoje</p>
              <p className="text-xl font-bold text-amber-900 mt-1">
                {tasks.due_today}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-red-100 bg-red-50/50">
              <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Atrasadas
              </p>
              <p className="text-xl font-bold text-red-700 mt-1">
                {tasks.overdue}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/50">
              <p className="text-[11px] text-emerald-700 font-medium">Concluídas</p>
              <p className="text-xl font-bold text-emerald-800 mt-1">
                {tasks.completed_all_time}
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 text-[11px] text-gray-400">
          Statuses reais inspecionados: pending, completed, cancelled
        </div>
      </div>

      {/* 2. Conversations Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Inbox Conversacional CRM
                </h3>
                <p className="text-xs text-gray-500">
                  Atendimento unificado multicanal (Email e SMS)
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              SNAPSHOT
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 my-2">
            <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Conversas Abertas</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {snapshot.open_conversations}
                </p>
              </div>
              <MessageSquare className="w-8 h-8 text-gray-300" />
            </div>

            <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 flex items-center justify-between">
              <div>
                <p className="text-xs text-indigo-700 font-medium">Não Lidas</p>
                <p className="text-2xl font-bold text-indigo-900 mt-1">
                  {snapshot.unread_conversations}
                </p>
              </div>
              <div className="p-2 rounded-full bg-indigo-100 text-indigo-700">
                <AlertCircle className="w-5 h-5" />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">
            Atualização em tempo real das mensagens recebidas
          </span>
          <Link
            to="/inbox"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
          >
            Acessar Inbox
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
};
