// =============================================================================
// Shared Types for Edge Functions
// =============================================================================

export interface LeadIntakePayload {
  source: 'meta' | 'google' | 'manual' | 'test' | 'form' | 'facebook' | 'instagram' | string;
  source_detail?: string;
  lead_id?: string;
  intake_event_id?: string;
  external_event_id?: string;
  external_lead_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_confirmation?: string;
  phone?: string;
  contact_preference?: 'email' | 'sms' | 'call' | string;
  source_created_at?: string;
  raw_payload?: Record<string, unknown>;
}

export interface LeadIntakeResponse {
  success: boolean;
  intake_event_id: string;
  lead_id: string | null;
  status: string;
  messages_sent: number;
  messages_failed: number;
  tasks_created: number;
  stage_advanced: boolean;
  errors?: string[];
}
