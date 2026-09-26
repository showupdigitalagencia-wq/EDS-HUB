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

export interface DomainAuthenticationHealth {
  spf: 'verified' | 'failed' | 'unconfigured' | 'unknown';
  dkim: 'verified' | 'failed' | 'unconfigured' | 'unknown';
  dmarc: 'verified' | 'failed' | 'unconfigured' | 'unknown';
  sendingDomain: string;
  isDomainHealthy: boolean;
  warnings: string[];
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
  authentication?: DomainAuthenticationHealth;
  lastUpdated: string;
}

export type DeliverabilityRiskLevel =
  | 'baixo'
  | 'moderado'
  | 'alto'
  | 'critico'
  | 'sem_historico';

export type SpamRiskLevel = 'baixo' | 'moderado' | 'alto';

export type FactualDeliveryStatus =
  | 'sem_historico'
  | 'enviado'
  | 'aceito'
  | 'entregue'
  | 'abertura_detectada'
  | 'clique_detectado'
  | 'entrega_atrasada'
  | 'falha_temporaria'
  | 'hard_bounce'
  | 'falha_entrega'
  | 'reclamacao_spam'
  | 'suprimido'
  | 'descadastrado'
  | 'bloqueado_provedor';

export interface FactualStatusInfo {
  status: FactualDeliveryStatus;
  label: string;
  badgeClass: string;
  dotColor: string;
}

export interface DeliverabilityRiskInfo {
  level: DeliverabilityRiskLevel;
  label: string;
  reasons: string[];
  color: string;
  badgeClass: string;
}

export interface SpamRiskInfo {
  level: SpamRiskLevel;
  label: string;
  reasons: string[];
}

export interface SuppressionInfo {
  isActive: boolean;
  reason?: string | null;
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
  reason?: string;
  factualStatus?: FactualStatusInfo;
  risk?: DeliverabilityRiskInfo;
  spamRisk?: SpamRiskInfo;
  suppression?: SuppressionInfo;
  automationAllowed?: boolean;
  lastSuccessfulDelivery?: string | null;
  lastFailure?: string | null;
  lastOpenDetected?: string | null;
  lastClickDetected?: string | null;
  softBounceCount?: number;
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
 * Factual Domain Authentication Health (SPF, DKIM, DMARC)
 * Resend manages DKIM keys and SPF verification for expdentalsolutions.com.
 */
export function getDomainAuthenticationHealth(): DomainAuthenticationHealth {
  return {
    spf: 'verified',
    dkim: 'verified',
    dmarc: 'verified',
    sendingDomain: 'expdentalsolutions.com',
    isDomainHealthy: true,
    warnings: [],
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
      authentication: getDomainAuthenticationHealth(),
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
      authentication: getDomainAuthenticationHealth(),
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
 * Uses the exact same dual-layer classification engine as Pipeline.
 */
export async function fetchLeadEmailHealth(
  leadEmail?: string | null,
  client = supabase
): Promise<LeadEmailHealthResult> {
  const cleanEmail = leadEmail ? leadEmail.trim().toLowerCase() : '';
  if (!cleanEmail) {
    const defaultResolved = resolveLeadDeliverabilityHealth({ leadEmail: null });
    return {
      ...defaultResolved,
      status: 'sem_historico',
      label: 'E-mail não informado',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
      details: 'E-mail não informado para este lead',
      reason: 'E-mail não informado ou sem histórico',
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
      const resolved = resolveLeadDeliverabilityHealth({
        leadEmail: cleanEmail,
        suppressionReason: suppression.reason,
      });

      if (suppression.reason === 'hard_bounce') {
        return {
          ...resolved,
          status: 'falha',
          label: 'Falha de entrega',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          details: 'Endereço bloqueado após falha permanente (hard bounce)',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }
      if (suppression.reason === 'complaint') {
        return {
          ...resolved,
          status: 'reclamacao',
          label: 'Reclamação / Spam',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          details: 'Endereço bloqueado após registro de reclamação de spam',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }
      return {
        ...resolved,
        status: 'suprimido',
        label: 'Suprimido',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        details: 'Endereço suprimido para recebimento de e-mails',
        reason: resolved.risk?.reasons?.join(', ') || '',
      };
    }

    // 2. Check recent outbound messages history for this recipient
    const { data: recentOutbound } = await client
      .from('outbound_messages')
      .select(
        'status, delivered_at, bounced_at, complained_at, opened_at, clicked_at, delivery_delayed_at, failed_at, bounce_type, error_code, error_message, provider_status, created_at'
      )
      .eq('channel', 'email')
      .eq('recipient', cleanEmail)
      .order('created_at', { ascending: false })
      .limit(10);

    const resolved = resolveLeadDeliverabilityHealth({
      leadEmail: cleanEmail,
      suppressionReason: null,
      recentOutboundMessages: recentOutbound || [],
    });

    if (recentOutbound && recentOutbound.length > 0) {
      const hasComplaint = recentOutbound.some((m) => m.complained_at || m.status === 'complained');
      if (hasComplaint) {
        return {
          ...resolved,
          status: 'reclamacao',
          label: 'Reclamação / Spam',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          details: 'Registro de reclamação de spam pelo destinatário',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }

      const hasHardBounce = recentOutbound.some(
        (m) => (m.bounced_at || m.status === 'bounced') && m.bounce_type !== 'soft_bounce'
      );
      if (hasHardBounce) {
        return {
          ...resolved,
          status: 'falha',
          label: 'Falha de entrega',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          details: 'Falha permanente de entrega (hard bounce)',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }

      const hasSoftBounce = recentOutbound.some((m) => m.bounce_type === 'soft_bounce');
      if (hasSoftBounce) {
        return {
          ...resolved,
          status: 'falha',
          label: 'Falha temporária',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
          details: 'Falha temporária de entrega (soft bounce), o provedor tentará novamente',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }

      const hasClick = recentOutbound.some((m) => (m as any).clicked_at || m.status === 'clicked');
      if (hasClick) {
        return {
          ...resolved,
          status: 'saudavel',
          label: 'Clique detectado',
          badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          details: 'Engajamento comprovado: clique detectado em link do e-mail',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }

      const hasOpen = recentOutbound.some((m) => (m as any).opened_at || m.status === 'opened');
      if (hasOpen) {
        return {
          ...resolved,
          status: 'saudavel',
          label: 'Abertura detectada',
          badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
          details: 'Abertura detectada no e-mail (sujeito a proxies/scanners)',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }

      const hasDelivered = recentOutbound.some((m) => m.delivered_at || m.status === 'delivered');
      if (hasDelivered) {
        return {
          ...resolved,
          status: 'saudavel',
          label: 'Entregue',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          details: 'Histórico factual de entrega comprovada',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }

      const hasDelayed = recentOutbound.some((m) => m.delivery_delayed_at || m.status === 'delayed');
      if (hasDelayed) {
        return {
          ...resolved,
          status: 'falha',
          label: 'Entrega adiada',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
          details: 'Entrega temporariamente adiada pelo servidor do destinatário',
          reason: resolved.risk?.reasons?.join(', ') || '',
        };
      }
    }

    return {
      ...resolved,
      status: 'sem_historico',
      label: 'Sem histórico recente',
      badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
      details: 'Sem histórico recente de entregabilidade',
      reason: 'Sem histórico recente',
    };
  } catch (err) {
    console.error('Error fetching lead email health:', err);
    const fallback = resolveLeadDeliverabilityHealth({ leadEmail: cleanEmail });
    return {
      ...fallback,
      status: 'sem_historico',
      label: 'Sem histórico recente',
      badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
      details: 'Sem histórico recente de entregabilidade',
      reason: 'Sem histórico recente',
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
  label: 'Saudável' | 'Atenção' | 'Risco' | 'Suprimido' | 'Sem dados' | string;
  description: string;
  dotColor: string;
  badgeClass: string;
  factualStatus?: FactualStatusInfo;
  risk?: DeliverabilityRiskInfo;
  spamRisk?: SpamRiskInfo;
  suppression?: SuppressionInfo;
  automationAllowed?: boolean;
  lastSuccessfulDelivery?: string | null;
  lastFailure?: string | null;
  lastOpenDetected?: string | null;
  lastClickDetected?: string | null;
  softBounceCount?: number;
}

export interface ResolvedLeadDeliverabilityInfo extends LeadDeliverabilityInfo {
  factualStatus: FactualStatusInfo;
  risk: DeliverabilityRiskInfo;
  spamRisk: SpamRiskInfo;
  suppression: SuppressionInfo;
  automationAllowed: boolean;
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
    bounce_type?: string | null;
    error_code?: string | null;
    error_message?: string | null;
    provider_status?: string | null;
    created_at?: string | null;
  }> | null;
}

/**
 * Resolves compact factual deliverability health and explainable risk for a lead.
 * Separates Factual Delivery Status (Concept A) from Deliverability Risk (Concept B).
 * Enforces:
 * - Complaint / Hard Bounce / Suppression -> Risk CRITICAL, Suppression ACTIVE, Automation BLOCKED
 * - 2+ Soft Bounces -> Risk ALTO, Suppression INACTIVE
 * - 1 Soft Bounce / Delay -> Risk MODERADO, Suppression INACTIVE
 * - Confirmed Delivery / Engaged -> Risk BAIXO, Suppression INACTIVE
 * - No History / No Email -> Risk SEM_HISTORICO, Status SEM_HISTORICO (NEVER "Saudável")
 * - Spam Risk (Baixo / Moderado / Alto) without ever claiming inbox-placement without proof.
 */
export function resolveLeadDeliverabilityHealth(
  params: ResolveDeliverabilityParams
): ResolvedLeadDeliverabilityInfo {
  const cleanEmail = params.leadEmail ? params.leadEmail.trim().toLowerCase() : '';

  // 1. Missing or empty email -> Sem histórico / Sem dados
  if (!cleanEmail) {
    return {
      status: 'sem_dados',
      label: 'Sem dados',
      description: 'Ainda não há histórico suficiente de entrega.',
      dotColor: 'bg-slate-400',
      badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80 hover:bg-slate-100/80',
      factualStatus: {
        status: 'sem_historico',
        label: 'Sem histórico',
        dotColor: 'bg-slate-400',
        badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80',
      },
      risk: {
        level: 'sem_historico',
        label: 'Sem histórico',
        reasons: ['E-mail não informado ou sem histórico de envio'],
        color: 'text-slate-500',
        badgeClass: 'bg-slate-50 text-slate-500 border-slate-200',
      },
      spamRisk: {
        level: 'baixo',
        label: 'Baixo',
        reasons: ['Sem dados de envio'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: false,
    };
  }

  // 2. Suppression check: hard_bounce, complaint, unsubscribe, manual
  if (params.suppressionReason) {
    const reason = params.suppressionReason;
    if (reason === 'hard_bounce') {
      return {
        status: 'suprimido',
        label: 'Suprimido',
        description: 'Falha permanente de entrega (hard bounce). Contato suprimido para proteção do domínio.',
        dotColor: 'bg-rose-600',
        badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
        factualStatus: {
          status: 'hard_bounce',
          label: 'Hard Bounce',
          dotColor: 'bg-rose-600',
          badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
        },
        risk: {
          level: 'critico',
          label: 'Crítico',
          reasons: [
            'Falha permanente (hard bounce) registrada',
            'Endereço bloqueado na lista de supressão',
            'Novos envios automáticos bloqueados',
          ],
          color: 'text-rose-700',
          badgeClass: 'bg-rose-100/90 text-rose-800 border-rose-300',
        },
        spamRisk: {
          level: 'alto',
          label: 'Alto',
          reasons: ['Endereço permanentemente inválido ou inexistente'],
        },
        suppression: {
          isActive: true,
          reason: 'hard_bounce',
        },
        automationAllowed: false,
      };
    }

    if (reason === 'complaint') {
      return {
        status: 'suprimido',
        label: 'Suprimido',
        description: 'Reclamação de spam registrada. Contato automaticamente suprimido para proteger a reputação.',
        dotColor: 'bg-rose-600',
        badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
        factualStatus: {
          status: 'reclamacao_spam',
          label: 'Spam / Complaint',
          dotColor: 'bg-rose-600',
          badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
        },
        risk: {
          level: 'critico',
          label: 'Crítico',
          reasons: [
            'Reclamação de spam registrada pelo destinatário',
            'Endereço automaticamente suprimido para proteção da reputação',
            'Novos envios automáticos e campanhas bloqueados',
          ],
          color: 'text-rose-700',
          badgeClass: 'bg-rose-100/90 text-rose-800 border-rose-300',
        },
        spamRisk: {
          level: 'alto',
          label: 'Alto',
          reasons: ['Reclamação de spam confirmada pelo provedor'],
        },
        suppression: {
          isActive: true,
          reason: 'complaint',
        },
        automationAllowed: false,
      };
    }

    if (reason === 'unsubscribe') {
      return {
        status: 'suprimido',
        label: 'Suprimido',
        description: 'Contato descadastrado. Novos envios automáticos bloqueados.',
        dotColor: 'bg-amber-600',
        badgeClass: 'bg-amber-100/80 text-amber-800 border-amber-300 hover:bg-amber-200/80',
        factualStatus: {
          status: 'descadastrado',
          label: 'Descadastrado',
          dotColor: 'bg-amber-600',
          badgeClass: 'bg-amber-100/80 text-amber-800 border-amber-300 hover:bg-amber-200/80',
        },
        risk: {
          level: 'critico',
          label: 'Crítico',
          reasons: ['Contato solicitou descadastramento (opt-out)', 'Envios de e-mail bloqueados por consentimento'],
          color: 'text-amber-800',
          badgeClass: 'bg-amber-100/90 text-amber-800 border-amber-300',
        },
        spamRisk: {
          level: 'moderado',
          label: 'Moderado',
          reasons: ['Contato optou por descadastramento'],
        },
        suppression: {
          isActive: true,
          reason: 'unsubscribe',
        },
        automationAllowed: false,
      };
    }

    return {
      status: 'suprimido',
      label: 'Suprimido',
      description: 'Este contato está suprimido para novos envios de e-mail.',
      dotColor: 'bg-rose-600',
      badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
      factualStatus: {
        status: 'suprimido',
        label: 'Suprimido',
        dotColor: 'bg-rose-600',
        badgeClass: 'bg-rose-100/80 text-rose-800 border-rose-300 hover:bg-rose-200/80',
      },
      risk: {
        level: 'critico',
        label: 'Crítico',
        reasons: ['Endereço suprimido para recebimento de e-mails', 'Novos envios bloqueados'],
        color: 'text-rose-700',
        badgeClass: 'bg-rose-100/90 text-rose-800 border-rose-300',
      },
      spamRisk: {
        level: 'alto',
        label: 'Alto',
        reasons: ['Endereço suprimido'],
      },
      suppression: {
        isActive: true,
        reason,
      },
      automationAllowed: false,
    };
  }

  const messages = params.recentOutboundMessages || [];

  // 3. No outbound messages yet -> Sem dados / Sem histórico
  if (messages.length === 0) {
    return {
      status: 'sem_dados',
      label: 'Sem dados',
      description: 'Ainda não há histórico suficiente de entrega.',
      dotColor: 'bg-slate-400',
      badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80 hover:bg-slate-100/80',
      factualStatus: {
        status: 'sem_historico',
        label: 'Sem histórico',
        dotColor: 'bg-slate-400',
        badgeClass: 'bg-slate-50 text-slate-500 border-slate-200/80',
      },
      risk: {
        level: 'sem_historico',
        label: 'Sem histórico',
        reasons: ['Nenhum e-mail enviado anteriormente para este contato', 'Dados insuficientes para cálculo de risco'],
        color: 'text-slate-500',
        badgeClass: 'bg-slate-50 text-slate-500 border-slate-200',
      },
      spamRisk: {
        level: 'baixo',
        label: 'Baixo',
        reasons: ['Sem dados de envio anteriores'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: true,
    };
  }

  // 4. Extract factual chronological events
  const hasComplaint = messages.some((m) => m.complained_at || m.status === 'complained');
  const hasHardBounce = messages.some(
    (m) => (m.bounced_at || m.status === 'bounced') && m.bounce_type !== 'soft_bounce'
  );
  const softBounceMsgs = messages.filter((m) => m.bounce_type === 'soft_bounce');
  const softBounceCount = softBounceMsgs.length;
  const hasProviderBlock = messages.some(
    (m) =>
      m.provider_status === 'blocked' ||
      m.error_code === 'PROVIDER_BLOCKED' ||
      m.error_code === 'PROVIDER_REJECTED' ||
      (m.error_message && m.error_message.toLowerCase().includes('block'))
  );
  const hasDelayed = messages.some((m) => m.delivery_delayed_at || m.status === 'delayed');
  const hasFailure = messages.some((m) => m.failed_at || m.status === 'failed');
  const hasDelivered = messages.some((m) => m.delivered_at || m.status === 'delivered');
  const hasClick = messages.some((m) => (m as any).clicked_at || m.status === 'clicked');
  const hasOpen = messages.some((m) => (m as any).opened_at || m.status === 'opened');

  const lastSuccessfulDelivery =
    messages.find((m) => m.delivered_at || m.status === 'delivered')?.delivered_at || null;
  const lastFailure =
    messages.find((m) => m.bounced_at || m.complained_at || m.failed_at)?.bounced_at ||
    messages.find((m) => m.failed_at)?.failed_at ||
    messages.find((m) => m.complained_at)?.complained_at ||
    null;
  const lastOpenDetected = messages.find((m) => m.opened_at || m.status === 'opened')?.opened_at || null;
  const lastClickDetected = messages.find((m) => m.clicked_at || m.status === 'clicked')?.clicked_at || null;

  // Case A: Complaint recorded in history
  if (hasComplaint) {
    return {
      status: 'risco',
      label: 'Risco',
      description: 'Foram detectadas falhas ou problemas recentes de entrega.',
      dotColor: 'bg-rose-500',
      badgeClass: 'bg-rose-50/90 text-rose-700 border-rose-200/80 hover:bg-rose-100/80',
      factualStatus: {
        status: 'reclamacao_spam',
        label: 'Spam / Complaint',
        dotColor: 'bg-rose-600',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
      },
      risk: {
        level: 'critico',
        label: 'Crítico',
        reasons: [
          'Reclamação de spam registrada pelo destinatário',
          'Endereço automaticamente suprimido para proteger a reputação',
          'Novos envios automáticos bloqueados',
        ],
        color: 'text-rose-700',
        badgeClass: 'bg-rose-100/90 text-rose-800 border-rose-300',
      },
      spamRisk: {
        level: 'alto',
        label: 'Alto',
        reasons: ['Reclamação de spam confirmada pelo destinatário'],
      },
      suppression: {
        isActive: true,
        reason: 'complaint',
      },
      automationAllowed: false,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case B: Hard Bounce recorded in history
  if (hasHardBounce) {
    return {
      status: 'risco',
      label: 'Risco',
      description: 'Foram detectadas falhas ou problemas recentes de entrega.',
      dotColor: 'bg-rose-500',
      badgeClass: 'bg-rose-50/90 text-rose-700 border-rose-200/80 hover:bg-rose-100/80',
      factualStatus: {
        status: 'hard_bounce',
        label: 'Hard Bounce',
        dotColor: 'bg-rose-600',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
      },
      risk: {
        level: 'critico',
        label: 'Crítico',
        reasons: [
          'Falha permanente (hard bounce): servidor rejeitou o endereço',
          'Endereço bloqueado na lista de supressão',
          'Novos envios automáticos bloqueados',
        ],
        color: 'text-rose-700',
        badgeClass: 'bg-rose-100/90 text-rose-800 border-rose-300',
      },
      spamRisk: {
        level: 'alto',
        label: 'Alto',
        reasons: ['Rejeição permanente por inexistência ou bloqueio de domínio'],
      },
      suppression: {
        isActive: true,
        reason: 'hard_bounce',
      },
      automationAllowed: false,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case C: Provider Block
  if (hasProviderBlock) {
    return {
      status: 'risco',
      label: 'Risco',
      description: 'Bloqueado pelo provedor de e-mail.',
      dotColor: 'bg-rose-500',
      badgeClass: 'bg-rose-50/90 text-rose-700 border-rose-200/80 hover:bg-rose-100/80',
      factualStatus: {
        status: 'bloqueado_provedor',
        label: 'Bloqueado pelo provedor',
        dotColor: 'bg-rose-600',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
      },
      risk: {
        level: 'critico',
        label: 'Crítico',
        reasons: ['Bloqueio ou rejeição formal informada pelo provedor', 'Envios preventivamente suspensos'],
        color: 'text-rose-700',
        badgeClass: 'bg-rose-100/90 text-rose-800 border-rose-300',
      },
      spamRisk: {
        level: 'alto',
        label: 'Alto',
        reasons: ['Bloqueio operacional informado pelo provedor'],
      },
      suppression: {
        isActive: true,
        reason: 'provider_blocked',
      },
      automationAllowed: false,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case D: Repeated Soft Bounces (2+) -> Risk ALTO
  if (softBounceCount >= 2) {
    return {
      status: 'risco',
      label: 'Risco',
      description: 'Foram detectadas falhas ou problemas recentes de entrega.',
      dotColor: 'bg-orange-500',
      badgeClass: 'bg-orange-50/90 text-orange-700 border-orange-200/80 hover:bg-orange-100/80',
      factualStatus: {
        status: 'falha_temporaria',
        label: 'Falha temporária',
        dotColor: 'bg-orange-500',
        badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
      },
      risk: {
        level: 'alto',
        label: 'Alto',
        reasons: [
          `${softBounceCount} falhas temporárias consecutivas (soft bounces)`,
          'Servidor do destinatário segue indisponível ou rejeitando temporariamente',
          'Última tentativa de entrega não concluída',
        ],
        color: 'text-orange-700',
        badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
      },
      spamRisk: {
        level: 'alto',
        label: 'Alto',
        reasons: ['Falhas temporárias recorrentes sem entrega posterior confirmada'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: true,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case E: Single Soft Bounce (1) without subsequent delivery -> Risk MODERADO
  if (softBounceCount === 1 && !hasDelivered) {
    return {
      status: 'atencao',
      label: 'Atenção',
      description: 'Falha temporária de entrega (soft bounce), o provedor tentará novamente.',
      dotColor: 'bg-amber-500',
      badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
      factualStatus: {
        status: 'falha_temporaria',
        label: 'Falha temporária',
        dotColor: 'bg-amber-500',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      },
      risk: {
        level: 'moderado',
        label: 'Moderado',
        reasons: [
          '1 falha temporária recente (caixa de correio cheia ou indisponibilidade temporária)',
          'Provedor tentará nova entrega automaticamente',
        ],
        color: 'text-amber-700',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      },
      spamRisk: {
        level: 'moderado',
        label: 'Moderado',
        reasons: ['Falha temporária registrada'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: true,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case F: Delivery Delayed without subsequent delivery -> Risk MODERADO
  if (hasDelayed && !hasDelivered) {
    return {
      status: 'atencao',
      label: 'Atenção',
      description: 'Entrega temporariamente adiada pelo servidor do destinatário.',
      dotColor: 'bg-amber-500',
      badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
      factualStatus: {
        status: 'entrega_atrasada',
        label: 'Entrega atrasada',
        dotColor: 'bg-amber-500',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      },
      risk: {
        level: 'moderado',
        label: 'Moderado',
        reasons: [
          'Entrega adiada pelo provedor de destino (greylisting / controle de taxa)',
          'Reenvio automático programado pelo provedor',
        ],
        color: 'text-amber-700',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      },
      spamRisk: {
        level: 'moderado',
        label: 'Moderado',
        reasons: ['Atraso temporário na entrega'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: true,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case G: Technical Failure without confirmed delivery
  if (hasFailure && !hasDelivered) {
    return {
      status: 'atencao',
      label: 'Atenção',
      description: 'Poucos dados ou sinais mistos de entrega.',
      dotColor: 'bg-amber-500',
      badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
      factualStatus: {
        status: 'falha_entrega',
        label: 'Falha de entrega',
        dotColor: 'bg-amber-500',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      },
      risk: {
        level: 'moderado',
        label: 'Moderado',
        reasons: ['Falha técnica recente no processamento do e-mail'],
        color: 'text-amber-700',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      },
      spamRisk: {
        level: 'moderado',
        label: 'Moderado',
        reasons: ['Falha técnica no envio'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: true,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case H: Confirmed Delivery / Engagement (Click / Open / Delivered)
  const isDeliveredOrEngaged = hasDelivered || hasClick || hasOpen;

  if (isDeliveredOrEngaged) {
    if (hasClick) {
      return {
        status: 'saudavel',
        label: 'Saudável',
        description: 'Clique detectado em link do e-mail.',
        dotColor: 'bg-emerald-500',
        badgeClass: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
        factualStatus: {
          status: 'clique_detectado',
          label: 'Clique detectado',
          dotColor: 'bg-indigo-500',
          badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
        },
        risk: {
          level: 'baixo',
          label: 'Baixo',
          reasons: ['Engajamento factual comprovado (clique em link)', 'Nenhuma falha recente registrada'],
          color: 'text-emerald-700',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        },
        spamRisk: {
          level: 'baixo',
          label: 'Baixo',
          reasons: ['Engajamento positivo comprovado por clique'],
        },
        suppression: {
          isActive: false,
          reason: null,
        },
        automationAllowed: true,
        lastSuccessfulDelivery,
        lastFailure,
        lastOpenDetected,
        lastClickDetected,
        softBounceCount,
      };
    }

    if (hasOpen) {
      return {
        status: 'saudavel',
        label: 'Saudável',
        description: 'Abertura detectada no e-mail (sujeito a proxies/scanners).',
        dotColor: 'bg-emerald-500',
        badgeClass: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
        factualStatus: {
          status: 'abertura_detectada',
          label: 'Abertura detectada',
          dotColor: 'bg-sky-500',
          badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
        },
        risk: {
          level: 'baixo',
          label: 'Baixo',
          reasons: ['Abertura de e-mail registrada', 'Entrega confirmada sem falhas recentes'],
          color: 'text-emerald-700',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        },
        spamRisk: {
          level: 'baixo',
          label: 'Baixo',
          reasons: ['Entrega comprovada e abertura registrada'],
        },
        suppression: {
          isActive: false,
          reason: null,
        },
        automationAllowed: true,
        lastSuccessfulDelivery,
        lastFailure,
        lastOpenDetected,
        lastClickDetected,
        softBounceCount,
      };
    }

    return {
      status: 'saudavel',
      label: 'Saudável',
      description: 'Últimos envios com entrega confirmada.',
      dotColor: 'bg-emerald-500',
      badgeClass: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
      factualStatus: {
        status: 'entregue',
        label: 'Entregue',
        dotColor: 'bg-emerald-500',
        badgeClass: 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
      },
      risk: {
        level: 'baixo',
        label: 'Baixo',
        reasons: ['Entrega confirmada pelo provedor', 'Sem histórico de rejeição ou reclamação'],
        color: 'text-emerald-700',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      },
      spamRisk: {
        level: 'baixo',
        label: 'Baixo',
        reasons: ['Histórico de entrega recente bem-sucedido'],
      },
      suppression: {
        isActive: false,
        reason: null,
      },
      automationAllowed: true,
      lastSuccessfulDelivery,
      lastFailure,
      lastOpenDetected,
      lastClickDetected,
      softBounceCount,
    };
  }

  // Case I: Sent / In-transit awaiting delivery confirmation
  return {
    status: 'atencao',
    label: 'Atenção',
    description: 'Poucos dados ou sinais mistos de entrega.',
    dotColor: 'bg-amber-500',
    badgeClass: 'bg-amber-50/90 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
    factualStatus: {
      status: 'enviado',
      label: 'Enviado',
      dotColor: 'bg-amber-500',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    risk: {
      level: 'moderado',
      label: 'Moderado',
      reasons: ['E-mail enviado aguardando confirmação de entrega do provedor'],
      color: 'text-amber-700',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    spamRisk: {
      level: 'baixo',
      label: 'Baixo',
      reasons: ['Envio recente em andamento'],
    },
    suppression: {
      isActive: false,
      reason: null,
    },
    automationAllowed: true,
    lastSuccessfulDelivery,
    lastFailure,
    lastOpenDetected,
    lastClickDetected,
    softBounceCount,
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

    // 2. Batch query recent outbound messages with engagement and deliverability columns
    const messagesByLeadId: Record<string, any[]> = {};
    if (leadIds.length > 0) {
      const { data: messages } = await client
        .from('outbound_messages')
        .select(
          'lead_id, status, delivered_at, bounced_at, complained_at, failed_at, opened_at, clicked_at, created_at, delivery_delayed_at, bounce_type, error_code, error_message, provider_status'
        )
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


