// =============================================================================
// Edge Function: retry-inbound-processing
// =============================================================================
// Foundation for re-evaluating failed or conflict inbound messages.
// Reuses the original inbound_messages row without creating duplicates.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

interface RetryPayload {
  inbound_message_id: string;
  target_lead_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized || !authResult.userId) {
    return new Response(JSON.stringify({ error: authResult.error || 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: RetryPayload = await req.json();
    const { inbound_message_id, target_lead_id } = payload;

    if (!inbound_message_id) {
      return new Response(JSON.stringify({ error: 'Missing inbound_message_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = createAdminClient();

    const { data: msg, error: msgErr } = await db
      .from('inbound_messages')
      .select('*')
      .eq('id', inbound_message_id)
      .single();

    if (msgErr || !msg) {
      return new Response(JSON.stringify({ error: 'Inbound message not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (msg.processing_status === 'processed') {
      return new Response(
        JSON.stringify({ success: true, message: 'Message is already processed', inbound_message_id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Attempt re-matching or use provided target_lead_id
    let leadIdToUse = target_lead_id || msg.lead_id;

    if (!leadIdToUse) {
      if (msg.channel === 'email') {
        const { data: matchedLeads } = await db
          .from('leads')
          .select('id')
          .eq('email', msg.from_address.trim().toLowerCase());

        if (matchedLeads && matchedLeads.length === 1) {
          leadIdToUse = matchedLeads[0].id;
        }
      } else if (msg.channel === 'sms') {
        const { data: matchedLeads } = await db
          .from('leads')
          .select('id')
          .or(`phone_e164.eq.${msg.from_address},phone_raw.eq.${msg.from_address}`);

        if (matchedLeads && matchedLeads.length === 1) {
          leadIdToUse = matchedLeads[0].id;
        }
      }
    }

    if (!leadIdToUse) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'CANNOT_RESOLVE_LEAD',
          message: 'Could not resolve lead automatically. Target lead ID required.',
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve or create conversation
    let convId = msg.conversation_id;
    if (!convId) {
      if (msg.channel === 'sms') {
        const { data: existingConv } = await db
          .from('conversations')
          .select('id')
          .eq('lead_id', leadIdToUse)
          .eq('channel', 'sms')
          .maybeSingle();

        if (existingConv) {
          convId = existingConv.id;
        } else {
          const { data: newConv } = await db
            .from('conversations')
            .insert({
              lead_id: leadIdToUse,
              channel: 'sms',
              status: 'open',
              last_message_at: msg.received_at,
              last_message_preview: msg.body_text.slice(0, 120),
              last_message_direction: 'inbound',
            })
            .select('id')
            .single();
          convId = newConv?.id;
        }
      } else {
        const { data: newConv } = await db
          .from('conversations')
          .insert({
            lead_id: leadIdToUse,
            channel: 'email',
            status: 'open',
            subject: msg.subject,
            last_message_at: msg.received_at,
            last_message_preview: msg.body_text.slice(0, 120),
            last_message_direction: 'inbound',
          })
          .select('id')
          .single();
        convId = newConv?.id;
      }
    }

    // Update message status to processed
    await db
      .from('inbound_messages')
      .update({
        lead_id: leadIdToUse,
        conversation_id: convId,
        processing_status: 'processed',
        conflict_reason: null,
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inbound_message_id);

    // Update Lead last_response_at
    await db
      .from('leads')
      .update({ last_response_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', leadIdToUse);

    // Stop sequences if configured with stop_on_response
    const { data: activeRuns } = await db
      .from('automation_runs')
      .select('id, automation_id, automations(name), automation_versions(stop_on_response)')
      .eq('lead_id', leadIdToUse)
      .in('status', ['pending', 'running', 'waiting', 'paused']);

    if (activeRuns) {
      for (const r of activeRuns as any[]) {
        if (r.automation_versions?.stop_on_response) {
          await db
            .from('automation_jobs')
            .update({ status: 'cancelled' })
            .eq('automation_run_id', r.id)
            .eq('status', 'pending');

          await db
            .from('automation_runs')
            .update({
              status: 'stopped_by_condition',
              run_control_status: 'stopped',
              stop_reason_code: 'LEAD_REPLIED',
              stop_reason_message: `Lead replied via ${msg.channel.toUpperCase()}`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', r.id);

          await db.from('lead_activities').insert({
            lead_id: leadIdToUse,
            automation_run_id: r.id,
            activity_type: 'sequence_stopped',
            actor_type: 'system',
            summary: `Sequence "${r.automations?.name}" stopped: Lead replied via ${msg.channel.toUpperCase()}`,
            metadata: { stop_reason_code: 'LEAD_REPLIED', channel: msg.channel, inbound_message_id },
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inbound_message_id,
        lead_id: leadIdToUse,
        conversation_id: convId,
        processing_status: 'processed',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Retry processing failed:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
