// The made-up bank behind the mock API (server.mjs): customers, accounts, cheques, cards, rates, branches and the contact-centre tables for the
// Singapore and Malaysia lines of the business-banking design (docs: "Business Banking Phone Agents: Weave Design"). Every name, number and code
// here is invented. `freshData()` returns a new copy, so a restart (or a test) starts from the same state.

const sgAccounts = {
  // Acme Trading Pte Ltd: a business customer with a phone code (full access, P)
  501234567001: { cif: 'SG0001001', type: 'Current Account', currency: 'SGD', balance: 128450.75, available: 126900.75, cheques: true },
  501234567002: { cif: 'SG0001001', type: 'Business Savings', currency: 'SGD', balance: 482300.0, available: 482300.0, cheques: false },
  501234567003: { cif: 'SG0001001', type: 'ACU Current Account', currency: 'USD', balance: 75210.4, available: 75210.4, cheques: true, acu: true },
  // Lim & Co Logistics: account services only (AS), verified by account number, NRIC and a one-time password
  502468013579: { cif: 'SG0002002', type: 'Current Account', currency: 'SGD', balance: 23890.1, available: 22140.1, cheques: true },
  // a dormant account
  503000111222: { cif: 'SG0003003', type: 'Current Account', currency: 'SGD', balance: 12.5, available: 0, cheques: true, dormant: true },
  // Investigations: the account a VIP's last service manager looks after
  509876543210: { cif: 'SG0004004', type: 'Current Account', currency: 'SGD', balance: 918400.0, available: 918400.0, cheques: true },
};

const sgCustomers = {
  SG0001001: {
    cif: 'SG0001001',
    name: 'Acme Trading Pte Ltd',
    contact: 'Tan Wei Ming',
    user_type: 'business',
    access_level: 'P',
    phone_code: '1234567',
    pin: '246810',
    nric_last4: '567A',
    mobile: '+6591234567',
    accounts: ['501234567001', '501234567002', '501234567003'],
    bizconn: true,
    segment: 'BI',
  },
  SG0002002: {
    cif: 'SG0002002',
    name: 'Lim & Co Logistics',
    contact: 'Lim Mei Ling',
    user_type: 'business',
    access_level: 'AS',
    phone_code: '7654321',
    pin: '135790',
    nric_last4: '321B',
    mobile: '+6598887777',
    accounts: ['502468013579'],
    bizconn: false,
    segment: 'BI',
  },
  SG0003003: {
    cif: 'SG0003003',
    name: 'Old Harbour Traders',
    contact: 'Ong Boon Keat',
    user_type: 'business',
    access_level: 'AC',
    nric_last4: '888C',
    mobile: '+6590001111',
    accounts: ['503000111222'],
    segment: 'BI',
  },
  SG0004004: {
    cif: 'SG0004004',
    name: 'Goh Holdings Pte Ltd',
    contact: 'Goh Kian Huat',
    user_type: 'business',
    access_level: 'P',
    phone_code: '2468024',
    pin: '112233',
    nric_last4: '246D',
    mobile: '+6598765432',
    accounts: ['509876543210'],
    bizconn: true,
    segment: 'BC',
  },
  // a personal customer who dialled the business line
  SG0009009: { cif: 'SG0009009', name: 'Jessie Koh', user_type: 'personal', access_level: 'P', phone_code: '1111111', pin: '111111', accounts: [] },
};

const today = new Date('2026-10-26T10:00:00+08:00');
const daysAgo = (n) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);

const history = {
  501234567001: [
    { date: daysAgo(0), description: 'FAST payment to Sunrise Supplies', amount: -4200.0 },
    { date: daysAgo(1), description: 'GIRO salary run', amount: -38650.0 },
    { date: daysAgo(2), description: 'Inward TT from Nippon Parts Co', amount: 15880.25 },
    { date: daysAgo(4), description: 'Cheque 000231 cleared', amount: -1250.0 },
    { date: daysAgo(6), description: 'Service charge', amount: -25.0 },
  ],
  501234567002: [{ date: daysAgo(3), description: 'Interest credit', amount: 312.48 }],
  501234567003: [{ date: daysAgo(5), description: 'Inward TT from Pacific Freight LLC', amount: 9800.0 }],
  502468013579: [
    { date: daysAgo(1), description: 'Cheque deposit 482211', amount: 3400.0 },
    { date: daysAgo(2), description: 'PayNow to Lim Mei Ling', amount: -1500.0 },
  ],
};

const incomingFunds = {
  501234567001: [
    { date: daysAgo(0), from: 'Nippon Parts Co', currency: 'SGD', amount: 15880.25, status: 'credited', reference: 'TT260412' },
    { date: daysAgo(0), from: 'Harbour Exports Ltd', currency: 'USD', amount: 6200.0, status: 'pending', reference: 'TT260419' },
  ],
  502468013579: [],
};

const chequeDeposits = {
  501234567001: [{ date: daysAgo(1), cheque_no: '774410', amount: 2600.0, status: 'cleared', value_date: daysAgo(0) }],
  502468013579: [
    { date: daysAgo(1), cheque_no: '482211', amount: 3400.0, status: 'clearing', value_date: daysAgo(-1) },
    { date: daysAgo(3), cheque_no: '009812', amount: 780.0, status: 'returned', reason: 'Payment stopped by drawer' },
  ],
};

const issuedCheques = {
  '501234567001:000231': { status: 'paid', amount: 1250.0, paid_on: daysAgo(4) },
  '501234567001:000232': { status: 'not presented' },
  '501234567001:000233': { status: 'stopped', stopped_on: daysAgo(10) },
  '502468013579:118804': { status: 'not presented' },
};

const chequeBooks = {
  501234567001: { from: '000226', to: '000275', sent_on: daysAgo(40), delivery: 'mailed to registered address' },
  502468013579: { from: '118801', to: '118850', sent_on: daysAgo(15), delivery: 'collected at Tampines branch' },
  501234567003: { from: '900101', to: '900125', sent_on: daysAgo(90), delivery: 'mailed to registered address' },
};

// Contact-centre tables (CMM): caller preferences, the VIP table, service codes, the call-back list, bookings
const callers = {
  '+6591234567': { language: 'en', favourite_txn: 'balance', is_vip: false },
  '+6598887777': { language: 'zh', favourite_txn: '', is_vip: false },
  '+6598765432': { language: 'en', favourite_txn: '', is_vip: true },
  '+6597770000': { language: 'zh', favourite_txn: '', is_vip: true },
};

const vips = {
  '+6598765432': { name: 'Mr Goh Kian Huat', vip_type: 'account', account: '509876543210', language: 'en', last_sm: 'sm_rachel' },
  '+6597770000': { name: 'Ms Chua Li Ting', vip_type: 'phone_code', cif: 'SG0001001', language: 'zh', last_sm: 'sm_daniel' },
  '+6596660000': { name: 'Mr Arjun Pillai', vip_type: 'default', language: 'en', last_sm: 'sm_rachel' },
};

const serviceManagers = {
  sm_rachel: { id: 'sm_rachel', name: 'Rachel Ng', group: 'BC Service Managers', available: true },
  sm_daniel: { id: 'sm_daniel', name: 'Daniel Lee', group: 'BI Service Managers', available: false },
};

const investigations = {
  509876543210: { last_sm: 'sm_rachel', case: 'INV-77120', topic: 'Inward remittance trace' },
  501234567001: { last_sm: 'sm_daniel', case: 'INV-77098', topic: 'Cheque return query' },
};

const serviceCodes = { 328: { route: 'fd_loans', label: 'Fixed deposit, loan or FX dealing' } };

const rates = {
  sg: {
    prime: 5.35,
    sgd_td: [
      { tenor_months: 3, rate: 2.15 },
      { tenor_months: 6, rate: 2.25 },
      { tenor_months: 12, rate: 2.4 },
    ],
    fx: { USD: { buy: 1.3412, sell: 1.3528 }, EUR: { buy: 1.4521, sell: 1.4688 }, JPY: { buy: 0.008912, sell: 0.009034 }, MYR: { buy: 0.2985, sell: 0.3061 } },
  },
  my: {
    base_rate: 3.0,
    blr: 6.68,
    islamic_bfr: 6.68,
    fd: [
      { tenor_months: 3, rate: 2.6 },
      { tenor_months: 12, rate: 2.85 },
    ],
    fcy_fd: [{ currency: 'USD', tenor_months: 3, rate: 4.1 }],
    fx: { USD: { buy: 4.402, sell: 4.462 }, SGD: { buy: 3.268, sell: 3.35 } },
  },
};

const promotions = {
  sg: [
    { id: 'PR01', title: 'Business Growth Account: no fall-below fee for 12 months', until: '2026-12-31' },
    { id: 'PR02', title: '1.8% p.a. on a 6-month SGD fixed deposit from S$50,000', until: '2026-11-30' },
  ],
  my: [{ id: 'MP01', title: 'Zero annual fee on the OCBC Business Debit Card for 2026', until: '2026-12-31' }],
};

const forms = {
  sg: [
    { id: 'F01', title: 'Corporate Electronic Services Update Form' },
    { id: 'F02', title: 'Velocity Application Form' },
    { id: 'F03', title: 'Velocity User Request Form' },
    { id: 'F04', title: 'Stop Cheque Payment Instruction' },
  ],
  my: [
    { id: 'MF01', title: 'Account Mandate Change Form' },
    { id: 'MF02', title: 'FPX Direct Debit Termination Form' },
  ],
};

const branches = {
  sg: [
    { id: 'B01', name: 'OCBC Centre', address: '65 Chulia Street, Singapore 049513', hours: 'Mon–Fri 9:30 am to 4:30 pm', area: 'central' },
    {
      id: 'B02',
      name: 'Tampines',
      address: '1 Tampines Central 5, Singapore 529508',
      hours: 'Mon–Fri 9:30 am to 4:30 pm, Sat 9:30 am to 12:30 pm',
      area: 'east',
    },
    { id: 'B03', name: 'Jurong East', address: '50 Jurong Gateway Road, Singapore 608549', hours: 'Mon–Fri 9:30 am to 4:30 pm', area: 'west' },
  ],
  my: [
    {
      id: 'MB01',
      name: 'Menara OCBC, Kuala Lumpur',
      address: '18 Jalan Tun Perak, 50050 Kuala Lumpur',
      hours: 'Mon–Fri 9:15 am to 4:30 pm',
      area: 'kuala lumpur',
    },
    { id: 'MB02', name: 'Penang', address: '10 Lebuh Pantai, 10300 George Town', hours: 'Mon–Fri 9:15 am to 4:30 pm', area: 'penang' },
  ],
};

const bankCodes = {
  bank: 'OCBC Bank (Singapore)',
  giro_bank_code: '7339',
  swift: 'OCBCSGSG',
  branch_code_note: 'The branch code is the first three digits of the account number.',
};

const slots = {
  foreign_worker: [
    { id: 'S1', branch: 'B02', date: daysAgo(-2), time: '10:00' },
    { id: 'S2', branch: 'B03', date: daysAgo(-3), time: '14:30' },
  ],
  payment_training: [{ id: 'S3', branch: 'B01', date: daysAgo(-5), time: '09:30' }],
  trade_training: [{ id: 'S4', branch: 'B01', date: daysAgo(-7), time: '14:00' }],
};

// Malaysia: Business Banking (key code + TPIN) and Consumer (phone code + TPIN)
const myCustomers = {
  MY1001: {
    cif: 'MY1001',
    name: 'Syarikat Maju Jaya Sdn Bhd',
    contact: 'Ahmad bin Ismail',
    line: 'business',
    key_code: '12345678',
    tpin: '123456',
    accounts: ['7011223344', '7011223355'],
  },
  MY2002: {
    cif: 'MY2002',
    name: 'Aisyah binti Rahman',
    line: 'consumer',
    phone_code: '87654321',
    tpin: '654321',
    ic: '880101145678',
    iq_member: true,
    accounts: ['7022334455'],
    cards: ['4321'],
    bills: ['TNB-221144', 'UNIFI-998877'],
  },
  MY3003: { cif: 'MY3003', name: 'Lee Chong Wei Enterprise', line: 'business', key_code: '11112222', tpin: '999999', accounts: ['7033445566'] },
};

const myAccounts = {
  7011223344: { cif: 'MY1001', type: 'Current Account', currency: 'MYR', balance: 256780.4, cheques: true },
  7011223355: { cif: 'MY1001', type: 'Foreign Currency Account', currency: 'USD', balance: 18900.0, cheques: false },
  7022334455: { cif: 'MY2002', type: 'Savings Account', currency: 'MYR', balance: 8420.15, cheques: false },
  7033445566: { cif: 'MY3003', type: 'Current Account-i', currency: 'MYR', balance: 41200.0, cheques: true, islamic: true },
};

const myLoans = {
  MY1001: [{ id: 'LN-5521', type: 'Business term loan', monthly: 4200.0, due: daysAgo(-6) }],
  MY2002: [{ id: 'HL-8810', type: 'Home loan', monthly: 2150.0, due: daysAgo(-9) }],
};

const myCards = {
  4321: {
    cif: 'MY2002',
    product: 'OCBC Titanium MasterCard',
    status: 'inactive',
    limit: 15000,
    balance: 2310.55,
    minimum_due: 115.53,
    due: daysAgo(-12),
    annual_fee: 150,
  },
};

const fpx = { MY1001: [{ id: 'DD-310', merchant: 'Takaful Ikhlas', amount: 380.0, status: 'active' }] };

const myHistory = {
  7011223344: [
    { date: daysAgo(0), description: 'IBG transfer to Pembekal Bina', amount: -12500.0 },
    { date: daysAgo(2), description: 'Cheque deposit 102233', amount: 8600.0 },
  ],
  7022334455: [{ date: daysAgo(1), description: 'DuitNow from Siti', amount: 250.0 }],
};

const myCheques = { '7011223344:102230': { status: 'paid', amount: 4300.0, paid_on: daysAgo(3) }, '7011223344:102231': { status: 'not presented' } };

export function freshData() {
  return structuredClone({
    sg: {
      customers: sgCustomers,
      accounts: sgAccounts,
      history,
      incomingFunds,
      chequeDeposits,
      issuedCheques,
      chequeBooks,
      callers,
      vips,
      serviceManagers,
      investigations,
      serviceCodes,
      rates: rates.sg,
      promotions: promotions.sg,
      forms: forms.sg,
      branches: branches.sg,
      bankCodes,
      slots,
    },
    my: {
      customers: myCustomers,
      accounts: myAccounts,
      loans: myLoans,
      cards: myCards,
      fpx,
      history: myHistory,
      cheques: myCheques,
      rates: rates.my,
      promotions: promotions.my,
      forms: forms.my,
      branches: branches.my,
    },
    // what the agents did, newest last: service requests, bookings, call-backs, surveys, transfers, faxes, payments
    activity: [],
    otp: {},
    callbacks: [],
    bookings: [],
  });
}

// The one-time password the mock "sends" by SMS: always this, so a tester can key it in.
export const MOCK_OTP = '123456';
