import { useState, useEffect, useCallback } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { syncLeadNow } from '../../integrations/hubspot/services/hubspot-service';
import type { IntegrationEntityLink, IntegrationConflict } from '../../../types';

interface LeadHubSpotCardProps {
  leadId: string;
  hubspotContactId?: string | null;
  onLeadUpdated?: () => void;
}

export function LeadHubSpotCard({
  leadId,
  hubspotContactId,
  onLeadUpdated,
}: LeadHubSpotCardProps) {
  const [link, setLink] = useState<IntegrationEntityLink | null>(null);
  const [conflict, setConflict] = useState<IntegrationConflict | null>(null);
  const [portalId, setPortalId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const loadLinkData = useCallback(async () => {
    try {
      const [linkRes, conflictRes, connRes] = await Promise.all([
        supabase
          .from('integration_entity_links')
          .select('*')
          .eq('eds_entity_id', leadId)
          .eq('status', 'active')
          .single(),
        supabase
          .from('integration_conflicts')
          .select('*')
          .eq('eds_entity_id', leadId)
          .eq('status', 'pending_review')
          .maybeSingle(),
        supabase
          .from('integration_connections')
          .select('portal_id')
          .eq('provider', 'hubspot')
          .single(),
      ]);

      if (linkRes.data) setLink(linkRes.data as IntegrationEntityLink);
      if (conflictRes.data) setConflict(conflictRes.data as IntegrationConflict);
      if (connRes.data?.portal_id) setPortalId(connRes.data.portal_id);
    } catch {
      // Non-fatal
    }
  }, [leadId]);

  useEffect(() => {
    loadLinkData();
  }, [loadLinkData]);

  const activeContactId = link?.external_entity_id || hubspotContactId;
  const isLinked = Boolean(activeContactId);

  const copyContactId = () => {
    if (!activeContactId) return;
    navigator.clipboard.writeText(activeContactId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await syncLeadNow(leadId);
      setSyncFeedback(res.message);
      setTimeout(() => setSyncFeedback(null), 4000);
      await loadLinkData();
      if (onLeadUpdated) onLeadUpdated();
    } catch (err: any) {
      setSyncFeedback('Error: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const hubspotUrl = activeContactId && portalId
    ? `https://app.hubspot.com/contacts/${portalId}/contact/${activeContactId}`
    : activeContactId
    ? `https://app.hubspot.com/contacts/contact/${activeContactId}`
    : null;

  return (
    <div className="card-executive p-6 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 flex items-center justify-center text-orange-600 font-bold text-xs">
            HS
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#08254f] dark:text-white font-heading uppercase tracking-wider">
              HubSpot Integration
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Persistent bidirectional sync
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
            conflict
              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400'
              : isLinked
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
              : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              conflict ? 'bg-amber-500' : isLinked ? 'bg-emerald-500' : 'bg-slate-400'
            }`}
          />
          {conflict ? 'Conflict Detected' : isLinked ? 'Linked' : 'Not Linked'}
        </span>
      </div>

      {conflict && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Sync Conflict Pending</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {conflict.conflict_summary}
            </p>
            <a
              href="/settings?tab=integrations"
              className="inline-block font-semibold text-amber-900 dark:text-amber-200 underline text-[11px]"
            >
              Review in Settings &rarr; Conflicts
            </a>
          </div>
        </div>
      )}

      {/* Details List */}
      <div className="space-y-2.5 text-xs">
        <div>
          <span className="text-slate-400 dark:text-gray-500 block mb-0.5">HubSpot Contact ID</span>
          {activeContactId ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-gray-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-gray-700">
                {activeContactId}
              </span>
              <button
                type="button"
                onClick={copyContactId}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Copy ID"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {hubspotUrl && (
                <a
                  href={hubspotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#08254f] dark:text-[#449bd5] hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in HubSpot
                </a>
              )}
            </div>
          ) : (
            <span className="text-slate-400 italic">No external contact linked</span>
          )}
        </div>

        {link && (
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            <div>
              <span className="text-slate-400 block mb-0.5">Last Inbound Sync</span>
              <span className="text-slate-700 dark:text-slate-300">
                {link.last_inbound_sync_at
                  ? new Date(link.last_inbound_sync_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                  : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Last Outbound Sync</span>
              <span className="text-slate-700 dark:text-slate-300">
                {link.last_outbound_sync_at
                  ? new Date(link.last_outbound_sync_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                  : '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      {syncFeedback && (
        <div className="p-2.5 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg text-xs text-slate-700 dark:text-slate-300">
          {syncFeedback}
        </div>
      )}

      {/* Sync Now Action Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={isSyncing}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 dark:bg-gray-800 dark:hover:bg-gray-750 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-gray-700 transition-colors shadow-xs disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync with HubSpot Now'}
        </button>
      </div>
    </div>
  );
}
