import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { Lead, PipelineStage, Tag } from '../../types';
import { getQualificationStatusBadge } from '../leads/utils/qualificationMapping';
import {
  Kanban,
  RotateCw,
  Plus,
  Mail,
  Phone,
  Clock,
  GripVertical,
} from 'lucide-react';
import { NewLeadModal } from '../leads/components/NewLeadModal';

export function PipelineKanbanPage() {
  const navigate = useNavigate();

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leadsByStage, setLeadsByStage] = useState<Record<string, Lead[]>>({});
  const [leadTagsMap, setLeadTagsMap] = useState<Record<string, Tag[]>>({});
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

      // 3. Load tags for these leads
      if (allLeads.length > 0) {
        const leadIds = allLeads.map((l) => l.id);
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
      setError(err instanceof Error ? err.message : 'Error loading pipeline data');
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

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setActiveDropStageId(null);

    if (!draggedLeadId) return;
    const leadId = draggedLeadId;
    setDraggedLeadId(null);

    // Find current stage of lead
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
      alert(err instanceof Error ? err.message : 'Failed to move lead stage');
    }
  };

  const getStageHeaderColor = (sortOrder: number) => {
    switch (sortOrder) {
      case 1: return 'border-sky-500 bg-sky-50/70 text-sky-800';
      case 2: return 'border-amber-500 bg-amber-50/70 text-amber-800';
      case 3: return 'border-purple-500 bg-purple-50/70 text-purple-800';
      case 4: return 'border-indigo-500 bg-indigo-50/70 text-indigo-800';
      case 5: return 'border-emerald-500 bg-emerald-50/70 text-emerald-800';
      case 6: return 'border-blue-500 bg-blue-50/70 text-blue-800';
      case 7: return 'border-gray-500 bg-gray-50/70 text-gray-800';
      default: return 'border-gray-400 bg-gray-50 text-gray-800';
    }
  };

  return (
    <Layout title="Commercial Pipeline">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-brand-50 text-brand-600">
                <Kanban className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Commercial Pipeline</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  Interactive drag-and-drop Kanban powered by {stages.length} official pipeline stages
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-gray-700 shadow-xs">
              Total Leads: <strong className="text-brand-600">{totalLeads}</strong>
            </span>
            <button
              onClick={loadPipelineData}
              title="Refresh board"
              className="p-2 text-gray-500 hover:text-gray-800 hover:bg-white border border-gray-200 rounded-xl shadow-xs transition-colors"
            >
              <RotateCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setIsNewLeadOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Lead
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingState message="Loading pipeline stages and leads..." />
        ) : error ? (
          <ErrorState message={error} onRetry={loadPipelineData} />
        ) : (
          /* Kanban Board Scrollable Container */
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-[1500px]">
              {stages.map((stage) => {
                const stageLeads = leadsByStage[stage.id] || [];
                const isDropTarget = activeDropStageId === stage.id;

                return (
                  <div
                    key={stage.id}
                    onDragOver={(e) => handleDragOver(e, stage.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stage.id)}
                    className={`flex-1 min-w-[220px] max-w-[260px] rounded-2xl flex flex-col bg-gray-100/70 border transition-all duration-200 ${
                      isDropTarget
                        ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/20 shadow-md'
                        : 'border-gray-200'
                    }`}
                  >
                    {/* Column Header */}
                    <div
                      className={`px-3.5 py-3 rounded-t-2xl border-t-4 flex items-center justify-between ${getStageHeaderColor(
                        stage.sort_order,
                      )}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold tracking-tight">{stage.name}</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white shadow-xs text-gray-700">
                        {stageLeads.length}
                      </span>
                    </div>

                    {/* Cards List */}
                    <div className="p-2.5 flex-1 space-y-2.5 min-h-[500px] overflow-y-auto max-h-[75vh]">
                      {stageLeads.map((lead) => {
                        const fullName =
                          [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead';
                        const tags = leadTagsMap[lead.id] || [];
                        const isDragging = draggedLeadId === lead.id;

                        return (
                          <div
                            key={lead.id}
                            draggable
                            onDragStart={() => handleDragStart(lead.id)}
                            onClick={() => navigate(`/leads/${lead.id}`)}
                            className={`p-3 bg-white rounded-xl border border-gray-200/90 shadow-xs hover:shadow-md transition-all duration-150 cursor-grab active:cursor-grabbing space-y-2 group ${
                              isDragging ? 'opacity-40 scale-95 border-dashed border-brand-400' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <h4 className="text-xs font-bold text-gray-900 leading-tight line-clamp-1 group-hover:text-brand-600 transition-colors">
                                {fullName}
                              </h4>
                              <div className="flex items-center gap-1 shrink-0">
                                {lead.lead_score !== undefined && lead.lead_score !== null && (
                                  <span
                                    title={`Lead Score: ${lead.lead_score}`}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-extrabold font-mono bg-amber-50 text-amber-700 border border-amber-200"
                                  >
                                    ⚡ {lead.lead_score}
                                  </span>
                                )}
                                <GripVertical className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 shrink-0" />
                              </div>
                            </div>

                            {lead.email && (
                              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                                <Mail className="h-3 w-3 text-gray-400 shrink-0" />
                                <span className="truncate">{lead.email}</span>
                              </div>
                            )}

                            {lead.phone_raw && (
                              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                                <Phone className="h-3 w-3 text-gray-400 shrink-0" />
                                <span className="truncate">{lead.phone_raw}</span>
                              </div>
                            )}

                            {/* Tags pill */}
                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {tags.slice(0, 3).map((t) => (
                                  <span
                                    key={t.id}
                                    className="px-1.5 py-0.5 text-[9px] font-medium bg-gray-100 text-gray-600 rounded"
                                  >
                                    #{t.name}
                                  </span>
                                ))}
                                {tags.length > 3 && (
                                  <span className="text-[9px] text-gray-400">+{tags.length - 3}</span>
                                )}
                              </div>
                            )}

                            {/* Qualification badge */}
                            {lead.qualification_status && (
                              (() => {
                                const badge = getQualificationStatusBadge(lead.qualification_status);
                                return (
                                  <div className="pt-0.5">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md border ${badge.bg} ${badge.text} ${badge.border}`}
                                    >
                                      {badge.label}
                                    </span>
                                  </div>
                                );
                              })()
                            )}

                            {/* Footer info */}
                            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                              <span className="capitalize">{lead.source}</span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {new Date(lead.updated_at).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      {stageLeads.length === 0 && (
                        <div className="h-24 flex items-center justify-center border-2 border-dashed border-gray-200/60 rounded-xl text-[11px] text-gray-400">
                          Empty stage
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <NewLeadModal
          isOpen={isNewLeadOpen}
          onClose={() => setIsNewLeadOpen(false)}
          onLeadCreated={loadPipelineData}
        />
      </div>
    </Layout>
  );
}
