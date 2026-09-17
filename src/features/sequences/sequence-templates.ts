// =============================================================================
// EDS HUB — Sequence Templates Library (Phase 3 Block 3)
// =============================================================================
// Pre-configured sequence templates for rapid deployment.
// Using "Create from Template" deep-copies the definition into a new independent
// draft sequence so runtime execution is fully decoupled from the library.
// =============================================================================

import type {
  AutomationTriggerType,
  AutomationStepConfig,
  AutomationStepType,
  AutomationActionType,
  SequenceStopCondition,
} from '../../types/database';

export interface SequenceTemplateStep {
  step_order: number;
  step_type: AutomationStepType;
  action_type: AutomationActionType | null;
  config: AutomationStepConfig;
}

export interface SequenceTemplate {
  id: string;
  name: string;
  badge: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  stop_conditions: SequenceStopCondition[];
  steps: SequenceTemplateStep[];
}

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
  {
    id: 'new_lead_followup',
    name: 'New Lead Fast Follow-Up',
    badge: 'Popular',
    description: 'Multi-touch omni-channel sequence reaching out within minutes, then checking response before sending follow-up SMS and creating a phone call task.',
    trigger_type: 'lead_created',
    trigger_config: {},
    stop_conditions: [
      {
        type: 'qualification_status',
        operator: 'in',
        values: ['some_response', 'interested', 'hot', 'confirmed'],
      },
    ],
    steps: [
      {
        step_order: 1,
        step_type: 'action',
        action_type: 'send_email',
        config: {
          subject: 'Welcome to Expert Dental Solutions, {{first_name}}!',
          body: '<p>Hello {{salutation}},</p><p>Thank you for your interest in our programs. We would love to discuss your clinical goals and schedule an introductory session.</p><p>Best regards,<br/>Expert Dental Solutions Team</p>',
        },
      },
      {
        step_order: 2,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 1,
          duration_unit: 'days',
        },
      },
      {
        step_order: 3,
        step_type: 'condition',
        action_type: null,
        config: {
          field: 'qualification_status',
          operator: 'equals',
          value: 'no_response',
        },
      },
      {
        step_order: 4,
        step_type: 'action',
        action_type: 'send_sms',
        config: {
          message: 'Hi {{salutation}}, this is Expert Dental Solutions following up on your inquiry. Have you had a chance to review our course catalog?',
        },
      },
      {
        step_order: 5,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 2,
          duration_unit: 'days',
        },
      },
      {
        step_order: 6,
        step_type: 'action',
        action_type: 'create_call_task',
        config: {
          title: 'Direct Call Follow-up: {{first_name}} {{last_name}}',
          description: 'Lead has not responded after email and SMS. Conduct a high-touch introductory phone call.',
          task_type: 'call',
        },
      },
    ],
  },
  {
    id: 'no_response_reengagement',
    name: 'No Response Re-engagement Sequence',
    badge: 'Recovery',
    description: 'Triggered when a lead is marked No Response, applying a progressive 7-day multi-touch cadence before retiring to nurture.',
    trigger_type: 'qualification_status_changed',
    trigger_config: {
      to_status: 'no_response',
    },
    stop_conditions: [
      {
        type: 'qualification_status',
        operator: 'in',
        values: ['some_response', 'interested', 'hot', 'confirmed'],
      },
    ],
    steps: [
      {
        step_order: 1,
        step_type: 'action',
        action_type: 'send_email',
        config: {
          subject: 'Quick check-in regarding dental continuing education',
          body: '<p>Dear {{salutation}},</p><p>We noticed we haven\'t connected yet. Our upcoming cohort has limited seats remaining and we want to ensure you have all needed details.</p>',
        },
      },
      {
        step_order: 2,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 2,
          duration_unit: 'days',
        },
      },
      {
        step_order: 3,
        step_type: 'action',
        action_type: 'send_sms',
        config: {
          message: 'Hello {{salutation}}, EDS Admissions here. Would a 5-minute phone call tomorrow work better for your schedule?',
        },
      },
      {
        step_order: 4,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 3,
          duration_unit: 'days',
        },
      },
      {
        step_order: 5,
        step_type: 'action',
        action_type: 'create_task',
        config: {
          title: 'Final SDR Review: {{first_name}} {{last_name}}',
          description: 'Review contact record before moving to long-term newsletter nurture.',
          task_type: 'data_review',
        },
      },
    ],
  },
  {
    id: 'course_interest_intensive',
    name: 'Course Interest: Intensive & Mastership Follow-Up',
    badge: 'High Value',
    description: 'Specialized sequence for high-intent clinicians interested in Intensive / Surgical programs with immediate curriculum delivery.',
    trigger_type: 'form_submitted',
    trigger_config: {},
    stop_conditions: [
      {
        type: 'qualification_status',
        operator: 'in',
        values: ['interested', 'hot', 'confirmed'],
      },
    ],
    steps: [
      {
        step_order: 1,
        step_type: 'condition',
        action_type: null,
        config: {
          field: 'course_interest',
          operator: 'contains',
          value: 'Intensive',
        },
      },
      {
        step_order: 2,
        step_type: 'action',
        action_type: 'send_email',
        config: {
          subject: 'Your Intensive Dental Course Syllabus & Hands-On Dates',
          body: '<p>Dr. {{last_name}},</p><p>Thank you for requesting information on our Intensive program. Attached is the full curriculum and schedule for the upcoming live-patient residency.</p>',
        },
      },
      {
        step_order: 3,
        step_type: 'action',
        action_type: 'add_tag',
        config: {
          tag_name: 'High-Intent',
        },
      },
      {
        step_order: 4,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 1,
          duration_unit: 'days',
        },
      },
      {
        step_order: 5,
        step_type: 'action',
        action_type: 'create_call_task',
        config: {
          title: 'Faculty Consultation Call: Dr. {{last_name}}',
          description: 'Schedule program director discussion to review clinical prerequisites and seat reservation.',
          task_type: 'call',
        },
      },
    ],
  },
  {
    id: 'hot_lead_acceleration',
    name: 'Hot Lead Acceleration Sequence',
    badge: 'Urgent',
    description: 'Triggered when qualification status changes to Hot. Immediately alerts admissions and creates expedited call tasks.',
    trigger_type: 'qualification_status_changed',
    trigger_config: {
      to_status: 'hot',
    },
    stop_conditions: [
      {
        type: 'qualification_status',
        operator: 'in',
        values: ['confirmed'],
      },
    ],
    steps: [
      {
        step_order: 1,
        step_type: 'action',
        action_type: 'create_call_task',
        config: {
          title: 'URGENT: Call Hot Lead Dr. {{last_name}}',
          description: 'Lead marked as HOT. Contact immediately to confirm course dates and payment arrangements.',
          task_type: 'call',
        },
      },
      {
        step_order: 2,
        step_type: 'action',
        action_type: 'send_sms',
        config: {
          message: 'Dr. {{last_name}}, we are excited to have you join our next cohort! Our admissions director will reach out shortly.',
        },
      },
      {
        step_order: 3,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 1,
          duration_unit: 'days',
        },
      },
      {
        step_order: 4,
        step_type: 'action',
        action_type: 'send_email',
        config: {
          subject: 'Enrollment confirmation & documentation checklist',
          body: '<p>Dr. {{last_name}},</p><p>Please find the enrollment agreement and credential checklist required to finalize your registration.</p>',
        },
      },
    ],
  },
  {
    id: 'enrollment_confirmation',
    name: 'Confirmed Enrollment Onboarding Sequence',
    badge: 'Onboarding',
    description: 'Triggered when qualification status becomes Confirmed. Welcomes the clinician, sends preparation guidelines, and updates pipeline.',
    trigger_type: 'qualification_status_changed',
    trigger_config: {
      to_status: 'confirmed',
    },
    stop_conditions: [],
    steps: [
      {
        step_order: 1,
        step_type: 'action',
        action_type: 'send_email',
        config: {
          subject: 'Welcome to the Program! Complete Onboarding Guide',
          body: '<p>Welcome Dr. {{last_name}},</p><p>Your registration is confirmed. Please review the pre-course study materials and hotel accommodation options.</p>',
        },
      },
      {
        step_order: 2,
        step_type: 'action',
        action_type: 'add_tag',
        config: {
          tag_name: 'Enrolled',
        },
      },
      {
        step_order: 3,
        step_type: 'wait',
        action_type: 'wait',
        config: {
          duration_value: 3,
          duration_unit: 'days',
        },
      },
      {
        step_order: 4,
        step_type: 'action',
        action_type: 'create_task',
        config: {
          title: 'Verify Pre-Course Credentials: Dr. {{last_name}}',
          description: 'Confirm malpractice insurance copy and dental license verification are filed.',
          task_type: 'data_review',
        },
      },
    ],
  },
];
