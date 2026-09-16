import { useState, useEffect, useCallback, useId } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicFormDefinition, PublicFormField } from '../../../types';
import {
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Phone,
  Mail,
  ArrowRight,
  Clock,
} from 'lucide-react';

export function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();

  const [formDef, setFormDef] = useState<PublicFormDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form values & validation state
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [renderTimestamp, setRenderTimestamp] = useState<number>(0);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ message: string; redirectUrl: string | null } | null>(null);

  const hpFieldId = useId();

  // Load public form definition from Edge Function
  const fetchFormDefinition = useCallback(async (formSlug: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(
        `${supabaseUrl}/functions/v1/submit-public-form?slug=${encodeURIComponent(formSlug)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
          },
        }
      );

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('This form is either inactive or does not exist.');
        }
        throw new Error('Failed to load form. Please try again later.');
      }

      const data: PublicFormDefinition = await res.json();
      setFormDef(data);

      // Initialize default values
      const initialValues: Record<string, unknown> = {};
      for (const field of data.fields) {
        if (field.field_type === 'contact_preference') {
          initialValues[field.internal_name] = 'email';
        } else if (field.field_type === 'checkbox') {
          initialValues[field.internal_name] = false;
        } else {
          initialValues[field.internal_name] = '';
        }
      }
      setFieldValues(initialValues);

      // Initialize anti-bot & idempotency parameters
      setIdempotencyKey(`form_${formSlug}_${crypto.randomUUID()}`);
      setRenderTimestamp(Date.now());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error loading form');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (slug) {
      fetchFormDefinition(slug);
    }
  }, [slug, fetchFormDefinition]);

  const handleFieldChange = (name: string, value: unknown) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (validationErrors[name]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validateForm = (): boolean => {
    if (!formDef) return false;
    const errors: Record<string, string> = {};

    for (const field of formDef.fields) {
      const val = fieldValues[field.internal_name];

      // Required check
      if (field.required) {
        if (val === undefined || val === null || String(val).trim() === '' || val === false) {
          errors[field.internal_name] = `${field.label} is required.`;
          continue;
        }
      }

      // Email format check
      if (field.field_type === 'email' && val) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(val).trim())) {
          errors[field.internal_name] = 'Please enter a valid email address.';
        }
      }

      // Phone format check
      if (field.field_type === 'phone' && val) {
        const digits = String(val).replace(/\D/g, '');
        if (digits.length < 7) {
          errors[field.internal_name] = 'Please enter a complete phone number.';
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDef || isSubmitting) return;

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const payload = {
        slug: formDef.slug,
        idempotency_key: idempotencyKey,
        render_timestamp: renderTimestamp,
        _hp_company: honeypot,
        fields: fieldValues,
      };

      const res = await fetch(`${supabaseUrl}/functions/v1/submit-public-form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        throw new Error('Too many submissions from this location. Please wait a few minutes before trying again.');
      }

      const responseData = await res.json();

      if (!res.ok) {
        throw new Error(responseData.error || 'Failed to submit form. Please check your information.');
      }

      setIsSubmitted(true);
      setSuccessInfo({
        message: responseData.message || formDef.success_message,
        redirectUrl: responseData.redirect_url || formDef.redirect_url,
      });

      // Handle optional redirect
      const finalRedirect = responseData.redirect_url || formDef.redirect_url;
      if (finalRedirect && finalRedirect.startsWith('http')) {
        setTimeout(() => {
          window.location.href = finalRedirect;
        }, 2000);
      }
    } catch (err) {
      setSubmissionError(err instanceof Error ? err.message : 'An error occurred during submission');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">Loading form...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError || !formDef) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Form Unavailable</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {loadError || 'The requested form could not be found or has been deactivated.'}
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 sm:p-10 text-center space-y-5 animate-scaleUp">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Submission Received</h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              {successInfo?.message || 'Thank you for your submission! We will get in touch shortly.'}
            </p>
          </div>

          {successInfo?.redirectUrl && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 flex items-center justify-center gap-2">
              <Clock className="h-4 w-4 animate-spin text-brand-600" />
              <span>Redirecting you shortly...</span>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Encrypted & Secured by EDS HUB</span>
          </div>
        </div>
      </div>
    );
  }

  // Form Render
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 flex flex-col justify-center">
      <div className="max-w-xl w-full mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide uppercase">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verified Intake
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {formDef.name}
          </h1>
          {formDef.description && (
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              {formDef.description}
            </p>
          )}
        </div>

        {/* Form Container */}
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-lg border border-slate-200/80 p-6 sm:p-10">
          {submissionError && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <span>{submissionError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Honeypot field (hidden from human visitors) */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                opacity: 0,
                top: 0,
                left: 0,
                height: 0,
                width: 0,
                zIndex: -1,
                overflow: 'hidden',
              }}
            >
              <label htmlFor={hpFieldId}>Do not fill this field</label>
              <input
                id={hpFieldId}
                type="text"
                name="_hp_company"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            {/* Dynamic Fields */}
            {formDef.fields.map((field: PublicFormField) => {
              const value = fieldValues[field.internal_name];
              const error = validationErrors[field.internal_name];

              return (
                <div key={field.internal_name} className="space-y-1.5">
                  <label
                    htmlFor={`field-${field.internal_name}`}
                    className="block text-xs font-semibold text-slate-700"
                  >
                    {field.label}
                    {field.required && <span className="text-rose-500 ml-1 font-bold">*</span>}
                  </label>

                  {/* Field Type: contact_preference */}
                  {field.field_type === 'contact_preference' ? (
                    <div className="grid grid-cols-3 gap-2.5 pt-1">
                      {[
                        { key: 'email', label: 'Email', icon: Mail },
                        { key: 'sms', label: 'SMS Text', icon: Phone },
                        { key: 'call', label: 'Phone Call', icon: Phone },
                      ].map((item) => {
                        const isSelected = value === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => handleFieldChange(field.internal_name, item.key)}
                            className={`p-3 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all ${
                              isSelected
                                ? 'bg-brand-50 border-brand-500 text-brand-800 ring-2 ring-brand-500/20 shadow-xs'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                          >
                            <item.icon className={`h-4 w-4 ${isSelected ? 'text-brand-600' : 'text-slate-400'}`} />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : field.field_type === 'course_interest' || field.field_type === 'select' ? (
                    /* Field Type: select / course_interest */
                    <div className="relative">
                      <select
                        id={`field-${field.internal_name}`}
                        value={String(value || '')}
                        onChange={(e) => handleFieldChange(field.internal_name, e.target.value)}
                        className={`w-full px-3.5 py-2.5 rounded-xl border text-sm bg-white appearance-none focus:outline-none focus:ring-2 transition-colors ${
                          error
                            ? 'border-rose-300 focus:ring-rose-500 text-rose-900'
                            : 'border-slate-300 focus:ring-brand-500 text-slate-900'
                        }`}
                      >
                        <option value="">{field.placeholder || 'Select an option...'}</option>
                        {field.options.map((opt: string) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                        </svg>
                      </div>
                    </div>
                  ) : field.field_type === 'textarea' ? (
                    /* Field Type: textarea */
                    <textarea
                      id={`field-${field.internal_name}`}
                      rows={3}
                      value={String(value || '')}
                      placeholder={field.placeholder || ''}
                      onChange={(e) => handleFieldChange(field.internal_name, e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-colors ${
                        error
                          ? 'border-rose-300 focus:ring-rose-500 text-rose-900'
                          : 'border-slate-300 focus:ring-brand-500 text-slate-900'
                      }`}
                    />
                  ) : field.field_type === 'checkbox' ? (
                    /* Field Type: checkbox */
                    <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => handleFieldChange(field.internal_name, e.target.checked)}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-4 w-4 mt-0.5"
                      />
                      <span className="text-xs text-slate-600 leading-relaxed">
                        {field.placeholder || field.label}
                      </span>
                    </label>
                  ) : (
                    /* Default text / email / phone inputs */
                    <input
                      id={`field-${field.internal_name}`}
                      type={
                        field.field_type === 'email'
                          ? 'email'
                          : field.field_type === 'phone'
                          ? 'tel'
                          : 'text'
                      }
                      value={String(value || '')}
                      placeholder={field.placeholder || ''}
                      onChange={(e) => handleFieldChange(field.internal_name, e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-colors ${
                        error
                          ? 'border-rose-300 focus:ring-rose-500 text-rose-900'
                          : 'border-slate-300 focus:ring-brand-500 text-slate-900'
                      }`}
                    />
                  )}

                  {field.help_text && (
                    <p className="text-[11px] text-slate-400">{field.help_text}</p>
                  )}

                  {error && (
                    <p className="text-xs text-rose-600 font-medium flex items-center gap-1">
                      <span>•</span>
                      <span>{error}</span>
                    </p>
                  )}
                </div>
              );
            })}

            {/* Submit Button */}
            <div className="pt-3">
              <button
                type="submit"
                id="btn-public-submit"
                disabled={isSubmitting}
                className="w-full py-3.5 px-4 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold text-sm rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Processing submission...</span>
                  </>
                ) : (
                  <>
                    <span>{formDef.submit_button_text || 'Submit'}</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>

            <div className="pt-2 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
              <span>Your personal information is secure and never shared.</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
