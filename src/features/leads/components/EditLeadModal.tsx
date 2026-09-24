import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Course, CourseSession, Lead, ContactPreference } from '../../../types';
import { formatSessionMonthYear } from '../../pipeline/components/MinimalLeadCard';
import { normalizePhoneDigits } from '../utils/qualificationMapping';
import {
  X,
  Edit2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { notifySmsPreference } from '../../notifications/services/push-notification-service';

export interface EditLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead;
  onLeadUpdated: () => void;
}

export interface CourseInterestEditEntry {
  courseId: string;
  sessionId: string;
}

export function EditLeadModal({ isOpen, onClose, lead, onLeadUpdated }: EditLeadModalProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);

  // Main Lead Fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPreference, setContactPreference] = useState<ContactPreference>('email');
  const [referredBy, setReferredBy] = useState('');

  // Course Interests (up to 3 prioritized)
  const [interests, setInterests] = useState<CourseInterestEditEntry[]>([
    { courseId: '', sessionId: '' },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suppressionWarning, setSuppressionWarning] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Initialize fields and load courses/sessions/existing interests
  useEffect(() => {
    if (!isOpen || !lead) return;

    setError(null);
    setSuppressionWarning(null);
    setSuccessMessage(null);

    setFirstName(lead.first_name || '');
    setLastName(lead.last_name || '');
    setEmail(lead.email || '');
    setPhone(lead.phone_raw || lead.phone_e164 || '');
    setContactPreference(
      lead.contact_preference && ['email', 'sms', 'call'].includes(lead.contact_preference)
        ? lead.contact_preference
        : 'email'
    );
    setReferredBy(lead.referred_by || '');

    async function loadData() {
      setIsLoading(true);
      try {
        const [coursesRes, sessionsRes, interestsRes] = await Promise.all([
          supabase
            .from('courses')
            .select('*')
            .eq('active', true)
            .order('name', { ascending: true }),
          supabase
            .from('course_sessions')
            .select('*')
            .in('status', ['open', 'confirmed', 'draft'])
            .order('start_date', { ascending: true }),
          supabase
            .from('lead_course_interests')
            .select('course_id, course_session_id, priority')
            .eq('lead_id', lead.id)
            .order('priority', { ascending: true }),
        ]);

        if (coursesRes.data) {
          setCourses(coursesRes.data);
        }
        if (sessionsRes.data) {
          setSessions(sessionsRes.data as CourseSession[]);
        }

        if (interestsRes.data && interestsRes.data.length > 0) {
          const mapped: CourseInterestEditEntry[] = interestsRes.data.slice(0, 3).map((item: any) => ({
            courseId: item.course_id,
            sessionId: item.course_session_id || '',
          }));
          setInterests(mapped);
        } else {
          setInterests([{ courseId: '', sessionId: '' }]);
        }
      } catch (err: any) {
        console.error('Failed to load courses or interests:', err);
      } finally {
        setIsLoading(false);
      }
    }

    void loadData();
  }, [isOpen, lead]);

  // Check email suppression on blur or change
  const handleEmailBlur = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setSuppressionWarning(null);
      return;
    }

    try {
      const { data } = await supabase
        .from('email_suppressions')
        .select('reason')
        .eq('normalized_email', cleanEmail)
        .maybeSingle();

      if (data) {
        setSuppressionWarning(
          `Aviso: O endereço "${cleanEmail}" está suprimido para envio de e-mails (${data.reason}).`
        );
      } else {
        setSuppressionWarning(null);
      }
    } catch {
      // non-fatal
    }
  };

  if (!isOpen || !lead) return null;

  // Add another course interest (up to 3 max)
  const handleAddInterest = () => {
    if (interests.length < 3) {
      setInterests([...interests, { courseId: '', sessionId: '' }]);
    }
  };

  // Remove an interest
  const handleRemoveInterest = (index: number) => {
    if (interests.length > 1) {
      setInterests(interests.filter((_, i) => i !== index));
    } else {
      setInterests([{ courseId: '', sessionId: '' }]);
    }
  };

  // Update interest course
  const handleCourseChange = (index: number, courseId: string) => {
    const updated = [...interests];
    updated[index].courseId = courseId;
    updated[index].sessionId = ''; // reset session when course changes
    setInterests(updated);
  };

  // Update interest session
  const handleSessionChange = (index: number, sessionId: string) => {
    const updated = [...interests];
    updated[index].sessionId = sessionId;
    setInterests(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const phoneDigits = normalizePhoneDigits(cleanPhone);

    if (!trimmedFirst && !trimmedLast && !cleanEmail && !cleanPhone) {
      setError('Por favor, informe ao menos um nome, e-mail ou telefone para o lead.');
      return;
    }

    // Email format validation
    if (cleanEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        setError('Por favor, informe um formato de e-mail válido.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // 1. Identity Conflict Check: Email
      if (cleanEmail) {
        const { data: emailConflict } = await supabase
          .from('leads')
          .select('id, first_name, last_name, email')
          .neq('id', lead.id)
          .ilike('email', cleanEmail)
          .limit(1);

        if (emailConflict && emailConflict.length > 0) {
          const conflictName =
            [emailConflict[0].first_name, emailConflict[0].last_name].filter(Boolean).join(' ') ||
            'Outro lead';
          setError(
            `Conflito de identidade: O e-mail "${cleanEmail}" já está cadastrado para o lead "${conflictName}" (ID: ${emailConflict[0].id.slice(0, 8)}). A atualização foi cancelada para evitar duplicações.`
          );
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Identity Conflict Check: Phone
      if (phoneDigits.length >= 8) {
        const { data: phoneConflict } = await supabase
          .from('leads')
          .select('id, first_name, last_name, phone_raw, phone_e164')
          .neq('id', lead.id)
          .or(`phone_raw.eq.${cleanPhone},phone_e164.eq.${cleanPhone}`)
          .limit(1);

        if (phoneConflict && phoneConflict.length > 0) {
          const conflictName =
            [phoneConflict[0].first_name, phoneConflict[0].last_name].filter(Boolean).join(' ') ||
            'Outro lead';
          setError(
            `Conflito de identidade: O telefone informado já pertence ao lead "${conflictName}" (ID: ${phoneConflict[0].id.slice(0, 8)}). A atualização foi cancelada para proteger a integridade dos dados.`
          );
          setIsSubmitting(false);
          return;
        }
      }

      // 3. Format Phone E164 if valid
      let phoneE164: string | null = null;
      if (cleanPhone.startsWith('+') && /^\+[1-9][0-9]{7,14}$/.test(cleanPhone)) {
        phoneE164 = cleanPhone;
      }

      // 4. Resolve Prioritized Course Interests
      const validInterests = interests
        .filter((i) => Boolean(i.courseId))
        .slice(0, 3)
        .map((item, idx) => ({
          courseId: item.courseId,
          sessionId: item.sessionId ? item.sessionId : null,
          priority: (idx + 1) as 1 | 2 | 3,
        }));

      // Find course names for legacy snapshots
      const courseMap = new Map(courses.map((c) => [c.id, c.name]));
      const courseNames = validInterests
        .map((vi) => courseMap.get(vi.courseId))
        .filter(Boolean) as string[];
      const primaryCourseName = courseNames[0] || null;

      // 5. Update Current Lead strictly in-place (DO NOT touch pipeline_stage_id)
      const { error: updateErr } = await supabase
        .from('leads')
        .update({
          first_name: trimmedFirst || null,
          last_name: trimmedLast || null,
          email: cleanEmail || null,
          phone_raw: cleanPhone || null,
          phone_e164: phoneE164,
          contact_preference: contactPreference,
          referred_by: referredBy.trim() || null,
          course_interest: primaryCourseName,
          course_interests: courseNames,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      if (updateErr) throw updateErr;

      // 6. Update lead_course_interests (delete old & insert new prioritized rows)
      await supabase
        .from('lead_course_interests')
        .delete()
        .eq('lead_id', lead.id);

      if (validInterests.length > 0) {
        const rowsToInsert = validInterests.map((item) => ({
          lead_id: lead.id,
          course_id: item.courseId,
          course_session_id: item.sessionId,
          priority: item.priority,
          source: 'manual',
          status: 'active',
        }));

        const { error: intErr } = await supabase
          .from('lead_course_interests')
          .insert(rowsToInsert);

        if (intErr) throw intErr;
      }

      // 7. Show success message & trigger immediate view refresh
      setSuccessMessage('Lead atualizado');

      if (contactPreference === 'sms' && lead.contact_preference !== 'sms') {
        void notifySmsPreference({
          leadId: lead.id,
          leadName: `${trimmedFirst} ${trimmedLast}`.trim() || 'Lead',
        }).catch(() => {});
      }

      window.dispatchEvent(
        new CustomEvent('lead-updated', {
          detail: { leadId: lead.id },
        })
      );

      onLeadUpdated();

      // Close modal smoothly after brief feedback
      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar alterações do lead.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-lead-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#061a38]/40 backdrop-blur-xs p-0 sm:p-4 overflow-hidden"
    >
      <div className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full max-w-lg h-full sm:h-auto sm:max-h-[92vh] flex flex-col border border-slate-200/80">
        {/* Sticky Header with Back / Close Button */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 bg-white shrink-0"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-800 rounded-lg flex items-center gap-1 text-xs font-semibold"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Voltar</span>
            </button>
            <div className="p-2 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs hidden sm:block">
              <Edit2 className="h-4 w-4" />
            </div>
            <div>
              <h2 id="edit-lead-title" className="text-base font-bold font-heading text-[#08254f]">
                Editar Lead
              </h2>
              <p className="text-xs text-slate-500">
                Atualize as informações cadastrais do lead
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Fechar modal"
            className="hidden sm:inline-flex p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2 animate-fadeIn"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {suppressionWarning && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2 animate-fadeIn"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="flex-1">{suppressionWarning}</div>
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 animate-fadeIn font-semibold"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Name Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ex: João"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Sobrenome
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Ex: Silva"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all"
              />
            </div>
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="nome@exemplo.com"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Telefone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+55 11 99999-9999"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all"
              />
            </div>
          </div>

          {/* Contact Preference & Referred By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Canal Preferencial
              </label>
              <select
                value={contactPreference}
                onChange={(e) => setContactPreference(e.target.value as ContactPreference)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all cursor-pointer"
              >
                <option value="email">E-mail</option>
                <option value="sms">SMS</option>
                <option value="call">Ligação / Telefone</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Quem indicou?
              </label>
              <input
                type="text"
                value={referredBy}
                onChange={(e) => setReferredBy(e.target.value)}
                placeholder="Ex: Dra. Mariana Costa"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all"
              />
            </div>
          </div>

          {/* Course Interests (Up to 3 prioritized) */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold font-heading text-slate-800 uppercase tracking-wider">
                Cursos de Interesse (Até 3 priorizados)
              </label>
              {interests.length < 3 && (
                <button
                  type="button"
                  onClick={handleAddInterest}
                  disabled={isSubmitting}
                  className="text-xs font-semibold text-[#449bd5] hover:text-[#08254f] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar outro</span>
                </button>
              )}
            </div>

            <div className="space-y-3">
              {interests.map((interest, idx) => {
                const availableSessions = sessions.filter(
                  (s) => s.course_id === interest.courseId
                );

                return (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50/70 rounded-xl border border-slate-200/80 space-y-2 relative"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-600">
                        Prioridade #{idx + 1}
                      </span>
                      {interests.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveInterest(idx)}
                          disabled={isSubmitting}
                          className="text-slate-400 hover:text-rose-500 p-1 rounded-md transition-colors cursor-pointer"
                          title="Remover interesse"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <select
                          value={interest.courseId}
                          onChange={(e) => handleCourseChange(idx, e.target.value)}
                          disabled={isSubmitting || isLoading}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all cursor-pointer"
                        >
                          <option value="">Selecione um curso...</option>
                          {courses.map((course) => (
                            <option key={course.id} value={course.id}>
                              {course.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <select
                          value={interest.sessionId}
                          onChange={(e) => handleSessionChange(idx, e.target.value)}
                          disabled={isSubmitting || !interest.courseId || availableSessions.length === 0}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] transition-all cursor-pointer disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="">
                            {!interest.courseId
                              ? 'Selecione o curso primeiro'
                              : availableSessions.length === 0
                              ? 'Nenhuma turma disponível'
                              : 'Selecione a turma / data...'}
                          </option>
                          {availableSessions.map((session) => {
                            const formatted = formatSessionMonthYear(session.start_date);
                            const label = formatted
                              ? `${session.title || 'Turma'} (${formatted})`
                              : session.title || 'Turma';
                            return (
                              <option key={session.id} value={session.id}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </form>

        {/* Sticky Action Footer */}
        <div
          className="sticky bottom-0 z-10 flex items-center justify-end gap-3 px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-white shrink-0"
          style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#08254f] hover:bg-[#0c3266] rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Salvando alterações...</span>
              </>
            ) : (
              <span>Salvar alterações</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
