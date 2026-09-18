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
  const { funnel = [], current_distribution = [], movements_in_period = 0 } = pipeline || {};

  const safeFunnel = Array.isArray(funnel) ? funnel : [];
  const safeDistribution = Array.isArray(current_distribution) ? current_distribution : [];

  // Find max leads entered in funnel to scale bars
  const maxEntered = Math.max(...safeFunnel.map((f) => f?.unique_leads_entered ?? 0), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 1. Commercial Sales Funnel (Cohort-Based) */}
      <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#08254f] text-white shadow-xs">
                <Filter className="w-4 h-4 text-[#449bd5]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Funil Comercial de Vendas
                </h3>
                <p className="text-xs text-slate-500">
                  Conversão estrita por cohort de entrada no período
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 uppercase tracking-wider">
                PERÍODO (COHORT)
              </span>
              {onExportPipeline && (
                <button
                  type="button"
                  onClick={onExportPipeline}
                  className="text-xs font-semibold text-[#8a1c1c] hover:text-[#701414] transition-colors cursor-pointer"
                >
                  Exportar CSV
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 p-3 rounded-xl bg-[#f8fafc] border border-slate-200/80 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[#449bd5] mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-slate-600 leading-relaxed">
              <strong className="text-[#08254f]">Regra de Cohort:</strong> Para cada estágio, o denominador é a contagem de leads únicos que entraram no estágio no período. A taxa de conversão calcula quantos desses mesmos leads avançaram subsequentemente ao próximo estágio. Post-Course e Alumni ficam fora do funil comercial.
            </p>
          </div>

          {/* Funnel Stages List */}
          <div className="space-y-4 my-4">
            {safeFunnel.map((stage, idx) => {
              const widthPct = Math.max(
                Math.round(((stage.unique_leads_entered ?? 0) / maxEntered) * 100),
                8
              );

              return (
                <div key={stage.stage_code} className="relative">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5 font-heading">
                      <span className="w-5 h-5 rounded-full bg-[#08254f]/5 text-[#08254f] flex items-center justify-center text-[10px] font-bold border border-[#08254f]/10">
                        {stage.sort_order}
                      </span>
                      {stage.stage_name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-[#08254f]">
                        {stage.unique_leads_entered} leads únicos
                      </span>
                      {stage.conversion_from_prev !== null ? (
                        <span className="inline-flex items-center gap-1 font-bold text-[#08254f] bg-[#e1f0fb] px-2 py-0.5 rounded-md text-[11px] border border-[#b4cdeb]">
                          <ArrowRight className="w-3 h-3 text-[#125e95]" />
                          {formatRate(stage.conversion_from_prev)}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">
                          (Estágio Inicial)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Horizontal Bar */}
                  <div className="w-full bg-slate-100 h-6 rounded-lg overflow-hidden relative">
                    <div
                      className={`h-full rounded-lg transition-all duration-500 ${
                        idx === 0
                          ? 'bg-[#08254f]'
                          : idx === 1
                          ? 'bg-[#1d5cb0]'
                          : idx === 2
                          ? 'bg-[#449bd5]'
                          : idx === 3
                          ? 'bg-[#7bb5e5]'
                          : 'bg-emerald-600'
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-[10px] font-medium text-slate-600">
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

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Total de movimentações de estágio no período:{' '}
            <strong className="text-[#08254f]">{movements_in_period}</strong>
          </span>
          <span className="text-[11px] text-slate-400">
            Deduplicação automática por lead
          </span>
        </div>
      </div>

      {/* 2. Current Pipeline Distribution & Qualification Snapshot */}
      <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[#08254f] font-heading">
                Distribuição Atual do CRM
              </h3>
              <p className="text-xs text-slate-500">
                Foto instantânea dos leads por estágio e qualificação
              </p>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              SNAPSHOT
            </span>
          </div>

          {/* Current Pipeline Stages Table */}
          <div className="mb-6">
            <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
              Estágio Atual dos Leads
            </h4>
            <div className="space-y-1.5">
              {safeDistribution.map((stage) => (
                <div
                  key={stage.stage_id}
                  className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 border-b border-slate-100/60 text-xs transition-colors"
                >
                  <span className="text-slate-700 font-medium truncate max-w-[150px]">
                    {stage.stage_name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#08254f]">
                      {stage.lead_count ?? 0}
                    </span>
                    <span className="text-slate-400 w-12 text-right">
                      {(stage.percentage ?? 0).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Qualification Status Snapshot */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
              Status de Qualificação
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {(qualification?.distribution || []).map((q) => (
                <div
                  key={q.status}
                  className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between hover:bg-white hover:shadow-xs transition-all"
                >
                  <div>
                    <p className="text-[11px] font-semibold text-slate-600">{q.label}</p>
                    <p className="text-base font-extrabold text-[#08254f] mt-0.5 font-heading">
                      {q.lead_count ?? 0}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                    {(q.percentage ?? 0).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            Independentes do período filtrado
          </span>
        </div>
      </div>
    </div>
  );
};
