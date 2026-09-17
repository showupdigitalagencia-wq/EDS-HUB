// =============================================================================
// Revenue & Enrollment Intelligence Export Utilities
// =============================================================================
// RFC 4180 compliant CSV exports for Enrollments, Approved Not Enrolled,
// Course Performance, and Source Performance.
// =============================================================================

import type {
  CourseRevenuePerformance,
  SourceRevenuePerformance,
  ApprovedNotEnrolledLead,
  Enrollment,
} from '../../../types/database';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports Course Revenue Performance to CSV
 */
export function exportCourseRevenueCsv(
  courses: CourseRevenuePerformance[],
  periodLabel: string = 'Period'
): void {
  const headers = [
    'Course Name',
    'Course Code',
    'Default Price',
    'Currency',
    'Interested Leads',
    'Confirmed Enrollments',
    'Booked Value',
    'Collected Revenue',
    'Net Revenue',
    'Outstanding Balance',
    'Average Ticket',
  ];

  const rows = courses.map((c) => [
    escapeCsvField(c.course_name),
    escapeCsvField(c.course_code),
    escapeCsvField(c.default_price !== null ? c.default_price.toFixed(2) : 'N/A'),
    escapeCsvField(c.currency),
    escapeCsvField(c.interested_leads_count),
    escapeCsvField(c.confirmed_enrollments_count),
    escapeCsvField(c.booked_value.toFixed(2)),
    escapeCsvField(c.collected_revenue.toFixed(2)),
    escapeCsvField(c.net_revenue.toFixed(2)),
    escapeCsvField(c.outstanding_balance.toFixed(2)),
    escapeCsvField(c.average_ticket !== null ? c.average_ticket.toFixed(2) : 'No data'),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCsv(csv, `revenue_by_course_${periodLabel.toLowerCase().replace(/\s+/g, '_')}_${dateStr}.csv`);
}

/**
 * Exports Source Revenue Performance to CSV
 */
export function exportSourceRevenueCsv(
  sources: SourceRevenuePerformance[],
  periodLabel: string = 'Period'
): void {
  const headers = [
    'Canonical Source',
    'Total Leads',
    'Confirmed Enrollments',
    'Conversion Rate (%)',
    'Booked Value',
    'Net Revenue',
    'Average Ticket',
  ];

  const rows = sources.map((s) => [
    escapeCsvField(s.source),
    escapeCsvField(s.total_leads),
    escapeCsvField(s.confirmed_enrollments),
    escapeCsvField(s.conversion_rate !== null ? s.conversion_rate.toFixed(1) : 'No data'),
    escapeCsvField(s.booked_value.toFixed(2)),
    escapeCsvField(s.net_revenue.toFixed(2)),
    escapeCsvField(s.average_ticket !== null ? s.average_ticket.toFixed(2) : 'No data'),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCsv(csv, `revenue_by_source_${periodLabel.toLowerCase().replace(/\s+/g, '_')}_${dateStr}.csv`);
}

/**
 * Exports Approved Not Enrolled leads to CSV
 */
export function exportApprovedNotEnrolledCsv(leads: ApprovedNotEnrolledLead[]): void {
  const headers = [
    'Name',
    'Email',
    'Phone',
    'Course Interest',
    'Lead Score',
    'Qualification Status',
    'Days in Approval',
    'Next Action',
  ];

  const rows = leads.map((l) => [
    escapeCsvField([l.first_name, l.last_name].filter(Boolean).join(' ') || 'Unnamed Lead'),
    escapeCsvField(l.email || ''),
    escapeCsvField(l.phone_raw || ''),
    escapeCsvField(l.course_interest || 'None specified'),
    escapeCsvField(l.lead_score ?? 'No score'),
    escapeCsvField(l.qualification_status || 'unqualified'),
    escapeCsvField(l.days_in_approval),
    escapeCsvField(l.next_action || 'No pending action'),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCsv(csv, `approved_not_enrolled_${dateStr}.csv`);
}

/**
 * Exports Enrollments list to CSV
 */
export function exportEnrollmentsCsv(enrollments: Enrollment[]): void {
  const headers = [
    'Enrollment ID',
    'Course Name',
    'Status',
    'Agreed Amount',
    'Currency',
    'Paid Amount',
    'Remaining Balance',
    'Enrollment Date',
    'Source',
    'Notes',
  ];

  const rows = enrollments.map((e) => [
    escapeCsvField(e.id),
    escapeCsvField(e.course_name_snapshot),
    escapeCsvField(e.enrollment_status),
    escapeCsvField(Number(e.agreed_amount).toFixed(2)),
    escapeCsvField(e.currency),
    escapeCsvField(e.paid_amount !== undefined ? e.paid_amount.toFixed(2) : '0.00'),
    escapeCsvField(e.remaining_balance !== undefined ? e.remaining_balance.toFixed(2) : '0.00'),
    escapeCsvField(e.enrollment_date),
    escapeCsvField(e.source),
    escapeCsvField(e.notes || ''),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadCsv(csv, `enrollments_export_${dateStr}.csv`);
}
