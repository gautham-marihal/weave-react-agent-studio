// Tetherfi Unbound, use case 1 (AI onboarding with video): the systems around the two Agent Builder bots, as stand-ins.
//   /unbound/*  the bank's onboarding service: offers for a large deposit, the application, and a STAND-IN face check
//               (face match, liveness, deepfake). No picture is ever sent here: the bots keep pictures in the call's
//               memory only, so this route answers "passed" unless asked to simulate a failure. A real build calls a
//               verification provider instead.
//   /mx/*       the Tetherfi MX routing bridge: the AI hands the customer to a human agent's queue (an http_request
//               transfer), the human agent's desktop marks the hand-over done, and MX hands the customer back to the next
//               AI agent with the context (GET /mx/handbacks/latest).
//   /tqd/*      Tetherfi Quest Desk: the case for the new account, and the e-mail TQD sends the customer (kept in an
//               outbox here; nothing is really sent).
// Where the data lives: with BLOB_READ_WRITE_TOKEN set (on Vercel: the private Blob store weave-mock-unbound), in that
// store, so every copy of the function sees the same hand-overs, hand-backs, cases and e-mails; without it (this machine,
// the unit tests), in memory. A hand-back that can't be found falls back to the demo customer and says so with
// source: "demo_default". Figures are demo figures.

import { randomInt } from 'node:crypto';

// short references (TQD-48213): easy to say aloud, and too short for call-log redaction to take for an account number
const ref = (prefix) => `${prefix}-${randomInt(10000, 100000)}`;
const now = () => new Date().toISOString();
const bad = (reason) => [400, { ok: false, reason }];
const notFound = (what) => [404, { ok: false, reason: `No ${what} with that reference.` }];
const text = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

// ---- the store: put / get / newest, by kind (applications, handovers, handbacks, cases, outbox)
const memoryStore = () => {
  const kinds = new Map();
  const of = (kind) => kinds.get(kind) || kinds.set(kind, new Map()).get(kind);
  return {
    put: async (kind, id, value) => void of(kind).set(id, structuredClone(value)),
    get: async (kind, id) => (of(kind).has(id) ? structuredClone(of(kind).get(id)) : null),
    newest: async (kind, limit) =>
      [...of(kind).values()]
        .reverse()
        .slice(0, limit)
        .map((v) => structuredClone(v)),
    clear: () => kinds.clear(),
  };
};
const blobStore = () => {
  let lib;
  const blob = async () => (lib ??= await import('@vercel/blob'));
  const path = (kind, id) => `unbound/${kind}/${id}.json`;
  const read = async (pathname) => {
    const { get } = await blob();
    const found = await get(pathname, { access: 'private', useCache: false }).catch((err) => (err?.name === 'BlobNotFoundError' ? null : Promise.reject(err)));
    return found?.stream ? JSON.parse(await new Response(found.stream).text()) : null;
  };
  return {
    put: async (kind, id, value) => {
      const { put } = await blob();
      await put(path(kind, id), JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    },
    get: async (kind, id) => read(path(kind, id)),
    newest: async (kind, limit) => {
      const { list } = await blob();
      const { blobs } = await list({ prefix: `unbound/${kind}/`, limit: 1000 });
      const recent = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(0, limit);
      return (await Promise.all(recent.map((b) => read(b.pathname)))).filter(Boolean);
    },
    clear: () => {},
  };
};
const store = process.env.BLOB_READ_WRITE_TOKEN ? blobStore() : memoryStore();
// a name that sorts by time, for the kinds read newest first
const timeKey = (iso, id) => `${iso.replace(/\D/g, '')}-${id}`;

// the demo customer of the stage script, used when a hand-back can't be found (see the top of this file)
const DEMO_CUSTOMER = {
  first_name: 'Wei Ming',
  last_name: 'Tan',
  email: 'weiming.tan@example.com',
  mobile: '+6591234567',
};

// what the bank offers for a large one-off deposit (demo figures, per year)
const OFFERS = [
  {
    id: 'private_wealth',
    name: 'Private Wealth Account',
    min_amount: 1000000,
    rate: '3.10% p.a. on a 12-month fixed deposit',
    points: ['a dedicated relationship manager', 'a separate account just for this money', 'no account fees'],
  },
  {
    id: 'inheritance_holding',
    name: 'Inheritance Holding Account',
    min_amount: 250000,
    rate: '2.25% p.a., with access at any time',
    points: ['keep the money apart while you decide', 'move any part into fixed deposits later'],
  },
  {
    id: 'deposit_ladder',
    name: 'Laddered Fixed Deposits',
    min_amount: 100000,
    rate: '2.80% to 3.10% p.a. over 3, 6 and 12 months',
    points: ['part of the money comes free every few months', 'the rate is fixed for each part'],
  },
];
const SAFETY = [
  'Deposits are held by the bank itself and never lent to related companies.',
  'The deposit insurance scheme covers only up to its legal limit per depositor; above that, the bank’s capital ratios and ratings matter. A relationship manager can explain them.',
  'Large amounts can be split across accounts in your name.',
];
// the plans a human agent walks the customer through in the co-browse (the same ids as the offers), and who looks
// after each afterwards (demo names)
const PLANS = new Set(OFFERS.map((o) => o.id));
const MANAGERS = { private_wealth: 'Daniel Lim', inheritance_holding: 'Priya Nair', deposit_ladder: 'Marcus Goh' };
// from this amount (or for a politically exposed person) the bank runs enhanced due diligence: it must see proof of
// where the money comes from before the deposit is accepted (anti-money-laundering rules)
const EDD_FROM = 5000000;
const SOURCE_PROOF = {
  Inheritance: 'the grant of probate or letters of administration',
  'Sale of property': 'the sale and purchase agreement',
  'Business income': 'audited accounts or tax returns',
  'Salary or bonus': 'payslips or a letter from your employer',
  Investments: 'statements from the investment firm',
};

// what MX passes to the next AI agent when a human agent has finished
const handbackOf = (h) => ({
  ok: true,
  source: 'mx',
  handover_id: h.handover_id,
  application_id: h.application_id,
  customer_name: `${h.confirmed.first_name} ${h.confirmed.last_name}`.trim(),
  first_name: h.confirmed.first_name,
  email: h.customer.email,
  mobile: h.customer.mobile,
  plan_id: h.plan_id,
  plan_name: h.plan_name,
  account_number: h.account_number,
  account_last4: h.account_number.slice(-4),
  agent: h.agent,
  relationship_manager: h.relationship_manager,
  risk: h.risk,
  proof_needed: h.proof_needed,
  completed_at: h.completed_at,
});

const amountOf = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const UNBOUND_ROUTES = [
  // ---- the bank's onboarding service
  [
    'GET',
    '/unbound/offers',
    (_, __, q) => {
      const amount = amountOf(q.amount);
      const currency = text(q.currency).toUpperCase() || 'SGD';
      const offers = OFFERS.filter((o) => !amount || amount >= o.min_amount).map(({ min_amount, ...o }) => ({
        ...o,
        min_amount: `${currency} ${min_amount.toLocaleString('en-US')}`,
      }));
      return [
        200,
        {
          ok: true,
          amount: amount ? `${currency} ${amount.toLocaleString('en-US')}` : null,
          offers,
          safety: SAFETY,
          onboarding: 'Open the account in about 2 minutes, in this conversation: a short form, a photo of your ID card and a quick video check.',
          ...(amount >= EDD_FROM
            ? {
                requirements:
                  'For a deposit this size the bank must see proof of where the money comes from before it is credited (for an inheritance: the grant of probate or letters of administration). It can be sent after the account is opened; the relationship manager collects it.',
              }
            : {}),
          note: 'Demo figures.',
        },
      ];
    },
  ],
  [
    'POST',
    '/unbound/applications',
    async (_, body) => {
      const need = ['first_name', 'last_name', 'date_of_birth', 'email', 'mobile', 'id_number'];
      const missing = need.filter((k) => !text(body[k]));
      if (missing.length) return bad(`Missing: ${missing.join(', ')}.`);
      const amount = amountOf(body.amount);
      const pep = /^y/i.test(text(body.pep));
      const source = text(body.source_of_funds);
      const risk = amount >= EDD_FROM || pep ? 'enhanced_due_diligence' : 'standard';
      const application = {
        application_id: ref('APP'),
        status: 'details_received',
        customer: {
          first_name: text(body.first_name),
          last_name: text(body.last_name),
          email: text(body.email),
          mobile: text(body.mobile),
          nationality: text(body.nationality),
          address: text(body.address),
          occupation: text(body.occupation),
          tax_residency: text(body.tax_residency),
        },
        // the id number is kept only as its last four characters
        id_last4: text(body.id_number).slice(-4),
        amount: amount ? `${text(body.currency).toUpperCase() || 'SGD'} ${amount.toLocaleString('en-US')}` : '',
        source_of_funds: source,
        pep,
        risk,
        proof_needed: risk === 'enhanced_due_diligence' ? SOURCE_PROOF[source] || 'documents showing where the money comes from' : '',
        created_at: now(),
      };
      await store.put('applications', application.application_id, application);
      return [200, { ok: true, application_id: application.application_id, status: application.status, risk, proof_needed: application.proof_needed }];
    },
  ],
  [
    'POST',
    '/unbound/verify/face',
    async (_, body) => {
      // STAND-IN: no picture comes here. simulate: "no_match" | "deepfake" lets a demo show a failure.
      // A demo can also ask for a failure through the customer's e-mail: name+deepfake@… or name+nomatch@… (the e-mail
      // sent with the request, else the application's)
      const application = await store.get('applications', text(body.application_id));
      const email = text(body.email) || application?.customer.email || '';
      const tag = email.match(/\+(deepfake|nomatch)@/)?.[1];
      const simulate = text(body.simulate) || (tag === 'nomatch' ? 'no_match' : tag || '');
      const matched = simulate !== 'no_match';
      const fake = simulate === 'deepfake';
      if (application) await store.put('applications', application.application_id, { ...application, status: 'video_checked' });
      return [
        200,
        {
          ok: true,
          provider: 'stand-in',
          face_match: matched ? 'passed' : 'failed',
          face_score: matched ? 0.94 : 0.31,
          liveness: 'passed',
          deepfake: fake ? 'detected' : 'not_detected',
          deepfake_score: fake ? 0.88 : 0.03,
          checked_at: now(),
          note: 'Stand-in for a verification provider: no picture was sent or checked.',
        },
      ];
    },
  ],

  // ---- the Tetherfi MX routing bridge
  [
    'POST',
    '/mx/handovers',
    async (_, body) => {
      const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
      const application = await store.get('applications', text(body.application_id));
      if (!text(customer.first_name) && !text(customer.last_name)) return bad('Say who the customer is (customer.first_name, customer.last_name).');
      const handover = {
        handover_id: ref('HO'),
        status: 'queued',
        queue: text(body.queue) || 'account_opening',
        skill: 'video_kyc',
        reason: text(body.reason) || 'account_opening',
        // a list, or one text with the labels separated by commas (as compare_values writes them)
        differences: (Array.isArray(body.differences) ? body.differences : text(body.differences).split(',')).map(text).filter(Boolean),
        application_id: text(body.application_id),
        customer: { first_name: text(customer.first_name), last_name: text(customer.last_name), email: text(customer.email), mobile: text(customer.mobile) },
        checks: body.checks && typeof body.checks === 'object' ? body.checks : {},
        // what the human agent must also cover: enhanced due diligence and the proof of funds it needs
        risk: application?.risk || text(body.risk) || 'standard',
        proof_needed: application?.proof_needed || text(body.proof_needed),
        session: text(body.session),
        created_at: now(),
      };
      await store.put('handovers', handover.handover_id, handover);
      return [
        200,
        {
          ok: true,
          handover_id: handover.handover_id,
          status: 'queued',
          queue: handover.queue,
          position: 1,
          wait_s: 20,
          message: 'A video banking agent will join this call.',
        },
      ];
    },
  ],
  // the human agents' queue, newest first (what the agent desktop shows)
  [
    'GET',
    '/mx/handovers',
    async (_, __, q) => {
      const status = text(q.status);
      const list = (await store.newest('handovers', 50)).filter((h) => !status || h.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return [200, { ok: true, handovers: list.slice(0, 20) }];
    },
  ],
  [
    'GET',
    '/mx/handovers/:id',
    async ({ id }) => {
      const handover = await store.get('handovers', id);
      return handover ? [200, { ok: true, ...handover }] : notFound('hand-over');
    },
  ],
  [
    // what the human agent's desktop sends when the video check, the plan choice and the signing are done
    'POST',
    '/mx/handovers/:id/complete',
    async ({ id }, body) => {
      const handover = await store.get('handovers', id);
      if (!handover) return notFound('hand-over');
      const plan = text(body.plan_id);
      if (!PLANS.has(plan)) return bad(`Say the plan: ${[...PLANS].join(', ')}.`);
      if (body.signed !== true) return bad('The customer has not signed yet (signed: true).');
      Object.assign(handover, {
        status: 'returned_to_ai',
        plan_id: plan,
        plan_name: OFFERS.find((o) => o.id === plan).name,
        account_number: `5${String(Date.now()).slice(-9)}`,
        // the names as the human agent confirmed them on video (they may correct what the customer typed)
        confirmed: { first_name: text(body.first_name) || handover.customer.first_name, last_name: text(body.last_name) || handover.customer.last_name },
        agent: text(body.agent) || 'Video banking agent',
        relationship_manager: MANAGERS[plan],
        notes: text(body.notes),
        completed_at: now(),
      });
      await store.put('handovers', id, handover);
      // MX's hand-back to the next AI agent, kept under its own new name (so "the newest" never reads a stale copy)
      await store.put('handbacks', timeKey(handover.completed_at, id), handbackOf(handover));
      return [200, { ok: true, handover_id: id, status: handover.status, account_number: handover.account_number }];
    },
  ],
  [
    // MX hands the customer back to the next AI agent: the newest hand-over a human finished
    'GET',
    '/mx/handbacks/latest',
    async () => {
      const [latest] = await store.newest('handbacks', 1);
      if (latest) return [200, latest];
      return [
        200,
        {
          ok: true,
          source: 'demo_default',
          handover_id: 'HO-DEMO',
          application_id: 'APP-DEMO',
          customer_name: `${DEMO_CUSTOMER.first_name} ${DEMO_CUSTOMER.last_name}`,
          first_name: DEMO_CUSTOMER.first_name,
          email: DEMO_CUSTOMER.email,
          mobile: DEMO_CUSTOMER.mobile,
          plan_id: 'private_wealth',
          plan_name: 'Private Wealth Account',
          account_number: '5000012345',
          account_last4: '2345',
          agent: 'Video banking agent',
          relationship_manager: MANAGERS.private_wealth,
          risk: 'enhanced_due_diligence',
          proof_needed: SOURCE_PROOF.Inheritance,
        },
      ];
    },
  ],
  [
    // the account opened by the AI when the customer is fully verified: the plan chosen and the application signed
    // (a failed verification goes to a video banking agent instead, through MX)
    'POST',
    '/unbound/accounts',
    async (_, body) => {
      const offer = OFFERS.find((o) => o.id === text(body.plan_id) || o.name.toLowerCase() === text(body.plan_name).toLowerCase());
      if (!offer) return bad(`Say the plan: ${OFFERS.map((o) => o.name).join(', ')}.`);
      if (body.signed !== true && text(body.signed).toLowerCase() !== 'true') return bad('The customer has not signed yet (signed: true).');
      const application = await store.get('applications', text(body.application_id));
      const account = {
        account_number: `5${String(Date.now()).slice(-9)}`,
        application_id: text(body.application_id),
        plan_id: offer.id,
        plan_name: offer.name,
        relationship_manager: MANAGERS[offer.id],
        risk: application?.risk || text(body.risk) || 'standard',
        proof_needed: application?.proof_needed || text(body.proof_needed),
        opened_by: 'ai',
        opened_at: now(),
      };
      await store.put('accounts', account.account_number, account);
      return [200, { ok: true, ...account, account_last4: account.account_number.slice(-4) }];
    },
  ],
  [
    // when no video banking agent can be reached: a call-back is booked (the AI says the reference)
    'POST',
    '/unbound/callbacks',
    (_, body) => {
      const mobile = text(body.mobile);
      if (!/^\+?\d{8,15}$/.test(mobile.replace(/[\s-]/g, ''))) return bad('Give the customer’s mobile number.');
      return [200, { ok: true, reference: ref('CB'), window: 'within 2 working hours', mobile }];
    },
  ],

  // ---- Tetherfi Quest Desk
  [
    'POST',
    '/tqd/cases',
    async (_, body) => {
      const email = text(body.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Give the customer’s e-mail address.');
      const name = text(body.customer_name) || 'Customer';
      const account = text(body.account_number);
      const plan = text(body.plan_name) || 'new account';
      const manager = text(body.relationship_manager) || 'your relationship manager';
      const proof = text(body.proof_needed);
      const item = {
        case_id: ref('TQD'),
        type: text(body.type) || 'account_opening',
        status: 'open',
        handover_id: text(body.handover_id),
        application_id: text(body.application_id),
        customer_name: name,
        email,
        account_number: account,
        plan_name: plan,
        created_at: now(),
      };
      const mail = {
        to: email,
        subject: `Welcome to Unbound Bank: your ${plan} is open`,
        body: [
          `Dear ${name},`,
          '',
          `Your ${plan} is open${account ? `, account number ending ${account.slice(-4)}` : ''}. Your case reference is ${item.case_id}.`,
          '',
          'What happens next:',
          `1. ${manager === 'your relationship manager' ? 'Your relationship manager' : `${manager}, your relationship manager,`} will call you within one working day to arrange the deposit.`,
          ...(proof ? [`2. Before the deposit is credited, please have ${proof} ready. Banks must check where large deposits come from.`] : []),
          `${proof ? 3 : 2}. Your online banking login and debit card arrive by post within 5 working days.`,
          '',
          'Unbound Bank',
        ].join('\n'),
        case_id: item.case_id,
        sent_at: now(),
        status: 'sent (mock outbox: nothing is really e-mailed)',
      };
      await store.put('cases', item.case_id, item);
      await store.put('outbox', timeKey(mail.sent_at, item.case_id), mail);
      return [200, { ok: true, case_id: item.case_id, status: item.status, email_sent_to: email, email_subject: mail.subject }];
    },
  ],
  [
    'GET',
    '/tqd/cases/:id',
    async ({ id }) => {
      const item = await store.get('cases', id);
      return item ? [200, { ok: true, ...item }] : notFound('case');
    },
  ],
  ['GET', '/tqd/outbox', async () => [200, { ok: true, emails: await store.newest('outbox', 20) }]],
];

/** For tests: forget everything (the in-memory store only). */
export function resetUnbound() {
  store.clear();
}
