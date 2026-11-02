import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gateway, GatewayError } from '../../api/gateway';
import type { AccountView, ToolResponse } from '../../api/gatewayTypes';
import { extractIdentifier, maskIdentifier, normalizeDigitSequence } from '../../utils/numericNormalization';
import type { BankingChannel } from '../../hooks/useBankingChannel';
import {
  APPOINTMENT_SERVICES,
  askFor,
  askParty,
  CAPABILITIES,
  confirmationIntent,
  describeLookup,
  describeRefusal,
  describeSuccess,
  greeting,
  goodbye,
  lookupFor,
  missingSlot,
  NEEDS_VERIFICATION,
  pickAccount,
  pickCurrency,
  pickDelivery,
  pickOption,
  pickParty,
  pickPeriod,
  pickService,
  secureEntryPrompt,
  toolFor,
  TOPIC_LABEL,
  understand,
  type AppointmentService,
  type BankingRequest,
  type Card,
  type ChoiceOption,
  type ChoicePurpose,
  type Delivery,
  type Missing,
  type Period,
} from './bankingAssistant';

// The turn engine of a banking agent's Sandbox test conversation: one conversation, typed or spoken, driving a real
// gateway session. It runs gateway tools the way the agent runtime would (through the rehearsal tool route), follows
// `next` and reads `say` as given, and follows the session's channel stream for sign-in, keypads and confirmations, so
// the transcript and the customer's device always agree.
//
// What it never keeps or sends: PIN, NRIC or OTP digits. Those are keyed on the secure keypad only; digits typed or
// said while a keypad is open are refused and shown as "hidden". Identifiers (Phone Code, account number) are masked.

export type Via = 'voice' | 'chat' | 'screen';

export interface BankingLine {
  readonly id: number;
  readonly role: 'assistant' | 'customer' | 'system';
  readonly text: string;
  readonly card?: Card;
  readonly via?: Via;
  readonly at: number;
  /** A customer line whose content was withheld (secure entry) or masked (an identifier). */
  readonly secure?: boolean;
  /** An agent line that states what the banking gateway answered (shown with where the answer came from). */
  readonly fromBank?: boolean;
}

/** A tool the engine ran, as the call's records keep it. */
export interface ToolRun {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly response: ToolResponse | null;
  readonly error?: string;
}

type PickPurpose = 'service' | 'branch' | 'slot' | 'party' | 'booking';

type Awaiting =
  | { kind: 'none' }
  | { kind: 'method' }
  | { kind: 'identifier'; field: 'phone_code' | 'account_number' }
  | { kind: 'slot'; missing: Missing }
  | { kind: 'choice'; purpose: 'account'; accounts: AccountView[] }
  | { kind: 'choice'; purpose: 'currency'; currencies: string[] }
  | { kind: 'choice'; purpose: 'delivery'; options: Delivery[] }
  | { kind: 'pick'; purpose: PickPurpose; options: ChoiceOption[] }
  | { kind: 'confirm'; confirmationId: string }
  | { kind: 'callback_offer' };

const SECURE_PURPOSES = new Set(['pin', 'nric', 'otp', 'current_pin', 'new_pin', 'confirm_new_pin']);
const SECURE_LABEL: Record<string, string> = { pin: 'Phone PIN', nric: 'NRIC digits', otp: 'one-time password', current_pin: 'current Phone PIN', new_pin: 'new Phone PIN', confirm_new_pin: 'new Phone PIN again' };

/** A refusal that sends the request back a step: the field to clear before asking again. */
const STEP_BACK: Record<string, Partial<BankingRequest>> = {
  branch_not_offering: { branchId: undefined, slotId: undefined, party: undefined },
  slot_unavailable: { slotId: undefined, party: undefined },
  party_too_large: { party: undefined },
};

/** What a picked option fills in on the pending request. */
function patchFor(purpose: PickPurpose, id: string): Partial<BankingRequest> {
  switch (purpose) {
    case 'service':
      return { service: id as AppointmentService };
    case 'branch':
      return { branchId: id };
    case 'slot':
      return { slotId: id };
    case 'party':
      return { party: Number(id) };
    case 'booking':
      return { bookingId: id };
  }
}

export interface BankingAssistant {
  readonly lines: BankingLine[];
  readonly thinking: boolean;
  /** The secure-entry step in progress (pin, nric, otp…): the keypad, not the conversation, takes it. */
  readonly secureStep: string | null;
  /** The identifier the agent is waiting for, when any. */
  readonly identifierStep: 'phone_code' | 'account_number' | null;
  /** The agent's first words, once the session's secure channel is open. */
  greet: () => Promise<void>;
  /** Something the customer typed or said. */
  handle: (text: string, via: Via) => void;
  /** A choice the customer clicked under a reply. */
  choose: (purpose: ChoicePurpose, id: string, label: string) => void;
  /** An account picked on the customer's device: used for what is pending, or its balance is shown. */
  selectAccount: (account: AccountView) => void;
  /** Show a balance in another currency of a multi-currency account. */
  balanceIn: (accountRef: string, currency: string) => void;
  /** A line from the conversation itself (not the agent): started, ended, voice notes. */
  note: (text: string) => void;
}

export function useBankingAssistant({
  callId,
  channel,
  onLine,
  onTool,
  agentName,
}: {
  callId: string | null;
  /** The agent being tested: the greeting and goodbye name it. */
  agentName?: string;
  channel: BankingChannel;
  /** Every line as it is added, for the call's records and for the voice to speak. */
  onLine: (line: BankingLine) => void;
  /** Every tool run, for the call's records. */
  onTool: (run: ToolRun) => void;
}): BankingAssistant {
  const [lines, setLines] = useState<BankingLine[]>([]);
  const [thinking, setThinking] = useState(false);
  const [awaitingView, setAwaitingView] = useState<Awaiting>({ kind: 'none' });

  const idRef = useRef(0);
  const callRef = useRef(callId);
  callRef.current = callId;
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;
  const onToolRef = useRef(onTool);
  onToolRef.current = onTool;

  // Conversation control state, read by handlers that run after awaits.
  const ctl = useRef<{ awaiting: Awaiting; pending: BankingRequest | null; selected: string | null; lastPrompted: string | null; paged: { tool: string; args: Record<string, unknown>; page: number } | null }>({
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

  const push = useCallback((m: Omit<BankingLine, 'id' | 'at'>) => {
    idRef.current += 1;
    const line: BankingLine = { ...m, id: idRef.current, at: Date.now() };
    setLines((prev) => [...prev, line]);
    onLineRef.current(line);
    return line;
  }, []);

  const say = useCallback((text: string, card?: Card, fromBank = false) => void push({ role: 'assistant', text, card, fromBank }), [push]);
  const note = useCallback((text: string) => void push({ role: 'system', text }), [push]);

  const auth = () => channelRef.current.state?.auth ?? null;
  const secureStepNow = () => {
    const ch = channelRef.current;
    const purpose = ch.keypad?.purpose ?? ch.state?.auth.secure_entry?.purpose ?? null;
    return purpose && SECURE_PURPOSES.has(purpose) ? purpose : null;
  };

  /** Runs a gateway tool for this conversation and reports it for the records. */
  const runTool = useCallback(
    async (tool: string, args: Record<string, unknown>): Promise<ToolResponse | null> => {
      const id = callRef.current;
      if (!id) return null;
      setThinking(true);
      try {
        const response = await gateway.rehearsal.runTool(id, tool, args);
        onToolRef.current({ tool, args, response });
        return response;
      } catch (e) {
        const err = e instanceof GatewayError ? e : new GatewayError(0, 'server', 'The banking gateway had a problem with this request.');
        onToolRef.current({ tool, args, response: null, error: err.message });
        say(`I couldn't reach the banking service just now. ${err.message} Please try again in a moment.`, { kind: 'notice', tone: 'danger', title: 'Banking service unavailable', text: err.message }, true);
        return null;
      } finally {
        setThinking(false);
      }
    },
    [say]
  );

  const askVerification = useCallback(
    (request: BankingRequest | null) => {
      const a = auth();
      if (a?.state === 'locked') {
        say(a.message, { kind: 'notice', tone: 'danger', title: 'Sign-in is locked', text: a.message }, true);
        return;
      }
      ctl.current.pending = request;
      const step = secureStepNow();
      if (step) {
        say(secureEntryPrompt(step));
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
    [say]
  );

  const run = useCallback(
    async (request: BankingRequest, accountOverride?: string | null): Promise<void> => {
      switch (request.topic) {
        case 'greeting':
          return say(`Hello! ${CAPABILITIES}`);
        case 'thanks':
          return say("You're welcome. Is there anything else I can help you with?");
        case 'goodbye':
          return say(goodbye(agentName));
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
      if (NEEDS_VERIFICATION.has(request.topic) && !auth()?.authenticated) return askVerification(request);

      // Something to ask the customer first.
      const missing = missingSlot(request);
      if (missing) {
        ctl.current.pending = request;
        if (missing === 'service') {
          setAwaiting({ kind: 'pick', purpose: 'service', options: APPOINTMENT_SERVICES.map((s) => ({ id: s.id, label: s.label })) });
          const ask = askFor('service');
          return say(ask.text, ask.card);
        }
        if (missing === 'party') {
          const ask = askParty(request.maxParty ?? 6);
          setAwaiting({ kind: 'pick', purpose: 'party', options: ask.card?.kind === 'choices' ? ask.card.options : [] });
          return say(ask.text, ask.card);
        }
        setAwaiting({ kind: 'slot', missing });
        const ask = askFor(missing);
        return say(ask.text, ask.card);
      }

      // Something to look up and offer as choices first (a branch, a slot, a booking).
      const lookup = lookupFor(request);
      if (lookup) {
        const response = await runTool(lookup.tool, lookup.args);
        if (!response) return;
        if (!response.ok) {
          if (response.error_code === 'not_authenticated') return askVerification(request);
          const back = response.error_code ? STEP_BACK[response.error_code] : undefined;
          const refusal = describeRefusal(response);
          if (back && lookup.purpose === 'slot') {
            say(refusal.text, refusal.card, true);
            return run({ ...request, ...back });
          }
          ctl.current.pending = null;
          setAwaiting({ kind: 'none' });
          return say(refusal.text, refusal.card, true);
        }
        const offered = describeLookup(lookup.purpose, response);
        if (!offered.options.length) {
          ctl.current.pending = null;
          setAwaiting({ kind: 'none' });
          return say(offered.text, offered.card, true);
        }
        ctl.current.pending = { ...request, maxParty: offered.maxParty ?? request.maxParty };
        setAwaiting({ kind: 'pick', purpose: lookup.purpose, options: offered.options });
        return say(offered.text, offered.card, true);
      }

      const accounts = channelRef.current.state?.profile?.accounts ?? [];
      const named = pickAccount(request.words, accounts);
      const accountRef = accountOverride ?? named?.account_ref ?? ctl.current.selected;
      const call = toolFor(request, NEEDS_VERIFICATION.has(request.topic) && request.topic !== 'accounts' && request.topic !== 'pin_change' ? accountRef : null);
      if (!call) return say(CAPABILITIES);
      const response = await runTool(call.tool, call.args);
      if (!response) return;

      if (response.ok) {
        ctl.current.pending = null;
        setAwaiting({ kind: 'none' });
        const reply = describeSuccess(call.tool, response, Date.now());
        if (reply.card?.kind === 'balance' && reply.card.balance.accountRef) ctl.current.selected = reply.card.balance.accountRef;
        else if (typeof call.args.account_ref === 'string') ctl.current.selected = call.args.account_ref;
        ctl.current.paged = response.has_more === true ? { tool: call.tool, args: call.args, page: typeof response.page === 'number' ? response.page : 1 } : null;
        if (typeof response.confirmation_id === 'string') setAwaiting({ kind: 'confirm', confirmationId: response.confirmation_id });
        if (call.tool === 'start_pin_change') ctl.current.lastPrompted = 'current_pin';
        if (call.tool === 'prepare_agent_transfer' && response.within_hours === false) setAwaiting({ kind: 'callback_offer' });
        return say(reply.text, reply.card, true);
      }

      const back = response.error_code ? STEP_BACK[response.error_code] : undefined;
      if (back) {
        say(describeRefusal(response).text, undefined, true);
        return run({ ...request, ...back });
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
          if (typeof call.args.account_ref === 'string') ctl.current.selected = call.args.account_ref;
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
      return say(reply.text, reply.card, true);
    },
    [askVerification, runTool, say, agentName]
  );

  /** Resumes the pending request with what the customer just supplied. */
  const resume = useCallback(
    (patch: Partial<BankingRequest>, accountRef?: string) => {
      const pending = ctl.current.pending;
      setAwaiting({ kind: 'none' });
      if (!pending) return Promise.resolve();
      return run({ ...pending, ...patch }, accountRef);
    },
    [run]
  );

  const chooseMethod = useCallback(
    (method: 'phonecode_pin' | 'account_nric_otp') => {
      const field = method === 'phonecode_pin' ? 'phone_code' : 'account_number';
      setAwaiting({ kind: 'identifier', field });
      say(
        method === 'phonecode_pin'
          ? 'Please enter your 7-digit Phone Code on the sign-in panel, or type or say it here.'
          : 'Please enter your 12-digit business account number on the sign-in panel, or type or say it here.'
      );
    },
    [say]
  );

  const process = useCallback(
    async (text: string) => {
      const a = auth();
      const awaiting = ctl.current.awaiting;
      const request = understand(text);

      // 1. A keypad is open: secrets go on the keypad only. Digits here are refused, never sent.
      const step = secureStepNow();
      if (step) {
        const digits = normalizeDigitSequence(text, { context: 'digit_sequence' });
        if (digits.length >= 4) return say(`For your security, please key in your ${SECURE_LABEL[step] ?? 'code'} on the secure keypad. What you typed or said was not sent to the bank.`);
        if (request && ['sign_out', 'agent', 'callback', 'lost_card'].includes(request.topic)) return run(request);
        return say(secureEntryPrompt(step));
      }

      // 2. Identifying: a Phone Code (7 digits) or an account number (12 digits) goes to the gateway's identify route.
      if (!a?.authenticated && a?.state !== 'locked') {
        const extracted = extractIdentifier(text);
        const digits = extracted?.value ?? normalizeDigitSequence(text, { context: 'digit_sequence' });
        // Digits count as an identifier while one is asked for, or before sign-in has started (recovering after an error).
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
            if (err && (err.kind === 'unreachable' || err.kind === 'not_configured' || err.kind === 'unavailable' || err.status >= 500)) {
              return say('I could not reach the banking verification service right now. Please try again in a moment.', undefined, true);
            }
            if (refusal?.error_code === 'locked' || channelRef.current.state?.auth.state === 'locked') return say(refusal?.error_message ?? 'Verification has been locked.', undefined, true);
            return say(refusal?.error_message ?? `That ${field === 'phone_code' ? 'Phone Code' : 'account number'} could not be verified. Please check the number and try again.`, undefined, true);
          }
          return; // the keypad prompt follows from the gateway's capture request
        }
        if (expecting && digits.length > 0) {
          const field = awaiting.kind === 'identifier' ? awaiting.field : digits.length <= 7 ? 'phone_code' : 'account_number';
          setAwaiting({ kind: 'identifier', field });
          return say(field === 'account_number' ? 'Your business account number has 12 digits. Please try again.' : 'Your Phone Code has 7 digits. Please check and try again.');
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
          if (response && !response.ok && response.error_code === 'not_confirmed') return say("I didn't hear a clear yes, so nothing has been sent. Say yes to confirm, or no to cancel.", undefined, true);
          setAwaiting({ kind: 'none' });
          if (response && !response.ok && response.error_code !== 'outcome_unknown' && !String(response.error_code).includes(':')) {
            const reply = describeRefusal(response);
            return say(reply.text, reply.card, true);
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

      // 4. Answering a question the agent asked.
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
      if (awaiting.kind === 'pick') {
        const picked =
          awaiting.purpose === 'party'
            ? (() => {
                const n = pickParty(text, awaiting.options.length);
                return n ? String(n) : null;
              })()
            : awaiting.purpose === 'service'
              ? (pickService(text) ?? pickOption(text, awaiting.options)?.id ?? null)
              : (pickOption(text, awaiting.options)?.id ?? null);
        if (picked) return resume(patchFor(awaiting.purpose, picked));
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
        if (!response.ok) return say(describeRefusal(response).text, undefined, true);
        ctl.current.paged = response.has_more === true ? { ...paged, page: paged.page + 1 } : null;
        const reply = describeSuccess(paged.tool, response, Date.now());
        return say(reply.text, reply.card, true);
      }

      // 6. A new request.
      if (!request) return say(`Sorry, I didn't quite catch that. ${CAPABILITIES}`);
      setAwaiting({ kind: 'none' });
      return run(request);
    },
    [chooseMethod, run, runTool, resume, say]
  );

  const enqueue = useCallback((work: () => Promise<void> | void) => {
    queue.current = queue.current.then(work).catch(() => undefined);
  }, []);

  /** Puts what the customer said in the transcript (identifiers masked, secrets hidden) and handles it. */
  const dispatch = useCallback(
    (text: string, via: Via) => {
      const step = secureStepNow();
      const digits = normalizeDigitSequence(text, { context: 'digit_sequence' });
      const a = auth();
      if (step && digits.length >= 4) push({ role: 'customer', text: `${SECURE_LABEL[step] ?? 'Code'} ${via === 'voice' ? 'spoken' : 'typed'}: hidden`, via, secure: true });
      else if (!a?.authenticated && (digits.length === 7 || digits.length === 12)) push({ role: 'customer', text: `${digits.length === 7 ? 'Phone Code' : 'Account number'} ${maskIdentifier(digits)}`, via, secure: true });
      else if (ctl.current.awaiting.kind === 'slot' && ctl.current.awaiting.missing === 'phone' && digits.length >= 5) push({ role: 'customer', text: `Phone number ${maskIdentifier(digits)}`, via, secure: true });
      else push({ role: 'customer', text, via });
      enqueue(() => process(text));
    },
    [enqueue, process, push]
  );

  // Spoken digits arrive in pieces across natural pauses: they are gathered until the number is complete.
  const digitBuffer = useRef<{ text: string; timer: number | null }>({ text: '', timer: null });
  const flushDigits = useCallback(() => {
    const buffer = digitBuffer.current;
    if (buffer.timer !== null) window.clearTimeout(buffer.timer);
    buffer.timer = null;
    const text = buffer.text;
    buffer.text = '';
    if (text) dispatch(text, 'voice');
  }, [dispatch]);

  const handle = useCallback(
    (raw: string, via: Via) => {
      const text = raw.trim();
      if (!text || !callRef.current) return;
      const awaiting = ctl.current.awaiting;
      const a = auth();
      const expectingIdentifier = !a?.authenticated && a?.state !== 'locked' && (awaiting.kind === 'identifier' || awaiting.kind === 'method' || a?.state === 'not_started');
      const digitContext = !secureStepNow() && (expectingIdentifier || (awaiting.kind === 'slot' && (awaiting.missing === 'phone' || awaiting.missing === 'cheque_number')));
      if (via === 'voice' && digitContext && normalizeDigitSequence(text, { context: 'digit_sequence' }).length > 0) {
        const buffer = digitBuffer.current;
        buffer.text = buffer.text ? `${buffer.text} ${text}` : text;
        const total = normalizeDigitSequence(buffer.text, { context: 'digit_sequence' }).length;
        const expected = awaiting.kind === 'identifier' ? (awaiting.field === 'account_number' ? [12] : [7]) : awaiting.kind === 'slot' ? (awaiting.missing === 'cheque_number' ? [6] : []) : [7, 12];
        if (expected.includes(total) || (awaiting.kind === 'slot' && awaiting.missing === 'phone' && total >= 8)) return flushDigits();
        if (buffer.timer !== null) window.clearTimeout(buffer.timer);
        buffer.timer = window.setTimeout(flushDigits, 1200);
        return;
      }
      if (digitBuffer.current.timer !== null) flushDigits();
      dispatch(text, via);
    },
    [dispatch, flushDigits]
  );

  const choose = useCallback(
    (purpose: ChoicePurpose, id: string, label: string) => {
      if (!callRef.current) return;
      push({ role: 'customer', text: label, via: 'screen' });
      enqueue(() => {
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
          case 'service':
          case 'branch':
          case 'slot':
          case 'party':
          case 'booking':
            return resume(patchFor(purpose, id));
          default:
            return undefined;
        }
      });
    },
    [chooseMethod, enqueue, push, resume, run]
  );

  const selectAccount = useCallback(
    (account: AccountView) => {
      if (!callRef.current) return;
      ctl.current.selected = account.account_ref;
      push({ role: 'customer', text: `${account.type} ${account.ending}`, via: 'screen' });
      enqueue(() => {
        const awaiting = ctl.current.awaiting;
        if (awaiting.kind === 'choice' && awaiting.purpose === 'account' && ctl.current.pending) return resume({}, account.account_ref);
        return run({ topic: 'balance', words: '' }, account.account_ref);
      });
    },
    [enqueue, push, resume, run]
  );

  const balanceIn = useCallback(
    (accountRef: string, currency: string) => {
      if (!callRef.current) return;
      push({ role: 'customer', text: `Show the ${currency} balance`, via: 'screen' });
      enqueue(() => run({ topic: 'balance', words: '', currency }, accountRef));
    },
    [enqueue, push, run]
  );

  const greet = useCallback(async () => {
    const response = await runTool('get_caller_context', {});
    say(greeting(response?.ok && typeof response.greeting === 'string' ? response.greeting : null, agentName));
  }, [runTool, say, agentName]);

  // ---- Following the gateway session ----

  // A new session starts a new conversation.
  useEffect(() => {
    setLines([]);
    setAwaiting({ kind: 'none' });
    ctl.current = { awaiting: { kind: 'none' }, pending: null, selected: null, lastPrompted: null, paged: null };
    queue.current = Promise.resolve();
    const buffer = digitBuffer.current;
    if (buffer.timer !== null) window.clearTimeout(buffer.timer);
    buffer.timer = null;
    buffer.text = '';
  }, [callId]);
  useEffect(() => () => {
    const buffer = digitBuffer.current;
    if (buffer.timer !== null) window.clearTimeout(buffer.timer);
  }, []);

  // Sign-in state changes, whichever screen caused them.
  const authState = channel.state?.auth.state ?? null;
  const prevAuth = useRef<string | null>(null);
  useEffect(() => {
    const before = prevAuth.current;
    prevAuth.current = authState;
    if (!authState || before === authState || !callRef.current) return;
    const a = channelRef.current.state?.auth;
    if (!a) return;
    // Starting sign-in again prompts each keypad step again.
    if (authState === 'not_started' || authState === 'locked') ctl.current.lastPrompted = null;
    if (authState === 'authenticated') {
      ctl.current.lastPrompted = null;
      const pending = ctl.current.pending;
      ctl.current.pending = null;
      setAwaiting({ kind: 'none' });
      const accounts = channelRef.current.state?.profile?.accounts ?? [];
      if (accounts.length === 1) ctl.current.selected = accounts[0]?.account_ref ?? null;
      say("Thank you, you're verified.", undefined, true);
      if (pending) enqueue(() => run(pending));
      else say('How can I help you today?');
    } else if (authState === 'locked') {
      ctl.current.pending = null;
      setAwaiting({ kind: 'none' });
      say(a.message, { kind: 'notice', tone: 'danger', title: 'Sign-in is locked', text: a.message }, true);
    } else if (authState === 'not_started' && before === 'authenticated') {
      ctl.current.selected = null;
      ctl.current.pending = null;
      setAwaiting({ kind: 'none' });
      say("You're signed out of banking. Is there anything else I can help you with?", undefined, true);
    }
  }, [authState, enqueue, run, say]);

  // Each secure-entry step is prompted once.
  const purpose = channel.keypad?.purpose ?? channel.state?.auth.secure_entry?.purpose ?? null;
  useEffect(() => {
    if (!purpose || !callRef.current || ctl.current.lastPrompted === purpose) return;
    ctl.current.lastPrompted = purpose;
    say(secureEntryPrompt(purpose));
  }, [purpose, say]);

  // Keypad results: the gateway's own words (attempts left, PIN changed).
  const feedback = channel.feedback;
  useEffect(() => {
    if (!feedback || !callRef.current) return;
    if (!feedback.accepted) {
      const still = feedback.auth?.state;
      say(still === 'locked' ? feedback.message : `${feedback.message}${still && still !== 'authenticated' && still !== 'not_started' ? ' Please try again on the secure keypad.' : ''}`, undefined, true);
    } else if (ctl.current.lastPrompted === 'confirm_new_pin') {
      ctl.current.lastPrompted = null;
      say(feedback.message, { kind: 'notice', tone: 'success', title: 'Phone PIN changed' }, true);
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
        return say(`Done. ${card.message ?? 'Your request has been submitted.'}${ref}`, { kind: 'notice', tone: 'success', title: 'Request completed', text: `${card.summary}${ref}` }, true);
      case 'cancelled':
        setAwaiting({ kind: 'none' });
        return say("Okay, I've cancelled that. Nothing was sent.", undefined, true);
      case 'failed':
        setAwaiting({ kind: 'none' });
        return say(`That request did not go through. ${card.message ?? ''} Would you like me to connect you to a Service Manager?`.replace(/\s+/g, ' '), { kind: 'notice', tone: 'danger', title: 'Request failed', text: card.message }, true);
      case 'unknown':
        setAwaiting({ kind: 'none' });
        return say(card.message ?? 'We could not confirm whether your request went through. Please do not repeat it; a Service Manager can check its status for you.', { kind: 'notice', tone: 'warning', title: 'Outcome unknown', text: card.message }, true);
      case 'expired':
        setAwaiting({ kind: 'none' });
        return say('That request expired before it was confirmed, so nothing was sent.', undefined, true);
      default:
        return;
    }
    // Keyed on id and phase: each outcome is announced once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  const identifierStep = awaitingView.kind === 'identifier' ? awaitingView.field : null;
  const secureStep = purpose && SECURE_PURPOSES.has(purpose) ? purpose : null;

  return useMemo(
    () => ({ lines, thinking, secureStep, identifierStep, greet, handle, choose, selectAccount, balanceIn, note }),
    [lines, thinking, secureStep, identifierStep, greet, handle, choose, selectAccount, balanceIn, note]
  );
}
