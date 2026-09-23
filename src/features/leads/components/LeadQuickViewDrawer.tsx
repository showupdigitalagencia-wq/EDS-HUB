import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink,
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
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Drawer } from '../../../components/ui/Drawer';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { LeadQuickActionBar } from './LeadQuickActionBar';
import { LeadConversationStatus } from './LeadConversationStatus';
import { LeadConversationsCard } from '../LeadConversationsCard';
import { LeadTimeline } from './LeadTimeline';
import { LeadTaskList } from './LeadTaskList';
import { LeadTaskModal } from './LeadTaskModal';
import type { Lead, LeadActivity, Task, LeadNote } from '../../../types';

export interface LeadQuickViewDrawerProps {
  leadId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onLeadUpdated?: () => void;
  initialLead?: Lead | null;
}

type TabType = 'resumo' | 'conversas' | 'atividades' | 'tarefas';

export function LeadQuickViewDrawer({
  leadId,
  isOpen,
  onClose,
  onLeadUpdated,
  initialLead,
}: LeadQuickViewDrawerProps) {
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(initialLead || null);
  const [courseInterests, setCourseInterests] = useState<any[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('resumo');

  // Task modal
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'generic' | 'payment'>('generic');

  const fetchLeadData = useCallback(async () => {
    if (!leadId) {
      setLead(null);
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
        .limit(30);

      setActivities(actData || []);

      // 4. Fetch Tasks (for task list)
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
    } catch (err) {
      console.error('Failed to load lead in Quick View:', err);
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
    if (isOpen && leadId) {
      fetchLeadData();
      setActiveTab('resumo');
    }
  }, [isOpen, leadId, fetchLeadData]);

  const handleOpenFullProfile = () => {
    if (leadId) {
      onClose();
      navigate(`/leads/${leadId}`);
    }
  };

  const handleLeadRefresh = () => {
    fetchLeadData();
    if (onLeadUpdated) onLeadUpdated();
  };

  const tabs: TabItem<TabType>[] = [
    { id: 'resumo', label: 'Resumo', icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'conversas', label: 'Conversas', icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: 'atividades', label: 'Atividades', icon: <Activity className="h-3.5 w-3.5" /> },
    { id: 'tarefas', label: 'Tarefas', icon: <CheckSquare className="h-3.5 w-3.5" /> },
  ];

  const initials = lead
    ? `${lead.first_name?.charAt(0) || ''}${lead.last_name?.charAt(0) || ''}`.toUpperCase() || 'L'
    : 'L';

  const pipelineStage = (lead as any)?.pipeline_stage;

  // Operational Attention State Derivation
  const overdueTasksCount = tasks.filter(
    (t) => t.status !== 'completed' && t.due_at && new Date(t.due_at) < new Date()
  ).length;
  const pendingTasksCount = tasks.filter((t) => t.status === 'pending').length;
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

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      widthClass="sm:max-w-xl w-full"
      title={
        lead ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#08254f] text-white flex items-center justify-center text-xs font-bold font-heading shadow-xs shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#08254f] truncate font-heading tracking-tight">
                {lead.first_name} {lead.last_name}
              </h2>
              {pipelineStage && (
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="navy" size="sm">
                    {pipelineStage.name}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        ) : (
          <span className="text-sm font-semibold text-slate-500">Carregando lead...</span>
        )
      }
      headerActions={
        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="text-[10px] text-slate-400 animate-pulse font-medium">
              Sincronizando...
            </span>
          )}
          {lead ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenFullProfile}
              title="Ver em página completa"
              rightIcon={<ExternalLink className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />}
              className="text-xs"
            >
              Ver em página completa
            </Button>
          ) : null}
        </div>
      }
    >
      {!lead ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-10 bg-slate-100 rounded-xl" />
          <div className="h-28 bg-slate-100 rounded-2xl" />
          <div className="h-36 bg-slate-100 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-5">
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
            onActivityLogged={handleLeadRefresh}
          />

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

          {/* Tab 1: Resumo */}
          {activeTab === 'resumo' && (
            <div className="space-y-4">
              {/* Operational Attention State Banner */}
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

              {/* Contact & Registration Summary Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
                <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider">
                  Dados de Contato & Origem
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px] mb-0.5">Telefone</span>
                    {lead.phone_e164 || lead.phone_raw ? (
                      <a
                        href={`tel:${(lead.phone_e164 || lead.phone_raw || '').replace(/\D/g, '')}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex w-fit max-w-full items-center gap-1.5 font-semibold text-slate-800 hover:text-[#08254f] py-1 px-1.5 -ml-1.5 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                        title={`Ligar para ${lead.phone_e164 || lead.phone_raw}`}
                      >
                        <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{lead.phone_e164 || lead.phone_raw}</span>
                      </a>
                    ) : (
                      <span className="font-semibold text-slate-400 italic">Não informado</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] mb-0.5">E-mail</span>
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email.trim()}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex w-fit max-w-full items-center gap-1.5 font-semibold text-slate-800 hover:text-[#08254f] py-1 px-1.5 -ml-1.5 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                        title={`Enviar e-mail para ${lead.email}`}
                      >
                        <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{lead.email}</span>
                      </a>
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

              {/* Course Interests Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
                <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider flex items-center gap-1.5">
                  <GraduationCap className="h-4 w-4 text-[#449bd5]" />
                  <span>Cursos de Interesse</span>
                </h3>

                {courseInterests.length > 0 ? (
                  <div className="space-y-2">
                    {courseInterests.map((interest) => (
                      <div
                        key={interest.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                      >
                        <span className="font-semibold text-slate-800">
                          {interest.course?.name || 'Curso'}
                        </span>
                        {interest.session?.start_date && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {new Date(interest.session.start_date).toLocaleDateString('pt-BR', {
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Nenhum curso de interesse selecionado
                  </p>
                )}
              </div>

              {/* Notes Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-[#449bd5]" />
                    <span>Observações ({notes.length})</span>
                  </h3>
                </div>

                {notes.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className="p-2.5 rounded-xl border text-xs leading-relaxed bg-slate-50 border-slate-100 text-slate-700"
                      >
                        <p>{note.content}</p>
                        <span className="text-[10px] text-slate-400 block mt-1">
                          {new Date(note.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Nenhuma observação registrada.
                  </p>
                )}

                {/* Inline Add Note */}
                <form
                  onSubmit={async (e) => {
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
                  }}
                  className="pt-2 border-t border-slate-100 flex gap-2"
                >
                  <input
                    type="text"
                    placeholder="Adicionar nota rápida..."
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
                    Adicionar
                  </Button>
                </form>
              </div>
            </div>
          )}

          {/* Tab 2: Conversas (Lazy-Loaded message thread) */}
          {activeTab === 'conversas' && (
            <div className="space-y-4">
              <LeadConversationsCard
                lead={lead}
                onLeadUpdated={handleLeadRefresh}
              />
            </div>
          )}

          {/* Tab 3: Atividades (Timeline of contact attempts & events) */}
          {activeTab === 'atividades' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs">
              <LeadTimeline activities={activities} />
            </div>
          )}

          {/* Tab 4: Tarefas (Interactive Task Checklist) */}
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
        </div>
      )}

      {/* Task Creation Modal */}
      {lead && (
        <LeadTaskModal
          isOpen={isTaskModalOpen}
          leadId={lead.id}
          mode={taskModalMode === 'payment' ? 'payment' : 'generic'}
          onClose={() => setIsTaskModalOpen(false)}
          onTaskCreated={handleLeadRefresh}
        />
      )}
    </Drawer>
  );
}

// Unified alias per Section 9
export const LeadProfileDrawer = LeadQuickViewDrawer;

