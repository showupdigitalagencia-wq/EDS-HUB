import React from 'react';
import { Link } from 'react-router-dom';
import {
  CheckSquare,
  AlertTriangle,
  MessageSquare,
  DollarSign,
  GraduationCap,
  Award,
  Clock,
  User,
  ArrowRight,
  CheckCircle2,
  Calendar,
  Phone,
  Mail,
  Flame,
} from 'lucide-react';
import type { WorkItem, TaskPriority } from '../../../types/database';

interface WorkItemCardProps {
  item: WorkItem;
  onCompleteTask: (taskId: string) => void;
  onRescheduleTask: (task: WorkItem) => void;
  onCreateTaskForLead: (item: WorkItem) => void;
  onSelectLead?: (leadId: string) => void;
  isCompleting?: boolean;
}

export const WorkItemCard: React.FC<WorkItemCardProps> = ({
  item,
  onCompleteTask,
  onRescheduleTask,
  onCreateTaskForLead,
  onSelectLead,
  isCompleting = false,
}) => {
  const getPriorityBadge = (priority: TaskPriority) => {
    switch (priority) {
      case 'critical':
        return (
          <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-red-100 text-red-700 border border-red-200">
            Crítica
          </span>
        );
      case 'high':
        return (
          <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
            <Flame className="w-2.5 h-2.5 text-amber-600" />
            Alta
          </span>
        );
      case 'normal':
        return (
          <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-sky-50 text-sky-800 border border-sky-200">
            Normal
          </span>
        );
      case 'low':
        return (
          <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-slate-100 text-slate-600 border border-slate-200">
            Baixa
          </span>
        );
    }
  };

  const getTypeIcon = () => {
    switch (item.type) {
      case 'TASK':
        return <CheckSquare className="w-4 h-4 text-emerald-600" />;
      case 'CONVERSATION_ATTENTION':
        return <MessageSquare className="w-4 h-4 text-indigo-600" />;
      case 'COURSE_ATTENTION':
        return <GraduationCap className="w-4 h-4 text-purple-600" />;
      case 'PAYMENT_ATTENTION':
        return <DollarSign className="w-4 h-4 text-emerald-700" />;
      case 'POST_COURSE_ATTENTION':
        return <Award className="w-4 h-4 text-teal-600" />;
      case 'LEAD_ATTENTION':
      default:
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
    }
  };

  const getCleanTypeLabel = () => {
    switch (item.type) {
      case 'TASK':
        return 'Tarefa';
      case 'CONVERSATION_ATTENTION':
        return 'Inbox';
      case 'COURSE_ATTENTION':
        return 'Operação de Curso';
      case 'PAYMENT_ATTENTION':
        return 'Pagamento';
      case 'POST_COURSE_ATTENTION':
        return 'Pós-Curso';
      case 'LEAD_ATTENTION':
        return 'Alerta de Lead';
    }
  };

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        item.priority === 'critical'
          ? 'bg-red-50/30 border-red-200/80 hover:border-red-300'
          : item.is_overdue
          ? 'bg-amber-50/20 border-amber-200/70 hover:border-amber-300'
          : 'bg-white border-slate-200/80 hover:border-slate-300 shadow-sm'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left Side: Type, Priority, Title, Context */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
              {getTypeIcon()}
              <span>{getCleanTypeLabel()}</span>
            </div>
            {getPriorityBadge(item.priority)}
            {item.is_overdue && (
              <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-red-50 text-red-700 border border-red-200 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                Atrasada
              </span>
            )}
            {item.pipeline_stage && (
              <span className="px-2 py-0.5 text-[10px] uppercase font-medium rounded bg-slate-100 text-slate-600">
                {item.pipeline_stage}
              </span>
            )}
            {item.reason_code && (
              <span className="px-2 py-0.5 text-[9px] font-mono font-semibold rounded bg-slate-100 text-slate-500">
                {item.reason_code}
              </span>
            )}
          </div>

          <h3 className="text-sm font-semibold text-slate-900 leading-snug break-words">
            {item.title}
          </h3>

          {item.description && (
            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
              {item.description}
            </p>
          )}

          {/* Lead Context Bar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-0.5">
            {item.lead_id && (
              onSelectLead ? (
                <button
                  type="button"
                  onClick={() => onSelectLead(item.lead_id!)}
                  className="font-medium text-[#08254f] hover:text-[#449bd5] flex items-center gap-1 transition-colors cursor-pointer text-left"
                >
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>{item.lead_name}</span>
                </button>
              ) : (
                <Link
                  to={`/leads/${item.lead_id}`}
                  className="font-medium text-[#08254f] hover:text-[#449bd5] flex items-center gap-1 transition-colors"
                >
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>{item.lead_name}</span>
                </Link>
              )
            )}

            {item.lead_score != null && (
              <span className="text-slate-500 text-[11px]">
                Score: <strong className="text-slate-700">{item.lead_score}</strong>
              </span>
            )}

            {item.contact_preference && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 capitalize">
                {item.contact_preference === 'email' && <Mail className="w-3 h-3" />}
                {item.contact_preference === 'sms' && <MessageSquare className="w-3 h-3" />}
                {item.contact_preference === 'call' && <Phone className="w-3 h-3" />}
                <span>{item.contact_preference}</span>
              </span>
            )}

            {item.due_at && (
              <span
                className={`text-[11px] flex items-center gap-1 ${
                  item.is_overdue ? 'text-red-600 font-semibold' : 'text-slate-500'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Prazo: {new Date(item.due_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Quick Action Buttons */}
        <div className="flex items-center gap-2 sm:shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          {item.type === 'TASK' || item.type === 'PAYMENT_ATTENTION' || item.context_type === 'task' ? (
            <>
              {item.category !== 'completed' ? (
                <>
                  <button
                    onClick={() => onRescheduleTask(item)}
                    title="Reagendar Data Limite"
                    className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Reagendar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const taskId = (item.context_id || item.id).replace(/^task:/i, '').trim();
                      onCompleteTask(taskId);
                    }}
                    disabled={isCompleting}
                    data-testid={`complete-task-${(item.context_id || item.id).replace(/^task:/i, '').trim()}`}
                    className="btn-crimson text-xs px-3.5 py-2 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isCompleting ? 'Concluindo...' : 'Marcar como concluída'}</span>
                  </button>
                </>
              ) : (
                <span className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Concluída
                </span>
              )}
            </>
          ) : (
            <>
              {item.primary_action.type === 'create_task' ? (
                <button
                  onClick={() => onCreateTaskForLead(item)}
                  className="btn-crimson text-xs px-3.5 py-2 flex items-center gap-1.5"
                >
                  <span>{item.primary_action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : item.primary_action.href ? (
                <Link
                  to={item.primary_action.href}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#08254f] text-white hover:bg-[#0c3875] transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span>{item.primary_action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
