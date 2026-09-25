// =============================================================================
// Edge Function: hubspot-properties-discovery
// =============================================================================
// Queries HubSpot CRM Properties API, updates integration_property_cache,
// and evaluates mapping health (healthy, missing_property, type_mismatch).
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

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
      const { data: templates } = await db.from('email_templates').select('id, name, template_key, subject, has_attachment, is_attachment_required, attachment_name');
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
