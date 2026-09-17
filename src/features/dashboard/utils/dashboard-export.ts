// =============================================================================
// Dashboard CSV Export Utilities
// =============================================================================
// RFC 4180 compliant CSV export for Priority Leads, Needs Attention, and Pipeline
// =============================================================================

import type {
  DashboardPriorityLead,
  DashboardNeedsAttentionItem,
  DashboardPipelineMetrics,
} from '../../../types/database';

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports Priority Leads dataset to CSV matching dashboard view
 */
export function exportPriorityLeadsToCsv(
  leads: DashboardPriorityLead[],
  periodLabel: string
): void {
  const headers = [
    'ID',
    'Nome',
    'Email',
    'Telefone',
    'Score',
    'Categoria Score',
    'Estágio Pipeline',
    'Qualificação',
    'Interesse Curso',
    'Criado em',
  ];

  const rows = leads.map((l) => [
    l.id,
    [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Não informado',
    l.email || '',
    l.phone_e164 || '',
    l.lead_score ?? 'Sem score',
    l.lead_score_category,
    l.stage_name,
    l.qualification_status || 'Não definido',
    l.course_interest || 'Não informado',
    l.created_at ? new Date(l.created_at).toLocaleString('pt-BR') : '',
  ]);

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\r\n');

  const cleanLabel = periodLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
  downloadCsv(`eds_leads_prioritarios_${cleanLabel}.csv`, csvContent);
}

/**
 * Exports Needs Attention dataset to CSV with explicit reason_codes
 */
export function exportNeedsAttentionToCsv(
  items: DashboardNeedsAttentionItem[],
  periodLabel: string
): void {
  const headers = [
    'ID Lead',
    'Nome Lead',
    'Email Lead',
    'Código Motivo',
    'Motivo da Atenção',
    'Detalhes',
    'Detectado em',
  ];

  const rows = items.map((item) => [
    item.lead_id,
    item.lead_name,
    item.lead_email || '',
    item.reason_code,
    item.reason_label,
    item.detail,
    item.detected_at ? new Date(item.detected_at).toLocaleString('pt-BR') : '',
  ]);

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\r\n');

  const cleanLabel = periodLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
  downloadCsv(`eds_leads_precisam_atencao_${cleanLabel}.csv`, csvContent);
}

/**
 * Exports Pipeline and Funnel Summary to CSV
 */
export function exportPipelineSummaryToCsv(
  pipeline: DashboardPipelineMetrics,
  periodLabel: string
): void {
  // Section 1: Funnel Cohort
  const funnelHeaders = [
    'Ordem',
    'Estágio Comercial',
    'Código',
    'Leads Únicos Entraram (Cohort)',
    'Conversão do Estágio Anterior',
  ];

  const funnelRows = pipeline.funnel.map((f) => [
    f.sort_order,
    f.stage_name,
    f.stage_code,
    f.unique_leads_entered,
    f.conversion_from_prev !== null ? `${f.conversion_from_prev.toFixed(1)}%` : '—',
  ]);

  // Section 2: Current Distribution
  const distHeaders = [
    'Ordem',
    'Estágio Atual (Snapshot)',
    'Código',
    'Total de Leads',
    'Participação (%)',
  ];

  const distRows = pipeline.current_distribution.map((d) => [
    d.sort_order,
    d.stage_name,
    d.stage_code,
    d.lead_count,
    `${d.percentage.toFixed(1)}%`,
  ]);

  const csvContent = [
    escapeCsvCell('FUNIL DE VENDAS (COHORT-BASED) - ' + periodLabel),
    funnelHeaders.map(escapeCsvCell).join(','),
    ...funnelRows.map((r) => r.map(escapeCsvCell).join(',')),
    '',
    escapeCsvCell('DISTRIBUIÇÃO ATUAL DO PIPELINE (SNAPSHOT)'),
    distHeaders.map(escapeCsvCell).join(','),
    ...distRows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\r\n');

  const cleanLabel = periodLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
  downloadCsv(`eds_resumo_pipeline_${cleanLabel}.csv`, csvContent);
}
