// =============================================================================
// Enrollment Modal (Simplified Create / Edit Enrollment)
// =============================================================================
// Conforms to production simplification:
// - Modal contains ONLY:
//   1. Curso Oficial
//   2. Status da Matrícula
//   3. Data do Curso
// - Removes commercial/financial inputs (agreed amount, initial payment, notes)
// - Never creates fake $0 payment records
// - Preserves all existing financial and enrollment history in database
// =============================================================================

import React, { useState, useEffect } from 'react';
import { X, Calendar, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { Course, Enrollment, EnrollmentStatus, LeadSource } from '../../../types/database';
import { fetchCourses, createEnrollment, updateEnrollment } from '../../revenue/services/revenue-service';
import { supabase } from '../../../lib/supabase';

interface CourseSessionItem {
  id: string;
  course_id: string;
  title: string;
  code?: string;
  start_date: string;
  end_date?: string;
}

interface EnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadSource?: LeadSource;
  existingEnrollment?: Enrollment | null;
  onSuccess: () => void;
}

export const EnrollmentModal: React.FC<EnrollmentModalProps> = ({
  isOpen,
  onClose,
  leadId,
  leadSource = 'manual',
  existingEnrollment,
  onSuccess,
}) => {
  const isEdit = !!existingEnrollment;

  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSessionItem[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [enrollmentStatus, setEnrollmentStatus] = useState<EnrollmentStatus>('confirmed');
  const [courseDate, setCourseDate] = useState<string>('2026-11-07');

  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setIdempotencyKey(crypto.randomUUID());

    const loadData = async () => {
      setIsLoadingCourses(true);
      setError(null);
      try {
        const [courseList, { data: sessionData }] = await Promise.all([
          fetchCourses(),
          supabase
            .from('course_sessions')
            .select('id, course_id, title, code, start_date, end_date')
            .order('start_date', { ascending: true }),
        ]);

        setCourses(courseList);
        const activeSessions = (sessionData || []) as CourseSessionItem[];
        setSessions(activeSessions);

        if (existingEnrollment) {
          setSelectedCourseId(existingEnrollment.course_id);
          setEnrollmentStatus(existingEnrollment.enrollment_status);
          setCourseDate(existingEnrollment.enrollment_date);
          setSelectedSessionId((existingEnrollment as any).course_session_id || '');
        } else if (courseList.length > 0) {
          const first = courseList[0];
          setSelectedCourseId(first.id);
          setEnrollmentStatus('confirmed');

          const matchingSess = activeSessions.filter((s) => s.course_id === first.id);
          if (matchingSess.length > 0) {
            setSelectedSessionId(matchingSess[0].id);
            setCourseDate(matchingSess[0].start_date);
          } else {
            setSelectedSessionId('');
            setCourseDate('2026-11-07');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar catálogo de cursos');
      } finally {
        setIsLoadingCourses(false);
      }
    };

    void loadData();
  }, [isOpen, existingEnrollment]);

  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId);
    const matchingSess = sessions.filter((s) => s.course_id === courseId);
    if (matchingSess.length > 0) {
      setSelectedSessionId(matchingSess[0].id);
      setCourseDate(matchingSess[0].start_date);
    } else {
      setSelectedSessionId('');
      setCourseDate('2026-11-07');
    }
  };

  const handleSessionChange = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    const found = sessions.find((s) => s.id === sessionId);
    if (found && found.start_date) {
      setCourseDate(found.start_date);
    }
  };

  const availableSessions = sessions.filter((s) => s.course_id === selectedCourseId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedCourseId) {
      setError('Selecione um curso válido do catálogo.');
      return;
    }

    if (!courseDate) {
      setError('Informe a data do curso.');
      return;
    }

    const course = courses.find((c) => c.id === selectedCourseId);
    const agreedAmountNum = course?.default_price ?? 0;

    setIsSubmitting(true);

    try {
      if (isEdit && existingEnrollment) {
        await updateEnrollment({
          enrollmentId: existingEnrollment.id,
          courseId: selectedCourseId,
          enrollmentStatus,
          agreedAmount: existingEnrollment.agreed_amount ?? agreedAmountNum,
          enrollmentDate: courseDate,
          notes: existingEnrollment.notes || undefined,
        });

        if (selectedSessionId) {
          try {
            await supabase
              .from('enrollments')
              .update({ course_session_id: selectedSessionId })
              .eq('id', existingEnrollment.id);
          } catch {
            // Non-blocking update
          }
        }
      } else {
        const enrollmentId = await createEnrollment({
          leadId,
          courseId: selectedCourseId,
          enrollmentStatus,
          agreedAmount: agreedAmountNum,
          currency: 'USD',
          enrollmentDate: courseDate,
          source: leadSource,
          idempotencyKey: idempotencyKey || crypto.randomUUID(),
          // Explicitly NO initial payment recorded to avoid fake financial records
        });

        if (selectedSessionId) {
          try {
            await supabase
              .from('enrollments')
              .update({ course_session_id: selectedSessionId })
              .eq('id', enrollmentId);
          } catch {
            // Non-blocking update
          }
        }
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar matrícula.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200/90 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
          <div>
            <h3 className="text-base font-bold text-[#08254f] font-heading">
              {isEdit ? 'Editar Matrícula' : 'Nova Matrícula Comercial'}
            </h3>
            <p className="text-xs text-slate-500">
              {isEdit
                ? 'Atualize os dados e status da matrícula do aluno'
                : 'Vincule o curso oficial, defina o status e a data do curso'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          {isLoadingCourses ? (
            <div className="py-8 flex items-center justify-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-[#125e95]" />
              Carregando catálogo de cursos...
            </div>
          ) : (
            <>
              {/* 1. Curso Oficial */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Curso Oficial <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedCourseId}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                  required
                  data-testid="enrollment-modal-course-select"
                >
                  <option value="" disabled>Selecione um curso...</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Status da Matrícula */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Status da Matrícula <span className="text-rose-500">*</span>
                </label>
                <select
                  value={enrollmentStatus}
                  onChange={(e) => setEnrollmentStatus(e.target.value as EnrollmentStatus)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                  required
                  data-testid="enrollment-modal-status-select"
                >
                  <option value="confirmed">Confirmada (Garante Vaga)</option>
                  <option value="pending">Pendente (Em Análise)</option>
                  <option value="cancelled">Cancelada (Desistência)</option>
                </select>
              </div>

              {/* 3. Data do Curso */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Data do Curso <span className="text-rose-500">*</span>
                </label>

                {availableSessions.length > 0 && (
                  <div className="mb-2">
                    <select
                      value={selectedSessionId}
                      onChange={(e) => handleSessionChange(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium mb-1.5"
                      data-testid="enrollment-modal-session-select"
                    >
                      <option value="">Selecione uma turma / sessão disponível...</option>
                      {availableSessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title || s.code} ({s.start_date})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={courseDate}
                    onChange={(e) => {
                      setCourseDate(e.target.value);
                      setSelectedSessionId('');
                    }}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                    required
                    data-testid="enrollment-modal-course-date-input"
                  />
                </div>
              </div>
            </>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isLoadingCourses}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#125e95] hover:bg-[#08254f] shadow-xs flex items-center gap-2 transition-all disabled:opacity-50"
              data-testid="enrollment-modal-submit-button"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gravando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {isEdit ? 'Salvar Alterações' : 'Confirmar Matrícula'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
