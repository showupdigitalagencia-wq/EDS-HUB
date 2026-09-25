import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  resolveCanonicalPreference,
  getContactPreferenceLabel,
  formatContactPreferenceLabel,
  getContactPreferenceBadgeClasses,
} from '../utils/contact-preference';
import {
  detectBrowserTimezone,
  getUserTimezone,
  setUserTimezone,
  isTimezoneAutoDetected,
  formatInUserTimezone,
  formatTaskDueTime,
  parseLocalToUtc,
} from '../utils/timezone';
import { PwaUpdatePrompt } from '../components/PwaUpdatePrompt';

describe('EDS HUB — Final Delivery Recovery Test Suite', () => {

  // ===========================================================================
  // 1. Contact Preference Resolver & Formatter
  // ===========================================================================
  describe('1. Central Contact Preference Resolver & Invariants', () => {
    it('resolves canonical values accurately', () => {
      expect(resolveCanonicalPreference('email')).toBe('email');
      expect(resolveCanonicalPreference('EMAIL')).toBe('email');
      expect(resolveCanonicalPreference('sms')).toBe('sms');
      expect(resolveCanonicalPreference('SMS / Text')).toBe('sms');
      expect(resolveCanonicalPreference('whatsapp')).toBe('whatsapp');
      expect(resolveCanonicalPreference('WhatsApp')).toBe('whatsapp');
      expect(resolveCanonicalPreference('whats')).toBe('whatsapp');
      expect(resolveCanonicalPreference('call')).toBe('call');
      expect(resolveCanonicalPreference('phone')).toBe('call');
      expect(resolveCanonicalPreference('ligação')).toBe('call');
    });

    it('STRICT INVARIANT: Null/Unspecified/Unknown NEVER falls back to email', () => {
      expect(resolveCanonicalPreference(null)).toBeNull();
      expect(resolveCanonicalPreference(undefined)).toBeNull();
      expect(resolveCanonicalPreference('')).toBeNull();
      expect(resolveCanonicalPreference('   ')).toBeNull();
      expect(resolveCanonicalPreference('none')).toBeNull();
      expect(resolveCanonicalPreference('unspecified')).toBeNull();
      expect(resolveCanonicalPreference('não informada')).toBeNull();
      expect(resolveCanonicalPreference('random_unknown_value')).toBeNull();
    });

    it('returns official UI labels', () => {
      expect(getContactPreferenceLabel('email')).toBe('Email');
      expect(getContactPreferenceLabel('sms')).toBe('SMS');
      expect(getContactPreferenceLabel('call')).toBe('Ligação');
      expect(getContactPreferenceLabel('whatsapp')).toBe('WhatsApp');
      expect(getContactPreferenceLabel(null)).toBe('Não informada');
      expect(getContactPreferenceLabel(undefined)).toBe('Não informada');
    });

    it('formats display labels with and without prefix', () => {
      expect(formatContactPreferenceLabel('email')).toBe('Preferência: Email');
      expect(formatContactPreferenceLabel('sms')).toBe('Preferência: SMS');
      expect(formatContactPreferenceLabel('whatsapp')).toBe('Preferência: WhatsApp');
      expect(formatContactPreferenceLabel('call')).toBe('Preferência: Ligação');
      expect(formatContactPreferenceLabel(null)).toBe('Preferência: Não informada');

      expect(formatContactPreferenceLabel('whatsapp', { withPrefix: false })).toBe('WhatsApp');
      expect(formatContactPreferenceLabel(null, { withPrefix: false })).toBe('Não informada');
    });

    it('returns valid Tailwind badge styling classes for all preferences', () => {
      const emailBadge = getContactPreferenceBadgeClasses('email');
      expect(emailBadge.badge).toContain('emerald');

      const smsBadge = getContactPreferenceBadgeClasses('sms');
      expect(smsBadge.badge).toContain('blue');

      const waBadge = getContactPreferenceBadgeClasses('whatsapp');
      expect(waBadge.badge).toContain('emerald');

      const callBadge = getContactPreferenceBadgeClasses('call');
      expect(callBadge.badge).toContain('amber');

      const nullBadge = getContactPreferenceBadgeClasses(null);
      expect(nullBadge.badge).toContain('slate');
    });
  });

  // ===========================================================================
  // 2. Central Timezone Management System
  // ===========================================================================
  describe('2. Central Timezone Management System (America/New_York & IANA)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('detects browser timezone or falls back to America/New_York', () => {
      const tz = detectBrowserTimezone();
      expect(tz).toBeDefined();
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    });

    it('allows setting manual timezone override and reading it back', () => {
      expect(isTimezoneAutoDetected()).toBe(true);

      setUserTimezone('America/New_York');
      expect(getUserTimezone()).toBe('America/New_York');
      expect(isTimezoneAutoDetected()).toBe(false);

      setUserTimezone('America/Sao_Paulo');
      expect(getUserTimezone()).toBe('America/Sao_Paulo');

      // Reset to auto
      setUserTimezone(null);
      expect(isTimezoneAutoDetected()).toBe(true);
    });

    it('formats UTC ISO timestamps cleanly in specified timezone', () => {
      // 2026-09-25T18:00:00Z -> in America/New_York (EDT, UTC-4) is 14:00
      const utcIso = '2026-09-25T18:00:00Z';
      const formatted = formatInUserTimezone(utcIso, { hour: '2-digit', minute: '2-digit', hour12: false }, 'America/New_York');
      expect(formatted).toContain('14:00');
    });

    it('converts local calendar date and time in IANA timezone to exact UTC ISO with DST', () => {
      // EDT date (September): UTC-4 offset
      const utcDate = parseLocalToUtc('2026-09-25', '14:00', 'America/New_York');
      expect(utcDate).toBe('2026-09-25T18:00:00.000Z');

      // Standard Time date (January): UTC-5 offset
      const winterUtcDate = parseLocalToUtc('2026-01-15', '14:00', 'America/New_York');
      expect(winterUtcDate).toBe('2026-01-15T19:00:00.000Z');
    });

    it('formats task due time in human-readable Portuguese', () => {
      const formatted = formatTaskDueTime('2026-09-25T18:00:00Z', 'America/New_York');
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // ===========================================================================
  // 3. PWA Update Prompt Component
  // ===========================================================================
  describe('3. PWA Update Lifecycle & Prompt Component', () => {
    it('renders nothing when no update is available', () => {
      const { container } = render(<PwaUpdatePrompt />);
      expect(container.firstChild).toBeNull();
    });

    it('renders banner when eds-pwa-update-available event is dispatched', () => {
      render(<PwaUpdatePrompt />);

      const mockReg = {
        waiting: { postMessage: vi.fn() },
      } as unknown as ServiceWorkerRegistration;

      fireEvent(
        window,
        new CustomEvent('eds-pwa-update-available', {
          detail: { registration: mockReg },
        })
      );

      expect(screen.getByTestId('pwa-update-banner')).toBeDefined();
      expect(screen.getByText('Nova versão disponível')).toBeDefined();
      expect(screen.getByTestId('pwa-update-now-btn')).toBeDefined();
    });

    it('clicking "Atualizar agora" triggers postMessage SKIP_WAITING to waiting worker', () => {
      render(<PwaUpdatePrompt />);

      const postMessageSpy = vi.fn();
      const mockReg = {
        waiting: { postMessage: postMessageSpy },
      } as unknown as ServiceWorkerRegistration;

      fireEvent(
        window,
        new CustomEvent('eds-pwa-update-available', {
          detail: { registration: mockReg },
        })
      );

      const updateBtn = screen.getByTestId('pwa-update-now-btn');
      fireEvent.click(updateBtn);

      expect(postMessageSpy).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });

    it('dismissing the banner hides it cleanly', () => {
      render(<PwaUpdatePrompt />);

      const mockReg = {
        waiting: { postMessage: vi.fn() },
      } as unknown as ServiceWorkerRegistration;

      fireEvent(
        window,
        new CustomEvent('eds-pwa-update-available', {
          detail: { registration: mockReg },
        })
      );

      expect(screen.getByTestId('pwa-update-banner')).toBeDefined();

      const dismissBtn = screen.getByLabelText('Dispensar aviso');
      fireEvent.click(dismissBtn);

      expect(screen.queryByTestId('pwa-update-banner')).toBeNull();
    });
  });
});
