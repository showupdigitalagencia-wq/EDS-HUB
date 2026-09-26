import { useRef } from 'react';
import type { CampaignAttachment } from '../../../types';
import type { OfficialCourseMaterial } from '../services/campaign-audience-service';
import {
  FileText,
  Paperclip,
  Trash2,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';

interface CampaignAttachmentSectionProps {
  attachment: CampaignAttachment | null;
  suggestedMaterial: OfficialCourseMaterial | null;
  onAttachFile: (attachment: CampaignAttachment) => void;
  onRemoveAttachment: () => void;
  disabled?: boolean;
}

export function CampaignAttachmentSection({
  attachment,
  suggestedMaterial,
  onAttachFile,
  onRemoveAttachment,
  disabled = false,
}: CampaignAttachmentSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes === 0) return 'Tamanho não especificado';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Apenas arquivos no formato PDF são suportados para envio por email.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 40MB limit check aligned with deliverability architecture
    if (file.size > 40 * 1024 * 1024) {
      alert('O arquivo selecionado excede o limite máximo permitido de 40 MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    onAttachFile({
      filename: file.name,
      size: file.size,
      type: 'application/pdf',
      source: 'uploaded',
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAttachOfficial = () => {
    if (!suggestedMaterial) return;
    onAttachFile({
      filename: suggestedMaterial.file_name,
      size: suggestedMaterial.file_size_bytes || undefined,
      type: suggestedMaterial.content_type || 'application/pdf',
      storage_path: suggestedMaterial.storage_path,
      material_id: suggestedMaterial.id,
      course_id: suggestedMaterial.course_id,
      source: 'official_material',
    });
  };

  return (
    <div className="card-executive p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-bold text-[#08254f] flex items-center gap-2 font-heading">
            <Paperclip className="w-4 h-4 text-[#449bd5]" />
            Anexo / Material em PDF
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Inclua um documento PDF no envio do email. Se houver material oficial do curso, você pode anexá-lo com um clique.
          </p>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled}
        />

        {!attachment && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-white border border-slate-200 text-[#08254f] hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
          >
            <Paperclip className="w-3.5 h-3.5" />
            Adicionar arquivo (PDF)
          </button>
        )}
      </div>

      {/* Suggested Official Material Banner (if available and not yet attached) */}
      {!attachment && suggestedMaterial && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-800 shrink-0 mt-0.5">
              <FileCheck className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <span className="text-xs font-bold text-blue-950 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-[#449bd5]" /> Material Oficial do Curso Disponível
              </span>
              <p className="text-xs font-semibold text-blue-900 mt-0.5">
                {suggestedMaterial.title || suggestedMaterial.file_name}
              </p>
              <p className="text-[11px] text-blue-700 mt-0.5">
                Arquivo: <span className="font-mono">{suggestedMaterial.file_name}</span> •{' '}
                {formatFileSize(suggestedMaterial.file_size_bytes)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAttachOfficial}
            disabled={disabled}
            className="w-full sm:w-auto shrink-0 px-3.5 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Anexar Material Oficial
          </button>
        </div>
      )}

      {/* Attached File Card */}
      {attachment ? (
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900 truncate font-mono">
                  {attachment.filename}
                </span>
                <span className="px-2 py-0.5 text-[10px] font-black rounded bg-rose-100 text-rose-800 uppercase tracking-wider">
                  PDF
                </span>
                {attachment.source === 'official_material' ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800">
                    Material Oficial
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-slate-200 text-slate-700">
                    Arquivo Carregado
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Tamanho: {formatFileSize(attachment.size)} • Pronto para despacho junto aos emails
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Substituir
            </button>
            <button
              type="button"
              onClick={onRemoveAttachment}
              disabled={disabled}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Remover
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
          Nenhum arquivo anexado a esta campanha. O envio será realizado apenas com o corpo do email.
        </div>
      )}
    </div>
  );
}
