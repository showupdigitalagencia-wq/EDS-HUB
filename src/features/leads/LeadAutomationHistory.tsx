import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Workflow,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Play,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { AutomationRun, AutomationRunStep } from '../../types/database';

interface LeadAutomationHistoryProps {
  leadId: string;
}

interface RunWithSteps extends AutomationRun {
  steps?: AutomationRunStep[];
  isExpanded?: boolean;
}

export function LeadAutomationHistory({ leadId }: LeadAutomationHistoryProps) {
  const [runs, setRuns] = useState<RunWithSteps[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadAutomationRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('automation_runs')
        .select('*, automation:automations(name, trigger_type)')
        .eq('lead_id', leadId)
        .order('started_at', { ascending: false });

      if (error) throw error;
      setRuns(data || []);
    } catch (err) {
      console.error('Failed to load lead automation runs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadAutomationRuns();
  }, [loadAutomationRuns]);

  const toggleExpand = async (runId: string) => {
    const targetRun = runs.find((r) => r.id === runId);
    if (!targetRun) return;

    if (targetRun.isExpanded) {
      setRuns(runs.map((r) => (r.id === runId ? { ...r, isExpanded: false } : r)));
      return;
    }

    // Fetch steps if not loaded yet
    if (!targetRun.steps) {
      const { data: steps } = await supabase
        .from('automation_run_steps')
        .select('*')
        .eq('automation_run_id', runId)
        .order('step_order', { ascending: true });

      setRuns(
        runs.map((r) =>
          r.id === runId ? { ...r, isExpanded: true, steps: steps || [] } : r
        )
      );
    } else {
      setRuns(runs.map((r) => (r.id === runId ? { ...r, isExpanded: true } : r)));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200">
            <Play className="h-3 w-3" /> Running
          </span>
        );
      case 'waiting':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Clock className="h-3 w-3" /> Waiting
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="h-3 w-3" /> Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600">
            <XCircle className="h-3 w-3" /> Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
          <Workflow className="h-4 w-4 text-brand-600" />
          Automation History ({runs.length})
        </h2>
        <button
          onClick={loadAutomationRuns}
          className="text-xs text-brand-600 hover:text-brand-700 font-semibold"
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="py-4 text-center text-xs text-gray-400">Loading automation history...</div>
      ) : runs.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No automations enrolled for this contact.</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            return (
              <div
                key={run.id}
                className="border border-gray-200 rounded-xl overflow-hidden text-xs transition-all shadow-2xs"
              >
                {/* Header Row */}
                <div
                  onClick={() => toggleExpand(run.id)}
                  className="p-3 bg-gray-50/70 hover:bg-gray-100/70 cursor-pointer flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {run.isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                    <div>
                      <div className="font-semibold text-gray-900 flex items-center gap-2">
                        {run.automation?.name || 'Automation Workflow'}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        Started: {new Date(run.started_at).toLocaleString()}
                        {run.completed_at && ` | Completed: ${new Date(run.completed_at).toLocaleString()}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {getStatusBadge(run.status)}
                  </div>
                </div>

                {/* Expanded Detailed Step Timeline */}
                {run.isExpanded && (
                  <div className="p-4 bg-white border-t border-gray-100 space-y-3">
                    {run.stop_reason && (
                      <div className="p-2.5 bg-amber-50 text-amber-800 rounded-lg text-xs">
                        <span className="font-semibold">Stopped:</span> {run.stop_reason}
                      </div>
                    )}
                    {run.last_error && (
                      <div className="p-2.5 bg-red-50 text-red-800 rounded-lg text-xs">
                        <span className="font-semibold">Error:</span> {run.last_error}
                      </div>
                    )}

                    <div className="space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                        Execution Steps
                      </span>

                      {!run.steps || run.steps.length === 0 ? (
                        <div className="py-2 text-xs text-gray-400 italic">Loading step log...</div>
                      ) : (
                        run.steps.map((step) => (
                          <div
                            key={step.id}
                            className="p-2.5 bg-gray-50 border border-gray-100 rounded-lg flex items-start justify-between text-xs"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="w-4 h-4 rounded-full bg-white border border-gray-300 text-gray-700 flex items-center justify-center text-[10px] font-bold">
                                  {step.step_order}
                                </span>
                                <span className="font-bold text-gray-800 uppercase text-[10px]">
                                  {step.step_type}
                                </span>
                                {step.action_type && (
                                  <span className="font-mono text-gray-700">
                                    {step.action_type}
                                  </span>
                                )}
                              </div>

                              {step.skip_reason_message && (
                                <p className="text-[11px] text-amber-700 pl-6 font-medium">
                                  {step.skip_reason_message}
                                </p>
                              )}

                              {step.error_message && (
                                <p className="text-[11px] text-red-700 pl-6 font-medium">
                                  Error: {step.error_message}
                                </p>
                              )}
                            </div>

                            <div className="text-right shrink-0">
                              {getStatusBadge(step.status)}
                              <span className="text-[10px] text-gray-400 block mt-0.5">
                                {step.completed_at
                                  ? new Date(step.completed_at).toLocaleTimeString()
                                  : step.started_at
                                  ? new Date(step.started_at).toLocaleTimeString()
                                  : ''}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
