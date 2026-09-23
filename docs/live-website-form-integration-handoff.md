# EDS HUB — Live Website Form Integration Handoff Package
## Laravel Registration Form (`/register`) → EDS HUB CRM Synchronization

**Target Website:** `https://expdentalsolutions.com`  
**Registration Page:** `https://expdentalsolutions.com/register`  
**Target Form:** `#registerForm`  
**Platform:** Laravel / PHP + Bootstrap 5 + jQuery / Vanilla JS  
**Current Baseline in EDS HUB:** Migration `00058_add_form_completed_status.sql`

---

## 1. Objective

Integrate the live course registration form on the public EDS website with the **EDS HUB CRM** to synchronize student registrations seamlessly across two distinct lifecycle events:

1. **EVENT A (Incomplete Intent):** Capture prospective students who begin filling out their contact details and select a course, but abandon the page before final submission. Creates/matches the lead in `Novo Lead` (`capture`) and generates an operational follow-up task.
2. **EVENT B (Completed Application):** Capture confirmed applications submitted through the website. Atomically reconciles the earlier incomplete attempt (`form_completed`), cancels the pending follow-up task, logs application completion, populates `resolved_form_submission_id`, leaves `resolved_enrollment_id` `NULL`, and preserves the existing commercial pipeline stage.

---

## 2. Architecture Tradeoff & Recommendation

Two implementation options are available for the website developer:

| Criteria | OPTION A: Pure Browser Integration (JS only) | OPTION B: Hybrid Integration (Recommended) |
| :--- | :--- | :--- |
| **Event A (Incomplete Intent)** | Browser → EDS HUB Edge Function | Browser → EDS HUB Edge Function |
| **Event B (Completed Application)** | Browser → EDS HUB Edge Function (after Laravel 200) | Laravel Backend → EDS HUB Edge Function (server-to-server) |
| **Developer Effort** | Add 1 JavaScript snippet to `/register` blade | Add JS snippet + 1 PHP helper call in RegistrationController |
| **Reliability on Slow Mobile Networks** | Good (with 5s timeout & non-blocking finally) | **Maximum** (guaranteed execution, zero risk of tab close before sync) |
| **Ad Blocker / Privacy Shield Resilience** | Moderate (some aggressive extensions block analytics) | **Maximum** (completed application cannot be blocked by client extensions) |
| **Form Attempt ID Continuity** | Automatically tracked in `sessionStorage` | Stored in `sessionStorage` + submitted as hidden input `<input name="eds_form_attempt_id">` |

### Recommended Choice: **OPTION B (Hybrid)**
- **Why:** The student's incomplete intent can only be detected in the browser while they type. However, for a high-value completed application ($9k–$11k course tuition), server-to-server dispatch from Laravel guarantees 100% CRM delivery regardless of mobile signal drops, client browser crashes, or browser extensions.
- **Fast-Track Alternative (OPTION A):** If the developer cannot immediately modify Laravel controller code, **OPTION A works entirely from the frontend** using only the JavaScript snippet.

---

## 3. What the Developer Must Add

### For OPTION A (Pure Browser):
1. Include `docs/snippets/eds-register-integration.js` on `https://expdentalsolutions.com/register`.
2. Hook `window.sendEdsHubCompletedForm(form)` into the existing AJAX success callback where `#registerForm` receives its `200 OK` response.

### For OPTION B (Hybrid — Recommended):
1. Include `docs/snippets/eds-register-integration.js` on `https://expdentalsolutions.com/register`.
   *(The JS snippet automatically injects `<input type="hidden" name="eds_form_attempt_id">` into `#registerForm`).*
2. Add `App\Services\EdsHubSyncService` (`docs/snippets/eds-register-completed-sync.php`) to Laravel.
3. Call `EdsHubSyncService::syncCompletedApplication($request)` in the controller immediately after saving the student record to the local database.

---

## 4. Where to Add It

### Frontend (Blade Template):
In `resources/views/register.blade.php` (or your registration view layout):
```html
<!-- Load before closing </body> or after form scripts -->
<script src="{{ asset('js/eds-register-integration.js') }}" defer></script>
```

### Existing AJAX Handler (Only if using OPTION A):
In the existing fetch/AJAX handler for `#registerForm`:
```javascript
// Existing Laravel AJAX submission
fetch(form.action, {
  method: 'POST',
  body: formData,
  headers: { 'X-CSRF-TOKEN': csrfToken }
})
.then(res => res.json())
.then(result => {
  if (result.success) {
    // -------------------------------------------------------------------------
    // EDS HUB INTEGRATION HOOK (OPTION A):
    // -------------------------------------------------------------------------
    if (typeof window.sendEdsHubCompletedForm === 'function') {
      window.sendEdsHubCompletedForm(form).finally(() => {
        // Continue with original redirect
        window.location.href = result.redirect || '/thank-you';
      });
    } else {
      window.location.href = result.redirect || '/thank-you';
    }
  } else {
    // Original validation error handling
    showErrors(result.errors);
  }
});
```

### Laravel Controller (Only if using OPTION B):
In `app/Http/Controllers/RegistrationController.php`:
```php
public function store(RegisterRequest $request)
{
    // 1. Existing local registration & file uploads
    $registration = $this->registrationService->create($request->validated());

    // 2. EDS HUB Completed Sync (Non-blocking: failures do not affect student)
    \App\Services\EdsHubSyncService::syncCompletedApplication($request);

    // 3. Return existing response
    return response()->json([
        'success' => true,
        'redirect' => route('thank-you'),
    ]);
}
```

---

## 5. Endpoints & Safe Public Credentials

| Event | Method | URL | Auth Header |
| :--- | :--- | :--- | :--- |
| **Incomplete Intent** | `POST` | `https://xogcexclqiornuscsdmn.supabase.co/functions/v1/capture-incomplete-enrollment` | `apikey: sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw` |
| **Completed Form** | `POST` | `https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form` | `apikey: sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw` |

> [!NOTE]
> The `apikey` is a **public publishable client key** designed specifically for browser exposure.
> **NEVER** expose `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or private API secrets on the website.

---

## 6. Field Mapping (CRM Whitelist vs. Strictly Prohibited)

### A. Approved CRM Whitelist Fields

| Field Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` / `first_name` | string | **Yes** | Full name or first name (conservative multi-token parsing) |
| `last_name` | string | No | Surname (all tokens after first space) |
| `email` | string | **Yes** | Contact email (normalized lowercase) |
| `phone` | string | **Yes** | Mobile phone (digits normalized) |
| `course` | string | **Yes** | Course selected from dropdown |
| `specialty` | string | No | Dental specialty (e.g., General Practitioner, Implantologist) |
| `years_in_practice` | string | No | Experience bracket |
| `surgical_experience` | string | No | Surgical experience level |
| `agd_number` | string | No | AGD / PACE membership ID |
| `heard_from` | string | No | Attribution / channel source |
| `referral_name` | string | No | Referring colleague name |
| `promo_code` | string | No | Coupon / campaign code |
| `terms_accepted` | boolean | No | Sent as `true` ONLY on completed submission |

### B. Technical Integration Parameters (Not Form Inputs)

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `external_attempt_id` | string | Recommended | Stable session attempt ID (`reg_...`) linking incomplete to completed intent |
| `idempotency_key` | string | **Yes** | UUID preventing duplicate submissions on retry/double-click |
| `source_page` | string | Optional | Current URL origin + pathname (no query or hash) |
| `utm_source`, `utm_medium`, etc. | string | Optional | Whitelisted marketing parameters |

### C. STRICTLY PROHIBITED DATA (Never Transmit to EDS HUB)

> [!CAUTION]
> **COMPLIANCE & PRIVACY MANDATE**  
> To comply with privacy and medical records regulations, the following data **MUST REMAIN EXCLUSIVELY ON THE WEBSITE DATABASE/STORAGE**:
> - `medical_conditions`: Health, allergies, medical info. **PROHIBITED**.
> - `dietary`: Dietary restrictions. **PROHIBITED**.
> - `passport`: Document upload files or file URLs. **PROHIBITED**.
> - `dental_license`: Document upload files or file URLs. **PROHIBITED**.
> - `emergency_phone`: Course logistics contact. **EXCLUDED**.
> - `certificate_name`: Certificate printing name. **EXCLUDED**.
> - `coat_size`: Apparel size. **EXCLUDED**.
> - `signature`: Legal signature image/canvas. **PROHIBITED**.
> - `raw FormData`: Raw multipart request body. **PROHIBITED**.
> - Laravel CSRF tokens, session IDs, cookies, or passwords. **EXCLUDED**.

---

## 7. Deterministic Course Mapping Table

The live form has a single `<select name="course">`. The options embed course title, session dates, and tuition. The integration uses deterministic keyword matching:

| Live Website Option (Exact Prefix / Keywords) | EDS HUB `courses.code` | Canonical Course Name |
| :--- | :--- | :--- |
| `Dental Implant Intensive Course` | `IDIT-01` | Intensive Dental Implant Training |
| `Advanced Bone Grafting & Sinus Lift` | `ADIE-01` | Advanced Dental Implant Experience |
| `Zygomatic & Pterygoid Implants` | `ZIT-01` | Zygomatic Implant Training |
| `Full Arch Immediate Loading` | `AIRE-01` | Advanced Implant Rehabilitation Experience |

### Session Reality
The live registration form **does NOT** contain a separate session selector dropdown. Dates are embedded directly in the course option text. Therefore, `course_session_id` remains `NULL` in EDS HUB until a registrar or coordinator assigns the student to a specific turma.

---

## 8. Conservative Name Parsing Rule

The live form has a single `<input name="name">`. To prevent damaging multi-token surnames:
- `first_name` = first whitespace-delimited token (e.g. `"Carlos"`)
- `last_name` = all remaining tokens preserved intact (e.g. `"da Silva Santos"`, `"Van Der Bellen"`)
- If the visitor inputs only a single name, `first_name` receives the value and `last_name` remains empty string.
- The original full string is preserved in `submitted_data`.

---

## 9. Failure Handling & Non-Blocking Guarantee

The student's registration experience on the website is the absolute highest priority:
1. **Incomplete Intent Failure:** If the incomplete request fails or times out, it silently logs to `console.debug`. No alert or modal is ever shown to the visitor.
2. **Completed Application Failure:** If EDS HUB is unreachable when the student submits the form, the student's registration in Laravel has already succeeded. The `.finally()` block guarantees the visitor is still redirected to `/thank-you` without error banners.
3. **Timeout:** Both endpoints are bounded with a strict **5-second timeout** using `AbortController` (JS) and `Http::timeout(5)` (PHP) so pages never hang.

---

## 10. Implementation Checklist for Developer

- [ ] **Step 1: Backup:** Keep a backup of current `/register` blade template and registration JS.
- [ ] **Step 2: Add JS Snippet:** Copy `docs/snippets/eds-register-integration.js` into your public assets folder (`public/js/eds-register-integration.js`).
- [ ] **Step 3: Include in Blade:** Add `<script src="/js/eds-register-integration.js" defer></script>` to `/register` template.
- [ ] **Step 4: Verify Selectors:** Confirm input names match `#registerForm`, `input[name="name"]`, `input[name="email"]`, `input[name="phone"]`, `select[name="course"]`.
- [ ] **Step 5: Choose Completed Sync Path:**
  - **Option A (Frontend):** Call `window.sendEdsHubCompletedForm(form)` inside the existing AJAX success callback before redirecting to `/thank-you`.
  - **Option B (Backend - Recommended):** Copy `docs/snippets/eds-register-completed-sync.php` to `app/Services/EdsHubSyncService.php` and call `EdsHubSyncService::syncCompletedApplication($request)` in your controller.
- [ ] **Step 6: Privacy Audit:** Verify that `medical_conditions`, `dietary`, `passport`, `dental_license`, and `signature` are NOT sent to EDS HUB.
- [ ] **Step 7: Execute Testing Plan:** Follow the test scenarios below in a staging or preview environment.

---

## 11. Testing Plan for Website Developer

Use only synthetic test personas. **Never use real customer data for testing.**

### Test Persona:
- **Name:** `Maria Teste Integração`
- **Email:** `integracao+teste@expdentalsolutions.com`
- **Phone:** `+1 305 555 0199`
- **Course:** `Dental Implant Intensive Course`

### Scenario 1: Incomplete Intent Capture
1. Open an Incognito window and visit `https://expdentalsolutions.com/register`.
2. Open Browser DevTools (F12) → Network tab.
3. Type the Name, Email, Phone, and choose the Course.
4. **DO NOT CLICK SUBMIT.** Stop typing and wait 1 second.
5. In Network tab, observe:
   - Request to `capture-incomplete-enrollment`
   - Method: `POST`
   - Status: `200 OK`
   - Payload contains `external_attempt_id: "reg_..."` and `course_code: "IDIT-01"`
6. In EDS HUB: The lead appears in **Novo Lead** with an operational incomplete enrollment alert and follow-up task.

### Scenario 2: Completed Application Reconciliation
1. In the **same browser session** without closing the tab, fill in the rest of the form (specialty, experience, terms).
2. Click **Submit Application**.
3. Observe:
   - Laravel `#registerForm` AJAX request returns HTTP 200 success.
   - EDS HUB completed submission is dispatched with the **same** `external_attempt_id`.
   - Browser redirects to `/thank-you`.
4. In EDS HUB:
   - The same lead's incomplete alert transitions to `Formulário concluído`.
   - The pending incomplete follow-up task is automatically `cancelled`.
   - Lead activity timeline shows `form_submitted` with `resolved_form_submission_id`.
   - Lead commercial stage is preserved.

---

## 12. Synthetic Data Cleanup Plan in EDS HUB

To remove test data created during staging/production verification:
1. Log into EDS HUB as an administrator.
2. Search for `integracao+teste@expdentalsolutions.com`.
3. Open the lead profile.
4. If dismissed is preferred: In the Incomplete Intent banner, click **Descartar** (cancels follow-up task and marks attempt `dismissed`).
5. Or delete the lead profile directly from the lead detail view if it was purely synthetic test data.

---

## 13. Rollback Instructions

If unexpected behavior occurs on the website:
1. **Frontend Rollback:** Remove the `<script src=".../eds-register-integration.js">` tag from `/register` blade template.
2. **Backend Rollback (if Option B was used):** Comment out or remove `EdsHubSyncService::syncCompletedApplication($request)` in the controller.
3. **EDS HUB State:** **DO NOT roll back database migrations in EDS HUB.** The EDS HUB database schema (Migration `00058`) is completely backward-compatible and will safely remain idle until re-connected.
