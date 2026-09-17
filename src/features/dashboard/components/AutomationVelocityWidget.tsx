import React from 'react';
import { Workflow, GitFork, CheckCircle, XCircle, Clock } from 'lucide-react';
import type { DashboardAutomationMetrics } from '../../../types/database';
import { formatRate } from '../services/dashboard-service';

interface AutomationVelocityWidgetProps {
  automation: DashboardAutomationMetrics;
}

export const AutomationVelocityWidget: React.FC<AutomationVelocityWidgetProps> = ({
  automation,
}) => {
  const {
    active_workflows,
    active_sequences,
    period_runs_total,
    period_runs_completed,
    period_runs_failed,
    sequences_performance,
  } = automation;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
            <Workflow className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#08254f] font-heading">
              Automações & Sequências de Follow-Up
            </h3>
            <p className="text-xs text-slate-500">
              Desempenho de execuções e atribuição confiável de respostas por sequência
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 uppercase tracking-wider">
            EXECUÇÃO: PERÍODO
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
            ATIVAS: SNAPSHOT
          </span>
        </div>
      </div>

      {/* Top summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="p-3.5 bg-[#f8fafc] rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Workflow className="w-3.5 h-3.5 text-[#125e95]" />
            <span className="font-medium">Workflows Ativos</span>
          </div>
          <span className="text-xl font-extrabold text-[#08254f] font-heading">{active_workflows}</span>
        </div>

        <div className="p-3.5 bg-[#f8fafc] rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <GitFork className="w-3.5 h-3.5 text-[#08254f]" />
            <span className="font-medium">Sequences Ativas</span>
          </div>
          <span className="text-xl font-extrabold text-[#08254f] font-heading">{active_sequences}</span>
        </div>

        <div className="p-3.5 bg-[#f8fafc] rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span className="font-medium">Runs Iniciados</span>
          </div>
          <span className="text-xl font-extrabold text-[#08254f] font-heading">{period_runs_total}</span>
        </div>

        <div className="p-3.5 bg-emerald-50/40 rounded-xl border border-emerald-100">
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold">Runs Concluídos</span>
          </div>
          <span className="text-xl font-extrabold text-emerald-800 font-heading">{period_runs_completed}</span>
        </div>

        <div className="p-3.5 bg-rose-50/40 rounded-xl border border-rose-100">
          <div className="flex items-center gap-1.5 text-xs text-[#8a1c1c] mb-1">
            <XCircle className="w-3.5 h-3.5 text-[#8a1c1c]" />
            <span className="font-semibold">Runs com Falha</span>
          </div>
          <span className="text-xl font-extrabold text-[#8a1c1c] font-heading">{period_runs_failed}</span>
        </div>
      </div>

      {/* Sequences Performance Table */}
      <div>
        <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-3">
          Performance das Sequências (Atribuição Estrita de Respostas)
        </h4>

        {sequences_performance.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            Nenhuma sequência de follow-up cadastrada
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-2.5">Sequência</th>
                  <th className="pb-2.5">Status</th>
                  <th className="pb-2.5 text-center">Runs Ativos</th>
                  <th className="pb-2.5 text-center">Runs Concluídos</th>
                  <th className="pb-2.5 text-center">Outbounds Enviados</th>
                  <th className="pb-2.5 text-center">Respostas Atribuídas</th>
                  <th className="pb-2.5 text-right">Taxa de Resposta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/70">
                {sequences_performance.map((seq) => (
                  <tr key={seq.sequence_id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3 pr-2 font-semibold text-slate-900 group-hover:text-[#08254f] transition-colors">
                      {seq.sequence_name}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                          seq.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {seq.status === 'active' ? 'Ativa' : 'Pausada'}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center font-semibold text-slate-700">
                      {seq.active_runs}
                    </td>
                    <td className="py-3 px-2 text-center font-bold text-emerald-700">
                      {seq.completed_runs}
                    </td>
                    <td className="py-3 px-2 text-center font-semibold text-[#08254f]">
                      {seq.outbound_sent}
                    </td>
                    <td className="py-3 px-2 text-center font-bold text-purple-700">
                      {seq.replies_attributed}
                    </td>
                    <td className="py-3 pl-2 text-right">
                      <span className="font-bold text-[#08254f] bg-[#e1f0fb] px-2 py-0.5 rounded-md border border-[#b4cdeb]">
                        {formatRate(seq.reply_rate)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400 mt-4">
        Respostas só são atribuídas quando há vínculo direto comprovado (mensagem enviada pela sequência anterior à resposta).
      </div>
    </div>
  );
};
