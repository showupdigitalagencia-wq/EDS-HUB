import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  Clock,
  UserPlus,
  MessageSquare,
  Mail,
  FileText,
  CheckSquare,
  AlertOctagon,
  Sparkles,
  Settings,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../features/auth/AuthProvider';

export interface InAppNotification {
  id: string;
  user_id: string;
  event_type: string;
  event_id?: string | null;
  title: string;
  body: string;
  deep_link?: string | null;
  status: string;
  created_at: string;
}

const READ_STORAGE_KEY = 'eds_notifications_read_ids';

function getReadIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    // Keep at most 200 most recent IDs to prevent unbounded storage
    const arr = Array.from(ids).slice(-200);
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Non-fatal
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return 'Agora mesmo';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min atrás`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h atrás`;
    return `${Math.floor(diffSec / 86400)} d atrás`;
  } catch {
    return '';
  }
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'new_lead':
      return <UserPlus className="h-4 w-4 text-indigo-600" />;
    case 'sms_preference':
      return <MessageSquare className="h-4 w-4 text-emerald-600" />;
    case 'inbound_email':
      return <Mail className="h-4 w-4 text-sky-600" />;
    case 'incomplete_registration':
      return <FileText className="h-4 w-4 text-amber-600" />;
    case 'task_due':
      return <CheckSquare className="h-4 w-4 text-purple-600" />;
    case 'deliverability_critical':
      return <AlertOctagon className="h-4 w-4 text-rose-600" />;
    default:
      return <Sparkles className="h-4 w-4 text-blue-600" />;
  }
}

export function NotificationBell() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => getReadIds());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userId = appUser?.user_id;

  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);

    try {
      if (typeof supabase?.from !== 'function') return;
      const query = supabase.from('push_notification_logs');
      if (!query || typeof query.select !== 'function') return;

      const { data, error: fetchErr } = await query
        .select('id, user_id, event_type, event_id, title, body, deep_link, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);

      if (fetchErr) throw fetchErr;
      const rawList = (data as InAppNotification[]) || [];
      const seen = new Set<string>();
      const deduped: InAppNotification[] = [];
      for (const item of rawList) {
        const dedupeKey = `${item.event_type}_${item.event_id || item.title}_${item.created_at.slice(0, 16)}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          deduped.push(item);
        }
      }
      setNotifications(deduped);
    } catch (err) {
      console.warn('[NotificationBell] Failed to load notifications:', err);
      setError('Não foi possível carregar as notificações.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Initial load
  useEffect(() => {
    if (userId) {
      loadNotifications();
    }
  }, [userId, loadNotifications]);

  // Realtime subscription on push_notification_logs for this user
  useEffect(() => {
    if (!userId) return;
    if (typeof supabase?.channel !== 'function') return;

    const channelName = `user-notifications-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'push_notification_logs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            const newLog = payload.new as InAppNotification;
            setNotifications((prev) => {
              const dedupeKey = `${newLog.event_type}_${newLog.event_id || newLog.title}_${newLog.created_at.slice(0, 16)}`;
              const exists = prev.some(
                (n) => n.id === newLog.id || `${n.event_type}_${n.event_id || n.title}_${n.created_at.slice(0, 16)}` === dedupeKey
              );
              if (exists) return prev;
              return [newLog, ...prev];
            });
          }
        }
      );

    try {
      channel.subscribe();
    } catch (err) {
      console.debug('[NotificationBell] Realtime subscribe notice:', err);
    }

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const handleMarkAllAsRead = () => {
    const next = new Set(readIds);
    notifications.forEach((n) => next.add(n.id));
    setReadIds(next);
    saveReadIds(next);
  };

  const handleNotificationClick = (item: InAppNotification) => {
    // Mark as read
    const next = new Set(readIds);
    next.add(item.id);
    setReadIds(next);
    saveReadIds(next);

    // Close panel
    setIsOpen(false);

    // Navigate to deep link if present
    if (item.deep_link) {
      navigate(item.deep_link);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        id="btn-notification-bell"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : 'Notificações'}
        aria-expanded={isOpen}
        className="relative flex items-center justify-center p-2 rounded-xl text-slate-600 hover:text-[#08254f] hover:bg-slate-100 transition-colors cursor-pointer min-h-[40px] min-w-[40px]"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            id="badge-unread-notifications"
            className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs border-2 border-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-over / Dropdown Panel */}
      {isOpen && (
        <>
          {/* Backdrop on mobile */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            id="notification-panel"
            role="dialog"
            aria-label="Painel de Notificações"
            className="fixed inset-x-2 top-16 sm:inset-auto sm:absolute sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-w-[calc(100vw-1rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[520px] animate-in fade-in-0 zoom-in-95 duration-150"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-sm text-[#08254f]">Notificações</span>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-[#08254f]/10 text-[#08254f] rounded-full">
                    {unreadCount} nova{unreadCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#08254f] hover:text-[#0c356e] p-1 rounded hover:bg-slate-200/60 transition-colors cursor-pointer"
                    title="Marcar todas como lidas"
                  >
                    <Check className="h-3 w-3" />
                    <span>Marcar lidas</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors sm:hidden"
                  aria-label="Fechar painel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List Body */}
            <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
              {isLoading && notifications.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-[#08254f]" />
                  <span>Carregando notificações...</span>
                </div>
              ) : error ? (
                <div className="p-6 text-center space-y-3">
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-50 text-rose-600">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <p className="text-xs text-rose-700 font-medium">{error}</p>
                  <button
                    type="button"
                    onClick={loadNotifications}
                    className="px-3 py-1.5 text-xs font-semibold text-[#08254f] bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-12 px-6 text-center space-y-2">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-400 mx-auto">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div className="text-xs font-semibold text-slate-700">Nenhuma notificação recente</div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Alertas operacionais de leads, tarefas, entregabilidade e mensagens aparecerão aqui.
                  </p>
                </div>
              ) : (
                notifications.map((item) => {
                  const isUnread = !readIds.has(item.id);

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleNotificationClick(item)}
                      className={`p-3.5 flex items-start gap-3 hover:bg-slate-50 transition-colors cursor-pointer select-none ${
                        isUnread ? 'bg-blue-50/40' : 'bg-white'
                      }`}
                    >
                      <div className="p-2 rounded-xl bg-slate-100 shrink-0 mt-0.5 border border-slate-200/60">
                        {getEventIcon(item.event_type)}
                      </div>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-xs truncate ${
                              isUnread ? 'font-bold text-[#08254f]' : 'font-semibold text-slate-800'
                            }`}
                          >
                            {item.title}
                          </p>
                          {isUnread && (
                            <span className="h-2 w-2 rounded-full bg-[#08254f] shrink-0" />
                          )}
                        </div>

                        <p className="text-[11px] text-slate-600 line-clamp-2 break-words leading-relaxed">
                          {item.body}
                        </p>

                        <div className="flex items-center justify-between pt-0.5 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(item.created_at)}
                          </span>
                          {item.deep_link && (
                            <span className="inline-flex items-center gap-0.5 text-blue-600 font-medium">
                              Abrir <ExternalLink className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  navigate('/settings?tab=notifications');
                }}
                className="inline-flex items-center gap-1.5 text-slate-600 hover:text-[#08254f] font-medium transition-colors cursor-pointer py-1"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Preferências de Alerta</span>
              </button>

              <button
                type="button"
                onClick={loadNotifications}
                className="text-slate-500 hover:text-slate-700 font-medium transition-colors cursor-pointer py-1"
              >
                Atualizar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
