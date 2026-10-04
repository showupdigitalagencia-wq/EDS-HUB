import {
  Activity,
  Phone,
  MessageSquare,
  Mail,
  CalendarCheck,
  CheckCircle2,
  CheckCheck,
  RefreshCw,
  Clock,
  AlertCircle,
  AlertTriangle,
  Eye,
  MousePointerClick,
  FileText,
  User,
  PlusCircle,
  Calendar,
} from 'lucide-react';
import type { LeadActivity } from '../../../types';
import { WhatsAppIcon } from '../../../components/icons/WhatsAppIcon';

interface LeadTimelineProps {
  activities: LeadActivity[];
  onOpenRegisterActivity?: () => void;
}

/**
 * Canonical Contact Attempt Counter (Batch 4 Core Rule):
 * Counts confirmed outreach events:
 * - email_dispatched
 * - sms_dispatched
 * - call_manual_attempt
 * - whatsapp_contact_attempt
 * - manual_email_sent
 * - manual_sms_sent
 * - manual_call_logged
 * - manual_whatsapp_sent
 * - manual_contact_made
 * - call_logged (outbound)
 *
 * Excludes email_manual_attempt and sms_manual_attempt because mailto: / sms:
 * deep-links only confirm that the operator opened the client, not whether
 * the message was actually sent.
 *
 * Deduplicates outbound provider dispatches using outbound_message_id, message_id, or external_activity_id.
 */
export function countContactAttempts(activities: LeadActivity[]): number {
  const COUNTABLE_TYPES = new Set([
    'email_dispatched',
    'sms_dispatched',
    'call_manual_attempt',
    'whatsapp_contact_attempt',
    'manual_email_sent',
    'manual_sms_sent',
    'sms_manual_confirmed',
    'manual_call_logged',
    'manual_whatsapp_sent',
    'whatsapp_manual_confirmed',
    'whatsapp_contact_confirmed',
    'manual_contact_made',
    'call_logged',
  ]);

  const seenKeys = new Set<string>();
  let total = 0;

  for (const act of activities) {
    if (!COUNTABLE_TYPES.has(act.activity_type)) continue;

    const meta = act.metadata as Record<string, any> | undefined;
    const dedupeKey =
      meta?.outbound_message_id ||
      meta?.message_id ||
      meta?.external_activity_id ||
      act.external_activity_id ||
      `act-${act.id}`;

    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      total++;
    }
  }

  return total;
}

/**
 * Identifies the factual source of the activity for clear timeline provenance.
 * Examples:
 * - Source: HubSpot
 * - Source: EDS / Resend
 * - Source: EDS / Titan
 * - Source: EDS HUB
 */
export function getActivitySource(act: LeadActivity): { label: string; badgeClass: string; isHubSpot: boolean } {
  const meta = act.metadata as Record<string, any> | undefined;
  const isHubSpot =
    meta?.source === 'hubspot' ||
    meta?.provider === 'hubspot' ||
    act.activity_type.startsWith('hubspot_') ||
    meta?.external_activity_id?.startsWith('hs_') ||
    (typeof act.external_activity_id === 'string' && act.external_activity_id.startsWith('hs_'));

  if (isHubSpot) {
    return {
      label: 'Source: HubSpot',
      badgeClass: 'bg-orange-50 text-orange-800 border-orange-200/80',
      isHubSpot: true,
    };
  }

  const isResend =
    meta?.provider === 'resend' ||
    meta?.service === 'resend' ||
    (act.activity_type.startsWith('email_') && !meta?.manual) ||
    meta?.outbound_channel === 'email';

  if (isResend) {
    return {
      label: 'Source: EDS / Resend',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200/70',
      isHubSpot: false,
    };
  }

  const isTitan = meta?.provider === 'titan';
  if (isTitan) {
    return {
      label: 'Source: EDS / Titan',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200/70',
      isHubSpot: false,
    };
  }

  return {
    label: 'Source: EDS HUB',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200/80',
    isHubSpot: false,
  };
}

/**
 * Translates activity_type into honest, client-facing Portuguese labels.
 * If the activity is sourced from HubSpot, returns specific contextual labels:
 * - Ligação registrada
 * - Nota registrada
 * - Formulário enviado
 * - Task concluída
 * - Tarefa
 */
export function getActivityLabel(activityType: string, act?: LeadActivity): string {
  const meta = act?.metadata as Record<string, any> | undefined;
  const isHubSpot =
    meta?.source === 'hubspot' ||
    meta?.provider === 'hubspot' ||
    meta?.external_activity_id?.startsWith('hs_') ||
    (typeof act?.external_activity_id === 'string' && act.external_activity_id.startsWith('hs_'));

  if (isHubSpot) {
    switch (activityType) {
      case 'call_logged':
      case 'manual_call_logged':
        return 'Ligação registrada';
      case 'note_created':
        return 'Nota registrada';
      case 'task_completed':
        return 'Task concluída';
      case 'task_created':
        return 'Tarefa';
      case 'meeting_logged':
        return 'Reunião';
      case 'sms_logged':
      case 'sms_dispatched':
        return 'SMS registrado';
      case 'whatsapp_contact_attempt':
        return 'WhatsApp registrado';
      case 'form_submitted':
        return 'Formulário enviado';
      case 'email_sent':
      case 'email_dispatched':
        return 'Email enviado';
      default:
        break;
    }
  }

  switch (activityType) {
    case 'manual_activity_logged':
      return 'Atividade manual';
    case 'manual_email_sent':
      return 'E-mail enviado';
    case 'manual_sms_sent':
    case 'sms_manual_confirmed':
      return 'SMS enviado';
    case 'manual_call_logged':
      return 'Ligação realizada';
    case 'manual_whatsapp_sent':
    case 'whatsapp_manual_confirmed':
    case 'whatsapp_contact_confirmed':
      return 'WhatsApp enviado';
    case 'manual_contact_made':
      return 'Contato realizado';
    case 'call_logged':
      return 'Ligação registrada';
    case 'meeting_logged':
      return 'Reunião';
    case 'sms_logged':
      return 'SMS registrado';
    case 'hubspot_activity_synced':
      return 'Atividade HubSpot';
    case 'email_dispatched':
      return 'Envio de email iniciado';
    case 'email_sent': {
      const templateKey = typeof meta?.template_key === 'string' ? meta.template_key : '';
      const summaryStr = typeof act?.summary === 'string' ? act.summary.toLowerCase() : '';
      if (
        templateKey.includes('course_details') ||
        templateKey === 'lead_intake_email' ||
        summaryStr.includes('primeiro contato') ||
        summaryStr.includes('email sent to')
      ) {
        return 'E-mail enviado — Automação / Primeiro Contato';
      }
      return 'E-mail enviado';
    }
    case 'email_delivered':
      return 'E-mail entregue';
    case 'email_opened':
      return 'Abertura detectada';
    case 'email_clicked':
      return 'Clique detectado';
    case 'email_delivery_delayed':
      return 'Entrega adiada temporariamente';
    case 'email_bounced':
      return 'E-mail retornado (Bounce)';
    case 'email_complained':
      return 'E-mail marcado como spam';
    case 'email_failed':
      return 'Falha no envio de e-mail';
    case 'email_suppressed':
      return 'E-mail suprimido pelo provedor';
    case 'email_unsubscribed':
      return 'Descadastro solicitado';
    case 'sms_dispatched':
      return 'Envio de SMS iniciado';
    case 'call_manual_attempt':
      return 'Ligação iniciada';
    case 'whatsapp_contact_attempt':
      return 'WhatsApp aberto';
    case 'email_manual_attempt':
      return 'Email aberto para contato';
    case 'sms_manual_attempt':
      return 'SMS aberto para contato';
    case 'lead_created':
      return 'Lead criado';
    case 'form_submitted':
      return 'Formulário enviado';
    case 'intake_received':
      return 'Entrada de dados recebida';
    case 'email_reply_received':
      return 'Resposta por email';
    case 'sms_reply_received':
      return 'Resposta por SMS';
    case 'task_created':
      return 'Tarefa criada';
    case 'task_completed':
      return 'Tarefa concluída';
    case 'task_rescheduled':
      return 'Tarefa reagendada';
    case 'stage_changed':
      return 'Estágio alterado';
    case 'hubspot_contact_linked':
      return 'Vinculado ao HubSpot';
    case 'hubspot_outbound_synced':
      return 'Sincronizado com HubSpot';
    case 'hubspot_sync_conflict':
      return 'Conflito de sincronização HubSpot';
    case 'note_created':
      return 'Nota adicionada';
    case 'enrollment_created':
      return 'Matrícula iniciada';
    case 'enrollment_confirmed':
      return 'Matrícula confirmada';
    case 'course_session_assigned':
      return 'Turma vinculada';
    case 'course_session_changed':
      return 'Turma alterada';
    case 'attendance_recorded':
      return 'Presença registrada';
    case 'course_completed':
      return 'Curso concluído';
    case 'student_no_show':
      return 'Não compareceu';
    case 'post_course_followup_created':
      return 'Follow-up pós-curso criado';
    case 'feedback_received':
      return 'Feedback recebido';
    case 'testimonial_received':
      return 'Depoimento recebido';
    case 'qualification_status_changed':
      return 'Qualificação atualizada';
    case 'incomplete_enrollment_captured':
      return 'Inscrição iniciada e não concluída';
    case 'incomplete_enrollment_recovered':
      return 'Inscrição recuperada — matrícula confirmada';
    case 'incomplete_enrollment_dismissed':
      return 'Alerta de inscrição dispensado';
    default:
      return activityType.replace(/_/g, ' ');
  }
}

function getActivityIcon(type: string, isHubSpot: boolean = false) {
  if (isHubSpot) {
    switch (type) {
      case 'call_logged':
      case 'manual_call_logged':
        return <Phone className="h-3 w-3 text-orange-600" />;
      case 'note_created':
        return <FileText className="h-3 w-3 text-orange-600" />;
      case 'meeting_logged':
        return <Calendar className="h-3 w-3 text-orange-600" />;
      case 'task_completed':
        return <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
      case 'task_created':
        return <CalendarCheck className="h-3 w-3 text-orange-600" />;
      case 'sms_logged':
      case 'sms_dispatched':
        return <MessageSquare className="h-3 w-3 text-orange-600" />;
      case 'whatsapp_contact_attempt':
        return <WhatsAppIcon className="h-3 w-3 text-emerald-600" />;
      default:
        return <RefreshCw className="h-3 w-3 text-orange-500" />;
    }
  }

  switch (type) {
    case 'manual_email_sent':
      return <Mail className="h-3 w-3 text-indigo-500" />;
    case 'manual_sms_sent':
    case 'sms_manual_confirmed':
      return <MessageSquare className="h-3 w-3 text-sky-500" />;
    case 'manual_call_logged':
    case 'call_logged':
      return <Phone className="h-3 w-3 text-[#449bd5]" />;
    case 'manual_whatsapp_sent':
    case 'whatsapp_manual_confirmed':
    case 'whatsapp_contact_confirmed':
      return <WhatsAppIcon className="h-3 w-3 text-emerald-600" />;
    case 'manual_contact_made':
      return <CheckCheck className="h-3 w-3 text-teal-600" />;
    case 'manual_activity_logged':
      return <FileText className="h-3 w-3 text-[#08254f]" />;
    case 'meeting_logged':
      return <Calendar className="h-3 w-3 text-purple-600" />;
    case 'incomplete_enrollment_captured':
      return <AlertCircle className="h-3 w-3 text-amber-500" />;
    case 'incomplete_enrollment_recovered':
      return <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
    case 'incomplete_enrollment_dismissed':
      return <Clock className="h-3 w-3 text-slate-400" />;
    case 'call_manual_attempt':
      return <Phone className="h-3 w-3 text-[#449bd5]" />;
    case 'whatsapp_contact_attempt':
      return <WhatsAppIcon className="h-3 w-3 text-emerald-600" />;
    case 'email_opened':
      return <Eye className="h-3 w-3 text-sky-500" />;
    case 'email_clicked':
      return <MousePointerClick className="h-3 w-3 text-indigo-600" />;
    case 'email_delivered':
      return <CheckCheck className="h-3 w-3 text-emerald-600" />;
    case 'email_dispatched':
    case 'email_sent':
    case 'email_manual_attempt':
    case 'email_reply_received':
      return <Mail className="h-3 w-3 text-indigo-500" />;
    case 'email_bounced':
    case 'email_failed':
      return <AlertTriangle className="h-3 w-3 text-rose-500" />;
    case 'email_complained':
    case 'email_suppressed':
      return <AlertCircle className="h-3 w-3 text-rose-600" />;
    case 'email_delivery_delayed':
      return <Clock className="h-3 w-3 text-amber-500" />;
    case 'sms_dispatched':
    case 'sms_manual_attempt':
    case 'sms_reply_received':
    case 'sms_logged':
      return <MessageSquare className="h-3 w-3 text-sky-500" />;
    case 'task_completed':
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    case 'task_created':
    case 'task_rescheduled':
      return <CalendarCheck className="h-3 w-3 text-amber-500" />;
    case 'hubspot_contact_linked':
    case 'hubspot_outbound_synced':
      return <RefreshCw className="h-3 w-3 text-orange-500" />;
    default:
      return <Activity className="h-3 w-3 text-slate-400" />;
  }
}

export function LeadTimeline({ activities, onOpenRegisterActivity }: LeadTimelineProps) {
  const attemptsCount = countContactAttempts(activities);

  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="card-executive p-5 space-y-4">
      {/* Header with Contact Attempts Counter & Register Activity CTA */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#449bd5]" />
          <h2 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider">
            Linha do Tempo ({activities.length})
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Action: Registrar Atividade */}
          {onOpenRegisterActivity && (
            <button
              type="button"
              onClick={onOpenRegisterActivity}
              data-testid="timeline-register-activity-button"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#08254f] bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-lg transition-colors cursor-pointer"
              title="Registrar atividade de contato manual"
            >
              <PlusCircle className="h-3.5 w-3.5 text-[#449bd5]" />
              <span>Registrar atividade</span>
            </button>
          )}

          {/* Tentativas de contato summary badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border select-none ${
              attemptsCount > 0
                ? 'bg-[#449bd5]/10 text-[#08254f] border-[#449bd5]/30'
                : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}
          >
            <span>Tentativas de contato:</span>
            <strong className="font-bold text-[#08254f]">{attemptsCount}</strong>
          </span>
        </div>
      </div>

      {/* Activity List */}
      {sortedActivities.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-6 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-1">
          <Clock className="h-5 w-5 text-slate-300" />
          <p className="text-xs font-medium text-slate-600">Nenhuma atividade registrada ainda</p>
          <p className="text-[11px] text-slate-400">
            Ações de contato, tarefas e eventos aparecerão aqui em ordem cronológica.
          </p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          {sortedActivities.map((act) => {
            const label = getActivityLabel(act.activity_type, act);
            const sourceInfo = getActivitySource(act);
            const date = new Date(act.created_at);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString('pt-BR');

            const meta = act.metadata as Record<string, any> | undefined;
            const isManual =
              meta?.manual === true ||
              meta?.source === 'manual' ||
              meta?.activity_source === 'manual' ||
              act.activity_type.startsWith('manual_');

            const isHubSpot = sourceInfo.isHubSpot;
            const createdByName = meta?.created_by_name || meta?.registered_by || null;
            const noteContent = meta?.activity_note || meta?.note || meta?.body || act.summary;
            const cleanNote = typeof noteContent === 'string' ? noteContent.replace(/<[^>]*>/g, '').trim() : '';

            return (
              <div key={act.id} className="relative text-xs">
                {/* Timeline Node Dot */}
                <div
                  className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-white border shadow-xs flex items-center justify-center ${
                    isHubSpot ? 'border-orange-300' : 'border-slate-200'
                  }`}
                >
                  {getActivityIcon(act.activity_type, isHubSpot)}
                </div>

                <div className="space-y-1">
                  {/* Top row: Label, Source Badge & Time */}
                  <div className="flex items-center justify-between text-[11px] gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-[#08254f]">{label}</span>

                      {/* Source Provenance Badge */}
                      <span
                        data-testid="activity-source-badge"
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${sourceInfo.badgeClass}`}
                      >
                        {sourceInfo.label}
                      </span>

                      {isManual && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-[#08254f] border border-blue-200/60">
                          Manual
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {dateStr} {timeStr}
                    </span>
                  </div>

                  {/* Manual Attribution Subheader: "Registrado manualmente por [User]" */}
                  {isManual && (
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      <User className="h-3 w-3 text-[#449bd5] shrink-0" />
                      <span>
                        Registrado manualmente por{' '}
                        <strong className="text-slate-700 font-semibold">
                          {createdByName || 'Operador'}
                        </strong>
                      </span>
                    </div>
                  )}

                  {/* HubSpot Call Context */}
                  {isHubSpot && (act.activity_type === 'call_logged' || act.activity_type === 'manual_call_logged') && (
                    <div className="text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
                      {meta?.direction && (
                        <span className="capitalize text-slate-500">
                          Direção: <strong>{meta.direction === 'inbound' ? 'Entrada' : 'Saída'}</strong>
                        </span>
                      )}
                      {(meta?.activity_subtype || meta?.status) && (
                        <span className="text-slate-500">
                          Resultado: <strong>{meta.activity_subtype || meta.status}</strong>
                        </span>
                      )}
                      {meta?.duration ? (
                        <span className="text-slate-400 font-mono">
                          Duração: {Math.round(Number(meta.duration) / 1000) > 0 ? `${Math.round(Number(meta.duration) / 1000)}s` : `${meta.duration}s`}
                        </span>
                      ) : null}
                    </div>
                  )}

                  {/* HubSpot Meeting Context */}
                  {isHubSpot && act.activity_type === 'meeting_logged' && meta?.activity_subtype && (
                    <div className="text-[11px] text-slate-500">
                      Status da reunião: <strong>{meta.activity_subtype}</strong>
                    </div>
                  )}

                  {/* HubSpot Task Context */}
                  {isHubSpot && (act.activity_type === 'task_created' || act.activity_type === 'task_completed') && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                      <span>
                        Status: <strong>{meta?.status === 'completed' ? 'Concluída' : 'Pendente'}</strong>
                      </span>
                      {meta?.priority && (
                        <span>
                          Prioridade: <strong>{meta.priority}</strong>
                        </span>
                      )}
                      {meta?.due_at && (
                        <span>
                          Vencimento: <strong>{new Date(meta.due_at).toLocaleDateString('pt-BR')}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Email Automation & Recipient Context */}
                  {(act.activity_type.startsWith('email_') || meta?.recipient) && meta?.recipient && !cleanNote.includes(meta.recipient) && (
                    <div className="text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
                      <span>
                        Destinatário: <strong className="font-mono text-slate-700">{meta.recipient}</strong>
                      </span>
                      {meta?.provider_message_id && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          ID: {String(meta.provider_message_id).slice(0, 16)}...
                        </span>
                      )}
                    </div>
                  )}

                  {/* Note / Content Body */}
                  {isManual ? (
                    <div className="mt-1 p-2.5 rounded-xl bg-slate-50/90 border border-slate-200/80 text-slate-700 text-xs leading-relaxed">
                      <p className="whitespace-pre-wrap">{noteContent}</p>
                    </div>
                  ) : isHubSpot && act.activity_type === 'note_created' && cleanNote ? (
                    <div className="mt-1 p-2.5 rounded-xl bg-orange-50/40 border border-orange-200/60 text-slate-700 text-xs leading-relaxed">
                      <p className="whitespace-pre-wrap">{cleanNote}</p>
                    </div>
                  ) : (
                    act.summary && (
                      <p className="text-slate-600 text-xs leading-relaxed">{act.summary}</p>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
