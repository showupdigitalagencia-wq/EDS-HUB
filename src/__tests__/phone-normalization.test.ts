import { describe, it, expect } from 'vitest';
import { normalizePhoneSafe } from '../utils/phone';

describe('Phone Normalization & Safe Country Handling', () => {
  describe('Explicit International Numbers (+)', () => {
    it('normalizes US/Canada (+1) numbers accurately', () => {
      const result = normalizePhoneSafe('+1 (407) 555-1234');
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+14075551234');
      expect(result.phone_raw).toBe('+1 (407) 555-1234');
      expect(result.countryCode).toBe('US/CA');
      expect(result.isAmbiguous).toBe(false);
      expect(result.formattedDisplay).toBe('+1 (407) 555-1234');
    });

    it('normalizes Brazil (+55) mobile 11-digit numbers accurately', () => {
      const result = normalizePhoneSafe('+55 (11) 98765-4321');
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+5511987654321');
      expect(result.phone_raw).toBe('+55 (11) 98765-4321');
      expect(result.countryCode).toBe('BR');
      expect(result.isAmbiguous).toBe(false);
      expect(result.formattedDisplay).toBe('+55 (11) 98765-4321');
    });

    it('normalizes Brazil (+55) landline 10-digit numbers accurately', () => {
      const result = normalizePhoneSafe('+55 11 3234-5678');
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+551132345678');
      expect(result.countryCode).toBe('BR');
      expect(result.isAmbiguous).toBe(false);
      expect(result.formattedDisplay).toBe('+55 (11) 3234-5678');
    });

    it('normalizes other valid international numbers', () => {
      const result = normalizePhoneSafe('+44 20 7946 0991');
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+442079460991');
      expect(result.countryCode).toBe('INTL');
      expect(result.isAmbiguous).toBe(false);
    });
  });

  describe('Ambiguous Numbers Without Country Code (+)', () => {
    it('preserves raw phone but refuses to fabricate phone_e164 for US-looking 10 digits without +', () => {
      const result = normalizePhoneSafe('(407) 555-1234');
      expect(result.isValidE164).toBe(false);
      expect(result.phone_e164).toBeNull();
      expect(result.phone_raw).toBe('(407) 555-1234');
      expect(result.isAmbiguous).toBe(true);
      expect(result.countryCode).toBeNull();
    });

    it('preserves raw phone but refuses to fabricate phone_e164 for Brazil-looking 11 digits without +', () => {
      const result = normalizePhoneSafe('11987654321');
      expect(result.isValidE164).toBe(false);
      expect(result.phone_e164).toBeNull();
      expect(result.phone_raw).toBe('11987654321');
      expect(result.isAmbiguous).toBe(true);
      expect(result.countryCode).toBeNull();
    });

    it('handles empty or whitespace strings gracefully', () => {
      const result = normalizePhoneSafe('   ');
      expect(result.phone_raw).toBeNull();
      expect(result.phone_e164).toBeNull();
      expect(result.isValidE164).toBe(false);
      expect(result.isAmbiguous).toBe(false);
    });
  });
});
