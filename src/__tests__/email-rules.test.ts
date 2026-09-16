// =============================================================================
// Tests T4-T5: Email Validation & Deduplication
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  isValidEmailSyntax,
  normalizeEmail,
  resolveEmailRecipients,
} from '../utils/email-validation';

describe('isValidEmailSyntax', () => {
  it('accepts valid email', () => {
    expect(isValidEmailSyntax('user@example.com')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(isValidEmailSyntax('user@mail.example.com')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidEmailSyntax('')).toBe(false);
  });

  it('rejects email without @', () => {
    expect(isValidEmailSyntax('userexample.com')).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(isValidEmailSyntax('user@')).toBe(false);
  });

  it('rejects email without TLD', () => {
    expect(isValidEmailSyntax('user@example')).toBe(false);
  });

  it('rejects email with spaces', () => {
    expect(isValidEmailSyntax('user @example.com')).toBe(false);
  });

  it('rejects email with single char TLD', () => {
    expect(isValidEmailSyntax('user@example.c')).toBe(false);
  });

  it('rejects email starting with @', () => {
    expect(isValidEmailSyntax('@example.com')).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });
});

describe('resolveEmailRecipients', () => {
  // T4: email and confirmation equal after normalization → 1 email
  it('T4: returns single email when both are the same', () => {
    const result = resolveEmailRecipients('user@example.com', 'user@example.com');
    expect(result).toEqual(['user@example.com']);
    expect(result).toHaveLength(1);
  });

  it('T4: returns single email when same but different case', () => {
    const result = resolveEmailRecipients('User@Example.COM', 'user@example.com');
    expect(result).toEqual(['user@example.com']);
    expect(result).toHaveLength(1);
  });

  it('T4: returns single email when same with whitespace differences', () => {
    const result = resolveEmailRecipients('  user@example.com  ', 'user@example.com');
    expect(result).toEqual(['user@example.com']);
    expect(result).toHaveLength(1);
  });

  // T5: email and confirmation different → 2 emails
  it('T5: returns two emails when they are different', () => {
    const result = resolveEmailRecipients('user@example.com', 'other@example.com');
    expect(result).toEqual(['user@example.com', 'other@example.com']);
    expect(result).toHaveLength(2);
  });

  // Edge cases
  it('returns single email when only email is provided', () => {
    const result = resolveEmailRecipients('user@example.com', null);
    expect(result).toEqual(['user@example.com']);
    expect(result).toHaveLength(1);
  });

  it('returns single email when only confirmation is provided', () => {
    const result = resolveEmailRecipients(null, 'user@example.com');
    expect(result).toEqual(['user@example.com']);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when both are null', () => {
    const result = resolveEmailRecipients(null, null);
    expect(result).toEqual([]);
  });

  it('returns empty array when both are empty strings', () => {
    const result = resolveEmailRecipients('', '');
    expect(result).toEqual([]);
  });

  it('excludes invalid emails', () => {
    const result = resolveEmailRecipients('valid@example.com', 'invalid-email');
    expect(result).toEqual(['valid@example.com']);
    expect(result).toHaveLength(1);
  });

  it('returns empty when both are invalid', () => {
    const result = resolveEmailRecipients('not-an-email', 'also-not');
    expect(result).toEqual([]);
  });
});
