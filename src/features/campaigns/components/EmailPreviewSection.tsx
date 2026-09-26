import { useState, useMemo } from 'react';
import { sanitizeHtml } from '../../../utils/sanitize-html';
import { renderTemplateWithSampleData } from '../../../utils/template-variables';
import type { CampaignAttachment } from '../../../types';
import {
  Monitor,
  Smartphone,
  Eye,
  Paperclip,
  FileText,
  ShieldCheck,
} from 'lucide-react';

interface EmailPreviewSectionProps {
  subject: string;
  previewText?: string;
  fromName: string;
  replyTo?: string;
  htmlContent: string;
  attachment: CampaignAttachment | null;
}

export function EmailPreviewSection({
  subject,
  previewText,
  fromName,
  replyTo,
  htmlContent,
  attachment,
}: EmailPreviewSectionProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const renderedSubject = useMemo(() => {
    const raw = subject.trim() || '(Sem assunto)';
    return renderTemplateWithSampleData(raw, 'global');
  }, [subject]);

  const renderedPreviewText = useMemo(() => {
    if (!previewText?.trim()) return '';
    return renderTemplateWithSampleData(previewText.trim(), 'global');
  }, [previewText]);

  const renderedHtml = useMemo(() => {
    const raw = htmlContent || '<p style="color: #94a3b8; font-style: italic;">Nenhum conteúdo adicionado ao editor.</p>';
    const substituted = renderTemplateWithSampleData(raw, 'global');
    return sanitizeHtml(substituted);
  }, [htmlContent]);

  return (
    <div className="card-executive p-5 space-y-4">
      {/* Header with Device Toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-[#449bd5]" />
          <div>
            <h3 className="text-sm font-bold text-[#08254f] font-heading">
              Pré-visualização Real do Email
            </h3>
            <p className="text-xs text-slate-500">
              Veja exatamente como o destinatário visualizará a mensagem na caixa de entrada.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              device === 'desktop'
                ? 'bg-white text-[#08254f] shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              device === 'mobile'
                ? 'bg-white text-[#08254f] shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Mobile (375px)
          </button>
        </div>
      </div>

      {/* Simulated Email Envelope Header */}
      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-400">De:</span>
            <span className="font-bold text-[#08254f]">
              {fromName || 'Expert Dental Solutions'}
            </span>
            <span className="text-slate-400 text-[11px]">&lt;info@expdentalsolutions.com&gt;</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck className="w-3 h-3 text-emerald-600" /> DKIM & SPF Verificados
          </span>
        </div>

        <div className="flex items-center gap-2 text-slate-600">
          <span className="font-semibold text-slate-400">Para:</span>
          <span className="text-slate-800">Dr. Carlos Silva &lt;carlos.silva@exemplo.com&gt;</span>
        </div>

        {replyTo && (
          <div className="flex items-center gap-2 text-slate-600 text-[11px]">
            <span className="font-semibold text-slate-400">Responder para:</span>
            <span className="text-slate-700">{replyTo}</span>
          </div>
        )}

        <div className="pt-2 border-t border-slate-200/60 flex items-start gap-2">
          <span className="font-semibold text-slate-400 shrink-0">Assunto:</span>
          <span className="font-bold text-slate-900">{renderedSubject}</span>
        </div>

        {renderedPreviewText && (
          <div className="flex items-start gap-2 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-400 shrink-0">Prévia:</span>
            <span className="italic">{renderedPreviewText}</span>
          </div>
        )}
      </div>

      {/* Email Body Frame */}
      <div className="bg-slate-100 p-4 sm:p-6 rounded-2xl flex justify-center overflow-x-auto">
        {device === 'desktop' ? (
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xs border border-slate-200 p-6 min-h-[300px]">
            <div
              className="prose prose-sm max-w-none text-slate-800 break-words"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />

            {/* Attached file card inside email preview */}
            {attachment && (
              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-slate-800 truncate">{attachment.filename}</span>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-100 text-rose-800 uppercase">
                    PDF
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Mobile 375px Device Mockup */
          <div className="w-[375px] max-w-full bg-slate-900 p-2.5 rounded-[36px] shadow-xl border-4 border-slate-800">
            {/* Notch */}
            <div className="w-28 h-4 bg-slate-800 rounded-full mx-auto mb-2" />
            <div className="bg-white rounded-[26px] p-4 min-h-[460px] max-h-[580px] overflow-y-auto">
              <div
                className="prose prose-xs max-w-none text-slate-800 break-words"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />

              {attachment && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                  <FileText className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span className="font-bold text-slate-800 truncate">{attachment.filename}</span>
                </div>
              )}
            </div>
            {/* Bottom bar */}
            <div className="w-24 h-1 bg-slate-600 rounded-full mx-auto mt-2" />
          </div>
        )}
      </div>
    </div>
  );
}
