/**
 * =============================================================================
 * EDS HUB Website Registration Integration — Production Client Script
 * Target URL: https://www.expdentalsolutions.com/register
 * Target Form: #registerForm
 * 
 * Version: 2.2 (Production Release — Universal Attempt Capture on Submit)
 * 
 * Canonical Rule:
 * ANY factual user attempt to submit the Register form must be captured if the
 * registration does not complete (User clicks Register / Submit + does not complete).
 * Zero minimum field threshold: captures Name only, Email only, Phone only,
 * very incomplete forms, and anonymous attempts with factual missing value labels.
 * 
 * Responsibilities:
 * 1. Automatically tracks persistent attempt ID across session.
 * 2. Injects hidden field <input type="hidden" name="eds_form_attempt_id"> into #registerForm.
 * 3. Captures INCOMPLETE registration intent (debounced 1.5s) when visitor enters contact + course.
 * 4. Captures ALL SUBMISSION FAILURES upon explicit user Submit/Register action.
 * 5. Hooks into COMPLETED submissions (HTTP 200) to notify EDS HUB (Option A or Option B).
 * 6. Strictly excludes sensitive health notes, dietary info, uploaded files, and blacklisted key patterns.
 * 7. Non-blocking: failures to reach CRM never prevent visitor registration or redirect.
 * =============================================================================
 */

(function () {
  'use strict';

  var EDS_CONFIG = {
    // EDS HUB Production Supabase Endpoints
    INCOMPLETE_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/capture-incomplete-enrollment',
    COMPLETED_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form',
    
    // Public Anon Key (safe for browser exposure)
    PUBLIC_ANON_KEY: 'sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw',
    FORM_SLUG: 'website-register',

    // Mapping from live select option strings to canonical EDS HUB course codes
    COURSE_MAP: {
      'dental implant intensive': 'IDIT-01',
      'dental implant advanced': 'ADIE-01',
      'zygomatic implant': 'ZIT-01',
      'wisdom teeth': 'WTT-01',
      'advanced implant rehabilitation': 'AIRE-01',
      'perioplastic surgery': 'PST-01',
      'periodontal surgery': 'PST-01',
      'intensive molar endodontics': 'ET-01',
      'endodontics training': 'ET-01',
      'maxillofacial anomalies': 'MAX-01'
    }
  };

  // Retrieve or generate attempt UUID for this browser tab session
  function getAttemptId() {
    var key = 'eds_form_attempt_id';
    var attemptId = null;
    try {
      attemptId = sessionStorage.getItem(key);
      if (!attemptId) {
        attemptId = 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        sessionStorage.setItem(key, attemptId);
      }
    } catch (_e) {
      attemptId = 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    return attemptId;
  }

  // Extract UTM parameters from current URL
  function getUtmParams() {
    try {
      var params = new URLSearchParams(window.location.search);
      return {
        utm_source: params.get('utm_source') || null,
        utm_medium: params.get('utm_medium') || null,
        utm_campaign: params.get('utm_campaign') || null,
        utm_term: params.get('utm_term') || null,
        utm_content: params.get('utm_content') || null
      };
    } catch (_e) {
      return {};
    }
  }

  // Resolve course option string to canonical course code
  function resolveCourseCode(rawCourse) {
    if (!rawCourse) return null;
    var lower = rawCourse.toLowerCase();
    var keys = Object.keys(EDS_CONFIG.COURSE_MAP);
    for (var i = 0; i < keys.length; i++) {
      if (lower.indexOf(keys[i]) !== -1) {
        return EDS_CONFIG.COURSE_MAP[keys[i]];
      }
    }
    return null;
  }

  // Parse full name into first and last name
  function parseName(fullName) {
    var trimmed = (fullName || '').trim();
    if (!trimmed) return { first: null, last: null };
    var space = trimmed.indexOf(' ');
    if (space === -1) return { first: trimmed, last: null };
    return {
      first: trimmed.substring(0, space).trim(),
      last: trimmed.substring(space + 1).trim() || null
    };
  }

  // Sanitize phone number to digits and leading +
  function sanitizePhone(rawPhone) {
    if (!rawPhone) return null;
    var cleaned = rawPhone.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+') && cleaned.length >= 10) {
      cleaned = '+' + cleaned;
    }
    return cleaned || null;
  }

  // Strip any properties containing blacklisted substrings (e.g. 'rg' inside emergency_phone / surgical_experience)
  var SENSITIVE_KEY_PATTERNS = [
    'password', 'token', 'secret', 'credit_card', 'card_number', 'pan',
    'cvv', 'cvc', 'expiry', 'ssn', 'cpf', 'rg', 'passport', 'bank_account', 'iban'
  ];

  function sanitizePayloadForEdge(payload) {
    var safe = {};
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      var lower = k.toLowerCase();
      var isBlacklisted = false;
      for (var i = 0; i < SENSITIVE_KEY_PATTERNS.length; i++) {
        if (lower.indexOf(SENSITIVE_KEY_PATTERNS[i]) !== -1) {
          isBlacklisted = true;
          break;
        }
      }
      if (!isBlacklisted && payload[k] !== undefined) {
        safe[k] = payload[k];
      }
    }
    return safe;
  }

  function init() {
    var form = document.getElementById('registerForm');
    if (!form) return;

    var attemptId = getAttemptId();

    // 1. Ensure hidden input exists for attempt tracking
    var hiddenInput = form.querySelector('input[name="eds_form_attempt_id"]');
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = 'eds_form_attempt_id';
      hiddenInput.id = 'eds_form_attempt_id';
      hiddenInput.value = attemptId;
      form.appendChild(hiddenInput);
    }

    var debounceTimer = null;
    var lastCapturedSignature = '';
    var lastReportedSubmitTime = 0;

    // 2. Debounced Intent Listener (captures progressive incomplete form filling without submit)
    function onFieldChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(captureIncompleteAttempt, 1500);
    }

    form.querySelectorAll('input:not([type="file"]), select').forEach(function (el) {
      el.addEventListener('input', onFieldChange);
      el.addEventListener('change', onFieldChange);
    });

    // 3. Dispatch Incomplete Registration Intent to EDS HUB (Passive abandonment flow)
    function captureIncompleteAttempt() {
      var emailEl = form.querySelector('input[name="email"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var courseEl = form.querySelector('select[name="course"]');
      var nameEl = form.querySelector('input[name="name"]');
      var certNameEl = form.querySelector('input[name="certificate_name"]');
      var agdEl = form.querySelector('input[name="agd_number"]');
      var specialtyEl = form.querySelector('select[name="specialty"]');
      var yearsEl = form.querySelector('select[name="years_in_practice"]');
      var coatEl = form.querySelector('input[name="coat_size"]');
      var heardEl = form.querySelector('select[name="heard_from"]');
      var referralEl = form.querySelector('input[name="referral_name"]');
      var promoEl = form.querySelector('input[name="promo_code"]');

      var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
      var phone = phoneEl ? sanitizePhone(phoneEl.value) : '';
      var rawCourse = courseEl ? courseEl.value : '';
      var name = nameEl ? nameEl.value.trim() : '';

      // Only fire passive intent if visitor entered contact info AND selected a course
      if ((!email && !phone) || !rawCourse) return;

      var courseCode = resolveCourseCode(rawCourse);

      // Signature encompasses filled progressive fields
      var signature = [
        email,
        phone,
        rawCourse,
        name,
        specialtyEl ? specialtyEl.value : '',
        yearsEl ? yearsEl.value : '',
        agdEl ? agdEl.value.trim() : '',
        referralEl ? referralEl.value.trim() : '',
        promoEl ? promoEl.value.trim() : '',
        coatEl ? coatEl.value.trim() : '',
        heardEl ? heardEl.value : '',
        certNameEl ? certNameEl.value.trim() : ''
      ].join('|');

      if (signature === lastCapturedSignature) return; // avoid duplicate requests
      lastCapturedSignature = signature;

      var names = parseName(name);
      var utm = getUtmParams();

      var rawPayload = {
        idempotency_key: 'inc_' + attemptId + '_' + (courseCode || 'course'),
        external_attempt_id: attemptId,
        first_name: names.first || undefined,
        last_name: names.last || undefined,
        name: name || undefined,
        email: email || null,
        phone: phone || null,
        course: rawCourse || undefined,
        course_code: courseCode || null,
        certificate_name: certNameEl ? certNameEl.value.trim() : undefined,
        agd_number: agdEl ? agdEl.value.trim() : undefined,
        specialty: specialtyEl ? specialtyEl.value : undefined,
        years_in_practice: yearsEl ? yearsEl.value : undefined,
        coat_size: coatEl ? coatEl.value.trim() : undefined,
        heard_from: heardEl ? heardEl.value : undefined,
        referral_name: referralEl ? referralEl.value.trim() : undefined,
        promo_code: promoEl ? promoEl.value.trim() : undefined,
        status: 'needs_followup',
        source_page: window.location.origin + window.location.pathname,
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_term: utm.utm_term || null,
        utm_content: utm.utm_content || null
      };

      var payload = sanitizePayloadForEdge(rawPayload);

      fetch(EDS_CONFIG.INCOMPLETE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
        },
        body: JSON.stringify(payload)
      }).catch(function (err) {
        console.warn('[EDS HUB] Notice: Incomplete capture offline/skipped', err);
      });
    }

    // 4. Reset Attempt ID — strictly called only upon factual successful completion
    window.resetEdsHubAttempt = function () {
      try {
        sessionStorage.removeItem('eds_form_attempt_id');
      } catch (_e) {}
    };

    // Track factual submission attempt count across the session
    function getSubmitAttemptCount() {
      var key = 'eds_submit_attempt_count_' + attemptId;
      var count = 0;
      try {
        count = parseInt(sessionStorage.getItem(key) || '0', 10);
      } catch (_e) {
        count = 0;
      }
      count += 1;
      try {
        sessionStorage.setItem(key, String(count));
      } catch (_e) {}
      return count;
    }

    // Categorize failure reason without exposing technical stack traces
    function resolveFailureCategory(errorCode, errorDetails) {
      var code = String(errorCode || '').toUpperCase();
      if (code.includes('413') || code.includes('UPLOAD_TOO_LARGE')) {
        return 'Upload error';
      }
      if (code.includes('NETWORK')) {
        return 'Network/server error';
      }
      if (code.includes('CAPTCHA')) {
        return 'Captcha inválido';
      }

      // Check missing attachments on form DOM
      var passportInput = form.querySelector('input[name="passport"]');
      var licenseInput = form.querySelector('input[name="dental_license"]');
      var hasPassport = passportInput && passportInput.files && passportInput.files.length > 0;
      var hasLicense = licenseInput && licenseInput.files && licenseInput.files.length > 0;

      // Check details object if passed from Laravel response or client diagnostics
      if (errorDetails && typeof errorDetails === 'object') {
        var errKeys = Object.keys(errorDetails);
        if (errKeys.indexOf('passport') !== -1 && !hasPassport) return 'Passport ausente';
        if (errKeys.indexOf('dental_license') !== -1 && !hasLicense) return 'Dental License ausente';
        if (errKeys.indexOf('g-recaptcha-response') !== -1) return 'Captcha inválido';
        if (errKeys.length > 0) return 'Campos obrigatórios ausentes';
      }

      if (!hasPassport && !hasLicense) return 'Campos obrigatórios ausentes';
      if (!hasPassport) return 'Passport ausente';
      if (!hasLicense) return 'Dental License ausente';

      if (code.includes('CLIENT_VALIDATION')) {
        return 'CLIENT_VALIDATION_FAILED';
      }
      if (code.includes('422') || code.includes('VALIDATION')) {
        return 'Validation error';
      }
      if (code.includes('SERVER')) {
        return 'Network/server error';
      }
      return 'Validation error';
    }

    // 5. Report Failed Submission to EDS HUB (Captures ANY user submit attempt that does not complete)
    window.reportEdsHubSubmissionFailure = function (errorCode, errorDetails) {
      // Coalescing: Ensure one submit click action with multiple issues triggers only ONE failed attempt (Requirement: One click = one attempt)
      var now = Date.now();
      if (now - lastReportedSubmitTime < 2500) return;
      lastReportedSubmitTime = now;

      var emailEl = form.querySelector('input[name="email"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var courseEl = form.querySelector('select[name="course"]');
      var nameEl = form.querySelector('input[name="name"]');
      var certNameEl = form.querySelector('input[name="certificate_name"]');
      var agdEl = form.querySelector('input[name="agd_number"]');
      var specialtyEl = form.querySelector('select[name="specialty"]');
      var yearsEl = form.querySelector('select[name="years_in_practice"]');
      var coatEl = form.querySelector('input[name="coat_size"]');
      var heardEl = form.querySelector('select[name="heard_from"]');
      var referralEl = form.querySelector('input[name="referral_name"]');
      var promoEl = form.querySelector('input[name="promo_code"]');

      var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
      var phone = phoneEl ? sanitizePhone(phoneEl.value) : '';
      var rawCourse = courseEl ? courseEl.value : '';
      var courseCode = resolveCourseCode(rawCourse);
      var name = nameEl ? nameEl.value.trim() : '';
      var names = parseName(name);
      var utm = getUtmParams();
      var attemptCount = getSubmitAttemptCount();
      var category = resolveFailureCategory(errorCode, errorDetails);

      var rawPayload = {
        idempotency_key: 'fail_' + attemptId + '_' + attemptCount,
        external_attempt_id: attemptId,
        first_name: names.first || undefined,
        last_name: names.last || undefined,
        name: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        course: rawCourse || undefined,
        course_code: courseCode || null,
        certificate_name: certNameEl ? certNameEl.value.trim() : undefined,
        agd_number: agdEl ? agdEl.value.trim() : undefined,
        specialty: specialtyEl ? specialtyEl.value : undefined,
        years_in_practice: yearsEl ? yearsEl.value : undefined,
        coat_size: coatEl ? coatEl.value.trim() : undefined,
        heard_from: heardEl ? heardEl.value : undefined,
        referral_name: referralEl ? referralEl.value.trim() : undefined,
        promo_code: promoEl ? promoEl.value.trim() : undefined,
        status: 'submission_failed',
        failure_category: category,
        submit_attempt_count: attemptCount,
        error_code: String(errorCode || 'SUBMISSION_FAILED').slice(0, 50),
        source_page: window.location.origin + window.location.pathname,
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_term: utm.utm_term || null,
        utm_content: utm.utm_content || null
      };

      var payload = sanitizePayloadForEdge(rawPayload);

      fetch(EDS_CONFIG.INCOMPLETE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
        },
        body: JSON.stringify(payload)
      }).catch(function (err) {
        console.warn('[EDS HUB] Notice: Failed submission alert offline/skipped', err);
      });
    };

    // 6. Client-Side Submit Attempt & Validation Preflight Hook
    // Captures ANY user attempt when user clicks Register but client requirements or native validation block completion
    function handleClientSideSubmitAttempt(triggerSource) {
      // Check native HTML5 validity
      var isNativeInvalid = false;
      if (typeof form.checkValidity === 'function') {
        try {
          isNativeInvalid = !form.checkValidity();
        } catch (_e) {}
      }

      // Check required attachments and critical fields
      var passportInput = form.querySelector('input[name="passport"]');
      var licenseInput = form.querySelector('input[name="dental_license"]');
      var hasPassport = passportInput && passportInput.files && passportInput.files.length > 0;
      var hasLicense = licenseInput && licenseInput.files && licenseInput.files.length > 0;
      var termsInput = form.querySelector('input[name="terms_accepted"]');
      var hasTerms = termsInput ? termsInput.checked : true;
      var dateInput = form.querySelector('input[name="date"]');
      var hasDate = dateInput ? dateInput.value.trim() !== '' : true;
      var sigInput = form.querySelector('input[name="signature"]');
      var hasSig = sigInput ? sigInput.value.trim() !== '' : true;

      var isClientBlocked = isNativeInvalid || !hasPassport || !hasLicense || !hasTerms || !hasDate || !hasSig;

      if (isClientBlocked) {
        window.reportEdsHubSubmissionFailure('CLIENT_VALIDATION_FAILED', {
          trigger: triggerSource,
          native_invalid: isNativeInvalid,
          missing_passport: !hasPassport,
          missing_license: !hasLicense,
          missing_terms: !hasTerms,
          missing_date: !hasDate,
          missing_signature: !hasSig
        });
      }
    }

    // 7. Attach listeners for Submit Button Click, Native Invalid, and Form Submit
    var submitBtn = document.getElementById('registerSubmitBtn') || form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        handleClientSideSubmitAttempt('click');
      }, true);
    }

    // Capture phase listener for native invalid event on any child input
    form.addEventListener('invalid', function () {
      handleClientSideSubmitAttempt('invalid');
    }, true);

    // Capture phase listener on form submit
    form.addEventListener('submit', function () {
      if (typeof form.checkValidity === 'function') {
        try {
          if (!form.checkValidity()) {
            handleClientSideSubmitAttempt('submit');
          }
        } catch (_e) {}
      }
    }, true);

    // 8. Send Completed Form to EDS HUB (Called strictly upon factual Laravel success)
    window.sendEdsHubCompletedForm = function () {
      var emailEl = form.querySelector('input[name="email"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var courseEl = form.querySelector('select[name="course"]');
      var nameEl = form.querySelector('input[name="name"]');
      var certNameEl = form.querySelector('input[name="certificate_name"]');
      var agdEl = form.querySelector('input[name="agd_number"]');
      var specialtyEl = form.querySelector('select[name="specialty"]');
      var yearsEl = form.querySelector('select[name="years_in_practice"]');
      var coatEl = form.querySelector('input[name="coat_size"]');
      var heardEl = form.querySelector('select[name="heard_from"]');
      var referralEl = form.querySelector('input[name="referral_name"]');
      var promoEl = form.querySelector('input[name="promo_code"]');
      var termsEl = form.querySelector('input[name="terms_accepted"]');

      var rawCourse = courseEl ? courseEl.value : '';
      var courseCode = resolveCourseCode(rawCourse);
      var names = parseName(nameEl ? nameEl.value : '');
      var utm = getUtmParams();

      var rawPayload = {
        form_slug: EDS_CONFIG.FORM_SLUG,
        idempotency_key: 'comp_' + attemptId,
        external_attempt_id: attemptId,
        name: nameEl ? nameEl.value.trim() : '',
        first_name: names.first || undefined,
        last_name: names.last || undefined,
        email: emailEl ? emailEl.value.trim().toLowerCase() : '',
        phone: phoneEl ? sanitizePhone(phoneEl.value) : '',
        contact_preference: 'email',
        course: rawCourse,
        course_code: courseCode || null,
        certificate_name: certNameEl ? certNameEl.value.trim() : '',
        agd_number: agdEl ? agdEl.value.trim() : '',
        specialty: specialtyEl ? specialtyEl.value : '',
        years_in_practice: yearsEl ? yearsEl.value : '',
        coat_size: coatEl ? coatEl.value.trim() : '',
        heard_from: heardEl ? heardEl.value : '',
        referral_name: referralEl ? referralEl.value.trim() : '',
        promo_code: promoEl ? promoEl.value.trim() : '',
        terms_accepted: termsEl ? termsEl.checked : true,
        source_page: window.location.origin + window.location.pathname,
        submitted_at: new Date().toISOString(),
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_term: utm.utm_term || null,
        utm_content: utm.utm_content || null
      };

      var payload = sanitizePayloadForEdge(rawPayload);

      // Direct intake to EDS HUB submit-public-form with keepalive
      return fetch(EDS_CONFIG.COMPLETED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
        },
        body: JSON.stringify(payload),
        keepalive: true
      })
      .then(function (res) {
        return res.json();
      })
      .catch(function (err) {
        console.warn('[EDS HUB] Notice: Completed form sync skipped', err);
      });
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
