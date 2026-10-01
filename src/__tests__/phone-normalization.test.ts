import { describe, it, expect } from 'vitest';
import { normalizePhoneSafe, resolveSmsDestinationPhone } from '../utils/phone';

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

    it('normalizes UK (+44) numbers accurately with +', () => {
      const result = normalizePhoneSafe('+447833252393');
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+447833252393');
      expect(result.countryCode).toBe('UK');
      expect(result.isAmbiguous).toBe(false);
    });

    it('normalizes UK (+44) numbers with spaces accurately', () => {
      const result = normalizePhoneSafe('+44 20 7946 0991');
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+442079460991');
      expect(result.countryCode).toBe('UK');
      expect(result.isAmbiguous).toBe(false);
    });
  });

  describe('Numbers Without (+) and Without Reliable Country Context', () => {
    it('preserves raw 447833252393 without inventing + when no country metadata is provided', () => {
      const result = normalizePhoneSafe('447833252393');
      expect(result.isValidE164).toBe(false);
      expect(result.phone_e164).toBeNull();
      expect(result.phone_raw).toBe('447833252393');
      expect(result.countryCode).toBeNull();
      expect(result.isAmbiguous).toBe(true);
    });

    it('preserves raw 5521992532694 without inventing + when no country metadata is provided', () => {
      const result = normalizePhoneSafe('5521992532694');
      expect(result.isValidE164).toBe(false);
      expect(result.phone_e164).toBeNull();
      expect(result.phone_raw).toBe('5521992532694');
      expect(result.countryCode).toBeNull();
      expect(result.isAmbiguous).toBe(true);
    });

    it('preserves raw 14075551234 without inventing + when no country metadata is provided', () => {
      const result = normalizePhoneSafe('14075551234');
      expect(result.isValidE164).toBe(false);
      expect(result.phone_e164).toBeNull();
      expect(result.phone_raw).toBe('14075551234');
      expect(result.countryCode).toBeNull();
      expect(result.isAmbiguous).toBe(true);
    });

    it('preserves raw 21992532694 without inventing + or guessing Brazil DDD when no country metadata is provided', () => {
      const result = normalizePhoneSafe('21992532694');
      expect(result.isValidE164).toBe(false);
      expect(result.phone_e164).toBeNull();
      expect(result.phone_raw).toBe('21992532694');
      expect(result.countryCode).toBeNull();
      expect(result.isAmbiguous).toBe(true);
    });
  });

  describe('Numbers With Reliable Source Country Metadata', () => {
    it('generates canonical E.164 for UK 12-digit number when sourceCountry is UK', () => {
      const result = normalizePhoneSafe('447833252393', { sourceCountry: 'UK' });
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+447833252393');
      expect(result.countryCode).toBe('UK');
      expect(result.isAmbiguous).toBe(false);
    });

    it('generates canonical E.164 for Brazil 13-digit number when sourceCountry is BR', () => {
      const result = normalizePhoneSafe('5521992532694', { sourceCountry: 'BR' });
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+5521992532694');
      expect(result.countryCode).toBe('BR');
      expect(result.isAmbiguous).toBe(false);
    });

    it('generates canonical E.164 for US 11-digit number when sourceCountry is US', () => {
      const result = normalizePhoneSafe('14075551234', { sourceCountry: 'US' });
      expect(result.isValidE164).toBe(true);
      expect(result.phone_e164).toBe('+14075551234');
      expect(result.countryCode).toBe('US/CA');
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

  describe('resolveSmsDestinationPhone & Deep Link Safety', () => {
    it('preserves leading + for UK number +447833252393', () => {
      const lead = { phone_e164: '+447833252393', phone_raw: '+44 7833 252393' };
      const resolved = resolveSmsDestinationPhone(lead);
      expect(resolved).toBe('+447833252393');
      expect(resolved.startsWith('+')).toBe(true);
    });

    it('preserves leading + for US number +14075551234', () => {
      const lead = { phone_e164: '+14075551234', phone_raw: '+1 (407) 555-1234' };
      const resolved = resolveSmsDestinationPhone(lead);
      expect(resolved).toBe('+14075551234');
      expect(resolved.startsWith('+')).toBe(true);
    });

    it('preserves leading + for Brazil number +5521992532694', () => {
      const lead = { phone_e164: '+5521992532694', phone_raw: '+55 (21) 99253-2694' };
      const resolved = resolveSmsDestinationPhone(lead);
      expect(resolved).toBe('+5521992532694');
      expect(resolved.startsWith('+')).toBe(true);
    });

    it('preserves raw digits for 21992532694 without inventing +', () => {
      const lead = { phone_e164: null, phone_raw: '21992532694' };
      const resolved = resolveSmsDestinationPhone(lead);
      expect(resolved).toBe('21992532694');
      expect(resolved.startsWith('+')).toBe(false);
    });

    it('preserves raw digits for 447833252393 without inventing + when no country context exists', () => {
      const lead = { phone_e164: null, phone_raw: '447833252393' };
      const resolved = resolveSmsDestinationPhone(lead);
      expect(resolved).toBe('447833252393');
      expect(resolved.startsWith('+')).toBe(false);
    });

    it('does NOT prepend + to ambiguous local numbers', () => {
      const lead = { phone_e164: null, phone_raw: '4075551234' };
      const resolved = resolveSmsDestinationPhone(lead);
      expect(resolved).toBe('4075551234');
      expect(resolved.startsWith('+')).toBe(false);
    });

    it('reflects manual edit from raw 21992532694 to +5521992532694 immediately', () => {
      // Before edit
      const initialLead = { phone_e164: null, phone_raw: '21992532694' };
      expect(resolveSmsDestinationPhone(initialLead)).toBe('21992532694');

      // Operator edits and saves +5521992532694
      const normalizedEdit = normalizePhoneSafe('+5521992532694');
      const updatedLead = {
        phone_e164: normalizedEdit.phone_e164,
        phone_raw: normalizedEdit.phone_raw,
      };

      expect(updatedLead.phone_e164).toBe('+5521992532694');
      expect(resolveSmsDestinationPhone(updatedLead)).toBe('+5521992532694');
    });
  });
});
