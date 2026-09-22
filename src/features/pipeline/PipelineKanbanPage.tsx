import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { Lead, PipelineStage } from '../../types';
import {
  RotateCw,
  Plus,
} from 'lucide-react';
import { NewLeadModal } from '../leads/components/NewLeadModal';
import {
  MinimalLeadCard,
  resolveAttentionState,
  type FormattedCourseInterest,
} from './components/MinimalLeadCard';

const OPERATIONAL_STAGE_CODES = [
  'capture',
  'qualification',
  'acquisition',
  'approval',
  'enrollment',
] as const;

const STAGE_ORDER_MAP: Record<string, number> = {
  capture: 1,
  qualification: 2,
  acquisition: 3,
  approval: 4,
  enrollment: 5,
};

export function PipelineKanbanPage() {
  const navigate = useNavigate();

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leadsByStage, setLeadsByStage] = useState<Record<string, Lead[]>>({});
  const [leadInterestsMap, setLeadInterestsMap] = useState<Record<string, FormattedCourseInterest[]>>({});
  const [leadActivitiesMap, setLeadActivitiesMap] = useState<Record<string, string[]>>({});
  const [totalLeads, setTotalLeads] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drag state
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [activeDropStageId, setActiveDropStageId] = useState<string | null>(null);

  // New Lead Modal
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);

  const loadPipelineData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch official stages ordered by sort_order
      const { data: stagesData, error: stagesErr } = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('sort_order', { ascending: true });

      if (stagesErr) throw stagesErr;
      const loadedStages = (stagesData as PipelineStage[]) || [];
      setStages(loadedStages);

      // 2. Fetch all leads
      const { data: leadsData, error: leadsErr } = await supabase
        .from('leads')
        .select('*')
        .order('updated_at', { ascending: false });

      if (leadsErr) throw leadsErr;
      const allLeads = (leadsData as Lead[]) || [];
      setTotalLeads(allLeads.length);

      // Group leads by stage id
      const grouped: Record<string, Lead[]> = {};
      loadedStages.forEach((s) => {
        grouped[s.id] = [];
      });

      allLeads.forEach((l) => {
        if (grouped[l.pipeline_stage_id]) {
          grouped[l.pipeline_stage_id].push(l);
        } else if (loadedStages[0]) {
          grouped[loadedStages[0].id].push(l);
        }
      });

      setLeadsByStage(grouped);

      // 3. Batch fetch course interests and recent activities for all leads
      if (allLeads.length > 0) {
        const leadIds = allLeads.map((l) => l.id);

        const [interestsRes, activitiesRes] = await Promise.all([
          supabase
            .from('lead_course_interests')
            .select('lead_id, priority, course:courses(name), session:course_sessions(title, start_date)')
            .in('lead_id', leadIds)
            .order('priority', { ascending: true }),
          supabase
            .from('lead_activities')
            .select('lead_id, summary')
            .in('lead_id', leadIds)
            .in('activity_type', ['processing_failed', 'website_lead_suppressed', 'channel_skipped'])
            .order('created_at', { ascending: false }),
        ]);

        const intMap: Record<string, FormattedCourseInterest[]> = {};
        if (interestsRes.data) {
          interestsRes.data.forEach((row: any) => {
            if (!intMap[row.lead_id]) intMap[row.lead_id] = [];
            intMap[row.lead_id].push({
              courseName: row.course?.name || 'Curso',
              sessionTitle: row.session?.title,
              startDate: row.session?.start_date,
              priority: row.priority,
            });
          });
        }
        setLeadInterestsMap(intMap);

        const actMap: Record<string, string[]> = {};
        if (activitiesRes.data) {
          activitiesRes.data.forEach((row: any) => {
            if (!actMap[row.lead_id]) actMap[row.lead_id] = [];
            actMap[row.lead_id].push(row.summary);
          });
        }
        setLeadActivitiesMap(actMap);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados do pipeline');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPipelineData();
  }, [loadPipelineData]);

  useEffect(() => {
    const handlePurged = () => {
      loadPipelineData();
    };
    window.addEventListener('leads-purged', handlePurged);
    return () => window.removeEventListener('leads-purged', handlePurged);
  }, [loadPipelineData]);

  // Handle stage drag and drop
  const handleDragStart = (leadId: string) => {
    setDraggedLeadId(leadId);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    if (activeDropStageId !== stageId) {
      setActiveDropStageId(stageId);
    }
  };

  const handleDragLeave = () => {
    setActiveDropStageId(null);
  };

  const moveLeadToStage = async (leadId: string, targetStageId: string) => {
    let currentStageId: string | null = null;
    for (const [stgId, lds] of Object.entries(leadsByStage)) {
      if (lds.some((l) => l.id === leadId)) {
        currentStageId = stgId;
        break;
      }
    }

    if (!currentStageId || currentStageId === targetStageId) return;

    // Optimistic UI update
    const previousState = { ...leadsByStage };
    const movedLead = leadsByStage[currentStageId].find((l) => l.id === leadId)!;

    const newGrouped = { ...leadsByStage };
    newGrouped[currentStageId] = newGrouped[currentStageId].filter((l) => l.id !== leadId);
    newGrouped[targetStageId] = [{ ...movedLead, pipeline_stage_id: targetStageId }, ...newGrouped[targetStageId]];

    setLeadsByStage(newGrouped);
    try {
      // Execute atomic server-side RPC move_lead_stage
      const { data, error: rpcErr } = await supabase.rpc('move_lead_stage', {
        p_lead_id: leadId,
        p_new_stage_id: targetStageId,
        p_note: 'Moved in Kanban view',
      });

      if (rpcErr) throw rpcErr;
      if (!data?.success) throw new Error('Stage movement rejected by server');
    } catch (err) {
      // Rollback on failure
      setLeadsByStage(previousState);
      alert(err instanceof Error ? err.message : 'Falha ao mover lead');
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setActiveDropStageId(null);

    if (!draggedLeadId) return;
    const leadId = draggedLeadId;
    setDraggedLeadId(null);
    await moveLeadToStage(leadId, targetStageId);
  };

  const getStageHeaderColor = (code: string) => {
    switch (code) {
      case 'capture': return 'border-t-[#08254f] bg-slate-50 text-[#08254f]';
      case 'qualification': return 'border-t-[#449bd5] bg-[#449bd5]/5 text-[#08254f]';
      case 'acquisition': return 'border-t-indigo-600 bg-indigo-50/50 text-indigo-900';
      case 'approval': return 'border-t-amber-600 bg-amber-50/50 text-amber-900';
      case 'enrollment': return 'border-t-emerald-600 bg-emerald-50/50 text-emerald-900';
      default: return 'border-t-slate-400 bg-slate-50 text-slate-800';
    }
  };

  // Filter ONLY the 5 operational stages in strict order
  const operationalStages = stages
    .filter((s) => OPERATIONAL_STAGE_CODES.includes(s.code as any))
    .sort((a, b) => (STAGE_ORDER_MAP[a.code] || 99) - (STAGE_ORDER_MAP[b.code] || 99));

  return (
    <Layout
      title="Commercial Pipeline"
      subtitle="Pipeline Comercial • Gestão operacional de leads por estágio do funil"
    >
      <div className="space-y-4">
        {/* Controls Bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-3 py-1.5 bg-white border border-slate-200/80 rounded-xl text-slate-700 shadow-2xs">
              Total de Leads: <strong className="text-[#08254f]">{totalLeads}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={loadPipelineData}
              title="Atualizar pipeline"
              className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200/80 rounded-xl shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <RotateCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setIsNewLeadOpen(true)}
              className="btn-crimson text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Novo Lead</span>
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingState message="Carregando estágios e leads..." />
        ) : error ? (
          <ErrorState message={error} onRetry={loadPipelineData} />
        ) : (
          /* Kanban Board Scrollable Container */
          <div className="overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth w-full">
            <div className="flex gap-3 sm:gap-4 min-w-[1250px]">
              {operationalStages.map((stage) => {
                const stageLeads = leadsByStage[stage.id] || [];
                const isDropTarget = activeDropStageId === stage.id;

                return (
                  <div
                    key={stage.id}
                    onDragOver={(e) => handleDragOver(e, stage.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stage.id)}
                    className={`flex-1 min-w-[240px] sm:min-w-[230px] max-w-[280px] snap-start rounded-2xl flex flex-col bg-slate-100/70 border transition-all duration-200 ${
                      isDropTarget
                        ? 'border-[#449bd5] bg-[#449bd5]/10 ring-2 ring-[#449bd5]/30 shadow-md'
                        : 'border-slate-200/80'
                    }`}
                  >
                    {/* Column Header */}
                    <div
                      className={`px-3.5 py-3 rounded-t-2xl border-t-4 flex items-center justify-between font-heading ${getStageHeaderColor(
                        stage.code,
                      )}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold tracking-tight">{stage.name}</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white shadow-xs text-slate-700 border border-slate-200/50">
                        {stageLeads.length}
                      </span>
                    </div>

                    {/* Cards List */}
                    <div className="p-2.5 flex-1 space-y-2 min-h-[160px] sm:min-h-[220px] overflow-y-auto max-h-[calc(100vh-220px)]">
                      {stageLeads.length > 0 ? (
                        stageLeads.map((lead) => {
                          const interests = leadInterestsMap[lead.id] || [];
                          const activities = leadActivitiesMap[lead.id] || [];
                          const attentionState = resolveAttentionState(lead, activities);
                          const isDragging = draggedLeadId === lead.id;

                          return (
                            <MinimalLeadCard
                              key={lead.id}
                              lead={lead}
                              interests={interests}
                              attentionState={attentionState}
                              isDragging={isDragging}
                              onDragStart={() => handleDragStart(lead.id)}
                              onClick={() => navigate(`/leads/${lead.id}`)}
                            />
                          );
                        })
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 px-3 text-center text-slate-400 text-xs italic min-h-[110px] select-none">
                          <span className="max-w-[190px] leading-relaxed">
                            Nenhum lead neste estágio
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Modal: New Lead */}
        <NewLeadModal
          isOpen={isNewLeadOpen}
          onClose={() => setIsNewLeadOpen(false)}
          onLeadCreated={loadPipelineData}
        />
      </div>
    </Layout>
  );
}
