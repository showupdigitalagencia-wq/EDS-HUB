import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { parsePhoneNumber, type CountryCode } from 'libphonenumber-js';

// Top common countries prioritized at top of list
export interface CountryOption {
  iso: CountryCode;
  name: string;
  dial: string;
}

export const COUNTRIES: CountryOption[] = [
  { iso: 'US', name: 'United States', dial: '1' },
  { iso: 'CA', name: 'Canada', dial: '1' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'BR', name: 'Brazil', dial: '55' },
  { iso: 'ES', name: 'Spain', dial: '34' },
  { iso: 'PT', name: 'Portugal', dial: '351' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'IT', name: 'Italy', dial: '39' },
  { iso: 'CH', name: 'Switzerland', dial: '41' },
  { iso: 'AU', name: 'Australia', dial: '61' },
  { iso: 'MX', name: 'Mexico', dial: '52' },
  { iso: 'CO', name: 'Colombia', dial: '57' },
  { iso: 'AR', name: 'Argentina', dial: '54' },
  { iso: 'CL', name: 'Chile', dial: '56' },
  { iso: 'PE', name: 'Peru', dial: '51' },
  { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966' },
  { iso: 'IE', name: 'Ireland', dial: '353' },
  { iso: 'NL', name: 'Netherlands', dial: '31' },
  { iso: 'BE', name: 'Belgium', dial: '32' },
  { iso: 'AT', name: 'Austria', dial: '43' },
  { iso: 'SE', name: 'Sweden', dial: '46' },
  { iso: 'NO', name: 'Norway', dial: '47' },
  { iso: 'DK', name: 'Denmark', dial: '45' },
  { iso: 'FI', name: 'Finland', dial: '358' },
  { iso: 'GR', name: 'Greece', dial: '30' },
  { iso: 'PL', name: 'Poland', dial: '48' },
  { iso: 'DO', name: 'Dominican Republic', dial: '1809' },
  { iso: 'PR', name: 'Puerto Rico', dial: '1787' },
  { iso: 'ZA', name: 'South Africa', dial: '27' },
];

function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

interface PhoneCountryInputProps {
  id?: string;
  value?: string;
  error?: boolean;
  placeholder?: string;
  defaultCountry?: CountryCode;
  onChange: (fullE164: string, countryIso: CountryCode) => void;
}

export const PhoneCountryInput: React.FC<PhoneCountryInputProps> = ({
  id = 'phone-input',
  value = '',
  error = false,
  placeholder = 'Enter Phone Number',
  defaultCountry = 'US',
  onChange,
}) => {
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(() => {
    return COUNTRIES.find((c) => c.iso === defaultCountry) || COUNTRIES[0];
  });
  const [localNumber, setLocalNumber] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync incoming value (e.g. from state or reset)
  useEffect(() => {
    if (!value) {
      setLocalNumber('');
      return;
    }

    const trimmed = value.trim();
    if (trimmed.startsWith('+')) {
      try {
        const parsed = parsePhoneNumber(trimmed);
        if (parsed) {
          const match = COUNTRIES.find((c) => c.iso === parsed.country);
          if (match) {
            setSelectedCountry(match);
          }
          setLocalNumber(parsed.nationalNumber);
          return;
        }
      } catch {
        // ignore
      }
    }
  }, [value]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const filteredCountries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim().replace(/^\+/, '');
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;

    // Check if user pasted or typed full international number starting with '+'
    if (inputVal.trim().startsWith('+')) {
      try {
        const parsed = parsePhoneNumber(inputVal.trim());
        if (parsed) {
          const match = COUNTRIES.find((c) => c.iso === parsed.country);
          if (match) {
            setSelectedCountry(match);
            setLocalNumber(parsed.nationalNumber);
            onChange(parsed.number, match.iso);
            return;
          }
        }
      } catch {
        // continue normal handling
      }
    }

    // Normal typing: keep digits and punctuation
    const cleaned = inputVal.replace(/[^\d\s\-().]/g, '');
    setLocalNumber(cleaned);

    // Compute canonical E.164 using libphonenumber-js
    try {
      const parsed = parsePhoneNumber(cleaned, selectedCountry.iso);
      if (parsed) {
        onChange(parsed.number, selectedCountry.iso);
        return;
      }
    } catch {
      // Fallback: strip trunk zero if applicable and concatenate
      const rawDigits = cleaned.replace(/\D/g, '');
      const normalizedDigits =
        rawDigits.startsWith('0') && selectedCountry.dial !== '39'
          ? rawDigits.substring(1)
          : rawDigits;
      const fallbackE164 = normalizedDigits ? `+${selectedCountry.dial}${normalizedDigits}` : '';
      onChange(fallbackE164, selectedCountry.iso);
    }
  };

  const handleSelectCountry = (country: CountryOption) => {
    setSelectedCountry(country);
    setIsOpen(false);
    setSearchQuery('');

    // Recompute with new country
    if (localNumber.trim()) {
      try {
        const parsed = parsePhoneNumber(localNumber, country.iso);
        if (parsed) {
          onChange(parsed.number, country.iso);
          return;
        }
      } catch {
        // Fallback
      }
      const rawDigits = localNumber.replace(/\D/g, '');
      const normalizedDigits =
        rawDigits.startsWith('0') && country.dial !== '39' ? rawDigits.substring(1) : rawDigits;
      onChange(normalizedDigits ? `+${country.dial}${normalizedDigits}` : '', country.iso);
    } else {
      onChange('', country.iso);
    }
  };

  return (
    <div className="relative w-full flex items-stretch gap-2" ref={dropdownRef}>
      {/* Country Selector Button */}
      <button
        type="button"
        id={`${id}-country-btn`}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium bg-white hover:bg-slate-50 transition-colors shrink-0 ${
          error ? 'border-rose-300 text-rose-900' : 'border-slate-300 text-slate-800'
        }`}
        title={`${selectedCountry.name} (+${selectedCountry.dial})`}
      >
        <span className="text-base leading-none">{getFlagEmoji(selectedCountry.iso)}</span>
        <span className="text-xs font-semibold text-slate-700">+{selectedCountry.dial}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {/* Number Input Field */}
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={localNumber}
        placeholder={placeholder}
        onChange={handleInputChange}
        className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-colors ${
          error
            ? 'border-rose-300 focus:ring-rose-500 text-rose-900'
            : 'border-slate-300 focus:ring-brand-500 text-slate-900'
        }`}
      />

      {/* Searchable Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-72 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden flex flex-col max-h-72 animate-in fade-in zoom-in-95">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search country or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-transparent border-none focus:outline-none text-slate-800 placeholder-slate-400"
            />
          </div>
          <div className="overflow-y-auto divide-y divide-slate-50 py-1">
            {filteredCountries.length > 0 ? (
              filteredCountries.map((c) => {
                const isSelected = c.iso === selectedCountry.iso;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    onClick={() => handleSelectCountry(c)}
                    className={`w-full px-3.5 py-2 text-xs flex items-center justify-between text-left hover:bg-brand-50/60 transition-colors ${
                      isSelected ? 'bg-brand-50 text-brand-900 font-semibold' : 'text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-base">{getFlagEmoji(c.iso)}</span>
                      <span className="truncate">{c.name}</span>
                    </div>
                    <span className="font-mono text-slate-400 text-[11px] shrink-0 ml-2">
                      +{c.dial}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">No country found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

