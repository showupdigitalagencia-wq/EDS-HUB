// =============================================================================
// Edge Function: process-lead-score-batch
// =============================================================================
// Executes batch recalculation for a lead_score_recalculation_jobs record.
// Invokes the PostgreSQL RPC process_lead_score_recalculation_batch in chunks.
// Safe against timeouts and browser closures via cursor resumption.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

interface ProcessBatchPayload {
  job_id: string;
  max_iterations?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    // 1. Verify user authentication
    const authHeader = req.headers.get('Authorization');
    const authUser = await verifyAuth(authHeader);
    if (!authUser) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Active app user session required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse payload
    const payload: ProcessBatchPayload = await req.json();
    if (!payload.job_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: job_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createAdminClient();
    const maxIterations = Math.min(25, payload.max_iterations || 10);
    let iterations = 0;
    let hasMore = true;
    let finalStatus = 'processing';
    let lastBatchResult: any = null;

    // 3. Process batches in a controlled loop
    while (hasMore && iterations < maxIterations) {
      iterations++;
      const { data, error } = await supabase.rpc('process_lead_score_recalculation_batch', {
        p_job_id: payload.job_id,
      });

      if (error) {
        throw error;
      }

      lastBatchResult = data;
      hasMore = Boolean(data?.has_more);
      finalStatus = data?.status || 'processing';

      if (finalStatus === 'completed' || finalStatus === 'failed') {
        break;
      }
    }

    // 4. Fetch current progress snapshot
    const { data: jobRow } = await supabase
      .from('lead_score_recalculation_jobs')
      .select('*')
      .eq('id', payload.job_id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        job_id: payload.job_id,
        iterations_run: iterations,
        has_more: hasMore,
        job: jobRow,
        last_batch: lastBatchResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Batch recalculation error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
