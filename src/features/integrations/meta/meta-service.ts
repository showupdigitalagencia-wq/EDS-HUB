// =============================================================================
// Meta Integration Service: Page Subscription & Form Discovery
// =============================================================================
// Helper utilities for the live client meeting:
// 1. subscribePageToLeadgen: Subscribes the selected Facebook Page to the leadgen
//    webhook topic via Graph API with zero guesswork.
// 2. discoverLeadgenForms: Fetches real native Lead Ads forms active on the Page.
// 3. registerFormCourseMapping: Records Form -> Course mapping into EDS HUB.
// =============================================================================

import { supabase } from '../../../lib/supabase';

export interface DiscoveredMetaForm {
  id: string;
  name: string;
  status: string;
  leads_count?: number;
  created_time?: string;
}

export interface MetaPageSubscriptionResult {
  success: boolean;
  pageId: string;
  error?: string;
}

/**
 * Subscribes the client's Facebook Page to the Meta leadgen webhook topic.
 * Graph API: POST /{page_id}/subscribed_apps?subscribed_fields=leadgen
 */
export async function subscribePageToLeadgen(
  pageId: string,
  pageAccessToken: string
): Promise<MetaPageSubscriptionResult> {
  if (!pageId || !pageAccessToken) {
    return { success: false, pageId, error: 'Missing pageId or pageAccessToken' };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      return { success: true, pageId };
    }

    return {
      success: false,
      pageId,
      error: data.error?.message || `Failed with HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      success: false,
      pageId,
      error: err instanceof Error ? err.message : 'Network error subscribing page',
    };
  }
}

/**
 * Discovers real native Lead Ads forms active on the client's Facebook Page.
 * Graph API: GET /{page_id}/leadgen_forms
 */
export async function discoverLeadgenForms(
  pageId: string,
  pageAccessToken: string
): Promise<{ success: boolean; forms: DiscoveredMetaForm[]; error?: string }> {
  if (!pageId || !pageAccessToken) {
    return { success: false, forms: [], error: 'Missing pageId or pageAccessToken' };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,status,leads_count,created_time&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();

    if (res.ok && Array.isArray(data.data)) {
      const forms: DiscoveredMetaForm[] = data.data.map((item: any) => ({
        id: String(item.id),
        name: String(item.name || 'Untitled Form'),
        status: String(item.status || 'ACTIVE'),
        leads_count: typeof item.leads_count === 'number' ? item.leads_count : undefined,
        created_time: item.created_time,
      }));
      return { success: true, forms };
    }

    return {
      success: false,
      forms: [],
      error: data.error?.message || `Failed to fetch forms (HTTP ${res.status})`,
    };
  } catch (err: any) {
    return {
      success: false,
      forms: [],
      error: err instanceof Error ? err.message : 'Network error discovering forms',
    };
  }
}

/**
 * Registers a confirmed Form ID -> EDS HUB Course mapping into public.integration_field_mappings.
 * Uses existing schema (no migrations needed).
 */
export async function registerFormCourseMapping(
  formId: string,
  formName: string,
  courseCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Verify target course exists
    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('id, code, name')
      .eq('code', courseCode)
      .eq('active', true)
      .single();

    if (courseErr || !course) {
      return { success: false, error: `Course "${courseCode}" does not exist in EDS HUB catalog` };
    }

    // 2. Persist in integration_field_mappings
    const { error: upsertErr } = await supabase
      .from('integration_field_mappings')
      .upsert(
        {
          integration: 'meta',
          entity_type: 'lead',
          external_property: `form:${formId}`,
          eds_target: `course:${course.code}`,
          target_type: 'lead_course_interest',
          direction: 'hubspot_to_eds', // inbound to EDS HUB
          source_of_truth: 'meta',
          transform_rule: `map_form_to_course:${formName || formId} -> ${course.name}`,
          is_active: true,
          mapping_version: 1,
        },
        { onConflict: 'integration,entity_type,external_property,eds_target,mapping_version' }
      );

    if (upsertErr) {
      return { success: false, error: upsertErr.message };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to register form course mapping',
    };
  }
}
