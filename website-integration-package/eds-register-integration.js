/**
 * =============================================================================
 * EDS HUB Website Registration Integration — Production Client Script
 * Target URL: https://www.expdentalsolutions.com/register
 * Target Form: #registerForm
 * 
 * Version: 2.0 (Production Release)
 * 
 * Responsibilities:
 * 1. Automatically tracks persistent attempt ID across session.
 * 2. Injects hidden field <input type="hidden" name="eds_form_attempt_id"> into #registerForm.
 * 3. Captures INCOMPLETE registration intent (debounced 1.5s) when visitor enters contact + course.
 * 4. Captures SUBMISSION FAILURES (validation error, captcha error, network timeout) with diagnostics.
 * 5. Hooks into COMPLETED submissions (HTTP 200) to notify EDS HUB (Option A or Option B).
 * 6. Strictly excludes sensitive health notes (medical_conditions), dietary info, and binary uploads.
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
    if (!trimmed) return { first: 'Lead', last: null };
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

    // 2. Debounced Intent Listener (captures incomplete registrations)
    function onFieldChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(captureIncompleteAttempt, 1500);
    }

    form.querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('input', onFieldChange);
      el.addEventListener('change', onFieldChange);
    });

    // 3. Dispatch Incomplete Registration to EDS HUB
    function captureIncompleteAttempt() {
      var emailEl = form.querySelector('input[name="email"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var courseEl = form.querySelector('select[name="course"]');
      var nameEl = form.querySelector('input[name="name"]');

      var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
      var phone = phoneEl ? sanitizePhone(phoneEl.value) : '';
      var rawCourse = courseEl ? courseEl.value : '';
      var name = nameEl ? nameEl.value.trim() : '';

      // Only fire if visitor entered contact info AND selected a course
      if ((!email && !phone) || !rawCourse) return;

      var courseCode = resolveCourseCode(rawCourse);
      var signature = (email || '') + '|' + (phone || '') + '|' + rawCourse;
      if (signature === lastCapturedSignature) return; // avoid duplicate requests
      lastCapturedSignature = signature;

      var names = parseName(name);
      var utm = getUtmParams();

      var payload = {
        idempotency_key: 'inc_' + attemptId + '_' + (courseCode || 'course'),
        external_attempt_id: attemptId,
        first_name: names.first,
        last_name: names.last,
        email: email || null,
        phone: phone || null,
        course_code: courseCode || null,
        status: 'needs_followup',
        source_page: window.location.origin + window.location.pathname,
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_term: utm.utm_term || null,
        utm_content: utm.utm_content || null
      };

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

    // 4. Report Failed Submission to EDS HUB (for proactive alerts)
    window.reportEdsHubSubmissionFailure = function (errorCode, errorMessage) {
      var emailEl = form.querySelector('input[name="email"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var courseEl = form.querySelector('select[name="course"]');
      var nameEl = form.querySelector('input[name="name"]');

      var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
      var phone = phoneEl ? sanitizePhone(phoneEl.value) : '';
      if (!email && !phone) return;

      var rawCourse = courseEl ? courseEl.value : '';
      var courseCode = resolveCourseCode(rawCourse);
      var names = parseName(nameEl ? nameEl.value : '');

      var payload = {
        idempotency_key: 'fail_' + attemptId + '_' + Date.now(),
        external_attempt_id: attemptId,
        first_name: names.first,
        last_name: names.last,
        email: email || null,
        phone: phone || null,
        course_code: courseCode || null,
        status: 'submission_failed',
        error_code: String(errorCode || 'SUBMISSION_FAILED').slice(0, 50),
        source_page: window.location.origin + window.location.pathname
      };

      fetch(EDS_CONFIG.INCOMPLETE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
        },
        body: JSON.stringify(payload)
      }).catch(function () {});
    };

    // 5. Send Completed Form to EDS HUB (Used in Option A)
    window.sendEdsHubCompletedForm = function () {
      var emailEl = form.querySelector('input[name="email"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var courseEl = form.querySelector('select[name="course"]');
      var nameEl = form.querySelector('input[name="name"]');
      var certNameEl = form.querySelector('input[name="certificate_name"]');
      var agdEl = form.querySelector('input[name="agd_number"]');
      var specialtyEl = form.querySelector('select[name="specialty"]');
      var yearsEl = form.querySelector('select[name="years_in_practice"]');
      var surgicalEl = form.querySelector('select[name="surgical_experience"]');
      var coatEl = form.querySelector('input[name="coat_size"]');
      var heardEl = form.querySelector('select[name="heard_from"]');
      var referralEl = form.querySelector('input[name="referral_name"]');
      var promoEl = form.querySelector('input[name="promo_code"]');
      var termsEl = form.querySelector('input[name="terms_accepted"]');

      var rawCourse = courseEl ? courseEl.value : '';
      var courseCode = resolveCourseCode(rawCourse);
      var names = parseName(nameEl ? nameEl.value : '');
      var utm = getUtmParams();

      var payload = {
        form_slug: EDS_CONFIG.FORM_SLUG,
        idempotency_key: 'comp_' + attemptId,
        external_attempt_id: attemptId,
        name: nameEl ? nameEl.value.trim() : '',
        first_name: names.first,
        last_name: names.last,
        email: emailEl ? emailEl.value.trim().toLowerCase() : '',
        phone: phoneEl ? sanitizePhone(phoneEl.value) : '',
        contact_preference: 'email',
        course: rawCourse,
        course_code: courseCode || null,
        certificate_name: certNameEl ? certNameEl.value.trim() : '',
        agd_number: agdEl ? agdEl.value.trim() : '',
        specialty: specialtyEl ? specialtyEl.value : '',
        years_in_practice: yearsEl ? yearsEl.value : '',
        surgical_experience: surgicalEl ? surgicalEl.value : '',
        coat_size: coatEl ? coatEl.value.trim() : '',
        heard_from: heardEl ? heardEl.value : '',
        referral_name: referralEl ? referralEl.value.trim() : '',
        promo_code: promoEl ? promoEl.value.trim() : '',
        terms_accepted: termsEl ? termsEl.checked : true,
        source_page: window.location.origin + window.location.pathname,
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_term: utm.utm_term || null,
        utm_content: utm.utm_content || null
      };

      return fetch(EDS_CONFIG.COMPLETED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
        },
        body: JSON.stringify(payload)
      })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        try { sessionStorage.removeItem('eds_form_attempt_id'); } catch (_e) {}
        return data;
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
