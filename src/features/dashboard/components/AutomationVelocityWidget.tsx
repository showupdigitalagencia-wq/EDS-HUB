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
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
            <Workflow className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">
              Automações & Sequências de Follow-Up
            </h3>
            <p className="text-xs text-gray-500">
              Desempenho de execuções e atribuição confiável de respostas por sequência
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            EXECUÇÃO: PERÍODO
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            ATIVAS: SNAPSHOT
          </span>
        </div>
      </div>

      {/* Top summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Workflow className="w-3.5 h-3.5 text-blue-600" />
            <span>Workflows Ativos</span>
          </div>
          <span className="text-xl font-bold text-gray-900">{active_workflows}</span>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <GitFork className="w-3.5 h-3.5 text-purple-600" />
            <span>Sequences Ativas</span>
          </div>
          <span className="text-xl font-bold text-gray-900">{active_sequences}</span>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Runs Iniciados</span>
          </div>
          <span className="text-xl font-bold text-gray-900">{period_runs_total}</span>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>Runs Concluídos</span>
          </div>
          <span className="text-xl font-bold text-emerald-700">{period_runs_completed}</span>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <XCircle className="w-3.5 h-3.5 text-red-600" />
            <span>Runs com Falha</span>
          </div>
          <span className="text-xl font-bold text-red-600">{period_runs_failed}</span>
        </div>
      </div>

      {/* Sequences Performance Table */}
      <div>
        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
          Performance das Sequências (Atribuição Estrita de Respostas)
        </h4>

        {sequences_performance.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-xs">
            Nenhuma sequência de follow-up cadastrada
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wider font-semibold">
                  <th className="pb-2">Sequência</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-center">Runs Ativos</th>
                  <th className="pb-2 text-center">Runs Concluídos</th>
                  <th className="pb-2 text-center">Outbounds Enviados</th>
                  <th className="pb-2 text-center">Respostas Atribuídas</th>
                  <th className="pb-2 text-right">Taxa de Resposta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sequences_performance.map((seq) => (
                  <tr key={seq.sequence_id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 pr-2 font-semibold text-gray-900">
                      {seq.sequence_name}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          seq.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {seq.status === 'active' ? 'Ativa' : 'Pausada'}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center font-medium text-gray-700">
                      {seq.active_runs}
                    </td>
                    <td className="py-3 px-2 text-center font-medium text-emerald-700">
                      {seq.completed_runs}
                    </td>
                    <td className="py-3 px-2 text-center font-medium text-gray-900">
                      {seq.outbound_sent}
                    </td>
                    <td className="py-3 px-2 text-center font-bold text-purple-700">
                      {seq.replies_attributed}
                    </td>
                    <td className="py-3 pl-2 text-right font-bold text-indigo-700">
                      {formatRate(seq.reply_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-gray-100 text-[11px] text-gray-400 mt-4">
        Respostas só são atribuídas quando há vínculo direto comprovado (mensagem enviada pela sequência anterior à resposta).
      </div>
    </div>
  );
};
