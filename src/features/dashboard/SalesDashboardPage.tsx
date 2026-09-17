import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Calendar,
  AlertCircle,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { Sidebar } from '../../components/Sidebar';
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
} from '../../types/database';

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
      const data = await fetchSalesDashboardMetrics(
        boundaries.startDate,
        boundaries.endDate
      );
      setMetrics(data);
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
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Top Bar: Header & Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  Sales Intelligence
                </h1>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Performance comercial, funil de conversão por cohort e monitoramento de automações
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Period Filter Buttons */}
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
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
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      periodFilter === opt.id
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Custom Date Pickers */}
              {periodFilter === 'custom' && (
                <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-200">
                  <Calendar className="w-4 h-4 text-gray-400 ml-1" />
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="text-xs bg-transparent border-none text-gray-700 focus:ring-0 p-1"
                  />
                  <span className="text-gray-400 text-xs">até</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="text-xs bg-transparent border-none text-gray-700 focus:ring-0 p-1"
                  />
                </div>
              )}

              {/* Refresh Button */}
              <button
                type="button"
                id="dashboard-refresh-btn"
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
                Atualizar
              </button>

              {/* Last Updated Indicator */}
              {lastUpdated && (
                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{lastUpdated}</span>
                </div>
              )}
            </div>
          </div>

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
              {/* Row 1: KPI Cards */}
              <KpiCardsSection metrics={metrics} />

              {/* Row 2: Sales Funnel & Snapshot Distribution */}
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
                  leads={metrics.priority_leads}
                  onExportCsv={() =>
                    exportPriorityLeadsToCsv(metrics.priority_leads, boundaries.label)
                  }
                />
                <NeedsAttentionWidget
                  items={metrics.needs_attention}
                  onExportCsv={() =>
                    exportNeedsAttentionToCsv(metrics.needs_attention, boundaries.label)
                  }
                />
              </div>

              {/* Row 4: Activity Trend */}
              <ActivityTrendWidget
                trend={metrics.activity.trend}
                periodLabel={boundaries.label}
              />

              {/* Row 5: Score Distribution & Course Interest */}
              <ScoreAndInterestWidget
                scoring={metrics.scoring}
                demographics={metrics.demographics}
              />

              {/* Row 6: Canonical Sources & Contact Preferences */}
              <SourceAndChannelWidget demographics={metrics.demographics} />

              {/* Row 7: Automation Velocity & Sequence Performance */}
              <AutomationVelocityWidget automation={metrics.automation} />

              {/* Row 8: Tasks & Conversations Status */}
              <TasksAndConversationsWidget
                tasks={metrics.tasks}
                snapshot={metrics.snapshot}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
export default SalesDashboardPage;
