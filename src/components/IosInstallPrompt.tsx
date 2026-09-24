import { useState, useEffect } from 'react';
import { Share, PlusSquare, Smartphone, X } from 'lucide-react';
import { useIsStandalone, getIsIosDevice } from '../hooks/useIsStandalone';
import edsEmblem from '../assets/eds-emblem.png';

const DISMISS_KEY = 'eds_ios_install_prompt_dismissed';

export function IosInstallPrompt() {
  const isStandalone = useIsStandalone();
  const [isIos, setIsIos] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    setIsIos(getIsIosDevice());
    const dismissed = localStorage.getItem(DISMISS_KEY) === 'true';
    setIsDismissed(dismissed);
  }, []);

  // If already running in standalone mode or not on iOS, never render
  if (isStandalone || !isIos || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Ignore localStorage errors
    }
  };

  return (
    <div
      id="ios-install-banner"
      role="region"
      aria-label="Instruções de instalação para iOS"
      className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-3.5 shadow-md mb-4 mx-4 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img
            src={edsEmblem}
            alt="EDS"
            className="w-8 h-8 rounded-lg object-contain bg-white shadow-2xs border border-slate-100 p-0.5"
          />
          <div>
            <h2 className="text-xs font-bold text-[#08254f] font-heading tracking-tight">
              Instalar EDS HUB
            </h2>
            <p className="text-[11px] text-slate-500 font-sans">
              Acesse como aplicativo nativo na Tela de Início
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dispensar aviso de instalação"
          className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2 text-[10px] text-slate-600 font-medium">
        <div className="flex flex-col items-center text-center p-1.5 bg-slate-50 rounded-xl">
          <div className="p-1 rounded-md bg-white text-[#08254f] shadow-2xs mb-1">
            <Share className="h-3.5 w-3.5" />
          </div>
          <span>1. Toque em Compartilhar</span>
        </div>

        <div className="flex flex-col items-center text-center p-1.5 bg-slate-50 rounded-xl">
          <div className="p-1 rounded-md bg-white text-[#08254f] shadow-2xs mb-1">
            <PlusSquare className="h-3.5 w-3.5" />
          </div>
          <span>2. Adicionar à Tela de Início</span>
        </div>

        <div className="flex flex-col items-center text-center p-1.5 bg-slate-50 rounded-xl">
          <div className="p-1 rounded-md bg-white text-[#08254f] shadow-2xs mb-1">
            <Smartphone className="h-3.5 w-3.5" />
          </div>
          <span>3. Abra pelo novo ícone</span>
        </div>
      </div>
    </div>
  );
}

export function IosInstallGuideModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const isStandalone = useIsStandalone();

  if (!isOpen || isStandalone) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <img
              src={edsEmblem}
              alt="EDS HUB"
              className="w-7 h-7 rounded-lg object-contain"
            />
            <h3 className="text-sm font-bold text-[#08254f] font-heading">
              Instalar EDS HUB no iPhone
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="py-4 space-y-3.5 text-xs text-slate-600">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-lg bg-[#08254f]/10 text-[#08254f] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
              1
            </div>
            <div>
              <p className="font-semibold text-slate-800">Toque em Compartilhar</p>
              <p className="text-[11px] text-slate-500">
                Na barra inferior do Safari, clique no ícone de compartilhamento (quadrado com seta para cima).
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-lg bg-[#08254f]/10 text-[#08254f] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
              2
            </div>
            <div>
              <p className="font-semibold text-slate-800">Adicionar à Tela de Início</p>
              <p className="text-[11px] text-slate-500">
                Role para baixo no menu e selecione a opção "Adicionar à Tela de Início".
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-lg bg-[#08254f]/10 text-[#08254f] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
              3
            </div>
            <div>
              <p className="font-semibold text-slate-800">Abra pelo novo ícone</p>
              <p className="text-[11px] text-slate-500">
                Toque em "Adicionar" e inicie o EDS HUB diretamente da Tela de Início para uma experiência de app nativo.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 bg-[#08254f] hover:bg-[#0c3266] text-white rounded-xl text-xs font-semibold cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
