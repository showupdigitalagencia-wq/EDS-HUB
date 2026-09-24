import { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  BellRing,
  BellOff,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Mail,
  MessageSquare,
  UserPlus,
  FileText,
  CheckSquare,
  AlertOctagon,
  RefreshCw,
} from 'lucide-react';
import {
  isPushSupported,
  getNotificationPermission,
  isCurrentDeviceSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  detectDeviceType,
  type PushNotificationPreferences,
} from '../../notifications/services/push-notification-service';

export function NotificationPreferencesView() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [deviceType, setDeviceType] = useState<string>('desktop');
  const [preferences, setPreferences] = useState<PushNotificationPreferences | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const isSupp = isPushSupported();
      setSupported(isSupp);
      setDeviceType(detectDeviceType());

      if (isSupp) {
        const perm = getNotificationPermission();
        setPermission(perm);

        const subscribed = await isCurrentDeviceSubscribed();
        setIsSubscribed(subscribed);
      }

      const prefs = await fetchNotificationPreferences();
      setPreferences(prefs);
    } catch (err) {
      console.error('[NotificationPreferencesView] Load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSubscribe = async () => {
    setIsSubscribing(true);
    setStatusMessage(null);

    const result = await subscribeToPush();

    if (result.success) {
      setIsSubscribed(true);
      setPermission('granted');
      setStatusMessage({
        type: 'success',
        text: 'Notificações ativadas com sucesso neste dispositivo! Você receberá alertas operacionais em tempo real.',
      });
      // Refresh preferences in state
      const prefs = await fetchNotificationPreferences();
      setPreferences(prefs);
    } else {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Não foi possível ativar notificações neste dispositivo.',
      });
      setPermission(getNotificationPermission());
    }

    setIsSubscribing(false);
  };

  const handleUnsubscribe = async () => {
    setIsSubscribing(true);
    setStatusMessage(null);

    const result = await unsubscribeFromPush();

    if (result.success) {
      setIsSubscribed(false);
      setStatusMessage({
        type: 'info',
        text: 'Notificações desativadas para este dispositivo. Seus registros no CRM permanecem inalterados.',
      });
    } else {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Erro ao desativar notificações.',
      });
    }

    setIsSubscribing(false);
  };

  const handleToggleCategory = async (key: keyof Omit<PushNotificationPreferences, 'id' | 'user_id'>) => {
    if (!preferences) return;
    const currentVal = preferences[key];
    const updatedVal = !currentVal;

    // Optimistic update
    setPreferences({ ...preferences, [key]: updatedVal });
    setIsSavingPrefs(true);

    try {
      await updateNotificationPreferences({ [key]: updatedVal });
      setStatusMessage({
        type: 'success',
        text: 'Preferências salvas.',
      });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      // Revert on failure
      setPreferences({ ...preferences, [key]: currentVal });
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Falha ao salvar preferência.',
      });
    } finally {
      setIsSavingPrefs(false);
    }
  };

  if (isLoading) {
    return (
      <div className="card-executive p-8 flex items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-[#08254f]" />
        <span>Carregando preferências de notificação...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Device Subscription Card */}
      <div className="card-executive">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-[#08254f] flex items-center justify-center">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold font-heading text-[#08254f]">Notificações no Dispositivo</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Receba alertas operacionais instantâneos de novos leads, tarefas e mensagens diretamente no seu aparelho.
              </p>
            </div>
          </div>
          {supported && isSubscribed && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ativo neste dispositivo
            </span>
          )}
        </div>

        <div className="p-6 space-y-6">
          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-4 rounded-xl text-xs flex items-center gap-3 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : statusMessage.type === 'error'
                  ? 'bg-rose-50 border border-rose-200 text-rose-800'
                  : 'bg-blue-50 border border-blue-200 text-blue-800'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : statusMessage.type === 'error' ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              ) : (
                <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Browser / Environment Unsupported */}
          {!supported ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Web Push não disponível neste navegador</span>
              </div>
              <p className="text-amber-800">
                Seu navegador atual ou janela anônima não suporta notificações Web Push. No iOS (iPhone/iPad),
                adicione o EDS HUB à Tela de Início (Add to Home Screen) via Safari (iOS 16.4+) para receber alertas.
              </p>
            </div>
          ) : permission === 'denied' ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <BellOff className="h-4 w-4 text-rose-600 shrink-0" />
                <span>Permissão de notificação bloqueada</span>
              </div>
              <p className="text-rose-800">
                As notificações foram bloqueadas nas configurações do seu navegador ou sistema operacional.
                Para receber alertas do EDS HUB, abra as configurações do navegador ou dispositivo e altere a permissão para &quot;Permitir&quot;.
              </p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Bell className="h-4 w-4 text-[#08254f]" />
                  <span>
                    {isSubscribed
                      ? `Alertas ativos neste ${deviceType === 'mobile' ? 'celular' : deviceType === 'tablet' ? 'tablet' : 'computador'}`
                      : 'Alertas desativados neste dispositivo'}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {isSubscribed
                    ? 'Este aparelho está registrado para receber notificações sonoras e push do sistema.'
                    : 'Clique no botão ao lado para autorizar o recebimento de alertas operacionais seguros.'}
                </p>
              </div>

              <div>
                {isSubscribed ? (
                  <button
                    type="button"
                    onClick={handleUnsubscribe}
                    disabled={isSubscribing}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isSubscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
                    Desativar neste dispositivo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubscribe}
                    disabled={isSubscribing}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#08254f] hover:bg-[#0c356e] shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isSubscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                    Receber alertas neste dispositivo
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Privacy & Safe Delivery Note */}
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-blue-50/50 border border-blue-100 text-xs text-slate-600">
            <ShieldCheck className="h-4 w-4 text-[#08254f] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#08254f]">Privacidade &amp; Resiliência do CRM:</span>
              <p>
                As notificações contêm apenas dados operacionais essenciais (ex: primeiro nome do lead, título da tarefa).
                Nenhum dado médico, passaporte ou financeiro é transmitido via push. Caso uma notificação falhe na rede,
                o registro permanente no CRM permanece 100% preservado.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Notification Preferences by Category */}
      <div className="card-executive">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold font-heading text-[#08254f]">Categorias Operacionais</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Escolha quais eventos disparam notificações push para o seu usuário administrador.
            </p>
          </div>
          {isSavingPrefs && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Salvando...
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {/* Category: New Leads */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
                <UserPlus className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Novos Leads</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Receba alertas imediatos quando um novo interessado preencher um formulário ou anúncio Meta Lead Ads.
                </p>
                <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
                  Ex: &quot;Novo lead recebido — John Smith demonstrou interesse em Wisdom Teeth Extraction.&quot;
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferences?.new_leads ?? true}
                onChange={() => handleToggleCategory('new_leads')}
                disabled={isSavingPrefs}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#08254f]"></div>
            </label>
          </div>

          {/* Category: SMS Preference */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Lead aguardando SMS</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Alerte a equipe quando o lead indicar preferência explícita por contato via mensagem SMS.
                </p>
                <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
                  Ex: &quot;Lead aguardando contato por SMS — John Smith prefere contato por SMS.&quot;
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferences?.sms_preference ?? true}
                onChange={() => handleToggleCategory('sms_preference')}
                disabled={isSavingPrefs}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#08254f]"></div>
            </label>
          </div>

          {/* Category: Tasks */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-9 w-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
                <CheckSquare className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Tarefas do CRM</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Notificações de tarefas atribuídas, prazos a vencer ou pendências prioritárias na fila de trabalho.
                </p>
                <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
                  Ex: &quot;Tarefa pendente — Ligar para John Smith.&quot;
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferences?.tasks ?? true}
                onChange={() => handleToggleCategory('tasks')}
                disabled={isSavingPrefs}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#08254f]"></div>
            </label>
          </div>

          {/* Category: Inbound Emails */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Respostas de E-mail</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Notificar instantaneamente quando um lead responder a qualquer e-mail enviado pelo EDS HUB.
                </p>
                <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
                  Ex: &quot;Nova resposta recebida — John Smith respondeu ao seu e-mail.&quot;
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferences?.inbound_emails ?? true}
                onChange={() => handleToggleCategory('inbound_emails')}
                disabled={isSavingPrefs}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#08254f]"></div>
            </label>
          </div>

          {/* Category: Incomplete Registrations */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-9 w-9 rounded-lg bg-orange-50 text-orange-700 flex items-center justify-center shrink-0 mt-0.5">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Inscrições Incompletas</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Alertas de carrinhos ou inscrições iniciadas sem conclusão para acompanhamento ativo.
                </p>
                <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
                  Ex: &quot;Inscrição não concluída — Novo lead precisa de acompanhamento.&quot;
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferences?.incomplete_registrations ?? true}
                onChange={() => handleToggleCategory('incomplete_registrations')}
                disabled={isSavingPrefs}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#08254f]"></div>
            </label>
          </div>

          {/* Category: Critical Deliverability */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-9 w-9 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center shrink-0 mt-0.5">
                <AlertOctagon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Alertas Críticos de Entregabilidade</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Apenas para ocorrências factuais críticas: hard bounce permanente, reclamação de spam ou suspensão de envio. Sem ruído técnico.
                </p>
                <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
                  Ex: &quot;Alerta de Entregabilidade — E-mail para john@... rejeitado permanentemente.&quot;
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferences?.deliverability_critical ?? true}
                onChange={() => handleToggleCategory('deliverability_critical')}
                disabled={isSavingPrefs}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#08254f]"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
