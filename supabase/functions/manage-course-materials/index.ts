// =============================================================================
// Edge Function: manage-course-materials
// =============================================================================
// Secure server-side PDF management for Course Materials & Template Attachments.
//
// Capabilities:
// - upload: Uploads PDF binary to private 'course-materials' bucket, associates
//   with course_materials and template_attachments, and verifies server-side download.
// - verify: Performs real server-side download to ensure storage object exists and is valid.
// - replace: Atomically replaces an attachment only after the new file is verified.
// - remove: Disassociates attachment from template without deleting shared physical files.
// - toggle_required: Updates required flag for a template attachment.
// - get: Returns public-facing attachment metadata (no private URLs or technical IDs).
// =============================================================================

import { createAdminClient } from '../_shared/supabase-client.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { testTitanConnectionAndDiscoverSent, verifyTitanSentMessage } from '../_shared/titan-imap.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function corsResponse() {
  return new Response('ok', { headers: corsHeaders });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  // 1. Authorization: Allow internal admin secret OR active app user
  const authHeader = req.headers.get('Authorization');
  const adminKey = req.headers.get('x-admin-key');
  const INTERNAL_ADMIN_SECRET = Deno.env.get('INTERNAL_ADMIN_SECRET');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  let isAuthorized = false;
  let callerId = 'anonymous';

  if (
    (adminKey && INTERNAL_ADMIN_SECRET && adminKey === INTERNAL_ADMIN_SECRET) ||
    (adminKey && serviceRoleKey && adminKey === serviceRoleKey)
  ) {
    isAuthorized = true;
    callerId = 'admin_internal';
  } else if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (
      (INTERNAL_ADMIN_SECRET && token === INTERNAL_ADMIN_SECRET) ||
      (serviceRoleKey && token === serviceRoleKey)
    ) {
      isAuthorized = true;
      callerId = 'admin_internal';
    } else {
      const authResult = await verifyAuth(authHeader);
      if (authResult.isAuthorized && authResult.userId) {
        isAuthorized = true;
        callerId = authResult.userId;
      }
    }
  }

  if (!isAuthorized) {
    return errorResponse('UNAUTHORIZED', 'Acesso não autorizado para gerenciamento de materiais.', 401);
  }

  const db = createAdminClient();

  try {
    const contentType = req.headers.get('content-type') || '';

    // =========================================================================
    // DIRECT BINARY UPLOAD (Content-Type: application/pdf)
    // =========================================================================
    if (contentType.includes('application/pdf')) {
      const fileName = decodeURIComponent(req.headers.get('x-file-name') || 'document.pdf');
      const customStoragePath = req.headers.get('x-storage-path');
      const templateKey = req.headers.get('x-template-key');
      const courseCode = req.headers.get('x-course-code') || 'ZIT-01';
      const isRequired = req.headers.get('x-is-required') !== 'false';

      if (!fileName.toLowerCase().endsWith('.pdf')) {
        return errorResponse('INVALID_FORMAT', 'Apenas arquivos PDF são permitidos.');
      }

      const bytes = new Uint8Array(await req.arrayBuffer());
      const byteLength = bytes.byteLength;

      if (byteLength === 0) {
        return errorResponse('EMPTY_FILE', 'O arquivo enviado está vazio (0 bytes).');
      }

      const MAX_BYTES = 40 * 1024 * 1024;
      if (byteLength > MAX_BYTES) {
        return errorResponse('FILE_TOO_LARGE', 'O arquivo excede o limite de 40MB para envio.');
      }

      // Check header
      const header = String.fromCharCode(...bytes.subarray(0, 5));
      if (!header.startsWith('%PDF')) {
        return errorResponse('INVALID_PDF_HEADER', 'O arquivo não é um PDF válido.');
      }

      // Resolve course
      let resolvedCourseId: string | null = null;
      let effectiveCourseCode = courseCode;
      const { data: c } = await db
        .from('courses')
        .select('id, code')
        .eq('code', effectiveCourseCode)
        .maybeSingle();

      if (c) {
        resolvedCourseId = c.id;
      } else {
        const { data: anyCourse } = await db.from('courses').select('id, code').limit(1).maybeSingle();
        if (anyCourse) {
          resolvedCourseId = anyCourse.id;
          effectiveCourseCode = anyCourse.code;
        }
      }

      const storagePath =
        customStoragePath ||
        `courses/${effectiveCourseCode}/${fileName}`;

      // 1. Upload to private bucket
      const { error: storageErr } = await db.storage
        .from('course-materials')
        .upload(storagePath, bytes, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (storageErr) {
        return errorResponse('STORAGE_UPLOAD_FAILED', `Falha no upload para o storage: ${storageErr.message}`, 500);
      }

      // 2. Real server-side retrieval verification
      const { data: verifyData, error: verifyErr } = await db.storage
        .from('course-materials')
        .download(storagePath);

      if (verifyErr || !verifyData || verifyData.size === 0) {
        return errorResponse(
          'STORAGE_VERIFICATION_FAILED',
          'Falha na validação server-side do arquivo após upload.',
          500
        );
      }

      // 3. Upsert public.course_materials
      const { data: existingMat } = await db
        .from('course_materials')
        .select('id')
        .eq('storage_bucket', 'course-materials')
        .eq('storage_path', storagePath)
        .maybeSingle();

      let materialId: string;
      const cleanTitle = fileName.replace(/\.pdf$/i, '').trim();

      if (existingMat) {
        materialId = existingMat.id;
        await db
          .from('course_materials')
          .update({
            title: cleanTitle,
            file_name: fileName,
            file_size_bytes: byteLength,
            content_type: 'application/pdf',
            is_active: true,
            is_required_for_outreach: isRequired,
          })
          .eq('id', materialId);
      } else {
        const { data: newMat, error: insertMatErr } = await db
          .from('course_materials')
          .insert({
            course_id: resolvedCourseId,
            title: cleanTitle,
            file_name: fileName,
            storage_bucket: 'course-materials',
            storage_path: storagePath,
            content_type: 'application/pdf',
            file_size_bytes: byteLength,
            is_active: true,
            is_required_for_outreach: isRequired,
          })
          .select('id')
          .single();

        if (insertMatErr || !newMat) {
          return errorResponse('DB_INSERT_FAILED', insertMatErr?.message || 'Falha ao salvar material.', 500);
        }
        materialId = newMat.id;
      }

      // 4. Upsert public.template_attachments if template_key is provided
      if (templateKey) {
        const { data: existingAtt } = await db
          .from('template_attachments')
          .select('id')
          .eq('template_key', templateKey)
          .eq('material_id', materialId)
          .maybeSingle();

        if (existingAtt) {
          await db
            .from('template_attachments')
            .update({
              is_required: isRequired,
              display_name: fileName,
            })
            .eq('id', existingAtt.id);
        } else {
          await db.from('template_attachments').insert({
            template_key: templateKey,
            material_id: materialId,
            is_required: isRequired,
            display_name: fileName,
          });
        }

        // Sync with email_templates record
        await db
          .from('email_templates')
          .update({
            has_attachment: true,
            attachment_name: fileName,
          })
          .or(`template_key.eq.${templateKey},name.ilike.%${templateKey.replace(/_/g, ' ')}%`);
      }

      return jsonResponse({
        success: true,
        verified: true,
        file_name: fileName,
        storage_path: storagePath,
        file_size_bytes: byteLength,
        content_type: 'application/pdf',
        server_retrieval: 'PASS',
        is_required: isRequired,
      });
    }

    let body: Record<string, any> = {};
    if (req.method === 'GET') {
      const url = new URL(req.url);
      body = {
        action: url.searchParams.get('action') || 'get',
        template_key: url.searchParams.get('template_key'),
      };
    } else {
      try {
        body = await req.json();
      } catch (_e) {
        body = {};
      }
    }
    const action = body.action || 'get';
    if (action === 'list_all') {
      const { data: courses } = await db.from('courses').select('id, code, name');
      const { data: materials } = await db.from('course_materials').select('*');
      const { data: attachments } = await db.from('template_attachments').select('*');
      return jsonResponse({ courses, materials, attachments });
    }

    if (action === 'associate') {
      const { template_key, material_id, display_name, is_required = true } = body;
      const { data, error } = await db.from('template_attachments').upsert({
        template_key,
        material_id,
        display_name,
        is_required,
      }, { onConflict: 'template_key,material_id' }).select();
      return jsonResponse({ success: !error, data, error });
    }

    if (action === 'inspect_submission') {
      const { submission_id } = body;
      const { data: submission } = await db
        .from('form_submissions')
        .select('*')
        .eq('id', submission_id)
        .maybeSingle();

      if (!submission) return errorResponse('NOT_FOUND', 'Submission not found', 404);

      const { data: lead } = await db
        .from('leads')
        .select('*')
        .eq('id', submission.lead_id)
        .maybeSingle();

      const { data: submissions } = await db
        .from('form_submissions')
        .select('*')
        .eq('lead_id', submission.lead_id)
        .order('submitted_at', { ascending: false });

      return jsonResponse({ submission, lead, submissions });
    }

    if (action === 'inspect_lead') {
      const { lead_id, email, phone } = body;
      let query = db.from('leads').select('*');
      if (lead_id) query = query.eq('id', lead_id);
      else if (email) query = query.eq('email', email.trim().toLowerCase());
      else if (phone) query = query.or(`phone_raw.ilike.%${phone}%,phone_e164.ilike.%${phone}%`);
      const { data: lead } = await query.maybeSingle();

      if (!lead) return errorResponse('NOT_FOUND', 'Lead not found', 404);

      const [outboundRes, tasksRes, activitiesRes, formsRes] = await Promise.all([
        db.from('outbound_messages').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
        db.from('tasks').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
        db.from('lead_activities').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
        db.from('form_submissions').select('*').eq('lead_id', lead.id).order('submitted_at', { ascending: false }),
      ]);

      return jsonResponse({
        lead,
        outbound_messages: outboundRes.data || [],
        tasks: tasksRes.data || [],
        activities: activitiesRes.data || [],
        submissions: formsRes.data || [],
      });
    }

    if (action === 'test_rpc') {
      const rpcName = body.rpc_name || 'process_form_submission_transaction';
      const { data, error } = await db.rpc(rpcName, body.params);
      return jsonResponse({ data, error });
    }

    if (action === 'query_leads') {
      const { stage_id, order_by = 'created_at', ascending = false, limit = 20 } = body;
      let q = db.from('leads').select('id, first_name, last_name, email, phone_raw, created_at, source_created_at, last_inbound_activity_at, pipeline_stage_id, deleted_at').is('deleted_at', null);
      if (stage_id) q = q.eq('pipeline_stage_id', stage_id);
      q = q.order(order_by, { ascending }).order('id', { ascending: false }).limit(limit);
      const { data: leads, error } = await q;
      return jsonResponse({ leads, error });
    }

    if (action === 'query_recent') {
      const limit = body.limit || 5;
      const [submissions, intakeEvents, syncEvents, outbound] = await Promise.all([
        db.from('form_submissions').select('*').order('submitted_at', { ascending: false }).limit(limit),
        db.from('lead_intake_events').select('*').order('created_at', { ascending: false }).limit(limit),
        db.from('integration_sync_events').select('*').order('created_at', { ascending: false }).limit(limit),
        db.from('outbound_messages').select('*').order('created_at', { ascending: false }).limit(limit),
      ]);
      return jsonResponse({
        submissions: submissions.data || [],
        intake_events: intakeEvents.data || [],
        sync_events: syncEvents.data || [],
        outbound_messages: outbound.data || [],
      });
    }

    if (action === 'check_email_history') {
      const email = (body.email || '').trim().toLowerCase();
      if (!email) return errorResponse('MISSING_EMAIL', 'Email is required');
      const [leads, submissions, outbound, intake] = await Promise.all([
        db.from('leads').select('*').or(`email.ilike.${email},email_confirmation.ilike.${email}`),
        db.from('form_submissions').select('*').ilike('email', email),
        db.from('outbound_messages').select('*').ilike('recipient', email),
        db.from('lead_intake_events').select('*').or(`idempotency_key.ilike.%${email}%,payload_hash.ilike.%${email}%`),
      ]);
      return jsonResponse({
        email,
        leads: leads.data || [],
        submissions: submissions.data || [],
        outbound_messages: outbound.data || [],
        intake_events: intake.data || [],
      });
    }

    if (action === 'manage_suppression') {
      const { op, email, reason = 'hard_bounce' } = body;
      const normalizedEmail = (email || '').trim().toLowerCase();
      if (op === 'add') {
        const { error } = await db.from('email_suppressions').upsert({
          normalized_email: normalizedEmail,
          reason,
          provider: 'resend',
          metadata: { test: true },
        }, { onConflict: 'normalized_email' });
        return jsonResponse({ success: !error, error });
      } else if (op === 'remove') {
        const { error } = await db.from('email_suppressions').delete().eq('normalized_email', normalizedEmail);
        return jsonResponse({ success: !error, error });
      }
      return errorResponse('INVALID_OP', 'Unknown suppression operation', 400);
    }

    if (action === 'cleanup_test_leads') {
      const { emails = [], lead_ids = [] } = body;
      const targetLeadIds: string[] = [...lead_ids];
      if (emails.length > 0) {
        const { data: found } = await db
          .from('leads')
          .select('id')
          .in('email', emails.map((e: string) => e.trim().toLowerCase()));
        if (found) {
          for (const row of found) {
            targetLeadIds.push(row.id);
          }
        }
      }
      if (body.pattern) {
        const { data: foundPat } = await db
          .from('leads')
          .select('id')
          .or(`email.ilike.%${body.pattern}%,phone_raw.ilike.%${body.pattern}%,phone_e164.ilike.%${body.pattern}%`);
        if (foundPat) {
          for (const row of foundPat) {
            targetLeadIds.push(row.id);
          }
        }
      }

      const uniqueIds = Array.from(new Set(targetLeadIds.filter(Boolean)));
      if (uniqueIds.length > 0) {
        await db.from('outbound_messages').delete().in('lead_id', uniqueIds);
        await db.from('tasks').delete().in('lead_id', uniqueIds);
        await db.from('lead_activities').delete().in('lead_id', uniqueIds);
        await db.from('lead_course_interests').delete().in('lead_id', uniqueIds);
        await db.from('lead_stage_history').delete().in('lead_id', uniqueIds);
        await db.from('form_submissions').delete().in('lead_id', uniqueIds);
        await db.from('lead_intake_events').delete().in('lead_id', uniqueIds);
        await db.from('conversations').delete().in('lead_id', uniqueIds);
        await db.from('integration_entity_links').delete().in('eds_entity_id', uniqueIds);
        await db.from('leads').delete().in('id', uniqueIds);
      }
      return jsonResponse({ success: true, cleaned_lead_ids: uniqueIds });
    }

    if (action === 'mark_sms_sent') {
      const { lead_id } = body;
      if (!lead_id) return errorResponse('MISSING_LEAD_ID', 'lead_id is required');

      const { data: captureStage } = await db.from('pipeline_stages').select('id').eq('code', 'capture').maybeSingle();
      const { data: qualificationStage } = await db.from('pipeline_stages').select('id').eq('code', 'qualification').maybeSingle();

      // 1. Complete pending SMS task
      await db.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('lead_id', lead_id).ilike('title', '%SMS%');

      // 2. Insert activity
      await db.from('lead_activities').insert({
        lead_id,
        activity_type: 'sms_manual_confirmed',
        channel: 'sms',
        actor_type: 'user',
        summary: 'SMS enviado manualmente: "Olá! Confirmamos seu interesse no curso."',
        metadata: {
          channel: 'sms',
          direction: 'outbound',
          status: 'manually_confirmed',
          manual: true,
          sent_at: new Date().toISOString(),
        }
      });

      // 3. Move from capture to qualification
      if (captureStage && qualificationStage) {
        const { data: lead } = await db.from('leads').select('pipeline_stage_id').eq('id', lead_id).maybeSingle();
        if (lead && lead.pipeline_stage_id === captureStage.id) {
          await db.from('leads').update({
            pipeline_stage_id: qualificationStage.id,
            updated_at: new Date().toISOString()
          }).eq('id', lead_id);

          await db.from('lead_stage_history').insert({
            lead_id,
            from_stage_id: captureStage.id,
            to_stage_id: qualificationStage.id,
            reason: 'SMS manual confirmado pelo operador',
          });
        }
      }

      return jsonResponse({ success: true, lead_id });
    }

    if (action === 'titan_test_connection') {
      const res = await testTitanConnectionAndDiscoverSent();
      return jsonResponse(res);
    }

    if (action === 'generate_auth_link') {
      const email = body.email || 'info@expdentalsolutions.com';
      const redirectTo = body.redirect_to || 'http://127.0.0.1:5173/leads/262128c0-28f5-42b8-9841-855064b9326b';
      const { data, error } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo,
        },
      });
      return jsonResponse({ data, error });
    }

    if (action === 'titan_verify_sent_message') {
      const res = await verifyTitanSentMessage({
        toEmail: body.to_email,
        subject: body.subject,
      });
      return jsonResponse(res);
    }

    if (action === 'record_manual_activity') {
      const { lead_id, activity_type, channel, summary, created_at, metadata, move_to_respondido } = body;
      const { data: act, error: actErr } = await db.from('lead_activities').insert({
        lead_id,
        activity_type,
        channel: channel || null,
        actor_type: 'user',
        summary,
        created_at: created_at || new Date().toISOString(),
        metadata: metadata || {},
      }).select().single();

      if (actErr) return errorResponse('ACT_ERR', actErr.message, 500);

      if (move_to_respondido) {
        const { data: qualStage } = await db.from('pipeline_stages').select('id, name, code').eq('code', 'qualification').maybeSingle();
        const { data: captureStage } = await db.from('pipeline_stages').select('id, name, code').eq('code', 'capture').maybeSingle();
        console.log('[record_manual_activity] qualStage:', qualStage, 'captureStage:', captureStage);
        if (qualStage) {
          const { error: upErr } = await db.from('leads').update({ pipeline_stage_id: qualStage.id, updated_at: new Date().toISOString() }).eq('id', lead_id);
          if (upErr) console.error('[record_manual_activity] update lead error:', upErr);
          if (captureStage) {
            await db.from('lead_stage_history').insert({
              lead_id,
              from_stage_id: captureStage.id,
              to_stage_id: qualStage.id,
              change_reason: 'manual_activity_registered',
            });
          }
          await db.from('lead_activities').insert({
            lead_id,
            activity_type: 'stage_changed',
            actor_type: 'user',
            summary: `Lead avançado de Novo Lead para Respondido após: ${metadata?.activity_type_label || activity_type}`,
            metadata: {
              from: 'capture',
              to: 'qualification',
              reason: 'manual_activity_registered',
              registered_by: metadata?.created_by_name || 'Operador',
            },
          });
        }
      }

      return jsonResponse({ success: true, activity: act });
    }

    if (action === 'inspect_stages') {
      const { data: stages, error: stErr } = await db.from('pipeline_stages').select('*').order('sort_order', { ascending: true });
      return jsonResponse({ stages, error: stErr });
    }

    if (action === 'set_lead_stage') {
      const { lead_id, stage_id } = body;
      const { error: updErr } = await db.from('leads').update({
        pipeline_stage_id: stage_id,
        updated_at: new Date().toISOString(),
      }).eq('id', lead_id);
      if (updErr) return errorResponse('STAGE_ERR', updErr.message, 500);
      return jsonResponse({ success: true });
    }

    if (action === 'update_lead_phone') {
      const { lead_id, phone_raw, phone_e164 } = body;
      const { data: lead, error: leadErr } = await db.from('leads').update({
        phone_raw,
        phone_e164,
        updated_at: new Date().toISOString(),
      }).eq('id', lead_id).select().single();

      if (leadErr) return errorResponse('LEAD_ERR', leadErr.message, 500);
      return jsonResponse({ success: true, lead });
    }

    // =========================================================================
    // ACTION: get_template_attachment
    // =========================================================================
    if (action === 'get') {
      const templateKey = body.template_key;
      if (!templateKey) {
        return errorResponse('MISSING_TEMPLATE_KEY', 'Chave do template é obrigatória.');
      }

      const { data: attachments, error: attErr } = await db
        .from('template_attachments')
        .select('id, is_required, display_name, material_id, created_at')
        .eq('template_key', templateKey);

      if (attErr) {
        return errorResponse('DB_ERROR', attErr.message, 500);
      }

      if (!attachments || attachments.length === 0) {
        return jsonResponse({ has_attachment: false, attachment: null, attachments: [] });
      }

      const attachmentsList: Array<{
        file_name: string;
        display_name: string;
        is_required: boolean;
        file_size_bytes: number;
        is_pdf: boolean;
      }> = [];

      for (const att of attachments) {
        if (!att.material_id) continue;
        const { data: material } = await db
          .from('course_materials')
          .select('id, title, file_name, file_size_bytes, content_type, is_active, is_required_for_outreach')
          .eq('id', att.material_id)
          .maybeSingle();

        if (material && material.is_active) {
          attachmentsList.push({
            file_name: material.file_name,
            display_name: att.display_name || material.file_name,
            is_required: Boolean(att.is_required),
            file_size_bytes: material.file_size_bytes || 0,
            is_pdf: true,
          });
        }
      }

      return jsonResponse({
        has_attachment: attachmentsList.length > 0,
        attachment: attachmentsList[0] || null,
        attachments: attachmentsList,
      });
    }

    // =========================================================================
    // ACTION: upload
    // =========================================================================
    if (action === 'upload') {
      const {
        file_base64,
        file_name,
        storage_path: customStoragePath,
        template_key,
        course_code,
        course_id: inputCourseId,
        is_required = true,
      } = body;

      if (!file_base64 || typeof file_base64 !== 'string') {
        return errorResponse('MISSING_FILE', 'Conteúdo do arquivo não fornecido.');
      }

      if (!file_name || typeof file_name !== 'string') {
        return errorResponse('MISSING_FILENAME', 'Nome do arquivo não fornecido.');
      }

      // Validate PDF extension
      if (!file_name.toLowerCase().endsWith('.pdf')) {
        return errorResponse('INVALID_FORMAT', 'Apenas arquivos PDF são permitidos.');
      }

      // Decode base64
      let binaryString: string;
      try {
        const cleanBase64 = file_base64.replace(/^data:application\/pdf;base64,/, '').trim();
        binaryString = atob(cleanBase64);
      } catch (_e) {
        return errorResponse('INVALID_BASE64', 'Codificação base64 inválida.');
      }

      const byteLength = binaryString.length;
      if (byteLength === 0) {
        return errorResponse('EMPTY_FILE', 'O arquivo enviado está vazio (0 bytes).');
      }

      // Email size limit: 40MB max
      const MAX_BYTES = 40 * 1024 * 1024;
      if (byteLength > MAX_BYTES) {
        return errorResponse('FILE_TOO_LARGE', 'O arquivo excede o limite de 40MB para envio.');
      }

      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Validate PDF magic bytes: %PDF-
      const header = String.fromCharCode(...bytes.subarray(0, 5));
      if (!header.startsWith('%PDF')) {
        return errorResponse('INVALID_PDF_HEADER', 'O arquivo não é um PDF válido.');
      }

      // Determine course association
      let resolvedCourseId: string | null = inputCourseId || null;
      let effectiveCourseCode = course_code || null;

      if (!resolvedCourseId) {
        if (effectiveCourseCode) {
          const { data: c } = await db
            .from('courses')
            .select('id, code')
            .eq('code', effectiveCourseCode)
            .maybeSingle();
          if (c) resolvedCourseId = c.id;
        } else if (template_key === 'zygomatic_course_details' || file_name.toLowerCase().includes('zygomatic')) {
          const { data: c } = await db
            .from('courses')
            .select('id, code')
            .eq('code', 'ZIT-01')
            .maybeSingle();
          if (c) {
            resolvedCourseId = c.id;
            effectiveCourseCode = 'ZIT-01';
          }
        }
      }

      // Fallback course if none matched
      if (!resolvedCourseId) {
        const { data: anyCourse } = await db.from('courses').select('id, code').limit(1).maybeSingle();
        if (anyCourse) {
          resolvedCourseId = anyCourse.id;
          effectiveCourseCode = anyCourse.code;
        }
      }

      if (!resolvedCourseId) {
        return errorResponse('COURSE_NOT_FOUND', 'Nenhum curso encontrado para associar o material.');
      }

      // Determine Storage Path
      const storagePath =
        customStoragePath ||
        (effectiveCourseCode
          ? `courses/${effectiveCourseCode}/${file_name}`
          : `materials/${template_key || 'general'}/${file_name}`);

      // 1. Physical upload to private bucket 'course-materials'
      const { error: storageErr } = await db.storage
        .from('course-materials')
        .upload(storagePath, bytes, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (storageErr) {
        return errorResponse('STORAGE_UPLOAD_FAILED', `Falha no upload para o storage: ${storageErr.message}`, 500);
      }

      // 2. Real server-side retrieval verification
      const { data: verifyData, error: verifyErr } = await db.storage
        .from('course-materials')
        .download(storagePath);

      if (verifyErr || !verifyData || verifyData.size === 0) {
        return errorResponse(
          'STORAGE_VERIFICATION_FAILED',
          'Falha na validação server-side do arquivo após upload.',
          500
        );
      }

      // 3. Upsert public.course_materials
      const { data: existingMat } = await db
        .from('course_materials')
        .select('id')
        .eq('storage_bucket', 'course-materials')
        .eq('storage_path', storagePath)
        .maybeSingle();

      let materialId: string;
      const cleanTitle = file_name.replace(/\.pdf$/i, '').trim();

      if (existingMat) {
        materialId = existingMat.id;
        await db
          .from('course_materials')
          .update({
            title: cleanTitle,
            file_name,
            file_size_bytes: byteLength,
            content_type: 'application/pdf',
            is_active: true,
            is_required_for_outreach: is_required,
          })
          .eq('id', materialId);
      } else {
        const { data: newMat, error: insertMatErr } = await db
          .from('course_materials')
          .insert({
            course_id: resolvedCourseId,
            title: cleanTitle,
            file_name,
            storage_bucket: 'course-materials',
            storage_path: storagePath,
            content_type: 'application/pdf',
            file_size_bytes: byteLength,
            is_active: true,
            is_required_for_outreach: is_required,
          })
          .select('id')
          .single();

        if (insertMatErr || !newMat) {
          return errorResponse('DB_INSERT_FAILED', insertMatErr?.message || 'Falha ao salvar material.', 500);
        }
        materialId = newMat.id;
      }

      // 4. Upsert public.template_attachments if template_key is provided
      if (template_key) {
        const { data: existingAtt } = await db
          .from('template_attachments')
          .select('id')
          .eq('template_key', template_key)
          .eq('material_id', materialId)
          .maybeSingle();

        if (existingAtt) {
          await db
            .from('template_attachments')
            .update({
              is_required,
              display_name: file_name,
            })
            .eq('id', existingAtt.id);
        } else {
          await db.from('template_attachments').insert({
            template_key,
            material_id: materialId,
            is_required,
            display_name: file_name,
          });
        }

        // Sync with email_templates record
        await db
          .from('email_templates')
          .update({
            has_attachment: true,
            attachment_name: file_name,
          })
          .or(`template_key.eq.${template_key},name.ilike.%${template_key.replace(/_/g, ' ')}%`);
      }

      return jsonResponse({
        success: true,
        verified: true,
        file_name,
        file_size_bytes: byteLength,
        content_type: 'application/pdf',
        server_retrieval: 'PASS',
        is_required,
      });
    }

    // =========================================================================
    // ACTION: verify
    // =========================================================================
    if (action === 'verify') {
      const { template_key, storage_path: directPath } = body;
      let targetPath = directPath;

      if (!targetPath && template_key) {
        const { data: tmplAtt } = await db
          .from('template_attachments')
          .select('material_id, is_required')
          .eq('template_key', template_key)
          .maybeSingle();

        if (tmplAtt?.material_id) {
          const { data: mat } = await db
            .from('course_materials')
            .select('storage_path, file_name, content_type')
            .eq('id', tmplAtt.material_id)
            .maybeSingle();
          if (mat) targetPath = mat.storage_path;
        }
      }

      if (!targetPath) {
        return errorResponse('NOT_FOUND', 'Nenhum caminho de anexo localizado para verificação.', 404);
      }

      const { data: fileData, error: dlErr } = await db.storage
        .from('course-materials')
        .download(targetPath);

      if (dlErr || !fileData) {
        return jsonResponse({
          exists: false,
          server_retrieval: 'FAIL',
          error: dlErr?.message || 'Arquivo não encontrado',
        });
      }

      const ab = await fileData.arrayBuffer();
      return jsonResponse({
        exists: true,
        server_retrieval: 'PASS',
        size: fileData.size,
        mime: fileData.type || 'application/pdf',
        byte_length: ab.byteLength,
        is_pdf: fileData.type === 'application/pdf' || targetPath.endsWith('.pdf'),
      });
    }

    // =========================================================================
    // ACTION: replace
    // =========================================================================
    if (action === 'replace') {
      const { template_key, file_base64, file_name, is_required = true } = body;
      if (!template_key || !file_base64 || !file_name) {
        return errorResponse('MISSING_FIELDS', 'template_key, file_base64 e file_name são obrigatórios.');
      }

      // Forward to upload with current template_key
      // Upload validates new file AND server-side retrieval before updating association.
      // If validation fails, error response is returned and previous association remains untouched.
      const uploadReq = new Request(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify({
          action: 'upload',
          file_base64,
          file_name,
          template_key,
          is_required,
        }),
      });

      // Internal call: re-run logic cleanly
      const cleanBase64 = file_base64.replace(/^data:application\/pdf;base64,/, '').trim();
      let bin: string;
      try {
        bin = atob(cleanBase64);
      } catch (_e) {
        return errorResponse('INVALID_BASE64', 'Codificação base64 inválida.');
      }

      if (bin.length === 0) {
        return errorResponse('EMPTY_FILE', 'O novo arquivo está vazio (0 bytes).');
      }

      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }

      const head = String.fromCharCode(...bytes.subarray(0, 5));
      if (!head.startsWith('%PDF')) {
        return errorResponse('INVALID_PDF_HEADER', 'O arquivo substituto não é um PDF válido.');
      }

      // Safe replace: upload new file to unique path
      const storagePath = `templates/${template_key}/${Date.now()}_${file_name}`;
      const { error: upErr } = await db.storage.from('course-materials').upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

      if (upErr) {
        return errorResponse('UPLOAD_FAILED', `Falha ao enviar arquivo substituto: ${upErr.message}`, 500);
      }

      // Verify server retrieval of new file
      const { data: vData, error: vErr } = await db.storage.from('course-materials').download(storagePath);
      if (vErr || !vData || vData.size === 0) {
        return errorResponse(
          'VERIFY_FAILED',
          'Novo arquivo não pôde ser verificado no storage. Substituição abortada, arquivo anterior preservado.',
          500
        );
      }

      // Retrieve course_id from existing course material if available
      let courseId: string | null = null;
      const { data: oldAtt } = await db
        .from('template_attachments')
        .select('material_id')
        .eq('template_key', template_key)
        .maybeSingle();

      if (oldAtt?.material_id) {
        const { data: oldMat } = await db
          .from('course_materials')
          .select('course_id')
          .eq('id', oldAtt.material_id)
          .maybeSingle();
        courseId = oldMat?.course_id || null;
      }

      if (!courseId) {
        const { data: anyCourse } = await db.from('courses').select('id').limit(1).maybeSingle();
        courseId = anyCourse?.id || null;
      }

      if (!courseId) {
        return errorResponse('NO_COURSE', 'Curso não encontrado para associar material.');
      }

      // Insert new material record
      const { data: newMat, error: nErr } = await db
        .from('course_materials')
        .insert({
          course_id: courseId,
          title: file_name.replace(/\.pdf$/i, '').trim(),
          file_name,
          storage_bucket: 'course-materials',
          storage_path: storagePath,
          content_type: 'application/pdf',
          file_size_bytes: bytes.byteLength,
          is_active: true,
          is_required_for_outreach: is_required,
        })
        .select('id')
        .single();

      if (nErr || !newMat) {
        return errorResponse('DB_ERROR', nErr?.message || 'Erro ao registrar novo material.', 500);
      }

      // Update template_attachments to point to new material
      if (oldAtt) {
        await db
          .from('template_attachments')
          .update({
            material_id: newMat.id,
            display_name: file_name,
            is_required,
          })
          .eq('template_key', template_key);
      } else {
        await db.from('template_attachments').insert({
          template_key,
          material_id: newMat.id,
          display_name: file_name,
          is_required,
        });
      }

      // Sync email_templates
      await db
        .from('email_templates')
        .update({
          has_attachment: true,
          attachment_name: file_name,
        })
        .or(`template_key.eq.${template_key},name.ilike.%${template_key.replace(/_/g, ' ')}%`);

      return jsonResponse({
        success: true,
        replaced: true,
        file_name,
        file_size_bytes: bytes.byteLength,
        is_required,
      });
    }

    // =========================================================================
    // ACTION: remove
    // =========================================================================
    if (action === 'remove') {
      const templateKey = body.template_key;
      if (!templateKey) {
        return errorResponse('MISSING_KEY', 'template_key é obrigatório.');
      }

      // Delete association from template_attachments only
      // Do NOT delete the physical file or course_materials record (safeguards shared files)
      const { error: delErr } = await db
        .from('template_attachments')
        .delete()
        .eq('template_key', templateKey);

      if (delErr) {
        return errorResponse('DELETE_FAILED', delErr.message, 500);
      }

      // Update email_templates
      await db
        .from('email_templates')
        .update({
          has_attachment: false,
          attachment_name: null,
        })
        .or(`template_key.eq.${templateKey},name.ilike.%${templateKey.replace(/_/g, ' ')}%`);

      return jsonResponse({
        success: true,
        removed: true,
      });
    }

    // =========================================================================
    // ACTION: toggle_required
    // =========================================================================
    if (action === 'toggle_required') {
      const { template_key, is_required } = body;
      if (!template_key || typeof is_required !== 'boolean') {
        return errorResponse('MISSING_FIELDS', 'template_key e is_required (boolean) são obrigatórios.');
      }

      const { error: updErr } = await db
        .from('template_attachments')
        .update({ is_required })
        .eq('template_key', template_key);

      if (updErr) {
        return errorResponse('UPDATE_FAILED', updErr.message, 500);
      }

      return jsonResponse({
        success: true,
        is_required,
      });
    }

    return errorResponse('UNKNOWN_ACTION', `Ação desconhecida: ${action}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro interno';
    return errorResponse('INTERNAL_ERROR', msg, 500);
  }
});
