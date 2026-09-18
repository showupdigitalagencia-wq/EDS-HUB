import { useState } from 'react';
import type { SourcesReportData, SourcePerformanceItem } from '../types/reporting';

interface SourcesTabProps {
  data: SourcesReportData;
}

type SortField = keyof SourcePerformanceItem;

export function SourcesTab({ data }: SourcesTabProps) {
  const [sortField, setSortField] = useState<SortField>('net_revenue');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortedSources = [...data.sources].sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];
    if (valA === null || valA === undefined) return sortAsc ? -1 : 1;
    if (valB === null || valB === undefined) return sortAsc ? 1 : -1;
    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
  });

  return (
    <div className="space-y-6">
      {/* Information Banner */}
      <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4 text-xs text-blue-900 flex items-start gap-3">
        <div className="font-semibold shrink-0">Source Attribution:</div>
        <div>
          Uses each lead's first canonical intake source (single-touch).
          <strong> Cohort Conversion</strong> tracks the percentage of leads captured in this period that eventually enrolled.
          <strong> Enrollments in Period</strong> tracks enrollments confirmed within this date window.
        </div>
      </div>

      {/* Sources Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
              Lead Source Performance
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sorted by <strong className="capitalize">{String(sortField).replace(/_/g, ' ')}</strong> ({sortAsc ? 'Ascending' : 'Descending'})
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider">
                <th
                  onClick={() => handleSort('source')}
                  className="py-3 px-4 font-semibold cursor-pointer hover:text-[#08254f]"
                >
                  Source {sortField === 'source' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('leads_created')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Leads {sortField === 'leads_created' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('qualified_leads')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Qualified {sortField === 'qualified_leads' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('cohort_leads_enrolled')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Cohort Enrolled {sortField === 'cohort_leads_enrolled' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('cohort_conversion_rate')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Cohort Conv. {sortField === 'cohort_conversion_rate' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('enrollments_confirmed_in_period')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  In-Period Enrollments {sortField === 'enrollments_confirmed_in_period' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('gross_collected')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Gross Collected {sortField === 'gross_collected' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('refunded_amount')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Refunds {sortField === 'refunded_amount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('net_revenue')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Net Revenue {sortField === 'net_revenue' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('current_outstanding_balance')}
                  className="py-3 px-4 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Outstanding {sortField === 'current_outstanding_balance' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedSources.map((s) => (
                <tr key={s.source} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-bold text-[#08254f] capitalize">
                    {s.source}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-700">
                    {s.leads_created}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    {s.qualified_leads}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    {s.cohort_leads_enrolled}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-purple-700">
                    {s.cohort_conversion_rate !== null ? `${s.cohort_conversion_rate}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-700">
                    {s.enrollments_confirmed_in_period}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-700">
                    ${s.gross_collected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right text-rose-600 font-medium">
                    ${s.refunded_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-emerald-700">
                    ${s.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600">
                    ${s.current_outstanding_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
