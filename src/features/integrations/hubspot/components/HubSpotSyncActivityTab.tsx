import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Eye,
  X,
} from 'lucide-react';
import type { IntegrationSyncEvent } from '../../../../types';

interface HubSpotSyncActivityTabProps {
  events: IntegrationSyncEvent[];
  filterStatus: string;
  onFilterChange: (status: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export function HubSpotSyncActivityTab({
  events,
  filterStatus,
  onFilterChange,
  onRefresh,
  isLoading,
}: HubSpotSyncActivityTabProps) {
  const [selectedEvent, setSelectedEvent] = useState<IntegrationSyncEvent | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400' };
      case 'ignored_duplicate':
        return { label: 'Duplicate Ignored', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300' };
      case 'ignored_echo':
        return { label: 'Loop Echo Ignored', cls: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400' };
      case 'ignored_stale':
        return { label: 'Stale Event Ignored', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400' };
      case 'conflict':
        return { label: 'Conflict Flagged', cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400' };
      case 'failed':
      case 'dead_letter':
        return { label: status === 'dead_letter' ? 'Dead Letter' : 'Failed', cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400' };
      default:
        return { label: status, cls: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300' };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Sync Activity & Audit Log
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Immutable log of inbound webhooks, outbound dispatches, loop suppression, and idempotency events.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => onFilterChange(e.target.value)}
            className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#08254f]"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="ignored_duplicate">Duplicate Ignored</option>
            <option value="ignored_echo">Loop Echo Ignored</option>
            <option value="ignored_stale">Stale Ignored</option>
            <option value="conflict">Conflicts</option>
            <option value="failed">Failed / Dead Letter</option>
          </select>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors"
            title="Refresh events"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/75 dark:bg-gray-800/50">
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Direction</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Event Type</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Contact / External ID</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Attempts</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Timestamp (UTC)</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {events.map((ev) => {
                const badge = getStatusBadge(ev.status);
                const isInbound = ev.direction === 'inbound';

                return (
                  <tr key={ev.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-750 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                        isInbound
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400'
                      }`}>
                        {isInbound ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {isInbound ? 'Inbound' : 'Outbound'}
                      </span>
                    </td>

                    <td className="px-4 py-3 font-mono text-gray-800 dark:text-gray-200">
                      {ev.event_type}
                    </td>

                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300">
                      {ev.external_entity_id || '—'}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {ev.attempt_count} / {ev.max_attempts}
                    </td>

                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(ev.created_at).toUTCString()}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedEvent(ev)}
                        className="inline-flex items-center gap-1 text-[#08254f] dark:text-[#449bd5] hover:underline font-medium text-xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}

              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No sync activity recorded matching current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Event Details Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                Sync Event Diagnostics
              </h4>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Event ID</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{selectedEvent.id}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400 block mb-0.5">External Event ID</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{selectedEvent.external_event_id || '—'}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Payload Hash (SHA-256)</span>
                <span className="font-mono text-gray-700 dark:text-gray-300 break-all text-[11px] bg-gray-50 dark:bg-gray-900 p-1 rounded">
                  {selectedEvent.payload_hash}
                </span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Mapping Version</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {selectedEvent.mapping_version ? `v${selectedEvent.mapping_version}` : 'N/A'}
                </span>
              </div>
            </div>

            {selectedEvent.error_message && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-xs text-rose-700 dark:text-rose-400">
                <span className="font-semibold block mb-1">Error Message:</span>
                {selectedEvent.error_message}
              </div>
            )}

            <div>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                Change Summary / Payload:
              </span>
              <pre className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-48">
                {JSON.stringify(selectedEvent.change_summary, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs font-medium rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
