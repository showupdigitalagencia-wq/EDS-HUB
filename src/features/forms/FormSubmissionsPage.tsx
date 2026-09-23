import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import type { Form, FormSubmission, FormField } from '../../types';
import {
  BarChart2,
  Search,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  User,
  X,
  ShieldAlert,
} from 'lucide-react';

export function FormSubmissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<Form | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [fieldsByVersion, setFieldsByVersion] = useState<Record<number, FormField[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);

  const loadData = useCallback(async (formId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Load form
      const { data: formData, error: formErr } = await supabase
        .from('forms')
        .select('*')
        .eq('id', formId)
        .single();

      if (formErr) throw formErr;
      setForm(formData);

      // 2. Load fields across all versions for this form
      const { data: fieldsData } = await supabase
        .from('form_fields')
        .select('*')
        .eq('form_id', formId)
        .order('sort_order', { ascending: true });

      const versionMap: Record<number, FormField[]> = {};
      if (fieldsData) {
        for (const f of fieldsData) {
          if (!versionMap[f.version]) versionMap[f.version] = [];
          versionMap[f.version].push(f);
        }
      }
      setFieldsByVersion(versionMap);

      // 3. Load submissions with lead join
      const { data: subsData, error: subsErr } = await supabase
        .from('form_submissions')
        .select(`
          *,
          lead:leads (
            first_name,
            last_name,
            email
          )
        `)
        .eq('form_id', formId)
        .order('submitted_at', { ascending: false });

      if (subsErr) throw subsErr;
      setSubmissions(subsData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) {
      loadData(id);
    }
  }, [id, loadData]);

  const filteredSubmissions = submissions.filter((sub) => {
    const leadName = sub.lead ? `${sub.lead.first_name || ''} ${sub.lead.last_name || ''}`.trim() : '';
    const matchesSearch =
      (sub.email && sub.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (sub.phone_e164 && sub.phone_e164.includes(searchQuery)) ||
      leadName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.idempotency_key.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' ? true : sub.processing_status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const total = submissions.length;
  const processed = submissions.filter((s) => s.processing_status === 'processed').length;
  const conflicts = submissions.filter((s) => s.processing_status === 'conflict').length;
  const failed = submissions.filter((s) => s.processing_status === 'failed').length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle className="h-3 w-3" />
            Processed
          </span>
        );
      case 'conflict':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200" title="Email and phone belong to different leads. Automatic merge prevented.">
            <AlertTriangle className="h-3 w-3" />
            Conflict
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="h-3 w-3" />
            Processing
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
            {status}
          </span>
        );
    }
  };

  return (
    <Layout
      backTo="/forms"
      eyebrow="INTAKE & FORMULÁRIOS"
      title={form ? `${form.name} — Submissões` : 'Submissões do Formulário'}
      subtitle={form ? `Histórico de envios e integridade de captura para /f/${form.slug} (v${form.current_version})` : 'Histórico de envios e integridade de captura'}
      actions={
        form ? (
          <button
            type="button"
            onClick={() => navigate(`/forms/${form.id}`)}
            className="btn-secondary text-xs px-3 py-2"
          >
            Editar Formulário
          </button>
        ) : undefined
      }
    >
      <div className="space-y-6">

        {/* Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">Total</span>
            <span className="text-2xl font-bold text-gray-900 mt-1 block">{total}</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider block">Processed</span>
            <span className="text-2xl font-bold text-emerald-700 mt-1 block">{processed}</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider block">Conflicts</span>
            <span className="text-2xl font-bold text-amber-700 mt-1 block">{conflicts}</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider block">Failed</span>
            <span className="text-2xl font-bold text-rose-700 mt-1 block">{failed}</span>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative w-full sm:w-80">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by email, phone, lead..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-gray-500">Status:</span>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                All ({total})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('processed')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'processed' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                Processed ({processed})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('conflict')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'conflict' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                Conflicts ({conflicts})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('failed')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === 'failed' ? 'bg-white text-rose-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                Failed ({failed})
              </button>
            </div>
          </div>
        </div>

        {/* Submissions Table */}
        {isLoading ? (
          <LoadingState message="Loading submissions..." />
        ) : error ? (
          <ErrorState message={error} onRetry={() => id && loadData(id)} />
        ) : filteredSubmissions.length === 0 ? (
          <EmptyState
            icon={<BarChart2 className="h-7 w-7 text-gray-300" />}
            title={searchQuery || statusFilter !== 'all' ? 'No matching submissions found' : 'No submissions yet'}
            message={
              searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search criteria or status filter.'
                : 'Share your public link to start collecting submissions.'
            }
          />
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Date / Time</th>
                    <th className="py-3.5 px-4">Lead</th>
                    <th className="py-3.5 px-4">Email</th>
                    <th className="py-3.5 px-4">Phone</th>
                    <th className="py-3.5 px-4">Channel</th>
                    <th className="py-3.5 px-4">Version</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSubmissions.map((sub) => {
                    const leadFullName = sub.lead
                      ? `${sub.lead.first_name || ''} ${sub.lead.last_name || ''}`.trim()
                      : null;

                    return (
                      <tr
                        key={sub.id}
                        onClick={() => setSelectedSubmission(sub)}
                        className="hover:bg-gray-50/80 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs text-gray-500">
                          {new Date(sub.submitted_at).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {sub.lead_id ? (
                            <Link
                              to={`/leads/${sub.lead_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-brand-600 hover:text-brand-800 hover:underline flex items-center gap-1.5"
                            >
                              <User className="h-3.5 w-3.5 text-gray-400" />
                              <span>{leadFullName || 'View Lead'}</span>
                            </Link>
                          ) : (
                            <span className="text-gray-400 text-xs italic">Unlinked / Conflict</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs text-gray-700">
                          {sub.email || '—'}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs text-gray-700 font-mono">
                          {sub.phone_e164 || '—'}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs text-gray-700 uppercase">
                          {sub.contact_preference ? (
                            <span className="font-semibold text-gray-600">{sub.contact_preference}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-gray-100 text-gray-600">
                            v{sub.form_version}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {getStatusBadge(sub.processing_status)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-right text-xs">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSubmission(sub);
                            }}
                            className="text-brand-600 hover:text-brand-800 font-medium"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Submission Details Drawer */}
        {selectedSubmission && (
          <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end">
            <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-slideLeft">
              {/* Drawer Header */}
              <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Submission Details</h3>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">ID: {selectedSubmission.id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSubmission(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Status Callout */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">Status</span>
                    <div className="mt-1">{getStatusBadge(selectedSubmission.processing_status)}</div>
                    {selectedSubmission.processing_error && (
                      <p className="text-xs text-rose-600 mt-2 font-medium bg-rose-50 p-2 rounded border border-rose-200">
                        {selectedSubmission.processing_error}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">Form Version</span>
                    <span className="text-sm font-mono font-bold text-gray-800 block mt-1">
                      v{selectedSubmission.form_version}
                    </span>
                  </div>
                </div>

                {/* Conflict Notice */}
                {selectedSubmission.processing_status === 'conflict' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-amber-900 text-xs">
                    <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-amber-950">Conflict Isolation Applied</p>
                      <p className="mt-1">
                        The submitted email and phone number matched different leads in the CRM database.
                        In accordance with security rules, the system did not perform an automatic merge and withheld
                        automated first-touch messaging. Staff review is required.
                      </p>
                    </div>
                  </div>
                )}

                {/* Lead Connection */}
                {selectedSubmission.lead_id && (
                  <div className="p-4 bg-brand-50/50 rounded-xl border border-brand-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <User className="h-5 w-5 text-brand-600" />
                      <div>
                        <span className="text-xs font-semibold text-brand-900 block">Connected Lead</span>
                        <span className="text-xs text-brand-700">
                          {selectedSubmission.lead
                            ? `${selectedSubmission.lead.first_name || ''} ${selectedSubmission.lead.last_name || ''}`.trim()
                            : selectedSubmission.lead_id}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/leads/${selectedSubmission.lead_id}`}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1"
                    >
                      <span>Open Lead</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}

                {/* Submitted Form Fields (with Version Matching) */}
                <div>
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">
                    Submitted Data (Version {selectedSubmission.form_version} Mapping)
                  </h4>
                  <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                    {(() => {
                      const verFields = fieldsByVersion[selectedSubmission.form_version] || [];
                      const submittedData = selectedSubmission.submitted_data || {};
                      const entries = Object.entries(submittedData);

                      if (entries.length === 0) {
                        return <p className="p-4 text-xs text-gray-400">No field data recorded.</p>;
                      }

                      return entries.map(([key, value]) => {
                        const fieldDef = verFields.find((f) => f.internal_name === key);
                        const displayLabel = fieldDef ? fieldDef.label : key;

                        return (
                          <div key={key} className="p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                            <div className="min-w-0">
                              <span className="font-semibold text-gray-700">{displayLabel}</span>
                              <span className="text-gray-400 font-mono text-[11px] ml-1.5">({key})</span>
                            </div>
                            <span className="font-medium text-gray-900 break-all sm:text-right">
                              {value !== null && value !== undefined && value !== '' ? String(value) : '—'}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* Technical Audit Information */}
                <div>
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">
                    Audit & Delivery Information
                  </h4>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2.5 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Idempotency Key:</span>
                      <span className="text-gray-800 break-all">{selectedSubmission.idempotency_key}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Source Detail:</span>
                      <span className="text-gray-800">{selectedSubmission.source_detail || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">IP Address:</span>
                      <span className="text-gray-800">{selectedSubmission.ip_address || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Submitted At:</span>
                      <span className="text-gray-800">{new Date(selectedSubmission.submitted_at).toISOString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Processed At:</span>
                      <span className="text-gray-800">
                        {selectedSubmission.processed_at ? new Date(selectedSubmission.processed_at).toISOString() : '—'}
                      </span>
                    </div>
                    {selectedSubmission.intake_event_id && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Intake Event ID:</span>
                        <span className="text-gray-800">{selectedSubmission.intake_event_id}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
