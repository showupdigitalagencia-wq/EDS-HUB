// =============================================================================
// EDS HUB — Database Types (Phase 1 + Phase 2)
// =============================================================================

export type LeadSource = 'meta' | 'google' | 'manual' | 'test';
export type ContactPreference = 'email' | 'sms' | 'call';
export type MessageChannel = 'email' | 'sms' | 'call';
export type MessageProvider = 'resend' | 'twilio';
export type MessageStatus = 'pending' | 'sent' | 'failed';
export type IntakeStatus = 'received' | 'processing' | 'processed' | 'failed' | 'duplicate';
export type TaskType = 'call' | 'data_review';
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
  | 'csv_status_unmapped';
export type ActorType = 'system' | 'user';
export type StageChangeReason = 'initial_assignment' | 'auto_after_intake' | 'manual' | 'csv_import_stage_mapping';
export type DomainVerificationStatus = 'unknown' | 'pending' | 'passed' | 'verified' | 'failed';

// Phase 2 Enums
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';
export type ImportRowStatus = 'created' | 'updated' | 'skipped' | 'failed';
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
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_confirmation: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  contact_preference: ContactPreference;
  pipeline_stage_id: string;
  source_created_at: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  lead_id: string;
  intake_event_id: string | null;
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
