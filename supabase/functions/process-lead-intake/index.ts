// =============================================================================
// Edge Function: process-lead-intake
// =============================================================================
// Main orchestrator for lead intake processing.
// Accepts a normalized payload, creates/finds lead, sends messages,
// creates tasks, and advances pipeline.
// =============================================================================

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import {
  resolveSalutation,
  resolveSafeFirstName,
  resolveZygomaticSalutation,
  getApprovedZygomaticText,
  getApprovedZygomaticHtml,
  APPROVED_COURSE_TEMPLATES,
} from '../_shared/salutation.ts';
import {
  resolveCanonicalEmails,
  resolveEmailRecipients,
  escapeHtml,
  type ResolvedEmailIdentity,
} from '../_shared/email-utils.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';
import { sendSms } from '../_shared/twilio-adapter.ts';
import { syncEmailToTitanSent } from '../_shared/titan-imap.ts';
import type { LeadIntakePayload, LeadIntakeResponse } from '../_shared/types.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // --- 1. Authenticate ---
  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuth(authHeader);

  if (!authResult.isAuthorized) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // --- 2. Parse and validate payload ---
    const payload: LeadIntakePayload = await req.json();

    const validationErrors = validatePayload(payload);
    if (validationErrors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload', details: validationErrors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const db = createAdminClient();

    // --- 3. Generate idempotency key ---
    const idempotencyKey = generateIdempotencyKey(payload);

    // --- 4. Register lead_intake_event ---
    let existingEvent: { id: string; status: string; lead_id: string | null; attempt_count?: number } | null = null;
    if (payload.intake_event_id) {
      const { data: byId } = await db
        .from('lead_intake_events')
        .select('id, status, lead_id, attempt_count')
        .eq('id', payload.intake_event_id)
        .single();
      existingEvent = byId;
    } else {
      const { data: byKey } = await db
        .from('lead_intake_events')
        .select('id, status, lead_id, attempt_count')
        .eq('idempotency_key', idempotencyKey)
        .single();
      existingEvent = byKey;
    }

    if (existingEvent && (existingEvent.status === 'processed' || existingEvent.status === 'duplicate')) {
      return jsonResponse({
        success: true,
        intake_event_id: existingEvent.id,
        lead_id: existingEvent.lead_id,
        status: existingEvent.status,
        messages_sent: 0,
        messages_failed: 0,
        tasks_created: 0,
        stage_advanced: false,
      });
    }

    // If the event exists and previously failed, we'll retry
    let intakeEventId: string;
    let attemptCount = 0;

    if (existingEvent) {
      intakeEventId = existingEvent.id;
      // Increment attempt count
      const { data: updated } = await db
        .from('lead_intake_events')
        .update({
          status: 'processing',
          attempt_count: (existingEvent as { attempt_count?: number }).attempt_count
            ? (existingEvent as { attempt_count?: number }).attempt_count! + 1
            : 1,
          last_error: null,
        })
        .eq('id', intakeEventId)
        .select('attempt_count')
        .single();
      attemptCount = updated?.attempt_count ?? 1;
    } else {
      const { data: newEvent, error: insertError } = await db
        .from('lead_intake_events')
        .insert({
          source: payload.source,
          external_event_id: payload.external_event_id || null,
          external_lead_id: payload.external_lead_id || null,
          idempotency_key: idempotencyKey,
          raw_payload: payload.raw_payload || {},
          normalized_payload: sanitizeForStorage(payload),
          status: 'processing',
          attempt_count: 1,
        })
        .select('id')
        .single();

      if (insertError) {
        // Could be a race condition — check if it was a duplicate
        if (insertError.code === '23505') {
          return jsonResponse({
            success: true,
            intake_event_id: '',
            lead_id: null,
            status: 'duplicate',
            messages_sent: 0,
            messages_failed: 0,
            tasks_created: 0,
            stage_advanced: false,
          });
        }
        throw insertError;
      }

      intakeEventId = newEvent!.id;
      attemptCount = 1;
    }

    // --- 5. Find or create lead ---
    const { leadId, isNewLead } = await findOrCreateLead(db, payload, intakeEventId);

    // Update intake event with lead_id
    await db
      .from('lead_intake_events')
      .update({ lead_id: leadId })
      .eq('id', intakeEventId);

    // --- 6. Get the Capture stage ID ---
    const { data: captureStage } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('code', 'capture')
      .single();

    const { data: qualificationStage } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('code', 'qualification')
      .single();

    if (!captureStage || !qualificationStage) {
      throw new Error('Pipeline stages not properly seeded');
    }

    // If new lead, set to Capture and log
    if (isNewLead) {
      await db
        .from('leads')
        .update({ pipeline_stage_id: captureStage.id })
        .eq('id', leadId);

      // Log initial assignment
      await db.from('lead_stage_history').insert({
        lead_id: leadId,
        from_stage_id: null,
        to_stage_id: captureStage.id,
        change_reason: 'initial_assignment',
        intake_event_id: intakeEventId,
      });

      // Log activities
      await db.from('lead_activities').insert([
        {
          lead_id: leadId,
          intake_event_id: intakeEventId,
          activity_type: 'lead_created',
          actor_type: 'system',
          summary: `Lead created from ${payload.source} source`,
          metadata: { source: payload.source },
        },
        {
          lead_id: leadId,
          intake_event_id: intakeEventId,
          activity_type: 'intake_received',
          actor_type: 'system',
          summary: `Intake event received (attempt ${attemptCount})`,
          metadata: { idempotency_key: idempotencyKey },
        },
      ]);
    } else {
      // Existing lead — just log intake
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: `Intake event received (attempt ${attemptCount}, existing lead)`,
        metadata: { idempotency_key: idempotencyKey },
      });
    }

    // --- 7. Resolve salutation ---
    // Try to get custom default from settings
    const { data: settings } = await db
      .from('app_settings')
      .select('default_salutation')
      .single();

    const salutation = resolveSalutation(
      payload.last_name,
      payload.first_name,
      settings?.default_salutation || 'Doc',
    );

    // --- 8. Execute based on source and contact_preference ---
    let messagesSent = 0;
    let messagesFailed = 0;
    let tasksCreated = 0;
    let actionSucceeded = false;
    let pref: 'email' | 'sms' | 'call' | 'whatsapp' = 'email';
    const errors: string[] = [];

    const isTestLead =
      (payload.source || '').toLowerCase() === 'test' ||
      (payload.source_detail || '').toLowerCase() === 'test' ||
      Boolean(payload.raw_payload && (payload.raw_payload.is_test === true || payload.raw_payload.test === true));

    const isHistoricalSync =
      ['csv_import', 'legacy_import', 'historical_migration'].includes((payload.source || '').toLowerCase()) ||
      ['hubspot_sync', 'hubspot_historical', 'hubspot_reconcile', 'csv_import', 'legacy_import', 'historical_migration'].includes((payload.source_detail || '').toLowerCase());

    const isWebsiteIncomplete =
      ['website incomplete registration', 'website_incomplete_registration', 'incomplete_registration', 'incomplete-registration'].includes((payload.source_detail || '').toLowerCase()) ||
      (payload.source_detail || '').toLowerCase().includes('incomplete');

    const isWebsiteLead =
      payload.source === 'form' ||
      payload.source === 'website' ||
      payload.source_detail === 'website' ||
      payload.source_detail === 'website-form' ||
      payload.source_detail === 'contact_form' ||
      payload.source_detail === 'website_registration_form';

    const isMetaLead =
      payload.source === 'meta' ||
      payload.source_detail === 'meta_lead_ad' ||
      payload.source_detail === 'facebook' ||
      payload.source_detail === 'instagram';

    if (isTestLead) {
      // TEST LEAD RULE:
      // Strictly suppressed from automatic outreach per safety rule.
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: 'Test lead intake received. Automated outreach is strictly suppressed per safety rule.',
        metadata: { source: payload.source, source_detail: payload.source_detail },
      });
      actionSucceeded = true;
    } else if (isHistoricalSync) {
      // HISTORICAL HUBSPOT / CSV RULE:
      // Excluded from automatic initial outreach.
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: 'Historical import lead intake received. Automated initial outreach is suppressed.',
        metadata: { source: payload.source, source_detail: payload.source_detail },
      });
      actionSucceeded = true;
    } else if (isWebsiteIncomplete) {
      // INCOMPLETE WEBSITE REGISTRATION:
      // Held until complete registration occurs.
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: 'Incomplete website registration received. Automated first-contact outreach is held until registration completion.',
        metadata: { source: payload.source, source_detail: payload.source_detail },
      });
      actionSucceeded = true;
    } else if (!isNewLead) {
      // EXISTING LEAD RULE:
      // Resurfacing returning lead. Preserve created_at & stage. Do NOT resend first-contact email!
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: 'Intake event received for existing lead. First-contact automatic outreach is suppressed.',
        metadata: { source: payload.source, source_detail: payload.source_detail, resurfaced: true },
      });
      actionSucceeded = true;
    } else if (!isProvenAdLead(payload)) {
      // NON-AD SOURCE RULE:
      // Automatic first-contact email is strictly restricted to approved advertising Lead Ads (Meta / Facebook / Instagram Lead Ads).
      // Website /register, organic HubSpot, manual leads, historical imports, etc. are safely ingested
      // and preserved, but do NOT receive the automatic Ad email.
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: `Lead intake received from non-ad source (${payload.source || 'direct'} / ${payload.source_detail || 'organic'}). Automated first-contact email is restricted to approved advertising Lead Ads.`,
        metadata: { source: payload.source, source_detail: payload.source_detail, ad_eligible: false },
      });
      actionSucceeded = true;
    } else {
      // GENUINELY NEW INBOUND AD LEAD (Meta / Facebook / Instagram Lead Ads, or HubSpot contact proven to be Ad Lead)
      // AUTHORITATIVE SOURCE TIMESTAMP FRESHNESS GUARD:
      // The decision to send automated first-contact outreach must be based on the ORIGINAL SOURCE TIMESTAMP
      // (HubSpot contact createdate, Meta created_time, or payload source_created_at).
      // The EDS local record creation timestamp (created_at / now()) must NEVER make an old lead appear fresh!
      // If actual source lead age <= 4 hours -> eligible for existing first-contact automation.
      // If actual source lead age > 4 hours -> historical recovery -> import/update lead -> NO automatic customer outreach.
      // If source timestamp is missing/unreliable -> fail safe -> NO automatic customer outreach.
      const rawSourceTimestamp = payload.source_created_at ||
        (payload.raw_payload && typeof payload.raw_payload === 'object' && (
          (payload.raw_payload as any).properties?.createdate ||
          (payload.raw_payload as any).createdate ||
          (payload.raw_payload as any).created_time
        )) ||
        null;

      let isSourceLeadFresh = false;
      let sourceLeadAgeHours: number | null = null;

      if (rawSourceTimestamp) {
        let parsedMs = NaN;
        if (!isNaN(Number(rawSourceTimestamp)) && String(rawSourceTimestamp).trim().length >= 8) {
          const num = Number(rawSourceTimestamp);
          parsedMs = num > 100000000000 ? num : num * 1000;
        } else {
          parsedMs = Date.parse(String(rawSourceTimestamp));
        }

        if (!isNaN(parsedMs) && parsedMs > 0) {
          const diffMs = Date.now() - parsedMs;
          sourceLeadAgeHours = diffMs / (1000 * 60 * 60);
          // Eligible only if created at source within 4 hours (with 15 min clock skew tolerance)
          if (sourceLeadAgeHours >= -0.25 && sourceLeadAgeHours <= 4.0) {
            isSourceLeadFresh = true;
          }
        }
      }

      if (!isSourceLeadFresh) {
        // HISTORICAL RECOVERY / MISSING SOURCE TIMESTAMP RULE:
        // Automated initial outreach is strictly suppressed!
        await db.from('lead_activities').insert({
          lead_id: leadId,
          intake_event_id: intakeEventId,
          activity_type: 'intake_received',
          actor_type: 'system',
          summary: `Automated first-contact outreach is suppressed: source lead age is ${sourceLeadAgeHours !== null ? sourceLeadAgeHours.toFixed(1) + 'h' : 'unknown/missing'} (> 4h threshold or missing source timestamp). Historical lead imported safely.`,
          metadata: {
            source: payload.source,
            source_detail: payload.source_detail,
            source_created_at: rawSourceTimestamp,
            source_lead_age_hours: sourceLeadAgeHours,
            historical_recovery: true,
          },
        });
        actionSucceeded = true;
      } else {
        // GENUINELY FRESH AD LEAD (<= 4 hours old): Proceed with first-contact automation
        // Contact preference normalized
      const rawPref = payload.contact_preference ? String(payload.contact_preference).trim().toLowerCase() : '';
      pref = 'email';
      if (rawPref === 'sms' || rawPref === 'text' || rawPref.includes('sms')) {
        pref = 'sms';
      } else if (rawPref === 'call' || rawPref === 'phone' || rawPref.includes('call') || rawPref.includes('phone') || rawPref.includes('lig')) {
        pref = 'call';
      } else if (rawPref === 'whatsapp' || rawPref === 'whats' || rawPref === 'zap' || rawPref.includes('whats') || rawPref.includes('zap')) {
        pref = 'whatsapp';
      } else if (rawPref === 'email' || rawPref === 'mail') {
        pref = 'email';
      }

      if (pref === 'call') {
        // Manual call task
        const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || 'Novo Lead';
        await db.from('tasks').insert({
          lead_id: leadId,
          intake_event_id: intakeEventId,
          task_type: 'call',
          title: `Ligação Telefônica — ${fullName}`,
          description: `Lead indicou preferência por Ligação Telefônica. Contatar pelo telefone: ${payload.phone || 'não informado'}.`,
          status: 'pending',
          created_by: 'system',
        });
        await db.from('lead_activities').insert({
          lead_id: leadId,
          intake_event_id: intakeEventId,
          activity_type: 'contact_preference_detected',
          actor_type: 'system',
          summary: 'Contato preferencial por Ligação Telefônica. Tarefa de ligação criada.',
          metadata: { preference: 'call', manual_task: true },
        });
        tasksCreated++;
        actionSucceeded = true;
      } else if (pref === 'whatsapp') {
        // Manual WhatsApp task
        const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || 'Novo Lead';
        await db.from('tasks').insert({
          lead_id: leadId,
          intake_event_id: intakeEventId,
          task_type: 'follow_up',
          title: `WhatsApp Manual — ${fullName}`,
          description: `Lead indicou preferência por WhatsApp. Contatar pelo WhatsApp: ${payload.phone || 'não informado'}.`,
          status: 'pending',
          created_by: 'system',
        });
        await db.from('lead_activities').insert({
          lead_id: leadId,
          intake_event_id: intakeEventId,
          activity_type: 'contact_preference_detected',
          actor_type: 'system',
          summary: 'Contato preferencial por WhatsApp. Tarefa de WhatsApp criada.',
          metadata: { preference: 'whatsapp', manual_task: true },
        });
        tasksCreated++;
        actionSucceeded = true;
      } else {
        // PREFERENCE = 'email' OR 'sms'
        // Rule: Both send approved first-contact email!
        // SMS preference must NOT block the approved email from being sent.
        const sourceDataForResolution: Record<string, unknown> = {
          ...((payload.raw_payload && typeof payload.raw_payload === 'object') ? payload.raw_payload as Record<string, unknown> : {}),
          ...((payload.raw_data && typeof payload.raw_data === 'object') ? payload.raw_data as Record<string, unknown> : {}),
          email: payload.email,
          email_confirmation: payload.email_confirmation,
        };

        if (Array.isArray(payload.resolved_emails)) {
          payload.resolved_emails.forEach((re, idx) => {
            if (re && (re.raw_email || re.normalized_email)) {
              sourceDataForResolution[`resolved_email_${idx}`] = re.raw_email || re.normalized_email;
            }
          });
        }

        const canonicalEmailRes = resolveCanonicalEmails(sourceDataForResolution, payload.source || 'intake');
        const resolvedIdentities = canonicalEmailRes.emails;

        if (resolvedIdentities.length > 0) {
          const emailRes = await handleEmailPreference(
            db, payload, leadId, intakeEventId, salutation, idempotencyKey, resolvedIdentities,
          );
          messagesSent += emailRes.sent;
          messagesFailed += emailRes.failed;
          tasksCreated += emailRes.tasksCreated;
          errors.push(...emailRes.errors);
          actionSucceeded = emailRes.allSucceeded;
        } else {
          // No valid email at all
          await db.from('lead_activities').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'processing_failed',
            actor_type: 'system',
            summary: 'Lead has no valid email address for first contact automation.',
            metadata: { source: payload.source, source_detail: payload.source_detail },
          });
          actionSucceeded = false;
          errors.push('Lead has no valid email address for first contact automation');
        }

        // IF PREFERENCE === 'sms':
        // DO NOT automatically send SMS (Twilio auto-SMS remains strictly disabled).
        // Create manual SMS follow-up task + send mobile push notification to admins!
        if (pref === 'sms') {
          const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || 'Novo Lead';
          const courseName = payload.course_title || payload.course_interest || 'Curso';

          const { data: existingSmsTask } = await db
            .from('tasks')
            .select('id')
            .eq('lead_id', leadId)
            .eq('task_type', 'follow_up')
            .ilike('title', '%SMS%')
            .maybeSingle();

          if (!existingSmsTask) {
            await db.from('tasks').insert({
              lead_id: leadId,
              intake_event_id: intakeEventId,
              task_type: 'follow_up',
              title: `SMS Manual — ${fullName}`,
              description: `Lead indicou preferência por SMS. O e-mail inicial foi enviado automaticamente. Realizar contato manual por SMS. Telefone: ${payload.phone || 'não informado'}.`,
              status: 'pending',
              created_by: 'system',
            });
            tasksCreated++;

            await db.from('lead_activities').insert({
              lead_id: leadId,
              intake_event_id: intakeEventId,
              activity_type: 'contact_preference_detected',
              actor_type: 'system',
              summary: 'Lead prefere SMS. E-mail inicial enviado; tarefa de SMS manual criada.',
              metadata: { preference: 'sms', manual_sms_pending: true },
            });
          }

          // Mobile push notification to administrators
          try {
            await db.functions.invoke('send-push-notification', {
              body: {
                event_type: 'sms_preference',
                event_id: leadId,
                idempotency_key: `sms_pref_${intakeEventId}`,
                title: 'Novo lead prefere SMS',
                body: `${fullName} demonstrou interesse em ${courseName}. O e-mail inicial foi enviado e o contato por SMS está pendente.`,
                deep_link: `/leads/${leadId}?tab=communication`,
              },
            });
          } catch (pushErr) {
            console.warn('[process-lead-intake] SMS preference push notification warning:', pushErr);
          }
        }
      }
      }
    }

    // --- 9. Advance pipeline if successful (Step 8: Email preference Ad Leads advance upon successful send; SMS preference remains in Novo Lead) ---
    let stageAdvanced = false;
    if (actionSucceeded && isNewLead) {
      // Check current stage — only advance if currently in Capture (Novo Lead)
      const { data: currentLead } = await db
        .from('leads')
        .select('pipeline_stage_id')
        .eq('id', leadId)
        .single();

      if (currentLead && currentLead.pipeline_stage_id === captureStage.id) {
        let shouldAdvanceToRespondido = false;

        if (isProvenAdLead(payload)) {
          // PROVEN AD LEAD (STEP 8):
          // Preference = Email: Automatically move Novo Lead -> Respondido ONLY upon factual successful email send
          // Preference = SMS: REMAINS in Novo Lead (advances only when user manually confirms SMS sent)
          // Preference = Call / WhatsApp: REMAINS in Novo Lead
          if (pref === 'email' && messagesSent > 0) {
            shouldAdvanceToRespondido = true;
          }
        } else if (!isWebsiteLead && !isHistoricalSync && !isTestLead && !isMetaLead) {
          // Other generic inbound leads with successful send
          if (messagesSent > 0) {
            shouldAdvanceToRespondido = true;
          }
        }

        if (shouldAdvanceToRespondido) {
          await db
            .from('leads')
            .update({
              pipeline_stage_id: qualificationStage.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', leadId);

          await db.from('lead_stage_history').insert({
            lead_id: leadId,
            from_stage_id: captureStage.id,
            to_stage_id: qualificationStage.id,
            change_reason: 'auto_after_intake',
            intake_event_id: intakeEventId,
          });

          await db.from('lead_activities').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'stage_changed',
            actor_type: 'system',
            summary: 'Lead avançado de Novo Lead para Respondido após envio com sucesso do e-mail inicial',
            metadata: { from: 'capture', to: 'qualification', reason: 'auto_after_intake' },
          });

          stageAdvanced = true;
        }
      }
    } else {
      // Log failure
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'processing_failed',
        actor_type: 'system',
        summary: `Intake processing failed: ${errors.join('; ').substring(0, 200)}`,
        metadata: { errors },
      });
    }

    // --- 10. Finalize intake event ---
    const finalStatus = actionSucceeded ? 'processed' : 'failed';
    await db
      .from('lead_intake_events')
      .update({
        status: finalStatus,
        processed_at: new Date().toISOString(),
        last_error: errors.length > 0 ? errors.join('; ').substring(0, 500) : null,
      })
      .eq('id', intakeEventId);

    // Supplementary non-blocking push notification for new lead (only when SMS preference push was not already dispatched)
    if (actionSucceeded && leadId && isNewLead && pref !== 'sms' && isProvenAdLead(payload)) {
      try {
        const leadName = `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || 'Novo interessado';
        const courseName = payload.course_title || payload.course_interest || 'curso de especialização';
        await db.functions.invoke('send-push-notification', {
          body: {
            event_type: 'new_lead',
            event_id: leadId,
            idempotency_key: `lead_${leadId}_${intakeEventId}`,
            title: 'Novo lead recebido',
            body: `${leadName} demonstrou interesse em ${courseName}.`,
            deep_link: `/leads/${leadId}`,
          },
        });
      } catch (pushErr) {
        console.warn('[process-lead-intake] Supplementary push notification notice:', pushErr);
      }
    }

    return jsonResponse({
      success: actionSucceeded,
      intake_event_id: intakeEventId,
      lead_id: leadId,
      status: finalStatus,
      messages_sent: messagesSent,
      messages_failed: messagesFailed,
      tasks_created: tasksCreated,
      stage_advanced: stageAdvanced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[process-lead-intake] Unhandled error:', err instanceof Error ? err.message : 'Unknown');
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// =============================================================================
// Helper functions
// =============================================================================

function validatePayload(p: LeadIntakePayload): string[] {
  const errors: string[] = [];
  const validSources = ['meta', 'google', 'manual', 'test', 'form', 'facebook', 'instagram', 'hubspot'];
  if (!p.source || !validSources.includes(p.source.toLowerCase())) {
    errors.push('Invalid or missing source');
  }
  return errors;
}

function isProvenAdLead(payload: LeadIntakePayload): boolean {
  const source = (payload.source || '').toLowerCase().trim();
  const sourceDetail = (payload.source_detail || '').toLowerCase().trim();
  const raw = payload.raw_payload || {};

  // Disqualify explicit non-ad sources
  if (source === 'manual' || sourceDetail === 'manual') return false;
  if (source === 'website' || sourceDetail === 'contact_form') return false;
  if (source === 'form' && (sourceDetail === 'website' || sourceDetail === 'website-form' || !sourceDetail)) return false;
  if (sourceDetail.includes('website') || sourceDetail.includes('register') || sourceDetail.includes('contact')) return false;

  // 1. Explicitly approved ad sources
  const adSources = ['meta', 'facebook', 'instagram', 'meta_ads', 'lead_ads'];
  if (adSources.includes(source)) return true;

  const adDetails = [
    'meta_lead_ad',
    'facebook_lead_ad',
    'instagram_lead_ad',
    'facebook',
    'instagram',
    'paid_social',
    'lead_ad',
    'ad_lead',
  ];
  if (adDetails.includes(sourceDetail)) return true;

  // 2. HubSpot or other transport payload properties with proven Ad attribution
  const props = (raw.properties && typeof raw.properties === 'object') ? raw.properties : raw;

  const origem = String(props.origem_do_lead || props.origem || '').toLowerCase();
  const leadSource = String(props.lead_source || '').toLowerCase();
  const hsAnalytics = String(props.hs_analytics_source || '').toLowerCase();
  const firstConv = String(props.first_conversion_event_name || '').toLowerCase();
  const recentConv = String(props.recent_conversion_event_name || '').toLowerCase();
  const adId = props.ad_id || raw.ad_id;
  const leadgenId = props.leadgen_id || raw.leadgen_id;

  if (adId || leadgenId) return true;

  if (
    origem.includes('meta') ||
    origem.includes('facebook') ||
    origem.includes('instagram') ||
    leadSource.includes('meta') ||
    leadSource.includes('facebook') ||
    leadSource.includes('instagram') ||
    hsAnalytics === 'paid_social' ||
    firstConv.includes('facebook lead ads') ||
    firstConv.includes('meta lead ads') ||
    firstConv.includes('instagram') ||
    recentConv.includes('facebook lead ads') ||
    recentConv.includes('meta lead ads') ||
    recentConv.includes('instagram')
  ) {
    return true;
  }

  return false;
}

function generateIdempotencyKey(p: LeadIntakePayload): string {
  if (p.idempotency_key) {
    return p.idempotency_key;
  }
  if (p.external_event_id) {
    return `${p.source}:${p.external_event_id}`;
  }
  // Fallback: hash of key fields
  const content = JSON.stringify({
    source: p.source,
    external_lead_id: p.external_lead_id,
    email: p.email?.toLowerCase().trim(),
    phone: p.phone,
    contact_preference: p.contact_preference,
  });
  return `${p.source}:hash:${simpleHash(content)}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

function sanitizeForStorage(p: LeadIntakePayload): Record<string, unknown> {
  // Store normalized payload without raw_payload (which is stored separately)
  const { raw_payload: _, ...rest } = p;
  return rest as Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
async function findOrCreateLead(db: any, payload: LeadIntakePayload, _intakeEventId: string) {
  // If explicitly flagged as new lead (e.g. from hubspot-webhook or hubspot-reconcile created_leads handoff)
  if (payload.is_new_lead === true && payload.lead_id) {
    return { leadId: payload.lead_id, isNewLead: true };
  }

  // Try direct lead_id lookup if provided
  if (payload.lead_id) {
    const { data: existing } = await db
      .from('leads')
      .select('id, created_at')
      .eq('id', payload.lead_id)
      .single();

    if (existing) {
      // Check if lead has ever had outbound first-contact outreach
      const { count } = await db
        .from('outbound_messages')
        .select('*', { count: 'exact', head: true })
        .eq('lead_id', existing.id);

      const hasOutreach = (count || 0) > 0;
      // If no outreach has occurred and it is an ad lead, treat as eligible for first-contact automation
      const isNew = !hasOutreach && payload.is_new_lead !== false;
      return { leadId: existing.id, isNewLead: isNew };
    }
  }

  // Try to find existing lead by source + external_lead_id
  if (payload.external_lead_id) {
    const { data: existing } = await db
      .from('leads')
      .select('id')
      .eq('source', payload.source)
      .eq('external_lead_id', payload.external_lead_id)
      .single();

    if (existing) {
      return { leadId: existing.id, isNewLead: false };
    }
  }

  // Try to find existing lead by normalized email
  if (payload.email) {
    const cleanEmail = payload.email.trim().toLowerCase();
    const { data: existing } = await db
      .from('leads')
      .select('id, created_at, pipeline_stage_id, course_interest, course_interests')
      .or(`email.eq.${cleanEmail},email_confirmation.eq.${cleanEmail}`)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Existing lead matched! Non-destructive resurfacing:
      // Preserves original created_at and pipeline_stage_id!
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        last_inbound_activity_at: new Date().toISOString(),
        has_new_submission: true,
        new_submission_at: new Date().toISOString(),
      };
      if (payload.course_interest) {
        const curInterests: string[] = Array.isArray(existing.course_interests) ? existing.course_interests : [];
        const hasCourse = curInterests.some((c) => c.toLowerCase().trim() === payload.course_interest!.toLowerCase().trim());
        if (!hasCourse) {
          updateData.course_interests = [...curInterests, payload.course_interest];
          updateData.course_interest = existing.course_interest ? `${existing.course_interest}, ${payload.course_interest}` : payload.course_interest;
        }
      }
      if (payload.email_confirmation && payload.email_confirmation.trim().toLowerCase() !== cleanEmail) {
        updateData.email_confirmation = payload.email_confirmation.trim().toLowerCase();
        updateData.email_mismatch = true;
      }
      await db.from('leads').update(updateData).eq('id', existing.id);
      return { leadId: existing.id, isNewLead: false };
    }
  }

  // Try to find existing lead by normalized phone
  if (payload.phone) {
    const cleanDigits = payload.phone.replace(/\D/g, '');
    if (cleanDigits.length >= 8) {
      const { data: existing } = await db
        .from('leads')
        .select('id, created_at, pipeline_stage_id, course_interest, course_interests')
        .or(`phone_raw.ilike.%${cleanDigits}%,phone_e164.ilike.%${cleanDigits}%`)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const updateData: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
          last_inbound_activity_at: new Date().toISOString(),
          has_new_submission: true,
          new_submission_at: new Date().toISOString(),
        };
        if (payload.course_interest) {
          const curInterests: string[] = Array.isArray(existing.course_interests) ? existing.course_interests : [];
          const hasCourse = curInterests.some((c) => c.toLowerCase().trim() === payload.course_interest!.toLowerCase().trim());
          if (!hasCourse) {
            updateData.course_interests = [...curInterests, payload.course_interest];
            updateData.course_interest = existing.course_interest ? `${existing.course_interest}, ${payload.course_interest}` : payload.course_interest;
          }
        }
        await db.from('leads').update(updateData).eq('id', existing.id);
        return { leadId: existing.id, isNewLead: false };
      }
    }
  }

  // Get Capture stage
  const { data: captureStage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('code', 'capture')
    .single();

  // Determine DB-safe contact_preference ('email' | 'sms' | 'call' | 'whatsapp' | null)
  const normPref = payload.contact_preference ? String(payload.contact_preference).trim().toLowerCase() : '';
  let dbContactPreference: 'email' | 'sms' | 'call' | 'whatsapp' | null = null;
  if (normPref === 'email' || normPref === 'e-mail' || normPref === 'mail') {
    dbContactPreference = 'email';
  } else if (normPref === 'sms' || normPref === 'text' || normPref.includes('sms')) {
    dbContactPreference = 'sms';
  } else if (normPref === 'whatsapp' || normPref === 'whats' || normPref === 'zap' || normPref.includes('whats') || normPref.includes('zap') || normPref === 'wa') {
    dbContactPreference = 'whatsapp';
  } else if (normPref === 'call' || normPref === 'phone' || normPref.includes('call') || normPref.includes('phone') || normPref.includes('lig')) {
    dbContactPreference = 'call';
  }

  // Create new lead
  const cleanEmail = payload.email ? payload.email.trim().toLowerCase() : null;
  const cleanEmailConf = payload.email_confirmation ? payload.email_confirmation.trim().toLowerCase() : null;
  const isEmailMismatch = Boolean(cleanEmail && cleanEmailConf && cleanEmail !== cleanEmailConf);

  const { data: newLead, error: createError } = await db
    .from('leads')
    .insert({
      source: payload.source,
      source_detail: payload.source_detail || null,
      external_lead_id: payload.external_lead_id || null,
      first_name: payload.first_name || null,
      last_name: payload.last_name || null,
      email: cleanEmail,
      email_confirmation: cleanEmailConf || cleanEmail,
      email_mismatch: isEmailMismatch,
      phone_raw: payload.phone || null,
      phone_e164: payload.phone && payload.phone.startsWith('+') ? payload.phone : null,
      contact_preference: dbContactPreference,
      pipeline_stage_id: captureStage!.id,
      course_interest: payload.course_interest || null,
      course_interests: payload.course_interest ? [payload.course_interest] : [],
      last_inbound_activity_at: payload.source_created_at || new Date().toISOString(),
      source_created_at: payload.source_created_at || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createError) {
    // Duplicate on source + external_lead_id
    if (createError.code === '23505' && payload.external_lead_id) {
      const { data: existing } = await db
        .from('leads')
        .select('id')
        .eq('source', payload.source)
        .eq('external_lead_id', payload.external_lead_id)
        .single();

      if (existing) {
        return { leadId: existing.id, isNewLead: false };
      }
    }
    throw createError;
  }

  return { leadId: newLead!.id, isNewLead: true };
}

// deno-lint-ignore no-explicit-any
async function handleEmailPreference(
  db: any,
  payload: LeadIntakePayload,
  leadId: string,
  intakeEventId: string,
  salutation: string,
  _baseIdempotencyKey: string,
  resolvedIdentities?: ResolvedEmailIdentity[],
) {
  let identities = resolvedIdentities;
  if (!identities || identities.length === 0) {
    const sourceData: Record<string, unknown> = {
      ...((payload.raw_payload && typeof payload.raw_payload === 'object') ? payload.raw_payload as Record<string, unknown> : {}),
      ...((payload.raw_data && typeof payload.raw_data === 'object') ? payload.raw_data as Record<string, unknown> : {}),
      email: payload.email,
      email_confirmation: payload.email_confirmation,
    };
    if (Array.isArray(payload.resolved_emails)) {
      payload.resolved_emails.forEach((re, idx) => {
        if (re && (re.raw_email || re.normalized_email)) {
          sourceData[`resolved_email_${idx}`] = re.raw_email || re.normalized_email;
        }
      });
    }
    identities = resolveCanonicalEmails(sourceData, payload.source || 'intake').emails;
  }

  // Non-blocking sync to public.lead_emails table
  for (const identity of identities) {
    try {
      await db.from('lead_emails').upsert(
        {
          lead_id: leadId,
          raw_email: identity.raw_email,
          normalized_email: identity.normalized_email,
          source: identity.source || payload.source || 'intake',
          source_field: identity.source_field || 'email',
          is_primary: identity.is_primary,
          is_valid: true,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'lead_id,normalized_email' }
      );
    } catch (_err) {
      // non-blocking
    }
  }

  const recipients = identities.map((id) => id.normalized_email);

  if (recipients.length === 0) {
    // No valid email — create data_review task (idempotent)
    const { data: existingReviewTask } = await db
      .from('tasks')
      .select('id')
      .eq('intake_event_id', intakeEventId)
      .eq('task_type', 'data_review')
      .single();

    if (!existingReviewTask) {
      await db.from('tasks').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        task_type: 'data_review',
        title: 'Review lead email data',
        description: 'No valid email address available for this lead. Please review and update.',
        status: 'pending',
        created_by: 'system',
      });

      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'processing_failed',
        actor_type: 'system',
        summary: 'No valid email address — data review task created',
        metadata: { reason: 'no_valid_email' },
      });
    }

    return { sent: 0, failed: 0, tasksCreated: 1, allSucceeded: false, errors: ['No valid email address'] };
  }

  // Resolve course template key if specified
  let templateKey = 'lead_intake_email';
  let isCourseUnidentified = false;
  if (payload.course_interest) {
    const normalizedCourse = payload.course_interest.trim().toLowerCase();
    if (normalizedCourse === 'zygomatic' || normalizedCourse === 'zit-01' || normalizedCourse.includes('zygomatic')) {
      templateKey = 'zygomatic_course_details';
    } else if (normalizedCourse === 'periodontal' || normalizedCourse === 'periodontal plastic' || normalizedCourse.includes('perio')) {
      templateKey = 'periodontal_course_details';
    } else if (normalizedCourse === 'endodontic' || normalizedCourse === 'endodontics' || normalizedCourse === 'et-01' || normalizedCourse.includes('endo')) {
      templateKey = 'endodontic_course_details';
    } else if (normalizedCourse === 'intensive' || normalizedCourse === 'advanced' || normalizedCourse === 'idit-01' || normalizedCourse.includes('intensive') || normalizedCourse.includes('implant')) {
      templateKey = 'implant_course_details';
    } else if (normalizedCourse === 'wisdom' || normalizedCourse === 'wtt-01' || normalizedCourse.includes('wisdom') || normalizedCourse.includes('molar')) {
      templateKey = 'wisdom_course_details';
    } else if (normalizedCourse === 'rehabilitation' || normalizedCourse.includes('rehab')) {
      templateKey = 'rehabilitation_course_details';
    } else {
      isCourseUnidentified = true;
    }
  }

  if (isCourseUnidentified) {
    await db.from('tasks').insert({
      lead_id: leadId,
      intake_event_id: intakeEventId,
      task_type: 'data_review',
      title: 'Triagem de Curso Não Identificado — Meta Lead',
      description: `Interesse de curso não identificado: "${payload.course_interest}". Realizar triagem manual para definir a turma apropriada.`,
      status: 'pending',
      created_by: 'system',
    });
  }

  // Get email template
  const { data: template } = await db
    .from('transactional_templates')
    .select('subject_template, body_template')
    .eq('key', templateKey)
    .eq('is_active', true)
    .maybeSingle();

  if (!template) {
    return { sent: 0, failed: 0, tasksCreated: 0, allSucceeded: false, errors: [`Email template not found: ${templateKey}`] };
  }

  // Get settings for from email
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
  const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;
  const replyTo = 'info@expdentalsolutions.com';

  const isZygomatic = templateKey === 'zygomatic_course_details';
  const approvedTpl = APPROVED_COURSE_TEMPLATES[templateKey];
  const zygomaticSalutation = resolveZygomaticSalutation(payload);

  const templateVars = {
    salutation,
    salutation_line: zygomaticSalutation,
    first_name: resolveSafeFirstName(payload.first_name),
    last_name: payload.last_name || '',
    course_name: payload.course_interest || (isZygomatic ? 'Zygomatic Implant Training' : 'Intensive Dental Implant Training'),
    course_date_range: 'November 7–10, 2026',
    course_tuition: '$17,500',
  };

  let subject: string;
  let body: string;
  let escapedHtmlBody: string;

  if (approvedTpl) {
    subject = approvedTpl.subject;
    body = approvedTpl.getText(payload);
    escapedHtmlBody = approvedTpl.getHtml(payload);
  } else if (isZygomatic) {
    subject = template.subject_template || 'Zygomatic Course Details – Hands-On Training in Rio';
    body = getApprovedZygomaticText(payload);
    escapedHtmlBody = getApprovedZygomaticHtml(payload);
  } else {
    subject = renderTemplate(template.subject_template || '', templateVars);
    body = renderTemplate(template.body_template, templateVars);
    escapedHtmlBody = renderTemplate(template.body_template, {
      ...templateVars,
      salutation: escapeHtml(templateVars.salutation),
      first_name: escapeHtml(templateVars.first_name),
    }).replace(/\n/g, '<br>');
  }

  // Attachment handling: Query template_attachments for this template
  const attachmentsToSend: Array<{ filename: string; content: string; contentType?: string }> = [];
  let attachmentMetadata = {
    included: false,
    filename: null as string | null,
    materialId: null as string | null,
  };

  let { data: tmplAtts } = await db
    .from('template_attachments')
    .select('is_required, display_name, material_id')
    .eq('template_key', templateKey);

  // Fallback for zygomatic_course_details if material_id was not linked in template_attachments
  if ((!tmplAtts || tmplAtts.length === 0) && isZygomatic) {
    const { data: zygMat } = await db
      .from('course_materials')
      .select('id, title, file_name, storage_bucket, storage_path, content_type, is_active')
      .ilike('file_name', '%zygomatic%')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (zygMat) {
      tmplAtts = [{ is_required: true, display_name: zygMat.file_name, material_id: zygMat.id }];
    }
  }

  if (tmplAtts && tmplAtts.length > 0) {
    for (const tmplAtt of tmplAtts) {
      if (!tmplAtt.material_id) continue;
      const { data: material } = await db
        .from('course_materials')
        .select('id, title, file_name, storage_bucket, storage_path, content_type, is_active')
        .eq('id', tmplAtt.material_id)
        .maybeSingle();

      if (material && material.is_active) {
        const { data: fileData, error: downloadErr } = await db.storage
          .from(material.storage_bucket)
          .download(material.storage_path);

        if (!downloadErr && fileData && fileData.size > 0) {
          const arrayBuffer = await fileData.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk as any);
          }
          const base64Content = btoa(binary);

          attachmentsToSend.push({
            filename: tmplAtt.display_name || material.file_name,
            content: base64Content,
            contentType: 'application/pdf',
          });
        } else if (tmplAtt.is_required || isZygomatic || approvedTpl) {
          return {
            sent: 0,
            failed: 1,
            tasksCreated: 1,
            allSucceeded: false,
            errors: [`Required course attachment (${material?.file_name || 'PDF'}) could not be retrieved from storage`],
          };
        }
      }
    }

    if (attachmentsToSend.length > 0) {
      attachmentMetadata = {
        included: true,
        filename: attachmentsToSend.map((a) => a.filename).join(', '),
        materialId: tmplAtts[0]?.material_id || null,
      };
    }
  }

  // Ensure or resolve conversation for threading in Lead Profile -> Conversas
  let conversationId: string | null = null;
  const { data: existingConv } = await db
    .from('conversations')
    .select('id')
    .eq('lead_id', leadId)
    .eq('channel', 'email')
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: createdConv } = await db
      .from('conversations')
      .insert({
        lead_id: leadId,
        channel: 'email',
        status: 'open',
        subject: subject || 'Welcome to Expert Dental Solutions',
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 120),
        last_message_direction: 'outbound',
      })
      .select('id')
      .single();
    conversationId = createdConv?.id || null;
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    const msgIdempotencyKey = `${leadId}:${templateKey}:${recipient}`;

    // Check if recipient email is suppressed
    const { data: suppression } = await db
      .from('email_suppressions')
      .select('reason')
      .eq('normalized_email', recipient)
      .maybeSingle();

    if (suppression) {
      await db.from('outbound_messages').insert({
        lead_id: leadId,
        conversation_id: conversationId,
        intake_event_id: intakeEventId,
        channel: 'email',
        provider: 'resend',
        recipient,
        template_key: templateKey,
        subject_snapshot: subject,
        body_snapshot: body,
        status: 'failed',
        error_code: 'EMAIL_SUPPRESSED',
        error_message: `Recipient email is suppressed (${suppression.reason})`,
        idempotency_key: msgIdempotencyKey,
        attempt_count: 1,
        failed_at: new Date().toISOString(),
      });
      failed++;
      errors.push(`Recipient ${recipient} is suppressed (${suppression.reason})`);
      continue;
    }

    // Check recipient-level exactly-once idempotency across retries, reconciliations, and historical sync:
    // Any existing message for (lead_id + recipient + template_key) or idempotency_key in valid send/delivered/opened/clicked/in-flight states skips re-send.
    const { data: existingMsg } = await db
      .from('outbound_messages')
      .select('id, status, attempt_count, conversation_id, provider_message_id')
      .or(`idempotency_key.eq.${msgIdempotencyKey},and(lead_id.eq.${leadId},recipient.ilike.${recipient},template_key.eq.${templateKey})`)
      .in('status', ['sent', 'delivered', 'opened', 'clicked', 'pending', 'queued'])
      .maybeSingle();

    if (existingMsg) {
      sent++;
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: `E-mail de primeiro contato (${templateKey}) já enviado para ${recipient}. Reenvio duplicado ignorado.`,
        metadata: {
          outbound_message_id: existingMsg.id,
          provider_message_id: existingMsg.provider_message_id,
          recipient,
          template_key: templateKey,
        },
      });
      continue; // Already sent — skip
    }

    // Create or find outbound message
    let messageId: string;
    if (existingMsg) {
      messageId = existingMsg.id;
      await db
        .from('outbound_messages')
        .update({
          status: 'pending',
          conversation_id: conversationId || existingMsg.conversation_id,
          attempt_count: (existingMsg.attempt_count || 0) + 1,
        })
        .eq('id', messageId);
    } else {
      const { data: newMsg } = await db
        .from('outbound_messages')
        .insert({
          lead_id: leadId,
          conversation_id: conversationId,
          intake_event_id: intakeEventId,
          channel: 'email',
          provider: 'resend',
          recipient,
          template_key: templateKey,
          subject_snapshot: subject,
          body_snapshot: body,
          status: 'pending',
          idempotency_key: msgIdempotencyKey,
          attempt_count: 1,
          attachment_included: attachmentMetadata.included,
          attachment_filename: attachmentMetadata.filename,
          attachment_material_id: attachmentMetadata.materialId,
        })
        .select('id')
        .single();
      messageId = newMsg!.id;
    }

    // Send via Resend
    const result = await sendEmail({
      from: sender,
      to: recipient,
      subject,
      html: escapedHtmlBody,
      text: body,
      replyTo,
      idempotencyKey: msgIdempotencyKey,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    });

    if (result.success) {
      await db
        .from('outbound_messages')
        .update({
          status: 'sent',
          provider_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId);

      if (conversationId) {
        await db
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: body.slice(0, 120),
            last_message_direction: 'outbound',
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId);
      }

      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'email_dispatched',
        channel: 'email',
        actor_type: 'system',
        summary: `Email sent to ${recipient}`,
        metadata: { recipient, provider_message_id: result.messageId },
      });

      sent++;

      // --- Titan Sent Mailbox Synchronization (Archival copy) ---
      try {
        const titanRes = await syncEmailToTitanSent({
          from: sender,
          to: recipient,
          subject,
          html: escapedHtmlBody,
          text: body,
          messageId: result.messageId || undefined,
          date: new Date(),
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
          idempotencyKey: msgIdempotencyKey,
        });

        if (titanRes.status === 'synced') {
          await db
            .from('outbound_messages')
            .update({
              titan_sync_status: 'synced',
              titan_synced_at: new Date().toISOString(),
              titan_sent_folder: titanRes.folder || 'Sent',
            })
            .eq('id', messageId);
        } else if (titanRes.status === 'CONFIG_REQUIRED') {
          await db
            .from('outbound_messages')
            .update({
              titan_sync_status: 'pending',
              titan_sync_error: 'TITAN_IMAP_PASSWORD configuration required in Supabase secrets',
            })
            .eq('id', messageId);
        } else if (titanRes.status === 'failed') {
          await db
            .from('outbound_messages')
            .update({
              titan_sync_status: 'failed',
              titan_sync_error: titanRes.error || 'Titan IMAP sync failed',
            })
            .eq('id', messageId);
        }
      } catch (titanErr: any) {
        console.warn('[process-lead-intake] Titan sync error (isolated from Resend delivery):', titanErr.message);
        await db
          .from('outbound_messages')
          .update({
            titan_sync_status: 'failed',
            titan_sync_error: titanErr.message,
          })
          .eq('id', messageId);
      }
    } else {
      await db
        .from('outbound_messages')
        .update({
          status: 'failed',
          error_code: result.errorCode,
          error_message: result.errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId);

      failed++;
      errors.push(`Failed to send to ${recipient}: ${result.errorMessage}`);
    }
  }

  return {
    sent,
    failed,
    tasksCreated: 0,
    allSucceeded: sent > 0 || (recipients.length === 0 ? false : failed === 0),
    errors,
  };
}

// deno-lint-ignore no-explicit-any
async function handleSmsPreference(
  db: any,
  payload: LeadIntakePayload,
  leadId: string,
  intakeEventId: string,
  salutation: string,
  _baseIdempotencyKey: string,
) {
  // Determine E.164 number
  let phoneE164: string | null = null;

  if (payload.phone) {
    if (payload.phone.startsWith('+')) {
      phoneE164 = payload.phone.trim();
    }
    // Do NOT guess country code — only use if already E.164
  }

  if (!phoneE164) {
    // No usable phone — create data_review task (idempotent)
    const { data: existingReviewTask } = await db
      .from('tasks')
      .select('id')
      .eq('intake_event_id', intakeEventId)
      .eq('task_type', 'data_review')
      .single();

    if (!existingReviewTask) {
      await db.from('tasks').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        task_type: 'data_review',
        title: 'Review lead phone data',
        description: 'No E.164 phone number available. Please review and update with international format.',
        status: 'pending',
        created_by: 'system',
      });

      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'processing_failed',
        actor_type: 'system',
        summary: 'No E.164 phone number — data review task created',
        metadata: { reason: 'no_e164_phone', raw_phone: payload.phone || null },
      });
    }

    return { sent: 0, failed: 0, tasksCreated: 1, allSucceeded: false, errors: ['No E.164 phone number'] };
  }

  // Get SMS template
  const { data: template } = await db
    .from('transactional_templates')
    .select('body_template')
    .eq('key', 'lead_intake_sms')
    .eq('is_active', true)
    .single();

  if (!template) {
    return { sent: 0, failed: 0, tasksCreated: 0, allSucceeded: false, errors: ['SMS template not found'] };
  }

  const body = renderTemplate(template.body_template, salutation);
  const msgIdempotencyKey = `${intakeEventId}:sms:${phoneE164}`;

  // Check if already sent
  const { data: existingMsg } = await db
    .from('outbound_messages')
    .select('id, status, attempt_count')
    .eq('idempotency_key', msgIdempotencyKey)
    .single();

  if (existingMsg?.status === 'sent') {
    return { sent: 1, failed: 0, tasksCreated: 0, allSucceeded: true, errors: [] };
  }

  // Create or update outbound message
  let messageId: string;
  if (existingMsg) {
    messageId = existingMsg.id;
    await db
      .from('outbound_messages')
      .update({ status: 'pending', attempt_count: (existingMsg.attempt_count || 0) + 1 })
      .eq('id', messageId);
  } else {
    const { data: newMsg } = await db
      .from('outbound_messages')
      .insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        channel: 'sms',
        provider: 'twilio',
        recipient: phoneE164,
        template_key: 'lead_intake_sms',
        body_snapshot: body,
        status: 'pending',
        idempotency_key: msgIdempotencyKey,
        attempt_count: 1,
      })
      .select('id')
      .single();
    messageId = newMsg!.id;
  }

  // Send via Twilio
  const result = await sendSms({ to: phoneE164, body });

  if (result.success) {
    await db
      .from('outbound_messages')
      .update({
        status: 'sent',
        provider_message_id: result.messageId,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId);

    await db.from('lead_activities').insert({
      lead_id: leadId,
      intake_event_id: intakeEventId,
      activity_type: 'sms_dispatched',
      channel: 'sms',
      actor_type: 'system',
      summary: `SMS sent to ${phoneE164}`,
      metadata: { recipient: phoneE164, provider_message_id: result.messageId },
    });

    return { sent: 1, failed: 0, tasksCreated: 0, allSucceeded: true, errors: [] };
  }

  await db
    .from('outbound_messages')
    .update({
      status: 'failed',
      error_code: result.errorCode,
      error_message: result.errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', messageId);

  await db.from('lead_activities').insert({
    lead_id: leadId,
    intake_event_id: intakeEventId,
    activity_type: 'processing_failed',
    channel: 'sms',
    actor_type: 'system',
    summary: result.errorCode === 'MISSING_FROM_NUMBER'
      ? 'SMS dispatch blocked: TWILIO_FROM_NUMBER is not configured'
      : `SMS dispatch failed: ${result.errorMessage}`,
    metadata: {
      provider: 'twilio',
      error_code: result.errorCode,
      error_message: result.errorMessage,
    },
  });

  return {
    sent: 0,
    failed: 1,
    tasksCreated: 0,
    allSucceeded: false,
    errors: [`SMS failed: ${result.errorMessage}`],
  };
}

// deno-lint-ignore no-explicit-any
async function handleCallPreference(
  db: any,
  leadId: string,
  intakeEventId: string,
  salutation: string,
) {
  try {
    const { data: existingCallTask } = await db
      .from('tasks')
      .select('id')
      .eq('intake_event_id', intakeEventId)
      .eq('task_type', 'call')
      .single();

    if (existingCallTask) {
      return { tasksCreated: 1, success: true, errors: [] as string[] };
    }

    await db.from('tasks').insert({
      lead_id: leadId,
      intake_event_id: intakeEventId,
      task_type: 'call',
      title: `Call lead — ${salutation}`,
      description: 'Lead prefers phone call. Please reach out.',
      status: 'pending',
      created_by: 'system',
    });

    await db.from('lead_activities').insert({
      lead_id: leadId,
      intake_event_id: intakeEventId,
      activity_type: 'call_task_created',
      channel: 'call',
      actor_type: 'system',
      summary: `Call task created for ${salutation}`,
      metadata: { task_type: 'call' },
    });

    return { tasksCreated: 1, success: true, errors: [] as string[] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create call task';
    return { tasksCreated: 0, success: false, errors: [msg] };
  }
}

function resolveSafeFirstName(firstName?: string | null): string {
  if (!firstName || typeof firstName !== 'string') return 'Doctor';
  const trimmed = firstName.trim();
  if (!trimmed) return 'Doctor';
  const lower = trimmed.toLowerCase();
  const placeholders = [
    'doutor(a)',
    'doutora',
    'doutor',
    'dr(a)',
    'dr(a).',
    'dr.',
    'dra.',
    'dr',
    'dra',
    'undefined',
    'null',
    'n/a',
    'none',
  ];
  if (placeholders.includes(lower)) return 'Doctor';
  return trimmed;
}

function renderTemplate(
  template: string,
  vars: { salutation?: string; first_name?: string; course_name?: string; course_date_range?: string; course_tuition?: string } | string
): string {
  if (typeof vars === 'string') {
    return template.replace(/\{\{salutation\}\}/gi, vars);
  }
  const safeFirst = resolveSafeFirstName(vars.first_name);
  const safeSalutation = vars.salutation && !['doutor(a)', 'doutora', 'doutor', 'dr(a)', 'dr.', 'dra.'].includes(vars.salutation.toLowerCase())
    ? vars.salutation
    : safeFirst;

  let res = template
    .replace(/\{\{\s*salutation\s*\}\}/gi, safeSalutation)
    .replace(/\{\{\s*first_name\s*\}\}/gi, safeFirst)
    .replace(/\{\{\s*course_name\s*\}\}/gi, vars.course_name || 'Zygomatic Implant Training')
    .replace(/\{\{\s*course_date_range\s*\}\}/gi, vars.course_date_range || 'November 7–10, 2026')
    .replace(/\{\{\s*course_tuition\s*\}\}/gi, vars.course_tuition || '$17,500');

  // Strip any remaining unresolved template tags safely
  res = res.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');
  return res;
}

function jsonResponse(body: LeadIntakeResponse): Response {
  return new Response(
    JSON.stringify(body),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
