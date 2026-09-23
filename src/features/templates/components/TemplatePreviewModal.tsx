import { useState, useMemo } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { sanitizeHtml } from '../../../utils/sanitize-html';
import {
  getTemplateChannel,
  getTemplateSubject,
  renderTemplateWithSampleData,
  calculateSmsSegments,
  SAMPLE_PREVIEW_DATA,
} from '../../../utils/template-variables';
import type { EmailTemplate } from '../../../types';
import {
  Mail,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Monitor,
} from 'lucide-react';

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: EmailTemplate | null;
}

type PreviewDevice = 'desktop' | 'mobile';

export function TemplatePreviewModal({ isOpen, onClose, template }: TemplatePreviewModalProps) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const channel = useMemo(() => getTemplateChannel(template), [template]);

  const emailData = useMemo(() => {
    if (!template || channel !== 'email') return null;
    const rawSubject = getTemplateSubject(template) || template.name;
    const substitutedSubject = renderTemplateWithSampleData(rawSubject, 'global');
    const substitutedHtml = renderTemplateWithSampleData(template.html_template, 'global');
    const safeHtml = sanitizeHtml(substitutedHtml);

    return {
      subject: substitutedSubject,
      html: safeHtml,
    };
  }, [template, channel]);

  const smsData = useMemo(() => {
    if (!template || channel !== 'sms') return null;
    const substitutedText = renderTemplateWithSampleData(template.text_template, 'global');
    const segments = calculateSmsSegments(substitutedText);

    return {
      text: substitutedText,
      segments,
    };
  }, [template, channel]);

  if (!template) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Pré-visualização: ${template.name}`}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Sample Data Disclaimer Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-slate-50 border border-slate-200/80 px-3.5 py-2 rounded-xl text-xs gap-2">
          <div className="flex items-center gap-2 text-slate-700 font-semibold font-heading">
            <Sparkles className="w-4 h-4 text-[#449bd5]" />
            <span>DADOS DE EXEMPLO — PRÉ-VISUALIZAÇÃO ESTÁTICA</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Nenhum lead real consultado • Envio desativado</span>
          </div>
        </div>

        {/* Email Preview */}
        {channel === 'email' && emailData && (
          <div className="space-y-3">
            {/* Desktop / Mobile Switcher */}
            <div className="flex justify-center">
              <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setDevice('desktop')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    device === 'desktop'
                      ? 'bg-white text-[#08254f] shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Desktop</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDevice('mobile')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    device === 'mobile'
                      ? 'bg-white text-[#08254f] shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Mobile (390px)</span>
                </button>
              </div>
            </div>

            <div className="flex justify-center">
              <div
                className={`w-full rounded-2xl border border-slate-200 overflow-hidden shadow-xs bg-white transition-all ${
                  device === 'mobile' ? 'max-w-[390px]' : 'max-w-2xl'
                }`}
              >
                {/* Email Window Chrome */}
                <div className="bg-slate-100/90 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                    <span className="ml-2 text-xs font-semibold text-slate-600 flex items-center gap-1.5 font-heading">
                      <Mail className="w-3.5 h-3.5 text-[#08254f]" /> Cliente de Email ({device === 'mobile' ? 'Mobile' : 'Desktop'})
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold">
                    Email
                  </span>
                </div>

                {/* Email Headers */}
                <div className="px-5 py-3 bg-slate-50/60 border-b border-slate-100 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-medium w-16">De:</span>
                    <span className="font-semibold text-slate-800">
                      {SAMPLE_PREVIEW_DATA.sender_name} &lt;{SAMPLE_PREVIEW_DATA.sender_email}&gt;
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-medium w-16">Para:</span>
                    <span className="text-slate-700">
                      {SAMPLE_PREVIEW_DATA.first_name} {SAMPLE_PREVIEW_DATA.last_name} &lt;{SAMPLE_PREVIEW_DATA.recipient_email}&gt;
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                    <span className="text-slate-400 font-medium w-16">Assunto:</span>
                    <span className="font-bold text-[#08254f] font-heading">
                      {emailData.subject || '(Sem assunto definido)'}
                    </span>
                  </div>
                </div>

                {/* Rendered Sanitized HTML */}
                <div className="p-3 sm:p-4 bg-slate-100/50">
                  <iframe
                    title="Email Preview"
                    srcDoc={emailData.html || '<p style="color:#64748b; font-size:13px; text-align:center; padding:20px;">(Template sem conteúdo HTML)</p>'}
                    className="w-full h-[450px] bg-white rounded-xl border border-slate-200 shadow-2xs"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SMS Preview */}
        {channel === 'sms' && smsData && (
          <div className="max-w-md mx-auto rounded-3xl border border-slate-300 overflow-hidden shadow-sm bg-slate-900 text-white">
            {/* Mobile Phone Chrome */}
            <div className="bg-slate-950 px-5 py-3 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-slate-200 font-heading">
                  Dispositivo Móvel • SMS
                </span>
              </div>
              <span className="text-[10px] font-mono uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded-md font-bold">
                SMS
              </span>
            </div>

            {/* Recipient bar */}
            <div className="bg-slate-900/90 px-4 py-2.5 text-center border-b border-slate-800/80">
              <p className="text-xs font-bold text-slate-200 font-heading">
                {SAMPLE_PREVIEW_DATA.first_name} {SAMPLE_PREVIEW_DATA.last_name}
              </p>
              <p className="text-[11px] font-mono text-slate-400">{SAMPLE_PREVIEW_DATA.recipient_phone}</p>
            </div>

            {/* Bubble Screen */}
            <div className="p-6 bg-slate-800/50 min-h-[260px] flex flex-col justify-end">
              <div className="max-w-[85%] self-start bg-slate-700/80 text-slate-100 rounded-2xl rounded-bl-xs p-4 shadow-sm border border-slate-600/50 text-xs leading-relaxed break-words whitespace-pre-wrap">
                {smsData.text || '(Template de SMS sem mensagem de texto)'}
              </div>
              <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-emerald-400" />
                <span>Mensagem de texto (SMS)</span>
              </div>
            </div>

            {/* Segment & Encoding Footer */}
            <div className="bg-slate-950 px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center justify-between font-mono">
                <span>Contagem: <strong className="text-slate-200">{smsData.segments.characterCount}</strong> caracteres</span>
                <span>Segmentos: <strong className="text-emerald-400">{smsData.segments.segmentCount}</strong> estimado(s)</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>Codificação: <strong className="text-slate-300">{smsData.segments.encoding}</strong></span>
                <span>Restantes no segmento: {smsData.segments.remainingInCurrentSegment}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
