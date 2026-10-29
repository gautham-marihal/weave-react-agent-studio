// MOCK ADAPTERS. In-memory stand-ins for AS400, Siebel, CMM and the SOA OTP service, implementing the same ports
// as the real adapters will. For local development and tests only; mock/main.ts refuses to run in production.

import { randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { addDays, localParts, weekdayOf } from '../src/domain/time.ts';
import type { Money } from '../src/domain/types.ts';
import {
  HostError,
  type Appointment,
  type AppointmentService,
  type AppointmentSlot,
  type Branch,
  type ChequebookRecord,
  type ContentPort,
  type CoreBankingPort,
  type CrmPort,
  type DepositedCheque,
  type IssuedCheque,
  type OtpPort,
  type Ports,
  type ServiceRequest,
  type TransactionRecord,
} from '../src/ports/ports.ts';
import { MOCK_BALANCES, MOCK_BRANCHES, MOCK_CUSTOMERS, MOCK_FX } from './fixtures.ts';

export interface MockControls {
  /** Makes the next call of a port method throw this host error (e.g. failNext('stopCheques', new HostError('as400', '196'))). */
  failNext(method: string, error: HostError): void;
  /** Makes the next call of a port method never answer (until the gateway aborts it): a host timeout. */
  hangNext(method: string): void;
  /** SMS one-time passwords the mock "sent", newest last. Tests read these; mock/main.ts prints them. */
  readonly otpOutbox: Array<{ customerId: string; otp: string }>;
  readonly serviceRequests: ServiceRequest[];
  readonly callbacks: Array<{ number: string; date: string }>;
  readonly stopped: Array<{ account: string; from: string; to: string }>;
}

const hash = (salt: string, value: string) => scryptSync(value, salt, 32);

export function createMockPorts(clock: () => number = Date.now, onOtp?: (customerId: string, otp: string) => void): { ports: Ports; controls: MockControls } {
  const failures = new Map<string, HostError>();
  const hangs = new Set<string>();
  const controls: MockControls = {
    failNext: (method, error) => void failures.set(method, error),
    hangNext: (method) => void hangs.add(method),
    otpOutbox: [],
    serviceRequests: [],
    callbacks: [],
    stopped: [],
  };
  const maybeFail = (method: string) => {
    const error = failures.get(method);
    if (error) {
      failures.delete(method);
      throw error;
    }
  };
  const maybeHang = async (method: string, signal: AbortSignal) => {
    if (!hangs.delete(method)) return;
    await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const today = () => localParts(clock()).date;
  const latency = (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  };

  // PINs are compared as salted scrypt hashes, as a real host would; the plain value is never kept after start-up.
  const pins = new Map<string, { salt: string; hash: Buffer }>();
  for (const c of MOCK_CUSTOMERS) {
    if (c.credential.phoneCode && c.credential.pin)
      pins.set(c.credential.phoneCode, { salt: c.profile.customerId, hash: hash(c.profile.customerId, c.credential.pin) });
  }
  const pinMatches = (phoneCode: string, pin: string) => {
    const stored = pins.get(phoneCode);
    return stored ? timingSafeEqual(stored.hash, hash(stored.salt, pin)) : false;
  };
  const byPhoneCode = (code: string) => MOCK_CUSTOMERS.find((c) => c.credential.phoneCode === code);
  const byAccount = (number: string) => MOCK_CUSTOMERS.find((c) => c.profile.accounts.some((a) => a.number === number));

  const money = (dollars: number, currency = 'SGD'): Money => ({ minor: Math.round(dollars * 100), currency });

  const core: CoreBankingPort = {
    async loginWithPhoneCode(phoneCode, pin, signal) {
      latency(signal);
      maybeFail('loginWithPhoneCode');
      const customer = byPhoneCode(phoneCode);
      if (!customer) return { result: 'invalid_phonecode' };
      if (customer.credential.hostLocked) return { result: 'locked' };
      if (!pinMatches(phoneCode, pin)) return { result: 'invalid_pin' };
      return { result: 'ok', customer: customer.profile };
    },
    async changePin(customerId, phoneCode, currentPin, newPin, signal) {
      latency(signal);
      maybeFail('changePin');
      if (!pinMatches(phoneCode, currentPin)) return { result: 'invalid_pin' };
      pins.set(phoneCode, { salt: customerId, hash: hash(customerId, newPin) });
      return { result: 'ok' };
    },
    async getBalance(accountNumber, currency, signal) {
      latency(signal);
      maybeFail('getBalance');
      const b = MOCK_BALANCES[`${accountNumber}:${currency ?? 'SGD'}`];
      if (!b) throw new HostError('as400', '99', 'no balance record');
      const account = byAccount(accountNumber)?.profile.accounts.find((a) => a.number === accountNumber);
      return {
        current: b.current,
        available: b.available,
        holdAmount: b.hold,
        chequesPendingClearance: b.pending,
        overdraftLimit: b.od,
        omnibus: account?.omnibus ?? false,
      };
    },
    async listCurrencies(accountNumber, signal) {
      latency(signal);
      return byAccount(accountNumber)?.profile.accounts.find((a) => a.number === accountNumber)?.currencies ?? [];
    },
    async incomingFunds(accountNumber, sinceDate, signal) {
      latency(signal);
      maybeFail('incomingFunds');
      if (accountNumber !== '500000000101') return [];
      const t = today();
      const records: TransactionRecord[] = [
        { postedOn: t, amount: money(2_500), code: 'GIRO', description: 'GIRO credit' },
        { postedOn: t, amount: money(780.25), code: 'FAST', description: 'Local transfer' },
        ...Array.from({ length: 10 }, (_, i) => ({
          postedOn: addDays(t, -1 - (i % 6)),
          amount: money(100 + i * 37.5),
          code: 'TT',
          description: 'Overseas telegraphic transfer',
        })),
      ];
      return records.filter((r) => r.postedOn >= sinceDate);
    },
    async recentTransactions(accountNumber, limit, signal) {
      latency(signal);
      maybeFail('recentTransactions');
      const t = today();
      const records: TransactionRecord[] = Array.from({ length: 12 }, (_, i) => ({
        postedOn: addDays(t, -i),
        amount: money(i % 3 === 0 ? -(45 + i * 10) : 120 + i * 15),
        code: i % 3 === 0 ? '0451' : '0210',
        description: i % 3 === 0 ? 'Cheque payment' : 'Cash deposit',
      }));
      return accountNumber === '500000000301' ? [] : records.slice(0, limit);
    },
    async depositedCheques(accountNumber, status, sinceDate, signal) {
      latency(signal);
      const t = today();
      const all: DepositedCheque[] = [
        { chequeNumber: '204511', amount: money(1_200), status: 'deposited', on: t, returnReason: null },
        { chequeNumber: '204512', amount: money(640.5), status: 'deposited', on: addDays(t, -2), returnReason: null },
        { chequeNumber: null, amount: money(300), status: 'returned', on: addDays(t, -3), returnReason: 'insufficient funds' },
      ];
      return accountNumber === '500000000101' ? all.filter((c) => c.status === status && c.on >= sinceDate) : [];
    },
    async issuedChequeStatus(_accountNumber, chequeNumber, signal): Promise<IssuedCheque> {
      latency(signal);
      const n = Number(chequeNumber);
      if (n === 100005) return { status: 'cleared', amount: money(1_500), on: addDays(today(), -4), returnReason: null };
      if (n === 100006) return { status: 'returned', amount: money(800), on: addDays(today(), -2), returnReason: 'signature differs' };
      if (n === 100007) return { status: 'stopped', amount: null, on: addDays(today(), -10), returnReason: null };
      if (n >= 100001 && n <= 100100) return { status: 'not_presented', amount: null, on: null, returnReason: null };
      return { status: 'not_on_record', amount: null, on: null, returnReason: null };
    },
    async chequebooks(accountNumber, signal): Promise<ChequebookRecord[]> {
      latency(signal);
      maybeFail('chequebooks');
      if (!['500000000101', '500000000201', '500000000103'].includes(accountNumber)) return [];
      return [
        { issuedOn: addDays(today(), -20), firstChequeNumber: '100051', lastChequeNumber: '100100' },
        { issuedOn: addDays(today(), -200), firstChequeNumber: '100001', lastChequeNumber: '100050' },
      ];
    },
    async stopCheques(accountNumber, from, to, _key, signal) {
      latency(signal);
      maybeFail('stopCheques');
      await maybeHang('stopCheques', signal);
      if (Number(from) <= 100007 && 100007 <= Number(to)) throw new HostError('as400', '192');
      if (Number(from) <= 100005 && 100005 <= Number(to)) throw new HostError('as400', '196');
      controls.stopped.push({ account: accountNumber, from, to });
      return { stopped: Number(to) - Number(from) + 1 };
    },
    async requestStatement(_accountNumber, month, _key, signal) {
      latency(signal);
      maybeFail('requestStatement');
      await maybeHang('requestStatement', signal);
      return { reference: `STMT-${month}-MOCK` };
    },
    async requestChequebook(_accountNumber, delivery, _key, signal) {
      latency(signal);
      maybeFail('requestChequebook');
      await maybeHang('requestChequebook', signal);
      return { reference: `CBK-${delivery.toUpperCase()}-MOCK` };
    },
    async primeRate(signal) {
      latency(signal);
      maybeFail('primeRate');
      return { rate: '5.25' };
    },
    async fxRate(currency, signal) {
      latency(signal);
      maybeFail('fxRate');
      const r = MOCK_FX[currency];
      if (!r) throw new HostError('as400', '33');
      return { currency, ...r };
    },
    async timeDepositRates(signal) {
      latency(signal);
      maybeFail('timeDepositRates');
      return {
        minimumDeposit: money(5_000),
        rates: [
          { months: 1, rate: '0.05' },
          { months: 2, rate: '0.05' },
          { months: 3, rate: '0.10' },
          { months: 6, rate: '0.25' },
          { months: 12, rate: '0.50' },
        ],
      };
    },
  };

  const otps = new Map<string, { otp: string; wrong: number }>();
  const otp: OtpPort = {
    async send(customerId, signal) {
      latency(signal);
      maybeFail('otpSend');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      otps.set(customerId, { otp: code, wrong: 0 });
      controls.otpOutbox.push({ customerId, otp: code });
      onOtp?.(customerId, code);
      return { result: 'sent' };
    },
    async verify(customerId, value, signal) {
      latency(signal);
      const entry = otps.get(customerId);
      if (!entry) return { result: 'invalid' };
      if (entry.otp === value) {
        otps.delete(customerId);
        return { result: 'ok' };
      }
      entry.wrong += 1;
      return { result: entry.wrong >= 5 ? 'locked' : 'invalid' };
    },
  };

  type Booking = Appointment & { readonly customerId: string };
  const bookings: Booking[] = [];
  const issuedSlots = new Map<string, AppointmentSlot & { service: AppointmentService }>();
  const crm: CrmPort = {
    async verifyAccountAndNric(accountNumber, nric, signal) {
      latency(signal);
      maybeFail('verifyAccountAndNric');
      const customer = byAccount(accountNumber);
      if (!customer || customer.credential.accountNumber !== accountNumber) return { result: 'invalid_account' };
      if (customer.credential.nric !== nric) return { result: 'invalid_nric' };
      return { result: 'ok', customer: customer.profile };
    },
    async identifyAccount(accountNumber, signal) {
      latency(signal);
      const customer = byAccount(accountNumber);
      return { found: Boolean(customer), customerId: customer?.profile.customerId ?? null, segment: customer?.profile.segment ?? null };
    },
    async createServiceRequest(sr, _key, signal) {
      latency(signal);
      maybeFail('createServiceRequest');
      controls.serviceRequests.push(sr);
      return { srNumber: `SR-MOCK-${String(controls.serviceRequests.length).padStart(5, '0')}` };
    },
    async appointmentSlots({ service, branchId, fromDate }, signal): Promise<AppointmentSlot[]> {
      latency(signal);
      const slots: AppointmentSlot[] = [];
      for (let i = 0; i < 30 && slots.length < 6; i++) {
        const date = addDays(fromDate, i);
        const day = weekdayOf(date);
        // Deck p45: payment training on Wednesdays 9:30–12:30; trade training the last Friday of the month 10–12.
        const fits =
          service === 'foreign_worker_account'
            ? day >= 1 && day <= 5
            : service === 'velocity_payment_training'
              ? day === 3
              : day === 5 && addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
        if (!fits) continue;
        const [start, end] =
          service === 'velocity_trade_training' ? ['10:00', '12:00'] : service === 'velocity_payment_training' ? ['09:30', '12:30'] : ['09:30', '10:30'];
        const slotId = `slot_${service.slice(0, 3)}_${branchId.replace(/[^a-z0-9]/g, '')}_${date.replace(/-/g, '')}`;
        const taken = bookings.filter((b) => b.date === date && b.branchId === branchId && b.service === service).reduce((n, b) => n + b.partySize, 0);
        const slot = { slotId, branchId, date, start: start as string, end: end as string, capacity: 12 - taken };
        issuedSlots.set(slotId, { ...slot, service });
        slots.push(slot);
      }
      return slots;
    },
    async bookAppointment({ slotId, customerId, partySize }, _key, signal) {
      latency(signal);
      const slot = issuedSlots.get(slotId);
      if (!slot) throw new HostError('siebel', 'slot_not_found');
      const bookingId = `bk_${bookings.length + 1}`;
      bookings.push({ bookingId, service: slot.service, branchId: slot.branchId, date: slot.date, start: slot.start, end: slot.end, partySize, customerId });
      return { bookingId };
    },
    async listAppointments(customerId, signal) {
      latency(signal);
      return bookings.filter((b) => b.customerId === customerId);
    },
    async cancelAppointment(bookingId, customerId, _key, signal) {
      latency(signal);
      const i = bookings.findIndex((b) => b.bookingId === bookingId && b.customerId === customerId);
      if (i < 0) throw new HostError('siebel', 'not_found');
      bookings.splice(i, 1);
    },
  };

  const languageCounts = new Map<string, { language: 'en' | 'zh'; count: number }>();
  const content: ContentPort = {
    async isHoliday(date) {
      return date.endsWith('-12-25') || date.endsWith('-01-01');
    },
    async branches() {
      return MOCK_BRANCHES as unknown as Branch[];
    },
    async preferredLanguage(callerId) {
      const entry = languageCounts.get(callerId);
      return entry && entry.count >= 5 ? entry.language : null;
    },
    async recordLanguageChoice(callerId, language) {
      const entry = languageCounts.get(callerId);
      languageCounts.set(callerId, entry && entry.language === language ? { language, count: entry.count + 1 } : { language, count: 1 });
    },
    async insertCallback(request) {
      if (controls.callbacks.some((c) => c.number === request.number && c.date === request.date)) return { result: 'duplicate' };
      controls.callbacks.push({ number: request.number, date: request.date });
      return { result: 'created' };
    },
    async announcements(kind) {
      return kind === 'promotions'
        ? [{ id: 'p1', title: 'Test promotion', text: 'This is a test promotion from the test content service.' }]
        : [{ id: 'g1', title: 'GIRO and SWIFT', text: 'Bank code 0000, SWIFT code TESTSGSGXXX (test values).' }];
    },
  };

  return { ports: { core, crm, content, otp }, controls };
}
