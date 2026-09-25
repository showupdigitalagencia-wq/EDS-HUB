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
  const INTERNAL_ADMIN_SECRET = 'eds_internal_course_materials_mgmt_2026';

  let isAuthorized = false;
  let callerId = 'anonymous';

  if (adminKey && adminKey === INTERNAL_ADMIN_SECRET) {
    isAuthorized = true;
    callerId = 'admin_internal';
  } else if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === INTERNAL_ADMIN_SECRET) {
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
          .maybeSingle();

        if (existingAtt) {
          await db
            .from('template_attachments')
            .update({
              material_id: materialId,
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

    const body = await req.json();
    const action = body.action || 'get';

    // =========================================================================
    // ACTION: get_template_attachment
    // =========================================================================
    if (action === 'get') {
      const templateKey = body.template_key;
      if (!templateKey) {
        return errorResponse('MISSING_TEMPLATE_KEY', 'Chave do template é obrigatória.');
      }

      const { data: attachment, error: attErr } = await db
        .from('template_attachments')
        .select('id, is_required, display_name, material_id, created_at')
        .eq('template_key', templateKey)
        .maybeSingle();

      if (attErr) {
        return errorResponse('DB_ERROR', attErr.message, 500);
      }

      if (!attachment || !attachment.material_id) {
        return jsonResponse({ has_attachment: false, attachment: null });
      }

      const { data: material, error: matErr } = await db
        .from('course_materials')
        .select('id, title, file_name, file_size_bytes, content_type, is_active, is_required_for_outreach')
        .eq('id', attachment.material_id)
        .maybeSingle();

      if (matErr || !material) {
        return jsonResponse({ has_attachment: false, attachment: null });
      }

      // Return clean, user-friendly presentation (no UUIDs, buckets, private storage paths)
      return jsonResponse({
        has_attachment: true,
        attachment: {
          file_name: material.file_name,
          display_name: attachment.display_name || material.file_name,
          is_required: Boolean(attachment.is_required),
          file_size_bytes: material.file_size_bytes || 0,
          is_pdf: true,
        },
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
          .maybeSingle();

        if (existingAtt) {
          await db
            .from('template_attachments')
            .update({
              material_id: materialId,
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
