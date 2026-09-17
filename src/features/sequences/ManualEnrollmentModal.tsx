import { useState, useEffect } from 'react';
import { X, GitFork, Play, AlertCircle, CheckCircle2, ShieldAlert, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Automation, AutomationStep } from '../../types/database';

interface ManualEnrollmentModalProps {
  isOpen: boolean;
  leadId: string;
  leadName: string;
  onClose: () => void;
  onEnrolled: () => void;
}

interface SequenceWithSteps extends Automation {
  steps?: AutomationStep[];
}

export function ManualEnrollmentModal({
  isOpen,
  leadId,
  leadName,
  onClose,
  onEnrolled,
}: ManualEnrollmentModalProps) {
  const [sequences, setSequences] = useState<SequenceWithSteps[]>([]);
  const [selectedSeqId, setSelectedSeqId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const loadActiveSequences = async () => {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);
      try {
        const { data, error: err } = await supabase
          .from('automations')
          .select('*, automation_versions(id, version, status)')
          .eq('automation_type', 'sequence')
          .eq('status', 'active')
          .order('name');

        if (err) throw err;
        setSequences(data || []);
        if (data && data.length > 0) {
          setSelectedSeqId(data[0].id);
        }
      } catch (err: any) {
        console.error('Failed to load active sequences:', err);
        setError('Failed to load active sequences.');
      } finally {
        setIsLoading(false);
      }
    };

    loadActiveSequences();
  }, [isOpen]);

  const selectedSeq = sequences.find((s) => s.id === selectedSeqId);

  const handleEnroll = async () => {
    if (!selectedSeqId) return;

    setIsEnrolling(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('manual_enroll_lead_in_sequence' as any, {
        p_lead_id: leadId,
        p_sequence_id: selectedSeqId,
      });

      if (rpcErr) throw rpcErr;

      const res = data as { success: boolean; run_id?: string; error?: string; message?: string };

      if (!res.success) {
        setError(res.error || 'Failed to enroll lead');
        return;
      }

      setSuccessMessage('Lead enrolled successfully!');

      // Trigger background runner asynchronously
      if (res.run_id) {
        supabase.functions.invoke('execute-automation-run', {
          body: { automation_run_id: res.run_id },
        }).catch((err) => console.warn('Async runner dispatch error:', err));
      }

      setTimeout(() => {
        onEnrolled();
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Enrollment error:', err);
      setError(err.message || 'An unexpected error occurred during enrollment.');
    } finally {
      setIsEnrolling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 via-white to-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-xs">
              <GitFork className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Enroll in Sequence</h3>
              <p className="text-xs text-gray-500">
                Enrolling <strong className="text-gray-800">{leadName}</strong> into a multi-touch cadence.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-8 text-center text-xs text-gray-400">Loading active sequences...</div>
          ) : sequences.length === 0 ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-xs text-gray-500">No active follow-up sequences found.</p>
              <p className="text-[11px] text-gray-400">Create and activate a sequence under the Sequences menu first.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Select Sequence
                </label>
                <select
                  value={selectedSeqId}
                  onChange={(e) => setSelectedSeqId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  {sequences.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (v{s.current_version})
                    </option>
                  ))}
                </select>
              </div>

              {selectedSeq && (
                <div className="p-4 bg-gray-50/80 border border-gray-200 rounded-2xl space-y-2.5">
                  <div className="text-xs text-gray-700 leading-relaxed font-medium">
                    {selectedSeq.description || 'No description provided for this sequence.'}
                  </div>

                  {selectedSeq.stop_conditions && selectedSeq.stop_conditions.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Stops automatically when qualification becomes:{' '}
                        <strong>{selectedSeq.stop_conditions[0].values?.join(', ')}</strong>
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[11px] text-gray-400 pt-1 border-t border-gray-100">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Starts immediately upon enrollment</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-200/60 font-semibold text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleEnroll}
            disabled={!selectedSeqId || isEnrolling || sequences.length === 0}
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-xs transition-all flex items-center gap-2 shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isEnrolling ? 'Enrolling...' : 'Confirm Enrollment'}
          </button>
        </div>
      </div>
    </div>
  );
}
