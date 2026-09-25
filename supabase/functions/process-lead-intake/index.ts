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
import { resolveSalutation } from '../_shared/salutation.ts';
import { resolveEmailRecipients, escapeHtml } from '../_shared/email-utils.ts';
import { sendEmail } from '../_shared/resend-adapter.ts';
import { sendSms } from '../_shared/twilio-adapter.ts';
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
    const errors: string[] = [];

    const isTestLead =
      (payload.source || '').toLowerCase() === 'test' ||
      (payload.source_detail || '').toLowerCase() === 'test' ||
      Boolean(payload.raw_payload && (payload.raw_payload.is_test === true || payload.raw_payload.test === true));

    const isHistoricalSync =
      ['hubspot', 'csv_import', 'legacy_import', 'historical_migration'].includes((payload.source || '').toLowerCase()) ||
      ['hubspot_sync', 'hubspot_historical', 'hubspot_reconcile', 'csv_import', 'legacy_import', 'historical_migration'].includes((payload.source_detail || '').toLowerCase());

    const isWebsiteLead =
      ['form', 'website'].includes((payload.source || '').toLowerCase()) ||
      ['website', 'website-register', 'website_register', 'website incomplete registration', 'website_incomplete_registration', 'incomplete_registration', 'incomplete-registration'].includes((payload.source_detail || '').toLowerCase()) ||
      (payload.source_detail || '').toLowerCase().includes('website');

    const isMetaLead =
      !isTestLead &&
      !isHistoricalSync &&
      !isWebsiteLead &&
      (
        ['meta', 'facebook', 'instagram', 'fb', 'ig'].includes((payload.source || '').toLowerCase()) ||
        ['meta', 'facebook', 'instagram', 'fb', 'ig', 'meta_ad', 'instagram_ad', 'facebook_ad'].includes((payload.source_detail || '').toLowerCase())
      );

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
    } else if (isWebsiteLead) {
      // WEBSITE LEAD RULE:
      // Must NOT receive first-contact automation.
      // Remains in Novo Lead for manual client response.
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: 'Website lead intake received. Automated first-contact outreach is suppressed per business rule (manual client response required).',
        metadata: { source: payload.source, source_detail: payload.source_detail },
      });
      actionSucceeded = true;
    } else if (!isNewLead) {
      // EXISTING LEAD RULE:
      // First-contact automatic outreach is triggered only for genuinely new leads.
      await db.from('lead_activities').insert({
        lead_id: leadId,
        intake_event_id: intakeEventId,
        activity_type: 'intake_received',
        actor_type: 'system',
        summary: 'Intake event received for existing lead. First-contact automatic outreach is suppressed.',
        metadata: { source: payload.source, source_detail: payload.source_detail },
      });
      actionSucceeded = true;
    } else if (isMetaLead) {
      // BATCH 7.5: META / INSTAGRAM FIRST EMAIL AUTOMATION (EMAIL-ONLY SAFE ACTIVATION)
      // SMS is strictly disabled (zero Twilio calls, zero SMS sends).
      const isMetaAutoEmailActive = Deno.env.get('ENABLE_META_FIRST_EMAIL_AUTOMATION') === 'true';

      if (!isMetaAutoEmailActive) {
        // Dormant Mode: deployed safely without dispatching live emails until explicitly activated
        await db.from('lead_activities').insert({
          lead_id: leadId,
          intake_event_id: intakeEventId,
          activity_type: 'intake_received',
          actor_type: 'system',
          summary: 'Meta first email automation is currently dormant (ENABLE_META_FIRST_EMAIL_AUTOMATION is inactive). Lead retained in Novo Lead for manual outreach.',
          metadata: { source: payload.source, source_detail: payload.source_detail, dormant: true },
        });
        actionSucceeded = true;
      } else {
        const metaPref = payload.contact_preference
          ? String(payload.contact_preference).trim().toLowerCase()
          : null;

        // 1. Explicit SMS preference -> NÃO email automático, SMS Manual Assistido/task
        if (metaPref === 'sms' || metaPref === 'text') {
          await db.from('tasks').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            task_type: 'follow_up',
            title: 'SMS Manual Assistido — Meta Lead',
            description: `Lead indicou preferência explícita por SMS. Envio automático de SMS está desabilitado. Contatar manualmente via SMS Assistido no Inbox ou WhatsApp Web. Telefone: ${payload.phone || 'não informado'}.`,
            status: 'pending',
            created_by: 'system',
          });
          await db.from('lead_activities').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email automático suprimido: lead possui preferência explícita por SMS. Tarefa de SMS Manual Assistido criada.',
            metadata: { preference: 'sms', suppressed_channel: 'email', manual_assisted: true },
          });
          tasksCreated++;
          actionSucceeded = true;
        }
        // 2. Phone / Call -> ligação manual/task
        else if (metaPref === 'call' || metaPref === 'phone') {
          await db.from('tasks').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            task_type: 'call',
            title: 'Ligação Telefônica — Meta Lead',
            description: `Lead indicou preferência por Ligação Telefônica. Contatar pelo telefone: ${payload.phone || 'não informado'}.`,
            status: 'pending',
            created_by: 'system',
          });
          await db.from('lead_activities').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email automático suprimido: lead possui preferência por Ligação Telefônica. Tarefa de ligação criada.',
            metadata: { preference: 'call', suppressed_channel: 'email', manual_task: true },
          });
          tasksCreated++;
          actionSucceeded = true;
        }
        // 3. WhatsApp -> manual/task
        else if (metaPref === 'whatsapp') {
          await db.from('tasks').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            task_type: 'follow_up',
            title: 'WhatsApp Manual — Meta Lead',
            description: `Lead indicou preferência por WhatsApp. Contatar pelo WhatsApp: ${payload.phone || 'não informado'}.`,
            status: 'pending',
            created_by: 'system',
          });
          await db.from('lead_activities').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email automático suprimido: lead possui preferência por WhatsApp. Tarefa manual criada.',
            metadata: { preference: 'whatsapp', suppressed_channel: 'email', manual_task: true },
          });
          tasksCreated++;
          actionSucceeded = true;
        }
        // 4. Unknown / Null / Unspecified -> NÃO assumir Email
        else if (!metaPref || metaPref === 'unknown' || metaPref === 'unspecified') {
          await db.from('tasks').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            task_type: 'data_review',
            title: 'Revisão de Preferência de Contato — Meta Lead',
            description: 'Lead capturado sem preferência de contato especificada. Não presumir Email automaticamente. Verificar canal preferido antes de disparar.',
            status: 'pending',
            created_by: 'system',
          });
          await db.from('lead_activities').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email automático suprimido: preferência de contato não informada (não presumir Email). Lead retido para revisão manual.',
            metadata: { preference: null, suppressed_channel: 'email', manual_review: true },
          });
          tasksCreated++;
          actionSucceeded = true;
        }
        // 5. Email preference -> email automático somente se todas as demais regras passarem
        else if (metaPref === 'email') {
          const hasValidEmail = Boolean(
            payload.email &&
            payload.email.trim().length > 3 &&
            payload.email.includes('@') &&
            payload.email.includes('.')
          );
          const hasValidPhone = Boolean(payload.phone && payload.phone.replace(/\D/g, '').length >= 8);

          if (hasValidEmail) {
            // Stable lead-level first-contact idempotency:
            // Check if an automatic first email was already attempted or accepted for this lead
            const { data: existingFirstContact } = await db
              .from('outbound_messages')
              .select('id, status, provider_message_id')
              .eq('lead_id', leadId)
              .eq('channel', 'email')
              .in('template_key', ['lead_intake_email', 'zygomatic_course_details', 'intensive_course_details'])
              .in('status', ['sent', 'delivered', 'pending'])
              .maybeSingle();

            if (existingFirstContact) {
              await db.from('lead_activities').insert({
                lead_id: leadId,
                intake_event_id: intakeEventId,
                activity_type: 'intake_received',
                actor_type: 'system',
                summary: 'First automatic email has already been accepted/sent for this lead. Duplicate send skipped.',
                metadata: { outbound_message_id: existingFirstContact.id, provider_message_id: existingFirstContact.provider_message_id },
              });
              actionSucceeded = true;
            } else {
              const emailRes = await handleEmailPreference(
                db, payload, leadId, intakeEventId, salutation, idempotencyKey,
              );
              messagesSent += emailRes.sent;
              messagesFailed += emailRes.failed;
              tasksCreated += emailRes.tasksCreated;
              errors.push(...emailRes.errors);
              actionSucceeded = emailRes.allSucceeded;
            }
          } else if (hasValidPhone && !hasValidEmail) {
            // Phone-only Meta lead:
            // In this email-only phase, SMS is inactive. Send NOTHING automatically.
            // Retain lead in Novo Lead for manual follow-up without creating a failure state.
            await db.from('lead_activities').insert({
              lead_id: leadId,
              intake_event_id: intakeEventId,
              activity_type: 'intake_received',
              actor_type: 'system',
              summary: 'Meta lead has phone only. Automated SMS is inactive in email-only phase; lead retained in Novo Lead for manual follow-up.',
              metadata: { source: payload.source, source_detail: payload.source_detail, has_phone: true, has_email: false },
            });
            actionSucceeded = true;
          } else {
            // Neither valid email nor valid phone
            await db.from('lead_activities').insert({
              lead_id: leadId,
              intake_event_id: intakeEventId,
              activity_type: 'processing_failed',
              actor_type: 'system',
              summary: 'Meta lead has neither valid email nor valid phone for first contact.',
              metadata: { source: payload.source, source_detail: payload.source_detail },
            });
            actionSucceeded = false;
            errors.push('Meta lead has neither valid email nor valid phone for first contact');
          }
        } else {
          // Any other raw preference value
          await db.from('tasks').insert({
            lead_id: leadId,
            intake_event_id: intakeEventId,
            task_type: 'data_review',
            title: `Revisão de Canal Desconhecido (${metaPref}) — Meta Lead`,
            description: `Preferência de contato "${metaPref}" não suportada para disparo automático. Avaliar contato manual.`,
            status: 'pending',
            created_by: 'system',
          });
          actionSucceeded = true;
          tasksCreated++;
        }
      }
    } else {
      const pref = payload.contact_preference;
      const isValidPreference = pref === 'email' || pref === 'sms' || pref === 'call';

      if (!isValidPreference) {
        // Preference missing, invalid, or unsupported
        // Audit decision in lead_activities
        await db.from('lead_activities').insert([
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'contact_preference_detected',
            actor_type: 'system',
            summary: `Invalid or missing contact preference detected: "${pref ?? 'none'}"`,
            metadata: { preference: pref ?? null, valid: false },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email channel skipped: invalid or missing contact preference',
            metadata: { channel: 'email', reason: 'invalid_or_missing_preference' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'sms',
            actor_type: 'system',
            summary: 'SMS channel skipped: invalid or missing contact preference',
            metadata: { channel: 'sms', reason: 'invalid_or_missing_preference' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'call',
            actor_type: 'system',
            summary: 'Call channel skipped: invalid or missing contact preference',
            metadata: { channel: 'call', reason: 'invalid_or_missing_preference' },
          },
        ]);

        // Create administrative data_review task (internal review, not customer contact)
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
            title: 'Review lead contact preference',
            description: `Contact preference '${pref || 'none'}' is missing or invalid. Internal data review required before initiating contact.`,
            status: 'pending',
            created_by: 'system',
          });
        }

        tasksCreated = 1;
        actionSucceeded = false;
        errors.push(`Invalid or missing contact_preference: "${pref ?? 'none'}"`);
      } else if (pref === 'email') {
        await db.from('lead_activities').insert([
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'contact_preference_detected',
            actor_type: 'system',
            summary: 'Contact preference detected: email',
            metadata: { preference: 'email', valid: true },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'email_selected',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email channel selected based on lead contact preference',
            metadata: { channel: 'email' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'sms',
            actor_type: 'system',
            summary: 'SMS channel skipped: contact preference is email',
            metadata: { channel: 'sms', reason: 'preference_exclusion', preferred: 'email' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'call',
            actor_type: 'system',
            summary: 'Call channel skipped: contact preference is email',
            metadata: { channel: 'call', reason: 'preference_exclusion', preferred: 'email' },
          },
        ]);

        const result = await handleEmailPreference(
          db, payload, leadId, intakeEventId, salutation, idempotencyKey,
        );
        messagesSent = result.sent;
        messagesFailed = result.failed;
        tasksCreated = result.tasksCreated;
        actionSucceeded = result.allSucceeded;
        errors.push(...result.errors);
      } else if (pref === 'sms') {
        await db.from('lead_activities').insert([
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'contact_preference_detected',
            actor_type: 'system',
            summary: 'Contact preference detected: sms',
            metadata: { preference: 'sms', valid: true },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'sms_selected',
            channel: 'sms',
            actor_type: 'system',
            summary: 'SMS channel selected based on lead contact preference',
            metadata: { channel: 'sms' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email channel skipped: contact preference is sms',
            metadata: { channel: 'email', reason: 'preference_exclusion', preferred: 'sms' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'call',
            actor_type: 'system',
            summary: 'Call channel skipped: contact preference is sms',
            metadata: { channel: 'call', reason: 'preference_exclusion', preferred: 'sms' },
          },
        ]);

        const result = await handleSmsPreference(
          db, payload, leadId, intakeEventId, salutation, idempotencyKey,
        );
        messagesSent = result.sent;
        messagesFailed = result.failed;
        tasksCreated = result.tasksCreated;
        actionSucceeded = result.allSucceeded;
        errors.push(...result.errors);
      } else if (pref === 'call') {
        await db.from('lead_activities').insert([
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'contact_preference_detected',
            actor_type: 'system',
            summary: 'Contact preference detected: call',
            metadata: { preference: 'call', valid: true },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'call_selected',
            channel: 'call',
            actor_type: 'system',
            summary: 'Call task selected based on lead contact preference',
            metadata: { channel: 'call' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email channel skipped: contact preference is call',
            metadata: { channel: 'email', reason: 'preference_exclusion', preferred: 'call' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'sms',
            actor_type: 'system',
            summary: 'SMS channel skipped: contact preference is call',
            metadata: { channel: 'sms', reason: 'preference_exclusion', preferred: 'call' },
          },
        ]);

        const result = await handleCallPreference(
          db, leadId, intakeEventId, salutation,
        );
        tasksCreated = result.tasksCreated;
        actionSucceeded = result.success;
        errors.push(...result.errors);
      } else if (pref === 'whatsapp') {
        // Explicit WhatsApp branch: ZERO auto-email, create manual task
        await db.from('lead_activities').insert([
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'contact_preference_detected',
            actor_type: 'system',
            summary: 'Contact preference detected: whatsapp',
            metadata: { preference: 'whatsapp', valid: true },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email channel skipped: contact preference is whatsapp',
            metadata: { channel: 'email', reason: 'preference_exclusion', preferred: 'whatsapp' },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'sms',
            actor_type: 'system',
            summary: 'SMS channel skipped: contact preference is whatsapp',
            metadata: { channel: 'sms', reason: 'preference_exclusion', preferred: 'whatsapp' },
          },
        ]);

        const { error: taskErr } = await db.from('tasks').insert({
          lead_id: leadId,
          title: `Contato WhatsApp — ${payload.first_name || 'Lead'} ${payload.last_name || ''}`.trim(),
          description: `Lead solicitou preferência por WhatsApp. Telefone: ${payload.phone_raw || payload.phone_e164 || 'N/A'}. Realizar contato manual via aparelho ou WhatsApp corporativo.`,
          status: 'pending',
          priority: 'high',
          due_date: new Date().toISOString(),
        });
        if (!taskErr) tasksCreated++;
        actionSucceeded = true;
      } else {
        // NULL / Unspecified preference: ZERO auto-email, create review task
        await db.from('lead_activities').insert([
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'contact_preference_detected',
            actor_type: 'system',
            summary: 'Contact preference not specified: manual review required',
            metadata: { preference: null, valid: false },
          },
          {
            lead_id: leadId,
            intake_event_id: intakeEventId,
            activity_type: 'channel_skipped',
            channel: 'email',
            actor_type: 'system',
            summary: 'Email channel skipped: preference not specified (no automatic fallback to email)',
            metadata: { channel: 'email', reason: 'unspecified_preference_protection' },
          },
        ]);

        const { error: taskErr } = await db.from('tasks').insert({
          lead_id: leadId,
          title: `Revisão Manual — ${payload.first_name || 'Lead'} ${payload.last_name || ''}`.trim(),
          description: `Preferência de contato não informada pelo lead. Não é permitido presumir e-mail automaticamente. Verificar dados cadastrais e definir melhor abordagem humana.`,
          status: 'pending',
          priority: 'medium',
          due_date: new Date().toISOString(),
        });
        if (!taskErr) tasksCreated++;
        actionSucceeded = true;
      }
    }

    // --- 9. Advance pipeline if successful (Website, Historical, Test, and Meta leads stay in Novo Lead) ---
    let stageAdvanced = false;
    if (actionSucceeded) {
      if (!isWebsiteLead && !isHistoricalSync && !isMetaLead && !isTestLead && isNewLead) {
        // Check current stage — only advance if still in Capture (Novo Lead)
        const { data: currentLead } = await db
          .from('leads')
          .select('pipeline_stage_id')
          .eq('id', leadId)
          .single();

        if (currentLead && currentLead.pipeline_stage_id === captureStage.id) {
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
            summary: 'Lead advanced from Novo Lead to Respondido after successful intake processing',
            metadata: { from: 'capture', to: 'qualification' },
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

    // Supplementary non-blocking push notification for new lead
    if (actionSucceeded && leadId) {
      try {
        const leadName = `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || 'Novo interessado';
        const courseName = payload.course_title || 'curso de especialização';
        await db.functions.invoke('send-push-notification', {
          body: {
            event_type: 'new_lead',
            event_id: leadId,
            idempotency_key: `lead_${leadId}_${Date.now()}`,
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
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// =============================================================================
// Helper functions
// =============================================================================

function validatePayload(p: LeadIntakePayload): string[] {
  const errors: string[] = [];
  const validSources = ['meta', 'google', 'manual', 'test', 'form', 'facebook', 'instagram'];
  if (!p.source || !validSources.includes(p.source.toLowerCase())) {
    errors.push('Invalid or missing source');
  }
  return errors;
}

function generateIdempotencyKey(p: LeadIntakePayload): string {
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
  // Try direct lead_id lookup if provided
  if (payload.lead_id) {
    const { data: existing } = await db
      .from('leads')
      .select('id')
      .eq('id', payload.lead_id)
      .single();

    if (existing) {
      return { leadId: existing.id, isNewLead: false };
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

  // Get Capture stage
  const { data: captureStage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('code', 'capture')
    .single();

  // Determine DB-safe contact_preference ('email' | 'sms' | 'call')
  const rawPref = payload.contact_preference;
  const isPrefValid = rawPref === 'email' || rawPref === 'sms' || rawPref === 'call';
  const dbContactPreference = isPrefValid ? rawPref : 'email';

  // Create new lead
  const { data: newLead, error: createError } = await db
    .from('leads')
    .insert({
      source: payload.source,
      source_detail: payload.source_detail || null,
      external_lead_id: payload.external_lead_id || null,
      first_name: payload.first_name || null,
      last_name: payload.last_name || null,
      email: payload.email ? payload.email.trim().toLowerCase() : null,
      email_confirmation: payload.email_confirmation
        ? payload.email_confirmation.trim().toLowerCase()
        : null,
      phone_raw: payload.phone || null,
      phone_e164: payload.phone && payload.phone.startsWith('+') ? payload.phone : null,
      contact_preference: dbContactPreference,
      pipeline_stage_id: captureStage!.id,
      source_created_at: payload.source_created_at || null,
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
) {
  const recipients = resolveEmailRecipients(payload.email, payload.email_confirmation);

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
    } else if (normalizedCourse === 'intensive' || normalizedCourse === 'idit-01' || normalizedCourse.includes('intensive')) {
      templateKey = 'intensive_course_details';
    } else if (normalizedCourse === 'endodontic' || normalizedCourse === 'et-01' || normalizedCourse.includes('endo')) {
      templateKey = 'endodontic_course_details';
    } else if (normalizedCourse === 'wisdom' || normalizedCourse === 'wtt-01' || normalizedCourse.includes('wisdom')) {
      templateKey = 'wisdom_course_details';
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

  const templateVars = {
    salutation,
    first_name: resolveSafeFirstName(payload.first_name),
    course_name: payload.course_interest || (templateKey === 'zygomatic_course_details' ? 'Zygomatic Implant Training' : 'Intensive Dental Implant Training'),
    course_date_range: 'November 7–10, 2026',
    course_tuition: '$17,500',
  };

  const subject = renderTemplate(template.subject_template || '', templateVars);
  const body = renderTemplate(template.body_template, templateVars);
  const escapedHtmlBody = renderTemplate(template.body_template, {
    ...templateVars,
    salutation: escapeHtml(templateVars.salutation),
    first_name: escapeHtml(templateVars.first_name),
  }).replace(/\n/g, '<br>');

  // Attachment handling: Query template_attachments for this template
  const attachmentsToSend: Array<{ filename: string; content: string; contentType?: string }> = [];
  let attachmentMetadata = {
    included: false,
    filename: null as string | null,
    materialId: null as string | null,
  };

  const { data: tmplAtt } = await db
    .from('template_attachments')
    .select('is_required, display_name, material_id')
    .eq('template_key', templateKey)
    .maybeSingle();

  if (tmplAtt && tmplAtt.material_id) {
    const { data: material } = await db
      .from('course_materials')
      .select('id, title, file_name, storage_bucket, storage_path, content_type, is_active')
      .eq('id', tmplAtt.material_id)
      .single();

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
          filename: material.file_name || 'Zygomatic Course Details.pdf',
          content: base64Content,
          contentType: 'application/pdf',
        });

        attachmentMetadata = {
          included: true,
          filename: material.file_name,
          materialId: material.id,
        };
      } else if (tmplAtt.is_required || templateKey === 'zygomatic_course_details') {
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
    const msgIdempotencyKey = `${intakeEventId}:email:${recipient}`;

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

    // Check if already sent (for retry scenarios)
    const { data: existingMsg } = await db
      .from('outbound_messages')
      .select('id, status, attempt_count, conversation_id')
      .eq('idempotency_key', msgIdempotencyKey)
      .single();

    if (existingMsg?.status === 'sent') {
      sent++;
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
    allSucceeded: failed === 0 && sent > 0,
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
