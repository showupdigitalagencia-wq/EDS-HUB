// =============================================================================
// EDS HUB — Database Types (Phase 1 + Phase 2)
// =============================================================================

export type LeadSource = 'meta' | 'google' | 'manual' | 'test' | 'form';
export type ContactPreference = 'email' | 'sms' | 'call';
export type MessageChannel = 'email' | 'sms' | 'call';
export type MessageProvider = 'resend' | 'twilio';
export type MessageStatus = 'pending' | 'sent' | 'failed';
export type IntakeStatus = 'received' | 'processing' | 'processed' | 'failed' | 'duplicate';
export type TaskType = 'call' | 'data_review' | 'general' | 'follow_up' | 'payment';
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';
export type TaskSource = 'manual' | 'automation' | 'system' | 'course_operations' | 'post_course' | 'campaign';
export type TaskStatus = 'pending' | 'completed' | 'cancelled';
export type TaskCreatedBy = 'system' | 'user';
export type ActivityType =
  | 'lead_created'
  | 'intake_received'
  | 'email_dispatched'
  | 'sms_dispatched'
  | 'call_task_created'
  | 'stage_changed'
  | 'processing_failed'
  | 'note_created'
  | 'tag_added'
  | 'tag_removed'
  | 'campaign_sent'
  | 'contact_preference_detected'
  | 'email_selected'
  | 'sms_selected'
  | 'call_selected'
  | 'channel_skipped'
  | 'csv_status_unmapped'
  | 'qualification_status_changed'
  | 'form_submitted'
  | 'automation_started'
  | 'automation_completed'
  | 'automation_failed'
  | 'sequence_started'
  | 'sequence_completed'
  | 'sequence_failed'
  | 'sequence_stopped'
  | 'email_reply_received'
  | 'sms_reply_received'
  | 'enrollment_created'
  | 'enrollment_confirmed'
  | 'course_session_assigned'
  | 'course_session_changed'
  | 'attendance_recorded'
  | 'course_completed'
  | 'student_no_show'
  | 'checklist_item_updated'
  | 'post_course_followup_created'
  | 'post_course_followup_completed'
  | 'feedback_requested'
  | 'feedback_received'
  | 'testimonial_requested'
  | 'testimonial_received'
  | 'future_course_interest_added'
  | 'task_created'
  | 'task_rescheduled'
  | 'task_completed';
export type ActorType = 'system' | 'user';
export type StageChangeReason =
  | 'initial_assignment'
  | 'auto_after_intake'
  | 'manual'
  | 'csv_import_stage_mapping'
  | 'enrollment_confirmed'
  | 'course_completed'
  | 'post_course_transition'
  | 'alumni_transition';
export type DomainVerificationStatus = 'unknown' | 'pending' | 'passed' | 'verified' | 'failed';

export type QualificationStatus =
  | 'no_response'
  | 'some_response'
  | 'interested'
  | 'hot'
  | 'confirmed';

// Phase 2 Enums
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';
export type ImportRowStatus = 'created' | 'updated' | 'skipped' | 'failed' | 'conflict';
export type CampaignStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
export type RecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

// --- Phase 1 Table Row Types ---

export interface AppUser {
  user_id: string;
  singleton_key?: number | null;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  id: string;
  singleton_key: number;
  company_name: string;
  default_salutation: string;
  timezone: string | null;
  email_from_name: string | null;
  email_sending_domain: string | null;
  resend_domain_id: string | null;
  monthly_net_revenue_target?: number;
  monthly_enrollment_target?: number;
  default_currency?: string;
  course_readiness_window_days?: number;
  post_course_followup_due_days?: number;
  post_course_feedback_due_days?: number;
  testimonial_request_due_days?: number;
  lead_stale_after_days?: number;
  hot_lead_action_window_hours?: number;
  new_lead_action_grace_hours?: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  source: LeadSource;
  external_lead_id: string | null;
  hubspot_contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_confirmation: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  contact_preference: ContactPreference;
  qualification_status: QualificationStatus | null;
  course_interest: string | null;
  course_interests: string[];
  pipeline_stage_id: string;
  referred_by?: string | null;
  source_created_at: string | null;
  last_response_at?: string | null;
  lead_score?: number;
  lead_score_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadIntakeEvent {
  id: string;
  source: LeadSource;
  external_event_id: string | null;
  external_lead_id: string | null;
  idempotency_key: string;
  raw_payload: Record<string, unknown>;
  normalized_payload: Record<string, unknown>;
  status: IntakeStatus;
  lead_id: string | null;
  attempt_count: number;
  last_error: string | null;
  received_at: string;
  processed_at: string | null;
}

export interface TransactionalTemplate {
  key: string;
  channel: MessageChannel;
  subject_template: string | null;
  body_template: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OutboundMessage {
  id: string;
  lead_id: string;
  intake_event_id: string;
  channel: MessageChannel;
  provider: MessageProvider;
  recipient: string;
  template_key: string;
  subject_snapshot: string | null;
  body_snapshot: string;
  status: MessageStatus;
  provider_message_id: string | null;
  idempotency_key: string;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  automation_run_id?: string | null;
  automation_run_step_id?: string | null;
  conversation_id?: string | null;
  is_manual_reply?: boolean;
  actor_id?: string | null;
  in_reply_to_provider_message_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  lead_id: string;
  intake_event_id: string | null;
  automation_run_id?: string | null;
  automation_run_step_id?: string | null;
  task_type: TaskType;
  title: string;
  description: string | null;
  status: TaskStatus;
  due_at: string | null;
  priority: TaskPriority;
  task_source: TaskSource;
  created_by: TaskCreatedBy;
  enrollment_id?: string | null;
  course_session_id?: string | null;
  post_course_engagement_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  intake_event_id: string | null;
  activity_type: ActivityType;
  channel: MessageChannel | null;
  actor_type: ActorType;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LeadStageHistory {
  id: string;
  lead_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  change_reason: StageChangeReason;
  changed_by_user_id: string | null;
  intake_event_id: string | null;
  changed_at: string;
}

export interface EmailDomainStatus {
  id: string;
  domain: string;
  resend_domain_id: string | null;
  provider_status: DomainVerificationStatus;
  spf_status: DomainVerificationStatus;
  dkim_status: DomainVerificationStatus;
  dmarc_status: DomainVerificationStatus;
  last_checked_at: string | null;
  verified_at: string | null;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// --- Phase 2 Table Row Types ---

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadTag {
  lead_id: string;
  tag_id: string;
  created_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  content: string;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadImport {
  id: string;
  filename: string;
  status: ImportStatus;
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  conflict_count?: number;
  error_summary: string | null;
  mapping_config: Record<string, string>;
  created_by_user_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface LeadImportRow {
  id: string;
  import_id: string;
  row_number: number;
  raw_data: Record<string, unknown>;
  status: ImportRowStatus;
  lead_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  content_json: unknown;
  html_template: string;
  text_template: string;
  is_active: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  channel: 'email' | 'sms' | 'call';
  status: CampaignStatus;
  subject: string;
  preview_text: string | null;
  from_name: string;
  reply_to: string | null;
  template_id: string | null;
  scheduled_at: string | null;
  approved_at: string | null;
  approved_by_user_id: string | null;
  created_by_user_id: string | null;
  activated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignVersion {
  id: string;
  campaign_id: string;
  version_number: number;
  subject: string;
  preview_text: string | null;
  content_json: unknown;
  html_snapshot: string;
  text_snapshot: string;
  created_by_user_id: string | null;
  created_at: string;
}

export interface CampaignAudience {
  id: string;
  campaign_id: string;
  saved_segment_id?: string | null;
  filter_definition: AudienceFilterDefinition | Record<string, unknown>;
  estimated_recipient_count: number;
  snapshot_frozen_at?: string | null;
  snapshot_metadata?: Record<string, unknown>;
  total_matched_count?: number;
  eligible_count?: number;
  excluded_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignVariant {
  id: string;
  campaign_id: string;
  variant_key: 'A' | 'B';
  subject: string;
  content_json: unknown;
  html_snapshot: string;
  traffic_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  lead_id: string;
  email: string | null;
  phone_e164?: string | null;
  channel: 'email' | 'sms' | 'call';
  is_eligible: boolean;
  exclusion_reason?: string | null;
  status: RecipientStatus;
  variant: 'A' | 'B' | null;
  provider_message_id: string | null;
  sent_at: string | null;
  error_code: string | null;
  error_message: string | null;
  snapshot_stage_id?: string | null;
  snapshot_lead_score?: number | null;
  prepared_at: string;
  activated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedSegment {
  id: string;
  name: string;
  description?: string | null;
  filter_definition: AudienceFilterDefinition;
  is_active: boolean;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignChannel = 'email' | 'sms' | 'call';

export type AudienceExclusionReason =
  | 'TEST_SOURCE'
  | 'NO_VALID_CONTACT_PREFERENCE'
  | 'CHANNEL_PREFERENCE_MISMATCH'
  | 'MISSING_EMAIL'
  | 'MISSING_PHONE'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'SUPPRESSED'
  | 'DUPLICATE';

export interface AudienceFilterRule {
  field: string;
  operator: string;
  value: any;
}

export interface AudienceFilterDefinition {
  version: number;
  operator: 'and';
  stages?: string[];
  sources?: string[];
  qualification_statuses?: string[];
  min_score?: number | null;
  max_score?: number | null;
  days_since_last_activity?: number | null;
  enrolled_course_id?: string | null;
  not_enrolled_course_id?: string | null;
  completed_course_id?: string | null;
  repeat_student?: boolean | null;
  has_outstanding_balance?: boolean | null;
  course_interest_id?: string | null;
  contact_preferences?: string[];
  rules?: AudienceFilterRule[];
}

export interface AudienceExclusionBreakdown {
  TEST_SOURCE: number;
  NO_VALID_CONTACT_PREFERENCE: number;
  CHANNEL_PREFERENCE_MISMATCH: number;
  MISSING_EMAIL: number;
  MISSING_PHONE: number;
  [key: string]: number;
}

export interface AudienceMemberPreview {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  contact_preference: string | null;
  pipeline_stage_id: string;
  stage_name: string | null;
  stage_code: string | null;
  lead_score: number;
  is_eligible: boolean;
  exclusion_reason: string | null;
  created_at: string;
}

export interface AudiencePreviewResult {
  total_matched: number;
  eligible_count: number;
  excluded_count: number;
  exclusion_breakdown: AudienceExclusionBreakdown;
  leads: AudienceMemberPreview[];
}

export interface CampaignTestSend {
  id: string;
  campaign_id: string;
  campaign_version_id: string | null;
  recipient_email: string;
  provider_message_id: string | null;
  status: string;
  error_message: string | null;
  sent_at: string;
  created_at: string;
}

export interface CampaignJob {
  id: string;
  campaign_id: string;
  job_type: 'send_campaign';
  status: JobStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Phase 3: Forms Types
// =============================================================================

export type FormStatus = 'active' | 'inactive';

export type FormFieldType =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'contact_preference'
  | 'course_interest'
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'hidden';

export type SubmissionProcessingStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'conflict'
  | 'failed';

export interface Form {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: FormStatus;
  success_message: string;
  redirect_url: string | null;
  source_detail: string | null;
  default_pipeline_stage_id: string;
  default_tags: string[];
  duplicate_update_enabled: boolean;
  current_version: number;
  submit_button_text: string;
  purpose?: 'general' | 'lead_capture' | 'course_feedback';
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  // Computed fields from queries
  submission_count?: number;
  lead_count?: number;
}

export interface FormField {
  id: string;
  form_id: string;
  version: number;
  field_type: FormFieldType;
  internal_name: string;
  label: string;
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: string[];
  sort_order: number;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  form_version: number;
  lead_id: string | null;
  intake_event_id: string | null;
  submitted_data: Record<string, unknown>;
  email: string | null;
  phone_e164: string | null;
  contact_preference: string | null;
  course_interest: string | null;
  source_detail: string | null;
  processing_status: SubmissionProcessingStatus;
  post_course_engagement_id?: string | null;
  processing_error: string | null;
  idempotency_key: string;
  ip_address: string | null;
  user_agent: string | null;
  submitted_at: string;
  processed_at: string | null;
  // Joined fields
  form_name?: string;
  lead?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

export interface PublicFormField {
  internal_name: string;
  label: string;
  field_type: FormFieldType;
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: string[];
  sort_order: number;
}

export interface PublicFormDefinition {
  name: string;
  slug: string;
  description: string | null;
  version: number;
  submit_button_text: string;
  success_message: string;
  redirect_url: string | null;
  fields: PublicFormField[];
}

// =============================================================================
// Phase 3 Block 2: Automation Engine Types
// =============================================================================

export type AutomationTriggerType =
  | 'form_submitted'
  | 'lead_created'
  | 'qualification_status_changed'
  | 'pipeline_stage_changed'
  | 'tag_added'
  | 'manual_enrollment'
  | 'lead_replied'
  | 'enrollment_created'
  | 'enrollment_status_changed'
  | 'payment_received'
  | 'payment_status_changed'
  | 'course_session_assigned'
  | 'course_session_changed'
  | 'attendance_recorded'
  | 'course_completed'
  | 'student_no_show'
  | 'post_course_engagement_created'
  | 'post_course_followup_due'
  | 'post_course_followup_completed'
  | 'feedback_received'
  | 'testimonial_received'
  | 'future_course_interest_added';

export type AutomationType = 'workflow' | 'sequence';
export type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived';
export type AutomationVersionStatus = 'draft' | 'published' | 'archived';
export type AutomationStepType = 'condition' | 'action' | 'wait';
export type RunControlStatus = 'active' | 'paused' | 'stopped';

export type AutomationActionType =
  | 'send_email'
  | 'send_sms'
  | 'create_call_task'
  | 'create_task'
  | 'add_tag'
  | 'remove_tag'
  | 'move_pipeline_stage'
  | 'update_qualification_status'
  | 'wait'
  | 'stop_automation';

export type AutomationRunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped_by_condition';

export type AutomationStepRunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export type AutomationJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ConditionField =
  | 'contact_preference'
  | 'course_interest'
  | 'qualification_status'
  | 'pipeline_stage'
  | 'source'
  | 'source_detail'
  | 'tag'
  | 'email exists'
  | 'phone exists'
  | 'form_id'
  | 'lead_score';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'exists'
  | 'not_exists'
  | 'in'
  | 'greater_than'
  | 'greater_or_equal'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'less_than_or_equal';

export interface ConditionRule {
  field: ConditionField;
  operator: ConditionOperator;
  value?: string;
}

export interface AutomationStepConfig {
  // Condition config
  field?: ConditionField;
  operator?: ConditionOperator;
  value?: string;
  // Send email config
  template_type?: 'custom' | 'transactional' | 'marketing';
  template_id?: string | null;
  subject?: string;
  body?: string;
  // Send SMS config
  message?: string;
  // Task config
  title?: string;
  description?: string;
  task_type?: TaskType;
  // Tag config
  tag_id?: string;
  tag_name?: string;
  // Stage config
  pipeline_stage_id?: string;
  // Qualification config
  qualification_status?: QualificationStatus;
  // Wait config
  duration_value?: number;
  duration_unit?: 'minutes' | 'hours' | 'days';
  // Stop config
  stop_reason?: string;
  stop_on_qualification_status?: QualificationStatus[];
}

export interface SequenceStopCondition {
  type: 'qualification_status' | 'pipeline_stage' | 'tag';
  operator: 'in' | 'equals' | 'not_in';
  values: string[];
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  automation_type: AutomationType;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  status: AutomationStatus;
  stop_conditions: SequenceStopCondition[];
  enrollment_rules: Record<string, unknown>;
  stop_on_response?: boolean;
  current_version: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  // Aggregated metrics
  metrics?: {
    enrolled: number;
    active: number;
    completed: number;
    failed: number;
  };
}

export interface AutomationVersion {
  id: string;
  automation_id: string;
  version: number;
  status: AutomationVersionStatus;
  definition: Record<string, unknown>;
  stop_conditions?: SequenceStopCondition[];
  stop_on_response?: boolean;
  published_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  automation_version_id: string;
  step_order: number;
  step_type: AutomationStepType;
  action_type: AutomationActionType | null;
  config: AutomationStepConfig;
  created_at: string;
  updated_at: string;
}

export interface AutomationEvent {
  id: string;
  event_type: AutomationTriggerType;
  lead_id: string;
  source_table: string;
  source_record_id: string;
  source_event_key: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'processed' | 'ignored' | 'failed';
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  automation_version_id: string;
  lead_id: string;
  trigger_event_id: string | null;
  idempotency_key: string;
  parent_run_id: string | null;
  caused_by_automation_run_id: string | null;
  automation_depth: number;
  status: AutomationRunStatus;
  run_control_status: RunControlStatus;
  current_step_order: number;
  stop_reason: string | null;
  stop_reason_code: string | null;
  stop_reason_message: string | null;
  last_error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  automation?: {
    name: string;
    trigger_type: AutomationTriggerType;
    automation_type?: AutomationType;
  };
  lead?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_raw: string | null;
    contact_preference: ContactPreference;
  };
}

export interface AutomationRunStep {
  id: string;
  automation_run_id: string;
  automation_step_id: string | null;
  step_order: number;
  step_type: AutomationStepType;
  action_type: AutomationActionType | null;
  status: AutomationStepRunStatus;
  skip_reason_code: string | null;
  skip_reason_message: string | null;
  condition_input: Record<string, unknown> | null;
  condition_result: boolean | null;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  provider: string | null;
  retry_count: number;
  scheduled_resume_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined step info
  automation_step?: AutomationStep;
}

export interface AutomationJob {
  id: string;
  automation_run_id: string;
  automation_run_step_id: string;
  lead_id: string;
  run_at: string;
  status: AutomationJobStatus;
  claimed_at: string | null;
  claimed_by: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceMetrics {
  active_runs: number;
  waiting_runs: number;
  paused_runs: number;
  completed_runs: number;
  failed_runs: number;
  stopped_by_condition_runs: number;
  emails_sent: number;
  sms_sent: number;
  tasks_created: number;
  actions_skipped: number;
}

export interface NextActionInfo {
  actionType: string;
  actionLabel: string;
  scheduledAt: string | null;
  isImmediate: boolean;
  isPaused: boolean;
}

// =============================================================================
// Phase 3 Block 4: Inbound Responses & Conversational CRM Types
// =============================================================================

export type ConversationChannel = 'email' | 'sms';
export type ConversationStatus = 'open' | 'closed';
export type InboundProcessingStatus = 'received' | 'processed' | 'conflict' | 'failed';

export interface Conversation {
  id: string;
  lead_id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  external_thread_id: string | null;
  subject: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: 'inbound' | 'outbound' | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joins & derived
  unread_count?: number;
  lead?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_e164: string | null;
    contact_preference: ContactPreference;
    qualification_status: QualificationStatus | null;
    course_interest: string | null;
    pipeline_stage_id: string;
    last_response_at?: string | null;
    pipeline_stages?: { id: string; name: string; code: string } | null;
  } | null;
}

export interface InboundMessage {
  id: string;
  lead_id: string | null;
  conversation_id: string | null;
  channel: ConversationChannel;
  provider: 'resend' | 'twilio';
  provider_message_id: string;
  provider_thread_id: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  attachments: Array<{
    filename: string;
    mime_type: string;
    size?: number;
    provider_attachment_id?: string;
  }>;
  raw_metadata: Record<string, unknown>;
  processing_status: InboundProcessingStatus;
  conflict_reason: string | null;
  processing_error: string | null;
  read_at: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationThreadMessage {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  channel: ConversationChannel;
  provider: string;
  sender: string;
  recipient: string;
  subject?: string | null;
  body: string;
  body_html?: string | null;
  attachments?: Array<{ filename: string; mime_type: string; size?: number }>;
  status?: string;
  timestamp: string;
  read_at?: string | null;
  is_manual_reply?: boolean;
}

export interface ConversationMetrics {
  total_replies: number;
  email_replies: number;
  sms_replies: number;
  open_conversations: number;
  unread_conversations: number;
}

// --- Phase 4 Block 1: Lead Scoring Foundation Types ---

export type LeadScoreCategory = 'fit' | 'intent' | 'engagement';

export type LeadScoreOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal';

export type LeadScoreLabel = 'cold' | 'warm' | 'hot' | 'very_hot';

export interface LeadScoreRule {
  id: string;
  name: string;
  category: LeadScoreCategory;
  field_or_event: string;
  operator: LeadScoreOperator;
  value: unknown;
  points: number;
  sort_order: number;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadScoreSettings {
  id: string;
  cold_min: number;
  cold_max: number;
  warm_min: number;
  warm_max: number;
  hot_min: number;
  hot_max: number;
  very_hot_min: number;
  very_hot_max: number;
  updated_at: string;
}

export interface LeadScoreHistory {
  id: string;
  lead_id: string;
  old_score: number;
  new_score: number;
  delta: number;
  reason: string;
  trigger_event_id: string | null;
  matched_rules_snapshot: Array<{
    rule_id: string;
    name: string;
    category: LeadScoreCategory;
    points: number;
    description?: string | null;
  }>;
  created_at: string;
}

export interface LeadScoreRecalculationJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  total_leads: number;
  processed_leads: number;
  failed_leads: number;
  batch_size: number;
  last_processed_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadScoreCalculationResult {
  lead_id: string;
  raw_total: number;
  score: number;
  label: LeadScoreLabel;
  fit_subtotal: number;
  intent_subtotal: number;
  engagement_subtotal: number;
  matched_rules: Array<{
    rule_id: string;
    name: string;
    category: LeadScoreCategory;
    points: number;
    description?: string | null;
  }>;
  unmatched_rules: Array<{
    rule_id: string;
    name: string;
    category: LeadScoreCategory;
    points: number;
  }>;
}

// =============================================================================
// Phase 4 Block 2: Sales Intelligence Dashboard Types
// =============================================================================

export type MetricSemantics = 'SNAPSHOT' | 'PERIOD';

export type DashboardPeriodFilter = 'today' | '7d' | '30d' | '90d' | 'custom';

export interface DashboardSnapshotMetrics {
  total_leads: number;
  open_tasks: number;
  open_conversations: number;
  unread_conversations: number;
}

export interface DashboardPipelineStage {
  stage_id: string;
  stage_code: string;
  stage_name: string;
  sort_order: number;
  lead_count: number;
  percentage: number;
}

export interface DashboardFunnelStage {
  stage_code: string;
  stage_name: string;
  sort_order: number;
  unique_leads_entered: number;
  conversion_from_prev: number | null;
}

export interface DashboardPipelineMetrics {
  current_distribution: DashboardPipelineStage[];
  funnel: DashboardFunnelStage[];
  movements_in_period: number;
}

export interface DashboardQualificationItem {
  status: string;
  label: string;
  sort_order: number;
  lead_count: number;
  percentage: number;
}

export interface DashboardQualificationMetrics {
  distribution: DashboardQualificationItem[];
  confirmed_count: number;
}

export interface DashboardScoreBand {
  category: string;
  label: string;
  min_score: number | null;
  max_score: number | null;
  lead_count: number;
  percentage: number;
}

export interface DashboardScoringMetrics {
  thresholds: LeadScoreSettings;
  average_score: number;
  hot_and_very_hot_count: number;
  distribution: DashboardScoreBand[];
}

export interface DashboardActivityTrendItem {
  date: string;
  new_leads: number;
  outbound_messages: number;
  inbound_replies: number;
  stage_movements: number;
}

export interface DashboardActivityMetrics {
  new_leads_count: number;
  outbound_sent_count: number;
  outbound_unique_leads: number;
  inbound_replies_count: number;
  inbound_unique_leads: number;
  reply_rate: number | null;
  avg_first_response_time_seconds: number | null;
  trend: DashboardActivityTrendItem[];
}

export interface DashboardSequencePerformance {
  sequence_id: string;
  sequence_name: string;
  status: string;
  active_runs: number;
  completed_runs: number;
  outbound_sent: number;
  replies_attributed: number;
  reply_rate: number | null;
}

export interface DashboardAutomationMetrics {
  active_workflows: number;
  active_sequences: number;
  period_runs_total: number;
  period_runs_completed: number;
  period_runs_failed: number;
  sequences_performance: DashboardSequencePerformance[];
}

export interface DashboardTasksMetrics {
  pending_tasks: number;
  due_today: number;
  overdue: number;
  completed_all_time: number;
}

export interface DashboardDemographics {
  course_interest: Array<{
    course_name: string;
    lead_count: number;
    percentage: number;
  }>;
  sources: Array<{
    source: string;
    lead_count: number;
    percentage: number;
  }>;
  contact_preference: Array<{
    preference: string;
    lead_count: number;
    percentage: number;
  }>;
}

export interface DashboardPriorityLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string | null;
  lead_score: number | null;
  lead_score_category: string;
  stage_code: string;
  stage_name: string;
  qualification_status: string | null;
  course_interest: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardNeedsAttentionItem {
  lead_id: string;
  lead_name: string;
  lead_email: string | null;
  reason_code:
    | 'HIGH_SCORE_NO_NEXT_ACTION'
    | 'OVERDUE_TASK'
    | 'FAILED_AUTOMATION'
    | 'FAILED_INBOUND'
    | 'UNREAD_CONVERSATION'
    | 'NO_RESPONSE_STALE'
    | string;
  reason_label: string;
  detected_at: string;
  detail: string;
}

export interface SalesDashboardMetrics {
  snapshot: DashboardSnapshotMetrics;
  pipeline: DashboardPipelineMetrics;
  qualification: DashboardQualificationMetrics;
  scoring: DashboardScoringMetrics;
  activity: DashboardActivityMetrics;
  automation: DashboardAutomationMetrics;
  tasks: DashboardTasksMetrics;
  demographics: DashboardDemographics;
  priority_leads: DashboardPriorityLead[];
  needs_attention: DashboardNeedsAttentionItem[];
  period: {
    start_date: string;
    end_date: string;
  };
  generated_at: string;
}

// =============================================================================
// Phase 4 Block 3: Revenue & Enrollment Intelligence Types
// =============================================================================

export interface Course {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_price: number | null;
  currency: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type EnrollmentStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Enrollment {
  id: string;
  lead_id: string;
  course_id: string;
  course_name_snapshot: string;
  enrollment_status: EnrollmentStatus;
  agreed_amount: number;
  currency: string;
  enrollment_date: string;
  source: LeadSource;
  notes: string | null;
  idempotency_key: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  // Computed or joined
  course_session_id?: string | null;
  course?: Course | null;
  session?: CourseSession | null;
  participation?: CourseParticipation | null;
  post_course_engagement?: PostCourseEngagement | null;
  payments?: EnrollmentPayment[];
  paid_amount?: number;
  remaining_balance?: number;
}

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';
export type PaymentType = 'payment' | 'refund';

export type PaymentMethod =
  | 'credit_card'
  | 'wire_transfer'
  | 'check'
  | 'cash'
  | 'financing'
  | 'other';

export interface EnrollmentPayment {
  id: string;
  enrollment_id: string;
  amount: number;
  currency: string;
  payment_status: PaymentStatus;
  payment_type: PaymentType;
  parent_payment_id: string | null;
  payment_date: string;
  payment_method: PaymentMethod | null;
  external_reference: string | null;
  notes: string | null;
  idempotency_key: string | null;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type EnrollmentEventType =
  | 'enrollment_created'
  | 'enrollment_status_changed'
  | 'course_changed'
  | 'agreed_amount_changed'
  | 'payment_added'
  | 'payment_status_changed'
  | 'notes_updated';

export interface EnrollmentHistory {
  id: string;
  enrollment_id: string;
  lead_id: string;
  actor_id: string | null;
  actor_email: string | null;
  event_type: EnrollmentEventType;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown>;
  created_at: string;
}

export interface RevenueKpis {
  booked_value: number;
  gross_collected: number;
  collected_revenue?: number;
  refunded_amount: number;
  net_revenue: number;
  outstanding_balance: number;
  confirmed_enrollments_count: number;
  paid_enrollments_count: number;
  average_ticket: number | null;
  avg_collected_per_enrollment: number | null;
  avg_days_to_enrollment: number | null;
}

export interface RevenueCohorts {
  lead_to_enrollment_rate: number | null;
  leads_created_in_period: number;
  leads_created_enrolled: number;
  approval_to_enrollment_rate: number | null;
  leads_entered_approval_count: number;
  leads_approval_enrolled: number;
}

export interface RevenueGoals {
  monthly_net_revenue_target: number;
  monthly_enrollment_target: number;
  default_currency: string;
  revenue_progress_pct: number | null;
  enrollment_progress_pct: number | null;
}

export interface CourseRevenuePerformance {
  course_id: string;
  course_code: string;
  course_name: string;
  default_price: number | null;
  currency: string;
  interested_leads_count: number;
  confirmed_enrollments_count: number;
  booked_value: number;
  collected_revenue: number;
  net_revenue: number;
  outstanding_balance: number;
  average_ticket: number | null;
}

export interface SourceRevenuePerformance {
  source: string;
  total_leads: number;
  confirmed_enrollments: number;
  booked_value: number;
  net_revenue: number;
  conversion_rate: number | null;
  average_ticket: number | null;
}

export interface ApprovedNotEnrolledLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_raw: string | null;
  course_interest: string | null;
  lead_score: number | null;
  qualification_status: QualificationStatus | null;
  days_in_approval: number;
  next_action: string | null;
}

export interface EnrollmentVelocityEntry {
  period_start: string;
  period_end: string;
  confirmed_enrollments: number;
  booked_value: number;
}

export interface RevenueDashboardMetrics {
  kpis: RevenueKpis;
  cohorts: RevenueCohorts;
  goals: RevenueGoals;
  course_performance: CourseRevenuePerformance[];
  source_performance: SourceRevenuePerformance[];
  approved_not_enrolled: ApprovedNotEnrolledLead[];
  velocity: EnrollmentVelocityEntry[];
}

// =============================================================================
// Phase 4 Block 4: Course Operations & Student Lifecycle Types
// =============================================================================

export type CourseSessionStatus = 'draft' | 'open' | 'confirmed' | 'completed' | 'cancelled';
export type AttendanceStatus = 'expected' | 'attended' | 'no_show' | 'cancelled';
export type CompletionStatus = 'not_started' | 'completed' | 'incomplete';
export type ChecklistItemStatus = 'pending' | 'completed' | 'waived';

export type NeedsAttentionReasonCode =
  | 'ENROLLMENT_WITHOUT_SESSION'
  | 'PAYMENT_OUTSTANDING'
  | 'MISSING_REQUIRED_ITEM'
  | 'UPCOMING_SESSION_UNREADY'
  | 'NO_SHOW'
  | 'POST_COURSE_FOLLOWUP_DUE'
  | 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED';

export interface CourseSession {
  id: string;
  course_id: string;
  code: string;
  title: string;
  status: CourseSessionStatus;
  start_date: string;
  end_date: string;
  timezone: string;
  capacity: number | null;
  location: string | null;
  instructor_name: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  // Computed or joined
  course?: Course;
  confirmed_students_count?: number;
  available_seats?: number | null;
  is_at_capacity?: boolean;
  is_over_capacity?: boolean;
}

export interface CourseParticipation {
  id: string;
  enrollment_id: string;
  course_session_id: string;
  attendance_status: AttendanceStatus;
  completion_status: CompletionStatus;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  session?: CourseSession;
}

export interface CourseChecklistTemplate {
  id: string;
  course_id: string | null;
  title: string;
  description: string | null;
  required: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StudentChecklistItem {
  id: string;
  enrollment_id: string;
  course_session_id: string;
  template_id: string | null;
  title_snapshot: string;
  required: boolean;
  status: ChecklistItemStatus;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRosterStudent {
  enrollment_id: string;
  lead_id: string;
  student_name: string;
  student_email: string | null;
  student_phone: string | null;
  enrollment_status: EnrollmentStatus;
  enrollment_date: string;
  agreed_amount: number;
  currency: string;
  net_paid: number;
  outstanding_balance: number;
  payment_status_derived: 'paid' | 'partial' | 'unpaid';
  attendance_status: AttendanceStatus;
  completion_status: CompletionStatus;
  completed_at: string | null;
  participation_notes: string | null;
  repeat_student: boolean;
  checklist_total: number;
  checklist_completed: number;
  checklist_pending: number;
  checklist_required_pending: number;
  checklist_items: StudentChecklistItem[];
  needs_attention_reasons: NeedsAttentionReasonCode[];
}

export interface CourseOperationsKpis {
  active_sessions_count: number;
  upcoming_sessions_count: number;
  active_students_count: number;
  unassigned_enrollments_count: number;
  needs_attention_count: number;
}

export interface UpcomingSessionSummary {
  id: string;
  code: string;
  title: string;
  status: CourseSessionStatus;
  start_date: string;
  end_date: string;
  timezone: string;
  capacity: number | null;
  location: string | null;
  instructor_name: string | null;
  course_id: string;
  course_name: string;
  course_code: string;
  confirmed_students_count: number;
  available_seats: number | null;
  unready_students_count: number;
}

export interface RecentlyCompletedSessionSummary {
  id: string;
  code: string;
  title: string;
  status: CourseSessionStatus;
  start_date: string;
  end_date: string;
  course_name: string;
  total_students: number;
  attended_count: number;
  completed_count: number;
}

export interface UnassignedStudent {
  enrollment_id: string;
  lead_id: string;
  student_name: string;
  email: string | null;
  phone: string | null;
  course_id: string;
  course_name_snapshot: string;
  enrollment_date: string;
  agreed_amount: number;
  net_paid: number;
  outstanding_balance: number;
}

export interface CourseOperationsNeedsAttentionItem {
  reason_code: NeedsAttentionReasonCode;
  severity: 'critical' | 'warning' | 'info';
  enrollment_id: string;
  lead_id: string;
  student_name: string;
  course_name: string;
  session_code: string | null;
  session_id: string | null;
  message: string;
  detected_at: string;
}

export interface CourseOperationsDashboardData {
  kpis: CourseOperationsKpis;
  upcoming_sessions: UpcomingSessionSummary[];
  recently_completed: RecentlyCompletedSessionSummary[];
  unassigned_students: UnassignedStudent[];
  needs_attention: CourseOperationsNeedsAttentionItem[];
  settings: {
    readiness_window_days: number;
    followup_due_days: number;
  };
}

export interface CourseSessionDetailData {
  session: {
    id: string;
    code: string;
    title: string;
    status: CourseSessionStatus;
    start_date: string;
    end_date: string;
    timezone: string;
    capacity: number | null;
    location: string | null;
    instructor_name: string | null;
    notes: string | null;
    confirmed_students_count: number;
    available_seats: number | null;
    is_at_capacity: boolean;
    is_over_capacity: boolean;
  };
  course: {
    id: string;
    code: string;
    name: string;
    currency: string;
  };
  roster: SessionRosterStudent[];
}

// =============================================================================
// Phase 4 Block 5: Alumni & Post-Course Experience Types
// =============================================================================

export type PostCourseFollowupStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type FeedbackStatus = 'not_requested' | 'requested' | 'received' | 'declined';
export type TestimonialStatus = 'not_requested' | 'requested' | 'received' | 'declined';
export type TestimonialConsentStatus = 'unknown' | 'granted' | 'declined';
export type FutureInterestStatus = 'active' | 'converted' | 'dismissed';
export type FutureInterestSource = 'manual' | 'post_course' | 'form';

export type PostCourseNeedsAttentionReason =
  | 'POST_COURSE_FOLLOWUP_OVERDUE'
  | 'FEEDBACK_PENDING'
  | 'TESTIMONIAL_REQUEST_DUE'
  | 'NEXT_COURSE_OPPORTUNITY'
  | 'POST_COURSE_TASK_OVERDUE';

export interface PostCourseEngagement {
  id: string;
  enrollment_id: string;
  lead_id: string;
  followup_status: PostCourseFollowupStatus;
  feedback_status: FeedbackStatus;
  testimonial_status: TestimonialStatus;
  testimonial_consent_status: TestimonialConsentStatus;
  followup_due_at: string;
  followup_completed_at: string | null;
  feedback_requested_at: string | null;
  feedback_received_at: string | null;
  feedback_notes: string | null;
  testimonial_requested_at: string | null;
  testimonial_received_at: string | null;
  testimonial_notes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  enrollment?: Enrollment;
  lead?: Lead;
}

export interface LeadCourseInterest {
  id: string;
  lead_id: string;
  course_id: string;
  course_session_id?: string | null;
  priority?: 1 | 2 | 3 | null;
  source: FutureInterestSource;
  source_enrollment_id?: string | null;
  post_course_engagement_id?: string | null;
  status: FutureInterestStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  course?: Course;
}

export interface PostCourseFeedbackToken {
  id: string;
  engagement_id: string;
  token_hash: string;
  token_hint: string | null;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
}

export interface PostCourseFollowupQueueItem {
  engagement_id: string;
  enrollment_id: string;
  lead_id: string;
  student_name: string;
  student_email: string | null;
  student_phone: string | null;
  contact_preference: ContactPreference;
  course_name: string;
  session_code: string | null;
  session_title: string | null;
  completed_at: string | null;
  followup_status: PostCourseFollowupStatus;
  followup_due_at: string;
  is_overdue: boolean;
  notes: string | null;
}

export interface TestimonialOpportunityItem {
  engagement_id: string;
  enrollment_id: string;
  lead_id: string;
  student_name: string;
  student_email: string | null;
  course_name: string;
  session_code: string | null;
  feedback_status: FeedbackStatus;
  feedback_received_at: string | null;
  feedback_notes: string | null;
  testimonial_status: TestimonialStatus;
  testimonial_consent_status: TestimonialConsentStatus;
  testimonial_notes: string | null;
}

export interface NextCourseOpportunityItem {
  interest_id: string;
  lead_id: string;
  student_name: string;
  student_email: string | null;
  student_phone: string | null;
  contact_preference: ContactPreference;
  course_id: string;
  target_course_name: string;
  default_price: number | null;
  source: FutureInterestSource;
  status: FutureInterestStatus;
  notes: string | null;
  created_at: string;
  completed_course_name: string | null;
}

export interface AlumniDirectoryItem {
  lead_id: string;
  student_name: string;
  student_email: string | null;
  student_phone: string | null;
  contact_preference: ContactPreference;
  member_since: string;
  confirmed_enrollments_count: number;
  is_repeat_student: boolean;
  total_spend: number;
  last_completed_date: string | null;
  current_interest: string | null;
}

export interface PostCourseNeedsAttentionItem {
  reason_code: PostCourseNeedsAttentionReason;
  severity: 'warning' | 'info';
  engagement_id: string;
  lead_id: string;
  student_name: string;
  course_name: string;
  message: string;
  detected_at: string;
}

export interface PostCourseKpis {
  completed_students_count: number;
  followups_due_count: number;
  followups_overdue_count: number;
  feedback_pending_count: number;
  feedback_received_count: number;
  testimonials_received_count: number;
  testimonial_opportunities_count: number;
  next_course_opportunities_count: number;
  repeat_students_count: number;
  alumni_students_count: number;
  feedback_response_rate: number | null;
  testimonial_response_rate: number | null;
  repeat_student_rate: number | null;
}

export interface PostCourseDashboardData {
  kpis: PostCourseKpis;
  followup_queue: PostCourseFollowupQueueItem[];
  testimonial_opportunities: TestimonialOpportunityItem[];
  next_course_opportunities: NextCourseOpportunityItem[];
  alumni_directory: AlumniDirectoryItem[];
  needs_attention: PostCourseNeedsAttentionItem[];
}

// =============================================================================
// Phase 5 Block 1: Tasks, Work Queues & Daily Operations Types
// =============================================================================

export type WorkItemType =
  | 'TASK'
  | 'LEAD_ATTENTION'
  | 'CONVERSATION_ATTENTION'
  | 'PAYMENT_ATTENTION'
  | 'COURSE_ATTENTION'
  | 'POST_COURSE_ATTENTION';

export type WorkItemCategory =
  | 'today'
  | 'overdue'
  | 'needs_reply'
  | 'hot_leads'
  | 'no_action'
  | 'stale_leads'
  | 'courses'
  | 'payments'
  | 'post_course'
  | 'completed'
  | 'upcoming';

export interface WorkItemPrimaryAction {
  type:
    | 'complete_task'
    | 'reschedule_task'
    | 'open_lead'
    | 'create_task'
    | 'open_inbox'
    | 'open_enrollment'
    | 'open_session'
    | 'open_engagement';
  label: string;
  href?: string;
  task_id?: string;
  lead_id?: string;
  session_id?: string;
  enrollment_id?: string;
  engagement_id?: string;
}

export interface WorkItem {
  id: string;
  type: WorkItemType;
  category: WorkItemCategory;
  priority: TaskPriority;
  title: string;
  description: string | null;
  due_at: string | null;
  is_overdue: boolean;
  detected_at: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  contact_preference: ContactPreference | null;
  lead_score: number | null;
  pipeline_stage: string | null;
  reason_code: string | null;
  context_id: string | null;
  context_type: 'task' | 'conversation' | 'lead' | 'enrollment' | 'session' | 'post_course';
  primary_action: WorkItemPrimaryAction;
}

export interface DailyOperationsDashboardKpis {
  timezone: string;
  hot_min_threshold: number;
  stale_after_days: number;
  due_today_count: number;
  overdue_count: number;
  completed_today_count: number;
  needs_reply_count: number;
  hot_leads_count: number;
  leads_no_next_action_count: number;
  stale_leads_count: number;
  course_attention_count: number;
  payment_attention_count: number;
  post_course_attention_count: number;
  total_actionable_items: number;
}

export interface DailyOperationsQueueResponse {
  tab: string;
  total_count: number;
  limit: number;
  offset: number;
  items: WorkItem[];
}

export interface DailyOperationsFilter {
  tab?: string;
  subFilter?: string | null;
  priority?: TaskPriority | null;
  search?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// HubSpot Continuous Sync & Mapping Governance Types
// =============================================================================

export type IntegrationConnectionStatus =
  | 'configuration_required'
  | 'connected'
  | 'degraded'
  | 'disconnected';

export type IntegrationEntityLinkStatus =
  | 'active'
  | 'conflict'
  | 'archived'
  | 'disconnected';

export type IntegrationFieldMappingDirection =
  | 'hubspot_to_eds'
  | 'eds_to_hubspot'
  | 'bidirectional';

export type IntegrationSourceOfTruth =
  | 'hubspot'
  | 'eds'
  | 'bidirectional_newest'
  | 'manual_conflict';

export type IntegrationTargetType =
  | 'lead_field'
  | 'lead_course_interest'
  | 'integration_metadata';

export type IntegrationTransformRule =
  | 'none'
  | 'phone_digits'
  | 'phone_e164'
  | 'email_normalize'
  | 'qualification_status_enum'
  | 'course_interest_lookup'
  | 'boolean_toggle'
  | 'timestamp_utc';

export type IntegrationSyncDirection = 'inbound' | 'outbound';

export type IntegrationSyncStatus =
  | 'received'
  | 'processing'
  | 'completed'
  | 'ignored_duplicate'
  | 'ignored_echo'
  | 'ignored_stale'
  | 'conflict'
  | 'failed'
  | 'dead_letter';

export type IntegrationConflictType =
  | 'MULTIPLE_EMAIL_MATCH'
  | 'MULTIPLE_PHONE_MATCH'
  | 'EMAIL_COLLISION'
  | 'PHONE_COLLISION'
  | 'MAPPING_VALUE_UNKNOWN'
  | 'TYPE_CONVERSION_FAILED'
  | 'CONCURRENT_FIELD_UPDATE'
  | 'EXTERNAL_ENTITY_MERGED';

export type IntegrationConflictStatus =
  | 'pending_review'
  | 'resolved_hubspot_wins'
  | 'resolved_eds_wins'
  | 'resolved_manual_edit'
  | 'dismissed';

export interface IntegrationConnection {
  id: string;
  provider: 'hubspot';
  status: IntegrationConnectionStatus;
  portal_id: string | null;
  account_name: string | null;
  sync_enabled: boolean;
  inbound_webhook_enabled: boolean;
  outbound_sync_enabled: boolean;
  auto_suppress_automations: boolean;
  last_health_check_at: string | null;
  health_status_message: string | null;
  last_successful_api_call_at: string | null;
  last_webhook_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationEntityLink {
  id: string;
  integration: 'hubspot';
  entity_type: 'lead';
  eds_entity_id: string;
  external_entity_id: string;
  status: IntegrationEntityLinkStatus;
  last_synced_hash: string | null;
  external_updated_at: string | null;
  conflict_reason: string | null;
  last_inbound_sync_at: string | null;
  last_outbound_sync_at: string | null;
  linked_at: string;
  created_at: string;
  updated_at: string;
}

export interface IntegrationFieldMapping {
  id: string;
  integration: 'hubspot';
  entity_type: 'lead';
  external_property: string;
  eds_target: string;
  target_type: IntegrationTargetType;
  direction: IntegrationFieldMappingDirection;
  source_of_truth: IntegrationSourceOfTruth;
  transform_rule: IntegrationTransformRule;
  allow_clear: boolean;
  is_active: boolean;
  mapping_version: number;
  created_at: string;
  updated_at: string;
}

export interface IntegrationFieldMappingHistory {
  id: string;
  mapping_id: string;
  external_property: string;
  eds_target: string;
  target_type: IntegrationTargetType;
  direction: IntegrationFieldMappingDirection;
  source_of_truth: IntegrationSourceOfTruth;
  transform_rule: IntegrationTransformRule;
  allow_clear: boolean;
  mapping_version: number;
  changed_by: string | null;
  change_reason: string | null;
  created_at: string;
}

export interface IntegrationSyncEvent {
  id: string;
  integration: 'hubspot';
  direction: IntegrationSyncDirection;
  entity_type: 'lead';
  eds_entity_id: string | null;
  external_entity_id: string | null;
  event_type: string;
  external_event_id: string | null;
  external_event_timestamp: string | null;
  mapping_version: number | null;
  payload_hash: string;
  status: IntegrationSyncStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  error_code: string | null;
  error_message: string | null;
  change_summary: Record<string, any>;
  created_at: string;
  processed_at: string | null;
}

export interface IntegrationOutboxItem {
  id: string;
  integration: 'hubspot';
  entity_type: 'lead';
  eds_entity_id: string;
  external_entity_id: string | null;
  event_type: string;
  payload: Record<string, any>;
  payload_hash: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface IntegrationConflict {
  id: string;
  integration: 'hubspot';
  entity_type: 'lead';
  eds_entity_id: string | null;
  external_entity_id: string | null;
  conflict_type: IntegrationConflictType;
  conflict_summary: string;
  field_name: string | null;
  hubspot_data: Record<string, any>;
  eds_data: Record<string, any>;
  status: IntegrationConflictStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface IntegrationPropertyCache {
  id: string;
  integration: 'hubspot';
  property_name: string;
  label: string;
  property_type: string;
  field_type: string;
  options: any[] | null;
  is_custom: boolean;
  is_archived: boolean;
  last_refreshed_at: string;
}

export interface HubSpotSyncMetrics {
  provider: 'hubspot';
  status: IntegrationConnectionStatus;
  portal_id: string | null;
  account_name: string | null;
  sync_enabled: boolean;
  linked_count: number;
  pending_outbox: number;
  sync_errors: number;
  conflicts_count: number;
  last_sync_at: string | null;
  last_health_check_at: string | null;
  health_status_message: string | null;
}

export interface HubSpotDryRunResult {
  scanned: number;
  matched: number;
  would_create: number;
  would_update: number;
  conflicts: number;
  skipped: number;
}
