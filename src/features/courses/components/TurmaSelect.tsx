import React, { useState, useEffect, useId, useMemo } from 'react';
import {
  fetchGlobalTurmaOptions,
  saveCustomTurmaOption,
  STANDARD_TURMA_OPTIONS,
  OUTRAS_LABEL,
  isUuid,
} from '../services/turma-catalog-service';
import type { CourseSession } from '../../../types/database';

export interface TurmaSelectProps {
  label?: string;
  value?: string | null;
  onChange: (selectedLabel: string) => void;
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

  // Load global options on mount (filtering any UUID junk)
  useEffect(() => {
    let isMounted = true;
    void fetchGlobalTurmaOptions().then((opts) => {
      if (isMounted && opts.length > 0) {
        setGlobalOptions(opts.filter((o) => !isUuid(o)));
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter valid course sessions: omit any whose title is a UUID or missing
  const validSessions = useMemo(() => {
    return courseSessions.filter((s) => s.title && s.title.trim() && !isUuid(s.title.trim()));
  }, [courseSessions]);

  // Determine current display value & match against sessions or global options
  const matchedSession = courseSessions.find((s) => s.id === value || s.title === value);
  const resolvedHumanLabel =
    matchedSession && matchedSession.title && !isUuid(matchedSession.title)
      ? matchedSession.title.trim()
      : value && !isUuid(value)
      ? value.trim()
      : '';

  // Check if current value matches one of the known options
  const isKnownOption =
    resolvedHumanLabel === '' ||
    validSessions.some((s) => s.title.trim() === resolvedHumanLabel) ||
    globalOptions.includes(resolvedHumanLabel);

  useEffect(() => {
    if (resolvedHumanLabel && !isKnownOption && !isOutrasSelected) {
      // It's a custom label not in initial list
      setIsOutrasSelected(true);
      setCustomInputValue(resolvedHumanLabel);
    }
  }, [resolvedHumanLabel, isKnownOption, isOutrasSelected]);

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
    if (isUuid(val)) return; // Never accept raw UUIDs
    setCustomInputValue(val);
    onChange(val);
  };

  const handleCustomInputBlur = () => {
    const trimmed = customInputValue.trim();
    if (trimmed && !isUuid(trimmed)) {
      void saveCustomTurmaOption(trimmed).then((updated) => {
        setGlobalOptions(updated.filter((o) => !isUuid(o)));
      });
    }
  };

  // Build the complete options list:
  // 1. Any existing valid courseSessions (rendered with value=title and label=title)
  // 2. Global options (excluding any that match existing session titles or are UUIDs)
  const existingSessionTitles = new Set(validSessions.map((s) => s.title.trim()));
  const remainingGlobalOptions = globalOptions.filter(
    (opt) => !existingSessionTitles.has(opt) && !isUuid(opt)
  );

  // Determine what value to set on the select element
  let selectValue = '';
  if (isOutrasSelected) {
    selectValue = OUTRAS_LABEL;
  } else if (matchedSession) {
    selectValue = matchedSession.id;
  } else if (resolvedHumanLabel) {
    if (existingSessionTitles.has(resolvedHumanLabel) || remainingGlobalOptions.includes(resolvedHumanLabel)) {
      selectValue = resolvedHumanLabel;
    }
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

          {validSessions.map((s) => (
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
