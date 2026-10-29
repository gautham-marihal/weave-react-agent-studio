// The banking assistant's conversation rules for rehearsals on the mock gateway: what a customer's words ask for,
// which gateway tool answers it, and how a tool result is said and shown. Deterministic on purpose: there is no
// language model here, so a rehearsal behaves the same way every time, and every fact it states comes from a gateway
// tool result. The gateway still decides everything that matters (who is verified, which account, whether a "yes"
// is a yes); these rules only choose the next tool and the words around its result.

import type { AccountView, ToolResponse } from '../../api/gatewayTypes.ts';
import { normalizeDigitSequence } from './digits.ts';

/** The bank the assistant speaks for when none is named (Build → Banking → Banking name names it). */
export const DEFAULT_BANK = 'Business Banking';

export type Topic =
  | 'balance'
  | 'accounts'
  | 'transactions'
  | 'incoming'
  | 'statement'
  | 'deposited_cheques'
  | 'issued_cheque'
  | 'stop_cheque'
  | 'chequebook_status'
  | 'chequebook_request'
  | 'pin_change'
  | 'fx'
  | 'prime'
  | 'deposit_rates'
  | 'branch'
  | 'callback'
  | 'agent'
  | 'lost_card'
  | 'services'
  | 'sign_in'
  | 'sign_out'
  | 'greeting'
  | 'thanks'
  | 'goodbye';

export type Period = 'current_month' | 'previous_month' | 'two_months_ago' | 'older';
export type Region = 'north' | 'south' | 'east' | 'west' | 'central';
export type Delivery = 'same_day' | 'next_day' | 'standard';

export interface BankingRequest {
  topic: Topic;
  /** The customer's own words, for tools that take a reason. */
  words: string;
  cheques?: string[];
  currency?: string;
  period?: Period;
  region?: Region;
  delivery?: Delivery;
  chequeStatus?: 'deposited' | 'returned';
  phone?: string;
}

export const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'JPY', 'HKD', 'CAD', 'NZD', 'IDR'] as const;

const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/\b(usd|us dollars?|american dollars?|u\.s\. dollars?)\b/, 'USD'],
  [/\b(eur|euros?)\b/, 'EUR'],
  [/\b(gbp|pounds?|sterling|british)\b/, 'GBP'],
  [/\b(aud|australian dollars?|aussie)\b/, 'AUD'],
  [/\b(jpy|yen|japanese)\b/, 'JPY'],
  [/\b(hkd|hong kong dollars?)\b/, 'HKD'],
  [/\b(cad|canadian dollars?)\b/, 'CAD'],
  [/\b(nzd|new zealand dollars?|kiwi)\b/, 'NZD'],
  [/\b(idr|rupiah|indonesian)\b/, 'IDR'],
  [/\b(sgd|singapore dollars?)\b/, 'SGD'],
];

const has = (text: string, re: RegExp) => re.test(text);
const normalise = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Six-digit runs (cheque numbers) in the order spoken. */
const chequeNumbers = (text: string) => text.match(/\b\d{6}\b/g) ?? [];

export function pickCurrency(text: string, options: readonly string[] = FX_CURRENCIES): string | null {
  const t = normalise(text);
  for (const [re, code] of CURRENCY_WORDS) if (re.test(t) && options.includes(code)) return code;
  return null;
}

export function pickPeriod(text: string): Period | null {
  const t = normalise(text);
  if (has(t, /\b(this|current) month\b|month to date/)) return 'current_month';
  if (has(t, /\b(last|previous|past) month\b/)) return 'previous_month';
  if (has(t, /\b(two|2) months? ago\b|month before( last)?/)) return 'two_months_ago';
  if (has(t, /\bolder\b|earlier|last year|\b(three|four|five|six|3|4|5|6) months\b/)) return 'older';
  return null;
}

export function pickRegion(text: string): Region | null {
  const m = /\b(north|south|east|west|central)\b/.exec(normalise(text));
  return m ? (m[1] as Region) : null;
}

export function pickDelivery(text: string): Delivery | null {
  const t = normalise(text);
  if (has(t, /same[ -]?day|today/)) return 'same_day';
  if (has(t, /next[ -]?day|tomorrow|express/)) return 'next_day';
  if (has(t, /standard|normal|regular|no rush|free/)) return 'standard';
  return null;
}

// Ways of asking about money coming in, and about past activity: any one of them is enough.
const INCOMING = [
  /\bincoming\b/,
  /\b(funds?|money|payments?|transfers?) (received|in|came|arrived|coming)\b/,
  /\breceived?\b.*\b(funds?|money|payments?|transfers?)\b/,
  /\bgiro\b.*\b(in|received)\b/,
];
const TRANSACTIONS = [/\btransactions?\b/, /\bactivit(y|ies)\b/, /\bhistory\b/, /\brecent (payments?|debits?|credits?)\b/, /\bwhat did i (spend|pay)\b/];

/** What the customer asked for, or null when the words match no banking request. */
export function understand(raw: string): BankingRequest | null {
  const t = normalise(raw);
  if (!t) return null;
  const words = raw.trim();
  const cheques = chequeNumbers(t);
  const cheque = /\b(cheques?|checks?|chq)\b/.test(t);

  if (has(t, /\b(lost|stolen|missing)\b.*\bcard\b|\bcard\b.*\b(lost|stolen|missing)\b|unauthori[sz]ed withdrawal/)) return { topic: 'lost_card', words };
  if (has(t, /\b(sign|log)[ -]?(out|off)\b|logout/)) return { topic: 'sign_out', words };
  if (has(t, /\bstop\b/) && (cheque || has(t, /payment/))) return { topic: 'stop_cheque', words, cheques };
  if (has(t, /cheque ?books?|check ?books?|chequebooks?|checkbooks?/)) {
    return has(t, /\b(sent|status|where|arriv|deliver(ed)?|when|track|dispatched|posted)\b/) && !has(t, /\b(new|order|request|need|another|want)\b/)
      ? { topic: 'chequebook_status', words }
      : { topic: 'chequebook_request', words, delivery: pickDelivery(t) ?? undefined };
  }
  if (has(t, /\bpin\b/) && has(t, /\b(change|reset|new|update|modify|different)\b/)) return { topic: 'pin_change', words };
  if (cheque && has(t, /\b(returned|bounced|bounce|dishonou?red)\b/)) return { topic: 'deposited_cheques', words, chequeStatus: 'returned' };
  if (cheque && cheques.length > 0 && !has(t, /\bdeposit/)) return { topic: 'issued_cheque', words, cheques };
  if (cheque && has(t, /\b(issued|wrote|written|presented|cashed)\b/)) return { topic: 'issued_cheque', words, cheques };
  if (cheque && has(t, /\b(deposit\w*|clear\w*|status|pending)\b/)) return { topic: 'deposited_cheques', words, chequeStatus: 'deposited' };
  if (has(t, /\bstatements?\b/)) return { topic: 'statement', words, period: pickPeriod(t) ?? undefined };
  if (INCOMING.some((p) => has(t, p))) return { topic: 'incoming', words };
  if (TRANSACTIONS.some((p) => has(t, p))) return { topic: 'transactions', words };
  if (has(t, /\bbalances?\b|how much (money )?(do i have|is (there )?in|have i got)|\bfunds? available\b|available funds/))
    return { topic: 'balance', words, currency: pickCurrency(t, ['SGD', ...FX_CURRENCIES]) ?? undefined };
  if (has(t, /\bprime\b/)) return { topic: 'prime', words };
  if (has(t, /\b(fixed|time) deposits?\b|\bdeposit rates?\b|\binterest rates?\b|\bfd rates?\b/)) return { topic: 'deposit_rates', words };
  if (has(t, /\b(exchange|fx|forex|conversion)\b/) || (has(t, /\brates?\b/) && pickCurrency(t) !== null))
    return { topic: 'fx', words, currency: pickCurrency(t) ?? undefined };
  if (has(t, /\bbranch(es)?\b|opening hours|nearest (office|bank)|\baddress\b/)) return { topic: 'branch', words, region: pickRegion(t) ?? undefined };
  if (has(t, /call ?back|call me|ring me|phone me/)) {
    const phone = /\b\d{5,15}\b/.exec(t.replace(/(\d)[ -](?=\d)/g, '$1'))?.[0];
    return { topic: 'callback', words, phone };
  }
  if (has(t, /\b(person|human|someone|agent|service manager|representative|operator|staff|real person|talk to somebody)\b/)) return { topic: 'agent', words };
  if (has(t, /\b(my )?accounts?\b/) && has(t, /\b(show|list|see|view|which|what|my|all)\b/)) return { topic: 'accounts', words };
  if (has(t, /what can you (do|help)|\bhelp\b|\bmenu\b|\bservices\b|\boptions\b/)) return { topic: 'services', words };
  if (has(t, /\b(sign|log)[ -]?in\b|login|\bverify\b|authenticat/)) return { topic: 'sign_in', words };
  // a goodbye wins over a thank-you ("Thanks, goodbye" ends the conversation)
  if (has(t, /\b(bye|goodbye|that's all|that is all|nothing else|end the call)\b/)) return { topic: 'goodbye', words };
  if (has(t, /\b(thanks|thank you|cheers)\b/)) return { topic: 'thanks', words };
  if (has(t, /^(hi|hello|hey|good (morning|afternoon|evening))\b/)) return { topic: 'greeting', words };
  return null;
}

/**
 * The digits in what was said or typed: "1 3 5 7 9 0", "one three five seven nine zero" and "double three" all
 * work. Words that are not digits are ignored, so "my PIN is 135790" gives "135790".
 */
export function spokenDigits(text: string): string {
  return normalizeDigitSequence(text, { context: 'general' });
}

/** Shows only the last `keep` digits of an identifier, for the transcript. */
export const maskDigits = (digits: string, keep = 4) =>
  digits.length <= keep ? '•'.repeat(digits.length) : `${'•'.repeat(Math.min(4, digits.length - keep))}${digits.slice(-keep)}`;

// "The second one": the ordinal decides; a bare number counts only as "number two" / "option two".
const ORDINALS: Array<[RegExp, number]> = [
  [/\b(first|1st|top)\b|\b(number|option|account) (one|1)\b/, 0],
  [/\b(second|2nd)\b|\b(number|option|account) (two|2)\b/, 1],
  [/\b(third|3rd)\b|\b(number|option|account) (three|3)\b/, 2],
  [/\b(fourth|4th)\b|\b(number|option|account) (four|4)\b/, 3],
];

/** Which of the offered accounts the customer means: by last digits, by position, or by a type only one has. */
export function pickAccount(text: string, accounts: readonly AccountView[]): AccountView | null {
  const t = normalise(text);
  const tail = (a: AccountView) => a.ending.replace(/\D/g, '');
  const digitRuns = t.replace(/(\d)[ -](?=\d)/g, '$1').match(/\d{2,}/g) ?? [];
  for (const run of digitRuns) {
    const found = accounts.filter((a) => tail(a).endsWith(run.slice(-4)) || (run.length < 4 && tail(a).endsWith(run)));
    if (found.length === 1) return found[0] ?? null;
  }
  const spoken = spokenDigits(t);
  if (spoken.length >= 3) {
    const found = accounts.filter((a) => tail(a).endsWith(spoken.slice(-4)));
    if (found.length === 1) return found[0] ?? null;
  }
  if (/\b(foreign|usd|eur|currency)\b/.test(t)) {
    const found = accounts.filter((a) => /foreign/i.test(a.type) || a.currencies.some((c) => c !== 'SGD'));
    if (found.length === 1) return found[0] ?? null;
  }
  for (const [re, index] of ORDINALS) if (re.test(t) && accounts[index]) return accounts[index] ?? null;
  return null;
}

/** Routing only: is this a clear no, something that may be a yes (the gateway decides), or neither? */
export function confirmationIntent(text: string): 'no' | 'maybe_yes' | null {
  const t = normalise(text);
  if (/\b(no|nope|cancel|don't|do not|stop|never ?mind|abort)\b/.test(t)) return 'no';
  if (/\b(yes|yeah|yep|yup|confirm|go ahead|proceed|ok|okay|sure|please do|do it|correct)\b/.test(t)) return 'maybe_yes';
  return null;
}

/** Topics that need a verified caller before the gateway will answer. */
export const NEEDS_VERIFICATION: ReadonlySet<Topic> = new Set<Topic>([
  'balance',
  'accounts',
  'transactions',
  'incoming',
  'statement',
  'deposited_cheques',
  'issued_cheque',
  'stop_cheque',
  'chequebook_status',
  'chequebook_request',
  'pin_change',
]);

export const TOPIC_LABEL: Record<Topic, string> = {
  balance: 'check your balance',
  accounts: 'show your accounts',
  transactions: 'show your recent transactions',
  incoming: 'check your incoming funds',
  statement: 'request a statement',
  deposited_cheques: 'check your deposited cheques',
  issued_cheque: 'check that cheque',
  stop_cheque: 'stop that cheque',
  chequebook_status: 'check on your cheque book',
  chequebook_request: 'order a cheque book',
  pin_change: 'change your Phone PIN',
  fx: 'look up an exchange rate',
  prime: 'look up the prime rate',
  deposit_rates: 'look up fixed deposit rates',
  branch: 'find a branch',
  callback: 'arrange a call back',
  agent: 'connect you to a Service Manager',
  lost_card: 'report a lost card',
  services: 'show what I can help with',
  sign_in: 'verify your identity',
  sign_out: 'sign you out',
  greeting: 'help',
  thanks: 'help',
  goodbye: 'help',
};

/** What a request still needs from the customer before its tool can run. */
export type Missing = 'cheque_number' | 'period' | 'currency' | 'phone';

export function missingSlot(request: BankingRequest): Missing | null {
  if ((request.topic === 'issued_cheque' || request.topic === 'stop_cheque') && !request.cheques?.length) return 'cheque_number';
  if (request.topic === 'statement' && !request.period) return 'period';
  if (request.topic === 'fx' && !request.currency) return 'currency';
  return null;
}

/** The gateway tool for a request, with arguments in the tool's own schema. */
export function toolFor(request: BankingRequest, accountRef: string | null): { tool: string; args: Record<string, unknown> } | null {
  const account = accountRef ? { account_ref: accountRef } : {};
  const [first, last] = request.cheques ?? [];
  switch (request.topic) {
    case 'balance':
      return { tool: 'get_balance', args: { ...account, ...(request.currency ? { currency: request.currency } : {}) } };
    case 'accounts':
      return { tool: 'list_accounts', args: {} };
    case 'transactions':
      return { tool: 'get_recent_transactions', args: account };
    case 'incoming':
      return { tool: 'get_incoming_funds', args: account };
    case 'statement':
      return request.period ? { tool: 'prepare_statement_request', args: { ...account, period: request.period } } : null;
    case 'deposited_cheques':
      return { tool: 'get_deposited_cheques', args: { ...account, status: request.chequeStatus ?? 'deposited' } };
    case 'issued_cheque':
      return first ? { tool: 'get_issued_cheque_status', args: { ...account, cheque_number: first } } : null;
    case 'stop_cheque':
      return first
        ? { tool: 'prepare_stop_cheque', args: { ...account, first_cheque: first, ...(last && last !== first ? { last_cheque: last } : {}) } }
        : null;
    case 'chequebook_status':
      return { tool: 'get_chequebook_status', args: account };
    case 'chequebook_request':
      return { tool: 'prepare_chequebook_request', args: { ...account, ...(request.delivery ? { delivery: request.delivery } : {}) } };
    case 'pin_change':
      return { tool: 'start_pin_change', args: {} };
    case 'fx':
      return request.currency ? { tool: 'get_fx_rate', args: { currency: request.currency } } : null;
    case 'prime':
      return { tool: 'get_prime_rate', args: {} };
    case 'deposit_rates':
      return { tool: 'get_time_deposit_rates', args: {} };
    case 'branch':
      return { tool: 'find_branch', args: request.region ? { region: request.region } : {} };
    case 'callback':
      return { tool: 'request_callback', args: { reason: request.words.slice(0, 200), ...(request.phone ? { phone_number: request.phone } : {}) } };
    case 'agent':
      return { tool: 'prepare_agent_transfer', args: { topic: 'general', reason: request.words.slice(0, 200) } };
    case 'lost_card':
      return { tool: 'report_lost_card', args: {} };
    case 'services':
      return { tool: 'list_services', args: {} };
    default:
      return null;
  }
}

// ---- What the assistant shows and says about a result ----

export interface BalanceSnapshot {
  accountRef: string | null;
  accountType: string;
  ending: string;
  currency: string;
  currencies: string[];
  current: string;
  available: string;
  hold: string | null;
  pendingClearance: string | null;
  overdraftLimit: string | null;
  inDebit: boolean;
  facilityNotice: boolean;
  /** When the gateway answered (this screen's clock). */
  retrievedAt: number;
}

export interface ListItem {
  primary: string;
  secondary?: string;
  amount?: string;
  tone?: 'credit' | 'debit' | 'neutral';
}

export type ChoicePurpose = 'account' | 'currency' | 'period' | 'delivery' | 'method' | 'topic';

export type Card =
  | { kind: 'balance'; balance: BalanceSnapshot }
  | { kind: 'list'; title: string; items: ListItem[]; footnote?: string }
  | { kind: 'choices'; purpose: ChoicePurpose; options: Array<{ id: string; label: string; hint?: string }> }
  | { kind: 'notice'; tone: 'success' | 'warning' | 'danger' | 'info'; title: string; text?: string };

export interface Reply {
  text: string;
  card?: Card;
}

type Described = { account_ref?: string | null; type?: string; ending?: string; currencies?: string[] };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const accountName = (a: Described | undefined) => (a?.type && a.ending ? `${a.type} ending ${a.ending.replace(/\D/g, '')}` : 'your account');
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function balanceSnapshot(response: ToolResponse, at: number): BalanceSnapshot {
  const account = (response.account ?? {}) as Described;
  return {
    accountRef: account.account_ref ?? null,
    accountType: account.type ?? 'Account',
    ending: account.ending ?? '',
    currency: str(response.currency) ?? '',
    currencies: account.currencies ?? [],
    current: str(response.current) ?? '',
    available: str(response.available) ?? '',
    hold: str(response.hold),
    pendingClearance: str(response.pending_clearance),
    overdraftLimit: str(response.overdraft_limit),
    inDebit: response.in_debit === true,
    facilityNotice: response.facility_notice === true,
    retrievedAt: at,
  };
}

const txnItems = (response: ToolResponse): ListItem[] =>
  arr<{ date?: string; description?: string; direction?: string; amount?: string; today?: boolean }>(response.items).map((i) => ({
    primary: i.description ?? 'Transaction',
    secondary: i.today ? 'Today' : (i.date ?? undefined),
    amount: i.amount ?? undefined,
    tone: i.direction === 'debited' ? 'debit' : i.direction === 'credited' ? 'credit' : 'neutral',
  }));

/** Up to three items read aloud, newest first. */
const readItems = (response: ToolResponse) =>
  arr<{ description?: string; direction?: string; amount_spoken?: string; today?: boolean; date?: string }>(response.items)
    .slice(0, 3)
    .map((i) =>
      `${i.today ? 'today' : `on ${i.date ?? ''}`}, ${i.description ?? 'a transaction'}, ${i.direction ?? ''} ${i.amount_spoken ?? ''}`
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('; ');

/** The reply for a successful tool result. Gateway wording (`say`, `message`, `summary`) is used as written. */
export function describeSuccess(tool: string, response: ToolResponse, at: number): Reply {
  const say = str(response.say);
  const message = str(response.message);
  const account = response.account as Described | undefined;
  switch (tool) {
    case 'get_balance':
      return { text: say ?? 'Here is your balance.', card: { kind: 'balance', balance: balanceSnapshot(response, at) } };
    case 'list_accounts': {
      const accounts = arr<AccountView>(response.accounts);
      return {
        text:
          accounts.length === 1
            ? `You have one account: ${accountName(accounts[0])}.`
            : `You have ${accounts.length} accounts: ${accounts.map(accountName).join('; ')}.`,
        card: {
          kind: 'list',
          title: 'Your accounts',
          items: accounts.map((a) => ({ primary: a.type, secondary: `Ending ${a.ending.replace(/\D/g, '')}`, amount: a.currencies.join(' · ') })),
        },
      };
    }
    case 'get_recent_transactions':
    case 'get_incoming_funds': {
      const items = txnItems(response);
      const title = tool === 'get_incoming_funds' ? 'Incoming funds, last 7 days' : 'Recent transactions';
      if (!items.length) return { text: message ?? 'There is nothing to show.', card: { kind: 'notice', tone: 'info', title, text: message ?? undefined } };
      const total = typeof response.total === 'number' ? response.total : items.length;
      const lead =
        tool === 'get_incoming_funds'
          ? `There ${total === 1 ? 'is 1 incoming payment' : `are ${total} incoming payments`}`
          : `Here ${total === 1 ? 'is your latest transaction' : `are your latest ${Math.min(total, items.length)} of ${total} transactions`}`;
      return {
        text: `${lead} on the ${accountName(account)}. The most recent: ${readItems(response)}.`,
        card: {
          kind: 'list',
          title: `${title} · ${accountName(account)}`,
          items,
          footnote: response.has_more ? `Showing ${items.length} of ${total}. Ask for more to see the next page.` : undefined,
        },
      };
    }
    case 'get_deposited_cheques': {
      const items = arr<{ cheque_number?: string; amount?: string; status?: string; on?: string; reason?: string | null }>(response.items).map((c) => ({
        primary: `Cheque ${c.cheque_number ?? ''}`.trim(),
        secondary: [c.status, c.on, c.reason].filter(Boolean).join(' · '),
        amount: c.amount,
        tone: 'neutral' as const,
      }));
      const pending = str(response.pending_clearance);
      const text = [
        items.length ? `I found ${items.length === 1 ? 'one cheque' : `${items.length} cheques`} on the ${accountName(account)}.` : message,
        pending,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        text: text || 'There is nothing to show.',
        card: items.length
          ? { kind: 'list', title: `Deposited cheques · ${accountName(account)}`, items, footnote: pending ?? undefined }
          : { kind: 'notice', tone: 'info', title: 'Deposited cheques', text: text },
      };
    }
    case 'list_services': {
      const available = arr<{ label: string }>(response.available).map((s) => s.label);
      const locked = arr<string>(response.needs_verification);
      const text = response.authenticated
        ? `I can help with: ${available.join(', ')}.`
        : `Right now I can help with ${available.map((s) => s.toLowerCase()).join(', ') || 'general enquiries'}. Once you're verified I can also help with your balances, transactions, statements, cheques and your Phone PIN.`;
      return {
        text,
        card: {
          kind: 'list',
          title: 'What I can help with',
          items: [
            ...available.map((s) => ({ primary: s, secondary: 'Available now' })),
            ...locked.map((s) => ({ primary: s, secondary: 'After you verify your identity' })),
          ],
        },
      };
    }
    case 'find_branch': {
      const branches = arr<{ name: string; hours?: string; address?: string; region?: string }>(response.branches);
      if (!branches.length) return { text: 'I could not find a branch matching that.' };
      return {
        text:
          branches.length === 1
            ? `${branches[0]?.name}: ${branches[0]?.address}. Opening hours: ${branches[0]?.hours}.`
            : `I found ${branches.length} branches. ${branches.map((b) => `${b.name}, ${b.hours}`).join('. ')}.`,
        card: {
          kind: 'list',
          title: 'Branches',
          items: branches.map((b) => ({ primary: b.name, secondary: [b.address, b.hours].filter(Boolean).join(' · ') })),
        },
      };
    }
    case 'get_time_deposit_rates': {
      const bands = arr<{ fromMonths: number; toMonths: number; rate: string }>(response.bands);
      const span = (b: { fromMonths: number; toMonths: number }) =>
        b.fromMonths === b.toMonths ? `${b.fromMonths} month${b.fromMonths === 1 ? '' : 's'}` : `${b.fromMonths} to ${b.toMonths} months`;
      return {
        text: say ?? 'Here are the fixed deposit rates.',
        card: bands.length
          ? {
              kind: 'list',
              title: 'SGD fixed deposit rates',
              items: bands.map((b) => ({ primary: span(b), amount: `${b.rate}% p.a.` })),
              footnote: str(response.minimum_deposit) ? `Minimum deposit ${String(response.minimum_deposit)}` : undefined,
            }
          : undefined,
      };
    }
    case 'get_fx_rate': {
      const per =
        typeof response.unit === 'number' && response.unit !== 1 ? `${response.unit} ${String(response.currency)}` : `1 ${String(response.currency ?? '')}`;
      return {
        text: say ?? 'Here is the exchange rate.',
        card: {
          kind: 'list',
          title: `Exchange rate · ${per} in SGD`,
          items: [
            { primary: 'Bank sells', amount: str(response.selling) ?? '—' },
            { primary: 'Bank buys', amount: str(response.buying) ?? '—' },
          ],
          footnote: 'Indicative rates from the bank system.',
        },
      };
    }
    case 'get_prime_rate':
      return {
        text: say ?? 'Here is the prime rate.',
        card: str(response.rate)
          ? { kind: 'list', title: 'Prime rate', items: [{ primary: 'Prime lending rate', amount: `${String(response.rate)}% p.a.` }] }
          : undefined,
      };
    case 'prepare_statement_request':
    case 'prepare_stop_cheque':
    case 'prepare_chequebook_request': {
      const summary = str(response.summary) ?? 'Your request is ready.';
      const charge = str(response.charge);
      const notice = str(response.notice);
      return {
        text: `${notice ? `${notice} ` : ''}${summary}${charge ? ` There is a charge of ${charge}.` : ''} Shall I go ahead? Say yes to confirm, or no to cancel. You can also use the card on screen.`,
      };
    }
    case 'start_pin_change':
      return { text: 'Sure. For your security, please key in your current Phone PIN on the secure keypad.' };
    case 'request_callback':
      return {
        text: message ?? 'Your call back request has been recorded.',
        card: {
          kind: 'notice',
          tone: response.created ? 'success' : 'info',
          title: response.created ? 'Call back requested' : 'Call back already requested',
          text: str(response.number_ending) ? `To the number ending ${String(response.number_ending).replace(/\D/g, '')}` : undefined,
        },
      };
    case 'prepare_agent_transfer': {
      if (response.within_hours === false)
        return {
          text: 'Our Commercial Service Centre is open 8:30am to 6:00pm, Monday to Friday. I can arrange for a Service Manager to call you back instead. Would you like that?',
        };
      const ref = str(response.context_id);
      return {
        text: `I'll connect you to a Service Manager.${ref ? ` Your reference is ${ref}.` : ''} In this test environment no call is transferred.`,
        card: {
          kind: 'notice',
          tone: 'info',
          title: 'Transfer to a Service Manager',
          text: `Route ${String(response.route ?? '')}${ref ? ` · reference ${ref}` : ''}. Test environment: the request was logged; no call was transferred.`,
        },
      };
    }
    case 'report_lost_card':
      return {
        text: `I'm sorry to hear that. I've logged this as a priority request${str(response.context_id) ? `, reference ${String(response.context_id)}` : ''}, and I'm transferring you to a Service Manager now. In this test environment no call is transferred.`,
        card: {
          kind: 'notice',
          tone: 'warning',
          title: 'Lost card reported',
          text: `Priority ${String(response.priority ?? '')}. Test environment: no call was transferred.`,
        },
      };
    default:
      return { text: say ?? message ?? 'Done.' };
  }
}

/**
 * The reply for a refused or failed tool result. Choices the gateway asks for become buttons; everything else uses
 * the gateway's own message, never an invented reason.
 */
export function describeRefusal(response: ToolResponse): Reply {
  const code = response.error_code ?? '';
  const message = str(response.error_message) ?? 'Sorry, we are unable to process your request right now.';
  switch (code) {
    case 'choose_account': {
      const accounts = arr<AccountView>(response.accounts);
      return {
        text: `Which account would you like? ${accounts.map((a, i) => `${i === 0 ? '' : i === accounts.length - 1 ? 'or ' : ''}the ${accountName(a)}`).join(', ')}.`,
        card: {
          kind: 'choices',
          purpose: 'account',
          options: accounts.map((a) => ({ id: a.account_ref, label: `${capitalise(a.type)} ${a.ending}`, hint: a.currencies.join(' · ') })),
        },
      };
    }
    case 'choose_currency':
    case 'currency_not_held': {
      const currencies = arr<string>(response.currencies);
      return {
        text: `${code === 'currency_not_held' ? `${message} ` : ''}This account holds ${currencies.join(' and ')}. Which currency would you like?`,
        card: { kind: 'choices', purpose: 'currency', options: currencies.map((c) => ({ id: c, label: c })) },
      };
    }
    case 'choose_delivery': {
      const options = arr<Delivery>(response.options);
      const label: Record<Delivery, string> = { same_day: 'Same day', next_day: 'Next day', standard: 'Standard (about 5 working days)' };
      return {
        text: `${response.error_message && /cut-off/.test(String(response.error_message)) ? `${message} ` : ''}How would you like to receive it: ${options.map((o) => label[o].toLowerCase()).join(', or ')}?`,
        card: { kind: 'choices', purpose: 'delivery', options: options.map((o) => ({ id: o, label: label[o] })) },
      };
    }
    case 'account_not_eligible':
      return {
        text: `${message} Please choose one of these accounts.`,
        card: {
          kind: 'choices',
          purpose: 'account',
          options: arr<AccountView>(response.accounts).map((a) => ({ id: a.account_ref, label: `${capitalise(a.type)} ${a.ending}` })),
        },
      };
    case 'not_entitled':
    case 'no_eligible_account':
      return {
        text: `${message} A Service Manager can help with this.`,
        card: { kind: 'notice', tone: 'warning', title: 'Not available for your access level', text: message },
      };
    case 'locked':
      return { text: message, card: { kind: 'notice', tone: 'danger', title: 'Sign-in is locked', text: message } };
    default: {
      const host = code.includes(':') || code === 'timeout' || code === 'internal' || code === 'outcome_unknown';
      return {
        text: response.next === 'offer_transfer' ? `${message} Would you like me to connect you to a Service Manager?` : message,
        card: host
          ? { kind: 'notice', tone: 'danger', title: code === 'outcome_unknown' ? 'Outcome unknown' : 'The bank system did not complete this', text: message }
          : undefined,
      };
    }
  }
}

/** Prompts for the missing piece of a request. */
export function askFor(missing: Missing): Reply {
  switch (missing) {
    case 'cheque_number':
      return { text: 'Which cheque is it? Please tell me the 6-digit cheque number. For a range, say the first and last numbers.' };
    case 'period':
      return {
        text: 'Which statement would you like: this month, last month, or the month before?',
        card: {
          kind: 'choices',
          purpose: 'period',
          options: [
            { id: 'current_month', label: 'This month' },
            { id: 'previous_month', label: 'Last month' },
            { id: 'two_months_ago', label: 'The month before' },
            { id: 'older', label: 'Older' },
          ],
        },
      };
    case 'currency':
      return {
        text: 'Which currency? For example US dollars, euros or yen.',
        card: { kind: 'choices', purpose: 'currency', options: FX_CURRENCIES.map((c) => ({ id: c, label: c })) },
      };
    case 'phone':
      return { text: 'Which number should a Service Manager call you back on?' };
  }
}

/** The greeting, using the gateway's time-of-day period when it gave one. */
export function greeting(period: string | null, bank: string = DEFAULT_BANK): string {
  const hello = period === 'morning' || period === 'afternoon' || period === 'evening' ? `Good ${period}` : 'Hello';
  return `${hello}, thank you for calling ${bank}. I'm your virtual banking assistant. How can I help you today?`;
}

export const CAPABILITIES =
  'I can help with your account balance, recent transactions, incoming funds, statements, cheques and cheque books, changing your Phone PIN, exchange and deposit rates, branches, or connecting you to a Service Manager. What would you like to do?';

/** The prompt for each secure-entry step; `spoken` adds the voice option when the rehearsal allows it. */
export function secureEntryPrompt(purpose: string, spoken: boolean): string {
  const orSay = spoken ? ', or say the digits' : '';
  switch (purpose) {
    case 'pin':
      return `Thank you. Now please enter your 6-digit Phone PIN on the secure keypad${orSay}.`;
    case 'nric':
      return `Thank you. Please key in the digits of your NRIC or passport number on the secure keypad${orSay}.`;
    case 'otp':
      return `We've sent a one-time password to your registered mobile number. Please key it in on the secure keypad${orSay}.`;
    case 'current_pin':
      return `Please key in your current Phone PIN on the secure keypad${orSay}.`;
    case 'new_pin':
      return `Now key in your new 6-digit Phone PIN${orSay}.`;
    case 'confirm_new_pin':
      return `Please key in the new Phone PIN once more to confirm it${orSay}.`;
    default:
      return `Please use the secure keypad${orSay}.`;
  }
}
