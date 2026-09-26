import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { campaignAudienceService, type SearchedLead } from '../services/campaign-audience-service';
import type {
  AudienceFilterDefinition,
  AudiencePreviewResult,
  PipelineStage,
} from '../../../types';
import {
  Users,
  CheckCircle2,
  XCircle,
  RotateCw,
  Eye,
  GraduationCap,
  Calendar,
  Search,
  Check,
  ShieldCheck,
  Bookmark,
  Sliders,
  X,
  Layers,
  Phone,
  Mail,
} from 'lucide-react';

interface CourseOption {
  id: string;
  name: string;
  code: string;
}

interface CourseSessionOption {
  id: string;
  course_id: string;
  code: string;
  title: string;
  start_date: string;
  end_date: string;
}

interface AudienceSectionProps {
  channel: 'email' | 'sms' | 'call';
  filterDefinition: AudienceFilterDefinition;
  onChange: (def: AudienceFilterDefinition) => void;
  onOpenPreview?: (preview: AudiencePreviewResult) => void;
  onOpenSavedSegments?: () => void;
  disabled?: boolean;
}

type AudienceMode = 'all' | 'stage' | 'course' | 'individual';

export function AudienceSection({
  channel,
  filterDefinition = { mode: 'all', version: 1, operator: 'and' },
  onChange,
  onOpenPreview,
  onOpenSavedSegments,
  disabled = false,
}: AudienceSectionProps) {
  const [mode, setMode] = useState<AudienceMode>(filterDefinition.mode || 'all');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [sessions, setSessions] = useState<CourseSessionOption[]>([]);

  // Real leads list & search state
  const [leadSearchTerm, setLeadSearchTerm] = useState('');
  const [realLeads, setRealLeads] = useState<SearchedLead[]>([]);
  const [isLoadingRealLeads, setIsLoadingRealLeads] = useState(false);
  const [selectedLeadsList, setSelectedLeadsList] = useState<SearchedLead[]>([]);

  // Stage & Course matching leads previews
  const [stageMatchingLeads, setStageMatchingLeads] = useState<SearchedLead[]>([]);
  const [isLoadingStageLeads, setIsLoadingStageLeads] = useState(false);
  const [courseMatchingLeads, setCourseMatchingLeads] = useState<SearchedLead[]>([]);
  const [isLoadingCourseLeads, setIsLoadingCourseLeads] = useState(false);

  // Estimation & Reach state
  const [isEstimating, setIsEstimating] = useState(false);
  const [previewResult, setPreviewResult] = useState<AudiencePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);

  // 1. Load canonical stages and courses
  useEffect(() => {
    async function loadRefs() {
      try {
        const [stagesRes, coursesRes] = await Promise.all([
          supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
          supabase.from('courses').select('id, name, code').eq('active', true).order('sort_order', { ascending: true }),
        ]);

        if (stagesRes.data) setStages(stagesRes.data);
        if (coursesRes.data) setCourses(coursesRes.data);
      } catch (err) {
        console.error('Failed to load reference data for audience builder:', err);
      }
    }
    loadRefs();
  }, []);

  // 2. When course changes, load its real sessions
  const currentCourseId = filterDefinition.course_id || filterDefinition.enrolled_course_id || '';
  useEffect(() => {
    async function loadSessions() {
      if (!currentCourseId) {
        setSessions([]);
        return;
      }
      try {
        const { data } = await supabase
          .from('course_sessions')
          .select('id, course_id, code, title, start_date, end_date')
          .eq('course_id', currentCourseId)
          .order('start_date', { ascending: true });
        if (data) setSessions(data);
      } catch (err) {
        console.error('Failed to load course sessions:', err);
      }
    }
    loadSessions();
  }, [currentCourseId]);

  // 3. Load Real Leads for "Leads Específicos" directly
  const loadRealLeads = useCallback(async (query = '') => {
    setIsLoadingRealLeads(true);
    try {
      const results = await campaignAudienceService.searchLeads(query, 60);
      setRealLeads(results);
    } catch (err) {
      console.error('Failed to load real leads:', err);
    } finally {
      setIsLoadingRealLeads(false);
    }
  }, []);

  useEffect(() => {
    loadRealLeads(leadSearchTerm);
  }, [loadRealLeads, leadSearchTerm]);

  // 4. Load initial selected individual leads info
  useEffect(() => {
    async function loadInitialSelectedLeads() {
      const currentSelectedIds = filterDefinition.selected_lead_ids || [];
      if (currentSelectedIds.length === 0) {
        setSelectedLeadsList([]);
        return;
      }
      try {
        const leads = await campaignAudienceService.searchLeads('', 100);
        const filtered = leads.filter((l) => currentSelectedIds.includes(l.id));
        setSelectedLeadsList(filtered);
      } catch (err) {
        console.error('Failed to load selected leads info:', err);
      }
    }
    loadInitialSelectedLeads();
  }, [filterDefinition.selected_lead_ids]);

  // 5. Load Stage Matching Leads
  const selectedStages = useMemo(() => filterDefinition.stages || [], [filterDefinition.stages]);
  useEffect(() => {
    async function loadStageLeads() {
      if (mode !== 'stage' || selectedStages.length === 0) {
        setStageMatchingLeads([]);
        return;
      }
      setIsLoadingStageLeads(true);
      try {
        // Resolve stage codes to UUIDs if needed
        const stageUuids = stages
          .filter((st) => selectedStages.includes(st.code) || selectedStages.includes(st.id))
          .map((st) => st.id);
        const results = await campaignAudienceService.searchLeads('', 20, {
          stageIds: stageUuids.length > 0 ? stageUuids : selectedStages,
        });
        setStageMatchingLeads(results);
      } catch (err) {
        console.error('Failed to load stage matching leads:', err);
      } finally {
        setIsLoadingStageLeads(false);
      }
    }
    loadStageLeads();
  }, [mode, selectedStages, stages]);

  // 6. Load Course Matching Leads
  useEffect(() => {
    async function loadCourseLeads() {
      if (mode !== 'course' || !currentCourseId) {
        setCourseMatchingLeads([]);
        return;
      }
      setIsLoadingCourseLeads(true);
      try {
        const results = await campaignAudienceService.searchLeads('', 20, {
          courseId: currentCourseId,
        });
        setCourseMatchingLeads(results);
      } catch (err) {
        console.error('Failed to load course matching leads:', err);
      } finally {
        setIsLoadingCourseLeads(false);
      }
    }
    loadCourseLeads();
  }, [mode, currentCourseId]);

  // Update a single filter field
  const updateFilter = useCallback(
    <K extends keyof AudienceFilterDefinition>(field: K, value: AudienceFilterDefinition[K]) => {
      onChange({
        ...filterDefinition,
        [field]: value,
      });
    },
    [filterDefinition, onChange],
  );

  // Switch audience mode
  const handleModeChange = (newMode: AudienceMode) => {
    setMode(newMode);
    const updated: AudienceFilterDefinition = {
      ...filterDefinition,
      mode: newMode,
    };

    if (newMode === 'all') {
      updated.stages = undefined;
      updated.course_id = undefined;
      updated.enrolled_course_id = undefined;
      updated.course_session_id = undefined;
      updated.selected_lead_ids = undefined;
    } else if (newMode === 'stage' && (!updated.stages || updated.stages.length === 0)) {
      if (stages.length > 0) {
        updated.stages = [stages[0].code || stages[0].id];
      }
    } else if (newMode === 'individual') {
      // In individual mode, make sure real leads are loaded
      loadRealLeads('');
    }

    onChange(updated);
  };

  // Evaluate Server-Side Reach
  const estimateReach = useCallback(async () => {
    setIsEstimating(true);
    setError(null);
    try {
      const result = await campaignAudienceService.previewAudience(filterDefinition, channel, 10, 0);
      setPreviewResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao calcular alcance da audiência');
    } finally {
      setIsEstimating(false);
    }
  }, [filterDefinition, channel]);

  // Re-estimate on filterDefinition changes
  useEffect(() => {
    estimateReach();
  }, [estimateReach]);

  // Toggle stage selection
  const toggleStage = (stageCodeOrId: string) => {
    const list = filterDefinition.stages || [];
    const updated = list.includes(stageCodeOrId)
      ? list.filter((s) => s !== stageCodeOrId)
      : [...list, stageCodeOrId];
    updateFilter('stages', updated.length > 0 ? updated : undefined);
  };

  // Toggle individual lead selection (enforces eligibility)
  const toggleLeadSelection = (lead: SearchedLead) => {
    // HARD ENFORCEMENT: Never allow ineligible leads to be selected for sending
    if (!lead.is_eligible) {
      return;
    }

    const currentIds = filterDefinition.selected_lead_ids || [];
    const isAlreadySelected = currentIds.includes(lead.id);

    let updatedIds: string[];
    let updatedList: SearchedLead[];

    if (isAlreadySelected) {
      updatedIds = currentIds.filter((id) => id !== lead.id);
      updatedList = selectedLeadsList.filter((l) => l.id !== lead.id);
    } else {
      updatedIds = [...currentIds, lead.id];
      updatedList = [...selectedLeadsList, lead];
    }

    setSelectedLeadsList(updatedList);
    updateFilter('selected_lead_ids', updatedIds.length > 0 ? updatedIds : undefined);
  };

  // Select all currently visible eligible leads
  const handleSelectAllEligible = () => {
    const eligibleLeads = realLeads.filter((l) => l.is_eligible);
    if (eligibleLeads.length === 0) return;

    const currentIds = new Set(filterDefinition.selected_lead_ids || []);
    const existingListMap = new Map(selectedLeadsList.map((l) => [l.id, l]));

    eligibleLeads.forEach((lead) => {
      currentIds.add(lead.id);
      existingListMap.set(lead.id, lead);
    });

    const newIds = Array.from(currentIds);
    const newList = Array.from(existingListMap.values());

    setSelectedLeadsList(newList);
    updateFilter('selected_lead_ids', newIds);
  };

  // Clear all selections
  const handleClearSelection = () => {
    setSelectedLeadsList([]);
    updateFilter('selected_lead_ids', undefined);
  };

  const selectedLeadIds = filterDefinition.selected_lead_ids || [];

  return (
    <div className="card-executive p-5 space-y-6">
      {/* Header bar with Saved Segments */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-bold text-[#08254f] flex items-center gap-2 font-heading">
            <Users className="w-4 h-4 text-[#449bd5]" />
            Quem vai receber?
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Defina o público da campanha a partir dos leads reais do CRM. A segurança de canal exclui automaticamente contatos sem preferência por email ou com entregabilidade comprometida.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenSavedSegments?.()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <Bookmark className="w-3.5 h-3.5 text-[#449bd5]" />
          Segmentos Salvos
        </button>
      </div>

      {/* Primary Audience Filter Mode Selector */}
      <div className="space-y-2">
        <label className="block text-xs font-bold text-slate-700">
          Critério Principal de Seleção:
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'all', label: 'Todos os Elegíveis', icon: Users, desc: 'Toda a base ativa com preferência por email' },
            { id: 'stage', label: 'Por Etapa do Funil', icon: Layers, desc: 'Filtrar por Novo Lead, Interessado, etc.' },
            { id: 'course', label: 'Por Curso & Turma', icon: GraduationCap, desc: 'Filtrar por curso e data de turma' },
            { id: 'individual', label: 'Leads Específicos', icon: Search, desc: 'Escolher contatos reais na lista' },
          ].map((item) => {
            const isSelected = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => handleModeChange(item.id as AudienceMode)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#08254f] bg-blue-50/50 ring-1 ring-[#08254f]'
                    : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <item.icon className={`w-4 h-4 ${isSelected ? 'text-[#08254f]' : 'text-slate-400'}`} />
                  <span className={`text-xs font-bold ${isSelected ? 'text-[#08254f]' : 'text-slate-700'}`}>
                    {item.label}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 line-clamp-2">{item.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-SECTION 1: By Pipeline Stage */}
      {mode === 'stage' && (
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-600" />
              Etapas do Funil (Pipeline Stages Reais)
            </span>
            <span className="text-[11px] text-slate-500">
              {selectedStages.length === 0
                ? 'Nenhuma selecionada (todos)'
                : `${selectedStages.length} etapa(s) selecionada(s)`}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {stages.map((stage) => {
              const identifier = stage.code || stage.id;
              const isSelected = selectedStages.includes(identifier);
              return (
                <button
                  key={stage.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleStage(identifier)}
                  className={`px-3 py-1.5 text-xs rounded-xl font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold shadow-2xs'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5" />}
                  {stage.name}
                </button>
              );
            })}
          </div>

          {/* Real leads matching selected stage */}
          {selectedStages.length > 0 && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <span className="text-[11px] font-bold text-slate-700 block">
                Leads reais nesta etapa ({isLoadingStageLeads ? 'carregando...' : stageMatchingLeads.length}):
              </span>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {stageMatchingLeads.length === 0 && !isLoadingStageLeads ? (
                  <p className="p-3 text-xs text-slate-400 italic text-center">Nenhum lead encontrado nesta etapa.</p>
                ) : (
                  stageMatchingLeads.map((l) => (
                    <div key={l.id} className="p-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900 block truncate">
                          {l.first_name} {l.last_name || ''}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate block">
                          {l.email || 'Sem email'} • {l.stage_name}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          l.is_eligible
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {l.is_eligible ? 'Elegível' : l.exclusion_reason || 'Ineligível'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-SECTION 2: By Course & Session */}
      {mode === 'course' && (
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <GraduationCap className="w-4 h-4 text-emerald-600" />
                Curso
              </label>
              <select
                disabled={disabled}
                value={filterDefinition.course_id || filterDefinition.enrolled_course_id || ''}
                onChange={(e) => {
                  const courseId = e.target.value || undefined;
                  onChange({
                    ...filterDefinition,
                    course_id: courseId,
                    enrolled_course_id: courseId,
                    course_session_id: undefined,
                  });
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:ring-1 focus:ring-[#08254f] outline-none"
              >
                <option value="">Selecione um curso...</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-purple-600" />
                Turma / Data da Sessão (Opcional)
              </label>
              <select
                disabled={disabled || !currentCourseId}
                value={filterDefinition.course_session_id || ''}
                onChange={(e) => updateFilter('course_session_id', e.target.value || undefined)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:ring-1 focus:ring-[#08254f] outline-none disabled:bg-slate-100"
              >
                <option value="">Todas as turmas deste curso</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code || s.title} ({new Date(s.start_date).toLocaleDateString()} a{' '}
                    {new Date(s.end_date).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Real leads matching selected course */}
          {currentCourseId && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <span className="text-[11px] font-bold text-slate-700 block">
                Leads com interesse neste curso ({isLoadingCourseLeads ? 'carregando...' : courseMatchingLeads.length}):
              </span>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {courseMatchingLeads.length === 0 && !isLoadingCourseLeads ? (
                  <p className="p-3 text-xs text-slate-400 italic text-center">Nenhum lead com interesse registrado neste curso.</p>
                ) : (
                  courseMatchingLeads.map((l) => (
                    <div key={l.id} className="p-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900 block truncate">
                          {l.first_name} {l.last_name || ''}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate block">
                          {l.email || 'Sem email'} • {l.stage_name || 'Sem etapa'}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          l.is_eligible
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {l.is_eligible ? 'Elegível' : l.exclusion_reason || 'Ineligível'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-SECTION 3: REAL LEAD PICKER ("Leads Específicos") */}
      {mode === 'individual' && (
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 font-heading">
                <Search className="w-4 h-4 text-blue-600" />
                Leads Específicos do CRM
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Escolha os contatos individualmente na lista real abaixo. Apenas contatos elegíveis para email podem ser selecionados para envio.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                {selectedLeadIds.length} lead{selectedLeadIds.length === 1 ? '' : 's'} selecionado{selectedLeadIds.length === 1 ? '' : 's'}
              </span>

              <button
                type="button"
                onClick={handleSelectAllEligible}
                disabled={disabled || realLeads.filter((l) => l.is_eligible).length === 0}
                data-testid="select-all-eligible-btn"
                className="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
              >
                Selecionar todos os elegíveis
              </button>

              {selectedLeadIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  disabled={disabled}
                  data-testid="clear-selection-btn"
                  className="text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  Limpar seleção
                </button>
              )}
            </div>
          </div>

          {/* Full-width Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={leadSearchTerm}
              onChange={(e) => setLeadSearchTerm(e.target.value)}
              placeholder="Buscar por nome, email ou telefone..."
              data-testid="real-lead-search-input"
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-[#08254f] shadow-2xs"
            />
            {leadSearchTerm && (
              <button
                type="button"
                onClick={() => setLeadSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Real Leads Scrollable List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
              <span>
                {isLoadingRealLeads
                  ? 'Carregando contatos do CRM...'
                  : `${realLeads.length} lead${realLeads.length === 1 ? '' : 's'} encontrado${realLeads.length === 1 ? '' : 's'}`}
              </span>
              <span className="text-[10px] text-slate-400">
                Ineligíveis aparecem desabilitados com o motivo factual
              </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-2 max-h-80 overflow-y-auto space-y-2">
              {realLeads.length === 0 && !isLoadingRealLeads && (
                <div className="p-6 text-center text-xs text-slate-400">
                  Nenhum lead encontrado com o termo informado.
                </div>
              )}

              {realLeads.map((lead) => {
                const isSelected = selectedLeadIds.includes(lead.id);
                return (
                  <div
                    key={lead.id}
                    onClick={() => {
                      if (lead.is_eligible) {
                        toggleLeadSelection(lead);
                      }
                    }}
                    className={`p-3 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500'
                        : lead.is_eligible
                        ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 cursor-pointer'
                        : 'border-slate-200 bg-slate-50/80 opacity-70 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!lead.is_eligible || disabled}
                        data-testid={`lead-select-checkbox-${lead.id}`}
                        onChange={() => {
                          if (lead.is_eligible) {
                            toggleLeadSelection(lead);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed shrink-0"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {lead.first_name} {lead.last_name || ''}
                          </span>

                          {/* Email Eligibility Status Badge */}
                          {lead.is_eligible ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 self-start sm:self-auto shrink-0">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Elegível para email
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-900 border border-amber-200 self-start sm:self-auto shrink-0"
                              title={lead.exclusion_reason || 'Incompatível com envio de email'}
                            >
                              <XCircle className="w-3 h-3 text-amber-700" />
                              Não elegível — {lead.exclusion_reason || 'Incompatível'}
                            </span>
                          )}
                        </div>

                        {/* Contact details: email & phone */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[11px] text-slate-600">
                          <span className="flex items-center gap-1.5">
                            <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                            {lead.email || <span className="italic text-slate-400">Sem email</span>}
                          </span>
                          {lead.phone && (
                            <span className="flex items-center gap-1.5">
                              <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                              {lead.phone}
                            </span>
                          )}
                        </div>

                        {/* Badges: Preference, Stage, Course */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                              lead.contact_preference === 'email'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            Preferência: {lead.contact_preference ? lead.contact_preference.toUpperCase() : 'Não informada'}
                          </span>

                          {lead.stage_name && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-800">
                              Etapa: {lead.stage_name}
                            </span>
                          )}

                          {lead.course_interest && (
                            <span
                              className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-700 truncate max-w-[220px]"
                              title={lead.course_interest}
                            >
                              <GraduationCap className="w-3 h-3 inline mr-1 text-[#449bd5]" />
                              {lead.course_interest}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Leads Summary Chips */}
          {selectedLeadsList.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <span className="text-xs font-bold text-slate-800 block">
                Selecionados ({selectedLeadsList.length}):
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-white border border-slate-200 rounded-xl">
                {selectedLeadsList.map((lead) => (
                  <span
                    key={lead.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-100/80 text-[#08254f] text-xs font-semibold"
                  >
                    <span>{lead.first_name} {lead.last_name || ''}</span>
                    <button
                      type="button"
                      onClick={() => toggleLeadSelection(lead)}
                      data-testid={`remove-selected-lead-${lead.id}`}
                      className="hover:text-red-700 cursor-pointer p-0.5"
                      title="Remover lead"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advanced Rules Collapsible Drawer */}
      <div className="pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setShowAdvancedRules(!showAdvancedRules)}
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
        >
          <Sliders className="w-3.5 h-3.5 text-slate-500" />
          {showAdvancedRules ? 'Ocultar Filtros Comerciais Avançados' : 'Filtros Comerciais Avançados (Score, Inatividade, Alunos Recorrentes)'}
        </button>

        {showAdvancedRules && (
          <div className="mt-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Score Mínimo (0–100)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={filterDefinition.min_score ?? ''}
                onChange={(e) => updateFilter('min_score', e.target.value ? Number(e.target.value) : null)}
                placeholder="Ex: 50"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Dias sem Interação
              </label>
              <select
                value={filterDefinition.days_since_last_activity ?? ''}
                onChange={(e) =>
                  updateFilter('days_since_last_activity', e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="">Qualquer período</option>
                <option value="7">Inatividade ≥ 7 dias</option>
                <option value="14">Inatividade ≥ 14 dias</option>
                <option value="30">Inatividade ≥ 30 dias (Esfriando)</option>
                <option value="60">Inatividade ≥ 60 dias</option>
              </select>
            </div>

            <div className="flex items-center pt-4">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={filterDefinition.repeat_student === true}
                  onChange={(e) => updateFilter('repeat_student', e.target.checked ? true : null)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Apenas Alunos Recorrentes (≥ 2 matrículas)
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Safety Notice: Contact Preference & Deliverability */}
      <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/60 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-950">
          <span className="font-bold">Regra de Segurança de Canal Ativa: EMAIL</span>
          <p className="mt-0.5 text-blue-900 leading-relaxed">
            Apenas contatos com Preferência de Contato = <strong>Email</strong> e endereço de email válido serão marcados como Elegíveis.
            Contatos com preferência por SMS, WhatsApp, Telefone ou Sem Preferência definida, bem como emails com histórico de <em>hard bounce</em> ou reclamação de spam, são rigorosamente excluídos da lista para proteger a reputação do domínio.
          </p>
        </div>
      </div>

      {/* LIVE AUDIENCE REACH BAR */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Selecionados
              </span>
              <p className="text-2xl font-black text-slate-900">
                {isEstimating
                  ? '...'
                  : mode === 'individual'
                  ? selectedLeadIds.length
                  : previewResult?.total_matched ?? 0}
              </p>
            </div>

            <div className="h-8 w-px bg-slate-200 hidden sm:block" />

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Elegíveis para Email
              </span>
              <p className="text-2xl font-black text-emerald-700">
                {isEstimating ? '...' : previewResult?.eligible_count ?? 0}
              </p>
            </div>

            <div className="h-8 w-px bg-slate-200 hidden sm:block" />

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> Excluídos da Lista
              </span>
              <p className="text-2xl font-black text-rose-700">
                {isEstimating ? '...' : previewResult?.excluded_count ?? 0}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={estimateReach}
              disabled={isEstimating}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isEstimating ? 'animate-spin' : ''}`} />
              Recalcular Alcance
            </button>

            <button
              type="button"
              onClick={() => previewResult && onOpenPreview?.(previewResult)}
              disabled={isEstimating || !previewResult}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-[#08254f] text-white hover:bg-[#061d3d] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              Visualizar Contatos ({previewResult?.total_matched ?? 0})
            </button>
          </div>
        </div>

        {/* Exclusion Breakdown Badges */}
        {previewResult && previewResult.excluded_count > 0 && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Motivos de exclusão da lista:</span>
            {previewResult.exclusion_breakdown.CHANNEL_PREFERENCE_MISMATCH > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.CHANNEL_PREFERENCE_MISMATCH} Preferência diferente de Email
              </span>
            )}
            {previewResult.exclusion_breakdown.NO_VALID_CONTACT_PREFERENCE > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.NO_VALID_CONTACT_PREFERENCE} Sem preferência cadastrada
              </span>
            )}
            {previewResult.exclusion_breakdown.MISSING_EMAIL > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.MISSING_EMAIL} Sem endereço de email
              </span>
            )}
            {(previewResult.exclusion_breakdown.SUPPRESSED || 0) > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-900 border border-red-300 text-[11px] font-bold">
                {previewResult.exclusion_breakdown.SUPPRESSED} Suprimido (Hard bounce/Spam)
              </span>
            )}
            {previewResult.exclusion_breakdown.TEST_SOURCE > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.TEST_SOURCE} Lead de Teste
              </span>
            )}
          </div>
        )}

        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
