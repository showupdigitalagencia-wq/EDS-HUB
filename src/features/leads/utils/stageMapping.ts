// =============================================================================
// CSV Lead Status to Pipeline Stage Mapping
// =============================================================================

/**
 * Canonical mapping table from CSV status values to pipeline stage codes.
 */
export const CSV_STATUS_TO_STAGE_CODE: Record<string, string> = {
  // Novo Lead / Captura (capture)
  'new': 'capture',
  'new lead': 'capture',
  'newlead': 'capture',
  'captura': 'capture',
  'capture': 'capture',
  'novo lead': 'capture',
  'novo_lead': 'capture',
  'novo': 'capture',

  // Respondido / Qualificação (qualification)
  'qualified': 'qualification',
  'qualification': 'qualification',
  'qualificacao': 'qualification',
  'qualificação': 'qualification',
  'respondido': 'qualification',

  // Interessado / Aquisição (acquisition)
  'opportunity': 'acquisition',
  'acquisition': 'acquisition',
  'aquisicao': 'acquisition',
  'aquisição': 'acquisition',
  'interessado': 'acquisition',

  // Quente / Aprovação (approval)
  'approved': 'approval',
  'approval': 'approval',
  'aprovacao': 'approval',
  'aprovação': 'approval',
  'quente': 'approval',

  // Matrícula (enrollment)
  'enrolled': 'enrollment',
  'enrollment': 'enrollment',
  'matricula': 'enrollment',
  'matrícula': 'enrollment',

  // Pós-curso (post_course)
  'completed': 'post_course',
  'post-course': 'post_course',
  'post_course': 'post_course',
  'post course': 'post_course',
  'pos-curso': 'post_course',
  'pos_course': 'post_course',
  'pos curso': 'post_course',
  'pós-curso': 'post_course',
  'pós curso': 'post_course',

  // Alumni (alumni)
  'alumni': 'alumni',
};

/**
 * Normalizes a raw status string from CSV and returns the canonical
 * pipeline stage code, or null if empty, unrecognized, or unmapped.
 */
export function mapCsvStatusToStageCode(rawStatus?: string | null): string | null {
  if (!rawStatus) return null;
  const trimmed = rawStatus.trim().toLowerCase();
  if (!trimmed) return null;

  // Direct lookup
  if (CSV_STATUS_TO_STAGE_CODE[trimmed]) {
    return CSV_STATUS_TO_STAGE_CODE[trimmed];
  }

  // Normalized with spaces
  const normalizedSpaces = trimmed.replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
  if (CSV_STATUS_TO_STAGE_CODE[normalizedSpaces]) {
    return CSV_STATUS_TO_STAGE_CODE[normalizedSpaces];
  }

  // Normalized without spaces
  const noSpaces = trimmed.replace(/[-_\s]+/g, '');
  if (CSV_STATUS_TO_STAGE_CODE[noSpaces]) {
    return CSV_STATUS_TO_STAGE_CODE[noSpaces];
  }

  return null;
}
