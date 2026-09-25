// =============================================================================
// EDS HUB — Manual Email Composer Modal (Lead Profile)
// =============================================================================
// Enables 1-to-1 staff email dispatch directly from the Complete Lead Profile
// without external mailto navigation or tab loss.
// Enforces pre-send suppression checks, template snapshots with safe variable
// replacement, double-send protection, and mobile full/bottom sheet responsiveness.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mail,
  Send,
  X,
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  FileText,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { resolveSalutation, resolveSafeFirstName } from '../../../utils/salutation';
import { getTemplateSubject } from '../../../utils/template-variables';
import type { Lead, EmailTemplate } from '../../../types';

export interface ManualEmailComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead;
  onEmailSent?: () => void;
  initialSubject?: string | null;
  inReplyToProviderMessageId?: string | null;
  conversationId?: string | null;
  initialBody?: string | null;
}

export function ManualEmailComposerModal({
  isOpen,
  onClose,
  lead,
  onEmailSent,
  initialSubject,
  inReplyToProviderMessageId,
  conversationId,
  initialBody,
}: ManualEmailComposerModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Template state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ displayName: string; canRemove: boolean; isRequired?: boolean } | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Suppression state
  const [isCheckingSuppression, setIsCheckingSuppression] = useState(false);
  const [suppressionReason, setSuppressionReason] = useState<string | null>(null);
  const [suppressionWarning, setSuppressionWarning] = useState<string | null>(null);

  // Stable idempotency key per compose session
  const idempotencyKeyRef = useRef<string>('');

  const cleanEmail = lead.email ? lead.email.trim().toLowerCase() : '';
  const isValidEmail = Boolean(cleanEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail));

  const prevIsOpenRef = useRef(false);
  const prevLeadIdRef = useRef<string | null>(null);

  const loadSuppressionAndTemplates = useCallback(async () => {
    // Check suppression remotely
    setIsCheckingSuppression(true);
    try {
      const { data: suppression } = await supabase
        .from('email_suppressions')
        .select('reason')
        .eq('normalized_email', cleanEmail)
        .maybeSingle();

      if (suppression) {
        setSuppressionReason(suppression.reason);
        if (suppression.reason === 'hard_bounce') {
          setSuppressionWarning('Este endereço está bloqueado após uma falha permanente de entrega.');
        } else if (suppression.reason === 'complaint') {
          setSuppressionWarning('Este endereço foi bloqueado após uma reclamação de spam.');
        } else if (suppression.reason === 'unsubscribe') {
          setSuppressionWarning('Este contato cancelou o recebimento de e-mails.');
        } else {
          setSuppressionWarning('Este endereço de e-mail está suprimido para envios.');
        }
      }
    } catch (err) {
      console.error('Failed to check email suppression:', err);
    } finally {
      setIsCheckingSuppression(false);
    }

    // Load active templates
    setIsLoadingTemplates(true);
    try {
      const { data: tpls } = await supabase
        .from('email_templates')
        .select('*')
        .eq('is_active', true)
        .order('name');
      setTemplates((tpls || []) as EmailTemplate[]);
    } catch (err) {
      console.error('Failed to load email templates:', err);
      setError('Não foi possível preparar o e-mail. Tente novamente.');
    } finally {
      setIsLoadingTemplates(false);
    }
  }, [cleanEmail]);

  useEffect(() => {
    const isOpening = isOpen && (!prevIsOpenRef.current || prevLeadIdRef.current !== lead.id);
    if (isOpening) {
      // Reset state & generate fresh idempotency key
      setSubject(initialSubject || '');
      setBody(initialBody || '');
      setError(null);
      setSendSuccess(false);
      setIsSending(false);
      setSelectedTemplateId('');
      setSelectedTemplateKey(null);
      setAttachment(null);
      setSuppressionReason(null);
      setSuppressionWarning(null);
      idempotencyKeyRef.current = `manual_email:${lead.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

      // Validate email address format first
      if (!isValidEmail) {
        setError('Este lead não possui um e-mail válido.');
      } else {
        void loadSuppressionAndTemplates();
      }
    }
    prevIsOpenRef.current = isOpen;
    prevLeadIdRef.current = isOpen ? lead.id : null;
  }, [isOpen, lead.id, isValidEmail, loadSuppressionAndTemplates, initialSubject, initialBody]);

  // Handle Template Selection: copies snapshot into composer with safe variable substitution
  const handleSelectTemplate = (templateId: string) => {
    try {
      setSelectedTemplateId(templateId);
      if (!templateId) {
        setSelectedTemplateKey(null);
        setAttachment(null);
        return;
      }

      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) return;

      // Check attachment configuration
      const isZygomatic = tpl.template_key === 'zygomatic_course_details' || tpl.name.toLowerCase().includes('zygomatic');
      const hasAtt = Boolean(tpl.has_attachment || (tpl.content_json as any)?.has_attachment || isZygomatic);
      if (hasAtt) {
        const isRequired = isZygomatic || Boolean((tpl as any).is_attachment_required || (tpl.content_json as any)?.is_attachment_required);
        setAttachment({
          displayName: isZygomatic ? 'Zygomatic Course (2).pdf' : (tpl.attachment_name || (tpl.content_json as any)?.attachment_name || 'Documento PDF'),
          canRemove: !isRequired,
          isRequired,
        });
      } else {
        setAttachment(null);
      }
      setSelectedTemplateKey(tpl.template_key || (isZygomatic ? 'zygomatic_course_details' : null));

      // Resolve variables with lead data safely using canonical rule
      const firstName = resolveSafeFirstName(lead.first_name, 'Doctor');
      const salutation = resolveSalutation(lead.last_name, lead.first_name, 'Doctor');
      const lastName = lead.last_name ? lead.last_name.trim() : '';
      const courseName = lead.course_interest || (isZygomatic ? 'Zygomatic Implant Training' : 'Intensive Dental Implant Training');
      const courseDateRange = 'November 7–10, 2026';
      const courseTuition = '$17,500';

      const replaceVars = (text: string) =>
        text
          .replace(/\{\{\s*salutation\s*\}\}/gi, salutation || 'Doctor')
          .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
          .replace(/\{\{\s*last_name\s*\}\}/gi, lastName)
          .replace(/\{\{\s*course_name\s*\}\}/gi, courseName)
          .replace(/\{\{\s*course_date_range\s*\}\}/gi, courseDateRange)
          .replace(/\{\{\s*course_tuition\s*\}\}/gi, courseTuition)
          .replace(/\{\{\s*[\w.]+\s*\}\}/g, ''); // Safe cleanup of any unmapped variables

      // Subject snapshot
      const templateSubject = getTemplateSubject(tpl) || tpl.name || '';
      setSubject(replaceVars(templateSubject));

      // Body snapshot: prefer text_template, fallback to clean text from blocks
      let rawBody = tpl.text_template || '';
      if (!rawBody && tpl.content_json) {
        if (Array.isArray(tpl.content_json)) {
          rawBody = tpl.content_json
            .map((b: any) => b.content?.text || b.content?.body || '')
            .filter(Boolean)
            .join('\n\n');
        } else if (typeof tpl.content_json === 'object') {
          const cj = tpl.content_json as any;
          rawBody = cj.body || cj.text || '';
        }
      }

      setBody(replaceVars(rawBody));
    } catch (err) {
      console.error('Failed to prepare template in composer:', err);
      setError('Não foi possível preparar o e-mail. Tente novamente.');
    }
  };

  // Handle Send Email
  const handleSend = async () => {
    if (!isValidEmail) {
      setError('Este lead não possui um e-mail válido.');
      return;
    }

    if (suppressionWarning) {
      setError(suppressionWarning);
      return;
    }

    if (!subject.trim()) {
      setError('Por favor, informe o assunto do e-mail.');
      return;
    }

    if (!body.trim()) {
      setError('Por favor, escreva a mensagem do e-mail.');
      return;
    }

    // Strict enforcement: if template requires an attachment, it cannot be sent without it
    const isZygomaticTpl = selectedTemplateKey === 'zygomatic_course_details';
    if ((isZygomaticTpl || attachment?.isRequired) && !attachment) {
      setError('O anexo PDF oficial é obrigatório para este modelo e não pode ser removido.');
      return;
    }

    // Double-click guard
    if (isSending) return;
    setIsSending(true);
    setError(null);

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('send-conversation-message', {
        body: {
          lead_id: lead.id,
          conversation_id: conversationId || undefined,
          channel: 'email',
          subject: subject.trim(),
          body: body.trim(),
          template_key: selectedTemplateKey || undefined,
          include_attachment: Boolean(attachment),
          in_reply_to_provider_message_id: inReplyToProviderMessageId || undefined,
          idempotency_key: idempotencyKeyRef.current,
        },
      });

      if (invokeErr) {
        let friendlyMessage = 'Não foi possível enviar o e-mail. Tente novamente.';
        if (typeof invokeErr === 'object' && invokeErr !== null) {
          const anyErr = invokeErr as any;
          if (anyErr.context && typeof anyErr.context.json === 'function') {
            try {
              const errBody = await anyErr.context.json();
              if (errBody) {
                if (errBody.error === 'EMAIL_SUPPRESSED') {
                  setSuppressionWarning(errBody.message);
                  friendlyMessage = errBody.message;
                } else if (errBody.error === 'ATTACHMENT_REQUIRED_MISSING') {
                  friendlyMessage = 'Não foi possível carregar o PDF obrigatório do curso. Verifique o material e tente novamente.';
                } else if (errBody.error === 'INVALID_ATTACHMENT_MIME') {
                  friendlyMessage = 'O anexo deve ser um documento PDF válido.';
                } else if (errBody.error === 'EMPTY_ATTACHMENT') {
                  friendlyMessage = 'O arquivo PDF anexado está vazio.';
                } else if (errBody.error === 'ATTACHMENT_TOO_LARGE') {
                  friendlyMessage = 'O arquivo PDF excede o limite máximo permitido para envio.';
                } else if (errBody.error === 'CONTACT_PREFERENCE_MISMATCH') {
                  friendlyMessage = errBody.message || 'O canal de envio selecionado difere da preferência do lead.';
                } else if (
                  errBody.message &&
                  !/is not defined|ReferenceError|TypeError|SyntaxError|Edge Function|Internal server error|status code/i.test(errBody.message)
                ) {
                  friendlyMessage = errBody.message;
                } else if (
                  errBody.error &&
                  typeof errBody.error === 'string' &&
                  !/is not defined|ReferenceError|TypeError|SyntaxError|Edge Function|Internal server error|status code/i.test(errBody.error)
                ) {
                  friendlyMessage = errBody.error;
                }
              }
            } catch {
              // Could not parse body, keep friendly fallback
            }
          }
        }
        throw new Error(friendlyMessage);
      }

      if (data?.error) {
        if (data.error === 'EMAIL_SUPPRESSED') {
          setSuppressionWarning(data.message);
          throw new Error(data.message);
        }
        throw new Error(data.message || data.error);
      }

      // Successful dispatch accepted by Resend
      setSendSuccess(true);
      setTimeout(() => {
        onEmailSent?.();
        onClose();
      }, 1100);
    } catch (err: any) {
      console.error('Failed to send manual email:', err);
      let userMsg = err.message || 'Não foi possível enviar o e-mail. Tente novamente.';
      const isTechnical =
        /is not defined|ReferenceError|TypeError|SyntaxError|Internal server error|FunctionsHttpError|Edge Function|Failed to send|object Object|status code/i.test(
          userMsg
        );
      if (isTechnical) {
        userMsg = 'Não foi possível enviar o e-mail no momento. Tente novamente em instantes.';
      }
      setError(userMsg);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  const isBlocked = Boolean(!isValidEmail || suppressionWarning);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-email-composer-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header — Sticky with Back / Close */}
        <div
          className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3"
          style={{ paddingTop: 'max(0.875rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-800 transition-colors"
              title="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="manual-email-composer-title"
                className="text-sm font-bold text-[#08254f] font-heading truncate"
              >
                Enviar E-mail Manual
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Comunicação direta 1-para-1 • Lead Profile
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body — Scrollable with Safe Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Success State Overlay */}
          {sendSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 text-emerald-900 animate-in fade-in duration-200">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold font-heading">Email enviado</p>
                <p className="text-[11px] text-emerald-700">
                  Status: <strong>Enviado</strong>. A entrega será atualizada quando o webhook for recebido.
                </p>
              </div>
            </div>
          )}

          {/* Suppression Guard Warning */}
          {suppressionWarning && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-start gap-2.5 text-rose-900">
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <p className="font-bold font-heading">Envio bloqueado por supressão</p>
                <p className="text-rose-800 text-[11px] leading-relaxed">
                  {suppressionWarning}
                </p>
                <p className="text-[10px] text-rose-600/80 pt-0.5">
                  Motivo: <code className="font-mono bg-rose-100 px-1 py-0.5 rounded">{suppressionReason}</code>. Para proteger a reputação do domínio, envios para este endereço estão bloqueados.
                </p>
              </div>
            </div>
          )}

          {/* Invalid Email Notice */}
          {!isValidEmail && !suppressionWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-amber-900">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold">Este lead não possui um e-mail válido.</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Cadastre um endereço de e-mail válido nos dados do lead para enviar mensagens manuais.
                </p>
              </div>
            </div>
          )}

          {/* Generic Error Notice */}
          {error && !suppressionWarning && isValidEmail && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Fixed Metadata Row: De & Para */}
          <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="text-slate-400 font-medium">De:</span>
              <span className="font-semibold text-slate-800">
                Expert Dental Solutions &lt;info@expdentalsolutions.com&gt;
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200/50">
              <span className="text-slate-400 font-medium">Para:</span>
              <span className="font-semibold text-slate-800">
                {lead.first_name || lead.last_name ? `${lead.first_name || ''} ${lead.last_name || ''} `.trim() : ''}
                {cleanEmail ? `(${cleanEmail})` : 'E-mail não informado'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/50">
              <span className="text-slate-400 font-medium">Responder para:</span>
              <span className="text-slate-600 font-mono">info@expdentalsolutions.com</span>
            </div>
          </div>

          {/* Optional: Template Picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="manual-email-template" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                <span>Usar Modelo (Opcional)</span>
              </label>
              {isLoadingTemplates && (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                </span>
              )}
            </div>
            <select
              id="manual-email-template"
              value={selectedTemplateId}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              disabled={isBlocked || isSending || templates.length === 0}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-[#449bd5] disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">Nenhum modelo selecionado (mensagem em branco)</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} {tpl.category ? `(${tpl.category})` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              Ao selecionar um modelo, uma cópia editável é inserida nos campos abaixo.
            </p>
          </div>

          {/* Subject Field */}
          <div>
            <label htmlFor="manual-email-subject" className="block text-xs font-semibold text-slate-700 mb-1">
              Assunto <span className="text-rose-500">*</span>
            </label>
            <input
              id="manual-email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isBlocked || isSending}
              placeholder="Assunto do e-mail..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#449bd5] focus:border-[#449bd5] disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>

          {/* Message Body Field */}
          <div>
            <label htmlFor="manual-email-body" className="block text-xs font-semibold text-slate-700 mb-1">
              Mensagem <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="manual-email-body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isBlocked || isSending}
              placeholder="Digite o conteúdo da mensagem..."
              className="w-full px-3.5 py-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#449bd5] focus:border-[#449bd5] resize-y disabled:bg-slate-100 disabled:text-slate-400 leading-relaxed font-sans"
            />
          </div>

          {/* Attachment Preview Section */}
          {attachment && (
            <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3 flex items-center justify-between animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 font-bold text-[10px] flex items-center justify-center border border-rose-200 shrink-0">
                  PDF
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-800">{attachment.displayName}</span>
                    {attachment.isRequired ? (
                      <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                        Obrigatório
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        Anexo Oficial
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400">PDF • Documento oficial do curso incluído</p>
                </div>
              </div>
              {attachment.canRemove ? (
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
                  title="Remover anexo apenas deste envio"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <span className="text-[10px] text-slate-400 italic">
                  Anexo fixo
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer — Sticky with Actions & Mobile Safe Area */}
        <div className="sticky bottom-0 z-10 bg-white border-t border-slate-100 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 pb-safe">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            id="send-manual-email-btn"
            onClick={handleSend}
            disabled={isBlocked || isSending || !subject.trim() || !body.trim() || isCheckingSuppression}
            className="btn-crimson text-xs px-5 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs active:translate-y-0.5 cursor-pointer"
          >
            {isSending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Enviando...</span>
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                <span>Enviar Email</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
