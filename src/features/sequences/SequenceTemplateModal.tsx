import React from 'react';
import { X, Sparkles, ArrowRight, Clock, Mail, MessageSquare, PhoneCall, CheckCircle2, ShieldAlert } from 'lucide-react';
import { SEQUENCE_TEMPLATES, type SequenceTemplate } from './sequence-templates';

interface SequenceTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: SequenceTemplate) => void;
}

export function SequenceTemplateModal({
  isOpen,
  onClose,
  onSelectTemplate,
}: SequenceTemplateModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 via-white to-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Sequence Templates Library</h3>
              <p className="text-xs text-gray-500">
                Choose a pre-built cadence to create an independent, fully customizable follow-up sequence.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 divide-y divide-gray-100">
          {SEQUENCE_TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.id}
              className="pt-4 first:pt-0 group hover:bg-gray-50/60 p-4 rounded-2xl border border-transparent hover:border-gray-200 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 text-sm">{tmpl.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-50 text-brand-700 border border-brand-200">
                      {tmpl.badge}
                    </span>
                    <span className="text-[11px] text-gray-400 font-mono">
                      Trigger: {tmpl.trigger_type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {tmpl.description}
                  </p>

                  {/* Stop conditions preview */}
                  {tmpl.stop_conditions.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50/60 border border-amber-200/60 px-2.5 py-1 rounded-lg w-fit">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Stops when qualification becomes: <strong className="font-semibold">{tmpl.stop_conditions[0].values?.join(', ')}</strong>
                      </span>
                    </div>
                  )}

                  {/* Step Pills Preview */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {tmpl.steps.map((s, idx) => (
                      <React.Fragment key={idx}>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] font-medium text-gray-700 shadow-2xs">
                          {s.step_type === 'wait' && <Clock className="w-3 h-3 text-indigo-500" />}
                          {s.action_type === 'send_email' && <Mail className="w-3 h-3 text-blue-500" />}
                          {s.action_type === 'send_sms' && <MessageSquare className="w-3 h-3 text-emerald-500" />}
                          {s.action_type === 'create_call_task' && <PhoneCall className="w-3 h-3 text-purple-500" />}
                          {s.action_type === 'create_task' && <CheckCircle2 className="w-3 h-3 text-amber-500" />}
                          {s.step_type === 'condition' && <span className="font-mono text-gray-400 font-bold">IF</span>}
                          <span>
                            {s.step_type === 'wait'
                              ? `Wait ${s.config.duration_value} ${s.config.duration_unit}`
                              : s.action_type || s.step_type}
                          </span>
                        </div>
                        {idx < tmpl.steps.length - 1 && (
                          <ArrowRight className="w-3 h-3 text-gray-300" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => onSelectTemplate(tmpl)}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs transition-colors flex items-center gap-2 shadow-xs group-hover:scale-102"
                >
                  Use Template
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>5 curated clinical follow-up sequences available.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-200/60 font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
