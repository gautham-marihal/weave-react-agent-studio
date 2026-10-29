import type { AccountType, AuthMethod, Money, ServiceId, UserRole } from './types.ts';

// Business policy, in one place. Values come from the legacy Avaya deck (BBCSC call flow v47, 15 Jul 2015) and are
// NOT approved for production: each carries the deck page it came from. The business owner must sign off this file
// (or replace it with values served by CMM) before go-live. `approved: false` makes the gateway say so at startup.

export interface EntitlementRule {
  /** Any one rule in the list grants the service. */
  readonly anyOf: ReadonlyArray<{ readonly method: AuthMethod; readonly roles?: readonly UserRole[]; readonly bizConn?: true }>;
  /** The customer must hold at least one account of these types. Omitted = no account requirement. */
  readonly accountTypes?: readonly AccountType[];
}

export interface Policy {
  readonly approved: boolean;
  readonly source: string;
  /** Deck p33/p34: "Invalid code from HOST & IVR are cumulative 3 tries." */
  readonly maxAuthFailures: number;
  readonly maxOtpResends: number;
  readonly captureTtlMs: number;
  readonly confirmationTtlMs: number;
  readonly sessionTtlMs: number;
  readonly maxToolCallsPerSession: number;
  /** Deck p31/p35: "Commercial Service Center is operational from 8:30am - 6:00pm from Monday to Friday." */
  readonly serviceCentre: { readonly open: string; readonly close: string; readonly weekdays: readonly number[] };
  readonly chequebook: {
    /** Deck p14: same day before 10AM, next day before 3PM (CMM-configurable). */
    readonly sameDayCutoff: string;
    readonly nextDayCutoff: string;
    /** Deck p14 speech bubble. */
    readonly charges: Readonly<Record<'same_day' | 'next_day', Readonly<Record<string, Money>>>>;
  };
  readonly stopCheque: {
    /** Deck p15/p16: range must be <= 50 cheques within one cheque book. */
    readonly maxRange: number;
    readonly chargeSingle: Money;
    readonly chargeRange: Money;
    /** Deck p15: instructions after 7 PM on weekdays are not effective for today's clearing. */
    readonly clearingCutoff: string;
  };
  readonly lookbackDays: number; // "7 days = 7 calendar days"
  readonly pageSize: number; // deck p6/p7: 9 records per page
  readonly maxRecentTransactions: number; // deck p7: "limit the listing to maximum of 15"
  readonly appointments: {
    readonly minDaysAhead: number; // deck p19: "booking is done 2 days in advance"
    readonly cancelMinDaysAhead: number; // deck p47: no cancellation within 2 days
    readonly maxPartyFwa: number; // deck p19: max 6 accounts per booking
    readonly maxPartyTraining: number; // deck p45: max 2 attendees
  };
  readonly callback: { readonly minDigits: number; readonly maxDigits: number }; // deck p39
  readonly channel: {
    /**
     * Identifiers the caller may unmask on their own screen (the eye icon). Secrets (PIN, NRIC, OTP) are never in this
     * list: they only go through the secure keypad. Not in the deck: OPEN DECISION for Security and the business owner.
     */
    readonly revealableIdentifiers: ReadonlyArray<'phone_code' | 'account_number'>;
  };
  readonly entitlements: Readonly<Record<ServiceId, EntitlementRule | 'public'>>;
}

const sgd = (dollars: number): Money => ({ minor: dollars * 100, currency: 'SGD' });
const usd = (dollars: number): Money => ({ minor: dollars * 100, currency: 'USD' });

const P = { method: 'phonecode_pin' } as const;
const AS = { method: 'account_nric_otp', roles: ['AS'] } as const;
const AS_AC = { method: 'account_nric_otp', roles: ['AS', 'AC'] } as const;

export const LEGACY_POLICY: Policy = {
  approved: false,
  source: 'BBCSC-IVR-CallFlow-2015Jul15-v47 (legacy Avaya deck); pending business-owner approval',
  maxAuthFailures: 3,
  maxOtpResends: 1, // not in the deck: OPEN DECISION
  captureTtlMs: 120_000, // not in the deck: OPEN DECISION
  confirmationTtlMs: 180_000, // not in the deck: OPEN DECISION
  sessionTtlMs: 2 * 60 * 60_000,
  maxToolCallsPerSession: 60,
  serviceCentre: { open: '08:30', close: '18:00', weekdays: [1, 2, 3, 4, 5] },
  chequebook: {
    sameDayCutoff: '10:00',
    nextDayCutoff: '15:00',
    charges: {
      next_day: { SGD: sgd(18), USD: usd(12) }, // deck calls this "Express"
      same_day: { SGD: sgd(27), USD: usd(18) },
    },
  },
  stopCheque: { maxRange: 50, chargeSingle: sgd(15), chargeRange: sgd(30), clearingCutoff: '19:00' },
  lookbackDays: 7,
  pageSize: 9,
  maxRecentTransactions: 15,
  appointments: { minDaysAhead: 2, cancelMinDaysAhead: 2, maxPartyFwa: 6, maxPartyTraining: 2 },
  callback: { minDigits: 5, maxDigits: 15 },
  channel: { revealableIdentifiers: ['phone_code', 'account_number'] }, // not in the deck: OPEN DECISION
  // Deck p3 (Bal, IF & A/c Actv) and p10 (Cheque Svcs). P = PhoneCode user; AS/AC = OTP user roles.
  entitlements: {
    account_balance: { anyOf: [P, AS], accountTypes: ['CA', 'ACU', 'ACU_CHQ', 'ACU_CALL'] },
    incoming_funds: { anyOf: [P, AS_AC], accountTypes: ['CA', 'ACU', 'ACU_CHQ', 'ACU_CALL'] },
    recent_activity: { anyOf: [P, AS_AC], accountTypes: ['CA', 'ACU', 'ACU_CHQ', 'ACU_CALL'] },
    statement_request: { anyOf: [P, AS], accountTypes: ['CA'] },
    pin_change: { anyOf: [P] },
    fd_loan: { anyOf: [{ method: 'account_nric_otp', roles: ['AS', 'AC'], bizConn: true }] },
    cheque_deposit_status: { anyOf: [P, AS_AC], accountTypes: ['CA', 'ACU', 'ACU_CHQ', 'ACU_CALL'] },
    cheque_issued_status: { anyOf: [P, AS_AC], accountTypes: ['CA', 'ACU_CHQ'] },
    chequebook_status: { anyOf: [P, AS_AC], accountTypes: ['CA', 'ACU_CHQ'] },
    chequebook_request: { anyOf: [P, AS], accountTypes: ['CA', 'ACU_CHQ'] },
    stop_cheque: { anyOf: [P, AS], accountTypes: ['CA', 'ACU_CHQ'] },
    appointment: { anyOf: [P, AS_AC] },
    rates: 'public',
    branch_locator: 'public',
    forms: 'public',
    lost_card: 'public', // deck p30: account number + Siebel login only, then a priority transfer
    callback: 'public',
  },
};

/** Account types that may be used for a service, or every type when the rule has no account requirement. */
export function accountTypesFor(policy: Policy, service: ServiceId): readonly AccountType[] | null {
  const rule = policy.entitlements[service];
  return rule === 'public' ? null : (rule.accountTypes ?? null);
}
