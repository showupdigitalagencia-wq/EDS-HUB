/**
 * =============================================================================
 * EDS HUB Website Form Integration — Client Script (Contact / Course Info)
 * Target Forms: any <form data-eds-slug="..."> (e.g. #contact-form, #course-info-form)
 *
 * The registration form has its own script (eds-register-integration.js).
 *
 * Responsibilities:
 * 1. Tracks a persistent attempt ID per form slug across the tab session.
 * 2. Injects <input type="hidden" name="eds_form_attempt_id"> (and any UTM params
 *    from the page URL) into the form so the Laravel backend can sync the
 *    completed submission server-to-server (EdsHubSyncService).
 * 3. Dispatches DIRECT completed intake to EDS HUB submit-public-form endpoint
 *    in parallel with website submission, ensuring immediate lead ingestion.
 * 4. Bounded retry logic for transient errors (up to 2 retries, no 4xx retries).
 * 5. Non-blocking: EDS HUB failures never prevent submission or redirect.
 * 6. For course info / registration flows with a course field, captures incomplete intent.
 * =============================================================================
 */

(function () {
  'use strict';

  var EDS_CONFIG = {
    INCOMPLETE_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/capture-incomplete-enrollment',
    COMPLETED_URL: 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form',

    // Public anon key (safe for browser exposure; client publishable key)
    PUBLIC_ANON_KEY: 'sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw',

    // Keep in sync with EdsHubSyncService::$courseMap
    COURSE_MAP: {
      'dental implant intensive': 'IDIT-01',
      'intensive dental implant': 'IDIT-01',
      'dental implant advanced': 'ADIE-01',
      'advanced dental implant': 'ADIE-01',
      'zygomatic implant': 'ZIT-01',
      'wisdom teeth': 'WTT-01',
      'advanced implant rehabilitation': 'AIRE-01',
      'perioplastic surgery': 'PST-01',
      'periodontal surgery': 'PST-01',
      'intensive molar endodontics': 'ET-01',
      'endodontics training': 'ET-01',
      'maxillofacial anomalies': 'MAX-01'
    },

    UTM_KEYS: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
  };

  function generateAttemptId() {
    return 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  function attemptKey(slug) {
    return 'eds_form_attempt_id:' + slug;
  }

  // Retrieve or generate attempt ID for this form in this browser tab session
  function getAttemptId(slug) {
    var attemptId = null;
    try {
      attemptId = sessionStorage.getItem(attemptKey(slug));
      if (!attemptId) {
        attemptId = generateAttemptId();
        sessionStorage.setItem(attemptKey(slug), attemptId);
      }
    } catch (_e) {
      attemptId = generateAttemptId();
    }
    return attemptId;
  }

  function getUtmParams() {
    var utm = {};
    try {
      var params = new URLSearchParams(window.location.search);
      EDS_CONFIG.UTM_KEYS.forEach(function (key) {
        utm[key] = params.get(key) || null;
      });
    } catch (_e) {}
    return utm;
  }

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

  // Normalize to E.164. The phone inputs are Cleave-formatted as a US number
  // "(941) 555-0188", so a bare 10-digit number gets the +1 country code.
  // Keep in sync with EdsHubSyncService::normalizePhone().
  function sanitizePhone(rawPhone) {
    if (!rawPhone) return null;
    var cleaned = rawPhone.replace(/[^\d+]/g, '');
    if (!cleaned) return null;
    if (cleaned.charAt(0) === '+') return cleaned;
    if (cleaned.length === 10) return '+1' + cleaned;
    if (cleaned.length === 11 && cleaned.charAt(0) === '1') return '+' + cleaned;
    if (cleaned.length > 10) return '+' + cleaned;
    return cleaned;
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
  }

  function ensureHiddenInput(form, name, value) {
    var input = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
    return input;
  }

  function initForm(form) {
    var slug = form.getAttribute('data-eds-slug');
    var courseSelector = form.getAttribute('data-eds-course');
    var attemptId = getAttemptId(slug);
    var utmParams = getUtmParams();

    // 1. Hidden fields for the server-side completed sync
    ensureHiddenInput(form, 'eds_form_attempt_id', attemptId);
    EDS_CONFIG.UTM_KEYS.forEach(function (key) {
      if (utmParams[key]) ensureHiddenInput(form, key, utmParams[key]);
    });

    function value(selector) {
      var el = form.querySelector(selector);
      return el ? el.value.trim() : '';
    }

    // The course select's value may be an ID, so read the selected label
    function courseLabel() {
      var el = courseSelector ? form.querySelector(courseSelector) : null;
      if (!el || !el.value) return '';
      var option = el.options ? el.options[el.selectedIndex] : null;
      return option ? option.text.trim() : el.value.trim();
    }

    function contactInfo() {
      var names = parseName(value('input[name="name"]'));
      return {
        first_name: names.first,
        last_name: names.last,
        email: value('input[name="email"]').toLowerCase() || null,
        phone: sanitizePhone(value('input[name="phone"]'))
      };
    }

    function completedIdempotencyKey() {
      var key = null;
      try {
        key = sessionStorage.getItem('eds_comp_key:' + slug);
        if (!key) {
          key = 'sub_' + slug + '_' + attemptId;
          sessionStorage.setItem('eds_comp_key:' + slug, key);
        }
      } catch (_e) {
        key = 'sub_' + slug + '_' + attemptId;
      }
      return key;
    }

    var directIntakeInFlight = false;
    var directIntakeCompleted = false;

    // PATH A — PRIMARY: Direct EDS HUB Intake with Bounded Retry
    function dispatchDirectIntake(onFinished) {
      if (directIntakeCompleted) {
        if (typeof onFinished === 'function') onFinished(true);
        return;
      }
      if (directIntakeInFlight) return;

      var contact = contactInfo();
      // Must have at least an email or phone to submit
      if (!contact.email && !contact.phone) {
        if (typeof onFinished === 'function') onFinished(false);
        return;
      }

      directIntakeInFlight = true;
      var rawCourse = courseLabel();
      var messageEl = form.querySelector('textarea[name="message"], input[name="message"]');
      var message = messageEl ? messageEl.value.trim() : '';

      var payload = {
        slug: slug,
        idempotency_key: completedIdempotencyKey(),
        external_attempt_id: attemptId,
        fields: {
          name: (contact.first_name + (contact.last_name ? ' ' + contact.last_name : '')).trim(),
          first_name: contact.first_name,
          last_name: contact.last_name || undefined,
          email: contact.email,
          phone: contact.phone,
          message: message || undefined,
          course: rawCourse || undefined,
          course_interest: rawCourse || undefined,
          source_page: window.location.origin + window.location.pathname,
          submitted_at: new Date().toISOString(),
          utm_source: utmParams.utm_source || undefined,
          utm_medium: utmParams.utm_medium || undefined,
          utm_campaign: utmParams.utm_campaign || undefined,
          utm_term: utmParams.utm_term || undefined,
          utm_content: utmParams.utm_content || undefined
        }
      };

      // Bounded retry helper: 1 initial attempt + up to 2 retries on 5xx/network errors
      function attemptPost(retriesLeft, delay) {
        fetch(EDS_CONFIG.COMPLETED_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': EDS_CONFIG.PUBLIC_ANON_KEY
          },
          body: JSON.stringify(payload),
          keepalive: true
        })
          .then(function (res) {
            if (res.ok) {
              directIntakeCompleted = true;
              directIntakeInFlight = false;
              try { sessionStorage.setItem('eds_direct_done:' + slug, 'true'); } catch (_e) {}
              if (typeof onFinished === 'function') onFinished(true);
            } else if (res.status >= 500 && retriesLeft > 0) {
              // Retry on transient 5xx server errors only
              setTimeout(function () {
                attemptPost(retriesLeft - 1, delay * 2);
              }, delay);
            } else {
              // Deterministic 4xx or retries exhausted: do not retry
              directIntakeInFlight = false;
              if (typeof onFinished === 'function') onFinished(false);
            }
          })
          .catch(function (_err) {
            if (retriesLeft > 0) {
              setTimeout(function () {
                attemptPost(retriesLeft - 1, delay * 2);
              }, delay);
            } else {
              directIntakeInFlight = false;
              if (typeof onFinished === 'function') onFinished(false);
            }
          });
      }

      attemptPost(2, 500); // 2 retries max, 500ms initial backoff
    }

    // Capture-phase listener: fires direct intake in parallel when visitor submits form
    form.addEventListener('submit', function (_e) {
      dispatchDirectIntake();
    }, true);

    var api = {
      // Called after a successful submission so a new submission in the
      // same tab gets a fresh attempt ID (and idempotency key).
      reset: function () {
        try {
          sessionStorage.removeItem(attemptKey(slug));
          sessionStorage.removeItem('eds_comp_key:' + slug);
          sessionStorage.removeItem('eds_direct_done:' + slug);
        } catch (_e) {}
      },
      sendCompleted: function (callback) {
        dispatchDirectIntake(callback);
      },
      reportFailure: function () {}
    };
    form.edsHub = api;

    // Incomplete capture / failure reporting only applies to dedicated course enrollment flows.
    // Course info forms (#course-info-form, /contact) are COURSE INFORMATION REQUESTS, NOT enrollments.
    var isCourseInfoOrContact = (slug === 'course-info-form' || slug === 'contact-form' || slug === 'website-contact' ||
      (window.location && (window.location.pathname.indexOf('/contact') !== -1 || window.location.pathname.indexOf('/request-course-information') !== -1)));

    if (!courseSelector || isCourseInfoOrContact) return;

    var debounceTimer = null;
    var lastCapturedSignature = '';

    // 2. Debounced intent listener (captures incomplete course enquiries)
    function onFieldChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(captureIncompleteAttempt, 1500);
    }

    form.querySelectorAll('input[name="name"], input[name="email"], input[name="phone"], ' + courseSelector).forEach(function (el) {
      el.addEventListener('input', onFieldChange);
      el.addEventListener('change', onFieldChange);
    });

    // 3. Incomplete enquiry → EDS HUB
    function captureIncompleteAttempt() {
      var contact = contactInfo();
      var rawCourse = courseLabel();

      // Only fire if visitor entered contact info AND selected a course
      if ((!contact.email && !contact.phone) || !rawCourse) return;

      var courseCode = resolveCourseCode(rawCourse);
      var signature = (contact.email || '') + '|' + (contact.phone || '') + '|' + rawCourse;
      if (signature === lastCapturedSignature) return;
      lastCapturedSignature = signature;

      var payload = {
        idempotency_key: 'inc_' + attemptId + '_' + (courseCode || 'course'),
        external_attempt_id: attemptId,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        course_code: courseCode || null,
        status: 'needs_followup',
        source_page: window.location.origin + window.location.pathname,
        utm_source: utmParams.utm_source || null,
        utm_medium: utmParams.utm_medium || null,
        utm_campaign: utmParams.utm_campaign || null,
        utm_term: utmParams.utm_term || null,
        utm_content: utmParams.utm_content || null
      };

      postJson(EDS_CONFIG.INCOMPLETE_URL, payload).catch(function (err) {
        console.warn('[EDS HUB] Incomplete capture skipped', err);
      });
    }

    // 4. Failed submission → EDS HUB
    api.reportFailure = function (errorCode) {
      var contact = contactInfo();
      if (!contact.email && !contact.phone) return;

      var payload = {
        idempotency_key: 'fail_' + attemptId + '_' + Date.now(),
        external_attempt_id: attemptId,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        course_code: resolveCourseCode(courseLabel()),
        status: 'submission_failed',
        error_code: String(errorCode || 'SUBMISSION_FAILED').slice(0, 50),
        source_page: window.location.origin + window.location.pathname
      };

      postJson(EDS_CONFIG.INCOMPLETE_URL, payload).catch(function () {});
    };
  }

  // Non-fatal helpers for the page submit handlers
  window.EdsHubForms = {
    reportFailure: function (form, errorCode) {
      try { if (form && form.edsHub) form.edsHub.reportFailure(errorCode); } catch (_e) {}
    },
    sendCompleted: function (form, callback) {
      try {
        if (form && form.edsHub && form.edsHub.sendCompleted) {
          form.edsHub.sendCompleted(callback);
        } else if (typeof callback === 'function') {
          callback(false);
        }
      } catch (_e) {
        if (typeof callback === 'function') callback(false);
      }
    },
    reset: function (form) {
      try { if (form && form.edsHub) form.edsHub.reset(); } catch (_e) {}
    }
  };

  function init() {
    document.querySelectorAll('form[data-eds-slug]').forEach(initForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
