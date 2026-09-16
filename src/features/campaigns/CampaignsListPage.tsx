import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import type { Campaign, CampaignStatus } from '../../types';
import {
  Mail,
  Plus,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  FileEdit,
  RotateCw,
} from 'lucide-react';

export function CampaignsListPage() {
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  // Create Campaign Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampSubject, setNewCampSubject] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let query = supabase.from('campaigns').select('*').order('created_at', { ascending: false });
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }
      const { data, error: err } = await query;
      if (err) throw err;
      setCampaigns(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCampName.trim()) return;
    setIsCreating(true);

    try {
      const { data: newCamp, error: createErr } = await supabase
        .from('campaigns')
        .insert({
          name: newCampName.trim(),
          subject: newCampSubject.trim() || 'Exciting Updates from Expert Dental Solutions',
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

      // Create empty audience row
      await supabase.from('campaign_audiences').insert({
        campaign_id: newCamp.id,
        filter_definition: {},
        estimated_recipient_count: 0,
      });

      setIsCreateOpen(false);
      navigate(`/campaigns/${newCamp.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating campaign');
    } finally {
      setIsCreating(false);
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
    <Layout title="Campaigns">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-brand-50 text-brand-600">
                <Mail className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Campaigns</h1>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Email marketing campaigns with mandatory approval, A/B testing and batch dispatching
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs font-semibold bg-white border border-gray-200 rounded-xl shadow-xs"
            >
              <option value="">All Statuses</option>
              <option value="draft">Drafts</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="scheduled">Scheduled</option>
              <option value="sending">Sending</option>
              <option value="sent">Sent</option>
            </select>
            <button
              onClick={fetchCampaigns}
              title="Refresh campaigns"
              className="p-2 text-gray-500 hover:text-gray-800 hover:bg-white border border-gray-200 rounded-xl shadow-xs transition-colors"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Campaign
            </button>
          </div>
        </div>

        {/* Content List */}
        {isLoading ? (
          <LoadingState message="Loading campaigns..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchCampaigns} />
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns found"
            message="Create your first marketing campaign with visual blocks, target audience filters, and approval workflows."
          />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="divide-y divide-gray-100">
              {campaigns.map((camp) => (
                <div
                  key={camp.id}
                  onClick={() => navigate(`/campaigns/${camp.id}`)}
                  className="p-5 hover:bg-brand-50/20 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-bold text-gray-900">{camp.name}</h3>
                      {getStatusBadge(camp.status)}
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-2">
                      <span>Subject: <strong className="text-gray-700">{camp.subject}</strong></span>
                      {camp.from_name && <span>• From: {camp.from_name}</span>}
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
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Campaign Name</label>
                  <input
                    type="text"
                    required
                    value={newCampName}
                    onChange={(e) => setNewCampName(e.target.value)}
                    placeholder="e.g. Q3 Alumni Masterclass Announcement"
                    className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Email Subject Line</label>
                  <input
                    type="text"
                    value={newCampSubject}
                    onChange={(e) => setNewCampSubject(e.target.value)}
                    placeholder="e.g. Exclusive Masterclass for {{salutation}}"
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
      </div>
    </Layout>
  );
}
