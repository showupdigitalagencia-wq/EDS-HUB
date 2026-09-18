import { supabase } from '../../../lib/supabase';
import type {
  AudienceFilterDefinition,
  AudiencePreviewResult,
  CampaignAudience,
  CampaignRecipient,
  SavedSegment,
} from '../../../types';

/**
 * Service for Campaigns & Audience Segmentation 2.0.
 * Interacts with server-side RPCs and tables with active app user authorization.
 */
export const campaignAudienceService = {
  /**
   * Evaluates audience filters server-side without mutating campaign records.
   * Returns total matches, eligible counts, excluded counts, and reason breakdown.
   */
  async previewAudience(
    filters: AudienceFilterDefinition,
    channel: 'email' | 'sms' | 'call' = 'email',
    limit = 50,
    offset = 0,
  ): Promise<AudiencePreviewResult> {
    const { data, error } = await supabase.rpc('preview_audience_segment', {
      p_filters: filters,
      p_channel: channel,
      p_include_test: false,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error('Failed to preview audience segment:', error);
      throw new Error(error.message || 'Failed to preview audience segment');
    }

    return (
      data || {
        total_matched: 0,
        eligible_count: 0,
        excluded_count: 0,
        exclusion_breakdown: {
          TEST_SOURCE: 0,
          NO_VALID_CONTACT_PREFERENCE: 0,
          CHANNEL_PREFERENCE_MISMATCH: 0,
          MISSING_EMAIL: 0,
          MISSING_PHONE: 0,
        },
        leads: [],
      }
    );
  },

  /**
   * Prepares the audience snapshot for a campaign.
   * Atomically freezes snapshot metadata and populates campaign_recipients.
   * MANDATORY: DOES NOT CREATE ANY TASKS OR DISPATCH ANY MESSAGES.
   */
  async prepareCampaignAudience(
    campaignId: string,
    savedSegmentId: string | null = null,
  ): Promise<{
    success: boolean;
    total_matched: number;
    eligible_count: number;
    excluded_count: number;
    recipients_materialized: number;
    snapshot_frozen_at: string;
  }> {
    const { data, error } = await supabase.rpc('prepare_campaign_audience_snapshot', {
      p_campaign_id: campaignId,
      p_saved_segment_id: savedSegmentId || null,
    });

    if (error) {
      console.error('Failed to prepare campaign audience:', error);
      throw new Error(error.message || 'Failed to prepare campaign audience');
    }

    return data;
  },

  /**
   * Explicit action to activate a prepared Call Campaign.
   * Only creates deduplicated call tasks in public.tasks for eligible recipients.
   * 100% idempotent.
   */
  async activateCallCampaign(campaignId: string): Promise<{
    success: boolean;
    tasks_created: number;
    tasks_skipped_idempotent: number;
    activated_at: string;
  }> {
    const { data, error } = await supabase.rpc('activate_call_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      console.error('Failed to activate call campaign:', error);
      throw new Error(error.message || 'Failed to activate call campaign');
    }

    return data;
  },

  /**
   * Fetches all active saved segments.
   */
  async listSavedSegments(): Promise<SavedSegment[]> {
    const { data, error } = await supabase
      .from('saved_segments')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to list saved segments:', error);
      throw new Error(error.message || 'Failed to list saved segments');
    }

    return (data || []).map((seg) => ({
      ...seg,
      filter_definition:
        typeof seg.filter_definition === 'object' && seg.filter_definition !== null
          ? (seg.filter_definition as AudienceFilterDefinition)
          : { version: 1, operator: 'and', conditions: [] },
    }));
  },

  /**
   * Creates a new saved segment.
   */
  async createSavedSegment(
    name: string,
    description: string | undefined,
    filterDefinition: AudienceFilterDefinition,
  ): Promise<SavedSegment> {
    const { data, error } = await supabase
      .from('saved_segments')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        filter_definition: filterDefinition,
        is_active: true,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Failed to create saved segment:', error);
      throw new Error(error?.message || 'Failed to create saved segment');
    }

    return data;
  },

  /**
   * Updates an existing saved segment.
   */
  async updateSavedSegment(
    id: string,
    name: string,
    description: string | undefined,
    filterDefinition: AudienceFilterDefinition,
  ): Promise<SavedSegment> {
    const { data, error } = await supabase
      .from('saved_segments')
      .update({
        name: name.trim(),
        description: description?.trim() || null,
        filter_definition: filterDefinition,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      console.error('Failed to update saved segment:', error);
      throw new Error(error?.message || 'Failed to update saved segment');
    }

    return data;
  },

  /**
   * Soft deletes / deactivates a saved segment.
   */
  async deleteSavedSegment(id: string): Promise<void> {
    const { error } = await supabase
      .from('saved_segments')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Failed to delete saved segment:', error);
      throw new Error(error.message || 'Failed to delete saved segment');
    }
  },

  /**
   * Fetches the campaign_audiences record for a campaign.
   */
  async fetchCampaignAudience(campaignId: string): Promise<CampaignAudience | null> {
    const { data, error } = await supabase
      .from('campaign_audiences')
      .select('*')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch campaign audience:', error);
      return null;
    }

    return data;
  },

  /**
   * Fetches materialized campaign recipients (both eligible and excluded audit).
   */
  async fetchCampaignRecipients(
    campaignId: string,
    limit = 100,
    offset = 0,
  ): Promise<CampaignRecipient[]> {
    const { data, error } = await supabase
      .from('campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('is_eligible', { ascending: false })
      .order('prepared_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch campaign recipients:', error);
      return [];
    }

    return data || [];
  },
};
