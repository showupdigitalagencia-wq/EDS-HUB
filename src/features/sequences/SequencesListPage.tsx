import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { supabase } from '../../lib/supabase';
import {
  GitFork,
  Plus,
  Sparkles,
  Play,
  Pause,
  ArrowRight,
  ShieldAlert,
  Search,
  Mail,
  MessageSquare,
  ListTodo,
} from 'lucide-react';
import type { Automation, SequenceMetrics } from '../../types/database';
import { SequenceTemplateModal } from './SequenceTemplateModal';
import type { SequenceTemplate } from './sequence-templates';

export function SequencesListPage() {
  const navigate = useNavigate();
  const [sequences, setSequences] = useState<Automation[]>([]);
  const [metrics, setMetrics] = useState<SequenceMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch sequences
      let query = supabase
        .from('automations')
        .select('*, automation_versions(id, version, status)')
        .eq('automation_type', 'sequence')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setSequences(data || []);

      // 2. Fetch metrics
      const { data: metricsData } = await supabase.rpc('get_sequence_metrics' as any);
      if (metricsData) {
        setMetrics(metricsData as SequenceMetrics);
      }
    } catch (err) {
      console.error('Failed to load sequences:', err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleStatus = async (seq: Automation, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = seq.status === 'active' ? 'paused' : 'active';
    try {
      const { error } = await supabase
        .from('automations')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', seq.id);

      if (error) throw error;
      setSequences((prev) =>
        prev.map((s) => (s.id === seq.id ? { ...s, status: newStatus } : s))
      );
    } catch (err) {
      console.error('Failed to toggle sequence status:', err);
    }
  };

  const handleSelectTemplate = (template: SequenceTemplate) => {
    setIsTemplateModalOpen(false);
    navigate('/sequences/new', { state: { template } });
  };

  const filteredSequences = sequences.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Layout title="Follow-up Sequences">
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
              <GitFork className="h-7 w-7 text-brand-600" />
              Follow-up Sequences
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Automated multi-touch cadences that continue outreach until a lead responds or status changes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsTemplateModalOpen(true)}
              className="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 shadow-2xs"
            >
              <Sparkles className="w-4 h-4 text-brand-600" />
              Browse Templates
            </button>
            <button
              onClick={() => navigate('/sequences/new')}
              className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 shadow-xs"
            >
              <Plus className="w-4 h-4" />
              New Sequence
            </button>
          </div>
        </div>

        {/* Aggregated KPI Metrics Bar */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active</div>
              <div className="text-xl font-bold text-blue-600 mt-1">{metrics.active_runs}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Waiting</div>
              <div className="text-xl font-bold text-indigo-600 mt-1">{metrics.waiting_runs}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Paused</div>
              <div className="text-xl font-bold text-amber-600 mt-1">{metrics.paused_runs}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Completed</div>
              <div className="text-xl font-bold text-emerald-600 mt-1">{metrics.completed_runs}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Stopped</div>
              <div className="text-xl font-bold text-purple-600 mt-1">{metrics.stopped_by_condition_runs}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <Mail className="w-3 h-3 text-blue-500" /> Emails
              </div>
              <div className="text-xl font-bold text-gray-800 mt-1">{metrics.emails_sent}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-emerald-500" /> SMS
              </div>
              <div className="text-xl font-bold text-gray-800 mt-1">{metrics.sms_sent}</div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <ListTodo className="w-3 h-3 text-purple-500" /> Tasks
              </div>
              <div className="text-xl font-bold text-gray-800 mt-1">{metrics.tasks_created}</div>
            </div>
          </div>
        )}

        {/* Filter & Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search sequences..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {['all', 'active', 'draft', 'paused', 'archived'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Sequences Grid / Cards */}
        {isLoading ? (
          <div className="py-16 text-center text-xs text-gray-400">Loading sequences...</div>
        ) : filteredSequences.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-3xl p-12 text-center max-w-lg mx-auto space-y-4 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 mx-auto">
              <GitFork className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">No follow-up sequences found</h3>
              <p className="text-xs text-gray-500 mt-1">
                Start from a pre-configured template to set up a multi-touch cadence in seconds.
              </p>
            </div>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                onClick={() => setIsTemplateModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <Sparkles className="w-4 h-4" />
                Browse Templates
              </button>
              <button
                onClick={() => navigate('/sequences/new')}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold text-xs transition-colors"
              >
                Create from Scratch
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSequences.map((seq) => {
              const stopConds = seq.stop_conditions || [];
              return (
                <div
                  key={seq.id}
                  onClick={() => navigate(`/sequences/${seq.id}`)}
                  className="bg-white border border-gray-200 rounded-3xl p-5 shadow-2xs hover:shadow-md hover:border-brand-200 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="font-bold text-gray-900 text-sm group-hover:text-brand-600 transition-colors">
                          {seq.name}
                        </h3>
                        <div className="text-[11px] text-gray-400 font-mono flex items-center gap-2">
                          <span>v{seq.current_version}</span>
                          <span>•</span>
                          <span>Trigger: {seq.trigger_type}</span>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          seq.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : seq.status === 'draft'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : seq.status === 'paused'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}
                      >
                        {seq.status}
                      </span>
                    </div>

                    <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                      {seq.description || 'No description provided.'}
                    </p>

                    {/* Stop condition badge */}
                    {stopConds.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-purple-700 bg-purple-50/70 border border-purple-200/60 px-2.5 py-1 rounded-xl">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          Stops if {stopConds[0].type}: <strong>{stopConds[0].values?.join(', ')}</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Footer actions */}
                  <div className="pt-4 mt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <button
                      onClick={(e) => toggleStatus(seq, e)}
                      className={`font-semibold text-xs flex items-center gap-1 transition-colors ${
                        seq.status === 'active'
                          ? 'text-amber-600 hover:text-amber-700'
                          : 'text-emerald-600 hover:text-emerald-700'
                      }`}
                    >
                      {seq.status === 'active' ? (
                        <>
                          <Pause className="w-3.5 h-3.5" /> Pause Sequence
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" /> Activate
                        </>
                      )}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/automations/${seq.id}/runs`);
                      }}
                      className="font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
                    >
                      View Runs <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Template Selection Modal */}
      <SequenceTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onSelectTemplate={handleSelectTemplate}
      />
    </Layout>
  );
}
