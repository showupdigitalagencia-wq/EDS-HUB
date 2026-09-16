import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import type { PipelineStage, Tag, ContactPreference } from '../../../types';
import { X, UserPlus, AlertCircle, Loader2 } from 'lucide-react';

interface NewLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeadCreated: () => void;
}

export function NewLeadModal({ isOpen, onClose, onLeadCreated }: NewLeadModalProps) {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailConfirmation, setEmailConfirmation] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPreference, setContactPreference] = useState<ContactPreference>('email');
  const [pipelineStageId, setPipelineStageId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Load stages and tags
    async function loadData() {
      const [stagesRes, tagsRes] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
        supabase.from('tags').select('*').order('name', { ascending: true }),
      ]);

      if (stagesRes.data) {
        setStages(stagesRes.data);
        const capture = stagesRes.data.find((s) => s.code === 'capture') || stagesRes.data[0];
        if (capture) {
          setPipelineStageId(capture.id);
        }
      }
      if (tagsRes.data) {
        setAvailableTags(tagsRes.data);
      }
    }

    loadData();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    const name = newTagName.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Check if tag already exists in list
    const existing = availableTags.find((t) => t.slug === slug);
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) {
        setSelectedTagIds([...selectedTagIds, existing.id]);
      }
      setNewTagName('');
      return;
    }

    // Insert new tag
    const { data: newTag, error: tagErr } = await supabase
      .from('tags')
      .insert({ name, slug })
      .select()
      .single();

    if (!tagErr && newTag) {
      setAvailableTags([...availableTags, newTag]);
      setSelectedTagIds([...selectedTagIds, newTag.id]);
      setNewTagName('');
    }
  };

  const toggleTag = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      setSelectedTagIds(selectedTagIds.filter((id) => id !== tagId));
    } else {
      setSelectedTagIds([...selectedTagIds, tagId]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() && !lastName.trim() && !email.trim()) {
      setError('Please provide at least a name or an email for the lead.');
      return;
    }

    if (email.trim() && emailConfirmation.trim() && email.trim().toLowerCase() !== emailConfirmation.trim().toLowerCase()) {
      setError('Email and Email Confirmation do not match.');
      return;
    }

    if (!pipelineStageId) {
      setError('Please select a pipeline stage.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Insert lead (source = 'manual')
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          source: 'manual',
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          email: email.trim().toLowerCase() || null,
          email_confirmation: emailConfirmation.trim().toLowerCase() || null,
          phone_raw: phone.trim() || null,
          phone_e164: phone.trim().startsWith('+') ? phone.trim() : null,
          contact_preference: contactPreference,
          pipeline_stage_id: pipelineStageId,
        })
        .select()
        .single();

      if (leadErr) throw leadErr;
      if (!lead) throw new Error('Failed to create lead record.');

      // 2. Insert initial stage history
      await supabase.from('lead_stage_history').insert({
        lead_id: lead.id,
        from_stage_id: null,
        to_stage_id: pipelineStageId,
        change_reason: 'initial_assignment',
      });

      // 3. Insert activity audit log
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'lead_created',
        actor_type: 'user',
        summary: `Lead created manually (${[firstName, lastName].filter(Boolean).join(' ') || email})`,
        metadata: { source: 'manual' },
      });

      // 4. Attach tags
      if (selectedTagIds.length > 0) {
        const tagRows = selectedTagIds.map((tagId) => ({
          lead_id: lead.id,
          tag_id: tagId,
        }));
        await supabase.from('lead_tags').insert(tagRows);
      }

      onLeadCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto border border-gray-100">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-brand-50 text-brand-600">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Add New Lead</h2>
              <p className="text-xs text-gray-500">Register a lead manually into the CRM</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@example.com"
                className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Confirm Email</label>
              <input
                type="email"
                value={emailConfirmation}
                onChange={(e) => setEmailConfirmation(e.target.value)}
                placeholder="Repeat email"
                className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+15551234567"
                className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Contact Preference</label>
              <select
                value={contactPreference}
                onChange={(e) => setContactPreference(e.target.value as ContactPreference)}
                className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all bg-white"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="call">Phone Call</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Initial Pipeline Stage</label>
            <select
              value={pipelineStageId}
              onChange={(e) => setPipelineStageId(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all bg-white"
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name} ({stage.sort_order})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {availableTags.map((t) => {
                const isSelected = selectedTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium border transition-colors ${
                      isSelected
                        ? 'bg-brand-50 border-brand-300 text-brand-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {isSelected ? '✓ ' : '+ '}
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="New tag name..."
                className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
              >
                Add Tag
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Lead'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
