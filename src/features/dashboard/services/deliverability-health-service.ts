// =============================================================================
// EDS HUB — Email Deliverability Health Service
// =============================================================================
// Evaluates factual email deliverability based on verified provider events.
// Centralizes classification thresholds, sample size guards, rolling windows,
// and suppressions audit without arbitrary scores or speculative metrics.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type { Lead } from '../../../types';

export type DeliverabilityHealthLevel =
  | 'Excelente'
  | 'Saudável'
  | 'Atenção'
  | 'Risco'
  | 'Crítico'
  | 'Dados insuficientes';

export interface DeliverabilityRawMetrics {
  sent: number;
  delivered: number;
  bounced: number;
  complaints: number;
  failed: number;
  suppressed: number;
}

export interface DeliverabilityRates {
  deliveryRate: number | null; // e.g. 98.5 (%)
  bounceRate: number | null;   // e.g. 1.2 (%)
  complaintRate: number | null; // e.g. 0.0 (%)
  failureRate: number | null;  // e.g. 0.3 (%)
}

export interface EmailSuppressionRecord {
  id: string;
  normalized_email: string;
  reason: 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual';
  provider: string;
  created_at: string;
  updated_at?: string;
}

export interface DeliverabilityHealthSummary {
  level: DeliverabilityHealthLevel;
  levelExplanation: string;
  isSufficientData: boolean;
  sampleCount: number;
  minSampleRequired: number;
  windowDays: number;
  metrics: DeliverabilityRawMetrics;
  rates: DeliverabilityRates;
  alerts: string[];
  lastUpdated: string;
}

export type LeadEmailHealthStatus =
  | 'saudavel'
  | 'falha'
  | 'reclamacao'
  | 'suprimido'
  | 'sem_historico';

export interface LeadEmailHealthResult {
  status: LeadEmailHealthStatus;
  label: string;
  badgeClass: string;
  details?: string;
}

// =============================================================================
// Centralized Conservative Thresholds & Configuration
// =============================================================================
export const DELIVERABILITY_CONFIG = {
  MIN_SAMPLE_SIZE: 50,
  ROLLING_WINDOW_DAYS: 30,
  THRESHOLDS: {
    CRITICAL: {
      BOUNCE_RATE: 5.0,     // > 5% bounce rate
      COMPLAINT_RATE: 0.5,  // > 0.5% complaint rate
      FAILURE_RATE: 15.0,   // > 15% technical failure rate
    },
    RISK: {
      BOUNCE_RATE: 3.0,     // > 3% bounce rate
      COMPLAINT_RATE: 0.2,  // > 0.2% complaint rate
      FAILURE_RATE: 10.0,   // > 10% technical failure rate
    },
    ATTENTION: {
      BOUNCE_RATE: 1.5,     // > 1.5% bounce rate
      COMPLAINT_RATE: 0.05, // > 0.05% complaint rate
      FAILURE_RATE: 5.0,    // > 5% technical failure rate
    },
    HEALTHY: {
      MIN_DELIVERY_RATE: 95.0,
      MAX_BOUNCE_RATE: 1.5,
      MAX_COMPLAINT_RATE: 0.0,
    },
    EXCELLENT: {
      MIN_DELIVERY_RATE: 98.0,
      MAX_BOUNCE_RATE: 1.0,
      MAX_COMPLAINT_RATE: 0.0,
      MAX_FAILURE_RATE: 2.0,
    },
  },
} as const;

/**
 * Pure calculation of deliverability rates given raw counts.
 * Returns null for rates when denominator is 0.
 * NEVER calculates or returns Open/Read/Seen rates.
 */
export function calculateDeliverabilityRates(metrics: DeliverabilityRawMetrics): DeliverabilityRates {
  const { sent, delivered, bounced, complaints, failed } = metrics;
  if (sent <= 0) {
    return {
      deliveryRate: null,
      bounceRate: null,
      complaintRate: null,
      failureRate: null,
    };
  }

  const round = (val: number) => Math.round(val * 10) / 10;

  return {
    deliveryRate: round((delivered / sent) * 100),
    bounceRate: round((bounced / sent) * 100),
    complaintRate: round((complaints / sent) * 100),
    failureRate: round((failed / sent) * 100),
  };
}

/**
 * Rules-based, explainable classification of deliverability health.
 * Enforces minimum sample guard (<50 sends -> 'Dados insuficientes').
 * A single complaint triggers an operational alert without falsely making domain Critical if volume is high.
 */
export function classifyDeliverabilityHealth(
  metrics: DeliverabilityRawMetrics,
  minSample: number = DELIVERABILITY_CONFIG.MIN_SAMPLE_SIZE
): {
  level: DeliverabilityHealthLevel;
  levelExplanation: string;
  isSufficientData: boolean;
  rates: DeliverabilityRates;
  alerts: string[];
} {
  const rates = calculateDeliverabilityRates(metrics);
  const alerts: string[] = [];

  // Factual operational alerts based on event triggers
  if (metrics.complaints > 0) {
    alerts.push(
      metrics.complaints === 1
        ? 'Alerta: uma reclamação de spam foi registrada.'
        : `Alerta: ${metrics.complaints} reclamações de spam foram registradas.`
    );
  }

  if (rates.bounceRate !== null && rates.bounceRate > DELIVERABILITY_CONFIG.THRESHOLDS.ATTENTION.BOUNCE_RATE) {
    alerts.push('Risco de entregabilidade: a taxa de bounce aumentou.');
  }

  if (rates.failureRate !== null && rates.failureRate > DELIVERABILITY_CONFIG.THRESHOLDS.ATTENTION.FAILURE_RATE) {
    alerts.push('Atenção: houve aumento nas falhas de entrega.');
  }

  // Minimum sample guard: if sent < 50, strictly return 'Dados insuficientes'
  if (metrics.sent < minSample) {
    return {
      level: 'Dados insuficientes',
      levelExplanation: `Amostra insuficiente para avaliação estatística (${metrics.sent} de no mínimo ${minSample} envios nos últimos ${DELIVERABILITY_CONFIG.ROLLING_WINDOW_DAYS} dias).`,
      isSufficientData: false,
      rates,
      alerts,
    };
  }

  const bounce = rates.bounceRate ?? 0;
  const complaint = rates.complaintRate ?? 0;
  const failure = rates.failureRate ?? 0;
  const delivery = rates.deliveryRate ?? 0;

  // 1. Crítico
  if (
    bounce >= DELIVERABILITY_CONFIG.THRESHOLDS.CRITICAL.BOUNCE_RATE ||
    (metrics.complaints > 1 && complaint >= DELIVERABILITY_CONFIG.THRESHOLDS.CRITICAL.COMPLAINT_RATE) ||
    failure >= DELIVERABILITY_CONFIG.THRESHOLDS.CRITICAL.FAILURE_RATE
  ) {
    return {
      level: 'Crítico',
      levelExplanation: 'Taxas de rejeição, múltiplas reclamações ou falhas técnicas em níveis críticos.',
      isSufficientData: true,
      rates,
      alerts,
    };
  }

  // 2. Risco
  if (
    bounce >= DELIVERABILITY_CONFIG.THRESHOLDS.RISK.BOUNCE_RATE ||
    (metrics.complaints > 1 && complaint >= DELIVERABILITY_CONFIG.THRESHOLDS.RISK.COMPLAINT_RATE) ||
    failure >= DELIVERABILITY_CONFIG.THRESHOLDS.RISK.FAILURE_RATE
  ) {
    return {
      level: 'Risco',
      levelExplanation: 'Taxa de bounce ou falhas elevada em relação aos padrões de entrega saudáveis.',
      isSufficientData: true,
      rates,
      alerts,
    };
  }

  // 3. Atenção (single complaint or moderate bounce/failure)
  if (
    bounce >= DELIVERABILITY_CONFIG.THRESHOLDS.ATTENTION.BOUNCE_RATE ||
    metrics.complaints > 0 ||
    failure >= DELIVERABILITY_CONFIG.THRESHOLDS.ATTENTION.FAILURE_RATE
  ) {
    return {
      level: 'Atenção',
      levelExplanation:
        metrics.complaints === 1
          ? 'Reclamação pontual de spam registrada. Atenção operacional recomendada.'
          : 'Pequenas variações de bounce ou falhas identificadas.',
      isSufficientData: true,
      rates,
      alerts,
    };
  }

  // 4. Excelente
  if (
    delivery >= DELIVERABILITY_CONFIG.THRESHOLDS.EXCELLENT.MIN_DELIVERY_RATE &&
    bounce <= DELIVERABILITY_CONFIG.THRESHOLDS.EXCELLENT.MAX_BOUNCE_RATE &&
    complaint === 0 &&
    failure <= DELIVERABILITY_CONFIG.THRESHOLDS.EXCELLENT.MAX_FAILURE_RATE
  ) {
    return {
      level: 'Excelente',
      levelExplanation: 'Entregabilidade superior com taxa de entrega >= 98% e zero reclamações.',
      isSufficientData: true,
      rates,
      alerts,
    };
  }

  // 5. Saudável (Padrão)
  return {
    level: 'Saudável',
    levelExplanation: 'Indicadores de entrega e rejeição dentro dos padrões recomendados.',
    isSufficientData: true,
    rates,
    alerts,
  };
}

/**
 * Fetches deliverability health metrics from remote/local Supabase.
 * Queries rolling 30-day outbound_messages and total email_suppressions.
 */
export async function fetchDeliverabilityHealth(
  client = supabase
): Promise<DeliverabilityHealthSummary> {
  const windowDays = DELIVERABILITY_CONFIG.ROLLING_WINDOW_DAYS;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1. Query outbound_messages in rolling window
    const { data: messages, error: msgErr } = await client
      .from('outbound_messages')
      .select('id, status, delivered_at, bounced_at, complained_at, failed_at')
      .eq('channel', 'email')
      .gte('created_at', windowStart);

    if (msgErr) {
      console.error('Error fetching outbound_messages for deliverability:', msgErr);
    }

    const emailList = messages || [];
    let deliveredCount = 0;
    let bouncedCount = 0;
    let complaintCount = 0;
    let failedCount = 0;

    for (const msg of emailList) {
      if (msg.delivered_at || msg.status === 'delivered') {
        deliveredCount++;
      }
      if (msg.bounced_at || msg.status === 'bounced') {
        bouncedCount++;
      }
      if (msg.complained_at || msg.status === 'complained') {
        complaintCount++;
      }
      if (msg.failed_at || msg.status === 'failed') {
        failedCount++;
      }
    }

    // 2. Query total suppressions count
    const { count: suppressionCount, error: suppErr } = await client
      .from('email_suppressions')
      .select('*', { count: 'exact', head: true });

    if (suppErr) {
      console.error('Error fetching email_suppressions count:', suppErr);
    }

    const rawMetrics: DeliverabilityRawMetrics = {
      sent: emailList.length,
      delivered: deliveredCount,
      bounced: bouncedCount,
      complaints: complaintCount,
      failed: failedCount,
      suppressed: suppressionCount || 0,
    };

    const classification = classifyDeliverabilityHealth(rawMetrics);

    return {
      level: classification.level,
      levelExplanation: classification.levelExplanation,
      isSufficientData: classification.isSufficientData,
      sampleCount: rawMetrics.sent,
      minSampleRequired: DELIVERABILITY_CONFIG.MIN_SAMPLE_SIZE,
      windowDays,
      metrics: rawMetrics,
      rates: classification.rates,
      alerts: classification.alerts,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Failed to compute deliverability health summary:', err);
    const fallbackMetrics: DeliverabilityRawMetrics = {
      sent: 0,
      delivered: 0,
      bounced: 0,
      complaints: 0,
      failed: 0,
      suppressed: 0,
    };
    const classification = classifyDeliverabilityHealth(fallbackMetrics);
    return {
      level: classification.level,
      levelExplanation: classification.levelExplanation,
      isSufficientData: false,
      sampleCount: 0,
      minSampleRequired: DELIVERABILITY_CONFIG.MIN_SAMPLE_SIZE,
      windowDays,
      metrics: fallbackMetrics,
      rates: classification.rates,
      alerts: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Fetches read-only list of email suppressions with optional search query.
 */
export async function fetchEmailSuppressions(
  client = supabase,
  search?: string
): Promise<EmailSuppressionRecord[]> {
  try {
    let query = client
      .from('email_suppressions')
      .select('id, normalized_email, reason, provider, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (search && search.trim()) {
      query = query.ilike('normalized_email', `%${search.trim().toLowerCase()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as EmailSuppressionRecord[];
  } catch (err) {
    console.error('Failed to fetch email_suppressions:', err);
    return [];
  }
}

/**
 * Factual lead-level email health resolution for Lead Profile.
 * Discreetly reflects:
 * - 'E-mail saudável' when factual successful delivery exists and no suppression
 * - 'Falha de entrega' / 'Reclamação / Spam' / 'Suprimido' when factual issue exists
 * - 'sem_historico' when lead has not been emailed or has no email
 */
export async function fetchLeadEmailHealth(
  leadEmail?: string | null,
  client = supabase
): Promise<LeadEmailHealthResult> {
  const cleanEmail = leadEmail ? leadEmail.trim().toLowerCase() : '';
  if (!cleanEmail) {
    return {
      status: 'sem_historico',
      label: 'E-mail não informado',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
    };
  }

  try {
    // 1. Check suppression table
    const { data: suppression } = await client
      .from('email_suppressions')
      .select('reason')
      .eq('normalized_email', cleanEmail)
      .maybeSingle();

    if (suppression) {
      if (suppression.reason === 'hard_bounce') {
        return {
          status: 'falha',
          label: 'Falha de entrega',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          details: 'Endereço bloqueado após falha permanente (hard bounce)',
        };
      }
      if (suppression.reason === 'complaint') {
        return {
          status: 'reclamacao',
          label: 'Reclamação / Spam',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          details: 'Endereço bloqueado após registro de reclamação de spam',
        };
      }
      return {
        status: 'suprimido',
        label: 'Suprimido',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        details: 'Endereço suprimido para recebimento de e-mails',
      };
    }

    // 2. Check recent outbound messages history for this recipient
    const { data: recentOutbound } = await client
      .from('outbound_messages')
      .select('status, delivered_at, bounced_at, complained_at, opened_at, clicked_at, delivery_delayed_at, failed_at, bounce_type')
      .eq('channel', 'email')
      .eq('recipient', cleanEmail)
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentOutbound && recentOutbound.length > 0) {
      const hasComplaint = recentOutbound.some((m) => m.complained_at || m.status === 'complained');
      if (hasComplaint) {
        return {
          status: 'reclamacao',
          label: 'Reclamação / Spam',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        };
      }

      const hasHardBounce = recentOutbound.some((m) => (m.bounced_at || m.status === 'bounced') && m.bounce_type !== 'soft_bounce');
      if (hasHardBounce) {
        return {
          status: 'falha',
          label: 'Falha de entrega',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        };
      }

      const hasSoftBounce = recentOutbound.some((m) => m.bounce_type === 'soft_bounce');
      if (hasSoftBounce) {
        return {
          status: 'falha',
          label: 'Falha temporária',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
          details: 'Falha temporária de entrega (soft bounce), o provedor tentará novamente',
        };
      }

      const hasClick = recentOutbound.some((m) => m.clicked_at || m.status === 'clicked');
      if (hasClick) {
        return {
          status: 'saudavel',
          label: 'Clique detectado',
          badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          details: 'Engajamento comprovado: clique detectado em link do e-mail',
        };
      }

      const hasOpen = recentOutbound.some((m) => m.opened_at || m.status === 'opened');
      if (hasOpen) {
        return {
          status: 'saudavel',
          label: 'Abertura detectada',
          badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
          details: 'Abertura detectada no e-mail (sujeito a proxies/scanners)',
        };
      }

      const hasDelivered = recentOutbound.some((m) => m.delivered_at || m.status === 'delivered');
      if (hasDelivered) {
        return {
          status: 'saudavel',
          label: 'E-mail saudável',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          details: 'Histórico factual de entrega comprovada',
        };
      }

      const hasDelayed = recentOutbound.some((m) => m.delivery_delayed_at || m.status === 'delayed');
      if (hasDelayed) {
        return {
          status: 'falha',
          label: 'Entrega adiada',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
          details: 'Entrega temporariamente adiada pelo servidor do destinatário',
        };
      }
    }

    return {
      status: 'sem_historico',
      label: 'Sem histórico recente',
      badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
    };
  } catch (err) {
    console.error('Error fetching lead email health:', err);
    return {
      status: 'sem_historico',
      label: 'Sem histórico recente',
      badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
    };
  }
}

// =============================================================================
// Pipeline Lead Card Deliverability Health Resolution
// =============================================================================

export type LeadDeliverabilityStatus =
  | 'saudavel'
  | 'atencao'
  | 'risco'
  | 'suprimido'
  | 'sem_dados';

export interface LeadDeliverabilityInfo {
  status: LeadDeliverabilityStatus;
  label: 'Saudável' | 'Atenção' | 'Risco' | 'Suprimido' | 'Sem dados';
  description: string;
  dotColor: string;
  badgeClass: string;
}

export interface ResolveDeliverabilityParams {
  leadEmail?: string | null;
  suppressionReason?: string | null;
  recentOutboundMessages?: Array<{
    status?: string | null;
    delivered_at?: string | null;
    bounced_at?: string | null;
    complained_at?: string | null;
    failed_at?: string | null;
    opened_at?: string | null;
    clicked_at?: string | null;
    delivery_delayed_at?: string | null;
  }> | null;
}

/**
 * Resolves compact factual deliverability health for a lead card.
 * Enforces allowed compact states:
 * - Saudável: recent successful delivery history confirmed and no complaints/bounces
 * - Atenção: limited data, delayed delivery, or minor caution state
 * - Risco: bounce history or complaints
 * - Suprimido: recipient exists in email_suppressions
 * - Sem dados: no meaningful send history yet or missing email
 */
export function resolveLeadDeliverabilityHealth(
  params: ResolveDeliverabilityParams
): LeadDeliverabilityInfo {
  const cleanEmail = params.leadEmail ? params.leadEmail.trim().toLowerCase() : '';

  // 1. Missing or empty email -> Sem dados
  if (!cleanEmail) {
    return {
      status: 'sem_dados',
      label: 'Sem dados',
      description: 'Ainda não há histórico suficiente de entrega.',
      dotColor: 'bg-slate-400',
      badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80 hover:bg-slate-100/80',
    };
  }

  // 2. Suppression check: hard_bounce, complaint, unsubscribe, manual
  if (params.suppressionReason) {
    return {
      status: 'suprimido',
      label: 'Suprimido',
      description: 'Este contato está suprimido para novos envios de e-mail.',
      dotColor: 'bg-rose-600',
      badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
    };
  }

  const messages = params.recentOutboundMessages || [];

  // 3. No outbound messages yet -> Sem dados
  if (messages.length === 0) {
    return {
      status: 'sem_dados',
      label: 'Sem dados',
      description: 'Ainda não há histórico suficiente de entrega.',
      dotColor: 'bg-slate-400',
      badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80 hover:bg-slate-100/80',
    };
  }

  // 4. Risco: complaint or bounce recorded
  const hasComplaint = messages.some((m) => m.complained_at || m.status === 'complained');
  const hasBounce = messages.some((m) => m.bounced_at || m.status === 'bounced');

  if (hasComplaint || hasBounce) {
    return {
      status: 'risco',
      label: 'Risco',
      description: 'Foram detectadas falhas ou problemas recentes de entrega.',
      dotColor: 'bg-rose-500',
      badgeClass: 'bg-rose-50/90 text-rose-700 border-rose-200/80 hover:bg-rose-100/80',
    };
  }

  // 5. Atenção: technical failures without confirmed delivery, or delayed delivery
  const hasFailure = messages.some((m) => m.failed_at || m.status === 'failed');
  const hasDelivered = messages.some((m) => m.delivered_at || m.status === 'delivered');

  if (hasFailure && !hasDelivered) {
    return {
      status: 'atencao',
      label: 'Atenção',
      description: 'Poucos dados ou sinais mistos de entrega.',
      dotColor: 'bg-amber-500',
      badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
    };
  }

  // 6. Saudável: verified delivered event or positive engagement and no negative signals
  const hasClick = messages.some((m) => (m as any).clicked_at || m.status === 'clicked');
  const hasOpen = messages.some((m) => (m as any).opened_at || m.status === 'opened');
  const isDeliveredOrEngaged = hasDelivered || hasClick || hasOpen;

  if (isDeliveredOrEngaged) {
    let desc = 'Últimos envios com entrega confirmada.';
    if (hasClick) {
      desc = 'Clique detectado em link do e-mail.';
    } else if (hasOpen) {
      desc = 'Abertura detectada no e-mail (sujeito a proxies/scanners).';
    }
    return {
      status: 'saudavel',
      label: 'Saudável',
      description: desc,
      dotColor: 'bg-emerald-500',
      badgeClass: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
    };
  }

  // 7. Limited / in-transit / sent messages awaiting delivery confirmation -> Atenção
  return {
    status: 'atencao',
    label: 'Atenção',
    description: 'Poucos dados ou sinais mistos de entrega.',
    dotColor: 'bg-amber-500',
    badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
  };
}

/**
 * Batch-fetches factual deliverability health data for a list of leads in 2 index-backed queries.
 * Prevents N+1 queries on the Kanban board.
 */
export async function batchFetchPipelineDeliverabilityHealth(
  leads: Lead[],
  client = supabase
): Promise<Record<string, LeadDeliverabilityInfo>> {
  const result: Record<string, LeadDeliverabilityInfo> = {};
  if (!leads || leads.length === 0) return result;

  const leadEmailMap: Record<string, string> = {};
  const emails: string[] = [];
  const leadIds: string[] = [];

  for (const l of leads) {
    leadIds.push(l.id);
    if (l.email && l.email.trim()) {
      const cleanEmail = l.email.trim().toLowerCase();
      leadEmailMap[l.id] = cleanEmail;
      emails.push(cleanEmail);
    }
  }

  try {
    // 1. Batch query email_suppressions
    const uniqueEmails = Array.from(new Set(emails));
    const suppressionsMap: Record<string, string> = {};

    if (uniqueEmails.length > 0) {
      const { data: suppressions } = await client
        .from('email_suppressions')
        .select('normalized_email, reason')
        .in('normalized_email', uniqueEmails);

      if (suppressions) {
        for (const s of suppressions) {
          suppressionsMap[s.normalized_email] = s.reason;
        }
      }
    }

    // 2. Batch query recent outbound messages
    const messagesByLeadId: Record<string, any[]> = {};
    if (leadIds.length > 0) {
      const { data: messages } = await client
        .from('outbound_messages')
        .select('lead_id, status, delivered_at, bounced_at, complained_at, failed_at, opened_at, clicked_at, created_at')
        .eq('channel', 'email')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false });

      if (messages) {
        for (const m of messages) {
          if (!messagesByLeadId[m.lead_id]) messagesByLeadId[m.lead_id] = [];
          messagesByLeadId[m.lead_id].push(m);
        }
      }
    }

    // 3. Resolve status for each lead
    for (const l of leads) {
      const email = leadEmailMap[l.id];
      const suppressionReason = email ? suppressionsMap[email] : null;
      const recentMessages = messagesByLeadId[l.id] || [];

      result[l.id] = resolveLeadDeliverabilityHealth({
        leadEmail: email,
        suppressionReason,
        recentOutboundMessages: recentMessages,
      });
    }
  } catch (err) {
    console.error('Failed to batch fetch pipeline deliverability health:', err);
    for (const l of leads) {
      result[l.id] = resolveLeadDeliverabilityHealth({ leadEmail: l.email });
    }
  }

  return result;
}

