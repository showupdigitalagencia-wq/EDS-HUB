import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare,
  Mail,
  RefreshCw,
  Plus,
  Inbox,
  Check,
  CheckCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  ArrowDownLeft,
  Calendar,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { sanitizeHtml } from '../../utils/sanitize-html';
import { ManualEmailComposerModal } from './components/ManualEmailComposerModal';
import type { Lead } from '../../types';

export interface LeadConversationsCardProps {
  lead: Lead;
  onLeadUpdated?: () => void;
  onOpenComposer?: () => void;
}

export type TimelineDeliveryStatus =
  | 'sent'
  | 'delivered'
  | 'received'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'queued'
  | 'pending';

export interface LeadTimelineMessage {
  id: string;
  leadId: string;
  conversationId: string | null;
  direction: 'inbound' | 'outbound';
  channel: 'email' | 'sms' | 'whatsapp';
  senderLabel: string;
  subject: string | null;
  body: string;
  bodyHtml: string | null;
  status: TimelineDeliveryStatus;
  statusLabel: string;
  timestamp: string;
  isManualReply?: boolean;
}

interface ThreadGroup {
  id: string;
  subject: string;
  channel: 'email' | 'sms' | 'whatsapp';
  lastMessageAt: string;
  messages: LeadTimelineMessage[];
}

function formatMessageDateTime(isoString: string): { dateStr: string; timeStr: string } {
  if (!isoString) return { dateStr: '', timeStr: '' };
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return { dateStr: '', timeStr: '' };

  const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return { dateStr, timeStr };
}

function resolveDeliveryStatus(
  direction: 'inbound' | 'outbound',
  status?: string | null
): { status: TimelineDeliveryStatus; label: string } {
  if (direction === 'inbound') {
    return { status: 'received', label: 'Recebido' };
  }

  switch (status) {
    case 'delivered':
      return { status: 'delivered', label: 'Entregue' };
    case 'sent':
      return { status: 'sent', label: 'Enviado' };
    case 'bounced':
    case 'failed':
      return { status: 'bounced', label: 'Falha de entrega' };
    case 'complained':
      return { status: 'complained', label: 'Reclamação / Spam' };
    case 'queued':
    case 'pending':
      return { status: 'queued', label: 'Na fila' };
    default:
      return { status: 'sent', label: 'Enviado' };
  }
}

function MessageBodyText({ msg }: { msg: LeadTimelineMessage }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = (msg.body || '').length > 280;

  if (msg.direction === 'inbound' && msg.bodyHtml) {
    return (
      <div className="space-y-1.5 text-xs text-slate-800 break-words">
        <div
          className={`prose prose-xs max-w-none text-slate-800 leading-relaxed ${
            !isExpanded && isLong ? 'line-clamp-4' : ''
          }`}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.bodyHtml) }}
        />
        {isLong && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[11px] font-semibold text-[#08254f] hover:underline cursor-pointer pt-0.5 inline-block"
          >
            {isExpanded ? 'Ver menos' : 'Ver mais'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 text-xs text-slate-700 break-words">
      <p
        className={`whitespace-pre-wrap leading-relaxed ${
          !isExpanded && isLong ? 'line-clamp-4' : ''
        }`}
      >
        {msg.body}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[11px] font-semibold text-[#08254f] hover:underline cursor-pointer pt-0.5 inline-block"
        >
          {isExpanded ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}

export function LeadConversationsCard({
  lead,
  onLeadUpdated,
  onOpenComposer,
}: LeadConversationsCardProps) {
  const [messages, setMessages] = useState<LeadTimelineMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeChannelFilter, setActiveChannelFilter] = useState<'all' | 'email' | 'sms'>('all');
  const [isInternalComposerOpen, setIsInternalComposerOpen] = useState(false);

  const leadName = useMemo(() => {
    return (
      [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
      lead.email ||
      'Lead'
    );
  }, [lead.first_name, lead.last_name, lead.email]);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Outbound Messages strictly scoped to lead.id
      const { data: outbounds, error: outErr } = await supabase
        .from('outbound_messages')
        .select(
          'id, lead_id, conversation_id, channel, provider, recipient, template_key, subject_snapshot, body_snapshot, status, provider_status, sent_at, delivered_at, bounced_at, complained_at, failed_at, is_manual_reply, created_at'
        )
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: true });

      if (outErr) {
        console.error('Failed to load outbound messages for lead:', outErr);
      }

      // 2. Fetch Inbound Messages strictly scoped to lead.id
      const { data: inbounds, error: inErr } = await supabase
        .from('inbound_messages')
        .select(
          'id, lead_id, conversation_id, channel, provider, from_address, to_address, subject, body_text, body_html, received_at, created_at'
        )
        .eq('lead_id', lead.id)
        .order('received_at', { ascending: true });

      if (inErr) {
        console.error('Failed to load inbound messages for lead:', inErr);
      }

      // 3. Unify messages
      const unified: LeadTimelineMessage[] = [];

      (outbounds || []).forEach((out: any) => {
        const channel = out.channel === 'sms' ? 'sms' : 'email';
        const { status, label } = resolveDeliveryStatus('outbound', out.status);
        unified.push({
          id: out.id,
          leadId: lead.id,
          conversationId: out.conversation_id || null,
          direction: 'outbound',
          channel,
          senderLabel: `Você · ${channel === 'sms' ? 'SMS' : 'E-mail'}`,
          subject: out.subject_snapshot || null,
          body: out.body_snapshot || '',
          bodyHtml: null,
          status,
          statusLabel: label,
          timestamp: out.sent_at || out.created_at,
          isManualReply: Boolean(out.is_manual_reply),
        });
      });

      (inbounds || []).forEach((inMsg: any) => {
        const channel = inMsg.channel === 'sms' ? 'sms' : 'email';
        const { status, label } = resolveDeliveryStatus('inbound', null);
        unified.push({
          id: inMsg.id,
          leadId: lead.id,
          conversationId: inMsg.conversation_id || null,
          direction: 'inbound',
          channel,
          senderLabel: `${leadName} · ${channel === 'sms' ? 'SMS' : 'E-mail'}`,
          subject: inMsg.subject || null,
          body: inMsg.body_text || '',
          bodyHtml: inMsg.body_html || null,
          status,
          statusLabel: label,
          timestamp: inMsg.received_at || inMsg.created_at,
          isManualReply: false,
        });
      });

      // Sort chronologically ascending
      unified.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      setMessages(unified);
    } catch (err) {
      console.error('Error loading lead communication history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [lead.id, leadName]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Realtime subscription for immediate status updates (e.g. sent -> delivered)
  useEffect(() => {
    if (typeof supabase?.channel !== 'function') return;

    const channel = supabase
      .channel(`lead-comms-${lead.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'outbound_messages',
          filter: `lead_id=eq.${lead.id}`,
        },
        () => {
          loadMessages();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inbound_messages',
          filter: `lead_id=eq.${lead.id}`,
        },
        () => {
          loadMessages();
        }
      )
      .subscribe();

    return () => {
      if (typeof supabase?.removeChannel === 'function') {
        supabase.removeChannel(channel);
      }
    };
  }, [lead.id, loadMessages]);

  const handleOpenComposer = () => {
    if (onOpenComposer) {
      onOpenComposer();
    } else {
      setIsInternalComposerOpen(true);
    }
  };

  const filteredMessages = useMemo(() => {
    if (activeChannelFilter === 'all') return messages;
    return messages.filter((m) => m.channel === activeChannelFilter);
  }, [messages, activeChannelFilter]);

  const hasSms = useMemo(() => {
    return messages.some((m) => m.channel === 'sms');
  }, [messages]);

  // Group messages by conversation / thread
  const threadGroups = useMemo(() => {
    if (filteredMessages.length === 0) return [];

    const map = new Map<string, ThreadGroup>();

    filteredMessages.forEach((msg) => {
      const threadKey =
        msg.conversationId ||
        (msg.subject ? `subject:${msg.subject.trim().toLowerCase()}` : `thread:${msg.channel}`);

      if (!map.has(threadKey)) {
        map.set(threadKey, {
          id: threadKey,
          subject: msg.subject || (msg.channel === 'sms' ? 'Mensagem SMS' : 'Conversa via E-mail'),
          channel: msg.channel,
          lastMessageAt: msg.timestamp,
          messages: [],
        });
      }

      const group = map.get(threadKey)!;
      group.messages.push(msg);
      if (new Date(msg.timestamp).getTime() > new Date(group.lastMessageAt).getTime()) {
        group.lastMessageAt = msg.timestamp;
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
    );
  }, [filteredMessages]);

  const renderStatusBadge = (msg: LeadTimelineMessage) => {
    if (msg.direction === 'inbound') {
      return (
        <span
          data-testid={`delivery-status-${msg.id}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/80"
          title="Mensagem recebida do lead"
        >
          <ArrowDownLeft className="w-3 h-3 text-sky-600" />
          <span>Recebido</span>
        </span>
      );
    }

    switch (msg.status) {
      case 'delivered':
        return (
          <span
            data-testid={`delivery-status-${msg.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80"
            title="Entrega confirmada pelo provedor"
          >
            <CheckCheck className="w-3 h-3 text-emerald-600" />
            <span>Entregue</span>
          </span>
        );
      case 'sent':
        return (
          <span
            data-testid={`delivery-status-${msg.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/80"
            title="Enviado ao provedor"
          >
            <Check className="w-3 h-3 text-blue-600" />
            <span>Enviado</span>
          </span>
        );
      case 'bounced':
      case 'failed':
        return (
          <span
            data-testid={`delivery-status-${msg.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80"
            title="Falha definitiva ou rejeição na entrega"
          >
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>Falha de entrega</span>
          </span>
        );
      case 'complained':
        return (
          <span
            data-testid={`delivery-status-${msg.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-300"
            title="Reclamação de spam registrada"
          >
            <AlertCircle className="w-3 h-3 text-rose-700" />
            <span>Reclamação / Spam</span>
          </span>
        );
      case 'queued':
      case 'pending':
        return (
          <span
            data-testid={`delivery-status-${msg.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80"
            title="Aguardando disparo"
          >
            <Clock className="w-3 h-3 text-amber-600" />
            <span>Na fila</span>
          </span>
        );
      default:
        return (
          <span
            data-testid={`delivery-status-${msg.id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200"
          >
            <Check className="w-3 h-3 text-slate-500" />
            <span>Enviado</span>
          </span>
        );
    }
  };

  return (
    <div
      data-testid="lead-conversations-card"
      className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden w-full max-w-full"
    >
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#08254f] text-[#449bd5] flex items-center justify-center shadow-2xs shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold font-heading text-[#08254f] uppercase tracking-wider truncate">
                Conversas ({filteredMessages.length})
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Histórico factual de comunicações deste lead
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Channel Filters */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setActiveChannelFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                activeChannelFilter === 'all'
                  ? 'bg-white text-[#08254f] font-bold shadow-2xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setActiveChannelFilter('email')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                activeChannelFilter === 'email'
                  ? 'bg-white text-[#08254f] font-bold shadow-2xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              E-mail
            </button>
            {hasSms && (
              <button
                type="button"
                onClick={() => setActiveChannelFilter('sms')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  activeChannelFilter === 'sms'
                    ? 'bg-white text-[#08254f] font-bold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                SMS
              </button>
            )}
          </div>

          {/* Nova mensagem button -> opens internal composer */}
          <button
            type="button"
            onClick={handleOpenComposer}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#8a1c1c] hover:bg-[#701616] text-white rounded-xl shadow-2xs transition-colors cursor-pointer"
            data-testid="nova-mensagem-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova mensagem</span>
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={loadMessages}
            disabled={isLoading}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Atualizar conversas"
            aria-label="Atualizar conversas"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading && messages.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400 animate-pulse">
          Carregando histórico de conversas...
        </div>
      ) : filteredMessages.length === 0 ? (
        /* Empty State */
        <div
          data-testid="conversas-empty-state"
          className="p-8 sm:p-12 text-center space-y-3 bg-slate-50/50 rounded-xl border border-slate-100 m-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center text-slate-400 mx-auto shadow-2xs">
            <Inbox className="w-6 h-6 text-[#449bd5]" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-800 font-heading">
              Nenhuma conversa registrada
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Quando você enviar ou receber uma mensagem deste lead, ela aparecerá aqui.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={handleOpenComposer}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#8a1c1c] hover:bg-[#701616] text-white rounded-xl shadow-xs transition-colors cursor-pointer"
              data-testid="enviar-primeira-mensagem-btn"
            >
              <Plus className="w-4 h-4" />
              <span>Enviar primeira mensagem</span>
            </button>
          </div>
        </div>
      ) : (
        /* Timeline Messages Stream */
        <div className="p-4 sm:p-6 space-y-6 bg-slate-50/30 overflow-x-hidden">
          {threadGroups.map((group, groupIdx) => {
            const hasMultipleThreads = threadGroups.length > 1;

            return (
              <div
                key={group.id}
                data-testid={`thread-group-${groupIdx}`}
                className="space-y-4"
              >
                {/* Thread Header (shown if multiple threads exist or explicit subject) */}
                {hasMultipleThreads && (
                  <div className="flex items-center gap-2 pt-2 border-b border-slate-200/70 pb-2">
                    <span className="w-2 h-2 rounded-full bg-[#449bd5]" />
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider font-heading truncate">
                      Tópico: {group.subject}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-auto shrink-0 font-mono">
                      {group.messages.length}{' '}
                      {group.messages.length === 1 ? 'mensagem' : 'mensagens'}
                    </span>
                  </div>
                )}

                {/* Timeline Messages in this thread */}
                <div className="relative pl-6 sm:pl-7 border-l-2 border-slate-200/80 space-y-4 ml-2 sm:ml-3">
                  {group.messages.map((msg) => {
                    const isInbound = msg.direction === 'inbound';
                    const { dateStr, timeStr } = formatMessageDateTime(msg.timestamp);

                    return (
                      <div
                        key={msg.id}
                        data-testid={`timeline-message-${msg.id}`}
                        data-direction={msg.direction}
                        data-status={msg.status}
                        className="relative group"
                      >
                        {/* Timeline Node Dot */}
                        <div
                          className={`absolute -left-[31px] sm:-left-[35px] top-3.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow-2xs flex items-center justify-center shrink-0 ${
                            isInbound ? 'bg-sky-500' : 'bg-[#08254f]'
                          }`}
                        />

                        {/* CRM Message Card */}
                        <div
                          className={`w-full rounded-2xl p-4 transition-all duration-150 shadow-2xs space-y-2.5 ${
                            isInbound
                              ? 'bg-slate-50/90 border border-slate-200/90 hover:border-slate-300'
                              : 'bg-white border border-slate-200/80 hover:border-slate-300'
                          }`}
                        >
                          {/* Top Meta Row */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100/90 pb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {/* Channel icon */}
                              {msg.channel === 'email' ? (
                                <Mail className="w-3.5 h-3.5 text-[#449bd5] shrink-0" />
                              ) : (
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              )}

                              {/* Sender label */}
                              <span
                                data-testid={`message-sender-${msg.id}`}
                                className="text-xs font-bold text-slate-800 font-heading truncate"
                              >
                                {msg.senderLabel}
                              </span>
                            </div>

                            <div className="flex items-center gap-2.5 shrink-0 ml-auto">
                              {/* Timestamp */}
                              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-sans">
                                <Calendar className="w-3 h-3 text-slate-400" />
                                <span>{dateStr}</span>
                                <span className="text-slate-300">•</span>
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>{timeStr}</span>
                              </div>

                              {/* Delivery status badge */}
                              {renderStatusBadge(msg)}
                            </div>
                          </div>

                          {/* Email Subject (if applicable) */}
                          {msg.subject && (
                            <div className="pt-0.5">
                              <h4
                                data-testid={`message-subject-${msg.id}`}
                                className="text-xs font-bold text-[#08254f] font-heading break-words"
                              >
                                {msg.subject}
                              </h4>
                            </div>
                          )}

                          {/* Message Body */}
                          <div data-testid={`message-body-${msg.id}`} className="pt-0.5">
                            <MessageBodyText msg={msg} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback internal composer if parent did not provide onOpenComposer */}
      {!onOpenComposer && (
        <ManualEmailComposerModal
          isOpen={isInternalComposerOpen}
          lead={lead}
          onClose={() => setIsInternalComposerOpen(false)}
          onEmailSent={() => {
            loadMessages();
            onLeadUpdated?.();
          }}
        />
      )}
    </div>
  );
}
