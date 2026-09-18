# EDS HUB — Canonical Reporting & Analytics Metrics Dictionary

**Document Version**: Phase 5 Block 2 (1.0)  
**Last Updated**: 2026-09-17  
**Scope**: Unified Executive Analytics, Cohort Funnels, Financial Integrity, and Lifecycle Intelligence  
**Canonical Timezone**: `app_settings.timezone` (Default: `'America/New_York'`)  
**Period Semantics**: Semi-open interval `[start_at, end_at)` calculated server-side in PostgreSQL.

---

## 1. Core Principles & Conventions

1. **Source of Truth Driven**: All business intelligence metrics are calculated server-side via PostgreSQL domain aggregators. The frontend client never derives or synthesizes business KPIs independently.
2. **Period vs. Snapshot Demarcation**:
   - **Period Metrics**: Represent flow events occurring within `[start_at, end_at)` (e.g. leads captured, cash received, enrollments confirmed).
   - **Snapshot Metrics**: Represent current state of the database at query execution time (e.g. current pipeline distribution, current outstanding balance, current hot leads).
3. **Safe Division & Null Handling**:
   - Ratios with a denominator of 0 evaluate to `NULL` (rendered as `"No data"` or `"—"` in the UI, never misleading `0%` or `NaN`).
   - Real zero counts and balances evaluate to numeric `0` or `$0.00`.
4. **Comparison Semantics**:
   - When comparing Current Period vs Previous Equivalent Period:
     $$\Delta\% = \frac{\text{Current} - \text{Previous}}{|\text{Previous}|} \times 100$$
   - If $\text{Previous} = 0$, `percent_change` is `NULL` and `comparison_status` is `"new"`.
   - Snapshot metrics are never compared against prior periods as if they were flow events.
5. **Test Data Policy**:
   - Leads, enrollments, and payments with `source = 'test'` (or tied to test leads) are **excluded by default** (`p_include_test = false`).
   - Setting `p_include_test = true` explicitly includes test data for audit or staging verification.
6. **Multi-Currency Safety**:
   - All financial aggregations group or filter by `currency = 'USD'`. Mixed FX summation is strictly forbidden.

---

## 2. Metric Specifications

### 2.1 Leads Created
- **Source of Truth**: `public.leads.created_at`
- **Metric Type**: Period
- **Date Field Used**: `created_at` in `[start_at, end_at)`
- **Formula**: `COUNT(id) WHERE (source != 'test' OR p_include_test = true)`
- **Numerator / Denominator**: N/A (Count)
- **Null Behavior**: Returns `0` if no leads were created.
- **Comparison**: Supported vs. previous period.

### 2.2 Reached Qualification Stage
- **Source of Truth**: `public.leads` + `public.lead_stage_history`
- **Metric Type**: Period (Cohort)
- **Date Field Used**: `l.created_at` in `[start_at, end_at)`
- **Formula**: Count of cohort leads that transitioned into `qualification` (`to_stage_id = v_stage_qual_id`) or currently hold qualification or later stages (`sort_order >= 2`).
- **Numerator / Denominator**: N/A (Count)
- **Null Behavior**: Returns `0` if none reached stage.
- **Comparison**: Supported vs. previous period cohort.

### 2.3 Commercial Funnel Reached Stages & Conversion Rates
- **Source of Truth**: `public.leads` + `public.lead_stage_history`
- **Stages**: `capture` (1) $\to$ `qualification` (2) $\to$ `acquisition` (3) $\to$ `approval` (4) $\to$ `enrollment` (5)
- **Cohort Base**: All distinct leads created within `[start_at, end_at)`.
- **Reached Stage Formula**: Lead from cohort having stage history entry for stage OR current stage order $\ge$ target stage order OR active confirmed enrollment.
- **Conversion From Previous**:
  $$\text{Conversion Rate} = \frac{\text{Reached Current Stage}}{\text{Reached Previous Stage}} \times 100$$
- **Conversion From Cohort**:
  $$\text{Cohort Conversion Rate} = \frac{\text{Reached Current Stage}}{\text{Total Cohort Leads}} \times 100$$
- **Null Behavior**: Returns `NULL` if denominator is 0.

### 2.4 Confirmed Enrollments (in Period)
- **Source of Truth**: `public.enrollments` + `public.enrollment_history`
- **Metric Type**: Period
- **Date Field Used**: Canonical Confirmation Timestamp `confirmed_at` (derived from earliest `enrollment_history` entry with `status = 'confirmed'`, fallback to `(enrollment_date 00:00:00)` in org timezone).
- **Formula**: `COUNT(id) WHERE enrollment_status = 'confirmed' AND confirmed_at >= start_at AND confirmed_at < end_at`
- **Null Behavior**: Returns `0`.

### 2.5 New vs. Repeat Student Enrollments
- **Source of Truth**: `public.enrollments` partitioned by `lead_id` ordered by `confirmed_at ASC, id ASC`.
- **Metric Type**: Period
- **Definitions**:
  - **New Student Enrollment**: The lead's 1st historical confirmed enrollment (`student_enrollment_order = 1`).
  - **Repeat Student Enrollment**: Any subsequent confirmed enrollment (`student_enrollment_order > 1`).
- **Repeat Rate Formula**:
  $$\text{Repeat Rate} = \frac{\text{Repeat Enrollments in Period}}{\text{Total Confirmed Enrollments in Period}} \times 100$$
- **Null Behavior**: Returns `NULL` if total confirmed enrollments in period = 0.

### 2.6 Gross Collected Revenue
- **Source of Truth**: `public.enrollment_payments` (Reconciles 1:1 with Block 3)
- **Metric Type**: Period
- **Date Field Used**: `payment_date` in `[start_date, end_date]`
- **Formula**:
  $$\text{Gross Collected} = \sum \text{amount} \quad \text{WHERE payment\_status = 'paid' AND payment\_type = 'payment' AND currency = 'USD'}$$
- **Null Behavior**: Returns `0.00`.

### 2.7 Refunded Amount
- **Source of Truth**: `public.enrollment_payments` (Reconciles 1:1 with Block 3)
- **Metric Type**: Period
- **Date Field Used**: `payment_date` in `[start_date, end_date]`
- **Formula**:
  $$\text{Refunded Amount} = \sum \text{amount} \quad \text{WHERE (payment\_type = 'refund' OR payment\_status = 'refunded') AND currency = 'USD'}$$
- **Null Behavior**: Returns `0.00`.

### 2.8 Net Revenue
- **Source of Truth**: Server-side arithmetic (Reconciles 1:1 with Block 3)
- **Metric Type**: Period
- **Formula**: $\text{Net Revenue} = \text{Gross Collected} - \text{Refunded Amount}$
- **Null Behavior**: Returns `0.00`.

### 2.9 Booked / Contracted Revenue
- **Source of Truth**: `public.enrollments.agreed_amount` (USD)
- **Metric Type**: Period
- **Date Field Used**: Canonical `confirmed_at` / `enrollment_date` in `[start_date, end_date]`
- **Formula**: $\sum \text{agreed\_amount} \quad \text{WHERE enrollment\_status = 'confirmed'}$
- **Strict Labeling Rule**: Labeled exclusively as "Booked Revenue" or "Contracted Amount". Never labeled as collected revenue.

### 2.10 Current Outstanding Balance
- **Source of Truth**: `public.enrollments` + `public.enrollment_payments` (Reconciles 1:1 with Block 3)
- **Metric Type**: **Snapshot** (Never filtered by report date range)
- **Formula**:
  $$\text{Outstanding Balance} = \sum \max(\text{agreed\_amount} - \text{net\_paid}, 0) \quad \text{WHERE enrollment\_status = 'confirmed'}$$
  where $\text{net\_paid} = \text{Gross Paid} - \text{Refunds}$ for that enrollment.
- **Comparison Rule**: Snapshot metric; comparison percent change is disabled (`not_applicable`).

### 2.11 Course Attendance Rate
- **Source of Truth**: `public.course_participations` (Reconciles 1:1 with Block 4)
- **Metric Type**: Period / Session
- **Formula**:
  $$\text{Attendance Rate} = \frac{\text{COUNT(attended)}}{\text{COUNT(attended)} + \text{COUNT(no\_show)}} \times 100$$
  *Excludes `expected` and `cancelled`.*
- **Null Behavior**: Returns `NULL` if denominator is 0.

### 2.12 Course Completion Rate
- **Source of Truth**: `public.course_participations` (Reconciles 1:1 with Block 4)
- **Metric Type**: Period / Session
- **Formula**:
  $$\text{Completion Rate} = \frac{\text{COUNT(completed)}}{\text{COUNT(completed)} + \text{COUNT(incomplete)}} \times 100$$
  *Excludes `not_started`.*
- **Null Behavior**: Returns `NULL` if denominator is 0.

### 2.13 Reply Rate
- **Source of Truth**: `public.outbound_messages` + `public.inbound_messages` (Reconciles 1:1 with Block 2)
- **Metric Type**: Period
- **Denominator**: Distinct leads sent qualifying outbound email/sms messages in period (`status = 'sent'`).
- **Numerator**: Distinct leads replying with processed inbound message in period *after* outbound send timestamp.
- **Formula**: $\frac{\text{Numerator}}{\text{Denominator}} \times 100$.
- **Null Behavior**: Returns `NULL` if denominator is 0.

### 2.14 First Response Time (FRT)
- **Source of Truth**: `public.outbound_messages` $\to$ `public.inbound_messages`
- **Metric Type**: Period
- **Formula**: Elapsed seconds between lead's first qualifying sent outbound message and their first qualifying subsequent inbound message.
- **Aggregations**: Both Average (Mean) and Median (50th percentile) seconds returned. Leads with no response are excluded from the FRT calculation.

### 2.15 Post-Course Follow-Up Completion Rate
- **Source of Truth**: `public.post_course_engagements` (Reconciles 1:1 with Block 5)
- **Metric Type**: Cohort / Period
- **Formula**: $\frac{\text{followups\_completed}}{\text{followups\_due}} \times 100$ where `followup_status IN ('completed', 'pending')`.
- **Null Behavior**: Returns `NULL` if denominator is 0.

### 2.16 Feedback & Testimonial Response Rates
- **Source of Truth**: `public.post_course_engagements` (Reconciles 1:1 with Block 5)
- **Metric Type**: Snapshot / Cumulative
- **Feedback Rate**: $\frac{\text{feedback\_received}}{\text{feedback\_requested}} \times 100$.
- **Testimonial Rate**: $\frac{\text{testimonial\_received}}{\text{testimonial\_requested}} \times 100$.
- **Null Behavior**: Returns `NULL` if requests count = 0.
