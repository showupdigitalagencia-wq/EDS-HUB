# Resend & Email Infrastructure Production Readiness Audit
**Repository:** EDS HUB  
**Batch:** 7.1  
**Status:** Audit & Plan Only (No Production Emails Sent, No Secrets Configured, No Migrations Applied)  
**Date:** September 2026  

---

## 1. Executive Summary & Audit Scope

This document provides a comprehensive technical audit of the email architecture within EDS HUB, focusing specifically on Resend integration readiness for the domain `expdentalsolutions.com` and sender `info@expdentalsolutions.com`. 

Following the completion of website integration foundation (Batch 6.2), this audit examines the current implementation across all Supabase Edge Functions, database schemas, frontend components, and security controls to identify:
1. What is currently implemented and functional.
2. What architectural gaps and missing handlers exist.
3. What human actions (DNS, provider accounts, secrets) are strictly required before any real email is sent.
4. What code actions and schema migrations (proposed Migration 00059) must be prepared prior to production activation.

---

## 2. Existing Email Architecture Inventory

### 2.1 File & Function Inventory

| Component | File Path | Functions / Responsibilities | Status |
| :--- | :--- | :--- | :--- |
| **Resend Adapter** | `supabase/functions/_shared/resend-adapter.ts` | `sendEmail(params: SendEmailParams)`: Direct HTTP client to Resend REST API | Implemented |
| **Domain Checker** | `supabase/functions/check-domain-status/index.ts` | Queries Resend API (`/domains`) for verification status of SPF, DKIM | Implemented |
| **System Status** | `supabase/functions/system-status/index.ts` | Reports boolean status of `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Implemented |
| **Inbound Webhook** | `supabase/functions/inbound-email-webhook/index.ts` | Ingests incoming emails, validates Svix signature, invokes `ingest_inbound_message_transaction` | Implemented |
| **Webhook Verifier** | `supabase/functions/_shared/webhook-verifier.ts` | `verifyResendSignature`: Svix HMAC-SHA256 signature verification | Implemented |
| **Lead Intake Outbound** | `supabase/functions/process-lead-intake/index.ts` | `handleEmailPreference`: Dispatches initial outreach via Resend for intake events | Implemented |
| **Automation Outbound** | `supabase/functions/execute-automation-run/index.ts` | Action step `send_email`: Dispatches emails in automated workflows and sequences | Implemented |
| **Campaign Batch Send** | `supabase/functions/campaign-send-batch/index.ts` | Dispatches approved marketing campaigns in batches of 20–50 | Implemented |
| **Campaign Test Send** | `supabase/functions/campaign-test-send/index.ts` | Dispatches single test preview email to an authenticated admin | Implemented |
| **Conversational Send** | `supabase/functions/send-conversation-message/index.ts` | Dispatches manual 1-on-1 CRM replies from Conversational Inbox | Implemented |
| **Delivery Event Webhook** | *None* | Webhook endpoint for `email.delivered`, `email.bounced`, `email.complained` | **MISSING (GAP)** |
| **Email Queue Runner** | `supabase/functions/process-automation-queue/index.ts` | Background runner for scheduled wait steps; invokes `execute-automation-run` | Implemented |
| **Lead Profile Email** | `src/features/leads/LeadDetailPage.tsx` | Manual quick action `mailto:` deep link | Implemented (mailto) |
| **Email Utilities** | `supabase/functions/_shared/email-utils.ts` | Syntax validation (`isValidEmailSyntax`), normalization, dedup | Implemented |
| **Salutation Utility** | `supabase/functions/_shared/salutation.ts` | Resolves doctor salutation fallback (`Doc`, `Dr. [Last]`, `[First]`) | Implemented |

---

## 3. Resend Adapter Deep Dive

**File:** `supabase/functions/_shared/resend-adapter.ts`

### 3.1 Implementation Details
* **Is Resend adapter implemented?** **YES.**
* **Does it actually call the Resend API?** **YES.** It executes a direct server-side `fetch('https://api.resend.com/emails', ...)`.
* **HTTP Endpoint:** `POST https://api.resend.com/emails`
* **Headers Sent:**
  ```http
  Authorization: Bearer <RESEND_API_KEY>
  Content-Type: application/json
  Idempotency-Key: <params.idempotencyKey>
  ```
* **Payload Structure:**
  ```json
  {
    "from": "params.from",
    "to": ["params.to"],
    "subject": "params.subject",
    "html": "params.html",
    "headers": { ... } // optional
  }
  ```

### 3.2 Feature Matrix

| Feature | Supported in Adapter? | Implementation Notes |
| :--- | :---: | :--- |
| `from` | **YES** | Top-level string parameter in `sendEmail`. |
| `to` | **YES** | Single string wrapped in an array `[params.to]`. |
| `subject` | **YES** | Top-level string parameter. |
| `html` | **YES** | Top-level HTML string parameter. |
| `text` (plain-text body) | **NO** | Not accepted in `SendEmailParams`; not passed to Resend API. |
| `reply-to` | **NO** | Not exposed in `SendEmailParams`. Not set in payload. Can only be passed if caller manually injects `headers['Reply-To']`. |
| Custom `Message-ID` | **NO** | Resend assigns its own ID; adapter returns `data.id`. |
| `Idempotency-Key` | **YES** | Passed as standard HTTP header `Idempotency-Key: <params.idempotencyKey>`. |
| `tags` | **NO** | Not exposed in params; not passed to Resend. |
| `metadata` | **NO** | Not exposed in params; not passed to Resend. |
| Error Sanitization | **YES** | Extracts `parsedError.message` or slices body to 200 chars. Does NOT log API keys. |
| Response ID Return | **YES** | Returns `{ success: true, messageId: data.id }` to caller. |
| Automatic Retry / Backoff | **NO** | Single HTTP attempt only. No exponential backoff on HTTP 429 or network timeout. |
| Delivery Status Distinction | **NO** | Synchronous HTTP response only distinguishes `HTTP 200/201` (accepted by Resend) vs. `HTTP error / Network error`. Does not and cannot track async delivery (`delivered`, `bounced`, `complained`). |

---

## 4. Current Email Environment Variables & Secrets

Source references were audited across all Edge Functions, frontend code, and configuration files.

| Variable Name | Used in Code? | Required for Production? | Currently Configured? | Notes |
| :--- | :---: | :---: | :---: | :--- |
| `RESEND_API_KEY` | **YES** | **YES** | **YES (local) / UNKNOWN (remote)** | Present in local `supabase/functions/.env`. Remote Supabase secrets state is unknown without dashboard/CLI query. |
| `RESEND_FROM_EMAIL` | **YES** | **YES** | **YES (local) / UNKNOWN (remote)** | Present in local `.env` as `no-reply@expdentalsolutions.com`. Needs update to `info@expdentalsolutions.com`. |
| `RESEND_WEBHOOK_SECRET` | **YES** | **YES** (for inbound/events) | **NO (local) / UNKNOWN (remote)** | Used in `inbound-email-webhook`. Missing from local `.env`. |
| `RESEND_FROM_NAME` | **NO** | **NO** | **NOT CONFIGURED** | Not referenced in Edge Functions; code hardcodes or falls back to `'Expert Dental Solutions'`. |
| `RESEND_REPLY_TO` | **NO** | Recommended | **NOT CONFIGURED** | Not currently referenced in Edge Functions. |
| `RESEND_DOMAIN` | **NO** | **NO** | **NOT CONFIGURED** | Domain is stored in `app_settings.email_sending_domain` in database. |

---

## 5. Official Sender Identity Audit

### 5.1 Target Sender Identity
* **Target Email:** `info@expdentalsolutions.com`
* **Target Brand:** `Expert Dental Solutions`
* **Target Presentation Header:** `Expert Dental Solutions <info@expdentalsolutions.com>`

### 5.2 Existing Code Discrepancies
The codebase currently contains conflicting hardcoded sender fallbacks across different functions:
1. `supabase/functions/execute-automation-run/index.ts` (Line 545):
   ```ts
   const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'team@expertdentalsolutions.org';
   ```
   *Risk:* Points to `.org` domain if `RESEND_FROM_EMAIL` is missing!
2. `supabase/functions/send-conversation-message/index.ts` (Line 162):
   ```ts
   const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'team@expertdentalsolutions.org';
   ```
   *Risk:* Points to `.org` domain.
3. `supabase/functions/campaign-send-batch/index.ts` (Line 165):
   ```ts
   const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'no-reply@expdentalsolutions.com';
   const fromName = campaign.from_name || 'Expert Dental Solutions';
   const sender = `${fromName} <${fromEmail}>`;
   ```
   *Risk:* Falls back to `no-reply@` rather than `info@`.
4. `supabase/functions/campaign-test-send/index.ts` (Line 96):
   ```ts
   const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'no-reply@expdentalsolutions.com';
   ```
5. `supabase/functions/process-lead-intake/index.ts` (Line 798):
   ```ts
   const fromEmail = Deno.env.get('RESEND_FROM_EMAIL');
   if (!fromEmail) return { ... errors: ['RESEND_FROM_EMAIL not configured'] };
   ```

*Audit Finding:* Prior to production activation, all Edge Functions must standardize on:
`Expert Dental Solutions <info@expdentalsolutions.com>`.

---

## 6. Existing Email Provider & Mail Hosting Risk

> [!CAUTION]
> **CURRENT MAIL HOSTING: UNKNOWN — HUMAN CHECK REQUIRED**

Before any DNS record changes are made, the human administrator must determine where `info@expdentalsolutions.com` is currently hosted.

### 6.1 Critical Danger to Existing Mail
If `expdentalsolutions.com` already uses **Google Workspace**, **Microsoft 365**, or **cPanel Webmail**:
* The domain already has active **MX (Mail Exchange)** records routing day-to-day business emails to that provider's servers.
* **BLINDLY CHANGING OR OVERWRITING ROOT MX RECORDS WILL IMMEDIATELY BREAK ALL INCOMING BUSINESS EMAILS FOR THE CLINIC.**
* Resend's sending capabilities **do NOT require replacing existing root MX records**. Resend only requires SPF and DKIM for outbound sending.

### 6.2 Pre-Activation Verification Checklist for Human Admin
1. Execute a DNS lookup for `MX expdentalsolutions.com`.
2. Document whether existing MX points to Google (`aspmx.l.google.com`), Microsoft (`...mail.protection.outlook.com`), cPanel, or another provider.
3. **DO NOT MODIFY OR DELETE EXISTING MX RECORDS.**

---

## 7. SPF (Sender Policy Framework) Safety

### 7.1 Single Record Rule (RFC 7208)
* RFC 7208 §3.2 strictly states: **A domain MUST NOT have more than one SPF TXT record.**
* If a domain publishes multiple SPF TXT records, receiving mail servers will flag the SPF check as `PermError` (Permanent Error), which causes emails to be marked as spam or rejected outright by Gmail, Yahoo, and Outlook.

### 7.2 SPF Safe Merging Strategy
* If the domain has no existing SPF:
  Publish the Resend-specified SPF TXT record on the sending hostname.
* If the domain **already has an existing SPF record** (e.g., `v=spf1 include:_spf.google.com ~all`):
  Merge Resend's include mechanism into the single existing record:
  ```txt
  v=spf1 include:_spf.google.com include:resend.com ~all
  ```
* **NEVER add a second `v=spf1 ...` TXT record.**

---

## 8. DKIM (DomainKeys Identified Mail)

1. Resend provides 2 to 3 DKIM public keys as `CNAME` or `TXT` records when `expdentalsolutions.com` is registered in the Resend dashboard.
2. These records use Resend-generated selectors (e.g., `resend._domainkey.expdentalsolutions.com`).
3. Adding DKIM records poses **zero risk** to existing mail hosting because DKIM selectors are isolated subdomains and do not interfere with root domain routing.
4. **Action:** Human administrator must retrieve the exact DKIM hostnames and values directly from Resend Domain Management and configure them in DNS.

---

## 9. DMARC (Domain-based Message Authentication, Reporting, and Conformance)

### 9.1 Current Repository Dependency
* EDS HUB does not enforce or require a strict DMARC policy for internal application operation.
* `supabase/functions/check-domain-status/index.ts` records `dmarc_status: 'unknown'` because the Resend API does not validate third-party DMARC policies.

### 9.2 Conservative Staged Rollout Recommendation
To protect legitimate business communications from being blocked during rollout:
* **Stage 1 (Monitoring only):**
  ```txt
  Hostname: _dmarc.expdentalsolutions.com
  Type: TXT
  Value: v=DMARC1; p=none; pct=100; rua=mailto:dmarc-reports@expdentalsolutions.com;
  ```
  `p=none` allows deliverability monitoring without failing or rejecting any non-aligned emails.
* **Stage 2 (Quarantine / Reject):**
  Only after observing 100% alignment across Google Workspace/M365 and Resend over a 30-day period should `p=quarantine` or `p=reject` be considered.

---

## 10. Email Webhooks & Delivery Lifecycle Audit

### 10.1 Inbound Email Webhook
* **Endpoint:** `supabase/functions/inbound-email-webhook/index.ts`
* **Purpose:** Handles incoming emails, parses body/attachments, resolves sender lead, matches conversation thread.
* **Status:** Implemented and functional.

### 10.2 Delivery / Bounce / Complaint Webhook Gap Analysis
* **Status:** **COMPLETELY MISSING (CRITICAL GAP).**
* Currently, **no webhook endpoint exists** in EDS HUB to receive Resend asynchronous lifecycle events:
  * `email.sent`
  * `email.delivered`
  * `email.delivery_delayed`
  * `email.bounced`
  * `email.complained`
* **Consequence of this gap:**
  1. Once an email is accepted by Resend (`HTTP 200`), the database status remains frozen at `'sent'`.
  2. Bounced emails are never detected or recorded in `outbound_messages`.
  3. Hard-bounced addresses are not suppressed, meaning subsequent campaigns or sequences would repeatedly attempt delivery to invalid inboxes, damaging domain reputation.
  4. Spam complaints are never recorded.

---

## 11. Webhook Signature Verification

**File:** `supabase/functions/_shared/webhook-verifier.ts`

### 11.1 Implementation Verification
* **Standard:** Svix Webhook Verification.
* **Required Headers:**
  * `svix-id`
  * `svix-timestamp`
  * `svix-signature`
* **Algorithm:** HMAC-SHA256 on `${svix-id}.${svix-timestamp}.${rawBody}` using the secret key (stripping `whsec_` prefix and decoding base64).
* **Tolerance Window:** 300 seconds (5 minutes) timestamp freshness check.
* **Multiple Signatures:** Supports iterating space-separated `v1,signature` tokens.
* **Status:** Fully and correctly implemented.

### 11.2 Endpoint Separation
* Resend provides two distinct webhook configurations in their dashboard:
  1. **Resend Inbound Webhook:** Forwards inbound customer emails.
  2. **Resend Event Webhook:** Forwards delivery status changes (`delivered`, `bounced`, etc.).
* These require distinct endpoints or a unified router function with event type dispatching.

---

## 12. Conversation Threading & Message Persistence

### 12.1 Outbound Message Persistence

| Call Site | Table | `conversation_id` Assigned? | `provider_message_id` Saved? | Status Saved |
| :--- | :--- | :---: | :---: | :---: |
| `send-conversation-message` | `public.outbound_messages` | **YES** | **YES** | `'sent'` |
| `execute-automation-run` | `public.outbound_messages` | **NO** (null) | **YES** | `'sent'` |
| `process-lead-intake` | `public.outbound_messages` | **NO** (null) | **YES** | `'sent'` |
| `campaign-send-batch` | `public.campaign_recipients` | **N/A** | **YES** | `'sent'` |

*Note:* `campaign-send-batch` logs to `campaign_recipients` and `lead_activities` (`activity_type: 'campaign_sent'`), but does NOT insert rows into `public.outbound_messages`.

### 12.2 Inbound Matching Architecture
Located in RPC `ingest_inbound_message_transaction` (`00030_create_conversational_crm.sql`):
1. **Priority 1 (Header Threading):**
   * Inspects `In-Reply-To` and `References`.
   * Matches `om.provider_message_id = trim(p_in_reply_to)` or `om.idempotency_key = trim(p_in_reply_to)`.
   * If matched, verifies that sender email matches lead. If sender mismatch is detected, sets `v_is_conflict = true` (`HEADER_SENDER_MISMATCH`).
2. **Priority 2 (Normalized Email Matching):**
   * Queries `public.leads` where `lower(email) = lower(trim(p_from_address))`.
   * If exactly 1 match: lead matched.
   * If > 1 match: sets `v_is_conflict = true` (`AMBIGUOUS_EMAIL_MATCH`).
3. **Conversation Linking:**
   * If existing email conversation with matching `external_thread_id` exists, links message to that conversation.
   * Otherwise, creates a new `conversations` record with `channel = 'email'` and `external_thread_id = COALESCE(p_provider_thread_id, p_in_reply_to, p_provider_message_id)`.
4. **Audit & Downstream Updates:**
   * Updates `leads.last_response_at = now()`.
   * Evaluates `stop_on_response` for active sequences/automations and automatically stops them with reason `Lead replied to message`.

---

## 13. Message States & UI Truthfulness (Zero Fake States)

### 13.1 Current UI Implementation
Inspected in `src/features/inbox/ConversationThread.tsx` (Lines 307–328):
* Outbound status badges display **strictly factual** single-check states:
  * `msg.status === 'sent'` $\rightarrow$ **"Enviado"**
  * `msg.status === 'pending'` or `'queued'` $\rightarrow$ **"Na fila"**
  * `msg.status === 'failed'` $\rightarrow$ **"Falha"**
* **Zero Fake States:** The codebase **strictly excludes** fictitious states (`Opened`, `Read`, `Seen`, `Aberto`, `Lido`). Tests in `src/__tests__/batch3-client-ux.test.ts` line 153 explicitly verify this constraint.
* **Future State Extension:** Once real provider webhooks exist, `delivered` $\rightarrow$ "Entregue" and `bounced` $\rightarrow$ "Falha na entrega / Bounce" can be added.

---

## 14. Bounce Handling

* **Current Status:** **NOT IMPLEMENTED (GAP).**
* Currently, if an outbound email bounces:
  1. No webhook catches the bounce.
  2. The database maintains `status = 'sent'`.
  3. No flag is set on `public.leads`.
* **Required Behavior for Production:**
  * Webhook receives `email.bounced`.
  * Update `outbound_messages.status = 'failed'` (or `'bounced'`).
  * If bounce is **hard bounce** (e.g., mailbox does not exist):
    * Record factual bounce event in `lead_activities`.
    * Mark lead email as invalid / hard-bounced in suppression table.
    * Prevent further automated email dispatches from campaigns and sequences.

---

## 15. Complaint / Spam Handling

* **Current Status:** **NOT IMPLEMENTED (GAP).**
* If a recipient marks an email as spam in Gmail/Yahoo:
  1. Resend emits `email.complained`.
  2. No handler currently exists in EDS HUB to receive or process this event.
* **Required Behavior for Production:**
  * Immediately suppress the email address from all marketing campaigns, automated workflows, and follow-up sequences.
  * Record a critical warning in `lead_activities`.

---

## 16. Unsubscribe, Consent, & Legal Compliance

### 16.1 Existing Model
* `public.leads.contact_preference`: `'email' | 'sms' | 'call'`.
* This controls primary channel preference across lead intake and automations.

### 16.2 Missing Marketing Unsubscribe Infrastructure
* **No `is_unsubscribed` / `unsubscribed_at` column** exists on `public.leads`.
* **No `email_suppressions` table** exists.
* **No one-click unsubscribe header or link** is injected into outbound marketing campaigns (`campaign-send-batch`).
* **Compliance Gap:** Under CAN-SPAM and international standards, bulk marketing emails must include an unsubscribe mechanism and honor opt-outs.

---

## 17. Website Lead Rule & Isolation Guarantee

### 17.1 Canonical Business Rule
> **Website Form Lead:** Submissions on `expdentalsolutions.com/register` must **NEVER receive an automated first email response**. They require personal manual client review.

### 17.2 Code Audit Results
1. **In `supabase/functions/process-lead-intake/index.ts` (Lines 233–248):**
   ```ts
   const isWebsiteLead = payload.source === 'form' || payload.source_detail === 'website';
   if (isWebsiteLead) {
     // Suppresses automated first-contact outreach per business rule
     await db.from('lead_activities').insert({ ... summary: 'Website lead intake received. Automated first-contact outreach is suppressed...' });
     actionSucceeded = true;
   }
   ```
   **Protection is active and working.** Direct intake outreach is suppressed.
2. **In `supabase/functions/_shared/automation-evaluator.ts` (Lines 165–171):**
   ```ts
   if (context?.isInitialOutreach) {
     if (context.source === 'form' || context.source_detail === 'website') {
       return { allowed: false, skip_reason_code: 'WEBSITE_INITIAL_OUTREACH_SUPPRESSED', ... };
     }
   }
   ```
   *Guard logic exists in the evaluator.*
3. **CRITICAL DEFENSE AUDIT — Parameter Passing Gap in `execute-automation-run`:**
   In `supabase/functions/execute-automation-run/index.ts` (Line 448):
   ```ts
   const prefCheck = checkContactPreference(action, lead.contact_preference);
   ```
   Notice that `context` (`{ isInitialOutreach, source, source_detail }`) is **not passed** into `checkContactPreference`!
   *Implication:* If an administrator creates and publishes an automation triggered by `lead_created` with a `send_email` action, the engine would not suppress it based on source because `context` was omitted at line 448.
   *Safeguard currently protecting this:* No automations are currently active or published in the database.
   *Remediation Required:* Line 448 must pass the lead context before automations are enabled.

---

## 18. Meta / Instagram Lead Future Flow

* **Canonical Rule:** When Meta advertising leads are captured, initial outreach should attempt **both Email and SMS** if valid email and phone exist.
* **Current Status:** Logic is present in `process-lead-intake/index.ts` (lines 261–280), but Meta webhooks and live ingestion are currently inactive.
* **Production Status:** Resend audit confirms email sending logic for Meta leads can function once providers are live.

---

## 19. Historical Data & Bulk Import Safety

### 19.1 HubSpot & CSV Import Protections
Audited in `00051_hubspot_import_automation_suppression.sql` and `process-lead-intake/index.ts`:
1. `source_detail IN ('hubspot_sync', 'hubspot_historical', 'csv_import')` strictly suppresses automatic outreach in `process-lead-intake`.
2. Database trigger `trg_capture_lead_created_event()` checks `current_setting('app.sync_origin')` and skips inserting `automation_events` during HubSpot sync, reconciliation, and CSV import.
3. Test leads (`source = 'test'`) are skipped from event generation.

*Verdict:* Historical imports and existing contacts are safely protected from sudden automated email dispatch upon provider activation.

---

## 20. Campaigns Architecture & Compatibility

* **Draft & Preview without Provider:** Supported. Campaign versions, variants, and audience definitions can be edited, previewed, and tested without live Resend sending.
* **Recipient Snapshot:** `campaign-prepare` snapshots eligible leads into `public.campaign_recipients` in `'pending'` status with deduplication on `lower(trim(email))`.
* **Execution Path:** `campaign-send-batch` processes batches of 20–50 recipients sequentially.
* **Gaps:**
  1. No automatic unsubscribe link injection in HTML.
  2. `campaign_recipients` status only supports `'pending'`, `'sent'`, `'failed'`, `'skipped'` (no `'bounced'`).
  3. No throttling delay between recipients within a batch.

---

## 21. Automations Engine & Email Execution Path

* **Action Config:** Action step `send_email` extracts `step.config.subject` and `step.config.body`.
* **Published Versions Frozen:** Automation steps are versioned; edits create new draft versions while the running version remains immutable.
* **Provider Unconfigured Safeguard:** If `RESEND_API_KEY` is missing, `sendEmail` returns `errorCode: 'CONFIG_ERROR'`, and the run step transitions to `'failed'` without crashing the worker.
* **Historical Reprocessing Safeguard:** Runs use deterministic idempotency keys (`auto_msg:<runId>:<stepOrder>:email`). If `existingMsg.status === 'sent'` or `existingMsg.provider_message_id` is present, the engine reconciles and skips without resending.

---

## 22. Sequences Engine & Cadence Controls

* Sequences are modeled as `automations` with `automation_type = 'sequence'`.
* **Cadence & Wait Steps:** Wait steps create `automation_jobs` with `scheduled_at = now() + delay`.
* **Execution Runner:** `process-automation-queue` claims due jobs atomically via `claim_automation_jobs` (Postgres `FOR UPDATE SKIP LOCKED`).
* **Stop Conditions:** Evaluated at every event (`qualification_status_changed`, `pipeline_stage_changed`, inbound reply). If a stop condition triggers, pending jobs are cancelled and the sequence is marked `stopped_by_condition`.
* **Current Status:** Inactive; no active sequence jobs currently queued.

---

## 23. Manual Email Behavior

* **Lead Detail Quick Action (`LeadDetailPage.tsx`):**
  Uses native `mailto:<lead.email>` deep link. It opens the user's desktop/browser email client. It does **not** call Resend or create an `outbound_messages` row.
* **Conversational Inbox Composer (`InboxPage.tsx` / `ConversationComposer.tsx`):**
  Internal composer calls `send-conversation-message` Edge Function, which dispatches via Resend, inserts into `outbound_messages` with `is_manual_reply: true`, and links to `conversations`.

---

## 24. Email Template System & Compatibility

Audited across `00017_create_email_templates.sql` and `TemplateEditorModal.tsx`:
* **Channels:** Email and SMS templates are strictly separated.
* **Storage:**
  * `content_json`: Visual block editor model (headings, paragraphs, buttons, spacers, dividers).
  * `html_template`: Rendered static HTML with variable tokens.
  * `text_template`: Plain text representation.
* **Supported Personalization Tokens:**
  * `{{salutation}}` $\rightarrow$ Resolves via `resolveSalutation(lastName, firstName, 'Doc')`
  * `{{first_name}}` $\rightarrow$ Lead first name
  * `{{last_name}}` $\rightarrow$ Lead last name
* **Compatibility with Resend:** Rendered HTML snapshots from the visual editor are completely standard inline-styled HTML and fully compatible with Resend's HTML parser.

---

## 25. Variable Rendering Safety & HTML Injection Risk

### 25.1 Missing Variable Fallback
* `resolveSalutation` gracefully defaults to `'Doc'` if both first and last name are empty or whitespace.
* `first_name` and `last_name` default to empty strings `''`.

### 25.2 HTML Injection Risk
* **Audit Finding:** In `campaign-send-batch` and `execute-automation-run`, variables are substituted via raw string `.replace()`:
  ```ts
  html = html.replace(/\{\{\s*first_name\s*\}\}/gi, firstName);
  ```
* Because `firstName` is not HTML-escaped, if a contact registers with special HTML characters (e.g., `<script>`, `<b>`, `&`), those characters would be injected directly into the email HTML body.
* **Recommendation:** Implement standard HTML entity encoding for all user-supplied variables before rendering into HTML.

---

## 26. Email Footer, Branding, & Physical Address

> [!IMPORTANT]
> **BUSINESS PHYSICAL ADDRESS: HUMAN INPUT REQUIRED**

* **CAN-SPAM & Deliverability Requirement:** A valid physical postal address of the sender is legally required at the bottom of all commercial/marketing emails.
* **Repository Check:** The repository contains references to `'Orlando, FL'` for course locations, but does **NOT** contain the official street address, suite number, or postal code for Expert Dental Solutions.
* **Action Required:** Client must provide their official business mailing address to be embedded into campaign template footers.

---

## 27. Transactional vs. Marketing Classification

| Category | Email Types | Unsubscribe Required? | Channel Preference Checked? |
| :--- | :--- | :---: | :---: |
| **Transactional / Operational** | Inbound reply confirmation, course confirmation, password resets, direct manual CRM messages | No (essential communication) | No (direct 1-on-1 contact) |
| **Automated Workflows** | Post-enrollment instructions, task follow-ups | Recommended | Yes (`contact_preference`) |
| **Marketing Campaigns** | Promotional announcements, course session launches, newsletters | **YES (Strictly Mandatory)** | Yes |

---

## 28. Rate Limiting, Throttling, & Concurrency Control

* **Resend Account Limits:** Typically 2 emails/sec on free tier, 10+ emails/sec on paid tiers.
* **Current Code Limits:**
  * `campaign-send-batch` clamps batch size to maximum 50 recipients.
  * However, within the batch loop, emails are sent sequentially in a tight `for...of` loop with **no sleep delay**.
  * Sending 50 emails in rapid succession on an un-warmed or standard Resend plan risks triggering `HTTP 429 Too Many Requests`.
* **Recommendation:**
  * Add a 100ms–200ms delay between sends in `campaign-send-batch`.
  * Add HTTP 429 rate limit retry handling with `Retry-After` backoff in `_shared/resend-adapter.ts`.

---

## 29. Provider ID & Status Persistence Schema Gaps

### 29.1 Current `public.outbound_messages` Schema
* `status` is restricted by:
  ```sql
  CHECK (status IN ('pending', 'sent', 'failed'))
  ```
* **Gaps:**
  * No `'delivered'`, `'bounced'`, or `'complained'` allowed by the CHECK constraint.
  * No `delivered_at`, `bounced_at`, or `complained_at` timestamp columns.
  * No `provider_status` or raw provider payload storage.

### 29.2 Current `public.campaign_recipients` Schema
* `status` is restricted by:
  ```sql
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
  ```
* **Gaps:**
  * No `'delivered'` or `'bounced'` status allowed.

---

## 30. Idempotency Key Auditing Across Call Sites

| Call Site | Idempotency Key Format | Stability & Reusability |
| :--- | :--- | :--- |
| `campaign-send-batch` | `campaign:<campaign_id>:<recipient_id>` | **Deterministic & Stable.** Prevents duplicate sends on network retry. |
| `execute-automation-run` | `auto_msg:<run_id>:<step_order>:email` | **Deterministic & Stable.** Checked prior to sending. |
| `process-lead-intake` | `<intake_event_id>:email:<recipient>` | **Deterministic & Stable.** Checked prior to sending. |
| `campaign-test-send` | `test-send:<campaign_id>:<timestamp>` | Ephemeral for previews. |
| `send-conversation-message` | `manual_msg:<lead_id>:<timestamp>:<uuid>` | Generated per request. Client-side retry could generate new key if not guarded. |

---

## 31. Error Logging Privacy & PII Protection

* `_shared/resend-adapter.ts` lines 58–64 explicitly avoids logging API keys and truncates response error strings to 200 characters.
* Headers containing Bearer tokens are not dumped to console logs.
* Error objects returned to frontend clients omit internal infrastructure details.

---

## 32. Inbound Email Flow & MX Conflict Analysis

### 32.1 How Inbound Reaches EDS HUB
1. External recipient replies to an email.
2. If MX points to Resend, Resend processes the incoming SMTP message.
3. Resend triggers a webhook POST to `https://<project-ref>.supabase.co/functions/v1/inbound-email-webhook`.
4. The webhook verifies Svix signature headers, extracts email headers (`In-Reply-To`, `References`), and executes `ingest_inbound_message_transaction`.

### 32.2 Root MX Conflict Danger
* If the root domain `expdentalsolutions.com` MX is altered to point to Resend, **all existing company mailboxes (e.g., info@, support@, admin@) hosted on Google Workspace or Microsoft 365 will immediately cease functioning.**

---

## 33. Reply-To Strategy Evaluation

### Option Comparison

| Option | Architecture | Pros | Cons / Risks | Recommendation |
| :--- | :--- | :--- | :--- | :---: |
| **Option A** | **Replies go directly to real mailbox (`info@expdentalsolutions.com`)** | **Zero risk** to existing mail hosting. Zero DNS MX changes. Clinic staff read replies in normal Outlook/Gmail. | Replies do not appear inside EDS HUB Conversational Inbox. | **RECOMMENDED FOR PHASE 1** |
| **Option B** | **Subdomain Inbound Route (`reply.expdentalsolutions.com`)** | Inbound emails route to EDS HUB without touching root MX. Zero risk to existing `info@` mailbox. | Requires setting up subdomain MX records in DNS (`reply.expdentalsolutions.com`). | **RECOMMENDED FOR PHASE 2** |
| **Option C** | **Replace Root Domain MX with Resend** | Single address for sending and receiving. | **CATASTROPHIC RISK.** Destroys existing company mail hosting. | **STRICTLY FORBIDDEN** |

*Phase 1 Strategy:* Set `Reply-To: info@expdentalsolutions.com`. Keep existing mail hosting 100% untouched.

---

## 34. Proposed Production Activation Sequence

1. **Human Audit:** Human administrator inspects existing DNS MX records and confirms existing mail hosting provider.
2. **Resend Domain Setup:** Add `expdentalsolutions.com` to Resend dashboard as a sending domain.
3. **DNS Configuration:**
   * Merge `include:resend.com` into existing SPF record.
   * Add Resend DKIM CNAME records.
   * Add conservative DMARC `p=none` record.
   * **Leave MX records unchanged.**
4. **Domain Verification:** Confirm domain status changes to "Verified" in Resend dashboard.
5. **Secret Configuration:** Set Supabase Edge Function secrets via CLI:
   * `RESEND_API_KEY`
   * `RESEND_FROM_EMAIL=info@expdentalsolutions.com`
6. **Code Action (Migration 00059):** Apply Migration 00059 for delivery status tracking and suppression.
7. **Code Action (Webhooks):** Implement and deploy Resend delivery event webhook.
8. **Controlled Test Send:** Send a single test email to an internal staff address via `campaign-test-send` or admin script.
9. **Event Verification:** Confirm delivery event is received and logged in database.
10. **Enable Manual CRM Sending:** Activate 1-on-1 replies in Conversational Inbox.
11. **Harden Automation Evaluator:** Pass lead context into `checkContactPreference` in `execute-automation-run`.
12. **Enable Automations:** Publish vetted automation workflows.
13. **Enable Campaigns:** Allow marketing campaign execution with mandatory unsubscribe links.

---

## 35. Division of Responsibilities

### Human / Dashboard Actions
* Check current MX / mail provider in DNS.
* Create and manage Resend account.
* Add domain `expdentalsolutions.com` in Resend.
* Configure DNS records (SPF merge, DKIM CNAMEs, DMARC TXT) in DNS registrar/host.
* Generate production Resend API Key.
* Configure Supabase Edge Function secrets (`supabase secrets set`).
* Configure Resend Webhook in Resend dashboard.
* Provide official business physical mailing address.

### Code Actions
* Update fallback sender addresses to `info@expdentalsolutions.com`.
* Pass lead context to `checkContactPreference` in `execute-automation-run`.
* Implement Resend delivery lifecycle webhook endpoint.
* Apply Migration 00059 (delivery columns, event logs, suppressions).
* Add HTML entity escaping for template variables.
* Add throttling delay in `campaign-send-batch`.
* Embed standard CAN-SPAM footer in marketing campaigns.

---

## 36. Proposed Migration 00059 Specification

> [!NOTE]
> **PROPOSAL ONLY — NOT CREATED OR APPLIED IN BATCH 7.1**

```sql
-- Migration 00059: Email Delivery Lifecycle, Event Logging & Suppressions (PROPOSAL ONLY)

-- 1. Expand outbound_messages status constraint
ALTER TABLE public.outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_status_check;

ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'complained'));

-- 2. Add delivery timestamps to outbound_messages
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS provider_status TEXT NULL;

-- 3. Create email_suppressions table
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL UNIQUE,
  reason              TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'unsubscribe', 'manual')),
  source_message_id   TEXT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email ON public.email_suppressions(email);

-- 4. Create email_provider_event_logs table
CREATE TABLE IF NOT EXISTS public.email_provider_event_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL DEFAULT 'resend',
  event_type          TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  recipient           TEXT NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_msg_id 
  ON public.email_provider_event_logs(provider_message_id);
```

---

## 37. Final Audit Checklist

| Item | Result |
| :--- | :---: |
| **Resend adapter implemented** | **YES** |
| **Live Resend API call exists** | **YES** |
| **Resend secrets configured** | **YES (local) / UNKNOWN (remote)** |
| **Sender currently configured** | **NO** (needs update from `no-reply`/`team` to `info@expdentalsolutions.com`) |
| **Domain verified** | **UNKNOWN** (requires live human check in Resend dashboard) |
| **Delivery event webhook implemented** | **NO** |
| **Inbound email webhook implemented** | **YES** |
| **Svix verification implemented** | **YES** |
| **Provider message ID persisted** | **YES** |
| **Bounce persisted** | **NO** |
| **Complaint persisted** | **NO** |
| **Email opt-out enforced** | **PARTIAL** (`contact_preference` only; no marketing unsubscribe) |
| **Historical imports protected** | **YES** |
| **Website leads protected from automatic first response** | **YES** |
| **Meta first-contact inactive** | **YES** |
| **Campaign sending inactive** | **YES** |
| **Automation provider sending inactive** | **YES** |
| **Sequence provider sending inactive** | **YES** |
| **Manual email uses mailto** | **YES** (on Lead Profile) |
| **Migration required** | **YES** (Migration 00059 proposed) |

---
**BATCH 7.1 AUDIT READY FOR REVIEW**
