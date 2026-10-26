// A mock of the bank systems the business-banking phone agents call (docs: "Business Banking Phone Agents: Weave Design", section 20). Plain Node,
// no packages. Each system the design names is a path prefix, and each agent's connection points at one:
//   Singapore  /sg/as400 (logins, CIF, PIN change, cheque status, stop payment, rates)   /sg/soa (balances, history, statements, cheque deposits and
//              books, TD rates, one-time passwords)   /sg/siebel (account login, service requests, last service manager)   /sg/cmm (caller
//              preferences, VIP table, service codes, promotions, forms, branches, bank codes, appointment slots and bookings, call-backs, surveys)
//              /sg/aacc (hand-overs into skill queues)   /sg/fax (forms and promotions by fax)
//   Malaysia   /my/core (logins, accounts, payments, cheques, cards, rates, branches, forms)   /my/contact (hand-overs, call-backs, surveys)
// Everything is made up (data.mjs) and kept in memory: a restart starts again from the same data. What the agents changed is listed at /activity.
//   node mock-bank/server.mjs            (PORT, default 4300; MOCK_BANK_KEY, when set, makes the address http://…/<key>: only who has it gets in)
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { MOCK_OTP, freshData } from './data.mjs';

const round = (n) => Math.round(n * 100) / 100;
const last4 = (account) => String(account).slice(-4);

// ---- the routes: [method, path pattern, handler(ctx)] where ctx = { data, params, query, body, record(kind, detail) }
function routes() {
  const r = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:([a-z][a-z0-9_]*)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
    r.push({ method, re, keys, handler });
  };

  // ---------------------------------------------------------------- Singapore: AS400
  // Phone code + PIN login. code: 0 ok, 83 phone code unknown, 53 wrong PIN, 50 not authorised (no business CIF), 62 locked after 3 wrong PINs.
  on('POST', '/sg/as400/login', ({ data, body }) => {
    const customer = Object.values(data.sg.customers).find((c) => c.phone_code && c.phone_code === String(body.phone_code || ''));
    if (!customer) return { ok: false, code: 83, reason: 'invalid_phone_code' };
    customer.wrong_pins ||= 0;
    if (customer.wrong_pins >= 3) return { ok: false, code: 62, reason: 'locked' };
    if (body.pin === undefined) return { ok: true, code: 0, phone_code_valid: true };
    if (customer.pin !== String(body.pin)) {
      customer.wrong_pins += 1;
      return customer.wrong_pins >= 3 ? { ok: false, code: 62, reason: 'locked' } : { ok: false, code: 53, reason: 'invalid_pin' };
    }
    customer.wrong_pins = 0;
    return { ok: true, code: 0, cif: customer.cif, user_type: customer.user_type, access_level: customer.access_level };
  });
  // The CIF profile: who it is, what access it has, its accounts and what they allow
  on('GET', '/sg/as400/cif/:cif', ({ data, params }) => {
    const c = data.sg.customers[params.cif];
    if (!c) return { found: false };
    const accounts = c.accounts.map((no) => ({
      number: no,
      last4: last4(no),
      ...pick(data.sg.accounts[no], ['type', 'currency', 'cheques', 'acu', 'dormant']),
    }));
    return {
      found: true,
      cif: c.cif,
      name: c.name,
      contact: c.contact,
      user_type: c.user_type,
      access_level: c.access_level,
      segment: c.segment,
      accounts,
      has_ca: accounts.some((a) => a.type?.includes('Current') && !a.acu),
      has_acu: accounts.some((a) => a.acu),
      has_acu_chq: accounts.some((a) => a.acu && a.cheques),
      bizconn: !!c.bizconn,
    };
  });
  // One of the customer's accounts, by the last four digits they said or keyed (choosing the account to act on)
  on('GET', '/sg/as400/cif/:cif/accounts/:last4', ({ data, params }) => findAccount(data.sg, params));
  on('POST', '/sg/as400/pin', ({ data, body, record }) => {
    const c = Object.values(data.sg.customers).find((x) => x.phone_code === String(body.phone_code || ''));
    if (!c || c.pin !== String(body.old_pin || '')) return { ok: false, reason: 'invalid_pin' };
    if (!/^\d{6}$/.test(String(body.new_pin || ''))) return { ok: false, reason: 'new_pin_must_be_6_digits' };
    if (String(body.new_pin) === c.pin) return { ok: false, reason: 'same_as_old' };
    c.pin = String(body.new_pin);
    record('pin_changed', { cif: c.cif });
    return { ok: true };
  });
  on('GET', '/sg/as400/cheques/:account/:cheque', ({ data, params }) => {
    const hit = data.sg.issuedCheques[`${params.account}:${params.cheque}`];
    return hit ? { found: true, cheque_no: params.cheque, ...hit } : { found: false, cheque_no: params.cheque };
  });
  on('POST', '/sg/as400/cheques/:account/stop', ({ data, params, body, record }) => {
    const key = `${params.account}:${body.cheque_no}`;
    const cheque = data.sg.issuedCheques[key];
    if (cheque?.status === 'paid') return { ok: false, reason: 'already_paid', paid_on: cheque.paid_on };
    data.sg.issuedCheques[key] = { status: 'stopped', stopped_on: new Date().toISOString().slice(0, 10) };
    const fee = 30;
    record('cheque_stopped', { account: params.account, cheque_no: body.cheque_no, reason: body.reason || '' });
    return { ok: true, cheque_no: body.cheque_no, fee_sgd: fee, reference: `STP-${String(Date.now()).slice(-6)}` };
  });
  on('GET', '/sg/as400/rates/prime', ({ data }) => ({ prime_rate_pct: data.sg.rates.prime }));
  on('GET', '/sg/as400/rates/fx/:currency', ({ data, params }) => {
    const fx = data.sg.rates.fx[String(params.currency).toUpperCase()];
    return fx
      ? {
          found: true,
          currency: params.currency.toUpperCase(),
          bank_buys_sgd_per_unit: fx.buy,
          bank_sells_sgd_per_unit: fx.sell,
          note: 'Indicative, below S$40,000',
        }
      : { found: false };
  });

  // ---------------------------------------------------------------- Singapore: SOA (CBS)
  on('GET', '/sg/soa/accounts/:account/balance', ({ data, params }) => {
    const a = data.sg.accounts[params.account];
    if (!a) return { found: false };
    return { found: true, account_last4: last4(params.account), type: a.type, currency: a.currency, ledger_balance: a.balance, available_balance: a.available };
  });
  on('GET', '/sg/soa/accounts/:account/incoming-funds', ({ data, params }) => ({ items: data.sg.incomingFunds[params.account] || [] }));
  on('GET', '/sg/soa/accounts/:account/history', ({ data, params, query }) => ({
    items: (data.sg.history[params.account] || []).slice(0, Number(query.limit) || 5),
  }));
  on('POST', '/sg/soa/accounts/:account/statements', ({ params, body, record }) => {
    record('statement_requested', { account: params.account, month: body.month || 'latest', delivery: body.delivery || 'mail' });
    return { ok: true, reference: `STM-${String(Date.now()).slice(-6)}`, delivery: body.delivery || 'mail', arrives_in_days: body.delivery === 'fax' ? 0 : 5 };
  });
  on('GET', '/sg/soa/accounts/:account/cheque-deposits', ({ data, params }) => ({ items: data.sg.chequeDeposits[params.account] || [] }));
  on('GET', '/sg/soa/accounts/:account/cheque-book', ({ data, params }) => {
    const book = data.sg.chequeBooks[params.account];
    return book ? { found: true, ...book } : { found: false };
  });
  on('POST', '/sg/soa/accounts/:account/cheque-book', ({ params, body, record }) => {
    const delivery = ['normal', 'express', 'same_day'].includes(body.delivery) ? body.delivery : 'normal';
    record('cheque_book_requested', { account: params.account, delivery });
    const days = { normal: 7, express: 3, same_day: 0 }[delivery];
    return { ok: true, reference: `CBR-${String(Date.now()).slice(-6)}`, delivery, ready_in_working_days: days, fee_sgd: delivery === 'normal' ? 0 : 20 };
  });
  on('GET', '/sg/soa/rates/sgd-td', ({ data }) => ({ items: data.sg.rates.sgd_td }));
  on('POST', '/sg/soa/otp/send', ({ data, body }) => {
    const c = data.sg.customers[body.cif];
    if (!c) return { sent: false, reason: 'unknown_customer' };
    if (c.otp_locked) return { sent: false, reason: 'otp_suspended' };
    data.otp[c.cif] = { code: MOCK_OTP, tries: 0 };
    return { sent: true, to_mobile_ending: String(c.mobile).slice(-4) };
  });
  on('POST', '/sg/soa/otp/verify', ({ data, body }) => {
    const pending = data.otp[body.cif];
    if (!pending) return { valid: false, reason: 'no_otp_sent' };
    if (String(body.otp) === pending.code) {
      delete data.otp[body.cif];
      return { valid: true };
    }
    pending.tries += 1;
    if (pending.tries >= 3) {
      data.sg.customers[body.cif].otp_locked = true;
      return { valid: false, reason: 'otp_suspended' };
    }
    return { valid: false, reason: 'wrong_otp', tries_left: 3 - pending.tries };
  });

  // ---------------------------------------------------------------- Singapore: Siebel
  // A 12-digit account number: the account's customer, or why not (invalidAcct, dormant)
  on('POST', '/sg/siebel/account-login', ({ data, body }) => {
    const no = String(body.account || '');
    const a = data.sg.accounts[no];
    if (!/^\d{12}$/.test(no) || !a) return { found: false, invalidAcct: 'Y' };
    const c = data.sg.customers[a.cif];
    return { found: true, cif: a.cif, name: c.name, dormant: !!a.dormant, access_level: c.access_level, user_type: c.user_type };
  });
  on('POST', '/sg/siebel/verify-contact', ({ data, body }) => {
    const c = data.sg.customers[body.cif];
    const ok = !!c && String(body.nric_last4 || '').toUpperCase() === String(c.nric_last4 || '').toUpperCase();
    return ok ? { valid: true } : { valid: false, invalidContact: 'Y' };
  });
  on('POST', '/sg/siebel/service-requests', ({ body, record }) => {
    const sr = `SR-${String(Date.now()).slice(-7)}`;
    record('service_request', { sr, ...pick(body, ['cif', 'account', 'type', 'category', 'subcategory', 'notes']) });
    return { ok: true, sr_number: sr };
  });
  on('GET', '/sg/siebel/accounts/:account/investigation', ({ data, params }) => {
    const inv = data.sg.investigations[params.account];
    if (!inv) return { found: false };
    const sm = data.sg.serviceManagers[inv.last_sm];
    return { found: true, case_id: inv.case, topic: inv.topic, last_service_manager: { id: sm.id, name: sm.name, group: sm.group } };
  });

  // ---------------------------------------------------------------- Singapore: CMM (contact-centre tables)
  on('GET', '/sg/cmm/callers/:phone', ({ data, params }) => {
    const c = data.sg.callers[normalisePhone(params.phone)];
    return c ? { found: true, ...c } : { found: false, language: '', favourite_txn: '', is_vip: false };
  });
  on('GET', '/sg/cmm/vip/:phone', ({ data, params }) => {
    const v = data.sg.vips[normalisePhone(params.phone)];
    if (!v) return { found: false };
    const sm = data.sg.serviceManagers[v.last_sm];
    return {
      found: true,
      name: v.name,
      vip_type: v.vip_type,
      language: v.language,
      account_last4: v.account ? last4(v.account) : '',
      last_service_manager: { id: sm.id, name: sm.name, group: sm.group },
    };
  });
  on('POST', '/sg/cmm/vip/:phone/check-account', ({ data, params, body }) => {
    const v = data.sg.vips[normalisePhone(params.phone)];
    return { valid: !!v && v.account === String(body.account || '') };
  });
  on('GET', '/sg/cmm/service-codes/:code', ({ data, params }) => {
    const s = data.sg.serviceCodes[params.code];
    return s ? { valid: true, code: params.code, ...s } : { valid: false, code: params.code };
  });
  on('GET', '/sg/cmm/promotions', ({ data }) => ({ items: data.sg.promotions }));
  on('GET', '/sg/cmm/forms', ({ data }) => ({ items: data.sg.forms }));
  on('GET', '/sg/cmm/branches', ({ data, query }) => ({ items: matchBranches(data.sg.branches, query.q) }));
  on('GET', '/sg/cmm/bank-codes', ({ data }) => data.sg.bankCodes);
  on('GET', '/sg/cmm/appointments/slots', ({ data, query }) => ({ items: (data.sg.slots[query.type] || []).map((s) => withBranch(s, data.sg.branches)) }));
  on('POST', '/sg/cmm/appointments', ({ data, body, record }) => {
    const all = Object.values(data.sg.slots).flat();
    const slot = all.find((s) => s.id === body.slot_id);
    if (!slot || slot.taken) return { ok: false, reason: 'slot_not_available' };
    slot.taken = true;
    const booking = {
      id: `BK-${String(Date.now()).slice(-6)}`,
      cif: body.cif || '',
      type: body.type || '',
      contact_name: body.contact_name || '',
      ...withBranch(slot, data.sg.branches),
    };
    data.bookings.push(booking);
    record('appointment_booked', booking);
    return { ok: true, booking_id: booking.id, date: slot.date, time: slot.time, branch: booking.branch_name };
  });
  on('GET', '/sg/cmm/appointments', ({ data, query }) => ({ items: data.bookings.filter((b) => !b.cancelled && (!query.cif || b.cif === query.cif)) }));
  on('POST', '/sg/cmm/appointments/:id/cancel', ({ data, params, record }) => {
    const b = data.bookings.find((x) => x.id === params.id && !x.cancelled);
    if (!b) return { ok: false, reason: 'no_such_booking' };
    b.cancelled = true;
    const slot = Object.values(data.sg.slots)
      .flat()
      .find((s) => s.id === b.slot_id || (s.date === b.date && s.time === b.time));
    if (slot) slot.taken = false;
    record('appointment_cancelled', { id: b.id });
    return { ok: true };
  });
  on('GET', '/sg/cmm/callbacks/:phone', ({ data, params }) => {
    const open = data.callbacks.find((c) => c.market === 'sg' && c.caller === normalisePhone(params.phone) && c.status === 'open');
    return open ? { open: true, number: open.number } : { open: false };
  });
  on('POST', '/sg/cmm/callbacks', ({ data, body, record }) => callback(data, 'sg', body, record));
  on('POST', '/sg/cmm/surveys', ({ body, record }) => survey('sg', body, record));
  on('POST', '/sg/cmm/calls/register', ({ body, record }) => {
    record('call_registered', pick(body, ['intent', 'skillset', 'cif']));
    return { ok: true };
  });

  // ---------------------------------------------------------------- Singapore: AACC and fax
  on('POST', '/sg/aacc/transfer', ({ data, body, headers, record }) => handOver(data, 'sg', body, headers, record));
  on('POST', '/sg/fax/send', ({ body, record }) => fax(body, record));

  // ---------------------------------------------------------------- Malaysia: core banking
  on('POST', '/my/core/login', ({ data, body }) => {
    const byKey = body.key_code !== undefined;
    const code = String(byKey ? body.key_code : body.phone_code || '');
    const c = Object.values(data.my.customers).find((x) => (byKey ? x.key_code : x.phone_code) === code || (!byKey && x.ic === code));
    if (!c) return { ok: false, reason: byKey ? 'invalid_key_code' : 'invalid_phone_code' };
    if (body.tpin === undefined) return { ok: true, code_valid: true };
    c.wrong_tpins ||= 0;
    if (c.wrong_tpins >= 3) return { ok: false, reason: 'locked' };
    if (c.tpin !== String(body.tpin)) {
      c.wrong_tpins += 1;
      return { ok: false, reason: c.wrong_tpins >= 3 ? 'locked' : 'invalid_tpin' };
    }
    c.wrong_tpins = 0;
    return { ok: true, cif: c.cif, line: c.line, iq_member: !!c.iq_member };
  });
  on('GET', '/my/core/customers/:cif', ({ data, params }) => {
    const c = data.my.customers[params.cif];
    if (!c) return { found: false };
    return {
      found: true,
      cif: c.cif,
      name: c.name,
      line: c.line,
      iq_member: !!c.iq_member,
      accounts: c.accounts.map((no) => ({ number: no, last4: last4(no), ...pick(data.my.accounts[no], ['type', 'currency', 'cheques', 'islamic']) })),
      cards: (c.cards || []).map((id) => ({ last4: id, product: data.my.cards[id]?.product })),
      loans: data.my.loans[c.cif] || [],
      bills: c.bills || [],
    };
  });
  on('GET', '/my/core/customers/:cif/accounts/:last4', ({ data, params }) => findAccount(data.my, params));
  on('GET', '/my/core/accounts/:account/balance', ({ data, params }) => {
    const a = data.my.accounts[params.account];
    return a ? { found: true, account_last4: last4(params.account), type: a.type, currency: a.currency, balance: a.balance } : { found: false };
  });
  on('GET', '/my/core/accounts/:account/history', ({ data, params }) => ({ items: (data.my.history[params.account] || []).slice(0, 5) }));
  on('POST', '/my/core/accounts/:account/statements', ({ params, body, record }) => {
    record('statement_requested', { market: 'my', account: params.account, month: body.month || 'latest' });
    return { ok: true, reference: `MST-${String(Date.now()).slice(-6)}`, arrives_in_days: 5 };
  });
  on('POST', '/my/core/transfers/own', ({ data, body, record }) => {
    const from = data.my.accounts[body.from_account];
    const to = data.my.accounts[body.to_account];
    const amount = Number(body.amount);
    if (!from || !to || from.cif !== to.cif) return { ok: false, reason: 'accounts_not_yours' };
    if (!isPositive(amount)) return { ok: false, reason: 'invalid_amount' };
    if (from.currency !== to.currency) return { ok: false, reason: 'different_currencies' };
    if (amount > from.balance) return { ok: false, reason: 'insufficient_funds' };
    from.balance = round(from.balance - amount);
    to.balance = round(to.balance + amount);
    const ref = `TRF-${String(Date.now()).slice(-6)}`;
    record('own_transfer', { ref, from: last4(body.from_account), to: last4(body.to_account), amount });
    return { ok: true, reference: ref, new_balance_from: from.balance };
  });
  on('POST', '/my/core/payments/:kind', ({ data, params, body, record }) => {
    if (!['loan', 'credit_card', 'utility', 'giro'].includes(params.kind)) return { ok: false, reason: 'unknown_payment' };
    const from = data.my.accounts[body.from_account];
    const amount = Number(body.amount);
    if (!from) return { ok: false, reason: 'unknown_account' };
    if (!isPositive(amount)) return { ok: false, reason: 'invalid_amount' };
    if (amount > from.balance) return { ok: false, reason: 'insufficient_funds' };
    from.balance = round(from.balance - amount);
    const ref = `PAY-${String(Date.now()).slice(-6)}`;
    record(`payment_${params.kind}`, { ref, from: last4(body.from_account), to: body.payee || body.reference || '', amount });
    return { ok: true, reference: ref, new_balance: from.balance };
  });
  on('GET', '/my/core/fpx/:cif', ({ data, params }) => ({ items: data.my.fpx[params.cif] || [] }));
  on('POST', '/my/core/fpx/:cif/:id/terminate', ({ data, params, record }) => {
    const dd = (data.my.fpx[params.cif] || []).find((x) => x.id === params.id);
    if (!dd) return { ok: false, reason: 'no_such_direct_debit' };
    dd.status = 'terminated';
    record('fpx_terminated', { cif: params.cif, id: params.id });
    return { ok: true };
  });
  on('GET', '/my/core/cheques/:account/:cheque', ({ data, params }) => {
    const hit = data.my.cheques[`${params.account}:${params.cheque}`];
    return hit ? { found: true, cheque_no: params.cheque, ...hit } : { found: false, cheque_no: params.cheque };
  });
  on('POST', '/my/core/cheques/:account/stop', ({ data, params, body, record }) => {
    data.my.cheques[`${params.account}:${body.cheque_no}`] = { status: 'stopped' };
    record('cheque_stopped', { market: 'my', account: params.account, cheque_no: body.cheque_no });
    return { ok: true, fee_myr: 10, reference: `MSTP-${String(Date.now()).slice(-6)}` };
  });
  on('POST', '/my/core/accounts/:account/cheque-book', ({ params, record }) => {
    record('cheque_book_requested', { market: 'my', account: params.account });
    return { ok: true, reference: `MCB-${String(Date.now()).slice(-6)}`, ready_in_working_days: 7 };
  });
  on('GET', '/my/core/cards/:card', ({ data, params }) => {
    const c = data.my.cards[params.card];
    return c
      ? { found: true, last4: params.card, ...pick(c, ['product', 'status', 'limit', 'balance', 'minimum_due', 'due', 'annual_fee']) }
      : { found: false };
  });
  on('POST', '/my/core/cards/:card/:action', ({ data, params, body, record }) => {
    const c = data.my.cards[params.card];
    if (!c) return { ok: false, reason: 'unknown_card' };
    const ref = `CRD-${String(Date.now()).slice(-6)}`;
    if (params.action === 'activate') {
      if (c.status === 'active') return { ok: false, reason: 'already_active' };
      c.status = 'active';
    } else if (params.action === 'fee-waiver') {
      if (!c.annual_fee) return { ok: false, reason: 'no_fee_to_waive' };
      c.annual_fee = 0;
    } else if (params.action === 'credit-limit') {
      const wanted = Number(body.new_limit);
      if (!isPositive(wanted)) return { ok: false, reason: 'invalid_limit' };
      if (wanted > c.limit) return { ok: true, reference: ref, outcome: 'review', note: 'An increase is reviewed within 3 working days.' };
      c.limit = wanted;
    } else if (params.action === 'balance-transfer') {
      if (!isPositive(Number(body.amount))) return { ok: false, reason: 'invalid_amount' };
    } else return { ok: false, reason: 'unknown_action' };
    record(`card_${params.action}`, { card: params.card, ...pick(body, ['new_limit', 'amount', 'from_bank']) });
    return { ok: true, reference: ref, status: c.status, limit: c.limit };
  });
  on('GET', '/my/core/card-applications/:ic', ({ params }) =>
    String(params.ic).endsWith('5678') ? { found: true, status: 'approved', card: 'OCBC 365 Credit Card', sent_on: '2026-10-22' } : { found: false },
  );
  on('GET', '/my/core/rates', ({ data }) => data.my.rates);
  on('GET', '/my/core/branches', ({ data, query }) => ({ items: matchBranches(data.my.branches, query.q) }));
  on('GET', '/my/core/forms', ({ data }) => ({ items: data.my.forms }));
  on('POST', '/my/core/fax', ({ body, record }) => fax(body, record));

  // ---------------------------------------------------------------- Malaysia: contact centre
  on('POST', '/my/contact/transfer', ({ data, body, headers, record }) => handOver(data, 'my', body, headers, record));
  on('POST', '/my/contact/callbacks', ({ data, body, record }) => callback(data, 'my', body, record));
  on('POST', '/my/contact/surveys', ({ body, record }) => survey('my', body, record));

  return r;
}

// ---- shared answers
function handOver(data, market, body, headers, record) {
  // the queue is "busy" for the service manager who is away in the data (Daniel Lee), so the call-back path can be tried
  const sm = body.service_manager_id ? data.sg.serviceManagers[body.service_manager_id] : null;
  if (sm && !sm.available) return { ok: false, transferred: false, reason: 'service_manager_unavailable', name: sm.name };
  const screenPop = Object.fromEntries(Object.entries(headers).filter(([k]) => k.startsWith('x-')));
  record('hand_over', { market, skillset: body.skillset || '', priority: body.priority || 'normal', intent: body.intent || '', screen_pop: screenPop });
  return { ok: true, transferred: true, queue: body.skillset || 'general', estimated_wait_s: body.priority === 'high' ? 20 : 90 };
}
function callback(data, market, body, record) {
  const number = String(body.number || body.caller || '');
  if (!/^\+?\d{5,15}$/.test(number.replace(/[\s-]/g, ''))) return { ok: false, reason: 'number_must_be_5_to_15_digits' };
  const item = {
    id: `CB-${String(Date.now()).slice(-6)}`,
    market,
    caller: normalisePhone(body.caller || number),
    number,
    status: 'open',
    reason: body.reason || '',
  };
  data.callbacks.push(item);
  record('callback_requested', item);
  return { ok: true, request_id: item.id };
}
function survey(market, body, record) {
  const scores = ['q1', 'q2', 'q3'].map((k) => Number(body[k]));
  if (scores.some((s) => !(s >= 1 && s <= 5))) return { ok: false, reason: 'scores_must_be_1_to_5' };
  record('survey', { market, profile: body.profile || 'ivr', q1: scores[0], q2: scores[1], q3: scores[2] });
  return { ok: true };
}
function fax(body, record) {
  const number = String(body.fax_number || '').replace(/\D/g, '');
  if (number.length < 8) return { ok: false, reason: 'fax_number_too_short' };
  record('fax_sent', { to: number, document: body.document_id || body.title || '' });
  return { ok: true, job_id: `FX-${String(Date.now()).slice(-6)}` };
}

// ---- helpers
// a real number above zero (not NaN, not Infinity): amounts and limits
function isPositive(n) {
  return Number.isFinite(n) && n > 0;
}
function findAccount(market, { cif, last4: digits }) {
  const c = market.customers[cif];
  const no = (c?.accounts || []).find((a) => a.endsWith(String(digits)));
  if (!no) return { found: false };
  const a = market.accounts[no];
  return { found: true, number: no, last4: last4(no), type: a.type, currency: a.currency, cheques: !!a.cheques };
}
function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]]));
}
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^[89]\d{7}$/.test(digits)) return `+65${digits}`;
  return digits ? `+${digits}` : '';
}
function matchBranches(branches, q) {
  const words = String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return branches;
  return branches.filter((b) => words.some((w) => `${b.name} ${b.address} ${b.area}`.toLowerCase().includes(w)));
}
function withBranch(slot, branches) {
  const b = branches.find((x) => x.id === slot.branch);
  return { slot_id: slot.id, date: slot.date, time: slot.time, branch_name: b?.name || slot.branch, branch_address: b?.address || '' };
}

// ---- the server
// With a `key`, the API answers only under /<key> (a private link): any other address, / and /activity included, is a 404.
export function createMockBank({ data = freshData(), log = () => {}, key = '' } = {}) {
  const table = routes();
  const record = (kind, detail) => data.activity.push({ at: new Date().toISOString(), kind, ...detail });
  return http.createServer(async (req, res) => {
    let [pathname, search = ''] = String(req.url).split('?');
    const send = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(json, null, 2));
    };
    if (key) {
      if (pathname !== `/${key}` && !pathname.startsWith(`/${key}/`)) {
        log(`${req.method} (without the key) -> 404`);
        return send(404, { error: 'not_found' });
      }
      pathname = pathname.slice(key.length + 1) || '/';
    }
    const url = { pathname, searchParams: new URLSearchParams(search) };
    if (req.method === 'GET' && url.pathname === '/') return send(200, overview());
    if (req.method === 'GET' && url.pathname === '/activity') return send(200, { items: data.activity });
    const route = table.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) {
      log(`${req.method} ${url.pathname} -> 404`);
      return send(404, { error: 'not_found', path: url.pathname });
    }
    let body = {};
    if (req.method !== 'GET') {
      const raw = await new Promise((resolve) => {
        let s = '';
        req.on('data', (c) => (s += c));
        req.on('end', () => resolve(s));
      });
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(400, { error: 'body_is_not_json' });
      }
    }
    const values = route.re.exec(url.pathname).slice(1).map(decodeURIComponent);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, values[i]]));
    const answer = route.handler({ data, params, query: Object.fromEntries(url.searchParams), body, headers: req.headers, record });
    log(`${req.method} ${url.pathname} -> 200`);
    send(200, answer);
  });
}

// What a tester needs: the systems, and the made-up customers to try them with.
function overview() {
  return {
    name: 'Mock bank API for the business-banking phone agents',
    activity: '/activity lists what the agents changed (service requests, bookings, call-backs, surveys, hand-overs, payments, faxes)',
    one_time_password: MOCK_OTP,
    singapore: {
      systems: ['/sg/as400', '/sg/soa', '/sg/siebel', '/sg/cmm', '/sg/aacc', '/sg/fax'],
      try: [
        'Acme Trading: phone code 1234567, PIN 246810 (full access), accounts ending 7001, 7002, 7003; caller ID +65 9123 4567',
        'Lim & Co Logistics: account 502468013579, NRIC ending 321B, then the one-time password (account services only)',
        'Dormant account: 503000111222. Personal customer on the business line: phone code 1111111, PIN 111111',
        'VIP callers: +65 9876 5432 (checked by account 509876543210), +65 9777 0000 (phone code), +65 9666 0000 (no check)',
        'Investigations: account 509876543210 (service manager Rachel Ng, free), 501234567001 (Daniel Lee, busy: offers a call-back)',
      ],
    },
    malaysia: {
      systems: ['/my/core', '/my/contact'],
      try: [
        'Business Banking: key code 12345678, TPIN 123456 (Syarikat Maju Jaya), accounts ending 3344 (MYR), 3355 (USD)',
        'Consumer: phone code 87654321, TPIN 654321 (Aisyah binti Rahman, iQ member), card ending 4321 (inactive), IC 880101145678',
      ],
    },
  };
}

// Run directly: listen, and print each request.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT) || 4300;
  const key = process.env.MOCK_BANK_KEY || '';
  createMockBank({ key, log: (line) => console.log(new Date().toISOString().slice(11, 19), line) }).listen(port, () => {
    const base = `http://localhost:${port}${key ? `/${key}` : ''}`;
    console.log(`Mock bank API on ${base}  (GET ${base}/ for the test customers, ${base}/activity for what the agents did)`);
  });
}
