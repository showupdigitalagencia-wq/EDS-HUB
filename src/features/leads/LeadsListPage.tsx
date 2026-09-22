import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { NewLeadModal } from './components/NewLeadModal';
import { CsvImportModal } from './import/CsvImportModal';
import type { Lead, PipelineStage, Tag, Course, CourseSession } from '../../types';
import { formatSessionMonthYear } from '../pipeline/components/MinimalLeadCard';
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
  RotateCw,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';

const PAGE_SIZE = 15;

const OPERATIONAL_STAGE_CODES = [
  'capture',
  'qualification',
  'acquisition',
  'approval',
  'enrollment',
] as const;

export function LeadsListPage() {
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const sortParam = searchParams.get('sort');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sorting
  const sortBy = sortParam === 'score' ? 'lead_score' : 'created_at';
  const sortOrder: 'asc' | 'desc' = 'desc';

  // Primary Client Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');

  // Secondary Filters (behind "Mais filtros")
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('');
  const [preferenceFilter, setPreferenceFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [scoreFilter, setScoreFilter] = useState('');

  // Modals
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // 1. Fetch reference data (operational stages, active courses, sessions, tags)
  useEffect(() => {
    async function loadRefs() {
      const [stagesRes, coursesRes, sessionsRes, tagsRes] = await Promise.all([
        supabase
          .from('pipeline_stages')
          .select('*')
          .order('sort_order', { ascending: true }),
        supabase
          .from('courses')
          .select('*')
          .eq('active', true)
          .order('name', { ascending: true }),
        supabase
          .from('course_sessions')
          .select('*, course:courses(name)')
          .order('start_date', { ascending: true }),
        supabase
          .from('tags')
          .select('*')
          .order('name', { ascending: true }),
      ]);

      if (stagesRes.data) {
        setStages(stagesRes.data);
      }
      if (coursesRes.data) {
        setCourses(coursesRes.data);
      }
      if (sessionsRes.data) {
        setSessions(sessionsRes.data as CourseSession[]);
      }
      if (tagsRes.data) {
        setTags(tagsRes.data);
      }
    }
    loadRefs();
  }, []);

  // 2. Fetch leads with truly scalable server-side relational filtering & pagination
  const fetchLeads = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use !inner relational embed when course/session filter is active, ensuring 100% server-side filtering
      const hasCourseFilter = Boolean(courseFilter);
      const hasSessionFilter = Boolean(sessionFilter);

      let selectClause =
        '*, lead_course_interests(course_id, course_session_id, priority, course:courses(name), session:course_sessions(title, start_date))';

      if (hasCourseFilter || hasSessionFilter) {
        selectClause =
          '*, lead_course_interests!inner(course_id, course_session_id, priority, course:courses(name), session:course_sessions(title, start_date))';
      }

      let query = supabase.from('leads').select(selectClause, { count: 'exact' });

      // Primary Filter: Search term (name, email, phone)
      if (searchTerm.trim()) {
        const term = `%${searchTerm.trim()}%`;
        query = query.or(
          `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone_raw.ilike.${term}`,
        );
      }

      // Primary Filter: Pipeline Stage
      if (stageFilter) {
        query = query.eq('pipeline_stage_id', stageFilter);
      }

      // Primary Filter: Course of interest (server-side via relational !inner)
      if (courseFilter) {
        query = query.eq('lead_course_interests.course_id', courseFilter);
      }

      // Primary Filter: Course Session / Date (server-side via relational !inner)
      if (sessionFilter) {
        query = query.eq('lead_course_interests.course_session_id', sessionFilter);
      }

      // Secondary Filter: Source
      if (sourceFilter) {
        query = query.eq('source', sourceFilter);
      }

      // Secondary Filter: Contact Preference
      if (preferenceFilter) {
        query = query.eq('contact_preference', preferenceFilter);
      }

      // Secondary Filter: Score Band
      if (scoreFilter === 'very_hot') {
        query = query.gte('lead_score', 75);
      } else if (scoreFilter === 'hot') {
        query = query.gte('lead_score', 50).lte('lead_score', 74);
      } else if (scoreFilter === 'warm') {
        query = query.gte('lead_score', 25).lte('lead_score', 49);
      } else if (scoreFilter === 'cold') {
        query = query.lte('lead_score', 24);
      }

      // Secondary Filter: Tag filter
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
        .order(sortBy, { ascending: false })
        .range(from, to);

      if (fetchErr) throw fetchErr;

      const loadedLeads = (data as unknown as Lead[]) || [];
      setLeads(loadedLeads);
      setTotalCount(count || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar leads');
    } finally {
      setIsLoading(false);
    }
  }, [
    searchTerm,
    stageFilter,
    courseFilter,
    sessionFilter,
    sourceFilter,
    preferenceFilter,
    tagFilter,
    scoreFilter,
    currentPage,
    sortBy,
    sortOrder,
  ]);

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

  // Filter operational stages only for primary stage filter
  const operationalStages = stages.filter((s) =>
    OPERATIONAL_STAGE_CODES.includes(s.code as any),
  );

  const stageMap = stages.reduce<Record<string, PipelineStage>>((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {});

  // Sessions filtered by course if courseFilter selected
  const visibleSessions = courseFilter
    ? sessions.filter((s) => s.course_id === courseFilter)
    : sessions;

  const hasActiveSecondaryFilters = Boolean(
    sourceFilter || preferenceFilter || tagFilter || scoreFilter,
  );

  const resetFilters = () => {
    setSearchTerm('');
    setStageFilter('');
    setCourseFilter('');
    setSessionFilter('');
    setSourceFilter('');
    setPreferenceFilter('');
    setTagFilter('');
    setScoreFilter('');
    setCurrentPage(1);
  };

  const getStageBadgeStyle = (code?: string) => {
    switch (code) {
      case 'capture':
        return 'bg-slate-100 text-slate-800 border-slate-200';
      case 'qualification':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      case 'acquisition':
        return 'bg-indigo-50 text-indigo-800 border-indigo-200';
      case 'approval':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'enrollment':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <Layout title="Leads & Contatos">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
                <Users className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold text-[#08254f] tracking-tight font-heading">
                Leads & Contatos
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Base de contatos com filtros operacionais por curso, turma e estágio
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsImportOpen(true)}
              className="btn-secondary text-xs"
            >
              <Upload className="h-3.5 w-3.5 text-slate-500" />
              Importar CSV
            </button>
            <button
              onClick={() => setIsNewLeadOpen(true)}
              className="btn-crimson text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo Lead
            </button>
          </div>
        </div>

        {/* Primary Client Filters */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Busca */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Buscar por nome, email ou telefone..."
                className="w-full pl-9 pr-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f] focus:border-transparent transition-all"
              />
            </div>

            {/* 2. Estágio (Operational only) */}
            <div>
              <select
                value={stageFilter}
                onChange={(e) => {
                  setStageFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08254f]"
              >
                <option value="">Todos os Estágios</option>
                {operationalStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Curso de Interesse */}
            <div>
              <select
                value={courseFilter}
                onChange={(e) => {
                  setCourseFilter(e.target.value);
                  setSessionFilter(''); // reset session when course changes
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08254f]"
              >
                <option value="">Todos os Cursos</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Turma / Data */}
            <div className="flex items-center gap-2">
              <select
                value={sessionFilter}
                onChange={(e) => {
                  setSessionFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="flex-1 px-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08254f]"
              >
                <option value="">Todas as Turmas / Datas</option>
                {visibleSessions.map((s) => {
                  const formattedDate = formatSessionMonthYear(s.start_date);
                  const label = `${(s as any).course?.name || 'Curso'} — ${formattedDate || s.title}`;
                  return (
                    <option key={s.id} value={s.id}>
                      {label}
                    </option>
                  );
                })}
              </select>

              <button
                onClick={fetchLeads}
                title="Atualizar lista"
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors shrink-0"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Collapsible "Mais filtros" Toggle & Controls */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowMoreFilters(!showMoreFilters)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#08254f] transition-colors"
            >
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <span>Mais filtros</span>
              {hasActiveSecondaryFilters && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#449bd5]" />
              )}
              {showMoreFilters ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>

            {(searchTerm ||
              stageFilter ||
              courseFilter ||
              sessionFilter ||
              hasActiveSecondaryFilters) && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800 transition-colors font-medium"
              >
                <X className="h-3 w-3" />
                Limpar filtros
              </button>
            )}
          </div>

          {/* Secondary Filters Tray */}
          {showMoreFilters && (
            <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-200/60 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3">
              {/* Origem */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Origem
                </label>
                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg"
                >
                  <option value="">Todas as origens</option>
                  <option value="meta">Meta / Instagram</option>
                  <option value="google">Google Ads</option>
                  <option value="manual">Manual CRM</option>
                  <option value="form">Formulário Site</option>
                  <option value="test">Teste</option>
                </select>
              </div>

              {/* Preferência */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Preferência
                </label>
                <select
                  value={preferenceFilter}
                  onChange={(e) => {
                    setPreferenceFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg"
                >
                  <option value="">Todas as preferências</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="call">Telefone / Ligação</option>
                </select>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Tags
                </label>
                <select
                  value={tagFilter}
                  onChange={(e) => {
                    setTagFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg"
                >
                  <option value="">Todas as tags</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pontuação */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Pontuação
                </label>
                <select
                  value={scoreFilter}
                  onChange={(e) => {
                    setScoreFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg"
                >
                  <option value="">Todas as pontuações</option>
                  <option value="very_hot">Muito Quente (75+)</option>
                  <option value="hot">Quente (50-74)</option>
                  <option value="warm">Morno (25-49)</option>
                  <option value="cold">Frio (0-24)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Content Table */}
        {isLoading ? (
          <LoadingState message="Carregando leads..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchLeads} />
        ) : leads.length === 0 ? (
          <EmptyState
            title="Nenhum lead encontrado"
            message="Crie seu primeiro lead manualmente ou ajuste os filtros acima."
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                <thead className="bg-[#f8fafc] text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200/80">
                  <tr>
                    <th className="px-5 py-3.5">Nome</th>
                    <th className="px-5 py-3.5">Cursos de Interesse</th>
                    <th className="px-5 py-3.5">Estágio</th>
                    <th className="px-5 py-3.5">Contato</th>
                    <th className="px-5 py-3.5">Quem indicou?</th>
                    <th className="px-5 py-3.5">Data de Criação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {leads.map((lead) => {
                    const fullName =
                      [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                      'Lead sem nome';
                    const stage = stageMap[lead.pipeline_stage_id];
                    const interests = (lead as any).lead_course_interests || [];

                    return (
                      <tr
                        key={lead.id}
                        onClick={() => navigate(`/leads/${lead.id}`)}
                        className="hover:bg-[#f0f5fb]/60 transition-colors cursor-pointer group"
                      >
                        {/* 1. Nome */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="font-semibold text-slate-900 group-hover:text-[#08254f] transition-colors">
                            {fullName}
                          </div>
                          {lead.external_lead_id && (
                            <div className="text-[11px] text-slate-400">
                              ID: {lead.external_lead_id}
                            </div>
                          )}
                        </td>

                        {/* 2. Cursos de Interesse (up to 3 prioritized) */}
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col gap-1 max-w-[280px]">
                            {interests.length > 0 ? (
                              interests
                                .sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99))
                                .slice(0, 3)
                                .map((interest: any, idx: number) => {
                                  const formattedDate = formatSessionMonthYear(
                                    interest.session?.start_date,
                                  );
                                  const courseName = interest.course?.name || 'Curso';
                                  const label = formattedDate
                                    ? `${courseName} • ${formattedDate}`
                                    : courseName;

                                  return (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-700 rounded border border-slate-200/70 truncate"
                                      title={label}
                                    >
                                      <span className="truncate">{label}</span>
                                      {interest.priority && (
                                        <span className="text-[9px] font-bold text-slate-400">
                                          #{interest.priority}
                                        </span>
                                      )}
                                    </span>
                                  );
                                })
                            ) : lead.course_interest ? (
                              <span className="inline-block px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-700 rounded border border-slate-200/70 truncate">
                                {lead.course_interest}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">
                                Nenhum curso
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Estágio */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-full border ${getStageBadgeStyle(
                              stage?.code,
                            )}`}
                          >
                            {stage?.name || 'Novo Lead'}
                          </span>
                        </td>

                        {/* 4. Contato (Email / Phone) */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="space-y-0.5">
                            {lead.email ? (
                              <div className="flex items-center gap-1.5 text-slate-600">
                                <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="truncate max-w-[200px]">{lead.email}</span>
                              </div>
                            ) : null}
                            {lead.phone_raw ? (
                              <div className="flex items-center gap-1.5 text-slate-600">
                                <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                                <span>{lead.phone_raw}</span>
                              </div>
                            ) : null}
                            {!lead.email && !lead.phone_raw && (
                              <span className="text-slate-400 italic">Sem contato</span>
                            )}
                          </div>
                        </td>

                        {/* 5. Quem indicou? */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {lead.referred_by ? (
                            <span className="text-slate-700 font-medium text-xs">
                              {lead.referred_by}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>

                        {/* 6. Data de Criação */}
                        <td className="px-5 py-3.5 whitespace-nowrap text-slate-500 text-xs">
                          {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <div>
                Total de <strong className="text-slate-900">{totalCount}</strong> leads
                encontrados
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-medium">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors"
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
