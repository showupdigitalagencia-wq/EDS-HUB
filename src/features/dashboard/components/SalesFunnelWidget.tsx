import React from 'react';
import { Filter, ArrowRight, Info, HelpCircle } from 'lucide-react';
import type { DashboardPipelineMetrics, DashboardQualificationMetrics } from '../../../types/database';
import { formatRate } from '../services/dashboard-service';

interface SalesFunnelWidgetProps {
  pipeline: DashboardPipelineMetrics;
  qualification: DashboardQualificationMetrics;
  onExportPipeline?: () => void;
}

export const SalesFunnelWidget: React.FC<SalesFunnelWidgetProps> = ({
  pipeline,
  qualification,
  onExportPipeline,
}) => {
  const { funnel, current_distribution, movements_in_period } = pipeline;

  // Find max leads entered in funnel to scale bars
  const maxEntered = Math.max(...funnel.map((f) => f.unique_leads_entered), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 1. Commercial Sales Funnel (Cohort-Based) */}
      <div className="lg:col-span-7 bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                <Filter className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Funil Comercial de Vendas
                </h3>
                <p className="text-xs text-gray-500">
                  Conversão estrita por cohort de entrada no período
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                PERÍODO (COHORT)
              </span>
              {onExportPipeline && (
                <button
                  type="button"
                  onClick={onExportPipeline}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                >
                  Exportar CSV
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 p-2.5 rounded-lg bg-gray-50 border border-gray-100 flex items-start gap-2">
            <Info className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-gray-600 leading-relaxed">
              <strong>Regra de Cohort:</strong> Para cada estágio, o denominador é a contagem de leads únicos que entraram no estágio no período. A taxa de conversão calcula quantos desses mesmos leads avançaram subsequentemente ao próximo estágio. Post-Course e Alumni ficam fora do funil comercial.
            </p>
          </div>

          {/* Funnel Stages List */}
          <div className="space-y-4 my-4">
            {funnel.map((stage, idx) => {
              const widthPct = Math.max(
                Math.round((stage.unique_leads_entered / maxEntered) * 100),
                8
              );

              return (
                <div key={stage.stage_code} className="relative">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-bold">
                        {stage.sort_order}
                      </span>
                      {stage.stage_name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-900">
                        {stage.unique_leads_entered} leads únicos
                      </span>
                      {stage.conversion_from_prev !== null ? (
                        <span className="inline-flex items-center gap-0.5 font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-[11px]">
                          <ArrowRight className="w-3 h-3" />
                          {formatRate(stage.conversion_from_prev)}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-[11px] italic">
                          (Estágio Inicial)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Horizontal Bar */}
                  <div className="w-full bg-gray-100 h-6 rounded-lg overflow-hidden relative">
                    <div
                      className={`h-full rounded-lg transition-all duration-500 ${
                        idx === 0
                          ? 'bg-blue-500'
                          : idx === 1
                          ? 'bg-indigo-500'
                          : idx === 2
                          ? 'bg-purple-500'
                          : idx === 3
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-[10px] font-medium text-gray-500">
                      {stage.unique_leads_entered > 0
                        ? `${stage.unique_leads_entered} no cohort`
                        : 'Sem leads'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>
            Total de movimentações de estágio no período:{' '}
            <strong className="text-gray-800">{movements_in_period}</strong>
          </span>
          <span className="text-[11px] text-gray-400">
            Deduplicação automática por lead
          </span>
        </div>
      </div>

      {/* 2. Current Pipeline Distribution & Qualification Snapshot */}
      <div className="lg:col-span-5 bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Distribuição Atual do CRM
              </h3>
              <p className="text-xs text-gray-500">
                Foto instantânea dos leads por estágio e qualificação
              </p>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              SNAPSHOT
            </span>
          </div>

          {/* Current Pipeline Stages Table */}
          <div className="mb-6">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Estágio Atual dos Leads
            </h4>
            <div className="space-y-2">
              {current_distribution.map((stage) => (
                <div
                  key={stage.stage_id}
                  className="flex items-center justify-between py-1 border-b border-gray-50 text-xs"
                >
                  <span className="text-gray-700 truncate max-w-[150px]">
                    {stage.stage_name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {stage.lead_count}
                    </span>
                    <span className="text-gray-400 w-12 text-right">
                      {stage.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Qualification Status Snapshot */}
          <div>
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Status de Qualificação
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {qualification.distribution.map((q) => (
                <div
                  key={q.status}
                  className="p-2.5 rounded-lg border border-gray-100 bg-gray-50 flex items-center justify-between"
                >
                  <div>
                    <p className="text-[11px] font-medium text-gray-600">{q.label}</p>
                    <p className="text-base font-bold text-gray-900 mt-0.5">
                      {q.lead_count}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold text-gray-400">
                    {q.percentage.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5" />
            Independentes do período filtrado
          </span>
        </div>
      </div>
    </div>
  );
};
