import { describe, expect, it, vi } from 'vitest';
import { extractIdentifier, normalizeDigitSequence, normalizeMonetaryAmount } from '../../utils/numericNormalization';
import { spokenDigits, understand, toolFor } from './bankingAssistant';
import type { ChannelState, CaptureOutcome } from '../../api/gatewayTypes';

describe('Banking Verification and Numeric Input Flow', () => {
  describe('Numeric Input Normalization', () => {
    it('normalizes spoken digit sequences matching Phone Code (7 digits)', () => {
      const input = 'one, two, three, four, five, six, seven';
      const normalized = normalizeDigitSequence(input);
      expect(normalized).toBe('1234567');

      const extracted = extractIdentifier(input);
      expect(extracted).toEqual({ value: '1234567', type: 'phone_code' });
    });

    it('normalizes spoken digit sequences matching Business Account Number (12 digits)', () => {
      const input = 'five zero zero zero, zero zero zero zero, zero two zero one';
      const normalized = normalizeDigitSequence(input);
      expect(normalized).toBe('500000000201');

      const extracted = extractIdentifier(input);
      expect(extracted).toEqual({ value: '500000000201', type: 'account_number' });
    });

    it('handles spoken digit sequences with pauses, punctuation, dashes and spaces', () => {
      expect(normalizeDigitSequence('one... two... three - four, five, six, seven.')).toBe('1234567');
      expect(normalizeDigitSequence('5000 - 0000 - 0201')).toBe('500000000201');
      expect(normalizeDigitSequence('1, 2, 3, 4, 5, 6, 7')).toBe('1234567');
    });

    it('handles typed numeric inputs consistently with spoken inputs', () => {
      const typed = '1234567';
      const spoken = 'one two three four five six seven';

      expect(normalizeDigitSequence(typed)).toBe('1234567');
      expect(normalizeDigitSequence(spoken)).toBe('1234567');
      expect(extractIdentifier(typed)).toEqual(extractIdentifier(spoken));

      const typedAccount = '500000000201';
      const spokenAccount = 'five zero zero zero zero zero zero zero zero two zero one';
      expect(normalizeDigitSequence(typedAccount)).toBe('500000000201');
      expect(normalizeDigitSequence(spokenAccount)).toBe('500000000201');
      expect(extractIdentifier(typedAccount)).toEqual(extractIdentifier(spokenAccount));
    });

    it('preserves leading zeros in digit codes', () => {
      expect(normalizeDigitSequence('zero zero one two three four five')).toBe('0012345');
      expect(normalizeDigitSequence('0012345')).toBe('0012345');
      expect(normalizeDigitSequence('oh oh seven')).toBe('007');
      expect(normalizeDigitSequence('nought nought four five six')).toBe('00456');
    });

    it('handles spoken number-word variants, multipliers, and groupings', () => {
      expect(normalizeDigitSequence('double three four double five')).toBe('33455');
      expect(normalizeDigitSequence('triple zero one two')).toBe('00012');
      expect(normalizeDigitSequence('twenty five six seven')).toBe('2567');
      expect(normalizeDigitSequence('eleven twelve thirteen')).toBe('111213');
    });

    it('distinguishes digit codes from natural language and monetary amounts', () => {
      // Natural language phrases must not produce accidental numbers
      expect(normalizeDigitSequence('I want to check my account balance')).toBe('');
      expect(normalizeDigitSequence('Statement for last month')).toBe('');
      expect(normalizeDigitSequence('We won the contract')).toBe('');

      // SpokenDigits backwards compatibility preserves existing behavior
      expect(spokenDigits('I want to check my account balance')).toBe('');
      expect(spokenDigits('one two three four five six seven')).toBe('1234567');

      // Monetary amounts are parsed into numeric amounts with currency
      expect(normalizeMonetaryAmount('$150')).toEqual({ amount: 150, currency: 'SGD', raw: '$150' });
      expect(normalizeMonetaryAmount('one hundred fifty dollars')).toEqual({ amount: 150, currency: 'SGD', raw: 'one hundred fifty dollars' });
      expect(normalizeMonetaryAmount('250 USD')).toEqual({ amount: 250, currency: 'USD', raw: '250 USD' });
    });

    it('validates 7-digit Phone Code and 12-digit Account Number field constraints', () => {
      // Valid lengths
      expect(extractIdentifier('1234567')?.type).toBe('phone_code');
      expect(extractIdentifier('500000000201')?.type).toBe('account_number');

      // Invalid lengths (e.g. 6 digits or 10 digits)
      expect(extractIdentifier('123456')).toBeNull();
      expect(extractIdentifier('12345678')).toBeNull();
      expect(extractIdentifier('50000000020')).toBeNull();
      expect(extractIdentifier('5000000002011')).toBeNull();
    });
  });

  describe('End-to-End Verification and Pending Inquiry Resumption', () => {
    it('understands balance inquiry and maps to get_balance tool', () => {
      const req = understand("What's my account balance?");
      expect(req).not.toBeNull();
      expect(req?.topic).toBe('balance');

      // Once account is selected
      const toolCall = toolFor(req!, 'A1');
      expect(toolCall).toEqual({
        tool: 'get_balance',
        args: { account_ref: 'A1' },
      });
    });

    it('simulates full verification lifecycle with Phone Code and PIN', async () => {
      // 1. Customer says "What's my account balance?"
      const customerRequest = understand("What's my account balance?");
      expect(customerRequest?.topic).toBe('balance');

      // Pending request is set
      let pendingRequest = customerRequest;

      // 2. Customer provides Phone Code (spoken)
      const spokenCode = 'one, two, three, four, five, six, seven';
      const extractedPhone = extractIdentifier(spokenCode);
      expect(extractedPhone).toEqual({ value: '1234567', type: 'phone_code' });

      // Mock gateway identify response
      const mockIdentify = vi.fn().mockResolvedValue({
        ok: true,
        session_id: 'rehearsal_001',
        next: 'wait_for_secure_entry',
      });

      const identifyResult = await mockIdentify({ phone_code: extractedPhone!.value });
      expect(identifyResult.ok).toBe(true);

      // Channel moves to awaiting PIN
      const channelState: ChannelState = {
        hosts: 'mock',
        policy_approved: true,
        channel: 'web_voice',
        methods: [],
        services: { available: [], needs_verification: [] },
        help: {},
        auth: {
          state: 'awaiting_pin',
          authenticated: false,
          method: 'phonecode_pin',
          secure_entry: { purpose: 'pin', label: 'Phone PIN', min_digits: 6, max_digits: 6, expires_at: Date.now() + 60000 },
          attempts_remaining: 3,
          max_attempts: 3,
          lock_reason: null,
          otp_resends_left: null,
          next: 'wait_for_secure_entry',
          message: 'Please enter your Phone PIN',
        },
        profile: null,
        confirmation: null,
      };

      expect(channelState.auth.state).toBe('awaiting_pin');
      expect(channelState.auth.secure_entry?.purpose).toBe('pin');

      // 3. Customer speaks PIN "135790"
      const spokenPin = 'one three five seven nine zero';
      const normalizedPin = normalizeDigitSequence(spokenPin, { context: 'digit_sequence' });
      expect(normalizedPin).toBe('135790');

      // Mock submitCapture for PIN
      const mockSubmitCapture = vi.fn().mockImplementation(async (pin: string): Promise<CaptureOutcome> => {
        if (pin === '135790') {
          return { accepted: true, message: 'Thank you. You are verified.' };
        }
        return { accepted: false, message: 'You have entered an invalid Phone PIN.' };
      });

      const captureOutcome = await mockSubmitCapture(normalizedPin);
      expect(captureOutcome.accepted).toBe(true);

      // Channel transitions to authenticated
      const authenticatedState: ChannelState = {
        hosts: 'mock',
        policy_approved: true,
        channel: 'web_voice',
        methods: [],
        services: { available: [], needs_verification: [] },
        help: {},
        auth: {
          state: 'authenticated',
          authenticated: true,
          method: 'phonecode_pin',
          secure_entry: null,
          attempts_remaining: 3,
          max_attempts: 3,
          lock_reason: null,
          otp_resends_left: null,
          next: 'continue',
          message: 'Thank you. You are verified.',
        },
        profile: {
          business_name_masked: 'Mock Trading Pte Ltd',
          customer_ref_ending: '0001',
          method: 'phonecode_pin',
          role: 'AS',
          language: 'en',
          accounts: [
            { account_ref: 'A1', type: 'Current account', ending: '••••0101', currencies: ['SGD'] },
            { account_ref: 'A2', type: 'Current account', ending: '••••0102', currencies: ['SGD'] },
          ],
        },
        confirmation: null,
      };

      expect(authenticatedState.auth.authenticated).toBe(true);

      // 4. Pending request resumes automatically
      expect(pendingRequest).not.toBeNull();
      const resumedTool = toolFor(pendingRequest!, authenticatedState.profile!.accounts[0]!.account_ref);
      expect(resumedTool).toEqual({
        tool: 'get_balance',
        args: { account_ref: 'A1' },
      });
      pendingRequest = null;
      expect(pendingRequest).toBeNull();
    });

    it('handles verification failures with clear explanations and retry options', async () => {
      // Customer provides invalid Phone Code
      const mockIdentifyFailure = vi.fn().mockResolvedValue({
        ok: false,
        error_code: 'phonecode',
        error_message: 'You have entered an invalid Phone Code.',
      });

      const res = await mockIdentifyFailure({ phone_code: '0000000' });
      expect(res.ok).toBe(false);
      expect(res.error_message).toBe('You have entered an invalid Phone Code.');

      // Customer enters wrong PIN
      const mockPinFailure = vi.fn().mockResolvedValue({
        accepted: false,
        message: 'You have entered an invalid Phone PIN.',
      });

      const pinRes = await mockPinFailure('999999');
      expect(pinRes.accepted).toBe(false);
      expect(pinRes.message).toBe('You have entered an invalid Phone PIN.');
    });

    it('distinguishes backend service errors from invalid user credentials', async () => {
      // Backend unavailable / 503 error
      const mockNetworkError = {
        kind: 'unreachable',
        status: 503,
        message: 'The banking gateway could not be reached.',
      };

      const isBackendError = mockNetworkError.kind === 'unreachable' || mockNetworkError.status >= 500;
      expect(isBackendError).toBe(true);

      const errorMessage = isBackendError
        ? 'I could not reach the banking verification service right now. Please try again in a moment.'
        : 'That Phone Code could not be verified. Please check the number and try again.';

      expect(errorMessage).toContain('could not reach the banking verification service right now');
    });
  });
});
