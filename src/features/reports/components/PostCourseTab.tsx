
import { MetricCard } from './MetricCard';
import type { PostCourseReportData } from '../types/reporting';

interface PostCourseTabProps {
  data: PostCourseReportData;
}

export function PostCourseTab({ data }: PostCourseTabProps) {
  const { metrics } = data;

  return (
    <div className="space-y-6">
      {/* Information Header */}
      <div className="bg-purple-50/60 border border-purple-100 rounded-xl p-4 text-xs text-purple-900">
        <strong className="font-semibold">Alumni & Lifecycle Intelligence:</strong> Tracks the educational journey beyond course completion — follow-up execution, student feedback, testimonial capture, and repeat enrollments.
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Completed Students"
          metric={metrics.completed_students_in_period}
          subtitle="Students finished in period"
          tooltip="Unique students whose course participation reached completed status in this period."
        />
        <MetricCard
          title="Follow-Up Completion"
          metric={metrics.followup_completion_rate}
          isPercent
          subtitle={`${metrics.followup_completion_rate.followups_completed ?? 0} of ${metrics.followup_completion_rate.followups_due ?? 0} completed`}
          tooltip="Percentage of post-course follow-up engagements successfully completed."
        />
        <MetricCard
          title="Feedback Rate"
          metric={metrics.feedback_response_rate}
          isPercent
          subtitle={`${metrics.feedback_response_rate.feedback_received ?? 0} of ${metrics.feedback_response_rate.feedback_requested ?? 0} received`}
          tooltip="Percentage of survey requests answered: feedback received / feedback requested."
        />
        <MetricCard
          title="Testimonial Rate"
          metric={metrics.testimonial_response_rate}
          isPercent
          subtitle={`${metrics.testimonial_response_rate.testimonials_received ?? 0} of ${metrics.testimonial_response_rate.testimonials_requested ?? 0} received`}
          tooltip="Percentage of testimonial requests collected: testimonial received / testimonial requested."
        />
        <MetricCard
          title="Repeat Student Rate"
          metric={metrics.repeat_student_rate}
          isPercent
          subtitle={`${metrics.repeat_student_rate.repeat_students ?? 0} of ${metrics.repeat_student_rate.total_confirmed_students ?? 0} students`}
          tooltip="Cumulative snapshot percentage of confirmed students who have enrolled in 2 or more courses."
        />
        <MetricCard
          title="Alumni Count"
          metric={metrics.alumni_current_count}
          subtitle="Leads in Alumni stage"
          tooltip="Current snapshot of leads residing in the canonical Alumni pipeline stage."
        />
        <MetricCard
          title="Testimonial Opps"
          metric={metrics.testimonial_opportunities_count}
          subtitle="Feedback received, pending ask"
          tooltip="Completed students who submitted feedback but have not yet been invited to provide a testimonial."
        />
        <MetricCard
          title="Next Course Opps"
          metric={metrics.next_course_opportunities_count}
          subtitle="Active course interests"
          tooltip="Alumni or students expressing interest in upcoming courses without a confirmed enrollment."
        />
      </div>
    </div>
  );
}
