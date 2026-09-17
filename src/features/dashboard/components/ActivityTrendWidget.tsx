import React, { useState } from 'react';
import { Activity, Calendar } from 'lucide-react';
import type { DashboardActivityTrendItem } from '../../../types/database';

interface ActivityTrendWidgetProps {
  trend: DashboardActivityTrendItem[];
  periodLabel: string;
}

export const ActivityTrendWidget: React.FC<ActivityTrendWidgetProps> = ({
  trend,
  periodLabel,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // SVG Chart Dimensions
  const chartHeight = 160;
  const paddingBottom = 24;
  const paddingTop = 12;
  const availableHeight = chartHeight - paddingBottom - paddingTop;

  // Calculate max daily value across all metrics to normalize height
  const maxVal = Math.max(
    ...trend.map((t) =>
      Math.max(t.new_leads, t.outbound_messages, t.inbound_replies, t.stage_movements)
    ),
    5
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-[#e1f0fb] text-[#125e95] shadow-xs">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#08254f] font-heading">
              Tendência de Atividade Comercial
            </h3>
            <p className="text-xs text-slate-500">
              Volume diário de novos leads, mensagens enviadas, respostas e movimentações
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#449bd5] inline-block" />
            <span className="text-slate-600 font-medium">Novos Leads</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#08254f] inline-block" />
            <span className="text-slate-600 font-medium">Outbound Enviado</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#8a1c1c] inline-block" />
            <span className="text-slate-600 font-medium">Respostas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
            <span className="text-slate-600 font-medium">Movimentações</span>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 uppercase tracking-wider">
            PERÍODO
          </span>
        </div>
      </div>

      {trend.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-xs">
          Nenhum dado de atividade para o período selecionado ({periodLabel})
        </div>
      ) : (
        <div className="relative">
          {/* SVG Bar / Multi-bar Chart */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px] h-48 relative flex items-end justify-between px-2 pt-4 pb-6 border-b border-slate-100">
              {trend.map((day, idx) => {
                const dateParts = day.date.split('-');
                const displayDate = `${dateParts[2]}/${dateParts[1]}`;
                const isHovered = hoveredIdx === idx;

                const leadsHeight = (day.new_leads / maxVal) * availableHeight;
                const outHeight = (day.outbound_messages / maxVal) * availableHeight;
                const inHeight = (day.inbound_replies / maxVal) * availableHeight;
                const movHeight = (day.stage_movements / maxVal) * availableHeight;

                return (
                  <div
                    key={day.date}
                    className="flex-1 flex flex-col items-center group relative cursor-pointer h-full justify-end px-0.5"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {/* Tooltip on hover */}
                    {isHovered && (
                      <div className="absolute bottom-full mb-2 bg-[#08254f] text-white rounded-xl p-3 shadow-xl text-xs z-30 pointer-events-none whitespace-nowrap min-w-[150px] border border-white/10">
                        <div className="font-bold text-slate-200 border-b border-white/10 pb-1 mb-1.5 flex items-center gap-1.5 font-heading">
                          <Calendar className="w-3 h-3 text-[#449bd5]" />
                          {displayDate}
                        </div>
                        <div className="space-y-1 text-[11px]">
                          <div className="flex justify-between gap-3 text-[#b4cdeb]">
                            <span>Novos Leads:</span>
                            <span className="font-bold text-white">{day.new_leads}</span>
                          </div>
                          <div className="flex justify-between gap-3 text-slate-300">
                            <span>Outbounds:</span>
                            <span className="font-bold text-white">{day.outbound_messages}</span>
                          </div>
                          <div className="flex justify-between gap-3 text-rose-200">
                            <span>Respostas:</span>
                            <span className="font-bold text-white">{day.inbound_replies}</span>
                          </div>
                          <div className="flex justify-between gap-3 text-emerald-300">
                            <span>Movimentações:</span>
                            <span className="font-bold text-white">{day.stage_movements}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Clustered Bars */}
                    <div className="flex items-end gap-[2px] w-full justify-center max-w-[32px]">
                      <div
                        className="w-1.5 bg-[#449bd5] rounded-t transition-all duration-300"
                        style={{ height: `${Math.max(leadsHeight, 2)}px` }}
                        title={`Novos Leads: ${day.new_leads}`}
                      />
                      <div
                        className="w-1.5 bg-[#08254f] rounded-t transition-all duration-300"
                        style={{ height: `${Math.max(outHeight, 2)}px` }}
                        title={`Outbounds: ${day.outbound_messages}`}
                      />
                      <div
                        className="w-1.5 bg-[#8a1c1c] rounded-t transition-all duration-300"
                        style={{ height: `${Math.max(inHeight, 2)}px` }}
                        title={`Respostas: ${day.inbound_replies}`}
                      />
                      <div
                        className="w-1.5 bg-emerald-600 rounded-t transition-all duration-300"
                        style={{ height: `${Math.max(movHeight, 2)}px` }}
                        title={`Movimentações: ${day.stage_movements}`}
                      />
                    </div>

                    {/* Date label at bottom */}
                    <span
                      className={`text-[10px] absolute -bottom-5 transition-colors ${
                        isHovered ? 'font-bold text-[#08254f]' : 'text-slate-400'
                      }`}
                    >
                      {trend.length <= 14 || idx % Math.ceil(trend.length / 10) === 0
                        ? displayDate
                        : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 mt-6 px-1">
            <span>Escala máxima no período: <strong className="text-slate-700">{maxVal}</strong> eventos/dia</span>
            <span>Preenchimento contínuo diário</span>
          </div>
        </div>
      )}
    </div>
  );
};
