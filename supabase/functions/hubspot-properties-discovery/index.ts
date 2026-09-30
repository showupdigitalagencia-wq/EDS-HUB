// =============================================================================
// Edge Function: hubspot-properties-discovery
// =============================================================================
// Queries HubSpot CRM Properties API, updates integration_property_cache,
// and evaluates mapping health (healthy, missing_property, type_mismatch).
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { resolveCanonicalCourse } from '../_shared/course-resolver.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authHeader = req.headers.get('Authorization');
  const adminKey = req.headers.get('x-admin-key');
  const INTERNAL_ADMIN_SECRET = Deno.env.get('INTERNAL_ADMIN_SECRET');

  let isAuthorized = false;
  if (
    INTERNAL_ADMIN_SECRET &&
    (adminKey === INTERNAL_ADMIN_SECRET || authHeader === `Bearer ${INTERNAL_ADMIN_SECRET}`)
  ) {
    isAuthorized = true;
  } else {
    const authResult = await verifyAuth(authHeader);
    isAuthorized = authResult.isAuthorized;
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createAdminClient();
  const token = Deno.env.get('HUBSPOT_ACCESS_TOKEN');

  if (!token) {
    // Return cached properties from DB if token is not yet configured
    const { data: cached } = await db
      .from('integration_property_cache')
      .select('*')
      .eq('integration', 'hubspot')
      .order('label', { ascending: true });

    return new Response(
      JSON.stringify({
        success: true,
        status: 'configuration_required',
        properties: cached || [],
        message: 'HubSpot token not configured. Returning cached property definitions.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }

    if (body.action === 'audit_db') {
      const { data: courses } = await db.from('courses').select('id, code, name, description, active, sort_order').order('sort_order', { ascending: true });
      const { data: sessions } = await db.from('course_sessions').select('id, course_id, code, title, status, start_date, end_date, capacity, location, instructor_name').order('start_date', { ascending: true });
      const { data: materials } = await db.from('course_materials').select('*');
      const { data: templates } = await db.from('email_templates').select('id, name, template_key, has_attachment, attachment_name, category, content_json, is_active');
      const { data: attachments } = await db.from('template_attachments').select('*');
      const { count: interestCount } = await db.from('lead_course_interests').select('*', { count: 'exact', head: true });
      const { data: sampleInterests } = await db.from('lead_course_interests').select('id, lead_id, course_id, priority, source, status').limit(20);
      const { data: pipelineCounts } = await db.rpc('get_pipeline_stage_counts');

      return new Response(
        JSON.stringify({
          success: true,
          courses,
          sessions,
          materials,
          templates,
          attachments,
          interestCount,
          sampleInterests,
          pipelineCounts,
          runtime_env: {
            enable_meta_first_email_automation: Deno.env.get('ENABLE_META_FIRST_EMAIL_AUTOMATION') === 'true',
            raw_value: Deno.env.get('ENABLE_META_FIRST_EMAIL_AUTOMATION') || null,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'audit_hubspot_missing_leads') {
      const propList = [
        'firstname', 'lastname', 'email', 'phone', 'mobilephone',
        'hs_lead_status', 'status_de_qualificacao',
        'course_interest', 'curso_de_interesse', 'curso_de_interesse_2', 'curso_de_interesse_3',
        'data_do_curso_de_interesse', 'origem_do_lead', 'lead_source',
        'what_is_your_preferred_contact_method', 'what_is_your_preferred_method_of_contact', 'preferencia_de_contato',
        'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
        'first_conversion_event_name', 'recent_conversion_event_name',
        'createdate', 'lastmodifieddate'
      ];

      // 1. Fetch recent contacts from HubSpot (by createdate DESC)
      const contacts: any[] = [];
      let afterCursor: string | undefined = undefined;
      let pages = 0;

      do {
        pages++;
        const searchPayload: any = {
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
          properties: propList,
          limit: 100,
        };
        if (afterCursor) {
          searchPayload.after = afterCursor;
        }

        const hsRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchPayload),
        });

        if (!hsRes.ok) {
          const errText = await hsRes.text();
          return new Response(JSON.stringify({ error: `HubSpot Search API error ${hsRes.status}: ${errText}` }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const hsData = await hsRes.json();
        const pageResults: any[] = hsData.results || [];
        contacts.push(...pageResults);
        afterCursor = hsData.paging?.next?.after;
      } while (afterCursor && pages < 10);

      // 2. Fetch connection status & sync events
      const { data: conn } = await db.from('integration_connections').select('*').eq('provider', 'hubspot').maybeSingle();
      const { data: syncEvents } = await db.from('hubspot_sync_events').select('*').order('created_at', { ascending: false }).limit(15);
      const { data: syncBatches } = await db.from('hubspot_sync_batches').select('*').order('created_at', { ascending: false }).limit(10);

      // 3. Reconcile against EDS HUB leads (in-memory O(1) indexing with range pagination)
      const allLeads: any[] = [];
      let leadOffset = 0;
      while (true) {
        const { data: page } = await db
          .from('leads')
          .select('id, first_name, last_name, email, phone_e164, phone_raw, course_interest, pipeline_stage_id, created_at, hubspot_contact_id, source')
          .is('deleted_at', null)
          .range(leadOffset, leadOffset + 999);
        if (!page || page.length === 0) break;
        allLeads.push(...page);
        if (page.length < 1000) break;
        leadOffset += 1000;
      }

      const allLinks: any[] = [];
      let linkOffset = 0;
      while (true) {
        const { data: page } = await db
          .from('integration_entity_links')
          .select('external_entity_id, eds_entity_id')
          .eq('integration', 'hubspot')
          .eq('status', 'active')
          .range(linkOffset, linkOffset + 999);
        if (!page || page.length === 0) break;
        allLinks.push(...page);
        if (page.length < 1000) break;
        linkOffset += 1000;
      }

      const leadsById = new Map<string, any>();
      const leadsByHsId = new Map<string, any>();
      const leadsByEmail = new Map<string, any>();
      const leadsByPhoneDigits = new Map<string, any>();

      for (const lead of allLeads || []) {
        leadsById.set(lead.id, lead);
        if (lead.hubspot_contact_id) {
          leadsByHsId.set(String(lead.hubspot_contact_id).trim(), lead);
        }
        if (lead.email) {
          leadsByEmail.set(lead.email.trim().toLowerCase(), lead);
        }
        const p1 = (lead.phone_e164 || '').replace(/\D/g, '');
        const p2 = (lead.phone_raw || '').replace(/\D/g, '');
        if (p1.length >= 8) leadsByPhoneDigits.set(p1.slice(-8), lead);
        if (p2.length >= 8) leadsByPhoneDigits.set(p2.slice(-8), lead);
      }

      for (const link of allLinks || []) {
        const lead = leadsById.get(link.eds_entity_id);
        if (lead && link.external_entity_id) {
          leadsByHsId.set(String(link.external_entity_id).trim(), lead);
        }
      }

      const matched: any[] = [];
      const missing: any[] = [];

      for (const c of contacts) {
        const cId = String(c.id).trim();
        const p = c.properties || {};
        const email = p.email ? p.email.trim().toLowerCase() : null;
        const phone = p.phone || p.mobilephone || null;
        const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

        let lead = leadsByHsId.get(cId);

        if (!lead && email) {
          lead = leadsByEmail.get(email);
        }

        if (!lead && cleanPhone && cleanPhone.length >= 8) {
          lead = leadsByPhoneDigits.get(cleanPhone.slice(-8));
        }

        const contactSummary = {
          hubspot_contact_id: cId,
          name: `${p.firstname || ''} ${p.lastname || ''}`.trim() || 'Sem nome',
          email: p.email || null,
          phone: p.phone || p.mobilephone || null,
          createdate: p.createdate,
          lastmodifieddate: p.lastmodifieddate,
          source: p.origem_do_lead || p.hs_analytics_source || p.lead_source || 'hubspot',
          course: p.curso_de_interesse || p.course_interest || p.first_conversion_event_name || null,
          contact_preference: p.what_is_your_preferred_contact_method || p.what_is_your_preferred_method_of_contact || p.preferencia_de_contato || null,
        };

        if (lead) {
          matched.push({
            ...contactSummary,
            eds_lead_id: lead.id,
            eds_stage: lead.pipeline_stage_id,
            eds_created_at: lead.created_at,
          });
        } else {
          missing.push(contactSummary);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          total_scanned: contacts.length,
          matched_count: matched.length,
          missing_count: missing.length,
          missing_contacts: missing,
          sample_matched: matched.slice(0, 5),
          integration_connection: conn,
          recent_sync_events: syncEvents || [],
          recent_sync_batches: syncBatches || [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'get_cron_status') {
      const { data, error } = await db.rpc('get_cron_job_status');
      return new Response(
        JSON.stringify({ success: !error, data, error }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'test_process_single') {
      const { data: rpcRes, error: rpcErr } = await db.rpc('process_hubspot_inbound_batch', {
        p_events: [body.contact],
      });
      const cId = body.contact.id || body.contact.contact_id;
      const { data: link } = await db.from('integration_entity_links').select('*').eq('external_entity_id', cId);
      const { data: lead } = await db.from('leads').select('*').eq('hubspot_contact_id', cId);
      const { data: syncEvent } = await db.from('integration_sync_events').select('*').eq('external_entity_id', cId).order('created_at', { ascending: false }).limit(3);
      return new Response(
        JSON.stringify({
          rpcRes,
          rpcErr,
          link,
          lead,
          syncEvent,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'backfill_all_missing_hubspot_leads') {
      const propList = [
        'firstname', 'lastname', 'email', 'phone', 'mobilephone',
        'hs_calculated_phone_number', 'hs_lead_status', 'status_de_qualificacao',
        'course_interest', 'curso_de_interesse', 'curso_de_interesse_2', 'curso_de_interesse_3',
        'data_do_curso_de_interesse', 'origem_do_lead', 'lead_source',
        'what_is_your_preferred_contact_method', 'what_is_your_preferred_method_of_contact', 'preferencia_de_contato',
        'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
        'first_conversion_event_name', 'recent_conversion_event_name', 'hs_full_name_or_email',
        'createdate', 'lastmodifieddate'
      ];

      // 1. Fetch all contacts from HubSpot
      const contacts: any[] = [];
      let afterCursor: string | undefined = undefined;
      let pages = 0;
      const maxPages = body.max_pages || 10;

      do {
        pages++;
        const searchPayload: any = {
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
          properties: propList,
          limit: 100,
        };
        if (afterCursor) searchPayload.after = afterCursor;

        const hsRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchPayload),
        });

        if (!hsRes.ok) {
          const errText = await hsRes.text();
          return new Response(JSON.stringify({ error: `HubSpot API error ${hsRes.status}: ${errText}` }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const hsData = await hsRes.json();
        const pageResults: any[] = hsData.results || [];
        contacts.push(...pageResults);
        afterCursor = hsData.paging?.next?.after;
      } while (afterCursor && pages < maxPages);

      // 2. Fetch existing leads to filter only genuinely missing contacts (with range pagination)
      const allLeads: any[] = [];
      let leadOffset = 0;
      while (true) {
        const { data: page } = await db
          .from('leads')
          .select('id, email, phone_e164, phone_raw, hubspot_contact_id')
          .is('deleted_at', null)
          .range(leadOffset, leadOffset + 999);
        if (!page || page.length === 0) break;
        allLeads.push(...page);
        if (page.length < 1000) break;
        leadOffset += 1000;
      }

      const allLinks: any[] = [];
      let linkOffset = 0;
      while (true) {
        const { data: page } = await db
          .from('integration_entity_links')
          .select('external_entity_id')
          .eq('integration', 'hubspot')
          .eq('status', 'active')
          .range(linkOffset, linkOffset + 999);
        if (!page || page.length === 0) break;
        allLinks.push(...page);
        if (page.length < 1000) break;
        linkOffset += 1000;
      }

      const existingHsIds = new Set<string>();
      const existingEmails = new Set<string>();
      const existingPhoneDigits = new Set<string>();

      for (const l of allLeads || []) {
        if (l.hubspot_contact_id) existingHsIds.add(String(l.hubspot_contact_id).trim());
        if (l.email) existingEmails.add(l.email.trim().toLowerCase());
        const p1 = (l.phone_e164 || '').replace(/\D/g, '');
        const p2 = (l.phone_raw || '').replace(/\D/g, '');
        if (p1.length >= 8) existingPhoneDigits.add(p1.slice(-8));
        if (p2.length >= 8) existingPhoneDigits.add(p2.slice(-8));
      }

      for (const link of allLinks || []) {
        if (link.external_entity_id) existingHsIds.add(String(link.external_entity_id).trim());
      }

      const contactsToBackfill: any[] = [];
      const alreadyPresent: any[] = [];

      for (const c of contacts) {
        const cId = String(c.id).trim();
        const p = c.properties || {};
        const email = p.email ? p.email.trim().toLowerCase() : null;
        const phone = (p.phone || p.mobilephone || p.hs_calculated_phone_number || '').replace(/\D/g, '');

        const isKnown = existingHsIds.has(cId) ||
          (email && existingEmails.has(email)) ||
          (phone && phone.length >= 8 && existingPhoneDigits.has(phone.slice(-8)));

        if (!isKnown) {
          contactsToBackfill.push({
            id: cId,
            contact_id: cId,
            objectId: cId,
            properties: p,
            timestamp: p.lastmodifieddate || p.createdate || new Date().toISOString(),
          });
        } else {
          alreadyPresent.push(cId);
        }
      }

      // 3. Process missing contacts in batches of 50
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalIgnored = 0;
      let totalConflicts = 0;
      const batchSize = 50;

      for (let i = 0; i < contactsToBackfill.length; i += batchSize) {
        const batch = contactsToBackfill.slice(i, i + batchSize);
        const { data: batchResult, error: batchErr } = await db.rpc('process_hubspot_inbound_batch', {
          p_events: batch,
        });

        if (batchErr) {
          console.error('Backfill batch error at chunk ' + i + ':', batchErr);
        } else if (batchResult) {
          totalCreated += batchResult.created_count || 0;
          totalUpdated += batchResult.updated_count || 0;
          totalIgnored += batchResult.ignored_count || 0;
          totalConflicts += batchResult.conflict_count || 0;
        }
      }

      // 4. Update integration_connections watermark
      const nowIso = new Date().toISOString();
      await db
        .from('integration_connections')
        .update({
          last_sync_at: nowIso,
          last_reconciliation_at: nowIso,
          last_successful_api_call_at: nowIso,
        })
        .eq('provider', 'hubspot');

      return new Response(
        JSON.stringify({
          success: true,
          total_scanned: contacts.length,
          already_present: alreadyPresent.length,
          attempted_backfill: contactsToBackfill.length,
          created_count: totalCreated,
          updated_count: totalUpdated,
          ignored_count: totalIgnored,
          conflict_count: totalConflicts,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'check_lead_safety') {
      const { data: messages } = await db.from('outbound_messages').select('*').eq('lead_id', body.lead_id);
      const { data: activities } = await db.from('lead_activities').select('*').eq('lead_id', body.lead_id);
      const { data: intakeEvents } = await db.from('lead_intake_events').select('*').eq('lead_id', body.lead_id);
      const { data: lead } = await db.from('leads').select('*').eq('id', body.lead_id).single();
      return new Response(
        JSON.stringify({
          success: true,
          messagesCount: messages?.length || 0,
          messages: messages || [],
          activities: activities || [],
          intakeEvents: intakeEvents || [],
          lead,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'audit_hubspot_contact') {
      const contactId = body.contact_id || '558246046440';
      const cachedPropsRes = await db.from('integration_property_cache').select('property_name').eq('integration', 'hubspot');
      const propNames = cachedPropsRes.data?.map((p: any) => p.property_name) || [];
      const extraProps = [
        'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
        'recent_conversion_event_name', 'recent_conversion_date', 'first_conversion_event_name', 'first_conversion_date',
        'hs_lead_status', 'curso_de_interesse', 'curso_de_interesse_2', 'curso_de_interesse_3',
        'contact_preference', 'preferencia_de_contato', 'status_de_qualificacao', 'firstname', 'lastname', 'email', 'phone', 'mobilephone',
        'hs_object_id', 'createdate', 'lastmodifieddate', 'hs_all_contact_vids', 'hs_facebook_ad_id', 'hs_facebook_adset_id', 'hs_facebook_campaign_id',
        'hs_facebook_click_id', 'hs_google_click_id', 'hs_analytics_first_url', 'hs_analytics_last_url', 'hs_analytics_num_page_views',
        'hs_analytics_num_visits', 'hs_analytics_average_page_views', 'hs_email_domain', 'hs_marketable_status',
        'lead_source', 'source', 'lead_form', 'form_name', 'form_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
      ];
      const allPropsSet = new Set([...propNames, ...extraProps]);
      const propQuery = Array.from(allPropsSet).join(',');

      let crmContact: any = null;
      let crmContactErr: any = null;
      try {
        const crmRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=${propQuery}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (crmRes.ok) {
          crmContact = await crmRes.json();
        } else {
          crmContactErr = await crmRes.text();
        }
      } catch (e: any) {
        crmContactErr = e.message;
      }

      let classicProfile: any = null;
      let classicErr: any = null;
      try {
        const classicRes = await fetch(`https://api.hubapi.com/contacts/v1/contact/vid/${contactId}/profile`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (classicRes.ok) {
          classicProfile = await classicRes.json();
        } else {
          classicErr = await classicRes.text();
        }
      } catch (e: any) {
        classicErr = e.message;
      }

      const populatedProperties: Record<string, any> = {};
      if (crmContact?.properties) {
        for (const [k, v] of Object.entries(crmContact.properties)) {
          if (v !== null && v !== '' && v !== undefined) {
            populatedProperties[k] = v;
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          contactId,
          crmContactErr,
          classicErr,
          formSubmissions: classicProfile?.['form-submissions'] || [],
          populatedProperties,
          identityProfiles: classicProfile?.['identity-profiles'] || [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'backfill_forms') {
      const mode = body.mode === 'execute' ? 'execute' : 'dry_run';
      const targetLeadId = body.lead_id || null;
      const targetLimit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);

      let leadsToProcess: any[] = [];
      if (targetLeadId) {
        const { data: rawLead, error: leadErr } = await db
          .from('leads')
          .select('id, first_name, last_name, email, phone_e164, phone_raw, source, source_detail, course_interest, hubspot_contact_id, source_created_at, created_at')
          .eq('id', targetLeadId)
          .single();
        if (leadErr) throw leadErr;
        if (rawLead) leadsToProcess = [rawLead];
      } else {
        const { data: unbackfilledLeads, error: rpcErr } = await db.rpc('get_unbackfilled_form_leads', {
          p_limit: targetLimit,
        });
        if (rpcErr) throw rpcErr;
        leadsToProcess = unbackfilledLeads || [];
      }

      const propList = [
        'firstname', 'lastname', 'email', 'confirm_your_email', 'please_confirm_your_email_address',
        'phone', 'mobilephone', 'curso_de_interesse', 'curso_de_interesse_2', 'curso_de_interesse_3',
        'data_do_curso_de_interesse', 'origem_do_lead', 'what_is_your_preferred_contact_method',
        'what_is_your_preferred_method_of_contact', 'what_is_your_current_license_status',
        'when_would_you_like_to_attend_our_intensive_course', 'education_level',
        'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
        'first_conversion_event_name', 'first_conversion_date', 'recent_conversion_event_name', 'recent_conversion_date',
        'hs_calculated_form_submissions', 'hs_object_source_detail_1', 'hs_object_source_id',
        'createdate', 'lastmodifieddate'
      ];

      let totalAnalyzed = 0;
      let totalRecovered = 0;
      let totalUnrecoverable = 0;
      const recoveryResults: any[] = [];
      const submissionsToUpsert: any[] = [];

      // Process leads in batches of 100 via HubSpot Batch Read API
      const BATCH_SIZE = 100;
      for (let i = 0; i < leadsToProcess.length; i += BATCH_SIZE) {
        const chunk = leadsToProcess.slice(i, i + BATCH_SIZE);
        const contactInputs = chunk.map(l => ({ id: String(l.hubspot_contact_id) }));

        let batchResultsMap = new Map<string, any>();
        try {
          const batchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/batch/read`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: propList,
              inputs: contactInputs,
            }),
          });

          if (batchRes.ok) {
            const batchJson = await batchRes.json();
            for (const item of (batchJson.results || [])) {
              batchResultsMap.set(String(item.id), item.properties || {});
            }
          } else {
            console.error('Batch read error:', await batchRes.text());
          }
        } catch (bErr) {
          console.error('Batch fetch error:', bErr);
        }

        for (const lead of chunk) {
          totalAnalyzed++;
          const contactId = String(lead.hubspot_contact_id);
          const props = batchResultsMap.get(contactId);

          if (!props) {
            totalUnrecoverable++;
            recoveryResults.push({ lead_id: lead.id, contactId, name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(), status: 'unrecoverable', reason: 'not_found_in_hubspot' });
            continue;
          }

          // Check if contact has form submissions or conversion event
          const hasCalculated = Boolean(props.hs_calculated_form_submissions);
          const hasConversion = Boolean(props.first_conversion_event_name || props.recent_conversion_event_name || props.hs_object_source_detail_1);
          const isMetaOrFormOrigin = lead.source === 'meta' || lead.source === 'form' || Boolean(props.origem_do_lead);

          if (!hasCalculated && !hasConversion && !isMetaOrFormOrigin) {
            totalUnrecoverable++;
            recoveryResults.push({ lead_id: lead.id, contactId, name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(), status: 'unrecoverable', reason: 'no_form_or_conversion' });
            continue;
          }

          // Multiple submissions detection:
          // If hs_calculated_form_submissions has multiple entries separated by semicolon (e.g. "form1::ts1;form2::ts2")
          const subEntries: { formId?: string; ts?: number; title?: string }[] = [];
          if (hasCalculated && String(props.hs_calculated_form_submissions).includes(';')) {
            const parts = String(props.hs_calculated_form_submissions).split(';');
            for (const part of parts) {
              const [fId, fTs] = part.split('::');
              subEntries.push({
                formId: fId || undefined,
                ts: fTs ? Number(fTs) : undefined,
                title: props.recent_conversion_event_name || props.first_conversion_event_name || props.hs_object_source_detail_1,
              });
            }
          } else {
            subEntries.push({
              formId: props.hs_object_source_id || undefined,
              ts: props.first_conversion_date ? Date.parse(props.first_conversion_date) : props.createdate ? Date.parse(props.createdate) : undefined,
              title: props.first_conversion_event_name || props.recent_conversion_event_name || props.hs_object_source_detail_1 || lead.course_interest,
            });
          }

          const leadRecoveries: any[] = [];
          for (let sIdx = 0; sIdx < subEntries.length; sIdx++) {
            const sub = subEntries[sIdx];
            const rawTitle = sub.title || props.first_conversion_event_name || props.recent_conversion_event_name || lead.course_interest || 'Inscrição';
            const cleanFormName = String(rawTitle).replace(/^(Facebook Lead Ads:\s*|Register For Our Course [—–-]\s*Expert Dental Solutions:\s*)/i, '').trim();

            let sourceLabel = 'Meta Lead Ads';
            const leadOrigin = (props.origem_do_lead || '').toLowerCase();
            const source1 = (props.hs_analytics_source_data_1 || '').toLowerCase();
            const sourceDetail = (lead.source_detail || '').toLowerCase();

            if (leadOrigin.includes('instagram') || sourceDetail.includes('instagram')) {
              sourceLabel = 'Instagram Lead Ads';
            } else if (leadOrigin.includes('facebook') || source1.includes('facebook') || sourceDetail.includes('facebook')) {
              sourceLabel = 'Facebook Lead Ads';
            } else if (source1.includes('expdentalsolutions.com') || lead.source === 'form' || sourceDetail.includes('website')) {
              sourceLabel = 'Site';
            }

            const subTimestamp = sub.ts ? new Date(sub.ts).toISOString() : (props.first_conversion_date || props.createdate || lead.source_created_at || lead.created_at);
            const subId = sub.formId ? (sIdx > 0 ? `${sub.formId}_${sIdx}` : sub.formId) : (sIdx > 0 ? `sub_${sIdx}` : 'initial');
            const idempotencyKey = `hubspot_form:${contactId}:${subId}`;

            const submittedData: Record<string, any> = {
              first_name: props.firstname || lead.first_name || null,
              last_name: props.lastname || lead.last_name || null,
              email: props.email || lead.email || null,
              confirm_email: props.confirm_your_email || props.please_confirm_your_email_address || null,
              phone: props.phone || props.mobilephone || lead.phone_e164 || lead.phone_raw || null,
              course_interest: props.curso_de_interesse || lead.course_interest || null,
              curso_de_interesse_2: props.curso_de_interesse_2 || null,
              curso_de_interesse_3: props.curso_de_interesse_3 || null,
              course_session: props.data_do_curso_de_interesse || null,
              contact_preference: props.what_is_your_preferred_contact_method || props.what_is_your_preferred_method_of_contact || lead.contact_preference || null,
              what_is_your_preferred_contact_method: props.what_is_your_preferred_contact_method || null,
              what_is_your_current_license_status: props.what_is_your_current_license_status || null,
              when_would_you_like_to_attend_our_intensive_course: props.when_would_you_like_to_attend_our_intensive_course || null,
              education_level: props.education_level || null,
              campaign: props.hs_analytics_source_data_2 || props.utm_campaign || null,
              utm_source: props.hs_analytics_source_data_1 || props.utm_source || null,
              source_platform: props.origem_do_lead || null,
              form_name: cleanFormName,
              synchronized_via: 'HubSpot',
            };

            const cleanSubmittedData: Record<string, any> = {};
            for (const [k, v] of Object.entries(submittedData)) {
              if (v !== null && v !== undefined && v !== '') {
                cleanSubmittedData[k] = v;
              }
            }

            const subRecord = {
              lead_id: lead.id,
              form_id: null,
              form_name: cleanFormName,
              source: sourceLabel,
              source_detail: props.origem_do_lead || lead.source_detail || 'hubspot_historical',
              external_form_id: sub.formId || null,
              external_submission_id: String(subId),
              email: props.email || lead.email || null,
              phone_e164: lead.phone_e164 || props.phone || null,
              contact_preference: props.what_is_your_preferred_contact_method || lead.contact_preference || null,
              course_interest: props.curso_de_interesse || lead.course_interest || null,
              submitted_data: cleanSubmittedData,
              processing_status: 'historical_backfill',
              recovery_state: 'complete',
              idempotency_key: idempotencyKey,
              submitted_at: subTimestamp,
            };

            submissionsToUpsert.push(subRecord);

            leadRecoveries.push({
              form_name: cleanFormName,
              source: sourceLabel,
              submitted_at: subTimestamp,
              idempotency_key: idempotencyKey,
              fields_count: Object.keys(cleanSubmittedData).length,
            });
          }

          totalRecovered++;
          recoveryResults.push({
            lead_id: lead.id,
            contactId,
            name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
            submissions_count: leadRecoveries.length,
            submissions: leadRecoveries,
            status: 'recovered',
          });
        }
      }

      let upsertedCount = 0;
      let lastUpsertError: string | null = null;
      if (mode === 'execute' && submissionsToUpsert.length > 0) {
        // Deduplicate submissions by idempotency_key to prevent PostgreSQL ON CONFLICT row affect error
        const dedupedMap = new Map<string, any>();
        for (const sub of submissionsToUpsert) {
          dedupedMap.set(sub.idempotency_key, sub);
        }
        const dedupedList = Array.from(dedupedMap.values());

        // Upsert in batches of 100
        for (let i = 0; i < dedupedList.length; i += 100) {
          const slice = dedupedList.slice(i, i + 100);
          const { error: insErr } = await db.from('form_submissions').upsert(slice, {
            onConflict: 'idempotency_key',
          });
          if (insErr) {
            console.error('Error upserting backfill submissions slice:', insErr);
            lastUpsertError = insErr.message || JSON.stringify(insErr);
          } else {
            upsertedCount += slice.length;
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          mode,
          total_analyzed: totalAnalyzed,
          total_recovered: totalRecovered,
          total_unrecoverable: totalUnrecoverable,
          submissions_to_upsert: submissionsToUpsert.length,
          upserted_count: upsertedCount,
          last_upsert_error: lastUpsertError,
          results_count: recoveryResults.length,
          sample_results: recoveryResults.slice(0, 10),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'investigate_incident') {
      // 1. Check forms
      const { data: forms } = await db.from('forms').select('*');
      
      // 2. Check form submissions
      const { data: formSubmissions } = await db
        .from('form_submissions')
        .select('*')
        .order('submitted_at', { ascending: false })
        .limit(100);

      // 3. Check lead intake events
      const { data: recentIntakeEvents } = await db
        .from('lead_intake_events')
        .select('id, source, external_event_id, status, lead_id, attempt_count, last_error, received_at')
        .order('received_at', { ascending: false })
        .limit(50);

      // 4. Check integration connections
      const { data: connection } = await db
        .from('integration_connections')
        .select('*')
        .eq('provider', 'hubspot')
        .single();

      // 5. Check recent integration sync events
      const { data: syncEvents } = await db
        .from('integration_sync_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      // 6. Check recent leads in EDS (past 7 days)
      const { data: recentLeads } = await db
        .from('leads')
        .select('id, first_name, last_name, email, phone_raw, phone_e164, source, source_detail, hubspot_contact_id, pipeline_stage_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      // 7. Query HubSpot API for recently created or modified contacts (all within last 14 days)
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      let hsRecentContacts: any[] = [];
      let hsTotalContacts = 0;

      if (token) {
        // Search contacts created since Sept 1, 2026
        const createdFilterTime = Date.parse('2026-09-01T00:00:00.000Z');
        let afterCursor: string | undefined = undefined;
        do {
          const bodyPayload: any = {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'createdate',
                    operator: 'GTE',
                    value: String(createdFilterTime),
                  },
                ],
              },
            ],
            properties: [
              'firstname',
              'lastname',
              'email',
              'phone',
              'mobilephone',
              'hs_lead_status',
              'status_de_qualificacao',
              'course_interest',
              'curso_de_interesse',
              'hs_analytics_source',
              'hs_analytics_source_data_1',
              'hs_analytics_source_data_2',
              'createdate',
              'lastmodifieddate',
            ],
            limit: 100,
            sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
          };
          if (afterCursor) bodyPayload.after = afterCursor;

          const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(bodyPayload),
          });

          if (searchRes.ok) {
            const sData = await searchRes.json();
            const results = sData.results || [];
            hsRecentContacts.push(...results);
            hsTotalContacts = sData.total || hsRecentContacts.length;
            afterCursor = sData.paging?.next?.after;
          } else {
            break;
          }
        } while (afterCursor);
      }

      // Check which HubSpot recent contacts exist in EDS HUB
      const hsMissingFromEds: any[] = [];
      const hsPresentInEds: any[] = [];

      for (const contact of hsRecentContacts) {
        const contactId = String(contact.id);
        const email = contact.properties?.email ? String(contact.properties.email).trim().toLowerCase() : null;
        const phone = contact.properties?.phone || contact.properties?.mobilephone || null;

        // Check in EDS by hubspot_contact_id or email
        let matchQuery = db.from('leads').select('id, first_name, last_name, email, source, source_detail, pipeline_stage_id, created_at');
        if (contactId && email) {
          matchQuery = matchQuery.or(`hubspot_contact_id.eq.${contactId},email.ilike.${email}`);
        } else if (contactId) {
          matchQuery = matchQuery.eq('hubspot_contact_id', contactId);
        } else if (email) {
          matchQuery = matchQuery.ilike('email', email);
        }

        const { data: matchedLeads } = await matchQuery.limit(1);

        if (matchedLeads && matchedLeads.length > 0) {
          hsPresentInEds.push({
            hs_id: contactId,
            eds_lead_id: matchedLeads[0].id,
            email: email,
            name: `${contact.properties?.firstname || ''} ${contact.properties?.lastname || ''}`.trim(),
            createdate: contact.properties?.createdate,
            lastmodifieddate: contact.properties?.lastmodifieddate,
            source: matchedLeads[0].source,
          });
        } else {
          hsMissingFromEds.push({
            hs_id: contactId,
            email: email,
            name: `${contact.properties?.firstname || ''} ${contact.properties?.lastname || ''}`.trim(),
            phone: phone,
            createdate: contact.properties?.createdate,
            lastmodifieddate: contact.properties?.lastmodifieddate,
            hs_analytics_source: contact.properties?.hs_analytics_source,
            hs_analytics_source_data_1: contact.properties?.hs_analytics_source_data_1,
            hs_analytics_source_data_2: contact.properties?.hs_analytics_source_data_2,
            curso_de_interesse: contact.properties?.curso_de_interesse,
            status_de_qualificacao: contact.properties?.status_de_qualificacao,
          });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          forms,
          formSubmissionsCount: formSubmissions?.length || 0,
          formSubmissions: formSubmissions || [],
          recentIntakeEvents: recentIntakeEvents || [],
          connection,
          recentSyncEvents: syncEvents || [],
          recentLeadsCount: recentLeads?.length || 0,
          recentLeads: recentLeads || [],
          hubspot_analysis: {
            total_recent_in_hs: hsRecentContacts.length,
            total_in_search: hsTotalContacts,
            present_in_eds_count: hsPresentInEds.length,
            missing_from_eds_count: hsMissingFromEds.length,
            missing_contacts: hsMissingFromEds,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'fix_sms_template') {
      const officialZygomaticSms = `Hello Dr.
This is Natália from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.

I just sent you an email with all the course details.

To help you choose the best option, could you tell me a little about your implant experience?

We currently have openings for our November 7 to 10 course. Would those dates work for you?

I’m happy to answer any questions and help you find the course that best matches your goals.`;

      // 1. Update public.email_templates for zygomatic_followup_sms
      const { error: updErr } = await db
        .from('email_templates')
        .update({
          category: 'sms',
          has_attachment: false,
          attachment_name: null,
          content_json: {
            channel: 'sms',
            template_key: 'zygomatic_followup_sms',
            has_attachment: false,
          },
          text_template: officialZygomaticSms,
          html_template: `<p>${officialZygomaticSms.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`,
          updated_at: new Date().toISOString(),
        })
        .or('template_key.eq.zygomatic_followup_sms,name.ilike.%Zygomatic — Follow-up SMS%');

      // 2. Remove any attachment association in template_attachments for SMS template
      const { error: delAttErr } = await db
        .from('template_attachments')
        .delete()
        .eq('template_key', 'zygomatic_followup_sms');

      // 3. Verify Zygomatic email attachment is still intact
      const { data: emailAtt } = await db
        .from('template_attachments')
        .select('*')
        .eq('template_key', 'zygomatic_course_details');

      // 4. Update transactional_templates if table exists
      try {
        await db
          .from('transactional_templates')
          .update({
            body_template: officialZygomaticSms,
            updated_at: new Date().toISOString(),
          })
          .eq('key', 'zygomatic_followup_sms');
      } catch (_e) {
        // non-blocking
      }

      const { data: tpls } = await db
        .from('email_templates')
        .select('id, name, template_key, category, has_attachment, content_json, text_template');

      return new Response(
        JSON.stringify({
          success: true,
          action: 'fix_sms_template',
          email_templates_updated: !updErr,
          sms_attachment_removed: !delAttErr,
          zygomatic_email_attachment_intact: (emailAtt || []).length > 0,
          templates: tpls,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'reconcile_courses') {
      const mode = body.mode || 'dry_run'; // 'dry_run' | 'execute'

      // 1. Fetch all canonical courses from database
      const { data: dbCourses, error: cErr } = await db
        .from('courses')
        .select('id, code, name, default_price')
        .order('sort_order', { ascending: true });

      if (cErr || !dbCourses) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to load courses', details: cErr }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const courseByCode = new Map<string, any>();
      for (const c of dbCourses) {
        courseByCode.set(c.code.toUpperCase(), c);
      }

      // 2. Paged fetch of ALL leads
      const allLeads: any[] = [];
      let lFrom = 0;
      while (true) {
        const { data: page, error } = await db
          .from('leads')
          .select('id, hubspot_contact_id, email, course_interest, course_interests, source, source_detail, pipeline_stage_id')
          .range(lFrom, lFrom + 999);
        if (error) {
          console.error('Error fetching leads in reconcile_courses:', error);
          break;
        }
        if (!page || page.length === 0) break;
        allLeads.push(...page);
        if (page.length < 1000) break;
        lFrom += 1000;
      }

      // 3. Paged fetch of ALL existing lead_course_interests
      const allInterests: any[] = [];
      let iFrom = 0;
      while (true) {
        const { data: page, error } = await db
          .from('lead_course_interests')
          .select('id, lead_id, course_id, priority, status, source')
          .range(iFrom, iFrom + 999);
        if (error || !page || page.length === 0) break;
        allInterests.push(...page);
        if (page.length < 1000) break;
        iFrom += 1000;
      }

      const existingInterestLeadIds = new Set<string>();
      const existingInterestsByLead = new Map<string, Set<string>>();
      for (const item of allInterests) {
        existingInterestLeadIds.add(item.lead_id);
        if (!existingInterestsByLead.has(item.lead_id)) {
          existingInterestsByLead.set(item.lead_id, new Set());
        }
        existingInterestsByLead.get(item.lead_id)!.add(item.course_id);
      }

      // Metric before reconciliation
      let beforeWithInterest = 0;
      let beforeWithoutInterest = 0;
      const leadsWithoutInterest: any[] = [];

      for (const lead of allLeads) {
        const hasInterestsInTable = existingInterestLeadIds.has(lead.id);
        const hasLegacyText = Boolean(lead.course_interest && lead.course_interest.trim().length > 0);
        if (hasInterestsInTable || hasLegacyText) {
          beforeWithInterest++;
        } else {
          beforeWithoutInterest++;
          leadsWithoutInterest.push(lead);
        }
      }

      // Fetch HubSpot contact properties
      const hsContactsWithCourses = new Map<string, any>();
      const hsContactsByEmail = new Map<string, any>();

      if (token) {
        let afterCursor: string | undefined = undefined;
        const propList = 'email,curso_de_interesse,curso_de_interesse_2,curso_de_interesse_3,hs_analytics_source,hs_analytics_source_data_1,hs_analytics_source_data_2,utm_campaign';
        do {
          let fetchUrl = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=${propList}`;
          if (afterCursor) fetchUrl += `&after=${encodeURIComponent(afterCursor)}`;

          const hsRes = await fetch(fetchUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (!hsRes.ok) break;
          const hsData = await hsRes.json();
          const results = hsData.results || [];
          for (const item of results) {
            const p = item.properties || {};
            hsContactsWithCourses.set(String(item.id), p);
            if (p.email) hsContactsByEmail.set(String(p.email).toLowerCase().trim(), p);
          }
          afterCursor = hsData.paging?.next?.after;
        } while (afterCursor);
      }

      // Reconciliation processing
      let mappedSuccessfully = 0;
      let stillUnmapped = 0;

      const sourceBreakdown = {
        'Meta Form ID': 0,
        'Meta Form Name': 0,
        'HubSpot course property': 0,
        'HubSpot form/history': 0,
        'Campaign/ad metadata': 0,
        'Other factual metadata': 0,
      };

      const plannedEnrichments: Array<{
        leadId: string;
        courseId: string;
        courseCode: string;
        priority: number;
        source: string;
        sourceCategory: keyof typeof sourceBreakdown;
        rawSignal: string;
      }> = [];

      for (const lead of leadsWithoutInterest) {
        const hsContactProps = lead.hubspot_contact_id
          ? (hsContactsWithCourses.get(String(lead.hubspot_contact_id)) || (lead.email ? hsContactsByEmail.get(lead.email.toLowerCase()) : null))
          : (lead.email ? hsContactsByEmail.get(lead.email.toLowerCase()) : null);

        // Check if lead has course_interests JSONB populated
        const jsonInterests: string[] = Array.isArray(lead.course_interests)
          ? lead.course_interests.map((x: any) => typeof x === 'string' ? x : (x.course_code || x.name || x.code || '')).filter(Boolean)
          : [];

        const metaFormId = hsContactProps?.hs_analytics_source_data_2;
        const metaFormName = hsContactProps?.hs_analytics_source_data_1 || (lead.source_detail && !lead.source_detail.startsWith('hubspot') ? lead.source_detail : null);
        const hsCourse1 = hsContactProps?.curso_de_interesse || jsonInterests[0];
        const hsCourse2 = hsContactProps?.curso_de_interesse_2 || jsonInterests[1];
        const hsCourse3 = hsContactProps?.curso_de_interesse_3 || jsonInterests[2];
        const campaign = hsContactProps?.utm_campaign;

        const signalsToResolve: Array<{ raw: string; cat: keyof typeof sourceBreakdown }> = [];

        if (metaFormId && typeof metaFormId === 'string' && metaFormId.trim()) {
          signalsToResolve.push({ raw: metaFormId, cat: 'Meta Form ID' });
        }
        if (metaFormName && typeof metaFormName === 'string' && metaFormName.trim()) {
          signalsToResolve.push({ raw: metaFormName, cat: 'Meta Form Name' });
        }
        if (hsCourse1 && typeof hsCourse1 === 'string' && hsCourse1.trim()) {
          signalsToResolve.push({ raw: hsCourse1, cat: 'HubSpot course property' });
        }
        if (hsCourse2 && typeof hsCourse2 === 'string' && hsCourse2.trim()) {
          signalsToResolve.push({ raw: hsCourse2, cat: 'HubSpot course property' });
        }
        if (hsCourse3 && typeof hsCourse3 === 'string' && hsCourse3.trim()) {
          signalsToResolve.push({ raw: hsCourse3, cat: 'HubSpot course property' });
        }
        if (campaign && typeof campaign === 'string' && campaign.trim()) {
          signalsToResolve.push({ raw: campaign, cat: 'Campaign/ad metadata' });
        }

        let leadHasMatch = false;
        let priorityCounter = 1;
        const leadSeenCourses = new Set<string>();

        for (const s of signalsToResolve) {
          const resolved = resolveCanonicalCourse(s.raw);
          if (resolved.status === 'resolved' && resolved.courseCode) {
            const courseRecord = courseByCode.get(resolved.courseCode.toUpperCase());
            if (courseRecord && !leadSeenCourses.has(resolved.courseCode)) {
              leadSeenCourses.add(resolved.courseCode);
              leadHasMatch = true;
              sourceBreakdown[s.cat]++;

              plannedEnrichments.push({
                leadId: lead.id,
                courseId: courseRecord.id,
                courseCode: resolved.courseCode,
                priority: priorityCounter++,
                source: s.cat,
                sourceCategory: s.cat,
                rawSignal: s.raw,
              });

              if (priorityCounter > 3) break;
            }
          }
        }

        if (leadHasMatch) {
          mappedSuccessfully++;
        } else {
          stillUnmapped++;
        }
      }

      // If mode === 'execute', write enrichments idempotently
      let insertedCount = 0;
      let updatedLeadsCount = 0;

      if (mode === 'execute' && plannedEnrichments.length > 0) {
        const batchSize = 200;
        const nowIso = new Date().toISOString();

        for (let i = 0; i < plannedEnrichments.length; i += batchSize) {
          const chunk = plannedEnrichments.slice(i, i + batchSize);
          const recordsToInsert = chunk.map((p) => ({
            lead_id: p.leadId,
            course_id: p.courseId,
            priority: p.priority,
            status: 'active',
            source: p.source,
            created_at: nowIso,
            updated_at: nowIso,
          }));

          const { error: insErr } = await db
            .from('lead_course_interests')
            .upsert(recordsToInsert, { onConflict: 'lead_id,course_id' });

          if (!insErr) {
            insertedCount += recordsToInsert.length;
          } else {
            console.error('Error inserting lead_course_interests:', insErr);
          }
        }

        // Fast grouped bulk update for leads.course_interest
        const priority1Items = plannedEnrichments.filter((p) => p.priority === 1);
        const courseToLeadIds = new Map<string, string[]>();

        for (const item of priority1Items) {
          const course = dbCourses.find((c) => c.id === item.courseId);
          if (course && course.name) {
            if (!courseToLeadIds.has(course.name)) {
              courseToLeadIds.set(course.name, []);
            }
            courseToLeadIds.get(course.name)!.push(item.leadId);
          }
        }

        for (const [courseName, leadIds] of courseToLeadIds.entries()) {
          for (let i = 0; i < leadIds.length; i += batchSize) {
            const chunk = leadIds.slice(i, i + batchSize);
            const { error: updErr } = await db
              .from('leads')
              .update({ course_interest: courseName, updated_at: nowIso })
              .in('id', chunk)
              .is('course_interest', null);

            if (!updErr) {
              updatedLeadsCount += chunk.length;
            } else {
              console.error(`Error updating leads course_interest for ${courseName}:`, updErr);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          mode,
          metrics_before: {
            total_leads: allLeads.length,
            with_course_interest: beforeWithInterest,
            without_course_interest: beforeWithoutInterest,
          },
          reconciliation_outcome: {
            mapped_successfully: mappedSuccessfully,
            still_unmapped: stillUnmapped,
            source_breakdown: sourceBreakdown,
            planned_enrichments_count: plannedEnrichments.length,
            inserted_interests_count: insertedCount,
            updated_leads_count: updatedLeadsCount,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'verify_backfill') {
      const { data: stagesData } = await db.from('pipeline_stages').select('id, code, name').order('sort_order', { ascending: true });
      const stageMap: Record<string, string> = {};
      for (const s of (stagesData || [])) stageMap[s.id] = s.code;

      // Paged retrieval of ALL audit events for backfill
      const auditEvents: any[] = [];
      let aFrom = 0;
      while (true) {
        const { data: page, error } = await db
          .from('integration_sync_events')
          .select('eds_entity_id, external_entity_id, change_summary')
          .eq('event_type', 'hubspot_pipeline_historical_backfill')
          .range(aFrom, aFrom + 999);
        if (error || !page || page.length === 0) break;
        auditEvents.push(...page);
        if (page.length < 1000) break;
        aFrom += 1000;
      }

      const auditByCode: Record<string, number> = {
        capture: 0,
        qualification: 0,
        acquisition: 0,
        approval: 0,
        enrollment: 0,
      };

      const auditedLeadIds = new Set<string>();
      for (const e of auditEvents) {
        auditedLeadIds.add(e.eds_entity_id);
        const code = e.change_summary?.new_stage_code;
        if (code && auditByCode[code] !== undefined) {
          auditByCode[code]++;
        }
      }

      // Paged retrieval of ALL leads
      const allLeads: any[] = [];
      let lFrom = 0;
      while (true) {
        const { data: page, error } = await db
          .from('leads')
          .select('id, hubspot_contact_id, source, pipeline_stage_id, email, first_name, last_name')
          .range(lFrom, lFrom + 999);
        if (error || !page || page.length === 0) break;
        allLeads.push(...page);
        if (page.length < 1000) break;
        lFrom += 1000;
      }

      const auditedLeadsInDb: Record<string, number> = {
        capture: 0,
        qualification: 0,
        acquisition: 0,
        approval: 0,
        enrollment: 0,
      };

      const nonAuditedLeads: any[] = [];

      for (const l of allLeads) {
        const stageCode = stageMap[l.pipeline_stage_id] || 'unknown';
        if (auditedLeadIds.has(l.id)) {
          if (auditedLeadsInDb[stageCode] !== undefined) {
            auditedLeadsInDb[stageCode]++;
          }
        } else {
          nonAuditedLeads.push({
            id: l.id,
            email: l.email,
            first_name: l.first_name,
            source: l.source,
            stage_code: stageCode,
          });
        }
      }

      const { data: globalPipelineCounts } = await db.rpc('get_pipeline_stage_counts');

      return new Response(
        JSON.stringify({
          success: true,
          total_audit_events: auditEvents.length,
          audit_stage_distribution: auditByCode,
          audited_leads_current_distribution: auditedLeadsInDb,
          non_audited_leads_count: nonAuditedLeads.length,
          non_audited_leads: nonAuditedLeads,
          total_global_leads: allLeads.length,
          global_pipeline_counts: globalPipelineCounts,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'backfill_dry_run' || body.action === 'backfill_execute') {
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'HubSpot token required for backfill' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }


      // 1. Fetch all pipeline stages
      const { data: stagesData, error: stagesErr } = await db
        .from('pipeline_stages')
        .select('id, code, name, sort_order')
        .order('sort_order', { ascending: true });

      if (stagesErr || !stagesData) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to load pipeline stages', details: stagesErr }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const stageMap: Record<string, { id: string; name: string }> = {};
      for (const s of stagesData) {
        stageMap[s.code] = { id: s.id, name: s.name };
      }

      // 2. Fetch all contacts from HubSpot with status_de_qualificacao
      const allHsContacts: Array<{
        id: string;
        email: string | null;
        firstname: string | null;
        lastname: string | null;
        status_de_qualificacao: string | null;
        createdate: string | null;
      }> = [];

      let afterCursor: string | undefined = undefined;
      const propList = 'status_de_qualificacao,email,firstname,lastname,createdate';

      do {
        let fetchUrl = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=${propList}`;
        if (afterCursor) {
          fetchUrl += `&after=${encodeURIComponent(afterCursor)}`;
        }

        const hsRes = await fetch(fetchUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!hsRes.ok) {
          const errText = await hsRes.text();
          return new Response(
            JSON.stringify({ success: false, error: `HubSpot API error (${hsRes.status}): ${errText}` }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const hsData = await hsRes.json();
        const results = hsData.results || [];

        for (const item of results) {
          const p = item.properties || {};
          allHsContacts.push({
            id: String(item.id),
            email: p.email ? String(p.email).trim().toLowerCase() : null,
            firstname: p.firstname || null,
            lastname: p.lastname || null,
            status_de_qualificacao: p.status_de_qualificacao ? String(p.status_de_qualificacao).trim() : null,
            createdate: p.createdate || null,
          });
        }

        afterCursor = hsData.paging?.next?.after;
      } while (afterCursor);

      // 3. Raw tally of status_de_qualificacao
      const rawCounts: Record<string, number> = {
        'Sem resposta': 0,
        'Alguma resposta': 0,
        'Interessado': 0,
        'Quente': 0,
        'Confirmado': 0,
        'NULL / não preenchido': 0,
        'Other': 0,
      };

      // 4. Target EDS stage distribution
      const edsTargetCounts: Record<string, number> = {
        'Novo Lead': 0,    // capture (Sem resposta = 2,282)
        'Respondido': 0,   // qualification (Alguma resposta = 43)
        'Interessado': 0,  // acquisition (Interessado = 77 + 71 NULL = 148)
        'Quente': 0,       // approval (Quente = 47)
        'Matrícula': 0,    // enrollment (Confirmado = 112)
      };

      interface ContactMapping {
        hsContactId: string;
        email: string | null;
        rawStatus: string | null;
        targetStageCode: 'capture' | 'qualification' | 'acquisition' | 'approval' | 'enrollment';
        targetStageName: string;
        targetStageId: string;
        qualificationStatus: string;
      }

      const mappingsList: ContactMapping[] = [];

      for (const c of allHsContacts) {
        const raw = c.status_de_qualificacao;
        let targetCode: 'capture' | 'qualification' | 'acquisition' | 'approval' | 'enrollment';
        let targetQualStatus: string;

        if (raw === 'Sem resposta') {
          rawCounts['Sem resposta']++;
          targetCode = 'capture';
          targetQualStatus = 'no_response';
          edsTargetCounts['Novo Lead']++;
        } else if (raw === 'Alguma resposta') {
          rawCounts['Alguma resposta']++;
          targetCode = 'qualification';
          targetQualStatus = 'responded';
          edsTargetCounts['Respondido']++;
        } else if (raw === 'Interessado') {
          rawCounts['Interessado']++;
          targetCode = 'acquisition';
          targetQualStatus = 'qualified';
          edsTargetCounts['Interessado']++;
        } else if (raw === 'Quente') {
          rawCounts['Quente']++;
          targetCode = 'approval';
          targetQualStatus = 'hot';
          edsTargetCounts['Quente']++;
        } else if (raw === 'Confirmado') {
          rawCounts['Confirmado']++;
          targetCode = 'enrollment';
          targetQualStatus = 'enrolled';
          edsTargetCounts['Matrícula']++;
        } else if (!raw) {
          rawCounts['NULL / não preenchido']++;
          targetCode = 'acquisition'; // Explicit user rule: NULL / não preenchido -> Interessado
          targetQualStatus = 'qualified';
          edsTargetCounts['Interessado']++;
        } else {
          rawCounts['Other']++;
          targetCode = 'acquisition'; // Fallback to Interessado
          targetQualStatus = 'qualified';
          edsTargetCounts['Interessado']++;
        }

        mappingsList.push({
          hsContactId: c.id,
          email: c.email,
          rawStatus: raw,
          targetStageCode: targetCode,
          targetStageName: stageMap[targetCode]?.name || targetCode,
          targetStageId: stageMap[targetCode]?.id,
          qualificationStatus: targetQualStatus,
        });
      }

      // 5. Separate Audited Historical Set (up to 2026-09-24T23:59:59.999Z) vs New Inbound Contacts
      const AUDIT_CUTOFF = '2026-09-24T23:59:59.999Z';
      const auditedContacts = allHsContacts.filter((c) => !c.createdate || c.createdate <= AUDIT_CUTOFF);
      const newInboundContacts = allHsContacts.filter((c) => c.createdate && c.createdate > AUDIT_CUTOFF);

      // Re-tally for Audited Historical Set
      const auditedRawCounts: Record<string, number> = {
        'Sem resposta': 0,
        'Alguma resposta': 0,
        'Interessado': 0,
        'Quente': 0,
        'Confirmado': 0,
        'NULL / não preenchido': 0,
        'Other': 0,
      };

      const auditedEdsTargetCounts: Record<string, number> = {
        'Novo Lead': 0,    // capture (Sem resposta = 2,282)
        'Respondido': 0,   // qualification (Alguma resposta = 43)
        'Interessado': 0,  // acquisition (Interessado = 77 + 71 NULL = 148)
        'Quente': 0,       // approval (Quente = 47)
        'Matrícula': 0,    // enrollment (Confirmado = 112)
      };

      for (const c of auditedContacts) {
        const raw = c.status_de_qualificacao;
        if (raw === 'Sem resposta') {
          auditedRawCounts['Sem resposta']++;
          auditedEdsTargetCounts['Novo Lead']++;
        } else if (raw === 'Alguma resposta') {
          auditedRawCounts['Alguma resposta']++;
          auditedEdsTargetCounts['Respondido']++;
        } else if (raw === 'Interessado') {
          auditedRawCounts['Interessado']++;
          auditedEdsTargetCounts['Interessado']++;
        } else if (raw === 'Quente') {
          auditedRawCounts['Quente']++;
          auditedEdsTargetCounts['Quente']++;
        } else if (raw === 'Confirmado') {
          auditedRawCounts['Confirmado']++;
          auditedEdsTargetCounts['Matrícula']++;
        } else if (!raw) {
          auditedRawCounts['NULL / não preenchido']++;
          auditedEdsTargetCounts['Interessado']++;
        } else {
          auditedRawCounts['Other']++;
          auditedEdsTargetCounts['Interessado']++;
        }
      }

      const EXPECTED = {
        total: 2632,
        sem_resposta: 2282,
        alguma_resposta: 43,
        interessado_raw: 77,
        quente: 47,
        confirmado: 112,
        null_raw: 71,
        eds_novo_lead: 2282,
        eds_respondido: 43,
        eds_interessado: 148, // 77 + 71
        eds_quente: 47,
        eds_matricula: 112,
      };

      const isExactMatch =
        auditedContacts.length === EXPECTED.total &&
        auditedRawCounts['Sem resposta'] === EXPECTED.sem_resposta &&
        auditedRawCounts['Alguma resposta'] === EXPECTED.alguma_resposta &&
        auditedRawCounts['Interessado'] === EXPECTED.interessado_raw &&
        auditedRawCounts['Quente'] === EXPECTED.quente &&
        auditedRawCounts['Confirmado'] === EXPECTED.confirmado &&
        auditedRawCounts['NULL / não preenchido'] === EXPECTED.null_raw &&
        auditedEdsTargetCounts['Novo Lead'] === EXPECTED.eds_novo_lead &&
        auditedEdsTargetCounts['Respondido'] === EXPECTED.eds_respondido &&
        auditedEdsTargetCounts['Interessado'] === EXPECTED.eds_interessado &&
        auditedEdsTargetCounts['Quente'] === EXPECTED.eds_quente &&
        auditedEdsTargetCounts['Matrícula'] === EXPECTED.eds_matricula;

      // Paged retrieval of ALL leads from public.leads
      const allLeads: any[] = [];
      let leadFrom = 0;
      while (true) {
        const { data: page, error: pErr } = await db
          .from('leads')
          .select('id, hubspot_contact_id, email, pipeline_stage_id, qualification_status')
          .range(leadFrom, leadFrom + 999);
        if (pErr) throw pErr;
        if (!page || page.length === 0) break;
        allLeads.push(...page);
        if (page.length < 1000) break;
        leadFrom += 1000;
      }

      // Paged retrieval of ALL links from public.integration_entity_links
      const allLinks: any[] = [];
      let linkFrom = 0;
      while (true) {
        const { data: page, error: pErr } = await db
          .from('integration_entity_links')
          .select('eds_entity_id, external_entity_id')
          .eq('integration', 'hubspot')
          .range(linkFrom, linkFrom + 999);
        if (pErr) throw pErr;
        if (!page || page.length === 0) break;
        allLinks.push(...page);
        if (page.length < 1000) break;
        linkFrom += 1000;
      }

      const leadByHsId = new Map<string, any>();
      const leadByEmail = new Map<string, any>();

      for (const l of allLeads) {
        if (l.hubspot_contact_id) leadByHsId.set(String(l.hubspot_contact_id), l);
        if (l.email) leadByEmail.set(String(l.email).toLowerCase(), l);
      }

      for (const link of allLinks) {
        if (!leadByHsId.has(link.external_entity_id)) {
          const matchedLead = allLeads.find((l) => l.id === link.eds_entity_id);
          if (matchedLead) leadByHsId.set(link.external_entity_id, matchedLead);
        }
      }

      let matchedCount = 0;
      let unmatchedCount = 0;
      const matchedPairs: Array<{
        leadId: string;
        hsContactId: string;
        previousStageId: string;
        newStageId: string;
        newStageCode: string;
        newQualStatus: string;
        rawStatus: string | null;
      }> = [];

      // Match ONLY the audited contacts
      for (const m of mappingsList.filter((item) => auditedContacts.some((ac) => ac.id === item.hsContactId))) {
        const lead = leadByHsId.get(m.hsContactId) || (m.email ? leadByEmail.get(m.email) : null);
        if (lead) {
          matchedCount++;
          matchedPairs.push({
            leadId: lead.id,
            hsContactId: m.hsContactId,
            previousStageId: lead.pipeline_stage_id,
            newStageId: m.targetStageId,
            newStageCode: m.targetStageCode,
            newQualStatus: m.qualificationStatus,
            rawStatus: m.rawStatus,
          });
        } else {
          unmatchedCount++;
        }
      }


      // If dry run, return inspection results
      if (body.action === 'backfill_dry_run') {
        const sortedByDate = [...allHsContacts].sort((a, b) => {
          const ta = a.createdate ? new Date(a.createdate).getTime() : 0;
          const tb = b.createdate ? new Date(b.createdate).getTime() : 0;
          return tb - ta;
        });

        return new Response(
          JSON.stringify({
            success: true,
            mode: 'dry_run',
            is_exact_match: isExactMatch,
            audited_historical_metrics: {
              total: auditedContacts.length,
              raw_counts: auditedRawCounts,
              eds_target_counts: auditedEdsTargetCounts,
              matched_leads_in_eds: matchedCount,
              unmatched_contacts: unmatchedCount,
            },
            live_hubspot_metrics: {
              total: allHsContacts.length,
              raw_counts: rawCounts,
              eds_target_counts: edsTargetCounts,
            },
            new_inbound_post_audit_contacts: newInboundContacts,
            expected: EXPECTED,
            total_leads_in_db: allLeads.length,
            newest_5_contacts: sortedByDate.slice(0, 5),
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // EXECUTION GATE: Strictly enforce exact match before writing
      if (!isExactMatch) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'BLOCKED — HUBSPOT BACKFILL COUNT MISMATCH',
            audited_raw_counts: auditedRawCounts,
            audited_eds_target_counts: auditedEdsTargetCounts,
            expected: EXPECTED,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }


      // EXECUTION: Perform transactional batch updates
      const batchId = `backfill_${Date.now()}`;
      const nowIso = new Date().toISOString();
      let updatedCount = 0;
      const batchSize = 100;

      for (let i = 0; i < matchedPairs.length; i += batchSize) {
        const chunk = matchedPairs.slice(i, i + batchSize);

        // Group by newStageId and newQualStatus to do bulk updates
        const groups = new Map<string, string[]>();
        for (const p of chunk) {
          const key = `${p.newStageId}|${p.newQualStatus}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(p.leadId);
        }

        for (const [key, leadIds] of groups.entries()) {
          const [stageId, qualStatus] = key.split('|');
          const { error: updErr } = await db
            .from('leads')
            .update({
              pipeline_stage_id: stageId,
              qualification_status: qualStatus,
              updated_at: nowIso,
            })
            .in('id', leadIds);

          if (updErr) {
            console.error('Backfill update chunk error:', updErr);
          } else {
            updatedCount += leadIds.length;
          }
        }

        // Insert audit records into integration_sync_events
        const auditRecords = chunk.map((p) => ({
          integration: 'hubspot',
          direction: 'inbound',
          entity_type: 'lead',
          eds_entity_id: p.leadId,
          external_entity_id: p.hsContactId,
          event_type: 'hubspot_pipeline_historical_backfill',
          payload_hash: `backfill_hash_${p.leadId}`,
          status: 'completed',
          change_summary: {
            lead_id: p.leadId,
            hubspot_contact_id: p.hsContactId,
            previous_stage_id: p.previousStageId,
            new_stage_id: p.newStageId,
            new_stage_code: p.newStageCode,
            raw_status_de_qualificacao: p.rawStatus,
            backfill_version: 'v1.0_approved_status_de_qualificacao',
            execution_batch_id: batchId,
            backfill_timestamp: nowIso,
          },
        }));

        const { error: insErr } = await db.from('integration_sync_events').insert(auditRecords);

        if (insErr) {
          console.error('Audit insert error:', insErr);
        }

      }

      // Re-fetch pipeline stage counts to verify
      const { data: postPipelineCounts } = await db.rpc('get_pipeline_stage_counts');

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'execute',
          updated_records: updatedCount,
          execution_batch_id: batchId,
          timestamp: nowIso,
          post_pipeline_counts: postPipelineCounts,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    if (body.action === 'audit_stages') {
      const options = ['Sem resposta', 'Alguma resposta', 'Interessado', 'Quente', 'Confirmado', 'Perdido'];
      const counts: Record<string, number> = {};

      for (const opt of options) {
        const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'status_de_qualificacao',
                    operator: 'EQ',
                    value: opt,
                  },
                ],
              },
            ],
            limit: 1,
          }),
        });

        if (res.ok) {
          const d = await res.json();
          counts[opt] = d.total || 0;
        } else {
          counts[opt] = -1;
        }
      }

      // Check without property
      const resNone = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'status_de_qualificacao',
                  operator: 'NOT_HAS_PROPERTY',
                },
              ],
            },
          ],
          limit: 1,
        }),
      });
      const dNone = resNone.ok ? await resNone.json() : { total: -1 };
      counts['(sem_propriedade)'] = dNone.total || 0;

      return new Response(
        JSON.stringify({
          success: true,
          status_de_qualificacao_counts: counts,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiRes = await fetch(`https://api.hubapi.com/crm/v3/properties/contacts`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(
        JSON.stringify({ error: `HubSpot Properties API ${apiRes.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await apiRes.json();
    const results = data.results || [];

    // Upsert into integration_property_cache
    for (const prop of results) {
      await db.from('integration_property_cache').upsert({
        integration: 'hubspot',
        property_name: prop.name,
        label: prop.label || prop.name,
        property_type: prop.type || 'string',
        field_type: prop.fieldType || 'text',
        options: prop.options || null,
        is_custom: !prop.hubspotDefined,
        is_archived: !!prop.archived,
        last_refreshed_at: new Date().toISOString(),
      }, { onConflict: 'integration,property_name' });
    }

    // Evaluate Mapping Health
    const { data: mappings } = await db
      .from('integration_field_mappings')
      .select('*')
      .eq('integration', 'hubspot')
      .eq('is_active', true);

    const propMap = new Map<string, any>(results.map((p: any) => [p.name, p]));
    const mappingHealth: Record<string, string> = {};

    for (const m of (mappings || [])) {
      const prop = propMap.get(m.external_property);
      if (!prop) {
        mappingHealth[m.id] = 'missing_property';
      } else if (prop.archived) {
        mappingHealth[m.id] = 'archived';
      } else {
        mappingHealth[m.id] = 'healthy';
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        properties_count: results.length,
        mapping_health: mappingHealth,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error in hubspot-properties-discovery:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
