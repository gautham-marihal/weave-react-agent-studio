import { exponentOf, parseDecimal } from '../domain/money.ts';
import type { Account, Money } from '../domain/types.ts';
import { object, string } from '../schema/schema.ts';
import type { Committer } from './account-tools.ts';
import { declined, defineTool, ok, type ToolContext } from './define.ts';
import { accountRefParam, describeAccount, prepareTransaction, PREPARE_FIELDS, spoken } from './helpers.ts';

// Transfers between the verified caller's own accounts. Not in the legacy deck: added for banks whose systems can
// post them (CIMB: a debit and a credit, see src/adapters/cimb.ts). Two-phase like every write: nothing moves until
// the caller confirms the read-back. Every amount is checked here, in code: some hosts (CIMB) accept a negative,
// zero or over-precise amount and would move money the wrong way.

const amountParam = string({
  maxLength: 13,
  pattern: /^\d{1,9}(\.\d{1,2})?$/,
  patternHint: 'must be an amount such as 250 or 250.50',
  description: 'How much to move, in the accounts\' currency, as digits (e.g. "250.50"). Ask the caller; never guess.',
});

const listed = (ctx: ToolContext, accounts: readonly Account[]) => accounts.map((a) => describeAccount(ctx, a));
const named = (ctx: ToolContext, a: Account) => {
  const d = describeAccount(ctx, a);
  return `${d.type} ending ${d.ending.replace(/\D/g, '')}`;
};

export const prepareOwnTransfer = defineTool({
  name: 'prepare_own_transfer',
  agents: ['payments'],
  description:
    'Prepare a transfer between two of the verified caller\'s own accounts, in one currency. Nothing moves until the caller confirms via confirm_transaction. Leave out an account_ref the caller has not named: the result lists the choices (choose_from_account / choose_to_account). Transfers to anyone else are not offered.',
  access: 'entitled',
  service: 'own_transfer',
  effect: 'prepare',
  params: object({ from_account_ref: accountRefParam, to_account_ref: accountRefParam, amount: amountParam }, ['amount']),
  llmFields: [...PREPARE_FIELDS],
  timeoutMs: 8_000,
  legacy: 'Not in the deck: own-account transfer',
  async handler(ctx, args) {
    const eligible = ctx.eligibleAccounts('own_transfer').filter((a) => a.currencies.length === 1);
    if (eligible.length < 2) return declined('no_second_account', 'A transfer needs two of the caller\'s own single-currency accounts; they do not have two.', 'continue');
    const byRef = (ref: string) => eligible.find((a) => a.number === ctx.session.accountRefs[ref]) ?? null;

    const from = args.from_account_ref ? byRef(args.from_account_ref) : null;
    if (args.from_account_ref && !from) return declined('account_not_eligible', 'That account cannot be used for a transfer.', 'ask_again', { accounts: listed(ctx, eligible) });
    if (!from) return declined('choose_from_account', 'Ask which account the money should come from.', 'ask_again', { accounts: listed(ctx, eligible) });

    const currency = from.currencies[0] as string;
    const targets = eligible.filter((a) => a.number !== from.number && a.currencies[0] === currency);
    if (targets.length === 0) return declined('no_matching_account', `The caller has no other ${currency} account to move money to.`, 'continue');
    let to = args.to_account_ref ? byRef(args.to_account_ref) : null;
    if (args.to_account_ref && (!to || !targets.includes(to))) {
      return declined('account_not_eligible', `That account cannot receive it: it must be another of the caller's own ${currency} accounts.`, 'ask_again', { accounts: listed(ctx, targets) });
    }
    if (!to) {
      if (targets.length > 1) return declined('choose_to_account', 'Ask which account the money should go to.', 'ask_again', { accounts: listed(ctx, targets) });
      to = targets[0] as Account;
    }

    let amount: Money;
    try {
      amount = parseDecimal(args.amount, currency);
    } catch {
      return declined('bad_amount', `Ask for the amount again: ${currency} allows ${exponentOf(currency)} decimal places.`, 'ask_again');
    }
    if (amount.minor <= 0) return declined('bad_amount', 'The amount must be more than zero. Ask for it again.', 'ask_again');
    const limit: Money = { minor: ctx.policy.ownTransfer.maxMajorUnits * 10 ** exponentOf(currency), currency };
    if (amount.minor > limit.minor) return declined('over_limit', `The most one transfer can move here is ${spoken(limit).spoken}. Ask for a smaller amount.`, 'ask_again');

    const balance = await ctx.ports.core.getBalance(from.number, currency, ctx.signal);
    if (balance.available.minor < amount.minor) {
      return declined('insufficient_funds', `That is more than the available balance of ${spoken(balance.available).spoken} in the ${named(ctx, from)}. Ask for a smaller amount.`, 'ask_again');
    }
    return prepareTransaction(ctx, {
      service: 'own_transfer',
      summary: `Transfer ${spoken(amount).display} from your ${named(ctx, from)} to your ${named(ctx, to)}.`,
      charge: null,
      payload: { from: from.number, to: to.number, minor: amount.minor, currency },
    });
  },
});

export const commitOwnTransfer: Committer = async (ctx, txn) => {
  const { from, to, minor, currency } = txn.payload as { from: string; to: string; minor: number; currency: string };
  const amount: Money = { minor, currency };
  const { reference } = await ctx.ports.core.transferOwn(from, to, amount, txn.idempotencyKey, ctx.signal);
  return ok({ done: true, reference, message: `${capitalised(spoken(amount).spoken)} has been moved between your accounts.` });
};

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const TRANSFER_TOOLS = [prepareOwnTransfer];
