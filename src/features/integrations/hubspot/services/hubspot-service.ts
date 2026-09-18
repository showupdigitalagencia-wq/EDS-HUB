// =============================================================================
// HubSpot Integration Service
// =============================================================================
// Encapsulates all interactions with integration schema, Edge Functions,
// and atomic PostgreSQL RPCs for continuous sync governance.
// =============================================================================

import { supabase } from '../../../../lib/supabase';
import type {
  IntegrationConnection,
  IntegrationFieldMapping,
  IntegrationSyncEvent,
  IntegrationConflict,
  IntegrationPropertyCache,
  HubSpotSyncMetrics,
  HubSpotDryRunResult,
} from '../../../../types';

/**
 * Fetches the HubSpot singleton connection record.
 */
export async function fetchHubSpotConnection(): Promise<IntegrationConnection | null> {
  const { data, error } = await supabase
    .from('integration_connections')
    .select('*')
    .eq('provider', 'hubspot')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // No row
    throw error;
  }
  return data as IntegrationConnection;
}

/**
 * Fetches real-time integration operational metrics via atomic RPC.
 */
export async function fetchHubSpotMetrics(): Promise<HubSpotSyncMetrics> {
  const { data, error } = await supabase.rpc('get_hubspot_sync_metrics');
  if (error) throw error;
  return data as HubSpotSyncMetrics;
}

/**
 * Fetches all registered field mappings.
 */
export async function fetchFieldMappings(): Promise<IntegrationFieldMapping[]> {
  const { data, error } = await supabase
    .from('integration_field_mappings')
    .select('*')
    .eq('integration', 'hubspot')
    .order('is_active', { ascending: false })
    .order('external_property', { ascending: true });

  if (error) throw error;
  return (data || []) as IntegrationFieldMapping[];
}

/**
 * Updates an active field mapping and archives previous state to history.
 */
export async function updateFieldMapping(
  id: string,
  updates: Partial<IntegrationFieldMapping>,
  changeReason?: string
): Promise<IntegrationFieldMapping> {
  // 1. Fetch current mapping
  const { data: current, error: fetchErr } = await supabase
    .from('integration_field_mappings')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr) throw fetchErr;

  const newVersion = (current.mapping_version || 1) + 1;

  // 2. Archive to history
  await supabase.from('integration_field_mapping_history').insert({
    mapping_id: id,
    external_property: current.external_property,
    eds_target: current.eds_target,
    target_type: current.target_type,
    direction: current.direction,
    source_of_truth: current.source_of_truth,
    transform_rule: current.transform_rule,
    allow_clear: current.allow_clear,
    mapping_version: current.mapping_version,
    change_reason: changeReason || 'User updated mapping in settings UI',
  });

  // 3. Apply update with incremented version
  const { data: updated, error: updateErr } = await supabase
    .from('integration_field_mappings')
    .update({
      ...updates,
      mapping_version: newVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateErr) throw updateErr;
  return updated as IntegrationFieldMapping;
}

/**
 * Fetches recent sync audit events.
 */
export async function fetchSyncEvents(limit: number = 50, filterStatus?: string): Promise<IntegrationSyncEvent[]> {
  let query = supabase
    .from('integration_sync_events')
    .select('*')
    .eq('integration', 'hubspot')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filterStatus && filterStatus !== 'all') {
    query = query.eq('status', filterStatus);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as IntegrationSyncEvent[];
}

/**
 * Fetches conflict queue records.
 */
export async function fetchConflicts(status: string = 'pending_review'): Promise<IntegrationConflict[]> {
  let query = supabase
    .from('integration_conflicts')
    .select('*')
    .eq('integration', 'hubspot')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as IntegrationConflict[];
}

/**
 * Resolves a conflict via atomic PostgreSQL RPC.
 */
export async function resolveConflict(
  conflictId: string,
  resolution: 'resolved_hubspot_wins' | 'resolved_eds_wins' | 'dismissed',
  notes?: string
): Promise<{ success: boolean; status: string }> {
  const { data, error } = await supabase.rpc('resolve_hubspot_conflict', {
    p_conflict_id: conflictId,
    p_resolution: resolution,
    p_notes: notes || null,
  });

  if (error) throw error;
  return data;
}

/**
 * Fetches cached HubSpot properties.
 */
export async function fetchCachedProperties(): Promise<IntegrationPropertyCache[]> {
  const { data, error } = await supabase
    .from('integration_property_cache')
    .select('*')
    .eq('integration', 'hubspot')
    .order('label', { ascending: true });

  if (error) throw error;
  return (data || []) as IntegrationPropertyCache[];
}

/**
 * Triggers property discovery Edge Function.
 */
export async function refreshProperties(): Promise<{
  success: boolean;
  properties_count: number;
  mapping_health?: Record<string, string>;
  message?: string;
}> {
  const { data, error } = await supabase.functions.invoke('hubspot-properties-discovery', {
    method: 'POST',
  });

  if (error) throw error;
  return data;
}

/**
 * Executes Initial Dry Run preview via Edge Function / RPC.
 */
export async function runDryRunSync(testContacts?: any[]): Promise<HubSpotDryRunResult> {
  const { data, error } = await supabase.functions.invoke('hubspot-initial-sync', {
    body: { mode: 'dry_run', test_contacts: testContacts },
  });

  if (error) throw error;
  return data as HubSpotDryRunResult;
}

/**
 * Disconnects the HubSpot integration safely without deleting leads or links.
 */
export async function disconnectHubSpot(): Promise<void> {
  const { error } = await supabase
    .from('integration_connections')
    .update({
      status: 'disconnected',
      sync_enabled: false,
      inbound_webhook_enabled: false,
      outbound_sync_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'hubspot');

  if (error) throw error;
}

/**
 * Manually reconciles/syncs a single lead immediately.
 */
export async function syncLeadNow(leadId: string): Promise<{ success: boolean; message: string }> {
  // Check if lead has an active link
  const { data: link } = await supabase
    .from('integration_entity_links')
    .select('external_entity_id')
    .eq('eds_entity_id', leadId)
    .eq('status', 'active')
    .single();

  // Enqueue immediate outbox item
  const { data: lead } = await supabase
    .from('leads')
    .select('first_name, last_name, email, phone_raw, qualification_status')
    .eq('id', leadId)
    .single();

  if (!lead) throw new Error('Lead not found');

  const payload: Record<string, any> = {
    firstname: lead.first_name || '',
    lastname: lead.last_name || '',
    email: lead.email || '',
    phone: lead.phone_raw || '',
    hs_lead_status: lead.qualification_status || '',
  };

  const payloadHash = btoa(JSON.stringify(payload));

  await supabase.from('integration_outbox').insert({
    integration: 'hubspot',
    entity_type: 'lead',
    eds_entity_id: leadId,
    external_entity_id: link?.external_entity_id || null,
    event_type: 'lead.updated',
    payload,
    payload_hash: payloadHash,
    status: 'pending',
  });

  // Attempt trigger dispatcher
  try {
    await supabase.functions.invoke('hubspot-sync-dispatcher', { method: 'POST' });
  } catch {
    // Non-fatal if dispatcher is asynchronous
  }

  return { success: true, message: 'Lead sync queued successfully' };
}
