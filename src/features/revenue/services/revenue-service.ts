// =============================================================================
// Revenue & Enrollment Intelligence Service
// =============================================================================
// Handles RPC calls for revenue metrics, courses, enrollment transactions,
// payments, and financial calculations.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type {
  Course,
  Enrollment,
  EnrollmentPayment,
  EnrollmentStatus,
  PaymentStatus,
  PaymentMethod,
  RevenueDashboardMetrics,
  LeadSource,
} from '../../../types/database';

export interface CreateEnrollmentPayload {
  leadId: string;
  courseId: string;
  enrollmentStatus: EnrollmentStatus;
  agreedAmount: number;
  currency?: string;
  enrollmentDate?: string;
  source?: LeadSource;
  notes?: string;
  idempotencyKey?: string;
  initialPaymentAmount?: number;
  initialPaymentStatus?: PaymentStatus;
  initialPaymentMethod?: PaymentMethod;
  initialPaymentDate?: string;
  initialPaymentRef?: string;
}

export interface UpdateEnrollmentPayload {
  enrollmentId: string;
  enrollmentStatus: EnrollmentStatus;
  agreedAmount: number;
  courseId: string;
  enrollmentDate: string;
  notes?: string;
}

export interface RecordPaymentPayload {
  enrollmentId: string;
  amount: number;
  currency?: string;
  paymentStatus?: PaymentStatus;
  paymentDate?: string;
  paymentMethod?: PaymentMethod | null;
  externalReference?: string;
  notes?: string;
  idempotencyKey?: string;
  paymentType?: 'payment' | 'refund';
  parentPaymentId?: string | null;
}

export interface RecordRefundPayload {
  parentPaymentId: string;
  amount: number;
  reason?: string;
  idempotencyKey?: string;
}

/**
 * Invokes server-side aggregator RPC get_revenue_dashboard_metrics
 */
export async function fetchRevenueDashboardMetrics(
  startDate: string,
  endDate: string
): Promise<RevenueDashboardMetrics> {
  const { data, error } = await supabase.rpc('get_revenue_dashboard_metrics', {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error('Failed to fetch revenue dashboard metrics:', error);
    throw error;
  }

  return data as RevenueDashboardMetrics;
}

/**
 * Fetches all courses from catalog (can include inactive if specified)
 */
export async function fetchCourses(includeInactive = false): Promise<Course[]> {
  let query = supabase.from('courses').select('*').order('code', { ascending: true });

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch courses:', error);
    throw error;
  }

  return (data || []) as Course[];
}

/**
 * Updates a course pricing, currency or active status
 */
export async function updateCourse(
  courseId: string,
  updates: {
    default_price?: number | null;
    currency?: string;
    active?: boolean;
  }
): Promise<void> {
  const { error } = await supabase
    .from('courses')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', courseId);

  if (error) {
    console.error('Failed to update course:', error);
    throw error;
  }
}

/**
 * Fetches all enrollments for a specific lead, with payments and course details
 */
export async function fetchLeadEnrollments(leadId: string): Promise<Enrollment[]> {
  const { data, error } = await supabase
    .from('enrollments')
    .select(`
      *,
      course:courses(*),
      session:course_sessions(*),
      participation:course_participations(*),
      post_course_engagement:post_course_engagements(*),
      payments:enrollment_payments(*)
    `)
    .eq('lead_id', leadId)
    .order('enrollment_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch lead enrollments:', error);
    throw error;
  }

  const list = (data || []) as unknown as Enrollment[];

  return list.map((e) => {
    const balances = deriveEnrollmentBalances(e.agreed_amount, e.payments);
    return {
      ...e,
      paid_amount: balances.netPaid,
      remaining_balance: balances.balance,
    };
  });
}

/**
 * Creates enrollment via atomic server-side RPC create_enrollment_transaction
 */
export async function createEnrollment(
  payload: CreateEnrollmentPayload
): Promise<string> {
  const { data, error } = await supabase.rpc('create_enrollment_transaction', {
    p_lead_id: payload.leadId,
    p_course_id: payload.courseId,
    p_agreed_amount: payload.agreedAmount,
    p_currency: payload.currency || 'USD',
    p_enrollment_status: payload.enrollmentStatus,
    p_enrollment_date: payload.enrollmentDate || new Date().toISOString().split('T')[0],
    p_source: payload.source || 'manual',
    p_notes: payload.notes || null,
    p_initial_payment_amount: payload.initialPaymentAmount || null,
    p_initial_payment_method: payload.initialPaymentMethod || null,
    p_initial_payment_ref: payload.initialPaymentRef || null,
    p_idempotency_key: payload.idempotencyKey || null,
  });

  if (error) {
    console.error('Failed to create enrollment transaction:', error);
    throw error;
  }

  return data as string;
}

/**
 * Updates enrollment via atomic server-side RPC update_enrollment_transaction
 */
export async function updateEnrollment(
  payload: UpdateEnrollmentPayload
): Promise<string> {
  const { data, error } = await supabase.rpc('update_enrollment_transaction', {
    p_enrollment_id: payload.enrollmentId,
    p_enrollment_status: payload.enrollmentStatus,
    p_agreed_amount: payload.agreedAmount,
    p_course_id: payload.courseId,
    p_enrollment_date: payload.enrollmentDate,
    p_notes: payload.notes || null,
  });

  if (error) {
    console.error('Failed to update enrollment transaction:', error);
    throw error;
  }

  return data as string;
}

/**
 * Records payment via atomic server-side RPC record_enrollment_payment
 */
export async function recordPayment(
  payload: RecordPaymentPayload
): Promise<string> {
  const { data, error } = await supabase.rpc('record_enrollment_payment', {
    p_enrollment_id: payload.enrollmentId,
    p_amount: payload.amount,
    p_currency: payload.currency || 'USD',
    p_payment_method: payload.paymentMethod || 'credit_card',
    p_payment_date: payload.paymentDate || new Date().toISOString().split('T')[0],
    p_payment_status: payload.paymentStatus || 'paid',
    p_external_ref: payload.externalReference || null,
    p_notes: payload.notes || null,
    p_idempotency_key: payload.idempotencyKey || null,
    p_payment_type: payload.paymentType || 'payment',
    p_parent_payment_id: payload.parentPaymentId || null,
  });

  if (error) {
    console.error('Failed to record enrollment payment:', error);
    throw error;
  }

  return data as string;
}

/**
 * Records refund via dedicated helper RPC record_enrollment_refund
 */
export async function recordRefund(
  payload: RecordRefundPayload
): Promise<string> {
  const { data, error } = await supabase.rpc('record_enrollment_refund', {
    p_parent_payment_id: payload.parentPaymentId,
    p_amount: payload.amount,
    p_reason: payload.reason || null,
    p_idempotency_key: payload.idempotencyKey || null,
  });

  if (error) {
    console.error('Failed to record enrollment refund:', error);
    throw error;
  }

  return data as string;
}

/**
 * Updates payment status via update_enrollment_payment_status
 */
export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  notes?: string
): Promise<void> {
  const { error } = await supabase.rpc('update_enrollment_payment_status', {
    p_payment_id: paymentId,
    p_payment_status: status,
    p_notes: notes || null,
  });

  if (error) {
    console.error('Failed to update payment status:', error);
    throw error;
  }
}

/**
 * Derives financial balances from payments
 * - grossPaid: total payments of type 'payment' with status 'paid'
 * - refunded: total payments of type 'refund' with status 'paid' (or payments with status 'refunded')
 * - netPaid: grossPaid - refunded
 * - balance: Math.max(agreedAmount - netPaid, 0)
 */
export function deriveEnrollmentBalances(
  agreedAmount: number,
  payments?: EnrollmentPayment[]
): { grossPaid: number; paidAmount: number; refunded: number; netPaid: number; balance: number } {
  if (!payments || payments.length === 0) {
    return {
      grossPaid: 0,
      paidAmount: 0,
      refunded: 0,
      netPaid: 0,
      balance: Math.max(agreedAmount, 0),
    };
  }

  let grossPaid = 0;
  let refunded = 0;

  for (const p of payments) {
    const amt = Number(p.amount) || 0;
    const isRefundType = p.payment_type === 'refund';

    if (p.payment_status === 'paid') {
      if (isRefundType) {
        refunded += amt;
      } else {
        grossPaid += amt;
      }
    } else if (p.payment_status === 'refunded') {
      // Fallback for any legacy status representation
      refunded += amt;
    }
  }

  const netPaid = grossPaid - refunded;
  const balance = Math.max(agreedAmount - netPaid, 0);

  return {
    grossPaid,
    paidAmount: grossPaid,
    refunded,
    netPaid,
    balance,
  };
}

/**
 * Currency formatter with explicit currency code (default USD)
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency: string = 'USD'
): string {
  if (amount === null || amount === undefined || isNaN(amount) || !isFinite(amount)) {
    return '—';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Average ticket formatter. Returns 'No data' if null/undefined/NaN.
 */
export function formatTicket(
  amount: number | null | undefined,
  currency: string = 'USD'
): string {
  if (amount === null || amount === undefined || isNaN(amount) || !isFinite(amount)) {
    return 'No data';
  }
  return formatCurrency(amount, currency);
}

/**
 * Rate percentage formatter. Returns 'No data' if null/undefined/NaN.
 */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || isNaN(rate) || !isFinite(rate)) {
    return 'No data';
  }
  return `${rate.toFixed(1)}%`;
}
