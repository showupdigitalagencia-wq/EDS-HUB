import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { supabase } from '../../lib/supabase';
import { Save, Loader2, CheckCircle2 } from 'lucide-react';
import type { AppSettings } from '../../types';

export function SystemSetupPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [defaultSalutation, setDefaultSalutation] = useState('');
  const [timezone, setTimezone] = useState('');
  const [emailFromName, setEmailFromName] = useState('');
  const [emailSendingDomain, setEmailSendingDomain] = useState('');

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('app_settings')
        .select('*')
        .single();

      if (fetchError) throw fetchError;

      const s = data as AppSettings;
      setSettings(s);
      setCompanyName(s.company_name || '');
      setDefaultSalutation(s.default_salutation || '');
      setTimezone(s.timezone || '');
      setEmailFromName(s.email_from_name || '');
      setEmailSendingDomain(s.email_sending_domain || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('app_settings')
        .update({
          company_name: companyName,
          default_salutation: defaultSalutation,
          timezone: timezone || null,
          email_from_name: emailFromName || null,
          email_sending_domain: emailSendingDomain || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (updateError) throw updateError;

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="System Setup">
        <LoadingState message="Loading settings..." />
      </Layout>
    );
  }

  if (error && !settings) {
    return (
      <Layout title="System Setup">
        <ErrorState message={error} onRetry={fetchSettings} />
      </Layout>
    );
  }

  return (
    <Layout title="System Setup">
      <div className="max-w-2xl">
        <div className="bg-white rounded-[var(--radius-card)] shadow-[var(--shadow-card)] border border-gray-100">
          <div className="px-6 py-5 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">General Settings</h2>
            <p className="text-sm text-gray-500 mt-1">Configure your EDS HUB instance.</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div>
              <label htmlFor="settings-company-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Company Name
              </label>
              <input
                id="settings-company-name"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-[var(--radius-input)] border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="settings-salutation" className="block text-sm font-medium text-gray-700 mb-1.5">
                Default Salutation
              </label>
              <input
                id="settings-salutation"
                type="text"
                value={defaultSalutation}
                onChange={(e) => setDefaultSalutation(e.target.value)}
                className="w-full rounded-[var(--radius-input)] border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="Doc"
              />
              <p className="text-xs text-gray-400 mt-1">Used when no lead name is available.</p>
            </div>

            <div>
              <label htmlFor="settings-timezone" className="block text-sm font-medium text-gray-700 mb-1.5">
                Timezone
              </label>
              <input
                id="settings-timezone"
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-[var(--radius-input)] border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="America/New_York"
              />
              <p className="text-xs text-gray-400 mt-1">IANA timezone identifier (e.g., America/New_York).</p>
            </div>

            <hr className="border-gray-100" />

            <div>
              <label htmlFor="settings-email-from" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email From Name
              </label>
              <input
                id="settings-email-from"
                type="text"
                value={emailFromName}
                onChange={(e) => setEmailFromName(e.target.value)}
                className="w-full rounded-[var(--radius-input)] border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="Expert Dental Solutions"
              />
            </div>

            <div>
              <label htmlFor="settings-email-domain" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email Sending Domain
              </label>
              <input
                id="settings-email-domain"
                type="text"
                value={emailSendingDomain}
                onChange={(e) => setEmailSendingDomain(e.target.value)}
                className="w-full rounded-[var(--radius-input)] border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="mail.yourdomain.com"
              />
              <p className="text-xs text-gray-400 mt-1">Subdomain configured in Resend for email sending.</p>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                id="settings-save"
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 rounded-[var(--radius-button)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save Settings
                  </>
                )}
              </button>

              {saveSuccess && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved successfully
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
