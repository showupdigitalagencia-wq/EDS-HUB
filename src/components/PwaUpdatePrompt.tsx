import { useState, useEffect } from 'react';
import { Sparkles, RefreshCw, X } from 'lucide-react';

export function PwaUpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ registration: ServiceWorkerRegistration }>;
      if (customEvent.detail?.registration) {
        setRegistration(customEvent.detail.registration);
        setUpdateAvailable(true);
      }
    };

    window.addEventListener('eds-pwa-update-available', handleUpdate);

    // Also check if navigator.serviceWorker has a waiting worker already
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) {
          setRegistration(reg);
          setUpdateAvailable(true);
        }
      });
    }

    return () => {
      window.removeEventListener('eds-pwa-update-available', handleUpdate);
    };
  }, []);

  const handleUpdateNow = () => {
    setIsUpdating(true);

    if (registration?.waiting) {
      // Listen for the controlling service worker change, then reload safely
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      }

      // Post SKIP_WAITING to the waiting service worker
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  };

  if (!updateAvailable) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Atualização disponível"
      data-testid="pwa-update-banner"
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="bg-[#08254f] text-white rounded-2xl p-4 shadow-2xl border border-sky-400/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-[#449bd5] flex items-center justify-center shrink-0 border border-sky-400/20">
            <Sparkles className="w-4 h-4 text-sky-300" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold font-heading text-white truncate">
              Nova versão disponível
            </h4>
            <p className="text-[11px] text-slate-300 truncate">
              Atualize agora para aplicar as melhorias mais recentes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={isUpdating}
            data-testid="pwa-update-now-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#449bd5] hover:bg-[#3b87bc] active:bg-[#08254f] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isUpdating ? 'animate-spin' : ''}`} />
            <span>{isUpdating ? 'Atualizando…' : 'Atualizar agora'}</span>
          </button>
          <button
            type="button"
            onClick={() => setUpdateAvailable(false)}
            aria-label="Dispensar aviso"
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
