// =============================================================================
// EDS HUB — Lead Intake Contract
// =============================================================================
// Normalized payload accepted by the process-lead-intake Edge Function.
// This contract is intentionally provider-agnostic.
// In Phase 5, Meta/Google webhooks will convert their payloads to this format.
// =============================================================================

import type { ContactPreference, LeadSource } from './database';

/**
 * Normalized payload for lead intake.
 * All fields are provider-agnostic.
 */
export interface LeadIntakePayload {
  source: LeadSource;
  external_event_id?: string;
  external_lead_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_confirmation?: string;
  phone?: string;
  contact_preference: ContactPreference;
  source_created_at?: string; // ISO 8601
  raw_payload?: Record<string, unknown>;
}

/**
 * Response from the process-lead-intake Edge Function.
 */
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
