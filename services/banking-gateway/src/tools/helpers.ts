import { speakAmount } from '../domain/money.ts';
import type { Account, Money, PreparedTransaction, ServiceId } from '../domain/types.ts';
import { digits, integer, string } from '../schema/schema.ts';
import { newId } from '../security/crypto.ts';
import { maskTail } from '../security/redact.ts';
import { declined, ok, type ToolContext, type ToolOutcome } from './define.ts';

// Shared pieces for account and transaction tools.

const TYPE_LABEL: Record<Account['type'], string> = {
  CA: 'current account',
  ACU: 'foreign currency account',
  ACU_CHQ: 'foreign currency checking account',
  ACU_CALL: 'foreign currency call account',
};

/** What the model may know about an account: an opaque reference, the type and the last four digits. */
export function describeAccount(ctx: ToolContext, account: Account) {
  const ref = Object.entries(ctx.session.accountRefs).find(([, number]) => number === account.number)?.[0] ?? null;
  return { account_ref: ref, type: TYPE_LABEL[account.type], ending: maskTail(account.number), currencies: account.currencies };
}

export const accountRefParam = string({
  maxLength: 4,
  pattern: /^A\d{1,3}$/,
  patternHint: 'must be an account_ref from list_accounts, such as A1',
  description: 'The account_ref from list_accounts. Leave out when the caller has only one eligible account.',
});

/**
 * Deck p4/p42: one eligible account → use it without asking; several → the caller chooses. Returns the account or
 * a declined outcome listing the choices (references and last four digits only).
 */
export function resolveAccount(ctx: ToolContext, service: ServiceId, ref: string | undefined): { account: Account } | { outcome: ToolOutcome } {
  const eligible = ctx.eligibleAccounts(service);
  if (ref === undefined) {
    if (eligible.length === 1) return { account: eligible[0] as Account };
    return {
      outcome: declined('choose_account', 'Ask which account the caller means.', 'ask_again', { accounts: eligible.map((a) => describeAccount(ctx, a)) }),
    };
  }
  const number = ctx.session.accountRefs[ref];
  const account = eligible.find((a) => a.number === number);
  if (!account) {
    return {
      outcome: declined('account_not_eligible', 'That account cannot be used for this service.', 'ask_again', { accounts: eligible.map((a) => describeAccount(ctx, a)) }),
    };
  }
  return { account };
}

export const spoken = (money: Money) => speakAmount(money);

/**
 * Two-phase write, step one. Nothing reaches a host until the caller confirms. The confirmation id is random so the
 * model cannot invent one; the summary is built here, not by the model, so what is read back is what will run.
 */
export function prepareTransaction(
  ctx: ToolContext,
  draft: { service: PreparedTransaction['service']; summary: string; charge: Money | null; payload: Record<string, unknown> },
): ToolOutcome {
  const txn: PreparedTransaction = {
    id: newId('cnf'),
    service: draft.service,
    summary: draft.summary,
    charge: draft.charge,
    payload: draft.payload,
    idempotencyKey: newId('idem'),
    preparedAt: ctx.now,
    expiresAt: ctx.now + ctx.policy.confirmationTtlMs,
  };
  ctx.dispatch({ type: 'TXN_PREPARED', txn });
  ctx.announceConfirmation(txn.id, txn.summary, txn.expiresAt);
  return ok(
    {
      confirmation_id: txn.id,
      summary: txn.summary,
      charge: txn.charge ? spoken(txn.charge).spoken : null,
      expires_in_s: Math.round(ctx.policy.confirmationTtlMs / 1000),
      message: 'Read the summary to the caller word for word, then ask them to confirm or cancel. Pass their exact reply to confirm_transaction.',
    },
    'confirm_or_cancel',
  );
}

export const PREPARE_FIELDS = ['confirmation_id', 'summary', 'charge', 'expires_in_s', 'message', 'accounts'] as const;

export const pageParam = integer({ min: 1, max: 20, description: 'Page of results, from 1. Ask for the next page only when has_more was true.' });
export const chequeNumber = (description: string) => digits(6, description);

/** Splits a list into pages of policy.pageSize (deck: 9 records, "press # for more"). */
export function paginate<T>(items: readonly T[], page: number | undefined, size: number) {
  const index = (page ?? 1) - 1;
  return { items: items.slice(index * size, (index + 1) * size), page: index + 1, has_more: items.length > (index + 1) * size, total: items.length };
}
