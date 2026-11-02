import { addDays, localParts } from '../domain/time.ts';
import type { Money, PreparedTransaction } from '../domain/types.ts';
import type { TransactionRecord } from '../ports/ports.ts';
import { empty, object, oneOf, string } from '../schema/schema.ts';
import { ROUTES } from './routing.ts';
import { declined, defineTool, ok, type ToolContext, type ToolOutcome } from './define.ts';
import { accountRefParam, describeAccount, pageParam, paginate, prepareTransaction, PREPARE_FIELDS, resolveAccount, spoken } from './helpers.ts';

export type Committer = (ctx: ToolContext, txn: PreparedTransaction) => Promise<ToolOutcome>;

export const listAccounts = defineTool({
  name: 'list_accounts',
  agents: ['accounts', 'cheques'],
  description: 'List the verified caller\'s accounts as references (A1, A2…), type and last four digits. Use the reference in other tools. Never read out or ask for a full account number.',
  access: 'authenticated',
  service: null,
  effect: 'read',
  params: empty(),
  llmFields: ['accounts'],
  timeoutMs: 2_000,
  legacy: 'p42 Multiple A/C, p43 Multiple ACU',
  async handler(ctx) {
    const auth = ctx.session.auth;
    if (auth.kind !== 'authenticated') return declined('not_authenticated', 'The caller is not verified.', 'start_authentication');
    return ok({ accounts: auth.customer.accounts.filter((a) => !a.dormant).map((a) => describeAccount(ctx, a)) });
  },
});

export const getBalance = defineTool({
  name: 'get_balance',
  agents: ['accounts'],
  description: 'Current and available balance of a current or foreign currency account. Read `say` to the caller as written; it already follows the bank\'s wording for debit balances, holds and overdraft limits.',
  access: 'entitled',
  service: 'account_balance',
  effect: 'read',
  params: object({
    account_ref: accountRefParam,
    currency: string({ maxLength: 3, pattern: /^[A-Z]{3}$/, patternHint: 'must be a 3-letter currency code', description: 'For a multi-currency account, which currency (e.g. USD).' }),
  }),
  llmFields: ['say', 'account', 'currency', 'current', 'available', 'in_debit', 'hold', 'pending_clearance', 'overdraft_limit', 'facility_notice', 'currencies'],
  timeoutMs: 8_000,
  legacy: 'p4 A/C Balance (11000000), p5 Single CA/ACU Balance, p43 currency choice',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'account_balance', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const { account } = resolved;
    let currency = args.currency ?? null;
    if (account.currencies.length > 1 && !currency) {
      const currencies = await ctx.ports.core.listCurrencies(account.number, ctx.signal);
      return declined('choose_currency', 'This account holds several currencies. Ask which one.', 'ask_again', { currencies });
    }
    currency ??= account.currencies[0] ?? 'SGD';
    if (!account.currencies.includes(currency)) return declined('currency_not_held', `This account does not hold ${currency}.`, 'ask_again', { currencies: account.currencies });

    const b = await ctx.ports.core.getBalance(account.number, currency, ctx.signal);
    const say: string[] = [];
    if (b.omnibus) say.push('Please take note that the availability of balances for utilisation is subject to the facility limits for omnibus and/or shared facilities.');
    say.push(balanceLine('Your account balance', b.current));
    say.push(balanceLine('Your available balance', b.available));
    if (b.current.minor !== b.available.minor) {
      const hold = b.holdAmount.minor !== 0;
      const pending = b.chequesPendingClearance.minor !== 0;
      if (hold && pending) say.push(`The difference is due to cheques pending clearance of ${signed(b.chequesPendingClearance)} and a hold amount of ${signed(b.holdAmount)}.`);
      else if (b.holdAmount.minor > 0) say.push(`The difference is due to a hold amount of ${signed(b.holdAmount)}.`);
      else if (b.chequesPendingClearance.minor > 0) say.push(`The difference is due to cheques pending clearance of ${signed(b.chequesPendingClearance)}.`);
    }
    if (b.overdraftLimit && b.overdraftLimit.minor > 0) say.push(`Your overdraft limit is ${spoken(b.overdraftLimit).spoken}.`);
    return ok({
      say: say.join(' '),
      account: describeAccount(ctx, account),
      currency,
      current: spoken(b.current).display,
      available: spoken(b.available).display,
      in_debit: b.current.minor < 0 || b.available.minor < 0,
      // The same amounts `say` reads, for screens that show them separately (null when the host reports none).
      hold: b.holdAmount.minor !== 0 ? spoken(b.holdAmount).display : null,
      pending_clearance: b.chequesPendingClearance.minor !== 0 ? spoken(b.chequesPendingClearance).display : null,
      overdraft_limit: b.overdraftLimit && b.overdraftLimit.minor > 0 ? spoken(b.overdraftLimit).display : null,
      facility_notice: b.omnibus,
    });
  },
});

/** Deck p5: a negative balance is read as "in debit of"; prompts 1020/1021, 1022/1023. */
function balanceLine(label: string, money: Money): string {
  const s = spoken(money);
  return s.negative ? `${label} is in debit of ${s.spoken}.` : `${label} is ${s.spoken}.`;
}

/** Deck p5 note: a negative hold or pending amount is read with the word "negative" in front. */
const signed = (money: Money) => `${money.minor < 0 ? 'negative ' : ''}${spoken(money).spoken}`;

function describeTxn(t: TransactionRecord, today: string) {
  const s = spoken(t.amount);
  return { date: t.postedOn, today: t.postedOn === today, description: t.description, direction: s.negative ? 'debited' : 'credited', amount: s.display, amount_spoken: s.spoken };
}

export const getIncomingFunds = defineTool({
  name: 'get_incoming_funds',
  agents: ['accounts'],
  description: 'Incoming funds (GIRO, local and overseas transfers) received in the last 7 calendar days, newest first, 9 per page. Mention today\'s items first.',
  access: 'entitled',
  service: 'incoming_funds',
  effect: 'read',
  params: object({ account_ref: accountRefParam, page: pageParam }),
  llmFields: ['account', 'items', 'page', 'has_more', 'total', 'message'],
  timeoutMs: 8_000,
  legacy: 'p6 Incoming Fund (12000000): last 7 days, 9 per page, "For today" first',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'incoming_funds', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const today = localParts(ctx.now).date;
    const records = await ctx.ports.core.incomingFunds(resolved.account.number, addDays(today, -ctx.policy.lookbackDays), ctx.signal);
    if (records.length === 0) return ok({ account: describeAccount(ctx, resolved.account), items: [], total: 0, has_more: false, page: 1, message: 'There were no incoming funds received in the last 7 days.' });
    const page = paginate(records, args.page, ctx.policy.pageSize);
    return ok({ account: describeAccount(ctx, resolved.account), items: page.items.map((t) => describeTxn(t, today)), page: page.page, has_more: page.has_more, total: page.total });
  },
});

export const getRecentTransactions = defineTool({
  name: 'get_recent_transactions',
  agents: ['accounts'],
  description: 'The most recent account transactions (up to 15), newest first, 9 per page.',
  access: 'entitled',
  service: 'recent_activity',
  effect: 'read',
  params: object({ account_ref: accountRefParam, page: pageParam }),
  llmFields: ['account', 'items', 'page', 'has_more', 'total', 'message'],
  timeoutMs: 8_000,
  legacy: 'p7 Acc Activities (13000000): max 15, most recent first, >9 → "press # for more"',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'recent_activity', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const records = await ctx.ports.core.recentTransactions(resolved.account.number, ctx.policy.maxRecentTransactions, ctx.signal);
    if (records.length === 0) return ok({ account: describeAccount(ctx, resolved.account), items: [], total: 0, has_more: false, page: 1, message: 'There is no account activity.' });
    const today = localParts(ctx.now).date;
    const page = paginate(records.slice(0, ctx.policy.maxRecentTransactions), args.page, ctx.policy.pageSize);
    return ok({ account: describeAccount(ctx, resolved.account), items: page.items.map((t) => describeTxn(t, today)), page: page.page, has_more: page.has_more, total: page.total });
  },
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthBack(date: string, back: number): { key: string; label: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) - back;
  const year = Math.floor(index / 12);
  const month = index % 12;
  return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${MONTHS[month]} ${year}` };
}

export const prepareStatementRequest = defineTool({
  name: 'prepare_statement_request',
  agents: ['accounts'],
  description: 'Prepare a request for a current-account statement (this month, last month or the month before). Nothing is sent until the caller confirms via confirm_transaction. Older statements: offer a Service Manager.',
  access: 'entitled',
  service: 'statement_request',
  effect: 'prepare',
  params: object({ account_ref: accountRefParam, period: oneOf(['current_month', 'previous_month', 'two_months_ago', 'older'] as const) }, ['period']),
  llmFields: [...PREPARE_FIELDS],
  timeoutMs: 2_000,
  legacy: 'p8 Req Statement (14000000); option 4 (earlier) → agent transfer',
  async handler(ctx, args) {
    if (args.period === 'older') return declined('needs_agent', 'Statements older than two months are handled by a Service Manager.', 'offer_transfer');
    const resolved = resolveAccount(ctx, 'statement_request', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const today = localParts(ctx.now).date;
    const back = { current_month: 0, previous_month: 1, two_months_ago: 2 }[args.period];
    const month = monthBack(today, back);
    // Deck p8: for the current month, read the start date and today's date.
    const span = back === 0 ? `from 1 ${month.label} to ${Number(today.slice(8))} ${month.label}` : `for ${month.label}`;
    const ending = describeAccount(ctx, resolved.account).ending;
    return prepareTransaction(ctx, {
      service: 'statement_request',
      summary: `A statement ${span} for the current account ending ${ending.slice(-4)}, sent to you within 7 working days.`,
      charge: null,
      payload: { accountNumber: resolved.account.number, month: month.key },
    });
  },
});

export const commitStatement: Committer = async (ctx, txn) => {
  const { accountNumber, month } = txn.payload as { accountNumber: string; month: string };
  const { reference } = await ctx.ports.core.requestStatement(accountNumber, month, txn.idempotencyKey, ctx.signal);
  const route = ROUTES.statement_request;
  await ctx.recordServiceRequest({ customerId: customerIdOf(ctx), type: route.type, category: route.category, subCategory: route.subCategory, priority: 'normal', note: `Statement ${month}; ref ${reference}` }, txn.idempotencyKey);
  return ok({ done: true, reference, message: 'Your statement will be sent to you within 7 working days.' });
};

export const customerIdOf = (ctx: ToolContext) => (ctx.session.auth.kind === 'authenticated' ? ctx.session.auth.customer.customerId : null);

export const ACCOUNT_TOOLS = [listAccounts, getBalance, getIncomingFunds, getRecentTransactions, prepareStatementRequest];
