import { useState, useEffect, useRef } from 'react';
import {
  Mail,
  MessageSquare,
  Clock,
  AlertCircle,
  Paperclip,
  Check,
  User,
  Bot,
  Lock,
  Unlock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { sanitizeHtml } from '../../utils/sanitize-html';
import { ConversationComposer } from './ConversationComposer';
import type {
  Conversation,
  ConversationThreadMessage,
} from '../../types/database';

interface ConversationThreadProps {
  conversation: Conversation;
  onStatusChanged?: () => void;
  onMessageSent?: () => void;
}

export function ConversationThread({
  conversation,
  onStatusChanged,
  onMessageSent,
}: ConversationThreadProps) {
  const [messages, setMessages] = useState<ConversationThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Inbound Messages
      const { data: inbounds } = await supabase
        .from('inbound_messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('received_at', { ascending: true });

      // 2. Fetch Outbound Messages
      const { data: outbounds } = await supabase
        .from('outbound_messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      // 3. Unify and sort chronologically
      const unified: ConversationThreadMessage[] = [];

      (inbounds || []).forEach((inMsg: any) => {
        unified.push({
          id: inMsg.id,
          conversation_id: conversation.id,
          direction: 'inbound',
          channel: inMsg.channel,
          provider: inMsg.provider,
          sender: inMsg.from_address,
          recipient: inMsg.to_address,
          subject: inMsg.subject,
          body: inMsg.body_text,
          body_html: inMsg.body_html,
          attachments: inMsg.attachments || [],
          timestamp: inMsg.received_at,
          read_at: inMsg.read_at,
        });
      });

      (outbounds || []).forEach((outMsg: any) => {
        unified.push({
          id: outMsg.id,
          conversation_id: conversation.id,
          direction: 'outbound',
          channel: outMsg.channel,
          provider: outMsg.provider,
          sender: 'Expert Dental Solutions',
          recipient: outMsg.recipient,
          subject: outMsg.subject_snapshot,
          body: outMsg.body_snapshot,
          status: outMsg.status,
          timestamp: outMsg.sent_at || outMsg.created_at,
          is_manual_reply: outMsg.is_manual_reply,
        });
      });

      unified.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setMessages(unified);

      // Automatically mark as read if there are unread inbound messages
      const hasUnread = (inbounds || []).some((m: any) => !m.read_at);
      if (hasUnread) {
        await supabase.rpc('mark_conversation_read' as any, {
          p_conversation_id: conversation.id,
        });
      }
    } catch (err) {
      console.error('Failed to load conversation thread messages:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [conversation.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleConversationStatus = async () => {
    setIsUpdatingStatus(true);
    try {
      if (conversation.status === 'open') {
        await supabase.rpc('close_conversation' as any, {
          p_conversation_id: conversation.id,
        });
      } else {
        await supabase.rpc('reopen_conversation' as any, {
          p_conversation_id: conversation.id,
        });
      }
      onStatusChanged?.();
    } catch (err) {
      console.error('Failed to toggle conversation status:', err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const latestInbound = [...messages].reverse().find((m) => m.direction === 'inbound');

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Thread Header */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white z-10">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              conversation.channel === 'email'
                ? 'bg-blue-50 text-blue-600'
                : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            {conversation.channel === 'email' ? (
              <Mail className="w-4 h-4" />
            ) : (
              <MessageSquare className="w-4 h-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 font-heading">
                {conversation.subject || `Conversa via ${conversation.channel.toUpperCase()}`}
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  conversation.status === 'open'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                {conversation.status === 'open' ? 'Aberta' : 'Fechada'}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'} • Última atividade{' '}
              {new Date(conversation.last_message_at).toLocaleString('pt-BR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleConversationStatus}
            disabled={isUpdatingStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors cursor-pointer"
          >
            {conversation.status === 'open' ? (
              <>
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                <span>Fechar Conversa</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5 text-gray-400" />
                <span>Reabrir Conversa</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Message Stream */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50/50">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-xs">
            Carregando mensagens...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 space-y-2">
            <MessageSquare className="w-8 h-8 text-gray-300 stroke-1" />
            <p className="text-xs">Nenhuma mensagem nesta conversa.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === 'inbound';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 max-w-[85%] ${
                  isInbound ? 'mr-auto items-start' : 'ml-auto flex-row-reverse items-start'
                }`}
              >
                {/* Avatar Icon */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-2xs ${
                    isInbound
                      ? 'bg-slate-200 text-slate-700'
                      : msg.is_manual_reply
                      ? 'bg-[#8a1c1c] text-white'
                      : 'bg-[#08254f] text-white'
                  }`}
                >
                  {isInbound ? (
                    <User className="w-3.5 h-3.5" />
                  ) : msg.is_manual_reply ? (
                    <User className="w-3.5 h-3.5" />
                  ) : (
                    <Bot className="w-3.5 h-3.5" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={`rounded-2xl p-3.5 text-xs shadow-2xs space-y-2 ${
                    isInbound
                      ? 'bg-white text-slate-900 border border-slate-200/80 rounded-tl-xs'
                      : 'bg-[#08254f] text-white rounded-tr-xs shadow-xs'
                  }`}
                >
                  {/* Metadata Header */}
                  <div className="flex items-center justify-between gap-3 text-[10px] opacity-80">
                    <span className="font-semibold truncate">
                      {isInbound ? msg.sender : msg.is_manual_reply ? 'Equipe (Manual)' : 'Sequência Automatizada'}
                    </span>
                    <span className="shrink-0 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Email Subject Snapshot */}
                  {msg.subject && (
                    <p
                      className={`text-xs font-bold border-b pb-1.5 font-heading ${
                        isInbound ? 'border-slate-100 text-slate-900' : 'border-white/15 text-white'
                      }`}
                    >
                      {msg.subject}
                    </p>
                  )}

                  {/* Message Body */}
                  {isInbound && msg.body_html ? (
                    <div
                      className="prose prose-xs max-w-none break-words text-gray-800"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.body_html) }}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed break-words">
                      {msg.body}
                    </p>
                  )}

                  {/* Attachments Pills */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {msg.attachments.map((att, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 text-[10px] border border-gray-200"
                        >
                          <Paperclip className="w-3 h-3 text-gray-400" />
                          {att.filename} ({att.size ? `${Math.round(att.size / 1024)} KB` : 'arquivo'})
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Delivery Status Indicator (Outbound) - Factual Single Check per Correction 2 */}
                  {!isInbound && (
                    <div className="flex items-center justify-end gap-1 text-[10px] opacity-80 pt-1 font-sans">
                      {msg.status === 'sent' && (
                        <>
                          <Check className="w-3 h-3 text-emerald-300" />
                          <span>Enviado</span>
                        </>
                      )}
                      {(msg.status === 'pending' || msg.status === 'queued') && (
                        <>
                          <Clock className="w-3 h-3 text-amber-300" />
                          <span>Na fila</span>
                        </>
                      )}
                      {msg.status === 'failed' && (
                        <>
                          <AlertCircle className="w-3 h-3 text-rose-300" />
                          <span>Falha</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <ConversationComposer
        leadId={conversation.lead_id}
        conversationId={conversation.id}
        leadPreference={conversation.lead?.contact_preference}
        initialChannel={conversation.channel}
        inReplyToMessageId={latestInbound?.id}
        defaultSubject={conversation.subject}
        onMessageSent={() => {
          loadMessages();
          onMessageSent?.();
        }}
      />
    </div>
  );
}
