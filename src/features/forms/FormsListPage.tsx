import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import type { Form } from '../../types';
import {
  ClipboardList,
  Plus,
  Search,
  ExternalLink,
  Copy,
  Check,
  Edit2,
  Trash2,
  Archive,
  BarChart2,
  Eye,
  Globe,
  Tag,
} from 'lucide-react';

export function FormsListPage() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchForms = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Query forms
      const { data: formsData, error: formsErr } = await supabase
        .from('forms')
        .select('*')
        .order('created_at', { ascending: false });

      if (formsErr) throw formsErr;

      // Query submission counts for each form
      const { data: subsData, error: subsErr } = await supabase
        .from('form_submissions')
        .select('form_id, lead_id');

      if (subsErr) console.warn('Could not fetch submissions count:', subsErr);

      const subCountMap: Record<string, { total: number; leads: number }> = {};
      if (subsData) {
        for (const sub of subsData) {
          if (!subCountMap[sub.form_id]) {
            subCountMap[sub.form_id] = { total: 0, leads: 0 };
          }
          subCountMap[sub.form_id].total += 1;
          if (sub.lead_id) {
            subCountMap[sub.form_id].leads += 1;
          }
        }
      }

      const enhancedForms: Form[] = (formsData || []).map((f) => ({
        ...f,
        default_tags: Array.isArray(f.default_tags) ? f.default_tags : [],
        submission_count: subCountMap[f.id]?.total || 0,
        lead_count: subCountMap[f.id]?.leads || 0,
      }));

      setForms(enhancedForms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forms');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  const handleCopyLink = (slug: string) => {
    const origin = window.location.origin;
    const url = `${origin}/f/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2500);
  };

  const handleToggleStatus = async (form: Form) => {
    const nextStatus = form.status === 'active' ? 'inactive' : 'active';
    setActionInProgressId(form.id);
    try {
      const { error: updateErr } = await supabase
        .from('forms')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', form.id);

      if (updateErr) throw updateErr;

      setForms((prev) =>
        prev.map((f) => (f.id === form.id ? { ...f, status: nextStatus } : f))
      );
      setActionMessage(`Form ${nextStatus === 'active' ? 'activated' : 'deactivated'} successfully.`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to toggle status');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDeleteOrArchive = async (form: Form) => {
    const hasSubs = (form.submission_count || 0) > 0;
    const confirmPrompt = hasSubs
      ? `This form has ${form.submission_count} submissions. It cannot be deleted, but it will be archived (marked inactive). Proceed?`
      : `Are you sure you want to permanently delete form "${form.name}"?`;

    if (!window.confirm(confirmPrompt)) return;

    setActionInProgressId(form.id);
    try {
      const { data, error: rpcErr } = await supabase.rpc('archive_or_delete_form', {
        p_form_id: form.id,
      });

      if (rpcErr) throw rpcErr;

      if (data?.action === 'deleted') {
        setForms((prev) => prev.filter((f) => f.id !== form.id));
        setActionMessage('Form permanently deleted.');
      } else {
        setForms((prev) =>
          prev.map((f) => (f.id === form.id ? { ...f, status: 'inactive' } : f))
        );
        setActionMessage('Form archived (inactive) to preserve submissions.');
      }
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to process request');
    } finally {
      setActionInProgressId(null);
    }
  };

  // Filter forms
  const filteredForms = forms.filter((form) => {
    const matchesSearch =
      form.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      form.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (form.description && form.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === 'all' ? true : form.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const totalForms = forms.length;
  const activeForms = forms.filter((f) => f.status === 'active').length;
  const totalSubmissions = forms.reduce((acc, f) => acc + (f.submission_count || 0), 0);
  const totalLeads = forms.reduce((acc, f) => acc + (f.lead_count || 0), 0);

  return (
    <Layout title="Forms">
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <ClipboardList className="h-7 w-7 text-brand-600" />
              Lead Capture Forms
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Create, version, and manage high-converting capture forms connected to EDS intake automation.
            </p>
          </div>
          <button
            id="btn-create-form"
            onClick={() => navigate('/forms/new')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors duration-150"
          >
            <Plus className="h-4 w-4" />
            Create Form
          </button>
        </div>

        {/* Action message alert */}
        {actionMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-fadeIn">
            <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span>{actionMessage}</span>
          </div>
        )}

        {/* Metrics Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Forms</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{totalForms}</p>
            <p className="text-xs text-gray-400 mt-0.5">{activeForms} active</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Forms</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{activeForms}</p>
            <p className="text-xs text-gray-400 mt-0.5">Ready for public submissions</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Submissions</p>
            <p className="text-2xl font-bold text-brand-600 mt-1">{totalSubmissions}</p>
            <p className="text-xs text-gray-400 mt-0.5">Across all active versions</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Leads Generated</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">{totalLeads}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalSubmissions > 0 ? `${Math.round((totalLeads / totalSubmissions) * 100)}% lead capture rate` : '0%'}
            </p>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative w-full sm:w-80">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-gray-500">Status:</span>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                All ({totalForms})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'active'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Active ({activeForms})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('inactive')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'inactive'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Inactive ({totalForms - activeForms})
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        {isLoading ? (
          <LoadingState message="Loading forms..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchForms} />
        ) : filteredForms.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-7 w-7 text-gray-300" />}
            title={searchQuery || statusFilter !== 'all' ? 'No matching forms found' : 'No forms created yet'}
            message={
              searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search query or status filter.'
                : 'Build your first native form to start capturing and qualifying leads directly into EDS HUB.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredForms.map((form) => {
              const publicUrl = `${window.location.origin}/f/${form.slug}`;
              const isCopied = copiedSlug === form.slug;
              const isActing = actionInProgressId === form.id;

              return (
                <div
                  key={form.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="p-5 border-b border-gray-100">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-semibold text-gray-900 truncate" title={form.name}>
                            {form.name}
                          </h2>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700">
                            v{form.current_version}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 font-mono">/f/{form.slug}</p>
                      </div>

                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          form.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}
                      >
                        {form.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {form.description && (
                      <p className="text-xs text-gray-600 mt-3 line-clamp-2">{form.description}</p>
                    )}

                    {/* Public URL Box */}
                    <div className="mt-4 p-2.5 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Globe className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className="text-xs text-gray-600 truncate font-mono">{publicUrl}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleCopyLink(form.slug)}
                          title="Copy public link"
                          className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-200 transition-colors"
                        >
                          {isCopied ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <a
                          href={`/f/${form.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open public form"
                          className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-200 transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Card Metrics & Details */}
                  <div className="p-5 bg-gray-50/50 flex-1 flex flex-col justify-between">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-2xs">
                        <span className="text-[11px] font-medium text-gray-400 block uppercase">Submissions</span>
                        <span className="text-lg font-bold text-gray-900 mt-0.5 block">
                          {form.submission_count || 0}
                        </span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-2xs">
                        <span className="text-[11px] font-medium text-gray-400 block uppercase">Leads Created</span>
                        <span className="text-lg font-bold text-indigo-600 mt-0.5 block">
                          {form.lead_count || 0}
                        </span>
                      </div>
                    </div>

                    {form.source_detail && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-4">
                        <Tag className="h-3.5 w-3.5 text-gray-400" />
                        <span>Source Detail: <strong className="text-gray-700">{form.source_detail}</strong></span>
                      </div>
                    )}

                    {/* Card Actions */}
                    <div className="pt-3 border-t border-gray-200 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/forms/${form.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-2xs transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/forms/${form.id}/submissions`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 shadow-2xs transition-colors"
                        >
                          <BarChart2 className="h-3.5 w-3.5 text-brand-600" />
                          Submissions
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => handleToggleStatus(form)}
                          title={form.status === 'active' ? 'Deactivate form' : 'Activate form'}
                          className="p-1.5 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                        >
                          {form.status === 'active' ? (
                            <Archive className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => handleDeleteOrArchive(form)}
                          title={(form.submission_count || 0) > 0 ? 'Archive form' : 'Delete form'}
                          className="p-1.5 text-red-500 hover:text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
