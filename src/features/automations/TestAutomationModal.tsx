import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  Check,
  ShieldCheck,
} from 'lucide-react';
import type { AutomationStep } from '../../types/database';
import { simulateAutomationExecution } from './engine/automation-evaluator';

interface TestAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  automationName: string;
  steps: AutomationStep[];
}

interface TestLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  contact_preference: string;
  course_interest: string | null;
  qualification_status: string | null;
  pipeline_stage_id: string | null;
  source: string;
  source_detail: string | null;
}

export function TestAutomationModal({
  isOpen,
  onClose,
  automationName,
  steps,
}: TestAutomationModalProps) {
  const [leads, setLeads] = useState<TestLead[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<TestLead | null>(null);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [simulationResult, setSimulationResult] = useState<ReturnType<typeof simulateAutomationExecution> | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadLeads();
      setSimulationResult(null);
    }
  }, [isOpen]);

  const loadLeads = async () => {
    setIsLoadingLeads(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, first_name, last_name, email, phone_raw, phone_e164, contact_preference, course_interest, qualification_status, pipeline_stage_id, source, source_detail')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setLeads(data || []);
      if (data && data.length > 0 && !selectedLead) {
        setSelectedLead(data[0]);
      }
    } catch (err) {
      console.error('Failed to load test leads:', err);
    } finally {
      setIsLoadingLeads(false);
    }
  };

  const handleRunSimulation = () => {
    if (!selectedLead) return;
    setIsSimulating(true);

    // Run client-side simulation using the shared evaluator (100% dry run, zero side-effects)
    const report = simulateAutomationExecution(steps, {
      id: selectedLead.id,
      first_name: selectedLead.first_name,
      last_name: selectedLead.last_name,
      email: selectedLead.email,
      phone_raw: selectedLead.phone_raw,
      phone_e164: selectedLead.phone_e164,
      contact_preference: selectedLead.contact_preference,
      course_interest: selectedLead.course_interest,
      qualification_status: selectedLead.qualification_status,
      pipeline_stage_id: selectedLead.pipeline_stage_id,
      source: selectedLead.source,
      source_detail: selectedLead.source_detail,
    });

    setSimulationResult(report);
    setIsSimulating(false);
  };

  if (!isOpen) return null;

  const filteredLeads = leads.filter((l) => {
    const q = searchQuery.toLowerCase();
    const name = `${l.first_name || ''} ${l.last_name || ''}`.toLowerCase();
    const email = (l.email || '').toLowerCase();
    const phone = (l.phone_raw || '').toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-100 text-amber-800 border border-amber-200">
                Dry Run
              </span>
              <h2 className="text-base font-bold text-gray-900">
                Test Automation: {automationName}
              </h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Simulate step evaluation against a test lead without sending real messages or modifying data.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Lead Picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              1. Select Test Lead
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search leads by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>

            {isLoadingLeads ? (
              <div className="py-4 text-center text-xs text-gray-400">Loading leads...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-1 border border-gray-100 rounded-xl bg-gray-50/50">
                {filteredLeads.map((lead) => {
                  const isSelected = selectedLead?.id === lead.id;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => {
                        setSelectedLead(lead);
                        setSimulationResult(null);
                      }}
                      className={`text-left p-2 rounded-lg border text-xs transition-all ${
                        isSelected
                          ? 'border-brand-500 bg-brand-50/50 text-brand-900 shadow-xs'
                          : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold truncate">
                          {`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.email || 'Lead'}
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-brand-600 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-1">
                        <span className="px-1.5 py-0.2 rounded bg-gray-100 uppercase font-mono">
                          Pref: {lead.contact_preference}
                        </span>
                        {lead.course_interest && (
                          <span className="truncate">Course: {lead.course_interest}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Lead Info Badge */}
          {selectedLead && (
            <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl text-xs space-y-1">
              <div className="flex items-center justify-between text-blue-900 font-semibold">
                <span>Active Test Context: {selectedLead.first_name} {selectedLead.last_name}</span>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md uppercase font-bold text-[10px]">
                  Preference: {selectedLead.contact_preference}
                </span>
              </div>
              <p className="text-blue-700 text-[11px]">
                Email: {selectedLead.email || '—'} | Phone: {selectedLead.phone_raw || '—'} | Course: {selectedLead.course_interest || 'None'} | Stage: {selectedLead.qualification_status || 'Unset'}
              </p>
            </div>
          )}

          {/* Simulation Output */}
          {simulationResult && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                2. Simulation Trace ({simulationResult.steps_evaluated.length} Steps)
              </label>

              <div className="space-y-2 border border-gray-200 rounded-xl p-3 bg-gray-50/50 max-h-72 overflow-y-auto">
                {simulationResult.steps_evaluated.map((step) => {
                  return (
                    <div
                      key={step.step_order}
                      className="p-3 bg-white border border-gray-200 rounded-xl space-y-1 shadow-2xs"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-bold">
                            {step.step_order}
                          </span>
                          <span className="uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">
                            {step.step_type}
                          </span>
                          {step.action_type && (
                            <span className="font-mono text-gray-700">
                              {step.action_type}
                            </span>
                          )}
                        </span>

                        {step.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" /> Would Execute
                          </span>
                        )}
                        {step.status === 'skipped' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertCircle className="h-3 w-3" /> Would Skip
                          </span>
                        )}
                        {step.status === 'waiting' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            <Clock className="h-3 w-3" /> Server Wait
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-gray-700 pl-6">{step.summary}</p>

                      {step.skip_reason_message && (
                        <p className="text-[11px] text-amber-700 pl-6 font-medium">
                          Reason: {step.skip_reason_message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Zero real emails or SMS sent. Strictly safe simulation.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleRunSimulation}
              disabled={!selectedLead || isSimulating}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs disabled:opacity-50 transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
              {isSimulating ? 'Simulating...' : 'Run Simulation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
