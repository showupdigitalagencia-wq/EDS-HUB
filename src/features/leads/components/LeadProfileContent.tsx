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
} from 'lucide-react';
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
import type { Lead, LeadActivity, Task, LeadNote, IncompleteEnrollment } from '../../../types';

export interface LeadProfileContentProps {
  leadId: string;
  initialLead?: Lead | null;
  onLeadUpdated?: () => void;
  isStandalonePage?: boolean;
}

type TabType = 'resumo' | 'conversas' | 'atividades' | 'tarefas';

export function LeadProfileContent({
  leadId,
  initialLead,
  onLeadUpdated,
  isStandalonePage = false,
}: LeadProfileContentProps) {
  const [lead, setLead] = useState<Lead | null>(initialLead || null);
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
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                {lead.phone_raw || lead.phone_e164 ? (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3 text-slate-400" />
                    {lead.phone_raw || lead.phone_e164}
                  </span>
                ) : null}
                {lead.email ? (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3 text-slate-400" />
                    {lead.email}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {isLoading && (
            <span className="text-xs text-slate-400 animate-pulse font-medium">
              Sincronizando...
            </span>
          )}
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
            <h3 className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider">
              Dados de Contato & Origem
            </h3>
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
              {lead.contact_preference && (
                <div>
                  <span className="text-slate-400 block text-[11px] mb-0.5">Canal Preferencial</span>
                  <span className="font-semibold text-slate-700 capitalize">
                    {lead.contact_preference}
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
        </div>
      )}

      {/* TAB 2: CONVERSAS (Real Stored Thread) */}
      {activeTab === 'conversas' && (
        <div className="space-y-4">
          <LeadConversationsCard
            lead={lead}
            onLeadUpdated={handleLeadRefresh}
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
          mode={taskModalMode === 'payment' ? 'payment' : 'generic'}
          onClose={() => setIsTaskModalOpen(false)}
          onTaskCreated={handleLeadRefresh}
        />
      )}
    </div>
  );
}
