import { useEffect, useState } from 'react';
import {
  X,
  FileText,
  Clock,
  Globe,
  Share2,
  Copy,
  Check,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

export interface FormSubmissionField {
  label: string;
  value: string;
}

export interface LeadFormSubmissionItem {
  id: string;
  source: string;
  source_raw?: string;
  form_name: string;
  submitted_at: string;
  fields: FormSubmissionField[];
}

interface LeadFormSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadName?: string;
}

export function LeadFormSubmissionModal({
  isOpen,
  onClose,
  leadId,
  leadName,
}: LeadFormSubmissionModalProps) {
  const [submissions, setSubmissions] = useState<LeadFormSubmissionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !leadId) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);
    setSelectedIndex(0);

    async function fetchSubmissions() {
      try {
        const { data, error: rpcErr } = await supabase.rpc('get_lead_form_submissions', {
          p_lead_id: leadId,
        });

        if (rpcErr) throw rpcErr;

        if (isMounted) {
          const list = Array.isArray(data) ? data : [];
          setSubmissions(list);
        }
      } catch (err: any) {
        console.error('Error fetching lead form submissions:', err);
        if (isMounted) {
          setError(err.message || 'Falha ao carregar dados do formulário.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void fetchSubmissions();

    return () => {
      isMounted = false;
    };
  }, [isOpen, leadId]);

  if (!isOpen) return null;

  const currentSubmission = submissions[selectedIndex] || null;

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return dateStr;
    }
  };

  const getSourceBadge = (src: string) => {
    const s = src.toLowerCase();
    if (s.includes('meta') || s.includes('facebook') || s.includes('instagram')) {
      return {
        label: 'Meta Lead Ads',
        classes: 'bg-blue-50 text-blue-700 border-blue-200',
        icon: <Share2 className="w-3.5 h-3.5 text-blue-600" />,
      };
    }
    if (s.includes('site') || s.includes('form') || s.includes('website')) {
      return {
        label: 'Site',
        classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: <Globe className="w-3.5 h-3.5 text-emerald-600" />,
      };
    }
    if (s.includes('hubspot')) {
      return {
        label: 'HubSpot',
        classes: 'bg-orange-50 text-orange-700 border-orange-200',
        icon: <Share2 className="w-3.5 h-3.5 text-orange-600" />,
      };
    }
    return {
      label: src,
      classes: 'bg-slate-50 text-slate-700 border-slate-200',
      icon: <FileText className="w-3.5 h-3.5 text-slate-500" />,
    };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
      data-testid="lead-form-submission-modal"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/80 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-heading">
                Formulário do Lead
              </h3>
              <p className="text-[11px] text-slate-500 truncate max-w-xs sm:max-w-md">
                {leadName ? `Respostas submetidas por ${leadName}` : 'Dados originais submetidos pelo contato'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            data-testid="close-form-submission-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <div className="w-7 h-7 border-2 border-[#449bd5] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-slate-400 font-medium">Carregando dados originais do formulário...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p className="font-semibold">Erro ao carregar formulário</p>
                <p className="mt-0.5 text-[11px]">{error}</p>
              </div>
            </div>
          ) : submissions.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <HelpCircle className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-slate-700 font-heading">
                Nenhum formulário registrado
              </h4>
              <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                Não foram encontrados envios originais de formulário salvos no sistema para este contato.
              </p>
            </div>
          ) : (
            <>
              {/* Multiple Submissions Selector / Navigation */}
              {submissions.length > 1 && (
                <div className="space-y-1.5 pb-2 border-b border-slate-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Envios registrados ({submissions.length})
                  </span>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {submissions.map((sub, idx) => (
                      <button
                        key={sub.id || idx}
                        type="button"
                        onClick={() => setSelectedIndex(idx)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
                          selectedIndex === idx
                            ? 'bg-[#08254f] text-white border-[#08254f] shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        Envio #{submissions.length - idx} {idx === 0 ? '(Mais recente)' : ''} •{' '}
                        {formatDateTime(sub.submitted_at).split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentSubmission && (
                <div className="space-y-4">
                  {/* Metadata Banner */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                        Origem
                      </span>
                      <div className="mt-1 flex items-center gap-1.5">
                        {(() => {
                          const badge = getSourceBadge(currentSubmission.source);
                          return (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border ${badge.classes}`}
                            >
                              {badge.icon}
                              <span>{badge.label}</span>
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                        Formulário
                      </span>
                      <span className="font-semibold text-slate-800 block mt-1 truncate" title={currentSubmission.form_name}>
                        {currentSubmission.form_name || 'Inscrição'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                        Data de envio
                      </span>
                      <div className="flex items-center gap-1 text-slate-700 font-semibold mt-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{formatDateTime(currentSubmission.submitted_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Submitted Fields */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-700 font-heading uppercase tracking-wider block">
                      Campos e Respostas Submetidos
                    </span>

                    <div className="space-y-2 divide-y divide-slate-100 bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-2xs">
                      {currentSubmission.fields.map((field, fIdx) => (
                        <div
                          key={fIdx}
                          className="p-3 flex items-start justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-[11px] font-semibold text-slate-400 block">
                              {field.label}
                            </span>
                            <span className="text-xs font-bold text-slate-800 break-words mt-0.5 block select-text font-sans">
                              {field.value || <span className="text-slate-400 font-normal italic">Não informado</span>}
                            </span>
                          </div>

                          {field.value && (
                            <button
                              type="button"
                              onClick={() => handleCopy(`${selectedIndex}-${fIdx}`, field.value)}
                              className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors shrink-0"
                              title="Copiar valor"
                            >
                              {copiedKey === `${selectedIndex}-${fIdx}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400">
            {submissions.length > 0 ? `${submissions.length} envio(s) registrado(s)` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
