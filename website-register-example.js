/**
 * =============================================================================
 * EDS HUB Website Registration Integration — Browser Client Script
 * Target: https://www.expdentalsolutions.com/register
 * Target Form: #registerForm
 * 
 * Features:
 * 1. INCOMPLETE ATTEMPT CAPTURE: Automatically notifies EDS HUB when a visitor
 *    enters contact info (email/phone) and selects a course, but has not completed.
 * 2. ATTEMPT CONTINUITY: Maintains attempt UUID across user input via sessionStorage.
 * 3. FAILED SUBMISSION NOTIFICATION: If the form submit fails (e.g., validation/server
 *    error), records factual attempt and notifies EDS HUB for proactive followup.
 * 4. COMPLETED SUBMISSION SYNC: Dispatches completed registration to EDS HUB upon
 *    successful form completion.
 * 5. PRIVACY FILTER: Strictly excludes passwords, credit cards, medical notes,
 *    and file upload binaries.
 * 6. ZERO PRIVATE SECRETS: Uses only the public anon key.
 * =============================================================================
 */

(function () {
  'use strict';

  var EDS_CONFIG = {
    INCOMPLETE_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/capture-incomplete-enrollment',
    COMPLETED_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form',
    PUBLIC_ANON_KEY: 'sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw',
    FORM_SLUG: 'website-register',

    // Mapping from live website course select option text to canonical EDS HUB course codes
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

  // Generate or retrieve persistent attempt ID for this browser tab session
  function getAttemptId() {
    var key = 'eds_form_attempt_id';
    var attemptId = sessionStorage.getItem(key);
    if (!attemptId) {
      attemptId = 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem(key, attemptId);
    }
    return attemptId;
  }

  // Safe UUID v4 generator
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Extract URL parameters (UTM tags)
  function getUtmParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_term: params.get('utm_term') || null,
      utm_content: params.get('utm_content') || null
    };
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

  // Parse name into first and last name
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

  // Init when DOM is ready
  function initEdsIntegration() {
    var form = document.getElementById('registerForm');
    if (!form) return;

    var attemptId = getAttemptId();

    // Ensure hidden input for attempt tracking exists in form
    var hiddenInput = form.querySelector('input[name="eds_form_attempt_id"]');
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = 'eds_form_attempt_id';
      hiddenInput.value = attemptId;
      form.appendChild(hiddenInput);
    }

    var debounceTimer = null;
    var lastCapturedData = '';

    // Listen to changes for meaningful incomplete attempt capture
    function handleInputChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(captureIncompleteAttempt, 1500);
    }

    form.querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('input', handleInputChange);
      el.addEventListener('change', handleInputChange);
    });

    // Capture Incomplete Attempt (Debounced)
    function captureIncompleteAttempt() {
      var emailInput = form.querySelector('input[name="email"]');
      var phoneInput = form.querySelector('input[name="phone"]');
      var courseSelect = form.querySelector('select[name="course"]');
      var nameInput = form.querySelector('input[name="name"]');

      var email = emailInput ? emailInput.value.trim() : '';
      var phone = phoneInput ? phoneInput.value.trim() : '';
      var rawCourse = courseSelect ? courseSelect.value : '';
      var name = nameInput ? nameInput.value.trim() : '';

      // Only capture if meaningful contact info + course selected
      if ((!email && !phone) || !rawCourse) return;

      var courseCode = resolveCourseCode(rawCourse);
      var currentSig = email + '|' + phone + '|' + rawCourse;
      if (currentSig === lastCapturedData) return; // avoid duplicate calls for same state
      lastCapturedData = currentSig;

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
        source_page: window.location.origin + window.location.pathname,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_term: utm.utm_term,
        utm_content: utm.utm_content
      };

      fetch(EDS_CONFIG.INCOMPLETE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
        },
        body: JSON.stringify(payload)
      }).catch(function (err) {
        console.warn('[EDS HUB] Incomplete attempt notice:', err);
      });
    }

    // Expose Global Helper for Completed Submission (to be called upon Laravel 200 OK)
    window.sendEdsHubCompletedForm = function () {
      var emailInput = form.querySelector('input[name="email"]');
      var phoneInput = form.querySelector('input[name="phone"]');
      var courseSelect = form.querySelector('select[name="course"]');
      var nameInput = form.querySelector('input[name="name"]');
      var specialtySelect = form.querySelector('select[name="specialty"]');
      var yearsSelect = form.querySelector('select[name="years_in_practice"]');
      var surgicalSelect = form.querySelector('select[name="surgical_experience"]');
      var agdInput = form.querySelector('input[name="agd_number"]');
      var heardSelect = form.querySelector('select[name="heard_from"]');
      var referralInput = form.querySelector('input[name="referral_name"]');
      var promoInput = form.querySelector('input[name="promo_code"]');
      var termsCheck = form.querySelector('input[name="terms_accepted"]');

      var rawCourse = courseSelect ? courseSelect.value : '';
      var courseCode = resolveCourseCode(rawCourse);
      var names = parseName(nameInput ? nameInput.value : '');
      var utm = getUtmParams();

      var idempotencyKey = 'comp_' + attemptId;

      var payload = {
        form_slug: EDS_CONFIG.FORM_SLUG,
        idempotency_key: idempotencyKey,
        external_attempt_id: attemptId,
        first_name: names.first,
        last_name: names.last,
        name: nameInput ? nameInput.value.trim() : '',
        email: emailInput ? emailInput.value.trim() : '',
        phone: phoneInput ? phoneInput.value.trim() : '',
        contact_preference: 'email',
        course: rawCourse,
        course_code: courseCode || null,
        specialty: specialtySelect ? specialtySelect.value : '',
        years_in_practice: yearsSelect ? yearsSelect.value : '',
        surgical_experience: surgicalSelect ? surgicalSelect.value : '',
        agd_number: agdInput ? agdInput.value.trim() : '',
        heard_from: heardSelect ? heardSelect.value : '',
        referral_name: referralInput ? referralInput.value.trim() : '',
        promo_code: promoInput ? promoInput.value.trim() : '',
        terms_accepted: termsCheck ? termsCheck.checked : true,
        source_page: window.location.origin + window.location.pathname,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_term: utm.utm_term,
        utm_content: utm.utm_content
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
        // Clear attempt session upon successful completion
        sessionStorage.removeItem('eds_form_attempt_id');
        return data;
      })
      .catch(function (err) {
        console.warn('[EDS HUB] Completed sync notice:', err);
      });
    };

    // Report Failed Submission to EDS HUB (for proactive alerts)
    window.reportEdsHubSubmissionFailure = function (errorCode, errorMessage) {
      var emailInput = form.querySelector('input[name="email"]');
      var phoneInput = form.querySelector('input[name="phone"]');
      var courseSelect = form.querySelector('select[name="course"]');
      var nameInput = form.querySelector('input[name="name"]');

      var email = emailInput ? emailInput.value.trim() : '';
      var phone = phoneInput ? phoneInput.value.trim() : '';
      if (!email && !phone) return;

      var rawCourse = courseSelect ? courseSelect.value : '';
      var courseCode = resolveCourseCode(rawCourse);
      var names = parseName(nameInput ? nameInput.value : '');

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEdsIntegration);
  } else {
    initEdsIntegration();
  }
})();
