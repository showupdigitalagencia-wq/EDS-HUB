import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { supabase } from '../../lib/supabase';
import {
  ArrowLeft,
  Save,
  Play,
  Clock,
  Mail,
  MessageSquare,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ShieldAlert,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type {
  AutomationStep,
  AutomationTriggerType,
  AutomationActionType,
  SequenceStopCondition,
  QualificationStatus,
} from '../../types/database';
import { TestAutomationModal } from '../automations/TestAutomationModal';
import type { SequenceTemplate } from './sequence-templates';

export function SequenceBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const templateFromLocation = (location.state as { template?: SequenceTemplate })?.template;

  const isNew = !id;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('lead_created');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<'draft' | 'active' | 'paused' | 'archived'>('draft');
  const [currentVersion, setCurrentVersion] = useState(1);
  const [versionId, setVersionId] = useState<string | null>(null);

  // Stop conditions
  const [stopQualificationStatuses, setStopQualificationStatuses] = useState<QualificationStatus[]>([
    'some_response',
    'interested',
    'hot',
    'confirmed',
  ]);

  // Steps
  const [steps, setSteps] = useState<Partial<AutomationStep>[]>([]);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Initialize from template if creating new from template
  useEffect(() => {
    if (isNew && templateFromLocation) {
      setName(templateFromLocation.name);
      setDescription(templateFromLocation.description);
      setTriggerType(templateFromLocation.trigger_type);
      setTriggerConfig(templateFromLocation.trigger_config);

      const qualStop = templateFromLocation.stop_conditions.find((sc) => sc.type === 'qualification_status');
      if (qualStop && qualStop.values) {
        setStopQualificationStatuses(qualStop.values as QualificationStatus[]);
      }

      setSteps(
        templateFromLocation.steps.map((s) => ({
          step_order: s.step_order,
          step_type: s.step_type,
          action_type: s.action_type,
          config: s.config,
        }))
      );
    }
  }, [isNew, templateFromLocation]);

  // Load existing sequence if editing
  useEffect(() => {
    if (!id) return;

    const loadSequence = async () => {
      setIsLoading(true);
      try {
        const { data: auto, error: autoErr } = await supabase
          .from('automations')
          .select('*, automation_versions(*)')
          .eq('id', id)
          .single();

        if (autoErr) throw autoErr;
        if (!auto) throw new Error('Sequence not found');

        setName(auto.name);
        setDescription(auto.description || '');
        setTriggerType(auto.trigger_type);
        setTriggerConfig(auto.trigger_config || {});
        setStatus(auto.status);
        setCurrentVersion(auto.current_version);

        // Load stop conditions
        const qualStop = (auto.stop_conditions as SequenceStopCondition[] || []).find((sc) => sc.type === 'qualification_status');
        if (qualStop && qualStop.values) {
          setStopQualificationStatuses(qualStop.values as QualificationStatus[]);
        }

        // Load active or draft version steps
        const versions = auto.automation_versions || [];
        const draftOrPub = versions.find((v: { status: string }) => v.status === 'draft') || versions[0];

        if (draftOrPub) {
          setVersionId(draftOrPub.id);
          const { data: stepRows, error: stepErr } = await supabase
            .from('automation_steps')
            .select('*')
            .eq('automation_version_id', draftOrPub.id)
            .order('step_order', { ascending: true });

          if (stepErr) throw stepErr;
          setSteps(stepRows || []);
        }
      } catch (err: any) {
        console.error('Failed to load sequence:', err);
        setError(err.message || 'Failed to load sequence.');
      } finally {
        setIsLoading(false);
      }
    };

    loadSequence();
  }, [id]);

  const addStep = (stepType: 'action' | 'wait' | 'condition', actionType?: AutomationActionType) => {
    const nextOrder = steps.length + 1;
    let config: any = {};

    if (stepType === 'wait') {
      config = { duration_value: 1, duration_unit: 'days' };
    } else if (actionType === 'send_email') {
      config = { subject: 'Follow-up from Expert Dental Solutions', body: '<p>Hello {{salutation}},</p>' };
    } else if (actionType === 'send_sms') {
      config = { message: 'Hello {{salutation}}, this is Expert Dental Solutions following up.' };
    } else if (actionType === 'create_call_task') {
      config = { title: 'Call Lead: {{first_name}} {{last_name}}', task_type: 'call' };
    } else if (actionType === 'create_task') {
      config = { title: 'Follow-up Task: {{first_name}} {{last_name}}', task_type: 'general' };
    } else if (actionType === 'add_tag') {
      config = { tag_name: 'Followed-Up' };
    }

    const newStep: Partial<AutomationStep> = {
      step_order: nextOrder,
      step_type: stepType,
      action_type: actionType || null,
      config,
    };

    setSteps([...steps, newStep]);
    setSelectedStepIndex(steps.length);
  };

  const removeStep = (index: number) => {
    const updated = steps.filter((_, idx) => idx !== index).map((s, idx) => ({ ...s, step_order: idx + 1 }));
    setSteps(updated);
    setSelectedStepIndex(null);
  };

  const updateStepConfig = (key: string, value: any) => {
    if (selectedStepIndex === null) return;
    setSteps(
      steps.map((s, idx) =>
        idx === selectedStepIndex
          ? { ...s, config: { ...s.config, [key]: value } }
          : s
      )
    );
  };

  const toggleQualificationStop = (stat: QualificationStatus) => {
    if (stopQualificationStatuses.includes(stat)) {
      setStopQualificationStatuses(stopQualificationStatuses.filter((s) => s !== stat));
    } else {
      setStopQualificationStatuses([...stopQualificationStatuses, stat]);
    }
  };

  const handleSave = async (publishImmediately = false) => {
    if (!name.trim()) {
      setError('Please provide a sequence name.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    const stopConditions: SequenceStopCondition[] = [
      {
        type: 'qualification_status',
        operator: 'in',
        values: stopQualificationStatuses,
      },
    ];

    try {
      let targetSequenceId = id;
      let targetVersionId = versionId;

      if (isNew) {
        // 1. Create automation record
        const { data: newAuto, error: autoErr } = await supabase
          .from('automations')
          .insert({
            name,
            description,
            automation_type: 'sequence',
            trigger_type: triggerType,
            trigger_config: triggerConfig,
            status: 'draft',
            stop_conditions: stopConditions,
            current_version: 1,
          })
          .select('id')
          .single();

        if (autoErr) throw autoErr;
        targetSequenceId = newAuto.id;

        // 2. Create version record
        const { data: newVer, error: verErr } = await supabase
          .from('automation_versions')
          .insert({
            automation_id: targetSequenceId,
            version: 1,
            status: 'draft',
            stop_conditions: stopConditions,
            definition: { trigger: triggerType, steps_count: steps.length },
          })
          .select('id')
          .single();

        if (verErr) throw verErr;
        targetVersionId = newVer.id;
      } else {
        // Update existing automation
        await supabase
          .from('automations')
          .update({
            name,
            description,
            trigger_type: triggerType,
            trigger_config: triggerConfig,
            stop_conditions: stopConditions,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetSequenceId);

        // Check if current version is published; if so, create a new draft version
        const { data: curVer } = await supabase
          .from('automation_versions')
          .select('status, version')
          .eq('id', targetVersionId)
          .single();

        if (curVer?.status === 'published') {
          const nextVerNum = (curVer.version || 1) + 1;
          const { data: newDraft, error: draftErr } = await supabase
            .from('automation_versions')
            .insert({
              automation_id: targetSequenceId,
              version: nextVerNum,
              status: 'draft',
              stop_conditions: stopConditions,
              definition: { trigger: triggerType, steps_count: steps.length },
            })
            .select('id')
            .single();

          if (draftErr) throw draftErr;
          targetVersionId = newDraft.id;
          setVersionId(targetVersionId);
          setCurrentVersion(nextVerNum);
        }
      }

      // Save steps
      if (targetVersionId) {
        await supabase.from('automation_steps').delete().eq('automation_version_id', targetVersionId);

        const stepsToInsert = steps.map((s, idx) => ({
          automation_version_id: targetVersionId,
          step_order: idx + 1,
          step_type: s.step_type,
          action_type: s.action_type || null,
          config: s.config || {},
        }));

        if (stepsToInsert.length > 0) {
          const { error: stepsInsertErr } = await supabase
            .from('automation_steps')
            .insert(stepsToInsert);

          if (stepsInsertErr) throw stepsInsertErr;
        }
      }

      // Publish if requested
      if (publishImmediately && targetSequenceId) {
        const { data: pubRes, error: pubErr } = await supabase.rpc('publish_automation_version' as any, {
          p_automation_id: targetSequenceId,
        });

        if (pubErr) throw pubErr;
        const res = pubRes as { success: boolean; error?: string };
        if (!res.success) throw new Error(res.error || 'Failed to publish sequence');
        setStatus('active');
      }

      setSuccessMessage(publishImmediately ? 'Sequence published and activated!' : 'Draft saved successfully!');

      if (isNew && targetSequenceId) {
        navigate(`/sequences/${targetSequenceId}`, { replace: true });
      }
    } catch (err: any) {
      console.error('Failed to save sequence:', err);
      setError(err.message || 'Failed to save sequence.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Layout backTo="/sequences" eyebrow="MOTORES & CADÊNCIAS" title="Sequência de Cadência">
        <LoadingState message="Carregando definição da sequência..." />
      </Layout>
    );
  }

  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;

  return (
    <Layout
      backTo="/sequences"
      eyebrow="MOTORES & CADÊNCIAS"
      title={isNew ? 'Nova Sequência de Cadência' : name || 'Sequência de Cadência'}
      subtitle="WHEN (Gatilho) → STOP IF (Condições de parada) → THEN (Ações programadas de contato)"
    >
      <div className="space-y-6 max-w-6xl mx-auto pb-16">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/sequences')}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-white rounded-xl border border-slate-200/80 shadow-2xs transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold font-heading text-[#08254f] tracking-tight">
                  {isNew ? 'Create Follow-up Sequence' : name}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#08254f]/10 text-[#08254f] border border-[#08254f]/20">
                  v{currentVersion} • {status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                WHEN (Trigger) → STOP IF (Conditions) → THEN (Scheduled outreach actions)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTestModalOpen(true)}
              className="btn-secondary text-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#449bd5]" />
              Test Sequence
            </button>

            <button
              onClick={() => handleSave(false)}
              disabled={isSaving}
              className="btn-secondary text-xs disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 text-slate-400" />
              {isSaving ? 'Saving...' : 'Save Draft'}
            </button>

            <button
              onClick={() => handleSave(true)}
              disabled={isSaving}
              className="btn-crimson text-xs disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Publish & Activate
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-700 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Builder Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column: WHEN & STOP IF */}
          <div className="space-y-6">
            {/* General Info Card */}
            <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-2xs space-y-4">
              <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-brand-600" /> General Info
              </h2>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Sequence Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. New Lead Multi-Touch"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain the purpose and expected cadence..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                />
              </div>
            </div>

            {/* WHEN Trigger Card */}
            <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-2xs space-y-3">
              <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-600 fill-current" /> WHEN (Enrollment Trigger)
              </h2>

              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              >
                <option value="lead_created">Lead Created</option>
                <option value="form_submitted">Form Submitted</option>
                <option value="qualification_status_changed">Qualification Status Changed</option>
                <option value="pipeline_stage_changed">Pipeline Stage Changed</option>
                <option value="tag_added">Tag Added</option>
                <option value="manual_enrollment">Manual Enrollment Only</option>
              </select>

              <p className="text-[11px] text-gray-400">
                Leads can also be manually enrolled at any time directly from the Lead Profile.
              </p>
            </div>

            {/* STOP IF Card */}
            <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-purple-900 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-purple-600" /> STOP IF (Stop Conditions)
                </h2>
                <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                  Auto-Exit
                </span>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed">
                Immediately cancels pending waits and stops the sequence if the clinician reaches any of these qualification statuses:
              </p>

              <div className="space-y-2">
                {(['some_response', 'interested', 'hot', 'confirmed'] as QualificationStatus[]).map((stat) => (
                  <label
                    key={stat}
                    className="flex items-center gap-2.5 p-2 bg-gray-50 hover:bg-purple-50/50 rounded-xl border border-gray-200 cursor-pointer transition-colors text-xs font-semibold text-gray-800"
                  >
                    <input
                      type="checkbox"
                      checked={stopQualificationStatuses.includes(stat)}
                      onChange={() => toggleQualificationStop(stat)}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 w-4 h-4"
                    />
                    <span className="capitalize">{stat.replace('_', ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Center Column: THEN (Sequence Steps Timeline) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-2xs space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-brand-600" /> THEN (Sequence Outreach Cadence)
                </h2>
                <span className="text-xs font-mono text-gray-400">{steps.length} Steps</span>
              </div>

              {steps.length === 0 ? (
                <div className="py-12 border-2 border-dashed border-gray-200 rounded-2xl text-center space-y-2 p-6">
                  <Clock className="w-8 h-8 text-gray-300 mx-auto" />
                  <p className="text-xs font-semibold text-gray-600">No steps defined yet</p>
                  <p className="text-[11px] text-gray-400">
                    Add emails, SMS, delays, or tasks below to construct the follow-up flow.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {steps.map((step, idx) => {
                    const isSelected = selectedStepIndex === idx;
                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedStepIndex(idx)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-brand-50/30 border-brand-500 shadow-xs ring-2 ring-brand-500/10'
                            : 'bg-gray-50/70 border-gray-200 hover:bg-gray-100/60'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-700 shadow-2xs">
                            {idx + 1}
                          </div>

                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              {step.step_type === 'wait' && <Clock className="w-4 h-4 text-indigo-500" />}
                              {step.action_type === 'send_email' && <Mail className="w-4 h-4 text-blue-500" />}
                              {step.action_type === 'send_sms' && <MessageSquare className="w-4 h-4 text-emerald-500" />}
                              {step.action_type === 'create_call_task' && <PhoneCall className="w-4 h-4 text-purple-500" />}
                              {step.action_type === 'create_task' && <CheckCircle2 className="w-4 h-4 text-amber-500" />}

                              <span className="text-xs font-bold text-gray-900 uppercase">
                                {step.step_type === 'wait'
                                  ? `Wait ${step.config?.duration_value || 1} ${step.config?.duration_unit || 'days'}`
                                  : step.action_type?.replace(/_/g, ' ') || step.step_type}
                              </span>
                            </div>

                            <p className="text-[11px] text-gray-500 truncate max-w-md">
                              {step.config?.subject || step.config?.title || step.config?.message || 'Configured action'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeStep(idx);
                            }}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add Step Toolbar */}
              <div className="pt-4 border-t border-gray-100 space-y-2">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Add Next Action or Delay
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => addStep('action', 'send_email')}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5" /> Send Email
                  </button>
                  <button
                    onClick={() => addStep('wait')}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5" /> Add Delay
                  </button>
                  <button
                    onClick={() => addStep('action', 'send_sms')}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Send SMS
                  </button>
                  <button
                    onClick={() => addStep('action', 'create_call_task')}
                    className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <PhoneCall className="w-3.5 h-3.5" /> Call Task
                  </button>
                  <button
                    onClick={() => addStep('action', 'create_task')}
                    className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> CRM Task
                  </button>
                </div>
              </div>

              {/* Step Editor Drawer/Card when selected */}
              {selectedStep && (
                <div className="p-5 bg-gray-50 border border-brand-200 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                    <span className="text-xs font-bold text-gray-900 uppercase">
                      Edit Step {selectedStepIndex! + 1}: {selectedStep.action_type || selectedStep.step_type}
                    </span>
                    <button
                      onClick={() => setSelectedStepIndex(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 font-semibold"
                    >
                      Done
                    </button>
                  </div>

                  {selectedStep.step_type === 'wait' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Duration</label>
                        <input
                          type="number"
                          min={1}
                          value={selectedStep.config?.duration_value || 1}
                          onChange={(e) => updateStepConfig('duration_value', Number(e.target.value))}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                        <select
                          value={selectedStep.config?.duration_unit || 'days'}
                          onChange={(e) => updateStepConfig('duration_unit', e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold"
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {selectedStep.action_type === 'send_email' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                        <input
                          type="text"
                          value={selectedStep.config?.subject || ''}
                          onChange={(e) => updateStepConfig('subject', e.target.value)}
                          placeholder="Email subject line..."
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Body HTML</label>
                        <textarea
                          rows={4}
                          value={selectedStep.config?.body || ''}
                          onChange={(e) => updateStepConfig('body', e.target.value)}
                          placeholder="<p>Email content...</p>"
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {selectedStep.action_type === 'send_sms' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">SMS Message</label>
                      <textarea
                        rows={3}
                        value={selectedStep.config?.message || ''}
                        onChange={(e) => updateStepConfig('message', e.target.value)}
                        placeholder="SMS text message..."
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium"
                      />
                    </div>
                  )}

                  {(selectedStep.action_type === 'create_call_task' || selectedStep.action_type === 'create_task') && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Task Title</label>
                      <input
                        type="text"
                        value={selectedStep.config?.title || ''}
                        onChange={(e) => updateStepConfig('title', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Test Sequence Simulator Modal */}
      <TestAutomationModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        automationName={name || 'Follow-up Sequence'}
        steps={steps as AutomationStep[]}
      />
    </Layout>
  );
}
