
import { MetricCard } from './MetricCard';
import type { ExecutiveOverviewData } from '../types/reporting';

interface ExecutiveTabProps {
  data: ExecutiveOverviewData;
  onSelectTab: (tab: string) => void;
}

export function ExecutiveTab({ data, onSelectTab }: ExecutiveTabProps) {
  const { kpis, top_courses, top_sources, revenue_trend } = data;

  // Max value calculation for trend visualization
  const maxRevenue = Math.max(...revenue_trend.map((t) => Math.max(t.gross_collected, t.net_revenue, 1)), 100);

  return (
    <div className="space-y-6">
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Leads Created"
          metric={kpis.leads_created}
          tooltip="Total distinct leads captured within the selected period."
        />
        <MetricCard
          title="Confirmed Enrollments"
          metric={kpis.confirmed_enrollments}
          tooltip="Total student enrollments entering confirmed status in this period."
        />
        <MetricCard
          title="Gross Collected"
          metric={kpis.gross_collected}
          isCurrency
          tooltip="Total cash received from paid payment transactions in this period (USD)."
        />
        <MetricCard
          title="Net Revenue"
          metric={kpis.net_revenue}
          isCurrency
          tooltip="Actual revenue retained: Gross Collected minus Refunded Amount (USD)."
        />
        <MetricCard
          title="Booked Revenue"
          metric={kpis.booked_revenue}
          isCurrency
          tooltip="Total agreed contract value of enrollments confirmed in this period (USD)."
        />
        <MetricCard
          title="Outstanding Balance"
          metric={kpis.current_outstanding_balance}
          isCurrency
          subtitle="All confirmed enrollments"
          tooltip="Current snapshot of agreed amount remaining unpaid across all active confirmed enrollments."
        />
        <MetricCard
          title="Cohort Conversion"
          metric={kpis.cohort_conversion_rate}
          isPercent
          subtitle="Leads created in period that enrolled"
          tooltip="Percentage of leads captured in this period that reached confirmed enrollment at any point."
        />
        <MetricCard
          title="Reply Rate"
          metric={kpis.reply_rate}
          isPercent
          subtitle="Outbound leads that replied"
          tooltip="Percentage of unique leads sent an outbound email/SMS who replied with an inbound message."
        />
      </div>

      {/* Daily Activity & Revenue Trend */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
              Daily Revenue & Lead Flow
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Continuous timeline with daily cash collections and new lead volumes
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#08254f]" />
              <span className="text-slate-600 font-medium">Net Revenue</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
              <span className="text-slate-600 font-medium">Leads Created</span>
            </div>
          </div>
        </div>

        {revenue_trend.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            No activity recorded in this period.
          </div>
        ) : (
          <div className="h-44 flex items-end gap-1 sm:gap-2 pt-6 pb-2 overflow-x-auto">
            {revenue_trend.map((point) => {
              const heightPct = Math.min(100, Math.round((point.net_revenue / maxRevenue) * 100));
              return (
                <div
                  key={point.date}
                  className="flex-1 min-w-[20px] flex flex-col items-center gap-1 group relative h-full justify-end"
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-20 bg-slate-900 text-white text-[11px] p-2 rounded-md shadow-lg pointer-events-none whitespace-nowrap">
                    <div className="font-semibold text-slate-200">{point.date}</div>
                    <div className="text-emerald-400">Leads: {point.leads_created}</div>
                    <div className="text-blue-300">
                      Net: ${point.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* Bar */}
                  <div
                    className="w-full bg-[#08254f] hover:bg-blue-800 rounded-t-xs transition-all duration-200"
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className="text-[10px] text-slate-400 truncate max-w-full">
                    {point.date.slice(8)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Two Column Section: Top Courses & Top Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Courses */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
                Courses — Sorted by Net Revenue
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Top performing courses in selected period</p>
            </div>
            <button
              onClick={() => onSelectTab('courses')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
            >
              View all courses &rarr;
            </button>
          </div>

          {top_courses.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No course data in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="pb-2 font-medium">Course</th>
                    <th className="pb-2 font-medium text-right">Enrollments</th>
                    <th className="pb-2 font-medium text-right">Net Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {top_courses.map((course) => (
                    <tr key={course.course_id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 font-medium text-[#08254f] truncate max-w-[200px]">
                        {course.course_name}
                      </td>
                      <td className="py-2.5 text-right text-slate-600 font-semibold">
                        {course.confirmed_enrollments}
                      </td>
                      <td className="py-2.5 text-right font-bold text-emerald-700">
                        ${course.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Sources */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
                Sources — Sorted by Net Revenue
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Lead source attribution for selected period</p>
            </div>
            <button
              onClick={() => onSelectTab('sources')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
            >
              View all sources &rarr;
            </button>
          </div>

          {top_sources.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No source data in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 font-medium text-right">Leads</th>
                    <th className="pb-2 font-medium text-right">Cohort Conv.</th>
                    <th className="pb-2 font-medium text-right">Net Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {top_sources.map((src) => (
                    <tr key={src.source} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 font-medium text-[#08254f] capitalize">
                        {src.source}
                      </td>
                      <td className="py-2.5 text-right text-slate-600">{src.leads_created}</td>
                      <td className="py-2.5 text-right text-slate-600">
                        {src.cohort_conversion_rate !== null ? `${src.cohort_conversion_rate}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-bold text-emerald-700">
                        ${src.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
