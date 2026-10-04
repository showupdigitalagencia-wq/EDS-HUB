import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, User, Mail, Phone, X, Check, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

export interface LeadSearchResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
}

interface SearchableLeadSelectorProps {
  selectedLeadId: string;
  onSelectLead: (lead: LeadSearchResult | null) => void;
  initialLead?: LeadSearchResult | null;
  disabled?: boolean;
}

export const SearchableLeadSelector: React.FC<SearchableLeadSelectorProps> = ({
  selectedLeadId,
  onSelectLead,
  initialLead,
  disabled = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<LeadSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadSearchResult | null>(initialLead || null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // If initialLead changes or selectedLeadId is cleared from outside
  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLead(null);
    } else if (initialLead && initialLead.id === selectedLeadId) {
      setSelectedLead(initialLead);
    } else if (selectedLeadId && (!selectedLead || selectedLead.id !== selectedLeadId)) {
      // Fetch selected lead details if only ID is provided
      void (async () => {
        try {
          const { data } = await supabase
            .from('leads')
            .select('id, first_name, last_name, email, phone_raw, phone_e164')
            .eq('id', selectedLeadId)
            .maybeSingle();
          if (data) {
            setSelectedLead(data as LeadSearchResult);
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [selectedLeadId, initialLead]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search function with debouncing
  const performSearch = useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      const cleanTerm = query.trim();
      let req: any = supabase
        .from('leads')
        .select('id, first_name, last_name, email, phone_raw, phone_e164');

      if (cleanTerm && typeof req.or === 'function') {
        req = req.or(
          `first_name.ilike.%${cleanTerm}%,last_name.ilike.%${cleanTerm}%,email.ilike.%${cleanTerm}%,phone_raw.ilike.%${cleanTerm}%,phone_e164.ilike.%${cleanTerm}%`
        );
      }

      // Check deleted_at if column exists
      if (typeof req.is === 'function') {
        req = req.is('deleted_at', null);
      }

      if (typeof req.order === 'function') {
        req = req.order('created_at', { ascending: false });
      }

      if (typeof req.limit === 'function') {
        req = req.limit(15);
      }

      const { data, error } = await req;

      if (error) throw error;
      setResults(data || []);
      setHighlightedIndex(-1);
    } catch (err) {
      console.error('Failed to search leads for task creation:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setIsOpen(true);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void performSearch(value);
    }, 250);
  };

  const handleFocus = () => {
    setIsOpen(true);
    if (results.length === 0) {
      void performSearch(searchTerm);
    }
  };

  const handleSelect = (lead: LeadSearchResult) => {
    setSelectedLead(lead);
    onSelectLead(lead);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLead(null);
    onSelectLead(null);
    setSearchTerm('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        if (results.length === 0) void performSearch(searchTerm);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0 && results[highlightedIndex]) {
      e.preventDefault();
      handleSelect(results[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const formatLeadName = (lead: LeadSearchResult) => {
    const full = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
    return full || 'Lead sem nome';
  };

  const formatPhone = (lead: LeadSearchResult) => {
    return lead.phone_raw || lead.phone_e164 || null;
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* If a lead is already selected, display concise identity card with 'Trocar' button */}
      {selectedLead ? (
        <div
          data-testid="selected-lead-card"
          className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs hover:border-slate-300 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#08254f] text-white flex items-center justify-center font-bold text-xs shrink-0">
              {(selectedLead.first_name?.[0] || 'L').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 truncate">
                {formatLeadName(selectedLead)}
              </div>
              <div className="text-[11px] text-slate-500 truncate flex items-center gap-2">
                {selectedLead.email && (
                  <span className="flex items-center gap-1 truncate">
                    <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedLead.email}</span>
                  </span>
                )}
                {formatPhone(selectedLead) && (
                  <span className="flex items-center gap-1 shrink-0">
                    <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                    <span>{formatPhone(selectedLead)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              data-testid="clear-lead-selection-btn"
              className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer shrink-0 ml-2"
              title="Trocar lead"
            >
              Trocar
            </button>
          )}
        </div>
      ) : (
        /* Autocomplete Input */
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={handleInputChange}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder="Buscar lead por nome, email ou telefone..."
              aria-label="Buscar lead por nome, email ou telefone"
              data-testid="task-lead-search-input"
              className="w-full pl-9 pr-9 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5] bg-white text-slate-800 placeholder:text-slate-400"
            />
            {isLoading ? (
              <Loader2 className="absolute right-3 h-3.5 w-3.5 text-[#449bd5] animate-spin pointer-events-none" />
            ) : searchTerm ? (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  void performSearch('');
                  inputRef.current?.focus();
                }}
                className="absolute right-3 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Autocomplete Dropdown List */}
          {isOpen && (
            <div
              data-testid="task-lead-search-dropdown"
              className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100 animate-in fade-in-50 duration-150"
            >
              {isLoading && results.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#449bd5]" />
                  <span>Buscando leads...</span>
                </div>
              ) : results.length === 0 ? (
                <div
                  data-testid="no-leads-found"
                  className="p-4 text-center text-xs text-slate-500 font-medium"
                >
                  Nenhum lead encontrado
                </div>
              ) : (
                results.map((lead, idx) => {
                  const isHighlighted = idx === highlightedIndex;
                  const phone = formatPhone(lead);
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleSelect(lead)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      data-testid={`lead-search-option-${lead.id}`}
                      className={`w-full text-left p-2.5 flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer ${
                        isHighlighted ? 'bg-slate-50 text-[#08254f]' : 'hover:bg-slate-50/80 text-slate-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-800 truncate flex items-center gap-1.5">
                          <User className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="truncate">{formatLeadName(lead)}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate flex items-center gap-3 mt-0.5">
                          {lead.email ? (
                            <span className="flex items-center gap-1 truncate">
                              <Mail className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                              <span className="truncate">{lead.email}</span>
                            </span>
                          ) : (
                            <span className="italic text-slate-400">Sem e-mail</span>
                          )}
                          {phone && (
                            <span className="flex items-center gap-1 shrink-0">
                              <Phone className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                              <span>{phone}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {lead.id === selectedLeadId && (
                        <Check className="h-4 w-4 text-[#449bd5] shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
