/**
 * Formats a date string for display.
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    return new Date(dateString).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

/**
 * Formats a relative time string (e.g. "2 minutes ago").
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateString);
  } catch {
    return '—';
  }
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Formats a course cohort date range in natural Portuguese.
 * E.g., ("2026-11-07", "2026-11-10") -> "7–10 de novembro de 2026"
 */
export function formatCohortDateRange(startDateStr?: string | null, endDateStr?: string | null): string {
  if (!startDateStr) return 'Data a definir';
  try {
    const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
    if (!endDateStr) {
      return `${startDay} de ${MONTHS_PT[startMonth - 1]} de ${startYear}`;
    }
    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);

    if (startYear === endYear && startMonth === endMonth) {
      return `${startDay}–${endDay} de ${MONTHS_PT[startMonth - 1]} de ${startYear}`;
    }

    if (startYear === endYear) {
      return `${startDay} de ${MONTHS_PT[startMonth - 1]} a ${endDay} de ${MONTHS_PT[endMonth - 1]} de ${startYear}`;
    }

    return `${startDay} de ${MONTHS_PT[startMonth - 1]} de ${startYear} a ${endDay} de ${MONTHS_PT[endMonth - 1]} de ${endYear}`;
  } catch {
    return `${startDateStr} a ${endDateStr || ''}`.trim();
  }
}

