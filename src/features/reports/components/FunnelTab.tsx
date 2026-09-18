
import type { FunnelReportData } from '../types/reporting';

interface FunnelTabProps {
  data: FunnelReportData;
}

export function FunnelTab({ data }: FunnelTabProps) {
  const { cohort_funnel, current_pipeline_snapshot, qualification_snapshot, scoring_snapshot } = data;

  const baseCount = cohort_funnel.cohort_total_leads;

  return (
    <div className="space-y-8">
      {/* Funnel Visual Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-[#08254f]">
              Commercial Cohort Funnel
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200/60">
              Cohort Analysis
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tracking {baseCount} leads created in the selected period and their historical advancement through the 5 commercial stages.
          </p>
        </div>

        {baseCount === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            No leads created in this period to form a cohort.
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl mx-auto">
            {cohort_funnel.stages.map((stage, idx) => {
              const pctOfCohort = stage.conversion_from_cohort ?? 0;
              const isFirst = idx === 0;

              return (
                <div key={stage.stage_code} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#08254f] text-white flex items-center justify-center text-[10px] font-bold">
                        {stage.sort_order}
                      </span>
                      <span className="font-semibold text-[#08254f]">{stage.stage_name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-slate-600">
                      <span className="font-bold text-sm text-[#08254f]">{stage.reached_count} leads</span>
                      {!isFirst && stage.conversion_from_prev !== null && (
                        <span className="text-[11px] text-slate-400 font-medium">
                          ({stage.conversion_from_prev}% from prev)
                        </span>
                      )}
                      <span className="text-xs font-semibold text-emerald-700 w-14 text-right">
                        {pctOfCohort}%
                      </span>
                    </div>
                  </div>

                  {/* Funnel Bar */}
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-[#08254f] h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(pctOfCohort, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Snapshot Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current Pipeline Snapshot */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-semibold text-[#08254f] uppercase tracking-wider">
              Current Pipeline Snapshot
            </h4>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              Snapshot
            </span>
          </div>
          <div className="space-y-2.5">
            {current_pipeline_snapshot.map((stg) => (
              <div key={stg.stage_id} className="flex items-center justify-between text-xs">
                <span className="text-slate-600 capitalize">{stg.stage_name}</span>
                <span className="font-bold text-[#08254f]">{stg.lead_count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Qualification Status Snapshot */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-semibold text-[#08254f] uppercase tracking-wider">
              Qualification Status Snapshot
            </h4>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              Snapshot
            </span>
          </div>
          <div className="space-y-2.5">
            {qualification_snapshot.map((q) => (
              <div key={q.status} className="flex items-center justify-between text-xs">
                <span className="text-slate-600 capitalize">
                  {q.status.replace(/_/g, ' ')}
                </span>
                <span className="font-bold text-[#08254f]">{q.lead_count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Lead Score Tiers Snapshot */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-semibold text-[#08254f] uppercase tracking-wider">
              Lead Score Tiers Snapshot
            </h4>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              Snapshot
            </span>
          </div>
          <div className="mb-3 text-xs text-slate-500">
            Average Score: <strong className="text-[#08254f]">{scoring_snapshot?.average_score ?? 0}</strong>
          </div>
          <div className="space-y-2.5">
            {scoring_snapshot?.distribution?.map((tier) => (
              <div key={tier.category} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{tier.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-[11px]">({tier.percentage}%)</span>
                  <span className="font-bold text-[#08254f]">{tier.lead_count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
