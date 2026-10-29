import type { AuthMethodId, AuthState, ManifestTool, Money } from '../../api/gatewayTypes.ts';
import type { Tone } from './ui.tsx';

// Words and formats for what the banking gateway sends. Pure.

/** "SGD 30.00": the gateway sends integer minor units; never a float amount. */
export const formatMoney = (m: Money) => `${m.currency} ${(m.minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Which method a sign-in step belongs to (the agent may have started it in the conversation, not on the screen). */
export const methodOfState = (state: AuthState): AuthMethodId | null =>
  state === 'awaiting_pin' ? 'phonecode_pin' : state === 'awaiting_nric' || state === 'awaiting_otp' ? 'account_nric_otp' : null;

/** What a gateway tool does to the bank, in words. */
export const EFFECT: Record<ManifestTool['effect'], { label: string; tone: Tone; help: string }> = {
  read: { label: 'Reads', tone: 'neutral', help: 'Looks something up. Changes nothing.' },
  prepare: { label: 'Prepares a request', tone: 'warning', help: 'Builds a request and a summary. Nothing reaches the bank until the caller confirms.' },
  commit: { label: 'Carries out', tone: 'danger', help: 'Executes a prepared request after the caller confirmed it.' },
  session: { label: 'Session step', tone: 'neutral', help: 'Moves the conversation along (sign-in, keypad, menu). No banking change.' },
};

/** Who may use a gateway tool. */
export const ACCESS: Record<ManifestTool['access'], string> = {
  public: 'Anyone',
  auth_flow: 'During sign-in',
  authenticated: 'Verified callers',
  entitled: 'Verified and entitled callers',
};
