import { useState } from 'react';
import { Send, AlertTriangle, Mail, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ContactPreference, ConversationChannel } from '../../types/database';

interface ConversationComposerProps {
  leadId: string;
  leadName?: string;
  conversationId?: string | null;
  leadPreference?: ContactPreference | string | null;
  initialChannel?: ConversationChannel;
  inReplyToMessageId?: string | null;
  defaultSubject?: string | null;
  onMessageSent: () => void;
}

export function ConversationComposer({
  leadId,
  leadName = 'Lead',
  conversationId,
  leadPreference = 'email',
  initialChannel = 'email',
  inReplyToMessageId,
  defaultSubject,
  onMessageSent,
}: ConversationComposerProps) {
  const [channel, setChannel] = useState<ConversationChannel>(initialChannel);
  const [subject, setSubject] = useState(defaultSubject ? `Re: ${defaultSubject.replace(/^Re:\s*/i, '')}` : '');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);

  const cleanPref = (leadPreference || 'email').toLowerCase();
  const isMismatch = channel !== cleanPref;

  const handleSend = async (overrideConfirmed = false) => {
    if (!body.trim()) return;

    if (isMismatch && !overrideConfirmed) {
      setShowOverrideConfirm(true);
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('send-conversation-message', {
        body: {
          lead_id: leadId,
          conversation_id: conversationId,
          channel,
          subject: channel === 'email' ? subject : null,
          body: body.trim(),
          override_preference_confirmed: overrideConfirmed,
          in_reply_to_provider_message_id: inReplyToMessageId,
        },
      });

      if (invokeErr) {
        throw invokeErr;
      }

      if (data?.error) {
        if (data.preference_warning) {
          setShowOverrideConfirm(true);
          return;
        }
        throw new Error(data.message || data.error);
      }

      setBody('');
      setShowOverrideConfirm(false);
      onMessageSent();
    } catch (err: any) {
      console.error('Failed to send message:', err);
      setError(err.message || 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="border-t border-gray-100 bg-white p-4 space-y-3">
      {/* Channel Switcher */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => { setChannel('email'); setShowOverrideConfirm(false); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              channel === 'email'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Mail className="w-3.5 h-3.5 text-blue-600" />
            Email
          </button>
          <button
            type="button"
            onClick={() => { setChannel('sms'); setShowOverrideConfirm(false); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              channel === 'sms'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
            SMS
          </button>
        </div>

        {/* Preference Indicator */}
        <span className="text-[11px] text-gray-400">
          Lead prefers: <strong className="uppercase text-gray-600">{cleanPref}</strong>
        </span>
      </div>

      {/* Override Warning Confirmation Banner */}
      {showOverrideConfirm && isMismatch && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 flex items-start gap-2.5 animate-in fade-in duration-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <p className="font-semibold leading-tight">
              Contact Preference Warning
            </p>
            <p className="text-amber-800 text-[11px] leading-relaxed">
              {leadName} explicitly prefers <strong className="uppercase">{cleanPref}</strong>. Are you sure you want to send a manual <strong>{channel.toUpperCase()}</strong>?
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleSend(true)}
                disabled={isSending}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[11px] transition-colors"
              >
                {isSending ? 'Sending...' : `Yes, Send via ${channel.toUpperCase()}`}
              </button>
              <button
                type="button"
                onClick={() => { setShowOverrideConfirm(false); setChannel(cleanPref === 'sms' ? 'sms' : 'email'); }}
                className="px-2.5 py-1 text-gray-600 hover:text-gray-900 font-medium text-[11px]"
              >
                Switch to {cleanPref.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-100">
          {error}
        </p>
      )}

      {/* Email Subject Line */}
      {channel === 'email' && (
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject..."
          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      )}

      {/* Message Body Textarea */}
      <div className="relative">
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Type your reply to ${leadName}...`}
          className="w-full px-3.5 py-2.5 text-xs text-gray-900 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 resize-none"
        />
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400 font-mono">
          {channel === 'sms' ? `${body.length} characters` : ''}
        </span>
        <button
          type="button"
          onClick={() => handleSend(false)}
          disabled={isSending || !body.trim()}
          className="btn-crimson text-xs"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          Send {channel.toUpperCase()}
        </button>
      </div>
    </div>
  );
}
