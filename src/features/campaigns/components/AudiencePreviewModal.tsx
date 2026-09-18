import { useState } from 'react';
import type { AudiencePreviewResult } from '../../../types';
import { X, CheckCircle2, XCircle, Search } from 'lucide-react';

interface AudiencePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: 'email' | 'sms' | 'call';
  previewResult: AudiencePreviewResult;
}

export function AudiencePreviewModal({
  isOpen,
  onClose,
  channel,
  previewResult,
}: AudiencePreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'eligible' | 'excluded'>('eligible');
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const leads = previewResult.leads || [];
  const eligibleLeads = leads.filter((l) => l.is_eligible);
  const excludedLeads = leads.filter((l) => !l.is_eligible);

  const displayedList = (activeTab === 'eligible' ? eligibleLeads : excludedLeads).filter((lead) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.toLowerCase();
    const email = (lead.email || '').toLowerCase();
    const phone = (lead.phone || '').toLowerCase();
    return fullName.includes(term) || email.includes(term) || phone.includes(term);
  });

  const formatExclusionReason = (reason: string | null) => {
    switch (reason) {
      case 'CHANNEL_PREFERENCE_MISMATCH':
        return 'Channel Mismatch';
      case 'NO_VALID_CONTACT_PREFERENCE':
        return 'Missing Preference';
      case 'MISSING_EMAIL':
        return 'Missing Email';
      case 'MISSING_PHONE':
        return 'Missing Phone';
      case 'TEST_SOURCE':
        return 'Test Lead';
      default:
        return reason || 'Excluded';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">Audience Preview & Eligibility Audit</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Evaluated for Channel:{' '}
              <span className="font-bold text-gray-800 uppercase">{channel}</span> • Total Matches:{' '}
              <span className="font-bold text-gray-900">{previewResult.total_matched}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Switcher & Search Bar */}
        <div className="px-6 pt-4 pb-2 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('eligible')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'eligible'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Eligible ({previewResult.eligible_count})
            </button>
            <button
              onClick={() => setActiveTab('excluded')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'excluded'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <XCircle className="h-3.5 w-3.5" />
              Excluded ({previewResult.excluded_count})
            </button>
          </div>

          <div className="relative max-w-xs w-full">
            <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search sample leads..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {displayedList.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              No contacts found in this view.
            </div>
          ) : (
            <div className="space-y-2">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-hidden border border-gray-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Email / Phone</th>
                      <th className="px-4 py-2.5">Stage</th>
                      <th className="px-4 py-2.5">Score</th>
                      <th className="px-4 py-2.5">Preference</th>
                      <th className="px-4 py-2.5">Status / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayedList.map((lead) => (
                      <tr key={lead.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-900">
                          {lead.first_name || lead.last_name
                            ? `${lead.first_name || ''} ${lead.last_name || ''}`
                            : 'Unknown Lead'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div>{lead.email || '—'}</div>
                          {lead.phone && <div className="text-[11px] text-gray-400">{lead.phone}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-[11px] font-medium">
                            {lead.stage_name || lead.stage_code || 'Capture'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              lead.lead_score >= 70
                                ? 'bg-emerald-100 text-emerald-800'
                                : lead.lead_score >= 40
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {lead.lead_score} pts
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 capitalize">
                          {lead.contact_preference || 'None'}
                        </td>
                        <td className="px-4 py-3">
                          {lead.is_eligible ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]">
                              <CheckCircle2 className="h-3 w-3" /> Eligible
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-semibold text-[11px]">
                              <XCircle className="h-3 w-3" /> {formatExclusionReason(lead.exclusion_reason)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {displayedList.map((lead) => (
                  <div key={lead.id} className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-2 shadow-2xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-bold text-xs text-gray-900 block">
                          {lead.first_name || lead.last_name
                            ? `${lead.first_name || ''} ${lead.last_name || ''}`
                            : 'Unknown Lead'}
                        </span>
                        <span className="text-[11px] text-gray-500">{lead.email || lead.phone || 'No contact info'}</span>
                      </div>
                      {lead.is_eligible ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                          Eligible
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                          {formatExclusionReason(lead.exclusion_reason)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-gray-600 pt-1 border-t border-gray-100">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                        {lead.stage_name || lead.stage_code || 'Capture'}
                      </span>
                      <span>Score: {lead.lead_score} pts</span>
                      <span>Pref: {lead.contact_preference || 'None'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-900 text-white hover:bg-black transition-colors cursor-pointer"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
