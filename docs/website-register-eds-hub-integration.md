# Integration Guide — EDS Website Registration Form → EDS HUB
## Complete & Incomplete Form Intent Synchronization

This document specifies the integration between the public website registration form at `https://expdentalsolutions.com/register` and the **EDS HUB CRM**.

---

## 1. Architecture Overview

The integration captures prospective student intent across two distinct lifecycle events:

1. **EVENT A: INCOMPLETE INTENT (`capture-incomplete-enrollment`)**:
   - Sent when a visitor enters identifiable contact info (`name`, `email` or `phone`) and selects a `course`.
   - Captures abandoned registration intent without waiting for tab close or abandonment timers.
   - Status: `needs_followup`. Creates/matches the CRM lead in `Novo Lead` (`capture`), allocates course interest, and creates a follow-up task.
2. **EVENT B: COMPLETED APPLICATION (`submit-public-form`)**:
   - Sent **only after** the website form confirms successful submission (`result.status === 200 && result.body.success`).
   - Status: `form_completed`. Atomically reconciles the matching `needs_followup` attempt, cancels only the specifically linked follow-up task, logs application completion, populates `resolved_form_submission_id`, leaves `resolved_enrollment_id` `NULL`, and preserves the existing CRM lead stage.
3. **EVENT C: LATER ENROLLMENT CONFIRMATION (Database Trigger)**:
   - When an operator or registrar confirms enrollment in `public.enrollments`:
   - Transitions matching attempts in `needs_followup` OR `form_completed` to `recovered`.
   - Populates `resolved_enrollment_id`, preserves `resolved_form_submission_id` for historical lineage, and completes pending tasks.

---

## 2. Privacy & Data Exclusions (STRICT)

> [!CAUTION]
> **PROHIBITED DATA — NEVER TRANSMIT TO EDS HUB**
> To comply with privacy, HIPAA, and medical compliance standards, the following fields **MUST REMAIN EXCLUSIVELY ON THE WEBSITE BACKEND**:
> - `medical_conditions`: Protected health/medical information. **PROHIBITED**.
> - `dietary`: Food allergies, dietary restrictions, and health data. **PROHIBITED**.
> - `passport`: Document upload binary or file URL. **PROHIBITED**.
> - `dental_license`: Professional license document upload binary or file URL. **PROHIBITED**.
> - `email_confirmation`: Client-side form validation helper. **EXCLUDED**.
> - `emergency_phone`: Course clinic logistics; prohibited for lead matching. **EXCLUDED**.
> - `certificate_name`: Course certificate print name. **EXCLUDED**.
> - `coat_size`: Clinic apparel size. **EXCLUDED**.
> - `signature`: Legal signature copy/canvas. **PROHIBITED**.
> - `raw FormData`: Multipart/binary payload. **PROHIBITED**.

---

## 3. Approved Whitelist Fields Contract

### A. CRM CONTACT / APPLICATION FIELDS (Forms Engine Whitelist)

The canonical `website-register` form in EDS HUB version 1 defines only these safe fields:

| Field Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` / `first_name` | `first_name` | Yes | Student first name (or full name parsed) |
| `last_name` | `last_name` | No | Student surname (conservative multi-token preservation) |
| `email` | `email` | Yes | Email address (normalized lowercase) |
| `phone` | `phone` | Yes | Mobile phone (normalized E.164) |
| `course` | `course_interest` | Yes | Course selected from dropdown |
| `specialty` | `select` | No | Dental specialty (e.g., General Practitioner, Periodontist) |
| `years_in_practice` | `select` | No | Professional experience bracket |
| `surgical_experience` | `select` | No | Surgical experience level |
| `agd_number` | `text` | No | AGD / PACE accreditation ID |
| `heard_from` | `select` | No | Marketing attribution source |
| `referral_name` | `text` | No | Name of referring colleague |
| `promo_code` | `text` | No | Campaign / discount promo code |
| `terms_accepted` | `checkbox` | No | Sent as `true` ONLY on completed submission |

### B. INTEGRATION / ATTRIBUTION METADATA (Edge Function / RPC Technical Parameters)

Technical metadata is handled via Edge Function / RPC parameters and is NOT created as visible form fields:

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `external_attempt_id` | string | Recommended | Stable session attempt ID linking incomplete intent to completed submission |
| `idempotency_key` | string | Yes | Unique UUID per HTTP request to prevent duplicate processing |
| `source_page` | string | Optional | URL origin + pathname (query params and hash stripped) |
| `utm_source` | string | Optional | UTM marketing campaign source |
| `utm_medium` | string | Optional | UTM marketing medium |
| `utm_campaign` | string | Optional | UTM marketing campaign name |
| `utm_term` | string | Optional | UTM marketing search term |
| `utm_content` | string | Optional | UTM marketing ad content |

---

## 4. Name Parsing Rule (Conservative Splitting)

The live registration form has a single `<input name="name">` field.
To prevent damaging multi-part surnames (e.g. "Maria da Silva Santos", "Jean-Pierre Van Der Bellen"):
- `first_name` = first whitespace-delimited token ("Maria")
- `last_name` = all remaining tokens preserved intact ("da Silva Santos")
- If the visitor enters a single name, `first_name` receives the value, and `last_name` is empty string.
- The original `name` string is preserved inside `submitted_data` JSONB.

---

## 5. Course Field Mapping & Session Reality

### Audit of Live Website Course Options
The live form at `https://expdentalsolutions.com/register` uses a single `<select name="course">`. The options embed course title, session dates, and tuition:

1. `"Dental Implant Intensive Course - November 11-14, 2026 | Tuition: $9,400"`
2. `"Advanced Bone Grafting & Sinus Lift - December 02-05, 2026 | Tuition: $9,800"`
3. `"Zygomatic & Pterygoid Implants - January 20-23, 2027 | Tuition: $11,500"`
4. `"Full Arch Immediate Loading - February 17-20, 2027 | Tuition: $10,200"`

### Deterministic Course Mapping Table

| Website Option (Exact Prefix) | EDS HUB `courses.code` | EDS HUB Canonical Course Name |
| :--- | :--- | :--- |
| `Dental Implant Intensive Course` | `IDIT-01` | Intensive Dental Implant Training |
| `Advanced Bone Grafting & Sinus Lift` | `ADIE-01` | Advanced Dental Implant Experience |
| `Zygomatic & Pterygoid Implants` | `ZIT-01` | Zygomatic Implant Training |
| `Full Arch Immediate Loading` | `AIRE-01` | Advanced Implant Rehabilitation Experience |

### Session Field Reality
- **Session Dropdown**: The live website form **does NOT** contain an independent session/turma selector. Dates are embedded directly in the course option text.
- **`course_session_id` Handling**: In the incomplete capture endpoint, `course_session_id` remains `NULL` unless factual session mapping exists.
- **In Completed Form Submission**: `fields.course` is stored as `course_interest` text on the lead and in `form_submissions.course_interest`.

---

## 6. Journey Identifier (`external_attempt_id`)

Generate a single session attempt ID on the client and persist it in `sessionStorage`. Reuse this exact ID for both Event A and Event B:

```javascript
function getOrCreateAttemptId() {
  let attemptId = sessionStorage.getItem('eds_form_attempt_id');
  if (!attemptId) {
    attemptId = 'reg_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).substring(2, 9)));
    sessionStorage.setItem('eds_form_attempt_id', attemptId);
  }
  return attemptId;
}
```

---

## 7. Event A: Incomplete Intent Implementation (Client Script)

Attach a debounced listener on the registration form fields (`name`, `email`, `phone`, `course`). When identifiable contact info and a course are present, dispatch Event A:

```javascript
const EDS_HUB_URL = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1';

// Deterministic course code mapping
const COURSE_CODE_MAP = {
  'dental implant intensive': 'IDIT-01',
  'advanced bone grafting': 'ADIE-01',
  'zygomatic & pterygoid': 'ZIT-01',
  'full arch immediate': 'AIRE-01'
};

function resolveCourseCode(optionText) {
  const lower = (optionText || '').toLowerCase();
  for (const [key, code] of Object.entries(COURSE_CODE_MAP)) {
    if (lower.includes(key)) return code;
  }
  return 'IDIT-01'; // Default fallback
}

let incompleteCaptured = false;

function checkAndSendIncompleteIntent() {
  if (incompleteCaptured) return;

  const name = document.querySelector('input[name="name"]')?.value?.trim() || '';
  const email = document.querySelector('input[name="email"]')?.value?.trim() || '';
  const phone = document.querySelector('input[name="phone"]')?.value?.trim() || '';
  const courseSelect = document.querySelector('select[name="course"]');
  const course = courseSelect?.value?.trim() || '';

  const hasContact = (email && email.includes('@')) || (phone && phone.replace(/\D/g, '').length >= 8);
  if (hasContact && course) {
    incompleteCaptured = true;
    const parts = name.split(' ');
    const firstName = parts[0] || 'Doutor(a)';
    const lastName = parts.slice(1).join(' ') || '';

    const payload = {
      idempotency_key: crypto.randomUUID ? crypto.randomUUID() : ('req_' + Date.now()),
      external_attempt_id: getOrCreateAttemptId(),
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      course_code: resolveCourseCode(course),
      source_page: window.location.origin + window.location.pathname,
      utm_source: new URLSearchParams(window.location.search).get('utm_source') || undefined,
      utm_medium: new URLSearchParams(window.location.search).get('utm_medium') || undefined,
      utm_campaign: new URLSearchParams(window.location.search).get('utm_campaign') || undefined,
    };

    fetch(`${EDS_HUB_URL}/capture-incomplete-enrollment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.debug('[EDS HUB] Incomplete capture non-fatal error:', err));
  }
}
```

---

## 8. Event B: Completed Form Implementation (Client Script)

Hook into the existing AJAX / fetch response handler for `#registerForm`. **Only after the website confirms HTTP 200 success**, forward the completed application payload to EDS HUB:

```javascript
// Inside existing registerForm fetch handler:
fetch(form.action, {
  method: 'POST',
  body: data,
  credentials: 'same-origin',
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
    'X-CSRF-TOKEN': csrfToken
  }
}).then(res => res.json()).then(result => {
  if (result.status === 200 && result.body && result.body.success) {
    // 1. Prepare sanitized whitelist payload (Excluding medical, dietary, files, signature)
    const completedPayload = {
      slug: 'website-register',
      idempotency_key: crypto.randomUUID ? crypto.randomUUID() : ('comp_' + Date.now()),
      external_attempt_id: getOrCreateAttemptId(),
      fields: {
        name: form.querySelector('input[name="name"]')?.value?.trim(),
        email: form.querySelector('input[name="email"]')?.value?.trim(),
        phone: form.querySelector('input[name="phone"]')?.value?.trim(),
        course: form.querySelector('select[name="course"]')?.value?.trim(),
        specialty: form.querySelector('select[name="specialty"]')?.value?.trim(),
        years_in_practice: form.querySelector('select[name="years_in_practice"]')?.value?.trim(),
        surgical_experience: form.querySelector('select[name="surgical_experience"]')?.value?.trim(),
        agd_number: form.querySelector('input[name="agd_number"]')?.value?.trim(),
        heard_from: form.querySelector('select[name="heard_from"]')?.value?.trim(),
        referral_name: form.querySelector('input[name="referral_name"]')?.value?.trim(),
        promo_code: form.querySelector('input[name="promo_code"]')?.value?.trim(),
        terms_accepted: true // Confirmed upon successful submission
      }
    };

    // 2. Dispatch to EDS HUB with failure resilience
    fetch(`${EDS_HUB_URL}/submit-public-form`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'SUPABASE_ANON_KEY' // Public anon key
      },
      body: JSON.stringify(completedPayload)
    })
    .finally(() => {
      // 3. Clear attempt ID and navigate to thank-you page
      sessionStorage.removeItem('eds_form_attempt_id');
      window.location.href = result.body.redirect || 'https://expdentalsolutions.com/thank-you';
    });
  }
});
```

---

## 9. Resilience & Failure Handling

If EDS HUB synchronization fails (e.g., visitor is on an unstable mobile network), the website submission **MUST NOT FAIL**. The `finally()` block guarantees the visitor is still redirected to the normal thank-you page without error alerts.

---

## 10. Deployment Status

- **EDS HUB Backend (Database & Edge Functions)**: **READY**
- **Live External Laravel Website**: **NOT YET DEPLOYED** (Integration snippet is ready for deployment into the Laravel template / assets).
