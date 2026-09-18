// =============================================================================
// Revenue & Enrollment Intelligence Dashboard Page (/dashboard/revenue)
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Sidebar } from '../../components/Sidebar';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import {
  DollarSign,
  RefreshCw,
  Download,
  BarChart3,
  Menu,
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

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col lg:flex-row w-full overflow-x-hidden">
      <Sidebar mobileOpen={mobileMenuOpen} onCloseMobile={() => setMobileMenuOpen(false)} />

      {/* Mobile Top Bar (< lg) */}
      <header className="lg:hidden sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-4 py-3 flex items-center justify-between min-h-[56px] shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            id="mobile-revenue-menu-btn"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu lateral"
            className="p-2 -ml-1.5 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-[#08254f] truncate font-heading">
              Revenue Intelligence
            </h1>
            <p className="text-[10px] text-slate-500 truncate">{activeRangeLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadMetrics()}
          disabled={isLoading}
          aria-label="Atualizar dados"
          className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <main className="flex-1 lg:ml-64 p-4 sm:p-6 lg:p-8 overflow-y-auto min-w-0 w-full">
        <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 pb-12">
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

            {/* View Full Reports Button */}
            <Link
              to="/reports?tab=revenue"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#08254f] hover:bg-[#061e40] shadow-2xs transition-all"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              View Full Reports
            </Link>

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
