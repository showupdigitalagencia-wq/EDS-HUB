/**
 * =============================================================================
 * EDS Website Registration Integration — Client Script
 * Version: 1.1 (Hardened Production Release)
 * Target Page: https://expdentalsolutions.com/register
 * Target Form: #registerForm
 * 
 * Purpose:
 * Captures prospective student intent across two distinct lifecycle events:
 * 1. EVENT A (Incomplete Intent): Sent when visitor enters contact info + valid course.
 * 2. EVENT B (Completed Submission): Sent ONLY after Laravel confirms HTTP 200 success.
 * 
 * Hardening Guarantees:
 * - NO default course fallback: unmapped courses fail safe without CRM attribution error.
 * - In-flight guards: retry-safe, only marks success on 2xx responses.
 * - Stable idempotency keys: retried requests reuse the same idempotency key.
 * - Session continuity: attempt ID persists until completed sync succeeds.
 * - Zero medical, dietary, file uploads, signature, or password data transmitted.
 * - Non-blocking: EDS HUB failures NEVER block student registration or redirect.
 * =============================================================================
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Configuration & Constants
  // ---------------------------------------------------------------------------
  const EDS_CONFIG = {
    // Endpoints
    INCOMPLETE_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/capture-incomplete-enrollment',
    COMPLETED_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form',
    FORM_SLUG: 'website-register',

    // Public Supabase Anon Key (safe for public browser exposure; NOT service_role)
    PUBLIC_ANON_KEY: 'sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw',

    // Form element selectors (adapt if live DOM classes differ)
    SELECTORS: {
      form: '#registerForm',
      name: 'input[name="name"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      course: 'select[name="course"]',
      specialty: 'select[name="specialty"]',
      years_in_practice: 'select[name="years_in_practice"]',
      surgical_experience: 'select[name="surgical_experience"]',
      agd_number: 'input[name="agd_number"]',
      heard_from: 'select[name="heard_from"]',
      referral_name: 'input[name="referral_name"]',
      promo_code: 'input[name="promo_code"]',
      hiddenAttemptId: '#eds_form_attempt_id',
    },

    // Deterministic course code mapping based on live option prefix / keywords
    COURSE_MAP: {
      'dental implant intensive': 'IDIT-01',
      'advanced bone grafting': 'ADIE-01',
      'zygomatic & pterygoid': 'ZIT-01',
      'full arch immediate': 'AIRE-01',
    },

    // Timing
    DEBOUNCE_MS: 700,
    REQUEST_TIMEOUT_MS: 5000,
  };

  // ---------------------------------------------------------------------------
  // 2. State & Session Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns a stable attempt ID linking incomplete capture to completed submission.
   * Stored in sessionStorage for the duration of the browser tab.
   */
  function getEdsFormAttemptId() {
    let attemptId = sessionStorage.getItem('eds_form_attempt_id');
    if (!attemptId) {
      const randomPart = window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : (Date.now() + '_' + Math.random().toString(36).substring(2, 9));
      attemptId = 'reg_' + randomPart;
      sessionStorage.setItem('eds_form_attempt_id', attemptId);
    }
    return attemptId;
  }

  /**
   * Retrieves or generates a stable idempotency key for incomplete capture retries.
   */
  function getIncompleteIdempotencyKey() {
    let key = sessionStorage.getItem('eds_incomplete_idempotency_key');
    if (!key) {
      key = window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : ('inc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      sessionStorage.setItem('eds_incomplete_idempotency_key', key);
    }
    return key;
  }

  /**
   * Retrieves or generates a stable idempotency key for completed form submission.
   * Reuses the same key across retries of the same completed application.
   */
  function getCompletedIdempotencyKey() {
    let key = sessionStorage.getItem('eds_completed_idempotency_key');
    if (!key) {
      key = window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : ('comp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      sessionStorage.setItem('eds_completed_idempotency_key', key);
    }
    return key;
  }

  // ---------------------------------------------------------------------------
  // 3. Normalization & Utility Functions
  // ---------------------------------------------------------------------------

  /**
   * Maps live course dropdown value/text to canonical EDS HUB course code.
   * STRICT: Returns null if no explicit mapping exists. NEVER defaults silently.
   */
  function resolveCourseCode(rawCourseValue) {
    if (!rawCourseValue) return null;
    const lower = String(rawCourseValue).toLowerCase();
    for (const [key, code] of Object.entries(EDS_CONFIG.COURSE_MAP)) {
      if (lower.includes(key)) {
        return code;
      }
    }
    return null; // No fallback: unknown course will safely skip intent capture
  }

  /**
   * Conservative single-name splitting:
   * First whitespace token = first_name.
   * All remaining tokens = last_name (preserving multi-part surnames).
   */
  function parseFullName(fullName) {
    const trimmed = (fullName || '').trim();
    if (!trimmed) {
      return { firstName: 'Doutor(a)', lastName: '' };
    }
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex > 0) {
      return {
        firstName: trimmed.substring(0, spaceIndex),
        lastName: trimmed.substring(spaceIndex + 1).trim(),
      };
    }
    return { firstName: trimmed, lastName: '' };
  }

  /**
   * Extracts only whitelisted UTM parameters from URL search query.
   */
  function getSanitizedUtms() {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        utm_source: params.get('utm_source') || undefined,
        utm_medium: params.get('utm_medium') || undefined,
        utm_campaign: params.get('utm_campaign') || undefined,
        utm_term: params.get('utm_term') || undefined,
        utm_content: params.get('utm_content') || undefined,
      };
    } catch (_e) {
      return {};
    }
  }

  /**
   * Wrapper for fetch with strict timeout via AbortController.
   */
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || EDS_CONFIG.REQUEST_TIMEOUT_MS);
    return fetch(url, {
      ...options,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }

  // ---------------------------------------------------------------------------
  // 4. Incomplete Intent Capture (EVENT A)
  // ---------------------------------------------------------------------------
  let incompleteCaptured = false;
  let incompleteInFlight = false;
  let debounceTimer = null;

  function evaluateAndDispatchIncompleteIntent() {
    // If already successfully captured or a request is currently in flight, do not dispatch
    if (incompleteCaptured || incompleteInFlight || sessionStorage.getItem('eds_incomplete_sent') === 'true') {
      return;
    }

    const form = document.querySelector(EDS_CONFIG.SELECTORS.form);
    if (!form) return;

    const nameVal = form.querySelector(EDS_CONFIG.SELECTORS.name)?.value?.trim() || '';
    const emailVal = form.querySelector(EDS_CONFIG.SELECTORS.email)?.value?.trim() || '';
    const phoneVal = form.querySelector(EDS_CONFIG.SELECTORS.phone)?.value?.trim() || '';
    const courseSelect = form.querySelector(EDS_CONFIG.SELECTORS.course);
    const courseVal = courseSelect?.value?.trim() || (courseSelect?.selectedOptions?.[0]?.text?.trim() || '');

    // Intent qualification rules:
    // 1. Must have valid email OR valid phone (>= 8 digits)
    // 2. AND non-empty name (>= 2 chars)
    // 3. AND course selected
    const hasValidEmail = Boolean(emailVal && emailVal.includes('@') && emailVal.includes('.'));
    const cleanPhoneDigits = phoneVal.replace(/\D/g, '');
    const hasValidPhone = cleanPhoneDigits.length >= 8;
    const hasContact = hasValidEmail || hasValidPhone;
    const hasName = nameVal.length >= 2;

    if (!hasContact || !hasName || !courseVal) {
      return; // Not yet qualified intent
    }

    // Resolve course code strictly without arbitrary fallback
    const courseCode = resolveCourseCode(courseVal);
    if (!courseCode) {
      console.debug('[EDS HUB] Incomplete capture skipped: course option not in explicit COURSE_MAP:', courseVal);
      return;
    }

    incompleteInFlight = true;

    const { firstName, lastName } = parseFullName(nameVal);
    const utms = getSanitizedUtms();

    const payload = {
      idempotency_key: getIncompleteIdempotencyKey(),
      external_attempt_id: getEdsFormAttemptId(),
      first_name: firstName,
      last_name: lastName,
      email: emailVal || undefined,
      phone: phoneVal || undefined,
      course_code: courseCode,
      source_page: window.location.origin + window.location.pathname,
      ...utms,
    };

    fetchWithTimeout(
      EDS_CONFIG.INCOMPLETE_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY,
        },
        body: JSON.stringify(payload),
      },
      EDS_CONFIG.REQUEST_TIMEOUT_MS
    )
      .then((res) => {
        if (res.ok) {
          // Success: Mark completed so no further incomplete events fire in this session
          incompleteCaptured = true;
          sessionStorage.setItem('eds_incomplete_sent', 'true');
        } else {
          console.debug('[EDS HUB] Incomplete capture HTTP non-2xx status:', res.status);
          // Do not mark sent: allows later retry with the same idempotency key
        }
      })
      .catch((err) => {
        // Non-fatal: visitor experience must never be affected; keeps same idempotency key for retry
        console.debug('[EDS HUB] Incomplete capture non-fatal error:', err.message || err);
      })
      .finally(() => {
        incompleteInFlight = false;
      });
  }

  function onFieldChangeDebounced() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluateAndDispatchIncompleteIntent, EDS_CONFIG.DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // 5. Completed Form Submission (EVENT B - Fallback / Option A)
  // ---------------------------------------------------------------------------
  let completionInFlight = false;

  /**
   * Dispatches the sanitized whitelist application data to EDS HUB.
   * Call this function ONLY AFTER the existing Laravel AJAX request returns success.
   * NOTE: When using Option B (Laravel backend sync), do NOT call this function.
   * 
   * @param {HTMLFormElement} formElement - Reference to the submitted form.
   * @returns {Promise<void>} Resolves when request finishes or times out.
   */
  window.sendEdsHubCompletedForm = function (formElement) {
    const form = formElement || document.querySelector(EDS_CONFIG.SELECTORS.form);
    if (!form) return Promise.resolve();

    // Guard against duplicate completed dispatch or concurrent in-flight
    if (completionInFlight || sessionStorage.getItem('eds_completion_sent') === 'true') {
      return Promise.resolve();
    }
    completionInFlight = true;

    const attemptId = getEdsFormAttemptId();
    const courseSelect = form.querySelector(EDS_CONFIG.SELECTORS.course);
    const rawCourseText = courseSelect?.value?.trim() || (courseSelect?.selectedOptions?.[0]?.text?.trim() || '');

    // Build SANITIZED CRM whitelist payload
    // Strictly EXCLUDES: medical_conditions, dietary, passport, dental_license, emergency_phone,
    // certificate_name, coat_size, signature, and raw FormData
    const completedPayload = {
      slug: EDS_CONFIG.FORM_SLUG,
      idempotency_key: getCompletedIdempotencyKey(),
      external_attempt_id: attemptId,
      fields: {
        name: form.querySelector(EDS_CONFIG.SELECTORS.name)?.value?.trim() || '',
        email: form.querySelector(EDS_CONFIG.SELECTORS.email)?.value?.trim() || '',
        phone: form.querySelector(EDS_CONFIG.SELECTORS.phone)?.value?.trim() || '',
        course: rawCourseText,
        specialty: form.querySelector(EDS_CONFIG.SELECTORS.specialty)?.value?.trim() || undefined,
        years_in_practice: form.querySelector(EDS_CONFIG.SELECTORS.years_in_practice)?.value?.trim() || undefined,
        surgical_experience: form.querySelector(EDS_CONFIG.SELECTORS.surgical_experience)?.value?.trim() || undefined,
        agd_number: form.querySelector(EDS_CONFIG.SELECTORS.agd_number)?.value?.trim() || undefined,
        heard_from: form.querySelector(EDS_CONFIG.SELECTORS.heard_from)?.value?.trim() || undefined,
        referral_name: form.querySelector(EDS_CONFIG.SELECTORS.referral_name)?.value?.trim() || undefined,
        promo_code: form.querySelector(EDS_CONFIG.SELECTORS.promo_code)?.value?.trim() || undefined,
        terms_accepted: true, // Confirmed on completed application
      },
    };

    return fetchWithTimeout(
      EDS_CONFIG.COMPLETED_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY,
        },
        body: JSON.stringify(completedPayload),
      },
      EDS_CONFIG.REQUEST_TIMEOUT_MS
    )
      .then((res) => {
        if (res.ok) {
          sessionStorage.setItem('eds_completion_sent', 'true');
          // Clean up session storage after confirmed successful dispatch
          sessionStorage.removeItem('eds_form_attempt_id');
          sessionStorage.removeItem('eds_incomplete_idempotency_key');
          sessionStorage.removeItem('eds_completed_idempotency_key');
          sessionStorage.removeItem('eds_incomplete_sent');
        } else {
          console.debug('[EDS HUB] Completed submission HTTP non-2xx status:', res.status);
        }
      })
      .catch((err) => {
        // Non-fatal: website registration already succeeded on Laravel; allows retry with same idempotency key
        console.debug('[EDS HUB] Completed submission non-fatal sync error:', err.message || err);
      })
      .finally(() => {
        completionInFlight = false;
      });
  };

  // ---------------------------------------------------------------------------
  // 6. DOM Initialization
  // ---------------------------------------------------------------------------
  function initializeIntegration() {
    const form = document.querySelector(EDS_CONFIG.SELECTORS.form);
    if (!form) return;

    // 1. Ensure hidden input exists for external_attempt_id (enables Laravel server-side sync)
    let hiddenInput = form.querySelector(EDS_CONFIG.SELECTORS.hiddenAttemptId);
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = 'eds_form_attempt_id';
      hiddenInput.id = 'eds_form_attempt_id';
      form.appendChild(hiddenInput);
    }
    hiddenInput.value = getEdsFormAttemptId();

    // 2. Attach listeners for qualified incomplete intent capture
    const inputFields = [
      EDS_CONFIG.SELECTORS.name,
      EDS_CONFIG.SELECTORS.email,
      EDS_CONFIG.SELECTORS.phone,
      EDS_CONFIG.SELECTORS.course,
    ];

    inputFields.forEach((selector) => {
      const el = form.querySelector(selector);
      if (el) {
        el.addEventListener('input', onFieldChangeDebounced);
        el.addEventListener('change', onFieldChangeDebounced);
      }
    });

    // 3. Fallback: Hook into submit event to ensure hidden attempt ID is current
    form.addEventListener('submit', function () {
      if (hiddenInput) {
        hiddenInput.value = getEdsFormAttemptId();
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeIntegration);
  } else {
    initializeIntegration();
  }
})();
