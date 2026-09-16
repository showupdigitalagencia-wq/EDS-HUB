import { useState, useId } from 'react';
import { supabase } from '../../../lib/supabase';
import { parseCsv, type ParsedCsv } from '../utils/csvParser';
import type { ContactPreference, LeadSource } from '../../../types';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Settings2,
} from 'lucide-react';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type DuplicateStrategy = 'update' | 'skip' | 'create';
type Step = 'upload' | 'preview' | 'mapping' | 'strategy' | 'importing' | 'results';

const CRM_FIELDS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'email_confirmation', label: 'Email Confirmation' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'contact_preference', label: 'Contact Preference (email/sms/call)' },
  { key: 'source', label: 'Source (meta/google/manual/test)' },
  { key: 'tags', label: 'Tags (comma-separated)' },
];

export function CsvImportModal({ isOpen, onClose, onImportComplete }: CsvImportModalProps) {
  const fileInputId = useId();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedCsv | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('update');

  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState({
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  });
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = parseCsv(text);
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          setError('The uploaded CSV file contains no valid rows.');
          return;
        }

        setParsedData(parsed);

        // Auto-guess initial mapping based on header name similarity
        const initialMapping: Record<string, string> = {};
        parsed.headers.forEach((header) => {
          const lower = header.toLowerCase().replace(/[^a-z]/g, '');
          if (lower.includes('first') || lower === 'fname') initialMapping[header] = 'first_name';
          else if (lower.includes('last') || lower === 'lname') initialMapping[header] = 'last_name';
          else if (lower.includes('confirm') && lower.includes('email')) initialMapping[header] = 'email_confirmation';
          else if (lower.includes('email') || lower === 'mail') initialMapping[header] = 'email';
          else if (lower.includes('phone') || lower.includes('tel') || lower.includes('cell')) initialMapping[header] = 'phone';
          else if (lower.includes('preference') || lower.includes('contact')) initialMapping[header] = 'contact_preference';
          else if (lower.includes('source') || lower.includes('origin')) initialMapping[header] = 'source';
          else if (lower.includes('tag')) initialMapping[header] = 'tags';
        });

        setColumnMapping(initialMapping);
        setStep('preview');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error reading CSV file');
      }
    };
    reader.readAsText(selected);
  };

  const handleExecuteImport = async () => {
    if (!parsedData || !file) return;

    setStep('importing');
    setImportProgress(0);
    setError(null);

    try {
      // 1. Get default Capture stage ID
      const { data: captureStage } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('code', 'capture')
        .single();

      const defaultStageId = captureStage?.id;
      if (!defaultStageId) {
        throw new Error('Capture pipeline stage not found');
      }

      // 2. Create lead_imports record
      const { data: importRec, error: impErr } = await supabase
        .from('lead_imports')
        .insert({
          filename: file.name,
          status: 'processing',
          total_rows: parsedData.totalRows,
          mapping_config: columnMapping,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (impErr || !importRec) throw impErr || new Error('Failed to create import job');
      const importId = importRec.id;

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      // Invert mapping for quick lookup: { first_name: 'CSV_Col_Name' }
      const fieldToCol: Record<string, string> = {};
      Object.entries(columnMapping).forEach(([col, field]) => {
        if (field) fieldToCol[field] = col;
      });

      // 3. Process rows
      const total = parsedData.rows.length;
      for (let i = 0; i < total; i++) {
        const row = parsedData.rows[i];
        const rowNum = i + 1;

        const firstName = (fieldToCol.first_name ? row[fieldToCol.first_name] : '').trim();
        const lastName = (fieldToCol.last_name ? row[fieldToCol.last_name] : '').trim();
        const email = (fieldToCol.email ? row[fieldToCol.email] : '').trim().toLowerCase();
        const emailConfirmation = (fieldToCol.email_confirmation ? row[fieldToCol.email_confirmation] : '').trim().toLowerCase();
        const phone = (fieldToCol.phone ? row[fieldToCol.phone] : '').trim();
        const rawPref = (fieldToCol.contact_preference ? row[fieldToCol.contact_preference] : '').trim().toLowerCase();
        const rawSource = (fieldToCol.source ? row[fieldToCol.source] : '').trim().toLowerCase();
        const rawTags = (fieldToCol.tags ? row[fieldToCol.tags] : '').trim();

        const contactPreference: ContactPreference = ['email', 'sms', 'call'].includes(rawPref)
          ? (rawPref as ContactPreference)
          : 'email';

        const source: LeadSource = ['meta', 'google', 'manual', 'test'].includes(rawSource)
          ? (rawSource as LeadSource)
          : 'manual';

        if (!firstName && !lastName && !email && !phone) {
          skipped++;
          await supabase.from('lead_import_rows').insert({
            import_id: importId,
            row_number: rowNum,
            raw_data: row,
            status: 'skipped',
            error_message: 'Empty or invalid record',
          });
          continue;
        }

        try {
          // Check for existing lead by email or phone
          let existingLead: { id: string } | null = null;
          if (email) {
            const { data } = await supabase.from('leads').select('id').eq('email', email).maybeSingle();
            existingLead = data;
          }
          if (!existingLead && phone) {
            const { data } = await supabase.from('leads').select('id').eq('phone_raw', phone).maybeSingle();
            existingLead = data;
          }

          let finalLeadId: string | null = null;

          if (existingLead) {
            if (duplicateStrategy === 'skip') {
              skipped++;
              await supabase.from('lead_import_rows').insert({
                import_id: importId,
                row_number: rowNum,
                raw_data: row,
                status: 'skipped',
                lead_id: existingLead.id,
                error_message: 'Duplicate record skipped',
              });
              continue;
            } else if (duplicateStrategy === 'update') {
              // Update existing lead
              const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
              if (firstName) updateData.first_name = firstName;
              if (lastName) updateData.last_name = lastName;
              if (phone) {
                updateData.phone_raw = phone;
                if (phone.startsWith('+')) updateData.phone_e164 = phone;
              }

              await supabase.from('leads').update(updateData).eq('id', existingLead.id);
              finalLeadId = existingLead.id;
              updated++;

              await supabase.from('lead_import_rows').insert({
                import_id: importId,
                row_number: rowNum,
                raw_data: row,
                status: 'updated',
                lead_id: finalLeadId,
              });
            } else {
              // Create new anyway
              const { data: newL, error: insErr } = await supabase
                .from('leads')
                .insert({
                  source,
                  first_name: firstName || null,
                  last_name: lastName || null,
                  email: email || null,
                  email_confirmation: emailConfirmation || null,
                  phone_raw: phone || null,
                  phone_e164: phone.startsWith('+') ? phone : null,
                  contact_preference: contactPreference,
                  pipeline_stage_id: defaultStageId,
                })
                .select('id')
                .single();

              if (insErr) throw insErr;
              finalLeadId = newL!.id;
              created++;

              await supabase.from('lead_import_rows').insert({
                import_id: importId,
                row_number: rowNum,
                raw_data: row,
                status: 'created',
                lead_id: finalLeadId,
              });
            }
          } else {
            // New lead insertion
            const { data: newL, error: insErr } = await supabase
              .from('leads')
              .insert({
                source,
                first_name: firstName || null,
                last_name: lastName || null,
                email: email || null,
                email_confirmation: emailConfirmation || null,
                phone_raw: phone || null,
                phone_e164: phone.startsWith('+') ? phone : null,
                contact_preference: contactPreference,
                pipeline_stage_id: defaultStageId,
              })
              .select('id')
              .single();

            if (insErr) throw insErr;
            finalLeadId = newL!.id;
            created++;

            await supabase.from('lead_import_rows').insert({
              import_id: importId,
              row_number: rowNum,
              raw_data: row,
              status: 'created',
              lead_id: finalLeadId,
            });

            // Initial stage history & activity
            await supabase.from('lead_stage_history').insert({
              lead_id: finalLeadId,
              from_stage_id: null,
              to_stage_id: defaultStageId,
              change_reason: 'initial_assignment',
            });

            await supabase.from('lead_activities').insert({
              lead_id: finalLeadId,
              activity_type: 'lead_created',
              actor_type: 'user',
              summary: `Lead imported from CSV: ${file.name}`,
              metadata: { import_id: importId, filename: file.name },
            });
          }

          // Handle tags if present
          if (finalLeadId && rawTags) {
            const tagNames = rawTags.split(',').map((t) => t.trim()).filter(Boolean);
            for (const tagName of tagNames) {
              const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
              let tagId: string | null = null;
              const { data: exTag } = await supabase.from('tags').select('id').eq('slug', slug).maybeSingle();
              if (exTag) {
                tagId = exTag.id;
              } else {
                const { data: newT } = await supabase.from('tags').insert({ name: tagName, slug }).select('id').single();
                tagId = newT?.id || null;
              }
              if (tagId) {
                await supabase.from('lead_tags').upsert(
                  { lead_id: finalLeadId, tag_id: tagId },
                  { onConflict: 'lead_id,tag_id' },
                );
              }
            }
          }
        } catch (rowErr) {
          failed++;
          await supabase.from('lead_import_rows').insert({
            import_id: importId,
            row_number: rowNum,
            raw_data: row,
            status: 'failed',
            error_message: rowErr instanceof Error ? rowErr.message : 'Unknown error',
          });
        }

        setImportProgress(Math.round(((i + 1) / total) * 100));
      }

      // 4. Update import status
      const finalStatus = failed > 0 ? (created > 0 || updated > 0 ? 'completed_with_errors' : 'failed') : 'completed';
      await supabase
        .from('lead_imports')
        .update({
          status: finalStatus,
          processed_rows: total,
          created_count: created,
          updated_count: updated,
          skipped_count: skipped,
          failed_count: failed,
          completed_at: new Date().toISOString(),
        })
        .eq('id', importId);

      setResults({ total, created, updated, skipped, failed });
      setStep('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('strategy');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Import Leads from CSV</h2>
              <p className="text-xs text-gray-500">6-step clean import wizard without automatic triggers</p>
            </div>
          </div>
          {step !== 'importing' && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Wizard content */}
        <div className="p-6 flex-1">
          {error && (
            <div className="flex items-center gap-2 p-3.5 mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-brand-400 rounded-2xl p-10 text-center transition-colors bg-gray-50/50">
              <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4 shadow-xs">
                <UploadCloud className="h-7 w-7" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Choose CSV file to import</h3>
              <p className="text-xs text-gray-500 max-w-sm mb-5">
                Upload contacts exported from Meta, Google, or your previous CRM. Comma-separated files are supported.
              </p>
              <label
                htmlFor={fileInputId}
                className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl cursor-pointer shadow-xs transition-colors"
              >
                Browse CSV File
              </label>
              <input
                id={fileInputId}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}

          {/* STEP 2: PREVIEW */}
          {step === 'preview' && parsedData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">File Preview: {file?.name}</h4>
                  <p className="text-xs text-gray-500">Detected {parsedData.totalRows} rows and {parsedData.headers.length} columns</p>
                </div>
                <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg">
                  Previewing first 5 rows
                </span>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {parsedData.headers.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-semibold text-gray-700 truncate max-w-[150px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {parsedData.rows.slice(0, 5).map((r, rIdx) => (
                      <tr key={rIdx}>
                        {parsedData.headers.map((h, cIdx) => (
                          <td key={cIdx} className="px-3 py-2 text-gray-600 truncate max-w-[150px]">
                            {r[h] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 3: MAPPING */}
          {step === 'mapping' && parsedData && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Map CSV Columns to CRM Fields</h4>
                <p className="text-xs text-gray-500">Select which column corresponds to each lead field</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
                {parsedData.headers.map((header) => (
                  <div key={header} className="p-3 border border-gray-200 rounded-xl bg-gray-50/60 flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-gray-700 truncate" title={header}>
                      CSV Header: <strong className="text-gray-900">{header}</strong>
                    </span>
                    <select
                      value={columnMapping[header] || ''}
                      onChange={(e) =>
                        setColumnMapping({ ...columnMapping, [header]: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">-- Ignore column --</option>
                      {CRM_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: STRATEGY & VALIDATION */}
          {step === 'strategy' && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Duplicate Resolution Strategy</h4>
                <p className="text-xs text-gray-500">
                  How should existing leads with identical email or phone be handled?
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    key: 'update',
                    title: 'Update existing lead (Recommended)',
                    desc: 'Keeps existing stage & history, updates contact fields with fresh CSV data.',
                  },
                  {
                    key: 'skip',
                    title: 'Skip duplicate',
                    desc: 'Do not modify existing leads; only import brand new contacts.',
                  },
                  {
                    key: 'create',
                    title: 'Create new separate record',
                    desc: 'Creates a distinct lead record even if email/phone matches.',
                  },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    onClick={() => setDuplicateStrategy(opt.key as DuplicateStrategy)}
                    className={`flex items-start gap-3 p-3.5 border rounded-xl cursor-pointer transition-all ${
                      duplicateStrategy === opt.key
                        ? 'border-brand-500 bg-brand-50/50 shadow-xs'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="strategy"
                      checked={duplicateStrategy === opt.key}
                      onChange={() => setDuplicateStrategy(opt.key as DuplicateStrategy)}
                      className="mt-0.5 text-brand-600 focus:ring-brand-500"
                    />
                    <div>
                      <p className="text-xs font-semibold text-gray-900">{opt.title}</p>
                      <p className="text-[11px] text-gray-500 leading-normal">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                <Settings2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Safety Notice:</strong> Importing leads does not send emails, SMS, or trigger automatic pipeline advancement.
                </span>
              </div>
            </div>
          )}

          {/* STEP 5: IMPORTING */}
          {step === 'importing' && (
            <div className="py-12 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-brand-600 mx-auto" />
              <div>
                <h4 className="text-base font-bold text-gray-900">Importing Leads...</h4>
                <p className="text-xs text-gray-500">Processing rows, normalizing data and mapping tags</p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 max-w-md mx-auto overflow-hidden">
                <div
                  className="bg-brand-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <p className="text-xs font-medium text-gray-600">{importProgress}% completed</p>
            </div>
          )}

          {/* STEP 6: RESULTS */}
          {step === 'results' && (
            <div className="py-6 text-center space-y-5">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-gray-900">Import Completed Successfully</h4>
                <p className="text-xs text-gray-500">Processed {results.total} total rows from {file?.name}</p>
              </div>

              <div className="grid grid-cols-4 gap-3 max-w-lg mx-auto">
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-lg font-bold text-emerald-700">{results.created}</p>
                  <p className="text-[11px] font-medium text-emerald-600">Created</p>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-lg font-bold text-blue-700">{results.updated}</p>
                  <p className="text-[11px] font-medium text-blue-600">Updated</p>
                </div>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <p className="text-lg font-bold text-gray-700">{results.skipped}</p>
                  <p className="text-[11px] font-medium text-gray-600">Skipped</p>
                </div>
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-lg font-bold text-red-700">{results.failed}</p>
                  <p className="text-[11px] font-medium text-red-600">Failed</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
              >
                Next: Map Fields <ArrowRight className="h-4 w-4" />
              </button>
            </>
          )}

          {step === 'mapping' && (
            <>
              <button
                type="button"
                onClick={() => setStep('preview')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => setStep('strategy')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
              >
                Next: Duplicate Rules <ArrowRight className="h-4 w-4" />
              </button>
            </>
          )}

          {step === 'strategy' && (
            <>
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors"
              >
                Start Import ({parsedData?.totalRows} rows)
              </button>
            </>
          )}

          {step === 'results' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onImportComplete();
                  onClose();
                }}
                className="px-5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
