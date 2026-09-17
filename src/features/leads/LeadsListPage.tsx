import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { NewLeadModal } from './components/NewLeadModal';
import { CsvImportModal } from './import/CsvImportModal';
import type { Lead, PipelineStage, Tag } from '../../types';
import { getQualificationStatusBadge } from './utils/qualificationMapping';
import { deriveScoreLabel, getScoreLabelBadge } from '../scoring/engine/score-evaluator';
import {
  Users,
  Plus,
  Upload,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  PhoneCall,
  RotateCw,
  Sparkles,
} from 'lucide-react';

const PAGE_SIZE = 15;

export function LeadsListPage() {
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get('sort');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [leadTagsMap, setLeadTagsMap] = useState<Record<string, Tag[]>>({});

  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sorting & Score Filters
  const [sortBy, setSortBy] = useState<'created_at' | 'lead_score'>(
    sortParam === 'score' ? 'lead_score' : 'created_at'
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [scoreFilter, setScoreFilter] = useState<string>('');

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [preferenceFilter, setPreferenceFilter] = useState('');
  const [qualificationFilter, setQualificationFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  // Modals
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // 1. Fetch reference data (stages, tags)
  useEffect(() => {
    async function loadRefs() {
      const [stagesRes, tagsRes] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
        supabase.from('tags').select('*').order('name', { ascending: true }),
      ]);
      if (stagesRes.data) setStages(stagesRes.data);
      if (tagsRes.data) setTags(tagsRes.data);
    }
    loadRefs();
  }, []);

  // 2. Fetch leads with server-side pagination & filters
  const fetchLeads = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('leads')
        .select('*', { count: 'exact' });

      // Search term
      if (searchTerm.trim()) {
        const term = `%${searchTerm.trim()}%`;
        query = query.or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone_raw.ilike.${term}`);
      }

      // Filter by stage
      if (stageFilter) {
        query = query.eq('pipeline_stage_id', stageFilter);
      }

      // Filter by source
      if (sourceFilter) {
        query = query.eq('source', sourceFilter);
      }

      // Filter by contact preference
      if (preferenceFilter) {
        query = query.eq('contact_preference', preferenceFilter);
      }

      // Filter by qualification status
      if (qualificationFilter) {
        query = query.eq('qualification_status', qualificationFilter);
      }

      // Filter by lead score band
      if (scoreFilter === 'very_hot') {
        query = query.gte('lead_score', 75);
      } else if (scoreFilter === 'hot') {
        query = query.gte('lead_score', 50).lte('lead_score', 74);
      } else if (scoreFilter === 'warm') {
        query = query.gte('lead_score', 25).lte('lead_score', 49);
      } else if (scoreFilter === 'cold') {
        query = query.lte('lead_score', 24);
      }

      // Filter by tag if selected
      if (tagFilter) {
        const { data: tagMatches } = await supabase
          .from('lead_tags')
          .select('lead_id')
          .eq('tag_id', tagFilter);

        const leadIds = (tagMatches || []).map((t) => t.lead_id);
        if (leadIds.length === 0) {
          setLeads([]);
          setTotalCount(0);
          setIsLoading(false);
          return;
        }
        query = query.in('id', leadIds);
      }

      // Pagination & Ordering
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, count, error: fetchErr } = await query
        .order(sortBy, { ascending: sortOrder === 'asc' })
        .range(from, to);

      if (fetchErr) throw fetchErr;

      const loadedLeads = (data as Lead[]) || [];
      setLeads(loadedLeads);
      setTotalCount(count || 0);

      // Fetch tags for these leads
      if (loadedLeads.length > 0) {
        const leadIds = loadedLeads.map((l) => l.id);
        const { data: tagLinks } = await supabase
          .from('lead_tags')
          .select('lead_id, tag_id, tags(*)')
          .in('lead_id', leadIds);

        const map: Record<string, Tag[]> = {};
        if (tagLinks) {
          tagLinks.forEach((link: any) => {
            if (!map[link.lead_id]) map[link.lead_id] = [];
            if (link.tags) map[link.lead_id].push(link.tags);
          });
        }
        setLeadTagsMap(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch leads');
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm, stageFilter, sourceFilter, preferenceFilter, qualificationFilter, tagFilter, currentPage]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    const handlePurged = () => {
      fetchLeads();
    };
    window.addEventListener('leads-purged', handlePurged);
    return () => window.removeEventListener('leads-purged', handlePurged);
  }, [fetchLeads]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  const stageMap = stages.reduce<Record<string, PipelineStage>>((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {});

  const getStageColor = (sortOrder: number) => {
    switch (sortOrder) {
      case 1: return 'bg-sky-50 text-sky-700 border-sky-200';
      case 2: return 'bg-amber-50 text-amber-700 border-amber-200';
      case 3: return 'bg-purple-50 text-purple-700 border-purple-200';
      case 4: return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 5: return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 6: return 'bg-blue-50 text-blue-700 border-blue-200';
      case 7: return 'bg-gray-50 text-gray-700 border-gray-200';
      default: return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  return (
    <Layout title="Leads">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
                <Users className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold text-[#08254f] tracking-tight font-heading">Leads & Contacts</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Centralized CRM database with real-time segmentation and tagging
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsImportOpen(true)}
              className="btn-secondary text-xs"
            >
              <Upload className="h-3.5 w-3.5 text-slate-500" />
              Import CSV
            </button>
            <button
              onClick={() => setIsNewLeadOpen(true)}
              className="btn-crimson text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              New Lead
            </button>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs space-y-3">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by name, email, or phone..."
                className="w-full pl-9 pr-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>

            {/* Stage filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400 shrink-0 hidden sm:inline" />
              <select
                value={stageFilter}
                onChange={(e) => {
                  setStageFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All Stages</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              {/* Source filter */}
              <select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All Sources</option>
                <option value="meta">Meta Ads</option>
                <option value="google">Google Ads</option>
                <option value="manual">Manual</option>
                <option value="test">Test</option>
              </select>

              {/* Contact preference */}
              <select
                value={preferenceFilter}
                onChange={(e) => {
                  setPreferenceFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All Preferences</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="call">Call</option>
              </select>

              {/* Qualification status */}
              <select
                value={qualificationFilter}
                onChange={(e) => {
                  setQualificationFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All Qualification</option>
                <option value="no_response">No Response</option>
                <option value="some_response">Some Response</option>
                <option value="interested">Interested</option>
                <option value="hot">Hot</option>
                <option value="confirmed">Confirmed</option>
              </select>

              {/* Tag filter */}
              <select
                value={tagFilter}
                onChange={(e) => {
                  setTagFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All Tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name}
                  </option>
                ))}
              </select>

              {/* Score Band filter */}
              <select
                value={scoreFilter}
                onChange={(e) => {
                  setScoreFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs font-medium bg-amber-50/50 border border-amber-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 text-amber-900"
              >
                <option value="">All Scores</option>
                <option value="very_hot">Very Hot (75+)</option>
                <option value="hot">Hot (50-74)</option>
                <option value="warm">Warm (25-49)</option>
                <option value="cold">Cold (0-24)</option>
              </select>

              <button
                onClick={fetchLeads}
                title="Refresh leads"
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Presets Bar */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mr-1">
              Views:
            </span>
            <button
              onClick={() => {
                setSortBy('created_at');
                setSortOrder('desc');
                setScoreFilter('');
                setSearchParams({});
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                sortBy === 'created_at' && !scoreFilter
                  ? 'bg-[#08254f] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Contacts
            </button>
            <button
              onClick={() => {
                setSortBy('lead_score');
                setSortOrder('desc');
                setSearchParams({ sort: 'score' });
                setCurrentPage(1);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                sortBy === 'lead_score'
                  ? 'bg-[#8a1c1c] text-white shadow-xs'
                  : 'bg-[#fdf2f2] text-[#8a1c1c] border border-red-200 hover:bg-red-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Priority Leads (Ranked by Score)
            </button>
          </div>
        </div>

        {/* Content Table */}
        {isLoading ? (
          <LoadingState message="Loading contacts..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchLeads} />
        ) : leads.length === 0 ? (
          <EmptyState
            title="No leads found"
            message="Create your first lead manually or import contacts from a CSV file."
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                <thead className="bg-[#f8fafc] text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200/80">
                  <tr>
                    <th className="px-5 py-3.5">Lead Name</th>
                    <th
                      onClick={() => {
                        setSortBy('lead_score');
                        setSortOrder((prev) => (sortBy === 'lead_score' && prev === 'desc' ? 'asc' : 'desc'));
                        setCurrentPage(1);
                      }}
                      className="px-5 py-3.5 cursor-pointer hover:bg-gray-100/70 select-none"
                    >
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Score</span>
                        {sortBy === 'lead_score' && (
                          <span className="text-[10px] text-amber-600 font-bold">
                            {sortOrder === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </th>
                    <th className="px-5 py-3.5">Contact Info</th>
                    <th className="px-5 py-3.5">Preference</th>
                    <th className="px-5 py-3.5">Pipeline Stage</th>
                    <th className="px-5 py-3.5">Qualification</th>
                    <th className="px-5 py-3.5">Tags</th>
                    <th className="px-5 py-3.5">Source</th>
                    <th className="px-5 py-3.5">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {leads.map((lead) => {
                    const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead';
                    const stage = stageMap[lead.pipeline_stage_id];
                    const leadTags = leadTagsMap[lead.id] || [];

                    return (
                      <tr
                        key={lead.id}
                        onClick={() => navigate(`/leads/${lead.id}`)}
                        className="hover:bg-[#f0f5fb]/60 transition-colors cursor-pointer group"
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="font-semibold text-slate-900 group-hover:text-[#08254f] transition-colors">{fullName}</div>
                          {lead.external_lead_id && (
                            <div className="text-[11px] text-slate-400">ID: {lead.external_lead_id}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {(() => {
                            const score = lead.lead_score ?? 0;
                            const label = deriveScoreLabel(score);
                            const badge = getScoreLabelBadge(label);
                            return (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-extrabold text-xs text-gray-900">
                                  {score}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] border ${badge.bg} ${badge.text} ${badge.border}`}
                                >
                                  {badge.label}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-xs text-gray-600">
                          {lead.email ? (
                            <div className="flex items-center gap-1.5 font-medium text-gray-800">
                              <Mail className="h-3.5 w-3.5 text-gray-400" />
                              {lead.email}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">No email</span>
                          )}
                          {lead.phone_raw && (
                            <div className="flex items-center gap-1.5 text-gray-500 mt-0.5">
                              <Phone className="h-3 w-3 text-gray-400" />
                              {lead.phone_raw}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700">
                            {lead.contact_preference === 'email' && <Mail className="h-3 w-3" />}
                            {lead.contact_preference === 'sms' && <Phone className="h-3 w-3" />}
                            {lead.contact_preference === 'call' && <PhoneCall className="h-3 w-3" />}
                            {lead.contact_preference.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {stage ? (
                            <span
                              className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg border ${getStageColor(
                                stage.sort_order,
                              )}`}
                            >
                              {stage.name}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Unknown</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {lead.qualification_status ? (
                            (() => {
                              const badge = getQualificationStatusBadge(lead.qualification_status);
                              return (
                                <span
                                  className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg border ${badge.bg} ${badge.text} ${badge.border}`}
                                >
                                  {badge.label}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {leadTags.length > 0 ? (
                              leadTags.map((t) => (
                                <span
                                  key={t.id}
                                  className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-md"
                                >
                                  #{t.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 capitalize">
                            {lead.source}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-xs text-gray-400">
                          {new Date(lead.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50/50">
              <div className="text-xs text-gray-500">
                Showing <strong className="text-gray-900">{(currentPage - 1) * PAGE_SIZE + 1}</strong> to{' '}
                <strong className="text-gray-900">
                  {Math.min(currentPage * PAGE_SIZE, totalCount)}
                </strong>{' '}
                of <strong className="text-gray-900">{totalCount}</strong> leads
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-semibold text-gray-700 px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modals */}
        <NewLeadModal
          isOpen={isNewLeadOpen}
          onClose={() => setIsNewLeadOpen(false)}
          onLeadCreated={fetchLeads}
        />

        <CsvImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onImportComplete={fetchLeads}
        />
      </div>
    </Layout>
  );
}
