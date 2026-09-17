// =============================================================================
// Lead Scoring Evaluator Engine (TypeScript Client & Test Engine)
// =============================================================================
// Evaluates declarative lead_score_rules against a lead context deterministically.
// Produces category subtotals (Fit, Intent, Engagement), clamped score (0-100),
// explainable breakdown of matched rules, and derived label from settings.
// =============================================================================

import type {
  Lead,
  LeadScoreRule,
  LeadScoreSettings,
  LeadScoreCalculationResult,
  LeadScoreLabel,
} from '../../../types/database';

export interface EvaluatorLeadContext {
  lead: Lead;
  pipelineStageCode?: string | null;
  tags?: string[];
  inboundMessageCount?: number;
  lastActivityAt?: string | null;
  daysSinceLastActivity?: number;
  daysSinceLastResponse?: number;
}

export const DEFAULT_SCORE_SETTINGS: LeadScoreSettings = {
  id: '00000000-0000-0000-0000-000000000001',
  cold_min: 0,
  cold_max: 24,
  warm_min: 25,
  warm_max: 49,
  hot_min: 50,
  hot_max: 74,
  very_hot_min: 75,
  very_hot_max: 100,
  updated_at: new Date().toISOString(),
};

/**
 * Validates that settings thresholds are strictly contiguous, non-overlapping, and cover 0-100.
 */
export function validateScoreSettings(settings: LeadScoreSettings): { valid: boolean; error?: string } {
  const { cold_min, cold_max, warm_min, warm_max, hot_min, hot_max, very_hot_min, very_hot_max } = settings;

  if (cold_min !== 0) return { valid: false, error: 'Cold threshold must start at 0.' };
  if (cold_min > cold_max) return { valid: false, error: 'Cold min must be <= cold max.' };

  if (warm_min !== cold_max + 1) {
    return { valid: false, error: `Warm min (${warm_min}) must be cold max + 1 (${cold_max + 1}). No gaps or overlaps allowed.` };
  }
  if (warm_min > warm_max) return { valid: false, error: 'Warm min must be <= warm max.' };

  if (hot_min !== warm_max + 1) {
    return { valid: false, error: `Hot min (${hot_min}) must be warm max + 1 (${warm_max + 1}). No gaps or overlaps allowed.` };
  }
  if (hot_min > hot_max) return { valid: false, error: 'Hot min must be <= hot max.' };

  if (very_hot_min !== hot_max + 1) {
    return { valid: false, error: `Very Hot min (${very_hot_min}) must be hot max + 1 (${hot_max + 1}). No gaps or overlaps allowed.` };
  }
  if (very_hot_max !== 100) return { valid: false, error: 'Very Hot max must be 100.' };
  if (very_hot_min > very_hot_max) return { valid: false, error: 'Very Hot min must be <= very hot max.' };

  return { valid: true };
}

// =============================================================================
// EDS HUB Canonical Schema Constants & Validation
// =============================================================================

export const CANONICAL_SOURCES = ['meta', 'google', 'manual', 'test', 'form'] as const;
export type CanonicalSource = typeof CANONICAL_SOURCES[number];

export const CANONICAL_QUALIFICATION_STATUSES = [
  'no_response',
  'some_response',
  'interested',
  'hot',
  'confirmed',
] as const;
export type CanonicalQualificationStatus = typeof CANONICAL_QUALIFICATION_STATUSES[number];

export const CANONICAL_CONTACT_PREFERENCES = ['email', 'sms', 'call'] as const;
export type CanonicalContactPreference = typeof CANONICAL_CONTACT_PREFERENCES[number];

export const CANONICAL_PIPELINE_STAGE_CODES = [
  'capture',
  'qualification',
  'acquisition',
  'approval',
  'enrollment',
  'post_course',
  'alumni',
] as const;
export type CanonicalPipelineStageCode = typeof CANONICAL_PIPELINE_STAGE_CODES[number];

export const CANONICAL_PIPELINE_STAGES = [
  { code: 'capture', name: 'Captura (New Lead)' },
  { code: 'qualification', name: 'Qualificação (Qualification)' },
  { code: 'acquisition', name: 'Aquisição (Acquisition)' },
  { code: 'approval', name: 'Aprovação (Approval)' },
  { code: 'enrollment', name: 'Matrícula (Enrollment)' },
  { code: 'post_course', name: 'Pós-curso (Post-Course)' },
  { code: 'alumni', name: 'Alumni (Alumni)' },
] as const;

/**
 * Validates that a scoring rule adheres to EDS HUB canonical schemas.
 */
export function validateRuleCanonical(rule: {
  field_or_event: string;
  operator: string;
  value: unknown;
}): { valid: boolean; error?: string } {
  const valStr = typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value).replace(/^"|"$/g, '');

  if (rule.field_or_event === 'source' && ['equals', 'not_equals'].includes(rule.operator)) {
    if (!CANONICAL_SOURCES.includes(valStr as any)) {
      return {
        valid: false,
        error: `Invalid source '${valStr}'. Allowed sources: ${CANONICAL_SOURCES.join(', ')}.`,
      };
    }
  }

  if (rule.field_or_event === 'pipeline_stage') {
    if (['equals', 'not_equals'].includes(rule.operator)) {
      if (!CANONICAL_PIPELINE_STAGE_CODES.includes(valStr as any)) {
        return {
          valid: false,
          error: `Invalid pipeline stage '${valStr}'. Allowed stages: ${CANONICAL_PIPELINE_STAGE_CODES.join(', ')}.`,
        };
      }
    } else if (rule.operator === 'in') {
      const arr = Array.isArray(rule.value) ? rule.value : [];
      for (const item of arr) {
        if (!CANONICAL_PIPELINE_STAGE_CODES.includes(String(item) as any)) {
          return {
            valid: false,
            error: `Invalid pipeline stage '${item}' in list. Allowed stages: ${CANONICAL_PIPELINE_STAGE_CODES.join(', ')}.`,
          };
        }
      }
    }
  }

  if (rule.field_or_event === 'qualification_status' && ['equals', 'not_equals'].includes(rule.operator)) {
    if (!CANONICAL_QUALIFICATION_STATUSES.includes(valStr as any)) {
      return {
        valid: false,
        error: `Invalid qualification status '${valStr}'. Allowed statuses: ${CANONICAL_QUALIFICATION_STATUSES.join(', ')}.`,
      };
    }
  }

  if (rule.field_or_event === 'contact_preference' && ['equals', 'not_equals'].includes(rule.operator)) {
    if (!CANONICAL_CONTACT_PREFERENCES.includes(valStr as any)) {
      return {
        valid: false,
        error: `Invalid contact preference '${valStr}'. Allowed preferences: ${CANONICAL_CONTACT_PREFERENCES.join(', ')}.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Derives visual label ('cold', 'warm', 'hot', 'very_hot') from score and settings.
 */
export function deriveScoreLabel(score: number, settings: LeadScoreSettings = DEFAULT_SCORE_SETTINGS): LeadScoreLabel {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (clamped <= settings.cold_max) return 'cold';
  if (clamped <= settings.warm_max) return 'warm';
  if (clamped <= settings.hot_max) return 'hot';
  return 'very_hot';
}

/**
 * Returns badge styling and text for a LeadScoreLabel.
 */
export function getScoreLabelBadge(label: LeadScoreLabel): { bg: string; text: string; border: string; label: string } {
  switch (label) {
    case 'very_hot':
      return {
        bg: 'bg-rose-50',
        text: 'text-rose-700 font-bold',
        border: 'border-rose-200',
        label: 'Very Hot',
      };
    case 'hot':
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-700 font-bold',
        border: 'border-amber-200',
        label: 'Hot',
      };
    case 'warm':
      return {
        bg: 'bg-blue-50',
        text: 'text-blue-700 font-semibold',
        border: 'border-blue-200',
        label: 'Warm',
      };
    case 'cold':
    default:
      return {
        bg: 'bg-gray-50',
        text: 'text-gray-600 font-medium',
        border: 'border-gray-200',
        label: 'Cold',
      };
  }
}

/**
 * Evaluates a single scoring rule against lead context.
 */
export function evaluateRule(rule: LeadScoreRule, context: EvaluatorLeadContext): boolean {
  if (!rule.is_active) return false;

  const { lead, pipelineStageCode, inboundMessageCount = 0 } = context;

  // Derive days elapsed
  const nowMs = Date.now();
  const lastActivityMs = context.lastActivityAt
    ? new Date(context.lastActivityAt).getTime()
    : new Date(lead.updated_at || lead.created_at).getTime();
  const daysSinceActivity = context.daysSinceLastActivity ?? Math.max(0, (nowMs - lastActivityMs) / (1000 * 86400));

  const lastResponseMs = lead.last_response_at
    ? new Date(lead.last_response_at).getTime()
    : new Date(lead.created_at).getTime();
  const daysSinceResponse = context.daysSinceLastResponse ?? Math.max(0, (nowMs - lastResponseMs) / (1000 * 86400));

  const valStr = typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value).replace(/^"|"$/g, '');
  const valNum = Number(rule.value);
  const valArray = Array.isArray(rule.value) ? rule.value : [];

  switch (rule.field_or_event) {
    case 'qualification_status': {
      const q = lead.qualification_status || '';
      if (rule.operator === 'equals') return q.toLowerCase() === valStr.toLowerCase();
      if (rule.operator === 'not_equals') return q.toLowerCase() !== valStr.toLowerCase();
      if (rule.operator === 'in') return valArray.map((v) => String(v).toLowerCase()).includes(q.toLowerCase());
      return false;
    }

    case 'pipeline_stage': {
      const stage = (pipelineStageCode || '').toLowerCase();
      if (rule.operator === 'equals') return stage === valStr.toLowerCase();
      if (rule.operator === 'not_equals') return stage !== valStr.toLowerCase();
      if (rule.operator === 'in') return valArray.map((v) => String(v).toLowerCase()).includes(stage);
      return false;
    }

    case 'source': {
      const src = (lead.source || '').toLowerCase();
      if (rule.operator === 'equals') return src === valStr.toLowerCase();
      if (rule.operator === 'not_equals') return src !== valStr.toLowerCase();
      if (rule.operator === 'in') return valArray.map((v) => String(v).toLowerCase()).includes(src);
      return false;
    }

    case 'course_interest': {
      const hasInterest = Boolean(lead.course_interest && lead.course_interest.trim().length > 0);
      if (rule.operator === 'exists') return hasInterest;
      if (rule.operator === 'not_exists') return !hasInterest;
      if (rule.operator === 'equals') return (lead.course_interest || '').trim().toLowerCase() === valStr.trim().toLowerCase();
      return false;
    }

    case 'contact_preference': {
      const hasPref = Boolean(lead.contact_preference);
      if (rule.operator === 'exists') return hasPref;
      if (rule.operator === 'equals') return (lead.contact_preference || '').toLowerCase() === valStr.toLowerCase();
      return false;
    }

    case 'email_exists': {
      const hasEmail = Boolean(lead.email && lead.email.trim().length > 0);
      if (rule.operator === 'exists') return hasEmail;
      if (rule.operator === 'not_exists') return !hasEmail;
      return false;
    }

    case 'phone_exists': {
      const hasPhone = Boolean(lead.phone_e164 && lead.phone_e164.trim().length > 0);
      if (rule.operator === 'exists') return hasPhone;
      if (rule.operator === 'not_exists') return !hasPhone;
      return false;
    }

    case 'last_response_at': {
      const hasResp = Boolean(lead.last_response_at);
      if (rule.operator === 'exists') return hasResp;
      if (rule.operator === 'not_exists') return !hasResp;
      return false;
    }

    case 'inbound_message_count': {
      if (rule.operator === 'greater_than') return inboundMessageCount > valNum;
      if (rule.operator === 'greater_or_equal') return inboundMessageCount >= valNum;
      if (rule.operator === 'equals') return inboundMessageCount === valNum;
      return false;
    }

    case 'days_since_last_activity': {
      if (rule.operator === 'less_or_equal') return daysSinceActivity <= valNum;
      if (rule.operator === 'less_than') return daysSinceActivity < valNum;
      if (rule.operator === 'greater_than') return daysSinceActivity > valNum;
      if (rule.operator === 'greater_or_equal') return daysSinceActivity >= valNum;
      return false;
    }

    case 'days_since_last_response': {
      if (rule.operator === 'greater_than') return daysSinceResponse > valNum;
      if (rule.operator === 'greater_or_equal') return daysSinceResponse >= valNum;
      if (rule.operator === 'less_or_equal') return daysSinceResponse <= valNum;
      return false;
    }

    default:
      return false;
  }
}

/**
 * Pure calculation function: evaluates all active rules, computes category subtotals,
 * clamps final score [0, 100], and produces full explainable breakdown.
 */
export function calculateScore(
  context: EvaluatorLeadContext,
  rules: LeadScoreRule[],
  settings: LeadScoreSettings = DEFAULT_SCORE_SETTINGS
): LeadScoreCalculationResult {
  let fitSubtotal = 0;
  let intentSubtotal = 0;
  let engagementSubtotal = 0;
  let rawTotal = 0;

  const matchedRules: LeadScoreCalculationResult['matched_rules'] = [];
  const unmatchedRules: LeadScoreCalculationResult['unmatched_rules'] = [];

  // Sort rules deterministically by sort_order
  const sorted = [...rules].sort((a, b) => a.sort_order - b.sort_order);

  for (const rule of sorted) {
    const isMatched = evaluateRule(rule, context);

    if (isMatched) {
      rawTotal += rule.points;
      if (rule.category === 'fit') fitSubtotal += rule.points;
      else if (rule.category === 'intent') intentSubtotal += rule.points;
      else if (rule.category === 'engagement') engagementSubtotal += rule.points;

      matchedRules.push({
        rule_id: rule.id,
        name: rule.name,
        category: rule.category,
        points: rule.points,
        description: rule.description,
      });
    } else {
      unmatchedRules.push({
        rule_id: rule.id,
        name: rule.name,
        category: rule.category,
        points: rule.points,
      });
    }
  }

  const clampedScore = Math.max(0, Math.min(100, rawTotal));
  const label = deriveScoreLabel(clampedScore, settings);

  return {
    lead_id: context.lead.id,
    raw_total: rawTotal,
    score: clampedScore,
    label,
    fit_subtotal: fitSubtotal,
    intent_subtotal: intentSubtotal,
    engagement_subtotal: engagementSubtotal,
    matched_rules: matchedRules,
    unmatched_rules: unmatchedRules,
  };
}
