import type { PreparedTransaction } from '../domain/types.ts';
import { currentTxn } from '../fsm/session-machine.ts';
import { object, string } from '../schema/schema.ts';
import { commitStatement, type Committer } from './account-tools.ts';
import { commitAppointmentBooking, commitAppointmentCancellation } from './appointment-tools.ts';
import { commitChequebook, commitStopCheque } from './cheque-tools.ts';
import { declined, defineTool, ok, type ToolContext, type ToolOutcome } from './define.ts';

// Step two of every write. Confirmation is checked in code against the caller's own words, so a model cannot
// confirm on the caller's behalf by "deciding" they agreed. In chat, the confirmation card's buttons post directly
// to the gateway (POST /v1/channel/confirm) and bypass the model entirely.

export const COMMITTERS: Readonly<Record<PreparedTransaction['service'], Committer>> = {
  statement_request: commitStatement,
  chequebook_request: commitChequebook,
  stop_cheque: commitStopCheque,
  appointment_book: commitAppointmentBooking,
  appointment_cancel: commitAppointmentCancellation,
};

const NEGATION = /\b(no|nope|not|don'?t|do not|cancel|stop|wait|hold on|wrong|never)\b|不|别|取消/i;
// `(?![a-z0-9])` rather than `\b`: \b never matches after a CJK character, so "是的" would never count.
// eslint-disable-next-line sonarjs/regex-complexity -- one list of accepted words, kept as written so it is reviewed as a list
const AFFIRM = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|correct|right|confirm(?:ed)?|i confirm|please do|please proceed|proceed|go ahead|do it|1|是的|是|对|好的|好|确认)(?![a-z0-9])/i;

/** Deterministic: an explicit yes with no negation anywhere. "Yes, but cancel it" is not a confirmation. */
export function isAffirmative(words: string): boolean {
  const text = words.trim().toLowerCase().replace(/^["'“”]+|["'“”.!]+$/g, '');
  return AFFIRM.test(text) && !NEGATION.test(text);
}

/** Runs a confirmed transaction. Shared by confirm_transaction (voice) and the channel confirm endpoint (chat). */
export async function executeConfirmed(ctx: ToolContext, confirmationId: string): Promise<ToolOutcome> {
  const pending = currentTxn(ctx.session, ctx.now);
  if (pending.kind !== 'pending' || pending.txn.id !== confirmationId) {
    return declined('no_pending_confirmation', 'There is nothing waiting with that confirmation id; it may have expired. Prepare the request again.', 'continue');
  }
  const txn = pending.txn;
  ctx.dispatch({ type: 'TXN_CONFIRMED', id: txn.id });
  ctx.audit('transaction.confirmed', 'ok', { service: txn.service, confirmation_id: txn.id });
  try {
    const outcome = await COMMITTERS[txn.service](ctx, txn);
    ctx.audit('transaction.executed', 'ok', { service: txn.service, confirmation_id: txn.id });
    return outcome;
  } finally {
    // Settled either way: a failed host call surfaces through the executor's response matrix; the idempotency key
    // makes a caller-initiated retry safe.
    ctx.dispatch({ type: 'TXN_SETTLED', id: txn.id });
  }
}

export const confirmTransaction = defineTool({
  name: 'confirm_transaction',
  agents: ['accounts', 'cheques', 'appointments'],
  description: 'Execute a prepared request after the caller explicitly agreed. caller_words must be the caller\'s exact reply to the read-back (for example "yes, go ahead"). Anything but a clear yes is refused.',
  access: 'authenticated',
  service: null,
  effect: 'commit',
  params: object({
    confirmation_id: string({ maxLength: 40, pattern: /^cnf_[a-f0-9]{32}$/, patternHint: 'must be the confirmation_id returned by a prepare_ tool' }),
    caller_words: string({ maxLength: 200, description: 'The caller\'s exact words, verbatim.' }),
  }, ['confirmation_id', 'caller_words']),
  llmFields: ['done', 'reference', 'booking_id', 'message'],
  timeoutMs: 15_000,
  legacy: 'p8/p14/p15/p19 "To confirm, press 1. To cancel, press 2."',
  async handler(ctx, args) {
    if (!isAffirmative(args.caller_words)) {
      return declined('not_confirmed', 'The caller did not clearly confirm. Ask again whether to confirm or cancel.', 'confirm_or_cancel');
    }
    return executeConfirmed(ctx, args.confirmation_id);
  },
});

export const cancelTransaction = defineTool({
  name: 'cancel_transaction',
  agents: ['accounts', 'cheques', 'appointments'],
  description: 'Cancel a prepared request the caller does not want.',
  access: 'authenticated',
  service: null,
  effect: 'session',
  params: object({ confirmation_id: string({ maxLength: 40, pattern: /^cnf_[a-f0-9]{32}$/ }) }, ['confirmation_id']),
  llmFields: ['cancelled', 'message'],
  timeoutMs: 1_000,
  legacy: 'p8 prompt 1036 "You have cancelled your request"',
  async handler(ctx, args) {
    ctx.dispatch({ type: 'TXN_CANCELLED', id: args.confirmation_id });
    ctx.audit('transaction.cancelled', 'ok', { confirmation_id: args.confirmation_id });
    return ok({ cancelled: true, message: 'You have cancelled your request.' });
  },
});

export const TRANSACTION_TOOLS = [confirmTransaction, cancelTransaction];
