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
  failure_category?: string | null;
  submit_attempt_count?: number | null;
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

export const EDS_OFFICIAL_LOGO_URL = 'https://www.expdentalsolutions.com/storage/site/fJOJt2KVIZpwj4mHb7QQ.png';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalizes subject parameters, discarding empty, undefined, null, or UUID values.
 */
export function cleanSubjectParam(val?: string | null): string | null {
  if (!val) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'nil' ||
    lower === 'n/a' ||
    lower === 'na' ||
    lower === 'não informada' ||
    lower === 'não informado' ||
    lower === 'curso não especificado' ||
    lower === 'curso' ||
    lower === 'turma não informada' ||
    UUID_REGEX.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Standardizes email subjects under the "[EDS]" operational prefix.
 * Omits empty, undefined, null, or UUID parameters without leaving hanging separators.
 */
export function formatEdsSubject(
  prefix: string,
  name?: string | null,
  course?: string | null,
  turma?: string | null
): string {
  const parts: string[] = [prefix];
  const cleanName = cleanSubjectParam(name);
  const cleanCourse = cleanSubjectParam(course);
  const cleanTurma = cleanSubjectParam(turma);

  if (cleanName) parts.push(cleanName);
  if (cleanCourse) parts.push(cleanCourse);
  if (cleanTurma) parts.push(cleanTurma);

  return parts.join(' — ');
}

export interface EdsEmailSectionRow {
  label: string;
  value: string;
  isLink?: boolean;
  href?: string;
}

export interface EdsEmailSection {
  title: string;
  rows?: EdsEmailSectionRow[];
  calloutHtml?: string;
}

export interface EdsEmailTemplateOptions {
  subject: string;
  eventTitle: string;
  eventBadgeText?: string;
  badgeStyle?: { bg: string; text: string; border: string };
  accentColor?: string;
  leadName: string;
  leadSubheading?: string;
  courseTitle?: string | null;
  turmaTitle?: string | null;
  sections: EdsEmailSection[];
  ctaButton?: { label: string; url: string };
  footerNotice?: string;
}

/**
 * Renders the standardized, premium Expert Dental Solutions email layout.
 * Highly responsive, inline-styled, compatible with Gmail, Outlook, Apple Mail.
 */
export function renderEdsEmailHtml(options: EdsEmailTemplateOptions): string {
  const {
    eventTitle,
    eventBadgeText,
    badgeStyle = { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
    accentColor = '#08254f',
    leadName,
    leadSubheading,
    courseTitle,
    turmaTitle,
    sections,
    ctaButton,
    footerNotice = 'Notificação operacional automática do CRM EDS HUB.',
  } = options;

  const sectionsHtml = sections
    .map((sec) => {
      let contentHtml = '';
      if (sec.calloutHtml) {
        contentHtml += sec.calloutHtml;
      }
      if (sec.rows && sec.rows.length > 0) {
        const rowsHtml = sec.rows
          .map((row) => {
            const valDisplay = row.isLink && row.href
              ? `<a href="${escapeHtml(row.href)}" style="color: #08254f; text-decoration: underline; word-break: break-all;">${escapeHtml(row.value)}</a>`
              : `<span style="word-break: break-word;">${escapeHtml(row.value)}</span>`;

            return `<tr>
              <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">
                ${escapeHtml(row.label)}
              </td>
              <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">
                ${valDisplay}
              </td>
            </tr>`;
          })
          .join('');

        contentHtml += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 4px;">
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>`;
      }

      return `<div style="margin-top: 22px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
          ${escapeHtml(sec.title)}
        </div>
        ${contentHtml}
      </div>`;
    })
    .join('');

  const leadCourseInfo = courseTitle
    ? `<div style="margin-top: 8px; font-size: 13px; font-weight: 600; color: #08254f;">
        <span style="display: inline-block; padding: 2px 8px; background-color: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 11px; margin-right: 6px; text-transform: uppercase;">Curso</span>
        ${escapeHtml(courseTitle)}
      </div>`
    : '';

  const leadTurmaInfo = turmaTitle
    ? `<div style="margin-top: 4px; font-size: 12px; color: #475569;">
        <span style="display: inline-block; padding: 2px 8px; background-color: #f1f5f9; color: #475569; border-radius: 4px; font-size: 11px; margin-right: 6px; text-transform: uppercase;">Turma</span>
        ${escapeHtml(turmaTitle)}
      </div>`
    : '';

  const ctaHtml = ctaButton
    ? `<div style="margin: 28px 0 12px 0; text-align: center;">
        <a href="${escapeHtml(ctaButton.url)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #08254f; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 12px 28px; border-radius: 6px; letter-spacing: 0.3px; box-shadow: 0 2px 4px rgba(8, 37, 79, 0.15);">
          ${escapeHtml(ctaButton.label)} &rarr;
        </a>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(options.subject)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .eds-container { width: 100% !important; max-width: 100% !important; }
      .eds-content-padding { padding: 16px !important; }
      .eds-lead-name { font-size: 18px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <!-- Preheader text for email preview -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #f8fafc;">
    ${escapeHtml(eventTitle)} — ${escapeHtml(leadName)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8fafc; padding: 24px 8px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="eds-container" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td style="padding: 24px 28px 18px 28px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; text-align: left;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align: middle;">
                    <a href="https://www.expdentalsolutions.com" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="${EDS_OFFICIAL_LOGO_URL}" alt="Expert Dental Solutions" width="150" style="display: block; width: 150px; max-width: 150px; height: auto; border: 0;" />
                    </a>
                    <div style="font-size: 12px; font-weight: 700; color: #08254f; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 6px;">
                      Expert Dental Solutions
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    ${eventBadgeText ? `<span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; background-color: ${badgeStyle.bg}; color: ${badgeStyle.text}; border: 1px solid ${badgeStyle.border}; border-radius: 12px;">${escapeHtml(eventBadgeText)}</span>` : ''}
                  </td>
                </tr>
              </table>
              <div style="margin-top: 14px; font-size: 18px; font-weight: 700; color: #08254f; line-height: 1.3;">
                ${escapeHtml(eventTitle)}
              </div>
            </td>
          </tr>

          <!-- Lead Summary Highlight Card -->
          <tr>
            <td style="padding: 20px 28px 0 28px;" class="eds-content-padding">
              <div style="background-color: #f8fafc; border-left: 4px solid ${accentColor}; border-radius: 6px; padding: 14px 18px;">
                <div class="eds-lead-name" style="font-size: 19px; font-weight: 700; color: #0f172a; line-height: 1.2;">
                  ${escapeHtml(leadName)}
                </div>
                ${leadSubheading ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">${escapeHtml(leadSubheading)}</div>` : ''}
                ${leadCourseInfo}
                ${leadTurmaInfo}
              </div>
            </td>
          </tr>

          <!-- Structured Sections -->
          <tr>
            <td style="padding: 0 28px 24px 28px;" class="eds-content-padding">
              ${sectionsHtml}
              ${ctaHtml}
            </td>
          </tr>

          <!-- Operational Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 28px; text-align: center;">
              <div style="font-size: 12px; font-weight: 700; color: #08254f;">
                Expert Dental Solutions
              </div>
              <div style="font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.4;">
                ${escapeHtml(footerNotice)}
              </div>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 6px;">
                3730 S Federal Hwy, Boynton Beach, FL 33435 &bull; info@expdentalsolutions.com
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}



/**
 * Builds HTML and plain-text body for Incomplete Registration attempt.
 */
export function buildIncompleteAttemptEmail(
  payload: InternalNotificationPayload,
  leadUrl: string
): { subject: string; html: string; text: string } {
  const raw = payload.raw_payload || {};
  const rawName = (typeof raw.name === 'string' ? raw.name : undefined) ||
    (typeof raw.full_name === 'string' ? raw.full_name : undefined);
  const rawFirst = payload.first_name || (typeof raw.first_name === 'string' ? raw.first_name : undefined);
  const rawLast = payload.last_name || (typeof raw.last_name === 'string' ? raw.last_name : undefined);
  const combinedName = [rawFirst, rawLast].filter(Boolean).join(' ');

  const fullName: string = payload.lead_name || rawName || combinedName || 'Candidato sem nome';

  const rawCourseSignal =
    (payload.course_name as string | undefined) ||
    (payload.course_code as string | undefined) ||
    (typeof raw.course === 'string' ? raw.course : undefined) ||
    (typeof raw.course_name === 'string' ? raw.course_name : undefined) ||
    (typeof raw.course_code === 'string' ? raw.course_code : undefined) ||
    (typeof raw.course_interest === 'string' ? raw.course_interest : undefined) ||
    null;
  const courseTitle = resolveCanonicalCourseName(rawCourseSignal);
  const email: string = payload.email || (typeof raw.email === 'string' ? raw.email : undefined) || 'Não informado';
  const phone: string = payload.phone || (typeof raw.phone === 'string' ? raw.phone : undefined) || 'Não informado';
  const rawTurma = (payload.turma_name ||
    (typeof raw.turma === 'string' ? raw.turma : undefined) ||
    (typeof raw.session_title === 'string' ? raw.session_title : undefined) ||
    (typeof raw.course_session === 'string' ? raw.course_session : undefined)) as string | undefined;
  const cleanTurma = cleanSubjectParam(rawTurma);
  const turmaDisplay = cleanTurma || 'Não informada / automática';

  const emergencyPhone = raw.emergency_phone ? String(raw.emergency_phone) : undefined;
  const country = raw.country || raw.pais;
  const cityState = [raw.city || raw.cidade, raw.state || raw.estado].filter(Boolean).join(', ');

  const specialty = raw.specialty || raw.especialidade;
  const experience = raw.years_in_practice || raw.anos_experiencia;
  const surgicalExp = raw.surgical_experience || raw.experiencia_cirurgica;
  const agd = raw.agd_number || raw.agd;
  const heardFrom = raw.heard_from || raw.onde_ouviu;
  const referral = raw.referral_name || raw.indicacao;
  const promo = raw.promo_code || raw.cupom;
  const certName = raw.certificate_name ? String(raw.certificate_name) : undefined;
  const coatSize = raw.coat_size ? String(raw.coat_size) : undefined;
  const sourcePage: string = payload.source_page || (typeof raw.source_page === 'string' ? raw.source_page : undefined) || 'https://www.expdentalsolutions.com/register';
  const attemptTimestamp = formatDatePtBr((typeof raw.submitted_at === 'string' ? raw.submitted_at : undefined) || new Date().toISOString());

  const isFailedSubmit = payload.status === 'submission_failed';
  const attemptCount = (typeof payload.submit_attempt_count === 'number' && payload.submit_attempt_count > 1)
    ? payload.submit_attempt_count
    : (typeof raw.submit_attempt_count === 'number' && raw.submit_attempt_count > 1 ? raw.submit_attempt_count : 1);

  const statusDisplay = isFailedSubmit
    ? `Falha no envio do site (${attemptCount}ª tentativa)`
    : 'Inscrição iniciada (Não concluída)';

  // Factual missing reasons and diagnostic categories
  const factualCategory = payload.failure_category || (typeof raw.failure_category === 'string' ? raw.failure_category : null);
  const factualReasons: string[] = [];
  if (factualCategory) {
    factualReasons.push(`Motivo da falha: ${factualCategory}`);
  }
  if (payload.missing_reason && payload.missing_reason !== factualCategory) {
    factualReasons.push(String(payload.missing_reason));
  }
  if (payload.error_code) {
    factualReasons.push(`Código de erro reportado: ${payload.error_code}`);
  }
  if (raw.missing_fields && Array.isArray(raw.missing_fields)) {
    factualReasons.push(`Campos pendentes: ${raw.missing_fields.join(', ')}`);
  }
  if (attemptCount > 1) {
    factualReasons.push(`Tentativas realizadas: ${attemptCount}`);
  }
  const missingReasonText = factualReasons.length > 0
    ? factualReasons.join(' | ')
    : (isFailedSubmit ? 'O envio foi rejeitado pelo servidor' : 'Formulário abandonado antes da finalização');

  const utms = [
    raw.utm_source ? `Source: ${String(raw.utm_source)}` : null,
    raw.utm_medium ? `Medium: ${String(raw.utm_medium)}` : null,
    raw.utm_campaign ? `Campaign: ${String(raw.utm_campaign)}` : null,
    raw.utm_term ? `Term: ${String(raw.utm_term)}` : null,
    raw.utm_content ? `Content: ${String(raw.utm_content)}` : null,
  ].filter(Boolean).join(' | ') || 'Nenhum UTM registrado';

  let subjectPrefix = '[EDS] Matrícula não concluída';
  let eventTitle = 'Tentativa de matrícula não concluída';
  let eventBadgeText = 'Tentativa Incompleta';
  let badgeStyle = { bg: '#fef3c7', text: '#92400e', border: '#fde68a' };
  let accentColor = '#f59e0b';
  let leadSubheading = 'Tentativa de matrícula pendente de finalização';

  if (isFailedSubmit) {
    subjectPrefix = attemptCount > 1
      ? `[EDS] ${attemptCount} tentativas de matrícula`
      : '[EDS] Tentativa de matrícula';
    eventTitle = attemptCount > 1
      ? `${attemptCount} tentativas de matrícula com falha`
      : 'Tentativa de matrícula';
    eventBadgeText = attemptCount > 1
      ? `Falha no Envio (${attemptCount}ª tentativa)`
      : 'Falha no Envio';
    badgeStyle = { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' };
    accentColor = '#ef4444';
    leadSubheading = 'O visitante tentou concluir a matrícula, mas o envio não foi concluído.';
  }

  const subject = formatEdsSubject(subjectPrefix, fullName, courseTitle);

  const contactRows: EdsEmailSectionRow[] = [
    { label: 'Nome Completo', value: fullName },
    { label: 'E-mail', value: email, isLink: email !== 'Não informado', href: email !== 'Não informado' ? `mailto:${email}` : undefined },
    { label: 'Telefone', value: phone },
  ];
  if (emergencyPhone) {
    contactRows.push({ label: 'Tel. Emergência', value: emergencyPhone });
  }
  if (certName) {
    contactRows.push({ label: 'Nome no Certificado', value: certName });
  }
  if (country || cityState) {
    const loc = [country, cityState ? `(${cityState})` : null].filter(Boolean).join(' ');
    contactRows.push({ label: 'País / Localização', value: loc });
  }
  contactRows.push({ label: 'Data da Tentativa', value: attemptTimestamp });

  const sections: EdsEmailSection[] = [];

  if (isFailedSubmit) {
    sections.push({
      title: 'Diagnóstico da Falha no Envio',
      rows: [
        { label: 'Motivo Factual', value: factualCategory || 'Erro de validação ou envio rejeitado' },
        { label: 'Tentativas de Envio', value: `${attemptCount} tentativa${attemptCount > 1 ? 's' : ''}` },
        { label: 'Última Tentativa', value: attemptTimestamp },
      ],
    });
  }

  sections.push({
    title: 'Dados do Contato',
    rows: contactRows,
  });

  sections.push({
    title: 'Curso & Turma',
    rows: [
      { label: 'Curso Selecionado', value: courseTitle || 'Não identificado' },
      { label: 'Turma / Datas', value: turmaDisplay },
      { label: 'Status da Inscrição', value: statusDisplay },
      { label: 'Diagnóstico', value: missingReasonText },
    ],
  });

  const profRows: EdsEmailSectionRow[] = [];
  if (specialty) profRows.push({ label: 'Especialidade', value: String(specialty) });
  if (experience) profRows.push({ label: 'Tempo de Prática', value: String(experience) });
  if (surgicalExp) profRows.push({ label: 'Experiência Cirúrgica', value: String(surgicalExp) });
  if (coatSize) profRows.push({ label: 'Tamanho do Jaleco', value: coatSize });
  if (agd) profRows.push({ label: 'Número AGD/PACE', value: String(agd) });

  if (profRows.length > 0) {
    sections.push({
      title: 'Informações Profissionais',
      rows: profRows,
    });
  }

  const originRows: EdsEmailSectionRow[] = [
    { label: 'Origem', value: 'Website (Formulário de Matrícula)' },
    { label: 'Página', value: sourcePage },
  ];
  if (raw.utm_source) originRows.push({ label: 'UTM Source', value: String(raw.utm_source) });
  if (raw.utm_medium) originRows.push({ label: 'UTM Medium', value: String(raw.utm_medium) });
  if (raw.utm_campaign) originRows.push({ label: 'UTM Campaign', value: String(raw.utm_campaign) });
  if (heardFrom) originRows.push({ label: 'Onde Conheceu', value: String(heardFrom) });
  if (referral) originRows.push({ label: 'Indicação', value: String(referral) });
  if (promo) originRows.push({ label: 'Cupom de Desconto', value: String(promo) });

  sections.push({
    title: 'Origem e Atribuição',
    rows: originRows,
  });

  const html = renderEdsEmailHtml({
    subject,
    eventTitle,
    eventBadgeText,
    badgeStyle,
    accentColor,
    leadName: fullName,
    leadSubheading,
    courseTitle,
    turmaTitle: cleanTurma,
    sections,
    ctaButton: {
      label: 'Acompanhar tentativa no EDS HUB',
      url: leadUrl,
    },
    footerNotice: isFailedSubmit
      ? 'Alerta operacional imediato de tentativa de matrícula com falha no site.'
      : 'Notificação operacional automática do CRM EDS HUB.',
  });

  const textHeader = isFailedSubmit ? 'TENTATIVA DE MATRÍCULA COM FALHA NO ENVIO' : 'TENTATIVA DE MATRÍCULA NÃO CONCLUÍDA';
  const text = `${textHeader} - EDS HUB
========================================
Lead: ${fullName}
Curso: ${courseTitle || 'Não identificado'}
Turma: ${turmaDisplay}
Status: ${statusDisplay}
Motivo factual: ${missingReasonText}
${isFailedSubmit ? `Tentativas: ${attemptCount}\n` : ''}
CONTATO:
Email: ${email}
Telefone: ${phone}

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
  const rawName = (typeof raw.name === 'string' ? raw.name : undefined) ||
    (typeof raw.full_name === 'string' ? raw.full_name : undefined);
  const rawFirst = payload.first_name || (typeof raw.first_name === 'string' ? raw.first_name : undefined);
  const rawLast = payload.last_name || (typeof raw.last_name === 'string' ? raw.last_name : undefined);
  const combinedName = [rawFirst, rawLast].filter(Boolean).join(' ');

  const fullName: string = payload.lead_name || rawName || combinedName || 'Aluno';

  const rawCourse = (payload.course_name ||
    payload.course_code ||
    (typeof raw.course === 'string' ? raw.course : undefined) ||
    (typeof raw.course_interest === 'string' ? raw.course_interest : undefined) ||
    'Curso Confirmado') as string;
  const courseTitle = resolveCanonicalCourseName(rawCourse) || rawCourse;
  const email: string = payload.email || (typeof raw.email === 'string' ? raw.email : undefined) || 'Não informado';
  const phone: string = payload.phone || (typeof raw.phone === 'string' ? raw.phone : undefined) || 'Não informado';
  const rawTurma = (payload.turma_name ||
    (typeof raw.turma === 'string' ? raw.turma : undefined) ||
    (typeof raw.session_title === 'string' ? raw.session_title : undefined) ||
    (typeof raw.course_session === 'string' ? raw.course_session : undefined)) as string | undefined;
  const cleanTurma = cleanSubjectParam(rawTurma);
  const turmaDisplay = cleanTurma || 'Turma selecionada no formulário';

  const emergencyPhone = raw.emergency_phone ? String(raw.emergency_phone) : undefined;
  const country = raw.country || raw.pais;
  const cityState = [raw.city || raw.cidade, raw.state || raw.estado].filter(Boolean).join(', ');

  const specialty = raw.specialty || raw.especialidade || 'Não informada';
  const experience = raw.years_in_practice || raw.anos_experiencia || 'Não informado';
  const surgicalExp = raw.surgical_experience || raw.experiencia_cirurgica || 'Não informada';
  const agd = raw.agd_number || raw.agd || 'Não informado';
  const heardFrom = raw.heard_from || raw.onde_ouviu || 'Não informado';
  const referral = raw.referral_name || raw.indicacao || 'Nenhuma';
  const promo = raw.promo_code || raw.cupom || 'Nenhum';
  const termsAccepted = raw.terms_accepted ? 'Sim (Aceite confirmado no envio)' : 'Sim';
  const completionTimestamp = formatDatePtBr((typeof raw.submitted_at === 'string' ? raw.submitted_at : undefined) || new Date().toISOString());

  const docs = payload.documents || [];
  let docsHtml = '';
  if (docs.length > 0) {
    docsHtml = `<ul style="margin: 8px 0; padding-left: 20px; color: #111827; font-size: 13px;">` +
      docs.map((d) => `<li><strong>${escapeHtml(d.document_type)}:</strong> ${escapeHtml(d.original_filename)}</li>`).join('') +
      `</ul>`;
  } else {
    docsHtml = `<p style="margin: 6px 0; font-size: 13px; color: #475569;">Documentos enviados via formulário (Passaporte / Licença Odontológica). Acesse a área segura de documentos no EDS HUB.</p>`;
  }

  const subject = formatEdsSubject('[EDS] Nova matrícula concluída', fullName, courseTitle, cleanTurma);

  const studentRows: EdsEmailSectionRow[] = [
    { label: 'Nome Completo', value: fullName },
    { label: 'E-mail', value: email, isLink: email !== 'Não informado', href: email !== 'Não informado' ? `mailto:${email}` : undefined },
    { label: 'Telefone', value: phone },
  ];
  if (emergencyPhone) {
    studentRows.push({ label: 'Tel. Emergência', value: emergencyPhone });
  }
  if (country || cityState) {
    const loc = [country, cityState ? `(${cityState})` : null].filter(Boolean).join(' ');
    studentRows.push({ label: 'País / Localização', value: loc });
  }
  studentRows.push({ label: 'Data de Conclusão', value: completionTimestamp });

  const sections: EdsEmailSection[] = [
    {
      title: 'Dados do Aluno',
      rows: studentRows,
    },
    {
      title: 'Curso & Turma',
      rows: [
        { label: 'Curso Selecionado', value: courseTitle },
        { label: 'Turma / Datas', value: turmaDisplay },
        { label: 'Termos e Condições', value: termsAccepted },
      ],
    },
    {
      title: 'Informações Profissionais',
      rows: [
        { label: 'Especialidade', value: String(specialty) },
        { label: 'Anos de Prática', value: String(experience) },
        { label: 'Exp. Cirúrgica', value: String(surgicalExp) },
        { label: 'Número AGD/PACE', value: String(agd) },
      ],
    },
    {
      title: 'Documentos & Anexos de Matrícula',
      calloutHtml: `<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px;">
        ${docsHtml}
        <div style="margin-top: 10px;">
          <a href="${escapeHtml(documentsUrl)}" target="_blank" style="display: inline-block; padding: 7px 14px; background-color: #08254f; color: #ffffff; text-decoration: none; font-size: 12px; font-weight: 700; border-radius: 6px;">
            Acessar Documentos Seguros &rarr;
          </a>
        </div>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #64748b;">
          Documentos de identificação e licenças profissionais são protegidos por acesso autenticado no EDS HUB.
        </p>
      </div>`,
    },
    {
      title: 'Origem & Atribuição',
      rows: [
        { label: 'Origem', value: 'Website (Formulário Oficial de Registro)' },
        { label: 'Onde conheceu', value: referral !== 'Nenhuma' ? `${heardFrom} (Indicação: ${referral})` : String(heardFrom) },
        { label: 'Cupom Aplicado', value: String(promo) },
        { label: 'Página', value: payload.source_page || 'https://www.expdentalsolutions.com/register' },
      ],
    },
  ];

  const html = renderEdsEmailHtml({
    subject,
    eventTitle: 'Nova matrícula concluída',
    eventBadgeText: 'Matrícula Confirmada',
    badgeStyle: { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
    accentColor: '#10b981',
    leadName: fullName,
    leadSubheading: 'Inscrição finalizada com sucesso no site oficial',
    courseTitle,
    turmaTitle: cleanTurma,
    sections,
    ctaButton: {
      label: 'Abrir matrícula no EDS HUB',
      url: leadUrl,
    },
    footerNotice: 'Notificação operacional oficial de matrícula.',
  });

  const text = `NOVA MATRÍCULA CONCLUÍDA - EDS HUB
========================================
Aluno: ${fullName}
Curso: ${courseTitle}
Turma: ${turmaDisplay}
Email: ${email}
Telefone: ${phone}
Data: ${completionTimestamp}

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

    // 1.1 Check if an immediate alert (e.g. failed submission) was already sent for this attempt
    let alertAlreadySent = false;
    if (extAttemptId) {
      try {
        let qSent = db
          .from('internal_notification_logs')
          .select('id')
          .eq('event_type', 'incomplete_registration')
          .eq('status', 'sent');
        if (typeof qSent?.or === 'function') {
          qSent = qSent.or(`idempotency_key.ilike.%fail_${extAttemptId}%,payload_snapshot->>external_attempt_id.eq.${extAttemptId}`);
        } else if (typeof qSent?.eq === 'function') {
          qSent = qSent.eq('idempotency_key', `internal_email:attempt:fail_${extAttemptId}_1`);
        }
        if (typeof qSent?.limit === 'function') qSent = qSent.limit(1);
        const { data: sentFails } = await qSent;
        if (sentFails && sentFails.length > 0) {
          alertAlreadySent = true;
        }
      } catch (_sentErr) {}
    }

    if (alertAlreadySent) {
      await db
        .from('internal_notification_logs')
        .update({
          status: 'skipped',
          error_message: 'Skipped duplicate: immediate alert already sent for this attempt',
        })
        .eq('id', row.id);
      skipped++;
      continue;
    }

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

  const isFailedSubmit = payload.status === 'submission_failed';
  const isImmediate = options?.immediate === true || isFailedSubmit;

  // If immediate mode is not requested, use the inactivity lifecycle queue
  if (!isImmediate) {
    const queueRes = await queueOrUpdateIncompleteEnrollmentNotification(db, payload, options?.inactivityMinutes ?? 10);
    const recipients = await resolveInternalRecipients(db);
    return {
      success: queueRes.success,
      duplicate: queueRes.duplicate,
      recipients: queueRes.status === 'pending' ? recipients : [],
      subject: formatEdsSubject('[EDS] Matrícula não concluída', payload.lead_name, payload.course_name),
    };
  }

  // IMMEDIATE DISPATCH MODE:
  // 1. Idempotency & Throttling Check in public.internal_notification_logs
  const { data: existingLog } = await db
    .from('internal_notification_logs')
    .select('id, status, provider_message_id, recipient_emails, subject, sent_at, payload_snapshot')
    .eq('idempotency_key', idempotency_key)
    .maybeSingle();

  if (existingLog && (existingLog.status === 'sent' || existingLog.status === 'pending')) {
    const sentTime = existingLog.sent_at ? new Date(existingLog.sent_at).getTime() : 0;
    const nowTime = Date.now();
    const isThrottled = (nowTime - sentTime) < 5 * 60 * 1000;

    if (existingLog.status === 'sent' && isThrottled) {
      try {
        await db.from('internal_notification_logs').update({
          payload_snapshot: {
            ...(existingLog.payload_snapshot || {}),
            ...(payload.raw_payload || {}),
            submit_attempt_count: payload.submit_attempt_count || existingLog.payload_snapshot?.submit_attempt_count,
            last_failed_submission_at: new Date().toISOString(),
          },
          last_activity_at: new Date().toISOString(),
        }).eq('id', existingLog.id);
      } catch (_snapErr) {}

      return {
        success: true,
        duplicate: true,
        skipped: true,
        message_id: existingLog.provider_message_id,
        recipients: existingLog.recipient_emails || [],
        subject: existingLog.subject || '',
      };
    }

    if (existingLog.status === 'pending') {
      return {
        success: true,
        duplicate: true,
        message_id: existingLog.provider_message_id,
        recipients: existingLog.recipient_emails || [],
        subject: existingLog.subject || '',
      };
    }
  }

  // 1.1 When an immediate failed submission notification is sent:
  // Cancel any pending abandonment record for the same attempt to prevent double notification
  const extAttemptId = payload.external_attempt_id || (payload.raw_payload?.external_attempt_id as string);
  if (isFailedSubmit && (extAttemptId || attempt_id)) {
    try {
      let cancelQ = db
        .from('internal_notification_logs')
        .update({
          status: 'skipped',
          error_message: 'Subsumed by immediate failed submission notification',
        })
        .eq('event_type', 'incomplete_registration')
        .eq('status', 'pending');

      if (extAttemptId) {
        cancelQ = cancelQ.or(`idempotency_key.eq.internal_email:attempt:${extAttemptId},idempotency_key.eq.internal_email:attempt:inact_${extAttemptId}`);
      } else if (attempt_id) {
        cancelQ = cancelQ.eq('attempt_id', attempt_id);
      }
      await cancelQ;
    } catch (_cErr) {}
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
      const summaryMsg = isFailedSubmit
        ? `Alerta imediato de falha no envio de matrícula enviado para: ${recipients.join(', ')}`
        : `Alerta interno de tentativa de matrícula enviado para: ${recipients.join(', ')}`;
      await db.from('lead_activities').insert({
        lead_id,
        activity_type: 'internal_notification_sent',
        actor_type: 'system',
        summary: summaryMsg,
        metadata: {
          event_type,
          idempotency_key,
          recipients,
          provider_message_id: primaryMessageId,
          status: payload.status,
          failure_category: payload.failure_category,
          attempt_count: payload.submit_attempt_count,
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

  const subject = formatEdsSubject('[EDS] Novo contato pelo site', fullName);
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
    'message',
  ]);

  const raw = payload.raw_payload || {};
  const dynamicFieldRows: EdsEmailSectionRow[] = [];

  for (const [key, rawVal] of Object.entries(raw)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

    const formattedLabel = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    dynamicFieldRows.push({
      label: formattedLabel,
      value: String(rawVal).trim(),
    });
  }

  const visitorMessage = payload.message || (raw.message as string) || '';

  const sections: EdsEmailSection[] = [
    {
      title: 'Dados do Contato',
      rows: [
        { label: 'Nome Completo', value: fullName },
        { label: 'E-mail', value: payload.email || 'Não informado', isLink: Boolean(payload.email), href: payload.email ? `mailto:${payload.email}` : undefined },
        { label: 'Telefone', value: payload.phone || 'Não informado' },
        { label: 'Data do Envio', value: nowPtBr },
      ],
    },
    {
      title: 'Mensagem do Visitante',
      calloutHtml: `<div style="background-color: #f8fafc; border-left: 4px solid #08254f; padding: 14px 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; word-break: break-word;">${escapeHtml(visitorMessage || 'Nenhuma mensagem escrita.')}</div>`,
    },
  ];

  if (dynamicFieldRows.length > 0) {
    sections.push({
      title: 'Formulário Enviado (Campos Adicionais)',
      rows: dynamicFieldRows,
    });
  }

  const utmRows: EdsEmailSectionRow[] = [
    { label: 'Origem', value: 'Website (Formulário Fale Conosco / Contact Us)' },
    { label: 'Página', value: payload.source_page || 'https://www.expdentalsolutions.com/contact' },
  ];
  if (payload.utm_source) utmRows.push({ label: 'UTM Source', value: payload.utm_source });
  if (payload.utm_medium) utmRows.push({ label: 'UTM Medium', value: payload.utm_medium });
  if (payload.utm_campaign) utmRows.push({ label: 'UTM Campaign', value: payload.utm_campaign });
  if (payload.utm_term) utmRows.push({ label: 'UTM Term', value: payload.utm_term });
  if (payload.utm_content) utmRows.push({ label: 'UTM Content', value: payload.utm_content });

  sections.push({
    title: 'Origem e Rastreamento',
    rows: utmRows,
  });

  const html = renderEdsEmailHtml({
    subject,
    eventTitle: 'Novo contato pelo site',
    eventBadgeText: 'Website Contact',
    badgeStyle: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
    accentColor: '#08254f',
    leadName: fullName,
    leadSubheading: 'Novo formulário de contato recebido',
    sections,
    ctaButton: {
      label: 'Abrir lead no EDS HUB',
      url: leadUrl,
    },
    footerNotice: 'Notificação operacional automática do CRM EDS HUB.',
  });

  const text = `NOVO CONTATO PELO SITE - EDS HUB
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
      subject: existingLog.subject || formatEdsSubject('[EDS] Novo contato pelo site', payload.lead_name),
    };
  }

  // 2. Resolve Active Internal EDS Administrators
  const recipients = await resolveInternalRecipients(db);
  if (recipients.length === 0) {
    return {
      success: false,
      recipients: [],
      subject: formatEdsSubject('[EDS] Novo contato pelo site', payload.lead_name),
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

  const rawCourse =
    payload.course ||
    (payload.raw_payload?.course_interest as string) ||
    (payload.raw_payload?.course as string) ||
    '';
  const courseTitle = resolveCanonicalCourseName(rawCourse);

  const subject = formatEdsSubject('[EDS] Pedido de informações', fullName, courseTitle);
  const nowPtBr = formatDatePtBr(new Date().toISOString());

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
    'message',
  ]);

  const raw = payload.raw_payload || {};
  const dynamicFieldRows: EdsEmailSectionRow[] = [];

  for (const [key, rawVal] of Object.entries(raw)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

    const formattedLabel = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    dynamicFieldRows.push({
      label: formattedLabel,
      value: String(rawVal).trim(),
    });
  }

  const visitorMessage = payload.message || (raw.message as string) || '';

  const sections: EdsEmailSection[] = [
    {
      title: 'Dados do Contato',
      rows: [
        { label: 'Nome Completo', value: fullName },
        { label: 'E-mail', value: payload.email || 'Não informado', isLink: Boolean(payload.email), href: payload.email ? `mailto:${payload.email}` : undefined },
        { label: 'Telefone', value: payload.phone || 'Não informado' },
        { label: 'Data da Solicitação', value: nowPtBr },
      ],
    },
    {
      title: 'Curso de Interesse',
      rows: [
        { label: 'Curso', value: courseTitle || 'Não especificado' },
        { label: 'Status do Lead', value: 'Novo Lead / Aguardando Atendimento' },
      ],
    },
  ];

  if (visitorMessage) {
    sections.push({
      title: 'Mensagem do Interessado',
      calloutHtml: `<div style="background-color: #f8fafc; border-left: 4px solid #08254f; padding: 14px 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; word-break: break-word;">${escapeHtml(visitorMessage)}</div>`,
    });
  }

  if (dynamicFieldRows.length > 0) {
    sections.push({
      title: 'Formulário Enviado (Campos Adicionais)',
      rows: dynamicFieldRows,
    });
  }

  const utmRows: EdsEmailSectionRow[] = [
    { label: 'Origem', value: 'Website (Request Course Information)' },
    { label: 'Página', value: payload.source_page || 'https://www.expdentalsolutions.com/request-course-information' },
  ];
  if (payload.utm_source) utmRows.push({ label: 'UTM Source', value: payload.utm_source });
  if (payload.utm_medium) utmRows.push({ label: 'UTM Medium', value: payload.utm_medium });
  if (payload.utm_campaign) utmRows.push({ label: 'UTM Campaign', value: payload.utm_campaign });
  if (payload.utm_term) utmRows.push({ label: 'UTM Term', value: payload.utm_term });
  if (payload.utm_content) utmRows.push({ label: 'UTM Content', value: payload.utm_content });

  sections.push({
    title: 'Origem e Atribuição',
    rows: utmRows,
  });

  const html = renderEdsEmailHtml({
    subject,
    eventTitle: 'Novo pedido de informações sobre curso',
    eventBadgeText: 'Informações de Curso',
    badgeStyle: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    accentColor: '#08254f',
    leadName: fullName,
    leadSubheading: 'Solicitação de informações de curso recebida',
    courseTitle,
    sections,
    ctaButton: {
      label: 'Abrir lead no EDS HUB',
      url: leadUrl,
    },
    footerNotice: 'Notificação operacional automática do CRM EDS HUB.',
  });

  const text = `PEDIDO DE INFORMAÇÕES SOBRE CURSO - EDS HUB
-----------------------------------------
Nome: ${fullName}
Curso: ${courseTitle || 'Não especificado'}
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
      subject: existingLog.subject || formatEdsSubject('[EDS] Pedido de informações', payload.lead_name, payload.course),
    };
  }

  // 2. Resolve Active Internal EDS Administrators
  const recipients = await resolveInternalRecipients(db);
  if (recipients.length === 0) {
    return {
      success: false,
      recipients: [],
      subject: formatEdsSubject('[EDS] Pedido de informações', payload.lead_name, payload.course),
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

