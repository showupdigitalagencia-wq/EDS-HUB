import { useState, useEffect } from 'react';
import {
  X,
  Search,
  Sparkles,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  TrendingUp,
  Clock,
  User,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getScoreLabelBadge } from './engine/score-evaluator';
import type { Lead, LeadScoreCalculationResult } from '../../types/database';

interface TestScoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TestScoreModal({ isOpen, onClose }: TestScoreModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [calculation, setCalculation] = useState<LeadScoreCalculationResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelectedLead(null);
      setCalculation(null);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [isOpen]);

  const handleSearchLeads = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const term = `%${query.trim()}%`;
      const { data } = await supabase
        .from('leads')
        .select('*')
        .or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone_raw.ilike.${term}`)
        .limit(5);

      if (data) setSearchResults(data);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectLead = async (lead: Lead) => {
    setSelectedLead(lead);
    setIsEvaluating(true);
    try {
      // Execute read-only dry run calculation RPC
      const { data, error } = await supabase.rpc('recalculate_lead_score', {
        p_lead_id: lead.id,
        p_reason: 'test_score_simulation',
        p_dry_run: true,
      });

      if (error) throw error;
      if (data) setCalculation(data as LeadScoreCalculationResult);
    } catch (err) {
      console.error('Test score evaluation error:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  if (!isOpen) return null;

  const badge = calculation ? getScoreLabelBadge(calculation.label) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Lead Scoring Simulator (Test Score)</h3>
              <p className="text-xs text-gray-400">
                Dry-run simulation using production scoring engine. Zero database writes.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Lead Search Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 block">
              Select Contact to Test
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              {isSearching && (
                <Loader2 className="w-4 h-4 text-brand-500 animate-spin absolute right-3 top-2.5" />
              )}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchLeads(e.target.value)}
                placeholder="Search lead by name, email, or phone..."
                className="w-full pl-9 pr-9 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Search Results Dropdown */}
            {searchResults.length > 0 && !selectedLead && (
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 bg-gray-50/70 overflow-hidden shadow-xs">
                {searchResults.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => handleSelectLead(l)}
                    className="w-full text-left p-2.5 hover:bg-brand-50/50 transition-colors flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-gray-800">
                        {l.first_name || ''} {l.last_name || ''}
                      </span>
                      <span className="text-gray-400 ml-2">{l.email || l.phone_raw}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 font-semibold capitalize text-gray-700">
                      {l.qualification_status || 'no_response'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Evaluation Results */}
          {isEvaluating ? (
            <div className="p-12 text-center text-xs text-gray-400">
              Evaluating scoring rules against lead profile...
            </div>
          ) : selectedLead && calculation ? (
            <div className="space-y-6">
              {/* Selected Lead Summary Bar */}
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  <span className="font-bold text-gray-900">
                    {selectedLead.first_name || ''} {selectedLead.last_name || ''}
                  </span>
                  <span className="text-gray-400">({selectedLead.email})</span>
                </div>
                <button
                  onClick={() => {
                    setSelectedLead(null);
                    setCalculation(null);
                  }}
                  className="text-brand-600 hover:text-brand-700 font-semibold"
                >
                  Choose Different Lead
                </button>
              </div>

              {/* Score Summary Box */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-gray-200 bg-white text-center">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                    Final Clamped Score
                  </span>
                  <div className="flex items-baseline justify-center gap-1 mt-1">
                    <span className="text-3xl font-extrabold text-gray-900">{calculation.score}</span>
                    <span className="text-xs text-gray-400">/ 100</span>
                  </div>
                  {badge && (
                    <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {badge.label}
                    </span>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-gray-200 bg-white text-center">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block flex items-center justify-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                    Fit Subscore
                  </span>
                  <span className="text-2xl font-bold text-blue-600 mt-1 block">
                    +{calculation.fit_subtotal}
                  </span>
                </div>

                <div className="p-4 rounded-xl border border-gray-200 bg-white text-center">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block flex items-center justify-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                    Intent Subscore
                  </span>
                  <span className="text-2xl font-bold text-emerald-600 mt-1 block">
                    +{calculation.intent_subtotal}
                  </span>
                </div>

                <div className="p-4 rounded-xl border border-gray-200 bg-white text-center">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block flex items-center justify-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-purple-500" />
                    Engagement
                  </span>
                  <span className={`text-2xl font-bold mt-1 block ${calculation.engagement_subtotal < 0 ? 'text-rose-600' : 'text-purple-600'}`}>
                    {calculation.engagement_subtotal > 0 ? `+${calculation.engagement_subtotal}` : calculation.engagement_subtotal}
                  </span>
                </div>
              </div>

              {/* Matched Rules Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Matched Rules ({calculation.matched_rules.length})
                </h4>
                <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 text-xs">
                  {calculation.matched_rules.map((r) => (
                    <div key={r.rule_id} className="p-2.5 flex items-center justify-between bg-white">
                      <div>
                        <span className="font-semibold text-gray-800">{r.name}</span>
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 uppercase text-gray-500 font-bold">
                          {r.category}
                        </span>
                      </div>
                      <span className={`font-mono font-bold ${r.points > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {r.points > 0 ? `+${r.points}` : r.points} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Unmatched Rules Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-gray-400" />
                  Unmatched Rules ({calculation.unmatched_rules.length})
                </h4>
                <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-100 text-xs bg-gray-50/50">
                  {calculation.unmatched_rules.map((r) => (
                    <div key={r.rule_id} className="p-2.5 flex items-center justify-between text-gray-400">
                      <div>
                        <span>{r.name}</span>
                        <span className="ml-2 text-[10px] uppercase font-bold">{r.category}</span>
                      </div>
                      <span className="font-mono text-gray-400">{r.points > 0 ? `+${r.points}` : r.points} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              Type in the box above to search for any clinician lead and test how scoring rules apply.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs">
          <span className="text-emerald-700 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Dry-run simulation mode: changes zero live data
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
