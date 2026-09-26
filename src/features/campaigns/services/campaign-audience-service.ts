import { supabase } from '../../../lib/supabase';
import type {
  AudienceFilterDefinition,
  AudiencePreviewResult,
  AudienceMemberPreview,
  CampaignAudience,
  CampaignRecipient,
  SavedSegment,
} from '../../../types';

export interface SearchedLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  contact_preference: string | null;
  pipeline_stage_id: string;
  stage_name: string | null;
  stage_code: string | null;
  lead_score: number;
  is_eligible: boolean;
  exclusion_reason: string | null;
  is_suppressed?: boolean;
}

export interface OfficialCourseMaterial {
  id: string;
  course_id: string;
  title: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string;
  file_size_bytes: number | null;
  is_active: boolean;
}

/**
 * Service for Campaigns & Audience Segmentation 2.0.
 * Interacts with server-side RPCs and tables with active app user authorization.
 */
export const campaignAudienceService = {
  /**
   * Evaluates audience filters server-side without mutating campaign records.
   * Supports:
   * 1. Segment-based filtering (via Postgres preview_audience_segment RPC)
   * 2. Individual lead selection (via direct query & suppression verification)
   * 3. Session date filtering (via course_session_id)
   * Returns total matches, eligible counts, excluded counts, and reason breakdown.
   */
  async previewAudience(
    filters: AudienceFilterDefinition,
    channel: 'email' | 'sms' | 'call' = 'email',
    limit = 50,
    offset = 0,
  ): Promise<AudiencePreviewResult> {
    // 1. Handle Individual Lead Selection
    if (filters.mode === 'individual' && filters.selected_lead_ids && filters.selected_lead_ids.length > 0) {
      return this.evaluateSpecificLeadsAudience(filters.selected_lead_ids, channel, limit, offset);
    }

    // 2. Handle Session Cohort Filtering
    if (filters.course_session_id) {
      return this.evaluateCourseSessionAudience(filters.course_session_id, channel, limit, offset);
    }

    // 3. Segment Filter via RPC
    // Clean internal UI fields before passing to PostgreSQL RPC to maintain strict schema parity
    const { mode, course_id, course_session_id, selected_lead_ids, ...rpcFilters } = (filters || {}) as any;

    const { data, error } = await supabase.rpc('preview_audience_segment', {
      p_filters: rpcFilters,
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
   * Helper to evaluate a list of specific individual leads with factual counts and deliverability check.
   */
  async evaluateSpecificLeadsAudience(
    leadIds: string[],
    channel: 'email' | 'sms' | 'call',
    limit = 50,
    offset = 0,
  ): Promise<AudiencePreviewResult> {
    if (!leadIds || leadIds.length === 0) {
      return {
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
      };
    }

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, email, phone_raw, phone_e164, source, contact_preference, pipeline_stage_id, lead_score, created_at, pipeline_stages(name, code)')
      .in('id', leadIds);

    if (error) {
      console.error('Failed to fetch specific leads for audience preview:', error);
      throw new Error(error.message || 'Failed to preview specific leads');
    }

    // Check suppression status for email channel
    const emails = (leads || [])
      .map((l) => l.email?.toLowerCase().trim())
      .filter((e): e is string => Boolean(e));

    let suppressedSet = new Set<string>();
    if (emails.length > 0 && channel === 'email') {
      const { data: supps } = await supabase
        .from('email_suppressions')
        .select('normalized_email')
        .in('normalized_email', emails);
      if (supps) {
        suppressedSet = new Set(supps.map((s) => s.normalized_email));
      }
    }

    const breakdown = {
      TEST_SOURCE: 0,
      NO_VALID_CONTACT_PREFERENCE: 0,
      CHANNEL_PREFERENCE_MISMATCH: 0,
      MISSING_EMAIL: 0,
      MISSING_PHONE: 0,
      SUPPRESSED: 0,
    };

    const evaluatedLeads: AudienceMemberPreview[] = (leads || []).map((l: any) => {
      const email = l.email?.trim() || null;
      const phone = l.phone_e164 || l.phone_raw || null;
      const stageName = l.pipeline_stages?.name || null;
      const stageCode = l.pipeline_stages?.code || null;
      const isSuppressed = email ? suppressedSet.has(email.toLowerCase()) : false;

      let isEligible = true;
      let reason: string | null = null;

      if (l.source === 'test') {
        isEligible = false;
        reason = 'TEST_SOURCE';
        breakdown.TEST_SOURCE++;
      } else if (!l.contact_preference || !l.contact_preference.trim()) {
        isEligible = false;
        reason = 'NO_VALID_CONTACT_PREFERENCE';
        breakdown.NO_VALID_CONTACT_PREFERENCE++;
      } else if (l.contact_preference !== channel) {
        isEligible = false;
        reason = 'CHANNEL_PREFERENCE_MISMATCH';
        breakdown.CHANNEL_PREFERENCE_MISMATCH++;
      } else if (channel === 'email' && !email) {
        isEligible = false;
        reason = 'MISSING_EMAIL';
        breakdown.MISSING_EMAIL++;
      } else if (channel !== 'email' && !phone) {
        isEligible = false;
        reason = 'MISSING_PHONE';
        breakdown.MISSING_PHONE++;
      } else if (isSuppressed) {
        isEligible = false;
        reason = 'SUPPRESSED';
        breakdown.SUPPRESSED++;
      }

      return {
        id: l.id,
        first_name: l.first_name,
        last_name: l.last_name,
        email,
        phone,
        source: l.source,
        contact_preference: l.contact_preference,
        pipeline_stage_id: l.pipeline_stage_id,
        stage_name: stageName,
        stage_code: stageCode,
        lead_score: l.lead_score || 0,
        is_eligible: isEligible,
        exclusion_reason: reason,
        created_at: l.created_at,
      };
    });

    const eligibleCount = evaluatedLeads.filter((l) => l.is_eligible).length;
    const excludedCount = evaluatedLeads.length - eligibleCount;

    return {
      total_matched: evaluatedLeads.length,
      eligible_count: eligibleCount,
      excluded_count: excludedCount,
      exclusion_breakdown: breakdown,
      leads: evaluatedLeads.slice(offset, offset + limit),
    };
  },

  /**
   * Helper to evaluate leads enrolled in or interested in a specific course session cohort.
   */
  async evaluateCourseSessionAudience(
    courseSessionId: string,
    channel: 'email' | 'sms' | 'call',
    limit = 50,
    offset = 0,
  ): Promise<AudiencePreviewResult> {
    // 1. Fetch lead IDs from enrollments for this session
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('lead_id')
      .eq('course_session_id', courseSessionId);

    // 2. Fetch lead IDs from lead_course_interests for this session
    const { data: interests } = await supabase
      .from('lead_course_interests')
      .select('lead_id')
      .eq('course_session_id', courseSessionId);

    const leadIdSet = new Set<string>();
    (enrollments || []).forEach((e) => {
      if (e.lead_id) leadIdSet.add(e.lead_id);
    });
    (interests || []).forEach((i) => {
      if (i.lead_id) leadIdSet.add(i.lead_id);
    });

    const leadIds = Array.from(leadIdSet);
    if (leadIds.length === 0) {
      return {
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
      };
    }

    return this.evaluateSpecificLeadsAudience(leadIds, channel, limit, offset);
  },

  /**
   * Search real leads by name, email, or phone with stage and preference info.
   */
  async searchLeads(query: string, limit = 25): Promise<SearchedLead[]> {
    const term = query.trim();
    let queryBuilder = supabase
      .from('leads')
      .select('id, first_name, last_name, email, phone_raw, phone_e164, source, contact_preference, pipeline_stage_id, lead_score, created_at, pipeline_stages(name, code)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (term) {
      queryBuilder = queryBuilder.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone_raw.ilike.%${term}%`,
      );
    }

    const { data, error } = await queryBuilder;
    if (error) {
      console.error('Failed to search leads:', error);
      return [];
    }

    // Check suppression for returned emails
    const emails = (data || []).map((l) => l.email?.toLowerCase().trim()).filter((e): e is string => Boolean(e));
    let suppressedSet = new Set<string>();
    if (emails.length > 0) {
      const { data: supps } = await supabase
        .from('email_suppressions')
        .select('normalized_email')
        .in('normalized_email', emails);
      if (supps) {
        suppressedSet = new Set(supps.map((s) => s.normalized_email));
      }
    }

    return (data || []).map((l: any) => {
      const email = l.email?.trim() || null;
      const phone = l.phone_e164 || l.phone_raw || null;
      const stageName = l.pipeline_stages?.name || null;
      const stageCode = l.pipeline_stages?.code || null;
      const isSuppressed = email ? suppressedSet.has(email.toLowerCase()) : false;

      let isEligible = true;
      let reason: string | null = null;

      if (l.source === 'test') {
        isEligible = false;
        reason = 'TEST_SOURCE';
      } else if (!l.contact_preference || !l.contact_preference.trim()) {
        isEligible = false;
        reason = 'NO_VALID_CONTACT_PREFERENCE';
      } else if (l.contact_preference !== 'email') {
        isEligible = false;
        reason = 'CHANNEL_PREFERENCE_MISMATCH';
      } else if (!email) {
        isEligible = false;
        reason = 'MISSING_EMAIL';
      } else if (isSuppressed) {
        isEligible = false;
        reason = 'SUPPRESSED';
      }

      return {
        id: l.id,
        first_name: l.first_name,
        last_name: l.last_name,
        email,
        phone,
        source: l.source,
        contact_preference: l.contact_preference,
        pipeline_stage_id: l.pipeline_stage_id,
        stage_name: stageName,
        stage_code: stageCode,
        lead_score: l.lead_score || 0,
        is_eligible: isEligible,
        exclusion_reason: reason,
        is_suppressed: isSuppressed,
      };
    });
  },

  /**
   * Loads official materials (PDFs) associated with a given course.
   */
  async loadCourseMaterials(courseId: string): Promise<OfficialCourseMaterial[]> {
    if (!courseId) return [];
    const { data, error } = await supabase
      .from('course_materials')
      .select('*')
      .eq('course_id', courseId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Failed to load course materials:', error);
      return [];
    }
    return data || [];
  },

  /**
   * Loads official course material associated with an email template by template_key.
   */
  async loadTemplateAttachment(templateKey: string): Promise<OfficialCourseMaterial | null> {
    if (!templateKey) return null;
    const { data, error } = await supabase
      .from('template_attachments')
      .select('material_id, course_materials(*)')
      .eq('template_key', templateKey)
      .maybeSingle();

    if (error || !data) return null;
    return (data.course_materials as unknown as OfficialCourseMaterial) || null;
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
    // 1. Check if campaign audience uses individual leads mode
    if (!savedSegmentId) {
      try {
        const query = supabase?.from?.('campaign_audiences');
        if (query && typeof query.select === 'function') {
          const { data: aud } = await query
            .select('*')
            .eq('campaign_id', campaignId)
            .maybeSingle();

          const filters = (aud?.filter_definition as AudienceFilterDefinition) || {};
          const nowIso = new Date().toISOString();

          if (filters.mode === 'individual' && filters.selected_lead_ids && filters.selected_lead_ids.length > 0) {
            const preview = await this.evaluateSpecificLeadsAudience(filters.selected_lead_ids, 'email', 1000, 0);

            // Materialize into campaign_recipients
            await supabase.from('campaign_recipients').delete().eq('campaign_id', campaignId);

            const recipientRows = preview.leads.map((l) => ({
              campaign_id: campaignId,
              lead_id: l.id,
              email: l.email,
              phone_e164: l.phone,
              channel: 'email',
              is_eligible: l.is_eligible,
              exclusion_reason: l.exclusion_reason,
              status: l.is_eligible ? 'pending' : 'skipped',
              snapshot_stage_id: l.pipeline_stage_id,
              snapshot_lead_score: l.lead_score,
              prepared_at: nowIso,
            }));

            if (recipientRows.length > 0) {
              const { error: insErr } = await supabase.from('campaign_recipients').insert(recipientRows);
              if (insErr) {
                console.error('Failed to insert individual campaign recipients:', insErr);
                throw new Error(insErr.message || 'Failed to insert recipients');
              }
            }

            await supabase
              .from('campaign_audiences')
              .update({
                snapshot_frozen_at: nowIso,
                total_matched_count: preview.total_matched,
                eligible_count: preview.eligible_count,
                excluded_count: preview.excluded_count,
                updated_at: nowIso,
              })
              .eq('campaign_id', campaignId);

            return {
              success: true,
              total_matched: preview.total_matched,
              eligible_count: preview.eligible_count,
              excluded_count: preview.excluded_count,
              recipients_materialized: recipientRows.length,
              snapshot_frozen_at: nowIso,
            };
          }
        }
      } catch (err) {
        // Fallback to RPC if direct table queries fail
      }
    }

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
