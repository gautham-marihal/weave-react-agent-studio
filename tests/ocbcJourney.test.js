import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { handle, resetState } from '../mock-api/src/app.mjs';

// The OCBC journey (demos/ocbc-journey): the two agents built from use case 1 and the MY consumer team. Use case 1's
// flow is carried over word for word; the hand-overs and tools all resolve; every OCBC tool asks the mock something it
// answers.

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const pb = read('demos/ocbc-journey/personal-banking.config.json');
const desk = read('demos/ocbc-journey/case-desk.config.json');
const uc1 = read('demos/unbound/use-case-1/onboarding.config.json');
const uc1Desk = read('demos/unbound/use-case-1/case-desk.config.json');
const agent = (id) => pb.agents.items.find((a) => a.id === id);
const tool = (id) => pb.tools.find((t) => t.id === id);
const strip = (v) => JSON.parse(JSON.stringify(v), (k, x) => (k === 'bank' ? undefined : x));

test('the files are what the build script makes from its sources now', () => {
  const out = execFileSync(process.execPath, ['demos/ocbc-journey/scripts/build-configs.mjs', '--check'], { encoding: 'utf8' });
  assert.match(out, /up to date/);
});

test('use case 1 is carried over word for word: model, speech, form, checks, offers, the human hand-over', () => {
  assert.deepEqual(pb.defaults, uc1.defaults, 'the same models, speech rules and silences');
  for (const id of ['deposit_offers', 'choose_account'])
    assert.deepEqual(
      tool(id),
      uc1.tools.find((t) => t.id === id),
    );
  assert.deepEqual(agent('advisor').instructions.role, uc1.agents.items.find((a) => a.id === 'advisor').instructions.role);
  const onboarding = uc1.agents.items.find((a) => a.id === 'onboarding');
  assert.deepEqual([agent('onboarding').instructions.role, agent('onboarding').on_enter], [onboarding.instructions.role, onboarding.on_enter]);
  assert.deepEqual(pb.forms[0], uc1.forms[0], 'the application form and every check after it');
  // the signing form: the same steps, the bank sent along, and one line on where the phone banking details come from
  const steps = pb.forms[1].on_submit;
  const added = steps.filter((s) => s.type === 'say' && /phone banking number is in that e-mail/.test(s.text));
  assert.equal(added.length, 1);
  assert.deepEqual(strip(steps.filter((s) => !added.includes(s))), uc1.forms[1].on_submit);
  assert.deepEqual(strip(pb.telephony), uc1.telephony);
  for (const s of steps.filter((x) => x.type === 'http')) assert.equal(s.body.bank, '{{const.bank_name}}');
  assert.equal(pb.constants.bank_name, 'OCBC');
  for (const k of Object.keys(uc1.state.variables)) assert.deepEqual(pb.state.variables[k], uc1.state.variables[k], k);
});

test('one entry and the hand-overs of the design: new customers to the Advisor, existing ones to the specialists', () => {
  assert.equal(pb.agents.entry, 'front_desk');
  const to = (id) => (agent(id).handoffs || []).map((h) => h.to);
  assert.deepEqual(to('front_desk'), ['advisor', 'cards', 'banking', 'payments']);
  assert.deepEqual(to('advisor'), ['onboarding']);
  assert.deepEqual(to('onboarding'), ['banking']);
  assert.deepEqual(to('banking'), ['cards', 'payments']);
  assert.deepEqual(to('cards'), ['banking', 'payments']);
  assert.deepEqual(to('payments'), ['banking', 'cards']);
  // every hand-over a specialist's rules name is one it has
  for (const id of ['banking', 'cards', 'payments']) {
    const own = new Set((agent(id).handoffs || []).map((h) => h.tool));
    for (const named of agent(id)
      .instructions.rules.join(' ')
      .match(/go_to_\w+/g) || [])
      assert.ok(own.has(named), `${id}: ${named}`);
  }
  const ids = new Set(pb.tools.map((t) => t.id));
  for (const a of pb.agents.items) for (const t of a.tools || []) assert.ok(ids.has(t), `${a.id}: ${t}`);
  const handoffTools = pb.agents.items.flatMap((a) => (a.handoffs || []).map((h) => h.tool));
  assert.equal(new Set(handoffTools).size, handoffTools.length, 'every hand-over tool name is its own');
  for (const id of ['advisor', 'banking', 'cards', 'payments']) assert.ok(agent(id).tools.includes('back_to_front_desk'), id);
});

test('the specialists: checked once per call, gpt-4.1 at temperature 0, Singapore only', () => {
  for (const id of ['banking', 'cards', 'payments']) {
    const a = agent(id);
    assert.ok(a.tools.includes('caller_verified'), id);
    assert.deepEqual(a.overrides, { models: { llm: { model: 'gpt-4.1', temperature: 0 } } });
    assert.deepEqual(
      a.instructions.conditional.map((c) => c.when),
      [
        { state: 'verified', equals: false },
        { state: 'verified', equals: true },
      ],
    );
    assert.ok(!JSON.stringify(a).match(/verify_phone_code|login_ic|12-digit IC|\biQ\b|MYR|Malay/), id);
  }
  assert.deepEqual(tool('caller_verified').effects[0].do, [{ type: 'set_state', values: { verified: true } }]);
  assert.equal(pb.state.variables.verified.default, false);
  assert.equal(tool('get_rates').request.query.country, 'SG');
  // the advisor and onboarding keep use case 1's model (no overrides); the front desk routes on gpt-4.1 too
  for (const id of ['advisor', 'onboarding']) assert.equal(agent(id).overrides, undefined);
  assert.deepEqual(agent('front_desk').overrides, { models: { llm: { model: 'gpt-4.1', temperature: 0 } } });
});

test('every tool on the bank’s core systems asks the mock something it answers, for a test customer', async () => {
  resetState();
  const args = { phone_code: '5409881', customer_id: '5409881', account_number: '897350869921', account_id: '897350869921', card_id: 'C5409881D' };
  const fill = (v) =>
    typeof v === 'string'
      ? v.replace(/\{\{args\.(\w+)\}\}/g, (_, k) => args[k] ?? '')
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
        : v;
  const core = pb.tools.filter((t) => t.connection === 'core_banking');
  assert.equal(core.length, 14);
  for (const t of core) {
    const answer = await handle({ method: t.request.method, path: fill(t.request.path), body: fill(t.request.body || {}), query: {}, headers: {} });
    assert.notEqual(answer.status, 404, `${t.id}: ${t.request.path}`);
    assert.notEqual(answer.status, 500, `${t.id}: ${JSON.stringify(answer.body)}`);
    if (t.request.path === '/ocbc/dboperations') assert.equal(answer.body.responseCode, '0', t.id);
  }
});

test('the OCBC case desk: use case 1’s case desk with OCBC’s name, the bank sent to TQD, and the phone banking line', () => {
  const steps = desk.agents.items[0].on_enter;
  const added = steps.filter((s) => s.type === 'say' && /phone banking number is in that e-mail/.test(s.text));
  assert.equal(added.length, 1);
  assert.deepEqual(strip(steps.filter((s) => !added.includes(s))), uc1Desk.agents.items[0].on_enter);
  assert.equal(steps.find((s) => s.path === '/tqd/cases').body.bank, '{{const.bank_name}}');
  assert.deepEqual([desk.meta.id, desk.constants.bank_name, desk.persona.company], ['ocbc-case-desk', 'OCBC', 'OCBC']);
  const [mine, theirs] = [desk.agents.items[0].instructions, uc1Desk.agents.items[0].instructions];
  assert.equal(mine.role, theirs.role);
  assert.deepEqual(mine.rules.slice(0, theirs.rules.length), theirs.rules, 'use case 1’s rules, then one on banking later');
  assert.match(mine.rules.at(-1), /phone banking number from the welcome e-mail and the temporary PIN from the SMS/);
});

test('no gaps between the agents: money coming in is asked about first, every topic has an agent that takes it', () => {
  const front = agent('front_desk').instructions.rules.join(' ');
  assert.match(front, /deposit 1 million dollars/);
  assert.match(front, /is it for an account they already have with us, or would they like to open a new account for it\?/);
  assert.match(front, /Adding money to an account they already have .*: Banking\./);
  const advisorRules = agent('advisor').instructions.rules.join(' ');
  assert.match(advisorRules, /“Dollars” on their own mean Singapore dollars/);
  assert.match(advisorRules, /returns no offers/);
  assert.ok(agent('advisor').tools.includes('request_callback'));
  const bankingRules = agent('banking').instructions.rules.join(' ');
  assert.match(bankingRules, /To add money to an account they already have/);
  assert.match(bankingRules, /A new fixed deposit, or a new account for a larger sum: use back_to_front_desk/);
  assert.doesNotMatch(bankingRules, /Fixed deposits and loans are handled by a service manager/);
  assert.match(pb.persona.shared_rules.join(' '), /\(opening an account, balances and transactions, cards, transfers and payments\)/);
});
