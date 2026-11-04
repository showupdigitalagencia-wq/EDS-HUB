import { useState, useEffect, useCallback } from 'react';
import {
  BellRing,
  BellOff,
  Smartphone,
  Share2,
  CheckCircle2,
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import {
  checkDeviceSubscriptionSync,
  subscribeToPush,
  reregisterCurrentDevice,
  isPushPromptDismissed,
  recordPushPromptDismissed,
  clearPushPromptDismissed,
  type DeviceSubscriptionSyncStatus,
} from '../services/push-notification-service';

export function PushActivationBanner() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [syncStatus, setSyncStatus] = useState<DeviceSubscriptionSyncStatus | 'loading'>('loading');
  const [isDismissed, setIsDismissed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const evaluateStatus = useCallback(async () => {
    // If user dismissed this prompt within the last 10 days, suppress display
    if (isPushPromptDismissed(userId)) {
      setIsDismissed(true);
      setSyncStatus('synced'); // no need to check further
      return;
    }

    try {
      const result = await checkDeviceSubscriptionSync();
      setSyncStatus(result.status);
    } catch (err) {
      console.debug('[PushActivationBanner] Sync check non-fatal error:', err);
      setSyncStatus('transient_error');
    }
  }, [userId]);

  useEffect(() => {
    evaluateStatus();
  }, [evaluateStatus]);

  const handleDismiss = () => {
    recordPushPromptDismissed(userId);
    setIsDismissed(true);
  };

  const handleActivate = async () => {
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      let res: { success: boolean; error?: string };

      if (syncStatus === 'subscription_orphan' || syncStatus === 'subscription_missing') {
        // Device already has permission, but subscription is missing or from an old install
        res = await reregisterCurrentDevice();
      } else {
        // Permission default: request permission on user gesture and subscribe
        res = await subscribeToPush();
      }

      if (res.success) {
        clearPushPromptDismissed(userId);
        setSuccessMessage('Notificações ativadas com sucesso no seu dispositivo!');
        setTimeout(() => {
          setSyncStatus('synced');
        }, 2500);
      } else {
        if (res.error?.includes('negada') || res.error?.includes('denied')) {
          setSyncStatus('permission_denied');
        } else {
          setErrorMessage(res.error || 'Falha ao ativar notificações. Tente novamente.');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado ao ativar notificações.';
      setErrorMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  // If loading, already dismissed for 10 days, already synced, or completely unsupported (non-iOS)
  // If loading, transient network/auth error, already dismissed for 10 days, already synced, or completely unsupported
  if (
    isDismissed ||
    syncStatus === 'loading' ||
    syncStatus === 'synced' ||
    syncStatus === 'unsupported' ||
    syncStatus === 'transient_error'
  ) {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Case A: iOS Safari outside Standalone PWA
  // ---------------------------------------------------------------------------
  if (syncStatus === 'ios_not_standalone') {
    return (
      <div
        role="region"
        aria-label="Ativar Notificações no iPhone"
        data-testid="push-activation-banner"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#08254f] via-[#0d346b] to-[#08254f] border border-sky-400/25 p-4.5 sm:p-5 text-white shadow-md animate-in fade-in duration-300"
      >
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-[#449bd5] flex items-center justify-center shrink-0 border border-sky-400/25 mt-0.5">
              <Share2 className="w-5 h-5 text-sky-300" />
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm sm:text-base font-bold font-heading text-white">
                Não perca nenhuma atualização do EDS Hub
              </h3>
              <p className="text-xs text-slate-200 leading-relaxed">
                Para receber avisos de novos leads, matrículas e tarefas no seu iPhone, instale o EDS Hub na Tela de Início:
              </p>
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 text-[11px] text-sky-200">
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-sky-400/30 text-[10px] font-bold text-white">1</span>
                  Toque em <strong>Compartilhar</strong> (ícone <Share2 className="inline w-3 h-3" /> do Safari)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-sky-400/30 text-[10px] font-bold text-white">2</span>
                  Selecione <strong>Adicionar à Tela de Início</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-sky-400/30 text-[10px] font-bold text-white">3</span>
                  Abra o EDS Hub por lá para ativar alertas
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            data-testid="push-dismiss-button"
            title="Lembrar mais tarde (10 dias)"
            aria-label="Lembrar mais tarde"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Case B: Permission Denied in Device Settings
  // ---------------------------------------------------------------------------
  if (syncStatus === 'permission_denied') {
    return (
      <div
        role="region"
        aria-label="Notificações Bloqueadas"
        data-testid="push-activation-banner"
        className="relative overflow-hidden rounded-2xl bg-slate-900 border border-amber-400/30 p-4.5 sm:p-5 text-white shadow-md animate-in fade-in duration-300"
      >
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0 border border-amber-400/25 mt-0.5">
              <BellOff className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm sm:text-base font-bold font-heading text-white">
                Notificações desativadas no dispositivo
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                As notificações do EDS Hub estão bloqueadas nos ajustes do aparelho ou do navegador.
              </p>
              <p className="text-[11px] text-amber-200/90 pt-0.5">
                Para voltar a receber alertas de leads e tarefas, acesse <strong>Ajustes &gt; Notificações &gt; EDS Hub</strong> (ou permissões do navegador) e marque <strong>Permitir Notificações</strong>.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            data-testid="push-dismiss-button"
            title="Lembrar mais tarde (10 dias)"
            aria-label="Lembrar mais tarde"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Case C: Standard Prompt (Default permission, Missing subscription, or Orphan subscription)
  // ---------------------------------------------------------------------------
  return (
    <div
      role="region"
      aria-label="Aviso de Notificações"
      data-testid="push-activation-banner"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#08254f] via-[#0d346b] to-[#08254f] border border-sky-400/30 p-4.5 sm:p-5 text-white shadow-md animate-in fade-in duration-300"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Icon & Text */}
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-[#449bd5] flex items-center justify-center shrink-0 border border-sky-400/25 relative">
            <BellRing className="w-5 h-5 text-sky-300 animate-pulse" />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[#08254f]" />
          </div>

          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm sm:text-base font-bold font-heading text-white">
              Não perca nenhuma atualização do EDS Hub
            </h3>
            <p className="text-xs text-slate-200 leading-relaxed">
              Receba avisos de novos leads, matrículas e tarefas diretamente no seu celular.
            </p>
            {errorMessage && (
              <p className="text-xs text-rose-300 flex items-center gap-1 pt-1" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMessage}</span>
              </p>
            )}
            {successMessage && (
              <p className="text-xs text-emerald-300 flex items-center gap-1 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{successMessage}</span>
              </p>
            )}
          </div>
        </div>

        {/* Right: Action Button & Dismiss */}
        <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
          <button
            type="button"
            onClick={handleActivate}
            disabled={isProcessing || Boolean(successMessage)}
            data-testid="push-activate-button"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#449bd5] hover:bg-[#398bc2] active:bg-[#08254f] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-60"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>ATIVANDO...</span>
              </>
            ) : successMessage ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>ATIVADO</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5" />
                <span>ATIVAR NOTIFICAÇÕES</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            data-testid="push-dismiss-button"
            title="Lembrar mais tarde (10 dias)"
            aria-label="Lembrar mais tarde"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

