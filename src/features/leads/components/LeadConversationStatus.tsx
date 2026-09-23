import { useState, useEffect, useCallback } from 'react';
import { Mail, MessageSquare, Clock, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../../components/ui/Badge';

interface LeadConversationStatusProps {
  leadId: string;
  onSelectTab?: (tab: string) => void;
}

interface StoredConversationSummary {
  id: string;
  channel: 'email' | 'sms';
  subject: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: 'inbound' | 'outbound' | null;
  status: 'open' | 'closed';
}

function formatConversationDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `Hoje, ${timeStr}`;
  }
  if (isYesterday) {
    return `Ontem, ${timeStr}`;
  }

  const dayMonth = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${dayMonth}, ${timeStr}`;
}

export function LeadConversationStatus({ leadId, onSelectTab }: LeadConversationStatusProps) {
  const [conversation, setConversation] = useState<StoredConversationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLatestConversation = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, channel, subject, last_message_at, last_message_preview, last_message_direction, status')
        .eq('lead_id', leadId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Failed to load conversation status:', error);
      } else {
        setConversation(data as StoredConversationSummary | null);
      }
    } catch (err) {
      console.error('Error fetching conversation status:', err);
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchLatestConversation();
  }, [fetchLatestConversation]);

  if (isLoading) {
    return (
      <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-2" />
        <div className="h-3 bg-slate-200 rounded w-2/3" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-400 shrink-0" />
          <span>Nenhuma conversa registrada</span>
        </div>
        {onSelectTab && (
          <button
            type="button"
            onClick={() => onSelectTab('conversas')}
            className="text-[11px] font-semibold text-[#08254f] hover:underline cursor-pointer"
          >
            Ver histórico
          </button>
        )}
      </div>
    );
  }

  const isEmail = conversation.channel === 'email';
  const isInbound = conversation.last_message_direction === 'inbound';
  const formattedTime = formatConversationDate(conversation.last_message_at);

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-2xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Channel badge */}
          <Badge
            variant={isEmail ? 'info' : 'purple'}
            size="sm"
            icon={isEmail ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
          >
            {isEmail ? 'Email' : 'SMS'}
          </Badge>

          {/* Direction badge - strictly factual, no fake read receipt */}
          <Badge
            variant={isInbound ? 'success' : 'neutral'}
            size="sm"
            icon={isInbound ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
          >
            {isInbound ? 'Recebida' : 'Enviada'}
          </Badge>
        </div>

        {/* Timestamp */}
        {formattedTime && (
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <Clock className="h-3 w-3 shrink-0" />
            <span>{formattedTime}</span>
          </div>
        )}
      </div>

      {/* Message preview snippet */}
      {conversation.last_message_preview ? (
        <p className="text-xs text-slate-700 italic line-clamp-2 leading-relaxed bg-slate-50/70 p-2 rounded-lg border border-slate-100">
          "{conversation.last_message_preview}"
        </p>
      ) : conversation.subject ? (
        <p className="text-xs text-slate-700 font-medium line-clamp-1">
          {conversation.subject}
        </p>
      ) : null}

      {onSelectTab && (
        <div className="pt-1 text-right">
          <button
            type="button"
            onClick={() => onSelectTab('conversas')}
            className="text-[11px] font-semibold text-[#08254f] hover:underline cursor-pointer"
          >
            Abrir conversa completa →
          </button>
        </div>
      )}
    </div>
  );
}
