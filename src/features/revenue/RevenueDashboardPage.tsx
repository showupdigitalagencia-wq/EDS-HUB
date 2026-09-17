// =============================================================================
// Revenue & Enrollment Intelligence Dashboard Page (/dashboard/revenue)
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import {
  DollarSign,
  RefreshCw,
  Download,
} from 'lucide-react';
import type {
  DashboardPeriodFilter,
  RevenueDashboardMetrics,
} from '../../types/database';
import {
  getDateRangeBoundaries,
} from '../dashboard/services/dashboard-service';
import { fetchRevenueDashboardMetrics } from './services/revenue-service';
import { RevenueKpisWidget } from './components/RevenueKpisWidget';
import { CommercialGoalsWidget } from './components/CommercialGoalsWidget';
import { ConversionAndVelocityWidget } from './components/ConversionAndVelocityWidget';
import { CourseRevenueWidget } from './components/CourseRevenueWidget';
import { SourceRevenueWidget } from './components/SourceRevenueWidget';
import { ApprovedNotEnrolledWidget } from './components/ApprovedNotEnrolledWidget';
import {
  exportCourseRevenueCsv,
  exportSourceRevenueCsv,
  exportApprovedNotEnrolledCsv,
} from './utils/revenue-export';

export function RevenueDashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriodFilter>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [metrics, setMetrics] = useState<RevenueDashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRangeLabel, setActiveRangeLabel] = useState('');

  const loadMetrics = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);
      setError(null);

      try {
        const bounds = getDateRangeBoundaries(period, customStart, customEnd);
        setActiveRangeLabel(bounds.label);
        const data = await fetchRevenueDashboardMetrics(bounds.startDate, bounds.endDate);
        setMetrics(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar inteligência de receita.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [period, customStart, customEnd]
  );

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const handleExportAll = () => {
    if (!metrics) return;
    exportCourseRevenueCsv(metrics.course_performance, activeRangeLabel);
    exportSourceRevenueCsv(metrics.source_performance, activeRangeLabel);
    exportApprovedNotEnrolledCsv(metrics.approved_not_enrolled);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-8 pb-12">
          {/* Top Bar: Header & Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-[#08254f] text-white shadow-xs">
                  <DollarSign className="w-5 h-5 text-[#449bd5]" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-[#08254f] tracking-tight font-heading">
                    Revenue & Enrollment Intelligence
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Métricas auditáveis de faturamento, contratos acadêmicos e conversão comercial ({activeRangeLabel})
                  </p>
                </div>
              </div>
            </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Period Selector Tabs */}
            <div className="bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 flex items-center gap-0.5 text-xs font-semibold text-slate-600">
              {(
                [
                  { id: 'today', label: 'Hoje' },
                  { id: '7d', label: '7D' },
                  { id: '30d', label: '30D' },
                  { id: '90d', label: '90D' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    period === p.id
                      ? 'bg-white text-[#08254f] shadow-xs font-bold'
                      : 'hover:text-slate-900 text-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom Date Inputs if active */}
            {period === 'custom' && (
              <div className="flex items-center gap-1.5 text-xs bg-white p-1 rounded-xl border border-slate-200">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2 py-1 text-slate-700 font-medium bg-slate-50 rounded-lg border-0 focus:ring-1 focus:ring-[#125e95]"
                />
                <span className="text-slate-400 text-xs">até</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2 py-1 text-slate-700 font-medium bg-slate-50 rounded-lg border-0 focus:ring-1 focus:ring-[#125e95]"
                />
              </div>
            )}

            {/* Export All CSV Button */}
            <button
              onClick={handleExportAll}
              disabled={isLoading || !metrics}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 shadow-2xs transition-all disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Exportar CSVs
            </button>

            {/* Refresh Button */}
            <button
              onClick={() => loadMetrics(true)}
              disabled={isLoading || isRefreshing}
              className="p-2 rounded-xl text-slate-500 bg-white border border-slate-200 hover:text-slate-900 hover:bg-slate-50 shadow-2xs transition-all disabled:opacity-50"
              title="Atualizar Métricas"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#125e95]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Body Content */}
        {isLoading && !metrics ? (
          <LoadingState message="Carregando inteligência de receita..." />
        ) : error && !metrics ? (
          <ErrorState message={error} onRetry={() => loadMetrics()} />
        ) : metrics ? (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* 1. KPIs Section */}
            <RevenueKpisWidget kpis={metrics.kpis} currency={metrics.goals.default_currency} />

            {/* 2. Monthly Goals Progress */}
            <CommercialGoalsWidget goals={metrics.goals} kpis={metrics.kpis} />

            {/* 3. Conversions & Velocity */}
            <ConversionAndVelocityWidget
              cohorts={metrics.cohorts}
              velocity={metrics.velocity}
              currency={metrics.goals.default_currency}
            />

            {/* 4. Course Performance Breakdown */}
            <CourseRevenueWidget
              courses={metrics.course_performance}
              currency={metrics.goals.default_currency}
              periodLabel={activeRangeLabel}
            />

            {/* 5. Source Performance Breakdown */}
            <SourceRevenueWidget
              sources={metrics.source_performance}
              currency={metrics.goals.default_currency}
              periodLabel={activeRangeLabel}
            />

            {/* 6. Approved, Not Enrolled Actionable Queue */}
            <ApprovedNotEnrolledWidget leads={metrics.approved_not_enrolled} />
          </div>
        ) : null}
      </div>
    </main>
  </div>
);
}
