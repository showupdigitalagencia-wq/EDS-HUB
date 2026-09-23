import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import {
  ArrowLeft,
  Save,
  Rocket,
  Play,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Zap,
  Filter,
  Clock,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type {
  Automation,
  AutomationVersion,
  AutomationStep,
  AutomationTriggerType,
  AutomationActionType,
  ConditionField,
  ConditionOperator,
  PipelineStage,
  Tag as TagType,
  Form,
} from '../../types/database';
import { TestAutomationModal } from './TestAutomationModal';

export function AutomationBuilderPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [automation, setAutomation] = useState<Partial<Automation>>({
    name: 'New Automation',
    description: '',
    trigger_type: 'form_submitted',
    trigger_config: {},
    status: 'draft',
    current_version: 1,
  });

  const [currentVersion, setCurrentVersion] = useState<Partial<AutomationVersion> | null>(null);
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Reference data
  const [forms, setForms] = useState<Form[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);

  useEffect(() => {
    loadReferences();
    if (!isNew && id) {
      loadAutomation(id);
    } else {
      // Default initial steps for new automation
      setSteps([
        {
          id: 'temp-1',
          automation_version_id: '',
          step_order: 1,
          step_type: 'condition',
          action_type: null,
          config: {
            field: 'course_interest',
            operator: 'equals',
            value: 'Intensive',
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'temp-2',
          automation_version_id: '',
          step_order: 2,
          step_type: 'action',
          action_type: 'send_email',
          config: {
            subject: 'Welcome to Expert Dental Solutions, {{first_name}}',
            body: '<p>Hello {{salutation}}, thank you for your interest in our intensive course!</p>',
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    }
  }, [id, isNew]);

  const loadReferences = async () => {
    try {
      const [formsRes, stagesRes, tagsRes] = await Promise.all([
        supabase.from('forms').select('*').order('name'),
        supabase.from('pipeline_stages').select('*').order('sort_order'),
        supabase.from('tags').select('*').order('name'),
      ]);

      if (formsRes.data) setForms(formsRes.data);
      if (stagesRes.data) setPipelineStages(stagesRes.data);
      if (tagsRes.data) setTags(tagsRes.data);
    } catch (err) {
      console.error('Error loading builder references:', err);
    }
  };

  const loadAutomation = async (autoId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch automation
      const { data: auto, error: autoErr } = await supabase
        .from('automations')
        .select('*')
        .eq('id', autoId)
        .single();

      if (autoErr) throw autoErr;
      setAutomation(auto);

      // 2. Fetch latest version (draft or published)
      const { data: versions, error: verErr } = await supabase
        .from('automation_versions')
        .select('*')
        .eq('automation_id', autoId)
        .order('version', { ascending: false });

      if (verErr) throw verErr;

      const latestVersion = versions?.[0];
      setCurrentVersion(latestVersion || null);

      if (latestVersion) {
        // 3. Fetch steps
        const { data: stepRows, error: stepErr } = await supabase
          .from('automation_steps')
          .select('*')
          .eq('automation_version_id', latestVersion.id)
          .order('step_order', { ascending: true });

        if (stepErr) throw stepErr;
        setSteps(stepRows || []);
      }
    } catch (err) {
      console.error('Failed to load automation:', err);
      setError(err instanceof Error ? err.message : 'Failed to load automation');
    } finally {
      setIsLoading(false);
    }
  };

  // Add Step
  const handleAddStep = (type: 'condition' | 'action' | 'wait') => {
    const nextOrder = steps.length + 1;
    let newStep: AutomationStep;

    if (type === 'condition') {
      newStep = {
        id: `temp-${Date.now()}`,
        automation_version_id: currentVersion?.id || '',
        step_order: nextOrder,
        step_type: 'condition',
        action_type: null,
        config: {
          field: 'course_interest',
          operator: 'equals',
          value: '',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else if (type === 'wait') {
      newStep = {
        id: `temp-${Date.now()}`,
        automation_version_id: currentVersion?.id || '',
        step_order: nextOrder,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 1,
          duration_unit: 'days',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      newStep = {
        id: `temp-${Date.now()}`,
        automation_version_id: currentVersion?.id || '',
        step_order: nextOrder,
        step_type: 'action',
        action_type: 'send_email',
        config: {
          subject: 'Update from Expert Dental Solutions',
          body: '<p>Hello {{salutation}},</p>',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    setSteps([...steps, newStep]);
  };

  // Remove Step
  const handleRemoveStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index).map((s, idx) => ({
      ...s,
      step_order: idx + 1,
    }));
    setSteps(updated);
  };

  // Move Step Up
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...steps];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    setSteps(updated.map((s, idx) => ({ ...s, step_order: idx + 1 })));
  };

  // Move Step Down
  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const updated = [...steps];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    setSteps(updated.map((s, idx) => ({ ...s, step_order: idx + 1 })));
  };

  // Update Step Config
  const handleUpdateStep = (index: number, updates: Partial<AutomationStep>) => {
    const updated = [...steps];
    updated[index] = {
      ...updated[index],
      ...updates,
      config: {
        ...updated[index].config,
        ...(updates.config || {}),
      },
    };
    setSteps(updated);
  };

  // Save Draft (With Versioning Isolation)
  const handleSaveDraft = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      let targetAutoId = id;

      // 1. Create or update parent automation
      if (isNew) {
        const { data: newAuto, error: createErr } = await supabase
          .from('automations')
          .insert({
            name: automation.name || 'Untitled Automation',
            description: automation.description || null,
            trigger_type: automation.trigger_type || 'form_submitted',
            trigger_config: automation.trigger_config || {},
            status: 'draft',
            current_version: 1,
          })
          .select()
          .single();

        if (createErr) throw createErr;
        targetAutoId = newAuto.id;
        setAutomation(newAuto);
      } else {
        await supabase
          .from('automations')
          .update({
            name: automation.name,
            description: automation.description,
            trigger_type: automation.trigger_type,
            trigger_config: automation.trigger_config,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetAutoId!);
      }

      // 2. Versioning: If automation is active, or if no draft version exists, clone into a new draft version
      let targetVersionId = currentVersion?.id;
      let targetVersionNum = currentVersion?.version || 1;

      if (isNew || !currentVersion) {
        const { data: newVer, error: verErr } = await supabase
          .from('automation_versions')
          .insert({
            automation_id: targetAutoId!,
            version: 1,
            status: 'draft',
            definition: { trigger: automation.trigger_type, steps },
          })
          .select()
          .single();

        if (verErr) throw verErr;
        targetVersionId = newVer.id;
        targetVersionNum = 1;
        setCurrentVersion(newVer);
      } else if (currentVersion.status === 'published') {
        // Active version is frozen! Create a new draft version
        const nextVerNum = (currentVersion.version || 1) + 1;
        const { data: newVer, error: verErr } = await supabase
          .from('automation_versions')
          .insert({
            automation_id: targetAutoId!,
            version: nextVerNum,
            status: 'draft',
            definition: { trigger: automation.trigger_type, steps },
          })
          .select()
          .single();

        if (verErr) throw verErr;
        targetVersionId = newVer.id;
        targetVersionNum = nextVerNum;
        setCurrentVersion(newVer);
      } else {
        // Update existing draft version definition
        await supabase
          .from('automation_versions')
          .update({
            definition: { trigger: automation.trigger_type, steps },
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetVersionId!);
      }

      // 3. Sync normalized steps in automation_steps
      // Delete existing steps for this draft version
      await supabase
        .from('automation_steps')
        .delete()
        .eq('automation_version_id', targetVersionId!);

      // Insert new steps
      const stepsToInsert = steps.map((s, idx) => ({
        automation_version_id: targetVersionId!,
        step_order: idx + 1,
        step_type: s.step_type,
        action_type: s.action_type,
        config: s.config,
      }));

      if (stepsToInsert.length > 0) {
        const { error: insertStepsErr } = await supabase
          .from('automation_steps')
          .insert(stepsToInsert);

        if (insertStepsErr) throw insertStepsErr;
      }

      setSuccessMessage(`Draft saved successfully (Version ${targetVersionNum})`);

      if (isNew) {
        navigate(`/automations/${targetAutoId}`);
      }
    } catch (err) {
      console.error('Failed to save draft:', err);
      setError(err instanceof Error ? err.message : 'Failed to save automation');
    } finally {
      setIsSaving(false);
    }
  };

  // Publish / Activate Version
  const handlePublish = async () => {
    if (steps.length === 0) {
      setError('Cannot publish an automation with zero steps.');
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      // First ensure draft is saved
      await handleSaveDraft();

      // Call secure RPC publish_automation_version
      const autoId = id || automation.id;
      const { data, error: rpcErr } = await supabase.rpc('publish_automation_version', {
        p_automation_id: autoId,
      });

      if (rpcErr) throw rpcErr;
      if (!data?.success) throw new Error(data?.error || 'Failed to publish automation');

      setSuccessMessage(`Automation published & activated! (Version ${data.version})`);
      setAutomation((prev) => ({ ...prev, status: 'active', current_version: data.version }));
      if (currentVersion) {
        setCurrentVersion((prev) => (prev ? { ...prev, status: 'published' } : null));
      }
    } catch (err) {
      console.error('Failed to publish automation:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish automation');
    } finally {
      setIsPublishing(false);
    }
  };

  if (isLoading) {
    return (
      <Layout backTo="/automations" eyebrow="MOTORES & FLUXOS" title="Construtor de Automações">
        <div className="p-8 text-center text-sm text-slate-500">Carregando automação...</div>
      </Layout>
    );
  }

  return (
    <Layout
      backTo="/automations"
      eyebrow="MOTORES & FLUXOS"
      title={automation.name || 'Nova Automação'}
      subtitle="Fluxos de automação orientados a eventos (QUANDO → SE → ENTÃO)"
    >
      <div className="max-w-4xl mx-auto space-y-6 pb-20">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/automations')}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={automation.name || ''}
                  onChange={(e) => setAutomation({ ...automation, name: e.target.value })}
                  placeholder="Automation Name"
                  className="text-xl font-bold font-heading text-[#08254f] border-b border-transparent hover:border-slate-300 focus:border-[#449bd5] focus:outline-none px-1 py-0.5"
                />
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded-md uppercase tracking-wider ${
                    automation.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {automation.status}
                </span>
                {currentVersion && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-[#449bd5]/10 text-[#08254f] border border-[#449bd5]/20">
                    v{currentVersion.version} ({currentVersion.status})
                  </span>
                )}
              </div>
              <input
                type="text"
                value={automation.description || ''}
                onChange={(e) => setAutomation({ ...automation, description: e.target.value })}
                placeholder="Add a short description..."
                className="text-xs text-slate-500 border-b border-transparent hover:border-slate-200 focus:border-[#449bd5] focus:outline-none w-full px-1 mt-0.5"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTestModalOpen(true)}
              className="btn-secondary text-xs"
            >
              <Play className="h-3.5 w-3.5 text-amber-600" />
              Test Mode
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={isSaving}
              className="btn-secondary text-xs disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="btn-crimson text-xs disabled:opacity-50"
            >
              <Rocket className="h-3.5 w-3.5" />
              {isPublishing ? 'Publishing...' : 'Publish / Activate'}
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Builder Flow Canvas */}
        <div className="space-y-4">
          {/* 1. WHEN TRIGGER BLOCK */}
          <div className="card-executive border-l-4 border-l-[#08254f] p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#08254f]/10 text-[#08254f] flex items-center justify-center font-bold text-xs">
                  <Zap className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#08254f] font-heading">
                  WHEN (Trigger)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trigger Event
                </label>
                <select
                  value={automation.trigger_type}
                  onChange={(e) =>
                    setAutomation({
                      ...automation,
                      trigger_type: e.target.value as AutomationTriggerType,
                    })
                  }
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  <option value="form_submitted">Form Submitted</option>
                  <option value="lead_created">Lead Created</option>
                  <option value="qualification_status_changed">Qualification Status Changed</option>
                  <option value="pipeline_stage_changed">Pipeline Stage Changed</option>
                  <option value="tag_added">Tag Added</option>
                </select>
              </div>

              {/* Contextual Filter Settings */}
              {automation.trigger_type === 'form_submitted' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Specific Form (Optional)
                  </label>
                  <select
                    value={(automation.trigger_config as { form_id?: string })?.form_id || ''}
                    onChange={(e) =>
                      setAutomation({
                        ...automation,
                        trigger_config: {
                          ...automation.trigger_config,
                          form_id: e.target.value || undefined,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  >
                    <option value="">Any Form</option>
                    {forms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {automation.trigger_type === 'pipeline_stage_changed' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    To Stage (Optional)
                  </label>
                  <select
                    value={(automation.trigger_config as { to_stage_id?: string })?.to_stage_id || ''}
                    onChange={(e) =>
                      setAutomation({
                        ...automation,
                        trigger_config: {
                          ...automation.trigger_config,
                          to_stage_id: e.target.value || undefined,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  >
                    <option value="">Any Stage</option>
                    {pipelineStages.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {automation.trigger_type === 'qualification_status_changed' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    To Status (Optional)
                  </label>
                  <select
                    value={(automation.trigger_config as { to_status?: string })?.to_status || ''}
                    onChange={(e) =>
                      setAutomation({
                        ...automation,
                        trigger_config: {
                          ...automation.trigger_config,
                          to_status: e.target.value || undefined,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  >
                    <option value="">Any Status</option>
                    <option value="no_response">No Response</option>
                    <option value="some_response">Some Response</option>
                    <option value="interested">Interested</option>
                    <option value="hot">Hot</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                </div>
              )}

              {automation.trigger_type === 'tag_added' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Specific Tag (Optional)
                  </label>
                  <select
                    value={(automation.trigger_config as { tag_id?: string })?.tag_id || ''}
                    onChange={(e) =>
                      setAutomation({
                        ...automation,
                        trigger_config: {
                          ...automation.trigger_config,
                          tag_id: e.target.value || undefined,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  >
                    <option value="">Any Tag</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Connectors & Ordered Steps */}
          {steps.map((step, idx) => {
            const isCondition = step.step_type === 'condition';
            const isWait = step.step_type === 'wait';
            const isAction = step.step_type === 'action';

            return (
              <div key={step.id || idx} className="space-y-3">
                {/* Connector Line with Down Arrow */}
                <div className="flex justify-center">
                  <div className="w-0.5 h-6 bg-slate-200 relative flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                  </div>
                </div>

                {/* Step Card */}
                <div
                  className={`card-executive p-5 border-l-4 transition-all ${
                    isCondition
                      ? 'border-l-[#449bd5] bg-[#449bd5]/5'
                      : isWait
                      ? 'border-l-amber-500 bg-amber-50/20'
                      : 'border-l-emerald-600 bg-emerald-50/20'
                  }`}
                >
                  {/* Step Card Header */}
                  <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[10px] font-bold font-mono">
                        {step.step_order}
                      </span>
                      {isCondition && (
                        <span className="text-xs font-bold uppercase tracking-wider text-[#449bd5] font-heading flex items-center gap-1.5">
                          <Filter className="h-3.5 w-3.5" /> IF (Condition)
                        </span>
                      )}
                      {isWait && (
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 font-heading flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> WAIT (Delay)
                        </span>
                      )}
                      {isAction && (
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 font-heading flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5" /> THEN (Action)
                        </span>
                      )}
                    </div>

                    {/* Step Controls */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveUp(idx)}
                        disabled={idx === 0}
                        className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded hover:bg-slate-100"
                        title="Move step up"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleMoveDown(idx)}
                        disabled={idx === steps.length - 1}
                        className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded hover:bg-slate-100"
                        title="Move step down"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveStep(idx)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                        title="Delete step"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Step Body */}
                  {isCondition && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">
                          Property
                        </label>
                        <select
                          value={step.config?.field || 'course_interest'}
                          onChange={(e) =>
                            handleUpdateStep(idx, {
                              config: { field: e.target.value as ConditionField },
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                        >
                          <option value="course_interest">Course Interest</option>
                          <option value="contact_preference">Contact Preference</option>
                          <option value="qualification_status">Qualification Status</option>
                          <option value="pipeline_stage">Pipeline Stage</option>
                          <option value="source">Source</option>
                          <option value="source_detail">Source Detail</option>
                          <option value="tag">Tag</option>
                          <option value="email exists">Email Exists</option>
                          <option value="phone exists">Phone Exists</option>
                          <option value="form_id">Form ID</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">
                          Operator
                        </label>
                        <select
                          value={step.config?.operator || 'equals'}
                          onChange={(e) =>
                            handleUpdateStep(idx, {
                              config: { operator: e.target.value as ConditionOperator },
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                        >
                          <option value="equals">equals</option>
                          <option value="not_equals">not equals</option>
                          <option value="contains">contains</option>
                          <option value="exists">exists</option>
                          <option value="not_exists">not exists</option>
                          <option value="in">in (comma separated)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">
                          Value
                        </label>
                        <input
                          type="text"
                          value={step.config?.value || ''}
                          onChange={(e) =>
                            handleUpdateStep(idx, { config: { value: e.target.value } })
                          }
                          placeholder="e.g. Intensive"
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                        />
                      </div>
                    </div>
                  )}

                  {isWait && (
                    <div className="grid grid-cols-2 gap-3 max-w-sm">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">
                          Duration
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={step.config?.duration_value ?? 1}
                          onChange={(e) =>
                            handleUpdateStep(idx, {
                              config: { duration_value: parseInt(e.target.value, 10) || 1 },
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">
                          Unit
                        </label>
                        <select
                          value={step.config?.duration_unit || 'days'}
                          onChange={(e) =>
                            handleUpdateStep(idx, {
                              config: {
                                duration_unit: e.target.value as 'minutes' | 'hours' | 'days',
                              },
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        >
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                          <option value="minutes">Minutes</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {isAction && (
                    <div className="space-y-3">
                      <div className="max-w-sm">
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">
                          Action Type
                        </label>
                        <select
                          value={step.action_type || 'send_email'}
                          onChange={(e) =>
                            handleUpdateStep(idx, {
                              action_type: e.target.value as AutomationActionType,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                        >
                          <option value="send_email">Send Email (Resend)</option>
                          <option value="send_sms">Send SMS (Twilio)</option>
                          <option value="create_call_task">Create Call Task</option>
                          <option value="create_task">Create Internal Task</option>
                          <option value="add_tag">Add Tag</option>
                          <option value="remove_tag">Remove Tag</option>
                          <option value="move_pipeline_stage">Move Pipeline Stage</option>
                          <option value="update_qualification_status">Update Qualification Status</option>
                          <option value="stop_automation">Stop Automation</option>
                        </select>
                      </div>

                      {/* Action contextual forms */}
                      {step.action_type === 'send_email' && (
                        <div className="space-y-2 pt-1">
                          <div>
                            <label className="block text-[11px] font-medium text-gray-600 mb-1">
                              Subject
                            </label>
                            <input
                              type="text"
                              value={step.config?.subject || ''}
                              onChange={(e) =>
                                handleUpdateStep(idx, { config: { subject: e.target.value } })
                              }
                              placeholder="e.g. Welcome {{first_name}}"
                              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-gray-600 mb-1">
                              Email Body (HTML / Text)
                            </label>
                            <textarea
                              rows={3}
                              value={step.config?.body || ''}
                              onChange={(e) =>
                                handleUpdateStep(idx, { config: { body: e.target.value } })
                              }
                              placeholder="Hello {{salutation}}, thank you for connecting..."
                              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white font-mono"
                            />
                            <span className="text-[10px] text-gray-400">
                              Supported variables: <code>{'{{salutation}}'}</code>, <code>{'{{first_name}}'}</code>
                            </span>
                          </div>
                        </div>
                      )}

                      {step.action_type === 'send_sms' && (
                        <div className="pt-1">
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">
                            SMS Message Text
                          </label>
                          <textarea
                            rows={2}
                            value={step.config?.message || ''}
                            onChange={(e) =>
                              handleUpdateStep(idx, { config: { message: e.target.value } })
                            }
                            placeholder="Hello {{salutation}}, this is Expert Dental Solutions..."
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                          />
                        </div>
                      )}

                      {(step.action_type === 'create_call_task' || step.action_type === 'create_task') && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="block text-[11px] font-medium text-gray-600 mb-1">
                              Task Title
                            </label>
                            <input
                              type="text"
                              value={step.config?.title || ''}
                              onChange={(e) =>
                                handleUpdateStep(idx, { config: { title: e.target.value } })
                              }
                              placeholder="e.g. Follow up on course inquiry"
                              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-gray-600 mb-1">
                              Description
                            </label>
                            <input
                              type="text"
                              value={step.config?.description || ''}
                              onChange={(e) =>
                                handleUpdateStep(idx, { config: { description: e.target.value } })
                              }
                              placeholder="Task instructions..."
                              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                            />
                          </div>
                        </div>
                      )}

                      {(step.action_type === 'add_tag' || step.action_type === 'remove_tag') && (
                        <div className="max-w-xs pt-1">
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">
                            Select Tag
                          </label>
                          <select
                            value={step.config?.tag_id || ''}
                            onChange={(e) =>
                              handleUpdateStep(idx, { config: { tag_id: e.target.value } })
                            }
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                          >
                            <option value="">Select a Tag</option>
                            {tags.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {step.action_type === 'move_pipeline_stage' && (
                        <div className="max-w-xs pt-1">
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">
                            Destination Stage
                          </label>
                          <select
                            value={step.config?.pipeline_stage_id || ''}
                            onChange={(e) =>
                              handleUpdateStep(idx, { config: { pipeline_stage_id: e.target.value } })
                            }
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                          >
                            <option value="">Select Destination Stage</option>
                            {pipelineStages.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {step.action_type === 'update_qualification_status' && (
                        <div className="max-w-xs pt-1">
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">
                            Qualification Status
                          </label>
                          <select
                            value={step.config?.qualification_status || 'interested'}
                            onChange={(e) =>
                              handleUpdateStep(idx, {
                                config: { qualification_status: e.target.value as any },
                              })
                            }
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                          >
                            <option value="no_response">No Response</option>
                            <option value="some_response">Some Response</option>
                            <option value="interested">Interested</option>
                            <option value="hot">Hot</option>
                            <option value="confirmed">Confirmed</option>
                          </select>
                        </div>
                      )}

                      {step.action_type === 'stop_automation' && (
                        <div className="pt-1">
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">
                            Stop Reason
                          </label>
                          <input
                            type="text"
                            value={step.config?.stop_reason || ''}
                            onChange={(e) =>
                              handleUpdateStep(idx, { config: { stop_reason: e.target.value } })
                            }
                            placeholder="e.g. Lead reached target conversion"
                            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add Step Action Bar */}
          <div className="flex justify-center pt-4">
            <div className="inline-flex items-center gap-2 p-1.5 bg-gray-50 border border-gray-200 rounded-2xl shadow-xs">
              <span className="text-xs font-semibold text-gray-500 px-3">Add Step:</span>
              <button
                onClick={() => handleAddStep('condition')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                IF Condition
              </button>
              <button
                onClick={() => handleAddStep('action')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                THEN Action
              </button>
              <button
                onClick={() => handleAddStep('wait')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                WAIT Delay
              </button>
            </div>
          </div>
        </div>

        {/* Dry Run Test Simulation Modal */}
        <TestAutomationModal
          isOpen={isTestModalOpen}
          onClose={() => setIsTestModalOpen(false)}
          automationName={automation.name || 'Automation'}
          steps={steps}
        />
      </div>
    </Layout>
  );
}
