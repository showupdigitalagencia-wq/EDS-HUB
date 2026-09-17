import React from 'react';
import { Share2, PhoneCall, Mail, MessageSquare } from 'lucide-react';
import type { DashboardDemographics } from '../../../types/database';

interface SourceAndChannelWidgetProps {
  demographics: DashboardDemographics;
}

export const SourceAndChannelWidget: React.FC<SourceAndChannelWidgetProps> = ({
  demographics,
}) => {
  const { sources, contact_preference } = demographics;

  const getSourceLabel = (src: string) => {
    switch (src.toLowerCase()) {
      case 'meta':
        return 'Meta Ads (Facebook/Instagram)';
      case 'google':
        return 'Google Ads';
      case 'form':
        return 'Formulário Nativo';
      case 'manual':
        return 'Cadastro Manual';
      case 'test':
        return 'Lead de Teste';
      default:
        return src || 'Desconhecido';
    }
  };

  const getPreferenceIcon = (pref: string) => {
    switch (pref.toLowerCase()) {
      case 'email':
        return <Mail className="w-4 h-4 text-blue-500" />;
      case 'sms':
        return <MessageSquare className="w-4 h-4 text-purple-500" />;
      case 'call':
        return <PhoneCall className="w-4 h-4 text-emerald-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 1. Canonical Sources */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-sky-50 text-sky-600">
                <Share2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Origem Canônica dos Leads
                </h3>
                <p className="text-xs text-gray-500">
                  Canais oficiais de aquisição de leads no CRM
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              SNAPSHOT
            </span>
          </div>

          <div className="space-y-3">
            {sources.map((s) => (
              <div key={s.source} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-800">
                    {getSourceLabel(s.source)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">{s.lead_count}</span>
                    <span className="text-gray-400 w-12 text-right">
                      {s.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all duration-500"
                    style={{ width: `${Math.max(s.percentage, 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 text-[11px] text-gray-400">
          Canais canônicos: meta, google, form, manual, test
        </div>
      </div>

      {/* 2. Contact Preferences */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-violet-50 text-violet-600">
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Preferência de Contato
                </h3>
                <p className="text-xs text-gray-500">
                  Canal declarado pelo lead (Email, SMS, Ligação)
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              SNAPSHOT
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 my-2">
            {contact_preference.map((p) => (
              <div
                key={p.preference}
                className="p-4 rounded-xl border border-gray-100 bg-gray-50 flex flex-col items-center text-center justify-center"
              >
                <div className="p-2 rounded-full bg-white shadow-xs mb-2">
                  {getPreferenceIcon(p.preference)}
                </div>
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {p.preference}
                </span>
                <span className="text-xl font-bold text-gray-900 mt-1">
                  {p.lead_count}
                </span>
                <span className="text-xs text-gray-400 mt-0.5 font-medium">
                  {p.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 text-[11px] text-gray-400">
          Garante conformidade com as regras de contato automático
        </div>
      </div>
    </div>
  );
};
