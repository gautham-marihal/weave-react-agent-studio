import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { actionsOf, numberProblem, setDetails, setEndCall, setHandOver, setLookup, switchOf } from '../src/studio/setup/setupModel.js';
import { setMoment } from '../src/studio/agent/blocks/guardrailModel.js';
import { unusedTools } from '../src/studio/form/toolInfo.js';

// The Tools page's switches (the setup's "What it can do"): what they keep that something else uses, what they leave alone that was made by hand, and that
// saving the lookup form changes only what its answers changed.
const support = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const ids = (config) => (config.tools || []).map((t) => t.id);
const entryTools = (config) => config.agents.items[0].tools || [];

test('a switch turned off keeps a tool a guardrail rule still uses, and says so', () => {
  const ruled = setMoment(support(), 'frustrated_to_person', true);
  const off = setHandOver(ruled, false);
  assert.ok(ids(off).includes('escalate_to_human'), 'the rule still has its tool');
  assert.ok(!entryTools(off).includes('escalate_to_human'), 'the agent no longer offers it');
  assert.equal(actionsOf(off).hand_over.on, false);
  assert.match(actionsOf(off).hand_over.kept, /rule under Guardrails still uses it/);
  assert.equal(actionsOf(support()).hand_over.kept, undefined, 'nothing to say while it is on');
});

test('a switch turned off takes away what only it made, and its untouched lines; a reworded line stays', () => {
  const off = setEndCall(support(), false);
  assert.ok(!ids(off).some((id) => /^end_call/.test(id)));
  assert.equal(actionsOf(off).end_call.on, false);
  assert.equal(actionsOf(off).end_call.kept, undefined);
  const on = setEndCall(off, true);
  assert.equal(actionsOf(on).end_call.on, true, 'and back on again');
  const handOff = setHandOver(support(), false);
  assert.ok(!(handOff.telephony?.transfers || []).some((t) => t.id === 'human_support'), 'its own transfer goes with it');
  const reworded = support();
  reworded.messages = (reworded.messages || []).map((m) => (m.id === 'callback_line' ? { ...m, text: 'One moment, we will call you back.' } : m));
  assert.ok(
    setHandOver(reworded, false).messages.some((m) => m.id === 'callback_line'),
    'a line the person reworded is kept',
  );
});

test('a tool made by hand under the id a switch would use is never taken over or deleted', () => {
  const config = support();
  config.tools.push({ id: 'collect_details', type: 'builtin', builtin: 'send_form', params: { form: 'booking' } });
  config.forms = [{ id: 'booking', title: 'Book a visit', fields: [{ name: 'when', label: 'When', type: 'text' }] }];
  const on = setDetails(config, true, { fields: ['name', 'phone'] });
  assert.equal(new Set(ids(on)).size, ids(on).length, 'no two tools share an id');
  assert.ok(
    on.tools.some((t) => t.id === 'collect_details' && t.params.form === 'booking'),
    'the hand-made one is as it was',
  );
  assert.deepEqual(
    on.forms.find((f) => f.id === 'booking').fields.map((f) => f.name),
    ['when'],
    'its form gets none of the switch’s fields',
  );
  const off = setDetails(on, false);
  assert.ok(
    off.forms.some((f) => f.id === 'booking'),
    'switching the details off leaves the booking form alone',
  );
  assert.ok(ids(off).includes('collect_details'), 'and the hand-made tool');
});

test('ticking a detail changes only that field of the form', () => {
  let config = setDetails(support(), true, { fields: ['name', 'phone'] });
  const form = config.forms.find((f) => f.id === 'contact_details');
  form.title = 'Book a callback';
  form.fields.push({ name: 'postcode', label: 'Postcode', type: 'text' });
  config = setDetails(config, true, { fields: ['name', 'phone', 'email'] });
  const after = config.forms.find((f) => f.id === 'contact_details');
  assert.equal(after.title, 'Book a callback');
  assert.deepEqual(
    after.fields.map((f) => f.name),
    ['name', 'phone', 'postcode', 'email'],
  );
  assert.deepEqual(actionsOf(config).details.fields, ['name', 'phone', 'postcode', 'email']);
});

test('the hand-over number: a missing transfer is made again, and a number chosen elsewhere is not overwritten', () => {
  const config = support();
  config.telephony.transfers = [];
  const typed = setHandOver(config, true, { number: '+6561234567' });
  assert.equal(actionsOf(typed).hand_over.number, '+6561234567', 'what was typed is kept');
  const chosen = support();
  chosen.telephony.transfers[0].target = { from_state: 'team_number' };
  const after = setHandOver(chosen, true, { number: '+1' });
  assert.deepEqual(after.telephony.transfers[0].target, { from_state: 'team_number' });
  assert.equal(actionsOf(after).hand_over.numberElsewhere, true);
});

test('the lookup form: saving it unchanged changes nothing, and a new address keeps the connection’s sign-in', () => {
  const made = setLookup(support(), true, { url: 'https://shop.example.com/find?type=order&id={order number}', finds: 'an order', needs: 'order number' });
  assert.equal(made.problem, '');
  const read = actionsOf(made.config).lookup;
  assert.equal(read.url, 'https://shop.example.com/find?type=order&id={order number}', 'the query is read back as typed');
  const config = made.config;
  const connection = config.tools.find((t) => t.id === 'look_up').connection;
  config.connections[connection].auth = { type: 'bearer', token: { secret: 'SHOP_TOKEN' } };
  config.tools.find((t) => t.id === 'look_up').request.headers = { 'X-Shop': 'web' };
  const same = setLookup(config, true, read);
  assert.deepEqual(same.config.tools, config.tools, 'saved as it is, the tool stays exactly as it was');
  const moved = setLookup(config, true, { ...read, url: 'https://shop.example.com/v2/orders/{order number}' }).config;
  assert.deepEqual(moved.connections[connection].auth, { type: 'bearer', token: { secret: 'SHOP_TOKEN' } }, 'the sign-in stays');
  assert.deepEqual(moved.tools.find((t) => t.id === 'look_up').request.headers, { 'X-Shop': 'web' }, 'and the request’s headers');
});

test('the lookup form says what is wrong with an address instead of breaking on it', () => {
  const answers = { finds: 'an order', needs: 'order number' };
  assert.match(setLookup(support(), true, { ...answers, url: 'https://{shop}.example.com/orders' }).problem, /after the site’s name/);
  assert.match(setLookup(support(), true, { ...answers, url: 'not a web address' }).problem, /web address/);
  assert.equal(setLookup(support(), true, { ...answers, url: 'https://shop.example.com/a%zz/{order number}' }).problem.length > 0, true, 'a stray % is said');
  assert.match(setLookup(support(), true, { url: 'https://shop.example.com/orders', finds: 'x', needs: '' }).problem, /needs from the person/);
});

test('the number to pass calls to is checked as people write numbers: with its country code, or a phone system’s address', () => {
  ['', '+65 6123 4567', '+1 (415) 555-0100', 'sip:desk@pbx.example.com'].forEach((ok) => assert.equal(numberProblem(ok), '', ok));
  assert.match(numberProblem('(555) 123-4567'), /country code/);
  assert.match(numberProblem('06123 4567'), /country code/);
  assert.match(numberProblem('+12'), /whole number/);
});

test('a tool a guardrail rule uses is not called “Not used”, even with no agent offering it', () => {
  const kept = setHandOver(setMoment(support(), 'frustrated_to_person', true), false);
  assert.ok(!unusedTools(kept).includes('escalate_to_human'));
  const plain = setMoment(support(), 'frustrated_to_person', false);
  plain.agents.items[0].tools = plain.agents.items[0].tools.filter((t) => t !== 'escalate_to_human');
  assert.ok(unusedTools(plain).includes('escalate_to_human'), 'with nothing using it, it is');
});

test('a tool says which switch on the page stands for it, and a tool made by hand has none', () => {
  const config = support();
  assert.deepEqual(switchOf(config, 'end_call'), { id: 'end_call', label: 'End the conversation politely', on: true });
  assert.deepEqual(switchOf(config, 'escalate_to_human'), { id: 'hand_over', label: 'Pass people to a person on your team', on: true });
  // switched off while a rule still uses it: the same switch, off
  const ruled = setHandOver(setMoment(config, 'frustrated_to_person', true), false);
  assert.equal(switchOf(ruled, 'escalate_to_human').on, false);
  // a second tool of the same kind is not the switch's (the switch stands for the first)
  const twice = { ...config, tools: [...config.tools, { id: 'end_call_2', type: 'builtin', builtin: 'end_call', description: 'Ends it.' }] };
  assert.equal(switchOf(twice, 'end_call_2'), null);
  assert.equal(switchOf(config, 'nope'), null);
  assert.equal(switchOf(config, ''), null);
});
