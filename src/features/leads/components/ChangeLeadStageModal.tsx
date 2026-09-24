import { useState, useEffect, useCallback } from 'react';
import { Kanban, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

export interface CanonicalStageOption {
  id: string;
  name: string;
  code: string;
  sort_order: number;
}

export const CANONICAL_OPERATIONAL_STAGE_CODES = [
  'capture',
  'qualification',
  'acquisition',
  'approval',
  'enrollment',
] as const;

export const FALLBACK_CANONICAL_STAGES: CanonicalStageOption[] = [
  { id: 'stage-capture', name: 'Novo Lead', code: 'capture', sort_order: 1 },
  { id: 'stage-qualification', name: 'Respondido', code: 'qualification', sort_order: 2 },
  { id: 'stage-acquisition', name: 'Interessado', code: 'acquisition', sort_order: 3 },
  { id: 'stage-approval', name: 'Quente', code: 'approval', sort_order: 4 },
  { id: 'stage-enrollment', name: 'Matrícula', code: 'enrollment', sort_order: 5 },
];

export interface ChangeLeadStageModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadName?: string;
  currentStageId?: string | null;
  currentStageName?: string | null;
  onStageUpdated?: (newStageId: string, newStageName: string) => void;
}

export function ChangeLeadStageModal({
  isOpen,
  onClose,
  leadId,
  leadName,
  currentStageId,
  currentStageName,
  onStageUpdated,
}: ChangeLeadStageModalProps) {
  const [stages, setStages] = useState<CanonicalStageOption[]>([]);
  const [isLoadingStages, setIsLoadingStages] = useState(true);
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load canonical 5 stages from database (excluding post_course and alumni)
  const loadStages = useCallback(async () => {
    setIsLoadingStages(true);
    try {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('id, name, code, sort_order')
        .in('code', CANONICAL_OPERATIONAL_STAGE_CODES as unknown as string[])
        .order('sort_order', { ascending: true });

      if (!error && data && data.length > 0) {
        setStages(data as CanonicalStageOption[]);
      } else {
        setStages(FALLBACK_CANONICAL_STAGES);
      }
    } catch {
      setStages(FALLBACK_CANONICAL_STAGES);
    } finally {
      setIsLoadingStages(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadStages();
      setSelectedStageId('');
      setNote('');
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, loadStages]);

  const handleSave = async () => {
    if (!selectedStageId || isSubmitting) return;

    const chosenStage = stages.find((s) => s.id === selectedStageId);
    if (!chosenStage) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc('move_lead_stage', {
        p_lead_id: leadId,
        p_new_stage_id: selectedStageId,
        p_note: note.trim() || 'Alteração manual no perfil do lead',
      });

      if (error) throw error;
      if (data && typeof data === 'object' && 'success' in data && !(data as any).success) {
        throw new Error('Falha ao atualizar etapa');
      }

      setSuccessMessage('Etapa atualizada');

      // Dispatch global lead-updated event so Pipeline, Lead List & Dashboard update immediately
      window.dispatchEvent(
        new CustomEvent('lead-updated', {
          detail: { leadId, stageId: selectedStageId, stageName: chosenStage.name },
        })
      );

      if (onStageUpdated) {
        onStageUpdated(selectedStageId, chosenStage.name);
      }

      setTimeout(() => {
        onClose();
      }, 700);
    } catch {
      setErrorMessage('Não foi possível atualizar a etapa.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSaveDisabled = !selectedStageId || isSubmitting || selectedStageId === currentStageId;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-[#08254f]/10 text-[#08254f]">
            <Kanban className="h-4 w-4" />
          </div>
          <span>Alterar etapa</span>
        </div>
      }
      subtitle={leadName ? `Lead: ${leadName}` : 'Selecione a nova etapa para este contato'}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={isSaveDisabled}
            isLoading={isSubmitting}
          >
            Salvar etapa
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Success Alert */}
        {successMessage && (
          <div
            role="status"
            className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-150"
            data-testid="stage-update-success"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-150"
            data-testid="stage-update-error"
          >
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 1. Etapa Atual */}
        <div>
          <span className="text-xs font-semibold text-slate-500 block mb-1.5">
            Etapa atual:
          </span>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200/90">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#08254f]" />
              <span className="text-sm font-bold text-[#08254f] font-heading" data-testid="modal-current-stage-name">
                {currentStageName || 'Novo Lead'}
              </span>
            </div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">
              Estágio atual
            </span>
          </div>
        </div>

        {/* 2. Nova Etapa */}
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1.5">
            Nova etapa:
          </label>
          {isLoadingStages && stages.length === 0 ? (
            <div className="space-y-2 py-1" data-testid="stages-loading-skeleton">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-11 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5" role="radiogroup" aria-label="Nova etapa">
              {stages.map((stg) => {
              const isCurrent =
                (currentStageId && stg.id === currentStageId) ||
                (currentStageName && stg.name.toLowerCase() === currentStageName.toLowerCase());
              const isSelected = selectedStageId === stg.id;

              return (
                <button
                  key={stg.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={Boolean(isCurrent)}
                  onClick={() => setSelectedStageId(stg.id)}
                  data-testid={`stage-option-${stg.code}`}
                  className={`w-full text-left p-3 rounded-xl border transition-all duration-150 flex items-center justify-between ${
                    isCurrent
                      ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400'
                      : isSelected
                      ? 'border-[#08254f] bg-[#08254f]/5 text-[#08254f] ring-2 ring-[#08254f]/20 font-bold shadow-2xs'
                      : 'border-slate-200/90 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-medium cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'border-[#08254f] bg-[#08254f]'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-xs">{stg.name}</span>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] uppercase font-semibold text-slate-400">
                      Atual
                    </span>
                  )}
                </button>
              );
            })}
            </div>
          )}
        </div>

        {/* 3. Observação (Opcional) */}
        <div>
          <label htmlFor="stage-change-note" className="text-xs font-semibold text-slate-600 block mb-1">
            Observação (opcional):
          </label>
          <input
            id="stage-change-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex: Contato qualificado por telefone"
            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#08254f]/20 focus:border-[#08254f]"
          />
        </div>
      </div>
    </Modal>
  );
}
