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
 *
 * Excludes email_manual_attempt and sms_manual_attempt because mailto: / sms:
 * deep-links only confirm that the operator opened the client, not whether
 * the message was actually sent.
 *
 * Deduplicates outbound provider dispatches using outbound_message_id or message_id.
 */
export function countContactAttempts(activities: LeadActivity[]): number {
  const COUNTABLE_TYPES = new Set([
    'email_dispatched',
    'sms_dispatched',
    'call_manual_attempt',
    'whatsapp_contact_attempt',
    'manual_email_sent',
    'manual_sms_sent',
    'manual_call_logged',
    'manual_whatsapp_sent',
    'manual_contact_made',
  ]);

  const seenKeys = new Set<string>();
  let total = 0;

  for (const act of activities) {
    if (!COUNTABLE_TYPES.has(act.activity_type)) continue;

    const meta = act.metadata as Record<string, any> | undefined;
    const dedupeKey =
      meta?.outbound_message_id ||
      meta?.message_id ||
      `act-${act.id}`;

    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      total++;
    }
  }

  return total;
}

/**
 * Translates activity_type into honest, client-facing Portuguese labels.
 * Avoids claiming delivery/opened/read when provider data only proves dispatch.
 */
export function getActivityLabel(activityType: string): string {
  switch (activityType) {
    case 'manual_email_sent':
      return 'E-mail enviado';
    case 'manual_sms_sent':
      return 'SMS enviado';
    case 'manual_call_logged':
      return 'Ligação realizada';
    case 'manual_whatsapp_sent':
      return 'WhatsApp enviado';
    case 'manual_contact_made':
      return 'Contato realizado';
    case 'manual_activity_logged':
      return 'Observação / Outro';
    case 'email_dispatched':
      return 'Envio de email iniciado';
    case 'email_sent':
      return 'E-mail enviado';
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

function getActivityIcon(type: string) {
  switch (type) {
    case 'manual_email_sent':
      return <Mail className="h-3 w-3 text-indigo-500" />;
    case 'manual_sms_sent':
      return <MessageSquare className="h-3 w-3 text-sky-500" />;
    case 'manual_call_logged':
      return <Phone className="h-3 w-3 text-[#449bd5]" />;
    case 'manual_whatsapp_sent':
      return <WhatsAppIcon className="h-3 w-3 text-emerald-600" />;
    case 'manual_contact_made':
      return <CheckCheck className="h-3 w-3 text-teal-600" />;
    case 'manual_activity_logged':
      return <FileText className="h-3 w-3 text-[#08254f]" />;
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
            const label = getActivityLabel(act.activity_type);
            const date = new Date(act.created_at);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString('pt-BR');

            const meta = act.metadata as Record<string, any> | undefined;
            const isManual =
              meta?.manual === true ||
              meta?.source === 'manual' ||
              meta?.activity_source === 'manual' ||
              act.activity_type.startsWith('manual_');

            const createdByName = meta?.created_by_name || meta?.registered_by || null;
            const noteContent = meta?.activity_note || meta?.note || act.summary;

            return (
              <div key={act.id} className="relative text-xs">
                {/* Timeline Node Dot */}
                <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-white border border-slate-200 shadow-xs flex items-center justify-center">
                  {getActivityIcon(act.activity_type)}
                </div>

                <div className="space-y-1">
                  {/* Top row: Label & Time */}
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#08254f]">
                        {label}
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

                  {/* Content / Note */}
                  {isManual ? (
                    <div className="mt-1 p-2.5 rounded-xl bg-slate-50/90 border border-slate-200/80 text-slate-700 text-xs leading-relaxed">
                      <p className="whitespace-pre-wrap">{noteContent}</p>
                    </div>
                  ) : (
                    act.summary && (
                      <p className="text-slate-600 text-xs leading-relaxed">
                        {act.summary}
                      </p>
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
