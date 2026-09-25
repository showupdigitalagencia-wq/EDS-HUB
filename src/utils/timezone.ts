// =============================================================================
// EDS HUB — Central Timezone Management System
// =============================================================================
// Primary Client Location: Florida (America/New_York).
// Architectural Rules:
// 1. Storage: All database timestamps are UTC ISO-8601 strings.
// 2. Display: Converted dynamically to the user's configured/detected IANA timezone.
// 3. Daylight Saving Time (DST): Handled automatically via standard IANA identifiers
//    (never use fixed offsets like UTC-4 or -1h).
// 4. Persistence: Local override stored in localStorage ('eds_hub_user_timezone').
// =============================================================================

export interface TimezoneOption {
  value: string;
  label: string;
  offsetDescription: string;
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: 'America/New_York', label: 'Flórida / Nova York (Eastern Time)', offsetDescription: 'ET / UTC-5 (ou UTC-4 no verão)' },
  { value: 'America/Sao_Paulo', label: 'Brasil / São Paulo (Horário de Brasília)', offsetDescription: 'BRT / UTC-3' },
  { value: 'America/Chicago', label: 'EUA / Chicago (Central Time)', offsetDescription: 'CT / UTC-6 (ou UTC-5 no verão)' },
  { value: 'America/Denver', label: 'EUA / Denver (Mountain Time)', offsetDescription: 'MT / UTC-7 (ou UTC-6 no verão)' },
  { value: 'America/Los_Angeles', label: 'EUA / Los Angeles (Pacific Time)', offsetDescription: 'PT / UTC-8 (ou UTC-7 no verão)' },
  { value: 'Europe/Lisbon', label: 'Portugal / Lisboa (WET)', offsetDescription: 'WET / UTC+0 (ou UTC+1 no verão)' },
  { value: 'Europe/London', label: 'Reino Unido / Londres (GMT)', offsetDescription: 'GMT / UTC+0 (ou UTC+1 no verão)' },
  { value: 'UTC', label: 'Tempo Universal Coordenado (UTC)', offsetDescription: 'UTC+0' },
];

const TIMEZONE_STORAGE_KEY = 'eds_hub_user_timezone';

/**
 * Detects browser's native IANA timezone.
 * Falls back to 'America/New_York' (Florida client default).
 */
export function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

/**
 * Returns current effective timezone for the user:
 * Manual override from localStorage if set, otherwise auto-detected browser timezone.
 */
export function getUserTimezone(): string {
  if (typeof window === 'undefined') {
    return 'America/New_York';
  }

  try {
    const stored = localStorage.getItem(TIMEZONE_STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // Ignore localStorage access failures
  }

  return detectBrowserTimezone();
}

/**
 * Sets a manual timezone override. Pass null or empty string to restore auto-detection.
 */
export function setUserTimezone(timezone: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    if (!timezone || !timezone.trim()) {
      localStorage.removeItem(TIMEZONE_STORAGE_KEY);
    } else {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, timezone.trim());
    }
    // Dispatch event so all components react immediately
    window.dispatchEvent(new CustomEvent('eds-timezone-changed', { detail: { timezone: getUserTimezone() } }));
  } catch (err) {
    console.warn('[Timezone] Failed to save timezone preference:', err);
  }
}

/**
 * Checks whether user is currently using auto-detected timezone or a manual override.
 */
export function isTimezoneAutoDetected(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return !localStorage.getItem(TIMEZONE_STORAGE_KEY);
  } catch {
    return true;
  }
}

/**
 * Formats a UTC ISO timestamp or Date into the user's localized timezone.
 */
export function formatInUserTimezone(
  dateInput: string | Date | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  customTimezone?: string
): string {
  if (!dateInput) return '—';

  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const timeZone = customTimezone || getUserTimezone();

  const hasCustomParts = Boolean(
    options && (options.hour || options.minute || options.second || options.day || options.month || options.year)
  );

  const formattingOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    ...(hasCustomParts ? options : { dateStyle: 'short', timeStyle: 'short', ...options }),
  };

  try {
    return new Intl.DateTimeFormat('pt-BR', formattingOptions).format(date);
  } catch (err) {
    console.warn('[Timezone] Formatting error with timezone', timeZone, err);
    return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date);
  }
}

/**
 * Formats only time (HH:mm) in the user's timezone.
 */
export function formatTimeOnly(
  dateInput: string | Date | number | null | undefined,
  customTimezone?: string
): string {
  return formatInUserTimezone(
    dateInput,
    {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
    customTimezone
  );
}

/**
 * Formats task due time in human-friendly Portuguese with user timezone:
 * e.g., "13:50" or "25/09 às 13:50".
 */
export function formatTaskDueTime(
  dateInput: string | Date | number | null | undefined,
  customTimezone?: string
): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const tz = customTimezone || getUserTimezone();

  try {
    // Check if same calendar day in user timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const isToday = formatter.format(date) === formatter.format(now);

    const timeStr = formatTimeOnly(date, tz);
    if (isToday) {
      return timeStr;
    }

    const dayMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(date);
    return `${dayMonth} às ${timeStr}`;
  } catch {
    return formatInUserTimezone(dateInput, undefined, tz);
  }
}

/**
 * Converts a local date string (YYYY-MM-DD) and local time string (HH:mm)
 * in a specified IANA timezone into an exact UTC ISO-8601 string.
 * DST-safe: uses Intl API to calculate exact offset for that specific calendar date.
 */
export function parseLocalToUtc(
  dateStr: string,
  timeStr: string,
  ianaTimezone?: string
): string {
  const tz = ianaTimezone || getUserTimezone();

  // Create an approximate ISO date in UTC
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  // Use a reference UTC date
  const targetUtcGuess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));

  // Determine the timezone offset in minutes at targetUtcGuess for the specified IANA timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(targetUtcGuess);

  const getPart = (type: string) => {
    const p = parts.find((part) => part.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };

  const tzYear = getPart('year');
  const tzMonth = getPart('month');
  const tzDay = getPart('day');
  const tzHour = getPart('hour') % 24;
  const tzMinute = getPart('minute');

  const tzDateAsUtc = new Date(Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0, 0));
  const diffMs = tzDateAsUtc.getTime() - targetUtcGuess.getTime();

  // Correct targetUtc by subtracting the offset
  const exactUtc = new Date(targetUtcGuess.getTime() - diffMs);
  return exactUtc.toISOString();
}
