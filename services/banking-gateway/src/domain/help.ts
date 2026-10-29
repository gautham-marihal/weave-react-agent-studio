import type { Channel } from './types.ts';
import type { Policy } from './policy.ts';

// What the caller's device shows next to each sign-in step: which methods exist, what each needs, and where to get
// help. It is served by the gateway (GET /v1/channel/state) so the screen, the agent and the policy cannot disagree.
//
// Every help entry records where its wording comes from:
//   - 'legacy_deck': prompt text from the 2015 Avaya deck. Unapproved for the new channel until the business owner
//     signs it off (like every value in policy.ts).
//   - 'product':     how this product works (the keypad, why secrets are not spoken). Written for this product; needs
//     the same sign-off as any customer-facing copy.
//   - 'unknown':     the bank's procedure is not known to us. The entry says so and points to a Service Manager
//     instead of inventing a procedure.

export type HelpSource = 'legacy_deck' | 'product' | 'unknown';

export interface HelpEntry {
  readonly id: string;
  readonly question: string;
  /** null when the procedure is unknown; the device then shows `fallback` and the support routes. */
  readonly answer: string | null;
  readonly fallback: string;
  readonly source: HelpSource;
  /** Deck page or design reference, for reviewers. */
  readonly reference: string;
  readonly approved: boolean;
}

const SERVICE_MANAGER = 'Ask the assistant to connect you to a Service Manager, or to arrange a call back.';

export const HELP: Readonly<Record<string, HelpEntry>> = {
  find_phone_code: {
    id: 'find_phone_code',
    question: 'Where do I find my Phone Code?',
    answer: null,
    fallback: `We do not have approved instructions on where your Phone Code is issued. ${SERVICE_MANAGER} You can also sign in with your business account number instead.`,
    source: 'unknown',
    reference: 'Deck p33 asks for the 7-digit Phone Code but does not say where customers get it',
    approved: false,
  },
  find_account_number: {
    id: 'find_account_number',
    question: 'Which account number do I use?',
    answer: 'Use the twelve-digit number of a business current or foreign currency account that you are authorised on.',
    fallback: SERVICE_MANAGER,
    source: 'legacy_deck',
    reference: 'Deck p33 prompt 1172 ("enter your twelve digit Account Number"); p34 account route',
    approved: false,
  },
  nric_digits: {
    id: 'nric_digits',
    question: 'What do I key in for my NRIC?',
    answer: 'Key in only the digits of your NRIC or passport number, leaving out any letters.',
    fallback: SERVICE_MANAGER,
    source: 'legacy_deck',
    reference: 'Deck p34: "Please key the digits of your NRIC or Passport #" (1 to 15 digits)',
    approved: false,
  },
  secure_keypad: {
    id: 'secure_keypad',
    question: 'How does the secure keypad work?',
    answer: 'The keypad sends what you key in straight to the bank\'s verification service. It never appears in the conversation, and the assistant never sees it. Each keypad works once and closes after a short time; ask for a new one if it expires.',
    fallback: SERVICE_MANAGER,
    source: 'product',
    reference: 'WS-BANK-001 §6.2 secure capture',
    approved: false,
  },
  why_not_spoken: {
    id: 'why_not_spoken',
    question: 'Why can\'t I just say my PIN?',
    answer: 'Anything said aloud becomes part of the conversation record. Your PIN, NRIC digits and one-time password are only accepted on the secure keypad, so they never enter a transcript or recording.',
    fallback: SERVICE_MANAGER,
    source: 'product',
    reference: 'WS-BANK-001 decision D3',
    approved: false,
  },
  otp_not_received: {
    id: 'otp_not_received',
    question: 'My one-time password has not arrived',
    answer: 'The code is sent by SMS to the mobile number the bank holds for you. You can ask for it to be sent again a limited number of times during this conversation.',
    fallback: `If it still does not arrive, the number we hold may be out of date. ${SERVICE_MANAGER}`,
    source: 'legacy_deck',
    reference: 'Deck p34 "No Input (OTP#)" loop; resend limit is policy.maxOtpResends (developer default, unapproved)',
    approved: false,
  },
  cannot_verify: {
    id: 'cannot_verify',
    question: 'Why can\'t my account be verified?',
    answer: 'The details did not match the bank\'s records, the account cannot be used on this line, or the number of attempts allowed for this conversation has been used up.',
    fallback: SERVICE_MANAGER,
    source: 'legacy_deck',
    reference: 'Deck p33/p34 host codes 50, 53, 62, 83; invalidContact = Y → Service Manager',
    approved: false,
  },
  forgot_pin: {
    id: 'forgot_pin',
    question: 'I have forgotten my Phone PIN',
    answer: 'You may mail in a request for a new Phone PIN using the Corporate Electronic Services Update Form.',
    fallback: SERVICE_MANAGER,
    source: 'legacy_deck',
    reference: 'Deck p33 lock-out prompt',
    approved: false,
  },
  contact_service_manager: {
    id: 'contact_service_manager',
    question: 'How do I reach a person?',
    answer: 'Ask the assistant for a Service Manager. During service hours it can connect you; outside them it can arrange a call back.',
    fallback: 'The hours and contact numbers for the new channel have not been confirmed. Ask the assistant for a call back.',
    source: 'legacy_deck',
    reference: 'Deck p2 "0 for a Service Manager", p31/p35 service hours, p39 call back',
    approved: false,
  },
};

export type IdentifierField = 'phone_code' | 'account_number';

export interface AuthMethodView {
  readonly id: 'phonecode_pin' | 'account_nric_otp';
  readonly label: string;
  readonly summary: string;
  readonly identifier: {
    readonly field: IdentifierField;
    readonly label: string;
    readonly digits: number;
    /** Policy: may the caller reveal what they typed (eye icon)? Secrets are never revealable. */
    readonly reveal_allowed: boolean;
    readonly help: string;
  };
  /** The secrets keyed on the secure keypad afterwards, in order. */
  readonly secure_steps: ReadonlyArray<{ readonly purpose: 'pin' | 'nric' | 'otp'; readonly label: string; readonly help: string }>;
  readonly available: boolean;
  /** Why the method cannot be used on this channel, in words the caller can act on. */
  readonly unavailable_reason: string | null;
  readonly legacy: string;
}

/**
 * The sign-in methods for a channel. A phone call (SIP) has no screen and the runtime does not collect DTMF yet
 * (open decision O2), so no secret can be entered safely: both methods are listed as unavailable with the reason.
 */
export function authMethods(channel: Channel, policy: Policy): AuthMethodView[] {
  const noKeypad = channel === 'sip_voice' ? 'Secure entry is not available on a phone call yet. A Service Manager can help, or use the website or app.' : null;
  return [
    {
      id: 'phonecode_pin',
      label: 'Phone Code and Phone PIN',
      summary: 'For customers registered for phone banking. You need your 7-digit Phone Code and your 6-digit Phone PIN.',
      identifier: { field: 'phone_code', label: 'Phone Code', digits: 7, reveal_allowed: policy.channel.revealableIdentifiers.includes('phone_code'), help: 'find_phone_code' },
      secure_steps: [{ purpose: 'pin', label: '6-digit Phone PIN', help: 'forgot_pin' }],
      available: noKeypad === null,
      unavailable_reason: noKeypad,
      legacy: 'Deck p33 "P + T" route; host codes 50/53/62/83',
    },
    {
      id: 'account_nric_otp',
      label: 'Business account, NRIC and SMS code',
      summary: 'For authorised signatories and contacts. You need a 12-digit business account number, your NRIC or passport digits, and your mobile phone to receive a one-time password.',
      identifier: { field: 'account_number', label: 'Business account number', digits: 12, reveal_allowed: policy.channel.revealableIdentifiers.includes('account_number'), help: 'find_account_number' },
      secure_steps: [
        { purpose: 'nric', label: 'NRIC or passport digits', help: 'nric_digits' },
        { purpose: 'otp', label: '6-digit one-time password from the SMS', help: 'otp_not_received' },
      ],
      available: noKeypad === null,
      unavailable_reason: noKeypad,
      legacy: 'Deck p33/p34 "A + I" route with SMS OTP',
    },
  ];
}
