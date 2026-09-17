import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Play,
  AlertCircle,
  Sliders,
  X,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { supabase } from '../../lib/supabase';
import { TestScoreModal } from './TestScoreModal';
import {
  DEFAULT_SCORE_SETTINGS,
  validateScoreSettings,
  CANONICAL_SOURCES,
  CANONICAL_QUALIFICATION_STATUSES,
  CANONICAL_CONTACT_PREFERENCES,
  CANONICAL_PIPELINE_STAGES,
  validateRuleCanonical,
} from './engine/score-evaluator';
import type {
  LeadScoreRule,
  LeadScoreSettings,
  LeadScoreCategory,
  LeadScoreOperator,
  LeadScoreRecalculationJob,
} from '../../types/database';

export function LeadScoringSettingsPage() {
  const [rules, setRules] = useState<LeadScoreRule[]>([]);
  const [settings, setSettings] = useState<LeadScoreSettings>(DEFAULT_SCORE_SETTINGS);
  const [activeJob, setActiveJob] = useState<LeadScoreRecalculationJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<'all' | LeadScoreCategory>('all');
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Thresholds editor state
  const [isEditingThresholds, setIsEditingThresholds] = useState(false);
  const [editColdMax, setEditColdMax] = useState(24);
  const [editWarmMax, setEditWarmMax] = useState(49);
  const [editHotMax, setEditHotMax] = useState(74);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);

  // New / Edit Rule Modal state
  const [editingRule, setEditingRule] = useState<LeadScoreRule | null>(null);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleCategory, setRuleCategory] = useState<LeadScoreCategory>('fit');
  const [ruleField, setRuleField] = useState('qualification_status');
  const [ruleOperator, setRuleOperator] = useState<LeadScoreOperator>('equals');
  const [ruleValue, setRuleValue] = useState('');
  const [rulePoints, setRulePoints] = useState(10);
  const [ruleDescription, setRuleDescription] = useState('');
  const [ruleActive, setRuleActive] = useState(true);
  const [isSavingRule, setIsSavingRule] = useState(false);

  // Batch Job processing state
  const [isTriggeringBatch, setIsTriggeringBatch] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch rules
      const { data: rulesData, error: rulesErr } = await supabase
        .from('lead_score_rules')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (rulesErr) throw rulesErr;
      if (rulesData) setRules(rulesData as LeadScoreRule[]);

      // 2. Fetch settings
      const { data: setData, error: setErr } = await supabase
        .from('lead_score_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (!setErr && setData) {
        setSettings(setData as LeadScoreSettings);
        setEditColdMax(setData.cold_max);
        setEditWarmMax(setData.warm_max);
        setEditHotMax(setData.hot_max);
      }

      // 3. Fetch latest active or recent recalculation job
      const { data: jobData } = await supabase
        .from('lead_score_recalculation_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (jobData) {
        setActiveJob(jobData as LeadScoreRecalculationJob);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load scoring configuration');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling for active job progress
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'processing') return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('lead_score_recalculation_jobs')
        .select('*')
        .eq('id', activeJob.id)
        .single();

      if (data) {
        setActiveJob(data as LeadScoreRecalculationJob);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJob]);

  const handleSaveThresholds = async () => {
    setThresholdError(null);

    const newSettings: LeadScoreSettings = {
      ...settings,
      cold_min: 0,
      cold_max: editColdMax,
      warm_min: editColdMax + 1,
      warm_max: editWarmMax,
      hot_min: editWarmMax + 1,
      hot_max: editHotMax,
      very_hot_min: editHotMax + 1,
      very_hot_max: 100,
    };

    const validation = validateScoreSettings(newSettings);
    if (!validation.valid) {
      setThresholdError(validation.error || 'Invalid threshold range');
      return;
    }

    setIsSavingThresholds(true);
    try {
      const { error: saveErr } = await supabase
        .from('lead_score_settings')
        .update({
          cold_min: newSettings.cold_min,
          cold_max: newSettings.cold_max,
          warm_min: newSettings.warm_min,
          warm_max: newSettings.warm_max,
          hot_min: newSettings.hot_min,
          hot_max: newSettings.hot_max,
          very_hot_min: newSettings.very_hot_min,
          very_hot_max: newSettings.very_hot_max,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (saveErr) throw saveErr;

      setSettings(newSettings);
      setIsEditingThresholds(false);
    } catch (err: any) {
      setThresholdError(err.message || 'Failed to save thresholds');
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const handleFieldChange = (newField: string) => {
    setRuleField(newField);
    switch (newField) {
      case 'pipeline_stage':
        setRuleOperator('equals');
        setRuleValue('qualification');
        break;
      case 'source':
        setRuleOperator('equals');
        setRuleValue('form');
        break;
      case 'qualification_status':
        setRuleOperator('equals');
        setRuleValue('interested');
        break;
      case 'contact_preference':
        setRuleOperator('equals');
        setRuleValue('email');
        break;
      case 'phone_exists':
      case 'email_exists':
      case 'last_response_at':
        setRuleOperator('exists');
        setRuleValue('');
        break;
      case 'days_since_last_activity':
        setRuleOperator('less_or_equal');
        setRuleValue('7');
        break;
      case 'days_since_last_response':
        setRuleOperator('greater_than');
        setRuleValue('14');
        break;
      case 'inbound_message_count':
        setRuleOperator('greater_or_equal');
        setRuleValue('1');
        break;
      case 'course_interest':
        setRuleOperator('exists');
        setRuleValue('');
        break;
      default:
        setRuleValue('');
    }
  };

  const handleOpenNewRule = () => {
    setEditingRule(null);
    setRuleName('');
    setRuleCategory('intent');
    setRuleField('pipeline_stage');
    setRuleOperator('equals');
    setRuleValue('qualification');
    setRulePoints(10);
    setRuleDescription('');
    setRuleActive(true);
    setIsRuleModalOpen(true);
  };

  const handleOpenEditRule = (rule: LeadScoreRule) => {
    setEditingRule(rule);
    setRuleName(rule.name);
    setRuleCategory(rule.category);
    setRuleField(rule.field_or_event);
    setRuleOperator(rule.operator);
    setRuleValue(
      typeof rule.value === 'string'
        ? rule.value
        : JSON.stringify(rule.value).replace(/^"|"$/g, '')
    );
    setRulePoints(rule.points);
    setRuleDescription(rule.description || '');
    setRuleActive(rule.is_active);
    setIsRuleModalOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) return;

    setIsSavingRule(true);
    try {
      let parsedValue: any = ruleValue.trim();
      if (parsedValue.startsWith('[') || parsedValue.startsWith('{')) {
        try {
          parsedValue = JSON.parse(parsedValue);
        } catch {
          // fallback string
        }
      }

      // Enforce canonical schema validation
      const validation = validateRuleCanonical({
        field_or_event: ruleField,
        operator: ruleOperator,
        value: parsedValue,
      });
      if (!validation.valid) {
        alert(validation.error || 'Invalid rule configuration.');
        setIsSavingRule(false);
        return;
      }

      if (editingRule) {
        const { error: updErr } = await supabase
          .from('lead_score_rules')
          .update({
            name: ruleName.trim(),
            category: ruleCategory,
            field_or_event: ruleField,
            operator: ruleOperator,
            value: parsedValue,
            points: rulePoints,
            description: ruleDescription.trim() || null,
            is_active: ruleActive,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRule.id);

        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from('lead_score_rules').insert({
          name: ruleName.trim(),
          category: ruleCategory,
          field_or_event: ruleField,
          operator: ruleOperator,
          value: parsedValue,
          points: rulePoints,
          description: ruleDescription.trim() || null,
          is_active: ruleActive,
          sort_order: rules.length * 10 + 10,
        });

        if (insErr) throw insErr;
      }

      setIsRuleModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to save rule');
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleToggleRule = async (rule: LeadScoreRule) => {
    try {
      const { error: togErr } = await supabase
        .from('lead_score_rules')
        .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
        .eq('id', rule.id);

      if (togErr) throw togErr;
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r))
      );
    } catch (err: any) {
      alert(err.message || 'Failed to toggle rule');
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this scoring rule?')) return;
    try {
      const { error: delErr } = await supabase.from('lead_score_rules').delete().eq('id', id);
      if (delErr) throw delErr;
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete rule');
    }
  };

  const handleTriggerRecalculateAll = async () => {
    if (
      !confirm(
        'Trigger background batch recalculation for all contacts? This will recompute lead scores across the entire database.'
      )
    ) {
      return;
    }

    setIsTriggeringBatch(true);
    try {
      // 1. Start job via RPC
      const { data: startData, error: startErr } = await supabase.rpc(
        'start_lead_score_recalculation_job',
        { p_batch_size: 100 }
      );

      if (startErr) throw startErr;
      const jobId = startData?.job_id;

      // 2. Invoke Edge Function process-lead-score-batch
      supabase.functions.invoke('process-lead-score-batch', {
        body: { job_id: jobId },
      });

      // 3. Refresh job state
      const { data: jobRow } = await supabase
        .from('lead_score_recalculation_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobRow) {
        setActiveJob(jobRow as LeadScoreRecalculationJob);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to start batch recalculation');
    } finally {
      setIsTriggeringBatch(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Lead Scoring & Sales Intelligence">
        <LoadingState message="Loading lead scoring rules and thresholds..." />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Lead Scoring & Sales Intelligence">
        <ErrorState message={error} onRetry={loadData} />
      </Layout>
    );
  }

  const filteredRules = rules.filter((r) => {
    if (activeCategory === 'all') return true;
    return r.category === activeCategory;
  });

  return (
    <Layout title="Lead Scoring & Sales Intelligence">
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-brand-600" />
              Lead Scoring Foundation
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              Configure deterministic priority scoring rules (Fit, Intent, Engagement) and thresholds.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTestModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 shadow-xs transition-colors"
            >
              <Play className="w-3.5 h-3.5 text-amber-500" />
              Test Score Simulator
            </button>

            <button
              onClick={handleTriggerRecalculateAll}
              disabled={isTriggeringBatch || activeJob?.status === 'processing'}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-xl hover:bg-brand-700 shadow-xs transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTriggeringBatch ? 'animate-spin' : ''}`} />
              Recalculate All Leads
            </button>
          </div>
        </div>

        {/* Active Recalculation Job Banner */}
        {activeJob && activeJob.status === 'processing' && (
          <div className="p-4 rounded-2xl bg-brand-50 border border-brand-200 flex items-center justify-between gap-4 animate-pulse">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-brand-600 animate-spin" />
                <span className="text-xs font-bold text-brand-900">
                  Batch Score Recalculation in Progress
                </span>
              </div>
              <p className="text-xs text-brand-700">
                Processed {activeJob.processed_leads} / {activeJob.total_leads} contacts (
                {Math.round((activeJob.processed_leads / Math.max(1, activeJob.total_leads)) * 100)}%)
              </p>
            </div>
            <div className="w-36 bg-brand-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-brand-600 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (activeJob.processed_leads / Math.max(1, activeJob.total_leads)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Thresholds / Classification Bands */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                Priority Thresholds & Visual Classification
              </h2>
            </div>
            <button
              onClick={() => setIsEditingThresholds(!isEditingThresholds)}
              className="text-xs text-brand-600 hover:text-brand-700 font-semibold"
            >
              {isEditingThresholds ? 'Cancel' : 'Edit Thresholds'}
            </button>
          </div>

          {isEditingThresholds ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Cold Maximum</label>
                  <input
                    type="number"
                    value={editColdMax}
                    onChange={(e) => setEditColdMax(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">Cold band: 0 to {editColdMax}</p>
                </div>
                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Warm Maximum</label>
                  <input
                    type="number"
                    value={editWarmMax}
                    onChange={(e) => setEditWarmMax(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Warm band: {editColdMax + 1} to {editWarmMax}
                  </p>
                </div>
                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Hot Maximum</label>
                  <input
                    type="number"
                    value={editHotMax}
                    onChange={(e) => setEditHotMax(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Hot: {editWarmMax + 1} to {editHotMax} | Very Hot: {editHotMax + 1} to 100
                  </p>
                </div>
              </div>

              {thresholdError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {thresholdError}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsEditingThresholds(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveThresholds}
                  disabled={isSavingThresholds}
                  className="px-4 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                >
                  {isSavingThresholds ? 'Saving...' : 'Save Thresholds'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 text-center">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                  Cold
                </span>
                <span className="text-sm font-bold text-gray-800 mt-0.5 block">
                  {settings.cold_min} – {settings.cold_max} PTS
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40 text-center">
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">
                  Warm
                </span>
                <span className="text-sm font-bold text-blue-900 mt-0.5 block">
                  {settings.warm_min} – {settings.warm_max} PTS
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40 text-center">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                  Hot
                </span>
                <span className="text-sm font-bold text-amber-900 mt-0.5 block">
                  {settings.hot_min} – {settings.hot_max} PTS
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/40 text-center">
                <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">
                  Very Hot
                </span>
                <span className="text-sm font-bold text-rose-900 mt-0.5 block">
                  {settings.very_hot_min} – {settings.very_hot_max} PTS
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Scoring Rules Manager */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
          {/* Rules Header & Tabs */}
          <div className="p-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                Scoring Rules ({rules.length})
              </h2>

              <div className="flex items-center bg-gray-100 p-0.5 rounded-lg text-xs">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'fit', label: 'Fit' },
                    { id: 'intent', label: 'Intent' },
                    { id: 'engagement', label: 'Engagement' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCategory(tab.id)}
                    className={`px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
                      activeCategory === tab.id
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleOpenNewRule}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Rule
            </button>
          </div>

          {/* Rules Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-left text-xs">
              <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Rule Name</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Evaluation Signal</th>
                  <th className="px-5 py-3">Points</th>
                  <th className="px-5 py-3">Active</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRules.map((rule) => {
                  const isNegative = rule.points < 0;
                  return (
                    <tr key={rule.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-gray-900">
                        <div>
                          <p className="font-bold">{rule.name}</p>
                          {rule.description && (
                            <p className="text-[11px] text-gray-400">{rule.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            rule.category === 'fit'
                              ? 'bg-blue-50 text-blue-700'
                              : rule.category === 'intent'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-purple-50 text-purple-700'
                          }`}
                        >
                          {rule.category}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 font-mono text-[11px]">
                        <span className="font-semibold text-gray-800">{rule.field_or_event}</span>{' '}
                        <span className="text-gray-400">{rule.operator}</span>{' '}
                        <span className="text-gray-900">
                          {typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono font-bold">
                        <span
                          className={`px-2 py-0.5 rounded ${
                            isNegative
                              ? 'bg-rose-50 text-rose-700 font-extrabold'
                              : 'bg-emerald-50 text-emerald-700 font-extrabold'
                          }`}
                        >
                          {rule.points > 0 ? `+${rule.points}` : rule.points} pts
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => handleToggleRule(rule)}
                          className={`w-9 h-5 flex items-center rounded-full p-1 transition-colors ${
                            rule.is_active ? 'bg-brand-600 justify-end' : 'bg-gray-200 justify-start'
                          }`}
                        >
                          <div className="w-3 h-3 rounded-full bg-white shadow-xs" />
                        </button>
                      </td>
                      <td className="px-5 py-3.5 text-right space-x-1">
                        <button
                          onClick={() => handleOpenEditRule(rule)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                          title="Edit rule"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                          title="Delete rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rule Create/Edit Modal */}
        {isRuleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-sm font-bold text-gray-900">
                  {editingRule ? 'Edit Scoring Rule' : 'Create New Scoring Rule'}
                </h3>
                <button
                  onClick={() => setIsRuleModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveRule} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Rule Name</label>
                  <input
                    type="text"
                    required
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="e.g. VIP Course Declared"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-gray-700 block mb-1">Category</label>
                    <select
                      value={ruleCategory}
                      onChange={(e) => setRuleCategory(e.target.value as LeadScoreCategory)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white"
                    >
                      <option value="fit">Fit</option>
                      <option value="intent">Intent</option>
                      <option value="engagement">Engagement</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-gray-700 block mb-1">Points (+ or -)</label>
                    <input
                      type="number"
                      required
                      value={rulePoints}
                      onChange={(e) => setRulePoints(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-gray-700 block mb-1">Field / Signal</label>
                    <select
                      value={ruleField}
                      onChange={(e) => handleFieldChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white"
                    >
                      <option value="pipeline_stage">Pipeline Stage (Canonical)</option>
                      <option value="qualification_status">Qualification Status (Canonical)</option>
                      <option value="source">Lead Source (Canonical)</option>
                      <option value="contact_preference">Contact Preference (Canonical)</option>
                      <option value="course_interest">Course Interest</option>
                      <option value="phone_exists">Phone Available</option>
                      <option value="email_exists">Email Available</option>
                      <option value="last_response_at">Inbound Response Received</option>
                      <option value="inbound_message_count">Inbound Message Count</option>
                      <option value="days_since_last_activity">Days Since Last Activity</option>
                      <option value="days_since_last_response">Days Since Last Response</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-gray-700 block mb-1">Operator</label>
                    <select
                      value={ruleOperator}
                      onChange={(e) => setRuleOperator(e.target.value as LeadScoreOperator)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white"
                    >
                      <option value="equals">Equals</option>
                      <option value="not_equals">Not Equals</option>
                      <option value="in">In List (JSON)</option>
                      <option value="exists">Exists / Is Set</option>
                      <option value="not_exists">Not Exists / Empty</option>
                      <option value="greater_than">Greater Than</option>
                      <option value="greater_or_equal">Greater Or Equal</option>
                      <option value="less_than">Less Than</option>
                      <option value="less_or_equal">Less Or Equal</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">
                    Comparison Value
                  </label>
                  {['exists', 'not_exists'].includes(ruleOperator) ||
                  ['phone_exists', 'email_exists', 'last_response_at'].includes(ruleField) ? (
                    <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 italic">
                      No comparison value required for existence check.
                    </div>
                  ) : ruleField === 'pipeline_stage' && ['equals', 'not_equals'].includes(ruleOperator) ? (
                    <select
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus:ring-1 focus:ring-brand-500 font-medium"
                    >
                      {CANONICAL_PIPELINE_STAGES.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  ) : ruleField === 'source' && ['equals', 'not_equals'].includes(ruleOperator) ? (
                    <select
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus:ring-1 focus:ring-brand-500 font-medium"
                    >
                      {CANONICAL_SOURCES.map((src) => (
                        <option key={src} value={src}>
                          {src}
                        </option>
                      ))}
                    </select>
                  ) : ruleField === 'qualification_status' && ['equals', 'not_equals'].includes(ruleOperator) ? (
                    <select
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus:ring-1 focus:ring-brand-500 font-medium"
                    >
                      {CANONICAL_QUALIFICATION_STATUSES.map((qs) => (
                        <option key={qs} value={qs}>
                          {qs}
                        </option>
                      ))}
                    </select>
                  ) : ruleField === 'contact_preference' && ['equals', 'not_equals'].includes(ruleOperator) ? (
                    <select
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus:ring-1 focus:ring-brand-500 font-medium"
                    >
                      {CANONICAL_CONTACT_PREFERENCES.map((cp) => (
                        <option key={cp} value={cp}>
                          {cp}
                        </option>
                      ))}
                    </select>
                  ) : ['days_since_last_activity', 'days_since_last_response', 'inbound_message_count'].includes(
                      ruleField
                    ) ? (
                    <input
                      type="number"
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      placeholder="e.g. 7"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      placeholder={
                        ruleOperator === 'in'
                          ? 'e.g. ["qualification", "acquisition"]'
                          : 'e.g. Bootcamp or keyword'
                      }
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500 font-mono"
                    />
                  )}
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={ruleDescription}
                    onChange={(e) => setRuleDescription(e.target.value)}
                    placeholder="Short summary for why this score is granted..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="ruleActiveCheck"
                    checked={ruleActive}
                    onChange={(e) => setRuleActive(e.target.checked)}
                    className="rounded text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="ruleActiveCheck" className="text-xs text-gray-700 font-medium">
                    Rule is Active
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsRuleModalOpen(false)}
                    className="px-4 py-2 font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingRule}
                    className="px-5 py-2 font-semibold text-white bg-brand-600 rounded-xl hover:bg-brand-700 disabled:opacity-50"
                  >
                    {isSavingRule ? 'Saving...' : 'Save Rule'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Test Score Simulator Sandbox Modal */}
        <TestScoreModal isOpen={isTestModalOpen} onClose={() => setIsTestModalOpen(false)} />
      </div>
    </Layout>
  );
}
