// =============================================================================
// Executive Reporting & Analytics Types (Phase 5 Block 2)
// =============================================================================

export type ReportTab = 
  | 'executive' 
  | 'funnel' 
  | 'revenue' 
  | 'sources' 
  | 'courses' 
  | 'engagement' 
  | 'post_course';

export type DateRangePreset = 
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_year'
  | 'custom';

export type MetricType = 'period' | 'snapshot' | 'cohort';

export type ComparisonStatus = 
  | 'positive' 
  | 'negative' 
  | 'neutral' 
  | 'new' 
  | 'no_comparison' 
  | 'not_applicable';

export interface ReportMetadata {
  timezone: string;
  period_start: string;
  period_end: string;
  comparison_start?: string | null;
  comparison_end?: string | null;
  duration_days?: number;
  granularity?: string;
  course_filter_id?: string | null;
  include_test: boolean;
  currency: string;
  legacy_confirmation_fallback_count?: number;
  generated_at: string;
}

export interface MetricComparison<T = number> {
  current: T | null;
  previous?: T | null;
  percent_change?: number | null;
  comparison_status?: ComparisonStatus;
  type: MetricType;
  [key: string]: unknown;
}

export interface ExecutiveKpis {
  leads_created: MetricComparison<number>;
  confirmed_enrollments: MetricComparison<number>;
  gross_collected: MetricComparison<number>;
  net_revenue: MetricComparison<number>;
  booked_revenue: MetricComparison<number>;
  refunded_amount: MetricComparison<number>;
  current_outstanding_balance: MetricComparison<number>;
  current_hot_leads: MetricComparison<number>;
  current_active_leads: MetricComparison<number>;
  cohort_conversion_rate: MetricComparison<number>;
  repeat_student_rate: MetricComparison<number>;
  reply_rate: MetricComparison<number>;
}

export interface TopCourseItem {
  course_id: string;
  course_code: string;
  course_name: string;
  confirmed_enrollments: number;
  unique_students: number;
  booked_revenue: number;
  net_revenue: number;
}

export interface TopSourceItem {
  source: string;
  leads_created: number;
  confirmed_enrollments: number;
  net_revenue: number;
  cohort_conversion_rate: number | null;
}

export interface RevenueTrendItem {
  date: string;
  leads_created: number;
  gross_collected: number;
  net_revenue: number;
}

export interface ExecutiveOverviewData {
  metadata: ReportMetadata;
  kpis: ExecutiveKpis;
  top_courses: TopCourseItem[];
  top_sources: TopSourceItem[];
  revenue_trend: RevenueTrendItem[];
}

export interface FunnelStageItem {
  stage_code: string;
  stage_name: string;
  sort_order: number;
  reached_count: number;
  conversion_from_prev: number | null;
  conversion_from_cohort: number | null;
}

export interface FunnelReportData {
  metadata: ReportMetadata;
  cohort_funnel: {
    cohort_total_leads: number;
    stages: FunnelStageItem[];
  };
  current_pipeline_snapshot: Array<{
    stage_id: string;
    stage_code: string;
    stage_name: string;
    sort_order: number;
    lead_count: number;
    type: 'snapshot';
  }>;
  qualification_snapshot: Array<{
    status: string;
    lead_count: number;
  }>;
  scoring_snapshot: {
    average_score: number;
    hot_and_very_hot_count: number;
    distribution: Array<{
      category: string;
      label: string;
      lead_count: number;
      percentage: number;
    }>;
  };
}

export interface RevenueTimeSeriesItem {
  period_start: string;
  gross_collected: number;
  refunded_amount: number;
  net_revenue: number;
  booked_revenue: number;
}

export interface PaymentMethodItem {
  method: string;
  payment_count: number;
  total_amount: number;
}

export interface RevenueReportData {
  metadata: ReportMetadata;
  summary: {
    gross_collected: MetricComparison<number>;
    refunded_amount: MetricComparison<number>;
    net_revenue: MetricComparison<number>;
    booked_revenue: MetricComparison<number>;
    current_outstanding_balance: MetricComparison<number>;
    average_ticket: MetricComparison<number>;
    refund_rate: MetricComparison<number> & { refund_count: number };
  };
  time_series: RevenueTimeSeriesItem[];
  payment_methods: PaymentMethodItem[];
}

export interface SourcePerformanceItem {
  source: string;
  leads_created: number;
  qualified_leads: number;
  cohort_leads_enrolled: number;
  cohort_conversion_rate: number | null;
  enrollments_confirmed_in_period: number;
  booked_revenue: number;
  gross_collected: number;
  refunded_amount: number;
  net_revenue: number;
  current_outstanding_balance: number;
}

export interface SourcesReportData {
  metadata: ReportMetadata;
  sources: SourcePerformanceItem[];
}

export interface CoursePerformanceItem {
  course_id: string;
  course_code: string;
  course_name: string;
  default_price: number | null;
  currency: string;
  confirmed_enrollments: number;
  unique_students: number;
  new_students: number;
  repeat_students: number;
  booked_revenue: number;
  gross_collected: number;
  refunded_amount: number;
  net_revenue: number;
  current_outstanding_balance: number;
  attendance_rate: number | null;
  completion_rate: number | null;
}

export interface SessionPerformanceItem {
  session_id: string;
  session_code: string;
  session_title: string;
  course_id: string;
  course_name: string;
  status: string;
  start_date: string;
  end_date: string;
  capacity: number | null;
  assigned_enrollments: number;
  attendance_rate: number | null;
  completion_rate: number | null;
  net_revenue: number;
}

export interface CoursesReportData {
  metadata: ReportMetadata;
  courses: CoursePerformanceItem[];
  sessions: SessionPerformanceItem[];
}

export interface EngagementReportData {
  metadata: ReportMetadata;
  conversations: {
    outbound_sent_count: number;
    outbound_unique_leads: number;
    inbound_replies_count: number;
    replied_unique_leads: number;
    reply_rate: number | null;
    avg_first_response_time_seconds: number | null;
    median_first_response_time_seconds: number | null;
    open_conversations_needing_reply: number;
  };
  automations: {
    runs_total: number;
    runs_completed: number;
    runs_failed: number;
    actions_total: number;
    actions_completed: number;
    actions_failed: number;
    actions_skipped: number;
    actions_blocked_by_preference: number;
    retries_total: number;
    active_sequences_count: number;
  };
  forms: Array<{
    form_id: string;
    form_title: string;
    form_slug: string;
    submissions_count: number;
    unique_leads_created: number;
    cohort_leads_enrolled: number;
    cohort_conversion_rate: number | null;
  }>;
  tasks: {
    tasks_completed_in_period: number;
    current_overdue_tasks: number;
    current_tasks_due_today: number;
  };
}

export interface PostCourseReportData {
  metadata: ReportMetadata;
  metrics: {
    completed_students_in_period: MetricComparison<number>;
    followup_completion_rate: MetricComparison<number> & {
      followups_completed: number;
      followups_due: number;
    };
    feedback_response_rate: MetricComparison<number> & {
      feedback_received: number;
      feedback_requested: number;
    };
    testimonial_response_rate: MetricComparison<number> & {
      testimonials_received: number;
      testimonials_requested: number;
    };
    repeat_student_rate: MetricComparison<number> & {
      repeat_students: number;
      total_confirmed_students: number;
    };
    alumni_current_count: MetricComparison<number>;
    testimonial_opportunities_count: MetricComparison<number>;
    next_course_opportunities_count: MetricComparison<number>;
  };
}

export interface ReportsFilter {
  tab: ReportTab;
  preset: DateRangePreset;
  startDate: string;
  endDate: string;
  courseId?: string;
  source?: string;
  includeTest: boolean;
}
