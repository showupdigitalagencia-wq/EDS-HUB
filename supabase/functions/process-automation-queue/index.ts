// =============================================================================
// Edge Function: process-automation-queue
// =============================================================================
// Background queue runner for scheduled wait steps.
// Claims due jobs atomically using Postgres FOR UPDATE SKIP LOCKED (claim_automation_jobs),
// recovers stale jobs if any worker died, advances run steps,
// and invokes execute-automation-run.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

interface ProcessQueuePayload {
  batch_size?: number;
  lease_minutes?: number;
  process_events?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Authorization
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    let payload: ProcessQueuePayload = {};
    try {
      payload = await req.json();
    } catch {
      // Empty body allowed
    }

    const db = createAdminClient();
    const batchSize = Math.min(Math.max(Number(payload.batch_size) || 10, 1), 50);
    const leaseMinutes = Math.min(Math.max(Number(payload.lease_minutes) || 10, 1), 60);
    const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 2. Optional: process any pending automation events first
    if (payload.process_events) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        await fetch(`${supabaseUrl}/functions/v1/process-automation-events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ limit: batchSize }),
        });
      } catch (evErr) {
        console.warn('[process-automation-queue] Error dispatching events:', evErr);
      }
    }

    // 3. Atomic Claim via PostgreSQL RPC (FOR UPDATE SKIP LOCKED)
    const { data: claimedJobs, error: claimErr } = await db.rpc('claim_automation_jobs', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_minutes: leaseMinutes,
    });

    if (claimErr) {
      console.error('[process-automation-queue] RPC claim_automation_jobs error:', claimErr);
      return new Response(
        JSON.stringify({ error: 'Failed to claim automation jobs', details: claimErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!claimedJobs || claimedJobs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No due automation jobs to process', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resumedRuns: string[] = [];
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // 4. Process each claimed job
    for (const job of claimedJobs) {
      try {
        // Complete the wait step run
        await db
          .from('automation_run_steps')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.automation_run_step_id);

        // Update run status back to 'running'
        await db
          .from('automation_runs')
          .update({
            status: 'running',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.automation_run_id);

        // Resume execution via execute-automation-run
        const execRes = await fetch(`${supabaseUrl}/functions/v1/execute-automation-run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ automation_run_id: job.automation_run_id }),
        });

        if (!execRes.ok) {
          const errBody = await execRes.text();
          console.error(`[process-automation-queue] execute-automation-run returned ${execRes.status}: ${errBody}`);
        }

        // Mark job as completed
        await db
          .from('automation_jobs')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.job_id);

        resumedRuns.push(job.automation_run_id);
      } catch (jobErr) {
        const errMsg = jobErr instanceof Error ? jobErr.message : 'Job execution failed';
        console.error(`[process-automation-queue] Error executing job ${job.job_id}:`, errMsg);

        await db
          .from('automation_jobs')
          .update({
            status: 'failed',
            last_error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.job_id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        claimed_count: claimedJobs.length,
        resumed_runs: resumedRuns,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[process-automation-queue] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
