import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Calendar,
  AlertCircle,
  Clock,
  DollarSign,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { KpiCardsSection } from './components/KpiCardsSection';
import { SalesFunnelWidget } from './components/SalesFunnelWidget';
import { PriorityLeadsWidget } from './components/PriorityLeadsWidget';
import { NeedsAttentionWidget } from './components/NeedsAttentionWidget';
import { ActivityTrendWidget } from './components/ActivityTrendWidget';
import { ScoreAndInterestWidget } from './components/ScoreAndInterestWidget';
import { SourceAndChannelWidget } from './components/SourceAndChannelWidget';
import { AutomationVelocityWidget } from './components/AutomationVelocityWidget';
import { TasksAndConversationsWidget } from './components/TasksAndConversationsWidget';
import {
  fetchSalesDashboardMetrics,
  getDateRangeBoundaries,
} from './services/dashboard-service';
import {
  exportPriorityLeadsToCsv,
  exportNeedsAttentionToCsv,
  exportPipelineSummaryToCsv,
} from './utils/dashboard-export';
import type {
  SalesDashboardMetrics,
  DashboardPeriodFilter,
  RevenueDashboardMetrics,
} from '../../types/database';
import {
  fetchRevenueDashboardMetrics,
  formatCurrency,
  formatTicket,
} from '../revenue/services/revenue-service';

export const SalesDashboardPage: React.FC = () => {
  const [periodFilter, setPeriodFilter] = useState<DashboardPeriodFilter>('30d');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customEnd, setCustomEnd] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [metrics, setMetrics] = useState<SalesDashboardMetrics | null>(null);
  const [revMetrics, setRevMetrics] = useState<RevenueDashboardMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const boundaries = getDateRangeBoundaries(
        periodFilter,
        customStart,
        customEnd
      );
      const [salesData, revenueData] = await Promise.all([
        fetchSalesDashboardMetrics(boundaries.startDate, boundaries.endDate),
        fetchRevenueDashboardMetrics(boundaries.startDate, boundaries.endDate).catch((e) => {
          console.warn('Revenue metrics non-fatal error:', e);
          return null;
        }),
      ]);
      setMetrics(salesData);
      setRevMetrics(revenueData);
      setLastUpdated(new Date().toLocaleTimeString('pt-BR'));
    } catch (err: unknown) {
      console.error('Failed to load dashboard:', err);
      const msg = err instanceof Error ? err.message : 'Falha ao carregar métricas do dashboard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [periodFilter, customStart, customEnd]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const boundaries = getDateRangeBoundaries(periodFilter, customStart, customEnd);

  return (
    <Layout
      eyebrow="VISÃO GERAL OPERACIONAL"
      title="Sales Intelligence Dashboard"
      subtitle="Métricas comerciais executivas, funil de conversão e saúde da operação"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Period Filter Buttons */}
          <div className="inline-flex rounded-xl border border-slate-200/90 bg-white p-1 shadow-2xs">
            {(
              [
                { id: 'today', label: 'Hoje' },
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: 'custom', label: 'Personalizado' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                id={`period-btn-${opt.id}`}
                onClick={() => setPeriodFilter(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-heading transition-all cursor-pointer ${
                  periodFilter === opt.id
                    ? 'bg-[#08254f] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          {periodFilter === 'custom' && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-slate-200/90 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-xs bg-transparent border-none text-slate-700 focus:ring-0 p-1"
              />
              <span className="text-slate-400 text-xs">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-xs bg-transparent border-none text-slate-700 focus:ring-0 p-1"
              />
            </div>
          )}

          {/* View Full Reports Button */}
          <Link
            to="/reports"
            id="view-full-reports-btn"
            className="flex items-center gap-1.5 px-3 py-2 bg-[#08254f] hover:bg-[#061e40] text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Relatórios</span>
          </Link>

          {/* Refresh Button */}
          <button
            type="button"
            id="dashboard-refresh-btn"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/90 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#449bd5]' : ''}`} />
            <span>Atualizar</span>
          </button>

          {/* Last Updated Indicator */}
          {lastUpdated && (
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400 pl-1">
              <Clock className="w-3 h-3" />
              <span>{lastUpdated}</span>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-6 sm:space-y-8">

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div className="flex-1 text-xs text-red-800 font-medium">
                {error}
              </div>
              <button
                type="button"
                onClick={loadData}
                className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* Loading Skeleton */}
          {loading && !metrics && (
            <div className="space-y-6 animate-pulse">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-28 bg-gray-200 rounded-xl" />
                ))}
              </div>
              <div className="h-72 bg-gray-200 rounded-xl" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="h-80 bg-gray-200 rounded-xl" />
                <div className="h-80 bg-gray-200 rounded-xl" />
              </div>
            </div>
          )}

          {/* Loaded Dashboard Content */}
          {metrics && (
            <div className="space-y-8">
              {/* Row 1: Primary Funnel KPI Cards */}
              <KpiCardsSection metrics={metrics} />

              {/* Row 2: Sales Funnel & Current Stage Distribution */}
              <SalesFunnelWidget
                pipeline={metrics.pipeline}
                qualification={metrics.qualification}
                onExportPipeline={() =>
                  exportPipelineSummaryToCsv(metrics.pipeline, boundaries.label)
                }
              />

              {/* Row 3: Priority Leads & Needs Attention */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PriorityLeadsWidget
                  leads={metrics.priority_leads || []}
                  onExportCsv={() =>
                    exportPriorityLeadsToCsv(metrics.priority_leads || [], boundaries.label)
                  }
                />
                <NeedsAttentionWidget
                  items={metrics.needs_attention || []}
                  onExportCsv={() =>
                    exportNeedsAttentionToCsv(metrics.needs_attention || [], boundaries.label)
                  }
                />
              </div>

              {/* Row 4: Tasks & Conversations Status */}
              <TasksAndConversationsWidget
                tasks={metrics.tasks}
                snapshot={metrics.snapshot}
              />

              {/* Row 5: Course Interest & Demographics */}
              <ScoreAndInterestWidget
                scoring={metrics.scoring}
                demographics={metrics.demographics}
              />

              {/* Row 6: Canonical Sources & Contact Preferences */}
              <SourceAndChannelWidget demographics={metrics.demographics} />

              {/* Row 7: Automation Velocity & Activity Trend */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AutomationVelocityWidget automation={metrics.automation} />
                <ActivityTrendWidget
                  trend={metrics.activity?.trend || []}
                  periodLabel={boundaries.label}
                />
              </div>

              {/* Row 8: Commercial & Revenue Highlights Bar (Secondary Operational Closure) */}
              {revMetrics && revMetrics.kpis && (
                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 shadow-2xs">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Receita & Fechamento Comercial ({boundaries.label})
                      </span>
                      <div className="flex flex-wrap items-center gap-4 sm:gap-6 mt-1 text-xs">
                        <div>
                          <span className="text-slate-400">Net Revenue:</span>{' '}
                          <strong className="text-emerald-700 font-extrabold text-sm">
                            {formatCurrency(revMetrics.kpis?.net_revenue ?? 0, revMetrics.goals?.default_currency || 'USD')}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400">Matrículas:</span>{' '}
                          <strong className="text-[#08254f] font-extrabold text-sm">
                            {revMetrics.kpis?.confirmed_enrollments_count ?? 0}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400">Ticket Médio:</span>{' '}
                          <strong className="text-slate-800 font-bold">
                            {formatTicket(revMetrics.kpis?.average_ticket ?? 0, revMetrics.goals?.default_currency || 'USD')}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400">Approved Not Enrolled:</span>{' '}
                          <strong className="text-amber-700 font-bold">
                            {revMetrics.approved_not_enrolled?.length ?? 0}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Link
                    to="/dashboard/revenue"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#125e95] bg-[#e1f0fb] hover:bg-[#125e95] hover:text-white transition-all shrink-0"
                  >
                    Ver Inteligência Completa
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </Layout>
    );
  };
  export default SalesDashboardPage;
