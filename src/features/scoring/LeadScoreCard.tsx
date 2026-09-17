import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  TrendingUp,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  CheckCircle2,
  History,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  deriveScoreLabel,
  getScoreLabelBadge,
  DEFAULT_SCORE_SETTINGS,
} from './engine/score-evaluator';
import type { Lead } from '../../types';
import type {
  LeadScoreSettings,
  LeadScoreCalculationResult,
  LeadScoreHistory,
} from '../../types/database';

interface LeadScoreCardProps {
  lead: Lead;
  onLeadUpdated?: () => void;
}

export function LeadScoreCard({ lead, onLeadUpdated }: LeadScoreCardProps) {
  const [settings, setSettings] = useState<LeadScoreSettings>(DEFAULT_SCORE_SETTINGS);
  const [calculation, setCalculation] = useState<LeadScoreCalculationResult | null>(null);
  const [history, setHistory] = useState<LeadScoreHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(true);

  const loadScoreData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Load settings for threshold definitions
      const { data: setRow } = await supabase
        .from('lead_score_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      const currentSettings = setRow || DEFAULT_SCORE_SETTINGS;
      setSettings(currentSettings);

      // 2. Fetch active calculation snapshot via read-only RPC
      const { data: calcData, error: calcErr } = await supabase.rpc('calculate_lead_score', {
        p_lead_id: lead.id,
      });

      if (!calcErr && calcData) {
        setCalculation(calcData as LeadScoreCalculationResult);
      }

      // 3. Fetch score history
      const { data: histData } = await supabase
        .from('lead_score_history')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (histData) {
        setHistory(histData as LeadScoreHistory[]);
      }
    } catch (err) {
      console.error('Failed to load lead score details:', err);
    } finally {
      setIsLoading(false);
    }
  }, [lead.id]);

  useEffect(() => {
    loadScoreData();
  }, [loadScoreData]);

  const handleRecalculateNow = async () => {
    setIsRecalculating(true);
    try {
      const { error } = await supabase.rpc('recalculate_lead_score', {
        p_lead_id: lead.id,
        p_reason: 'manual_user_request',
        p_dry_run: false,
      });

      if (error) throw error;
      await loadScoreData();
      onLeadUpdated?.();
    } catch (err) {
      console.error('Recalculation error:', err);
    } finally {
      setIsRecalculating(false);
    }
  };

  const currentScore = lead.lead_score ?? calculation?.score ?? 0;
  const label = deriveScoreLabel(currentScore, settings);
  const badge = getScoreLabelBadge(label);

  const fitPts = calculation?.fit_subtotal ?? 0;
  const intentPts = calculation?.intent_subtotal ?? 0;
  const engagementPts = calculation?.engagement_subtotal ?? 0;

  return (
    <div className="card-executive overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#08254f] text-[#449bd5] flex items-center justify-center shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold font-heading text-[#08254f] uppercase tracking-wider flex items-center gap-2">
              Lead Priority Score
              <span className={`px-2 py-0.5 text-xs rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}>
                {badge.label}
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Deterministic priority calculation (Fit, Intent & Engagement)
            </p>
          </div>
        </div>

        <button
          onClick={handleRecalculateNow}
          disabled={isRecalculating || isLoading}
          className="btn-secondary text-xs disabled:opacity-50"
          title="Recalculate lead score"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
          {isRecalculating ? 'Recalculating...' : 'Recalculate'}
        </button>
      </div>

      {/* Main Score Display */}
      <div className="p-5 bg-gradient-to-br from-slate-50/70 via-white to-slate-50/40">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* Circular/Large Numeric Gauge */}
          <div className="relative flex flex-col items-center justify-center w-28 h-28 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
            <span className="text-4xl font-extrabold font-heading text-[#08254f] tracking-tight">
              {currentScore}
            </span>
            <span className="text-[10px] uppercase font-bold font-heading text-slate-400 tracking-wider">
              / 100 PTS
            </span>
          </div>

          {/* Subscores Breakdown */}
          <div className="flex-1 w-full space-y-2.5">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-gray-700 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                  Fit Score
                </span>
                <span className="font-bold text-gray-900">+{fitPts} pts</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, fitPts * 2.5))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-gray-700 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  Intent Score
                </span>
                <span className="font-bold text-gray-900">+{intentPts} pts</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, intentPts * 2))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-gray-700 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-purple-500" />
                  Engagement & Recency
                </span>
                <span className={`font-bold ${engagementPts < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                  {engagementPts >= 0 ? `+${engagementPts}` : engagementPts} pts
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    engagementPts < 0 ? 'bg-rose-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, Math.abs(engagementPts) * 3))}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {lead.lead_score_updated_at && (
          <p className="text-[10px] text-gray-400 mt-4 text-right">
            Last recalculated: {new Date(lead.lead_score_updated_at).toLocaleString([], {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
        )}
      </div>

      {/* "Why this score?" Rule Breakdown */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="w-full p-4 flex items-center justify-between text-xs font-bold text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-brand-600" />
            Why this score? ({calculation?.matched_rules?.length || 0} active signals)
          </span>
          {showBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showBreakdown && (
          <div className="px-4 pb-4 space-y-2">
            {calculation?.matched_rules && calculation.matched_rules.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {calculation.matched_rules.map((rule) => {
                  const isNegative = rule.points < 0;
                  return (
                    <div
                      key={rule.rule_id}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        isNegative
                          ? 'bg-rose-50/50 border-rose-200 text-rose-900'
                          : 'bg-emerald-50/40 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-bold truncate">{rule.name}</p>
                        {rule.description && (
                          <p className="text-[10px] text-gray-500 truncate">{rule.description}</p>
                        )}
                      </div>
                      <span
                        className={`font-mono font-extrabold px-2 py-0.5 rounded text-xs shrink-0 ${
                          isNegative
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {rule.points > 0 ? `+${rule.points}` : rule.points}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic p-2">
                No scoring rules matched for this contact yet.
              </p>
            )}
          </div>
        )}
      </div>

      {/* History Drawer */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full p-4 flex items-center justify-between text-xs font-bold text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            Score Change History ({history.length})
          </span>
          {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showHistory && (
          <div className="px-4 pb-4 space-y-2">
            {history.length > 0 ? (
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden bg-gray-50/50">
                {history.map((h) => (
                  <div key={h.id} className="p-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-gray-800 capitalize">
                        {h.reason.replace(/_/g, ' ')}
                      </span>
                      <p className="text-[10px] text-gray-400">
                        {new Date(h.created_at).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-gray-400">{h.old_score}</span>
                      <span className="text-gray-300">→</span>
                      <span className="font-bold text-gray-900">{h.new_score}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          h.delta > 0
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic p-2">
                No previous score adjustments on record.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
