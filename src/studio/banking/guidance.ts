// What to tell a banking customer, and what they can do next, for every state the gateway can report. One typed
// mapping instead of error strings scattered through the UI.
//
// Rules:
//   - the facts (attempts left, lock reason, error code) come from the gateway; nothing here guesses them;
//   - texts the gateway already wrote for the caller (deck wording, host matrix) are shown as written;
//   - no stack trace, host payload, policy detail or identifier is ever shown;
//   - an action is offered only if the screen hosting it can actually do it (`can`), so no button is a dead end.

import type { GatewayErrorKind } from '../../api/gateway.ts';
import type { AuthView, ConfirmationOutcome, ToolResponse } from '../../api/gatewayTypes.ts';

export type GuidanceActionId =
  | 'choose_method' // back to the sign-in method cards
  | 'new_keypad' // reissue the secure keypad
  | 'resend_otp'
  | 'use_other_method' // restart sign-in with the other method
  | 'ask_for_person' // ask the assistant for a Service Manager (real transfer through the runtime)
  | 'request_callback'
  | 'reconnect'
  | 'show_help';

export interface GuidanceAction {
  readonly id: GuidanceActionId;
  readonly label: string;
  /** For show_help: which help entry (gateway HELP id). */
  readonly helpId?: string;
}

export interface Guidance {
  readonly tone: 'info' | 'success' | 'warning' | 'danger';
  readonly title: string;
  readonly body: string;
  readonly actions: readonly GuidanceAction[];
  /** How a screen reader announces it: errors interrupt, everything else waits. */
  readonly announce: 'polite' | 'assertive';
}

export type Situation =
  | { readonly kind: 'gateway'; readonly error: GatewayErrorKind }
  | { readonly kind: 'auth'; readonly auth: AuthView }
  | { readonly kind: 'capture_failed'; readonly message: string; readonly auth: AuthView }
  | { readonly kind: 'tool'; readonly response: ToolResponse }
  | { readonly kind: 'confirmation'; readonly outcome: ConfirmationOutcome | 'processing'; readonly message?: string }
  | { readonly kind: 'needs_person' };

const A = {
  chooseMethod: { id: 'choose_method', label: 'Choose a sign-in method' },
  newKeypad: { id: 'new_keypad', label: 'Open a new keypad' },
  resendOtp: { id: 'resend_otp', label: 'Send the code again' },
  otherMethod: { id: 'use_other_method', label: 'Use a different Phone Code or account' },
  person: { id: 'ask_for_person', label: 'Speak to a Service Manager' },
  callback: { id: 'request_callback', label: 'Ask for a call back' },
  reconnect: { id: 'reconnect', label: 'Try again' },
  help: (helpId: string, label: string): GuidanceAction => ({ id: 'show_help', label, helpId }),
} as const satisfies Record<string, GuidanceAction | ((...a: string[]) => GuidanceAction)>;

const attempts = (n: number) => `You have ${n} attempt${n === 1 ? '' : 's'} left in this conversation.`;

function raw(situation: Situation): Omit<Guidance, 'announce'> & { announce?: Guidance['announce'] } {
  switch (situation.kind) {
    case 'gateway':
      switch (situation.error) {
        case 'not_configured':
          return {
            tone: 'warning',
            title: 'Banking services are not set up here',
            body: 'This Studio has no banking gateway configured, so sign-in and account services cannot run.',
            actions: [],
          };
        case 'unreachable':
          return {
            tone: 'danger',
            title: 'Banking services are unavailable',
            body: 'We cannot reach the banking service right now. Nothing has been sent and no result is shown until it answers.',
            actions: [A.reconnect, A.person],
          };
        case 'unauthorised':
          return {
            tone: 'danger',
            title: 'Secure entry is not connected to this conversation',
            body: "The banking service did not accept this conversation's credentials, so the keypad and confirmations cannot be used here.",
            actions: [A.person],
          };
        case 'not_found':
          return {
            tone: 'warning',
            title: 'This conversation is not connected to banking services',
            body: 'The banking service has no session for this conversation. Account services and secure entry are not available.',
            actions: [A.person],
          };
        case 'rate_limited':
          return { tone: 'warning', title: 'Too many attempts', body: 'Please wait a minute before trying again.', actions: [A.person] };
        default:
          return {
            tone: 'danger',
            title: 'Something went wrong',
            body: 'The banking service could not complete that request. Nothing has changed.',
            actions: [A.reconnect, A.person],
          };
      }

    case 'auth': {
      const { auth } = situation;
      switch (auth.state) {
        case 'not_started':
          return {
            tone: 'info',
            title: 'Verify your identity to use account services',
            body: 'Rates, branches and general questions work without signing in. Balances, cheques and requests need verification first.',
            actions: [A.chooseMethod, A.help('contact_service_manager', "I can't sign in")],
          };
        case 'awaiting_pin':
          return {
            tone: 'info',
            title: 'Enter your Phone PIN',
            body: `Use the secure keypad. Never say your PIN aloud. ${attempts(auth.attempts_remaining)}`,
            actions: [auth.secure_entry ? A.help('forgot_pin', 'I have forgotten my PIN') : A.newKeypad, A.otherMethod],
          };
        case 'awaiting_nric':
          return {
            tone: 'info',
            title: 'Enter your NRIC or passport digits',
            body: `Use the secure keypad; digits only. ${attempts(auth.attempts_remaining)}`,
            actions: [auth.secure_entry ? A.help('nric_digits', 'Which digits?') : A.newKeypad, A.otherMethod],
          };
        case 'awaiting_otp':
          return {
            tone: 'info',
            title: 'Enter the one-time password',
            body: `We sent it by SMS to the mobile number the bank holds for you. ${attempts(auth.attempts_remaining)}`,
            actions: [
              ...(auth.secure_entry ? [] : [A.newKeypad]),
              ...(auth.otp_resends_left ? [A.resendOtp] : []),
              A.help('otp_not_received', 'The code has not arrived'),
              A.person,
            ],
          };
        case 'authenticated':
          return { tone: 'success', title: 'You are verified', body: 'You can now ask about your accounts and cheques.', actions: [] };
        case 'locked':
          return locked(auth);
      }
      break;
    }

    case 'capture_failed': {
      const { auth, message } = situation;
      if (auth.state === 'locked') return locked(auth, message);
      // The gateway's message already says what was wrong ("invalid Phone PIN… 2 attempts left").
      return {
        tone: 'warning',
        title: 'That was not accepted',
        body: message,
        actions: auth.state === 'not_started' ? [A.chooseMethod, A.person] : [A.person],
        announce: 'assertive',
      };
    }

    case 'tool':
      return fromTool(situation.response);

    case 'confirmation':
      switch (situation.outcome) {
        case 'processing':
          return { tone: 'info', title: 'Processing your request', body: 'Please wait. Do not repeat the request while it is being processed.', actions: [] };
        case 'confirmed':
          return { tone: 'success', title: 'Request completed', body: situation.message ?? 'The bank has confirmed your request.', actions: [] };
        case 'cancelled':
          return { tone: 'info', title: 'Request cancelled', body: 'Nothing was sent to the bank.', actions: [] };
        case 'expired':
          return {
            tone: 'warning',
            title: 'This request is no longer waiting',
            body: situation.message ?? 'It expired before it was confirmed, so nothing was sent. Ask for it again if you still need it.',
            actions: [],
          };
        case 'failed':
          return {
            tone: 'danger',
            title: 'Request not completed',
            body: situation.message ?? 'The bank did not complete this request.',
            actions: [A.person],
            announce: 'assertive',
          };
        case 'unknown':
          return {
            tone: 'danger',
            title: 'We could not confirm the outcome',
            body: situation.message ?? 'The bank did not answer in time, so the request may or may not have gone through. Please do not repeat it.',
            actions: [A.person],
            announce: 'assertive',
          };
      }
      break;

    case 'needs_person':
      return {
        tone: 'info',
        title: 'Speak to a person',
        body: 'A Service Manager can take over. Outside service hours you can ask for a call back instead.',
        actions: [A.person, A.callback, A.help('contact_service_manager', 'Service hours')],
      };
  }
  return { tone: 'danger', title: 'Something went wrong', body: 'Please try again or ask for a Service Manager.', actions: [A.person] };
}

function locked(auth: AuthView, message?: string): Omit<Guidance, 'announce'> & { announce: Guidance['announce'] } {
  // The gateway's lock message carries the deck's wording (e.g. the PIN-reset form, "visit your nearest branch").
  const body = message ?? auth.message;
  if (auth.lock_reason === 'personal_customer')
    return { tone: 'warning', title: 'This service is for business customers', body, actions: [], announce: 'assertive' };
  if (auth.lock_reason === 'dormant_account')
    return { tone: 'warning', title: 'This account cannot be used here', body, actions: [A.person], announce: 'assertive' };
  return {
    tone: 'danger',
    title: 'Sign-in is locked for this conversation',
    body,
    actions: [A.person, A.callback, A.help('forgot_pin', 'How to get a new PIN')],
    announce: 'assertive',
  };
}

function fromTool(response: ToolResponse): Omit<Guidance, 'announce'> & { announce?: Guidance['announce'] } {
  if (response.ok)
    return { tone: 'success', title: 'Done', body: typeof response.message === 'string' ? response.message : 'The request was completed.', actions: [] };
  const message = response.error_message ?? 'The request could not be completed.';
  switch (response.error_code) {
    case 'not_authenticated':
      return { tone: 'info', title: 'Please verify your identity first', body: 'This service needs you to sign in.', actions: [A.chooseMethod] };
    case 'not_entitled':
      return {
        tone: 'warning',
        title: 'Not available for your access',
        body: 'This service is not available with your current access. A Service Manager can help.',
        actions: [A.person],
      };
    case 'no_eligible_account':
      return {
        tone: 'warning',
        title: 'No account can use this service',
        body: 'None of your accounts can use this service here. A Service Manager can help.',
        actions: [A.person],
      };
    case 'locked':
      return { tone: 'danger', title: 'Sign-in is locked for this conversation', body: message, actions: [A.person, A.callback] };
    case 'resend_limit':
    case 'otp_suspended':
      return { tone: 'warning', title: 'The code cannot be sent again', body: message, actions: [A.person] };
    case 'invalid_arguments':
      return { tone: 'warning', title: 'Please check what you entered', body: message, actions: [] };
    case 'timeout':
      return {
        tone: 'danger',
        title: 'The bank did not answer in time',
        body: 'Nothing is shown because no answer came back. You can try again, or speak to a Service Manager.',
        actions: [A.reconnect, A.person],
      };
    case 'outcome_unknown':
      return { tone: 'danger', title: 'We could not confirm the outcome', body: message, actions: [A.person], announce: 'assertive' };
    case 'too_many_requests':
      return { tone: 'warning', title: 'This conversation has reached its limit', body: 'Please speak to a Service Manager to continue.', actions: [A.person] };
    default:
      // Host matrix codes (as400:196 …) and other declined outcomes: the gateway's message is already safe to show.
      return {
        tone: 'warning',
        title: 'The request was not completed',
        body: message,
        actions: response.next === 'offer_transfer' ? [A.person] : response.next === 'offer_callback' ? [A.callback] : [],
      };
  }
}

/** Which situation the caller is in, most urgent first: no gateway, a refused entry, a refused action, sign-in. */
export function currentSituation(channel: {
  error: { kind: GatewayErrorKind } | null;
  feedback: { accepted: boolean; message: string; auth: AuthView | null } | null;
  refusal: ToolResponse | null;
  state: { auth: AuthView } | null;
}): Situation | null {
  if (channel.error) return { kind: 'gateway', error: channel.error.kind };
  if (channel.feedback && !channel.feedback.accepted && channel.feedback.auth)
    return { kind: 'capture_failed', message: channel.feedback.message, auth: channel.feedback.auth };
  if (channel.refusal) return { kind: 'tool', response: channel.refusal };
  if (channel.state && !channel.state.auth.authenticated) return { kind: 'auth', auth: channel.state.auth };
  return null;
}

/** Guidance for a situation, keeping only the actions this screen can perform. */
export function guidanceFor(situation: Situation, can: ReadonlySet<GuidanceActionId>): Guidance {
  const g = raw(situation);
  const announce = g.announce ?? (g.tone === 'danger' ? 'assertive' : 'polite');
  return { ...g, announce, actions: g.actions.filter((a) => can.has(a.id)) };
}
