import React, { useState, useEffect, useId } from 'react';
import {
  fetchGlobalTurmaOptions,
  saveCustomTurmaOption,
  STANDARD_TURMA_OPTIONS,
  OUTRAS_LABEL,
} from '../services/turma-catalog-service';
import type { CourseSession } from '../../../types/database';

export interface TurmaSelectProps {
  label?: string;
  value?: string | null;
  onChange: (selectedLabelOrId: string) => void;
  courseSessions?: CourseSession[];
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}

export const TurmaSelect: React.FC<TurmaSelectProps> = ({
  label = 'Turma / Data do curso',
  value = '',
  onChange,
  courseSessions = [],
  disabled = false,
  required = false,
  placeholder = 'Selecione a turma / data...',
  className = '',
  testId = 'turma-select',
}) => {
  const selectId = useId();
  const [globalOptions, setGlobalOptions] = useState<string[]>([...STANDARD_TURMA_OPTIONS]);
  const [isOutrasSelected, setIsOutrasSelected] = useState(false);
  const [customInputValue, setCustomInputValue] = useState('');

  // Load global options on mount
  useEffect(() => {
    let isMounted = true;
    void fetchGlobalTurmaOptions().then((opts) => {
      if (isMounted && opts.length > 0) {
        setGlobalOptions(opts);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Determine current display value & match against sessions or global options
  const matchedSession = courseSessions.find((s) => s.id === value || s.title === value);
  const effectiveValue = value || '';

  // Check if current value matches one of the known options
  const isKnownOption =
    effectiveValue === '' ||
    matchedSession !== undefined ||
    globalOptions.includes(effectiveValue);

  useEffect(() => {
    if (effectiveValue && !isKnownOption && !isOutrasSelected) {
      // It's a custom label not in initial list
      setIsOutrasSelected(true);
      setCustomInputValue(effectiveValue);
    }
  }, [effectiveValue, isKnownOption, isOutrasSelected]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    if (selected === OUTRAS_LABEL) {
      setIsOutrasSelected(true);
      setCustomInputValue('');
      onChange('');
    } else {
      setIsOutrasSelected(false);
      setCustomInputValue('');
      onChange(selected);
    }
  };

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomInputValue(val);
    onChange(val);
  };

  const handleCustomInputBlur = () => {
    if (customInputValue.trim()) {
      void saveCustomTurmaOption(customInputValue.trim()).then((updated) => {
        setGlobalOptions(updated);
      });
    }
  };

  // Build the complete options list:
  // 1. Any existing courseSessions (rendered with value=id and label=title)
  // 2. Global options (excluding any that match existing session titles)
  const existingSessionTitles = new Set(courseSessions.map((s) => s.title));
  const remainingGlobalOptions = globalOptions.filter((opt) => !existingSessionTitles.has(opt));

  // Determine what value to set on the select element
  let selectValue = '';
  if (isOutrasSelected) {
    selectValue = OUTRAS_LABEL;
  } else if (matchedSession) {
    selectValue = matchedSession.id;
  } else if (globalOptions.includes(effectiveValue)) {
    selectValue = effectiveValue;
  }

  return (
    <div className={`space-y-1.5 w-full ${className}`}>
      {label && (
        <label
          htmlFor={selectId}
          className="block text-xs font-semibold text-slate-700"
        >
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}

      <div className="relative w-full">
        <select
          id={selectId}
          value={selectValue}
          onChange={handleSelectChange}
          disabled={disabled}
          required={required && !isOutrasSelected}
          data-testid={testId}
          className="w-full text-xs sm:text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-400 transition-all truncate"
        >
          <option value="">{placeholder}</option>

          {courseSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}

          {remainingGlobalOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}

          <option value={OUTRAS_LABEL}>{OUTRAS_LABEL} (Adicionar nova...)</option>
        </select>
      </div>

      {isOutrasSelected && (
        <div className="pt-1 animate-in fade-in duration-150">
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Nova turma / data humanizada (Ex: Jan/28):
          </label>
          <input
            type="text"
            value={customInputValue}
            onChange={handleCustomInputChange}
            onBlur={handleCustomInputBlur}
            placeholder="Ex: Jan/28"
            autoFocus
            disabled={disabled}
            required={required}
            data-testid={`${testId}-custom-input`}
            className="w-full text-xs sm:text-sm px-3 py-2 bg-white border border-blue-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all"
          />
        </div>
      )}
    </div>
  );
};

