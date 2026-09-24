import { useState } from 'react';
import { CheckCircle2, Clock, Plus, Calendar } from 'lucide-react';
import type { Task } from '../../../types';
import { deriveIsOverdue, completeCrmTask } from '../../work/services/work-queue-service';

interface LeadTaskListProps {
  tasks: Task[];
  onOpenCreateTask: () => void;
  onTaskUpdated: () => void;
}

export function formatTaskTypeLabel(type: string): string {
  switch (type) {
    case 'call':
      return 'Ligar';
    case 'follow_up':
      return 'Follow-up';
    case 'payment':
      return 'Pagamento';
    case 'data_review':
      return 'Revisão de Dados';
    case 'general':
      return 'Geral';
    default:
      return type;
  }
}

export function formatTaskDateTime(dateStr?: string | null): string {
  if (!dateStr) return 'Sem data definida';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const month = monthNames[d.getMonth()];
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} • ${hours}:${mins}`;
  } catch {
    return dateStr;
  }
}

export function LeadTaskList({
  tasks,
  onOpenCreateTask,
  onTaskUpdated,
}: LeadTaskListProps) {
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  const pendingTasks = tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => {
      const aDue = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bDue = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const completedTasks = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.updated_at).getTime();
      const bTime = b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.updated_at).getTime();
      return bTime - aTime;
    });

  const handleComplete = async (taskId: string) => {
    if (completingTaskId) return;
    const cleanId = (taskId || '').replace(/^task:/i, '').trim();
    try {
      setCompletingTaskId(cleanId);
      setErrorFeedback(null);
      await completeCrmTask(cleanId);
      setSuccessFeedback('Tarefa concluída');
      setTimeout(() => setSuccessFeedback(null), 3000);
      onTaskUpdated();
    } catch {
      setErrorFeedback('Não foi possível concluir a tarefa.');
      setTimeout(() => setErrorFeedback(null), 4000);
    } finally {
      setCompletingTaskId(null);
    }
  };

  return (
    <div className="card-executive p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#449bd5]" />
          <h2 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider">
            Tarefas ({pendingTasks.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={onOpenCreateTask}
          className="btn-secondary text-xs flex items-center gap-1.5 py-1 px-2.5"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Adicionar Tarefa</span>
        </button>
      </div>

      {/* Success Feedback */}
      {successFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{successFeedback}</span>
        </div>
      )}

      {/* Error Feedback */}
      {errorFeedback && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2 font-medium">
          <Clock className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorFeedback}</span>
        </div>
      )}

      {tasks.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center p-6 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-2">
          <Clock className="h-6 w-6 text-slate-300" />
          <p className="text-xs font-semibold text-slate-700">Nenhuma tarefa agendada</p>
          <p className="text-[11px] text-slate-400">
            Crie lembretes de follow-up, ligações ou pagamentos para este lead.
          </p>
          <button
            type="button"
            onClick={onOpenCreateTask}
            className="btn-secondary text-xs flex items-center gap-1 mt-1"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Adicionar Tarefa</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pending Tasks */}
          {pendingTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Pendentes ({pendingTasks.length})
              </h3>
              <div className="space-y-2">
                {pendingTasks.map((task) => {
                  const isOverdue = deriveIsOverdue(task.due_at);
                  const isPayment = task.task_type === 'payment';
                  const cleanTaskId = task.id.replace(/^task:/i, '').trim();
                  const isCompleting = completingTaskId === cleanTaskId;

                  return (
                    <div
                      key={task.id}
                      className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 ${
                        isPayment
                          ? 'bg-amber-50/40 border-amber-200/70'
                          : isOverdue
                          ? 'bg-rose-50/40 border-rose-200/80'
                          : 'bg-white border-slate-200/80'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border ${
                              isPayment
                                ? 'bg-amber-100 text-amber-900 border-amber-200'
                                : 'bg-slate-100 text-[#08254f] border-slate-200'
                            }`}
                          >
                            {formatTaskTypeLabel(task.task_type)}
                          </span>
                          <span className="text-xs font-bold text-[#08254f]">
                            {task.title}
                          </span>
                          {isOverdue && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold uppercase bg-rose-100 text-rose-700 border border-rose-200 rounded">
                              Atrasada
                            </span>
                          )}
                          <span className="px-1.5 py-0.2 text-[9px] font-semibold text-slate-500 bg-slate-100 rounded">
                            Pendente
                          </span>
                        </div>

                        {task.description && (
                          <p className="text-xs text-slate-600 pl-0.5">
                            {task.description}
                          </p>
                        )}

                        <p className="text-[11px] text-slate-500 flex items-center gap-1 pl-0.5">
                          <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className={isOverdue ? 'text-rose-600 font-semibold' : ''}>
                            {formatTaskDateTime(task.due_at)}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleComplete(task.id)}
                          disabled={isCompleting}
                          data-testid={`lead-complete-task-${task.id}`}
                          className="btn-crimson py-1 px-3 text-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>{isCompleting ? 'Concluindo...' : 'Marcar como concluída'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed Tasks */}
          {completedTasks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Concluídas ({completedTasks.length})
              </h3>
              <div className="space-y-1.5">
                {completedTasks.map((task) => {
                  return (
                    <div
                      key={task.id}
                      className="p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-700">
                              {task.title}
                            </span>
                            <span className="text-[10px] text-slate-400 uppercase">
                              ({formatTaskTypeLabel(task.task_type)})
                            </span>
                          </div>
                          {task.description && (
                            <p className="text-[11px] text-slate-400">
                              {task.description}
                            </p>
                          )}
                          <p className="text-[10px] text-slate-400">
                            {formatTaskDateTime(task.completed_at || task.due_at)}
                          </p>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                        Concluída
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
