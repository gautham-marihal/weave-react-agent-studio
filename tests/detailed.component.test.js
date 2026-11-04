import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { createEngine } from '../src/studio/form/engine.js';
import { factsAt } from '../src/studio/agent/detailed/schemaFacts.js';
import { PAGE_GROUPS } from '../src/studio/agent/pages.js';
import { humanize } from '../src/studio/agent/rowNames.js';
import { addTransferToAgent } from '../src/studio/workflow/workflowOps.js';

// Build › Detailed (src/studio/agent/detailed/): each part of the agent mounted in jsdom on a real draft. Its header counts what it asks,
// every row is bound to a place the schema has, a change goes straight into the draft, and the parts point at each other's lists.
const { mountScreen, act, DETAILED_PARTS } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const mount = (part, config = agent(), props = {}) => mountScreen('detailed', config, { ready: '.dtPart', props: { part, ...props } });
const until = async (app, check, tries = 60) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(30);
  return check();
};
// the shapes some rows wait for: a number tidied to the international format has a default country
const SHAPED = { identity: { caller_id: { normalize: { type: 'e164' } } } };
const asPath = (joined) => joined.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));

test('every part of Build except the Workflow canvas has a Detailed part, numbered in the menu’s order', () => {
  const build = PAGE_GROUPS.find((g) => g.id === 'build')
    .pages.map((p) => p.id)
    .filter((id) => id !== 'workflow');
  for (const id of build) assert.ok(DETAILED_PARTS[id], `${id} has a part`);
  assert.ok(DETAILED_PARTS.settings, 'Engine and details too');
  const nums = Object.values(DETAILED_PARTS).map((p) => Number(p.num));
  assert.deepEqual(
    nums,
    [...nums].sort((x, y) => x - y),
    'numbered in order',
  );
});

test('every row written as a place in the configuration names a place the schema has', () => {
  const lost = [];
  for (const part of Object.values(DETAILED_PARTS))
    for (const card of part.cols.flat()) {
      const rows = [...(Array.isArray(card.rows) ? card.rows : []), ...(Array.isArray(card.adv) ? card.adv : [])];
      for (const row of rows) if (row.path && !factsAt(engine, schema, row.path, SHAPED)) lost.push(`${part.id}.${card.id}.${row.id}: ${row.path.join('.')}`);
      if (card.list?.path && !card.list.entries && !factsAt(engine, schema, card.list.path, {})) lost.push(`${part.id}.${card.id} list`);
    }
  assert.deepEqual(lost, []);
});

for (const id of Object.keys(DETAILED_PARTS)) {
  test(`the ${id} part: its header counts what it asks, and each row on it is at a place the schema has`, async () => {
    const extra = id === 'subagents' ? { workspace: [] } : {};
    const app = await mount(id, agent(), { extra });
    const part = $(app.container, `.dtPart[data-part="${id}"]`);
    assert.ok(part, 'the part is shown');
    assert.equal(textOf($(part, 'h1')), DETAILED_PARTS[id].title);
    // the header's chips by kind: "N required" is left out when nothing is
    const chip = (sel) => Number.parseInt(textOf($(part, `.dtCounts ${sel}`)) || '0', 10);
    const [count, required, advanced] = [chip('li:not(.req):not(.adv)'), chip('li.req'), chip('li.adv')];
    assert.ok(count > 0 && required >= 0 && advanced >= 0 && count >= advanced, `${count} fields, ${required} required, ${advanced} under Advanced`);
    // the folds show how many they hold; together they are what the header says is under Advanced (an empty item card has none yet)
    const folded = $$(part, '.dtAdvTitle').reduce((sum, t) => sum + Number(textOf(t).split('·')[1]), 0);
    assert.ok(folded <= advanced, `${folded} folded, ${advanced} counted`);
    const lost = $$(part, '[data-path]')
      .map((row) => row.dataset.path)
      .filter((path) => !factsAt(engine, schema, asPath(path), { ...app.config, ...SHAPED }));
    assert.deepEqual(lost, []);
    assert.ok(
      $$(part, '[data-field]').every((row) => row.dataset.field.startsWith(`${id}.`)),
      'rows are named by their part',
    );
    const ids = $$(part, '[id]').map((el) => el.id);
    assert.deepEqual(
      ids.filter((x, i) => ids.indexOf(x) !== i),
      [],
      'no id is used twice, so every label names its own field',
    );
    const fields = $$(part, '[data-field]').map((row) => row.dataset.field);
    assert.deepEqual(
      fields.filter((x, i) => fields.indexOf(x) !== i),
      [],
      'each row has its own name, so “show me” lands on one',
    );
    await app.unmount();
  });
}

test('a change on a part goes straight into the draft: the agent’s name', async () => {
  const app = await mount('agent');
  await a.type($(app.container, '#dt-agent-name'), 'Acme Helpdesk');
  assert.equal(app.config.meta.name, 'Acme Helpdesk');
  await app.unmount();
});

test('a switch writes the draft, and the settings that hang on it appear only once it is on: hide sensitive details after the call', async () => {
  const app = await mount('aftercall');
  const pills = () => $(app.container, '[data-field="aftercall.entities"] [role="group"], [data-field="aftercall.entities"] .dtPills');
  const replace = () => $(app.container, '#dt-aftercall-replace');
  assert.equal(replace(), null, 'nothing to replace while it is off: not shown');
  assert.equal(pills(), null);
  await a.click($(app.container, '#dt-aftercall-hide'));
  assert.equal(app.config.post_call?.redaction?.enabled, true);
  assert.ok(replace() && !replace().disabled, 'switched on: what it is replaced with is asked');
  assert.ok(pills(), 'what it looks for is offered');
  await app.unmount();
});

test('the parts point at each other: a transfer’s business hours are the schedules set on Channels', async () => {
  const config = {
    ...agent(),
    schedules: { office: { description: 'Office hours', timezone: 'Asia/Singapore', weekly: [] } },
    telephony: { transfers: [{ id: 'desk', method: 'sip_refer', target: { number: '+6561234567' } }] },
  };
  const app = await mount('connections', config);
  const hours = $(app.container, '#dt-connections-hours');
  assert.ok(hours, 'the chosen transfer’s card is open');
  const offered = (await a.choices(hours)).map((c) => c.text);
  assert.ok(offered.includes('Office hours'), `offered: ${offered.join(', ')}`);
  await a.choose(hours, 'office');
  assert.equal(app.config.telephony.transfers[0].schedule, 'office');
  await app.unmount();
});

test('a place asked for inside a list opens that item’s card', async () => {
  const config = agent();
  assert.ok(config.tools.length > 1, 'the starter has tools');
  const app = await mount('tools', config, { request: { path: ['tools', 1, 'description'], nonce: 1 } });
  const chips = () => $$(app.container, '[data-card="tools.list"] .dtItems button, .dtItems[aria-label="Tools"] button');
  assert.ok(await until(app, () => chips()[1]?.getAttribute('aria-current') === 'true'), 'the second tool is chosen');
  assert.equal(chips()[0].getAttribute('aria-current'), 'false');
  await app.unmount();
});

test('subagents and hand-overs: “Send a summary along” is shown but not available until the server supports it', async () => {
  // a hand-over to another agent of the workspace, made the way the Workflow canvas makes it
  const billing = { id: 'billing-desk', name: 'Billing desk', numbers: [{ number: '+6560000001' }] };
  const start = agent();
  const { config } = addTransferToAgent(start, start.agents.items[0].id, billing);
  const app = await mount('subagents', config, { extra: { workspace: { agents: [billing] } } });
  const field = await until(app, () => $(app.container, '[data-field="subagents.summary"]'));
  assert.ok(field, 'the transfer’s card is open, with the row');
  assert.ok($(field, 'button[role="switch"], input[type="checkbox"]').disabled, 'it cannot be switched on');
  assert.match(textOf(field), /Not available yet: the server needs to support it/);
  assert.equal(JSON.stringify(app.config), JSON.stringify(config), 'nothing was written');
  await app.unmount();
});

// ---- a list of the draft (tools here): its items as chips, one Add with the studio's kinds, the chosen item's card beside
const chipsOf = (app) => $$(app.container, '[data-card="tools.mine"] .dtItems > button[aria-current]');
const addTool = async (app, option) => {
  await a.click($(app.container, '[data-card="tools.mine"] .stAddBtn'));
  await a.click($(document.body, `.stPickCard[data-option="${option}"]`));
};

test('a list shows each item as a chip, has one place to add, and its chosen item opens in the card beside it', async () => {
  const app = await mount('tools');
  assert.equal(await until(app, () => chipsOf(app).length === app.config.tools.length), true, 'a chip for each tool');
  assert.equal($$(app.container, '[data-card="tools.mine"] .stAddBtn').length, 1, 'one Add');
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(app.config.tools[0].id)}`, 'the first is open');
  await a.click(chipsOf(app)[1]);
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(app.config.tools[1].id)}`);
  await a.type($(app.container, '#dt-tools-when'), 'When the caller asks for it.');
  assert.equal(app.config.tools[1].description, 'When the caller asks for it.', 'its card writes the draft');
  await app.unmount();
});

test('adding picks a kind; the new tool opens, has an id of its own and is given to the agent that answers first', async () => {
  const app = await mount('tools');
  const before = app.config.tools.length;
  await addTool(app, 'rules_only');
  assert.equal(app.config.tools.length, before + 1);
  const made = app.config.tools.at(-1).id;
  assert.equal(new Set(app.config.tools.map((t) => t.id)).size, before + 1, 'an id of its own');
  assert.ok(app.config.agents.items[0].tools.includes(made), 'the agent that answers can use it');
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(made)}`, 'and its card is open');
  await app.unmount();
});

test('a kind an agent needs only one of (ending the call) opens the one it has, rather than adding a second', async () => {
  const app = await mount('tools');
  const before = app.config.tools.length;
  await a.click($(app.container, '[data-card="tools.mine"] .stAddBtn'));
  assert.match(textOf($(document.body, '.stPickCard[data-option="end_call"]')), /It has one already/);
  await a.click($(document.body, '.stPickCard[data-option="end_call"]'));
  assert.equal(app.config.tools.length, before, 'nothing is added');
  const ending = app.config.tools.find((t) => t.builtin === 'end_call').id;
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(ending)}`, 'the one it has opens');
  await app.unmount();
});

test('deleting an item asks first when something uses it, takes the pointers out, and Undo puts it back', async () => {
  const app = await mount('tools');
  await addTool(app, 'rules_only');
  const added = app.config.tools.length;
  const made = app.config.tools.at(-1).id;
  // the studio's dialog is drawn by the app; here the question goes to the browser's box, answered yes
  const asked = [];
  window.confirm = (text) => asked.push(text) > 0;
  await a.click(byText(app.container, '[data-card="tools.tool"] button', 'Delete this tool'));
  // the agent offers it (a new tool is given to the agent that answers), so it asks first
  assert.equal(asked.length, 1, 'it asks');
  assert.ok(asked[0].startsWith(`Delete “${humanize(made)}”?`), asked[0]);
  assert.equal(await until(app, () => app.config.tools.length === added - 1), true, 'the tool is gone from the draft');
  assert.ok(!app.config.agents.items[0].tools.includes(made), 'and from the agent’s tools');
  assert.equal(await until(app, () => !!byText(app.container, 'button', 'Undo')), true, 'an Undo is offered');
  await a.click(byText(app.container, 'button', 'Undo'));
  assert.equal(app.config.tools.length, added, 'Undo puts it back');
  assert.ok(app.config.agents.items[0].tools.includes(made));
  await app.unmount();
});

test('an empty list says so, with the one way to add', async () => {
  const app = await mount('tools', { ...agent(), tools: [] });
  assert.match(textOf($(app.container, '[data-card="tools.mine"] .dtEmptyList')), /None yet/);
  assert.match(
    textOf($(app.container, '[data-card="tools.mine"] .dtEmptyList .stAddBtn')),
    /Add a tool/,
    'the way to add, named for what it adds, right there',
  );
  assert.match(textOf($(app.container, '[data-card="tools.tool"]')), /No tools yet/);
  await app.unmount();
});

// ---- After the call: the questions asked of every call
const withQuestions = (analysis) => ({ ...agent(), post_call: { analysis } });
const kindPills = (app, n) => $(app.container, `[role="radiogroup"][aria-label="Kind of answer to question ${n}"]`);

test('after the call: switching a question away from “One of a list” and back keeps its answers to choose from', async () => {
  const app = await mount('aftercall', withQuestions([{ id: 'feel', type: 'enum', question: 'How did they feel?', values: ['Happy', 'Neutral', 'Unhappy'] }]));
  await a.click(byText(kindPills(app, 1), 'button', /number/i));
  assert.equal(app.config.post_call.analysis[0].values, undefined, 'the configuration keeps a list only with “One of a list”');
  await a.click(byText(kindPills(app, 1), 'button', /one of a list/i));
  assert.deepEqual(app.config.post_call.analysis[0].values, ['Happy', 'Neutral', 'Unhappy']);
  await app.unmount();
});

test('after the call: rows write to their own item, a missing kind has none chosen, and repeated ids draw no React key error', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const app = await mount(
      'aftercall',
      withQuestions([
        null,
        { id: 'kindless', question: 'No kind' },
        { id: 'dup', type: 'enum', question: 'Third', values: ['Red', 'Green'] },
        { id: 'dup', type: 'enum', question: 'Fourth', values: ['Cat', 'Dog'] },
      ]),
    );
    assert.equal($$(app.container, '[data-card="aftercall.questions"] [role="radiogroup"]').length, 3, 'a row for each question');
    assert.equal($$(kindPills(app, 2), '[aria-checked="true"]').length, 0, 'no kind chosen');
    await a.click(byText(kindPills(app, 2), 'button', /words|text/i));
    assert.equal(app.config.post_call.analysis[1].type, 'string', 'the first row shown is the second item');
    assert.equal(app.config.post_call.analysis[0], null);
    await a.click($(app.container, 'button[aria-label="Remove question “Third”"]'));
    assert.deepEqual(
      app.config.post_call.analysis.map((q) => q?.question ?? null),
      [null, 'No kind', 'Fourth'],
    );
    await app.unmount();
  } finally {
    console.error = original;
  }
  assert.deepEqual(
    errors.filter((e) => /same key/i.test(e)),
    [],
  );
});

test('after the call: a new question takes the keyboard, and a removed one gives it to the next row or to “A question of your own”', async () => {
  const app = await mount('aftercall', { ...agent(), post_call: {} });
  await a.click(byText(app.container, 'button', '+ Why did they get in touch?'));
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-q0'));
  await a.click(byText(app.container, 'button', '+ A question of your own'));
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-q1'));
  await a.click($$(app.container, 'button[aria-label^="Remove question"]')[0]);
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-q0'), 'the row that took its place');
  await a.click($$(app.container, 'button[aria-label^="Remove question"]')[0]);
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-own'));
  assert.equal($(app.container, '#dt-aftercall-q0'), null);
  await app.unmount();
});

// ---- each input in one place
const staticPaths = (part) =>
  part.cols
    .flat()
    .flatMap((card) => [...(Array.isArray(card.rows) ? card.rows : []), ...(Array.isArray(card.adv) ? card.adv : [])])
    .filter((row) => row.path)
    .map((row) => row.path.join('.'));

test('each input is asked in one place: no setting is a row of two parts', () => {
  const where = {};
  for (const part of Object.values(DETAILED_PARTS)) for (const path of staticPaths(part)) (where[path] ||= []).push(part.id);
  const twice = Object.entries(where).filter(([, parts]) => parts.length > 1);
  assert.deepEqual(twice, []);
});

test('Engine and details asks only what no other part does: not the name, the language, the models or the tests', () => {
  const paths = staticPaths(DETAILED_PARTS.settings);
  assert.ok(paths.length > 0);
  const asked = paths.filter((p) => p === 'meta.name' || /^defaults\.(language|models)\b/.test(p) || p.startsWith('tests'));
  assert.deepEqual(asked, []);
});

test('guardrails: switching on “pass frustrated callers to a person” on an agent that can’t hand over yet switches hand-over on too, and says so first', async () => {
  const config = agent();
  config.tools = config.tools.filter((t) => t.builtin !== 'transfer_or_callback');
  config.agents.items[0].tools = config.agents.items[0].tools.filter((id) => config.tools.some((t) => t.id === id));
  delete config.guardrails;
  const app = await mount('guardrails', config);
  const row = $(app.container, '[data-field="guardrails.frustrated"]');
  assert.match(textOf(row), /also switches on “Pass people to a person”/);
  await a.click($(row, '#dt-guardrails-frustrated'));
  assert.ok(
    app.config.tools.some((t) => t.builtin === 'transfer_or_callback'),
    'it can hand over now',
  );
  assert.ok(
    app.config.guardrails.escalation.some((r) => r.id === 'frustrated_to_person'),
    'and the rule is on',
  );
  await app.unmount();
});

// ---- Channels: what a channel offers is the server's table of kinds (GET /channel-types), not a list in the part
test('a channel’s card offers what its kind can have: a keypad on a phone line, forms on a web chat; a kind that doesn’t run says so', async () => {
  const { FALLBACK } = await import('../src/studio/form/channelTypes.js');
  const config = {
    ...agent(),
    channels: [
      { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
      { id: 'chat', type: 'web_chat', enabled: true, entry: { widget_id: 'w' }, modalities: { input: ['text'], output: ['text'] } },
      { id: 'wa', type: 'whatsapp', enabled: true, modalities: { input: ['text'], output: ['text'] } },
    ],
  };
  const app = await mount('channels', config, { extra: { channelTypes: FALLBACK } });
  const chips = () => $$(app.container, '[data-card="channels.channel"] .dtItems > button[aria-current]');
  const fields = () => $$(app.container, '[data-card="channels.channel"] [data-field]').map((row) => row.dataset.field);
  assert.equal(chips().length, 3);
  assert.ok(fields().includes('channels.dtmf') && !fields().includes('channels.forms'), `a phone line: ${fields().join(', ')}`);
  assert.ok(fields().includes('channels.route'), 'and how callers reach it');
  await a.click(chips()[1]);
  assert.ok(fields().includes('channels.forms') && !fields().includes('channels.dtmf'), `a web chat: ${fields().join(', ')}`);
  await a.click(chips()[2]);
  if (FALLBACK.find((t) => t.type === 'whatsapp')?.runsToday === false)
    assert.ok(fields().includes('channels.notRunning'), 'WhatsApp says it is not running yet');
  await app.unmount();
});

test('a number that can’t be empty keeps its last value while the box is cleared, so clearing it and typing 5 gives 5', async () => {
  const config = agent();
  config.guardrails = { ...(config.guardrails || {}), topics: { on_off_topic: { max_strikes: 3, then: config.tools[0].id, say: 'Let’s stay on topic.' } } };
  const app = await mount('guardrails', config);
  const box = $(app.container, '#dt-guardrails-strikes');
  await a.type(box, '');
  assert.equal(app.config.guardrails.topics.on_off_topic.max_strikes, 3, 'cleared: still 3 in the draft');
  assert.equal(box.value, '', 'and the box stays empty to type in');
  await a.type(box, '5');
  assert.equal(app.config.guardrails.topics.on_off_topic.max_strikes, 5);
  await app.unmount();
});

// ---- guardrails: a check's card offers only the fields its kind has in the schema, and each writes its own place
test('guardrails: a check’s card shows only the fields its kind has, and they write where the schema keeps them', async () => {
  const config = agent();
  config.guardrails = {
    ...(config.guardrails || {}),
    input: [
      { id: 'details', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
      { id: 'kind', type: 'statement', text: 'Be kind.', enforcement: 'prompt' },
      { id: 'secrets', type: 'field_firewall', fields: ['customer'], enforcement: 'code' },
      { id: 'codes', type: 'regex_block', patterns: ['CODE[0-9]+'], enforcement: 'code', on_trigger: { action: 'deflect' } },
      { id: 'tricks', type: 'prompt_injection', enforcement: 'code', on_trigger: { action: 'deflect' } },
    ],
  };
  const app = await mount('guardrails', config);
  const card = () => $(app.container, '[data-card="guardrails.input"]');
  const chips = () => $$(card(), '.dtItems > button[aria-current]');
  const shown = () => $$(card(), '.dtRow[data-field]').map((r) => r.getAttribute('data-field').replace('guardrails.', ''));
  const folded = () => $$(card(), '.dtAdvNames span').map(textOf);
  const expect = {
    details: [['entities', 'action', 'enforce'], ['What it says when it triggers']],
    kind: [['enforce'], ['The rule in words']],
    secrets: [['enforce'], ['Fields to keep away']],
    codes: [
      ['action', 'enforce'],
      ['Patterns to look for', 'What it says when it triggers'],
    ],
    tricks: [['action', 'enforce'], ['What it says when it triggers']],
  };
  assert.equal(await until(app, () => chips().length === 5), true, 'a chip for each check');
  for (const [i, [id, [rows, adv]]] of Object.entries(expect).entries()) {
    await a.click(chips()[i]);
    assert.ok(await until(app, () => chips()[i].getAttribute('aria-current') === 'true'), `${id} is chosen`);
    assert.deepEqual(
      shown().filter((r) => rows.includes(r) || ['entities', 'action', 'enforce'].includes(r)),
      rows,
      `${id}: its rows`,
    );
    assert.deepEqual(folded(), adv, `${id}: its Advanced`);
  }
  // personal details: shown for a personal-detail check, and a choice is kept
  await a.click(chips()[0]);
  await until(app, () => shown().includes('entities'));
  await a.click(byText(card(), '[data-field="guardrails.entities"] .dtPills button', 'Bank account numbers'));
  assert.deepEqual(app.config.guardrails.input[0].entities, ['card_number', 'bank_account'], 'kept in entities');
  // the rule in words: kept in `text`, as the schema has it
  await a.click(chips()[1]);
  await until(app, () => folded().includes('The rule in words'));
  const fold = $(card(), 'details.dtAdv');
  fold.open = true;
  fold.dispatchEvent(new window.Event('toggle'));
  assert.ok(await until(app, () => $(card(), '#dt-guardrails-statement')), 'the Advanced rows open');
  await a.type($(card(), '#dt-guardrails-statement'), 'Never shame the caller.');
  assert.equal(app.config.guardrails.input[1].text, 'Never shame the caller.');
  assert.equal('statement' in app.config.guardrails.input[1], false, 'nothing written beside it');
  await app.unmount();
});
