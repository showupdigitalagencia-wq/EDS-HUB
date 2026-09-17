import React, { useState } from 'react';
import { X, CheckCircle2, Clock, Ban, AlertCircle } from 'lucide-react';
import { updateStudentChecklistItem } from '../services/course-operations-service';
import type { StudentChecklistItem, ChecklistItemStatus } from '../../../types/database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  studentName: string;
  items: StudentChecklistItem[];
}

export const ChecklistManagerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  studentName,
  items,
}) => {
  const [localItems, setLocalItems] = useState<StudentChecklistItem[]>(items);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStatusChange = async (itemId: string, newStatus: ChecklistItemStatus) => {
    setUpdatingId(itemId);
    setError(null);
    try {
      await updateStudentChecklistItem({
        itemId,
        status: newStatus,
      });

      setLocalItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: newStatus } : i))
      );
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to update checklist item.');
    } finally {
      setUpdatingId(null);
    }
  };

  const completedCount = localItems.filter((i) => i.status === 'completed' || i.status === 'waived').length;
  const progressPct = localItems.length > 0 ? Math.round((completedCount / localItems.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Pre-Course Checklist</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aluno: <span className="font-semibold text-slate-800">{studentName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
            <span>Readiness Progress</span>
            <span className="font-mono">{completedCount} of {localItems.length} ({progressPct}%)</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                progressPct === 100 ? 'bg-emerald-500' : 'bg-blue-600'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Items List */}
        <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
          {localItems.length === 0 ? (
            <p className="text-sm text-center text-slate-400 py-6">
              Nenhum item de checklist instanciado para esta matrícula.
            </p>
          ) : (
            localItems.map((item) => {
              const isUpdating = updatingId === item.id;

              return (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {item.title_snapshot}
                      </span>
                      {item.required ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                          REQUIRED
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                          OPTIONAL
                        </span>
                      )}
                    </div>
                    {item.notes && (
                      <p className="text-xs text-slate-500 mt-1">{item.notes}</p>
                    )}
                  </div>

                  {/* Status Switcher Buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => handleStatusChange(item.id, 'completed')}
                      title="Mark as Completed"
                      className={`p-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        item.status === 'completed'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => handleStatusChange(item.id, 'pending')}
                      title="Mark as Pending"
                      className={`p-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        item.status === 'pending'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                      }`}
                    >
                      <Clock className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => handleStatusChange(item.id, 'waived')}
                      title="Waive requirement"
                      className={`p-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        item.status === 'waived'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                      }`}
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            * O status financeiro é derivado e auditado automaticamente via balanço.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
