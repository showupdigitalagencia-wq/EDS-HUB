import { useState, useId, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { parseCsv, type ParsedCsv } from '../utils/csvParser';
import { getQualificationStatusLabel } from '../utils/qualificationMapping';
import {
  analyzeCsvImport,
  classifyRow,
  buildUpdatePayload,
  buildDbLeadIndexes,
  buildCsvPhoneCountMap,
  buildFieldToColumnMap,
  type DbLeadRef,
  type PipelineStageRef,
  type ConflictItem,
  type ImportPreviewAnalysis,
} from '../utils/csvImportEngine';
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
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type DuplicateStrategy = 'update' | 'skip' | 'create';
type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'results';

const CRM_FIELDS = [
  { key: 'hubspot_contact_id', label: 'HubSpot Record ID (hubspot_contact_id)' },
  { key: 'first_name', label: 'First Name (first_name)' },
  { key: 'last_name', label: 'Last Name (last_name)' },
  { key: 'email', label: 'Email (email)' },
  { key: 'phone', label: 'Phone Number (phone)' },
  { key: 'qualification_status', label: 'Qualification Status (qualification_status)' },
  { key: 'course_interest', label: 'Course of Interest (course_interest)' },
  { key: 'contact_preference', label: 'Preferred Channels / Contact Preference (contact_preference)' },
  { key: 'status', label: 'Lifecycle Stage / Pipeline Stage (status)' },
  { key: 'email_confirmation', label: 'Email Confirmation' },
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

  // Mapping view filters
  const [columnSearch, setColumnSearch] = useState('');
  const [mappingFilter, setMappingFilter] = useState<'all' | 'mapped'>('mapped');

  // Preview state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewAnalysis, setPreviewAnalysis] = useState<ImportPreviewAnalysis | null>(null);
  const [showConflictsList, setShowConflictsList] = useState(false);

  // Importing state
  const [importProgress, setImportProgress] = useState(0);
  const [currentProgressText, setCurrentProgressText] = useState('');
  const [results, setResults] = useState<{
    total: number;
    created: number;
    updated: number;
    conflicts: number;
    skipped: number;
    failed: number;
    conflictList: ConflictItem[];
  }>({
    total: 0,
    created: 0,
    updated: 0,
    conflicts: 0,
    skipped: 0,
    failed: 0,
    conflictList: [],
  });
  const [error, setError] = useState<string | null>(null);

  // Cached stages and DB leads
  const [cachedStages, setCachedStages] = useState<PipelineStageRef[]>([]);
  const [cachedDbLeads, setCachedDbLeads] = useState<DbLeadRef[]>([]);

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
          } else if (lower.includes('phone') || lower.includes('tel') || lower.includes('cell') || lower.includes('telefone')) {
            initialMapping[header] = 'phone';
          } else if (
            lower.includes('preference') ||
            lower.includes('preferredchannel') ||
            lower.includes('preferredchannels') ||
            lower.includes('canalpreferido')
          ) {
            initialMapping[header] = 'contact_preference';
          } else if (lower.includes('source') || lower.includes('origin') || lower.includes('origem')) {
            initialMapping[header] = 'source';
          } else if (
            lower.includes('status') ||
            lower.includes('stage') ||
            lower.includes('lifecycle') ||
            lower.includes('pipeline') ||
            lower.includes('estagio')
          ) {
            initialMapping[header] = 'status';
          } else if (lower.includes('tag')) {
            initialMapping[header] = 'tags';
          }
        });

        setColumnMapping(initialMapping);
        setStep('mapping');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error reading CSV file');
      }
    };
    reader.readAsText(selected);
  };

  const handleProceedToPreview = async () => {
    if (!parsedData) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      // 1. Fetch active pipeline stages
      let stages = cachedStages;
      if (stages.length === 0) {
        const { data: stagesData, error: stagesErr } = await supabase
          .from('pipeline_stages')
          .select('id, code, name, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (stagesErr || !stagesData) throw stagesErr || new Error('Failed to load active pipeline stages');
        stages = stagesData;
        setCachedStages(stagesData);
      }

      // 2. Fetch existing leads for deduplication
      let dbLeads = cachedDbLeads;
      if (dbLeads.length === 0) {
        const { data: leadsData, error: leadsErr } = await supabase
          .from('leads')
          .select('id, email, phone_raw, phone_e164, hubspot_contact_id, external_lead_id, pipeline_stage_id, qualification_status, first_name, last_name, course_interest');

        if (leadsErr) throw leadsErr;
        dbLeads = leadsData || [];
        setCachedDbLeads(dbLeads);
      }

      // 3. Run safe deduplication analysis across all rows
      const analysis = analyzeCsvImport(parsedData.rows, columnMapping, dbLeads, stages);
      setPreviewAnalysis(analysis);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze CSV preview');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!parsedData || !file) return;

    setStep('importing');
    setImportProgress(0);
    setCurrentProgressText('Initializing safe import job...');
    setError(null);

    try {
      // Load stages and dbLeads
      let stages = cachedStages;
      if (stages.length === 0) {
        const { data: stg } = await supabase
          .from('pipeline_stages')
          .select('id, code, name, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });
        stages = stg || [];
      }

      const stageByCode = new Map(stages.map((s) => [s.code, s]));
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const captureStage = stageByCode.get('capture') || stages[0];
      const qualificationStage = stageByCode.get('qualification');
      const defaultStageId = captureStage.id;

      let dbLeads = cachedDbLeads;
      if (dbLeads.length === 0) {
        const { data: lds } = await supabase
          .from('leads')
          .select('id, email, phone_raw, phone_e164, hubspot_contact_id, external_lead_id, pipeline_stage_id, qualification_status, first_name, last_name, course_interest');
        dbLeads = lds || [];
      }

      // Build in-memory indexes
      const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(dbLeads);
      const fieldToCol = buildFieldToColumnMap(columnMapping);
      const csvPhoneCountMap = buildCsvPhoneCountMap(parsedData.rows, fieldToCol.phone);

      // Create lead_imports record
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

      if (impErr || !importRec) throw impErr || new Error('Failed to create import job in database');
      const importId = importRec.id;

      let created = 0;
      let updated = 0;
      let conflicts = 0;
      let skipped = 0;
      let failed = 0;
      const conflictList: ConflictItem[] = [];

      const total = parsedData.rows.length;
      const BATCH_SIZE = 50;
      const totalBatches = Math.ceil(total / BATCH_SIZE);

      const pruneRaw = (r: Record<string, string>): Record<string, string> => {
        const mappedSet = new Set(Object.values(fieldToCol));
        const pruned: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          if (v && v.trim() !== '') pruned[k] = v;
          else if (mappedSet.has(k)) pruned[k] = '';
        }
        return pruned;
      };

      for (let b = 0; b < totalBatches; b++) {
        const start = b * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, total);
        const chunk = parsedData.rows.slice(start, end);

        setCurrentProgressText(`Processing contacts ${start + 1} - ${end} of ${total} (Batch ${b + 1}/${totalBatches})...`);

        const batchImportRows: Array<Record<string, unknown>> = [];
        const batchActivities: Array<Record<string, unknown>> = [];
        const batchStageHistory: Array<Record<string, unknown>> = [];
        const updateTasks: Array<() => Promise<void>> = [];
        const createTasks: Array<{
          rowNum: number;
          row: Record<string, string>;
          payload: Record<string, unknown>;
          extracted: ReturnType<typeof classifyRow>['extracted'];
          initialStageId: string;
        }> = [];

        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i];
          const rowNum = start + i + 1;

          try {
            const result = classifyRow(
              row,
              rowNum,
              fieldToCol,
              dbHubspotIdMap,
              dbEmailMap,
              dbPhoneToLeadsMap,
              csvPhoneCountMap,
              stageByCode,
            );

            if (result.action === 'skip') {
              skipped++;
              batchImportRows.push({
                import_id: importId,
                row_number: rowNum,
                raw_data: pruneRaw(row),
                status: 'skipped',
                error_message: result.conflictReason || 'Empty record',
              });
              continue;
            }

            if (result.action === 'conflict') {
              conflicts++;
              conflictList.push({
                rowNumber: rowNum,
                name: `${result.extracted.firstName} ${result.extracted.lastName}`.trim() || 'Unknown',
                email: result.extracted.email,
                phone: result.extracted.phone,
                recordId: result.extracted.hubspotId,
                reason: result.conflictReason || 'Conflict',
              });
              batchImportRows.push({
                import_id: importId,
                row_number: rowNum,
                raw_data: pruneRaw(row),
                status: 'conflict',
                error_message: result.conflictReason,
              });
              continue;
            }

            // Matched Lead
            if (result.action === 'update' && result.matchedLead) {
              if (duplicateStrategy === 'skip') {
                skipped++;
                batchImportRows.push({
                  import_id: importId,
                  row_number: rowNum,
                  raw_data: pruneRaw(row),
                  status: 'skipped',
                  lead_id: result.matchedLead.id,
                  error_message: 'Duplicate record skipped',
                });
                continue;
              }

              if (duplicateStrategy === 'update') {
                updated++;
                const leadRef = result.matchedLead;
                const { updateData, newStageId, stageChangeReason, qualificationStatusChanged } =
                  buildUpdatePayload(leadRef, result.extracted, stageById, qualificationStage);

                updateTasks.push(async () => {
                  await supabase.from('leads').update(updateData).eq('id', leadRef.id);
                });

                batchImportRows.push({
                  import_id: importId,
                  row_number: rowNum,
                  raw_data: pruneRaw(row),
                  status: 'updated',
                  lead_id: leadRef.id,
                });

                if (qualificationStatusChanged && result.extracted.qualificationStatus) {
                  batchActivities.push({
                    lead_id: leadRef.id,
                    activity_type: 'qualification_status_changed',
                    actor_type: 'user',
                    summary: `Qualification status imported from HubSpot: ${getQualificationStatusLabel(result.extracted.qualificationStatus)}`,
                    metadata: {
                      qualification_status: result.extracted.qualificationStatus,
                      previous_status: leadRef.qualification_status,
                      import_id: importId,
                    },
                  });
                }

                if (newStageId && stageChangeReason) {
                  batchStageHistory.push({
                    lead_id: leadRef.id,
                    from_stage_id: leadRef.pipeline_stage_id,
                    to_stage_id: newStageId,
                    change_reason: stageChangeReason,
                  });
                  batchActivities.push({
                    lead_id: leadRef.id,
                    activity_type: 'stage_changed',
                    actor_type: 'user',
                    summary: 'Pipeline stage set from CSV import',
                    metadata: {
                      from_stage_id: leadRef.pipeline_stage_id,
                      to_stage_id: newStageId,
                      import_id: importId,
                    },
                  });
                }

                // Update in-memory state
                leadRef.qualification_status = (updateData.qualification_status as import('../../../types').QualificationStatus) || leadRef.qualification_status;
                if (newStageId) leadRef.pipeline_stage_id = newStageId;
                if (result.extracted.hubspotId) {
                  leadRef.hubspot_contact_id = result.extracted.hubspotId;
                  dbHubspotIdMap.set(result.extracted.hubspotId, leadRef);
                }
                continue;
              }
            }

            // Create New Lead
            created++;
            const initialStageId =
              result.extracted.targetExplicitStage?.id ||
              (result.extracted.qualificationStatus && qualificationStage ? qualificationStage.id : defaultStageId);

            createTasks.push({
              rowNum,
              row,
              extracted: result.extracted,
              initialStageId,
              payload: {
                source: result.extracted.source,
                first_name: result.extracted.firstName || null,
                last_name: result.extracted.lastName || null,
                email: result.extracted.email || null,
                email_confirmation: result.extracted.emailConfirmation || null,
                phone_raw: result.extracted.phone || null,
                phone_e164: result.extracted.phone.startsWith('+') ? result.extracted.phone : null,
                hubspot_contact_id: result.extracted.hubspotId || null,
                qualification_status: result.extracted.qualificationStatus || null,
                course_interest: result.extracted.courseInterest || null,
                contact_preference: result.extracted.contactPreference,
                pipeline_stage_id: initialStageId,
              },
            });
          } catch (rowErr) {
            failed++;
            batchImportRows.push({
              import_id: importId,
              row_number: rowNum,
              raw_data: pruneRaw(row),
              status: 'failed',
              error_message: rowErr instanceof Error ? rowErr.message : 'Unknown error',
            });
          }
        }

        // Execute batch updates (concurrency chunks of 10)
        for (let u = 0; u < updateTasks.length; u += 10) {
          await Promise.all(updateTasks.slice(u, u + 10).map((fn) => fn()));
        }

        // Execute batch creates
        if (createTasks.length > 0) {
          const { data: inserted, error: insErr } = await supabase
            .from('leads')
            .insert(createTasks.map((c) => c.payload))
            .select('id, hubspot_contact_id, email, phone_raw');

          if (insErr) {
            console.error('Batch create error:', insErr);
          } else if (inserted) {
            inserted.forEach((lead, idx) => {
              const item = createTasks[idx];
              batchImportRows.push({
                import_id: importId,
                row_number: item.rowNum,
                raw_data: pruneRaw(item.row),
                status: 'created',
                lead_id: lead.id,
              });

              batchActivities.push({
                lead_id: lead.id,
                activity_type: 'lead_created',
                actor_type: 'user',
                summary: `Lead imported from CSV: ${file.name}`,
                metadata: { import_id: importId, filename: file.name },
              });

              batchStageHistory.push({
                lead_id: lead.id,
                from_stage_id: null,
                to_stage_id: item.initialStageId,
                change_reason: item.initialStageId !== defaultStageId ? 'csv_import_stage_mapping' : 'initial_assignment',
              });

              // Register in memory
              const refObj: DbLeadRef = {
                id: lead.id,
                hubspot_contact_id: lead.hubspot_contact_id,
                email: lead.email,
                phone_raw: lead.phone_raw,
                pipeline_stage_id: item.initialStageId,
                qualification_status: item.extracted.qualificationStatus,
              };
              if (lead.hubspot_contact_id) dbHubspotIdMap.set(lead.hubspot_contact_id, refObj);
              if (lead.email) dbEmailMap.set(lead.email.toLowerCase(), refObj);
              if (item.extracted.phoneDigits) {
                if (!dbPhoneToLeadsMap.has(item.extracted.phoneDigits)) dbPhoneToLeadsMap.set(item.extracted.phoneDigits, []);
                dbPhoneToLeadsMap.get(item.extracted.phoneDigits)!.push(refObj);
              }
            });
          }
        }

        // Batch inserts for audit records
        if (batchImportRows.length > 0) {
          await supabase.from('lead_import_rows').insert(batchImportRows);
        }
        if (batchActivities.length > 0) {
          await supabase.from('lead_activities').insert(batchActivities);
        }
        if (batchStageHistory.length > 0) {
          await supabase.from('lead_stage_history').insert(batchStageHistory);
        }

        // Update progress and yield to browser UI
        setImportProgress(Math.round((end / total) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }

      // Finalize lead_imports record
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

      setResults({
        total,
        created,
        updated,
        conflicts,
        skipped,
        failed,
        conflictList,
      });
      setStep('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview');
    }
  };

  // Filter columns for Mapping Step
  const filteredHeaders = useMemo(() => {
    if (!parsedData) return [];
    let list = parsedData.headers;

    if (mappingFilter === 'mapped') {
      list = list.filter((h) => Boolean(columnMapping[h]));
    }

    if (columnSearch.trim()) {
      const q = columnSearch.toLowerCase();
      list = list.filter(
        (h) => h.toLowerCase().includes(q) || (columnMapping[h] && columnMapping[h].toLowerCase().includes(q)),
      );
    }
    return list;
  }, [parsedData, mappingFilter, columnSearch, columnMapping]);

  const mappedCount = useMemo(() => {
    return Object.values(columnMapping).filter(Boolean).length;
  }, [columnMapping]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden border border-gray-100 dark:border-slate-800 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Import Leads from CSV</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                HubSpot migration engine • Safe deduplication • Zero automation triggers
              </p>
            </div>
          </div>
          {step !== 'importing' && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Wizard content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2.5 p-3.5 mb-5 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ================================================================= */}
          {/* STEP 1: UPLOAD                                                   */}
          {/* ================================================================= */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 rounded-2xl p-12 text-center transition-colors bg-gray-50/50 dark:bg-slate-800/30">
              <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-4 shadow-xs">
                <UploadCloud className="h-8 w-8" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1.5">Choose CSV file to import</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mb-6 leading-relaxed">
                Upload HubSpot contacts export (e.g. <code>all-contacts.csv</code>). Supported fields include Record ID, First/Last Name, Email, Phone, Status de Qualificação, and Curso de Interesse.
              </p>
              <label
                htmlFor={fileInputId}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl cursor-pointer shadow-sm transition-all hover:shadow"
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

          {/* ================================================================= */}
          {/* STEP 2: FIELD MAPPING                                            */}
          {/* ================================================================= */}
          {step === 'mapping' && parsedData && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-slate-800">
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">Map CSV Columns to CRM Fields</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {mappedCount} of {parsedData.headers.length} columns mapped • File contains {parsedData.totalRows} rows
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex p-0.5 bg-gray-100 dark:bg-slate-800 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setMappingFilter('mapped')}
                      className={`px-3 py-1 rounded-md font-medium transition-all ${
                        mappingFilter === 'mapped'
                          ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-xs'
                          : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Mapped ({mappedCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMappingFilter('all')}
                      className={`px-3 py-1 rounded-md font-medium transition-all ${
                        mappingFilter === 'all'
                          ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-xs'
                          : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      All Columns ({parsedData.headers.length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Column Search Box */}
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search column names..."
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500 text-gray-900 dark:text-white"
                />
              </div>

              {/* Columns Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[46vh] overflow-y-auto pr-1">
                {filteredHeaders.length === 0 ? (
                  <div className="col-span-2 py-8 text-center text-xs text-gray-400">
                    No columns match your filter.
                  </div>
                ) : (
                  filteredHeaders.map((header) => {
                    const sampleVal = parsedData.rows[0]?.[header];
                    const isMapped = Boolean(columnMapping[header]);
                    return (
                      <div
                        key={header}
                        className={`p-3 border rounded-xl transition-all flex flex-col gap-1.5 ${
                          isMapped
                            ? 'bg-brand-50/30 dark:bg-brand-950/20 border-brand-200 dark:border-brand-900/50'
                            : 'bg-gray-50/50 dark:bg-slate-800/40 border-gray-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-900 dark:text-white truncate" title={header}>
                            {header}
                          </span>
                          {sampleVal && (
                            <span className="text-[10px] text-gray-400 truncate max-w-[120px]" title={`Sample: ${sampleVal}`}>
                              ex: {sampleVal}
                            </span>
                          )}
                        </div>
                        <select
                          value={columnMapping[header] || ''}
                          onChange={(e) =>
                            setColumnMapping({ ...columnMapping, [header]: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">-- Ignore column --</option>
                          {CRM_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* STEP 3: PREVIEW BEFORE IMPORTING                                  */}
          {/* ================================================================= */}
          {step === 'preview' && previewAnalysis && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">Import Preview & Deduplication Analysis</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Pre-import analysis evaluated with HubSpot Contact ID &gt; Email &gt; Unique Phone rules
                </p>
              </div>

              {/* 5 KPI Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl text-center">
                  <p className="text-lg font-extrabold text-gray-900 dark:text-white">{previewAnalysis.totalRows}</p>
                  <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Total Rows</p>
                </div>
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl text-center">
                  <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400">{previewAnalysis.newLeadsCount}</p>
                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300">New Leads</p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-xl text-center">
                  <p className="text-lg font-extrabold text-blue-700 dark:text-blue-400">{previewAnalysis.existingToUpdateCount}</p>
                  <p className="text-[11px] font-medium text-blue-600 dark:text-blue-300">To Update</p>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-center">
                  <p className="text-lg font-extrabold text-amber-700 dark:text-amber-400">{previewAnalysis.conflictsCount}</p>
                  <p className="text-[11px] font-medium text-amber-600 dark:text-amber-300">Conflicts</p>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl text-center">
                  <p className="text-lg font-extrabold text-slate-700 dark:text-slate-300">{previewAnalysis.invalidCount}</p>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Invalid / Blank</p>
                </div>
              </div>

              {/* Conflict Isolation Panel */}
              {previewAnalysis.conflictsCount > 0 && (
                <div className="border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                      <span className="text-xs font-semibold">
                        {previewAnalysis.conflictsCount} Conflicted Contacts Isolated (Safe Mode)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConflictsList(!showConflictsList)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline"
                    >
                      {showConflictsList ? 'Hide details' : 'View conflict details'}
                      {showConflictsList ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    Contacts with shared phone numbers or mismatched records will <strong>NOT</strong> be automatically modified or overwritten. They will be recorded in <code>lead_import_rows</code> for manual review.
                  </p>

                  {/* Expandable Conflict Details Table */}
                  {showConflictsList && (
                    <div className="mt-2 max-h-48 overflow-y-auto border border-amber-200 dark:border-amber-800 rounded-lg bg-white dark:bg-slate-900">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800 text-[11px]">
                        <thead className="bg-amber-50/70 dark:bg-slate-800 text-amber-900 dark:text-amber-200">
                          <tr>
                            <th className="px-2.5 py-1.5 text-left font-semibold">Row</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold">Name</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold">Phone</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold">Email</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800 text-gray-700 dark:text-gray-300">
                          {previewAnalysis.conflicts.map((c, i) => (
                            <tr key={i} className="hover:bg-amber-50/30 dark:hover:bg-slate-800/40">
                              <td className="px-2.5 py-1.5 text-gray-500">{c.rowNumber}</td>
                              <td className="px-2.5 py-1.5 font-medium truncate max-w-[120px]">{c.name}</td>
                              <td className="px-2.5 py-1.5 truncate max-w-[110px]">{c.phone || '-'}</td>
                              <td className="px-2.5 py-1.5 truncate max-w-[120px]">{c.email || '-'}</td>
                              <td className="px-2.5 py-1.5 text-amber-700 dark:text-amber-400">{c.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Duplicate Strategy Selection */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-gray-900 dark:text-white">Duplicate Resolution Strategy</h5>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      key: 'update',
                      title: 'Update existing lead',
                      badge: 'Recommended',
                      desc: 'Non-destructive: updates filled fields, sets qualification status, and preserves existing data if cell is blank.',
                    },
                    {
                      key: 'skip',
                      title: 'Skip duplicates',
                      badge: null,
                      desc: 'Do not modify matched leads; only import brand new contacts.',
                    },
                    {
                      key: 'create',
                      title: 'Create separate',
                      badge: null,
                      desc: 'Always insert as new separate leads.',
                    },
                  ].map((opt) => (
                    <label
                      key={opt.key}
                      onClick={() => setDuplicateStrategy(opt.key as DuplicateStrategy)}
                      className={`flex flex-col p-3 border rounded-xl cursor-pointer transition-all ${
                        duplicateStrategy === opt.key
                          ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 shadow-xs'
                          : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-gray-900 dark:text-white">{opt.title}</span>
                        {opt.badge && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-brand-100 text-brand-700 rounded-md">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-normal">{opt.desc}</p>
                    </label>
                  ))}
                </div>
              </div>

              {/* Zero Automation Guarantee Notice */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  <strong>Zero Automation Guarantee:</strong> All contact automations (Resend emails, Twilio SMS, call tasks, and intake webhooks) are completely disabled.
                </span>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* STEP 4: IMPORTING (BATCHED WITH PROGRESS)                        */}
          {/* ================================================================= */}
          {step === 'importing' && (
            <div className="py-14 text-center space-y-5">
              <div className="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 flex items-center justify-center mx-auto shadow-xs">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
              <div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white">Importing Contacts Safely...</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{currentProgressText}</p>
              </div>
              <div className="w-full max-w-md mx-auto bg-gray-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-brand-600 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{importProgress}% completed</p>
              <p className="text-[11px] text-gray-400">
                Please keep this modal open while batches are processed.
              </p>
            </div>
          )}

          {/* ================================================================= */}
          {/* STEP 5: RESULTS                                                  */}
          {/* ================================================================= */}
          {step === 'results' && (
            <div className="py-6 text-center space-y-6">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white">Import Completed Successfully</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Processed {results.total} total rows from {file?.name}
                </p>
              </div>

              {/* 5 KPI Result Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 max-w-xl mx-auto">
                <div className="p-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{results.total}</p>
                  <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Processed</p>
                </div>
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800 rounded-xl">
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{results.created}</p>
                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300">Created</p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800 rounded-xl">
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{results.updated}</p>
                  <p className="text-[11px] font-medium text-blue-600 dark:text-blue-300">Updated</p>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800 rounded-xl">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{results.conflicts}</p>
                  <p className="text-[11px] font-medium text-amber-600 dark:text-amber-300">Conflicts</p>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-800 rounded-xl">
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">{results.failed}</p>
                  <p className="text-[11px] font-medium text-red-600 dark:text-red-300">Failed</p>
                </div>
              </div>

              {/* Conflict Log in Results */}
              {results.conflicts > 0 && (
                <div className="max-w-xl mx-auto p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl text-left text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <span className="font-bold">{results.conflicts} contacts preserved as conflicts:</span>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    These rows had shared phones or ambiguous matches and were isolated without modifying existing leads. All logs are registered in <code>lead_imports</code> and <code>lead_import_rows</code>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
          {step === 'mapping' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={handleProceedToPreview}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Analyzing Database...
                  </>
                ) : (
                  <>
                    Next: Preview & Deduplication <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back to Mapping
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors"
              >
                Start Import ({parsedData?.totalRows} contacts) <ArrowRight className="h-4 w-4" />
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
                className="px-6 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
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
