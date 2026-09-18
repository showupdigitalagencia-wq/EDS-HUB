// =============================================================================
// Executive Reporting & Analytics Service (Phase 5 Block 2)
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type {
  DateRangePreset,
  ExecutiveOverviewData,
  FunnelReportData,
  RevenueReportData,
  SourcesReportData,
  CoursesReportData,
  EngagementReportData,
  PostCourseReportData,
  ReportsFilter,
  ReportTab,
} from '../types/reporting';

/**
 * Calculates start and end dates formatted as YYYY-MM-DD for a given preset.
 */
export function getDatePresetRange(
  preset: DateRangePreset,
  referenceDate: Date = new Date()
): { startDate: string; endDate: string } {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();

  const formatDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dt = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dt}`;
  };

  switch (preset) {
    case 'last_7_days': {
      const start = new Date(year, month, day - 6);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
    case 'last_30_days': {
      const start = new Date(year, month, day - 29);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
    case 'last_90_days': {
      const start = new Date(year, month, day - 89);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
    case 'this_month': {
      const start = new Date(year, month, 1);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
    case 'last_month': {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0); // last day of previous month
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }
    case 'this_quarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const start = new Date(year, quarterStartMonth, 1);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
    case 'this_year': {
      const start = new Date(year, 0, 1);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
    case 'custom':
    default: {
      const start = new Date(year, month, day - 29);
      return { startDate: formatDate(start), endDate: formatDate(referenceDate) };
    }
  }
}

/**
 * Fetch Executive Overview
 */
export async function fetchExecutiveOverview(
  startDate: string,
  endDate: string,
  includeTest: boolean = false
): Promise<ExecutiveOverviewData> {
  const { data, error } = await supabase.rpc('get_reports_executive_overview', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching executive overview report:', error);
    throw new Error(error.message || 'Failed to load executive overview report.');
  }

  return data as ExecutiveOverviewData;
}

/**
 * Fetch Funnel Report
 */
export async function fetchFunnelReport(
  startDate: string,
  endDate: string,
  includeTest: boolean = false
): Promise<FunnelReportData> {
  const { data, error } = await supabase.rpc('get_reports_funnel', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching funnel report:', error);
    throw new Error(error.message || 'Failed to load funnel report.');
  }

  return data as FunnelReportData;
}

/**
 * Fetch Revenue Report
 */
export async function fetchRevenueReport(
  startDate: string,
  endDate: string,
  granularity?: string,
  includeTest: boolean = false
): Promise<RevenueReportData> {
  const { data, error } = await supabase.rpc('get_reports_revenue', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_granularity: granularity || null,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching revenue report:', error);
    throw new Error(error.message || 'Failed to load revenue report.');
  }

  return data as RevenueReportData;
}

/**
 * Fetch Source Performance Report
 */
export async function fetchSourcesReport(
  startDate: string,
  endDate: string,
  includeTest: boolean = false
): Promise<SourcesReportData> {
  const { data, error } = await supabase.rpc('get_reports_sources', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching sources report:', error);
    throw new Error(error.message || 'Failed to load sources report.');
  }

  return data as SourcesReportData;
}

/**
 * Fetch Course Performance Report
 */
export async function fetchCoursesReport(
  startDate: string,
  endDate: string,
  courseId?: string,
  includeTest: boolean = false
): Promise<CoursesReportData> {
  const { data, error } = await supabase.rpc('get_reports_courses', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_course_id: courseId || null,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching courses report:', error);
    throw new Error(error.message || 'Failed to load courses report.');
  }

  return data as CoursesReportData;
}

/**
 * Fetch Engagement & Operations Report
 */
export async function fetchEngagementReport(
  startDate: string,
  endDate: string,
  includeTest: boolean = false
): Promise<EngagementReportData> {
  const { data, error } = await supabase.rpc('get_reports_engagement', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching engagement report:', error);
    throw new Error(error.message || 'Failed to load engagement report.');
  }

  return data as EngagementReportData;
}

/**
 * Fetch Post-Course & Alumni Report
 */
export async function fetchPostCourseReport(
  startDate: string,
  endDate: string,
  includeTest: boolean = false
): Promise<PostCourseReportData> {
  const { data, error } = await supabase.rpc('get_reports_post_course', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_include_test: includeTest,
  });

  if (error) {
    console.error('Error fetching post-course report:', error);
    throw new Error(error.message || 'Failed to load post-course report.');
  }

  return data as PostCourseReportData;
}

// =============================================================================
// CSV Export Generation
// =============================================================================

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvMetadataHeader(
  reportTitle: string,
  startDate: string,
  endDate: string,
  timezone: string,
  includeTest: boolean,
  currency: string = 'USD'
): string[] {
  return [
    `# Report: ${reportTitle}`,
    `# Period: ${startDate} to ${endDate}`,
    `# Timezone: ${timezone}`,
    `# Include Test Data: ${includeTest}`,
    `# Currency: ${currency}`,
    `# Generated At: ${new Date().toISOString()}`,
    '',
  ];
}

export function exportExecutiveCSV(data: ExecutiveOverviewData): string {
  const meta = buildCsvMetadataHeader(
    'Executive Analytics Overview',
    data.metadata.period_start,
    data.metadata.period_end,
    data.metadata.timezone,
    data.metadata.include_test,
    data.metadata.currency
  );

  const headers = ['Metric', 'Type', 'Current Value', 'Previous Value', 'Percent Change (%)', 'Comparison Status'];
  const rows = [
    ['Leads Created', 'Period', data.kpis.leads_created.current, data.kpis.leads_created.previous ?? '', data.kpis.leads_created.percent_change ?? '', data.kpis.leads_created.comparison_status ?? ''],
    ['Confirmed Enrollments', 'Period', data.kpis.confirmed_enrollments.current, data.kpis.confirmed_enrollments.previous ?? '', data.kpis.confirmed_enrollments.percent_change ?? '', data.kpis.confirmed_enrollments.comparison_status ?? ''],
    ['Gross Collected', 'Period', data.kpis.gross_collected.current, data.kpis.gross_collected.previous ?? '', data.kpis.gross_collected.percent_change ?? '', data.kpis.gross_collected.comparison_status ?? ''],
    ['Net Revenue', 'Period', data.kpis.net_revenue.current, data.kpis.net_revenue.previous ?? '', data.kpis.net_revenue.percent_change ?? '', data.kpis.net_revenue.comparison_status ?? ''],
    ['Booked Revenue', 'Period', data.kpis.booked_revenue.current, data.kpis.booked_revenue.previous ?? '', data.kpis.booked_revenue.percent_change ?? '', data.kpis.booked_revenue.comparison_status ?? ''],
    ['Refunded Amount', 'Period', data.kpis.refunded_amount.current, data.kpis.refunded_amount.previous ?? '', data.kpis.refunded_amount.percent_change ?? '', data.kpis.refunded_amount.comparison_status ?? ''],
    ['Cohort Conversion Rate', 'Cohort', data.kpis.cohort_conversion_rate.current ?? '', data.kpis.cohort_conversion_rate.previous ?? '', data.kpis.cohort_conversion_rate.percent_change ?? '', data.kpis.cohort_conversion_rate.comparison_status ?? ''],
    ['Reply Rate', 'Period', data.kpis.reply_rate.current ?? '', data.kpis.reply_rate.previous ?? '', data.kpis.reply_rate.percent_change ?? '', data.kpis.reply_rate.comparison_status ?? ''],
    ['Current Outstanding Balance', 'Snapshot', data.kpis.current_outstanding_balance.current, '', '', ''],
    ['Current Hot Leads', 'Snapshot', data.kpis.current_hot_leads.current, '', '', ''],
    ['Current Active Leads', 'Snapshot', data.kpis.current_active_leads.current, '', '', ''],
  ];

  return [...meta, headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
}

export function exportSourcesCSV(data: SourcesReportData): string {
  const meta = buildCsvMetadataHeader(
    'Lead Source Performance Report',
    data.metadata.period_start,
    data.metadata.period_end,
    data.metadata.timezone,
    data.metadata.include_test,
    data.metadata.currency
  );

  const headers = [
    'Source',
    'Leads Created (Cohort)',
    'Qualified Leads (Cohort)',
    'Cohort Enrolled',
    'Cohort Conversion Rate (%)',
    'Enrollments Confirmed in Period',
    'Booked Revenue (USD)',
    'Gross Collected (USD)',
    'Refunded Amount (USD)',
    'Net Revenue (USD)',
    'Current Outstanding Balance (USD)',
  ];

  const rows = data.sources.map((s) => [
    escapeCsvCell(s.source),
    escapeCsvCell(s.leads_created),
    escapeCsvCell(s.qualified_leads),
    escapeCsvCell(s.cohort_leads_enrolled),
    escapeCsvCell(s.cohort_conversion_rate !== null ? s.cohort_conversion_rate : ''),
    escapeCsvCell(s.enrollments_confirmed_in_period),
    escapeCsvCell(s.booked_revenue.toFixed(2)),
    escapeCsvCell(s.gross_collected.toFixed(2)),
    escapeCsvCell(s.refunded_amount.toFixed(2)),
    escapeCsvCell(s.net_revenue.toFixed(2)),
    escapeCsvCell(s.current_outstanding_balance.toFixed(2)),
  ]);

  return [...meta, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportCoursesCSV(data: CoursesReportData): string {
  const meta = buildCsvMetadataHeader(
    'Course Performance Report',
    data.metadata.period_start,
    data.metadata.period_end,
    data.metadata.timezone,
    data.metadata.include_test,
    data.metadata.currency
  );

  const headers = [
    'Course Code',
    'Course Name',
    'Currency',
    'Confirmed Enrollments',
    'Unique Students',
    'New Students',
    'Repeat Students',
    'Booked Revenue',
    'Gross Collected',
    'Refunded Amount',
    'Net Revenue',
    'Current Outstanding Balance',
    'Attendance Rate (%)',
    'Completion Rate (%)',
  ];

  const rows = data.courses.map((c) => [
    escapeCsvCell(c.course_code),
    escapeCsvCell(c.course_name),
    escapeCsvCell(c.currency),
    escapeCsvCell(c.confirmed_enrollments),
    escapeCsvCell(c.unique_students),
    escapeCsvCell(c.new_students),
    escapeCsvCell(c.repeat_students),
    escapeCsvCell(c.booked_revenue.toFixed(2)),
    escapeCsvCell(c.gross_collected.toFixed(2)),
    escapeCsvCell(c.refunded_amount.toFixed(2)),
    escapeCsvCell(c.net_revenue.toFixed(2)),
    escapeCsvCell(c.current_outstanding_balance.toFixed(2)),
    escapeCsvCell(c.attendance_rate !== null ? c.attendance_rate : ''),
    escapeCsvCell(c.completion_rate !== null ? c.completion_rate : ''),
  ]);

  return [...meta, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportRevenueCSV(data: RevenueReportData): string {
  const meta = buildCsvMetadataHeader(
    'Revenue & Financial Trends Report',
    data.metadata.period_start,
    data.metadata.period_end,
    data.metadata.timezone,
    data.metadata.include_test,
    data.metadata.currency
  );

  const headers = [
    'Period Start',
    'Gross Collected (USD)',
    'Refunded Amount (USD)',
    'Net Revenue (USD)',
    'Booked Revenue (USD)',
  ];

  const rows = data.time_series.map((t) => [
    escapeCsvCell(t.period_start),
    escapeCsvCell(t.gross_collected.toFixed(2)),
    escapeCsvCell(t.refunded_amount.toFixed(2)),
    escapeCsvCell(t.net_revenue.toFixed(2)),
    escapeCsvCell(t.booked_revenue.toFixed(2)),
  ]);

  return [...meta, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportFunnelCSV(data: FunnelReportData): string {
  const meta = buildCsvMetadataHeader(
    'Commercial Funnel Report',
    data.metadata.period_start,
    data.metadata.period_end,
    data.metadata.timezone,
    data.metadata.include_test,
    'USD'
  );

  const headers = [
    'Stage Order',
    'Stage Code',
    'Stage Name',
    'Reached Count',
    'Conversion from Previous (%)',
    'Conversion from Cohort (%)',
  ];

  const rows = data.cohort_funnel.stages.map((s) => [
    escapeCsvCell(s.sort_order),
    escapeCsvCell(s.stage_code),
    escapeCsvCell(s.stage_name),
    escapeCsvCell(s.reached_count),
    escapeCsvCell(s.conversion_from_prev !== null ? s.conversion_from_prev : ''),
    escapeCsvCell(s.conversion_from_cohort !== null ? s.conversion_from_cohort : ''),
  ]);

  return [...meta, headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadCSV(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// =============================================================================
// URL Parameter State Serialization
// =============================================================================

export function parseReportsUrlParams(searchParams: URLSearchParams): Partial<ReportsFilter> {
  const tab = (searchParams.get('tab') as ReportTab) || 'executive';
  const preset = (searchParams.get('preset') as DateRangePreset) || 'last_30_days';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const courseId = searchParams.get('courseId') || undefined;
  const includeTest = searchParams.get('includeTest') === 'true';

  return {
    tab,
    preset,
    startDate,
    endDate,
    courseId,
    includeTest,
  };
}

export function buildReportsUrlParams(filter: ReportsFilter): URLSearchParams {
  const params = new URLSearchParams();
  params.set('tab', filter.tab);
  params.set('preset', filter.preset);
  if (filter.startDate) params.set('startDate', filter.startDate);
  if (filter.endDate) params.set('endDate', filter.endDate);
  if (filter.courseId) params.set('courseId', filter.courseId);
  if (filter.includeTest) params.set('includeTest', 'true');
  return params;
}
