import type { AuthMethodId, AuthState, ManifestTool, Money } from '../api/gatewayTypes';
import type { ChipTone } from '../components/ui/StatusChip';

/** "SGD 30.00": the gateway sends integer minor units; never a float amount. */
export const formatMoney = (m: Money) => `${m.currency} ${(m.minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Which method a sign-in step belongs to (the agent may have started it by voice, not the screen). */
export const methodOfState = (state: AuthState): AuthMethodId | null =>
  state === 'awaiting_pin' ? 'phonecode_pin' : state === 'awaiting_nric' || state === 'awaiting_otp' ? 'account_nric_otp' : null;

/** What a gateway tool does to the bank, in words, for the tool library and the rehearsal runner. */
export const EFFECT: Record<ManifestTool['effect'], { label: string; tone: ChipTone; help: string }> = {
  read: { label: 'Reads', tone: 'info', help: 'Looks something up. Changes nothing.' },
  prepare: { label: 'Prepares a request', tone: 'warning', help: 'Builds a request and a summary. Nothing reaches the bank until the caller confirms.' },
  commit: { label: 'Carries out', tone: 'danger', help: 'Executes a prepared request after the caller confirmed it.' },
  session: { label: 'Session step', tone: 'neutral', help: 'Moves the conversation along (sign-in, keypad, menu). No banking change.' },
};

export const ACCESS: Record<ManifestTool['access'], string> = {
  public: 'Anyone',
  auth_flow: 'During sign-in',
  authenticated: 'Verified callers',
  entitled: 'Verified and entitled callers',
};
