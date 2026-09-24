import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Mail,
  CheckCircle2,
  Ban,
  AlertOctagon,
  Info,
} from 'lucide-react';
import type { DeliverabilityHealthSummary } from '../services/deliverability-health-service';

interface EmailHealthCardProps {
  summary: DeliverabilityHealthSummary | null;
  loading?: boolean;
}

export const EmailHealthCard: React.FC<EmailHealthCardProps> = ({
  summary,
  loading = false,
}) => {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs animate-pulse">
        <div className="h-6 w-48 bg-slate-200 rounded mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const {
    level = 'Dados insuficientes',
    levelExplanation = '',
    metrics = { sent: 0, delivered: 0, bounced: 0, complaints: 0, failed: 0, suppressed: 0 },
    rates = { deliveryRate: null, bounceRate: null, complaintRate: null, failureRate: null },
  } = summary || {};

  const getLevelBadge = (lvl: string) => {
    switch (lvl) {
      case 'Excelente':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          dot: 'bg-emerald-500',
          icon: ShieldCheck,
        };
      case 'Saudável':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          dot: 'bg-emerald-500',
          icon: ShieldCheck,
        };
      case 'Atenção':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          dot: 'bg-amber-500',
          icon: AlertTriangle,
        };
      case 'Risco':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-200',
          dot: 'bg-rose-500',
          icon: ShieldAlert,
        };
      case 'Crítico':
        return {
          bg: 'bg-red-100 text-[#8a1c1c] border-red-300',
          dot: 'bg-[#8a1c1c]',
          icon: AlertOctagon,
        };
      default:
        return {
          bg: 'bg-slate-100 text-slate-700 border-slate-200',
          dot: 'bg-slate-400',
          icon: Info,
        };
    }
  };

  const badge = getLevelBadge(level);
  const StatusIcon = badge.icon;
  const hasSpamAlert = metrics.complaints > 0;
  const isHighRisk = level === 'Risco' || level === 'Crítico';

  return (
    <div
      id="email-health-card"
      className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between"
    >
      <div>
        {/* Header with Title and Level Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Saúde do E-mail
                </h3>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">
                  (Últimos 30 dias)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Métricas factuais de entrega e proteção da reputação de domínio
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              id="email-health-level-badge"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${badge.bg}`}
            >
              <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
              <StatusIcon className="w-3.5 h-3.5" />
              <span>{level}</span>
            </span>
          </div>
        </div>

        {/* High Priority Spam Complaint Alert Banner */}
        {hasSpamAlert && (
          <div
            id="spam-complaint-alert"
            className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 flex items-start gap-2.5"
          >
            <AlertOctagon className="w-4 h-4 text-[#8a1c1c] mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-xs">
              <strong className="font-bold text-[#8a1c1c] block">
                {metrics.complaints === 1
                  ? 'Alerta: uma reclamação de spam foi registrada.'
                  : `Alerta: ${metrics.complaints} reclamações de spam foram registradas.`}
              </strong>
              <p className="mt-0.5 text-rose-800">
                O remetente afetado foi suprimido automaticamente para proteger a reputação do domínio.
              </p>
            </div>
          </div>
        )}

        {/* High Risk Deliverability Alert Banner */}
        {isHighRisk && !hasSpamAlert && (
          <div
            id="deliverability-risk-alert"
            className="mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-xs">
              <strong className="font-bold text-amber-900 block">
                Proteção de reputação de domínio ativada ({level})
              </strong>
              <p className="mt-0.5 text-amber-800">
                Indicadores de bounce ou falhas técnicas em nível de atenção. Envios em lote preventivamente pausados.
              </p>
            </div>
          </div>
        )}

        {/* Factual Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 my-2">
          {/* Enviados */}
          <div className="p-3 rounded-xl border border-slate-200/80 bg-[#f8fafc]">
            <span className="text-[11px] text-slate-500 font-medium block">Enviados</span>
            <span className="text-xl font-extrabold text-[#08254f] font-heading mt-1 block">
              {metrics.sent.toLocaleString('pt-BR')}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Total no período</span>
          </div>

          {/* Entregues */}
          <div className="p-3 rounded-xl border border-emerald-200/80 bg-emerald-50/30">
            <span className="text-[11px] text-emerald-800 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              Entregues
            </span>
            <span className="text-xl font-extrabold text-emerald-900 font-heading mt-1 block">
              {metrics.delivered.toLocaleString('pt-BR')}
            </span>
            <span className="text-[10px] text-emerald-700 font-medium mt-0.5 block">
              {rates.deliveryRate !== null ? `${rates.deliveryRate}% taxa` : '—'}
            </span>
          </div>

          {/* Falhas */}
          <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/50">
            <span className="text-[11px] text-slate-600 font-medium block">Falhas</span>
            <span className="text-xl font-extrabold text-slate-800 font-heading mt-1 block">
              {metrics.failed.toLocaleString('pt-BR')}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {rates.failureRate !== null && rates.failureRate > 0 ? `${rates.failureRate}% taxa` : 'Sem falhas'}
            </span>
          </div>

          {/* Bounces */}
          <div className={`p-3 rounded-xl border ${metrics.bounced > 0 ? 'border-amber-200/80 bg-amber-50/40' : 'border-slate-200/80 bg-[#f8fafc]'}`}>
            <span className="text-[11px] text-amber-800 font-semibold block">Bounces</span>
            <span className="text-xl font-extrabold text-amber-900 font-heading mt-1 block">
              {metrics.bounced.toLocaleString('pt-BR')}
            </span>
            <span className="text-[10px] text-amber-700 font-medium mt-0.5 block">
              {rates.bounceRate !== null && rates.bounceRate > 0 ? `${rates.bounceRate}% taxa` : 'Zero bounces'}
            </span>
          </div>

          {/* Reclamações de Spam */}
          <div className={`p-3 rounded-xl border ${metrics.complaints > 0 ? 'border-rose-300 bg-rose-50/60' : 'border-slate-200/80 bg-[#f8fafc]'}`}>
            <span className="text-[11px] text-[#8a1c1c] font-semibold block">Reclamações de Spam</span>
            <span className={`text-xl font-extrabold font-heading mt-1 block ${metrics.complaints > 0 ? 'text-[#8a1c1c]' : 'text-slate-800'}`}>
              {metrics.complaints.toLocaleString('pt-BR')}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {metrics.complaints === 0 ? 'Zero reclamações' : 'Crítico'}
            </span>
          </div>

          {/* Suprimidos */}
          <div className="p-3 rounded-xl border border-slate-200/80 bg-[#f8fafc]">
            <span className="text-[11px] text-slate-600 font-semibold flex items-center gap-1">
              <Ban className="w-3 h-3 text-slate-500" />
              Suprimidos
            </span>
            <span className="text-xl font-extrabold text-slate-800 font-heading mt-1 block">
              {metrics.suppressed.toLocaleString('pt-BR')}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Total no sistema</span>
          </div>
        </div>

        {/* Explainable note / status description */}
        <p className="text-xs text-slate-600 mt-3">
          {levelExplanation || 'Indicadores de entrega avaliados com base em eventos factuais de provedor.'}
        </p>
      </div>

      {/* Footer Notes & Future Google Postmaster Extension */}
      <div className="pt-4 mt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>
            Status &quot;Entregue&quot; confirma o recebimento pelo servidor de destino, mas não garante a pasta de entrada.
          </span>
        </span>
        <span className="text-slate-400 italic">
          Google Postmaster: extensão futura preparada
        </span>
      </div>
    </div>
  );
};
