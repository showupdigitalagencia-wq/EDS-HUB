import { Loader2 } from 'lucide-react';
import edsLogo from '../assets/eds-logo.png';

interface LoadingScreenProps {
  message?: string;
  fullscreen?: boolean;
}

export function LoadingScreen({
  message = 'Carregando EDS HUB...',
  fullscreen = true,
}: LoadingScreenProps) {
  return (
    <div
      className={`flex items-center justify-center bg-[#08254f] ${
        fullscreen ? 'min-h-screen w-full fixed inset-0 z-50' : 'p-12 w-full'
      }`}
    >
      <div className="text-center p-6 max-w-xs mx-auto">
        <div className="inline-block p-3 rounded-2xl bg-white/95 shadow-xl mb-6 border border-white/20">
          <img
            src={edsLogo}
            alt="Expert Dental Solutions"
            className="h-9 w-auto max-w-[180px] object-contain"
          />
        </div>
        <div className="flex items-center justify-center gap-2.5 text-[#449bd5]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-xs font-semibold tracking-wide text-blue-100/90 font-heading">
            {message}
          </span>
        </div>
        <p className="text-[10px] text-blue-200/50 mt-3">
          Expert Dental Solutions • Deliverability CRM
        </p>
      </div>
    </div>
  );
}
