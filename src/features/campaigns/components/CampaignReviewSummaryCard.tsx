import type { CampaignStatus, CampaignAttachment } from '../../../types';
import {
  Users,
  CheckCircle2,
  XCircle,
  Mail,
  Calendar,
  Paperclip,
  Check,
  Clock,
  RotateCw,
} from 'lucide-react';

interface CampaignReviewSummaryCardProps {
  templateName?: string | null;
  subject: string;
  fromName: string;
  fromEmail?: string;
  totalMatched: number;
  eligibleCount: number;
  excludedCount: number;
  courseName?: string | null;
  stageName?: string | null;
  sessionDate?: string | null;
  attachment: CampaignAttachment | null;
  status: CampaignStatus;
}

export function CampaignReviewSummaryCard({
  templateName,
  subject,
  fromName,
  fromEmail = 'info@expdentalsolutions.com',
  totalMatched,
  eligibleCount,
  excludedCount,
  courseName,
  stageName,
  sessionDate,
  attachment,
  status,
}: CampaignReviewSummaryCardProps) {
  const getStatusBadge = (st: CampaignStatus) => {
    switch (st) {
      case 'draft':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-700">
            Rascunho
          </span>
        );
      case 'pending_approval':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-900 flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-700" /> Aguardando Aprovação
          </span>
        );
      case 'approved':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-blue-100 text-blue-900 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-blue-700" /> Aprovada
          </span>
        );
      case 'scheduled':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-purple-100 text-purple-900 flex items-center gap-1">
            <Calendar className="w-3 h-3 text-purple-700" /> Agendada
          </span>
        );
      case 'sending':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-900 flex items-center gap-1">
            <RotateCw className="w-3 h-3 animate-spin text-indigo-700" /> Enviando
          </span>
        );
      case 'sent':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-900 flex items-center gap-1">
            <Check className="w-3 h-3 text-emerald-700" /> Concluída / Enviada
          </span>
        );
      case 'failed':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-900 flex items-center gap-1">
            <XCircle className="w-3 h-3 text-rose-700" /> Falhou
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-700">
            {st}
          </span>
        );
    }
  };

  return (
    <div className="card-executive p-6 space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-base font-bold text-[#08254f] font-heading flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#449bd5]" />
            Resumo da Campanha
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Revise todos os parâmetros operacionais antes de submeter para aprovação ou disparo.
          </p>
        </div>
        <div>{getStatusBadge(status)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
        {/* Template */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Template
          </span>
          <p className="font-bold text-slate-900 truncate">
            {templateName || 'Personalizado (Sem template de biblioteca)'}
          </p>
        </div>

        {/* Assunto */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Assunto
          </span>
          <p className="font-bold text-slate-900 truncate" title={subject}>
            {subject || '(Nenhum assunto definido)'}
          </p>
        </div>

        {/* Remetente */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Remetente
          </span>
          <p className="font-bold text-slate-900 truncate">
            {fromName || 'Expert Dental Solutions'} &lt;{fromEmail}&gt;
          </p>
        </div>

        {/* Destinatários selecionados */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Destinatários Selecionados
          </span>
          <p className="text-base font-black text-slate-900 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-500" />
            {totalMatched} contatos
          </p>
        </div>

        {/* Elegíveis */}
        <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
            Elegíveis para Email
          </span>
          <p className="text-base font-black text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {eligibleCount} leads prontos
          </p>
        </div>

        {/* Excluídos */}
        <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">
            Excluídos da Lista
          </span>
          <p className="text-base font-black text-rose-800 flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-rose-600" />
            {excludedCount} contatos
          </p>
        </div>

        {/* Curso */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Curso
          </span>
          <p className="font-bold text-slate-900 truncate">
            {courseName || 'Todos os cursos'}
          </p>
        </div>

        {/* Etapa */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Etapa do Funil
          </span>
          <p className="font-bold text-slate-900 truncate">
            {stageName || 'Todas as etapas'}
          </p>
        </div>

        {/* Turma / Data */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Turma / Data
          </span>
          <p className="font-bold text-slate-900 truncate">
            {sessionDate || 'Todas as turmas'}
          </p>
        </div>

        {/* Anexo */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1 md:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Anexo / Material em PDF
          </span>
          <div className="flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
            {attachment ? (
              <span className="font-bold text-slate-900 truncate">
                {attachment.filename} ({attachment.size ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB` : 'PDF'})
              </span>
            ) : (
              <span className="text-slate-400 italic">Nenhum arquivo anexado</span>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Status Atual
          </span>
          <div className="pt-0.5">{getStatusBadge(status)}</div>
        </div>
      </div>
    </div>
  );
}
