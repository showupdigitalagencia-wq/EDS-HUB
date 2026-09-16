// =============================================================================
// Qualification Status Mapping and Utilities
// =============================================================================

import type { QualificationStatus } from '../../../types';

/**
 * Normalizes raw qualification status strings from HubSpot or CSV exports
 * to the canonical QualificationStatus enum, or returns null if empty or unknown.
 */
export function mapHubspotQualificationStatus(raw?: string | null): QualificationStatus | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  // Remove accents for resilient matching (e.g., 'qualificação' -> 'qualificacao')
  const clean = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ');

  switch (clean) {
    case 'sem resposta':
    case 'semresposta':
    case 'no response':
    case 'no_response':
    case 'noresponse':
      return 'no_response';

    case 'alguma resposta':
    case 'algumaresposta':
    case 'some response':
    case 'some_response':
    case 'someresponse':
      return 'some_response';

    case 'interessado':
    case 'interessada':
    case 'interested':
      return 'interested';

    case 'quente':
    case 'hot':
      return 'hot';

    case 'confirmado':
    case 'confirmada':
    case 'confirmed':
      return 'confirmed';

    default:
      return null;
  }
}

/**
 * Returns user-facing English label for a qualification status.
 */
export function getQualificationStatusLabel(status?: QualificationStatus | null): string {
  if (!status) return 'None';
  switch (status) {
    case 'no_response':
      return 'No Response';
    case 'some_response':
      return 'Some Response';
    case 'interested':
      return 'Interested';
    case 'hot':
      return 'Hot';
    case 'confirmed':
      return 'Confirmed';
    default:
      return 'None';
  }
}

/**
 * Returns Tailwind badge classes for styling qualification status chips.
 */
export function getQualificationStatusBadge(status?: QualificationStatus | null): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  const label = getQualificationStatusLabel(status);
  switch (status) {
    case 'hot':
      return {
        label,
        bg: 'bg-rose-50 dark:bg-rose-950/40',
        text: 'text-rose-700 dark:text-rose-400',
        border: 'border-rose-200 dark:border-rose-800/60',
      };
    case 'confirmed':
      return {
        label,
        bg: 'bg-emerald-50 dark:bg-emerald-950/40',
        text: 'text-emerald-700 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800/60',
      };
    case 'interested':
      return {
        label,
        bg: 'bg-sky-50 dark:bg-sky-950/40',
        text: 'text-sky-700 dark:text-sky-400',
        border: 'border-sky-200 dark:border-sky-800/60',
      };
    case 'some_response':
      return {
        label,
        bg: 'bg-amber-50 dark:bg-amber-950/40',
        text: 'text-amber-700 dark:text-amber-400',
        border: 'border-amber-200 dark:border-amber-800/60',
      };
    case 'no_response':
      return {
        label,
        bg: 'bg-slate-100 dark:bg-slate-800',
        text: 'text-slate-700 dark:text-slate-300',
        border: 'border-slate-200 dark:border-slate-700',
      };
    default:
      return {
        label: 'None',
        bg: 'bg-gray-100 dark:bg-gray-800',
        text: 'text-gray-500 dark:text-gray-400',
        border: 'border-gray-200 dark:border-gray-700',
      };
  }
}

/**
 * Normalizes phone string to digits-only representation for exact matching.
 */
export function normalizePhoneDigits(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}
