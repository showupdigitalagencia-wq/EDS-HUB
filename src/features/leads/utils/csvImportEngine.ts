// =============================================================================
// CSV Import Engine: Safe Deduplication, Preview Analysis & Batch Execution
// =============================================================================

import { normalizePhoneDigits, mapHubspotQualificationStatus } from './qualificationMapping';
import { mapCsvStatusToStageCode } from './stageMapping';
import { toDbContactPreference } from '../../../utils/contact-preference';
import type { QualificationStatus, ContactPreference, LeadSource } from '../../../types';

export interface DbLeadRef {
  id: string;
  email?: string | null;
  phone_raw?: string | null;
  phone_e164?: string | null;
  hubspot_contact_id?: string | null;
  external_lead_id?: string | null;
  pipeline_stage_id?: string | null;
  qualification_status?: QualificationStatus | null;
  first_name?: string | null;
  last_name?: string | null;
  course_interest?: string | null;
}

export interface PipelineStageRef {
  id: string;
  code: string;
  name: string;
  sort_order: number;
}

export interface ConflictItem {
  rowNumber: number;
  name: string;
  email: string;
  phone: string;
  recordId: string;
  reason: string;
}

export interface ImportPreviewAnalysis {
  totalRows: number;
  newLeadsCount: number;
  existingToUpdateCount: number;
  conflictsCount: number;
  invalidCount: number;
  conflicts: ConflictItem[];
  previewRows: Array<{
    rowNumber: number;
    name: string;
    email: string;
    phone: string;
    recordId: string;
    qualificationStatus: QualificationStatus | null;
    action: 'create' | 'update' | 'conflict' | 'skip';
    reason?: string;
  }>;
}

export interface RowClassificationResult {
  rowNumber: number;
  action: 'create' | 'update' | 'conflict' | 'skip';
  matchedLead: DbLeadRef | null;
  conflictReason: string | null;
  extracted: {
    firstName: string;
    lastName: string;
    email: string;
    emailConfirmation: string;
    phone: string;
    phoneDigits: string;
    hubspotId: string;
    qualificationStatus: QualificationStatus | null;
    courseInterest: string;
    contactPreference: ContactPreference;
    source: LeadSource;
    targetExplicitStage: PipelineStageRef | null;
    tags: string;
  };
}

/**
 * Builds inverse field-to-column lookup map.
 */
export function buildFieldToColumnMap(columnMapping: Record<string, string>): Record<string, string> {
  const fieldToCol: Record<string, string> = {};
  Object.entries(columnMapping).forEach(([col, field]) => {
    if (field) fieldToCol[field] = col;
  });
  return fieldToCol;
}

/**
 * Builds fast O(1) in-memory lookup indexes for existing CRM leads.
 */
export function buildDbLeadIndexes(allDbLeads: DbLeadRef[]) {
  const dbHubspotIdMap = new Map<string, DbLeadRef>();
  const dbEmailMap = new Map<string, DbLeadRef>();
  const dbPhoneToLeadsMap = new Map<string, DbLeadRef[]>();

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

  return { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap };
}

/**
 * Pre-counts phone occurrences across all CSV rows.
 */
export function buildCsvPhoneCountMap(
  rows: Record<string, string>[],
  phoneCol?: string,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!phoneCol) return map;

  rows.forEach((r) => {
    const pDigits = normalizePhoneDigits(r[phoneCol]);
    if (pDigits) {
      map.set(pDigits, (map.get(pDigits) || 0) + 1);
    }
  });
  return map;
}

/**
 * Classifies a single row using the canonical safe deduplication rules:
 * 1. hubspot_contact_id exact
 * 2. email normalized exact
 * 3. phone normalized ONLY if strictly unique on both CSV and DB
 * Ambiguity / shared phone = conflict!
 */
export function classifyRow(
  row: Record<string, string>,
  rowNumber: number,
  fieldToCol: Record<string, string>,
  dbHubspotIdMap: Map<string, DbLeadRef>,
  dbEmailMap: Map<string, DbLeadRef>,
  dbPhoneToLeadsMap: Map<string, DbLeadRef[]>,
  csvPhoneCountMap: Map<string, number>,
  stageByCode: Map<string, PipelineStageRef>,
): RowClassificationResult {
  const getVal = (fieldKey: string) => {
    const colName = fieldToCol[fieldKey];
    if (!colName) return '';
    const val = row[colName];
    return val !== undefined && val !== null ? String(val).trim() : '';
  };

  const firstName = getVal('first_name');
  const lastName = getVal('last_name');
  const email = getVal('email').toLowerCase();
  const emailConfirmation = getVal('email_confirmation').toLowerCase();
  const phone = getVal('phone');
  const phoneDigits = normalizePhoneDigits(phone);
  const hubspotId = getVal('hubspot_contact_id');
  const rawQualStatus = getVal('qualification_status');
  const courseInterest = getVal('course_interest');
  const rawPref = getVal('contact_preference').toLowerCase();
  const rawSource = getVal('source').toLowerCase();
  const rawStatus = getVal('status');
  const tags = getVal('tags');

  const qualificationStatus = mapHubspotQualificationStatus(rawQualStatus);
  const mappedStageCode = mapCsvStatusToStageCode(rawStatus);
  const targetExplicitStage = mappedStageCode ? stageByCode.get(mappedStageCode) || null : null;

  const contactPreference: ContactPreference = toDbContactPreference(rawPref);

  const source: LeadSource = ['meta', 'google', 'manual', 'test'].includes(rawSource)
    ? (rawSource as LeadSource)
    : 'manual';

  const extracted = {
    firstName,
    lastName,
    email,
    emailConfirmation,
    phone,
    phoneDigits,
    hubspotId,
    qualificationStatus,
    courseInterest,
    contactPreference,
    source,
    targetExplicitStage,
    tags,
  };

  // Check if completely empty / unidentifiable
  if (!firstName && !lastName && !email && !phone && !hubspotId) {
    return {
      rowNumber,
      action: 'skip',
      matchedLead: null,
      conflictReason: 'Empty record without identifying fields',
      extracted,
    };
  }

  // ===========================================================================
  // DEDUPLICATION PRIORITY
  // ===========================================================================
  // Priority 1: hubspot_contact_id exact match
  if (hubspotId && dbHubspotIdMap.has(hubspotId)) {
    return {
      rowNumber,
      action: 'update',
      matchedLead: dbHubspotIdMap.get(hubspotId)!,
      conflictReason: null,
      extracted,
    };
  }

  // Priority 2: email normalized exact match
  const emailMatch = email ? dbEmailMap.get(email) : null;
  const phoneMatches = phoneDigits ? dbPhoneToLeadsMap.get(phoneDigits) || [] : [];

  if (emailMatch && phoneMatches.length > 0) {
    const isSameLead = phoneMatches.some((l) => l.id === emailMatch.id);
    if (!isSameLead) {
      return {
        rowNumber,
        action: 'conflict',
        matchedLead: null,
        conflictReason: 'Conflict: Email points to one lead and Phone points to a different lead in CRM',
        extracted,
      };
    }
    return {
      rowNumber,
      action: 'update',
      matchedLead: emailMatch,
      conflictReason: null,
      extracted,
    };
  }

  if (emailMatch) {
    return {
      rowNumber,
      action: 'update',
      matchedLead: emailMatch,
      conflictReason: null,
      extracted,
    };
  }

  // Priority 3: Phone ONLY if strictly unique on both sides!
  if (phoneDigits) {
    const isDupInCsv = (csvPhoneCountMap.get(phoneDigits) || 0) > 1;
    const isDupInDb = phoneMatches.length > 1;

    if (isDupInCsv || isDupInDb) {
      let conflictReason = '';
      if (isDupInCsv && isDupInDb) {
        conflictReason = `Conflict: Phone is shared by ${csvPhoneCountMap.get(phoneDigits)} contacts in CSV and ${phoneMatches.length} leads in CRM`;
      } else if (isDupInCsv) {
        conflictReason = `Conflict: Phone is shared by ${csvPhoneCountMap.get(phoneDigits)} contacts in CSV`;
      } else {
        conflictReason = `Conflict: Phone is shared by ${phoneMatches.length} leads in CRM`;
      }
      return {
        rowNumber,
        action: 'conflict',
        matchedLead: null,
        conflictReason,
        extracted,
      };
    }

    if (phoneMatches.length === 1) {
      return {
        rowNumber,
        action: 'update',
        matchedLead: phoneMatches[0],
        conflictReason: null,
        extracted,
      };
    }
  }

  // No match & No conflict -> Create New Lead
  return {
    rowNumber,
    action: 'create',
    matchedLead: null,
    conflictReason: null,
    extracted,
  };
}

/**
 * Evaluates the non-destructive merge payload for updating an existing lead.
 * Rule: CSV filled -> update; CSV empty -> PRESERVE existing value.
 * Never DELETE + INSERT.
 */
export function buildUpdatePayload(
  matchedLead: DbLeadRef,
  extracted: RowClassificationResult['extracted'],
  stageById: Map<string, PipelineStageRef>,
  qualificationStage?: PipelineStageRef,
): {
  updateData: Record<string, unknown>;
  newStageId: string | null;
  stageChangeReason: string | null;
  qualificationStatusChanged: boolean;
} {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // CSV preenchido atualiza; CSV vazio preserva valor existente
  if (extracted.firstName) updateData.first_name = extracted.firstName;
  if (extracted.lastName) updateData.last_name = extracted.lastName;
  if (extracted.email) updateData.email = extracted.email;
  if (extracted.phone) {
    updateData.phone_raw = extracted.phone;
    if (extracted.phone.startsWith('+')) updateData.phone_e164 = extracted.phone;
  }
  if (extracted.hubspotId) updateData.hubspot_contact_id = extracted.hubspotId;
  if (extracted.courseInterest) updateData.course_interest = extracted.courseInterest;
  if (extracted.qualificationStatus) updateData.qualification_status = extracted.qualificationStatus;

  // Pipeline Stage & Anti-Downgrade Protection
  const currentStage = stageById.get(matchedLead.pipeline_stage_id || '');
  const currentSortOrder = currentStage?.sort_order ?? 1;

  let newStageId: string | null = null;
  let stageChangeReason: string | null = null;

  if (extracted.targetExplicitStage) {
    if (
      extracted.targetExplicitStage.sort_order >= currentSortOrder &&
      extracted.targetExplicitStage.id !== matchedLead.pipeline_stage_id
    ) {
      newStageId = extracted.targetExplicitStage.id;
      stageChangeReason = 'csv_import_stage_mapping';
    }
  } else if (extracted.qualificationStatus && qualificationStage) {
    // If currently in capture (sort_order <= 1), promote to qualification
    if (currentSortOrder <= 1 && qualificationStage.id !== matchedLead.pipeline_stage_id) {
      newStageId = qualificationStage.id;
      stageChangeReason = 'csv_import_stage_mapping';
    }
    // If already in acquisition, approval, enrollment, post_course, alumni -> NEVER downgrade!
  }

  if (newStageId) {
    updateData.pipeline_stage_id = newStageId;
  }

  const qualificationStatusChanged = Boolean(
    extracted.qualificationStatus &&
    extracted.qualificationStatus !== matchedLead.qualification_status,
  );

  return {
    updateData,
    newStageId,
    stageChangeReason,
    qualificationStatusChanged,
  };
}

/**
 * Analyzes the full CSV rows against existing CRM state before running the import.
 * Produces preview counts and conflict details.
 */
export function analyzeCsvImport(
  rows: Record<string, string>[],
  columnMapping: Record<string, string>,
  allDbLeads: DbLeadRef[],
  stages: PipelineStageRef[],
): ImportPreviewAnalysis {
  const fieldToCol = buildFieldToColumnMap(columnMapping);
  const { dbHubspotIdMap, dbEmailMap, dbPhoneToLeadsMap } = buildDbLeadIndexes(allDbLeads);
  const csvPhoneCountMap = buildCsvPhoneCountMap(rows, fieldToCol.phone);

  const stageByCode = new Map(stages.map((s) => [s.code, s]));

  let newLeadsCount = 0;
  let existingToUpdateCount = 0;
  let conflictsCount = 0;
  let invalidCount = 0;

  const conflicts: ConflictItem[] = [];
  const previewRows: ImportPreviewAnalysis['previewRows'] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 1;
    const result = classifyRow(
      row,
      rowNumber,
      fieldToCol,
      dbHubspotIdMap,
      dbEmailMap,
      dbPhoneToLeadsMap,
      csvPhoneCountMap,
      stageByCode,
    );

    if (result.action === 'skip') {
      invalidCount++;
    } else if (result.action === 'conflict') {
      conflictsCount++;
      conflicts.push({
        rowNumber,
        name: `${result.extracted.firstName} ${result.extracted.lastName}`.trim() || 'Unknown',
        email: result.extracted.email,
        phone: result.extracted.phone,
        recordId: result.extracted.hubspotId,
        reason: result.conflictReason || 'Ambiguous match',
      });
    } else if (result.action === 'update') {
      existingToUpdateCount++;
    } else if (result.action === 'create') {
      newLeadsCount++;
    }

    if (previewRows.length < 20 || result.action === 'conflict') {
      previewRows.push({
        rowNumber,
        name: `${result.extracted.firstName} ${result.extracted.lastName}`.trim() || 'Unknown',
        email: result.extracted.email,
        phone: result.extracted.phone,
        recordId: result.extracted.hubspotId,
        qualificationStatus: result.extracted.qualificationStatus,
        action: result.action,
        reason: result.conflictReason || undefined,
      });
    }
  });

  return {
    totalRows: rows.length,
    newLeadsCount,
    existingToUpdateCount,
    conflictsCount,
    invalidCount,
    conflicts,
    previewRows,
  };
}
