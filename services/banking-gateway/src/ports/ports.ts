import type { TenorRate } from '../domain/rates.ts';
import type { CustomerProfile, Money } from '../domain/types.ts';

// Ports: what the gateway needs from each legacy system, stated in domain terms. The real adapters (SOA/ESB calls
// to AS400, Siebel web services, the CMM database) and the mock adapters in ../../mock implement these interfaces.
// The gateway never imports an adapter directly; the composition root (src/main.ts or mock/main.ts) passes them in.
//
// Every method takes an AbortSignal; the executor aborts on its timeout. A host-level failure is thrown as
// HostError with the host's response code, so the response matrix (../executor/response-matrix.ts) can map it to
// something safe to say.

export class HostError extends Error {
  readonly system: 'as400' | 'siebel' | 'cmm' | 'soa' | 'otp';
  readonly code: string;
  constructor(system: HostError['system'], code: string, message?: string) {
    super(message ?? `${system} returned ${code}`);
    this.name = 'HostError';
    this.system = system;
    this.code = code;
  }
}

/** AS400 core banking via SOA: "Call AS400 …" / "Call SOA CBS-…" boxes in the deck. */
export interface CoreBankingPort {
  /** Deck p33 "Call AS400 Authentication Process User Login" + "Get CIF". */
  loginWithPhoneCode(phoneCode: string, pin: string, signal: AbortSignal): Promise<
    | { readonly result: 'ok'; readonly customer: CustomerProfile }
    | { readonly result: 'invalid_pin' } // host code 53
    | { readonly result: 'invalid_phonecode' } // host code 83
    | { readonly result: 'locked' } // host code 62
    | { readonly result: 'unauthorised' } // host code 50 (valid PIN, bad CIF)
  >;
  /** Deck p9 "Call AS400 Phone PIN change". The current PIN is re-verified by the host. */
  changePin(customerId: string, phoneCode: string, currentPin: string, newPin: string, signal: AbortSignal): Promise<{ readonly result: 'ok' | 'invalid_pin' }>;
  /** Deck p5 "CBS-AcctDeptStaticBalance". */
  getBalance(accountNumber: string, currency: string | null, signal: AbortSignal): Promise<BalanceRecord>;
  /** Deck p43 "CBS-ListCABalance": currencies held in a multi-currency ACU account. */
  listCurrencies(accountNumber: string, signal: AbortSignal): Promise<readonly string[]>;
  /** Deck p6 "CBS-IncomingFundTransaction": last N calendar days, newest first. */
  incomingFunds(accountNumber: string, sinceDate: string, signal: AbortSignal): Promise<readonly TransactionRecord[]>;
  /** Deck p7 "CBS-CASAHistory-I": newest first. */
  recentTransactions(accountNumber: string, limit: number, signal: AbortSignal): Promise<readonly TransactionRecord[]>;
  /** Deck p11 "Incoming Fund (CHQ / CHQR)". */
  depositedCheques(accountNumber: string, status: 'deposited' | 'returned', sinceDate: string, signal: AbortSignal): Promise<readonly DepositedCheque[]>;
  /** Deck p12 "Call AS400 Cheque Status enquiry". */
  issuedChequeStatus(accountNumber: string, chequeNumber: string, signal: AbortSignal): Promise<IssuedCheque>;
  /** Deck p13 "CBS-ChqBookRange-I": host code 90 = no cheque book issued. */
  chequebooks(accountNumber: string, signal: AbortSignal): Promise<readonly ChequebookRecord[]>;
  /** Deck p15 "Call AS400 Cheque Single Stop Payment"; p16 host codes 192 / 196 / 343. */
  stopCheques(accountNumber: string, fromCheque: string, toCheque: string, idempotencyKey: string, signal: AbortSignal): Promise<{ readonly stopped: number }>;
  /** Deck p8 "Call SOA For CA Statement request(45)". */
  requestStatement(accountNumber: string, month: string, idempotencyKey: string, signal: AbortSignal): Promise<{ readonly reference: string }>;
  /** Deck p14 "Call SOA For CA Cheque Book Request". */
  requestChequebook(accountNumber: string, delivery: 'same_day' | 'next_day' | 'standard', idempotencyKey: string, signal: AbortSignal): Promise<{ readonly reference: string }>;
  /** Deck p23 / p26 "Call AS400 Prime Rates / Foreign Exchange Rates". */
  primeRate(signal: AbortSignal): Promise<{ readonly rate: string }>;
  fxRate(currency: string, signal: AbortSignal): Promise<FxRateRecord>;
  /** Deck p24 "Call SOA SGD TD Rates Enquiry". */
  timeDepositRates(signal: AbortSignal): Promise<{ readonly minimumDeposit: Money; readonly rates: readonly TenorRate[] }>;
}

export interface BalanceRecord {
  readonly current: Money;
  readonly available: Money;
  readonly holdAmount: Money; // "Earmark = Hold"
  readonly chequesPendingClearance: Money;
  readonly overdraftLimit: Money | null;
  readonly omnibus: boolean;
}

export interface TransactionRecord {
  readonly postedOn: string; // YYYY-MM-DD
  readonly amount: Money; // negative = debit
  /** Deck p7: 4-digit aux code first, else the 3-digit transaction code, mapped to a description in CMM. */
  readonly code: string;
  readonly description: string;
}

export interface DepositedCheque {
  readonly chequeNumber: string | null; // "Valid Cheque # might not be available"
  readonly amount: Money;
  readonly status: 'deposited' | 'returned';
  readonly on: string;
  readonly returnReason: string | null;
}

export interface IssuedCheque {
  readonly status: 'presented' | 'stopped' | 'cleared' | 'returned' | 'not_presented' | 'not_on_record';
  readonly amount: Money | null;
  readonly on: string | null;
  readonly returnReason: string | null;
}

export interface ChequebookRecord {
  readonly issuedOn: string;
  readonly lastChequeNumber: string;
  readonly firstChequeNumber: string;
}

export interface FxRateRecord {
  readonly currency: string;
  readonly unit: number; // deck p26: "Query I_CURRENCY table for currency type and unit of currency"
  readonly selling: string;
  readonly buying: string;
  readonly sellingTtOd: string;
  readonly buyingTt: string;
  readonly buyingOd: string;
}

/** Siebel CRM: identity by account + NRIC, service requests (SR), appointments. */
export interface CrmPort {
  /** Deck p34 "Call Siebel Account + IC Login". */
  verifyAccountAndNric(accountNumber: string, nric: string, signal: AbortSignal): Promise<
    | { readonly result: 'ok'; readonly customer: CustomerProfile }
    | { readonly result: 'invalid_account' }
    | { readonly result: 'invalid_nric' }
  >;
  /** Deck p30 lost card: account login only (identify, not authenticate). */
  identifyAccount(accountNumber: string, signal: AbortSignal): Promise<{ readonly found: boolean; readonly customerId: string | null; readonly segment: string | null }>;
  /** "Call Siebel Create SR". Type/Category/Sub-category follow the deck's per-service notes. */
  createServiceRequest(sr: ServiceRequest, idempotencyKey: string, signal: AbortSignal): Promise<{ readonly srNumber: string }>;
  appointmentSlots(query: { readonly service: AppointmentService; readonly branchId: string; readonly fromDate: string }, signal: AbortSignal): Promise<readonly AppointmentSlot[]>;
  bookAppointment(booking: { readonly slotId: string; readonly customerId: string; readonly partySize: number }, idempotencyKey: string, signal: AbortSignal): Promise<{ readonly bookingId: string }>;
  listAppointments(customerId: string, signal: AbortSignal): Promise<readonly Appointment[]>;
  cancelAppointment(bookingId: string, customerId: string, idempotencyKey: string, signal: AbortSignal): Promise<void>;
}

export type AppointmentService = 'foreign_worker_account' | 'velocity_payment_training' | 'velocity_trade_training';

export interface AppointmentSlot {
  readonly slotId: string;
  readonly branchId: string;
  readonly date: string;
  readonly start: string; // HH:MM
  readonly end: string;
  readonly capacity: number;
}

export interface Appointment {
  readonly bookingId: string;
  readonly service: AppointmentService;
  readonly branchId: string;
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly partySize: number;
}

export interface ServiceRequest {
  readonly customerId: string | null;
  readonly type: string; // e.g. QUICKKILL
  readonly category: string;
  readonly subCategory: string | null;
  readonly priority: 'normal' | 'high';
  readonly channel: string;
  readonly note: string;
}

/** CMM: the content & configuration manager (prompts, hours, holidays, branches, callbacks, caller preferences). */
export interface ContentPort {
  isHoliday(date: string, signal: AbortSignal): Promise<boolean>;
  branches(signal: AbortSignal): Promise<readonly Branch[]>;
  /** Deck p1: preferred language after 5 selections, keyed by caller id. */
  preferredLanguage(callerId: string, signal: AbortSignal): Promise<'en' | 'zh' | null>;
  recordLanguageChoice(callerId: string, language: 'en' | 'zh', signal: AbortSignal): Promise<void>;
  /** Deck p39 "CMM Insert to Call-Back"; duplicates for the same caller and day are refused by CMM. */
  insertCallback(request: { readonly number: string; readonly callerId: string | null; readonly reason: string; readonly date: string }, signal: AbortSignal): Promise<{ readonly result: 'created' | 'duplicate' }>;
  /** Deck p21 promotions (max 7), p20 GIRO & SWIFT dynamic announcement. */
  announcements(kind: 'promotions' | 'giro_swift', signal: AbortSignal): Promise<readonly { readonly id: string; readonly title: string; readonly text: string }[]>;
}

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly region: 'north' | 'south' | 'east' | 'west' | 'central';
  readonly address: string;
  readonly hours: string;
  readonly appointmentServices: readonly AppointmentService[];
}

/** SOA OTP service: the SMS is sent by the OTP host, never by the gateway or the model. */
export interface OtpPort {
  send(customerId: string, signal: AbortSignal): Promise<{ readonly result: 'sent' | 'locked' }>;
  verify(customerId: string, otp: string, signal: AbortSignal): Promise<{ readonly result: 'ok' | 'invalid' | 'locked' }>;
}

export interface Ports {
  readonly core: CoreBankingPort;
  readonly crm: CrmPort;
  readonly content: ContentPort;
  readonly otp: OtpPort;
}
