import { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  X,
} from 'lucide-react';
import type { IntegrationConflict } from '../../../../types';

interface HubSpotConflictsTabProps {
  conflicts: IntegrationConflict[];
  onResolveConflict: (
    conflictId: string,
    resolution: 'resolved_hubspot_wins' | 'resolved_eds_wins' | 'dismissed',
    notes?: string
  ) => Promise<void>;
  onRefresh: () => void;
  isLoading: boolean;
}

export function HubSpotConflictsTab({
  conflicts,
  onResolveConflict,
  onRefresh,
  isLoading,
}: HubSpotConflictsTabProps) {
  const [selectedConflict, setSelectedConflict] = useState<IntegrationConflict | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResolve = async (
    resolution: 'resolved_hubspot_wins' | 'resolved_eds_wins' | 'dismissed'
  ) => {
    if (!selectedConflict) return;
    setIsSubmitting(true);
    try {
      await onResolveConflict(selectedConflict.id, resolution, resolutionNotes);
      setSelectedConflict(null);
      setResolutionNotes('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getConflictBadge = (type: string) => {
    switch (type) {
      case 'MULTIPLE_EMAIL_MATCH':
      case 'MULTIPLE_PHONE_MATCH':
        return { label: 'Ambiguous Match', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400' };
      case 'EMAIL_COLLISION':
      case 'PHONE_COLLISION':
        return { label: 'Data Collision', cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400' };
      case 'MAPPING_VALUE_UNKNOWN':
        return { label: 'Unknown Enum Value', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400' };
      default:
        return { label: type, cls: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300' };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Conflict Resolution Queue
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Ambiguous identity matches and data collisions routed for manual inspection.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors self-start sm:self-auto"
          title="Refresh conflicts"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Conflicts List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/75 dark:bg-gray-800/50">
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Conflict Type</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Summary</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">External Contact ID</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Detected</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {conflicts.map((c) => {
                const badge = getConflictBadge(c.conflict_type);

                return (
                  <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-750 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-900 dark:text-white font-medium max-w-xs truncate">
                      {c.conflict_summary}
                    </td>

                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300">
                      {c.external_entity_id || '—'}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                        c.status === 'pending_review'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      }`}>
                        {c.status === 'pending_review' ? 'Pending Review' : c.status}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {c.status === 'pending_review' ? (
                        <button
                          onClick={() => setSelectedConflict(c)}
                          className="px-2.5 py-1 bg-[#08254f] text-white hover:bg-[#0c3672] text-[11px] font-medium rounded-lg transition-colors"
                        >
                          Resolve
                        </button>
                      ) : (
                        <span className="text-gray-400 text-xs">Resolved</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {conflicts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                    No unresolved sync conflicts in queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resolution Modal */}
      {selectedConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                Resolve Integration Conflict
              </h4>
              <button
                onClick={() => setSelectedConflict(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300">
              {selectedConflict.conflict_summary}
            </p>

            {/* Side-by-Side Comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 rounded-lg text-xs space-y-2">
                <span className="font-semibold text-orange-900 dark:text-orange-300 block">
                  HubSpot Data
                </span>
                <pre className="text-[11px] font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-36">
                  {JSON.stringify(selectedConflict.hubspot_data, null, 2)}
                </pre>
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 rounded-lg text-xs space-y-2">
                <span className="font-semibold text-blue-900 dark:text-blue-300 block">
                  EDS HUB Data
                </span>
                <pre className="text-[11px] font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-36">
                  {JSON.stringify(selectedConflict.eds_data, null, 2)}
                </pre>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">
                Resolution Notes (Optional)
              </label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Document reason for chosen resolution..."
                className="w-full text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#08254f]"
                rows={2}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setSelectedConflict(null)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleResolve('dismissed')}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Dismiss / Keep As-Is
              </button>
              <button
                onClick={() => handleResolve('resolved_eds_wins')}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
              >
                Use EDS Value
              </button>
              <button
                onClick={() => handleResolve('resolved_hubspot_wins')}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
              >
                Accept HubSpot Value
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
