import {
  ArrowRight,
  ArrowLeftRight,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import type { IntegrationFieldMapping } from '../../../../types';

interface HubSpotFieldMappingTabProps {
  mappings: IntegrationFieldMapping[];
  onUpdateMapping: (id: string, updates: Partial<IntegrationFieldMapping>) => Promise<void>;
  onRefreshProperties: () => Promise<void>;
  isRefreshing: boolean;
}

export function HubSpotFieldMappingTab({
  mappings,
  onUpdateMapping,
  onRefreshProperties,
  isRefreshing,
}: HubSpotFieldMappingTabProps) {

  const getDirectionBadge = (dir: string) => {
    switch (dir) {
      case 'bidirectional':
        return {
          icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
          label: 'Bidirectional',
          cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800/60',
        };
      case 'eds_to_hubspot':
        return {
          icon: <ArrowRight className="w-3.5 h-3.5" />,
          label: 'EDS → HubSpot',
          cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800/60',
        };
      default:
        return {
          icon: <ArrowLeft className="w-3.5 h-3.5" />,
          label: 'HubSpot → EDS',
          cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
        };
    }
  };

  const getSourceOfTruthBadge = (sot: string) => {
    switch (sot) {
      case 'hubspot':
        return { label: 'HubSpot Owned', cls: 'text-orange-700 bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800' };
      case 'eds':
        return { label: 'EDS Owned', cls: 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800' };
      default:
        return { label: 'Bidirectional Newest', cls: 'text-purple-700 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800' };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Field Mapping Registry
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Centralized versioned mapping rules controlling direction, source of truth, and transformations.
          </p>
        </div>

        <button
          onClick={onRefreshProperties}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing Properties...' : 'Refresh Properties'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/75 dark:bg-gray-800/50">
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">HubSpot Property</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Direction</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">EDS HUB Target</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Source of Truth</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Transform</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Allow Clear</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Version</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {mappings.map((m) => {
                const dirBadge = getDirectionBadge(m.direction);
                const sotBadge = getSourceOfTruthBadge(m.source_of_truth);

                return (
                  <tr key={m.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-750 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-white">
                      {m.external_property}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${dirBadge.cls}`}>
                        {dirBadge.icon}
                        {dirBadge.label}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-gray-800 dark:text-gray-200">
                          {m.eds_target}
                        </span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          {m.target_type}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${sotBadge.cls}`}>
                        {sotBadge.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-[11px]">
                      {m.transform_rule}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        m.allow_clear
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      }`}>
                        {m.allow_clear ? 'Allowed' : 'Protected'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      v{m.mapping_version}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onUpdateMapping(m.id, { is_active: !m.is_active })}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                          m.is_active
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {m.is_active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {mappings.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No field mappings registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
