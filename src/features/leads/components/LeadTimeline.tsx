import { Activity, Phone, MessageSquare, Mail, CalendarCheck, CheckCircle2, RefreshCw, Clock } from 'lucide-react';
import type { LeadActivity } from '../../../types';
import { WhatsAppIcon } from '../../../components/icons/WhatsAppIcon';

interface LeadTimelineProps {
  activities: LeadActivity[];
}

/**
 * Canonical Contact Attempt Counter (Batch 4 Core Rule):
 * Counts ONLY confirmed outreach events:
 * - email_dispatched
 * - sms_dispatched
 * - call_manual_attempt
 * - whatsapp_contact_attempt
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
    case 'email_dispatched':
      return 'Envio de email iniciado';
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
    default:
      return activityType.replace(/_/g, ' ');
  }
}

function getActivityIcon(type: string) {
  switch (type) {
    case 'call_manual_attempt':
      return <Phone className="h-3 w-3 text-[#449bd5]" />;
    case 'whatsapp_contact_attempt':
      return <WhatsAppIcon className="h-3 w-3 text-emerald-600" />;
    case 'email_dispatched':
    case 'email_manual_attempt':
    case 'email_reply_received':
      return <Mail className="h-3 w-3 text-indigo-500" />;
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

export function LeadTimeline({ activities }: LeadTimelineProps) {
  const attemptsCount = countContactAttempts(activities);

  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="card-executive p-5 space-y-4">
      {/* Header with Contact Attempts Counter */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#449bd5]" />
          <h2 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider">
            Linha do Tempo ({activities.length})
          </h2>
        </div>

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
            const dateStr = date.toLocaleDateString();

            return (
              <div key={act.id} className="relative text-xs">
                {/* Timeline Node Dot */}
                <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-white border border-slate-200 shadow-xs flex items-center justify-center">
                  {getActivityIcon(act.activity_type)}
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-bold text-[#08254f]">
                      {label}
                    </span>
                    <span className="text-[10px] text-slate-400">{timeStr}</span>
                  </div>

                  {act.summary && (
                    <p className="text-slate-600 text-xs leading-relaxed">
                      {act.summary}
                    </p>
                  )}

                  <span className="text-[10px] text-slate-400 block pt-0.5">
                    {dateStr}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
