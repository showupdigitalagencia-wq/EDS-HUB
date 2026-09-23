import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { SavedSegmentsModal } from './components/SavedSegmentsModal';
import type { Campaign, CampaignStatus, CampaignChannel } from '../../types';
import {
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  FileEdit,
  RotateCw,
  Bookmark,
} from 'lucide-react';

export function CampaignsListPage() {
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('all');

  // Saved Segments Modal state
  const [isSavedSegmentsOpen, setIsSavedSegmentsOpen] = useState(false);

  // Create Campaign Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampSubject, setNewCampSubject] = useState('');
  const [newCampChannel, setNewCampChannel] = useState<CampaignChannel>('email');
  const [isCreating, setIsCreating] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let query = supabase.from('campaigns').select('*').order('created_at', { ascending: false });
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }
      if (channelFilter && channelFilter !== 'all') {
        query = query.eq('channel', channelFilter);
      }
      const { data, error: err } = await query;
      if (err) throw err;
      setCampaigns(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCampName.trim()) return;
    setIsCreating(true);

    try {
      const defaultSubject =
        newCampChannel === 'call'
          ? 'Outbound Phone Follow-up'
          : newCampChannel === 'sms'
          ? 'SMS Announcement'
          : 'Exciting Updates from Expert Dental Solutions';

      const { data: newCamp, error: createErr } = await supabase
        .from('campaigns')
        .insert({
          name: newCampName.trim(),
          subject: newCampSubject.trim() || defaultSubject,
          channel: newCampChannel,
          from_name: 'Expert Dental Solutions',
          status: 'draft',
        })
        .select()
        .single();

      if (createErr || !newCamp) throw createErr || new Error('Failed to create campaign');

      // Create initial version
      await supabase.from('campaign_versions').insert({
        campaign_id: newCamp.id,
        version_number: 1,
        subject: newCamp.subject,
      });

      // Create initial audience row with default preference filter
      await supabase.from('campaign_audiences').insert({
        campaign_id: newCamp.id,
        filter_definition: {
          version: 1,
          operator: 'and',
          rules: [{ field: 'contact_preference', operator: 'eq', value: newCampChannel }],
        },
        estimated_recipient_count: 0,
      });

      setIsCreateOpen(false);
      setNewCampName('');
      setNewCampSubject('');
      setNewCampChannel('email');
      navigate(`/campaigns/${newCamp.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating campaign');
    } finally {
      setIsCreating(false);
    }
  };

  const getChannelBadge = (channel: CampaignChannel = 'email') => {
    switch (channel) {
      case 'call':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-purple-50 text-purple-700 border border-purple-200">
            <PhoneCall className="h-3 w-3" /> Call
          </span>
        );
      case 'sms':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
            <MessageSquare className="h-3 w-3" /> SMS
          </span>
        );
      case 'email':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-sky-50 text-sky-700 border border-sky-200">
            <Mail className="h-3 w-3" /> Email
          </span>
        );
    }
  };

  const getStatusBadge = (status: CampaignStatus) => {
    switch (status) {
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
            <FileEdit className="h-3 w-3" /> Draft
          </span>
        );
      case 'pending_approval':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
            <Clock className="h-3 w-3" /> Pending Approval
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </span>
        );
      case 'scheduled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
            <Calendar className="h-3 w-3" /> Scheduled
          </span>
        );
      case 'sending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 animate-pulse">
            <Send className="h-3 w-3" /> Sending
          </span>
        );
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="h-3 w-3" /> Sent
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">
            <AlertCircle className="h-3 w-3" /> Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700 capitalize">
            {status}
          </span>
        );
    }
  };

  return (
    <Layout
      eyebrow="MARKETING & COMUNICAÇÃO"
      title="Campanhas"
      subtitle="Campanhas multicanal (Email, SMS) com segmentação canônica, congelamento de snapshot e histórico de versões"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-200/80 rounded-xl shadow-xs text-slate-700 font-heading"
          >
            <option value="all">Todos os Canais</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="call">Ligações</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-200/80 rounded-xl shadow-xs text-slate-700 font-heading"
          >
            <option value="">Todos os Status</option>
            <option value="draft">Rascunhos</option>
            <option value="pending_approval">Pendente de Aprovação</option>
            <option value="approved">Aprovadas</option>
            <option value="scheduled">Agendadas</option>
            <option value="sending">Enviando</option>
            <option value="sent">Enviadas</option>
          </select>

          <button
            onClick={() => setIsSavedSegmentsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-xl shadow-xs transition-colors cursor-pointer font-heading"
          >
            <Bookmark className="h-3.5 w-3.5 text-[#449bd5]" />
            <span>Segmentos Salvos</span>
          </button>

          <button
            onClick={fetchCampaigns}
            title="Atualizar campanhas"
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-white border border-slate-200/80 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          <button
            onClick={() => setIsCreateOpen(true)}
            className="btn-crimson text-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Campanha</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">


        {/* Content List */}
        {isLoading ? (
          <LoadingState message="Loading campaigns..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchCampaigns} />
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns found"
            message="Create your first marketing or call campaign with canonical audience segmentation, snapshot freezing, and approval workflows."
          />
        ) : (
          <div className="card-executive overflow-hidden">
            <div className="divide-y divide-slate-100">
              {campaigns.map((camp) => (
                <div
                  key={camp.id}
                  onClick={() => navigate(`/campaigns/${camp.id}`)}
                  className="p-5 hover:bg-slate-50/70 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-base font-bold font-heading text-[#08254f]">{camp.name}</h3>
                      {getChannelBadge(camp.channel)}
                      {getStatusBadge(camp.status)}
                    </div>
                    <p className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
                      <span>Subject: <strong className="text-gray-700">{camp.subject}</strong></span>
                      {camp.from_name && <span>• Sender: {camp.from_name}</span>}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
                    {camp.scheduled_at && (
                      <span className="flex items-center gap-1 text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(camp.scheduled_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    )}
                    <span>Created {new Date(camp.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modal: New Campaign Draft */}
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Create Campaign Draft</h2>
              <form onSubmit={handleCreateCampaign} className="space-y-4">
                {/* Channel Selector */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Campaign Channel *</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewCampChannel('email')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 ${
                        newCampChannel === 'email'
                          ? 'border-brand-500 bg-brand-50/50 text-brand-900 font-bold'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <Mail className={`h-4 w-4 ${newCampChannel === 'email' ? 'text-brand-600' : 'text-gray-400'}`} />
                      <span className="text-xs">Email</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewCampChannel('sms')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 ${
                        newCampChannel === 'sms'
                          ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-bold'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <MessageSquare className={`h-4 w-4 ${newCampChannel === 'sms' ? 'text-emerald-600' : 'text-gray-400'}`} />
                      <span className="text-xs">SMS</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewCampChannel('call')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 ${
                        newCampChannel === 'call'
                          ? 'border-purple-500 bg-purple-50/50 text-purple-900 font-bold'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <PhoneCall className={`h-4 w-4 ${newCampChannel === 'call' ? 'text-purple-600' : 'text-gray-400'}`} />
                      <span className="text-xs">Call Tasks</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    {newCampChannel === 'call'
                      ? 'Creates deduplicated call tasks in Daily Operations Work Queue upon activation.'
                      : 'Audience builder & snapshot freeze ready. Live sending deferred to Phase 7.'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Campaign Name *</label>
                  <input
                    type="text"
                    required
                    value={newCampName}
                    onChange={(e) => setNewCampName(e.target.value)}
                    placeholder={
                      newCampChannel === 'call'
                        ? 'e.g. Q3 Alumni Direct Phone Follow-up'
                        : 'e.g. Q3 Alumni Masterclass Announcement'
                    }
                    className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    {newCampChannel === 'call'
                      ? 'Call Script Goal / Objective'
                      : newCampChannel === 'sms'
                      ? 'SMS Topic / Header'
                      : 'Email Subject Line'}
                  </label>
                  <input
                    type="text"
                    value={newCampSubject}
                    onChange={(e) => setNewCampSubject(e.target.value)}
                    placeholder={
                      newCampChannel === 'call'
                        ? 'e.g. Follow-up regarding Next Level Restorative certification'
                        : 'e.g. Exclusive Masterclass for Dental Practitioners'
                    }
                    className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="px-5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs"
                  >
                    {isCreating ? 'Creating...' : 'Create Draft'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Saved Segments Management Modal */}
        <SavedSegmentsModal
          isOpen={isSavedSegmentsOpen}
          onClose={() => setIsSavedSegmentsOpen(false)}
        />
      </div>
    </Layout>
  );
}
