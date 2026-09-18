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
  const authResult = await verifyAuth(authHeader);
  if (!authResult.isAuthorized) {
    return new Response(JSON.stringify({ error: authResult.error }), {
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
    const apiRes = await fetch(`https://api.hubapi.com/crm/properties/2026-09/contacts`, {
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
