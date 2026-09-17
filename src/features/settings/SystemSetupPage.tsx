import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { DeleteAllContactsModal } from './components/DeleteAllContactsModal';
import { supabase } from '../../lib/supabase';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Database,
  Trash2,
} from 'lucide-react';
import type { AppSettings } from '../../types';

export function SystemSetupPage() {
  const [activeTab, setActiveTab] = useState<'general' | 'data-management'>('general');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [purgeSuccess, setPurgeSuccess] = useState(false);

  // Modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [defaultSalutation, setDefaultSalutation] = useState('');
  const [timezone, setTimezone] = useState('');
  const [emailFromName, setEmailFromName] = useState('');
  const [emailSendingDomain, setEmailSendingDomain] = useState('');
  const [monthlyNetRevenueTarget, setMonthlyNetRevenueTarget] = useState('50000');
  const [monthlyEnrollmentTarget, setMonthlyEnrollmentTarget] = useState('10');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');

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
      setMonthlyNetRevenueTarget(s.monthly_net_revenue_target !== undefined ? String(s.monthly_net_revenue_target) : '50000');
      setMonthlyEnrollmentTarget(s.monthly_enrollment_target !== undefined ? String(s.monthly_enrollment_target) : '10');
      setDefaultCurrency(s.default_currency || 'USD');
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
          monthly_net_revenue_target: parseFloat(monthlyNetRevenueTarget) || 50000,
          monthly_enrollment_target: parseInt(monthlyEnrollmentTarget, 10) || 10,
          default_currency: defaultCurrency || 'USD',
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

  const handlePurgeSuccess = () => {
    setPurgeSuccess(true);
    setTimeout(() => setPurgeSuccess(false), 8000);
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
    <Layout title="Settings">
      <div className="max-w-3xl space-y-6">
        {/* Settings Navigation Tabs */}
        <div className="flex border-b border-slate-200 gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer font-heading ${
              activeTab === 'general'
                ? 'border-[#08254f] text-[#08254f]'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Sliders className="h-4 w-4" />
            General Settings
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('data-management')}
            className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer font-heading ${
              activeTab === 'data-management'
                ? 'border-[#08254f] text-[#08254f]'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Database className="h-4 w-4" />
            Data Management
          </button>
        </div>

        {/* =============================================================== */}
        {/* TAB 1: GENERAL SETTINGS                                         */}
        {/* =============================================================== */}
        {activeTab === 'general' && (
          <div className="card-executive">
            <div className="px-6 py-5 border-b border-slate-100">
              <h2 className="text-base font-bold font-heading text-[#08254f]">General Settings</h2>
              <p className="text-xs text-slate-500 mt-1">Configure your EDS HUB instance parameters.</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label htmlFor="settings-company-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Company Name
                </label>
                <input
                  id="settings-company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-none"
                />
              </div>

              <div>
                <label htmlFor="settings-salutation" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Default Salutation
                </label>
                <input
                  id="settings-salutation"
                  type="text"
                  value={defaultSalutation}
                  onChange={(e) => setDefaultSalutation(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-none"
                  placeholder="Doc"
                />
                <p className="text-[11px] text-slate-400 mt-1">Used when no lead name is available.</p>
              </div>

              <div>
                <label htmlFor="settings-timezone" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Timezone
                </label>
                <input
                  id="settings-timezone"
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-none"
                  placeholder="America/New_York"
                />
                <p className="text-[11px] text-slate-400 mt-1">IANA timezone identifier (e.g., America/New_York).</p>
              </div>

              <hr className="border-slate-100" />

              <div>
                <label htmlFor="settings-email-from" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email From Name
                </label>
                <input
                  id="settings-email-from"
                  type="text"
                  value={emailFromName}
                  onChange={(e) => setEmailFromName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-none"
                  placeholder="Expert Dental Solutions"
                />
              </div>

              <div>
                <label htmlFor="settings-email-domain" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email Sending Domain
                </label>
                <input
                  id="settings-email-domain"
                  type="text"
                  value={emailSendingDomain}
                  onChange={(e) => setEmailSendingDomain(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-none"
                  placeholder="mail.yourdomain.com"
                />
                <p className="text-[11px] text-slate-400 mt-1">Subdomain configured in Resend for email sending.</p>
              </div>

              {/* Commercial Goals Section */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <h3 className="text-xs font-bold text-[#08254f] font-heading uppercase tracking-wider">
                  Metas Comerciais & Moeda (Phase 4 Block 3)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="settings-rev-target" className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Meta de Receita Líquida ($)
                    </label>
                    <input
                      id="settings-rev-target"
                      type="number"
                      min="0"
                      step="100"
                      value={monthlyNetRevenueTarget}
                      onChange={(e) => setMonthlyNetRevenueTarget(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-hidden font-semibold"
                      placeholder="50000"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Target mensal de Net Revenue.</p>
                  </div>

                  <div>
                    <label htmlFor="settings-enr-target" className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Meta de Matrículas (Alunos)
                    </label>
                    <input
                      id="settings-enr-target"
                      type="number"
                      min="0"
                      step="1"
                      value={monthlyEnrollmentTarget}
                      onChange={(e) => setMonthlyEnrollmentTarget(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-hidden font-semibold"
                      placeholder="10"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Target mensal de novas matrículas.</p>
                  </div>

                  <div>
                    <label htmlFor="settings-currency" className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Moeda Padrão
                    </label>
                    <select
                      id="settings-currency"
                      value={defaultCurrency}
                      onChange={(e) => setDefaultCurrency(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#449bd5] focus:ring-1 focus:ring-[#449bd5] outline-hidden font-semibold bg-white"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="BRL">BRL (R$)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">Moeda padrão da operação.</p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  id="settings-save"
                  type="submit"
                  disabled={isSaving}
                  className="btn-crimson text-xs disabled:opacity-50 cursor-pointer"
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
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Saved successfully
                  </span>
                )}
              </div>
            </form>
          </div>
        )}

        {/* =============================================================== */}
        {/* TAB 2: DATA MANAGEMENT (DANGER ZONE)                            */}
        {/* =============================================================== */}
        {activeTab === 'data-management' && (
          <div className="space-y-6">
            {purgeSuccess && (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-3 text-emerald-800 dark:text-emerald-200 shadow-xs">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-bold">All contacts were successfully deleted.</p>
                  <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90">
                    The database has been cleaned. Leads, activities, notes, tasks, and historical import rows have been removed.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] shadow-[var(--shadow-card)] border border-gray-100 dark:border-slate-800">
              <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Data Management</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Manage contact datasets, maintenance actions, and database cleanup.
                </p>
              </div>

              <div className="p-6 space-y-6">
                {/* Danger Zone Section */}
                <div className="border border-red-200 dark:border-red-900/60 rounded-2xl overflow-hidden bg-red-50/20 dark:bg-red-950/10">
                  <div className="px-5 py-3.5 border-b border-red-100 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/30 flex items-center gap-2 text-red-900 dark:text-red-200">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">Danger Zone</h3>
                  </div>

                  <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 max-w-lg">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">Delete All Contacts</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        Permanently delete all contacts and their related CRM data. This action cannot be undone.
                      </p>
                    </div>

                    <button
                      type="button"
                      id="btn-delete-all-contacts"
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete All Contacts
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete All Contacts Confirmation Modal */}
      <DeleteAllContactsModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onSuccess={handlePurgeSuccess}
      />
    </Layout>
  );
}
