
import type { EngagementReportData } from '../types/reporting';

interface EngagementTabProps {
  data: EngagementReportData;
}

export function EngagementTab({ data }: EngagementTabProps) {
  const { conversations, automations, forms, tasks } = data;

  const formatSeconds = (sec: number | null): string => {
    if (sec === null || sec === undefined) return 'No data';
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    const hours = Math.floor(sec / 3600);
    const mins = Math.round((sec % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="space-y-8">
      {/* 1. Conversations & Response Time */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
              Conversational CRM & Response Speed
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Outbound contact effectiveness, reply rates, and team responsiveness
            </p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/60">
            Period Flow
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Outbound Contacted
            </span>
            <div className="text-xl font-bold text-[#08254f] mt-1">
              {conversations.outbound_unique_leads} leads
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {conversations.outbound_sent_count} total messages sent
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Reply Rate
            </span>
            <div className="text-xl font-bold text-emerald-600 mt-1">
              {conversations.reply_rate !== null ? `${conversations.reply_rate}%` : 'No data'}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {conversations.replied_unique_leads} of {conversations.outbound_unique_leads} leads replied
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Median Response Time
            </span>
            <div className="text-xl font-bold text-[#08254f] mt-1">
              {formatSeconds(conversations.median_first_response_time_seconds)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Average: {formatSeconds(conversations.avg_first_response_time_seconds)}
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Needing Reply
            </span>
            <div className="text-xl font-bold text-indigo-700 mt-1">
              {conversations.open_conversations_needing_reply}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Current open threads awaiting reply</p>
          </div>
        </div>
      </div>

      {/* 2. Automation Engine Health */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
              Automation Engine Reliability & Execution
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Execution audits, error rates, and channel preference enforcement
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
            <span className="text-[10px] uppercase font-semibold text-slate-400">Total Runs</span>
            <div className="text-lg font-bold text-[#08254f] mt-0.5">{automations.runs_total}</div>
          </div>
          <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-100 text-center">
            <span className="text-[10px] uppercase font-semibold text-emerald-700">Completed</span>
            <div className="text-lg font-bold text-emerald-700 mt-0.5">{automations.runs_completed}</div>
          </div>
          <div className="p-3 bg-rose-50/60 rounded-lg border border-rose-100 text-center">
            <span className="text-[10px] uppercase font-semibold text-rose-700">Failed</span>
            <div className="text-lg font-bold text-rose-700 mt-0.5">{automations.runs_failed}</div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
            <span className="text-[10px] uppercase font-semibold text-slate-400">Step Actions</span>
            <div className="text-lg font-bold text-[#08254f] mt-0.5">{automations.actions_total}</div>
          </div>
          <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-100 text-center">
            <span className="text-[10px] uppercase font-semibold text-amber-700">Preference Blocked</span>
            <div className="text-lg font-bold text-amber-700 mt-0.5">{automations.actions_blocked_by_preference}</div>
          </div>
          <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100 text-center">
            <span className="text-[10px] uppercase font-semibold text-blue-700">Active Sequences</span>
            <div className="text-lg font-bold text-blue-700 mt-0.5">{automations.active_sequences_count}</div>
          </div>
        </div>
      </div>

      {/* 3. Forms Conversion */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
            Forms Submissions & Cohort Conversion
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Conversion tracking of leads captured through embedded or standalone forms
          </p>
        </div>

        {forms.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No forms recorded in the system.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4 font-semibold">Form Title</th>
                  <th className="py-3 px-3 font-semibold">Slug</th>
                  <th className="py-3 px-3 font-semibold text-right">Submissions</th>
                  <th className="py-3 px-3 font-semibold text-right">Unique Leads</th>
                  <th className="py-3 px-3 font-semibold text-right">Cohort Enrolled</th>
                  <th className="py-3 px-4 font-semibold text-right">Conversion Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {forms.map((f) => (
                  <tr key={f.form_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-[#08254f]">{f.form_title}</td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{f.form_slug}</td>
                    <td className="py-3 px-3 text-right font-medium text-slate-700">{f.submissions_count}</td>
                    <td className="py-3 px-3 text-right text-slate-600">{f.unique_leads_created}</td>
                    <td className="py-3 px-3 text-right text-slate-600">{f.cohort_leads_enrolled}</td>
                    <td className="py-3 px-4 text-right font-semibold text-purple-700">
                      {f.cohort_conversion_rate !== null ? `${f.cohort_conversion_rate}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Daily Operations Snapshot */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider mb-4">
          Daily Operations & Work Queue Health
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-emerald-50/60 rounded-lg border border-emerald-100">
            <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">
              Tasks Completed (Period)
            </span>
            <div className="text-2xl font-bold text-emerald-700 mt-1">
              {tasks.tasks_completed_in_period}
            </div>
            <p className="text-[11px] text-emerald-600 mt-0.5">Executed tasks during selected period</p>
          </div>

          <div className="p-4 bg-amber-50/60 rounded-lg border border-amber-100">
            <span className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
              Current Overdue Tasks
            </span>
            <div className="text-2xl font-bold text-amber-700 mt-1">
              {tasks.current_overdue_tasks}
            </div>
            <p className="text-[11px] text-amber-600 mt-0.5">Snapshot of unresolved overdue tasks</p>
          </div>

          <div className="p-4 bg-blue-50/60 rounded-lg border border-blue-100">
            <span className="text-[11px] font-semibold text-blue-800 uppercase tracking-wider">
              Due Today
            </span>
            <div className="text-2xl font-bold text-blue-700 mt-1">
              {tasks.current_tasks_due_today}
            </div>
            <p className="text-[11px] text-blue-600 mt-0.5">Scheduled tasks for today in org timezone</p>
          </div>
        </div>
      </div>
    </div>
  );
}
