import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { Lead, PipelineStage, Tag, LeadNote, Task, LeadActivity, ContactPreference } from '../../types';
import { LeadEnrollmentCard } from './components/LeadEnrollmentCard';
import { LeadHubSpotCard } from './components/LeadHubSpotCard';
import { LeadQuickActionBar } from './components/LeadQuickActionBar';
import { LeadTaskModal } from './components/LeadTaskModal';
import { LeadTaskList } from './components/LeadTaskList';
import { LeadTimeline } from './components/LeadTimeline';
import { LeadConversationStatus } from './components/LeadConversationStatus';
import { LeadConversationsCard } from './LeadConversationsCard';
import { ManualEmailComposerModal } from './components/ManualEmailComposerModal';
import { RescheduleTaskModal } from '../work/components/RescheduleTaskModal';
import {
  formatSessionMonthYear,
  resolveAttentionState,
  type FormattedCourseInterest,
} from '../pipeline/components/MinimalLeadCard';
import {
  formatContactPreferenceLabel,
  getContactPreferenceBadgeClasses,
} from '../../utils/contact-preference';
import {
  ArrowLeft,
  Mail,
  Phone,
  Tag as TagIcon,
  FileText,
  Edit2,
  Save,
  Trash2,
  Plus,
  Award,
  GraduationCap,
  Share2,
  AlertTriangle,
  AlertCircle,
  Kanban,
} from 'lucide-react';
import { ChangeLeadStageModal } from './components/ChangeLeadStageModal';
import { moveLeadToAlumni } from '../courses/services/post-course-service';
import { useSafeBackNavigation } from '../../hooks/useSafeBackNavigation';

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightedTaskId = searchParams.get('taskId');
  const safeBack = useSafeBackNavigation('/leads');

  const [lead, setLead] = useState<Lead | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leadTags, setLeadTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [courseInterests, setCourseInterests] = useState<FormattedCourseInterest[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Lead Info state
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPref, setEditPref] = useState<ContactPreference>('email');
  const [editReferredBy, setEditReferredBy] = useState('');
  const [editCourseInterest, setEditCourseInterest] = useState('');

  // New Note state
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  // New Tag state
  const [newTagName, setNewTagName] = useState('');

  // Move to Alumni state
  const [isMovingAlumni, setIsMovingAlumni] = useState(false);

  // Lead Task Modal state (Generic vs Payment Reminder)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'generic' | 'payment'>('generic');
  const [reschedulingTask, setReschedulingTask] = useState<Task | null>(null);

  // Stage change modal state
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);

  // Manual Email Composer Modal
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);

  const loadLeadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);

    try {
      const [leadRes, stagesRes, allTagsRes, notesRes, tasksRes, actRes, interestsRes] =
        await Promise.all([
          supabase.from('leads').select('*').eq('id', id).single(),
          supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
          supabase.from('tags').select('*').order('name', { ascending: true }),
          supabase.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
          supabase.from('tasks').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
          supabase.from('lead_activities').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
          supabase
            .from('lead_course_interests')
            .select('priority, course:courses(name), session:course_sessions(title, start_date)')
            .eq('lead_id', id)
            .order('priority', { ascending: true }),
        ]);

      if (leadRes.error || !leadRes.data) {
        throw new Error('Lead not found or inaccessible.');
      }

      const l = leadRes.data as Lead;
      setLead(l);
      setEditFirstName(l.first_name || '');
      setEditLastName(l.last_name || '');
      setEditEmail(l.email || '');
      setEditPhone(l.phone_raw || l.phone_e164 || '');
      setEditPref(l.contact_preference);
      setEditReferredBy(l.referred_by || '');
      setEditCourseInterest(l.course_interest || '');

      if (stagesRes.data) setStages(stagesRes.data);
      if (allTagsRes.data) setAllTags(allTagsRes.data);
      if (notesRes.data) setNotes(notesRes.data);
      if (tasksRes.data) setTasks(tasksRes.data);
      if (actRes.data) setActivities(actRes.data as LeadActivity[]);

      // Format normalized course interests
      if (interestsRes.data && interestsRes.data.length > 0) {
        const formatted: FormattedCourseInterest[] = interestsRes.data.map((row: any) => ({
          courseName: row.course?.name || 'Curso',
          sessionTitle: row.session?.title,
          startDate: row.session?.start_date,
          priority: row.priority,
        }));
        setCourseInterests(formatted);
      } else {
        setCourseInterests([]);
      }

      // Fetch lead's assigned tags
      const { data: tagLinks } = await supabase
        .from('lead_tags')
        .select('tag_id, tags(*)')
        .eq('lead_id', id);

      if (tagLinks) {
        const assigned = tagLinks.map((t: any) => t.tags).filter(Boolean);
        setLeadTags(assigned);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados do lead');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadLeadData();
  }, [loadLeadData]);

  useEffect(() => {
    const handleUpdated = (e: any) => {
      if (!e.detail?.leadId || e.detail?.leadId === id) {
        loadLeadData();
      }
    };
    window.addEventListener('lead-updated', handleUpdated);
    window.addEventListener('tasks-updated', handleUpdated);
    return () => {
      window.removeEventListener('lead-updated', handleUpdated);
      window.removeEventListener('tasks-updated', handleUpdated);
    };
  }, [id, loadLeadData]);

  // Save updated contact fields
  const handleSaveContact = async () => {
    if (!lead) return;
    try {
      const cleanPhone = editPhone.trim();
      const phoneE164 = cleanPhone.startsWith('+') ? cleanPhone : null;

      const { error: updateErr } = await supabase
        .from('leads')
        .update({
          first_name: editFirstName.trim() || null,
          last_name: editLastName.trim() || null,
          email: editEmail.trim().toLowerCase() || null,
          phone_raw: cleanPhone || null,
          phone_e164: phoneE164,
          contact_preference: editPref,
          referred_by: editReferredBy.trim() || null,
          course_interest: editCourseInterest.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      if (updateErr) throw updateErr;

      window.dispatchEvent(
        new CustomEvent('lead-updated', {
          detail: { leadId: lead.id },
        })
      );

      setIsEditing(false);
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao atualizar dados do lead');
    }
  };

  // Add Note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !newNoteContent.trim()) return;
    setIsAddingNote(true);

    try {
      const { error: noteErr } = await supabase.from('lead_notes').insert({
        lead_id: lead.id,
        content: newNoteContent.trim(),
      });
      if (noteErr) throw noteErr;

      // Audit in activities
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'note_created',
        actor_type: 'user',
        summary: 'Nota adicionada ao lead',
        metadata: { snippet: newNoteContent.trim().substring(0, 100) },
      });

      setNewNoteContent('');
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao adicionar nota');
    } finally {
      setIsAddingNote(false);
    }
  };

  // Delete Note
  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Deseja excluir esta nota?')) return;
    try {
      await supabase.from('lead_notes').delete().eq('id', noteId);
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao excluir nota');
    }
  };

  // Add Tag to Lead
  const handleAttachTag = async (tagId: string) => {
    if (!lead) return;
    try {
      await supabase.from('lead_tags').insert({ lead_id: lead.id, tag_id: tagId });
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'tag_added',
        actor_type: 'user',
        summary: 'Tag vinculada ao lead',
        metadata: { tag_id: tagId },
      });
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao vincular tag');
    }
  };

  // Remove Tag from Lead
  const handleRemoveTag = async (tagId: string) => {
    if (!lead) return;
    try {
      await supabase.from('lead_tags').delete().eq('lead_id', lead.id).eq('tag_id', tagId);
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'tag_removed',
        actor_type: 'user',
        summary: 'Tag removida do lead',
        metadata: { tag_id: tagId },
      });
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao remover tag');
    }
  };

  // Create & attach new tag
  const handleCreateAndAttachTag = async () => {
    if (!lead || !newTagName.trim()) return;
    const name = newTagName.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    try {
      const { data: newTag, error: tagErr } = await supabase
        .from('tags')
        .insert({ name, slug })
        .select()
        .single();

      if (tagErr && tagErr.code !== '23505') throw tagErr;

      let tagId = newTag?.id;
      if (!tagId) {
        const { data: exTag } = await supabase.from('tags').select('id').eq('slug', slug).single();
        tagId = exTag?.id;
      }

      if (tagId) {
        await handleAttachTag(tagId);
        setNewTagName('');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao criar tag');
    }
  };

  // Promote to Alumni
  const handlePromoteToAlumni = async () => {
    if (!lead) return;
    if (!confirm('Deseja promover este aluno para a etapa Alumni no pipeline de relacionamento?')) return;
    setIsMovingAlumni(true);
    try {
      const res = await moveLeadToAlumni(lead.id);
      if (res.has_future_session) {
        alert('Aluno promovido a Alumni! Nota: O aluno possui matrícula/turma futura confirmada, que continua ativa normalmente.');
      }
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao mover para Alumni.');
    } finally {
      setIsMovingAlumni(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Perfil do Lead" backTo="/leads">
        <LoadingState message="Carregando perfil operacional..." />
      </Layout>
    );
  }

  if (error || !lead) {
    return (
      <Layout title="Perfil do Lead" backTo="/leads">
        <ErrorState message={error || 'Lead não encontrado'} onRetry={() => navigate('/leads')} />
      </Layout>
    );
  }

  const currentStage = stages.find((s) => s.id === lead.pipeline_stage_id);
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead sem nome';

  // Operational attention state (evidence-backed only)
  const attentionState = resolveAttentionState(
    lead,
    activities.map((a) => a.summary)
  );

  const phoneDisplay = lead.phone_raw || lead.phone_e164 || null;
  const emailDisplay = lead.email ? lead.email.trim() : null;

  return (
    <Layout
      eyebrow="CRM COMERCIAL"
      title="Perfil do Contato"
      subtitle="Dados de contato, comunicação, tarefas operacionais e histórico"
      backTo="/leads"
    >
      <div className="space-y-5">
        {/* Top Header Card — Executive Profile Hierarchy */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          {/* Identity & Top Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={safeBack}
                className="p-2 rounded-xl border border-slate-200/80 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors shadow-xs shrink-0 cursor-pointer"
                title="Voltar"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {/* Profile Avatar Tile */}
              <div className="w-11 h-11 rounded-2xl bg-[#08254f] text-white flex items-center justify-center text-sm font-bold shadow-xs shrink-0 font-heading">
                {lead.first_name?.charAt(0)?.toUpperCase() || 'C'}
              </div>

              <div className="space-y-0.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* 1. Lead Name (Strongest visual emphasis) */}
                  <h1 className="text-xl sm:text-2xl font-bold text-[#08254f] tracking-tight font-heading">
                    {fullName}
                  </h1>

                  {/* 2. Stage Badge */}
                  {currentStage && (
                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-lg bg-[#08254f]/10 text-[#08254f] border border-[#08254f]/20">
                      {currentStage.name}
                    </span>
                  )}

                  {/* Operational Attention State (when applicable) */}
                  {attentionState && (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-lg border ${
                        attentionState.variant === 'error'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : attentionState.variant === 'warning'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : attentionState.variant === 'info'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {attentionState.variant === 'error' && <AlertCircle className="h-3.5 w-3.5 text-rose-500" />}
                      {attentionState.variant === 'warning' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                      {attentionState.label}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-2 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setIsStageModalOpen(true)}
                className="btn-secondary text-xs text-[#08254f] border-slate-200 hover:border-slate-300 py-1.5 px-3"
                data-testid="detail-alterar-etapa-button"
              >
                <Kanban className="h-3.5 w-3.5 text-[#449bd5]" />
                <span>Alterar etapa</span>
              </button>
              {currentStage?.code !== 'alumni' && (
                <button
                  type="button"
                  onClick={handlePromoteToAlumni}
                  disabled={isMovingAlumni}
                  title="Promover para Alumni"
                  className="btn-secondary text-xs text-[#08254f] border-slate-200 hover:border-slate-300 py-1.5 px-3"
                >
                  <Award className="h-3.5 w-3.5 text-amber-500" />
                  <span>{isMovingAlumni ? 'Movendo...' : 'Mover para Alumni'}</span>
                </button>
              )}
              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                  <span>Editar Contato</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveContact}
                  className="btn-crimson text-xs py-1.5 px-3"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Salvar Alterações</span>
                </button>
              )}
            </div>
          </div>

          {/* Secondary Header Row: Contact Info & Referred By */}
          <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-xs text-slate-600 pt-2 border-t border-slate-100">
            {/* Phone */}
            {phoneDisplay ? (
              <a
                href={`tel:${phoneDisplay.replace(/\D/g, '')}`}
                className="inline-flex w-fit items-center gap-1.5 font-medium py-1 px-1.5 -ml-1.5 rounded-md hover:text-[#08254f] hover:bg-slate-50 transition-colors cursor-pointer"
                title={`Ligar para ${phoneDisplay}`}
              >
                <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>{phoneDisplay}</span>
              </a>
            ) : (
              <div className="inline-flex w-fit items-center gap-1.5 font-medium text-slate-400 italic">
                <Phone className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                <span>Telefone não informado</span>
              </div>
            )}

            {/* Email */}
            {emailDisplay ? (
              <button
                type="button"
                onClick={() => setIsEmailComposerOpen(true)}
                className="inline-flex w-fit items-center gap-1.5 font-medium py-1 px-1.5 -ml-1.5 rounded-md hover:text-[#08254f] hover:bg-slate-50 transition-colors cursor-pointer text-left"
                title={`Enviar e-mail para ${emailDisplay}`}
              >
                <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>{emailDisplay}</span>
              </button>
            ) : (
              <div className="inline-flex w-fit items-center gap-1.5 font-medium text-slate-400 italic">
                <Mail className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                <span>Email não informado</span>
              </div>
            )}

            {/* Contact Preference Badge */}
            <div className="inline-flex items-center">
              <span
                data-testid="lead-detail-contact-preference"
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md border select-none ${
                  getContactPreferenceBadgeClasses(lead.contact_preference).badge
                }`}
              >
                {formatContactPreferenceLabel(lead.contact_preference)}
              </span>
            </div>

            {/* Referred By (rendered only if present) */}
            {lead.referred_by && (
              <div className="flex items-center gap-1.5 font-medium text-slate-700 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200/80">
                <Share2 className="h-3.5 w-3.5 text-[#449bd5] shrink-0" />
                <span>
                  Quem indicou: <strong className="font-semibold text-[#08254f]">{lead.referred_by}</strong>
                </span>
              </div>
            )}
          </div>

          {/* 3. Course Interests (Up to 3 Prioritized Interests) */}
          <div className="pt-2 border-t border-slate-100/80">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <GraduationCap className="h-3.5 w-3.5 text-[#449bd5]" />
                Cursos de Interesse:
              </span>

              {courseInterests.length > 0 ? (
                courseInterests.map((interest, idx) => {
                  const dateLabel = formatSessionMonthYear(interest.startDate);
                  const label = dateLabel ? `${interest.courseName} • ${dateLabel}` : interest.courseName;

                  return (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-slate-50 text-slate-800 border border-slate-200/80 rounded-lg shadow-2xs"
                      title={label}
                    >
                      <GraduationCap className="h-3 w-3 text-[#449bd5] shrink-0" />
                      <span>{label}</span>
                      {interest.priority && (
                        <span className="text-[10px] font-bold text-slate-400">
                          #{interest.priority}
                        </span>
                      )}
                    </span>
                  );
                })
              ) : lead.course_interest ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-slate-50 text-slate-800 border border-slate-200/80 rounded-lg">
                  <GraduationCap className="h-3 w-3 text-[#449bd5] shrink-0" />
                  <span>{lead.course_interest}</span>
                </span>
              ) : (
                <span className="text-xs text-slate-400 italic">
                  Sem curso de interesse
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Action Bar — One-Touch Operational Actions */}
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
          onActivityLogged={loadLeadData}
        />

        {/* Recent Conversation Status Widget */}
        <LeadConversationStatus leadId={lead.id} />

        {/* Edit Lead Details Inline Panel (when editing is active) */}
        {isEditing && (
          <div className="card-executive p-5 space-y-4 border-2 border-[#449bd5]/40 bg-blue-50/20">
            <h3 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-[#449bd5]" />
              Editar Informações de Contato
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nome</label>
                <input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Sobrenome</label>
                <input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Telefone</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Quem indicou?</label>
                <input
                  type="text"
                  value={editReferredBy}
                  onChange={(e) => setEditReferredBy(e.target.value)}
                  placeholder="Ex: Dr. Roberto"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Curso de Interesse (Legado)</label>
                <input
                  type="text"
                  value={editCourseInterest}
                  onChange={(e) => setEditCourseInterest(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="btn-secondary text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveContact}
                className="btn-crimson text-xs"
              >
                Salvar
              </button>
            </div>
          </div>
        )}

        {/* 2-Column Operational Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Primary Column (Left 2 cols): Tasks, Timeline, Notes */}
          <div className="lg:col-span-2 space-y-6">
            {/* 1. Tasks Section */}
            <LeadTaskList
              tasks={tasks}
              highlightedTaskId={highlightedTaskId}
              onOpenCreateTask={() => {
                setTaskModalMode('generic');
                setIsTaskModalOpen(true);
              }}
              onTaskUpdated={loadLeadData}
            />

            {/* 2. Operational Activity Timeline */}
            <LeadTimeline activities={activities} />

            {/* 3. Conversations Thread */}
            <LeadConversationsCard
              lead={lead}
              onLeadUpdated={loadLeadData}
              onOpenComposer={() => setIsEmailComposerOpen(true)}
            />

            {/* 3. Notes Section */}
            <div className="card-executive p-5 space-y-4">
              <h2 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#449bd5]" />
                Notas Internas ({notes.length})
              </h2>

              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  rows={2}
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Adicionar nota interna ou resumo de conversa..."
                  className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isAddingNote || !newNoteContent.trim()}
                    className="btn-crimson text-xs disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Salvar Nota</span>
                  </button>
                </div>
              </form>

              <div className="space-y-2.5 pt-1">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3 bg-slate-50/70 border border-slate-100 rounded-xl space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{new Date(note.created_at).toLocaleString()}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                        title="Excluir nota"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {note.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Secondary Column (Right 1 col): HubSpot, Enrollment, Tags */}
          <div className="space-y-6">
            {/* HubSpot Integration Card — Reused for Coexistence Visibility */}
            <LeadHubSpotCard
              leadId={lead.id}
              hubspotContactId={lead.hubspot_contact_id}
              onLeadUpdated={loadLeadData}
            />

            {/* Lead Enrollment Card (Phase 4 Block 3) */}
            <LeadEnrollmentCard
              leadId={lead.id}
              leadSource={lead.source}
              onEnrollmentChanged={loadLeadData}
            />

            {/* Tags Management Card */}
            <div className="card-executive p-5 space-y-3">
              <h2 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider flex items-center gap-2">
                <TagIcon className="h-4 w-4 text-[#449bd5]" />
                Tags ({leadTags.length})
              </h2>

              <div className="flex flex-wrap gap-1.5">
                {leadTags.length > 0 ? (
                  leadTags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium bg-[#449bd5]/10 text-[#08254f] border border-[#449bd5]/20 rounded-md"
                    >
                      #{t.name}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t.id)}
                        className="hover:text-red-600 transition-colors"
                        title="Remover tag"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 italic">Nenhuma tag vinculada.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-1 pt-2 border-t border-slate-100 items-center">
                {allTags
                  .filter((t) => !leadTags.some((lt) => lt.id === t.id))
                  .slice(0, 4)
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleAttachTag(t.id)}
                      className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                      + {t.name}
                    </button>
                  ))}

                <div className="flex items-center gap-1 ml-auto pt-1 w-full sm:w-auto">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Nova tag..."
                    className="px-2 py-1 text-xs border border-slate-200 rounded-lg w-28 focus:outline-none focus:ring-1 focus:ring-[#449bd5]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateAndAttachTag}
                    className="btn-crimson px-2 py-1 text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Simplified Task Modal (Generic Task & Payment Reminder) */}
      <LeadTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onTaskCreated={loadLeadData}
        leadId={lead.id}
        leadName={fullName}
        mode={taskModalMode}
      />

      {/* Reschedule Task Modal (when needed) */}
      {reschedulingTask && (
        <RescheduleTaskModal
          isOpen={Boolean(reschedulingTask)}
          onClose={() => setReschedulingTask(null)}
          onRescheduled={loadLeadData}
          taskId={reschedulingTask.id}
          taskTitle={reschedulingTask.title}
          currentDueAt={reschedulingTask.due_at}
        />
      )}

      {/* Manual Email Composer Modal (Standalone Lead View) */}
      {lead && (
        <ManualEmailComposerModal
          isOpen={isEmailComposerOpen}
          lead={lead}
          onClose={() => setIsEmailComposerOpen(false)}
          onEmailSent={loadLeadData}
        />
      )}

      {/* Change Lead Stage Modal */}
      {isStageModalOpen && lead && (
        <ChangeLeadStageModal
          isOpen={isStageModalOpen}
          onClose={() => setIsStageModalOpen(false)}
          leadId={lead.id}
          leadName={fullName}
          currentStageId={lead.pipeline_stage_id}
          currentStageName={currentStage?.name}
          onStageUpdated={loadLeadData}
        />
      )}
    </Layout>
  );
}
