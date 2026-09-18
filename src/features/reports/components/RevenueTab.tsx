
import { MetricCard } from './MetricCard';
import type { RevenueReportData } from '../types/reporting';

interface RevenueTabProps {
  data: RevenueReportData;
}

export function RevenueTab({ data }: RevenueTabProps) {
  const { summary, time_series, payment_methods, metadata } = data;

  return (
    <div className="space-y-6">
      {/* Financial Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Gross Collected"
          metric={summary.gross_collected}
          isCurrency
          tooltip="Total paid payments received in period (USD)."
        />
        <MetricCard
          title="Refunded Amount"
          metric={summary.refunded_amount}
          isCurrency
          tooltip="Total refunds recorded in period (USD)."
        />
        <MetricCard
          title="Net Revenue"
          metric={summary.net_revenue}
          isCurrency
          tooltip="Gross Collected minus Refunded Amount (USD)."
        />
        <MetricCard
          title="Booked Revenue"
          metric={summary.booked_revenue}
          isCurrency
          tooltip="Total agreed contract value of enrollments confirmed in period (USD)."
        />
        <MetricCard
          title="Outstanding Balance"
          metric={summary.current_outstanding_balance}
          isCurrency
          subtitle="All confirmed enrollments"
          tooltip="Current snapshot of agreed amount remaining unpaid across all confirmed enrollments."
        />
        <MetricCard
          title="Average Ticket"
          metric={summary.average_ticket}
          isCurrency
          subtitle="Agreed amount per confirmed enrollment"
          tooltip="Average contracted price per confirmed enrollment in this period."
        />
        <MetricCard
          title="Refund Rate"
          metric={summary.refund_rate}
          isPercent
          subtitle={`${summary.refund_rate.refund_count ?? 0} refunds recorded`}
          tooltip="Refunded amount divided by gross collected amount in period."
        />
      </div>

      {/* Time Series Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
              Revenue & Cash Collections Timeline
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Granularity: <strong className="capitalize">{metadata.granularity || 'Daily'}</strong> ({metadata.currency})
            </p>
          </div>
        </div>

        {time_series.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No cash transactions in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="pb-2.5 font-medium">Period Bucket</th>
                  <th className="pb-2.5 font-medium text-right">Gross Collected</th>
                  <th className="pb-2.5 font-medium text-right">Refunds</th>
                  <th className="pb-2.5 font-medium text-right">Net Revenue</th>
                  <th className="pb-2.5 font-medium text-right">Booked Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {time_series.map((item) => (
                  <tr key={item.period_start} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-2.5 font-medium text-slate-700">{item.period_start}</td>
                    <td className="py-2.5 text-right font-medium text-slate-700">
                      ${item.gross_collected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 text-right font-medium text-rose-600">
                      ${item.refunded_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 text-right font-bold text-emerald-700">
                      ${item.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 text-right font-medium text-blue-700">
                      ${item.booked_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Methods Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider mb-4">
          Collections by Payment Method
        </h3>
        {payment_methods.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No payment methods recorded in this period.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {payment_methods.map((pm) => (
              <div key={pm.method} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-[#08254f] capitalize">
                    {pm.method.replace(/_/g, ' ')}
                  </span>
                  <p className="text-[11px] text-slate-500">{pm.payment_count} transactions</p>
                </div>
                <div className="text-right font-bold text-sm text-emerald-700">
                  ${pm.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
