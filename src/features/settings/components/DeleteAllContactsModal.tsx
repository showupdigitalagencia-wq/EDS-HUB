import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  AlertTriangle,
  Loader2,
  X,
  CheckCircle2,
  Users,
  Activity,
  FileText,
  CheckSquare,
  FileSpreadsheet,
} from 'lucide-react';

interface DeleteAllContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface PurgePreviewCounts {
  leads_count: number;
  activities_count: number;
  notes_count: number;
  tasks_count: number;
  imports_count: number;
  import_rows_count: number;
  intake_events_count: number;
  outbound_messages_count: number;
  campaign_recipients_count: number;
  lead_tags_count: number;
}

const REQUIRED_CONFIRMATION = 'DELETE ALL CONTACTS';

export function DeleteAllContactsModal({ isOpen, onClose, onSuccess }: DeleteAllContactsModalProps) {
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingCounts, setIsLoadingCounts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<PurgePreviewCounts | null>(null);

  const fetchPreviewCounts = useCallback(async () => {
    setIsLoadingCounts(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_contacts_purge_preview');
      if (rpcErr) throw rpcErr;
      setCounts(data as PurgePreviewCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview counts');
    } finally {
      setIsLoadingCounts(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setConfirmationInput('');
      setError(null);
      fetchPreviewCounts();
    }
  }, [isOpen, fetchPreviewCounts]);

  if (!isOpen) return null;

  const isConfirmed = confirmationInput.trim() === REQUIRED_CONFIRMATION;

  const handleDelete = async () => {
    if (!isConfirmed || isDeleting) return;

    setIsDeleting(true);
    setError(null);

    try {
      const { data, error: purgeErr } = await supabase.rpc('purge_all_contacts', {
        confirmation_text: confirmationInput.trim(),
      });

      if (purgeErr) throw purgeErr;

      // Broadcast event so other components (Leads list, Pipeline, Dashboard) can clear cache immediately
      window.dispatchEvent(new CustomEvent('leads-purged', { detail: data }));

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete contacts');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-red-200 dark:border-red-900/60 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-red-100 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-red-950 dark:text-red-200">Delete All Contacts?</h3>
              <p className="text-xs text-red-700/80 dark:text-red-400/80">Permanent destructive maintenance action</p>
            </div>
          </div>
          {!isDeleting && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            This will permanently delete all contacts and their related CRM history. This action cannot be undone.
          </p>

          {error && (
            <div className="flex items-center gap-2.5 p-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Counts preview */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Records to be permanently purged:
            </span>

            {isLoadingCounts ? (
              <div className="py-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                Loading current database counts...
              </div>
            ) : counts ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="p-2.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-0.5">
                    <Users className="h-3.5 w-3.5" />
                    <span>Contacts</span>
                  </div>
                  <p className="text-base font-extrabold text-gray-900 dark:text-white">{counts.leads_count}</p>
                </div>

                <div className="p-2.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-0.5">
                    <Activity className="h-3.5 w-3.5" />
                    <span>Activities</span>
                  </div>
                  <p className="text-base font-extrabold text-gray-900 dark:text-white">{counts.activities_count}</p>
                </div>

                <div className="p-2.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-0.5">
                    <FileText className="h-3.5 w-3.5" />
                    <span>Notes</span>
                  </div>
                  <p className="text-base font-extrabold text-gray-900 dark:text-white">{counts.notes_count}</p>
                </div>

                <div className="p-2.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-0.5">
                    <CheckSquare className="h-3.5 w-3.5" />
                    <span>Tasks</span>
                  </div>
                  <p className="text-base font-extrabold text-gray-900 dark:text-white">{counts.tasks_count}</p>
                </div>

                <div className="p-2.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl col-span-2 sm:col-span-2">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-0.5">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>Import Records</span>
                  </div>
                  <p className="text-base font-extrabold text-gray-900 dark:text-white">
                    {counts.imports_count} jobs ({counts.import_rows_count} rows)
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Verification Notice */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>System & Configuration Preservation:</span>
            </div>
            <p>
              Users, settings, pipeline stages, campaigns definitions, email templates, and tags will remain completely intact. No automations will be fired.
            </p>
          </div>

          {/* Typing confirmation input */}
          <div className="space-y-1.5 pt-1">
            <label htmlFor="confirm-purge-input" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              To confirm, type <strong className="font-mono text-red-600 dark:text-red-400">{REQUIRED_CONFIRMATION}</strong> below:
            </label>
            <input
              id="confirm-purge-input"
              type="text"
              autoFocus
              disabled={isDeleting}
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={REQUIRED_CONFIRMATION}
              className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            id="confirm-delete-all-contacts"
            disabled={!isConfirmed || isDeleting}
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Permanently Deleting...
              </>
            ) : (
              'Permanently Delete Contacts'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
