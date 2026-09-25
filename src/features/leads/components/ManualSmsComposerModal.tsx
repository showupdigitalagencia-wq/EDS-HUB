// =============================================================================
// EDS HUB — Manual SMS Composer Modal (SMS Manual Assistido)
// =============================================================================
// Fully implements FASE 17 & 18:
// 1. Mobile-first native SMS dispatch via sms: URI.
// 2. Pre-filled and 100% editable template (Zygomatic follow-up, etc.).
// 3. Opening SMS app != sending. Only clicking "Marcar SMS como enviado" records sent.
// 4. Closes related pending SMS tasks and logs activity in lead timeline.
// =============================================================================

import { useState, useEffect } from 'react';
import {
  MessageSquare,
  ExternalLink,
  CheckCircle2,
  X,
  AlertCircle,
  Phone,
  Clock,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { resolveSafeFirstName } from '../../../utils/salutation';
import type { Lead } from '../../../types';

export interface ManualSmsComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead;
  onSmsRecorded?: () => void;
}

interface SmsTemplate {
  id: string;
  name: string;
  body: string;
}

const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: 'zygomatic_followup_sms',
    name: 'Zygomatic — Follow-up SMS',
    body: 'Hello {{first_name}}, this is Expert Dental Solutions following up on your inquiry about our Zygomatic Implant Training in Rio de Janeiro. How can we assist you?',
  },
  {
    id: 'general_inquiry_sms',
    name: 'Contato Inicial — Geral',
    body: 'Hello {{first_name}}, thank you for your interest in Expert Dental Solutions. We received your request and would love to answer your questions regarding our hands-on surgical programs.',
  },
];

export function ManualSmsComposerModal({
  isOpen,
  onClose,
  lead,
  onSmsRecorded,
}: ManualSmsComposerModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('zygomatic_followup_sms');
  const [messageText, setMessageText] = useState('');
  const [hasOpenedApp, setHasOpenedApp] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawPhone = lead.phone_e164 || lead.phone_raw || '';
  const digitsOnly = rawPhone.replace(/\D/g, '');
  const firstName = resolveSafeFirstName(lead.first_name, 'Doctor');


  // Initialize template text with safe variable replacement
  useEffect(() => {
    if (!isOpen) return;
    setHasOpenedApp(false);
    setError(null);

    const tpl = DEFAULT_SMS_TEMPLATES.find((t) => t.id === selectedTemplateId) || DEFAULT_SMS_TEMPLATES[0];
    const greetingName = firstName || 'Doctor';
    const filled = tpl.body.replace(/\{\{\s*first_name\s*\}\}/g, greetingName);
    setMessageText(filled);
  }, [isOpen, selectedTemplateId, firstName]);

  if (!isOpen) return null;

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = DEFAULT_SMS_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) {
      const greetingName = firstName || 'Doctor';
      setMessageText(tpl.body.replace(/\{\{\s*first_name\s*\}\}/g, greetingName));
    }
  };

  const handleOpenNativeSms = () => {
    if (!digitsOnly) {
      setError('Telefone não disponível para envio de SMS.');
      return;
    }

    // Build standard sms: URI
    // iOS and Android support: sms:+1234567890?body=urlencoded_text
    const encodedBody = encodeURIComponent(messageText);
    const smsUri = `sms:${digitsOnly}?body=${encodedBody}`;

    // Log attempt activity (non-blocking)
    void supabase.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'sms_manual_attempt',
      actor_type: 'user',
      summary: 'Aplicativo de SMS nativo aberto para envio manual',
      metadata: {
        channel: 'sms',
        phone: rawPhone,
        template_id: selectedTemplateId,
        opened_at: new Date().toISOString(),
      },
    });

    setHasOpenedApp(true);
    window.open(smsUri, '_self');
  };

  const handleMarkAsSent = async () => {
    setIsRecording(true);
    setError(null);
    try {
      // 1. Record manual SMS sent in lead_activities
      const { error: actErr } = await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'sms_manual_sent',
        actor_type: 'user',
        summary: `SMS enviado manualmente: "${messageText.slice(0, 80)}${messageText.length > 80 ? '...' : ''}"`,
        metadata: {
          channel: 'sms',
          phone: rawPhone,
          template_id: selectedTemplateId,
          content: messageText,
          sent_at: new Date().toISOString(),
        },
      });

      if (actErr) throw actErr;

      // 2. Complete any pending SMS-related task for this lead
      const { data: pendingTasks } = await supabase
        .from('crm_tasks')
        .select('id, title')
        .eq('lead_id', lead.id)
        .eq('status', 'pending');

      if (pendingTasks && pendingTasks.length > 0) {
        const smsTask = pendingTasks.find(
          (t) =>
            t.title.toLowerCase().includes('sms') ||
            t.title.toLowerCase().includes('contato') ||
            t.title.toLowerCase().includes('responder')
        );
        if (smsTask) {
          await supabase
            .from('crm_tasks')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
            })
            .eq('id', smsTask.id);
        }
      }

      // 3. Notify parent to refresh timeline
      if (onSmsRecorded) onSmsRecorded();
      onClose();
    } catch (err: any) {
      console.error('Error recording manual SMS:', err);
      setError(err.message || 'Erro ao registrar envio do SMS.');
    } finally {
      setIsRecording(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/80">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">SMS Manual Assistido</h3>
              <p className="text-[11px] text-slate-500">Envio seguro via aparelho celular pessoal ou T-Mobile</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Lead info banner */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Destinatário</span>
              <span className="font-semibold text-slate-800">
                {lead.first_name} {lead.last_name}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Telefone</span>
              <span className="font-mono font-medium text-slate-700 flex items-center gap-1 justify-end">
                <Phone className="w-3 h-3 text-slate-400" />
                {rawPhone || 'Não informado'}
              </span>
            </div>
          </div>

          {/* Contact preference note */}
          {lead.contact_preference === 'sms' && (
            <div className="p-2.5 rounded-lg bg-blue-50/80 border border-blue-200/60 text-xs text-blue-800 flex items-center gap-2">
              <Clock className="w-4 h-4 shrink-0 text-blue-600" />
              <span>Lead indicou preferência por contato via <strong>SMS</strong>.</span>
            </div>
          )}

          {/* Template Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Modelo de Mensagem
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              {DEFAULT_SMS_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Message Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Mensagem (Editável)
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                {messageText.length} caracteres
              </span>
            </div>
            <textarea
              rows={5}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Digite o texto do SMS..."
              className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-sans leading-relaxed"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Você pode personalizar a mensagem livremente antes de abrir no aplicativo.
            </p>
          </div>

          {/* Step Guidance */}
          {hasOpenedApp && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-1 animate-in fade-in">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Aplicativo de SMS acionado</span>
              </div>
              <p className="text-[11px] text-emerald-700">
                Após concluir o envio pelo seu aparelho ou computador, clique em <strong>Marcar SMS como enviado</strong> para registrar no histórico.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2">
            {/* Step 1: Open in native SMS */}
            <button
              type="button"
              onClick={handleOpenNativeSms}
              disabled={!digitsOnly || !messageText.trim()}
              className="btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5 disabled:opacity-50"
              title="Abre o aplicativo nativo de SMS com a mensagem preenchida"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
              <span>Abrir no SMS</span>
            </button>

            {/* Step 2: Mark as sent */}
            <button
              type="button"
              onClick={handleMarkAsSent}
              disabled={isRecording || !messageText.trim()}
              className="btn-crimson text-xs px-4 py-2 flex items-center gap-1.5 disabled:opacity-50"
              title="Registra que o SMS foi enviado manualmente e conclui a tarefa pendente"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isRecording ? 'Registrando...' : 'Marcar SMS como enviado'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
