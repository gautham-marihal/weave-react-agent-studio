// CIMB bank adapter: the gateway's ports on CIMB's TetherfiDbRestApi (the "CIMB-Bank" Postman collection in
// docs/evidence). One route, POST {base}/TetherfiDbRestApi/dboperations, takes {entity, method, details[{columnMap}]};
// every request carries the HTTP header `Region: DB2` (without it the database answers SQLGrammarException).
//
// What CIMB offers, and how it maps onto the ports:
//   customer.getCustomerDetails {customerId}    → sign-in: the 7-digit customer id is the Phone Code, the passcode
//                                                  the PIN (compared here, in constant time; never returned)
//   account.getCustomerAccounts {customerId}    → the customer's accounts
//   account.getAccountDetails {accountId}       → balance and currency
//   transaction.getTransactionHistory {accountId} → recent activity and incoming funds (CREDIT rows)
// Everything else the gateway can do (PIN change, cheques, statements, SMS OTP, account + NRIC sign-in, appointments,
// service requests, rates, branches, callbacks) has no CIMB method: those calls fail with HostError code
// 'not_offered', which the response matrix turns into an honest "not available on this line". Nothing is invented.
//
// Answers: always HTTP 200. The outcome is per row in responseList[i]: status SUCCESS with tableDetails.columnMap,
// or FAILED with a description. "… not found" / "No … found" is an empty result; anything else is a host error.

import { randomUUID } from 'node:crypto';
import { exponentOf, parseDecimal } from '../domain/money.ts';
import { LEGACY_POLICY, type Policy } from '../domain/policy.ts';
import type { Account, CustomerProfile, ServiceId } from '../domain/types.ts';
import { safeEqual } from '../security/crypto.ts';
import { HostError, type ContentPort, type CoreBankingPort, type CrmPort, type OtpPort, type Ports, type TransactionRecord } from '../ports/ports.ts';

export interface CimbConfig {
  /** e.g. http://cimb-host:3322 (no trailing path). */
  readonly baseUrl: string;
  /** The `Region` header CIMB routes on. */
  readonly region: string;
  /** Per-request cap, under the tools' own timeouts (3–8 s). */
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export type CimbRow = Readonly<Record<string, string>>;

/** Reads CIMB settings from the environment; null when CIMB_BASE_URL is not set. */
export function cimbConfigFromEnv(env: NodeJS.ProcessEnv): CimbConfig | null {
  const baseUrl = (env.CIMB_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) throw new Error('CIMB_BASE_URL must be an http(s) origin such as http://cimb-host:3322');
  const region = (env.CIMB_REGION ?? 'DB2').trim();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(region)) throw new Error('CIMB_REGION must be a short code such as DB2');
  const timeoutMs = Number(env.CIMB_TIMEOUT_MS ?? 6000);
  return { baseUrl, region, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 6000 };
}

const NOT_FOUND = /not found|^no .* found/i;

/** One CIMB call. Returns the SUCCESS rows' columnMaps; [] for a "not found" answer; throws HostError otherwise. */
export function cimbClient(config: CimbConfig) {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.baseUrl}/TetherfiDbRestApi/dboperations`;
  const timeoutMs = config.timeoutMs ?? 6000;

  return async function call(entity: string, method: string, columnMap: Record<string, string>, signal: AbortSignal): Promise<CimbRow[]> {
    const body = { ucid: randomUUID(), dnis: 'default', channel: 'IVR', entity, method, details: [{ columnMap }] };
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Region: config.region },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      // The executor's own abort is a timeout it already handles; ours (the per-request cap) is too.
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw new DOMException('Aborted', 'AbortError');
      throw new HostError('soa', 'unreachable', `CIMB ${entity}.${method}: not reachable`);
    }
    if (!response.ok) throw new HostError('soa', `http_${response.status}`, `CIMB ${entity}.${method}: HTTP ${response.status}`);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new HostError('soa', 'bad_response', `CIMB ${entity}.${method}: not JSON`);
    }
    const record = (typeof data === 'object' && data !== null ? data : {}) as { responseCode?: unknown; responseList?: unknown };
    if (record.responseCode !== 200) throw new HostError('soa', 'rejected', `CIMB ${entity}.${method}: responseCode ${String(record.responseCode)}`);
    const list = Array.isArray(record.responseList) ? (record.responseList as Array<Record<string, unknown>>) : [];
    const rows: CimbRow[] = [];
    for (const item of list) {
      if (item.status === 'SUCCESS') {
        const map = (item.tableDetails as { columnMap?: unknown } | null)?.columnMap;
        if (map && typeof map === 'object') rows.push(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v == null ? '' : String(v)])));
        continue;
      }
      const description = typeof item.description === 'string' ? item.description : '';
      if (/insufficient balance/i.test(description)) throw new HostError('soa', 'insufficient_funds', `CIMB ${entity}.${method}: insufficient balance`);
      if (/does not exist/i.test(description)) throw new HostError('soa', 'no_account', `CIMB ${entity}.${method}: no such account`);
      if (NOT_FOUND.test(description.trim())) continue;
      // A database exception or anything unexpected: never passed on (it can name tables and SQL).
      throw new HostError('soa', 'db_error', `CIMB ${entity}.${method}: ${item.status ?? 'unknown status'}`);
    }
    return rows;
  };
}

const notOffered = (system: HostError['system'], what: string) => new HostError(system, 'not_offered', `CIMB has no ${what}`);

/**
 * Whether CIMB definitely did not run a write: it answered and said no (a FAILED row or a rejected request). A
 * network error, a timeout or an HTTP error may have run it, so those are never "refused".
 */
const refused = (error: unknown) => error instanceof HostError && ['insufficient_funds', 'no_account', 'db_error', 'rejected'].includes(error.code);

/** Minor units → CIMB's decimal text: 25050 SGD → "250.50". */
export function formatMinor(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  if (exp === 0) return String(minor);
  const text = String(minor).padStart(exp + 1, '0');
  return `${text.slice(0, -exp)}.${text.slice(-exp)}`;
}

/**
 * The gateway's policy on CIMB: the legacy rules, minus what CIMB cannot do. Its services that have no CIMB method are
 * refused before any host call and left out of every menu, and callers sign in only with the customer id and
 * passcode (CIMB keeps no NRIC and sends no SMS).
 */
export function cimbPolicy(base: Policy = LEGACY_POLICY): Policy {
  return { ...base, unavailable: CIMB_UNAVAILABLE, authMethods: ['phonecode_pin'] };
}

/** What CIMB's systems do not offer: refused up front and left out of every menu (policy.unavailable). */
export const CIMB_UNAVAILABLE = [
  'statement_request',
  'pin_change',
  'cheque_deposit_status',
  'cheque_issued_status',
  'chequebook_status',
  'chequebook_request',
  'stop_cheque',
  'appointment',
  'rates',
  'branch_locator',
  'forms',
  'callback',
] as const satisfies readonly ServiceId[];

/** "2026-11-01T22:13:21.807" → "2026-11-01" (CIMB times are Malaysia/Singapore local, the gateway's own zone). */
const dateOf = (text: string) => (/^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? '');

export function createCimbPorts(config: CimbConfig): Ports {
  const call = cimbClient(config);

  async function accountDetails(accountId: string, signal: AbortSignal): Promise<CimbRow | null> {
    if (!/^\d{1,20}$/.test(accountId)) return null;
    return (await call('account', 'getAccountDetails', { accountId }, signal))[0] ?? null;
  }

  async function profileOf(customer: CimbRow, signal: AbortSignal): Promise<CustomerProfile> {
    const customerId = customer.customerId ?? '';
    const listed = await call('account', 'getCustomerAccounts', { customerId }, signal);
    // getCustomerAccounts has no currency; getAccountDetails does.
    const accounts = await Promise.all(
      listed
        .filter((row) => row.accountId)
        .map(async (row): Promise<Account> => {
          const details = await accountDetails(row.accountId as string, signal);
          const currency = (details?.currency || '').toUpperCase();
          return {
            number: row.accountId as string,
            // CIMB's products (savings, current, fixed deposit, Islamic "-i" variants) have no business-banking
            // type; 'CA' lets the account services run, and `product` is what the caller and the model are told.
            type: 'CA',
            product: row.accountType || details?.accountType || 'Account',
            currencies: /^[A-Z]{3}$/.test(currency) ? [currency] : [],
            dormant: false,
            omnibus: false,
          };
        }),
    );
    return {
      customerId,
      displayName: customer.name || 'Customer',
      // CIMB's customer API has no segment: every customer it knows is served on this line.
      segment: 'business',
      role: null,
      bizConn: false,
      accounts: accounts.filter((a) => a.currencies.length > 0),
      firstOtpLogin: false,
    };
  }

  async function history(accountNumber: string, signal: AbortSignal): Promise<TransactionRecord[]> {
    const details = await accountDetails(accountNumber, signal);
    if (!details) throw new HostError('soa', 'no_account', 'CIMB: no such account');
    const currency = (details.currency || '').toUpperCase();
    const rows = await call('transaction', 'getTransactionHistory', { accountId: accountNumber }, signal);
    const records = rows.flatMap((row): Array<TransactionRecord & { at: string; id: number }> => {
      const postedOn = dateOf(row.date ?? '');
      if (!postedOn || !row.amount) return [];
      const amount = parseDecimal(row.amount, currency);
      const debit = (row.type ?? '').toUpperCase() === 'DEBIT';
      return [{ postedOn, amount: { minor: debit ? -Math.abs(amount.minor) : Math.abs(amount.minor), currency }, code: (row.type ?? '').toUpperCase(), description: row.description || (debit ? 'Debit' : 'Credit'), at: row.date ?? '', id: Number(row.txnId) || 0 }];
    });
    // Newest first, whatever order the host used.
    records.sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1));
    return records.map(({ at: _at, id: _id, ...record }) => record);
  }

  const core: CoreBankingPort = {
    async loginWithPhoneCode(phoneCode, pin, signal) {
      const customer = (await call('customer', 'getCustomerDetails', { customerId: phoneCode }, signal))[0];
      if (!customer || customer.customerId !== phoneCode) return { result: 'invalid_phonecode' };
      if (!customer.passcode || !safeEqual(customer.passcode, pin)) return { result: 'invalid_pin' };
      return { result: 'ok', customer: await profileOf(customer, signal) };
    },
    async changePin() {
      throw notOffered('as400', 'PIN change');
    },
    // CIMB has no transfer method: a DEBIT on one account, then a CREDIT on the other (transaction.insertTransaction).
    // CIMB itself accepts negative, zero and three-decimal amounts, so this refuses anything but a positive amount in
    // the currency's precision before calling it (the tool already checked; this is the last line).
    async transferOwn(fromAccount, toAccount, amount, idempotencyKey, signal) {
      if (!Number.isSafeInteger(amount.minor) || amount.minor <= 0 || fromAccount === toAccount) throw new HostError('soa', 'transfer_failed', 'CIMB: refused before calling: bad amount or same account');
      const [from, to] = await Promise.all([accountDetails(fromAccount, signal), accountDetails(toAccount, signal)]);
      if (!from || !to || !from.customerId || from.customerId !== to.customerId) throw new HostError('soa', 'transfer_failed', 'CIMB: accounts not found or not the same customer');
      const currency = amount.currency;
      if ((from.currency || '').toUpperCase() !== currency || (to.currency || '').toUpperCase() !== currency) throw new HostError('soa', 'transfer_failed', 'CIMB: currency differs');
      const value = formatMinor(amount.minor, currency);
      const ref = idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase();
      const post = (accountId: string, type: 'DEBIT' | 'CREDIT', description: string) =>
        call('transaction', 'insertTransaction', { accountId, type, amount: value, description: description.slice(0, 100) }, signal);

      // 1. The debit. Refused (insufficient balance, …) = nothing moved. A timeout here may have run: the executor
      //    reports the outcome as unknown, never as failed.
      let debit: CimbRow[];
      try {
        debit = await post(fromAccount, 'DEBIT', `Transfer to account ending ${toAccount.slice(-4)} ref ${ref}`);
      } catch (error) {
        if (error instanceof HostError && error.code === 'insufficient_funds') throw error;
        if (refused(error)) throw new HostError('soa', 'transfer_failed', (error as Error).message);
        if (error instanceof HostError) throw new HostError('soa', 'transfer_incomplete', `CIMB: debit outcome unknown (${error.code})`);
        throw error;
      }
      const debitId = debit[0]?.txnId ?? '';

      // 2. The credit. Refused by the host = undo the debit with a reversal credit. Anything else (a timeout, the
      //    network, a 5xx) is left as unknown: the credit may have been posted, and reversing then would take the
      //    customer's money back twice.
      try {
        await post(toAccount, 'CREDIT', `Transfer from account ending ${fromAccount.slice(-4)} ref ${ref}`);
      } catch (error) {
        if (!refused(error)) {
          if (error instanceof HostError) throw new HostError('soa', 'transfer_incomplete', `CIMB: credit outcome unknown after debit ${debitId} (${error.code})`);
          throw error;
        }
        try {
          await post(fromAccount, 'CREDIT', `Reversal of transfer ref ${ref}`);
        } catch {
          throw new HostError('soa', 'transfer_incomplete', `CIMB: credit refused and the reversal of debit ${debitId} failed`);
        }
        throw new HostError('soa', 'transfer_failed', 'CIMB: credit refused; debit reversed');
      }
      return { reference: `TRF${debitId || ref}` };
    },
    async getBalance(accountNumber, currency, signal) {
      const details = await accountDetails(accountNumber, signal);
      if (!details) throw new HostError('soa', 'no_account', 'CIMB: no such account');
      const held = (details.currency || '').toUpperCase();
      if (currency && currency !== held) throw new HostError('soa', 'no_currency', `CIMB: account holds ${held}`);
      const balance = parseDecimal(details.balance ?? '', held);
      const zero = { minor: 0, currency: held };
      // CIMB reports one balance: no holds, cheques in clearing or overdraft facility.
      return { current: balance, available: balance, holdAmount: zero, chequesPendingClearance: zero, overdraftLimit: null, omnibus: false };
    },
    async listCurrencies(accountNumber, signal) {
      const currency = ((await accountDetails(accountNumber, signal))?.currency || '').toUpperCase();
      return currency ? [currency] : [];
    },
    async incomingFunds(accountNumber, sinceDate, signal) {
      return (await history(accountNumber, signal)).filter((t) => t.amount.minor > 0 && t.postedOn >= sinceDate);
    },
    async recentTransactions(accountNumber, limit, signal) {
      return (await history(accountNumber, signal)).slice(0, limit);
    },
    async depositedCheques() {
      throw notOffered('as400', 'cheque records');
    },
    async issuedChequeStatus() {
      throw notOffered('as400', 'cheque records');
    },
    async chequebooks() {
      throw notOffered('as400', 'cheque books');
    },
    async stopCheques() {
      throw notOffered('as400', 'stop payment');
    },
    async requestStatement() {
      throw notOffered('soa', 'statement requests');
    },
    async requestChequebook() {
      throw notOffered('soa', 'cheque book requests');
    },
    async primeRate() {
      throw notOffered('as400', 'rates');
    },
    async fxRate() {
      throw notOffered('as400', 'rates');
    },
    async timeDepositRates() {
      throw notOffered('soa', 'rates');
    },
  };

  const crm: CrmPort = {
    async verifyAccountAndNric() {
      // CIMB keeps no NRIC: the account route cannot verify anyone. The Phone Code (customer id) route works.
      throw notOffered('siebel', 'NRIC verification');
    },
    async identifyAccount(accountNumber, signal) {
      const details = await accountDetails(accountNumber, signal);
      return { found: !!details, customerId: details?.customerId || null, segment: null };
    },
    async createServiceRequest() {
      throw notOffered('siebel', 'service requests');
    },
    async appointmentSlots() {
      throw notOffered('siebel', 'appointments');
    },
    async bookAppointment() {
      throw notOffered('siebel', 'appointments');
    },
    async listAppointments() {
      throw notOffered('siebel', 'appointments');
    },
    async cancelAppointment() {
      throw notOffered('siebel', 'appointments');
    },
  };

  const content: ContentPort = {
    // CIMB has no holiday calendar: office hours come from the policy's weekdays and times alone.
    async isHoliday() {
      return false;
    },
    async branches() {
      throw notOffered('cmm', 'branch list');
    },
    // No stored language preference on CIMB: unknown, and a choice is not kept.
    async preferredLanguage() {
      return null;
    },
    async recordLanguageChoice() {
      throw notOffered('cmm', 'language preferences');
    },
    async insertCallback() {
      throw notOffered('cmm', 'callbacks');
    },
    async announcements() {
      throw notOffered('cmm', 'announcements');
    },
  };

  const otp: OtpPort = {
    async send() {
      throw notOffered('otp', 'SMS one-time passwords');
    },
    async verify() {
      throw notOffered('otp', 'SMS one-time passwords');
    },
  };

  return { core, crm, content, otp };
}
