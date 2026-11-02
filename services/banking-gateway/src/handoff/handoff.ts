import type { AuthMethod, Channel, Language } from '../domain/types.ts';
import type { SessionState } from '../fsm/session-machine.ts';

// Handing a conversation to another assistant (the Voice AI Banking Assistant) or a human team, as an explicit
// boundary. WS-BANK-001 §11 escalation order: self-service → retry → agent-assisted route → other assistant → people.
//
// Status: CONTRACT ONLY. The Voice AI Banking Assistant (krishn-shetty/voice-ai-banking-assistant) has no API that
// accepts a conversation from another runtime: its escalate_to_human marks its own call record as escalated. Until
// it (or the contact-centre platform) exposes one, the gateway uses NO_HANDOFF, which always says "not configured",
// and the agent falls back to prepare_agent_transfer / request_callback. Nothing here pretends a transfer happened.
//
// What may cross the boundary is decided here, from server state, not by the model: the caller's stated need, what
// has been completed, whether they are verified and how, an opaque account reference, and the last safe error code.
// Never: PINs, OTPs, NRIC digits, capture tokens, full account numbers, the customer's name or the transcript.

export interface HandoffContext {
  readonly intent: string;
  readonly completed_steps: readonly ('verified' | 'account_selected' | 'request_prepared')[];
  readonly authenticated: boolean;
  readonly method: AuthMethod | null;
  readonly account_ref: string | null;
  readonly last_error_code: string | null;
  readonly channel: Channel;
  readonly language: Language;
}

export type HandoffResult =
  | { readonly accepted: true; readonly reference: string }
  | { readonly accepted: false; readonly reason: 'not_configured' | 'unavailable' | 'refused' };

export interface AssistantHandoffPort {
  /** Resolves `accepted: true` only once the target has taken the conversation; the caller is told nothing before. */
  handOff(target: 'voice_ai_banking_assistant' | 'human_team', context: HandoffContext, signal: AbortSignal): Promise<HandoffResult>;
}

/** The honest default until a target exists. */
export const NO_HANDOFF: AssistantHandoffPort = {
  async handOff() {
    return { accepted: false, reason: 'not_configured' };
  },
};

const ERROR_CODE = /^[a-z0-9_:]{1,40}$/;

/**
 * The context another assistant may receive. `intent` is the caller's need in a few words, as the model summarised
 * it; it is free text, so long digit runs (a PIN, OTP, NRIC or account number said aloud) are removed and it is cut
 * to 160 characters. The account reference is passed only if it belongs to this verified caller.
 */
export function buildHandoffContext(session: SessionState, input: { intent: string; accountRef?: string | null; lastErrorCode?: string | null }): HandoffContext {
  const auth = session.auth;
  const authenticated = auth.kind === 'authenticated';
  const accountRef = authenticated && input.accountRef && input.accountRef in session.accountRefs ? input.accountRef : null;
  const intent = input.intent
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\d[\d\s-]{3,}\d/g, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const steps: HandoffContext['completed_steps'][number][] = [];
  if (authenticated) steps.push('verified');
  if (accountRef) steps.push('account_selected');
  if (session.txn.kind === 'pending') steps.push('request_prepared');
  return {
    intent: intent || 'Not stated',
    completed_steps: steps,
    authenticated,
    method: authenticated ? auth.method : null,
    account_ref: accountRef,
    last_error_code: input.lastErrorCode && ERROR_CODE.test(input.lastErrorCode) ? input.lastErrorCode : null,
    channel: session.channel,
    language: session.language,
  };
}
