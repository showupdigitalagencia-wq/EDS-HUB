import { useState } from 'react';
import {
  Phone,
  MessageSquare,
  Mail,
  PlusCircle,
  CalendarCheck,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { Lead } from '../../../types';

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
  const [loggingAction, setLoggingAction] = useState<string | null>(null);

  const rawPhone = lead.phone_e164 || lead.phone_raw || '';
  const digitsOnly = rawPhone.replace(/\D/g, '');
  const hasPhone = Boolean(rawPhone.trim() && digitsOnly.length >= 8);
  const hasEmail = Boolean(lead.email && lead.email.trim());

  // Canonical intent logger — does NOT change stage or pretend delivery
  const logIntent = async (
    activityType: 'call_manual_attempt' | 'whatsapp_contact_attempt' | 'email_manual_attempt' | 'sms_manual_attempt',
    summary: string,
    channel: 'call' | 'whatsapp' | 'email' | 'sms',
  ) => {
    try {
      setLoggingAction(channel);
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: activityType,
        actor_type: 'user',
        summary,
        metadata: {
          channel,
          manual: true,
          timestamp: new Date().toISOString(),
        },
      });
      if (onActivityLogged) onActivityLogged();
    } catch {
      // Non-fatal audit log failure
    } finally {
      setLoggingAction(null);
    }
  };

  const handleCall = () => {
    if (!hasPhone) return;
    logIntent('call_manual_attempt', 'Ligação iniciada', 'call');
    window.location.href = `tel:${rawPhone.trim()}`;
  };

  const handleSms = () => {
    if (!hasPhone) return;
    logIntent('sms_manual_attempt', 'SMS aberto para contato', 'sms');
    window.location.href = `sms:${rawPhone.trim()}`;
  };

  const handleEmail = () => {
    if (!hasEmail) return;
    logIntent('email_manual_attempt', 'Email aberto para contato', 'email');
    window.location.href = `mailto:${lead.email!.trim()}`;
  };

  const handleWhatsApp = () => {
    if (!hasPhone) return;
    logIntent('whatsapp_contact_attempt', 'WhatsApp aberto', 'whatsapp');
    window.open(`https://wa.me/${digitsOnly}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-2.5 shadow-xs">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap items-center gap-2">
        {/* 1. Ligar */}
        <button
          type="button"
          onClick={handleCall}
          disabled={!hasPhone || loggingAction === 'call'}
          title={hasPhone ? `Ligar para ${rawPhone}` : 'Telefone não cadastrado'}
          className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-2 select-none disabled:opacity-40 disabled:cursor-not-allowed bg-slate-50 hover:bg-slate-100/80 text-[#08254f] border-slate-200"
        >
          <Phone className="h-4 w-4 text-[#449bd5] shrink-0" />
          <span>Ligar</span>
        </button>

        {/* 2. SMS */}
        <button
          type="button"
          onClick={handleSms}
          disabled={!hasPhone || loggingAction === 'sms'}
          title={hasPhone ? `Enviar SMS para ${rawPhone}` : 'Telefone não cadastrado'}
          className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-2 select-none disabled:opacity-40 disabled:cursor-not-allowed bg-slate-50 hover:bg-slate-100/80 text-[#08254f] border-slate-200"
        >
          <MessageSquare className="h-4 w-4 text-[#449bd5] shrink-0" />
          <span>SMS</span>
        </button>

        {/* 3. Email */}
        <button
          type="button"
          onClick={handleEmail}
          disabled={!hasEmail || loggingAction === 'email'}
          title={hasEmail ? `Enviar email para ${lead.email}` : 'Email não cadastrado'}
          className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-2 select-none disabled:opacity-40 disabled:cursor-not-allowed bg-slate-50 hover:bg-slate-100/80 text-[#08254f] border-slate-200"
        >
          <Mail className="h-4 w-4 text-[#449bd5] shrink-0" />
          <span>Email</span>
        </button>

        {/* 4. WhatsApp */}
        <button
          type="button"
          onClick={handleWhatsApp}
          disabled={!hasPhone || loggingAction === 'whatsapp'}
          title={hasPhone ? `Abrir WhatsApp para ${digitsOnly}` : 'Telefone inválido para WhatsApp'}
          className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-2 select-none disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border-emerald-200"
        >
          <span className="font-bold text-emerald-600 text-sm leading-none">💬</span>
          <span>WhatsApp</span>
        </button>

        {/* 5. Adicionar Tarefa */}
        <button
          type="button"
          onClick={onOpenTaskModal}
          className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-2 select-none bg-indigo-50/70 hover:bg-indigo-100 text-[#08254f] border-indigo-200/80"
        >
          <PlusCircle className="h-4 w-4 text-indigo-600 shrink-0" />
          <span>Adicionar Tarefa</span>
        </button>

        {/* 6. Pagamento (Task Reminder) */}
        <button
          type="button"
          onClick={onOpenPaymentModal}
          title="Agendar lembrete de pagamento"
          className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-2 select-none bg-amber-50 hover:bg-amber-100/80 text-amber-900 border-amber-200"
        >
          <CalendarCheck className="h-4 w-4 text-amber-600 shrink-0" />
          <span>Pagamento</span>
        </button>
      </div>
    </div>
  );
}
