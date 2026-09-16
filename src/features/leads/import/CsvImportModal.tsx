import { useState, useId } from 'react';
import { supabase } from '../../../lib/supabase';
import { parseCsv, type ParsedCsv } from '../utils/csvParser';
import { mapCsvStatusToStageCode } from '../utils/stageMapping';
import {
  mapHubspotQualificationStatus,
  getQualificationStatusLabel,
  normalizePhoneDigits,
} from '../utils/qualificationMapping';
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
  ShieldAlert,
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
  { key: 'hubspot_contact_id', label: 'HubSpot Record ID' },
  { key: 'qualification_status', label: 'Qualification Status' },
  { key: 'course_interest', label: 'Course of Interest' },
  { key: 'contact_preference', label: 'Contact Preference (email/sms/call)' },
  { key: 'source', label: 'Source (meta/google/manual/test)' },
  { key: 'status', label: 'Pipeline Stage / Status' },
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
    conflicts: 0,
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

        // Auto-guess initial mapping based on header name similarity (English & Portuguese HubSpot headers)
        const initialMapping: Record<string, string> = {};
        parsed.headers.forEach((header) => {
          const lower = header.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (lower.includes('recordid') || lower === 'hubspotid') {
            initialMapping[header] = 'hubspot_contact_id';
          } else if (lower.includes('qualificacao') || lower.includes('qualification')) {
            initialMapping[header] = 'qualification_status';
          } else if (lower.includes('curso') || lower.includes('course')) {
            initialMapping[header] = 'course_interest';
          } else if (lower.includes('first') || lower === 'fname') {
            initialMapping[header] = 'first_name';
          } else if (lower.includes('last') || lower === 'lname') {
            initialMapping[header] = 'last_name';
          } else if (lower.includes('confirm') && lower.includes('email')) {
            initialMapping[header] = 'email_confirmation';
          } else if (lower.includes('email') || lower === 'mail') {
            initialMapping[header] = 'email';
          } else if (lower.includes('phone') || lower.includes('tel') || lower.includes('cell')) {
            initialMapping[header] = 'phone';
          } else if (lower.includes('preference') || lower.includes('preferredchannel')) {
            initialMapping[header] = 'contact_preference';
          } else if (lower.includes('source') || lower.includes('origin')) {
            initialMapping[header] = 'source';
          } else if (
            lower.includes('status') ||
            lower.includes('stage') ||
            lower.includes('lifecycle') ||
            lower.includes('pipeline')
          ) {
            initialMapping[header] = 'status';
          } else if (lower.includes('tag')) {
            initialMapping[header] = 'tags';
          }
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
      // 1. Get active pipeline stages dynamically with sort_order
      const { data: stages, error: stagesErr } = await supabase
        .from('pipeline_stages')
        .select('id, code, name, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (stagesErr || !stages) {
        throw stagesErr || new Error('Failed to load active pipeline stages');
      }

      const stageByCode = new Map(stages.map((s) => [s.code, s]));
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const captureStage = stageByCode.get('capture');
      const qualificationStage = stageByCode.get('qualification');
      if (!captureStage) {
        throw new Error('Capture pipeline stage not found');
      }
      const defaultStageId = captureStage.id;

      // 2. Pre-fetch all existing leads to build in-memory O(1) safe matching indexes
      const { data: existingLeadsData, error: leadsErr } = await supabase
        .from('leads')
        .select('id, email, phone_raw, phone_e164, hubspot_contact_id, external_lead_id, pipeline_stage_id, qualification_status, first_name, last_name, course_interest');

      if (leadsErr) throw leadsErr;
      const allDbLeads = existingLeadsData || [];

      // Build DB lookup indexes
      const dbHubspotIdMap = new Map<string, typeof allDbLeads[0]>();
      const dbEmailMap = new Map<string, typeof allDbLeads[0]>();
      const dbPhoneToLeadsMap = new Map<string, typeof allDbLeads>();

      allDbLeads.forEach((l) => {
        if (l.hubspot_contact_id) dbHubspotIdMap.set(l.hubspot_contact_id.trim(), l);
        if (l.external_lead_id) dbHubspotIdMap.set(l.external_lead_id.trim(), l);
        if (l.email) {
          const em = l.email.toLowerCase().trim();
          dbEmailMap.set(em, l);
        }
        const pDigits = normalizePhoneDigits(l.phone_raw) || normalizePhoneDigits(l.phone_e164);
        if (pDigits) {
          if (!dbPhoneToLeadsMap.has(pDigits)) dbPhoneToLeadsMap.set(pDigits, []);
          dbPhoneToLeadsMap.get(pDigits)!.push(l);
        }
      });

      // Invert column mapping for fast field lookup
      const fieldToCol: Record<string, string> = {};
      Object.entries(columnMapping).forEach(([col, field]) => {
        if (field) fieldToCol[field] = col;
      });

      // Pre-count phone occurrences in CSV to enforce strict rule: Phone must be unique on BOTH sides!
      const csvPhoneCountMap = new Map<string, number>();
      parsedData.rows.forEach((r) => {
        const pRaw = fieldToCol.phone ? r[fieldToCol.phone] : '';
        const pDigits = normalizePhoneDigits(pRaw);
        if (pDigits) {
          csvPhoneCountMap.set(pDigits, (csvPhoneCountMap.get(pDigits) || 0) + 1);
        }
      });

      // 3. Create lead_imports record
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
      let conflicts = 0;
      let skipped = 0;
      let failed = 0;

      // 4. Process each row sequentially with strict safety and non-destructive merges
      const total = parsedData.rows.length;
      for (let i = 0; i < total; i++) {
        const row = parsedData.rows[i];
        const rowNum = i + 1;

        const firstName = (fieldToCol.first_name ? row[fieldToCol.first_name] : '').trim();
        const lastName = (fieldToCol.last_name ? row[fieldToCol.last_name] : '').trim();
        const email = (fieldToCol.email ? row[fieldToCol.email] : '').trim().toLowerCase();
        const emailConfirmation = (fieldToCol.email_confirmation ? row[fieldToCol.email_confirmation] : '').trim().toLowerCase();
        const phone = (fieldToCol.phone ? row[fieldToCol.phone] : '').trim();
        const phoneDigits = normalizePhoneDigits(phone);
        const hubspotId = (fieldToCol.hubspot_contact_id ? row[fieldToCol.hubspot_contact_id] : '').trim();
        const rawQualStatus = (fieldToCol.qualification_status ? row[fieldToCol.qualification_status] : '').trim();
        const courseInterest = (fieldToCol.course_interest ? row[fieldToCol.course_interest] : '').trim();
        const rawPref = (fieldToCol.contact_preference ? row[fieldToCol.contact_preference] : '').trim().toLowerCase();
        const rawSource = (fieldToCol.source ? row[fieldToCol.source] : '').trim().toLowerCase();
        const rawStatus = (fieldToCol.status ? row[fieldToCol.status] : '').trim();
        const rawTags = (fieldToCol.tags ? row[fieldToCol.tags] : '').trim();

        const qualStatus = mapHubspotQualificationStatus(rawQualStatus);
        const mappedStageCode = mapCsvStatusToStageCode(rawStatus);
        const targetExplicitStage = mappedStageCode ? stageByCode.get(mappedStageCode) : null;

        const contactPreference: ContactPreference = ['email', 'sms', 'call'].includes(rawPref)
          ? (rawPref as ContactPreference)
          : 'email';

        const source: LeadSource = ['meta', 'google', 'manual', 'test'].includes(rawSource)
          ? (rawSource as LeadSource)
          : 'manual';

        // Check if row has at least one identifying property
        if (!firstName && !lastName && !email && !phone && !hubspotId) {
          skipped++;
          await supabase.from('lead_import_rows').insert({
            import_id: importId,
            row_number: rowNum,
            raw_data: row,
            status: 'skipped',
            error_message: 'Empty record without identifying fields',
          });
          continue;
        }

        try {
          // ===================================================================
          // STRICT SAFE DEDUPLICATION & CONFLICT IDENTIFICATION
          // ===================================================================
          let matchedLead: typeof allDbLeads[0] | null = null;
          let isConflict = false;
          let conflictReason = '';

          // Priority 1: hubspot_contact_id exact match
          if (hubspotId && dbHubspotIdMap.has(hubspotId)) {
            matchedLead = dbHubspotIdMap.get(hubspotId)!;
          } else {
            // Priority 2: email normalized exact match
            const emailMatch = email ? dbEmailMap.get(email) : null;
            const phoneMatches = phoneDigits ? (dbPhoneToLeadsMap.get(phoneDigits) || []) : [];

            // Conflict check: Email and Phone pointing to different leads
            if (emailMatch && phoneMatches.length > 0) {
              const sameLead = phoneMatches.some((l) => l.id === emailMatch.id);
              if (!sameLead) {
                isConflict = true;
                conflictReason = 'Conflict: Email points to one lead and Phone points to a different lead in CRM';
              } else {
                matchedLead = emailMatch;
              }
            } else if (emailMatch) {
              matchedLead = emailMatch;
            } else if (phoneDigits) {
              // Priority 3: Phone ONLY if UNIQUE ON BOTH SIDES
              const isDupInCsv = (csvPhoneCountMap.get(phoneDigits) || 0) > 1;
              const isDupInDb = phoneMatches.length > 1;

              if (isDupInCsv || isDupInDb) {
                isConflict = true;
                if (isDupInCsv && isDupInDb) {
                  conflictReason = `Conflict: Phone is shared by ${csvPhoneCountMap.get(phoneDigits)} contacts in CSV and ${phoneMatches.length} leads in CRM`;
                } else if (isDupInCsv) {
                  conflictReason = `Conflict: Phone is shared by ${csvPhoneCountMap.get(phoneDigits)} contacts in CSV`;
                } else {
                  conflictReason = `Conflict: Phone is shared by ${phoneMatches.length} leads in CRM`;
                }
              } else if (phoneMatches.length === 1) {
                // Exactly 1 in CSV and exactly 1 in DB! 100% safe match!
                matchedLead = phoneMatches[0];
              }
            }
          }

          // Case A: CONFLICT DETECTED -> Safe isolation (Do NOT update or create)
          if (isConflict) {
            conflicts++;
            await supabase.from('lead_import_rows').insert({
              import_id: importId,
              row_number: rowNum,
              raw_data: row,
              status: 'conflict',
              error_message: conflictReason,
            });
            setImportProgress(Math.round(((i + 1) / total) * 100));
            continue;
          }

          let finalLeadId: string | null = null;

          // Case B: MATCHED LEAD & STRATEGY = SKIP
          if (matchedLead && duplicateStrategy === 'skip') {
            skipped++;
            await supabase.from('lead_import_rows').insert({
              import_id: importId,
              row_number: rowNum,
              raw_data: row,
              status: 'skipped',
              lead_id: matchedLead.id,
              error_message: 'Duplicate record skipped',
            });
            setImportProgress(Math.round(((i + 1) / total) * 100));
            continue;
          }

          // Case C: MATCHED LEAD & STRATEGY = UPDATE (Safe non-destructive merge)
          if (matchedLead && duplicateStrategy === 'update') {
            const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

            // Rule: CSV preenchido atualiza; CSV vazio PRESERVA valor existente
            if (firstName) updateData.first_name = firstName;
            if (lastName) updateData.last_name = lastName;
            if (email) updateData.email = email;
            if (phone) {
              updateData.phone_raw = phone;
              if (phone.startsWith('+')) updateData.phone_e164 = phone;
            }
            if (hubspotId) updateData.hubspot_contact_id = hubspotId;
            if (courseInterest) updateData.course_interest = courseInterest;
            if (qualStatus) updateData.qualification_status = qualStatus;

            // Pipeline Stage Update & Anti-Downgrade Protection
            const currentStage = stageById.get(matchedLead.pipeline_stage_id);
            const currentSortOrder = currentStage?.sort_order || 1;

            let newStageId: string | null = null;
            let stageChangeReason: string | null = null;

            if (targetExplicitStage) {
              // Explicit stage from CSV (e.g. opportunity -> acquisition)
              if (targetExplicitStage.sort_order >= currentSortOrder && targetExplicitStage.id !== matchedLead.pipeline_stage_id) {
                newStageId = targetExplicitStage.id;
                stageChangeReason = 'csv_import_stage_mapping';
              }
            } else if (qualStatus && qualificationStage) {
              // Rule: If qualification_status is filled and lead is in capture (sort_order <= 1), promote to qualification
              if (currentSortOrder <= 1 && qualificationStage.id !== matchedLead.pipeline_stage_id) {
                newStageId = qualificationStage.id;
                stageChangeReason = 'csv_import_stage_mapping';
              }
              // If lead is already beyond qualification (sort_order > 2: acquisition, approval, enrollment, etc.),
              // STRICTLY DO NOT DOWNGRADE!
            }

            if (newStageId) {
              updateData.pipeline_stage_id = newStageId;
            }

            // Execute non-destructive UPDATE preserving existing lead_id
            await supabase.from('leads').update(updateData).eq('id', matchedLead.id);
            finalLeadId = matchedLead.id;
            updated++;

            // Update in-memory reference
            matchedLead.qualification_status = (updateData.qualification_status as any) || matchedLead.qualification_status;
            if (newStageId) matchedLead.pipeline_stage_id = newStageId;

            await supabase.from('lead_import_rows').insert({
              import_id: importId,
              row_number: rowNum,
              raw_data: row,
              status: 'updated',
              lead_id: finalLeadId,
            });

            // Audit qualification status change if modified
            if (qualStatus && qualStatus !== matchedLead.qualification_status) {
              await supabase.from('lead_activities').insert({
                lead_id: finalLeadId,
                activity_type: 'qualification_status_changed',
                actor_type: 'user',
                summary: `Qualification status imported from HubSpot: ${getQualificationStatusLabel(qualStatus)}`,
                metadata: {
                  qualification_status: qualStatus,
                  previous_status: matchedLead.qualification_status,
                  import_id: importId,
                },
              });
            }

            // Audit stage change if modified
            if (newStageId && stageChangeReason) {
              await supabase.from('lead_stage_history').insert({
                lead_id: finalLeadId,
                from_stage_id: matchedLead.pipeline_stage_id,
                to_stage_id: newStageId,
                change_reason: stageChangeReason,
              });

              await supabase.from('lead_activities').insert({
                lead_id: finalLeadId,
                activity_type: 'stage_changed',
                actor_type: 'user',
                summary: `Pipeline stage set from CSV import`,
                metadata: {
                  from_stage_id: matchedLead.pipeline_stage_id,
                  to_stage_id: newStageId,
                  import_id: importId,
                },
              });
            }
          } else {
            // Case D: NO MATCH & NO CONFLICT -> CREATE NEW LEAD
            let initialStageId = defaultStageId;
            if (targetExplicitStage) {
              initialStageId = targetExplicitStage.id;
            } else if (qualStatus && qualificationStage) {
              initialStageId = qualificationStage.id;
            }

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
                hubspot_contact_id: hubspotId || null,
                qualification_status: qualStatus || null,
                course_interest: courseInterest || null,
                contact_preference: contactPreference,
                pipeline_stage_id: initialStageId,
              })
              .select('id')
              .single();

            if (insErr) throw insErr;
            finalLeadId = newL!.id;
            created++;

            // Register in in-memory indexes to prevent internal CSV duplicates within same batch
            const createdLeadObj = {
              id: finalLeadId,
              email: email || null,
              phone_raw: phone || null,
              phone_e164: phone.startsWith('+') ? phone : null,
              hubspot_contact_id: hubspotId || null,
              external_lead_id: null,
              pipeline_stage_id: initialStageId,
              qualification_status: qualStatus || null,
              first_name: firstName || null,
              last_name: lastName || null,
              course_interest: courseInterest || null,
            };
            if (hubspotId) dbHubspotIdMap.set(hubspotId, createdLeadObj);
            if (email) dbEmailMap.set(email, createdLeadObj);
            if (phoneDigits) {
              if (!dbPhoneToLeadsMap.has(phoneDigits)) dbPhoneToLeadsMap.set(phoneDigits, []);
              dbPhoneToLeadsMap.get(phoneDigits)!.push(createdLeadObj);
            }

            await supabase.from('lead_import_rows').insert({
              import_id: importId,
              row_number: rowNum,
              raw_data: row,
              status: 'created',
              lead_id: finalLeadId,
            });

            await supabase.from('lead_activities').insert({
              lead_id: finalLeadId,
              activity_type: 'lead_created',
              actor_type: 'user',
              summary: `Lead imported from CSV: ${file.name}`,
              metadata: { import_id: importId, filename: file.name },
            });

            if (initialStageId !== defaultStageId) {
              await supabase.from('lead_stage_history').insert({
                lead_id: finalLeadId,
                from_stage_id: null,
                to_stage_id: initialStageId,
                change_reason: 'csv_import_stage_mapping',
              });
            } else {
              await supabase.from('lead_stage_history').insert({
                lead_id: finalLeadId,
                from_stage_id: null,
                to_stage_id: defaultStageId,
                change_reason: 'initial_assignment',
              });
            }
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

      // 5. Update import status
      const finalStatus = failed > 0 ? (created > 0 || updated > 0 ? 'completed_with_errors' : 'failed') : 'completed';
      await supabase
        .from('lead_imports')
        .update({
          status: finalStatus,
          processed_rows: total,
          created_count: created,
          updated_count: updated,
          conflict_count: conflicts,
          skipped_count: skipped,
          failed_count: failed,
          completed_at: new Date().toISOString(),
        })
        .eq('id', importId);

      setResults({ total, created, updated, conflicts, skipped, failed });
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
              <p className="text-xs text-gray-500">Clean import wizard with safe deduplication and zero automation triggers</p>
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
                Upload HubSpot contacts or CRM export. Supported columns include Record ID, Email, Phone, Status de Qualificação, and Course.
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
                  <h4 className="text-sm font-semibold text-gray-900">File Preview</h4>
                  <p className="text-xs text-gray-500">
                    Detected {parsedData.totalRows} rows and {parsedData.headers.length} columns
                  </p>
                </div>
                <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg">
                  Previewing first 5 rows
                </span>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {parsedData.headers.slice(0, 10).map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-semibold text-gray-700 truncate max-w-[150px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {parsedData.rows.slice(0, 5).map((r, rIdx) => (
                      <tr key={rIdx}>
                        {parsedData.headers.slice(0, 10).map((h, cIdx) => (
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
                <p className="text-xs text-gray-500">Review which column maps to each EDS HUB field before importing</p>
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

          {/* STEP 4: STRATEGY & SAFE DEDUPLICATION */}
          {step === 'strategy' && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Safe Duplicate Resolution Strategy</h4>
                <p className="text-xs text-gray-500">
                  Matches are prioritized: Record ID &gt; Email &gt; Phone (strictly unique on both sides).
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    key: 'update',
                    title: 'Update existing lead (Recommended)',
                    desc: 'Non-destructive: updates contact fields, sets qualification status, and preserves existing data if cell is blank.',
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

              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
                  <span>Conflict Protection & Zero Automation Guarantee:</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Contacts with shared phones in CSV or DB are classified as <strong>Conflicts</strong> and will NOT be automatically modified. No emails, SMS, or call tasks will be dispatched during this migration.
                </p>
              </div>
            </div>
          )}

          {/* STEP 5: IMPORTING */}
          {step === 'importing' && (
            <div className="py-12 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-brand-600 mx-auto" />
              <div>
                <h4 className="text-base font-semibold text-gray-900">Importing contacts safely...</h4>
                <p className="text-xs text-gray-500">Checking unique IDs and applying non-destructive rules</p>
              </div>
              <div className="w-full max-w-md mx-auto bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-brand-600 h-full transition-all duration-300 rounded-full"
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
                <h4 className="text-base font-bold text-gray-900">Import Process Finished</h4>
                <p className="text-xs text-gray-500">Processed {results.total} total rows from {file?.name}</p>
              </div>

              <div className="grid grid-cols-5 gap-2.5 max-w-xl mx-auto">
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-lg font-bold text-emerald-700">{results.created}</p>
                  <p className="text-[11px] font-medium text-emerald-600">Created</p>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-lg font-bold text-blue-700">{results.updated}</p>
                  <p className="text-[11px] font-medium text-blue-600">Updated</p>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-lg font-bold text-amber-700">{results.conflicts}</p>
                  <p className="text-[11px] font-medium text-amber-600">Conflicts</p>
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

              {results.conflicts > 0 && (
                <div className="max-w-xl mx-auto p-3 bg-amber-50 border border-amber-200 rounded-xl text-left text-xs text-amber-800">
                  <span className="font-semibold">{results.conflicts} contacts flagged as conflicts:</span>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    These rows had shared phones or ambiguity and were kept completely safe without updating existing records.
                  </p>
                </div>
              )}
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
                Next: Safe Deduplication <ArrowRight className="h-4 w-4" />
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
