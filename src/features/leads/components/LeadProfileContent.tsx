import { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  Calendar,
  UserCheck,
  CheckSquare,
  MessageSquare,
  Activity,
  FileText,
  Phone,
  Mail,
  AlertCircle,
  Plus,
  Trash2,
  Clock,
  ArrowRight,
  Edit2,
  Kanban,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { CampaignAudienceService } from '../../campaigns/services/campaign-audience-service';
import { supabase } from '../../../lib/supabase';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { LeadQuickActionBar } from './LeadQuickActionBar';
import { LeadConversationStatus } from './LeadConversationStatus';
import { LeadConversationsCard } from '../LeadConversationsCard';
import { LeadTimeline } from './LeadTimeline';
import { LeadTaskList } from './LeadTaskList';
import { LeadTaskModal } from './LeadTaskModal';
import { LeadEnrollmentCard } from './LeadEnrollmentCard';
import { formatSessionMonthYear } from '../../pipeline/components/MinimalLeadCard';
import { fetchActiveIncompleteEnrollment, dismissIncompleteEnrollment } from '../services/incomplete-enrollment-service';
import { ManualEmailComposerModal } from './ManualEmailComposerModal';
import { ManualSmsComposerModal } from './ManualSmsComposerModal';
import { EditLeadModal } from './EditLeadModal';
import { ChangeLeadStageModal } from './ChangeLeadStageModal';
import { fetchLeadEmailHealth, type LeadEmailHealthResult } from '../../dashboard/services/deliverability-health-service';
import { formatContactPreferenceLabel, getContactPreferenceBadgeClasses } from '../../../utils/contact-preference';
import type { Lead, LeadActivity, Task, LeadNote, IncompleteEnrollment } from '../../../types';

export interface LeadProfileContentProps {
  leadId: string;
  initialLead?: Lead | null;
  onLeadUpdated?: () => void;
  onLeadDeleted?: () => void;
  onOpenEditLead?: () => void;
  isStandalonePage?: boolean;
}

type TabType = 'resumo' | 'conversas' | 'atividades' | 'tarefas';

export function LeadProfileContent({
  leadId,
  initialLead,
  onLeadUpdated,
  onLeadDeleted,
  onOpenEditLead,
  isStandalonePage = false,
}: LeadProfileContentProps) {
  const { isAuthorized } = useAuth();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(initialLead || null);
  const [internalEditLeadOpen, setInternalEditLeadOpen] = useState(false);
  const handleOpenEdit = onOpenEditLead || (() => setInternalEditLeadOpen(true));
  const [courseInterests, setCourseInterests] = useState<any[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [incompleteEnrollment, setIncompleteEnrollment] = useState<IncompleteEnrollment | null>(null);
  const [isDismissingAlert, setIsDismissingAlert] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('resumo');

  // Safe delete lead state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDeleteLead = async () => {
    if (!lead) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await CampaignAudienceService.safeDeleteLead(lead.id);
      if (!res.success) {
        throw new Error('Falha ao excluir lead');
      }
      window.dispatchEvent(new CustomEvent('lead-updated', { detail: { leadId: lead.id } }));
      window.dispatchEvent(new CustomEvent('lead_updated', { detail: { leadId: lead.id } }));
      setIsDeleteModalOpen(false);
      if (onLeadDeleted) {
        onLeadDeleted();
      } else if (onLeadUpdated) {
        onLeadUpdated();
      } else if (isStandalonePage) {
        navigate('/leads', { state: { toast: 'Lead excluído com sucesso.' } });
      }
    } catch (err: any) {
      setDeleteError(err?.message || 'Falha ao excluir lead.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Task modal
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'generic' | 'payment'>('generic');

  // Stage change modal
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);

  // Manual Email & SMS Composers & Lead Email Health
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);
  const [isSmsComposerOpen, setIsSmsComposerOpen] = useState(false);
  const [emailHealth, setEmailHealth] = useState<LeadEmailHealthResult | null>(null);

  const fetchLeadData = useCallback(async () => {
    if (!leadId) {
      setLead(initialLead || null);
      setCourseInterests([]);
      setActivities([]);
      setTasks([]);
      setNotes([]);
      return;
    }

    setIsLoading(true);
    try {
      // 1. Fetch Lead Details
      const { data: leadData, error: leadErr } = await supabase
        .from('leads')
        .select(`
          *,
          pipeline_stage:pipeline_stages(*)
        `)
        .eq('id', leadId)
        .single();

      if (leadErr) throw leadErr;
      setLead(leadData as Lead);

      if (leadData?.email) {
        void fetchLeadEmailHealth(leadData.email).then(setEmailHealth);
      } else {
        setEmailHealth(null);
      }

      // 2. Fetch Lead Course Interests
      const { data: interestsData } = await supabase
        .from('lead_course_interests')
        .select(`
          id,
          course_id,
          session_id,
          priority,
          course:courses(id, name, code),
          session:course_sessions(id, name, start_date)
        `)
        .eq('lead_id', leadId)
        .order('priority', { ascending: true });

      setCourseInterests(interestsData || []);

      // 3. Fetch Activities (for timeline)
      const { data: actData } = await supabase
        .from('lead_activities')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(50);

      setActivities(actData || []);

      // 4. Fetch Tasks (for task list & summary)
      const { data: taskData } = await supabase
        .from('tasks')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      setTasks(taskData || []);

      // 5. Fetch Notes (for notes view)
      const { data: notesData } = await supabase
        .from('lead_notes')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      setNotes(notesData || []);

      // 6. Fetch Incomplete Enrollment
      const incData = await fetchActiveIncompleteEnrollment(leadId);
      setIncompleteEnrollment(incData);
    } catch (err) {
      console.error('Failed to load lead in LeadProfileContent:', err);
      if (initialLead) {
        setLead(initialLead);
      }
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (initialLead) {
      setLead(initialLead);
    }
  }, [initialLead]);

  useEffect(() => {
    if (leadId) {
      fetchLeadData();
    }
  }, [leadId, fetchLeadData]);

  // Realtime synchronization: refresh lead profile when tasks or lead data are updated
  useEffect(() => {
    const handleSync = (e?: Event) => {
      const customEvent = e as CustomEvent<{ leadId?: string }>;
      if (!customEvent?.detail?.leadId || customEvent.detail.leadId === leadId) {
        fetchLeadData();
      }
    };
    window.addEventListener('tasks-updated', handleSync);
    window.addEventListener('lead-updated', handleSync);
    return () => {
      window.removeEventListener('tasks-updated', handleSync);
      window.removeEventListener('lead-updated', handleSync);
    };
  }, [leadId, fetchLeadData]);

  const handleLeadRefresh = () => {
    fetchLeadData();
    if (onLeadUpdated) onLeadUpdated();
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !leadId) return;
    setIsAddingNote(true);
    try {
      const { error } = await supabase.from('lead_notes').insert({
        lead_id: leadId,
        content: newNoteContent.trim(),
      });
      if (!error) {
        setNewNoteContent('');
        fetchLeadData();
        if (onLeadUpdated) onLeadUpdated();
      }
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const { error } = await supabase.from('lead_notes').delete().eq('id', noteId);
      if (!error) {
        fetchLeadData();
        if (onLeadUpdated) onLeadUpdated();
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const handleDismissIncompleteAlert = async () => {
    if (!incompleteEnrollment) return;
    setIsDismissingAlert(true);
    try {
      const res = await dismissIncompleteEnrollment(incompleteEnrollment.id, 'Dispensado no perfil do lead');
      if (res.success) {
        setIncompleteEnrollment(null);
        fetchLeadData();
        if (onLeadUpdated) onLeadUpdated();
      }
    } finally {
      setIsDismissingAlert(false);
    }
  };

  const tabs: TabItem<TabType>[] = [
    { id: 'resumo', label: 'Resumo', icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'conversas', label: 'Conversas', icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: 'atividades', label: 'Atividades', icon: <Activity className="h-3.5 w-3.5" /> },
    { id: 'tarefas', label: 'Tarefas', icon: <CheckSquare className="h-3.5 w-3.5" /> },
  ];

  // Operational Attention State Derivation
  const overdueTasksCount = tasks.filter(
    (t) => t.status !== 'completed' && t.due_at && new Date(t.due_at) < new Date()
  ).length;
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const pendingTasksCount = pendingTasks.length;
  const hasNoContact = !lead?.phone_raw && !lead?.phone_e164 && !lead?.email;

  const attentionStatus = hasNoContact
    ? {
        label: 'Atenção: Contato ausente',
        badge: 'bg-rose-50 text-rose-700 border-rose-200',
        desc: 'Lead sem telefone ou e-mail cadastrado',
      }
    : overdueTasksCount > 0
    ? {
        label: 'Atenção: Tarefas em atraso',
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
        desc: `${overdueTasksCount} tarefa(s) operacional(is) vencida(s)`,
      }
    : pendingTasksCount > 0
    ? {
        label: 'Operação em andamento',
        badge: 'bg-sky-50 text-sky-700 border-sky-200',
        desc: `${pendingTasksCount} tarefa(s) pendente(s)`,
      }
    : {
        label: 'Operação em dia',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        desc: 'Nenhuma pendência operacional',
      };

  if (!lead && isLoading) {
    return (
      <div className="space-y-4 animate-pulse p-2">
        <div className="h-10 bg-slate-100 rounded-xl" />
        <div className="h-28 bg-slate-100 rounded-2xl" />
        <div className="h-36 bg-slate-100 rounded-2xl" />
        <div className="h-44 bg-slate-100 rounded-2xl" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-8 text-center text-slate-500">
        Lead não encontrado.
      </div>
    );
  }

  const initials = `${lead.first_name?.charAt(0) || ''}${lead.last_name?.charAt(0) || ''}`.toUpperCase() || 'L';
  const pipelineStage = (lead as any)?.pipeline_stage;

  return (
    <div className="space-y-5">
      {/* Standalone Page Header (Only rendered when accessed via /leads/:id) */}
      {isStandalonePage && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#08254f] text-white flex items-center justify-center text-base font-bold font-heading shadow-xs shrink-0">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold text-[#08254f] font-heading tracking-tight">
                  {lead.first_name} {lead.last_name}
                </h1>
                {pipelineStage && (
                  <Badge variant="navy" size="sm">
                    {pipelineStage.name}
                  </Badge>
                )}
                <span
                  data-testid="profile-contact-preference-badge"
                  className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${getContactPreferenceBadgeClasses(lead.contact_preference).badge}`}
                >
                  {formatContactPreferenceLabel(lead.contact_preference, { withPrefix: true })}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                {lead.phone_raw || lead.phone_e164 ? (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3 text-slate-400" />
                    {lead.phone_raw || lead.phone_e164}
                  </span>
                ) : null}
                {lead.email ? (
                  <button
                    type="button"
                    onClick={() => setIsEmailComposerOpen(true)}
                    className="flex items-center gap-1 hover:text-[#08254f] transition-colors cursor-pointer text-left"
                    title={`Enviar e-mail para ${lead.email}`}
                  >
                    <Mail className="h-3 w-3 text-slate-400" />
                    <span>{lead.email}</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#08254f] bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Editar lead"
              data-testid="standalone-edit-lead-button"
            >
              <Edit2 className="h-3.5 w-3.5 text-[#449bd5]" />
              <span>Editar lead</span>
            </button>
            {isAuthorized && (
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-xl transition-colors cursor-pointer"
                title="Excluir lead"
                data-testid="standalone-delete-lead-button"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                <span>Excluir lead</span>
              </button>
            )}
            {isLoading && (
              <span className="text-xs text-slate-400 animate-pulse font-medium">
                Sincronizando...
              </span>
            )}
          </div>
        </div>
      )}

      {/* Quick Action Toolbar (WhatsApp, Email, SMS, Call, Task, Payment) */}
      <LeadQuickActionBar
        lead={lead}
        onOpenTaskModal={() => {
          setTaskModalMode('generic');
          setIsTaskModalOpen(true);
        }}
        onOpenPaymentModal={() => {
          setTaskModalMode('payment');
          setIsTaskModalOpen(true);
        }}
        onOpenEmailComposer={() => setIsEmailComposerOpen(true)}
        onOpenSmsComposer={() => setIsSmsComposerOpen(true)}
        onActivityLogged={handleLeadRefresh}
      />

      {/* Current Pipeline Stage Section with 'Alterar etapa' action */}
      <div
        className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        data-testid="lead-stage-bar"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[#08254f]/10 text-[#08254f]">
            <Kanban className="h-4 w-4" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Etapa atual:
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="text-sm font-bold text-[#08254f] font-heading"
                data-testid="profile-current-stage-name"
              >
                {pipelineStage?.name || 'Novo Lead'}
              </span>
              <Badge variant="navy" size="sm">
                {pipelineStage?.name || 'Novo Lead'}
              </Badge>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsStageModalOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#08254f] bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
          title="Alterar etapa deste lead no pipeline"
          data-testid="alterar-etapa-button"
        >
          <Kanban className="h-3.5 w-3.5 text-[#449bd5]" />
          <span>Alterar etapa</span>
        </button>
      </div>

      {/* Recent Conversation Status Banner */}
      <LeadConversationStatus
        leadId={lead.id}
        onSelectTab={(tab) => setActiveTab(tab as TabType)}
      />

      {/* Navigation Tabs (Resumo, Conversas, Atividades, Tarefas) */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab)}
        className="w-full justify-start"
      />

      {/* TAB 1: RESUMO (Complete Operational Overview) */}
      {activeTab === 'resumo' && (
        <div className="space-y-4">
          {/* Incomplete Enrollment Operational Alert Banner */}
          {incompleteEnrollment && incompleteEnrollment.status === 'needs_followup' && (
            <div className="p-3.5 rounded-2xl border border-amber-300 bg-amber-50/90 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs font-heading text-amber-900">
                      Inscrição não concluída
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-200/70 text-amber-800">
                      Follow-up pendente
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800/90 mt-0.5">
                    <span className="font-semibold">{incompleteEnrollment.course?.name || 'Curso'}</span>
                    {incompleteEnrollment.course_session?.title && (
                      <span> • Turma: {incompleteEnrollment.course_session.title}</span>
                    )}
                    <span>
                      {' '}•{' '}
                      {new Date(incompleteEnrollment.created_at).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                {incompleteEnrollment.task_id && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs h-7 px-2.5 border-amber-300 hover:bg-amber-100 text-amber-900"
                    onClick={() => setActiveTab('tarefas')}
                  >
                    <CheckSquare className="h-3 w-3 mr-1" />
                    Ver Tarefa
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 px-2 text-amber-700 hover:bg-amber-100/80 hover:text-amber-900"
                  disabled={isDismissingAlert}
                  onClick={handleDismissIncompleteAlert}
                >
                  Dispensar Alerta
                </Button>
              </div>
            </div>
          )}

          {/* 1. Operational Attention State Banner */}
          <div className={`p-3.5 rounded-2xl border flex items-start gap-3 ${attentionStatus.badge}`}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-xs font-heading">{attentionStatus.label}</span>
                {lead.lead_score !== undefined && lead.lead_score !== null && (
                  <span className="text-[10px] opacity-75 font-mono">
                    Score: {lead.lead_score}
                  </span>
                )}
              </div>
              <p className="text-[11px] opacity-90 mt-0.5">{attentionStatus.desc}</p>
            </div>
          </div>

          {/* 2. Dados de Contato & Origem Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider">
                Dados de Contato & Origem
              </h3>
              <button
                type="button"
                onClick={handleOpenEdit}
                className="text-xs font-semibold text-[#449bd5] hover:text-[#08254f] flex items-center gap-1 cursor-pointer transition-colors"
                title="Editar dados cadastrais"
                data-testid="card-edit-lead-button"
              >
                <Edit2 className="h-3 w-3" />
                <span>Editar</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px] mb-0.5">Telefone</span>
                {lead.phone_raw || lead.phone_e164 ? (
                  <a
                    href={`tel:${(lead.phone_e164 || lead.phone_raw || '').replace(/\D/g, '')}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex w-fit max-w-full items-center gap-1.5 font-semibold text-slate-800 hover:text-[#08254f] py-1 px-1.5 -ml-1.5 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                    title={`Ligar para ${lead.phone_raw || lead.phone_e164}`}
                  >
                    <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{lead.phone_raw || lead.phone_e164}</span>
                  </a>
                ) : (
                  <span className="font-semibold text-slate-400 italic">Não informado</span>
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                  <span className="text-slate-400 block text-[11px]">E-mail</span>
                  {emailHealth && emailHealth.status !== 'sem_historico' && (
                    <>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-md border ${
                          emailHealth.factualStatus?.badgeClass || emailHealth.badgeClass
                        }`}
                        title={emailHealth.details}
                      >
                        {emailHealth.factualStatus?.label || emailHealth.label}
                      </span>
                      {emailHealth.risk && emailHealth.risk.level !== 'sem_historico' && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded-md border ${emailHealth.risk.badgeClass}`}
                          title={emailHealth.risk.reasons.join(', ')}
                        >
                          Risco: {emailHealth.risk.label}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {lead.email ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEmailComposerOpen(true);
                    }}
                    className="inline-flex w-fit max-w-full items-center gap-1.5 font-semibold text-slate-800 hover:text-[#08254f] py-1 px-1.5 -ml-1.5 rounded-md hover:bg-slate-50 transition-colors cursor-pointer text-left"
                    title={`Enviar e-mail para ${lead.email}`}
                  >
                    <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{lead.email}</span>
                  </button>
                ) : (
                  <span className="font-semibold text-slate-400 italic">Não informado</span>
                )}
              </div>
              {lead.source && (
                <div>
                  <span className="text-slate-400 block text-[11px] mb-0.5">Origem / Canal</span>
                  <span className="font-semibold text-slate-700 capitalize">
                    {lead.source} {lead.source_detail ? `(${lead.source_detail})` : ''}
                  </span>
                </div>
              )}
              <div>
                <span className="text-slate-400 block text-[11px] mb-0.5">Preferência de Contato</span>
                <span
                  data-testid="profile-contact-preference-value"
                  className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md border ${getContactPreferenceBadgeClasses(lead.contact_preference).badge}`}
                >
                  {formatContactPreferenceLabel(lead.contact_preference, { withPrefix: false })}
                </span>
              </div>
              {lead.referred_by && (
                <div className="flex items-center gap-1.5 text-slate-600 bg-slate-50 p-2 rounded-lg sm:col-span-2">
                  <UserCheck className="h-3.5 w-3.5 text-[#449bd5] shrink-0" />
                  <span className="text-[11px]">
                    Indicado por: <strong>{lead.referred_by}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Entregabilidade de E-mail & Proteção de Reputação Card */}
          {lead.email && emailHealth && (
            <div
              data-testid="lead-email-deliverability-detail"
              className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-[#449bd5]" />
                  <span>Entregabilidade & Reputação</span>
                </h3>
                {emailHealth.factualStatus && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-md border ${emailHealth.factualStatus.badgeClass}`}
                    >
                      {emailHealth.factualStatus.label}
                    </span>
                    {emailHealth.risk && emailHealth.risk.level !== 'sem_historico' && (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-md border ${emailHealth.risk.badgeClass}`}
                      >
                        Risco: {emailHealth.risk.label}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs">
                {/* Current status */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-medium uppercase">Status Atual</span>
                  <span className="font-bold text-slate-800 mt-1">
                    {emailHealth.factualStatus?.label || emailHealth.label || 'Sem histórico recente'}
                  </span>
                </div>

                {/* Deliverability risk */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-medium uppercase">Risco de Entregabilidade</span>
                  <span className={`font-bold mt-1 ${emailHealth.risk?.color || 'text-slate-700'}`}>
                    {emailHealth.risk ? emailHealth.risk.label : 'Sem histórico'}
                  </span>
                </div>

                {/* Suppression */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-medium uppercase">Supressão</span>
                  <span className="mt-1">
                    {emailHealth.suppression?.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800">
                        ATIVA ({emailHealth.suppression.reason})
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                        INATIVA
                      </span>
                    )}
                  </span>
                </div>

                {/* Automation eligibility */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-medium uppercase">Envio por Automação</span>
                  <span className="mt-1">
                    {emailHealth.automationAllowed === false ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800">
                        BLOQUEADO
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                        PERMITIDO
                      </span>
                    )}
                  </span>
                </div>

                {/* Timestamps */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block">Última entrega confirmada</span>
                  <span className="font-semibold text-slate-700 mt-1 block">
                    {emailHealth.lastSuccessfulDelivery
                      ? new Date(emailHealth.lastSuccessfulDelivery).toLocaleString('pt-BR')
                      : '—'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block">Última falha / problema</span>
                  <span className="font-semibold text-slate-700 mt-1 block">
                    {emailHealth.lastFailure
                      ? new Date(emailHealth.lastFailure).toLocaleString('pt-BR')
                      : '—'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block">Última abertura detectada</span>
                  <span className="font-semibold text-slate-700 mt-1 block">
                    {emailHealth.lastOpenDetected
                      ? new Date(emailHealth.lastOpenDetected).toLocaleString('pt-BR')
                      : '—'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block">Último clique detectado</span>
                  <span className="font-semibold text-slate-700 mt-1 block">
                    {emailHealth.lastClickDetected
                      ? new Date(emailHealth.lastClickDetected).toLocaleString('pt-BR')
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Reason / Explanation */}
              {emailHealth.risk?.reasons && emailHealth.risk.reasons.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block mb-1">
                    Justificativa Factual
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700 font-medium">
                    {emailHealth.risk.reasons.map((r, idx) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Spam Risk & Disclaimer */}
              <div className="p-2 rounded-xl bg-slate-50/80 border border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
                <span>
                  Risco de spam estimado:{' '}
                  <strong className="text-slate-700">
                    {emailHealth.spamRisk?.label || 'Baixo'}
                  </strong>
                </span>
                <span className="text-[10px] text-slate-400">
                  (Não infere pasta de destino sem sinal do provedor)
                </span>
              </div>
            </div>
          )}

          {/* 3. Cursos de Interesse Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider flex items-center gap-1.5">
              <GraduationCap className="h-4 w-4 text-[#449bd5]" />
              <span>Cursos de Interesse</span>
            </h3>

            {courseInterests.length > 0 ? (
              <div className="space-y-2">
                {courseInterests.map((interest) => {
                  const courseName = interest.course?.name || 'Curso';
                  const formattedDate = formatSessionMonthYear(interest.session?.start_date);
                  return (
                    <div
                      key={interest.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                    >
                      <span className="font-semibold text-slate-800">
                        {formattedDate ? `${courseName} • ${formattedDate}` : courseName}
                      </span>
                      {interest.session?.start_date && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {formattedDate}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : lead.course_interest ? (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-800">
                {lead.course_interest}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">
                Nenhum curso de interesse selecionado
              </p>
            )}
          </div>

          {/* 4. Matrículas & Financeiro Card (Complete Operational Capability) */}
          <LeadEnrollmentCard
            leadId={lead.id}
            leadSource={lead.source}
            onEnrollmentChanged={handleLeadRefresh}
          />

          {/* 5. Próximas Tarefas & Resumo Operacional Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare className="h-4 w-4 text-[#449bd5]" />
                <span>Tarefas ({tasks.length})</span>
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('tarefas')}
                className="text-xs text-[#08254f]"
              >
                Ver todas <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>

            {pendingTasks.length > 0 ? (
              <div className="space-y-2">
                {pendingTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="font-semibold text-slate-800 block truncate">
                        {task.title}
                      </span>
                      {task.due_at && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {new Date(task.due_at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                      )}
                    </div>
                    <Badge variant={task.priority === 'high' ? 'crimson' : 'navy'} size="sm">
                      {task.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">
                Nenhuma tarefa pendente no momento.
              </p>
            )}
          </div>

          {/* 6. Notas Internas Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[#449bd5]" />
                <span>Notas Internas ({notes.length})</span>
              </h3>
            </div>

            {notes.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="p-2.5 rounded-xl border text-xs leading-relaxed bg-slate-50 border-slate-100 text-slate-700"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span>
                        {new Date(note.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors p-0.5"
                        title="Excluir nota"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">
                Nenhuma observação ou nota registrada.
              </p>
            )}

            {/* Inline Add Note Form */}
            <form onSubmit={handleAddNote} className="pt-2 border-t border-slate-100 flex gap-2">
              <input
                type="text"
                placeholder="Adicionar nota interna ou resumo..."
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-[#449bd5]"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!newNoteContent.trim() || isAddingNote}
                className="text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                <span>Salvar Nota</span>
              </Button>
            </form>
          </div>

          {/* Zona de Perigo (Excluir lead) */}
          {isAuthorized && (
            <div className="bg-rose-50/40 border border-rose-200/80 rounded-2xl p-4 sm:p-5 mt-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-rose-950 font-heading uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    Zona de Perigo
                  </h4>
                  <p className="text-xs text-rose-700/80 mt-1 max-w-xl">
                    Remover este lead das listas operacionais do CRM. O histórico factual de interações, mensagens e tarefas concluídas é preservado.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-300 rounded-xl transition-colors cursor-pointer shrink-0 shadow-2xs"
                  data-testid="profile-delete-lead-button"
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  <span>Excluir lead</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CONVERSAS (Real Stored Thread) */}
      {activeTab === 'conversas' && (
        <div className="space-y-4">
          <LeadConversationsCard
            lead={lead}
            onLeadUpdated={handleLeadRefresh}
            onOpenComposer={() => setIsEmailComposerOpen(true)}
          />
        </div>
      )}

      {/* TAB 3: ATIVIDADES / LINHA DO TEMPO */}
      {activeTab === 'atividades' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs">
          <LeadTimeline activities={activities} />
        </div>
      )}

      {/* TAB 4: TAREFAS (Full Interactive Checklist) */}
      {activeTab === 'tarefas' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs">
          <LeadTaskList
            tasks={tasks}
            onOpenCreateTask={() => {
              setTaskModalMode('generic');
              setIsTaskModalOpen(true);
            }}
            onTaskUpdated={handleLeadRefresh}
          />
        </div>
      )}

      {/* Task Creation Modal */}
      {lead && (
        <LeadTaskModal
          isOpen={isTaskModalOpen}
          leadId={lead.id}
          leadName={`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || undefined}
          mode={taskModalMode === 'payment' ? 'payment' : 'generic'}
          onClose={() => setIsTaskModalOpen(false)}
          onTaskCreated={handleLeadRefresh}
        />
      )}

      {/* Manual Email Composer Modal (Lead Profile Direct Outreach) */}
      {lead && (
        <ManualEmailComposerModal
          isOpen={isEmailComposerOpen}
          lead={lead}
          onClose={() => setIsEmailComposerOpen(false)}
          onEmailSent={() => {
            fetchLeadData();
            setActiveTab('conversas');
            if (onLeadUpdated) onLeadUpdated();
          }}
        />
      )}

      {/* Manual SMS Composer Modal (SMS Manual Assistido) */}
      {lead && (
        <ManualSmsComposerModal
          isOpen={isSmsComposerOpen}
          lead={lead}
          onClose={() => setIsSmsComposerOpen(false)}
          onSmsRecorded={handleLeadRefresh}
        />
      )}

      {/* Edit Lead Modal */}
      {internalEditLeadOpen && lead && (
        <EditLeadModal
          isOpen={internalEditLeadOpen}
          onClose={() => setInternalEditLeadOpen(false)}
          lead={lead}
          onLeadUpdated={handleLeadRefresh}
        />
      )}

      {/* Change Lead Stage Modal */}
      {isStageModalOpen && lead && (
        <ChangeLeadStageModal
          isOpen={isStageModalOpen}
          onClose={() => setIsStageModalOpen(false)}
          leadId={lead.id}
          leadName={`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || undefined}
          currentStageId={lead.pipeline_stage_id || pipelineStage?.id}
          currentStageName={pipelineStage?.name || 'Novo Lead'}
          onStageUpdated={(newStageId, newStageName) => {
            setLead((prev) =>
              prev
                ? ({
                    ...prev,
                    pipeline_stage_id: newStageId,
                    pipeline_stage: { id: newStageId, name: newStageName },
                  } as any)
                : null
            );
            fetchLeadData();
            if (onLeadUpdated) onLeadUpdated();
          }}
        />
      )}

      {/* Delete Lead Confirmation Modal */}
      {isDeleteModalOpen && lead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-600 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#08254f] font-heading">
                  Excluir lead?
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Confirmação de exclusão segura
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 text-xs space-y-1">
              <div className="text-slate-500 font-medium">Lead:</div>
              <div className="font-bold text-slate-900 text-sm">
                {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead sem nome'}
              </div>
              {lead.email && (
                <>
                  <div className="text-slate-500 font-medium pt-1">Email:</div>
                  <div className="font-mono text-slate-700">{lead.email}</div>
                </>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Este lead será removido das listas operacionais do CRM.
            </p>

            {deleteError && (
              <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteError(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteLead}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer shadow-xs"
                data-testid="confirm-delete-lead-button"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Excluir lead</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
