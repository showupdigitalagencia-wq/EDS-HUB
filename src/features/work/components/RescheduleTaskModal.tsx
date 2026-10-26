import React, { useState } from 'react';
import { X, Clock, AlertCircle, Globe } from 'lucide-react';
import { rescheduleCrmTask } from '../services/work-queue-service';
import {
  formatToLocalDatetimeInputValue,
  parseLocalDatetimeInputToUtc,
  formatInUserTimezone,
  getUserTimezone,
} from '../../../utils/timezone';

interface RescheduleTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRescheduled: () => void;
  taskId: string;
  taskTitle: string;
  currentDueAt: string | null;
}

export const RescheduleTaskModal: React.FC<RescheduleTaskModalProps> = ({
  isOpen,
  onClose,
  onRescheduled,
  taskId,
  taskTitle,
  currentDueAt,
}) => {
  const getTomorrowNineAm = () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const localStr = formatToLocalDatetimeInputValue(tomorrow);
    return `${localStr.slice(0, 10)}T09:00`;
  };

  const [newDueDate, setNewDueDate] = useState(() => getTomorrowNineAm());
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const applyPreset = (hoursFromNow: number) => {
    const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
    setNewDueDate(formatToLocalDatetimeInputValue(d));
  };

  const applyTomorrow = () => {
    setNewDueDate(getTomorrowNineAm());
  };

  const applyDaysFromNow = (days: number) => {
    const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const localStr = formatToLocalDatetimeInputValue(target);
    setNewDueDate(`${localStr.slice(0, 10)}T09:00`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const isoDate = newDueDate ? parseLocalDatetimeInputToUtc(newDueDate) : null;
      await rescheduleCrmTask(taskId, isoDate, reason.trim() || undefined);
      onRescheduled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reschedule task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#08254f] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#449bd5]" />
            <h2 className="text-sm font-bold font-heading uppercase tracking-wider">
              Reschedule Task
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
            <p className="text-xs font-semibold text-slate-800 line-clamp-1">{taskTitle}</p>
            <p className="text-[11px] text-slate-500">
              Current Due:{' '}
              {currentDueAt
                ? formatInUserTimezone(currentDueAt)
                : 'No due date set'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Quick Presets
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset(2)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                In 2 Hours
              </button>
              <button
                type="button"
                onClick={applyTomorrow}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Tomorrow 09:00
              </button>
              <button
                type="button"
                onClick={() => applyDaysFromNow(2)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                In 2 Days
              </button>
              <button
                type="button"
                onClick={() => applyDaysFromNow(7)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Next Week
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              New Date & Time
            </label>
            <input
              type="datetime-local"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
              required
            />
            <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
              <Globe className="w-3 h-3 text-[#449bd5]" />
              <span>
                Fuso horário:{' '}
                <strong className="text-slate-700">
                  {getUserTimezone() === 'America/New_York'
                    ? 'Flórida / Eastern Time (ET)'
                    : getUserTimezone()}
                </strong>
              </span>
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason for Rescheduling (Audit Note)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Student requested callback tomorrow"
              className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-crimson text-xs px-5 py-2 disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? 'Saving...' : 'Save New Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
