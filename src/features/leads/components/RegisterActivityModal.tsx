// =============================================================================
// EDS HUB — Modal: Registrar Atividade Manual (Factual CRM History)
// =============================================================================
// Allows operators to register external / historical contact events in the lead
// timeline (e.g. leads arriving via HubSpot already contacted outside EDS HUB).
//
// Rules:
// 1. Factual CRM history only — NEVER sends emails or SMS automatically.
// 2. Supports at minimum:
//    - E-mail enviado (manual_email_sent)
//    - SMS enviado (manual_sms_sent)
//    - Ligação realizada (manual_call_logged)
//    - WhatsApp enviado (manual_whatsapp_sent)
//    - Contato realizado (manual_contact_made)
//    - Observação / Outro (manual_activity_logged)
// 3. User attribution: records operator name, ID, and email in metadata.
// 4. Performed at timestamp: user-editable date/time with current time default.
// 5. Pipeline safety: never silently changes stage.
//    Optional explicit checkbox: "Registrar atividade e mover para Respondido".
//    When checked, records activity first, then transitions Novo Lead -> Respondido.
// =============================================================================

import { useState, useEffect } from 'react';
import {
  ClipboardList,
  Mail,
  MessageSquare,
  Phone,
  CheckCheck,
  FileText,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../auth/AuthProvider';
import type { Lead } from '../../../types';
import { WhatsAppIcon } from '../../../components/icons/WhatsAppIcon';

export interface RegisterActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead;
  onActivityRegistered?: () => void;
}

export interface ActivityTypeOption {
  value: string;
  label: string;
  channel: 'email' | 'sms' | 'call' | 'whatsapp' | null;
  description: string;
}

export const MANUAL_ACTIVITY_OPTIONS: ActivityTypeOption[] = [
  {
    value: 'manual_email_sent',
    label: 'E-mail enviado',
    channel: 'email',
    description: 'E-mail enviado ao lead externamente (ex: Outlook, Gmail, HubSpot)',
  },
  {
    value: 'manual_sms_sent',
    label: 'SMS enviado',
    channel: 'sms',
    description: 'SMS enviado diretamente via celular ou gateway externo',
  },
  {
    value: 'manual_call_logged',
    label: 'Ligação realizada',
    channel: 'call',
    description: 'Chamada telefônica efetuada para o lead',
  },
  {
    value: 'manual_whatsapp_sent',
    label: 'WhatsApp enviado',
    channel: 'whatsapp',
    description: 'Mensagem enviada pelo WhatsApp web/app',
  },
  {
    value: 'manual_contact_made',
    label: 'Contato realizado',
    channel: null,
    description: 'Contato direto estabelecido pessoalmente ou em outro canal',
  },
  {
    value: 'manual_activity_logged',
    label: 'Observação / Outro',
    channel: null,
    description: 'Nota factual relevante sobre o histórico ou reconciliação do lead',
  },
];

function formatLocalDatetimeDefault(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function RegisterActivityModal({
  isOpen,
  onClose,
  lead,
  onActivityRegistered,
}: RegisterActivityModalProps) {
  const { appUser, user } = useAuth();

  const [activityType, setActivityType] = useState<string>('manual_email_sent');
  const [performedAt, setPerformedAt] = useState<string>(formatLocalDatetimeDefault());
  const [note, setNote] = useState<string>('');
  const [moveToRespondido, setMoveToRespondido] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Check if lead is currently in "Novo Lead" (capture stage)
  const isCurrentlyInCapture =
    !lead.pipeline_stage?.code ||
    lead.pipeline_stage.code === 'capture' ||
    lead.pipeline_stage_id === 'stage-capture';

  useEffect(() => {
    if (isOpen) {
      setActivityType('manual_email_sent');
      setPerformedAt(formatLocalDatetimeDefault());
      setNote('');
      setMoveToRespondido(false);
      setError(null);
      setSuccess(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedOption =
    MANUAL_ACTIVITY_OPTIONS.find((opt) => opt.value === activityType) ||
    MANUAL_ACTIVITY_OPTIONS[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setError('Por favor, informe uma descrição ou observação para a atividade.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // 1. Resolve user attribution
      const createdByName =
        appUser?.display_name ||
        user?.user_metadata?.full_name ||
        (appUser?.email ? appUser.email.split('@')[0] : null) ||
        (user?.email ? user.email.split('@')[0] : null) ||
        'Operador';

      const createdById = appUser?.user_id || user?.id || null;
      const createdByEmail = appUser?.email || user?.email || null;

      // 2. Parse performed at date
      const parsedDate = new Date(performedAt);
      const performedAtISO = !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();

      // 3. Insert factual CRM activity into existing lead_activities table
      const activityPayload = {
        lead_id: lead.id,
        activity_type: selectedOption.value,
        channel: selectedOption.channel,
        actor_type: 'user',
        summary: trimmedNote,
        created_at: performedAtISO,
        metadata: {
          manual: true,
          source: 'manual',
          activity_source: 'manual',
          activity_type_label: selectedOption.label,
          activity_note: trimmedNote,
          note: trimmedNote,
          performed_at: performedAtISO,
          registered_at: new Date().toISOString(),
          created_by_name: createdByName,
          created_by_id: createdById,
          created_by_email: createdByEmail,
          advanced_to_respondido: moveToRespondido && isCurrentlyInCapture,
        },
      };

      const { error: actErr } = await supabase
        .from('lead_activities')
        .insert(activityPayload);

      if (actErr) {
        throw new Error(actErr.message || 'Falha ao registrar atividade no banco de dados.');
      }

      // 4. Pipeline Safety: If explicitly requested to move to Respondido (and lead is in capture)
      if (moveToRespondido && isCurrentlyInCapture) {
        try {
          // Resolve qualification stage ID
          const { data: qualStage } = await supabase
            .from('pipeline_stages')
            .select('id, name')
            .eq('code', 'qualification')
            .maybeSingle();

          if (qualStage) {
            // Attempt atomic move_lead_stage RPC
            const { error: rpcErr } = await supabase.rpc('move_lead_stage', {
              p_lead_id: lead.id,
              p_new_stage_id: qualStage.id,
              p_note: `Avançado para Respondido após registro manual: ${selectedOption.label}`,
            });

            // Fallback to direct update if RPC fails
            if (rpcErr) {
              await supabase
                .from('leads')
                .update({
                  pipeline_stage_id: qualStage.id,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', lead.id);

              await supabase.from('lead_stage_history').insert({
                lead_id: lead.id,
                from_stage_id: lead.pipeline_stage_id,
                to_stage_id: qualStage.id,
                change_reason: `Registro manual de atividade: ${selectedOption.label}`,
              });

              await supabase.from('lead_activities').insert({
                lead_id: lead.id,
                activity_type: 'stage_changed',
                actor_type: 'user',
                summary: `Lead avançado de Novo Lead para Respondido após: ${selectedOption.label}`,
                metadata: {
                  from: 'capture',
                  to: 'qualification',
                  reason: 'manual_activity_registered',
                  registered_by: createdByName,
                },
              });
            }
          }
        } catch (stageErr) {
          console.warn('[RegisterActivity] Non-fatal stage advancement warning:', stageErr);
        }
      }

      setSuccess(true);

      // 5. Dispatch global refresh events
      window.dispatchEvent(
        new CustomEvent('lead-updated', {
          detail: { leadId: lead.id },
        })
      );
      window.dispatchEvent(
        new CustomEvent('lead_updated', {
          detail: { leadId: lead.id },
        })
      );

      if (onActivityRegistered) {
        onActivityRegistered();
      }

      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível registrar a atividade.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getActivityOptionIcon = (val: string) => {
    switch (val) {
      case 'manual_email_sent':
        return <Mail className="w-4 h-4 text-indigo-500" />;
      case 'manual_sms_sent':
        return <MessageSquare className="w-4 h-4 text-sky-500" />;
      case 'manual_call_logged':
        return <Phone className="w-4 h-4 text-[#449bd5]" />;
      case 'manual_whatsapp_sent':
        return <WhatsAppIcon className="w-4 h-4 text-emerald-600" />;
      case 'manual_contact_made':
        return <CheckCheck className="w-4 h-4 text-teal-600" />;
      default:
        return <FileText className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-activity-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#061a38]/40 backdrop-blur-xs p-0 sm:p-4 overflow-hidden"
    >
      <div className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full max-w-lg h-full sm:h-auto sm:max-h-[92vh] flex flex-col border border-slate-200/80">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 text-[#08254f] border border-blue-100">
              <ClipboardList className="h-5 w-5 text-[#449bd5]" />
            </div>
            <div>
              <h2
                id="register-activity-title"
                className="text-base font-bold text-[#08254f] font-heading"
              >
                Registrar Atividade
              </h2>
              <p className="text-xs text-slate-500">
                Histórico factual do CRM para contatos realizados fora do EDS HUB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Informational CRM Banner */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-xs text-slate-600 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-[#449bd5] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Este registro adiciona um evento ao histórico do lead na linha do tempo. <strong>Nenhuma mensagem ou e-mail será disparado automaticamente.</strong>
            </p>
          </div>

          {/* Lead Details Banner */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                Lead
              </span>
              <span className="font-semibold text-slate-800">
                {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead sem nome'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                Etapa Atual
              </span>
              <span className="font-medium text-slate-700">
                {lead.pipeline_stage?.name || 'Novo Lead'}
              </span>
            </div>
          </div>

          {/* Activity Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Tipo de Atividade <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-xs font-medium border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
              >
                {MANUAL_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="absolute left-3 top-3 pointer-events-none">
                {getActivityOptionIcon(activityType)}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {selectedOption.description}
            </p>
          </div>

          {/* Date & Time Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Data e Hora do Ocorrido</span>
            </label>
            <input
              type="datetime-local"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
            />
            <span className="text-[10px] text-slate-400 block mt-1">
              Padrão é a hora atual. Você pode alterar se o contato foi realizado antes.
            </span>
          </div>

          {/* Note / Description Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Descrição / Observação <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                {note.length} caracteres
              </span>
            </div>
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: Lead veio do HubSpot após o contato. E-mail com informações do curso já enviado e SMS inicial realizado anteriormente."
              className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5] leading-relaxed"
              required
            />
          </div>

          {/* Pipeline Safety / Optional Stage Move */}
          {isCurrentlyInCapture && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={moveToRespondido}
                  onChange={(e) => setMoveToRespondido(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#08254f] focus:ring-[#449bd5]"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-800 block">
                    Registrar atividade e mover para Respondido
                  </span>
                  <span className="text-slate-500 text-[11px] block mt-0.5 leading-relaxed">
                    Registra a atividade primeiro e avança a etapa do lead de{' '}
                    <strong>Novo Lead</strong> para <strong>Respondido</strong>. Ambos os eventos serão preservados na linha do tempo.
                  </span>
                </div>
              </label>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Atividade registrada com sucesso no histórico do lead!</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !note.trim()}
              data-testid="submit-register-activity"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#08254f] hover:bg-[#061a38] rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Registrando...</span>
                </>
              ) : (
                <>
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>
                    {moveToRespondido && isCurrentlyInCapture
                      ? 'Registrar e Avançar Etapa'
                      : 'Registrar Atividade'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
