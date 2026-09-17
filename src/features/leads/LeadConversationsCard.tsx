import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Mail,
  RefreshCw,
  Plus,
  Inbox,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ConversationThread } from '../inbox/ConversationThread';
import { ConversationComposer } from '../inbox/ConversationComposer';
import type { Lead } from '../../types';
import type { Conversation } from '../../types/database';

interface LeadConversationsCardProps {
  lead: Lead;
  onLeadUpdated?: () => void;
}

type TabType = 'all' | 'email' | 'sms';

export function LeadConversationsCard({ lead, onLeadUpdated }: LeadConversationsCardProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isComposingNew, setIsComposingNew] = useState(false);

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    try {
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
            pipeline_stage_id
          )
        `)
        .eq('lead_id', lead.id)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Compute unread count for each conversation
      const { data: unreadRows } = await supabase
        .from('inbound_messages')
        .select('conversation_id')
        .eq('lead_id', lead.id)
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

      // Default select
      if (enriched.length > 0) {
        if (!selectedConversation || !enriched.some((c) => c.id === selectedConversation.id)) {
          setSelectedConversation(enriched[0]);
        } else {
          // Update selected conversation with fresh data
          const updated = enriched.find((c) => c.id === selectedConversation.id);
          if (updated) setSelectedConversation(updated);
        }
      } else {
        setSelectedConversation(null);
      }
    } catch (err) {
      console.error('Failed to load lead conversations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [lead.id, selectedConversation]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const filteredConversations = conversations.filter((c) => {
    if (activeTab === 'email') return c.channel === 'email';
    if (activeTab === 'sms') return c.channel === 'sms';
    return true;
  });

  const handleMessageSent = () => {
    setIsComposingNew(false);
    loadConversations();
    onLeadUpdated?.();
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Conversations ({conversations.length})
            </h2>
            <p className="text-[11px] text-gray-400">
              Two-way email threads & SMS message exchange
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className="flex items-center bg-gray-100 p-0.5 rounded-lg text-xs">
            {(['all', 'email', 'sms'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setIsComposingNew(false);
                }}
                className={`px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsComposingNew(!isComposingNew)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            {isComposingNew ? 'View Threads' : 'New Message'}
          </button>

          <button
            onClick={loadConversations}
            disabled={isLoading}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            title="Refresh conversations"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isComposingNew ? (
        <div className="p-4 bg-gray-50">
          <div className="max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-4 shadow-xs">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">
              Compose Direct Outreach
            </h3>
            <ConversationComposer
              leadId={lead.id}
              leadName={`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.email || undefined}
              leadPreference={lead.contact_preference}
              initialChannel={lead.contact_preference === 'sms' ? 'sms' : 'email'}
              onMessageSent={handleMessageSent}
            />
          </div>
        </div>
      ) : conversations.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400 mx-auto">
            <Inbox className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-800">No conversations recorded</p>
            <p className="text-[11px] text-gray-400 max-w-sm mx-auto mt-0.5">
              No inbound or manual outbound messages yet. Outbound sequence deliveries and inbound replies will appear here.
            </p>
          </div>
          <button
            onClick={() => setIsComposingNew(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Send First Message
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row min-h-[480px]">
          {/* Thread Switcher (if more than 1 conversation) */}
          {conversations.length > 1 && (
            <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-gray-100 bg-gray-50/50 p-2 space-y-1 overflow-y-auto max-h-[480px]">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1 block">
                Threads
              </span>
              {filteredConversations.map((conv) => {
                const isSelected = selectedConversation?.id === conv.id;
                const hasUnread = (conv.unread_count || 0) > 0;

                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`w-full text-left p-2 rounded-lg text-xs transition-all flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-white shadow-xs border border-gray-200 text-gray-900 font-semibold'
                        : 'hover:bg-gray-100/70 text-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 truncate">
                        {conv.channel === 'email' ? (
                          <Mail className="w-3 h-3 text-blue-600 flex-shrink-0" />
                        ) : (
                          <MessageSquare className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                        )}
                        <span className="truncate">{conv.subject || 'Direct SMS Thread'}</span>
                      </span>
                      {hasUnread && (
                        <span className="w-2 h-2 rounded-full bg-brand-600 flex-shrink-0" />
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 truncate">
                      {new Date(conv.last_message_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active Thread Display */}
          <div className="flex-1 flex flex-col min-h-[480px]">
            {selectedConversation ? (
              <ConversationThread
                key={selectedConversation.id}
                conversation={selectedConversation}
                onStatusChanged={loadConversations}
                onMessageSent={() => {
                  loadConversations();
                  onLeadUpdated?.();
                }}
              />
            ) : (
              <div className="p-8 text-center text-xs text-gray-400">
                Select a thread from above to view messages.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
