import React, { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  Clock,
  MessageSquare,
  Award,
  Sparkles,
  Link as LinkIcon,
  Copy,
  Check,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type {
  Course,
  PostCourseFollowupStatus,
  TestimonialStatus,
  TestimonialConsentStatus,
} from '../../../types/database';
import {
  completeFollowup,
  updateEngagementStatus,
  generateFeedbackToken,
  recordTestimonial,
  recordFutureInterest,
} from '../services/post-course-service';

export type ModalMode = 'followup' | 'feedback' | 'testimonial' | 'interest';

interface PostCourseEngagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  engagementId: string;
  initialMode?: ModalMode;
  leadId?: string;
  studentName?: string;
  courseName?: string;
}

export const PostCourseEngagementModal: React.FC<PostCourseEngagementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  engagementId,
  initialMode = 'followup',
  leadId,
  studentName,
  courseName,
}) => {
  const [activeTab, setActiveTab] = useState<ModalMode>(initialMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mode: Follow-up
  const [followupStatus, setFollowupStatus] = useState<PostCourseFollowupStatus>('completed');
  const [followupNotes, setFollowupNotes] = useState('');

  // Mode: Feedback Link Token
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  // Mode: Testimonial
  const [testimonialStatus, setTestimonialStatus] = useState<TestimonialStatus>('received');
  const [testimonialConsent, setTestimonialConsent] = useState<TestimonialConsentStatus>('unknown');
  const [testimonialNotes, setTestimonialNotes] = useState('');

  // Mode: Future Interest
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [interestNotes, setInterestNotes] = useState('');

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (isOpen) {
      // Load active courses for future interest selector
      supabase
        .from('courses')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .then(({ data }) => {
          if (data) {
            setAllCourses(data as Course[]);
            if (data.length > 0 && !selectedCourseId) {
              setSelectedCourseId(data[0].id);
            }
          }
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      if (followupStatus === 'completed') {
        await completeFollowup(engagementId, followupNotes);
      } else {
        await updateEngagementStatus(engagementId, followupStatus, followupNotes);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao salvar follow-up.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateToken = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await generateFeedbackToken(engagementId, 30);
      setGeneratedToken(res.raw_token);
      setExpiresAt(res.expires_at);
      onSuccess();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao gerar link de feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedToken) return;
    const url = `${window.location.origin}/f/course-feedback?token=${generatedToken}`;
    navigator.clipboard.writeText(url);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2500);
  };

  const handleSaveTestimonial = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await recordTestimonial(engagementId, testimonialStatus, testimonialNotes, testimonialConsent);
      onSuccess();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao salvar depoimento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveInterest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId) {
      setErrorMessage('Lead ID não fornecido.');
      return;
    }
    if (!selectedCourseId) {
      setErrorMessage('Selecione o curso de interesse.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await recordFutureInterest({
        leadId,
        courseId: selectedCourseId,
        engagementId,
        notes: interestNotes,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao registrar interesse.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-800 font-heading">
              Acompanhamento Pós-Curso
            </h3>
            {studentName && (
              <p className="text-xs text-slate-500">
                {studentName} {courseName ? `• ${courseName}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 bg-slate-50/50 px-4 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('followup')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'followup'
                ? 'border-[#125e95] text-[#125e95]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Follow-Up
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('feedback')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'feedback'
                ? 'border-[#125e95] text-[#125e95]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Link de Feedback
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('testimonial')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'testimonial'
                ? 'border-[#125e95] text-[#125e95]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            Depoimento
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('interest')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'interest'
                ? 'border-[#125e95] text-[#125e95]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Novo Interesse
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-medium">
              {errorMessage}
            </div>
          )}

          {/* TAB 1: FOLLOW-UP */}
          {activeTab === 'followup' && (
            <form onSubmit={handleSaveFollowup} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Status do Follow-Up
                </label>
                <select
                  value={followupStatus}
                  onChange={(e) => setFollowupStatus(e.target.value as any)}
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                >
                  <option value="completed">Concluído (Contato Realizado)</option>
                  <option value="in_progress">Em Andamento</option>
                  <option value="pending">Pendente</option>
                  <option value="skipped">Dispensado</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Notas de Acompanhamento
                </label>
                <textarea
                  rows={4}
                  value={followupNotes}
                  onChange={(e) => setFollowupNotes(e.target.value)}
                  placeholder="Registre o resumo do contato com o aluno, percepções e satisfação..."
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#125e95] hover:bg-[#0e4b77] rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Salvar Follow-Up
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: FEEDBACK LINK TOKEN */}
          {activeTab === 'feedback' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Gere um token seguro e unguessable de uso único para convidar o aluno a preencher a
                avaliação do curso. O token protege os dados sem expor IDs no navegador.
              </p>

              {generatedToken ? (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                    <span>Link Seguro Gerado:</span>
                    {expiresAt && (
                      <span className="text-slate-400 font-normal">
                        Expira em: {expiresAt.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/f/course-feedback?token=${generatedToken}`}
                      className="w-full text-xs font-mono bg-white border border-slate-200 rounded-lg p-2 text-slate-700 select-all"
                    />
                    <button
                      onClick={handleCopyLink}
                      className="px-3 py-2 text-xs font-bold text-white bg-[#125e95] hover:bg-[#0e4b77] rounded-lg flex items-center gap-1 shrink-0 shadow-xs"
                    >
                      {hasCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {hasCopied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <LinkIcon className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 mb-4">
                    Nenhum link ativo gerado nesta sessão ainda.
                  </p>
                  <button
                    onClick={handleGenerateToken}
                    disabled={isSubmitting}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs inline-flex items-center gap-1.5"
                  >
                    {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Gerar Link de Avaliação
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TESTIMONIAL */}
          {activeTab === 'testimonial' && (
            <form onSubmit={handleSaveTestimonial} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Status do Depoimento
                </label>
                <select
                  value={testimonialStatus}
                  onChange={(e) => setTestimonialStatus(e.target.value as any)}
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                >
                  <option value="received">Recebido</option>
                  <option value="requested">Solicitado (Aguardando Resposta)</option>
                  <option value="not_requested">Não Solicitado</option>
                  <option value="declined">Recusado pelo Aluno</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Consentimento para Publicação (Obrigatório)
                </label>
                <select
                  value={testimonialConsent}
                  onChange={(e) => setTestimonialConsent(e.target.value as any)}
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                >
                  <option value="unknown">Pendente / Desconhecido (Não publicar)</option>
                  <option value="granted">Autorizado pelo Aluno</option>
                  <option value="declined">Não Autorizado (Apenas Uso Interno)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  O recebimento de um depoimento não autoriza automaticamente sua divulgação.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Texto ou Notas do Depoimento
                </label>
                <textarea
                  rows={4}
                  value={testimonialNotes}
                  onChange={(e) => setTestimonialNotes(e.target.value)}
                  placeholder="Transcrição do depoimento, link do vídeo ou observações..."
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Salvar Depoimento
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: FUTURE COURSE INTEREST */}
          {activeTab === 'interest' && (
            <form onSubmit={handleSaveInterest} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Curso de Interesse
                </label>
                <select
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                >
                  {allCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Observações / Contexto Comercial
                </label>
                <textarea
                  rows={4}
                  value={interestNotes}
                  onChange={(e) => setInterestNotes(e.target.value)}
                  placeholder="Por que o aluno tem interesse? Quando pretende cursar? Houve negociação de condição especial?"
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#125e95]"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                Uma tarefa de contato comercial será criada automaticamente para a equipe de vendas.
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Registrar Interesse & Criar Tarefa
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
