import React, { useState } from 'react';
import { X, AlertTriangle, AlertCircle, Sparkles } from 'lucide-react';
import {
  recordCourseAttendance,
  recordCourseCompletion,
} from '../services/course-operations-service';
import type { AttendanceStatus, CompletionStatus } from '../../../types/database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  enrollmentId: string;
  studentName: string;
  currentAttendance: AttendanceStatus;
  currentCompletion: CompletionStatus;
}

export const AttendanceCompletionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  enrollmentId,
  studentName,
  currentAttendance,
  currentCompletion,
}) => {
  const [attendance, setAttendance] = useState<AttendanceStatus>(currentAttendance);
  const [completion, setCompletion] = useState<CompletionStatus>(currentCompletion);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [pipelineMoved, setPipelineMoved] = useState<boolean | null>(null);
  const [evalReason, setEvalReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPipelineMoved(null);

    try {
      // 1. Update Attendance if changed
      if (attendance !== currentAttendance) {
        await recordCourseAttendance({
          enrollmentId,
          attendanceStatus: attendance,
          notes: notes.trim() || undefined,
        });
      }

      // 2. Update Completion if changed (or re-evaluating)
      if (completion !== currentCompletion) {
        const res = await recordCourseCompletion({
          enrollmentId,
          completionStatus: completion,
          notes: notes.trim() || undefined,
        });

        if (res.pipeline_evaluation) {
          setPipelineMoved(res.pipeline_evaluation.moved);
          if (!res.pipeline_evaluation.moved && res.pipeline_evaluation.reason) {
            setEvalReason(res.pipeline_evaluation.reason);
          }
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update attendance/completion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Attendance & Completion</h2>
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

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {pipelineMoved && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Lead safely advanced to <strong>Post-Course</strong> stage!</span>
          </div>
        )}

        {evalReason && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Post-Course hold: {evalReason}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Attendance Status */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Attendance Status *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'expected', label: 'Expected', color: 'border-slate-300' },
                { id: 'attended', label: 'Attended (Presente)', color: 'border-emerald-500 text-emerald-700' },
                { id: 'no_show', label: 'No Show', color: 'border-rose-500 text-rose-700' },
                { id: 'cancelled', label: 'Cancelled', color: 'border-slate-300 text-slate-500' },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setAttendance(opt.id as AttendanceStatus)}
                  className={`p-2.5 rounded-lg border text-xs font-semibold transition-all text-center ${
                    attendance === opt.id
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Completion Status */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Academic Completion Status *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'not_started', label: 'Not Started' },
                { id: 'completed', label: 'Completed' },
                { id: 'incomplete', label: 'Incomplete' },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setCompletion(opt.id as CompletionStatus)}
                  className={`p-2.5 rounded-lg border text-xs font-semibold transition-all text-center ${
                    completion === opt.id
                      ? opt.id === 'completed'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              Marcar como <strong>Completed</strong> ativa o avaliador transacional de pipeline. Se não houver outra matrícula pendente, o lead avança para Post-Course.
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Operational Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Aluno concluiu todos os procedimentos cirúrgicos com êxito..."
              rows={2}
              className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
