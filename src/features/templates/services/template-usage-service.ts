// =============================================================================
// EDS HUB — Template Usage & Deletion Safety Service
// =============================================================================
// Factual reference lookup across Campaigns, Automations, and Sequences.
// Enforces fail-safe delete verification and informational origin lineage.
// =============================================================================

import { supabase } from '../../../lib/supabase';

export interface TemplateUsageItem {
  id: string;
  name: string;
  status: string;
  channel?: string;
  type: 'campaign' | 'automation' | 'sequence';
}

export interface TemplateUsage {
  campaigns: TemplateUsageItem[];
  automations: TemplateUsageItem[];
  sequences: TemplateUsageItem[];
  totalCount: number;
}

export interface DeleteSafetyResult {
  canDelete: boolean;
  usage: TemplateUsage;
  errorMessage?: string;
}

/**
 * Queries factual references to a template in Campaigns, Automations, and Sequences.
 * Relies on exact relational keys (campaigns.template_id) and step config (template_id).
 */
export async function getTemplateUsage(templateId: string): Promise<TemplateUsage> {
  // 1. Check Campaigns (column campaigns.template_id)
  const { data: campRows, error: campErr } = await supabase
    .from('campaigns')
    .select('id, name, status, channel')
    .eq('template_id', templateId);

  if (campErr) throw campErr;

  const campaigns: TemplateUsageItem[] = (campRows || []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    channel: c.channel,
    type: 'campaign',
  }));

  // 2. Check Automations & Sequences (stored in automations & automation_steps)
  const { data: autoRows, error: autoErr } = await supabase
    .from('automations')
    .select(`
      id,
      name,
      status,
      automation_type,
      automation_versions (
        id,
        status,
        automation_steps (
          id,
          step_order,
          action_type,
          config
        )
      )
    `);

  if (autoErr) throw autoErr;

  const automations: TemplateUsageItem[] = [];
  const sequences: TemplateUsageItem[] = [];

  for (const auto of autoRows || []) {
    let hasTemplateRef = false;
    const versions = auto.automation_versions || [];

    for (const ver of versions) {
      const steps = ver.automation_steps || [];
      for (const step of steps) {
        const stepConfig = step.config as { template_id?: string } | undefined;
        if (stepConfig && stepConfig.template_id === templateId) {
          hasTemplateRef = true;
          break;
        }
      }
      if (hasTemplateRef) break;
    }

    if (hasTemplateRef) {
      const item: TemplateUsageItem = {
        id: auto.id,
        name: auto.name,
        status: auto.status,
        type: auto.automation_type === 'sequence' ? 'sequence' : 'automation',
      };

      if (auto.automation_type === 'sequence') {
        sequences.push(item);
      } else {
        automations.push(item);
      }
    }
  }

  return {
    campaigns,
    automations,
    sequences,
    totalCount: campaigns.length + automations.length + sequences.length,
  };
}

/**
 * Verifies delete safety for a template.
 *
 * Real DB Constraint:
 * Migration 00018 declares: `template_id UUID REFERENCES public.email_templates(id) ON DELETE SET NULL`.
 * Thus Postgres allows deleting the row and safely nullifies the template_id without breaking snapshots.
 *
 * Fail-safe requirement:
 * If reference verification fails (e.g. network/database error), hard deletion is strictly refused.
 */
export async function checkTemplateDeleteSafety(templateId: string): Promise<DeleteSafetyResult> {
  try {
    const usage = await getTemplateUsage(templateId);
    return {
      canDelete: true,
      usage,
    };
  } catch (err) {
    console.error('[TemplateUsageService] Failed to check delete safety:', err);
    return {
      canDelete: false,
      usage: { campaigns: [], automations: [], sequences: [], totalCount: 0 },
      errorMessage: 'Não foi possível verificar se este template está em uso. Tente novamente.',
    };
  }
}
