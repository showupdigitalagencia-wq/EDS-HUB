import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '../../../lib/supabase';
import { campaignAudienceService } from '../services/campaign-audience-service';
import type {
  AudienceFilterDefinition,
  AudiencePreviewResult,
  PipelineStage,
} from '../../../types';
import {
  Users,
  CheckCircle2,
  XCircle,
  RotateCw,
  Eye,
  Sliders,
  GraduationCap,
  DollarSign,
  Clock,
  ShieldCheck,
  Bookmark,
} from 'lucide-react';

interface CourseOption {
  id: string;
  name: string;
  code: string;
}

interface AudienceFilterBuilderProps {
  channel: 'email' | 'sms' | 'call';
  filterDefinition: AudienceFilterDefinition;
  onChange: (def: AudienceFilterDefinition) => void;
  onOpenPreview: (preview: AudiencePreviewResult) => void;
  onOpenSavedSegments: () => void;
  disabled?: boolean;
}

export function AudienceFilterBuilder({
  channel,
  filterDefinition,
  onChange,
  onOpenPreview,
  onOpenSavedSegments,
  disabled = false,
}: AudienceFilterBuilderProps) {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [isEstimating, setIsEstimating] = useState(false);
  const [previewResult, setPreviewResult] = useState<AudiencePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const minScoreInputId = useId();
  const maxScoreInputId = useId();
  const inactivitySelectId = useId();
  const enrolledCourseId = useId();
  const notEnrolledCourseId = useId();
  const futureInterestCourseId = useId();

  // Load Reference Data (Stages and Courses)
  useEffect(() => {
    async function loadRefs() {
      try {
        const [stagesRes, coursesRes] = await Promise.all([
          supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
          supabase.from('courses').select('id, name, code').eq('active', true).order('sort_order', { ascending: true }),
        ]);
        if (stagesRes.data) setStages(stagesRes.data);
        if (coursesRes.data) setCourses(coursesRes.data);
      } catch (err) {
        console.error('Failed to load reference data for audience builder:', err);
      }
    }
    loadRefs();
  }, []);

  // Update a single filter field
  const updateFilter = useCallback(
    <K extends keyof AudienceFilterDefinition>(field: K, value: AudienceFilterDefinition[K]) => {
      onChange({
        ...filterDefinition,
        [field]: value,
      });
    },
    [filterDefinition, onChange],
  );

  // Evaluate Server-Side Reach
  const estimateReach = useCallback(async () => {
    setIsEstimating(true);
    setError(null);
    try {
      const result = await campaignAudienceService.previewAudience(filterDefinition, channel, 10, 0);
      setPreviewResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error evaluating audience reach');
    } finally {
      setIsEstimating(false);
    }
  }, [filterDefinition, channel]);

  // Re-calculate reach when channel changes or on mount
  useEffect(() => {
    estimateReach();
  }, [channel, estimateReach]);

  // Helper to toggle array item
  const toggleArrayItem = (field: 'stages' | 'sources' | 'qualification_statuses' | 'contact_preferences', item: string) => {
    const list = (filterDefinition[field] as string[]) || [];
    const updated = list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
    updateFilter(field, updated);
  };

  const selectedStages = filterDefinition.stages || [];
  const selectedStatuses = filterDefinition.qualification_statuses || [];

  return (
    <div className="space-y-6">
      {/* Header bar with Saved Segments button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-gray-100">
        <div>
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Sliders className="h-4 w-4 text-brand-600" />
            Audience Rules & Commercial Segmentation
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Filter contacts server-side by CRM stage, score, courses, financial balance, and channel preference.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenSavedSegments}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
        >
          <Bookmark className="h-3.5 w-3.5 text-brand-600" />
          Saved Segments
        </button>
      </div>

      {/* Grid of Modular Filter Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Pipeline Stage & Qualification */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
          <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-blue-600" />
            Pipeline Stage
          </span>
          <div className="flex flex-wrap gap-1.5">
            {stages.map((stage) => {
              const isSelected = selectedStages.includes(stage.code);
              return (
                <button
                  key={stage.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleArrayItem('stages', stage.code)}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {stage.name}
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-gray-200/60">
            <span className="text-xs font-bold text-gray-900 block mb-1.5">Qualification Status</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'interested', label: 'Interested' },
                { key: 'hot', label: 'Hot (≥50 pts)' },
                { key: 'confirmed', label: 'Confirmed' },
                { key: 'some_response', label: 'Some Response' },
                { key: 'no_response', label: 'No Response' },
              ].map((status) => {
                const isSelected = selectedStatuses.includes(status.key);
                return (
                  <button
                    key={status.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleArrayItem('qualification_statuses', status.key)}
                    className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {status.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card 2: Lead Scoring & Commercial Inactivity */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
          <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-purple-600" />
            Lead Score & Engagement Activity
          </span>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={minScoreInputId} className="block text-[11px] font-semibold text-gray-700 mb-1">
                Min Lead Score (0–100)
              </label>
              <input
                id={minScoreInputId}
                type="number"
                min="0"
                max="100"
                disabled={disabled}
                value={filterDefinition.min_score ?? ''}
                onChange={(e) => updateFilter('min_score', e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 70"
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label htmlFor={maxScoreInputId} className="block text-[11px] font-semibold text-gray-700 mb-1">
                Max Lead Score (0–100)
              </label>
              <input
                id={maxScoreInputId}
                type="number"
                min="0"
                max="100"
                disabled={disabled}
                value={filterDefinition.max_score ?? ''}
                onChange={(e) => updateFilter('max_score', e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 100"
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor={inactivitySelectId} className="block text-[11px] font-semibold text-gray-700 mb-1">
              Days Without Meaningful Activity
            </label>
            <select
              id={inactivitySelectId}
              disabled={disabled}
              value={filterDefinition.days_since_last_activity ?? ''}
              onChange={(e) =>
                updateFilter('days_since_last_activity', e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
            >
              <option value="">Any Activity Timeframe</option>
              <option value="7">Inactivity ≥ 7 Days</option>
              <option value="14">Inactivity ≥ 14 Days</option>
              <option value="30">Inactivity ≥ 30 Days (Stale)</option>
              <option value="60">Inactivity ≥ 60 Days</option>
              <option value="90">Inactivity ≥ 90 Days</option>
            </select>
          </div>
        </div>

        {/* Card 3: Course & Student Lifecycle */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
          <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
            <GraduationCap className="h-3.5 w-3.5 text-emerald-600" />
            Course History & Repeat Students
          </span>

          <div className="space-y-2">
            <div>
              <label htmlFor={enrolledCourseId} className="block text-[11px] font-semibold text-gray-700 mb-1">
                Enrolled in Course
              </label>
              <select
                id={enrolledCourseId}
                disabled={disabled}
                value={filterDefinition.enrolled_course_id || ''}
                onChange={(e) => updateFilter('enrolled_course_id', e.target.value || null)}
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
              >
                <option value="">Any / Not Filtered</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={notEnrolledCourseId} className="block text-[11px] font-semibold text-gray-700 mb-1">
                NOT Enrolled in Course
              </label>
              <select
                id={notEnrolledCourseId}
                disabled={disabled}
                value={filterDefinition.not_enrolled_course_id || ''}
                onChange={(e) => updateFilter('not_enrolled_course_id', e.target.value || null)}
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
              >
                <option value="">Any / Not Filtered</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-800">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={filterDefinition.repeat_student === true}
                  onChange={(e) => updateFilter('repeat_student', e.target.checked ? true : null)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Repeat Students (≥ 2 confirmed enrollments)
              </label>
            </div>
          </div>
        </div>

        {/* Card 4: Financial Balance & Future Course Interest */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
          <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-teal-600" />
            Financial Balance & Future Course Interests
          </span>

          <div>
            <label htmlFor={futureInterestCourseId} className="block text-[11px] font-semibold text-gray-700 mb-1">
              Future Course Interest Declared
            </label>
            <select
              id={futureInterestCourseId}
              disabled={disabled}
              value={filterDefinition.course_interest_id || ''}
              onChange={(e) => updateFilter('course_interest_id', e.target.value || null)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
            >
              <option value="">Any / Not Filtered</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-800">
              <input
                type="checkbox"
                disabled={disabled}
                checked={filterDefinition.has_outstanding_balance === true}
                onChange={(e) => updateFilter('has_outstanding_balance', e.target.checked ? true : null)}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              Has Outstanding Balance (Agreed &gt; Net Collected)
            </label>
            <p className="text-[11px] text-gray-500 mt-1 pl-5">
              Calculates strictly using canonical payments minus refunds.
            </p>
          </div>
        </div>
      </div>

      {/* Channel & Contact Preference Rule Notice */}
      <div className="p-3.5 rounded-xl border border-brand-200 bg-brand-50/60 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-brand-700 shrink-0 mt-0.5" />
        <div className="text-xs text-brand-900">
          <span className="font-bold">Contact Preference Rule Active for Channel: {channel.toUpperCase()}</span>
          <p className="mt-0.5 text-brand-800">
            {channel === 'email' && 'Only leads with Contact Preference = Email and valid email address will be marked Eligible.'}
            {channel === 'sms' && 'Only leads with Contact Preference = SMS and valid phone number will be marked Eligible.'}
            {channel === 'call' && 'Only leads with Contact Preference = Call and valid phone number will be marked Eligible.'}
            {' Contacts with mismatched or missing preference and test leads (source = test) are safely excluded.'}
          </p>
        </div>
      </div>

      {/* Live Server-Side Reach Bar */}
      <div className="p-5 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Total Matches</span>
              <p className="text-2xl font-black text-gray-900">
                {isEstimating ? '...' : previewResult?.total_matched ?? 0}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Eligible ({channel.toUpperCase()})
              </span>
              <p className="text-2xl font-black text-emerald-700">
                {isEstimating ? '...' : previewResult?.eligible_count ?? 0}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1">
                <XCircle className="h-3 w-3" /> Excluded
              </span>
              <p className="text-2xl font-black text-rose-700">
                {isEstimating ? '...' : previewResult?.excluded_count ?? 0}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={estimateReach}
              disabled={isEstimating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`h-3.5 w-3.5 ${isEstimating ? 'animate-spin' : ''}`} />
              Recalculate Reach
            </button>
            <button
              type="button"
              onClick={() => previewResult && onOpenPreview(previewResult)}
              disabled={isEstimating || !previewResult}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-gray-900 text-white hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview Contacts ({previewResult?.total_matched ?? 0})
            </button>
          </div>
        </div>

        {/* Exclusion Breakdown Badges */}
        {previewResult && previewResult.excluded_count > 0 && (
          <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500 font-medium">Exclusion breakdown:</span>
            {previewResult.exclusion_breakdown.CHANNEL_PREFERENCE_MISMATCH > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.CHANNEL_PREFERENCE_MISMATCH} Preference Mismatch
              </span>
            )}
            {previewResult.exclusion_breakdown.NO_VALID_CONTACT_PREFERENCE > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.NO_VALID_CONTACT_PREFERENCE} No Preference
              </span>
            )}
            {previewResult.exclusion_breakdown.MISSING_EMAIL > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.MISSING_EMAIL} Missing Email
              </span>
            )}
            {previewResult.exclusion_breakdown.MISSING_PHONE > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.MISSING_PHONE} Missing Phone
              </span>
            )}
            {previewResult.exclusion_breakdown.TEST_SOURCE > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-[11px] font-medium">
                {previewResult.exclusion_breakdown.TEST_SOURCE} Test Source
              </span>
            )}
          </div>
        )}

        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
