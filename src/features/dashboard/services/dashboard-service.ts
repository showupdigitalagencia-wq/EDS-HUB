// =============================================================================
// Sales Intelligence Dashboard Service
// =============================================================================
// Handles date range UTC conversions, RPC calls, and metric formatters.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type {
  SalesDashboardMetrics,
  DashboardPeriodFilter,
} from '../../../types/database';

export interface DateRangeBoundaries {
  startDate: string; // ISO UTC string
  endDate: string;   // ISO UTC string
  label: string;
}

/**
 * Calculates UTC boundary timestamps for dashboard periods.
 * Avoids client-local timezone date-shifting bugs.
 */
export function getDateRangeBoundaries(
  filter: DashboardPeriodFilter,
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
): DateRangeBoundaries {
  const now = referenceDate;

  // Create UTC day boundaries
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();

  const endOfTodayUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 23, 59, 59, 999)).toISOString();

  switch (filter) {
    case 'today': {
      const startOfTodayUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 0, 0, 0, 0)).toISOString();
      return {
        startDate: startOfTodayUtc,
        endDate: endOfTodayUtc,
        label: 'Hoje',
      };
    }
    case '7d': {
      const start7d = new Date(Date.UTC(currentYear, currentMonth, currentDay - 6, 0, 0, 0, 0)).toISOString();
      return {
        startDate: start7d,
        endDate: endOfTodayUtc,
        label: 'Últimos 7 dias',
      };
    }
    case '30d': {
      const start30d = new Date(Date.UTC(currentYear, currentMonth, currentDay - 29, 0, 0, 0, 0)).toISOString();
      return {
        startDate: start30d,
        endDate: endOfTodayUtc,
        label: 'Últimos 30 dias',
      };
    }
    case '90d': {
      const start90d = new Date(Date.UTC(currentYear, currentMonth, currentDay - 89, 0, 0, 0, 0)).toISOString();
      return {
        startDate: start90d,
        endDate: endOfTodayUtc,
        label: 'Últimos 90 dias',
      };
    }
    case 'custom': {
      if (customStart && customEnd) {
        const [sY, sM, sD] = customStart.split('-').map(Number);
        const [eY, eM, eD] = customEnd.split('-').map(Number);
        const startCustom = new Date(Date.UTC(sY, sM - 1, sD, 0, 0, 0, 0)).toISOString();
        const endCustom = new Date(Date.UTC(eY, eM - 1, eD, 23, 59, 59, 999)).toISOString();
        return {
          startDate: startCustom,
          endDate: endCustom,
          label: `${customStart} até ${customEnd}`,
        };
      }
      // Fallback to 30d if invalid custom
      const fallback30d = new Date(Date.UTC(currentYear, currentMonth, currentDay - 29, 0, 0, 0, 0)).toISOString();
      return {
        startDate: fallback30d,
        endDate: endOfTodayUtc,
        label: 'Últimos 30 dias',
      };
    }
  }
}

/**
 * Invokes the server-side aggregator RPC get_sales_dashboard_metrics
 */
export async function fetchSalesDashboardMetrics(
  startDate: string,
  endDate: string
): Promise<SalesDashboardMetrics> {
  const { data, error } = await supabase.rpc('get_sales_dashboard_metrics', {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error('Failed to fetch sales dashboard metrics:', error);
    throw error;
  }

  return data as SalesDashboardMetrics;
}

/**
 * Formats response time in seconds to human-readable string.
 * Returns 'No data' if seconds is null.
 */
export function formatFirstResponseTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) {
    return 'No data';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = (seconds / 86400).toFixed(1);
  return `${days}d`;
}

/**
 * Formats rate percentage. Returns 'No data' if null/undefined.
 * Never outputs NaN or Infinity.
 */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || isNaN(rate) || !isFinite(rate)) {
    return 'No data';
  }
  return `${rate.toFixed(1)}%`;
}
