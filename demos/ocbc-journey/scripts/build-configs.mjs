// The OCBC journey: builds the two agents from their sources, so a fix in either source carries over.
//   ocbc-personal-banking  one team, one entry: Front desk -> Advisor -> Onboarding (use case 1, word for word) ->
//                          Banking / Cards / Payments (the MY consumer team's specialists, for Singapore)
//   ocbc-case-desk         use case 1's case desk, for OCBC (after a human video banker, MX hands the customer to it)
// Sources: ../unbound/use-case-1/{onboarding,case-desk}.config.json (use case 1, unchanged) and
// source/my-consumer-banking.config.json (the MY consumer team's draft, as read from the server on 2026-11-07).
// What changes in the copies, and only there:
//   - the bank: constants (bank_name OCBC), persona, meta, widget ids; the mock calls send bank: "OCBC" (the mock then
//     makes the new account a bank customer: phone banking number by e-mail, temporary TPIN by SMS)
//   - a new Front desk (entry): new customers to the Advisor, existing ones to the specialists
//   - hand-overs: Onboarding -> Banking once the account is open; Banking -> Cards / Payments directly
//   - the specialists: their bank tools read the mock's DB2 stand-in and /ocbc routes (same rules, same answers' shape);
//     Malaysia-only parts (IC login, iQ, Velocity, MYR fees, the 8 pm payment cut-off, Malay and Mandarin) left out;
//     a "caller_verified" marker, so a caller checked once stays checked after a hand-over; gpt-4.1 at temperature 0
// Run from the repo root: node demos/ocbc-journey/scripts/build-configs.mjs
import fs from 'node:fs';

const at = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(at(p), 'utf8'));
const write = (p, c) => fs.writeFileSync(at(p), `${JSON.stringify(c, null, 2)}\n`);
const clone = structuredClone;

const onboarding = read('../unbound/use-case-1/onboarding.config.json');
const caseDesk = read('../unbound/use-case-1/case-desk.config.json');
const my = read('source/my-consumer-banking.config.json');

const BANK = 'OCBC';
const MOCK = 'https://weave-mock-api.vercel.app';
const myTool = (id) => clone(my.tools.find((t) => t.id === id));
const myAgent = (id) => clone(my.agents.items.find((a) => a.id === id));
const ucAgent = (id) => clone(onboarding.agents.items.find((a) => a.id === id));

// ---------------------------------------------------------------- the bank's systems
const connections = {
  ...clone(onboarding.connections),
  // the bank's core systems as stand-ins (mock-api/src/ocbc.mjs): the DB2 stand-in and the routes that keep changes
  core_banking: { type: 'http', base_url: MOCK, headers: { 'x-refusals': 'in-body' }, timeout_s: 10 },
  // the bank's other services (cheques, rates, branches, credit card services), as the MY team uses them
  custom: clone(my.connections.custom),
};

// ---------------------------------------------------------------- the specialists' tools, for Singapore
const REPOINT = {
  bank_customer_details: '/ocbc/dboperations',
  bank_customer_accounts: '/ocbc/dboperations',
  bank_account_details: '/ocbc/dboperations',
  bank_transaction_history: '/ocbc/dboperations',
  account_balance: '/ocbc/accounts/{{args.account_id}}/balance',
  request_statement: '/ocbc/accounts/{{args.account_id}}/statements',
  list_cards: '/ocbc/customers/{{args.customer_id}}/cards',
  block_card: '/ocbc/cards/{{args.card_id}}/block',
  activate_card: '/ocbc/cards/{{args.card_id}}/activate',
  list_payees: '/ocbc/customers/{{args.customer_id}}/payees',
  make_payment: '/ocbc/payments',
  transfer_own_accounts: '/ocbc/transfers',
  change_phone_pin: '/ocbc/customers/{{args.customer_id}}/phone-pin',
  request_callback: '/ocbc/callbacks',
};
const SG_DESCRIPTIONS = {
  stop_cheque: ['fee MYR 10, taken from the account', 'fee SGD 15, or SGD 30 for a range, taken from the account'],
  request_statement: ['fee MYR 5', 'fee SGD 5'],
  block_card: ['(MYR 12)', '(free of charge)'],
};
const DROPPED_TOOLS = new Set(['login_ic', 'end_call', 'back_to_front_desk']); // IC login is Malaysian; the two builtins come below
const specialistTools = my.tools
  .filter((t) => !DROPPED_TOOLS.has(t.id))
  .map((t) => {
    const tool = clone(t);
    if (REPOINT[tool.id]) Object.assign(tool, { connection: 'core_banking' }, { request: { ...tool.request, path: REPOINT[tool.id] } });
    if (SG_DESCRIPTIONS[tool.id]) tool.description = tool.description.replace(...SG_DESCRIPTIONS[tool.id]);
    if (tool.id === 'get_rates') {
      tool.description =
        'Singapore rates: foreign exchange rates (USD, euro…), deposit rates by month, foreign currency deposit rates (call rates and fixed deposit rates) and the prime rate.';
      tool.request.query = { ...tool.request.query, country: 'SG' };
    }
    if (tool.id === 'find_branches') tool.request.query = { ...tool.request.query, country: 'SG' };
    // after a hand-over the model once passed the last four digits it had said aloud ("9921"), and the bank refused
    for (const name of ['from_account', 'to_account', 'account_id']) {
      const p = tool.parameters?.properties?.[name];
      if (p)
        p.description = `${p.description} The full number (accountId in bank_customer_accounts); if you only have the last four digits the caller heard, those, with customer_id.`;
    }
    // money moving and statements also send the customer, so the bank can tell which account four digits mean (a
    // specialist just handed the caller has the endings it heard and the phone banking number, not the full numbers)
    if (['transfer_own_accounts', 'make_payment', 'request_statement'].includes(tool.id)) {
      tool.parameters.properties.customer_id = { type: 'string', description: 'The caller’s phone banking number (their phone code), digits only.' };
      tool.parameters.required = [...tool.parameters.required, 'customer_id'];
      tool.request.body = { ...tool.request.body, customerId: '{{args.customer_id}}' };
    }
    return tool;
  });
// a caller checked once stays checked for the rest of the call, also after a hand-over
const callerVerified = {
  id: 'caller_verified',
  type: 'builtin',
  builtin: 'noop',
  description:
    'Call it once, in silence, the moment the caller’s TPIN matches the passcode from bank_customer_details: it records that they are verified for the rest of this call, also after a hand-over. Never call it otherwise. Then go straight on with what they asked, in the same turn.',
  parameters: { type: 'object', properties: {}, required: [] },
  // the model goes on in the same turn (with "none" it fell silent after a correct TPIN until the caller spoke again)
  reply: 'model',
  effects: [{ when: { state: 'verified', equals: false }, do: [{ type: 'set_state', values: { verified: true } }] }],
};
const tools = [...clone(onboarding.tools), myTool('back_to_front_desk'), callerVerified, ...specialistTools];

// ---------------------------------------------------------------- the specialists' words, for Singapore
const MALAYSIA_ONLY = /12-digit IC number|\biQ\b|Velocity|English, Malay or Mandarin/;
const SG_WORDS = [
  ['e.g. MYR 1,250.00 or SGD 480.50', 'e.g. SGD 1,250.00 or USD 480.50'],
  ['(SGD, MYR, IDR…)', '(SGD, USD…)'],
  ['for MYR 5?', 'for SGD 5?'],
  // the name the welcome e-mail gives it, so a new customer recognises what is asked
  ['ask for their 7-digit phone code.', 'ask for their 7-digit phone banking number (their phone code; call it the phone banking number).'],
];
const sg = (rule) => SG_WORDS.reduce((s, [a, b]) => s.replace(a, b), rule);
const VERIFIED_RULE =
  'The moment the TPIN matches, call caller_verified (in silence), then go straight on with what they asked. Once a caller is verified on this call, never ask for their phone code or TPIN again, also after a hand-over.';
// the sign-in in its order, said once more plainly (the runs showed both asked at once, and a PIN asked for a number
// no customer has)
const SIGN_IN_ORDER =
  'Sign-in order: first ask only for the phone banking number, never for the PIN in the same question. When they give it, call bank_customer_details before you say anything. If it finds no customer (an empty responseList, or “Customer not found.”), say you couldn’t find that phone banking number and ask them to check it; don’t ask for the PIN. Ask for the PIN only once a customer was found.';
// a hand-over carries the conversation but not the last specialist's tool results: the runs showed Payments, just
// handed the caller, sending the account endings it had heard, and the bank refusing
const OWN_LOOKUP =
  'Account numbers and card ids come only from your own bank_customer_accounts or list_cards call: after a hand-over you don’t have them, so call it first (the caller stays verified, no new sign-in) before any transfer, payment, statement or card change. If a bank tool refuses, read its reason, fix the call and try once more, or say plainly why it can’t be done.';
// the runs showed a card blocked without its reference
const SAY_REFERENCE =
  'After any change (a transfer, a payment, a card blocked or activated, a statement, a PIN change), say its reference from the tool’s answer (for example TRF-15325 or BLK-11230) in the same reply as what was done.';
// a reply that only announces a tool ("One moment, please") leaves the caller waiting for a second message
const NO_ANNOUNCING =
  'Never announce a tool call (“one moment”, “I will do that now”, “let me check”): call the tool in the same turn, then say what it returned or what was done, with its reference.';
const CONDITIONALS = [
  {
    when: { state: 'verified', equals: false },
    append: 'The caller is not verified yet: check their phone code and TPIN, as your rules say, before any account tool.',
  },
  {
    when: { state: 'verified', equals: true },
    append: 'The caller’s phone code and TPIN already matched on this call: they are verified. Don’t ask for them again.',
  },
];
// the specialists think more carefully than a chat about offers: gpt-4.1, temperature 0 (TPINs are compared digit by digit)
const SPECIALIST_MODEL = { models: { llm: { model: 'gpt-4.1', temperature: 0 } } };
// the three specialists pass the caller straight to each other (the runs showed Payments, with no way to Cards,
// improvising about a lost card): a hand-over tool each way, and a rule naming them
const SPECIALIST_TOPICS = {
  cards: 'Card services, and a lost or stolen card.',
  payments: 'Transfers and payments.',
};
const handoff = (from, to) => ({
  id: `to_${to}_from_${from}`,
  tool: `go_to_${to}_from_${from}`,
  description: SPECIALIST_TOPICS[to],
  to,
  carry_context: true,
  set_state: { intent: to },
});
// the runs showed a specialist saying "I will connect you now" without calling the hand-over, so nobody answered
const passOn = (topicA, toolA, topicB, toolB) =>
  `For ${topicA}, call ${toolA}; for ${topicB}, call ${toolB}. The call is your whole reply: say nothing first (never “I will connect you”, “a specialist will help”), ask nothing, read nothing back; the next specialist greets them, reads it back and does it. The caller stays verified.`;
function specialist(id, { rules = [], handoffs = [], replace = [] } = {}) {
  const a = myAgent(id);
  const swapped = (r) => replace.find(([old]) => old === r)?.[1] ?? r;
  for (const [old] of replace) if (!a.instructions.rules.includes(old)) throw new Error(`${id}: no rule "${old}" to replace`);
  a.instructions.rules = [
    ...a.instructions.rules
      .filter((r) => !MALAYSIA_ONLY.test(r))
      .map(sg)
      .map(swapped),
    SIGN_IN_ORDER,
    VERIFIED_RULE,
    NO_ANNOUNCING,
    OWN_LOOKUP,
    SAY_REFERENCE,
    ...rules,
  ];
  a.instructions.conditional = CONDITIONALS;
  a.tools = [...a.tools.filter((t) => t !== 'login_ic'), 'caller_verified'];
  a.handoffs = [...(a.handoffs || []), ...handoffs];
  a.overrides = SPECIALIST_MODEL;
  return a;
}

// ---------------------------------------------------------------- the team
const myFront = myAgent('front_desk');
const frontDesk = {
  id: 'front_desk',
  name: 'Front desk',
  kind: 'router',
  instructions: {
    role: 'You answer OCBC’s personal banking line in Singapore, for people who want to open an account and for existing customers. Find out what the caller needs and pass them to the right specialist.',
    opening: myFront.instructions.opening,
    rules: [
      // the runs showed the front desk asking for the phone banking number and PIN itself, then handing over
      'You can’t see accounts or check a phone banking number or PIN. When the caller wants anything with their own accounts, cards or money (a balance, a transfer, a lost card, a statement), your whole reply is the hand-over call to that specialist: never ask for their phone banking number or PIN, never say you will connect them; the specialist signs them in.',
      'Someone new to OCBC, or who wants to open an account: the Advisor (go_to_advisor), at once, passing on any amount they mentioned. Never ask them for a phone code or a TPIN: the Advisor needs neither.',
      // money coming in can mean an account they have or a new one: one question decides, never a guess
      'When someone wants to deposit, put away or invest money, or place a fixed deposit (for example “I want to deposit 1 million dollars”), and hasn’t said whether it is for an account they already have with OCBC, ask one short question first: is it for an account they already have with us, or would they like to open a new account for it? A new account, or they don’t bank with OCBC yet: the Advisor, with the amount. An account they already have: Banking. If they already said which, don’t ask.',
      'Adding money to an account they already have (how to pay in, by transfer or at a branch): Banking.',
      'A forgotten or blocked phone banking PIN, or a PIN change: Banking, at once; it explains what can be done. Never say you can reset a PIN yourself.',
      'Never ask whether to pass the caller on (“would you like me to connect you…?”): once you know what they need, hand over in the same reply.',
      ...myFront.instructions.rules
        .filter((r) => !MALAYSIA_ONLY.test(r))
        .map((r) => r.replace('You can help with balances,', 'You can help with opening an account, balances,')),
    ],
    conditional: myFront.instructions.conditional,
  },
  tools: myFront.tools,
  // routing must be exact (on gpt-4.1-mini it once asked for the phone banking number and PIN itself): as the specialists
  overrides: SPECIALIST_MODEL,
  handoffs: [
    {
      id: 'to_advisor',
      tool: 'go_to_advisor',
      description: 'Someone new to OCBC, or who wants to open a new account (also for a deposit or a fixed deposit).',
      to: 'advisor',
      carry_context: true,
      set_state: { intent: 'open_account' },
    },
    ...myFront.handoffs,
  ],
};
const advisor = ucAgent('advisor');
Object.assign(advisor, { kind: 'specialist', tools: [...advisor.tools, 'back_to_front_desk', 'request_callback'] });
advisor.instructions.opening =
  'If they already mentioned an amount, call deposit_offers at once; otherwise ask, in one short question, how much they would like to deposit.';
advisor.instructions.rules = [
  ...advisor.instructions.rules,
  '“Dollars” on their own mean Singapore dollars: use SGD (US dollars only when they say so).',
  'If deposit_offers returns no offers (the amount is below what these accounts take), say so plainly with the lowest amount it gives, and offer a call-back from a relationship manager about an everyday savings account (request_callback, with their mobile); don’t start opening an account.',
  'If they say they already bank with OCBC, that’s fine: the new account still opens with the same short form and ID check, because the deposit is large. If they would rather add the money to an account they already have, use back_to_front_desk.',
  'For anything other than opening an account (an existing account, a card, a payment), use back_to_front_desk.',
  // as the specialists do: a call never ends without a word
  'When they have nothing more, thank them warmly in one short sentence, then use end_call (it says goodbye).',
];
const onboardingAgent = ucAgent('onboarding');
onboardingAgent.instructions.rules = [
  'Once the account is open, if the customer wants to check their new account, its balance or their debit card, or to change their temporary phone PIN, call go_to_banking_from_onboarding: our banking team signs them in with the phone banking number from the welcome e-mail and the temporary PIN from the SMS.',
];
onboardingAgent.handoffs = [
  {
    id: 'to_banking_from_onboarding',
    tool: 'go_to_banking_from_onboarding',
    description: 'The account is open, and the customer wants to check it, its balance or their card, or to change their temporary phone PIN.',
    to: 'banking',
    carry_context: true,
    set_state: { intent: 'banking' },
  },
];
const banking = specialist('banking', {
  // a new fixed deposit or account for a larger sum is the Advisor's (it offers them), not a call-back
  replace: [
    [
      'Fixed deposits and loans are handled by a service manager: offer a call-back.',
      'A new fixed deposit, or a new account for a larger sum: use back_to_front_desk (our advisor offers them). Loans are handled by a service manager: offer a call-back.',
    ],
  ],
  rules: [
    'To add money to an account they already have: once they are verified, name the account by its type and last four digits and say how money comes in: a FAST or PayNow transfer from another bank to that account number (the full number is in their online banking or on a statement), a GIRO, or cash and cheques at any OCBC branch or deposit machine. For a large sum, also offer our advisor’s accounts for larger deposits (back_to_front_desk) or a call-back from their relationship manager.',
    'A newly opened account can show a balance of SGD 0.00 with a note that its first deposit has not arrived yet: say the balance, then the note in plain words (who arranges the deposit).',
    // the runs showed Banking telling a just-onboarded customer to wait for details they already had
    'A customer who has just opened their account on this call already has their phone banking number (in the welcome e-mail) and a temporary phone banking PIN (by SMS): ask for the phone banking number straight away; never tell them to wait for it.',
    passOn('a card (lost, stolen, block, activate, when it arrives)', 'go_to_cards_from_banking', 'a transfer or a payment', 'go_to_payments_from_banking'),
  ],
  handoffs: [handoff('banking', 'cards'), handoff('banking', 'payments')],
});
const cards = specialist('cards', {
  rules: [
    'A new debit card that is on its way shows the date it arrives (arrivesBy): say it. It can be activated once the customer has it in hand; if they ask before then, say so, and that they can call or chat with us to activate it when it arrives.',
    'When the caller names a card by its kind (“my debit card”, “my Visa”), call list_cards and take that card yourself; ask which one only when two of their cards fit, naming them by kind and last four digits. Never ask the caller for a card number.',
    'Call list_cards before the read-back, so the read-back names the card by its kind and last four digits (“Shall I block your debit card ending 2068 now? A replacement is free.”).',
    passOn('a balance or transactions', 'go_to_banking_from_cards', 'a transfer or a payment', 'go_to_payments_from_cards'),
  ],
  handoffs: [handoff('cards', 'payments')],
});
const payments = specialist('payments', {
  rules: [
    passOn('a balance or transactions', 'go_to_banking_from_payments', 'a card (lost, stolen, block, activate, when it arrives)', 'go_to_cards_from_payments'),
  ],
  handoffs: [handoff('payments', 'cards')],
});

// ---------------------------------------------------------------- the signing form and the human hand-over send the bank
const withBank = (body) => ({ ...body, bank: '{{const.bank_name}}' });
const forms = clone(onboarding.forms);
const sign = forms.find((f) => f.id === 'sign_application');
for (const step of sign.on_submit) if (step.type === 'http' && ['/unbound/accounts', '/tqd/cases'].includes(step.path)) step.body = withBank(step.body);
// where the customer's phone banking details come from, said once the case reference has been given
const PHONE_BANKING_LINE = {
  type: 'say',
  when: { not: { state: 'case_id', equals: null } },
  text: 'Your phone banking number is in that e-mail, and a temporary phone banking PIN is on its way to your mobile by SMS, so you can check your new account with us any time.',
};
const doneAt = sign.on_submit.findIndex((s) => s.type === 'say' && s.text.startsWith('Done. Your {{state.plan_name}} is open'));
sign.on_submit.splice(doneAt + 1, 0, PHONE_BANKING_LINE);
const telephony = clone(onboarding.telephony);
telephony.transfers[0].request.body = withBank(telephony.transfers[0].request.body);

const persona = {
  ...clone(onboarding.persona),
  company: BANK,
  style_rules: [
    ...onboarding.persona.style_rules,
    'Dates like 2 May 2026, and an account by its last four digits (ending 5600). An account ending is always exactly the last four digits of its number (account 923253456169 is "ending 6169").',
    // the name the welcome e-mail and the SMS use
    'To the caller, the 7-digit number they sign in with is always their “phone banking number” (your tools call it the phone code), and the TPIN is their “phone banking PIN”.',
  ],
  shared_rules: my.persona.shared_rules.map((r) =>
    r
      .replace('Amounts are in MYR unless', 'Amounts are in SGD unless')
      .replace('(balances and recent transactions)', '(opening an account, balances and transactions, cards, transfers and payments)'),
  ),
};
const guardrails = {
  input: my.guardrails.input.map((g) => (g.id === 'prompt_injection' ? clone(onboarding.guardrails.input.find((x) => x.id === 'prompt_injection')) : clone(g))),
  output: clone(my.guardrails.output || []),
};
const postCall = clone(my.post_call);
postCall.redaction.entities = [...new Set([...postCall.redaction.entities, ...onboarding.post_call.redaction.entities])];

const widget = (channels, id) =>
  clone(channels).map((ch) => ({ ...ch, entry: { ...ch.entry, widget_id: `${id}-${ch.type === 'web_voice' ? 'voice' : 'chat'}` } }));
const personalBanking = {
  schema_version: onboarding.schema_version,
  meta: {
    id: 'ocbc-personal-banking',
    name: 'OCBC personal banking',
    version: '1.0.0',
    status: 'draft',
    description:
      'OCBC Singapore, from onboarding to everyday banking, in one call: a front desk passes new customers to an advisor and onboarding (ID photo, video check, signing; a human video banker when a check fails) and existing ones to the banking, cards and payments specialists. A newly opened account can be checked straight away.',
    tags: ['ocbc', 'onboarding', 'multi-agent', 'tetherfi-unbound'],
  },
  runtime: clone(onboarding.runtime),
  defaults: clone(onboarding.defaults),
  persona,
  state: { variables: { ...clone(my.state.variables), ...clone(onboarding.state.variables) } },
  channels: widget(onboarding.channels, 'ocbc-personal-banking'),
  connections,
  tools,
  forms,
  telephony,
  agents: { entry: 'front_desk', items: [frontDesk, advisor, onboardingAgent, banking, cards, payments] },
  guardrails,
  post_call: postCall,
  constants: { ...clone(onboarding.constants), bank_name: BANK },
};

// ---------------------------------------------------------------- the case desk, for OCBC
const desk = clone(caseDesk);
desk.meta = {
  ...desk.meta,
  id: 'ocbc-case-desk',
  name: 'OCBC case desk',
  description:
    'OCBC journey: after a human video banker opens the account, MX hands the customer back to this agent; it reads the hand-back, opens the case in Tetherfi Quest Desk, and TQD e-mails the customer (the phone banking PIN goes by SMS).',
  tags: ['ocbc', 'onboarding', 'tetherfi-unbound'],
};
desk.persona = { ...desk.persona, company: BANK };
desk.constants = { ...desk.constants, bank_name: BANK };
desk.channels = widget(desk.channels, 'ocbc-case-desk');
desk.agents.items[0].instructions.rules = [
  ...desk.agents.items[0].instructions.rules,
  'If they want to check their new account or do other banking, say they can call or chat with us any time and sign in with the phone banking number from the welcome e-mail and the temporary PIN from the SMS.',
];
const deskSteps = desk.agents.items[0].on_enter;
for (const step of deskSteps) if (step.type === 'http' && step.path === '/tqd/cases') step.body = withBank(step.body);
deskSteps.splice(deskSteps.findIndex((s) => s.type === 'say' && s.text.startsWith('Done. Your case reference')) + 1, 0, clone(PHONE_BANKING_LINE));

// --check: only say whether the files hold what the sources make now (the unit tests use it; the layout may differ,
// as prettier formats the files)
if (process.argv.includes('--check')) {
  const stale = [
    ['personal-banking.config.json', personalBanking],
    ['case-desk.config.json', desk],
  ].filter(([file, config]) => JSON.stringify(read(file)) !== JSON.stringify(config));
  console.log(stale.length ? `out of date: ${stale.map(([f]) => f).join(', ')} (run build-configs.mjs)` : 'up to date');
  process.exit(stale.length ? 1 : 0);
}
write('personal-banking.config.json', personalBanking);
write('case-desk.config.json', desk);

// nothing of the other banks may be left (the form's nationality and tax residency lists rightly name Malaysia)
for (const [name, config] of [
  ['personal-banking', personalBanking],
  ['case-desk', desk],
]) {
  const left = JSON.stringify(config).match(/Unbound Bank|unbound-onboarding|OCBC Bank Malaysia|\bMYR\b|Malay or|verify_phone_code|login_ic/g);
  console.log(`${name}.config.json written${left ? `; LEFT: ${[...new Set(left)].join(', ')}` : ''}`);
}
