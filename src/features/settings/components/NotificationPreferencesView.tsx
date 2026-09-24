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
  Send,
  Wrench,
  Info,
} from 'lucide-react';
import {
  isPushSupported,
  getNotificationPermission,
  isCurrentDeviceSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPushNotification,
  reregisterCurrentDevice,
  getDevicePushDiagnostics,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  detectDeviceType,
  type PushNotificationPreferences,
  type DevicePushDiagnostics,
} from '../../notifications/services/push-notification-service';
import { getIsStandalone, getIsIosDevice } from '../../../hooks/useIsStandalone';

export function NotificationPreferencesView() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [deviceType, setDeviceType] = useState<string>('desktop');
  const [preferences, setPreferences] = useState<PushNotificationPreferences | null>(null);
  const [diagnostics, setDiagnostics] = useState<DevicePushDiagnostics | null>(null);

  const isIos = getIsIosDevice();
  const isStandalone = getIsStandalone();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isReregistering, setIsReregistering] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
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

        const diag = await getDevicePushDiagnostics();
        setDiagnostics(diag);
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

  // Listen for real push events broadcast by Service Worker to foreground app
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !navigator?.serviceWorker ||
      typeof navigator.serviceWorker.addEventListener !== 'function'
    ) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_NOTIFICATION_RECEIVED') {
        setStatusMessage({
          type: 'success',
          text: `Notificação recebida no aparelho: "${event.data.title || 'EDS HUB'}"`,
        });
        getDevicePushDiagnostics().then(setDiagnostics);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener?.('message', handleMessage);
    };
  }, []);

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
      const diag = await getDevicePushDiagnostics();
      setDiagnostics(diag);
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

  const handleReregister = async () => {
    setIsReregistering(true);
    setStatusMessage(null);

    const result = await reregisterCurrentDevice();

    if (result.success) {
      setIsSubscribed(true);
      setPermission('granted');
      setStatusMessage({
        type: 'success',
        text: 'Dispositivo registrado novamente com sucesso com as credenciais atuais do servidor!',
      });
      const diag = await getDevicePushDiagnostics();
      setDiagnostics(diag);
      const prefs = await fetchNotificationPreferences();
      setPreferences(prefs);
    } else {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Não foi possível registrar novamente este dispositivo.',
      });
    }

    setIsReregistering(false);
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
      const diag = await getDevicePushDiagnostics();
      setDiagnostics(diag);
    } else {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Erro ao desativar notificações.',
      });
    }

    setIsSubscribing(false);
  };

  const handleTestNotification = async () => {
    if (!isSubscribed) {
      setStatusMessage({
        type: 'info',
        text: 'Ative as notificações neste dispositivo para realizar o teste.',
      });
      return;
    }

    setIsTesting(true);
    setStatusMessage(null);

    try {
      const result = await sendTestPushNotification();

      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: result.message || 'Notificação de teste enviada com sucesso.',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: result.error || 'Não foi possível enviar a notificação de teste.',
        });
      }
      const diag = await getDevicePushDiagnostics();
      setDiagnostics(diag);
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Não foi possível enviar a notificação de teste.',
      });
    } finally {
      setIsTesting(false);
    }
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
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-[#08254f] flex items-center justify-center shrink-0">
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
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 self-start sm:self-auto shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ativo neste dispositivo
            </span>
          )}
        </div>

        <div className="p-4 sm:p-6 space-y-6">
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

          {/* iOS Standalone Requirement Note */}
          {deviceType === 'mobile' && !diagnostics?.isStandalone && (
            <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <Info className="h-4 w-4 text-sky-600 shrink-0" />
                <span>Instalação requerida para iPhone / iPad</span>
              </div>
              <p className="text-sky-800">
                No iOS (Safari), as notificações push só funcionam quando o EDS HUB é instalado na Tela de Início.
                Toque no botão <strong>Compartilhar</strong> no Safari e escolha <strong>Adicionar à Tela de Início</strong>.
                Em seguida, abra o app pelo ícone na Tela de Início para ativar os alertas.
              </p>
            </div>
          )}

          {/* Permission Granted but Inactive Subscription */}
          {permission === 'granted' && !isSubscribed && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Permissão concedida, mas inscrição pendente</span>
              </div>
              <p className="text-amber-800">
                A permissão de notificações está autorizada no navegador, mas este aparelho ainda não possui uma inscrição ativa no sistema.
                Toque em &quot;Registrar novamente este dispositivo&quot; para sincronizar com as chaves atuais.
              </p>
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

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                {isSubscribed ? (
                  <>
                    <button
                      type="button"
                      id="btn-test-push"
                      onClick={handleTestNotification}
                      disabled={isTesting || isSubscribing || isReregistering}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#08254f] hover:bg-[#0c356e] shadow-2xs transition-all disabled:opacity-50 cursor-pointer min-h-[40px]"
                    >
                      {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      <span>{isTesting ? 'Enviando notificação...' : 'Enviar notificação de teste'}</span>
                    </button>

                    <button
                      type="button"
                      id="btn-reregister-push"
                      onClick={handleReregister}
                      disabled={isReregistering || isSubscribing || isTesting}
                      className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 transition-colors disabled:opacity-50 cursor-pointer min-h-[40px]"
                    >
                      {isReregistering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span>Registrar novamente este dispositivo</span>
                    </button>

                    <button
                      type="button"
                      id="btn-unsubscribe-push"
                      onClick={handleUnsubscribe}
                      disabled={isSubscribing || isTesting || isReregistering}
                      className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer min-h-[40px]"
                    >
                      {isSubscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
                      <span>Desativar</span>
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <button
                      type="button"
                      id="btn-subscribe-push"
                      onClick={handleSubscribe}
                      disabled={isSubscribing || isReregistering || (isIos && !isStandalone)}
                      title={isIos && !isStandalone ? 'Adicione o EDS HUB à Tela de Início para habilitar notificações no iPhone' : undefined}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#08254f] hover:bg-[#0c356e] shadow-xs transition-all disabled:opacity-50 cursor-pointer min-h-[40px]"
                    >
                      {isSubscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                      <span>Receber alertas neste dispositivo</span>
                    </button>

                    <button
                      type="button"
                      id="btn-reregister-push"
                      onClick={handleReregister}
                      disabled={isReregistering || isSubscribing || (isIos && !isStandalone)}
                      title={isIos && !isStandalone ? 'Adicione o EDS HUB à Tela de Início para habilitar notificações no iPhone' : undefined}
                      className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 transition-colors disabled:opacity-50 cursor-pointer min-h-[40px]"
                    >
                      {isReregistering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span>Registrar novamente este dispositivo</span>
                    </button>

                    <button
                      type="button"
                      id="btn-test-push"
                      onClick={handleTestNotification}
                      disabled={isIos && !isStandalone}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-200/80 hover:bg-slate-200 transition-colors cursor-pointer min-h-[40px] disabled:opacity-50"
                      title={isIos && !isStandalone ? 'Adicione o EDS HUB à Tela de Início para realizar o teste no iPhone' : 'Ative as notificações neste dispositivo para realizar o teste'}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Enviar notificação de teste</span>
                    </button>
                  </div>
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

      {/* 2. Compact Technical Diagnostic Section */}
      <div className="card-executive">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold font-heading text-[#08254f]">Diagnóstico do Dispositivo</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Estado técnico para verificação do envio de notificações em tempo real.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const diag = await getDevicePushDiagnostics();
              setDiagnostics(diag);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Atualizar</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Permissão do iPhone</div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${diagnostics?.permission === 'granted' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className={diagnostics?.permission === 'granted' ? 'text-emerald-700' : 'text-slate-700'}>
                {diagnostics?.permission === 'granted' ? 'Ativada' : 'Não ativada'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Dispositivo registrado</div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${diagnostics?.isRegistered ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span className={diagnostics?.isRegistered ? 'text-emerald-700' : 'text-slate-700'}>
                {diagnostics?.isRegistered ? 'Sim' : 'Não'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Service Worker</div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${diagnostics?.serviceWorkerStatus === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className={diagnostics?.serviceWorkerStatus === 'active' ? 'text-emerald-700' : 'text-slate-700'}>
                {diagnostics?.serviceWorkerStatus === 'active' ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Modo de exibição</div>
            <div className="text-sm font-semibold">
              {isIos && !diagnostics?.isStandalone ? (
                <span className="text-amber-700">Safari Web (Requer Tela de Início)</span>
              ) : diagnostics?.isStandalone ? (
                <span className="text-emerald-700">App Instalado (PWA)</span>
              ) : (
                <span className="text-slate-800">Navegador Web</span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Último teste</div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${diagnostics?.lastTestStatus === 'sent' ? 'bg-emerald-500' : diagnostics?.lastTestStatus === 'failed' ? 'bg-rose-500' : 'bg-slate-400'}`} />
              <span className={diagnostics?.lastTestStatus === 'sent' ? 'text-emerald-700' : diagnostics?.lastTestStatus === 'failed' ? 'text-rose-700' : 'text-slate-600'}>
                {diagnostics?.lastTestStatus === 'sent' ? 'Enviado' : diagnostics?.lastTestStatus === 'failed' ? 'Falhou' : 'Aguardando'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1 sm:col-span-2 lg:col-span-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Último erro</div>
            <div className="text-xs text-slate-700 truncate" title={diagnostics?.lastErrorMessage || 'Nenhum erro registrado'}>
              {diagnostics?.lastErrorMessage || 'Nenhum erro registrado'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Notification Preferences by Category */}
      <div className="card-executive">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between">
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
          <div className="p-4 sm:p-6 flex items-center justify-between gap-4">
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
          <div className="p-4 sm:p-6 flex items-center justify-between gap-4">
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
          <div className="p-4 sm:p-6 flex items-center justify-between gap-4">
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
          <div className="p-4 sm:p-6 flex items-center justify-between gap-4">
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
          <div className="p-4 sm:p-6 flex items-center justify-between gap-4">
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
          <div className="p-4 sm:p-6 flex items-center justify-between gap-4">
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
