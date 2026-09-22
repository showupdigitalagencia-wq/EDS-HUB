import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Course, CourseSession } from '../../../types';
import { formatSessionMonthYear } from '../../pipeline/components/MinimalLeadCard';
import { X, UserPlus, AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';

interface NewLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeadCreated: () => void;
}

interface CourseInterestEntry {
  courseId: string;
  sessionId: string;
}

export function NewLeadModal({ isOpen, onClose, onLeadCreated }: NewLeadModalProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);

  // Main Lead Fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [referredBy, setReferredBy] = useState('');

  // Course Interests (up to 3 prioritized)
  const [interests, setInterests] = useState<CourseInterestEntry[]>([
    { courseId: '', sessionId: '' },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Reset state on open
    setError(null);
    setFullName('');
    setEmail('');
    setPhone('');
    setReferredBy('');
    setInterests([{ courseId: '', sessionId: '' }]);

    async function loadData() {
      const [coursesRes, sessionsRes] = await Promise.all([
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
      ]);

      if (coursesRes.data) {
        setCourses(coursesRes.data);
      }
      if (sessionsRes.data) {
        setSessions(sessionsRes.data as CourseSession[]);
      }
    }

    loadData();
  }, [isOpen]);

  if (!isOpen) return null;

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
      // Clear the single one instead of removing
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

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    if (!trimmedName && !trimmedEmail && !trimmedPhone) {
      setError('Por favor, informe ao menos um nome, email ou telefone para o lead.');
      return;
    }

    // Split name into first and last
    let firstName = trimmedName;
    let lastName: string | null = null;
    if (trimmedName.includes(' ')) {
      const parts = trimmedName.split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    }

    // Format prioritized interests (1..3)
    const validInterests = interests
      .filter((i) => Boolean(i.courseId))
      .slice(0, 3)
      .map((item, idx) => ({
        course_id: item.courseId,
        course_session_id: item.sessionId ? item.sessionId : null,
        priority: (idx + 1) as 1 | 2 | 3,
      }));

    setIsSubmitting(true);

    try {
      // Invoke atomic RPC create_manual_lead (Migration 00055)
      const { data, error: rpcErr } = await supabase.rpc('create_manual_lead', {
        p_first_name: firstName || null,
        p_last_name: lastName || null,
        p_email: trimmedEmail || null,
        p_phone: trimmedPhone || null,
        p_contact_preference: 'email', // Safe internal default satisfying DB NOT NULL constraint
        p_stage_id: null, // Defaults to Novo Lead (code = 'capture')
        p_referred_by: referredBy.trim() || null,
        p_interests: validInterests,
        p_tags: [],
      });

      if (rpcErr) throw rpcErr;
      if (!data?.success) {
        throw new Error(data?.error || 'Erro ao registrar lead manualmente');
      }

      onLeadCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar o lead.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto border border-slate-200/80">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold font-heading text-[#08254f]">
                Adicionar Novo Lead
              </h2>
              <p className="text-xs text-slate-500">
                Cadastro manual no funil de vendas (Novo Lead)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Nome Completo */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nome Completo
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Dr. João Silva"
              className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent transition-all"
            />
          </div>

          {/* Email e Telefone em grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doutor@exemplo.com"
                className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent transition-all"
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
                placeholder="(11) 98765-4321"
                className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Cursos de Interesse (1 a 3) */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800">
                Cursos de Interesse (até 3)
              </label>
              <span className="text-[11px] text-slate-400">
                {interests.length} de 3
              </span>
            </div>

            {interests.map((interest, idx) => {
              const availableSessions = interest.courseId
                ? sessions.filter((s) => s.course_id === interest.courseId)
                : [];

              return (
                <div
                  key={idx}
                  className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2 relative"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-[#08254f]">
                      Interesse #{idx + 1}
                    </span>
                    {interests.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveInterest(idx)}
                        className="text-slate-400 hover:text-rose-600 transition-colors"
                        title="Remover este curso"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Curso */}
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">
                        Curso
                      </label>
                      <select
                        value={interest.courseId}
                        onChange={(e) => handleCourseChange(idx, e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f]"
                      >
                        <option value="">Selecione um curso...</option>
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Turma / Data */}
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">
                        Turma / Data (Opcional)
                      </label>
                      <select
                        value={interest.sessionId}
                        onChange={(e) => handleSessionChange(idx, e.target.value)}
                        disabled={!interest.courseId}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f] disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        <option value="">Sem turma definida</option>
                        {availableSessions.map((s) => {
                          const dateFmt = formatSessionMonthYear(s.start_date);
                          return (
                            <option key={s.id} value={s.id}>
                              {dateFmt ? `${dateFmt} (${s.title})` : s.title}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Progressive Add Button (Up to 3 max) */}
            {interests.length < 3 && (
              <button
                type="button"
                onClick={handleAddInterest}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#449bd5] hover:text-[#08254f] transition-colors py-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Adicionar outro curso</span>
              </button>
            )}
          </div>

          {/* Quem indicou? */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Quem indicou?
            </label>
            <input
              type="text"
              value={referredBy}
              onChange={(e) => setReferredBy(e.target.value)}
              placeholder="Ex: Dra. Camila ou Dr. Pedro"
              className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent transition-all"
            />
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-crimson text-xs disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Criar Lead'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
