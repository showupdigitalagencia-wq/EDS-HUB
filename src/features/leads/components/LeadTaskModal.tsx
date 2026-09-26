import React, { useState, useEffect } from 'react';
import { X, Calendar, CheckSquare, Clock } from 'lucide-react';
import { createCrmTask } from '../../work/services/work-queue-service';
import { notifyTaskDue } from '../../notifications/services/push-notification-service';
import type { TaskType } from '../../../types/database';

interface LeadTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated: () => void;
  leadId: string;
  leadName?: string | null;
  mode?: 'generic' | 'payment';
}

export function LeadTaskModal({
  isOpen,
  onClose,
  onTaskCreated,
  leadId,
  leadName,
  mode = 'generic',
}: LeadTaskModalProps) {
  const isPaymentMode = mode === 'payment';

  const [taskType, setTaskType] = useState<TaskType>(isPaymentMode ? 'payment' : 'follow_up');
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    const h = String(d.getHours()).padStart(2, '0');
    return `${h}:00`;
  });
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTaskType(isPaymentMode ? 'payment' : 'follow_up');
      setNote('');
      setError(null);
      const d = new Date();
      setDate(d.toISOString().slice(0, 10));
      d.setHours(d.getHours() + 2);
      setTime(`${String(d.getHours()).padStart(2, '0')}:00`);
    }
  }, [isOpen, isPaymentMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId) {
      setError('Lead context is required.');
      return;
    }
    if (!date) {
      setError('A data da tarefa é obrigatória.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const selectedType: TaskType = isPaymentMode ? 'payment' : taskType;
      const title =
        selectedType === 'payment'
          ? 'Pagamento'
          : selectedType === 'call'
          ? 'Ligar'
          : 'Follow-up';

      const dueIso = date && time ? new Date(`${date}T${time}:00`).toISOString() : null;

      const taskRes = await createCrmTask({
        leadId,
        title,
        taskType: selectedType,
        dueAt: dueIso,
        priority: 'normal',
        description: note.trim() || undefined,
      });

      // Future scheduled tasks MUST NOT send push or in-app notification at creation time.
      // They will be dispatched by the reminder scheduler when the scheduled time arrives.
      const dueTime = dueIso ? new Date(dueIso).getTime() : null;
      const isDueNowOrOverdue = dueTime !== null && dueTime <= Date.now();

      if (isDueNowOrOverdue) {
        void notifyTaskDue({
          taskId: taskRes?.task_id || leadId,
          taskTitle: title,
          leadId,
          leadName: leadName || undefined,
          description: note.trim() || undefined,
        }).catch(() => {});
      }

      onTaskCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar tarefa');
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalTitle = isPaymentMode
    ? 'Agendar lembrete de pagamento'
    : 'Adicionar Tarefa';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 bg-[#08254f] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-[#449bd5]" />
            <div>
              <h3 className="font-bold font-heading text-sm text-white">
                {modalTitle}
              </h3>
              {leadName && (
                <p className="text-[11px] text-slate-300">
                  Lead: <span className="font-medium text-white">{leadName}</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl">
              {error}
            </div>
          )}

          {/* Tipo de Tarefa */}
          {!isPaymentMode ? (
            <div>
              <label className="text-xs font-semibold text-[#08254f] block mb-1">
                Tipo de Tarefa
              </label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#449bd5]/30 focus:border-[#449bd5]"
              >
                <option value="follow_up">Follow-up</option>
                <option value="call">Ligar</option>
                <option value="payment">Pagamento</option>
              </select>
            </div>
          ) : (
            <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-950">Tipo</span>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-amber-200/70 text-amber-900">
                  Pagamento (Lembrete)
                </span>
              </div>
              <p className="text-[11px] text-amber-800/90 mt-1">
                Lembrete operacional para acompanhamento de pagamento deste lead.
              </p>
            </div>
          )}

          {/* Data e Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#08254f] flex items-center gap-1 mb-1">
                <Calendar className="h-3 w-3 text-slate-400" />
                Data
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/30 focus:border-[#449bd5]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#08254f] flex items-center gap-1 mb-1">
                <Clock className="h-3 w-3 text-slate-400" />
                Hora
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/30 focus:border-[#449bd5]"
              />
            </div>
          </div>

          {/* Observação (opcional) */}
          <div>
            <label className="text-xs font-semibold text-[#08254f] block mb-1">
              Observação <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isPaymentMode ? 'Ex: Cobrar comprovante da entrada' : 'Ex: Ligar no final da tarde'}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/30 focus:border-[#449bd5]"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !date}
              className="btn-crimson text-xs py-2 px-4 flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? 'Criando...' : 'Criar tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
