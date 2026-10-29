// MOCK DATA. Synthetic test customers for local development and automated tests only. None of these values belong
// to a real customer, account or branch. Delete this folder once the real SOA/Siebel/CMM adapters are wired
// (see ../README.md, "Removing the mock").

import type { AccountType, CustomerProfile, Money } from '../src/domain/types.ts';

export interface MockCredential {
  readonly phoneCode?: string;
  readonly pin?: string; // stored hashed by the adapter at start-up; plain here only because it is test data
  readonly accountNumber?: string;
  readonly nric?: string;
  readonly hostLocked?: boolean;
}

export interface MockCustomer {
  readonly profile: CustomerProfile;
  readonly credential: MockCredential;
}

const account = (number: string, type: AccountType, currencies: string[], extra: { dormant?: boolean; omnibus?: boolean } = {}) => ({
  number,
  type,
  currencies,
  dormant: extra.dormant ?? false,
  omnibus: extra.omnibus ?? false,
});

/** Test credentials, documented in ../README.md so a tester can drive every branch of the call flow. */
export const MOCK_CUSTOMERS: readonly MockCustomer[] = [
  {
    // PhoneCode + PIN user with a positive SGD account, an overdrawn SGD account and a USD/EUR account.
    credential: { phoneCode: '1234567', pin: '135790' },
    profile: {
      customerId: 'CIF-MOCK-0001',
      displayName: 'Acme Trading Pte Ltd',
      segment: 'business',
      role: null,
      bizConn: false,
      firstOtpLogin: false,
      accounts: [
        account('500000000101', 'CA', ['SGD']),
        account('500000000102', 'CA', ['SGD'], { omnibus: true }),
        account('500000000103', 'ACU_CHQ', ['USD', 'EUR']),
      ],
    },
  },
  {
    // Account + NRIC + OTP user, Authorised Signatory, BizConn, first OTP login.
    credential: { accountNumber: '500000000201', nric: '1234567' },
    profile: {
      customerId: 'CIF-MOCK-0002',
      displayName: 'Acme Logistics Pte Ltd',
      segment: 'business',
      role: 'AS',
      bizConn: true,
      firstOtpLogin: true,
      accounts: [account('500000000201', 'CA', ['SGD'])],
    },
  },
  {
    // Account + NRIC + OTP user, Authorised Contact: may enquire but not request statements or stop cheques.
    credential: { accountNumber: '500000000301', nric: '7654321' },
    profile: {
      customerId: 'CIF-MOCK-0003',
      displayName: 'Acme Engineering Pte Ltd',
      segment: 'business',
      role: 'AC',
      bizConn: false,
      firstOtpLogin: false,
      accounts: [account('500000000301', 'CA', ['SGD'])],
    },
  },
  {
    // A personal-banking customer calling the business line (deck p33 → redirect and end).
    credential: { phoneCode: '7777777', pin: '111111' },
    profile: {
      customerId: 'CIF-MOCK-0004',
      displayName: 'Acme Personal',
      segment: 'personal',
      role: null,
      bizConn: false,
      firstOtpLogin: false,
      accounts: [account('500000000401', 'CA', ['SGD'])],
    },
  },
  {
    // A dormant account (deck p34 → "visit your nearest branch").
    credential: { accountNumber: '500000000501', nric: '9999999' },
    profile: {
      customerId: 'CIF-MOCK-0005',
      displayName: 'Acme Dormant Pte Ltd',
      segment: 'business',
      role: 'AS',
      bizConn: false,
      firstOtpLogin: false,
      accounts: [account('500000000501', 'CA', ['SGD'], { dormant: true })],
    },
  },
  {
    // The host reports this PhoneCode as locked (host code 62).
    credential: { phoneCode: '6666666', pin: '222222', hostLocked: true },
    profile: {
      customerId: 'CIF-MOCK-0006',
      displayName: 'Acme Locked Pte Ltd',
      segment: 'business',
      role: null,
      bizConn: false,
      firstOtpLogin: false,
      accounts: [account('500000000601', 'CA', ['SGD'])],
    },
  },
];

/** What each test login exercises, as documented in ../README.md ("Test logins"). Keyed by customer id. */
const LOGIN_NOTES: Readonly<Record<string, { label: string; exercises: string }>> = {
  'CIF-MOCK-0001': {
    label: 'Phone Code user with three accounts',
    exercises: 'Positive SGD account with a hold and pending cheques, an overdrawn SGD account, and a USD/EUR account',
  },
  'CIF-MOCK-0002': {
    label: 'Authorised Signatory (first OTP login)',
    exercises: 'Account + NRIC + SMS one-time password, terms notice, stop cheque, cheque books',
  },
  'CIF-MOCK-0003': { label: 'Authorised Contact', exercises: 'Entitlement refusals: may not check balances or stop cheques' },
  'CIF-MOCK-0004': { label: 'Personal-banking customer', exercises: 'Redirected to the personal banking line' },
  'CIF-MOCK-0005': { label: 'Dormant account', exercises: '"Visit your nearest branch"' },
  'CIF-MOCK-0006': { label: 'Host-locked Phone Code', exercises: 'The bank system reports the Phone Code as locked (host code 62)' },
};

export interface MockTestLogin {
  readonly id: string;
  readonly label: string;
  readonly method: 'phonecode_pin' | 'account_nric_otp';
  readonly identifier: string;
  readonly secret: string;
  readonly otp: boolean;
  readonly exercises: string;
}

/** The test logins above, for Studio's test-login list (mock gateway only). */
export const MOCK_TEST_LOGINS: readonly MockTestLogin[] = MOCK_CUSTOMERS.map(({ profile, credential }) => {
  const notes = LOGIN_NOTES[profile.customerId] ?? { label: profile.displayName, exercises: '' };
  const phone = credential.phoneCode !== undefined;
  return {
    id: profile.customerId,
    label: notes.label,
    method: phone ? 'phonecode_pin' : 'account_nric_otp',
    identifier: (phone ? credential.phoneCode : credential.accountNumber) ?? '',
    secret: (phone ? credential.pin : credential.nric) ?? '',
    otp: !phone,
    exercises: notes.exercises,
  };
});

const m = (dollars: number, currency = 'SGD'): Money => ({ minor: Math.round(dollars * 100), currency });

export const MOCK_BALANCES: Readonly<Record<string, { current: Money; available: Money; hold: Money; pending: Money; od: Money | null }>> = {
  '500000000101:SGD': { current: m(12_500.4), available: m(11_250.4), hold: m(1_000), pending: m(250), od: null },
  '500000000102:SGD': { current: m(-1_820.05), available: m(-1_820.05), hold: m(0), pending: m(0), od: m(5_000) },
  '500000000103:USD': { current: m(3_400, 'USD'), available: m(3_400, 'USD'), hold: m(0, 'USD'), pending: m(0, 'USD'), od: null },
  '500000000103:EUR': { current: m(980.5, 'EUR'), available: m(980.5, 'EUR'), hold: m(0, 'EUR'), pending: m(0, 'EUR'), od: null },
  '500000000201:SGD': { current: m(88_000), available: m(87_500), hold: m(0), pending: m(500), od: null },
  '500000000301:SGD': { current: m(4_200), available: m(4_200), hold: m(0), pending: m(0), od: null },
};

export const MOCK_FX: Readonly<Record<string, { unit: number; selling: string; buying: string; sellingTtOd: string; buyingTt: string; buyingOd: string }>> = {
  USD: { unit: 1, selling: '1.3650', buying: '1.3410', sellingTtOd: '1.3650', buyingTt: '1.3410', buyingOd: '1.3380' },
  CAD: { unit: 1, selling: '0.9950', buying: '0.9720', sellingTtOd: '0.9950', buyingTt: '0.9720', buyingOd: '0.9690' },
  GBP: { unit: 1, selling: '1.7400', buying: '1.7050', sellingTtOd: '1.7400', buyingTt: '1.7050', buyingOd: '1.7010' },
  AUD: { unit: 1, selling: '0.9050', buying: '0.8830', sellingTtOd: '0.9050', buyingTt: '0.8830', buyingOd: '0.8800' },
  NZD: { unit: 1, selling: '0.8250', buying: '0.8040', sellingTtOd: '0.8250', buyingTt: '0.8040', buyingOd: '0.8010' },
  EUR: { unit: 1, selling: '1.4900', buying: '1.4580', sellingTtOd: '1.4900', buyingTt: '1.4580', buyingOd: '1.4540' },
  JPY: { unit: 100, selling: '0.9200', buying: '0.8950', sellingTtOd: '0.9200', buyingTt: '0.8950', buyingOd: '0.8920' },
  HKD: { unit: 1, selling: '0.1760', buying: '0.1720', sellingTtOd: '0.1760', buyingTt: '0.1720', buyingOd: '0.1715' },
  IDR: { unit: 10000, selling: '0.8900', buying: '0.8300', sellingTtOd: '0.8900', buyingTt: '0.8300', buyingOd: '0.8250' },
};

export const MOCK_BRANCHES = [
  {
    id: 'br_central',
    name: 'Central Branch',
    region: 'central',
    address: '1 Test Street (test address)',
    hours: 'Monday to Friday, 9am to 4:30pm',
    appointmentServices: ['foreign_worker_account', 'velocity_payment_training', 'velocity_trade_training'],
  },
  {
    id: 'br_north',
    name: 'North Branch',
    region: 'north',
    address: '2 Test Avenue (test address)',
    hours: 'Monday to Friday, 9am to 4:30pm',
    appointmentServices: ['foreign_worker_account'],
  },
  {
    id: 'br_east',
    name: 'East Branch',
    region: 'east',
    address: '3 Test Road (test address)',
    hours: 'Monday to Saturday, 9am to 3pm',
    appointmentServices: ['foreign_worker_account'],
  },
] as const;
