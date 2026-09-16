// =============================================================================
// Edge Function: check-domain-status
// =============================================================================
// Queries Resend API for domain verification status and persists results.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authResult = await verifyAuth(req.headers.get('Authorization'));
  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Resend API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get domain from settings or request body
    const db = createAdminClient();
    let domain: string | null = null;
    let resendDomainId: string | null = null;

    try {
      const body = await req.json();
      domain = body.domain || null;
      resendDomainId = body.resend_domain_id || null;
    } catch {
      // No body provided — use settings
    }

    if (!domain) {
      const { data: settings } = await db
        .from('app_settings')
        .select('email_sending_domain, resend_domain_id')
        .single();

      domain = settings?.email_sending_domain || null;
      resendDomainId = resendDomainId || settings?.resend_domain_id || null;
    }

    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'No email sending domain configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // If we have a Resend domain ID, query it directly
    let domainData = null;
    if (resendDomainId) {
      const response = await fetch(`https://api.resend.com/domains/${resendDomainId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (response.ok) {
        domainData = await response.json();
      }
    }

    // If no domain ID, try to list domains and find the matching one
    if (!domainData) {
      const response = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (response.ok) {
        const { data: domains } = await response.json();
        if (Array.isArray(domains)) {
          domainData = domains.find((d: { name: string }) =>
            d.name.toLowerCase() === domain!.toLowerCase()
          );
        }
      }
    }

    // Map Resend status to our status model
    const now = new Date().toISOString();
    const statusRecord = {
      domain,
      resend_domain_id: domainData?.id || resendDomainId,
      provider_status: mapResendStatus(domainData?.status),
      spf_status: extractRecordStatus(domainData, 'spf'),
      dkim_status: extractRecordStatus(domainData, 'dkim'),
      dmarc_status: 'unknown', // Resend API does not confirm DMARC
      last_checked_at: now,
      verified_at: domainData?.status === 'verified' ? now : null,
      details: domainData ? { records: domainData.records || [] } : {},
      updated_at: now,
    };

    // Upsert domain status
    const { data: existing } = await db
      .from('email_domain_status')
      .select('id')
      .eq('domain', domain)
      .single();

    if (existing) {
      await db
        .from('email_domain_status')
        .update(statusRecord)
        .eq('id', existing.id);
    } else {
      await db
        .from('email_domain_status')
        .insert({ ...statusRecord, created_at: now });
    }

    return new Response(
      JSON.stringify({
        domain: statusRecord.domain,
        provider_status: statusRecord.provider_status,
        spf_status: statusRecord.spf_status,
        dkim_status: statusRecord.dkim_status,
        dmarc_status: statusRecord.dmarc_status,
        last_checked_at: statusRecord.last_checked_at,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[check-domain-status]', err instanceof Error ? err.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

function mapResendStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  switch (status.toLowerCase()) {
    case 'verified': return 'verified';
    case 'pending': return 'pending';
    case 'failed': return 'failed';
    default: return 'unknown';
  }
}

// deno-lint-ignore no-explicit-any
function extractRecordStatus(domainData: any, recordType: string): string {
  if (!domainData?.records || !Array.isArray(domainData.records)) return 'unknown';

  const record = domainData.records.find(
    // deno-lint-ignore no-explicit-any
    (r: any) => r.record_type?.toLowerCase() === recordType.toLowerCase() ||
                r.type?.toLowerCase() === recordType.toLowerCase()
  );

  if (!record) return 'unknown';

  switch (record.status?.toLowerCase()) {
    case 'verified':
    case 'valid':
      return 'verified';
    case 'pending':
      return 'pending';
    case 'failed':
    case 'invalid':
      return 'failed';
    default:
      return 'unknown';
  }
}
