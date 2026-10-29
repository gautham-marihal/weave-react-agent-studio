import type { NextStep } from '../tools/define.ts';
import type { HostError } from '../ports/ports.ts';

// The deck's "Response Matrix" boxes: every host response code maps to something safe to tell the caller and a
// deterministic next step. Raw host messages never reach the model. Unknown codes fall back to prompt 1189
// ("Sorry, we are unable to process your request") with an offer to speak to a Service Manager (deck p40).

export interface MatrixEntry {
  readonly code: string;
  readonly message: string;
  readonly next: NextStep;
  readonly retryable: boolean;
  /** Legacy prompt id, so a recorded prompt can be played instead of synthesised text. */
  readonly prompt: string;
}

const MATRIX: Readonly<Record<string, Omit<MatrixEntry, 'code'>>> = {
  'as400:33': { message: 'Rates for this option are currently unavailable.', next: 'offer_transfer', retryable: false, prompt: '1119' },
  'as400:90': { message: 'No cheque book has been issued for this account.', next: 'continue', retryable: false, prompt: '1061' },
  'as400:192': { message: 'Some or all of these cheques have already been stopped.', next: 'continue', retryable: false, prompt: '1205a' },
  'as400:196': { message: 'Some or all of these cheques have already been presented or cleared, so they cannot be stopped.', next: 'continue', retryable: false, prompt: '1205' },
  'as400:343': { message: 'The cheque range is invalid. It must be fewer than 50 cheques within the same cheque book.', next: 'ask_again', retryable: false, prompt: '1081' },
  'otp:locked': { message: 'The one-time password feature has been suspended for this customer.', next: 'offer_transfer', retryable: false, prompt: 'OTP-LOCK' },
};

const FALLBACK: Omit<MatrixEntry, 'code'> = {
  message: 'Sorry, we are unable to process your request right now.',
  next: 'offer_transfer',
  retryable: true,
  prompt: '1189',
};

export function lookupHostError(error: HostError): MatrixEntry {
  const key = `${error.system}:${error.code}`;
  return { code: key, ...(MATRIX[key] ?? FALLBACK) };
}

export const TIMEOUT_ENTRY: MatrixEntry = { code: 'timeout', ...FALLBACK, message: 'The banking system took too long to answer.' };
/**
 * A confirmed write whose host call did not answer in time. It may have run. Saying "failed" would invite a repeat
 * (a second stop-payment, a second cheque book); saying "done" would be a guess. A Service Manager can check.
 */
export const OUTCOME_UNKNOWN_ENTRY: MatrixEntry = {
  code: 'outcome_unknown',
  message: 'We could not confirm whether your request went through. Please do not repeat it; a Service Manager can check its status for you.',
  next: 'offer_transfer',
  retryable: false,
  prompt: '1189',
};
export const INTERNAL_ENTRY: MatrixEntry = { code: 'internal', ...FALLBACK, retryable: false };
