import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Calendar,
  AlertCircle,
  Clock,
  AlertOctagon,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { KpiCardsSection } from './components/KpiCardsSection';
import { SalesFunnelWidget } from './components/SalesFunnelWidget';
import { NeedsAttentionWidget } from './components/NeedsAttentionWidget';
import { TasksAndConversationsWidget } from './components/TasksAndConversationsWidget';
import { EmailHealthCard } from './components/EmailHealthCard';
import { IncompleteEnrollmentsWidget } from './components/IncompleteEnrollmentsWidget';
import { ActivityTrendWidget } from './components/ActivityTrendWidget';
import {
  fetchSalesDashboardMetrics,
  getDateRangeBoundaries,
} from './services/dashboard-service';
import {
  fetchDeliverabilityHealth,
  type DeliverabilityHealthSummary,
} from './services/deliverability-health-service';
import {
  fetchPendingIncompleteEnrollments,
  type PendingIncompleteEnrollmentItem,
} from '../leads/services/incomplete-enrollment-service';
import {
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
  const [deliverabilityHealth, setDeliverabilityHealth] = useState<DeliverabilityHealthSummary | null>(null);
  const [incompleteEnrollments, setIncompleteEnrollments] = useState<PendingIncompleteEnrollmentItem[]>([]);
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
      const [salesData, healthData, incompleteData] = await Promise.all([
        fetchSalesDashboardMetrics(boundaries.startDate, boundaries.endDate),
        fetchDeliverabilityHealth().catch((e) => {
          console.warn('Deliverability health non-fatal error:', e);
          return null;
        }),
        fetchPendingIncompleteEnrollments(5).catch((e) => {
          console.warn('Incomplete enrollments non-fatal error:', e);
          return [];
        }),
      ]);

      setMetrics(salesData);
      setDeliverabilityHealth(healthData);
      setIncompleteEnrollments(incompleteData || []);
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

  useEffect(() => {
    const handleSync = () => {
      loadData();
    };
    window.addEventListener('tasks-updated', handleSync);
    window.addEventListener('lead-updated', handleSync);
    return () => {
      window.removeEventListener('tasks-updated', handleSync);
      window.removeEventListener('lead-updated', handleSync);
    };
  }, [loadData]);

  const boundaries = getDateRangeBoundaries(periodFilter, customStart, customEnd);
  const hasSpamComplaint = (deliverabilityHealth?.metrics?.complaints ?? 0) > 0;

  return (
    <Layout
      eyebrow="PAINEL OPERACIONAL"
      title="Dashboard"
      subtitle="Acompanhamento diário de leads, pipeline, tarefas e entregabilidade"
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
              <span>Atualizado às {lastUpdated}</span>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-6 sm:space-y-8">
        {/* High-Priority Spam Alert Banner (Domain Reputation Protection) */}
        {hasSpamComplaint && (
          <div
            id="high-priority-spam-banner"
            className="bg-rose-50 border-2 border-rose-400 rounded-2xl p-4.5 flex items-start gap-3.5 shadow-xs"
          >
            <AlertOctagon className="w-5 h-5 text-[#8a1c1c] shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <strong className="text-sm font-bold text-[#8a1c1c] font-heading block">
                Alerta: uma reclamação de spam foi registrada.
              </strong>
              <p className="mt-1 text-rose-800 leading-relaxed">
                O provedor destinatário reportou um evento de reclamação. O contato correspondente foi suprimido automaticamente para proteger a reputação do domínio EDS HUB. Revise a lista de supressões antes de novos disparos.
              </p>
            </div>
          </div>
        )}

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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => (
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
          <div className="space-y-6 sm:space-y-8">
            {/* 1. Primary Operational KPI Cards */}
            <KpiCardsSection
              metrics={metrics}
              incompleteCount={incompleteEnrollments.length}
            />

            {/* 2. Tasks & Conversations Status */}
            <TasksAndConversationsWidget
              tasks={metrics.tasks}
              snapshot={metrics.snapshot}
            />

            {/* 3. Pipeline Funnel & Stage Distribution (Canonical 5 Stages) */}
            <SalesFunnelWidget
              pipeline={metrics.pipeline}
              qualification={metrics.qualification}
              onExportPipeline={() =>
                exportPipelineSummaryToCsv(metrics.pipeline, boundaries.label)
              }
            />

            {/* 4. Deliverability Health Card (Reputation Protection) */}
            <EmailHealthCard
              summary={deliverabilityHealth}
              loading={loading}
            />

            {/* 5. Operational Bottlenecks: Needs Attention & Incomplete Registrations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <NeedsAttentionWidget
                items={metrics.needs_attention || []}
                onExportCsv={() =>
                  exportNeedsAttentionToCsv(metrics.needs_attention || [], boundaries.label)
                }
              />
              <IncompleteEnrollmentsWidget
                items={incompleteEnrollments}
                loading={loading}
              />
            </div>

            {/* 6. Recent Operational Activity Trend */}
            {metrics.activity?.trend && metrics.activity.trend.length > 0 && (
              <ActivityTrendWidget
                trend={metrics.activity.trend}
                periodLabel={boundaries.label}
              />
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default SalesDashboardPage;
