// =============================================================================
// Supabase Shared Module: internal-enrollment-notifier.ts
// =============================================================================
// Internal email notifications for the EDS Admissions/Admin Team.
// Strictly NEVER sends to the applicant.
// Supports two canonical events:
// 1. incomplete_registration: "Tentativa de matrícula — [Lead Name] — [Course]"
// 2. completed_registration:  "Matrícula concluída — [Lead Name] — [Course]"
// Enforces strict per-event idempotency and prevents autosave email spam.
// =============================================================================

import { sendEmail } from './resend-adapter.ts';

export interface InternalNotificationPayload {
  event_type: 'incomplete_registration' | 'completed_registration';
  idempotency_key: string;
  lead_id?: string | null;
  attempt_id?: string | null;
  submission_id?: string | null;
  external_attempt_id?: string | null;
  raw_payload?: Record<string, unknown>;
  lead_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  course_code?: string | null;
  course_name?: string | null;
  turma_name?: string | null;
  source_page?: string | null;
  status?: string | null;
  missing_reason?: string | null;
  error_code?: string | null;
  documents?: Array<{
    document_type: string;
    original_filename: string;
    storage_path?: string;
    size_bytes?: number;
  }>;
}

export interface InternalNotificationResult {
  success: boolean;
  duplicate?: boolean;
  already_sent?: boolean;
  sent?: number;
  skipped?: boolean;
  message_id?: string | null;
  recipients: string[];
  subject: string;
  error?: string;
}

function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDatePtBr(isoString?: string | null): string {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return new Date().toISOString();
  }
}

function getEnv(key: string): string | undefined {
  try {
    if (typeof Deno !== 'undefined' && Deno?.env?.get) {
      return Deno.env.get(key);
    }
  } catch (_e) {
    // ignore
  }
  try {
    if (typeof process !== 'undefined' && process?.env) {
      return process.env[key];
    }
  } catch (_e) {
    // ignore
  }
  return undefined;
}

/**
 * Resolves verified administrative recipients.
 * Never includes the applicant or external addresses.
 */
export async function resolveInternalRecipients(db: any): Promise<string[]> {
  // 1. Check explicit override in environment
  const envOverride = getEnv('INTERNAL_ENROLLMENT_NOTIFICATIONS_TO');
  if (envOverride && envOverride.trim()) {
    const parsed = envOverride
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'));
    if (parsed.length > 0) {
      return Array.from(new Set(parsed));
    }
  }

  // 2. Query active admins from public.app_user
  try {
    const { data: users } = await db
      .from('app_user')
      .select('email')
      .eq('is_active', true);

    const emails = (users || [])
      .map((u: { email?: string }) => (u.email || '').trim().toLowerCase())
      .filter((e: string) => e.includes('@'));

    if (emails.length > 0) {
      return Array.from(new Set(emails));
    }
  } catch (err) {
    console.warn('[internal-enrollment-notifier] app_user query notice:', err);
  }

  // 3. Fallback to canonical internal operations mailbox
  return ['info@expdentalsolutions.com'];
}

const CANONICAL_COURSE_NAMES: Record<string, string> = {
  'IDIT-01': 'Intensive Dental Implant Training',
  'ET-01': 'Endodontics Training',
  'WTT-01': 'Wisdom Teeth Training',
  'ZIT-01': 'Zygomatic Implant Training',
  'ADIE-01': 'Advanced Dental Implant Experience',
  'PST-01': 'Periodontal Surgery Training',
  'AIRE-01': 'Advanced Implant Rehabilitation Experience',
};

export function resolveCanonicalCourseName(rawCourseOrCode?: string | null): string {
  if (!rawCourseOrCode || !rawCourseOrCode.trim()) return 'Curso não especificado';
  const trimmed = rawCourseOrCode.trim();
  const upper = trimmed.toUpperCase();
  if (CANONICAL_COURSE_NAMES[upper]) return CANONICAL_COURSE_NAMES[upper];

  const lower = trimmed.toLowerCase();
  if (trimmed.length <= 15) {
    if (lower === 'intensive' || lower.includes('idit')) return 'Intensive Dental Implant Training';
    if (lower === 'wisdom' || lower.includes('wtt')) return 'Wisdom Teeth Training';
    if (lower === 'zygomatic' || lower.includes('zit') || lower.includes('zygoma')) return 'Zygomatic Implant Training';
    if (lower === 'endodontics' || lower.includes('endo') || lower.includes('et-01')) return 'Endodontics Training';
    if (lower.includes('adie')) return 'Advanced Dental Implant Experience';
    if (lower.includes('pst')) return 'Periodontal Surgery Training';
  } else {
    if (lower === 'idit-01') return 'Intensive Dental Implant Training';
    if (lower === 'adie-01') return 'Advanced Dental Implant Experience';
    if (lower === 'wtt-01') return 'Wisdom Teeth Training';
    if (lower === 'zit-01') return 'Zygomatic Implant Training';
    if (lower === 'et-01') return 'Endodontics Training';
    if (lower === 'pst-01') return 'Periodontal Surgery Training';
  }
  return trimmed;
}

/**
 * Builds HTML and plain-text body for Incomplete Registration attempt.
 */
export function buildIncompleteAttemptEmail(
  payload: InternalNotificationPayload,
  leadUrl: string
): { subject: string; html: string; text: string } {
  const raw = payload.raw_payload || {};
  const fullName = payload.lead_name ||
    raw.name ||
    raw.full_name ||
    [payload.first_name || raw.first_name, payload.last_name || raw.last_name].filter(Boolean).join(' ') ||
    'Candidato sem nome';

  const rawCourseSignal =
    (payload.course_name as string | undefined) ||
    (payload.course_code as string | undefined) ||
    (typeof raw.course === 'string' ? raw.course : undefined) ||
    (typeof raw.course_name === 'string' ? raw.course_name : undefined) ||
    (typeof raw.course_code === 'string' ? raw.course_code : undefined) ||
    (typeof raw.course_interest === 'string' ? raw.course_interest : undefined) ||
    null;
  const courseTitle = resolveCanonicalCourseName(rawCourseSignal);
  const email = payload.email || raw.email || 'Não informado';
  const phone = payload.phone || raw.phone || 'Não informado';
  const turma = payload.turma_name || raw.turma || raw.session_title || raw.course_session || 'Não informada / automática';
  const specialty = raw.specialty || raw.especialidade || 'Não informada';
  const experience = raw.years_in_practice || raw.anos_experiencia || 'Não informado';
  const surgicalExp = raw.surgical_experience || raw.experiencia_cirurgica || 'Não informada';
  const agd = raw.agd_number || raw.agd || 'Não informado';
  const heardFrom = raw.heard_from || raw.onde_ouviu || 'Não informado';
  const referral = raw.referral_name || raw.indicacao || 'Nenhuma';
  const promo = raw.promo_code || raw.cupom || 'Nenhum';
  const country = raw.country || raw.pais || 'Não informado';
  const cityState = [raw.city || raw.cidade, raw.state || raw.estado].filter(Boolean).join(', ') || 'Não informado';
  const sourcePage = payload.source_page || raw.source_page || 'https://www.expdentalsolutions.com/register';
  const attemptTimestamp = formatDatePtBr(raw.submitted_at as string || new Date().toISOString());
  const statusDisplay = payload.status === 'submission_failed' ? 'Falha no envio do site' : 'Inscrição iniciada (Não concluída)';

  // Factual missing reasons (do not invent)
  const factualReasons: string[] = [];
  if (payload.missing_reason) factualReasons.push(String(payload.missing_reason));
  if (payload.error_code) factualReasons.push(`Código de erro reportado: ${payload.error_code}`);
  if (raw.missing_fields && Array.isArray(raw.missing_fields)) {
    factualReasons.push(`Campos pendentes: ${raw.missing_fields.join(', ')}`);
  }
  const missingReasonText = factualReasons.length > 0 ? factualReasons.join(' | ') : 'Formulário abandonado antes da finalização';

  const utms = [
    raw.utm_source ? `Source: ${raw.utm_source}` : null,
    raw.utm_medium ? `Medium: ${raw.utm_medium}` : null,
    raw.utm_campaign ? `Campaign: ${raw.utm_campaign}` : null,
    raw.utm_term ? `Term: ${raw.utm_term}` : null,
    raw.utm_content ? `Content: ${raw.utm_content}` : null,
  ].filter(Boolean).join(' | ') || 'Nenhum UTM registrado';

  const subject = `Tentativa de matrícula — ${fullName} — ${courseTitle}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1F2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
    <!-- Header -->
    <tr>
      <td style="background-color: #0B132B; padding: 24px 32px; border-bottom: 3px solid #F59E0B;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.02em;">Expert Dental Solutions</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.05em;">Notificação Interna de Admissões</p>
            </td>
            <td align="right">
              <span style="display: inline-block; padding: 6px 12px; background-color: #FEF3C7; color: #92400E; font-size: 12px; font-weight: 700; border-radius: 9999px; border: 1px solid #FCD34D;">Não concluída</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Alert Box -->
    <tr>
      <td style="padding: 24px 32px 16px 32px;">
        <div style="background-color: #FFFBEB; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 4px;">
          <h2 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: #92400E;">Nova tentativa de matrícula detectada</h2>
          <p style="margin: 0; font-size: 14px; color: #78350F; line-height: 1.5;">
            Um visitante iniciou o preenchimento da inscrição no site mas não concluiu o processo. Verifique os dados abaixo para contato proativo.
          </p>
        </div>
      </td>
    </tr>

    <!-- Lead Info Cards -->
    <tr>
      <td style="padding: 0 32px 24px 32px;">
        <!-- Seção: Dados Pessoais & Contato -->
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Dados Pessoais & Contato</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 14px; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td width="35%" style="color: #6B7280; font-weight: 500;">Nome Completo:</td>
              <td style="color: #111827; font-weight: 600;">${escapeHtml(String(fullName))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Email:</td>
              <td style="color: #111827;">${escapeHtml(String(email))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Telefone:</td>
              <td style="color: #111827;">${escapeHtml(String(phone))}</td>
            </tr>
            ${raw.emergency_phone ? `
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Tel. Emergência:</td>
              <td style="color: #111827;">${escapeHtml(String(raw.emergency_phone))}</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">País / Localização:</td>
              <td style="color: #111827;">${escapeHtml(String(country))} ${cityState !== 'Não informado' ? `(${escapeHtml(cityState)})` : ''}</td>
            </tr>
          </table>
        </div>

        <!-- Seção: Curso de Interesse -->
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Curso Selecionado</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 14px; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td width="35%" style="color: #6B7280; font-weight: 500;">Curso:</td>
              <td style="color: #1D4ED8; font-weight: 700;">${escapeHtml(String(courseTitle))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Turma / Sessão:</td>
              <td style="color: #111827;">${escapeHtml(String(turma))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Status da Tentativa:</td>
              <td style="color: #D97706; font-weight: 600;">${escapeHtml(statusDisplay)}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Motivo Factual:</td>
              <td style="color: #4B5563;">${escapeHtml(missingReasonText)}</td>
            </tr>
          </table>
        </div>

        <!-- Seção: Informações Profissionais (quando disponíveis) -->
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Perfil Profissional</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 14px; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td width="35%" style="color: #6B7280; font-weight: 500;">Especialidade:</td>
              <td style="color: #111827;">${escapeHtml(String(specialty))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Tempo de Formado:</td>
              <td style="color: #111827;">${escapeHtml(String(experience))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Exp. Cirúrgica:</td>
              <td style="color: #111827;">${escapeHtml(String(surgicalExp))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Registro AGD/PACE:</td>
              <td style="color: #111827;">${escapeHtml(String(agd))}</td>
            </tr>
          </table>
        </div>

        <!-- Seção: Rastreamento & Marketing -->
        <div style="margin-bottom: 24px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Rastreamento & Origem</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; border-collapse: collapse; background-color: #F9FAFB; border-radius: 6px;">
            <tr>
              <td width="35%" style="color: #6B7280;">Horário da Tentativa:</td>
              <td style="color: #111827;">${escapeHtml(attemptTimestamp)}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Página do Site:</td>
              <td style="color: #111827; word-break: break-all;">${escapeHtml(String(sourcePage))}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Onde nos conheceu:</td>
              <td style="color: #111827;">${escapeHtml(String(heardFrom))} ${referral !== 'Nenhuma' ? `(Indicação: ${escapeHtml(String(referral))})` : ''}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Cupom de Desconto:</td>
              <td style="color: #111827;">${escapeHtml(String(promo))}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Parâmetros UTM:</td>
              <td style="color: #4B5563;">${escapeHtml(utms)}</td>
            </tr>
          </table>
        </div>

        <!-- CTA Principal -->
        <div style="text-align: center; margin-top: 28px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
          <a href="${escapeHtml(leadUrl)}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: #0B132B; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 700; border-radius: 6px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">Abrir lead no EDS HUB &rarr;</a>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #9CA3AF;">Link seguro para administradores autenticados do EDS HUB.</p>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #F9FAFB; padding: 16px 32px; text-align: center; font-size: 12px; color: #9CA3AF; border-top: 1px solid #E5E7EB;">
        Esta é uma notificação interna automática do sistema EDS HUB. Não responda a este e-mail.
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `TENTATIVA DE MATRÍCULA — NÃO CONCLUÍDA
========================================
Lead: ${fullName}
Curso: ${courseTitle}
Turma: ${turma}
Status: ${statusDisplay}
Motivo factual: ${missingReasonText}

CONTATO:
Email: ${email}
Telefone: ${phone}
Localização: ${country} (${cityState})

PERFIL:
Especialidade: ${specialty}
Experiência: ${experience}
Cirúrgica: ${surgicalExp}
AGD/PACE: ${agd}

MARKETING:
Data/Hora: ${attemptTimestamp}
Origem: ${sourcePage}
UTMs: ${utms}

Abrir lead no EDS HUB: ${leadUrl}
`;

  return { subject, html, text };
}

/**
 * Builds HTML and plain-text body for Completed Registration.
 */
export function buildCompletedRegistrationEmail(
  payload: InternalNotificationPayload,
  leadUrl: string,
  documentsUrl: string
): { subject: string; html: string; text: string } {
  const raw = payload.raw_payload || {};
  const fullName = payload.lead_name ||
    raw.name ||
    raw.full_name ||
    [payload.first_name || raw.first_name, payload.last_name || raw.last_name].filter(Boolean).join(' ') ||
    'Aluno';

  const courseTitle = payload.course_name || payload.course_code || raw.course || raw.course_interest || 'Curso Confirmado';
  const email = payload.email || raw.email || 'Não informado';
  const phone = payload.phone || raw.phone || 'Não informado';
  const turma = payload.turma_name || raw.turma || raw.session_title || raw.course_session || 'Turma selecionada no formulário';
  const specialty = raw.specialty || raw.especialidade || 'Não informada';
  const experience = raw.years_in_practice || raw.anos_experiencia || 'Não informado';
  const surgicalExp = raw.surgical_experience || raw.experiencia_cirurgica || 'Não informada';
  const agd = raw.agd_number || raw.agd || 'Não informado';
  const heardFrom = raw.heard_from || raw.onde_ouviu || 'Não informado';
  const referral = raw.referral_name || raw.indicacao || 'Nenhuma';
  const promo = raw.promo_code || raw.cupom || 'Nenhum';
  const termsAccepted = raw.terms_accepted ? 'Sim (Aceite confirmado no envio)' : 'Sim';
  const completionTimestamp = formatDatePtBr(raw.submitted_at as string || new Date().toISOString());

  const docs = payload.documents || [];
  let docsHtml = '';
  if (docs.length > 0) {
    docsHtml = `<ul style="margin: 8px 0; padding-left: 20px; color: #111827;">` +
      docs.map((d) => `<li><strong>${escapeHtml(d.document_type)}:</strong> ${escapeHtml(d.original_filename)}</li>`).join('') +
      `</ul>`;
  } else {
    docsHtml = `<p style="margin: 8px 0; font-size: 14px; color: #4B5563;">Documentos enviados via formulário (Passaporte / Licença Odontológica). Acesse a área segura de documentos no EDS HUB.</p>`;
  }

  const utms = [
    raw.utm_source ? `Source: ${raw.utm_source}` : null,
    raw.utm_medium ? `Medium: ${raw.utm_medium}` : null,
    raw.utm_campaign ? `Campaign: ${raw.utm_campaign}` : null,
    raw.utm_term ? `Term: ${raw.utm_term}` : null,
    raw.utm_content ? `Content: ${raw.utm_content}` : null,
  ].filter(Boolean).join(' | ') || 'Nenhum UTM registrado';

  const subject = `Matrícula concluída — ${fullName} — ${courseTitle}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1F2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
    <!-- Header -->
    <tr>
      <td style="background-color: #0B132B; padding: 24px 32px; border-bottom: 3px solid #10B981;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.02em;">Expert Dental Solutions</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.05em;">Notificação Oficial de Matrícula</p>
            </td>
            <td align="right">
              <span style="display: inline-block; padding: 6px 14px; background-color: #D1FAE5; color: #065F46; font-size: 12px; font-weight: 700; border-radius: 9999px; border: 1px solid #6EE7B7;">Concluída</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Success Confirmation Box -->
    <tr>
      <td style="padding: 24px 32px 16px 32px;">
        <div style="background-color: #ECFDF5; border-left: 4px solid #10B981; padding: 16px; border-radius: 4px;">
          <h2 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: #065F46;">Ficha de Matrícula Finalizada com Sucesso</h2>
          <p style="margin: 0; font-size: 14px; color: #047857; line-height: 1.5;">
            O aluno completou todas as etapas obrigatórias do formulário de inscrição no site oficial. Registro consolidado no CRM.
          </p>
        </div>
      </td>
    </tr>

    <!-- Completed Application Details -->
    <tr>
      <td style="padding: 0 32px 24px 32px;">
        <!-- Seção: Dados Pessoais & Contato -->
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Dados do Aluno</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 14px; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td width="35%" style="color: #6B7280; font-weight: 500;">Nome Completo:</td>
              <td style="color: #111827; font-weight: 700;">${escapeHtml(String(fullName))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Email:</td>
              <td style="color: #111827;">${escapeHtml(String(email))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Telefone:</td>
              <td style="color: #111827;">${escapeHtml(String(phone))}</td>
            </tr>
          </table>
        </div>

        <!-- Seção: Curso e Turma -->
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Curso & Turma</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 14px; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td width="35%" style="color: #6B7280; font-weight: 500;">Curso Selecionado:</td>
              <td style="color: #065F46; font-weight: 700;">${escapeHtml(String(courseTitle))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Turma / Datas:</td>
              <td style="color: #111827;">${escapeHtml(String(turma))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Termos Aceitos:</td>
              <td style="color: #10B981; font-weight: 600;">${escapeHtml(termsAccepted)}</td>
            </tr>
          </table>
        </div>

        <!-- Seção: Perfil Profissional -->
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Informações Profissionais</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 14px; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td width="35%" style="color: #6B7280; font-weight: 500;">Especialidade:</td>
              <td style="color: #111827;">${escapeHtml(String(specialty))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Anos de Prática:</td>
              <td style="color: #111827;">${escapeHtml(String(experience))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Exp. Cirúrgica:</td>
              <td style="color: #111827;">${escapeHtml(String(surgicalExp))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="color: #6B7280; font-weight: 500;">Número AGD/PACE:</td>
              <td style="color: #111827;">${escapeHtml(String(agd))}</td>
            </tr>
          </table>
        </div>

        <!-- Seção: Documentos Anexados (Segurança) -->
        <div style="margin-bottom: 20px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px;">
          <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; color: #334155; text-transform: uppercase; letter-spacing: 0.05em;">Documentos & Anexos de Matrícula</h3>
          ${docsHtml}
          <div style="margin-top: 12px;">
            <a href="${escapeHtml(documentsUrl)}" target="_blank" style="display: inline-block; padding: 8px 16px; background-color: #1E293B; color: #FFFFFF; text-decoration: none; font-size: 13px; font-weight: 600; border-radius: 4px;">Acessar Documentos Seguros &rarr;</a>
          </div>
          <p style="margin: 8px 0 0 0; font-size: 11px; color: #64748B;">Documentos de identificação e licenças profissionais são protegidos por acesso autenticado no EDS HUB.</p>
        </div>

        <!-- Seção: Origem e Marketing -->
        <div style="margin-bottom: 24px;">
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Origem & Atribuição</h3>
          <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; border-collapse: collapse; background-color: #F9FAFB; border-radius: 6px;">
            <tr>
              <td width="35%" style="color: #6B7280;">Data de Conclusão:</td>
              <td style="color: #111827;">${escapeHtml(completionTimestamp)}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Onde conheceu:</td>
              <td style="color: #111827;">${escapeHtml(String(heardFrom))} ${referral !== 'Nenhuma' ? `(Indicação: ${escapeHtml(String(referral))})` : ''}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Cupom Aplicado:</td>
              <td style="color: #111827;">${escapeHtml(String(promo))}</td>
            </tr>
            <tr>
              <td style="color: #6B7280;">Campanha / UTMs:</td>
              <td style="color: #4B5563;">${escapeHtml(utms)}</td>
            </tr>
          </table>
        </div>

        <!-- CTA Principal -->
        <div style="text-align: center; margin-top: 28px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
          <a href="${escapeHtml(leadUrl)}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: #065F46; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 700; border-radius: 6px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">Abrir Matrícula no EDS HUB &rarr;</a>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #9CA3AF;">Acesso restrito para administradores autenticados.</p>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #F9FAFB; padding: 16px 32px; text-align: center; font-size: 12px; color: #9CA3AF; border-top: 1px solid #E5E7EB;">
        Esta é uma notificação interna oficial do sistema EDS HUB. Não envie este e-mail ao aluno.
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `MATRÍCULA CONCLUÍDA — EXPERT DENTAL SOLUTIONS
=============================================
Aluno: ${fullName}
Curso: ${courseTitle}
Turma: ${turma}
Status: Concluída
Termos Aceitos: ${termsAccepted}
Concluído em: ${completionTimestamp}

CONTATO:
Email: ${email}
Telefone: ${phone}

PERFIL PROFISSIONAL:
Especialidade: ${specialty}
Anos de Prática: ${experience}
Cirúrgica: ${surgicalExp}
AGD/PACE: ${agd}

MARKETING & ORIGEM:
Onde conheceu: ${heardFrom} (Indicação: ${referral})
Cupom: ${promo}
UTMs: ${utms}

Acessar Documentos Seguros: ${documentsUrl}
Abrir Registro Completo no EDS HUB: ${leadUrl}
`;

  return { subject, html, text };
}

/**
 * Queues or updates an incomplete registration attempt in internal_notification_logs.
 * - If no record exists: inserts a row with status = 'pending', last_activity_at = now(), scheduled_for = now() + 10m.
 * - If record exists with status = 'pending': merges new fields into payload_snapshot, resets last_activity_at = now() and scheduled_for = now() + 10m.
 * - If record exists with status = 'sent' or 'skipped': preserves final status, merges payload_snapshot for audit without re-sending.
 */
export async function queueOrUpdateIncompleteEnrollmentNotification(
  db: any,
  payload: InternalNotificationPayload,
  inactivityMinutes = 10
): Promise<{ success: boolean; duplicate?: boolean; status: string; scheduled_for?: string }> {
  const { idempotency_key, lead_id, attempt_id, raw_payload } = payload;
  if (!idempotency_key) {
    return { success: false, status: 'error' };
  }

  const now = new Date();
  const scheduledFor = new Date(now.getTime() + inactivityMinutes * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // 1. Check existing record
  const { data: existingLog } = await db
    .from('internal_notification_logs')
    .select('id, status, payload_snapshot')
    .eq('idempotency_key', idempotency_key)
    .maybeSingle();

  if (existingLog) {
    // Merge new non-empty fields into snapshot
    const mergedSnapshot = {
      ...(existingLog.payload_snapshot || {}),
      ...(raw_payload || {}),
    };

    if (existingLog.status === 'pending') {
      // User is continuing to type! Push scheduled_for 10 minutes forward
      await db
        .from('internal_notification_logs')
        .update({
          payload_snapshot: mergedSnapshot,
          last_activity_at: nowIso,
          scheduled_for: scheduledFor,
        })
        .eq('id', existingLog.id);

      return { success: true, duplicate: false, status: 'pending', scheduled_for: scheduledFor };
    }

    // Already 'sent' or 'skipped' -> update snapshot for audit, but do not re-send
    await db
      .from('internal_notification_logs')
      .update({
        payload_snapshot: mergedSnapshot,
        last_activity_at: nowIso,
      })
      .eq('id', existingLog.id);

    return { success: true, duplicate: true, status: existingLog.status };
  }

  // 2. Insert new pending row
  const recipients = await resolveInternalRecipients(db);
  const appBaseUrl = getEnv('EDS_HUB_APP_URL') || 'https://hub.expdentalsolutions.com';
  const leadUrl = lead_id ? `${appBaseUrl}/leads/${lead_id}` : appBaseUrl;
  const emailData = buildIncompleteAttemptEmail(payload, leadUrl);

  const newRecord = {
    event_type: 'incomplete_registration',
    idempotency_key,
    lead_id: lead_id || null,
    attempt_id: attempt_id || null,
    recipient_emails: recipients,
    subject: emailData.subject,
    status: 'pending',
    payload_snapshot: raw_payload || {},
    last_activity_at: nowIso,
    scheduled_for: scheduledFor,
    created_at: nowIso,
  };

  const { error: insertErr } = await db
    .from('internal_notification_logs')
    .insert(newRecord);

  if (insertErr) {
    console.warn('[internal-enrollment-notifier] Queue insert notice:', insertErr);
  }

  return { success: true, duplicate: false, status: 'pending', scheduled_for: scheduledFor };
}

/**
 * Sweeps and processes pending incomplete registration attempts whose inactivity
 * window has elapsed without completion. Dispatches ONE internal email per attempt
 * using the LATEST stored payload snapshot.
 */
export async function processPendingAbandonedEnrollments(
  db: any,
  _options?: { inactivityMinutes?: number }
): Promise<{ success: boolean; processed: number; sent: number; skipped: number }> {
  const nowIso = new Date().toISOString();
  let processed = 0;
  let sent = 0;
  let skipped = 0;

  // Query pending rows that are past their scheduled_for threshold
  const { data: pendingRows, error: queryErr } = await db
    .from('internal_notification_logs')
    .select('*')
    .eq('event_type', 'incomplete_registration')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .limit(50);

  if (queryErr || !pendingRows || pendingRows.length === 0) {
    return { success: true, processed: 0, sent: 0, skipped: 0 };
  }

  const appBaseUrl = getEnv('EDS_HUB_APP_URL') || 'https://hub.expdentalsolutions.com';
  const fromEmail = getEnv('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
  const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;

  for (const row of pendingRows) {
    processed++;

    // FINAL PRE-SEND SAFETY CHECK:
    // Determine whether a successful website registration already completed
    // via attempt ID, lead ID, email, or enrollment join.
    let isCompleted = false;

    // 1. Check attempt record status
    if (row.attempt_id) {
      const { data: attempt } = await db
        .from('incomplete_enrollments')
        .select('status, resolved_at, external_attempt_id')
        .eq('id', row.attempt_id)
        .maybeSingle();

      if (attempt && (attempt.status === 'completed' || attempt.status === 'recovered' || attempt.resolved_at)) {
        isCompleted = true;
      }
    }

    const extAttemptId =
      row.payload_snapshot?.external_attempt_id ||
      (row.idempotency_key?.startsWith('internal_email:attempt:')
        ? row.idempotency_key.replace('internal_email:attempt:', '')
        : null);

    // 2. Check form_submissions by attempt ID
    if (!isCompleted && extAttemptId) {
      try {
        let qSub = db.from('form_submissions').select('id');
        if (typeof qSub?.or === 'function') {
          qSub = qSub.or(`idempotency_key.eq.comp_${extAttemptId},submitted_data->>external_attempt_id.eq.${extAttemptId}`);
        } else if (typeof qSub?.eq === 'function') {
          qSub = qSub.eq('idempotency_key', `comp_${extAttemptId}`);
        }
        if (typeof qSub?.eq === 'function') {
          qSub = qSub.eq('form_name', 'website-register').eq('processing_status', 'processed');
        }
        if (typeof qSub?.limit === 'function') {
          qSub = qSub.limit(1);
        }
        const { data: subAttempt } = await qSub;
        if (subAttempt && subAttempt.length > 0) {
          isCompleted = true;
        }
      } catch (_subErr) {
        // mock DB fallback
      }
    }

    // 3. Check form_submissions by lead ID
    if (!isCompleted && row.lead_id) {
      try {
        let qLead = db.from('form_submissions').select('id');
        if (typeof qLead?.eq === 'function') qLead = qLead.eq('lead_id', row.lead_id);
        if (typeof qLead?.eq === 'function') qLead = qLead.eq('form_name', 'website-register');
        if (typeof qLead?.eq === 'function') qLead = qLead.eq('processing_status', 'processed');
        if (typeof qLead?.limit === 'function') qLead = qLead.limit(1);
        const { data: subLead } = await qLead;
        if (subLead && subLead.length > 0) {
          isCompleted = true;
        }
      } catch (_leadErr) {
        // mock DB fallback
      }
    }

    // 4. Check form_submissions by email
    const candidateEmail = (row.payload_snapshot?.email || '').trim().toLowerCase();
    if (!isCompleted && candidateEmail) {
      try {
        let qEmail = db.from('form_submissions').select('id');
        if (typeof qEmail?.eq === 'function') qEmail = qEmail.eq('email', candidateEmail);
        if (typeof qEmail?.eq === 'function') qEmail = qEmail.eq('form_name', 'website-register');
        if (typeof qEmail?.eq === 'function') qEmail = qEmail.eq('processing_status', 'processed');
        if (typeof qEmail?.limit === 'function') qEmail = qEmail.limit(1);
        const { data: subEmail } = await qEmail;
        if (subEmail && subEmail.length > 0) {
          isCompleted = true;
        }
      } catch (_emailErr) {
        // mock DB fallback
      }
    }

    // 5. Check enrollments table for active/confirmed enrollment
    if (!isCompleted && row.lead_id) {
      try {
        let qEnr = db.from('enrollments').select('id');
        if (typeof qEnr?.eq === 'function') qEnr = qEnr.eq('lead_id', row.lead_id);
        if (typeof qEnr?.limit === 'function') qEnr = qEnr.limit(1);
        const { data: enrLead } = await qEnr;
        if (enrLead && enrLead.length > 0) {
          isCompleted = true;
        }
      } catch (_enrErr) {
        // mock DB fallback
      }
    }

    if (isCompleted) {
      await db
        .from('internal_notification_logs')
        .update({
          status: 'skipped',
          error_message: 'Registration completed prior to abandonment dispatch (verified by final pre-send check)',
        })
        .eq('id', row.id);

      if (row.attempt_id) {
        await db
          .from('incomplete_enrollments')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('id', row.attempt_id);
      }
      skipped++;
      continue;
    }

    // Build the dynamic email using the LATEST captured snapshot
    const leadUrl = row.lead_id ? `${appBaseUrl}/leads/${row.lead_id}` : appBaseUrl;
    const courseCodeVal = (row.payload_snapshot?.course_code || row.payload_snapshot?.code) as string;
    const resolvedCourse = resolveCanonicalCourseName(
      (row.payload_snapshot?.course || row.payload_snapshot?.course_interest || row.payload_snapshot?.course_name || courseCodeVal) as string
    );

    const latestPayload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: row.idempotency_key,
      lead_id: row.lead_id,
      attempt_id: row.attempt_id,
      raw_payload: row.payload_snapshot || {},
      lead_name: (row.payload_snapshot?.name || row.payload_snapshot?.full_name || `${row.payload_snapshot?.first_name || ''} ${row.payload_snapshot?.last_name || ''}`.trim()) as string,
      first_name: row.payload_snapshot?.first_name as string,
      last_name: row.payload_snapshot?.last_name as string,
      email: (row.payload_snapshot?.email) as string,
      phone: (row.payload_snapshot?.phone) as string,
      course_code: courseCodeVal,
      course_name: resolvedCourse,
      source_page: (row.payload_snapshot?.source_page) as string,
      status: 'needs_followup',
    };

    const emailData = buildIncompleteAttemptEmail(latestPayload, leadUrl);
    const recipients = (row.recipient_emails && row.recipient_emails.length > 0)
      ? row.recipient_emails
      : await resolveInternalRecipients(db);

    let hasSuccess = false;
    let primaryMessageId: string | null = null;
    const sendErrors: string[] = [];

    for (const recipient of recipients) {
      // Exclude applicant
      if (latestPayload.email && recipient.toLowerCase().trim() === latestPayload.email.toLowerCase().trim()) {
        continue;
      }

      const res = await sendEmail({
        from: sender,
        to: recipient,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        replyTo: 'info@expdentalsolutions.com',
        idempotencyKey: `${row.idempotency_key}_${recipient}`,
      });

      if (res.success) {
        hasSuccess = true;
        if (!primaryMessageId) primaryMessageId = res.messageId;
      } else {
        sendErrors.push(`${recipient}: ${res.errorMessage || res.errorCode}`);
      }
    }

    const finalStatus = hasSuccess ? 'sent' : 'failed';
    await db
      .from('internal_notification_logs')
      .update({
        status: finalStatus,
        provider_message_id: primaryMessageId,
        error_message: sendErrors.length > 0 ? sendErrors.join('; ').substring(0, 500) : null,
        sent_at: hasSuccess ? new Date().toISOString() : null,
      })
      .eq('id', row.id);

    if (hasSuccess) {
      sent++;
      if (row.lead_id) {
        try {
          await db.from('lead_activities').insert({
            lead_id: row.lead_id,
            activity_type: 'internal_notification_sent',
            actor_type: 'system',
            summary: `Alerta interno de tentativa de matrícula enviado após inatividade para: ${recipients.join(', ')}`,
            metadata: {
              event_type: 'incomplete_registration',
              idempotency_key: row.idempotency_key,
              recipients,
              provider_message_id: primaryMessageId,
            },
          });
        } catch (_actErr) {}
      }
    }
  }

  return { success: true, processed, sent, skipped };
}

/**
 * Main dispatch function for internal enrollment notifications.
 * - completed_registration: skipped (canonically handled by Laravel RegistrationReceivedAdminMail).
 * - incomplete_registration: if options.immediate === true, dispatches immediately;
 *   otherwise queues or updates pending record with 15-minute inactivity window.
 */
export async function sendInternalEnrollmentNotification(
  db: any,
  payload: InternalNotificationPayload,
  options?: { immediate?: boolean; inactivityMinutes?: number }
): Promise<InternalNotificationResult> {
  const { event_type, idempotency_key, lead_id, attempt_id, submission_id } = payload;

  if (!idempotency_key) {
    return {
      success: false,
      recipients: [],
      subject: '',
      error: 'Missing idempotency_key',
    };
  }

  // Guard: Completed registration is canonically dispatched by Laravel RegistrationReceivedAdminMail
  // with physical attachments. EDS HUB CRM explicitly avoids duplicating this notification.
  if (event_type === 'completed_registration') {
    return {
      success: true,
      duplicate: false,
      message_id: null,
      recipients: [],
      subject: 'Skipped: completed registration email is canonically dispatched by Laravel RegistrationReceivedAdminMail',
    };
  }

  // If immediate mode is not requested, use the inactivity lifecycle queue
  if (!options?.immediate) {
    const queueRes = await queueOrUpdateIncompleteEnrollmentNotification(db, payload, options?.inactivityMinutes ?? 15);
    const recipients = await resolveInternalRecipients(db);
    return {
      success: queueRes.success,
      duplicate: queueRes.duplicate,
      recipients: queueRes.status === 'pending' ? recipients : [],
      subject: `Tentativa de matrícula — ${payload.lead_name || 'Lead'} — ${payload.course_name || 'Curso'}`,
    };
  }

  // IMMEDIATE DISPATCH MODE:
  // 1. Idempotency Check in public.internal_notification_logs
  const { data: existingLog } = await db
    .from('internal_notification_logs')
    .select('id, status, provider_message_id, recipient_emails, subject')
    .eq('idempotency_key', idempotency_key)
    .maybeSingle();

  if (existingLog && (existingLog.status === 'sent' || existingLog.status === 'pending')) {
    return {
      success: true,
      duplicate: true,
      message_id: existingLog.provider_message_id,
      recipients: existingLog.recipient_emails || [],
      subject: existingLog.subject || '',
    };
  }

  // 2. Resolve internal recipients
  const recipients = await resolveInternalRecipients(db);
  if (recipients.length === 0) {
    return {
      success: false,
      recipients: [],
      subject: '',
      error: 'No active internal recipients configured',
    };
  }

  // 3. Resolve deep links
  const appBaseUrl = getEnv('EDS_HUB_APP_URL') || 'https://hub.expdentalsolutions.com';
  const leadUrl = lead_id ? `${appBaseUrl}/leads/${lead_id}` : appBaseUrl;

  // 4. Build Subject and Content
  const emailData = buildIncompleteAttemptEmail(payload, leadUrl);
  const fromEmail = getEnv('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
  const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;

  // 5. Reserve idempotency slot in public.internal_notification_logs
  const logRecord = {
    event_type,
    idempotency_key,
    lead_id: lead_id || null,
    attempt_id: attempt_id || null,
    submission_id: submission_id || null,
    recipient_emails: recipients,
    subject: emailData.subject,
    status: 'pending',
    payload_snapshot: payload.raw_payload || {},
    last_activity_at: new Date().toISOString(),
    scheduled_for: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  const { error: reserveErr } = await db
    .from('internal_notification_logs')
    .upsert(logRecord, { onConflict: 'idempotency_key' });

  if (reserveErr) {
    console.error('[internal-enrollment-notifier] Reserve error:', reserveErr);
  }

  // 6. Deliver to each internal administrator
  let primaryMessageId: string | null = null;
  let hasSuccess = false;
  const sendErrors: string[] = [];

  for (const recipient of recipients) {
    // Safety check: NEVER send internal notification to applicant!
    if (payload.email && recipient.toLowerCase().trim() === payload.email.toLowerCase().trim()) {
      console.warn(`[internal-enrollment-notifier] Guard triggered: skipped sending internal email to applicant address: ${recipient}`);
      continue;
    }

    const res = await sendEmail({
      from: sender,
      to: recipient,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      replyTo: 'info@expdentalsolutions.com',
      idempotencyKey: `${idempotency_key}_${recipient}`,
    });

    if (res.success) {
      hasSuccess = true;
      if (!primaryMessageId) primaryMessageId = res.messageId;
    } else {
      sendErrors.push(`${recipient}: ${res.errorMessage || res.errorCode}`);
    }
  }

  // 7. Update internal_notification_logs with outcome
  const finalStatus = hasSuccess ? 'sent' : 'failed';
  await db
    .from('internal_notification_logs')
    .update({
      status: finalStatus,
      provider_message_id: primaryMessageId,
      error_message: sendErrors.length > 0 ? sendErrors.join('; ').substring(0, 500) : null,
      sent_at: hasSuccess ? new Date().toISOString() : null,
    })
    .eq('idempotency_key', idempotency_key);

  // 8. Log internal activity on lead if available
  if (lead_id && hasSuccess) {
    try {
      await db.from('lead_activities').insert({
        lead_id,
        activity_type: 'internal_notification_sent',
        actor_type: 'system',
        summary: `Alerta interno de tentativa de matrícula enviado para: ${recipients.join(', ')}`,
        metadata: {
          event_type,
          idempotency_key,
          recipients,
          provider_message_id: primaryMessageId,
        },
      });
    } catch (_actErr) {
      // non-blocking
    }
  }

  return {
    success: hasSuccess,
    message_id: primaryMessageId,
    recipients,
    subject: emailData.subject,
    error: sendErrors.length > 0 ? sendErrors.join('; ') : undefined,
  };
}

// =============================================================================
// Contact Us Internal Notification Module (Part B)
// =============================================================================

export interface InternalContactNotificationPayload {
  event_type?: 'contact_us';
  submission_id?: string | null;
  lead_id?: string | null;
  idempotency_key: string;
  lead_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  raw_payload?: Record<string, unknown>;
  source_page?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}

export function buildContactUsEmail(
  payload: InternalContactNotificationPayload,
  leadUrl: string
): { subject: string; html: string; text: string } {
  const fullName =
    payload.lead_name ||
    `${payload.first_name || ''} ${payload.last_name || ''}`.trim() ||
    (payload.raw_payload?.name as string) ||
    'Lead';

  const subject = `Novo Contact Us — ${fullName}`;
  const nowPtBr = formatDatePtBr(new Date().toISOString());

  // Dynamic rendering of all safe submitted fields
  const EXCLUDED_KEYS = new Set([
    '_token',
    'csrf',
    'g-recaptcha-response',
    'recaptcha',
    'password',
    'token',
    'formData',
    'raw_form_data',
    'form_data',
    'slug',
    'form_slug',
    'idempotency_key',
    'external_attempt_id',
    '_hp_company',
    'message', // Rendered prominently in its dedicated callout
  ]);

  const raw = payload.raw_payload || {};
  const dynamicFieldRows: Array<{ label: string; value: string }> = [];

  for (const [key, rawVal] of Object.entries(raw)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

    // Format label: replace underscores with spaces and capitalize
    const formattedLabel = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    dynamicFieldRows.push({
      label: formattedLabel,
      value: String(rawVal).trim(),
    });
  }

  const visitorMessage = payload.message || (raw.message as string) || '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); max-width: 600px; width: 100%;">
          <!-- Header -->
          <tr>
            <td style="background-color: #08254f; padding: 24px 32px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                      Expert Dental Solutions
                    </h1>
                    <p style="color: #449bd5; font-size: 13px; font-weight: 600; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 0.5px;">
                      Novo Formulário Fale Conosco (Contact Us)
                    </p>
                  </td>
                  <td align="right">
                    <span style="background-color: rgba(68, 155, 213, 0.2); color: #ffffff; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 9999px; border: 1px solid rgba(68, 155, 213, 0.4);">
                      Website Contact
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Notice Banner -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 32px; border-bottom: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5;">
                Um visitante enviou uma mensagem através do formulário de contato no site oficial.
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 24px 32px;">
              <!-- 1. Dados do Contato -->
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 0 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                1. Dados do Contato
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="margin-bottom: 20px; font-size: 13px;">
                <tr>
                  <td width="35%" style="color: #64748b; font-weight: 600;">Nome Completo:</td>
                  <td width="65%" style="color: #0f172a; font-weight: 700;">${escapeHtml(fullName)}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Email:</td>
                  <td style="color: #0f172a;"><a href="mailto:${escapeHtml(payload.email || '')}" style="color: #0284c7; text-decoration: none;">${escapeHtml(payload.email || 'Não informado')}</a></td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Telefone:</td>
                  <td style="color: #0f172a;">${escapeHtml(payload.phone || 'Não informado')}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Data do Envio:</td>
                  <td style="color: #0f172a;">${escapeHtml(nowPtBr)}</td>
                </tr>
              </table>

              <!-- 2. Mensagem do Visitante -->
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 20px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                2. Mensagem
              </h2>
              <div style="background-color: #f8fafc; border-left: 4px solid #08254f; padding: 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; word-break: break-word; margin-bottom: 20px;">${escapeHtml(visitorMessage || 'Nenhuma mensagem escrita.')}</div>

              <!-- 3. Formulário Enviado (Campos Adicionais) -->
              ${
                dynamicFieldRows.length > 0
                  ? `
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 20px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                3. Formulário Enviado (Campos Adicionais)
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="margin-bottom: 20px; font-size: 13px; background-color: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                ${dynamicFieldRows
                  .map(
                    (row) => `<tr>
                  <td width="40%" style="color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${escapeHtml(row.label)}:</td>
                  <td width="60%" style="color: #0f172a; border-bottom: 1px solid #e2e8f0;">${escapeHtml(row.value)}</td>
                </tr>`
                  )
                  .join('')}
              </table>`
                  : ''
              }

              <!-- 4. Origem e Rastreamento UTM -->
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 20px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                4. Origem / UTMs
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="margin-bottom: 24px; font-size: 13px;">
                <tr>
                  <td width="35%" style="color: #64748b; font-weight: 600;">Canal:</td>
                  <td width="65%" style="color: #0f172a;">Website (Formulário Fale Conosco / Contact Us)</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Página:</td>
                  <td style="color: #0f172a; word-break: break-all;">${escapeHtml(payload.source_page || 'https://www.expdentalsolutions.com/contact')}</td>
                </tr>
                ${payload.utm_source ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Source:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_source)}</td></tr>` : ''}
                ${payload.utm_medium ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Medium:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_medium)}</td></tr>` : ''}
                ${payload.utm_campaign ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Campaign:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_campaign)}</td></tr>` : ''}
                ${payload.utm_term ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Term:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_term)}</td></tr>` : ''}
                ${payload.utm_content ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Content:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_content)}</td></tr>` : ''}
              </table>

              <!-- 5. CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0 12px 0;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(leadUrl)}" target="_blank" style="background-color: #08254f; color: #ffffff; padding: 14px 32px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(8, 37, 79, 0.2);">
                      Abrir lead no EDS HUB &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.4;">
                Este é um alerta operacional interno do EDS HUB gerado automaticamente.<br>
                Não responda diretamente a este e-mail. Utilize os canais oficiais do CRM.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `NOVO CONTACT US RECEBIDO - EDS HUB
-----------------------------------------
Nome: ${fullName}
Email: ${payload.email || 'Não informado'}
Telefone: ${payload.phone || 'Não informado'}
Data: ${nowPtBr}

MENSAGEM:
${visitorMessage || 'Nenhuma mensagem escrita.'}

ORIGEM:
Canal: Website (Contact Us)
Página: ${payload.source_page || 'https://www.expdentalsolutions.com/contact'}
${payload.utm_source ? `UTM Source: ${payload.utm_source}\n` : ''}${payload.utm_medium ? `UTM Medium: ${payload.utm_medium}\n` : ''}${payload.utm_campaign ? `UTM Campaign: ${payload.utm_campaign}\n` : ''}

Abrir no EDS HUB:
${leadUrl}
`;

  return { subject, html, text };
}

export async function sendInternalContactNotification(
  db: any,
  payload: InternalContactNotificationPayload
): Promise<InternalNotificationResult> {
  const { submission_id, lead_id, idempotency_key, raw_payload } = payload;
  const effectiveKey = idempotency_key || `internal_email:contact:${submission_id || Date.now()}`;

  // 1. Idempotency Check
  const { data: existingLog } = await db
    .from('internal_notification_logs')
    .select('id, status, provider_message_id, recipient_emails, subject')
    .eq('idempotency_key', effectiveKey)
    .maybeSingle();

  if (existingLog && existingLog.status === 'sent') {
    return {
      success: true,
      duplicate: true,
      already_sent: true,
      sent: 0,
      message_id: existingLog.provider_message_id,
      recipients: existingLog.recipient_emails || [],
      subject: existingLog.subject || 'Novo Contact Us',
    };
  }

  // 2. Resolve Active Internal EDS Administrators
  const recipients = await resolveInternalRecipients(db);
  if (recipients.length === 0) {
    return {
      success: false,
      recipients: [],
      subject: 'Novo Contact Us',
      error: 'No active internal administrative recipients resolved',
    };
  }

  // 3. Build Email Content
  const appBaseUrl = getEnv('EDS_HUB_APP_URL') || 'https://hub.expdentalsolutions.com';
  const leadUrl = lead_id ? `${appBaseUrl}/leads/${lead_id}` : appBaseUrl;
  const emailData = buildContactUsEmail(payload, leadUrl);

  const nowIso = new Date().toISOString();

  // 4. Log or Update Pending Record
  let logId = existingLog?.id;
  if (!logId) {
    const insCall: any = db
      .from('internal_notification_logs')
      .insert({
        event_type: 'contact_us',
        idempotency_key: effectiveKey,
        lead_id: lead_id || null,
        submission_id: submission_id || null,
        recipient_emails: recipients,
        subject: emailData.subject,
        status: 'pending',
        payload_snapshot: raw_payload || {},
        last_activity_at: nowIso,
        scheduled_for: nowIso,
        created_at: nowIso,
      });

    if (typeof insCall?.select === 'function') {
      const sel = insCall.select('id');
      const insRes = typeof sel?.maybeSingle === 'function' ? await sel.maybeSingle() : await sel;
      if (insRes?.error) {
        console.warn('[sendInternalContactNotification] Log insert warning:', insRes.error);
      }
      logId = insRes?.data?.id;
    } else {
      const insRes = await insCall;
      if (insRes?.error) {
        console.warn('[sendInternalContactNotification] Log insert warning:', insRes.error);
      }
    }
  }

  // 5. Dispatch Email via Resend
  let primaryMessageId: string | null = null;
  const sendErrors: string[] = [];
  const fromEmail = getEnv('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
  const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;

  for (const recipient of recipients) {
    try {
      const result = await sendEmail({
        from: sender,
        to: recipient,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        replyTo: 'info@expdentalsolutions.com',
        idempotencyKey: `${effectiveKey}_${recipient}`,
      });

      if (result.success && result.messageId) {
        if (!primaryMessageId) primaryMessageId = result.messageId;
      } else {
        sendErrors.push(`Failed sending to ${recipient}: ${result.errorMessage || result.errorCode || 'Unknown'}`);
      }
    } catch (sendErr) {
      sendErrors.push(`Error sending to ${recipient}: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
    }
  }

  const hasSuccess = Boolean(primaryMessageId) || (sendErrors.length === 0 && recipients.length > 0);

  // 6. Update Log Record
  await db
    .from('internal_notification_logs')
    .update({
      status: hasSuccess ? 'sent' : 'failed',
      provider_message_id: primaryMessageId,
      error_message: sendErrors.length > 0 ? sendErrors.join('; ') : null,
      sent_at: hasSuccess ? nowIso : null,
    })
    .eq('idempotency_key', effectiveKey);

  // 7. Log Activity on Lead
  if (lead_id && hasSuccess) {
    try {
      await db.from('lead_activities').insert({
        lead_id,
        activity_type: 'contact_us_internal_email',
        actor_type: 'system',
        summary: `Alerta interno de Fale Conosco enviado para: ${recipients.join(', ')}`,
        metadata: {
          event_type: 'contact_us',
          idempotency_key: effectiveKey,
          submission_id,
          recipients,
          provider_message_id: primaryMessageId,
        },
      });
    } catch (_actErr) {
      // non-blocking
    }
  }

  return {
    success: hasSuccess,
    sent: hasSuccess ? recipients.length : 0,
    message_id: primaryMessageId,
    recipients,
    subject: emailData.subject,
    error: sendErrors.length > 0 ? sendErrors.join('; ') : undefined,
  };
}

export interface InternalCourseInfoNotificationPayload {
  submission_id?: string | null;
  lead_id?: string | null;
  idempotency_key: string;
  lead_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  course?: string | null;
  raw_course?: string | null;
  message?: string | null;
  raw_payload?: Record<string, unknown>;
  source_page?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}

export function buildCourseInfoEmail(
  payload: InternalCourseInfoNotificationPayload,
  leadUrl: string
): { subject: string; html: string; text: string } {
  const fullName =
    payload.lead_name ||
    `${payload.first_name || ''} ${payload.last_name || ''}`.trim() ||
    (payload.raw_payload?.name as string) ||
    'Lead';

  const courseTitle =
    payload.course ||
    (payload.raw_payload?.course_interest as string) ||
    (payload.raw_payload?.course as string) ||
    'Curso';

  const subject = `Request Course Information — ${fullName} — ${courseTitle}`;
  const nowPtBr = formatDatePtBr(new Date().toISOString());

  // Dynamic rendering of all safe submitted fields
  const EXCLUDED_KEYS = new Set([
    '_token',
    'csrf',
    'g-recaptcha-response',
    'recaptcha',
    'password',
    'token',
    'formData',
    'raw_form_data',
    'form_data',
    'slug',
    'form_slug',
    'idempotency_key',
    'external_attempt_id',
    '_hp_company',
    'message', // Rendered in dedicated callout
  ]);

  const raw = payload.raw_payload || {};
  const dynamicFieldRows: Array<{ label: string; value: string }> = [];

  for (const [key, rawVal] of Object.entries(raw)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

    // Format label: replace underscores with spaces and capitalize
    const formattedLabel = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    dynamicFieldRows.push({
      label: formattedLabel,
      value: String(rawVal).trim(),
    });
  }

  const visitorMessage = payload.message || (raw.message as string) || '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); max-width: 600px; width: 100%;">
          <!-- Header -->
          <tr>
            <td style="background-color: #08254f; padding: 24px 32px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                      Expert Dental Solutions
                    </h1>
                    <p style="color: #449bd5; font-size: 13px; font-weight: 600; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 0.5px;">
                      Solicitação de Informações de Curso (Course Information)
                    </p>
                  </td>
                  <td align="right">
                    <span style="background-color: rgba(68, 155, 213, 0.2); color: #ffffff; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 9999px; border: 1px solid rgba(68, 155, 213, 0.4);">
                      Course Info
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Notice Banner -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 32px; border-bottom: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5;">
                Um visitante solicitou informações sobre o curso <strong>${escapeHtml(courseTitle)}</strong> através do site oficial.
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 24px 32px;">
              <!-- 1. Dados do Contato & Curso -->
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 0 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                1. Dados do Contato &amp; Curso
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="margin-bottom: 20px; font-size: 13px;">
                <tr>
                  <td width="35%" style="color: #64748b; font-weight: 600;">Nome Completo:</td>
                  <td width="65%" style="color: #0f172a; font-weight: 700;">${escapeHtml(fullName)}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Curso Solicitado:</td>
                  <td style="color: #0284c7; font-weight: 700;">${escapeHtml(courseTitle)}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Email:</td>
                  <td style="color: #0f172a;"><a href="mailto:${escapeHtml(payload.email || '')}" style="color: #0284c7; text-decoration: none;">${escapeHtml(payload.email || 'Não informado')}</a></td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Telefone:</td>
                  <td style="color: #0f172a;">${escapeHtml(payload.phone || 'Não informado')}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Data do Envio:</td>
                  <td style="color: #0f172a;">${escapeHtml(nowPtBr)}</td>
                </tr>
              </table>

              <!-- 2. Mensagem do Visitante (se houver) -->
              ${
                visitorMessage
                  ? `
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 20px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                2. Mensagem
              </h2>
              <div style="background-color: #f8fafc; border-left: 4px solid #08254f; padding: 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; word-break: break-word; margin-bottom: 20px;">${escapeHtml(visitorMessage)}</div>
              `
                  : ''
              }

              <!-- 3. Formulário Enviado (Campos Adicionais) -->
              ${
                dynamicFieldRows.length > 0
                  ? `
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 20px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                3. Formulário Enviado (Campos Adicionais)
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="margin-bottom: 20px; font-size: 13px; background-color: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                ${dynamicFieldRows
                  .map(
                    (row) => `<tr>
                  <td width="40%" style="color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${escapeHtml(row.label)}:</td>
                  <td width="60%" style="color: #0f172a; border-bottom: 1px solid #e2e8f0;">${escapeHtml(row.value)}</td>
                </tr>`
                  )
                  .join('')}
              </table>`
                  : ''
              }

              <!-- 4. Origem e Rastreamento UTM -->
              <h2 style="font-size: 15px; font-weight: 700; color: #08254f; margin: 20px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                4. Origem / UTMs
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="margin-bottom: 24px; font-size: 13px;">
                <tr>
                  <td width="35%" style="color: #64748b; font-weight: 600;">Canal:</td>
                  <td width="65%" style="color: #0f172a;">Website (Request Course Information)</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-weight: 600;">Página:</td>
                  <td style="color: #0f172a; word-break: break-all;">${escapeHtml(payload.source_page || 'https://www.expdentalsolutions.com/request-course-information')}</td>
                </tr>
                ${payload.utm_source ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Source:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_source)}</td></tr>` : ''}
                ${payload.utm_medium ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Medium:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_medium)}</td></tr>` : ''}
                ${payload.utm_campaign ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Campaign:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_campaign)}</td></tr>` : ''}
                ${payload.utm_term ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Term:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_term)}</td></tr>` : ''}
                ${payload.utm_content ? `<tr><td style="color: #64748b; font-weight: 600;">UTM Content:</td><td style="color: #0f172a;">${escapeHtml(payload.utm_content)}</td></tr>` : ''}
              </table>

              <!-- 5. CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0 12px 0;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(leadUrl)}" target="_blank" style="background-color: #08254f; color: #ffffff; padding: 14px 32px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(8, 37, 79, 0.2);">
                      Abrir lead no EDS HUB &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.4;">
                Este é um alerta operacional interno do EDS HUB gerado automaticamente.<br>
                Não responda diretamente a este e-mail. Utilize os canais oficiais do CRM.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `REQUEST COURSE INFORMATION - EDS HUB
-----------------------------------------
Nome: ${fullName}
Curso: ${courseTitle}
Email: ${payload.email || 'Não informado'}
Telefone: ${payload.phone || 'Não informado'}
Data: ${nowPtBr}

${visitorMessage ? `MENSAGEM:\n${visitorMessage}\n\n` : ''}ORIGEM:
Canal: Website (Request Course Information)
Página: ${payload.source_page || 'https://www.expdentalsolutions.com/request-course-information'}
${payload.utm_source ? `UTM Source: ${payload.utm_source}\n` : ''}${payload.utm_medium ? `UTM Medium: ${payload.utm_medium}\n` : ''}${payload.utm_campaign ? `UTM Campaign: ${payload.utm_campaign}\n` : ''}

Abrir no EDS HUB:
${leadUrl}
`;

  return { subject, html, text };
}

export async function sendInternalCourseInfoNotification(
  db: any,
  payload: InternalCourseInfoNotificationPayload
): Promise<InternalNotificationResult> {
  const { submission_id, lead_id, idempotency_key, raw_payload } = payload;
  const effectiveKey = idempotency_key || `internal_email:course_info:${submission_id || Date.now()}`;

  // 1. Idempotency Check
  const { data: existingLog } = await db
    .from('internal_notification_logs')
    .select('id, status, provider_message_id, recipient_emails, subject')
    .eq('idempotency_key', effectiveKey)
    .maybeSingle();

  if (existingLog && existingLog.status === 'sent') {
    return {
      success: true,
      duplicate: true,
      already_sent: true,
      sent: 0,
      message_id: existingLog.provider_message_id,
      recipients: existingLog.recipient_emails || [],
      subject: existingLog.subject || 'Request Course Information',
    };
  }

  // 2. Resolve Active Internal EDS Administrators
  const recipients = await resolveInternalRecipients(db);
  if (recipients.length === 0) {
    return {
      success: false,
      recipients: [],
      subject: 'Request Course Information',
      error: 'No active internal administrative recipients resolved',
    };
  }

  // 3. Build Email Content
  const appBaseUrl = getEnv('EDS_HUB_APP_URL') || 'https://hub.expdentalsolutions.com';
  const leadUrl = lead_id ? `${appBaseUrl}/leads/${lead_id}` : appBaseUrl;
  const emailData = buildCourseInfoEmail(payload, leadUrl);

  const nowIso = new Date().toISOString();

  // 4. Log or Update Pending Record
  let logId = existingLog?.id;
  if (!logId) {
    const insCall: any = db
      .from('internal_notification_logs')
      .insert({
        event_type: 'course_information_request',
        idempotency_key: effectiveKey,
        lead_id: lead_id || null,
        submission_id: submission_id || null,
        recipient_emails: recipients,
        subject: emailData.subject,
        status: 'pending',
        payload_snapshot: raw_payload || {},
        last_activity_at: nowIso,
        scheduled_for: nowIso,
        created_at: nowIso,
      });

    if (typeof insCall?.select === 'function') {
      const sel = insCall.select('id');
      const insRes = typeof sel?.maybeSingle === 'function' ? await sel.maybeSingle() : await sel;
      if (insRes?.error) {
        console.warn('[sendInternalCourseInfoNotification] Log insert warning:', insRes.error);
      }
      logId = insRes?.data?.id;
    } else {
      const insRes = await insCall;
      if (insRes?.error) {
        console.warn('[sendInternalCourseInfoNotification] Log insert warning:', insRes.error);
      }
    }
  }

  // 5. Dispatch Email via Resend
  let primaryMessageId: string | null = null;
  const sendErrors: string[] = [];
  const fromEmail = getEnv('RESEND_FROM_EMAIL') || 'info@expdentalsolutions.com';
  const sender = fromEmail.includes('<') ? fromEmail : `Expert Dental Solutions <${fromEmail}>`;

  for (const recipient of recipients) {
    try {
      const result = await sendEmail({
        from: sender,
        to: recipient,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        replyTo: 'info@expdentalsolutions.com',
        idempotencyKey: `${effectiveKey}_${recipient}`,
      });

      if (result.success && result.messageId) {
        if (!primaryMessageId) primaryMessageId = result.messageId;
      } else {
        sendErrors.push(`Failed sending to ${recipient}: ${result.errorMessage || result.errorCode || 'Unknown'}`);
      }
    } catch (sendErr) {
      sendErrors.push(`Error sending to ${recipient}: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
    }
  }

  const hasSuccess = Boolean(primaryMessageId) || (sendErrors.length === 0 && recipients.length > 0);

  // 6. Update Log Record
  await db
    .from('internal_notification_logs')
    .update({
      status: hasSuccess ? 'sent' : 'failed',
      provider_message_id: primaryMessageId,
      error_message: sendErrors.length > 0 ? sendErrors.join('; ') : null,
      sent_at: hasSuccess ? nowIso : null,
    })
    .eq('idempotency_key', effectiveKey);

  // 7. Log Activity on Lead
  if (lead_id && hasSuccess) {
    try {
      await db.from('lead_activities').insert({
        lead_id,
        activity_type: 'course_info_internal_email',
        actor_type: 'system',
        summary: `Alerta interno de Solicitação de Informações de Curso enviado para: ${recipients.join(', ')}`,
        metadata: {
          event_type: 'course_information_request',
          idempotency_key: effectiveKey,
          submission_id,
          recipients,
          provider_message_id: primaryMessageId,
        },
      });
    } catch (_actErr) {
      // non-blocking
    }
  }

  return {
    success: hasSuccess,
    sent: hasSuccess ? recipients.length : 0,
    message_id: primaryMessageId,
    recipients,
    subject: emailData.subject,
    error: sendErrors.length > 0 ? sendErrors.join('; ') : undefined,
  };
}

