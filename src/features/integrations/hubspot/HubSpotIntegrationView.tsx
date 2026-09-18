import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Sliders,
  Activity,
  ShieldAlert,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { HubSpotOverviewTab } from './components/HubSpotOverviewTab';
import { HubSpotFieldMappingTab } from './components/HubSpotFieldMappingTab';
import { HubSpotSyncActivityTab } from './components/HubSpotSyncActivityTab';
import { HubSpotConflictsTab } from './components/HubSpotConflictsTab';
import { HubSpotDryRunModal } from './components/HubSpotDryRunModal';
import {
  fetchHubSpotConnection,
  fetchHubSpotMetrics,
  fetchFieldMappings,
  updateFieldMapping,
  fetchSyncEvents,
  fetchConflicts,
  resolveConflict,
  refreshProperties,
  runDryRunSync,
  disconnectHubSpot,
} from './services/hubspot-service';
import type {
  HubSpotSyncMetrics,
  IntegrationConnection,
  IntegrationFieldMapping,
  IntegrationSyncEvent,
  IntegrationConflict,
} from '../../../types';

export function HubSpotIntegrationView() {
  const [subTab, setSubTab] = useState<'overview' | 'mapping' | 'activity' | 'conflicts'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [connection, setConnection] = useState<IntegrationConnection | null>(null);
  const [metrics, setMetrics] = useState<HubSpotSyncMetrics | null>(null);
  const [mappings, setMappings] = useState<IntegrationFieldMapping[]>([]);
  const [events, setEvents] = useState<IntegrationSyncEvent[]>([]);
  const [conflicts, setConflicts] = useState<IntegrationConflict[]>([]);

  // Filters & Action States
  const [eventFilter, setEventFilter] = useState('all');
  const [isRefreshingProps, setIsRefreshingProps] = useState(false);
  const [isDryRunModalOpen, setIsDryRunModalOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [conn, met, maps, evs, confs] = await Promise.all([
        fetchHubSpotConnection().catch(() => null),
        fetchHubSpotMetrics().catch(() => null),
        fetchFieldMappings().catch(() => []),
        fetchSyncEvents(50, eventFilter).catch(() => []),
        fetchConflicts().catch(() => []),
      ]);

      setConnection(conn);
      setMetrics(met);
      setMappings(maps);
      setEvents(evs);
      setConflicts(confs);
    } catch (err: any) {
      setError(err.message || 'Failed to load HubSpot integration data');
    } finally {
      setIsLoading(false);
    }
  }, [eventFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdateMapping = async (id: string, updates: Partial<IntegrationFieldMapping>) => {
    try {
      const updated = await updateFieldMapping(id, updates);
      setMappings((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err: any) {
      alert('Failed to update mapping: ' + err.message);
    }
  };

  const handleRefreshProperties = async () => {
    setIsRefreshingProps(true);
    try {
      await refreshProperties();
      await loadData();
    } catch (err: any) {
      alert('Failed to refresh properties: ' + err.message);
    } finally {
      setIsRefreshingProps(false);
    }
  };

  const handleResolveConflict = async (
    conflictId: string,
    resolution: 'resolved_hubspot_wins' | 'resolved_eds_wins' | 'dismissed',
    notes?: string
  ) => {
    await resolveConflict(conflictId, resolution, notes);
    await loadData();
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect HubSpot? Active CRM leads and sync history will be safely preserved.')) {
      return;
    }
    setIsDisconnecting(true);
    try {
      await disconnectHubSpot();
      await loadData();
    } catch (err: any) {
      alert('Failed to disconnect: ' + err.message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading && !connection) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading HubSpot integration state...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-3 text-xs text-rose-700 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sub-navigation tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 space-x-6">
        <button
          onClick={() => setSubTab('overview')}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            subTab === 'overview'
              ? 'border-[#08254f] text-[#08254f] dark:border-[#449bd5] dark:text-[#449bd5]'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          Overview
        </button>

        <button
          onClick={() => setSubTab('mapping')}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            subTab === 'mapping'
              ? 'border-[#08254f] text-[#08254f] dark:border-[#449bd5] dark:text-[#449bd5]'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Field Mapping ({mappings.length})
        </button>

        <button
          onClick={() => setSubTab('activity')}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            subTab === 'activity'
              ? 'border-[#08254f] text-[#08254f] dark:border-[#449bd5] dark:text-[#449bd5]'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Activity className="w-4 h-4" />
          Sync Activity
        </button>

        <button
          onClick={() => setSubTab('conflicts')}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            subTab === 'conflicts'
              ? 'border-[#08254f] text-[#08254f] dark:border-[#449bd5] dark:text-[#449bd5]'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Conflicts ({conflicts.length})
        </button>
      </div>

      {/* Tab Panels */}
      {subTab === 'overview' && (
        <HubSpotOverviewTab
          metrics={metrics}
          connection={connection}
          onRefresh={loadData}
          onRunDryRun={() => setIsDryRunModalOpen(true)}
          onDisconnect={handleDisconnect}
          isDisconnecting={isDisconnecting}
        />
      )}

      {subTab === 'mapping' && (
        <HubSpotFieldMappingTab
          mappings={mappings}
          onUpdateMapping={handleUpdateMapping}
          onRefreshProperties={handleRefreshProperties}
          isRefreshing={isRefreshingProps}
        />
      )}

      {subTab === 'activity' && (
        <HubSpotSyncActivityTab
          events={events}
          filterStatus={eventFilter}
          onFilterChange={setEventFilter}
          onRefresh={loadData}
          isLoading={isLoading}
        />
      )}

      {subTab === 'conflicts' && (
        <HubSpotConflictsTab
          conflicts={conflicts}
          onResolveConflict={handleResolveConflict}
          onRefresh={loadData}
          isLoading={isLoading}
        />
      )}

      {/* Dry Run Simulation Modal */}
      <HubSpotDryRunModal
        isOpen={isDryRunModalOpen}
        onClose={() => setIsDryRunModalOpen(false)}
        onExecuteDryRun={async () => {
          return await runDryRunSync();
        }}
      />
    </div>
  );
}
