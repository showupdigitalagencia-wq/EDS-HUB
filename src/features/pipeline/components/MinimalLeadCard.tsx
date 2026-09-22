import React from 'react';
import type { Lead } from '../../../types';
import { GripVertical, AlertTriangle, Clock, AlertCircle } from 'lucide-react';

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

interface MinimalLeadCardProps {
  lead: Lead;
  interests?: FormattedCourseInterest[];
  attentionState?: OperationalAttentionState | null;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: () => void;
}

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
  isDragging = false,
  onDragStart,
  onClick,
}: MinimalLeadCardProps) {
  const fullName =
    [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead sem nome';

  // Sort and limit up to 3 prioritized interests
  const displayInterests = interests
    .filter((i) => Boolean(i.courseName))
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .slice(0, 3);

  // Fallback to legacy lead.course_interest if no relational interests exist
  const hasInterests = displayInterests.length > 0;
  const legacyCourseInterest = !hasInterests && lead.course_interest ? lead.course_interest : null;

  return (
    <div
      role="article"
      aria-label={`Lead ${fullName}`}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`p-3 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:shadow-md hover:border-[#449bd5]/50 transition-all duration-150 cursor-grab active:cursor-grabbing space-y-2 select-none group ${
        isDragging ? 'opacity-40 scale-95 border-dashed border-[#449bd5]' : ''
      }`}
    >
      {/* Header: Lead Name + Drag Grip */}
      <div className="flex items-start justify-between gap-1.5">
        <h4 className="text-xs font-bold font-heading text-[#08254f] leading-snug line-clamp-1 group-hover:text-[#449bd5] transition-colors">
          {fullName}
        </h4>
        <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5" />
      </div>

      {/* Course Interests (Up to 3, formatted: Course • Month Year) */}
      <div className="space-y-1">
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
                <span className="truncate">{label}</span>
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
            className="text-[11px] font-medium text-slate-700 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 truncate"
            title={legacyCourseInterest}
          >
            {legacyCourseInterest}
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 italic px-0.5">
            Nenhum curso selecionado
          </div>
        )}
      </div>

      {/* Operational Attention State Indicator (When applicable) */}
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
