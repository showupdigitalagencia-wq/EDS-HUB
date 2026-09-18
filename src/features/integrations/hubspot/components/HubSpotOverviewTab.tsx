import { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RefreshCw,
  PowerOff,
  Copy,
  Check,
  Play,
  Layers,
} from 'lucide-react';
import type { HubSpotSyncMetrics, IntegrationConnection } from '../../../../types';

interface HubSpotOverviewTabProps {
  metrics: HubSpotSyncMetrics | null;
  connection: IntegrationConnection | null;
  onRefresh: () => void;
  onRunDryRun: () => void;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}

export function HubSpotOverviewTab({
  metrics,
  connection,
  onRefresh,
  onRunDryRun,
  onDisconnect,
  isDisconnecting,
}: HubSpotOverviewTabProps) {
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${window.location.origin.replace('http://localhost:5173', 'https://xogcexclqiornuscsdmn.supabase.co')}/functions/v1/hubspot-webhook`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'connected':
        return {
          label: 'Connected',
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
          dot: 'bg-emerald-500',
        };
      case 'degraded':
        return {
          label: 'Degraded',
          bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60',
          dot: 'bg-amber-500',
        };
      case 'disconnected':
        return {
          label: 'Disconnected',
          bg: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
          dot: 'bg-slate-400',
        };
      default:
        return {
          label: 'Configuration Required',
          bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60',
          dot: 'bg-blue-500',
        };
    }
  };

  const badge = getStatusBadge(connection?.status);

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Linked Contacts */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Contacts Linked
            </span>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {metrics?.linked_count ?? 0}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Active identity pairings
            </p>
          </div>
        </div>

        {/* Pending Outbox */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Pending Outbox
            </span>
            <div className="p-2 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {metrics?.pending_outbox ?? 0}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Queued for HubSpot push
            </p>
          </div>
        </div>

        {/* Sync Errors */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Sync Errors
            </span>
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {metrics?.sync_errors ?? 0}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Failed or dead-letter events
            </p>
          </div>
        </div>

        {/* Open Conflicts */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Open Conflicts
            </span>
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {metrics?.conflicts_count ?? 0}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Pending manual review
            </p>
          </div>
        </div>
      </div>

      {/* Main Connection Status Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 flex items-center justify-center text-orange-600 font-bold text-lg">
              HS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  HubSpot CRM Integration
                </h3>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${badge.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                  {badge.label}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Continuous bidirectional sync with persistent identity linking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRunDryRun}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#08254f] text-white hover:bg-[#0c3672] transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5" />
              Run Dry Sync
            </button>
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            {connection?.status === 'connected' && (
              <button
                onClick={onDisconnect}
                disabled={isDisconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-200 dark:border-rose-800 transition-colors"
              >
                <PowerOff className="w-3.5 h-3.5" />
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Properties */}
          <div className="space-y-4 text-xs">
            <div>
              <span className="text-gray-500 dark:text-gray-400 block mb-1">Architecture Model</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">
                HubSpot Private App Token (Internal Org CRM) + Webhook v3
              </span>
            </div>

            <div>
              <span className="text-gray-500 dark:text-gray-400 block mb-1">Portal / Hub ID</span>
              <span className="font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-2 py-0.5 rounded">
                {connection?.portal_id || 'Pending Setup'}
              </span>
            </div>

            <div>
              <span className="text-gray-500 dark:text-gray-400 block mb-1">Last Health Check</span>
              <span className="text-gray-700 dark:text-gray-300">
                {connection?.last_health_check_at
                  ? new Date(connection.last_health_check_at).toLocaleString()
                  : 'Pending first check'}
              </span>
            </div>

            <div>
              <span className="text-gray-500 dark:text-gray-400 block mb-1">Last Inbound Webhook</span>
              <span className="text-gray-700 dark:text-gray-300">
                {connection?.last_webhook_at
                  ? new Date(connection.last_webhook_at).toLocaleString()
                  : 'No webhooks received yet'}
              </span>
            </div>
          </div>

          {/* Right Column: Webhook Listener Endpoint */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">
                Inbound Webhook URL (HubSpot App &rarr; EDS HUB)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-mono px-3 py-2 rounded-lg select-all"
                />
                <button
                  onClick={copyWebhookUrl}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedWebhook ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Configure this URL in your HubSpot App Webhooks with secret validation (<code className="text-gray-700 dark:text-gray-300">X-HubSpot-Signature-v3</code>).
              </p>
            </div>

            {/* Architecture Highlights Pill */}
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-xs space-y-2 text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                <Layers className="w-4 h-4 text-[#08254f] dark:text-[#449bd5]" />
                <span>Governance Guarantees Active</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                <li><strong>Loop Prevention:</strong> Transaction-local sync origin + SHA-256 payload hashing</li>
                <li><strong>Transactional Outbox:</strong> Zero frontend delay & guaranteed outbound delivery</li>
                <li><strong>Automation Safety:</strong> Sync updates strictly suppress automated outreach</li>
                <li><strong>Protected Core Fields:</strong> Contact preference, lead scores & courses strictly EDS-owned</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
