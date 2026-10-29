import { addDays, clockMinutes, localParts } from '../domain/time.ts';
import type { Money } from '../domain/types.ts';
import { object, oneOf } from '../schema/schema.ts';
import { customerIdOf, type Committer } from './account-tools.ts';
import { declined, defineTool, ok, type ToolContext } from './define.ts';
import { accountRefParam, chequeNumber, describeAccount, pageParam, paginate, prepareTransaction, PREPARE_FIELDS, resolveAccount, spoken } from './helpers.ts';
import { ROUTES } from './routing.ts';

export const getDepositedCheques = defineTool({
  name: 'get_deposited_cheques',
  agents: ['cheques'],
  description: 'Cheques deposited into, or returned on, an account in the last 7 calendar days. Returned cheques include the reason. Also reports cheques still pending clearance.',
  access: 'entitled',
  service: 'cheque_deposit_status',
  effect: 'read',
  params: object({ account_ref: accountRefParam, status: oneOf(['deposited', 'returned'] as const), page: pageParam }, ['status']),
  llmFields: ['account', 'pending_clearance', 'items', 'page', 'has_more', 'total', 'message'],
  timeoutMs: 8_000,
  legacy: 'p11 Status of Cheque Deposit (21000000)',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'cheque_deposit_status', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const { account } = resolved;
    const today = localParts(ctx.now).date;
    const [balance, cheques] = await Promise.all([
      ctx.ports.core.getBalance(account.number, account.currencies[0] ?? 'SGD', ctx.signal),
      ctx.ports.core.depositedCheques(account.number, args.status, addDays(today, -ctx.policy.lookbackDays), ctx.signal),
    ]);
    const pending = balance.chequesPendingClearance.minor > 0 ? `There are cheques pending clearance of ${spoken(balance.chequesPendingClearance).spoken}.` : null;
    if (cheques.length === 0) {
      return ok({ account: describeAccount(ctx, account), pending_clearance: pending, items: [], total: 0, has_more: false, page: 1, message: `There were no cheques ${args.status} in the last 7 days.` });
    }
    const page = paginate(cheques, args.page, ctx.policy.pageSize);
    return ok({
      account: describeAccount(ctx, account),
      pending_clearance: pending,
      items: page.items.map((c) => ({ cheque_number: c.chequeNumber, amount: spoken(c.amount).display, amount_spoken: spoken(c.amount).spoken, status: c.status, on: c.on, today: c.on === today, reason: c.returnReason })),
      page: page.page,
      has_more: page.has_more,
      total: page.total,
    });
  },
});

export const getIssuedChequeStatus = defineTool({
  name: 'get_issued_cheque_status',
  agents: ['cheques'],
  description: 'Status of one cheque the caller issued (presented, stopped, cleared, returned, not presented), by its 6-digit cheque number.',
  access: 'entitled',
  service: 'cheque_issued_status',
  effect: 'read',
  params: object({ account_ref: accountRefParam, cheque_number: chequeNumber('The 6-digit cheque number.') }, ['cheque_number']),
  llmFields: ['say', 'status', 'cheque_number'],
  timeoutMs: 8_000,
  legacy: 'p12 Status of Cheque Issued (22000000)',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'cheque_issued_status', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const c = await ctx.ports.core.issuedChequeStatus(resolved.account.number, args.cheque_number, ctx.signal);
    const n = args.cheque_number;
    const say =
      c.status === 'not_on_record'
        ? `We are unable to confirm cheque number ${n}.`
        : c.status === 'not_presented'
          ? `Cheque number ${n} was not presented.`
          : c.status === 'returned'
            ? `Cheque number ${n} was returned${c.returnReason ? ` due to ${c.returnReason}` : ''}.`
            : `Cheque number ${n}${c.amount && c.amount.minor > 0 ? ` of ${spoken(c.amount).spoken}` : ''} was ${c.status}${c.on ? ` on ${c.on}` : ''}.`;
    return ok({ say, status: c.status, cheque_number: n });
  },
});

export const getChequebookStatus = defineTool({
  name: 'get_chequebook_status',
  agents: ['cheques'],
  description: 'Whether cheque books have been issued for an account, when the last one was issued and its last cheque number.',
  access: 'entitled',
  service: 'chequebook_status',
  effect: 'read',
  params: object({ account_ref: accountRefParam }),
  llmFields: ['say', 'count'],
  timeoutMs: 8_000,
  legacy: 'p13 Last Chq Bk Announcement (23000000): host code 90 = none issued; > 40 reads "more than forty"',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'chequebook_status', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const books = await ctx.ports.core.chequebooks(resolved.account.number, ctx.signal);
    const latest = books[0];
    if (!latest) return ok({ say: 'No cheque book has been issued.', count: 0 });
    const count = books.length > 40 ? 'More than forty' : String(books.length);
    const noun = books.length === 1 ? 'cheque book has' : 'cheque books have';
    return ok({ say: `${count} ${noun} been issued. The latest was issued on ${latest.issuedOn}, ending with cheque number ${latest.lastChequeNumber}.`, count: books.length });
  },
});

type Delivery = 'same_day' | 'next_day' | 'standard';

/** Deck p14: same-day before 10AM, next-day before 3PM; the option is not offered after its cut-off. */
async function deliveryOptions(ctx: ToolContext): Promise<Delivery[]> {
  const local = localParts(ctx.now);
  const businessDay = local.weekday >= 1 && local.weekday <= 5 && !(await ctx.ports.content.isHoliday(local.date, ctx.signal));
  const options: Delivery[] = [];
  if (businessDay && local.minutes < clockMinutes(ctx.policy.chequebook.sameDayCutoff)) options.push('same_day');
  if (businessDay && local.minutes < clockMinutes(ctx.policy.chequebook.nextDayCutoff)) options.push('next_day');
  options.push('standard');
  return options;
}

export const prepareChequebookRequest = defineTool({
  name: 'prepare_chequebook_request',
  agents: ['cheques'],
  description: 'Prepare a new cheque book request. delivery: same_day (before 10am, charged), next_day (before 3pm, charged) or standard (within five working days). Call without delivery first to learn which options are open now. Nothing is sent until confirm_transaction.',
  access: 'entitled',
  service: 'chequebook_request',
  effect: 'prepare',
  params: object({ account_ref: accountRefParam, delivery: oneOf(['same_day', 'next_day', 'standard'] as const) }),
  llmFields: [...PREPARE_FIELDS, 'options'],
  timeoutMs: 3_000,
  legacy: 'p14 Cheque Bk Request (24000000)',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'chequebook_request', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const options = await deliveryOptions(ctx);
    if (!args.delivery || !options.includes(args.delivery)) {
      return declined('choose_delivery', args.delivery ? 'That delivery option is past its cut-off time today.' : 'Ask how the caller wants to receive the cheque book.', 'ask_again', { options });
    }
    const currency = resolved.account.currencies[0] ?? 'SGD';
    const charge: Money | null = args.delivery === 'standard' ? null : (ctx.policy.chequebook.charges[args.delivery][currency] ?? null);
    const when = { same_day: 'today', next_day: 'by the next day', standard: 'within five working days' }[args.delivery];
    const ending = describeAccount(ctx, resolved.account).ending.slice(-4);
    return prepareTransaction(ctx, {
      service: 'chequebook_request',
      summary: `A new cheque book for the account ending ${ending}, delivered ${when}${charge ? `, with a charge of ${spoken(charge).spoken}` : ''}.`,
      charge,
      payload: { accountNumber: resolved.account.number, delivery: args.delivery },
    });
  },
});

export const commitChequebook: Committer = async (ctx, txn) => {
  const { accountNumber, delivery } = txn.payload as { accountNumber: string; delivery: Delivery };
  const { reference } = await ctx.ports.core.requestChequebook(accountNumber, delivery, txn.idempotencyKey, ctx.signal);
  const route = ROUTES.chequebook_request;
  const sub = { standard: 'CHEQUE BOOK REQ - NORMAL', next_day: 'CHEQUE BOOK REQ - EXPRESS DELIVERY', same_day: 'CHEQUE BOOK REQ - SAME DAY DELIVERY' }[delivery];
  await ctx.recordServiceRequest({ customerId: customerIdOf(ctx), type: route.type, category: route.category, subCategory: sub, priority: 'normal', note: `ref ${reference}` }, txn.idempotencyKey);
  return ok({ done: true, reference, message: 'Your cheque book will be sent.' });
};

export const prepareStopCheque = defineTool({
  name: 'prepare_stop_cheque',
  agents: ['cheques'],
  description: 'Prepare a stop-payment instruction for one cheque (first_cheque only) or a range (first_cheque and last_cheque, at most 50 cheques in the same cheque book). A charge applies. Nothing is sent until confirm_transaction.',
  access: 'entitled',
  service: 'stop_cheque',
  effect: 'prepare',
  params: object({ account_ref: accountRefParam, first_cheque: chequeNumber('The 6-digit cheque number (the first one, for a range).'), last_cheque: chequeNumber('For a range: the last 6-digit cheque number.') }, ['first_cheque']),
  llmFields: [...PREPARE_FIELDS, 'notice'],
  timeoutMs: 8_000,
  legacy: 'p15 Stop Pymt (25000000), p16 Stop Pymt 2 (host codes 192/196/343)',
  async handler(ctx, args) {
    const resolved = resolveAccount(ctx, 'stop_cheque', args.account_ref);
    if ('outcome' in resolved) return resolved.outcome;
    const first = Number(args.first_cheque);
    const last = Number(args.last_cheque ?? args.first_cheque);
    if (last < first) return declined('range_order', 'The last cheque number must not be lower than the first.', 'ask_again');
    const count = last - first + 1;
    if (count > ctx.policy.stopCheque.maxRange) {
      return declined('range_too_large', `The cheque range is invalid. Please enter at most ${ctx.policy.stopCheque.maxRange} cheques within the same cheque book.`, 'ask_again');
    }
    const books = await ctx.ports.core.chequebooks(resolved.account.number, ctx.signal);
    const sameBook = books.some((b) => Number(b.firstChequeNumber) <= first && last <= Number(b.lastChequeNumber));
    if (books.length > 0 && !sameBook) return declined('range_across_books', 'The cheque range must be within the same cheque book.', 'ask_again');

    const local = localParts(ctx.now);
    const late = local.weekday >= 1 && local.weekday <= 5 && local.minutes >= clockMinutes(ctx.policy.stopCheque.clearingCutoff);
    const charge = count === 1 ? ctx.policy.stopCheque.chargeSingle : ctx.policy.stopCheque.chargeRange;
    const which = count === 1 ? `cheque number ${args.first_cheque}` : `cheque numbers ${args.first_cheque} to ${args.last_cheque}`;
    const ending = describeAccount(ctx, resolved.account).ending.slice(-4);
    const outcome = prepareTransaction(ctx, {
      service: 'stop_cheque',
      summary: `Stop payment on ${which} for the account ending ${ending}, with a charge of ${spoken(charge).spoken}.`,
      charge,
      payload: { accountNumber: resolved.account.number, from: args.first_cheque, to: args.last_cheque ?? args.first_cheque, count },
    });
    return outcome.status === 'ok' && late
      ? { ...outcome, data: { ...outcome.data, notice: 'Instructions placed after 7 PM on weekdays will not be effective for cheques presented for clearing today.' } }
      : outcome;
  },
});

export const commitStopCheque: Committer = async (ctx, txn) => {
  const { accountNumber, from, to, count } = txn.payload as { accountNumber: string; from: string; to: string; count: number };
  await ctx.ports.core.stopCheques(accountNumber, from, to, txn.idempotencyKey, ctx.signal);
  const route = ROUTES.stop_cheque;
  await ctx.recordServiceRequest({ customerId: customerIdOf(ctx), type: route.type, category: route.category, subCategory: route.subCategory, priority: 'normal', note: `Stop ${from}-${to}` }, txn.idempotencyKey);
  return ok({ done: true, message: count === 1 ? 'Your cheque has been stopped.' : 'Your cheques have been stopped.' });
};

export const CHEQUE_TOOLS = [getDepositedCheques, getIssuedChequeStatus, getChequebookStatus, prepareChequebookRequest, prepareStopCheque];
