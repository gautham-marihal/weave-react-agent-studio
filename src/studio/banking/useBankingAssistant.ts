import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gateway, GatewayError } from '../../api/gateway.ts';
import type { AccountView, CaptureOutcome, ToolResponse } from '../../api/gatewayTypes.ts';
import { extractIdentifier, maskIdentifier, normalizeDigitSequence } from './digits.ts';
import type { BankingChannel } from './useBankingChannel.ts';
import {
  askFor,
  CAPABILITIES,
  confirmationIntent,
  describeRefusal,
  describeSuccess,
  greeting,
  missingSlot,
  NEEDS_VERIFICATION,
  pickAccount,
  pickCurrency,
  pickDelivery,
  pickPeriod,
  DEFAULT_BANK,
  secureEntryPrompt,
  toolFor,
  TOPIC_LABEL,
  understand,
  type BalanceSnapshot,
  type BankingRequest,
  type Card,
  type ChoicePurpose,
  type Delivery,
  type Missing,
  type Period,
} from './assistantModel.ts';
import type { RunEvent } from './scenarios.ts';

// The banking assistant for a rehearsal: one conversation, typed or spoken, driving the real gateway session. It
// runs gateway tools the way the agent runtime would (through the rehearsal tool route) and follows the session's
// channel stream for sign-in, keypads and confirmations, so the transcript and the banking panel always agree.
//
// What it never keeps: PIN, NRIC or OTP digits. They go from the input straight to the gateway's secure capture and
// the transcript records only that something was entered. Identifiers (Phone Code, account number) are masked.

export type Via = 'voice' | 'chat' | 'screen';

export interface ChatMessage {
  readonly id: number;
  readonly role: 'assistant' | 'customer';
  readonly text: string;
  readonly card?: Card;
  readonly via?: Via;
  readonly at: number;
  /** A customer message whose content was withheld (secure entry). */
  readonly secure?: boolean;
  /** For a reply with choices: the option the customer chose (the choices are then settled, and closed). */
  readonly answered?: string;
}

/** Why the assistant ended the conversation: the caller said goodbye, or was handed to a Service Manager. */
export type EndReason = 'goodbye' | 'transferred';

type Awaiting =
  | { kind: 'none' }
  | { kind: 'method' }
  | { kind: 'identifier'; field: 'phone_code' | 'account_number' }
  | { kind: 'slot'; missing: Missing }
  | { kind: 'choice'; purpose: 'account'; accounts: AccountView[] }
  | { kind: 'choice'; purpose: 'currency'; currencies: string[] }
  | { kind: 'choice'; purpose: 'delivery'; options: Delivery[] }
  | { kind: 'confirm'; confirmationId: string }
  | { kind: 'callback_offer' };

const SECURE_PURPOSES = new Set(['pin', 'nric', 'otp', 'current_pin', 'new_pin', 'confirm_new_pin']);
const SECURE_LABEL: Record<string, string> = {
  pin: 'Phone PIN',
  nric: 'NRIC digits',
  otp: 'one-time password',
  current_pin: 'current Phone PIN',
  new_pin: 'new Phone PIN',
  confirm_new_pin: 'new Phone PIN again',
};

export interface BankingAssistant {
  readonly messages: ChatMessage[];
  readonly thinking: boolean;
  /** The gateway tool running right now (get_balance, find_branch…), while `thinking`. */
  readonly activeTool: string | null;
  /** The secure-entry step in progress (pin, nric, otp…), when the next input must be secret. */
  readonly secureStep: string | null;
  /** The identifier the assistant is waiting for, when any. */
  readonly identifierStep: 'phone_code' | 'account_number' | null;
  /** True from a click on a choice until the work it started is done: a second submission is ignored meanwhile. */
  readonly busy: boolean;
  readonly selectedAccount: string | null;
  readonly balances: Record<string, BalanceSnapshot>;
  /** Spoken PIN/NRIC/OTP digits are accepted (rehearsal setting). */
  readonly spokenSecrets: boolean;
  setSpokenSecrets: (on: boolean) => void;
  greet: () => Promise<void>;
  /** Something the customer typed or said. */
  handle: (text: string, via: Via) => void;
  /** A choice the customer clicked in the transcript (`messageId`: the reply it belongs to; each is answered once). */
  choose: (purpose: ChoicePurpose, id: string, label: string, messageId?: number) => void;
  /** An account card was clicked: use it for what is pending, or show its balance. */
  selectAccount: (account: AccountView) => void;
  /** Show a balance in another currency of a multi-currency account. */
  balanceIn: (accountRef: string, currency: string) => void;
  /** The keypad on the banking panel was used. */
  submitFromKeypad: (value: string) => Promise<CaptureOutcome | null>;
  record: (event: RunEvent) => void;
}

export function useBankingAssistant({
  callId,
  channel,
  voiceActive,
  onSay,
  onEvent,
  bankName,
  onEnd,
}: {
  callId: string | null;
  channel: BankingChannel;
  voiceActive: boolean;
  /** Every assistant reply, for the voice to speak. */
  onSay: (text: string) => void;
  /** What the gateway did, for the scenario checks. */
  onEvent: (event: RunEvent) => void;
  /** The bank it speaks for (Build → Banking → Banking name). */
  bankName?: string;
  /** The conversation is over (goodbye, or handed to a Service Manager): the host ends it, after the last reply. */
  onEnd?: (reason: EndReason) => void;
}): BankingAssistant {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, BalanceSnapshot>>({});
  // On by default, as in Weave Studio: while a PIN, NRIC or OTP step is open the composer becomes a masked secure
  // field (and spoken digits show as dots); either way the digits go straight to the gateway's secure capture. The
  // rehearsal's "PIN and OTP entry" setting turns it off (keypad only).
  const [spokenSecrets, setSpokenSecrets] = useState(true);
  const [awaitingView, setAwaitingView] = useState<Awaiting>({ kind: 'none' });

  const idRef = useRef(0);
  const callRef = useRef(callId);
  callRef.current = callId;
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const onSayRef = useRef(onSay);
  onSayRef.current = onSay;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const voiceRef = useRef(voiceActive);
  voiceRef.current = voiceActive;
  const spokenRef = useRef(spokenSecrets);
  spokenRef.current = spokenSecrets;
  const bankRef = useRef(bankName || DEFAULT_BANK);
  bankRef.current = bankName || DEFAULT_BANK;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  // Work started from the screen (a choice, an account, a currency) and not finished yet: read synchronously, so a
  // second click before the next render is ignored. The replies a choice has settled, so each is answered once.
  const busyRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const answeredRef = useRef(new Set<number>());

  // Conversation control state, read by handlers that run after awaits.
  const ctl = useRef<{
    awaiting: Awaiting;
    pending: BankingRequest | null;
    selected: string | null;
    lastPrompted: string | null;
    paged: { request: BankingRequest; tool: string; args: Record<string, unknown>; page: number } | null;
  }>({
    awaiting: { kind: 'none' },
    pending: null,
    selected: null,
    lastPrompted: null,
    paged: null,
  });
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setAwaiting = (a: Awaiting) => {
    ctl.current.awaiting = a;
    setAwaitingView(a);
  };
  const setSelected = (ref: string | null) => {
    ctl.current.selected = ref;
    setSelectedAccount(ref);
  };

  const record = useCallback((event: RunEvent) => onEventRef.current(event), []);

  const push = useCallback((m: Omit<ChatMessage, 'id' | 'at'>) => {
    idRef.current += 1;
    const message = { ...m, id: idRef.current, at: Date.now() };
    setMessages((prev) => [...prev, message]);
    return message;
  }, []);

  const say = useCallback(
    (text: string, card?: Card) => {
      push({ role: 'assistant', text, card });
      onSayRef.current(text);
    },
    [push],
  );

  const auth = () => channelRef.current.state?.auth ?? null;
  const secureStepNow = () => {
    const ch = channelRef.current;
    const purpose = ch.keypad?.purpose ?? ch.state?.auth.secure_entry?.purpose ?? null;
    return purpose && SECURE_PURPOSES.has(purpose) ? purpose : null;
  };

  /**
   * Runs a gateway tool for this conversation and records the outcome. An answer that arrives after the conversation
   * ended or another started is dropped (null), so a stale reply never lands in a newer conversation.
   */
  const runTool = useCallback(
    async (tool: string, args: Record<string, unknown>): Promise<ToolResponse | null> => {
      const id = callRef.current;
      if (!id) return null;
      setThinking(true);
      setActiveTool(tool);
      try {
        const response = await gateway.rehearsal.runTool(id, tool, args);
        if (callRef.current !== id) return null;
        record({ type: 'tool', tool, ok: response.ok, code: response.ok ? undefined : response.error_code, account: typeof args.account_ref === 'string' });
        return response;
      } catch (e) {
        if (callRef.current !== id) return null;
        const err = e instanceof GatewayError ? e : new GatewayError(0, 'server', 'The banking gateway had a problem with this request.');
        if (err.kind === 'unreachable' || err.kind === 'not_configured') record({ type: 'gateway_unreachable' });
        say(`I couldn't reach the banking service just now. ${err.message} Please try again in a moment.`, {
          kind: 'notice',
          tone: 'danger',
          title: 'Banking service unavailable',
          text: err.message,
        });
        return null;
      } finally {
        setThinking(false);
        setActiveTool(null);
      }
    },
    [record, say],
  );

  const askVerification = useCallback(
    (request: BankingRequest | null) => {
      const a = auth();
      if (a?.state === 'locked') {
        say(a.message, { kind: 'notice', tone: 'danger', title: 'Sign-in is locked', text: a.message });
        return;
      }
      ctl.current.pending = request;
      const step = secureStepNow();
      if (step) {
        say(secureEntryPrompt(step, spokenRef.current && voiceRef.current));
        return;
      }
      const lead = request ? `I can help you ${TOPIC_LABEL[request.topic]}. Let's verify your identity first.` : "Sure, let's verify your identity.";
      say(`${lead} Would you like to use your Phone Code and PIN, or your business account number with your NRIC and a one-time password?`, {
        kind: 'choices',
        purpose: 'method',
        options: [
          { id: 'phonecode_pin', label: 'Phone Code and PIN', hint: '7-digit Phone Code, then your 6-digit Phone PIN' },
          { id: 'account_nric_otp', label: 'Account number, NRIC and OTP', hint: '12-digit account number, NRIC digits, then an SMS code' },
        ],
      });
      setAwaiting({ kind: 'method' });
    },
    [say],
  );

  const run = useCallback(
    async (request: BankingRequest, accountOverride?: string | null, page?: number): Promise<void> => {
      switch (request.topic) {
        case 'greeting':
          return say(`Hello! ${CAPABILITIES}`);
        case 'thanks':
          return say("You're welcome. Is there anything else I can help you with?");
        case 'goodbye':
          // the caller is done: say goodbye, then the conversation ends (no further replies)
          say(`Thank you for banking with ${bankRef.current}. Goodbye.`);
          onEndRef.current?.('goodbye');
          return;
        case 'sign_in':
          if (auth()?.authenticated) return say("You're already verified. What would you like to do?");
          return askVerification(null);
        case 'sign_out':
          if (!auth()?.authenticated && auth()?.state === 'not_started') return say("You're not signed in.");
          await channelRef.current.restart();
          return;
        default:
          break;
      }
      const a = auth();
      if (NEEDS_VERIFICATION.has(request.topic) && !a?.authenticated) return askVerification(request);

      const missing = missingSlot(request);
      if (missing) {
        ctl.current.pending = request;
        setAwaiting({ kind: 'slot', missing });
        const ask = askFor(missing);
        return say(ask.text, ask.card);
      }

      const accounts = channelRef.current.state?.profile?.accounts ?? [];
      const named = pickAccount(request.words, accounts);
      const accountRef = accountOverride ?? named?.account_ref ?? ctl.current.selected;
      const call = toolFor(
        request,
        NEEDS_VERIFICATION.has(request.topic) && request.topic !== 'accounts' && request.topic !== 'pin_change' ? accountRef : null,
      );
      if (!call) return say(CAPABILITIES);
      const args = page ? { ...call.args, page } : call.args;
      const response = await runTool(call.tool, args);
      if (!response) return;

      if (response.ok) {
        ctl.current.pending = null;
        setAwaiting({ kind: 'none' });
        const reply = describeSuccess(call.tool, response, Date.now());
        if (reply.card?.kind === 'balance') {
          const b = reply.card.balance;
          if (b.accountRef) {
            setSelected(b.accountRef);
            setBalances((prev) => ({ ...prev, [b.accountRef as string]: b }));
          }
        } else if (typeof args.account_ref === 'string') setSelected(args.account_ref);
        ctl.current.paged =
          response.has_more === true ? { request, tool: call.tool, args: call.args, page: typeof response.page === 'number' ? response.page : 1 } : null;
        if (typeof response.confirmation_id === 'string') setAwaiting({ kind: 'confirm', confirmationId: response.confirmation_id });
        if (call.tool === 'start_pin_change') ctl.current.lastPrompted = 'current_pin';
        if (call.tool === 'prepare_agent_transfer' && response.within_hours === false) setAwaiting({ kind: 'callback_offer' });
        say(reply.text, reply.card);
        // the gateway hands the caller to a person now (agent transfer, lost card): this conversation is over
        if (response.next === 'transfer_now') onEndRef.current?.('transferred');
        return;
      }

      switch (response.error_code) {
        case 'not_authenticated':
          return askVerification(request);
        case 'choose_account':
        case 'account_not_eligible':
          ctl.current.pending = request;
          setAwaiting({ kind: 'choice', purpose: 'account', accounts: (response.accounts as AccountView[] | undefined) ?? [] });
          break;
        case 'choose_currency':
        case 'currency_not_held':
          ctl.current.pending = { ...request, currency: undefined };
          if (typeof args.account_ref === 'string') setSelected(args.account_ref);
          setAwaiting({ kind: 'choice', purpose: 'currency', currencies: (response.currencies as string[] | undefined) ?? [] });
          break;
        case 'choose_delivery':
          ctl.current.pending = { ...request, delivery: undefined };
          setAwaiting({ kind: 'choice', purpose: 'delivery', options: (response.options as Delivery[] | undefined) ?? [] });
          break;
        case 'need_number':
          ctl.current.pending = request;
          setAwaiting({ kind: 'slot', missing: 'phone' });
          return say(askFor('phone').text);
        default:
          ctl.current.pending = null;
          setAwaiting({ kind: 'none' });
      }
      const reply = describeRefusal(response);
      return say(reply.text, reply.card);
    },
    [askVerification, runTool, say],
  );

  /** Resumes the pending request with what the customer just supplied. */
  const resume = useCallback(
    (patch: Partial<BankingRequest>, accountRef?: string) => {
      const pending = ctl.current.pending;
      setAwaiting({ kind: 'none' });
      if (!pending) return Promise.resolve();
      return run({ ...pending, ...patch }, accountRef);
    },
    [run],
  );

  const submitSecret = useCallback(
    async (digits: string, via: 'voice' | 'chat'): Promise<CaptureOutcome | null> => {
      const ch = channelRef.current;
      const purpose = secureStepNow();
      if (!purpose) return null;
      // The keypad's one-time token may not have reached this screen yet (opened before it connected).
      if (!ch.keypad) await ch.newKeypad();
      const outcome = await channelRef.current.submitCapture(digits);
      if (outcome) record({ type: 'capture', purpose, accepted: outcome.accepted, via });
      return outcome;
    },
    [record],
  );

  const process = useCallback(
    async (text: string, via: Via) => {
      const a = auth();
      const awaiting = ctl.current.awaiting;
      const request = understand(text);

      // 1. A secure step is open: digits go to the gateway's secure capture, never to the transcript.
      const step = secureStepNow();
      if (step) {
        const digits = normalizeDigitSequence(text, { context: 'digit_sequence' });
        if (digits.length >= 4) {
          if (!spokenRef.current)
            return say(`For your security, please key in your ${SECURE_LABEL[step] ?? 'code'} on the secure keypad. Nothing you typed or said was sent.`);
          const outcome = await submitSecret(digits, via === 'voice' ? 'voice' : 'chat');
          if (outcome && !outcome.accepted) {
            return say(outcome.message || `That ${SECURE_LABEL[step] ?? 'code'} was not accepted. Please try again.`);
          }
          if (!outcome) {
            return say('I could not reach the secure verification service just now. Please try again.');
          }
          return;
        }
        if (request && ['sign_out', 'agent', 'callback', 'lost_card'].includes(request.topic)) return run(request);
        return say(secureEntryPrompt(step, spokenRef.current && voiceRef.current));
      }

      // 2. Identifying: a Phone Code (7 digits) or an account number (12 digits) goes to the gateway's identify route.
      if (!a?.authenticated && a?.state !== 'locked') {
        const extracted = extractIdentifier(text);
        const digits = extracted?.value ?? normalizeDigitSequence(text, { context: 'digit_sequence' });
        // Accept digits whenever the assistant is actively waiting for an identifier/method choice, has a pending
        // request that needs verification, OR auth simply hasn't started yet (covers recovery after an error where
        // awaiting was reset to 'none' but the caller is still trying to provide their Phone Code / account number).
        const expecting = awaiting.kind === 'identifier' || awaiting.kind === 'method' || a?.state === 'not_started';
        if (expecting && (digits.length === 7 || digits.length === 12)) {
          const isPhone = extracted ? extracted.type === 'phone_code' : awaiting.kind === 'identifier' ? awaiting.field === 'phone_code' : digits.length === 7;
          const field = isPhone ? 'phone_code' : 'account_number';
          setAwaiting({ kind: 'none' });
          const accepted = await channelRef.current.identify(isPhone ? { phone_code: digits } : { account_number: digits });
          if (!accepted) {
            const refusal = channelRef.current.lastRefusal();
            const err = channelRef.current.error;
            setAwaiting({ kind: 'identifier', field });

            if (err && (err.kind === 'unreachable' || err.kind === 'not_configured' || err.status >= 500)) {
              return say('I could not reach the banking verification service right now. Please try again in a moment.');
            }
            if (refusal?.error_code === 'locked' || channelRef.current.state?.auth.state === 'locked') {
              return say(refusal?.error_message ?? 'Verification has been locked.');
            }
            return say(
              refusal?.error_message ??
                `That ${field === 'phone_code' ? 'Phone Code' : 'account number'} could not be verified. Please check the number and try again.`,
            );
          }
          return; // the keypad prompt follows from the gateway's capture request
        }
        // Give a helpful digit-count hint whenever we're expecting an identifier and the caller spoke some digits
        // but not the right number — covers awaiting.kind === 'identifier', awaiting.kind === 'method' and not_started fallback.
        if ((awaiting.kind === 'identifier' || awaiting.kind === 'method' || a?.state === 'not_started') && digits.length > 0) {
          const field = awaiting.kind === 'identifier' ? awaiting.field : digits.length <= 7 ? 'phone_code' : 'account_number';
          setAwaiting({ kind: 'identifier', field });
          const hint =
            field === 'account_number'
              ? 'Your business account number has 12 digits. Please try again.'
              : field === 'phone_code'
                ? 'Your Phone Code has 7 digits. Please check and try again.'
                : 'Your Phone Code has 7 digits, or your business account number has 12 digits. Please try again.';
          return say(hint);
        }
        if (awaiting.kind === 'method' && !request) {
          const t = text.toLowerCase();
          if (/phone|pin|code/.test(t)) return chooseMethod('phonecode_pin');
          if (/account|nric|otp|sms/.test(t)) return chooseMethod('account_nric_otp');
        }
      }

      // 3. A prepared request is waiting for a yes or a no. The gateway decides whether the words are a clear yes.
      if (awaiting.kind === 'confirm') {
        const intent = confirmationIntent(text);
        if (intent === 'no') {
          await runTool('cancel_transaction', { confirmation_id: awaiting.confirmationId });
          setAwaiting({ kind: 'none' });
          return;
        }
        if (intent === 'maybe_yes') {
          const response = await runTool('confirm_transaction', { confirmation_id: awaiting.confirmationId, caller_words: text.slice(0, 200) });
          if (response && !response.ok && response.error_code === 'not_confirmed')
            return say("I didn't hear a clear yes, so nothing has been sent. Say yes to confirm, or no to cancel.");
          setAwaiting({ kind: 'none' });
          if (response && !response.ok && response.error_code !== 'outcome_unknown' && !String(response.error_code).includes(':')) {
            const reply = describeRefusal(response);
            return say(reply.text, reply.card);
          }
          return; // the outcome is announced from the confirmation card's state
        }
        if (!request) return say('Would you like me to go ahead? Say yes to confirm, or no to cancel.');
      }

      if (awaiting.kind === 'callback_offer') {
        const intent = confirmationIntent(text);
        if (intent === 'maybe_yes') return run({ topic: 'callback', words: 'Service Manager call back' });
        if (intent === 'no') {
          setAwaiting({ kind: 'none' });
          return say('No problem. Is there anything else I can help you with?');
        }
      }

      // 4. Answering a question the assistant asked.
      if (awaiting.kind === 'choice') {
        if (awaiting.purpose === 'account') {
          const account = pickAccount(text, awaiting.accounts);
          if (account) return resume({}, account.account_ref);
        } else if (awaiting.purpose === 'currency') {
          const currency = pickCurrency(text, awaiting.currencies);
          if (currency) return resume({ currency });
        } else {
          const delivery = pickDelivery(text);
          if (delivery && awaiting.options.includes(delivery)) return resume({ delivery });
        }
        if (!request) return say("Sorry, I didn't catch which one. You can also tap one of the options.");
      }
      if (awaiting.kind === 'slot') {
        if (awaiting.missing === 'cheque_number') {
          const norm = normalizeDigitSequence(text, { context: 'digit_sequence' });
          const cheques = text.match(/\b\d{6}\b/g) ?? (norm.length === 6 ? [norm] : []);
          if (cheques.length) return resume({ cheques });
        } else if (awaiting.missing === 'period') {
          const period = pickPeriod(text);
          if (period) return resume({ period });
        } else if (awaiting.missing === 'currency') {
          const currency = pickCurrency(text);
          if (currency) return resume({ currency });
        } else if (awaiting.missing === 'phone') {
          const phone = normalizeDigitSequence(text, { context: 'digit_sequence' });
          if (phone.length >= 5 && phone.length <= 15) return resume({ phone });
        }
        if (!request) return say(askFor(awaiting.missing).text);
      }

      // 5. "More" pages through the last list.
      if (/\b(more|next page|show more|next ones?)\b/i.test(text) && ctl.current.paged && !request) {
        const paged = ctl.current.paged;
        const response = await runTool(paged.tool, { ...paged.args, page: paged.page + 1 });
        if (!response) return;
        if (!response.ok) return say(describeRefusal(response).text);
        ctl.current.paged = response.has_more === true ? { ...paged, page: paged.page + 1 } : null;
        const reply = describeSuccess(paged.tool, response, Date.now());
        return say(reply.text, reply.card);
      }

      // 6. A new request.
      if (!request) return say(`Sorry, I didn't quite catch that. ${CAPABILITIES}`);
      setAwaiting({ kind: 'none' });
      return run(request);
    },
    // chooseMethod is declared below and stable; listing it would create a cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, runTool, resume, say, submitSecret],
  );

  function chooseMethod(method: 'phonecode_pin' | 'account_nric_otp') {
    const field = method === 'phonecode_pin' ? 'phone_code' : 'account_number';
    setAwaiting({ kind: 'identifier', field });
    say(
      method === 'phonecode_pin'
        ? 'Please enter your 7-digit Phone Code in the secure sign-in panel, or type or say it here.'
        : 'Please enter your 12-digit business account number in the secure sign-in panel, or type or say it here.',
    );
  }

  const enqueue = useCallback((work: () => Promise<void> | void) => {
    queue.current = queue.current.then(work).catch(() => undefined);
  }, []);

  /**
   * Work started by a click on the screen: refused while earlier work from the screen is still running (a double click,
   * or a second option before the first is answered), otherwise queued and marked busy until it is done.
   */
  const fromScreen = useCallback(
    (work: () => Promise<void> | void): boolean => {
      if (!callRef.current || busyRef.current > 0) return false;
      busyRef.current += 1;
      setBusy(true);
      enqueue(async () => {
        try {
          await work();
        } finally {
          // (a new conversation resets the count; work of the old one that finishes later must not go below zero)
          busyRef.current = Math.max(0, busyRef.current - 1);
          if (busyRef.current === 0) setBusy(false);
        }
      });
      return true;
    },
    [enqueue],
  );

  const digitBufferRef = useRef<{ text: string; via: Via; timer: number | null }>({
    text: '',
    via: 'voice',
    timer: null,
  });

  useEffect(() => {
    const buffer = digitBufferRef.current;
    return () => {
      if (buffer.timer !== null) {
        window.clearTimeout(buffer.timer);
      }
    };
  }, []);

  const dispatchCustomerInput = useCallback(
    (text: string, via: Via) => {
      // What the transcript may hold: secrets are withheld, identifiers masked.
      const step = secureStepNow();
      const digits = normalizeDigitSequence(text, { context: 'digit_sequence' });
      const a = auth();
      if (step && digits.length >= 4) {
        push({ role: 'customer', text: `${SECURE_LABEL[step] ?? 'Code'} ${via === 'voice' ? 'spoken' : 'typed'}: hidden`, via, secure: true });
      } else if (!a?.authenticated && (digits.length === 7 || digits.length === 12)) {
        push({ role: 'customer', text: `${digits.length === 7 ? 'Phone Code' : 'Account number'} ${maskIdentifier(digits)}`, via, secure: true });
      } else if (ctl.current.awaiting.kind === 'slot' && ctl.current.awaiting.missing === 'phone' && digits.length >= 5) {
        push({ role: 'customer', text: `Phone number ${maskIdentifier(digits)}`, via, secure: true });
      } else {
        push({ role: 'customer', text, via });
      }
      enqueue(() => process(text, via));
    },
    [enqueue, process, push],
  );

  const handle = useCallback(
    (raw: string, via: Via) => {
      const text = raw.trim();
      if (!text || !callRef.current) return;

      const step = secureStepNow();
      const awaiting = ctl.current.awaiting;
      const a = auth();
      const expectingIdentifier =
        !a?.authenticated && a?.state !== 'locked' && (awaiting.kind === 'identifier' || awaiting.kind === 'method' || a?.state === 'not_started');
      const isDigitContext = Boolean(
        step || expectingIdentifier || (awaiting.kind === 'slot' && (awaiting.missing === 'phone' || awaiting.missing === 'cheque_number')),
      );

      // Spoken voice digit buffering across natural pauses: prevents partial digit fragments from cutting off speech
      if (via === 'voice' && isDigitContext) {
        const chunkDigits = normalizeDigitSequence(text, { context: 'digit_sequence' });
        if (chunkDigits.length > 0) {
          const accumulated = digitBufferRef.current.text ? `${digitBufferRef.current.text} ${text}` : text;
          const totalDigits = normalizeDigitSequence(accumulated, { context: 'digit_sequence' });

          let targetReached = false;
          if (step) {
            targetReached = totalDigits.length >= 6;
          } else if (expectingIdentifier) {
            const expected = awaiting.kind === 'identifier' ? (awaiting.field === 'account_number' ? 12 : 7) : null;
            targetReached = expected !== null ? totalDigits.length === expected : totalDigits.length === 7 || totalDigits.length === 12;
          } else if (awaiting.kind === 'slot') {
            targetReached = awaiting.missing === 'cheque_number' ? totalDigits.length === 6 : totalDigits.length >= 8;
          }

          if (targetReached) {
            if (digitBufferRef.current.timer !== null) {
              window.clearTimeout(digitBufferRef.current.timer);
              digitBufferRef.current.timer = null;
            }
            digitBufferRef.current.text = '';
            dispatchCustomerInput(accumulated, 'voice');
            return;
          }

          // Incomplete digit sequence: buffer and wait up to 1200ms for caller's remaining digits
          if (digitBufferRef.current.timer !== null) {
            window.clearTimeout(digitBufferRef.current.timer);
          }
          digitBufferRef.current.text = accumulated;
          digitBufferRef.current.via = via;
          digitBufferRef.current.timer = window.setTimeout(() => {
            digitBufferRef.current.timer = null;
            const buffered = digitBufferRef.current.text;
            digitBufferRef.current.text = '';
            if (buffered) {
              dispatchCustomerInput(buffered, 'voice');
            }
          }, 1200);
          return;
        }
      }

      // If non-digit speech arrives while buffer was active, flush the buffer first
      if (digitBufferRef.current.timer !== null) {
        window.clearTimeout(digitBufferRef.current.timer);
        digitBufferRef.current.timer = null;
        const buffered = digitBufferRef.current.text;
        digitBufferRef.current.text = '';
        if (buffered) {
          dispatchCustomerInput(buffered, digitBufferRef.current.via);
        }
      }

      dispatchCustomerInput(text, via);
    },
    [dispatchCustomerInput],
  );

  const choose = useCallback(
    (purpose: ChoicePurpose, id: string, label: string, messageId?: number) => {
      // each reply's choices are answered once; the question they asked is then settled and the card closes
      if (messageId !== undefined && answeredRef.current.has(messageId)) return;
      const accepted = fromScreen(() => {
        switch (purpose) {
          case 'method':
            return chooseMethod(id as 'phonecode_pin' | 'account_nric_otp');
          case 'account':
            return resume({}, id);
          case 'currency':
            return ctl.current.pending ? resume({ currency: id }) : run({ topic: 'fx', words: label, currency: id });
          case 'delivery':
            return resume({ delivery: id as Delivery });
          case 'period':
            return resume({ period: id as Period });
          default:
            return undefined;
        }
      });
      if (!accepted) return;
      if (messageId !== undefined) {
        answeredRef.current.add(messageId);
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, answered: id } : m)));
      }
      push({ role: 'customer', text: label, via: 'screen' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromScreen, push, resume, run],
  );

  const selectAccount = useCallback(
    (account: AccountView) => {
      const accepted = fromScreen(() => {
        const awaiting = ctl.current.awaiting;
        if (awaiting.kind === 'choice' && awaiting.purpose === 'account' && ctl.current.pending) return resume({}, account.account_ref);
        return run({ topic: 'balance', words: '' }, account.account_ref);
      });
      if (!accepted) return;
      setSelected(account.account_ref);
      push({ role: 'customer', text: `${account.type} ${account.ending}`, via: 'screen' });
    },
    [fromScreen, push, resume, run],
  );

  const balanceIn = useCallback(
    (accountRef: string, currency: string) => {
      if (fromScreen(() => run({ topic: 'balance', words: '', currency }, accountRef)))
        push({ role: 'customer', text: `Show the ${currency} balance`, via: 'screen' });
    },
    [fromScreen, push, run],
  );

  const submitFromKeypad = useCallback(
    async (value: string) => {
      const purpose = secureStepNow() ?? 'pin';
      const outcome = await channelRef.current.submitCapture(value);
      if (outcome) record({ type: 'capture', purpose, accepted: outcome.accepted, via: 'keypad' });
      return outcome;
    },
    [record],
  );

  const greet = useCallback(async () => {
    const response = await runTool('get_caller_context', {});
    say(greeting(response?.ok && typeof response.greeting === 'string' ? response.greeting : null, bankRef.current));
    record({ type: 'greeted' });
  }, [record, runTool, say]);

  // ---- Following the gateway session ----

  // A new session starts a new conversation.
  useEffect(() => {
    setMessages([]);
    setBalances({});
    setSelected(null);
    setAwaiting({ kind: 'none' });
    ctl.current.pending = null;
    ctl.current.lastPrompted = null;
    ctl.current.paged = null;
    queue.current = Promise.resolve();
    answeredRef.current = new Set();
    busyRef.current = 0;
    setBusy(false);
    if (digitBufferRef.current.timer !== null) {
      window.clearTimeout(digitBufferRef.current.timer);
      digitBufferRef.current.timer = null;
    }
    digitBufferRef.current.text = '';
  }, [callId]);

  // Sign-in state changes, whichever screen caused them.
  const authState = channel.state?.auth.state ?? null;
  const prevAuth = useRef<string | null>(null);
  useEffect(() => {
    const before = prevAuth.current;
    prevAuth.current = authState;
    if (!authState || before === authState || !callRef.current) return;
    const a = channelRef.current.state?.auth;
    if (!a) return;
    record({ type: 'auth', state: a.state, method: a.method, reason: a.lock_reason });
    // Starting sign-in again prompts each keypad step again.
    if (authState === 'not_started' || authState === 'locked') ctl.current.lastPrompted = null;
    if (authState === 'authenticated') {
      ctl.current.lastPrompted = null;
      const pending = ctl.current.pending;
      ctl.current.pending = null;
      setAwaiting({ kind: 'none' });
      const accounts = channelRef.current.state?.profile?.accounts ?? [];
      if (accounts.length === 1) setSelected(accounts[0]?.account_ref ?? null);
      say("Thank you, you're verified.");
      if (pending) enqueue(() => run(pending));
      else say('How can I help you today?');
    } else if (authState === 'locked') {
      ctl.current.pending = null;
      setAwaiting({ kind: 'none' });
      say(a.message, { kind: 'notice', tone: 'danger', title: 'Sign-in is locked', text: a.message });
    } else if (authState === 'not_started' && before === 'authenticated') {
      setSelected(null);
      setBalances({});
      ctl.current.pending = null;
      setAwaiting({ kind: 'none' });
      say("You're signed out of banking. Is there anything else I can help you with?");
    }
  }, [authState, enqueue, record, run, say]);

  // Each secure-entry step is prompted once.
  const purpose = channel.keypad?.purpose ?? channel.state?.auth.secure_entry?.purpose ?? null;
  useEffect(() => {
    if (!purpose || !callRef.current || ctl.current.lastPrompted === purpose) return;
    ctl.current.lastPrompted = purpose;
    say(secureEntryPrompt(purpose, spokenRef.current && voiceRef.current));
  }, [purpose, say]);

  // Keypad results: the gateway's own words (attempts left, PIN changed).
  const feedback = channel.feedback;
  useEffect(() => {
    if (!feedback || !callRef.current) return;
    if (!feedback.accepted) {
      const still = feedback.auth?.state;
      say(
        still === 'locked'
          ? feedback.message
          : `${feedback.message}${still && still !== 'authenticated' && still !== 'not_started' ? ' Please try again on the secure keypad.' : ''}`,
      );
    } else if (ctl.current.lastPrompted === 'confirm_new_pin') {
      ctl.current.lastPrompted = null;
      say(feedback.message, { kind: 'notice', tone: 'success', title: 'Phone PIN changed' });
    }
  }, [feedback, say]);

  // Confirmation outcomes, from the card's state (the gateway's confirmation events).
  const card = channel.confirmation;
  const cardKey = card ? `${card.id}:${card.phase}` : null;
  useEffect(() => {
    if (!card || !callRef.current) return;
    const ref = card.reference ? ` Your reference is ${card.reference}.` : '';
    switch (card.phase) {
      case 'confirmed':
        setAwaiting({ kind: 'none' });
        record({ type: 'confirmation', outcome: 'confirmed' });
        return say(`Done. ${card.message ?? 'Your request has been submitted.'}${ref}`, {
          kind: 'notice',
          tone: 'success',
          title: 'Request completed',
          text: `${card.summary}${ref}`,
        });
      case 'cancelled':
        setAwaiting({ kind: 'none' });
        record({ type: 'confirmation', outcome: 'cancelled' });
        return say("Okay, I've cancelled that. Nothing was sent.");
      case 'failed':
        setAwaiting({ kind: 'none' });
        record({ type: 'confirmation', outcome: 'failed' });
        return say(`That request did not go through. ${card.message ?? ''} Would you like me to connect you to a Service Manager?`.replace(/\s+/g, ' '), {
          kind: 'notice',
          tone: 'danger',
          title: 'Request failed',
          text: card.message,
        });
      case 'unknown':
        setAwaiting({ kind: 'none' });
        record({ type: 'confirmation', outcome: 'unknown' });
        return say(
          card.message ?? 'We could not confirm whether your request went through. Please do not repeat it; a Service Manager can check its status for you.',
          { kind: 'notice', tone: 'warning', title: 'Outcome unknown', text: card.message },
        );
      case 'expired':
        setAwaiting({ kind: 'none' });
        record({ type: 'confirmation', outcome: 'expired' });
        return say('That request expired before it was confirmed, so nothing was sent.');
      default:
        return;
    }
    // Keyed on id and phase: each outcome is announced once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  const identifierStep = awaitingView.kind === 'identifier' ? awaitingView.field : null;
  const secureStep = purpose && SECURE_PURPOSES.has(purpose) ? purpose : null;

  return useMemo(
    () => ({
      messages,
      thinking,
      activeTool,
      secureStep,
      identifierStep,
      busy,
      selectedAccount,
      balances,
      spokenSecrets,
      setSpokenSecrets,
      greet,
      handle,
      choose,
      selectAccount,
      balanceIn,
      submitFromKeypad,
      record,
    }),
    [
      messages,
      thinking,
      activeTool,
      secureStep,
      identifierStep,
      busy,
      selectedAccount,
      balances,
      spokenSecrets,
      greet,
      handle,
      choose,
      selectAccount,
      balanceIn,
      submitFromKeypad,
      record,
    ],
  );
}
