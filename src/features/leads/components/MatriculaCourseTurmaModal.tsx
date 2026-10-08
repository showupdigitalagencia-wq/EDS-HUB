import React, { useState, useEffect } from 'react';
import { X, GraduationCap, Loader2, AlertCircle, Check } from 'lucide-react';
import type { Course, CourseSession } from '../../../types/database';
import { fetchCourses } from '../../revenue/services/revenue-service';
import { fetchAvailableSessionsForCourse } from '../../courses/services/course-operations-service';
import { ensureCourseSessionForLabel } from '../../courses/services/turma-catalog-service';
import { TurmaSelect } from '../../courses/components/TurmaSelect';
import { supabase } from '../../../lib/supabase';

interface MatriculaCourseTurmaModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  currentCourseId?: string | null;
  currentCourseSessionId?: string | null;
  onSuccess: () => void;
}

export const MatriculaCourseTurmaModal: React.FC<MatriculaCourseTurmaModalProps> = ({
  isOpen,
  onClose,
  leadId,
  currentCourseId,
  currentCourseSessionId,
  onSuccess,
}) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  const [loadingData, setLoadingData] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial loading of courses
  useEffect(() => {
    if (!isOpen) return;

    const loadInitial = async () => {
      setLoadingData(true);
      setError(null);
      try {
        const courseList = await fetchCourses();
        setCourses(courseList);

        const initialCourseId = currentCourseId || (courseList.length > 0 ? courseList[0].id : '');
        setSelectedCourseId(initialCourseId);

        if (initialCourseId) {
          setLoadingSessions(true);
          const sessionList = await fetchAvailableSessionsForCourse(initialCourseId);
          setSessions(sessionList);
          if (currentCourseSessionId && sessionList.some((s) => s.id === currentCourseSessionId)) {
            setSelectedSessionId(currentCourseSessionId);
          } else {
            setSelectedSessionId(currentCourseSessionId || '');
          }
          setLoadingSessions(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar catálogo de cursos');
      } finally {
        setLoadingData(false);
      }
    };

    void loadInitial();
  }, [isOpen, leadId, currentCourseId, currentCourseSessionId]);

  // When course changes, load its sessions
  const handleCourseChange = async (newCourseId: string) => {
    setSelectedCourseId(newCourseId);
    setSelectedSessionId('');
    if (!newCourseId) {
      setSessions([]);
      return;
    }

    setLoadingSessions(true);
    try {
      const sessionList = await fetchAvailableSessionsForCourse(newCourseId);
      setSessions(sessionList);
    } catch (err) {
      console.error('Failed to load sessions for course:', err);
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseId) {
      setError('Selecione um curso.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Resolve session ID safely from catalog label or existing session ID
      let resolvedSessionId: string | null = null;
      if (selectedSessionId && selectedSessionId.trim()) {
        try {
          const sess = await ensureCourseSessionForLabel(selectedCourseId, selectedSessionId.trim());
          resolvedSessionId = sess.id;
        } catch (sessErr) {
          console.warn('Could not ensure course session row, using raw session ID:', sessErr);
          resolvedSessionId = selectedSessionId.trim();
        }
      }

      // 1. Update or create lead_course_interests
      const { data: existingInterests, error: fetchErr } = await supabase
        .from('lead_course_interests')
        .select('id')
        .eq('lead_id', leadId)
        .order('priority', { ascending: true })
        .limit(1);

      if (fetchErr) {
        console.warn('Error checking existing course interests:', fetchErr);
      }

      if (existingInterests && existingInterests.length > 0) {
        const { error: updateErr } = await supabase
          .from('lead_course_interests')
          .update({
            course_id: selectedCourseId,
            course_session_id: resolvedSessionId,
          })
          .eq('id', existingInterests[0].id);

        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('lead_course_interests')
          .insert({
            lead_id: leadId,
            course_id: selectedCourseId,
            course_session_id: resolvedSessionId,
            priority: 1,
          });

        if (insertErr) throw insertErr;
      }

      // 2. Update lead course_interest label
      const chosenCourse = courses.find((c) => c.id === selectedCourseId);
      if (chosenCourse) {
        await supabase
          .from('leads')
          .update({
            course_interest: chosenCourse.name,
            updated_at: new Date().toISOString(),
          })
          .eq('id', leadId);
      }

      // 3. Keep existing enrollments row synchronized if present
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id')
        .eq('lead_id', leadId)
        .limit(1);

      if (enrollments && enrollments.length > 0) {
        await supabase
          .from('enrollments')
          .update({
            course_id: selectedCourseId,
            course_session_id: resolvedSessionId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollments[0].id);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lead-updated', { detail: { leadId } }));
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar curso e turma da matrícula.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200/90 w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[#08254f] text-[#449bd5]">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#08254f] font-heading">
                Definir Curso e Turma da Matrícula
              </h3>
              <p className="text-[11px] text-slate-500">
                Selecione o curso oficial e a turma presencial confirmada
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loadingData ? (
            <div className="py-8 flex items-center justify-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-[#125e95]" />
              Carregando opções...
            </div>
          ) : (
            <>
              {/* Curso Selector */}
              <div>
                <label
                  htmlFor="matricula-course-select"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Curso Oficial <span className="text-rose-500">*</span>
                </label>
                <select
                  id="matricula-course-select"
                  data-testid="matricula-course-select"
                  value={selectedCourseId}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95]"
                  required
                >
                  <option value="">Selecione um curso...</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Turma Selector */}
              <div>
                <TurmaSelect
                  label="Turma / Data do curso"
                  value={selectedSessionId}
                  onChange={(val) => setSelectedSessionId(val)}
                  courseSessions={sessions}
                  disabled={loadingSessions || !selectedCourseId}
                  placeholder="Selecione a turma / data..."
                  testId="matricula-turma-select"
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedCourseId || loadingData}
              data-testid="salvar-matricula-curso-turma-button"
              className="btn-crimson text-xs px-4 py-2 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Salvar Matrícula</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
