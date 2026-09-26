import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { Drawer } from '../../../components/ui/Drawer';
import { Badge } from '../../../components/ui/Badge';
import { LeadProfileContent } from './LeadProfileContent';
import { EditLeadModal } from './EditLeadModal';
import { Edit2 } from 'lucide-react';
import type { Lead } from '../../../types';

export interface LeadProfileDrawerProps {
  leadId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onLeadUpdated?: () => void;
  initialLead?: Lead | null;
}

export function LeadProfileDrawer({
  leadId,
  isOpen,
  onClose,
  onLeadUpdated,
  initialLead,
}: LeadProfileDrawerProps) {
  const [fetchedLead, setFetchedLead] = useState<Lead | null>(null);
  const [isEditLeadOpen, setIsEditLeadOpen] = useState(false);
  const lead = (initialLead && initialLead.id === leadId ? initialLead : null) ?? fetchedLead;

  const fetchHeaderLead = useCallback(async () => {
    if (!leadId) return;
    try {
      const { data } = await supabase
        .from('leads')
        .select('*, pipeline_stage:pipeline_stages(*)')
        .eq('id', leadId)
        .single();
      if (data) setFetchedLead(data as Lead);
    } catch {
      // non-fatal
    }
  }, [leadId]);

  useEffect(() => {
    if (isOpen && leadId) {
      void fetchHeaderLead();
    }
  }, [isOpen, leadId, fetchHeaderLead]);

  const initials = lead
    ? `${lead.first_name?.charAt(0) || ''}${lead.last_name?.charAt(0) || ''}`.toUpperCase() || 'L'
    : 'L';

  const pipelineStage = (lead as any)?.pipeline_stage;

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        widthClass="sm:max-w-2xl sm:w-[620px] w-full"
        headerActions={
          lead ? (
            <button
              type="button"
              onClick={() => setIsEditLeadOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[#08254f] bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-lg transition-colors cursor-pointer"
              title="Editar lead"
              data-testid="drawer-edit-lead-button"
            >
              <Edit2 className="h-3.5 w-3.5 text-[#449bd5]" />
              <span>Editar lead</span>
            </button>
          ) : null
        }
        title={
          lead ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#08254f] text-white flex items-center justify-center text-xs font-bold font-heading shadow-xs shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-[#08254f] truncate font-heading tracking-tight">
                  {lead.first_name} {lead.last_name}
                </h2>
                {pipelineStage && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="navy" size="sm">
                      {pipelineStage.name}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <span className="text-sm font-semibold text-slate-500">Perfil do Lead</span>
          )
        }
      >
        {leadId && (
          <LeadProfileContent
            leadId={leadId}
            initialLead={lead}
            onOpenEditLead={() => setIsEditLeadOpen(true)}
            onLeadUpdated={() => {
              fetchHeaderLead();
              if (onLeadUpdated) onLeadUpdated();
            }}
            onLeadDeleted={() => {
              onClose();
              if (onLeadUpdated) onLeadUpdated();
            }}
          />
        )}
      </Drawer>

      {isEditLeadOpen && lead && (
        <EditLeadModal
          isOpen={isEditLeadOpen}
          onClose={() => setIsEditLeadOpen(false)}
          lead={lead}
          onLeadUpdated={() => {
            fetchHeaderLead();
            if (onLeadUpdated) onLeadUpdated();
          }}
        />
      )}
    </>
  );
}

// Backward-compatible aliases per Section 9
export const LeadQuickViewDrawer = LeadProfileDrawer;
export type LeadQuickViewDrawerProps = LeadProfileDrawerProps;
