import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  GitFork,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Play,
  Pause,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  ShieldAlert,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import type { AutomationRun, AutomationRunStep, AutomationStep, NextActionInfo } from '../../types/database';
import { computeNextAction } from '../automations/engine/automation-evaluator';
import { ManualEnrollmentModal } from '../sequences/ManualEnrollmentModal';

interface LeadAutomationHistoryProps {
  leadId: string;
  leadName?: string;
}

interface RunWithDetails extends AutomationRun {
  steps?: AutomationRunStep[];
  automation_steps?: AutomationStep[];
  pending_job?: { id: string; run_at: string; status: string } | null;
  next_action?: NextActionInfo;
  isExpanded?: boolean;
}

export function LeadAutomationHistory({ leadId, leadName = 'Lead' }: LeadAutomationHistoryProps) {
  const [runs, setRuns] = useState<RunWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [stopModalRun, setStopModalRun] = useState<RunWithDetails | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const loadAutomationRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch runs
      const { data: runsData, error: runsErr } = await supabase
        .from('automation_runs')
        .select('*, automation:automations(name, trigger_type, automation_type, stop_conditions)')
        .eq('lead_id', leadId)
        .order('started_at', { ascending: false });

      if (runsErr) throw runsErr;
      const rawRuns = runsData || [];

      // 2. Enhance active runs with pending jobs & steps for next_action computation
      const enhanced: RunWithDetails[] = await Promise.all(
        rawRuns.map(async (r) => {
          // Fetch pending job if waiting
          let pendingJob: { id: string; run_at: string; status: string } | null = null;
          if (r.status === 'waiting' || r.status === 'paused') {
            const { data: job } = await supabase
              .from('automation_jobs')
              .select('id, run_at, status')
              .eq('automation_run_id', r.id)
              .eq('status', 'pending')
              .order('run_at', { ascending: true })
              .maybeSingle();
            pendingJob = job;
          }

          // Fetch step definitions for version
          const { data: vSteps } = await supabase
            .from('automation_steps')
            .select('*')
            .eq('automation_version_id', r.automation_version_id)
            .order('step_order', { ascending: true });

          const nextAct = computeNextAction(
            r.status,
            r.run_control_status || 'active',
            r.current_step_order,
            vSteps || [],
            pendingJob
          );

          return {
            ...r,
            pending_job: pendingJob,
            automation_steps: vSteps || [],
            next_action: nextAct,
          };
        })
      );

      setRuns(enhanced);
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
    const target = runs.find((r) => r.id === runId);
    if (!target) return;

    if (target.isExpanded) {
      setRuns(runs.map((r) => (r.id === runId ? { ...r, isExpanded: false } : r)));
      return;
    }

    if (!target.steps) {
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

  const handlePauseResume = async (run: RunWithDetails) => {
    setIsActionLoading(true);
    try {
      if (run.status === 'paused' || run.run_control_status === 'paused') {
        const { error } = await supabase.rpc('resume_automation_run' as any, {
          p_run_id: run.id,
        });
        if (error) throw error;
        // Trigger runner
        supabase.functions.invoke('execute-automation-run', {
          body: { automation_run_id: run.id },
        }).catch(() => {});
      } else {
        const { error } = await supabase.rpc('pause_automation_run' as any, {
          p_run_id: run.id,
        });
        if (error) throw error;
      }
      await loadAutomationRuns();
    } catch (err) {
      console.error('Pause/Resume failed:', err);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmStop = async () => {
    if (!stopModalRun) return;
    setIsActionLoading(true);
    try {
      const { error } = await supabase.rpc('stop_automation_run' as any, {
        p_run_id: stopModalRun.id,
        p_reason_code: 'MANUAL_STOP',
        p_reason_message: 'Stopped manually from lead detail',
      });
      if (error) throw error;
      setStopModalRun(null);
      await loadAutomationRuns();
    } catch (err) {
      console.error('Stop failed:', err);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRetryStep = async (runId: string, _stepRunId: string) => {
    setIsActionLoading(true);
    try {
      // Re-invoke execution runner with idempotency & provider reconciliation
      const { error } = await supabase.functions.invoke('execute-automation-run', {
        body: { automation_run_id: runId },
      });
      if (error) throw error;
      await loadAutomationRuns();
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setIsActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200">
            <Play className="h-3 w-3" /> Running
          </span>
        );
      case 'waiting':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Clock className="h-3 w-3" /> Waiting
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-50 text-amber-800 border border-amber-200">
            <Pause className="h-3 w-3" /> Paused
          </span>
        );
      case 'stopped_by_condition':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-50 text-purple-700 border border-purple-200">
            <ShieldAlert className="h-3 w-3" /> Stopped by Condition
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="h-3 w-3" /> Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-gray-600 border border-gray-200">
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

  const activeRuns = runs.filter((r) => ['pending', 'running', 'waiting', 'paused'].includes(r.status));
  const completedRuns = runs.filter((r) => ['completed', 'stopped_by_condition', 'cancelled', 'failed'].includes(r.status));

  return (
    <div className="card-executive p-6 space-y-6">
      {/* Header with Enroll in Sequence Button */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#08254f] text-[#449bd5] flex items-center justify-center shadow-xs">
            <GitFork className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xs font-bold font-heading uppercase tracking-wider text-[#08254f]">
              Automations & Sequences
            </h2>
            <p className="text-xs text-slate-500">
              {activeRuns.length} active • {completedRuns.length} historical
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadAutomationRuns}
            className="btn-secondary text-xs"
          >
            Refresh
          </button>
          <button
            onClick={() => setIsEnrollModalOpen(true)}
            className="btn-crimson text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Enroll in Sequence
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-gray-400">Loading automation history...</div>
      ) : runs.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <p className="text-xs text-gray-500">No automations or sequences enrolled for this contact.</p>
          <p className="text-[11px] text-gray-400">Click &ldquo;Enroll in Sequence&rdquo; above to start a follow-up cadence.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* AREA A: Active Automations / Sequences */}
          {activeRuns.length > 0 && (
            <div className="space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5 fill-current" /> Active Sequences & Workflows ({activeRuns.length})
              </span>

              <div className="space-y-3">
                {activeRuns.map((run) => {
                  const isSeq = run.automation?.automation_type === 'sequence';
                  const nextAction = run.next_action;

                  return (
                    <div
                      key={run.id}
                      className="border border-blue-200/80 bg-blue-50/20 rounded-2xl overflow-hidden text-xs shadow-2xs"
                    >
                      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 text-sm">
                              {run.automation?.name || 'Automation'}
                            </span>
                            {getStatusBadge(run.status)}
                            {isSeq && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-purple-50 text-purple-700 border border-purple-200">
                                Sequence
                              </span>
                            )}
                          </div>

                          {/* Next Action & Schedule */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400">Next Action:</span>
                              <strong className="font-semibold text-gray-900">
                                {nextAction?.actionLabel || 'Pending'}
                              </strong>
                            </div>

                            {nextAction?.scheduledAt && (
                              <div className="flex items-center gap-1 text-indigo-700 font-medium">
                                <Clock className="w-3.5 h-3.5" />
                                <span>
                                  Scheduled: {new Date(nextAction.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                              </div>
                            )}

                            <div className="text-[11px] text-gray-400">
                              Started: {new Date(run.started_at).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        {/* Controls: Pause / Resume, Stop, View Timeline */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handlePauseResume(run)}
                            disabled={isActionLoading}
                            className={`px-3 py-1.5 rounded-xl font-semibold text-xs border flex items-center gap-1.5 transition-colors ${
                              run.status === 'paused'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                            }`}
                          >
                            {run.status === 'paused' ? (
                              <>
                                <Play className="w-3 h-3 fill-current" /> Resume
                              </>
                            ) : (
                              <>
                                <Pause className="w-3 h-3" /> Pause
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => setStopModalRun(run)}
                            disabled={isActionLoading}
                            className="px-3 py-1.5 rounded-xl font-semibold text-xs bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 flex items-center gap-1 transition-colors"
                          >
                            <XCircle className="w-3 h-3" /> Stop
                          </button>

                          <button
                            onClick={() => toggleExpand(run.id)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-white transition-colors"
                          >
                            {run.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded Timeline if active */}
                      {run.isExpanded && renderTimeline(run, handleRetryStep)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AREA B: Completed / Concluded Automations */}
          {completedRuns.length > 0 && (
            <div className="space-y-3 pt-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Concluded Automations ({completedRuns.length})
              </span>

              <div className="space-y-2">
                {completedRuns.map((run) => (
                  <div
                    key={run.id}
                    className="border border-gray-200 rounded-2xl overflow-hidden text-xs bg-gray-50/50"
                  >
                    <div
                      onClick={() => toggleExpand(run.id)}
                      className="p-3.5 hover:bg-gray-100/60 cursor-pointer flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        {run.isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                        <div>
                          <div className="font-semibold text-gray-900 flex items-center gap-2">
                            {run.automation?.name || 'Automation'}
                            {run.stop_reason_message && (
                              <span className="text-[11px] font-normal text-purple-700">
                                — {run.stop_reason_message}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            Started: {new Date(run.started_at).toLocaleDateString()}
                            {run.completed_at && ` • Ended: ${new Date(run.completed_at).toLocaleDateString()}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {getStatusBadge(run.status)}
                      </div>
                    </div>

                    {/* Timeline view when opened */}
                    {run.isExpanded && renderTimeline(run, handleRetryStep)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Enrollment Modal */}
      <ManualEnrollmentModal
        isOpen={isEnrollModalOpen}
        leadId={leadId}
        leadName={leadName}
        onClose={() => setIsEnrollModalOpen(false)}
        onEnrolled={loadAutomationRuns}
      />

      {/* Stop Sequence Confirmation Modal */}
      {stopModalRun && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-100">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-gray-900">Stop this sequence?</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Stopping <strong>{stopModalRun.automation?.name}</strong> will immediately cancel any scheduled wait jobs and prevent further outreach. Past execution history will be preserved.
              </p>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl text-xs space-y-1 text-gray-700">
              <div>Current Step: <strong>Step {stopModalRun.current_step_order}</strong></div>
              <div>Status: <span className="uppercase font-bold">{stopModalRun.status}</span></div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setStopModalRun(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Keep Active
              </button>
              <button
                onClick={handleConfirmStop}
                disabled={isActionLoading}
                className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition-colors"
              >
                {isActionLoading ? 'Stopping...' : 'Confirm Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// AREA C: Detailed Run Timeline
function renderTimeline(
  run: RunWithDetails,
  onRetryStep: (runId: string, stepRunId: string) => void
) {
  return (
    <div className="p-4 bg-white border-t border-gray-100 space-y-3">
      {run.stop_reason_message && (
        <div className="p-2.5 bg-purple-50 text-purple-900 rounded-xl text-xs flex items-center gap-2 border border-purple-100">
          <ShieldAlert className="w-4 h-4 shrink-0 text-purple-600" />
          <span><strong>Stop Reason:</strong> {run.stop_reason_message}</span>
        </div>
      )}

      {run.last_error && (
        <div className="p-2.5 bg-red-50 text-red-800 rounded-xl text-xs flex items-center gap-2 border border-red-100">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span><strong>Error:</strong> {run.last_error}</span>
        </div>
      )}

      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
          Step Execution Timeline
        </span>

        {!run.steps || run.steps.length === 0 ? (
          <div className="py-3 text-xs text-gray-400 italic">No execution steps logged yet.</div>
        ) : (
          run.steps.map((step) => {
            const isEmail = step.action_type === 'send_email';
            const isSms = step.action_type === 'send_sms';
            const isCall = step.action_type === 'create_call_task';
            const isFailed = step.status === 'failed';
            const canRetry = isFailed && !['cancelled', 'stopped_by_condition'].includes(run.status);

            return (
              <div
                key={step.id}
                className="p-3 bg-gray-50 border border-gray-200/60 rounded-xl flex items-start justify-between text-xs transition-all hover:bg-gray-100/40"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-lg bg-white border border-gray-200 text-gray-700 flex items-center justify-center text-[10px] font-bold shadow-2xs">
                      {step.step_order}
                    </span>

                    {isEmail && <Mail className="w-3.5 h-3.5 text-blue-500" />}
                    {isSms && <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />}
                    {isCall && <PhoneCall className="w-3.5 h-3.5 text-purple-500" />}
                    {step.step_type === 'wait' && <Clock className="w-3.5 h-3.5 text-indigo-500" />}

                    <span className="font-bold text-gray-900 uppercase text-[10px]">
                      {step.action_type?.replace(/_/g, ' ') || step.step_type}
                    </span>

                    {step.provider && (
                      <span className="text-[10px] font-mono text-gray-400">
                        via {step.provider}
                      </span>
                    )}
                  </div>

                  {step.skip_reason_message && (
                    <p className="text-[11px] text-amber-700 pl-7 font-medium">
                      Skipped: {step.skip_reason_message}
                    </p>
                  )}

                  {step.error_message && (
                    <p className="text-[11px] text-red-700 pl-7 font-medium">
                      Failed: {step.error_message}
                    </p>
                  )}

                  {/* Delivery indicators */}
                  {step.status === 'completed' && (step.output_data as any)?.provider_message_id && (
                    <p className="text-[10px] text-emerald-700 pl-7 font-mono">
                      ✓ Delivered to provider (ID: {(step.output_data as any).provider_message_id})
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {canRetry && (
                    <button
                      onClick={() => onRetryStep(run.id, step.id)}
                      className="px-2.5 py-1 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition-colors shadow-2xs"
                    >
                      <RotateCcw className="w-3 h-3" /> Retry
                    </button>
                  )}

                  <div className="text-right">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-white border-gray-200 text-gray-700">
                      {step.status}
                    </span>
                    <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
                      {step.completed_at
                        ? new Date(step.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : step.started_at
                        ? new Date(step.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
