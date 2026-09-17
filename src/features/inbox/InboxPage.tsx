import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Inbox,
  Mail,
  MessageSquare,
  Search,
  RefreshCw,
  Phone,
  ExternalLink,
  Archive,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { supabase } from '../../lib/supabase';
import { ConversationThread } from './ConversationThread';
import { getQualificationStatusBadge, getQualificationStatusLabel } from '../leads/utils/qualificationMapping';
import type {
  Conversation,
  QualificationStatus,
} from '../../types/database';

type FilterTab = 'all' | 'unread' | 'email' | 'sms' | 'closed';

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedIdFromUrl = searchParams.get('id');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUpdatingLead, setIsUpdatingLead] = useState(false);

  // Metrics
  const [metrics, setMetrics] = useState({
    totalOpen: 0,
    totalUnread: 0,
    totalEmail: 0,
    totalSms: 0,
  });

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load conversations with lead and unread counts
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          lead:leads (
            id,
            first_name,
            last_name,
            email,
            phone_e164,
            contact_preference,
            qualification_status,
            course_interest,
            pipeline_stage_id,
            last_response_at,
            pipeline_stages (
              id,
              name,
              code
            )
          )
        `)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Also compute unread counts per conversation
      const { data: unreadRows } = await supabase
        .from('inbound_messages')
        .select('conversation_id')
        .is('read_at', null);

      const unreadMap = new Map<string, number>();
      (unreadRows || []).forEach((r) => {
        if (r.conversation_id) {
          unreadMap.set(r.conversation_id, (unreadMap.get(r.conversation_id) || 0) + 1);
        }
      });

      const enriched: Conversation[] = (data || []).map((conv: any) => ({
        ...conv,
        unread_count: unreadMap.get(conv.id) || 0,
      }));

      setConversations(enriched);

      // Compute metrics
      const openCount = enriched.filter((c) => c.status === 'open').length;
      const unreadCount = enriched.filter((c) => (c.unread_count || 0) > 0).length;
      const emailCount = enriched.filter((c) => c.channel === 'email').length;
      const smsCount = enriched.filter((c) => c.channel === 'sms').length;

      setMetrics({
        totalOpen: openCount,
        totalUnread: unreadCount,
        totalEmail: emailCount,
        totalSms: smsCount,
      });

      // Update selected conversation if needed
      if (selectedIdFromUrl) {
        const found = enriched.find((c) => c.id === selectedIdFromUrl);
        if (found) setSelectedConversation(found);
      } else if (enriched.length > 0 && !selectedConversation) {
        setSelectedConversation(enriched[0]);
        setSearchParams({ id: enriched[0].id });
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedIdFromUrl, selectedConversation, setSearchParams]);

  useEffect(() => {
    loadConversations();
  }, []);

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    setSearchParams({ id: conv.id });
  };

  const handleUpdateQualification = async (newStatus: QualificationStatus) => {
    if (!selectedConversation?.lead?.id) return;
    setIsUpdatingLead(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ qualification_status: newStatus })
        .eq('id', selectedConversation.lead.id);

      if (error) throw error;

      // Update local state
      if (selectedConversation.lead) {
        const updatedLead = { ...selectedConversation.lead, qualification_status: newStatus };
        const updatedConv = { ...selectedConversation, lead: updatedLead };
        setSelectedConversation(updatedConv);
        setConversations((prev) =>
          prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
        );
      }
    } catch (err) {
      console.error('Failed to update qualification status:', err);
    } finally {
      setIsUpdatingLead(false);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((conv) => {
    // Filter Tab
    if (activeFilter === 'unread' && (!conv.unread_count || conv.unread_count === 0)) return false;
    if (activeFilter === 'email' && conv.channel !== 'email') return false;
    if (activeFilter === 'sms' && conv.channel !== 'sms') return false;
    if (activeFilter === 'closed' && conv.status !== 'closed') return false;
    if (activeFilter !== 'closed' && conv.status === 'closed' && activeFilter !== 'all') return false;

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const leadName = `${conv.lead?.first_name || ''} ${conv.lead?.last_name || ''}`.toLowerCase();
      const email = (conv.lead?.email || '').toLowerCase();
      const phone = (conv.lead?.phone_e164 || '').toLowerCase();
      const subject = (conv.subject || '').toLowerCase();
      const preview = (conv.last_message_preview || '').toLowerCase();

      return (
        leadName.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        subject.includes(q) ||
        preview.includes(q)
      );
    }

    return true;
  });

  return (
    <Layout title="Global Inbox">
      <div className="h-[calc(100vh-5rem)] flex flex-col -m-6">
        {/* Top Mini Header / Metrics Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600">
              <Inbox className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-none">Global Inbox</h1>
              <p className="text-xs text-gray-400 mt-0.5">Conversational CRM for Inbound Emails and SMS</p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                {metrics.totalOpen} Open
              </span>
              {metrics.totalUnread > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                  {metrics.totalUnread} Unread
                </span>
              )}
            </div>
            <div className="h-4 w-px bg-gray-200" />
            <button
              onClick={loadConversations}
              disabled={isLoading}
              className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              title="Refresh conversations"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 3-Column Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Column 1: Conversations List */}
          <div className="w-80 lg:w-96 border-r border-gray-200 bg-white flex flex-col">
            {/* Search and Filters */}
            <div className="p-3 border-b border-gray-100 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sender, email, message..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 focus:bg-white transition-all"
                />
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'unread', label: `Unread (${metrics.totalUnread})` },
                    { id: 'email', label: 'Email' },
                    { id: 'sms', label: 'SMS' },
                    { id: 'closed', label: 'Closed' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      activeFilter === tab.id
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {isLoading && conversations.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400">Loading inbox...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400 space-y-2">
                  <Inbox className="w-8 h-8 text-gray-300 mx-auto" />
                  <p>No conversations found</p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = selectedConversation?.id === conv.id;
                  const leadName =
                    `${conv.lead?.first_name || ''} ${conv.lead?.last_name || ''}`.trim() ||
                    conv.lead?.email ||
                    conv.lead?.phone_e164 ||
                    'Unknown Contact';
                  const hasUnread = (conv.unread_count || 0) > 0;

                  return (
                    <button
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv)}
                      className={`w-full text-left p-3.5 transition-all flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-brand-50/70 border-l-4 border-l-brand-600'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {conv.channel === 'email' ? (
                            <span className="p-1 rounded bg-blue-50 text-blue-600 flex-shrink-0">
                              <Mail className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span className="p-1 rounded bg-emerald-50 text-emerald-600 flex-shrink-0">
                              <MessageSquare className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <span
                            className={`text-xs truncate ${
                              hasUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'
                            }`}
                          >
                            {leadName}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {hasUnread && (
                            <span className="w-2 h-2 rounded-full bg-brand-600" title="Unread message" />
                          )}
                          <span className="text-[10px] text-gray-400">
                            {new Date(conv.last_message_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      {conv.subject && (
                        <p className="text-[11px] font-medium text-gray-700 truncate">
                          {conv.subject}
                        </p>
                      )}

                      <div className="flex items-center gap-1 text-[11px] text-gray-500">
                        {conv.last_message_direction === 'outbound' ? (
                          <ArrowUpRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        ) : (
                          <ArrowDownLeft className="w-3 h-3 text-brand-500 flex-shrink-0" />
                        )}
                        <span className="truncate">
                          {conv.last_message_preview || 'No preview available'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        {conv.lead?.qualification_status ? (
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${getQualificationStatusBadge(
                              conv.lead.qualification_status
                            )}`}
                          >
                            {getQualificationStatusLabel(conv.lead.qualification_status)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">No qualification</span>
                        )}

                        {conv.status === 'closed' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                            <Archive className="w-2.5 h-2.5" />
                            Closed
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: Center Thread Area */}
          <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
            {selectedConversation ? (
              <ConversationThread
                key={selectedConversation.id}
                conversation={selectedConversation}
                onStatusChanged={loadConversations}
                onMessageSent={loadConversations}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-center text-gray-400 mb-4">
                  <Inbox className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">No conversation selected</h3>
                <p className="text-xs text-gray-500 max-w-sm">
                  Select a conversation from the left to view the thread, reply, or manage customer responses.
                </p>
              </div>
            )}
          </div>

          {/* Column 3: Lead Quick Context Drawer */}
          {selectedConversation && selectedConversation.lead && (
            <div className="w-72 lg:w-80 border-l border-gray-200 bg-white p-5 flex flex-col overflow-y-auto space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                  Lead Profile
                </h3>
                <Link
                  to={`/leads/${selectedConversation.lead.id}`}
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  Full Profile
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {/* Lead Identity */}
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-sm">
                    {selectedConversation.lead.first_name?.[0] || 'L'}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-gray-900 truncate">
                      {selectedConversation.lead.first_name || ''}{' '}
                      {selectedConversation.lead.last_name || ''}
                    </h4>
                    <span className="text-[11px] text-gray-400">
                      ID: {selectedConversation.lead.id.slice(0, 8)}...
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{selectedConversation.lead.email || 'No email'}</span>
                  </div>

                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">
                      {selectedConversation.lead.phone_e164 || 'No phone'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-gray-400">Preference</span>
                    <span className="font-semibold uppercase text-brand-700 bg-brand-50 px-2 py-0.5 rounded text-[10px]">
                      {selectedConversation.lead.contact_preference}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Qualification Updater */}
              <div className="space-y-2 pt-3 border-t border-gray-100">
                <label className="text-xs font-semibold text-gray-700 block">
                  Qualification Status
                </label>
                <select
                  disabled={isUpdatingLead}
                  value={selectedConversation.lead.qualification_status || ''}
                  onChange={(e) => handleUpdateQualification(e.target.value as QualificationStatus)}
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white focus:ring-1 focus:ring-brand-500 font-medium text-gray-800"
                >
                  <option value="">None</option>
                  <option value="no_response">No Response</option>
                  <option value="some_response">Some Response</option>
                  <option value="interested">Interested</option>
                  <option value="hot">Hot</option>
                  <option value="confirmed">Confirmed</option>
                </select>
                <p className="text-[10px] text-gray-400">
                  Updates sync instantly with CRM pipeline and sequences.
                </p>
              </div>

              {/* CRM Context Info */}
              <div className="space-y-3 pt-3 border-t border-gray-100 text-xs">
                <div>
                  <span className="text-gray-400 block text-[11px]">Course of Interest</span>
                  <span className="font-medium text-gray-800">
                    {selectedConversation.lead.course_interest || 'General / Unspecified'}
                  </span>
                </div>

                <div>
                  <span className="text-gray-400 block text-[11px]">Pipeline Stage</span>
                  <span className="font-medium text-gray-800">
                    {selectedConversation.lead.pipeline_stages?.name || 'Default Stage'}
                  </span>
                </div>

                {selectedConversation.lead.last_response_at && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase block">
                      Response Detected
                    </span>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Replied at{' '}
                      {new Date(selectedConversation.lead.last_response_at).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
