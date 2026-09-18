import { useState } from 'react';
import {
  Play,
  X,
  Loader2,
  FileCheck,
} from 'lucide-react';
import type { HubSpotDryRunResult } from '../../../../types';

interface HubSpotDryRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteDryRun: () => Promise<HubSpotDryRunResult>;
}

export function HubSpotDryRunModal({
  isOpen,
  onClose,
  onExecuteDryRun,
}: HubSpotDryRunModalProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<HubSpotDryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await onExecuteDryRun();
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to execute Dry Run simulation');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl max-w-lg w-full p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Play className="w-4 h-4 text-[#08254f] dark:text-[#449bd5]" />
            HubSpot Initial Sync — Dry Run Mode
          </h4>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-lg text-xs text-blue-800 dark:text-blue-300 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <FileCheck className="w-4 h-4" />
            Zero-Mutation Simulation Guarantee
          </p>
          <p className="text-[11px] text-blue-700 dark:text-blue-400">
            A Dry Run tests identity matching, normalization, and deduplication without modifying any leads, links, or activities in the database.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-xs text-rose-700 dark:text-rose-400">
            {error}
          </div>
        )}

        {/* Results Card */}
        {result ? (
          <div className="space-y-3">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 block">
              Simulation Results:
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400 block text-[11px]">Total Scanned</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">{result.scanned}</span>
              </div>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                <span className="text-emerald-700 dark:text-emerald-400 block text-[11px]">Matched Existing</span>
                <span className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{result.matched}</span>
              </div>
              <div className="p-3 bg-sky-50 dark:bg-sky-950/30 rounded-lg border border-sky-200 dark:border-sky-800/40">
                <span className="text-sky-700 dark:text-sky-400 block text-[11px]">Would Update</span>
                <span className="text-lg font-bold text-sky-800 dark:text-sky-300">{result.would_update}</span>
              </div>
              <div className="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800/40">
                <span className="text-purple-700 dark:text-purple-400 block text-[11px]">Would Create (New)</span>
                <span className="text-lg font-bold text-purple-800 dark:text-purple-300">{result.would_create}</span>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800/40">
                <span className="text-amber-700 dark:text-amber-400 block text-[11px]">Potential Conflicts</span>
                <span className="text-lg font-bold text-amber-800 dark:text-amber-300">{result.conflicts}</span>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400 block text-[11px]">Skipped</span>
                <span className="text-lg font-bold text-gray-700 dark:text-gray-300">{result.skipped}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-xs text-gray-500 dark:text-gray-400">
            Click below to execute the simulation.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#08254f] text-white hover:bg-[#0c3672] text-xs font-medium rounded-lg transition-colors shadow-sm disabled:opacity-60"
          >
            {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isRunning ? 'Simulating...' : result ? 'Re-run Simulation' : 'Start Dry Run'}
          </button>
        </div>
      </div>
    </div>
  );
}
