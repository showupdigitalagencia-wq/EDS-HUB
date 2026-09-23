import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import {
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Play,
  RotateCcw,
  X,
  Filter,
  User,
} from 'lucide-react';
import type { Automation, AutomationRun, AutomationRunStep } from '../../types/database';

export function AutomationRunsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();

  const isSequence = location.pathname.startsWith('/sequences');
  const backFallback = isSequence
    ? (id ? `/sequences/${id}` : '/sequences')
    : (id ? `/automations/${id}` : '/automations');

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);
  const [runSteps, setRunSteps] = useState<AutomationRunStep[]>([]);
  const [isLoadingSteps, setIsLoadingSteps] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    if (id) {
      loadData(id);
    }
  }, [id]);

  const loadData = async (autoId: string) => {
    setIsLoading(true);
    try {
      // 1. Fetch automation
      const { data: auto } = await supabase
        .from('automations')
        .select('*')
        .eq('id', autoId)
        .single();

      if (auto) setAutomation(auto);

      // 2. Fetch runs
      const { data: runsData, error: runsErr } = await supabase
        .from('automation_runs')
        .select('*, lead:leads(first_name, last_name, email, phone_raw, contact_preference)')
        .eq('automation_id', autoId)
        .order('started_at', { ascending: false });

      if (runsErr) throw runsErr;
      setRuns(runsData || []);
    } catch (err) {
      console.error('Failed to load automation runs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenRunDetail = async (run: AutomationRun) => {
    setSelectedRun(run);
    setIsLoadingSteps(true);
    try {
      const { data, error } = await supabase
        .from('automation_run_steps')
        .select('*, automation_step:automation_steps(*)')
        .eq('automation_run_id', run.id)
        .order('step_order', { ascending: true });

      if (error) throw error;
      setRunSteps(data || []);
    } catch (err) {
      console.error('Failed to load run steps:', err);
    } finally {
      setIsLoadingSteps(false);
    }
  };

  const handleCancelRun = async (runId: string) => {
    if (!confirm('Are you sure you want to cancel this automation run?')) return;
    try {
      await supabase
        .from('automation_runs')
        .update({
          status: 'cancelled',
          stop_reason: 'Manually cancelled by user',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      // Also cancel any pending automation_jobs for this run
      await supabase
        .from('automation_jobs')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('automation_run_id', runId);

      if (id) loadData(id);
      if (selectedRun?.id === runId) {
        setSelectedRun((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel run');
    }
  };

  const handleRetryRun = async (runId: string) => {
    setIsRetrying(true);
    try {
      // Re-invoke execute-automation-run via edge function or direct status reset
      await supabase
        .from('automation_runs')
        .update({
          status: 'pending',
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      // Call execute-automation-run
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      await fetch(`${supabaseUrl}/functions/v1/execute-automation-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ automation_run_id: runId }),
      });

      if (id) loadData(id);
      if (selectedRun?.id === runId) {
        handleOpenRunDetail({ ...selectedRun, status: 'running' });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to retry run');
    } finally {
      setIsRetrying(false);
    }
  };

  const filteredRuns = runs.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

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
    <Layout
      backTo={backFallback}
      eyebrow="MOTORES & FLUXOS"
      title={`Execuções: ${automation?.name || 'Automação'}`}
      subtitle="Histórico detalhado de execução e inspeção passo a passo de contatos inscritos"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => id && loadData(id)}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
          <button
            onClick={() => navigate(`/automations/${id}`)}
            className="btn-primary text-xs px-3 py-1.5"
          >
            Editar Automação
          </button>
        </div>
      }
    >
      <div className="space-y-6 pb-12">

        {/* Status Filters */}
        <div className="flex items-center gap-2 bg-white p-2.5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-xs font-semibold text-gray-400 px-2 flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Filter:
          </span>
          {['all', 'running', 'waiting', 'completed', 'failed', 'cancelled'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 text-xs font-semibold rounded-xl transition-all ${
                statusFilter === st
                  ? 'bg-brand-50 text-brand-700 shadow-2xs'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {st.charAt(0).toUpperCase() + st.slice(1)} ({runs.filter((r) => st === 'all' || r.status === st).length})
            </button>
          ))}
        </div>

        {/* Runs Table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-400">Loading runs...</div>
          ) : filteredRuns.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-400 space-y-1">
              <p className="font-semibold text-gray-600">No runs match the selected filter</p>
              <p className="text-[11px] text-gray-400">
                Runs will appear here when events match this automation's trigger.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                  <th className="py-3.5 px-6">Lead</th>
                  <th className="py-3.5 px-4">Contact Preference</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-center">Step</th>
                  <th className="py-3.5 px-4">Started At</th>
                  <th className="py-3.5 px-4">Completed / Stopped</th>
                  <th className="py-3.5 px-6 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {filteredRuns.map((run) => {
                  const leadName = `${run.lead?.first_name || ''} ${run.lead?.last_name || ''}`.trim() || run.lead?.email || 'Lead';
                  return (
                    <tr
                      key={run.id}
                      onClick={() => handleOpenRunDetail(run)}
                      className="hover:bg-gray-50/80 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-6 font-semibold text-gray-900">
                        <div>{leadName}</div>
                        <div className="text-[11px] text-gray-400 font-normal">{run.lead?.email}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-gray-100 text-gray-700">
                          {run.lead?.contact_preference || 'email'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">{getStatusBadge(run.status)}</td>
                      <td className="py-3.5 px-4 text-center font-mono text-gray-700">
                        {run.current_step_order}
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 text-[11px]">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 text-[11px]">
                        {run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRunDetail(run);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Run Detail Modal / Drawer */}
        {selectedRun && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Drawer Header */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(selectedRun.status)}
                    <h2 className="text-base font-bold text-gray-900">Run Inspector</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Lead: {selectedRun.lead?.first_name} {selectedRun.lead?.last_name} ({selectedRun.lead?.email})
                  </p>
                </div>
                <button
                  onClick={() => setSelectedRun(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                {selectedRun.stop_reason && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    <span className="font-semibold">Stop Reason:</span> {selectedRun.stop_reason}
                  </div>
                )}

                {selectedRun.last_error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                    <span className="font-semibold">Error:</span> {selectedRun.last_error}
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Step-by-Step History
                  </h3>

                  {isLoadingSteps ? (
                    <div className="py-6 text-center text-xs text-gray-400">Loading step log...</div>
                  ) : runSteps.length === 0 ? (
                    <div className="py-6 text-center text-xs text-gray-400">No steps recorded yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {runSteps.map((step) => {
                        return (
                          <div
                            key={step.id}
                            className="p-3 bg-white border border-gray-200 rounded-xl text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-bold">
                                  {step.step_order}
                                </span>
                                <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                  {step.step_type}
                                </span>
                                {step.action_type && (
                                  <span className="font-mono text-gray-800 font-semibold">
                                    {step.action_type}
                                  </span>
                                )}
                              </div>

                              <div>{getStatusBadge(step.status)}</div>
                            </div>

                            {/* Skip Reason */}
                            {step.skip_reason_message && (
                              <p className="text-amber-700 font-medium text-[11px] pl-7">
                                Skip Reason: {step.skip_reason_message}
                              </p>
                            )}

                            {/* Error Details */}
                            {step.error_message && (
                              <p className="text-red-700 font-medium text-[11px] pl-7">
                                Error: {step.error_message}
                              </p>
                            )}

                            {/* Timestamp */}
                            <div className="text-[10px] text-gray-400 pl-7 flex items-center justify-between pt-1">
                              <span>
                                {step.completed_at
                                  ? `Completed at: ${new Date(step.completed_at).toLocaleTimeString()}`
                                  : step.started_at
                                  ? `Started at: ${new Date(step.started_at).toLocaleTimeString()}`
                                  : ''}
                              </span>
                              {step.provider && (
                                <span className="uppercase font-mono text-[9px] bg-gray-100 px-1 rounded">
                                  Provider: {step.provider}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Drawer Footer Actions */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <button
                  onClick={() => navigate(`/leads/${selectedRun.lead_id}`)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  <User className="h-3.5 w-3.5" />
                  View Lead Profile
                </button>

                <div className="flex items-center gap-2">
                  {selectedRun.status === 'failed' && (
                    <button
                      onClick={() => handleRetryRun(selectedRun.id)}
                      disabled={isRetrying}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {isRetrying ? 'Retrying...' : 'Retry Run'}
                    </button>
                  )}

                  {(selectedRun.status === 'running' || selectedRun.status === 'waiting') && (
                    <button
                      onClick={() => handleCancelRun(selectedRun.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl border border-red-200 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel Run
                    </button>
                  )}

                  <button
                    onClick={() => setSelectedRun(null)}
                    className="px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
