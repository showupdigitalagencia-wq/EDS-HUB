import React, { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createCrmTask } from '../services/work-queue-service';
import type { TaskPriority, TaskType } from '../../../types/database';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated?: () => void;
  onCreated?: () => void;
  initialLeadId?: string | null;
  initialLeadName?: string | null;
  leadName?: string | null;
  initialTitle?: string;
  initialPriority?: TaskPriority;
  initialEnrollmentId?: string | null;
  initialSessionId?: string | null;
  initialEngagementId?: string | null;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  onTaskCreated,
  onCreated,
  initialLeadId,
  initialLeadName,
  leadName,
  initialTitle = '',
  initialPriority = 'normal',
  initialEnrollmentId,
  initialSessionId,
  initialEngagementId,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [taskType, setTaskType] = useState<TaskType>('call');
  const [priority, setPriority] = useState<TaskPriority>(initialPriority);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 4);
    return d.toISOString().slice(0, 16);
  });
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setPriority(initialPriority);
      setError(null);
    }
  }, [isOpen, initialTitle, initialPriority]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialLeadId) {
      setError('Lead context is required to create a task.');
      return;
    }
    if (!title.trim()) {
      setError('Task title is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await createCrmTask({
        leadId: initialLeadId,
        title: title.trim(),
        taskType,
        dueAt: dueDate ? new Date(dueDate).toISOString() : null,
        priority,
        description: description.trim() || undefined,
        enrollmentId: initialEnrollmentId || undefined,
        courseSessionId: initialSessionId || undefined,
        postCourseEngagementId: initialEngagementId || undefined,
      });

      (onTaskCreated || onCreated)?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayName = leadName || initialLeadName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#08254f] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[#449bd5]" />
            <h2 className="text-sm font-bold font-heading uppercase tracking-wider">
              Create New Task
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

          {displayName && (
            <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-700 flex items-center justify-between">
              <span className="text-slate-500 font-medium">Assigned Lead:</span>
              <span className="font-semibold text-[#08254f]">{displayName}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Call student regarding cohort schedule"
              className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Type
              </label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5] bg-white"
              >
                <option value="call">Phone Call</option>
                <option value="follow_up">Follow-up</option>
                <option value="data_review">Data Review</option>
                <option value="general">General Task</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5] bg-white"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Due Date & Time
            </label>
            <div className="relative">
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notes / Description (Optional)
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional operational context or details..."
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
              {isSubmitting ? 'Saving...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
