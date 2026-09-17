// =============================================================================
// EDS HUB — Database Types (Phase 1 + Phase 2)
// =============================================================================

export type LeadSource = 'meta' | 'google' | 'manual' | 'test' | 'form';
export type ContactPreference = 'email' | 'sms' | 'call';
export type MessageChannel = 'email' | 'sms' | 'call';
export type MessageProvider = 'resend' | 'twilio';
export type MessageStatus = 'pending' | 'sent' | 'failed';
export type IntakeStatus = 'received' | 'processing' | 'processed' | 'failed' | 'duplicate';
export type TaskType = 'call' | 'data_review' | 'general';
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
  | 'sequence_stopped';
export type ActorType = 'system' | 'user';
export type StageChangeReason = 'initial_assignment' | 'auto_after_intake' | 'manual' | 'csv_import_stage_mapping';
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
  singleton_key: number;
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
  created_by: TaskCreatedBy;
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
  channel: 'email';
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
  filter_definition: Record<string, unknown>;
  estimated_recipient_count: number;
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
  email: string;
  status: RecipientStatus;
  variant: 'A' | 'B' | null;
  provider_message_id: string | null;
  sent_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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
  | 'lead_replied';

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




