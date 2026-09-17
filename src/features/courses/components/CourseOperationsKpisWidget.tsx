import React from 'react';
import { Calendar, Users, AlertTriangle, Clock, UserCheck } from 'lucide-react';
import type { CourseOperationsKpis } from '../../../types/database';

interface Props {
  kpis: CourseOperationsKpis;
  onFilterNeedsAttention?: () => void;
  onFilterUnassigned?: () => void;
}

export const CourseOperationsKpisWidget: React.FC<Props> = ({
  kpis,
  onFilterNeedsAttention,
  onFilterUnassigned,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* Active Sessions */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs hover:border-slate-300 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Active Sessions
          </span>
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            <Calendar className="w-5 h-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">
            {kpis.active_sessions_count}
          </span>
          <span className="text-xs text-slate-500 font-medium">turmas ativas</span>
        </div>
      </div>

      {/* Upcoming Sessions */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs hover:border-slate-300 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Upcoming Sessions
          </span>
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">
            {kpis.upcoming_sessions_count}
          </span>
          <span className="text-xs text-slate-500 font-medium">próximas turmas</span>
        </div>
      </div>

      {/* Active Students */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs hover:border-slate-300 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Active Students
          </span>
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Users className="w-5 h-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">
            {kpis.active_students_count}
          </span>
          <span className="text-xs text-slate-500 font-medium">alunos confirmados</span>
        </div>
      </div>

      {/* Unassigned Students */}
      <div
        onClick={onFilterUnassigned}
        className={`bg-white rounded-xl p-5 border transition-all cursor-pointer ${
          kpis.unassigned_enrollments_count > 0
            ? 'border-amber-300 bg-amber-50/20 hover:bg-amber-50/40'
            : 'border-slate-200 shadow-xs hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
            Awaiting Session
          </span>
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-amber-900">
            {kpis.unassigned_enrollments_count}
          </span>
          <span className="text-xs text-amber-700 font-medium">sem turma atribuída</span>
        </div>
      </div>

      {/* Needs Attention */}
      <div
        onClick={onFilterNeedsAttention}
        className={`bg-white rounded-xl p-5 border transition-all cursor-pointer ${
          kpis.needs_attention_count > 0
            ? 'border-rose-300 bg-rose-50/20 hover:bg-rose-50/40'
            : 'border-slate-200 shadow-xs hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">
            Needs Attention
          </span>
          <div className="w-9 h-9 rounded-lg bg-rose-100 flex items-center justify-center text-rose-700">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-rose-900">
            {kpis.needs_attention_count}
          </span>
          <span className="text-xs text-rose-700 font-medium">pontos de atenção</span>
        </div>
      </div>
    </div>
  );
};
