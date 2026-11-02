import { describe, expect, it } from 'vitest';
import {
  extractIdentifier,
  maskIdentifier,
  normalizeDigitSequence,
  normalizeMonetaryAmount,
  redactSecret,
} from './numericNormalization';

describe('numericNormalization', () => {
  describe('normalizeDigitSequence', () => {
    it('normalizes spoken digit sequences', () => {
      expect(normalizeDigitSequence('one two three four five six seven')).toBe('1234567');
      expect(normalizeDigitSequence('one two three four five six seven', { expectedLength: 7 })).toBe('1234567');
      expect(normalizeDigitSequence('eight nine zero one')).toBe('8901');
    });

    it('normalizes digit sequences with pauses, commas, periods and dashes', () => {
      expect(normalizeDigitSequence('one, two, three, four, five, six, seven.')).toBe('1234567');
      expect(normalizeDigitSequence('one, two, three - four, five, six, seven')).toBe('1234567');
      expect(normalizeDigitSequence('5000-0000-0201')).toBe('500000000201');
      expect(normalizeDigitSequence('1, 2, 3, 4')).toBe('1234');
    });

    it('handles typed numeric strings', () => {
      expect(normalizeDigitSequence('1234567')).toBe('1234567');
      expect(normalizeDigitSequence('500000000201')).toBe('500000000201');
      expect(normalizeDigitSequence(' 1234567 ')).toBe('1234567');
    });

    it('preserves leading zeros accurately', () => {
      expect(normalizeDigitSequence('zero zero one two three four five')).toBe('0012345');
      expect(normalizeDigitSequence('0012345')).toBe('0012345');
      expect(normalizeDigitSequence('oh oh seven')).toBe('007');
      expect(normalizeDigitSequence('nil nil three')).toBe('003');
    });

    it('handles number-word variants and colloquial accents', () => {
      expect(normalizeDigitSequence('oh one two tree four five six')).toBe('0123456');
      expect(normalizeDigitSequence('nought one two three')).toBe('0123');
      expect(normalizeDigitSequence('niner seven ate won')).toBe('9781');
    });

    it('handles multipliers like double and triple', () => {
      expect(normalizeDigitSequence('one double three five')).toBe('1335');
      expect(normalizeDigitSequence('triple zero one two three four')).toBe('0001234');
      expect(normalizeDigitSequence('double five double six')).toBe('5566');
    });

    it('handles compound grouped numbers in digit sequences', () => {
      expect(normalizeDigitSequence('twenty five six seven')).toBe('2567');
      expect(normalizeDigitSequence('eleven twelve thirteen')).toBe('111213');
      expect(normalizeDigitSequence('fifty thousand', { context: 'digit_sequence' })).toBe('50');
    });

    it('protects against ambiguous words in natural language phrases', () => {
      // In general context, isolated words like "to", "for", "won" should not convert to digits
      expect(normalizeDigitSequence('I want to check my balance')).toBe('');
      expect(normalizeDigitSequence('Please get a statement for last month')).toBe('');
      expect(normalizeDigitSequence('We won the contest')).toBe('');

      // But in digit sequence context or adjacent to digits, "to" and "for" count
      expect(normalizeDigitSequence('one to three for five', { context: 'digit_sequence' })).toBe('12345');
      expect(normalizeDigitSequence('one to three')).toBe('123');
    });

    it('filters by expectedLength option', () => {
      expect(normalizeDigitSequence('one two three', { expectedLength: 7 })).toBe('');
      expect(normalizeDigitSequence('one two three four five six seven', { expectedLength: 7 })).toBe('1234567');
      expect(normalizeDigitSequence('1234567', { expectedLength: [7, 12] })).toBe('1234567');
      expect(normalizeDigitSequence('500000000201', { expectedLength: [7, 12] })).toBe('500000000201');
      expect(normalizeDigitSequence('12345', { expectedLength: [7, 12] })).toBe('');
    });
  });

  describe('extractIdentifier', () => {
    it('extracts a 7-digit Phone Code', () => {
      const res = extractIdentifier('one two three four five six seven');
      expect(res).toEqual({ value: '1234567', type: 'phone_code' });
    });

    it('extracts a typed 7-digit Phone Code', () => {
      const res = extractIdentifier('1234567');
      expect(res).toEqual({ value: '1234567', type: 'phone_code' });
    });

    it('extracts a 12-digit Account Number', () => {
      const res = extractIdentifier('500000000201');
      expect(res).toEqual({ value: '500000000201', type: 'account_number' });
    });

    it('extracts a spoken 12-digit Account Number with pauses and grouping', () => {
      const res = extractIdentifier('five zero zero zero, zero zero zero zero, zero two zero one');
      expect(res).toEqual({ value: '500000000201', type: 'account_number' });
    });

    it('extracts an identifier with explicit conversational hint', () => {
      expect(extractIdentifier('My phone code is 1234567')).toEqual({ value: '1234567', type: 'phone_code' });
      expect(extractIdentifier('Business account 5000 0000 0201')).toEqual({ value: '500000000201', type: 'account_number' });
    });

    it('returns null when input has invalid digit length', () => {
      expect(extractIdentifier('12345')).toBeNull();
      expect(extractIdentifier('hello how are you')).toBeNull();
      expect(extractIdentifier('1234567890')).toBeNull();
    });
  });

  describe('normalizeMonetaryAmount', () => {
    it('parses numeric monetary amounts with currency symbols', () => {
      expect(normalizeMonetaryAmount('$150')).toEqual({ amount: 150, currency: 'SGD', raw: '$150' });
      expect(normalizeMonetaryAmount('$1,250.50')).toEqual({ amount: 1250.5, currency: 'SGD', raw: '$1,250.50' });
      expect(normalizeMonetaryAmount('150 USD')).toEqual({ amount: 150, currency: 'USD', raw: '150 USD' });
      expect(normalizeMonetaryAmount('50 dollars')).toEqual({ amount: 50, currency: 'SGD', raw: '50 dollars' });
    });

    it('parses spoken monetary word phrases', () => {
      expect(normalizeMonetaryAmount('one hundred fifty dollars')).toEqual({
        amount: 150,
        currency: 'SGD',
        raw: 'one hundred fifty dollars',
      });
      expect(normalizeMonetaryAmount('two thousand five hundred USD')).toEqual({
        amount: 2500,
        currency: 'USD',
        raw: 'two thousand five hundred USD',
      });
    });

    it('returns null for non-monetary phrases or pure digit codes', () => {
      expect(normalizeMonetaryAmount('one two three four five six seven')).toBeNull();
      expect(normalizeMonetaryAmount('1234567')).toBeNull();
      expect(normalizeMonetaryAmount('my account balance')).toBeNull();
    });
  });

  describe('privacy masking', () => {
    it('masks identifiers preserving only the last keep digits', () => {
      expect(maskIdentifier('1234567')).toBe('•••4567');
      expect(maskIdentifier('500000000201')).toBe('••••••••0201');
      expect(maskIdentifier('123')).toBe('•••');
    });

    it('completely redacts secrets', () => {
      expect(redactSecret('135790')).toBe('***REDACTED***');
      expect(redactSecret('987654')).toBe('***REDACTED***');
    });
  });
});

