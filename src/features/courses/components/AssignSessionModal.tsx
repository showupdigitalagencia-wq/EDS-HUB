import React, { useState, useEffect } from 'react';
import { X, Calendar, AlertCircle, ArrowRight } from 'lucide-react';
import {
  assignEnrollmentToSession,
  changeEnrollmentSession,
  fetchAvailableSessionsForCourse,
} from '../services/course-operations-service';
import type { CourseSession } from '../../../types/database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  enrollmentId: string;
  leadId: string;
  studentName: string;
  courseId: string;
  currentSessionId?: string | null;
}

export const AssignSessionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  enrollmentId,
  studentName,
  courseId,
  currentSessionId,
}) => {
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && courseId) {
      loadSessions();
    }
  }, [isOpen, courseId]);

  const loadSessions = async () => {
    setFetching(true);
    setError(null);
    try {
      const data = await fetchAvailableSessionsForCourse(courseId);
      setSessions(data);
      if (data.length > 0) {
        // Default to first session that is not the current one, or the first session
        const candidate = data.find((s) => s.id !== currentSessionId) || data[0];
        setSelectedSessionId(candidate.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load course sessions.');
    } finally {
      setFetching(false);
    }
  };

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) {
      setError('Please select a course session.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const idempotencyKey = `assign-${enrollmentId}-${selectedSessionId}-${Date.now()}`;

      if (currentSessionId && currentSessionId !== selectedSessionId) {
        // Session Transfer
        await changeEnrollmentSession({
          enrollmentId,
          newSessionId: selectedSessionId,
          idempotencyKey,
        });
      } else {
        // Initial Assignment
        await assignEnrollmentToSession({
          enrollmentId,
          sessionId: selectedSessionId,
          idempotencyKey,
        });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to assign session.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {currentSessionId ? 'Transfer Student Session' : 'Assign Student to Session'}
            </h2>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {fetching ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Carregando turmas disponíveis...
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-medium">Nenhuma turma aberta para este curso.</p>
              <p className="text-xs text-slate-400 mt-1">
                Crie uma turma para este curso antes de alocar o estudante.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Select Course Session *
              </label>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {sessions.map((s) => {
                  const isSelected = s.id === selectedSessionId;
                  const isCurrent = s.id === currentSessionId;

                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-1 ring-blue-600'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900">{s.title}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 font-semibold">
                            {s.code}
                          </span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                              CURRENT
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                          <span>{s.start_date} até {s.end_date}</span>
                          <span>•</span>
                          <span>{s.location || 'Orlando, FL'}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs font-semibold text-slate-700">
                          {s.capacity === null ? 'Vagas ilimitadas' : `Capacidade: ${s.capacity}`}
                        </div>
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 uppercase">
                          {s.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Capacity Warning (Admin override allowed) */}
              {selectedSession && selectedSession.capacity !== null && (
                <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-700">Capacity & Pre-Course Check:</span>
                    <span className="font-mono text-slate-800">Max {selectedSession.capacity} seats</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    O checklist operacional de pré-requisitos será instanciado automaticamente.
                  </p>
                </div>
              )}
            </div>
          )}

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
              disabled={loading || !selectedSessionId || sessions.length === 0}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading ? (
                'Assigning...'
              ) : currentSessionId ? (
                <>
                  <span>Confirm Transfer</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                'Assign to Session'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
