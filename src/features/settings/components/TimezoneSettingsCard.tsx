import { useState, useEffect } from 'react';
import { Globe, Check, RefreshCw } from 'lucide-react';
import {
  getUserTimezone,
  setUserTimezone,
  isTimezoneAutoDetected,
  detectBrowserTimezone,
  COMMON_TIMEZONES,
  formatInUserTimezone,
} from '../../../utils/timezone';

export function TimezoneSettingsCard() {
  const [currentTimezone, setCurrentTimezone] = useState(getUserTimezone());
  const [isAuto, setIsAuto] = useState(isTimezoneAutoDetected());
  const [isEditing, setIsEditing] = useState(false);
  const [previewTime, setPreviewTime] = useState(formatInUserTimezone(new Date()));

  useEffect(() => {
    const interval = setInterval(() => {
      setPreviewTime(formatInUserTimezone(new Date(), undefined, currentTimezone));
    }, 1000);
    return () => clearInterval(interval);
  }, [currentTimezone]);

  const handleSelectTimezone = (tz: string) => {
    setUserTimezone(tz);
    setCurrentTimezone(tz);
    setIsAuto(false);
    setIsEditing(false);
  };

  const handleResetToAuto = () => {
    setUserTimezone(null);
    const autoTz = detectBrowserTimezone();
    setCurrentTimezone(autoTz);
    setIsAuto(true);
    setIsEditing(false);
  };

  const activeOption = COMMON_TIMEZONES.find((t) => t.value === currentTimezone);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100 shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#08254f] font-heading">
              Fuso Horário Operacional
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Determina o horário das tarefas, lembretes push e agendamento de campanhas
            </p>
          </div>
        </div>

        {!isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="px-3 py-1.5 text-xs font-semibold text-[#08254f] bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors cursor-pointer shrink-0"
            data-testid="change-timezone-btn"
          >
            Alterar
          </button>
        )}
      </div>

      <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-slate-800 text-sm">{currentTimezone}</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                isAuto
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              {isAuto ? 'Detectado automaticamente' : 'Definido manualmente'}
            </span>
          </div>
          <p className="text-slate-500 mt-0.5">
            {activeOption?.label || currentTimezone} {activeOption ? `• ${activeOption.offsetDescription}` : ''}
          </p>
        </div>

        <div className="sm:text-right font-mono text-slate-700 text-xs">
          <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
            Horário Atual
          </span>
          <span className="font-semibold text-slate-800">{previewTime}</span>
        </div>
      </div>

      {isEditing && (
        <div className="pt-2 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Selecione seu fuso horário:</span>
            {!isAuto && (
              <button
                type="button"
                onClick={handleResetToAuto}
                className="inline-flex items-center gap-1 text-[11px] text-[#449bd5] hover:text-[#08254f] font-semibold cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Usar detecção automática ({detectBrowserTimezone()})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {COMMON_TIMEZONES.map((option) => {
              const isSelected = option.value === currentTimezone;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectTimezone(option.value)}
                  className={`flex items-start justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#449bd5] bg-sky-50/60 ring-1 ring-[#449bd5]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <span className="font-semibold text-xs text-slate-900 block">
                      {option.label}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {option.value}
                    </span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[#449bd5] shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-semibold cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
