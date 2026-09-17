import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { Lead, PipelineStage, Tag, LeadNote, Task, LeadActivity, ContactPreference, QualificationStatus } from '../../types';
import { getQualificationStatusBadge, getQualificationStatusLabel } from './utils/qualificationMapping';
import { LeadAutomationHistory } from './LeadAutomationHistory';
import {
  ArrowLeft,
  Mail,
  Phone,
  Tag as TagIcon,
  FileText,
  CheckCircle2,
  Clock,
  Edit2,
  Save,
  Trash2,
  Plus,
  Activity,
  User,
} from 'lucide-react';

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leadTags, setLeadTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Lead Info state
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPref, setEditPref] = useState<ContactPreference>('email');
  const [editQualStatus, setEditQualStatus] = useState<QualificationStatus | ''>('');
  const [editCourseInterest, setEditCourseInterest] = useState('');

  // New Note state
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  // New Tag state
  const [newTagName, setNewTagName] = useState('');

  const loadLeadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);

    try {
      const [leadRes, stagesRes, allTagsRes, notesRes, tasksRes, actRes] = await Promise.all([
        supabase.from('leads').select('*').eq('id', id).single(),
        supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
        supabase.from('tags').select('*').order('name', { ascending: true }),
        supabase.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
        supabase.from('tasks').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
        supabase.from('lead_activities').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      ]);

      if (leadRes.error || !leadRes.data) {
        throw new Error('Lead not found or inaccessible.');
      }

      const l = leadRes.data as Lead;
      setLead(l);
      setEditFirstName(l.first_name || '');
      setEditLastName(l.last_name || '');
      setEditEmail(l.email || '');
      setEditPhone(l.phone_raw || '');
      setEditPref(l.contact_preference);
      setEditQualStatus(l.qualification_status || '');
      setEditCourseInterest(l.course_interest || '');

      if (stagesRes.data) setStages(stagesRes.data);
      if (allTagsRes.data) setAllTags(allTagsRes.data);
      if (notesRes.data) setNotes(notesRes.data);
      if (tasksRes.data) setTasks(tasksRes.data);
      if (actRes.data) setActivities(actRes.data);

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
      setError(err instanceof Error ? err.message : 'Error loading lead');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadLeadData();
  }, [loadLeadData]);

  // Save updated contact fields
  const handleSaveContact = async () => {
    if (!lead) return;
    try {
      const newQualStatus = editQualStatus ? (editQualStatus as QualificationStatus) : null;
      const hasQualChanged = newQualStatus !== lead.qualification_status;

      const { error: updateErr } = await supabase
        .from('leads')
        .update({
          first_name: editFirstName.trim() || null,
          last_name: editLastName.trim() || null,
          email: editEmail.trim().toLowerCase() || null,
          phone_raw: editPhone.trim() || null,
          phone_e164: editPhone.trim().startsWith('+') ? editPhone.trim() : null,
          contact_preference: editPref,
          qualification_status: newQualStatus,
          course_interest: editCourseInterest.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      if (updateErr) throw updateErr;

      if (hasQualChanged) {
        await supabase.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'qualification_status_changed',
          actor_type: 'user',
          summary: `Qualification status updated to: ${getQualificationStatusLabel(newQualStatus)}`,
          metadata: {
            qualification_status: newQualStatus,
            previous_status: lead.qualification_status,
          },
        });
      }

      setIsEditing(false);
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update lead');
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
        summary: 'Note added to lead',
        metadata: { snippet: newNoteContent.trim().substring(0, 100) },
      });

      setNewNoteContent('');
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setIsAddingNote(false);
    }
  };

  // Delete Note
  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
      await supabase.from('lead_notes').delete().eq('id', noteId);
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete note');
    }
  };

  // Toggle Task Status
  const handleToggleTask = async (task: Task) => {
    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await supabase
        .from('tasks')
        .update({
          status: nextStatus,
          completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update task');
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
        summary: 'Tag added to lead',
        metadata: { tag_id: tagId },
      });
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to attach tag');
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
        summary: 'Tag removed from lead',
        metadata: { tag_id: tagId },
      });
      loadLeadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove tag');
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
      alert(err instanceof Error ? err.message : 'Failed to create tag');
    }
  };

  if (isLoading) {
    return (
      <Layout title="Lead Profile">
        <LoadingState message="Loading lead profile..." />
      </Layout>
    );
  }

  if (error || !lead) {
    return (
      <Layout title="Lead Profile">
        <ErrorState message={error || 'Lead not found'} onRetry={() => navigate('/leads')} />
      </Layout>
    );
  }

  const currentStage = stages.find((s) => s.id === lead.pipeline_stage_id);
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead';

  return (
    <Layout title={`Lead: ${fullName}`}>
      <div className="space-y-6">
        {/* Navigation Breadcrumb & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/leads"
              className="p-2 rounded-xl border border-gray-200 hover:bg-white text-gray-500 hover:text-gray-800 transition-colors shadow-xs"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{fullName}</h1>
                {currentStage && (
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-lg bg-brand-50 text-brand-700 border border-brand-200">
                    {currentStage.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Lead ID: <span className="font-mono text-gray-600">{lead.id}</span> • Source: <span className="capitalize font-medium text-gray-700">{lead.source}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl shadow-xs transition-colors"
              >
                <Edit2 className="h-4 w-4 text-gray-500" />
                Edit Lead
              </button>
            ) : (
              <button
                onClick={handleSaveContact}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
              >
                <Save className="h-4 w-4" />
                Save Changes
              </button>
            )}
          </div>
        </div>

        {/* 2-Column Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Contact Details, Tags, Notes, Tasks */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contact Information Card */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                <User className="h-4 w-4 text-brand-600" />
                Contact Details
              </h2>

              {!isEditing ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">First Name</span>
                    <span className="font-medium text-gray-800">{lead.first_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Last Name</span>
                    <span className="font-medium text-gray-800">{lead.last_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Email Address</span>
                    <span className="font-medium text-gray-800 flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-gray-400" />
                      {lead.email || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Phone</span>
                    <span className="font-medium text-gray-800 flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-gray-400" />
                      {lead.phone_raw || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Contact Preference</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md bg-gray-100 text-gray-700 capitalize">
                      {lead.contact_preference}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Qualification Status</span>
                    {lead.qualification_status ? (
                      (() => {
                        const badge = getQualificationStatusBadge(lead.qualification_status);
                        return (
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-md border ${badge.bg} ${badge.text} ${badge.border}`}
                          >
                            {badge.label}
                          </span>
                        );
                      })()
                    ) : (
                      <span className="text-xs text-gray-400 italic">None</span>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Course of Interest</span>
                    <span className="font-medium text-gray-800 text-xs">
                      {lead.course_interest || '—'}
                    </span>
                  </div>
                  {lead.hubspot_contact_id && (
                    <div>
                      <span className="text-xs text-gray-400 block mb-0.5">HubSpot Contact ID</span>
                      <span className="font-mono text-xs text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-200">
                        {lead.hubspot_contact_id}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-gray-400 block mb-0.5">Created Date</span>
                    <span className="text-gray-600 text-xs">
                      {new Date(lead.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">First Name</label>
                    <input
                      type="text"
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Last Name</label>
                    <input
                      type="text"
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Phone</label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Preference</label>
                    <select
                      value={editPref}
                      onChange={(e) => setEditPref(e.target.value as ContactPreference)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                    >
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                      <option value="call">Call</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Qualification Status</label>
                    <select
                      value={editQualStatus}
                      onChange={(e) => setEditQualStatus(e.target.value as QualificationStatus | '')}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                    >
                      <option value="">None</option>
                      <option value="no_response">No Response</option>
                      <option value="some_response">Some Response</option>
                      <option value="interested">Interested</option>
                      <option value="hot">Hot</option>
                      <option value="confirmed">Confirmed</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Course of Interest</label>
                    <input
                      type="text"
                      value={editCourseInterest}
                      onChange={(e) => setEditCourseInterest(e.target.value)}
                      placeholder="e.g. Intensive, Wisdom"
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tags Management Card */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                <TagIcon className="h-4 w-4 text-brand-600" />
                Tags & Segments
              </h2>

              <div className="flex flex-wrap gap-2 mb-4">
                {leadTags.length > 0 ? (
                  leadTags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200 rounded-lg"
                    >
                      #{t.name}
                      <button
                        onClick={() => handleRemoveTag(t.id)}
                        className="hover:text-red-600 transition-colors"
                        title="Remove tag"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic">No tags assigned to this lead.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100 items-center">
                <span className="text-xs font-medium text-gray-500">Attach existing:</span>
                {allTags
                  .filter((t) => !leadTags.some((lt) => lt.id === t.id))
                  .slice(0, 6)
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleAttachTag(t.id)}
                      className="px-2 py-0.5 text-xs rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                    >
                      + {t.name}
                    </button>
                  ))}

                <div className="flex items-center gap-1 ml-auto">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="New tag..."
                    className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    onClick={handleCreateAndAttachTag}
                    className="px-2.5 py-1 text-xs font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Lead Notes Card */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-4">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-4 w-4 text-brand-600" />
                Notes ({notes.length})
              </h2>

              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  rows={2}
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Add a confidential note or conversation summary..."
                  className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isAddingNote || !newNoteContent.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl disabled:opacity-50 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Save Note
                  </button>
                </div>
              </form>

              <div className="space-y-3 pt-2">
                {notes.map((note) => (
                  <div key={note.id} className="p-3.5 bg-gray-50 border border-gray-100 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{new Date(note.created_at).toLocaleString()}</span>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-800 whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Tasks Card */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-3">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-brand-600" />
                Follow-up Tasks ({tasks.length})
              </h2>

              {tasks.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No tasks assigned to this lead.</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => {
                    const isCompleted = task.status === 'completed';
                    return (
                      <div
                        key={task.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                          isCompleted ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleToggleTask(task)}
                            className={`p-1 rounded-lg border transition-colors ${
                              isCompleted
                                ? 'bg-emerald-500 text-white border-emerald-500'
                                : 'border-gray-300 text-transparent hover:border-brand-500'
                            }`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <div>
                            <p className={`text-xs font-semibold ${isCompleted ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-[11px] text-gray-500">{task.description}</p>
                            )}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] uppercase font-semibold rounded bg-gray-100 text-gray-600">
                          {task.task_type}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Automation History Card */}
            <LeadAutomationHistory leadId={lead.id} />
          </div>

          {/* Right Column: Complete Timeline (Append-Only Lead Activities) */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 sticky top-6">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-brand-600" />
                Audit Timeline ({activities.length})
              </h2>

              <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                {activities.map((act) => (
                  <div key={act.id} className="relative text-xs">
                    <div className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-white border-2 border-brand-500 flex items-center justify-center" />
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span className="font-semibold text-gray-700 capitalize">
                          {act.activity_type.replace(/_/g, ' ')}
                        </span>
                        <span>{new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-gray-600 leading-normal">{act.summary}</p>
                      <span className="text-[10px] text-gray-400">
                        {new Date(act.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
