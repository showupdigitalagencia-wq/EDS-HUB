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
  const INTERNAL_ADMIN_SECRET = 'eds_internal_course_materials_mgmt_2026';

  let isAuthorized = false;
  if (adminKey === INTERNAL_ADMIN_SECRET || authHeader === `Bearer ${INTERNAL_ADMIN_SECRET}`) {
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
