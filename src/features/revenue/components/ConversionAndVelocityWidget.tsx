// =============================================================================
// Conversion and Velocity Widget
// =============================================================================

import React from 'react';
import { GitCommit, Activity } from 'lucide-react';
import type { RevenueCohorts, EnrollmentVelocityEntry } from '../../../types/database';
import { formatRate, formatCurrency } from '../services/revenue-service';

interface ConversionAndVelocityWidgetProps {
  cohorts: RevenueCohorts;
  velocity: EnrollmentVelocityEntry[];
  currency?: string;
}

export const ConversionAndVelocityWidget: React.FC<ConversionAndVelocityWidgetProps> = ({
  cohorts,
  velocity,
  currency = 'USD',
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 1. Cohort Conversions */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
                <GitCommit className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Taxas de Conversão (Cohorts)
                </h3>
                <p className="text-xs text-slate-500">
                  Medição auditável baseada em coortes temporais
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              COHORT
            </span>
          </div>

          <div className="space-y-4">
            {/* Cohort A: Lead -> Enrollment */}
            <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800">
                    Lead → Matrícula Confirmada
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Leads criados no período que concluíram matrícula
                  </p>
                </div>
                <span className="text-base font-extrabold text-[#08254f] font-heading">
                  {formatRate(cohorts.lead_to_enrollment_rate)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                <span>Leads criados: <strong className="text-slate-700">{cohorts.leads_created_in_period}</strong></span>
                <span>Converteram: <strong className="text-emerald-700">{cohorts.leads_created_enrolled}</strong></span>
              </div>
            </div>

            {/* Cohort B: Approval -> Enrollment */}
            <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800">
                    Aprovação → Matrícula Confirmada
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Leads qualificados que avançaram da fase Approval
                  </p>
                </div>
                <span className="text-base font-extrabold text-[#125e95] font-heading">
                  {formatRate(cohorts.approval_to_enrollment_rate)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                <span>Entraram em Aprovação: <strong className="text-slate-700">{cohorts.leads_entered_approval_count}</strong></span>
                <span>Converteram: <strong className="text-emerald-700">{cohorts.leads_approval_enrolled}</strong></span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400">
          Denominadores baseados exclusivamente na data de criação / entrada no estágio
        </div>
      </div>

      {/* 2. Enrollment Velocity Trend */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#e1f0fb] text-[#125e95] shadow-xs">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Velocidade de Matrículas
                </h3>
                <p className="text-xs text-slate-500">
                  Volume de fechamento comercial por intervalo
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              VELOCITY
            </span>
          </div>

          {velocity.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Nenhuma matrícula confirmada no período selecionado
            </div>
          ) : (
            <div className="space-y-3">
              {velocity.map((v, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50/60 rounded-xl border border-slate-200/80 flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-slate-800">
                      Semana {v.period_start} a {v.period_end}
                    </span>
                    <div className="text-[11px] text-slate-400">
                      Booked: {formatCurrency(v.booked_value, currency)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-extrabold bg-[#125e95] text-white">
                      {v.confirmed_enrollments} {v.confirmed_enrollments === 1 ? 'matrícula' : 'matrículas'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400">
          Reflete novas matrículas registradas na data do evento, sem sobreposição
        </div>
      </div>
    </div>
  );
};
