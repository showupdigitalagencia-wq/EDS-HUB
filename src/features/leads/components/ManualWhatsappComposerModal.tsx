// =============================================================================
// EDS HUB — Manual WhatsApp Composer Modal (WhatsApp Manual Assistido)
// =============================================================================
// Reuses the exact same approved message templates/content from the SMS system.
// 1. Mobile-friendly native WhatsApp dispatch via wa.me / universal URL.
// 2. Pre-filled and 100% editable course-specific template.
// 3. Opening WhatsApp != sending. Only clicking "Marcar WhatsApp como enviado" records sent.
// 4. Closes linked pending WhatsApp tasks and logs factual activity in lead timeline.
// 5. Does NOT use generic fallback: requires an approved course-specific template.
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  ExternalLink,
  CheckCircle2,
  X,
  AlertCircle,
  Phone,
  Sparkles,
  Info,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
  getApprovedZygomaticSmsText,
  getApprovedIntensiveAdvancedSmsText,
  getApprovedEndodonticsSmsText,
  getApprovedWisdomSmsText,
  getApprovedRehabilitationSmsText,
  getApprovedPeriodontalSmsText,
} from '../../../utils/salutation';
import { resolveSmsDestinationPhone } from '../../../utils/phone';
import { WhatsAppIcon } from '../../../components/icons/WhatsAppIcon';
import type { Lead } from '../../../types';

export interface ManualWhatsappComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead;
  onWhatsappRecorded?: () => void;
}

export interface SharedMessageTemplate {
  id: string;
  name: string;
  courseName: string;
  generator: (leadOrSalutation?: any) => string;
}

// Single source of truth: REUSES the EXACT same generator functions and text as SMS.
export const SHARED_WHATSAPP_TEMPLATES: SharedMessageTemplate[] = [
  {
    id: 'zygomatic_followup_whatsapp',
    name: 'Contato WhatsApp inicial — Zygomatic',
    courseName: 'Zygomatic',
    generator: getApprovedZygomaticSmsText,
  },
  {
    id: 'intensive_advanced_followup_whatsapp',
    name: 'Contato WhatsApp inicial — Intensive + Advanced',
    courseName: 'Intensive + Advanced',
    generator: getApprovedIntensiveAdvancedSmsText,
  },
  {
    id: 'endodontics_followup_whatsapp',
    name: 'Contato WhatsApp inicial — Endodontics',
    courseName: 'Endodontics',
    generator: getApprovedEndodonticsSmsText,
  },
  {
    id: 'wisdom_followup_whatsapp',
    name: 'Contato WhatsApp inicial — Wisdom',
    courseName: 'Wisdom Teeth',
    generator: getApprovedWisdomSmsText,
  },
  {
    id: 'rehabilitation_followup_whatsapp',
    name: 'Contato WhatsApp inicial — Rehabilitation',
    courseName: 'Rehabilitation',
    generator: getApprovedRehabilitationSmsText,
  },
  {
    id: 'periodontal_followup_whatsapp',
    name: 'Contato WhatsApp inicial — Periodontal Plastic',
    courseName: 'Periodontal Plastic',
    generator: getApprovedPeriodontalSmsText,
  },
];

export function resolveDefaultWhatsappTemplateId(lead: Lead): string | null {
  const interestStr = `${lead.course_interest || ''} ${JSON.stringify(lead.course_interests || [])}`.toLowerCase();
  if (interestStr.includes('zygoma')) return 'zygomatic_followup_whatsapp';
  if (interestStr.includes('endo')) return 'endodontics_followup_whatsapp';
  if (interestStr.includes('wisdom') || interestStr.includes('molar')) return 'wisdom_followup_whatsapp';
  if (interestStr.includes('rehab')) return 'rehabilitation_followup_whatsapp';
  if (interestStr.includes('perio')) return 'periodontal_followup_whatsapp';
  if (interestStr.includes('implant') || interestStr.includes('intensive') || interestStr.includes('advanced')) {
    return 'intensive_advanced_followup_whatsapp';
  }
  return null;
}

export function cleanPhoneForWhatsApp(raw: string): string {
  return raw.replace(/\D/g, '');
}

export const ManualWhatsappComposerModal: React.FC<ManualWhatsappComposerModalProps> = ({
  isOpen,
  onClose,
  lead,
  onWhatsappRecorded,
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [messageText, setMessageText] = useState('');
  const [hasOpenedApp, setHasOpenedApp] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknownCourseNotice, setUnknownCourseNotice] = useState(false);
  const submittingRef = useRef(false);

  const destinationPhone = resolveSmsDestinationPhone(lead);
  const rawPhone = destinationPhone || lead.phone_e164 || lead.phone_raw || '';
  const digitsOnly = cleanPhoneForWhatsApp(destinationPhone || rawPhone);

  // Initialize template text when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setHasOpenedApp(false);
    setError(null);
    submittingRef.current = false;

    const defaultTplId = resolveDefaultWhatsappTemplateId(lead);

    if (defaultTplId) {
      setSelectedTemplateId(defaultTplId);
      setUnknownCourseNotice(false);
      const tpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === defaultTplId);
      if (tpl) {
        setMessageText(tpl.generator(lead));
      }
    } else {
      // Course is unknown: DO NOT guess an unrelated generic message.
      // Clear selection and require manual selection of an approved course.
      setSelectedTemplateId('');
      setMessageText('');
      setUnknownCourseNotice(true);
    }
  }, [isOpen, lead]);

  if (!isOpen) return null;

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setUnknownCourseNotice(false);
    const tpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) {
      setMessageText(tpl.generator(lead));
    }
  };

  const handleOpenWhatsApp = () => {
    if (!digitsOnly || digitsOnly.length < 8) {
      setError('Telefone não disponível ou inválido para envio de WhatsApp.');
      return;
    }

    if (!selectedTemplateId || !messageText.trim()) {
      setError('Selecione um curso/template aprovado antes de abrir o WhatsApp.');
      return;
    }

    // Normalize phone number for WhatsApp wa.me link:
    // wa.me requires country code without leading plus, zero or special chars
    const waUrl = `https://wa.me/${digitsOnly}?text=${encodeURIComponent(messageText)}`;

    // Opening WhatsApp app MUST NOT record activity as sent automatically
    setHasOpenedApp(true);
    setError(null);
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const handleMarkAsSent = async () => {
    // Idempotency guard for double-click / rapid retry
    if (isRecording || submittingRef.current) return;
    submittingRef.current = true;
    setIsRecording(true);
    setError(null);

    const selectedTpl = SHARED_WHATSAPP_TEMPLATES.find((t) => t.id === selectedTemplateId);
    const courseName = selectedTpl?.courseName || lead.course_interest || 'Curso';

    try {
      // 1. Record factual manual confirmation in lead_activities
      // Status is factual operator confirmation (manually_confirmed), NOT delivered/read
      const payload = {
        lead_id: lead.id,
        activity_type: 'whatsapp_contact_confirmed',
        channel: 'whatsapp',
        actor_type: 'user',
        summary: `WhatsApp enviado manualmente: "${messageText.slice(0, 80)}${messageText.length > 80 ? '...' : ''}"`,
        metadata: {
          channel: 'whatsapp',
          direction: 'outbound',
          status: 'manually_confirmed',
          manual: true,
          provider: 'manual',
          phone: rawPhone,
          template_id: selectedTemplateId,
          course: courseName,
          content: messageText,
          sent_at: new Date().toISOString(),
        },
      };

      let { error: actErr } = await supabase.from('lead_activities').insert(payload);
      if (actErr && (actErr.message?.includes('check') || actErr.code === '23514')) {
        // Fallback to manual_whatsapp_sent if custom constraint prefers it
        const fallbackPayload = {
          ...payload,
          activity_type: 'manual_whatsapp_sent',
        };
        const { error: fbErr } = await supabase.from('lead_activities').insert(fallbackPayload);
        if (fbErr) throw fbErr;
      } else if (actErr) {
        throw actErr;
      }

      // 2. Complete any pending linked WhatsApp task for this lead
      try {
        const { data: pendingTasks } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('lead_id', lead.id)
          .eq('status', 'pending');

        if (pendingTasks && pendingTasks.length > 0) {
          const waTask = pendingTasks.find(
            (t: { id: string; title: string }) => {
              const lower = t.title.toLowerCase();
              return (
                lower.includes('whatsapp') ||
                lower.includes('whats') ||
                lower.includes('zap') ||
                lower.includes('contato whatsapp')
              );
            }
          );
          if (waTask) {
            await supabase
              .from('tasks')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
              })
              .eq('id', waTask.id);
          }
        }
      } catch (taskErr) {
        console.warn('[ManualWhatsApp] Non-fatal task completion warning:', taskErr);
      }

      // 3. Advance stage: Novo Lead -> Respondido (only if currently in Novo Lead)
      try {
        const { data: captureStage } = await supabase
          .from('pipeline_stages')
          .select('id')
          .eq('code', 'capture')
          .maybeSingle();

        const { data: qualificationStage } = await supabase
          .from('pipeline_stages')
          .select('id')
          .eq('code', 'qualification')
          .maybeSingle();

        if (captureStage && qualificationStage) {
          const { data: currentLead } = await supabase
            .from('leads')
            .select('pipeline_stage_id')
            .eq('id', lead.id)
            .maybeSingle();

          if (currentLead && currentLead.pipeline_stage_id === captureStage.id) {
            await supabase
              .from('leads')
              .update({
                pipeline_stage_id: qualificationStage.id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', lead.id);

            await supabase.from('lead_stage_history').insert({
              lead_id: lead.id,
              from_stage_id: captureStage.id,
              to_stage_id: qualificationStage.id,
              change_reason: 'manual_whatsapp_sent',
            });

            await supabase.from('lead_activities').insert({
              lead_id: lead.id,
              activity_type: 'stage_changed',
              actor_type: 'user',
              summary: 'Lead avançado de Novo Lead para Respondido após envio manual de WhatsApp confirmado',
              metadata: { from: 'capture', to: 'qualification', reason: 'manual_whatsapp_sent' },
            });
          }
        }
      } catch (stageErr) {
        console.warn('[ManualWhatsApp] Stage advancement warning:', stageErr);
      }

      // 4. Update conversation last message preview if conversations table has a whatsapp thread
      try {
        const { data: conv } = await supabase
          .from('conversations')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('channel', 'whatsapp')
          .maybeSingle();

        if (conv) {
          await supabase
            .from('conversations')
            .update({
              last_message_at: new Date().toISOString(),
              last_message_preview: messageText.slice(0, 100),
              last_message_direction: 'outbound',
            })
            .eq('id', conv.id);
        }
      } catch (convErr) {
        console.warn('[ManualWhatsApp] Non-fatal conversation update warning:', convErr);
      }

      // 5. Notify app to refresh cards, timeline, and lead state immediately in realtime
      window.dispatchEvent(
        new CustomEvent('whatsapp-sent-confirmed', {
          detail: {
            leadId: lead.id,
            sentAt: new Date().toISOString(),
            course: courseName,
          },
        })
      );
      if (onWhatsappRecorded) onWhatsappRecorded();
      onClose();
    } catch (err: any) {
      console.error('Error recording manual WhatsApp send:', err);
      setError(err.message || 'Erro ao registrar envio do WhatsApp.');
    } finally {
      submittingRef.current = false;
      setIsRecording(false);
    }
  };

  const leadFullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead sem nome';

  return (
    <div
      data-testid="manual-whatsapp-composer-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-[#08254f] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#25d366]/20 text-[#25d366]">
              <WhatsAppIcon className="h-5 w-5 text-[#25d366]" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-heading uppercase tracking-wider">
                WhatsApp Manual Assistido
              </h2>
              <p className="text-[11px] text-slate-300">
                Disparo assistido com mensagens oficiais por curso
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
            title="Fechar"
            data-testid="close-whatsapp-composer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Lead Information Card */}
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-xs">{leadFullName}</span>
              <span className="text-[10px] text-slate-400 font-mono">ID: {lead.id.slice(0, 8)}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600 text-[11px]">
              <Phone className="h-3 w-3 text-slate-400 shrink-0" />
              <span>
                {rawPhone ? (
                  <strong className="font-mono text-slate-800">{rawPhone}</strong>
                ) : (
                  <span className="text-red-500 italic">Telefone não informado</span>
                )}
              </span>
            </div>
          </div>

          {/* Unknown Course Warning */}
          {unknownCourseNotice && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
              <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Curso não identificado automaticamente</strong>
                <span>
                  Para evitar envio de mensagem genérica ou errada, selecione abaixo o curso aprovado específico de interesse deste lead.
                </span>
              </div>
            </div>
          )}

          {/* Template Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
              <span>Template de Mensagem (Compartilhado com SMS)</span>
              <span className="text-[10px] text-slate-400 font-normal">Conteúdo 100% idêntico</span>
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              data-testid="whatsapp-template-select"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#25d366]/20 focus:border-[#25d366] bg-white cursor-pointer"
            >
              <option value="">Selecione um curso / template aprovado...</option>
              {SHARED_WHATSAPP_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>

          {/* Message Textarea */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
              <span>Mensagem a ser enviada</span>
              <span className="text-[10px] text-slate-400">Total: {messageText.length} caracteres</span>
            </label>
            <textarea
              rows={7}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Selecione um template ou digite a mensagem..."
              data-testid="whatsapp-message-textarea"
              className="w-full px-3 py-2 text-xs font-sans border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#25d366]/20 focus:border-[#25d366] leading-relaxed resize-y"
            />
          </div>

          {/* Guidance Callout */}
          <div className="p-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl text-[11px] text-emerald-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-emerald-800">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              <span>Instruções de Operação</span>
            </div>
            <ol className="list-decimal list-inside space-y-0.5 text-emerald-800/90 pl-0.5">
              <li>Clique em <strong>Abrir no WhatsApp</strong> para abrir a conversa com o texto pré-preenchido.</li>
              <li>Envie ou revise a mensagem diretamente no aplicativo do WhatsApp.</li>
              <li>Após enviar no app, clique em <strong>Marcar WhatsApp como enviado</strong> para registrar o evento factualmente no CRM.</li>
            </ol>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
            {/* Step 1: Open WhatsApp */}
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              disabled={!digitsOnly || !selectedTemplateId}
              data-testid="btn-open-whatsapp"
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                !digitsOnly || !selectedTemplateId
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent shadow-xs active:translate-y-0.5'
              }`}
              title="Abre o WhatsApp com o número e texto pré-preenchidos (não marca como enviado)"
            >
              <WhatsAppIcon className="h-3.5 w-3.5 text-white" />
              <span>Abrir no WhatsApp</span>
              <ExternalLink className="h-3 w-3 opacity-80" />
            </button>

            {/* Step 2: Confirm Sent */}
            <button
              type="button"
              onClick={handleMarkAsSent}
              disabled={isRecording || !selectedTemplateId}
              data-testid="btn-mark-whatsapp-sent"
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                isRecording || !selectedTemplateId
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : hasOpenedApp
                  ? 'bg-[#08254f] hover:bg-[#0c336b] text-white border-transparent shadow-xs active:translate-y-0.5 ring-2 ring-[#08254f]/20'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
              }`}
              title="Registra factual confirmação manual do envio no CRM e avança para Respondido"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-[#25d366]" />
              <span>{isRecording ? 'Registrando...' : 'Marcar WhatsApp como enviado'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
