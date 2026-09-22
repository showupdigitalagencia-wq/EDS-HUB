import {
  Phone,
  MessageSquare,
  Mail,
  PlusCircle,
  CalendarCheck,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { Lead } from '../../../types';
import { WhatsAppIcon } from '../../../components/icons/WhatsAppIcon';

interface LeadQuickActionBarProps {
  lead: Lead;
  onOpenTaskModal: () => void;
  onOpenPaymentModal: () => void;
  onActivityLogged?: () => void;
}

export function LeadQuickActionBar({
  lead,
  onOpenTaskModal,
  onOpenPaymentModal,
  onActivityLogged,
}: LeadQuickActionBarProps) {
  const rawPhone = lead.phone_e164 || lead.phone_raw || '';
  const digitsOnly = rawPhone.replace(/\D/g, '');
  const hasPhone = Boolean(rawPhone.trim() && digitsOnly.length >= 8);

  const cleanEmail = lead.email ? lead.email.trim() : '';
  const isValidEmail = Boolean(cleanEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail));

  // Canonical intent logger — completely NON-BLOCKING & best-effort
  // Must NEVER block navigation or user interaction even if network fails
  const logIntentNonBlocking = (
    activityType: 'call_manual_attempt' | 'whatsapp_contact_attempt' | 'email_manual_attempt' | 'sms_manual_attempt',
    summary: string,
    channel: 'call' | 'whatsapp' | 'email' | 'sms',
  ) => {
    try {
      void Promise.resolve(
        supabase
          .from('lead_activities')
          .insert({
            lead_id: lead.id,
            activity_type: activityType,
            actor_type: 'user',
            summary,
            metadata: {
              channel,
              manual: true,
              timestamp: new Date().toISOString(),
            },
          })
      )
        .then(() => {
          if (onActivityLogged) onActivityLogged();
        })
        .catch(() => {
          // Non-fatal audit log failure — navigation must not be interrupted
        });
    } catch {
      // Non-fatal guard
    }
  };

  const actionBaseClass =
    'inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl border transition-all duration-150 select-none min-h-[40px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#449bd5]';

  const commButtonActive =
    'bg-white hover:bg-slate-50 text-[#08254f] border-slate-200 shadow-2xs hover:border-slate-300 hover:shadow-xs active:translate-y-0.5 cursor-pointer';

  const commButtonDisabled =
    'bg-slate-50 text-slate-400 border-slate-200/60 opacity-50 cursor-not-allowed';

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 shadow-2xs space-y-2.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* GROUP 1: Direct Communication (Ligar, SMS, Email, WhatsApp) */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Comunicação
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* 1. Ligar */}
            {hasPhone ? (
              <a
                href={`tel:${rawPhone.trim()}`}
                role="button"
                onClick={() => logIntentNonBlocking('call_manual_attempt', 'Ligação iniciada', 'call')}
                title={`Ligar para ${rawPhone}`}
                className={`${actionBaseClass} ${commButtonActive}`}
              >
                <Phone className="h-4 w-4 text-[#449bd5] shrink-0" />
                <span>Ligar</span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Telefone não informado"
                className={`${actionBaseClass} ${commButtonDisabled}`}
              >
                <Phone className="h-4 w-4 text-slate-300 shrink-0" />
                <span>Ligar</span>
              </button>
            )}

            {/* 2. SMS */}
            {hasPhone ? (
              <a
                href={`sms:${rawPhone.trim()}`}
                role="button"
                onClick={() => logIntentNonBlocking('sms_manual_attempt', 'SMS aberto para contato', 'sms')}
                title={`Enviar SMS para ${rawPhone}`}
                className={`${actionBaseClass} ${commButtonActive}`}
              >
                <MessageSquare className="h-4 w-4 text-[#449bd5] shrink-0" />
                <span>SMS</span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Telefone não informado"
                className={`${actionBaseClass} ${commButtonDisabled}`}
              >
                <MessageSquare className="h-4 w-4 text-slate-300 shrink-0" />
                <span>SMS</span>
              </button>
            )}

            {/* 3. Email — Fixed mailto & non-blocking logging */}
            {isValidEmail ? (
              <a
                href={`mailto:${cleanEmail}`}
                role="button"
                onClick={() => logIntentNonBlocking('email_manual_attempt', 'Email aberto para contato', 'email')}
                title={`Enviar email para ${cleanEmail}`}
                className={`${actionBaseClass} ${commButtonActive}`}
              >
                <Mail className="h-4 w-4 text-[#449bd5] shrink-0" />
                <span>Email</span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Email não informado"
                className={`${actionBaseClass} ${commButtonDisabled}`}
              >
                <Mail className="h-4 w-4 text-slate-300 shrink-0" />
                <span>Email</span>
              </button>
            )}

            {/* 4. WhatsApp — Official recognizable glyph */}
            {hasPhone ? (
              <a
                href={`https://wa.me/${digitsOnly}`}
                target="_blank"
                rel="noopener noreferrer"
                role="button"
                onClick={() => logIntentNonBlocking('whatsapp_contact_attempt', 'WhatsApp aberto', 'whatsapp')}
                title={`Abrir WhatsApp para ${digitsOnly}`}
                className={`${actionBaseClass} bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-900 border-emerald-200/80 hover:border-emerald-300 shadow-2xs cursor-pointer`}
              >
                <WhatsAppIcon className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>WhatsApp</span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Telefone não informado"
                className={`${actionBaseClass} ${commButtonDisabled}`}
              >
                <WhatsAppIcon className="h-4 w-4 text-slate-300 shrink-0" />
                <span>WhatsApp</span>
              </button>
            )}
          </div>
        </div>

        {/* Divider on large screens */}
        <div className="hidden lg:block w-px h-10 bg-slate-200/80 self-end mb-1" />

        {/* GROUP 2: Operational Actions (Adicionar Tarefa, Pagamento) */}
        <div className="lg:w-auto">
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Operacional
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {/* 5. Adicionar Tarefa */}
            <button
              type="button"
              onClick={onOpenTaskModal}
              title="Adicionar nova tarefa para este lead"
              className={`${actionBaseClass} bg-slate-50 hover:bg-slate-100 text-[#08254f] border-slate-200/90 shadow-2xs hover:border-slate-300 cursor-pointer`}
            >
              <PlusCircle className="h-4 w-4 text-[#08254f] shrink-0" />
              <span className="truncate">Adicionar Tarefa</span>
            </button>

            {/* 6. Pagamento (Task Reminder Semantics) */}
            <button
              type="button"
              onClick={onOpenPaymentModal}
              title="Agendar lembrete operacional de pagamento"
              className={`${actionBaseClass} bg-amber-50/70 hover:bg-amber-100/80 text-amber-900 border-amber-200/80 hover:border-amber-300 shadow-2xs cursor-pointer`}
            >
              <CalendarCheck className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="truncate">Pagamento</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
