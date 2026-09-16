// =============================================================================
// Tests T1-T3: Salutation Resolver
// =============================================================================
import { describe, it, expect } from 'vitest';
import { resolveSalutation } from '../utils/salutation';

describe('resolveSalutation', () => {
  // T1: Last Name present → use Last Name
  it('T1: returns last name when present', () => {
    expect(resolveSalutation('Smith', 'John')).toBe('Smith');
  });

  it('T1: returns trimmed last name', () => {
    expect(resolveSalutation('  Smith  ', 'John')).toBe('Smith');
  });

  // T2: Last Name empty, First Name present → use First Name
  it('T2: returns first name when last name is empty', () => {
    expect(resolveSalutation('', 'John')).toBe('John');
  });

  it('T2: returns first name when last name is null', () => {
    expect(resolveSalutation(null, 'John')).toBe('John');
  });

  it('T2: returns first name when last name is undefined', () => {
    expect(resolveSalutation(undefined, 'John')).toBe('John');
  });

  it('T2: returns first name when last name is whitespace only', () => {
    expect(resolveSalutation('   ', 'Maria')).toBe('Maria');
  });

  // T3: Both empty → use default ("Doc")
  it('T3: returns "Doc" when both names are empty', () => {
    expect(resolveSalutation('', '')).toBe('Doc');
  });

  it('T3: returns "Doc" when both names are null', () => {
    expect(resolveSalutation(null, null)).toBe('Doc');
  });

  it('T3: returns "Doc" when both names are undefined', () => {
    expect(resolveSalutation(undefined, undefined)).toBe('Doc');
  });

  it('T3: returns "Doc" when both names are whitespace', () => {
    expect(resolveSalutation('  ', '  ')).toBe('Doc');
  });

  it('T3: returns custom default salutation when provided', () => {
    expect(resolveSalutation(null, null, 'Doctor')).toBe('Doctor');
  });
});
