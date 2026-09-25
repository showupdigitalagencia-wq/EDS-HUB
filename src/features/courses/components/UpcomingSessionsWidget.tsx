import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Users, MapPin, AlertCircle, CheckCircle2, ChevronRight, User } from 'lucide-react';
import type { UpcomingSessionSummary } from '../../../types/database';
import { formatCohortDateRange } from '../../../utils/format';

interface Props {
  sessions: UpcomingSessionSummary[];
  onEditSession?: (session: UpcomingSessionSummary) => void;
}

export const UpcomingSessionsWidget: React.FC<Props> = ({ sessions, onEditSession }) => {
  const navigate = useNavigate();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Aberta</span>;
      case 'confirmed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Confirmada</span>;
      case 'draft':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Rascunho</span>;
      case 'completed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">Concluída</span>;
      case 'cancelled':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">Cancelada</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">{status}</span>;
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">Turmas Agendadas</h3>
          <p className="text-xs text-slate-500 mt-0.5">Turmas agendadas e controle operacional de vagas</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600">
          {sessions.length} {sessions.length === 1 ? 'turma' : 'turmas'}
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="p-10 text-center text-slate-400">
          <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
          <p className="text-sm font-medium text-slate-600">Nenhuma turma futura cadastrada</p>
          <p className="text-xs text-slate-400 mt-1">Crie uma nova turma para começar a alocar alunos confirmados.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider">
              <tr>
                <th className="py-3 px-6">Curso & Turma</th>
                <th className="py-3 px-4">Período</th>
                <th className="py-3 px-4">Local & Instrutor</th>
                <th className="py-3 px-4">Capacidade & Vagas</th>
                <th className="py-3 px-4">Preparação</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const isAtCap = s.capacity !== null && s.confirmed_students_count >= s.capacity;
                const isOverCap = s.capacity !== null && s.confirmed_students_count > s.capacity;

                return (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                    onClick={() => navigate(`/courses/sessions/${s.id}`)}
                  >
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {s.course_name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                        <span className="font-medium text-slate-700">{formatCohortDateRange(s.start_date, s.end_date)}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {formatCohortDateRange(s.start_date, s.end_date)}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 font-mono">{s.timezone}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="text-xs text-slate-800 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[130px]">{s.location || 'Orlando, FL'}</span>
                      </div>
                      {s.instructor_name && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{s.instructor_name}</span>
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-xs font-semibold text-slate-800">
                          <Users className="w-3.5 h-3.5 text-slate-500" />
                          <span>{s.confirmed_students_count}</span>
                          <span className="text-slate-400">/</span>
                          <span>{s.capacity === null ? '∞' : s.capacity}</span>
                        </div>
                        {isOverCap && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                            LOTADA (EXCESSO)
                          </span>
                        )}
                        {isAtCap && !isOverCap && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                            LOTADA
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {s.capacity === null
                          ? 'Vagas ilimitadas'
                          : `${s.available_seats ?? 0} vagas restantes`}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {s.unready_students_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          <AlertCircle className="w-3 h-3 text-amber-600" />
                          {s.unready_students_count} pendente{s.unready_students_count > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Todos Prontos
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">{getStatusBadge(s.status)}</td>

                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {onEditSession && (
                          <button
                            onClick={() => onEditSession(s)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/courses/sessions/${s.id}`)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                        >
                          <span>Ver Turma</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
