// =============================================================================
// Edge Function: campaign-prepare
// =============================================================================
// Resolves audience filters, deduplicates by email, assigns A/B test variants,
// and materializes campaign_recipients in 'pending' status.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

interface PreparePayload {
  campaign_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Verify authorization
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const payload: PreparePayload = await req.json();

    if (!payload.campaign_id) {
      return new Response(
        JSON.stringify({ error: 'Missing campaign_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const db = createAdminClient();

    // 2. Fetch campaign and verify approval status
    const { data: campaign, error: campError } = await db
      .from('campaigns')
      .select('*')
      .eq('id', payload.campaign_id)
      .single();

    if (campError || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (campaign.status !== 'approved' && campaign.status !== 'scheduled') {
      return new Response(
        JSON.stringify({
          error: `Campaign cannot be prepared in status '${campaign.status}'. Mandatory approval required.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Load audience filter definition
    const { data: audience } = await db
      .from('campaign_audiences')
      .select('*')
      .eq('campaign_id', payload.campaign_id)
      .maybeSingle();

    const filters = audience?.filter_definition || {};

    const campChannel = campaign.channel || 'email';
    if (campChannel !== 'email') {
      return new Response(
        JSON.stringify({
          error: `Campaign channel '${campChannel}' does not support bulk automated messaging. Only Email campaigns are permitted.`,
          code: 'CHANNEL_NOT_SUPPORTED',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Query eligible leads
    let query = db
      .from('leads')
      .select('id, email, first_name, last_name, pipeline_stage_id, source, contact_preference')
      .not('email', 'is', null);

    if (filters.pipeline_stage_id) {
      if (Array.isArray(filters.pipeline_stage_id)) {
        query = query.in('pipeline_stage_id', filters.pipeline_stage_id);
      } else {
        query = query.eq('pipeline_stage_id', filters.pipeline_stage_id);
      }
    }

    if (filters.source) {
      if (Array.isArray(filters.source)) {
        query = query.in('source', filters.source);
      } else {
        query = query.eq('source', filters.source);
      }
    }

    // Strict business rule: Bulk email campaigns require explicit contact_preference = 'email'
    // Leads with preference = 'sms', 'call', 'whatsapp', or null (unspecified) are excluded by default.
    const effectivePref = filters.contact_preference || 'email';
    query = query.eq('contact_preference', effectivePref);

    const { data: leads, error: leadsError } = await query;

    if (leadsError) {
      throw leadsError;
    }

    // Filter by tags if specified in audience
    let eligibleLeads = leads || [];
    if (filters.tag_ids && Array.isArray(filters.tag_ids) && filters.tag_ids.length > 0) {
      const { data: tagMatches } = await db
        .from('lead_tags')
        .select('lead_id')
        .in('tag_id', filters.tag_ids);

      const matchingLeadIds = new Set((tagMatches || []).map((t: { lead_id: string }) => t.lead_id));
      eligibleLeads = eligibleLeads.filter((l: { id: string }) => matchingLeadIds.has(l.id));
    }

    // 5. Deduplicate by normalized email
    const seenEmails = new Set<string>();
    const uniqueLeads: typeof eligibleLeads = [];

    for (const lead of eligibleLeads) {
      const normalizedEmail = (lead.email || '').trim().toLowerCase();
      if (normalizedEmail && !seenEmails.has(normalizedEmail)) {
        seenEmails.add(normalizedEmail);
        uniqueLeads.push({ ...lead, email: normalizedEmail });
      }
    }

    // 6. Check A/B variants with strict server-side validation
    const { data: variants } = await db
      .from('campaign_variants')
      .select('variant_key, traffic_percentage')
      .eq('campaign_id', payload.campaign_id)
      .order('variant_key', { ascending: true });

    const hasABTest = variants && variants.length >= 2;
    let splitPercentA = 100;

    if (hasABTest) {
      const varA = variants.find((v: { variant_key: string; traffic_percentage: number }) => v.variant_key === 'A');
      const varB = variants.find((v: { variant_key: string; traffic_percentage: number }) => v.variant_key === 'B');
      const percentA = Number(varA?.traffic_percentage) || 0;
      const percentB = Number(varB?.traffic_percentage) || 0;

      if (percentA < 0 || percentA > 100 || percentB < 0 || percentB > 100 || (percentA + percentB !== 100)) {
        return new Response(
          JSON.stringify({
            error: `Invalid A/B split: percentages must be between 0 and 100 and sum to exactly 100% (got A=${percentA}%, B=${percentB}%)`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      splitPercentA = percentA;
    }

    // 7. Materialize campaign_recipients (strictly normalized email)
    let createdCount = 0;
    const recipientRows = uniqueLeads.map((lead: { id: string; email: string }, idx: number) => {
      let assignedVariant: 'A' | 'B' | null = null;
      if (hasABTest) {
        // Deterministic split based on index percentage
        const ratio = (idx % 100) + 1;
        assignedVariant = ratio <= splitPercentA ? 'A' : 'B';
      }

      return {
        campaign_id: payload.campaign_id,
        lead_id: lead.id,
        email: lead.email.trim().toLowerCase(),
        status: 'pending',
        variant: assignedVariant,
      };
    });

    if (recipientRows.length > 0) {
      // Upsert in batches of 50 to avoid statement limits
      for (let i = 0; i < recipientRows.length; i += 50) {
        const batch = recipientRows.slice(i, i + 50);
        const { error: insertError } = await db
          .from('campaign_recipients')
          .upsert(batch, { onConflict: 'campaign_id,email', ignoreDuplicates: true });

        if (insertError) {
          console.error('Error inserting recipients batch:', insertError);
        } else {
          createdCount += batch.length;
        }
      }
    }

    // 8. Update audience estimated count
    await db
      .from('campaign_audiences')
      .upsert(
        {
          campaign_id: payload.campaign_id,
          filter_definition: filters,
          estimated_recipient_count: uniqueLeads.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'campaign_id' },
      );

    // 9. Ensure a campaign_job exists
    const { data: existingJob } = await db
      .from('campaign_jobs')
      .select('id')
      .eq('campaign_id', payload.campaign_id)
      .eq('status', 'pending')
      .maybeSingle();

    if (!existingJob) {
      await db.from('campaign_jobs').insert({
        campaign_id: payload.campaign_id,
        job_type: 'send_campaign',
        status: 'pending',
        scheduled_at: campaign.scheduled_at,
      });
    }

    // =========================================================================
    // [Phase 3 Extensibility Point]
    // Calculate Campaign Safety Score & Domain Reputation before sending.
    // =========================================================================

    return new Response(
      JSON.stringify({
        success: true,
        campaign_id: payload.campaign_id,
        status: campaign.status,
        total_eligible_leads: eligibleLeads.length,
        unique_recipients: uniqueLeads.length,
        recipients_materialized: createdCount,
        has_ab_test: !!hasABTest,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown prepare error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
