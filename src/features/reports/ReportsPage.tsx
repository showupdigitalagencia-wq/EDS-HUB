import { useState, useEffect, useCallback, type ComponentType } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  GitFork,
  DollarSign,
  Globe,
  GraduationCap,
  Activity,
  Award,
  Download,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import {
  getDatePresetRange,
  fetchExecutiveOverview,
  fetchFunnelReport,
  fetchRevenueReport,
  fetchSourcesReport,
  fetchCoursesReport,
  fetchEngagementReport,
  fetchPostCourseReport,
  exportExecutiveCSV,
  exportRevenueCSV,
  exportSourcesCSV,
  exportCoursesCSV,
  exportFunnelCSV,
  downloadCSV,
  parseReportsUrlParams,
  buildReportsUrlParams,
} from './services/reporting-service';
import { Layout } from '../../components/Layout';
import type {
  ReportTab,
  DateRangePreset,
  ExecutiveOverviewData,
  FunnelReportData,
  RevenueReportData,
  SourcesReportData,
  CoursesReportData,
  EngagementReportData,
  PostCourseReportData,
  ReportsFilter,
} from './types/reporting';

import { ExecutiveTab } from './components/ExecutiveTab';
import { FunnelTab } from './components/FunnelTab';
import { RevenueTab } from './components/RevenueTab';
import { SourcesTab } from './components/SourcesTab';
import { CoursesTab } from './components/CoursesTab';
import { EngagementTab } from './components/EngagementTab';
import { PostCourseTab } from './components/PostCourseTab';

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialParsed = parseReportsUrlParams(searchParams);
  const [activeTab, setActiveTab] = useState<ReportTab>(initialParsed.tab || 'executive');
  const [preset, setPreset] = useState<DateRangePreset>(initialParsed.preset || 'last_30_days');

  // Date boundaries
  const initialDates = initialParsed.startDate && initialParsed.endDate
    ? { startDate: initialParsed.startDate, endDate: initialParsed.endDate }
    : getDatePresetRange(initialParsed.preset || 'last_30_days');

  const [startDate, setStartDate] = useState<string>(initialDates.startDate);
  const [endDate, setEndDate] = useState<string>(initialDates.endDate);
  const [includeTest, setIncludeTest] = useState<boolean>(initialParsed.includeTest || false);
  const [courseFilterId, setCourseFilterId] = useState<string | undefined>(initialParsed.courseId);

  // Data states for each tab
  const [executiveData, setExecutiveData] = useState<ExecutiveOverviewData | null>(null);
  const [funnelData, setFunnelData] = useState<FunnelReportData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueReportData | null>(null);
  const [sourcesData, setSourcesData] = useState<SourcesReportData | null>(null);
  const [coursesData, setCoursesData] = useState<CoursesReportData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementReportData | null>(null);
  const [postCourseData, setPostCourseData] = useState<PostCourseReportData | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sync state to URL
  const updateUrlParams = useCallback((newFilter: ReportsFilter) => {
    const params = buildReportsUrlParams(newFilter);
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  // Handle Preset change
  const handlePresetChange = (newPreset: DateRangePreset) => {
    setPreset(newPreset);
    if (newPreset !== 'custom') {
      const dates = getDatePresetRange(newPreset);
      setStartDate(dates.startDate);
      setEndDate(dates.endDate);
      updateUrlParams({
        tab: activeTab,
        preset: newPreset,
        startDate: dates.startDate,
        endDate: dates.endDate,
        courseId: courseFilterId,
        includeTest,
      });
    } else {
      updateUrlParams({
        tab: activeTab,
        preset: 'custom',
        startDate,
        endDate,
        courseId: courseFilterId,
        includeTest,
      });
    }
  };

  const handleTabChange = (newTab: ReportTab) => {
    setActiveTab(newTab);
    updateUrlParams({
      tab: newTab,
      preset,
      startDate,
      endDate,
      courseId: courseFilterId,
      includeTest,
    });
  };

  const handleIncludeTestToggle = (checked: boolean) => {
    setIncludeTest(checked);
    updateUrlParams({
      tab: activeTab,
      preset,
      startDate,
      endDate,
      courseId: courseFilterId,
      includeTest: checked,
    });
  };

  const handleCourseFilterChange = (courseId: string | undefined) => {
    setCourseFilterId(courseId);
    updateUrlParams({
      tab: activeTab,
      preset,
      startDate,
      endDate,
      courseId,
      includeTest,
    });
  };

  // Load active tab data
  const loadActiveTabData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      switch (activeTab) {
        case 'executive': {
          const res = await fetchExecutiveOverview(startDate, endDate, includeTest);
          setExecutiveData(res);
          break;
        }
        case 'funnel': {
          const res = await fetchFunnelReport(startDate, endDate, includeTest);
          setFunnelData(res);
          break;
        }
        case 'revenue': {
          const res = await fetchRevenueReport(startDate, endDate, undefined, includeTest);
          setRevenueData(res);
          break;
        }
        case 'sources': {
          const res = await fetchSourcesReport(startDate, endDate, includeTest);
          setSourcesData(res);
          break;
        }
        case 'courses': {
          const res = await fetchCoursesReport(startDate, endDate, courseFilterId, includeTest);
          setCoursesData(res);
          break;
        }
        case 'engagement': {
          const res = await fetchEngagementReport(startDate, endDate, includeTest);
          setEngagementData(res);
          break;
        }
        case 'post_course': {
          const res = await fetchPostCourseReport(startDate, endDate, includeTest);
          setPostCourseData(res);
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load report data.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeTab, startDate, endDate, includeTest, courseFilterId]);

  useEffect(() => {
    loadActiveTabData();
  }, [loadActiveTabData]);

  // CSV Export Handler
  const handleExportCSV = () => {
    const timestamp = new Date().toISOString().slice(0, 10);
    switch (activeTab) {
      case 'sources':
        if (sourcesData) {
          const csv = exportSourcesCSV(sourcesData);
          downloadCSV(`eds-source-performance-${timestamp}.csv`, csv);
        }
        break;
      case 'courses':
        if (coursesData) {
          const csv = exportCoursesCSV(coursesData);
          downloadCSV(`eds-course-performance-${timestamp}.csv`, csv);
        }
        break;
      case 'revenue':
        if (revenueData) {
          const csv = exportRevenueCSV(revenueData);
          downloadCSV(`eds-revenue-trends-${timestamp}.csv`, csv);
        }
        break;
      case 'funnel':
        if (funnelData) {
          const csv = exportFunnelCSV(funnelData);
          downloadCSV(`eds-cohort-funnel-${timestamp}.csv`, csv);
        }
        break;
      case 'executive':
      default:
        if (executiveData) {
          const csv = exportExecutiveCSV(executiveData);
          downloadCSV(`eds-executive-overview-${timestamp}.csv`, csv);
        }
        break;
    }
  };

  const orgTimezone = executiveData?.metadata.timezone || 'America/New_York';

  const tabs: Array<{ id: ReportTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'executive', label: 'Executivo', icon: BarChart3 },
    { id: 'funnel', label: 'Funil Comercial', icon: GitFork },
    { id: 'revenue', label: 'Receita', icon: DollarSign },
    { id: 'sources', label: 'Origens', icon: Globe },
    { id: 'courses', label: 'Cursos', icon: GraduationCap },
    { id: 'engagement', label: 'Engajamento', icon: Activity },
    { id: 'post_course', label: 'Pós-Curso', icon: Award },
  ];

  return (
    <Layout
      eyebrow="INTELLIGENCE & RELATÓRIOS"
      title="Relatórios & Analytics"
      subtitle="Inteligência comercial unificada, conversão de coortes e integridade de faturamento"
    >
      <div className="space-y-6 pb-12">
        {/* Top Control Bar */}
        <div className="card-executive p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#08254f] font-heading tracking-tight">
                  Executive Analytics & Reports
                </h2>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  Fuso: {orgTimezone}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Visão consolidada com precisão de coortes e conciliação comercial
              </p>
            </div>

            {/* Filter Bar Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Date Preset Selector */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
                <select
                  value={preset}
                  onChange={(e) => handlePresetChange(e.target.value as DateRangePreset)}
                  className="text-xs bg-transparent border-0 font-medium text-[#08254f] focus:ring-0 focus:outline-hidden cursor-pointer"
                >
                  <option value="last_7_days">Últimos 7 dias</option>
                  <option value="last_30_days">Últimos 30 dias</option>
                  <option value="last_90_days">Últimos 90 dias</option>
                  <option value="this_month">Este mês</option>
                  <option value="last_month">Mês passado</option>
                  <option value="this_quarter">Este trimestre</option>
                  <option value="this_year">Este ano</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>

              {/* Custom Date Pickers */}
              {preset === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      updateUrlParams({
                        tab: activeTab,
                        preset: 'custom',
                        startDate: e.target.value,
                        endDate,
                        courseId: courseFilterId,
                        includeTest,
                      });
                    }}
                    className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white text-[#08254f]"
                  />
                  <span className="text-xs text-slate-400">até</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      updateUrlParams({
                        tab: activeTab,
                        preset: 'custom',
                        startDate,
                        endDate: e.target.value,
                        courseId: courseFilterId,
                        includeTest,
                      });
                    }}
                    className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white text-[#08254f]"
                  />
                </div>
              )}

              {/* Include Test Toggle */}
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={includeTest}
                  onChange={(e) => handleIncludeTestToggle(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-[#08254f] focus:ring-[#08254f] border-slate-300"
                />
                <span>Incluir Testes</span>
              </label>

              {/* Refresh Button */}
              <button
                onClick={() => loadActiveTabData()}
                title="Recarregar dados"
                disabled={loading}
                className="btn-secondary text-xs p-2"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#08254f]' : ''}`} />
              </button>

              {/* CSV Export Button */}
              <button
                onClick={handleExportCSV}
                disabled={loading}
                className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5 shadow-2xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mt-6 border-t border-slate-100 overflow-x-auto pt-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#08254f] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Tab Content */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => loadActiveTabData()}
              className="font-bold underline ml-4 hover:text-rose-950 cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {loading ? (
          <div className="card-executive p-12 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-[#08254f] mx-auto mb-3" />
            <p className="text-xs font-medium text-slate-500">Carregando dados analíticos...</p>
          </div>
        ) : (
        <div>
          {activeTab === 'executive' && executiveData && (
            <ExecutiveTab
              data={executiveData}
              onSelectTab={(t) => handleTabChange(t as ReportTab)}
            />
          )}
          {activeTab === 'funnel' && funnelData && (
            <FunnelTab data={funnelData} />
          )}
          {activeTab === 'revenue' && revenueData && (
            <RevenueTab data={revenueData} />
          )}
          {activeTab === 'sources' && sourcesData && (
            <SourcesTab data={sourcesData} />
          )}
          {activeTab === 'courses' && coursesData && (
            <CoursesTab
              data={coursesData}
              selectedCourseId={courseFilterId}
              onSelectCourse={handleCourseFilterChange}
            />
          )}
          {activeTab === 'engagement' && engagementData && (
            <EngagementTab data={engagementData} />
          )}
          {activeTab === 'post_course' && postCourseData && (
            <PostCourseTab data={postCourseData} />
          )}
        </div>
      )}
      </div>
    </Layout>
  );
}
