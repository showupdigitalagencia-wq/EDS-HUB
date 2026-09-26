import React from 'react';
import type { Lead } from '../../../types';
import type { LeadDeliverabilityInfo } from '../../dashboard/services/deliverability-health-service';
import {
  GripVertical,
  AlertTriangle,
  Clock,
  AlertCircle,
  Phone,
  Mail,
  GraduationCap,
} from 'lucide-react';

export interface FormattedCourseInterest {
  courseName: string;
  sessionTitle?: string | null;
  startDate?: string | null;
  priority?: 1 | 2 | 3 | null;
}

export interface OperationalAttentionState {
  label: string;
  variant: 'neutral' | 'warning' | 'error' | 'info';
}

export interface MinimalLeadCardProps {
  lead: Lead;
  interests?: FormattedCourseInterest[];
  attentionState?: OperationalAttentionState | null;
  deliverabilityHealth?: LeadDeliverabilityInfo | null;
  stageCode?: string | null;
  stageName?: string | null;
  isClosed?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: () => void;
  onDeliverabilityClick?: (e: React.MouseEvent) => void;
}

/**
 * Evaluates whether a lead is in a closed/won/completed state.
 * Deliverability health signal is strictly hidden for closed leads.
 */
export function isLeadClosed(
  lead: Lead,
  stage?: { code?: string; name?: string } | null,
  isClosedExplicit?: boolean
): boolean {
  if (isClosedExplicit !== undefined) return isClosedExplicit;
  if ((lead as any).is_closed === true) return true;
  if ((lead as any).status === 'closed' || (lead as any).status === 'won' || (lead as any).status === 'lost') return true;

  const stageCode = (stage?.code || (lead as any).stage_code || '').toLowerCase();
  const stageName = (stage?.name || (lead as any).stage_name || '').toLowerCase();

  const closedCodes = ['enrollment', 'post_course', 'alumni', 'closed', 'won', 'lost', 'archived', 'completed'];
  if (closedCodes.includes(stageCode)) return true;

  if (
    stageName.includes('matrícula') ||
    stageName.includes('matriculado') ||
    stageName.includes('ganho') ||
    stageName.includes('perdido') ||
    stageName.includes('arquivado') ||
    stageName.includes('desqualificado') ||
    stageName.includes('fechado')
  ) {
    return true;
  }

  return false;
}

import {
  formatContactPreferenceLabel,
  getContactPreferenceBadgeClasses,
} from '../../../utils/contact-preference';
export { formatContactPreferenceLabel, getContactPreferenceBadgeClasses };

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function formatSessionMonthYear(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  try {
    const parts = dateStr.split('-');
    if (parts.length >= 2) {
      const year = parts[0];
      const monthIndex = parseInt(parts[1], 10) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        return `${MONTH_NAMES[monthIndex]} ${year}`;
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
  } catch {
    // fallback to null
  }
  return null;
}

export function resolveAttentionState(
  lead: Lead,
  activitiesSummary?: string[],
): OperationalAttentionState | null {
  // 1. Website leads in capture (Novo Lead): Aguardando resposta manual
  if (lead.source === 'form' || lead.source_detail === 'website') {
    return {
      label: 'Aguardando resposta manual',
      variant: 'neutral',
    };
  }

  // 2. Check for explicit activity indicators if provided
  if (activitiesSummary && activitiesSummary.length > 0) {
    const hasPartialFailure = activitiesSummary.some(
      (s) =>
        s.toLowerCase().includes('partial failure') ||
        s.toLowerCase().includes('falha parcial'),
    );
    const hasInitialFailure = activitiesSummary.some(
      (s) =>
        !s.toLowerCase().includes('partial') &&
        (s.includes('Falha no primeiro contato') ||
          s.includes('Intake processing failed') ||
          s.toLowerCase().includes('failure')),
    );

    if (hasPartialFailure) {
      return {
        label: 'Falha parcial',
        variant: 'warning',
      };
    }
    if (hasInitialFailure) {
      return {
        label: 'Falha no primeiro contato',
        variant: 'error',
      };
    }
  }

  // 3. Fallback check for Meta leads in capture without failure: Aguardando contato
  if (lead.source === 'meta' && lead.source_detail === 'lead_gen_ad') {
    return {
      label: 'Aguardando contato',
      variant: 'info',
    };
  }

  return null;
}

export function MinimalLeadCard({
  lead,
  interests = [],
  attentionState,
  deliverabilityHealth,
  stageCode,
  stageName,
  isClosed,
  isDragging = false,
  onDragStart,
  onClick,
  onDeliverabilityClick,
}: MinimalLeadCardProps) {
  const fullName =
    [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead sem nome';

  const isClosedLead = isLeadClosed(
    lead,
    { code: stageCode || undefined, name: stageName || undefined },
    isClosed
  );

  // Sort and limit up to 3 prioritized interests
  const displayInterests = interests
    .filter((i) => Boolean(i.courseName))
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .slice(0, 3);

  // Fallback to legacy lead.course_interest if no relational interests exist
  const hasInterests = displayInterests.length > 0;
  const legacyCourseInterest = !hasInterests && lead.course_interest ? lead.course_interest : null;

  const phoneValue = lead.phone_raw || lead.phone_e164 || null;
  const emailValue = lead.email ? lead.email.trim() : null;

  const isDraggingInternal = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = React.useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    hasMovedRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 6 || dy > 6) {
      hasMovedRef.current = true;
    }
  };

  const handlePointerUp = () => {
    pointerStartRef.current = null;
  };

  const handleDragStart = (e: React.DragEvent) => {
    isDraggingInternal.current = true;
    hasMovedRef.current = true;
    try {
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
      }
    } catch {
      // Safe fallback for testing environments
    }
    if (onDragStart) onDragStart(e);
  };

  const handleDragEnd = () => {
    setTimeout(() => {
      isDraggingInternal.current = false;
      hasMovedRef.current = false;
    }, 200);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isDraggingInternal.current || hasMovedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (onClick) onClick();
  };

  return (
    <div
      role="article"
      aria-label={`Lead ${fullName}`}
      draggable
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      className={`p-3 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:shadow-md hover:border-[#449bd5]/50 transition-all duration-150 cursor-grab active:cursor-grabbing space-y-1.5 select-none group ${
        isDragging
          ? 'opacity-40 scale-[0.98] border-dashed border-[#449bd5] shadow-lg ring-2 ring-[#449bd5]/30'
          : ''
      }`}
    >
      {/* 1. Lead Name + Drag Grip (Strongest visual emphasis) */}
      <div className="flex items-start justify-between gap-1.5">
        <h4 className="text-xs font-bold font-heading text-[#08254f] leading-snug line-clamp-1 group-hover:text-[#449bd5] transition-colors">
          {fullName}
        </h4>
        <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5" />
      </div>

      {/* 2 & 3. Phone & Email (Display-only, non-clickable to prevent accidental actions) */}
      {(phoneValue || emailValue) ? (
        <div className="flex flex-col items-start gap-0.5 pt-0.5">
          {phoneValue && (
            <div
              className="inline-flex w-fit max-w-full items-center gap-1.5 py-0.5 px-1 -ml-1 text-[11px] text-slate-600 select-none"
              title={phoneValue}
            >
              <Phone className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate">{phoneValue}</span>
            </div>
          )}
          {emailValue && (
            <div
              className="inline-flex w-fit max-w-full items-center gap-1.5 py-0.5 px-1 -ml-1 text-[11px] text-slate-500 select-none"
              title={emailValue}
            >
              <Mail className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate">{emailValue}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[10px] text-slate-400 italic pt-0.5">
          Contato não informado
        </div>
      )}

      {/* Contact Preference Badge — Canonical preference indicator (ALWAYS VISIBLE & COEXISTS) */}
      <div className="pt-1 flex items-center">
        <span
          data-testid="contact-preference-badge"
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md border select-none max-w-full truncate ${
            getContactPreferenceBadgeClasses(lead.contact_preference).badge
          }`}
        >
          {formatContactPreferenceLabel(lead.contact_preference)}
        </span>
      </div>

      {/* Deliverability Health Indicator — Factual Delivery Status + Deliverability Risk (COEXISTS WITH PREFERENCE) */}
      {!isClosedLead && deliverabilityHealth && (
        <div className="pt-0.5 flex flex-wrap items-center gap-1.5">
          {/* 1. Factual Delivery Status Badge */}
          <div
            role="status"
            aria-label={`Status factual do e-mail: ${deliverabilityHealth.factualStatus?.label || deliverabilityHealth.label}`}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-md border transition-colors select-none max-w-full truncate cursor-pointer ${
              deliverabilityHealth.factualStatus?.badgeClass || deliverabilityHealth.badgeClass
            }`}
            title={
              deliverabilityHealth.risk?.reasons && deliverabilityHealth.risk.reasons.length > 0
                ? `${deliverabilityHealth.description}\nMotivos:\n• ${deliverabilityHealth.risk.reasons.join('\n• ')}`
                : deliverabilityHealth.description
            }
            data-testid="deliverability-health-badge"
            data-status={deliverabilityHealth.status}
            data-factual-status={deliverabilityHealth.factualStatus?.status}
            onClick={(e) => {
              if (onDeliverabilityClick) {
                e.stopPropagation();
                onDeliverabilityClick(e);
              }
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                deliverabilityHealth.factualStatus?.dotColor || deliverabilityHealth.dotColor
              }`}
            />
            <span className="truncate">
              {deliverabilityHealth.factualStatus?.label || deliverabilityHealth.label}
            </span>
          </div>

          {/* 2. Deliverability Risk Badge (Separated from Factual Status) */}
          {deliverabilityHealth.risk && deliverabilityHealth.risk.level !== 'sem_historico' && (
            <span
              data-testid="deliverability-risk-badge"
              data-risk={deliverabilityHealth.risk.level}
              className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded-md border select-none transition-colors ${deliverabilityHealth.risk.badgeClass}`}
              title={
                deliverabilityHealth.risk.reasons.length > 0
                  ? `Risco ${deliverabilityHealth.risk.label}:\n• ${deliverabilityHealth.risk.reasons.join('\n• ')}`
                  : `Risco de entregabilidade: ${deliverabilityHealth.risk.label}`
              }
            >
              Risco: {deliverabilityHealth.risk.label}
            </span>
          )}
        </div>
      )}

      {/* 4. Course Interests (Up to 3, formatted: Course • Month Year) */}
      <div className="space-y-1 pt-1 border-t border-slate-100/80">
        {hasInterests ? (
          displayInterests.map((interest, idx) => {
            const formattedDate = formatSessionMonthYear(interest.startDate);
            const label = formattedDate
              ? `${interest.courseName} • ${formattedDate}`
              : interest.courseName;

            return (
              <div
                key={idx}
                className="text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-slate-100/80 px-2 py-0.5 rounded-md border border-slate-100 truncate flex items-center justify-between gap-1"
                title={label}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <GraduationCap className="h-3 w-3 text-[#449bd5] shrink-0" />
                  <span className="truncate">{label}</span>
                </div>
                {interest.priority && (
                  <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                    #{interest.priority}
                  </span>
                )}
              </div>
            );
          })
        ) : legacyCourseInterest ? (
          <div
            className="text-[11px] font-medium text-slate-700 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 truncate flex items-center gap-1.5"
            title={legacyCourseInterest}
          >
            <GraduationCap className="h-3 w-3 text-[#449bd5] shrink-0" />
            <span className="truncate">{legacyCourseInterest}</span>
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 italic px-0.5">
            Sem curso de interesse
          </div>
        )}
      </div>

      {/* 5. Operational Attention State Indicator (Only when relevant) */}
      {attentionState && (
        <div className="pt-0.5">
          {attentionState.variant === 'neutral' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-slate-600 bg-slate-100/80 border border-slate-200 rounded-md">
              <Clock className="h-2.5 w-2.5 text-slate-400 shrink-0" />
              <span className="truncate">{attentionState.label}</span>
            </span>
          )}

          {attentionState.variant === 'error' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-md">
              <AlertCircle className="h-2.5 w-2.5 text-rose-600 shrink-0" />
              <span className="truncate">{attentionState.label}</span>
            </span>
          )}

          {attentionState.variant === 'warning' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md">
              <AlertTriangle className="h-2.5 w-2.5 text-amber-600 shrink-0" />
              <span className="truncate">{attentionState.label}</span>
            </span>
          )}

          {attentionState.variant === 'info' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-md">
              <Clock className="h-2.5 w-2.5 text-sky-600 shrink-0" />
              <span className="truncate">{attentionState.label}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
