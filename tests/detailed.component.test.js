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
import { addBackToStart, addSubagent, addTransferToAgent } from '../src/studio/workflow/workflowOps.js';
import { setMoment } from '../src/studio/agent/blocks/guardrailModel.js';
import { placedIds } from '../src/studio/agent/detailed/conversationView/conversationLayout.js';
import { placedIds as knowledgePlaced } from '../src/studio/agent/detailed/knowledgeWorkspace/knowledgeLayout.js';
import { placedIds as toolsPlaced, placedToolIds as toolPlaced } from '../src/studio/agent/detailed/toolsWorkspace/toolsLayout.js';
import { placedIds as connectionsPlaced } from '../src/studio/agent/detailed/connectionsWorkspace/connectionsLayout.js';
import { placedIds as channelsPlaced, placedItemIds as channelsItemPlaced } from '../src/studio/agent/detailed/channelsWorkspace/channelsLayout.js';
import { placedIds as subagentsPlaced, placedItemIds as subagentsItemPlaced } from '../src/studio/agent/detailed/subagentsWorkspace/subagentsLayout.js';
import { placedIds as guardrailsPlaced, placedItemIds as guardrailsItemPlaced } from '../src/studio/agent/detailed/guardrailsWorkspace/guardrailsLayout.js';
import { placedIds as afterCallPlaced } from '../src/studio/agent/detailed/afterCallWorkspace/afterCallLayout.js';
import { placedIds as enginePlaced } from '../src/studio/agent/detailed/engineWorkspace/engineLayout.js';
import { placedIds as mediaPlaced, placedItemIds as mediaItemPlaced } from '../src/studio/agent/detailed/mediaWorkspace/mediaLayout.js';

// Build › Detailed (src/studio/agent/detailed/): each part of the agent mounted in jsdom on a real draft. Its header counts what it asks,
// every row is bound to a place the schema has, a change goes straight into the draft, and the parts point at each other's lists.
const { mountScreen, act, DETAILED_PARTS } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const mount = (part, config = agent(), props = {}) => mountScreen('detailed', config, { ready: '.dtPart', props: { part, ...props } });
// A part's two views (Agent: Profile | All settings; Conversation: The call | All settings), switched with its own
// buttons, as a person would
const agentView = async (app, name) => {
  const button = byText(app.container, 'button', name);
  if (button && button.getAttribute('aria-pressed') !== 'true') await a.click(button);
};
const until = async (app, check, tries = 60) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(30);
  return check();
};
// the shapes some rows wait for: a number tidied to the international format has a default country
const SHAPED = { identity: { caller_id: { normalize: { type: 'e164' } } } };
// a sentence as it reads on screen, without the words only a screen reader hears ("(How long it waits: change)")
const said = (el) => textOf(el).replace(/ \([^)]*: (change|open)\)/g, '');
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
    // the header says what the part is for in plain words
    assert.equal(textOf($(part, '.dtQuestion')), DETAILED_PARTS[id].question);
    // "Show advanced settings · N": the folds show how many they hold, together no more than the header counts (an
    // empty item card has none yet); a part with nothing advanced has no switch
    const toggle = $(part, '.dtAdvToggle');
    const advanced = toggle ? Number(toggle.dataset.count) : 0;
    const folded = $$(part, '.dtAdvTitle').reduce((sum, t) => sum + Number(textOf(t).split('·')[1]), 0);
    assert.ok(folded <= advanced, `${folded} folded, ${advanced} counted`);
    if (folded) assert.ok(toggle, 'a part with advanced settings has the switch');
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
  // Agent's All settings: every setting as a row, as the other parts show them
  const app = await mount('agent');
  await agentView(app, 'All settings');
  assert.ok(await until(app, () => !!$(app.container, '#dt-agent-name')), 'All settings is drawn');
  await a.type($(app.container, '#dt-agent-name'), 'Acme Helpdesk');
  assert.equal(app.config.meta.name, 'Acme Helpdesk');
  await agentView(app, 'Profile');
  await app.unmount();
});

test('Agent as a profile: one sentence says it all, and each part opens its own settings in place', async () => {
  const app = await mount('agent');
  await agentView(app, 'Profile');
  assert.ok(await until(app, () => !!$(app.container, '.apHero')), 'the profile');
  const parts = $$(app.container, '.apSentence .apTok');
  assert.ok(parts.length >= 6, `${parts.length} parts of the sentence`);
  // the name: its editor opens under it, holding the part's own rows
  await a.click(parts[0]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop #dt-agent-persona')), 'its editor opens');
  await a.type($(document.body, '.apPop #dt-agent-persona'), 'Nova');
  assert.equal(app.config.persona.name, 'Nova', 'what is typed goes straight into the draft');
  assert.match(textOf($(app.container, '.apName h2')), /Nova/, 'and the profile follows');
  // the chapters: a line opens its settings under it
  const style = $$(app.container, '.apLine').find((l) => /Style rules/.test(textOf(l)));
  await a.click(byText(style, 'button', /Change/));
  assert.ok(await until(app, () => !!$(app.container, '.apLine.open [data-field="agent.style"]')), 'Style rules open under their line');
  // All settings: every setting, searchable
  await a.click(byText(app.container, 'button', 'All settings'));
  assert.ok(await until(app, () => $$(app.container, '.dtPart [data-field]').length >= 30), 'every setting');
  await agentView(app, 'Profile');
  await app.unmount();
});

test('a switch writes the draft, and the settings that hang on it appear only once it is on: hide sensitive details after the call', async () => {
  const app = await mount('aftercall');
  await agentView(app, 'All settings');
  const pills = () => $(app.container, '[data-field="aftercall.entities"] [role="group"], [data-field="aftercall.entities"] .dtPills');
  const replace = () => $(app.container, '#dt-aftercall-replace');
  assert.equal(replace(), null, 'nothing to replace while it is off: not shown');
  assert.equal(pills(), null);
  await a.click($(app.container, '#dt-aftercall-hide'));
  assert.equal(app.config.post_call?.redaction?.enabled, true);
  assert.ok(replace() && !replace().disabled, 'switched on: what it is replaced with is asked');
  assert.ok(pills(), 'what it looks for is offered');
  await agentView(app, 'After a call');
  await app.unmount();
});

test('the parts point at each other: a transfer’s business hours are the schedules set on Channels', async () => {
  const config = {
    ...agent(),
    schedules: { office: { description: 'Office hours', timezone: 'Asia/Singapore', weekly: [] } },
    telephony: { transfers: [{ id: 'desk', method: 'sip_refer', target: { number: '+6561234567' } }] },
  };
  const app = await mount('connections', config);
  await agentView(app, 'All settings');
  const hours = $(app.container, '#dt-connections-hours');
  assert.ok(hours, 'the chosen transfer’s card is open');
  const offered = (await a.choices(hours)).map((c) => c.text);
  assert.ok(offered.includes('Office hours'), `offered: ${offered.join(', ')}`);
  await a.choose(hours, 'office');
  assert.equal(app.config.telephony.transfers[0].schedule, 'office');
  await agentView(app, 'What it reaches');
  await app.unmount();
});

test('a place asked for inside a list opens that item’s card', async () => {
  const config = agent();
  assert.ok(config.tools.length > 1, 'the starter has tools');
  const app = await mount('tools', config, { request: { path: ['tools', 1, 'description'], nonce: 1 } });
  // the tools are rows, each with its Edit; the chosen one's is pressed
  const rows = () => $$(app.container, '[data-card="tools.mine"] .dtIList li button[aria-pressed]');
  assert.ok(await until(app, () => rows()[1]?.getAttribute('aria-pressed') === 'true'), 'the second tool is chosen');
  assert.equal(rows()[0].getAttribute('aria-pressed'), 'false');
  await app.unmount();
});

test('subagents and hand-overs: “Send a summary along” is shown but not available until the server supports it', async () => {
  // a hand-over to another agent of the workspace, made the way the Workflow canvas makes it
  const billing = { id: 'billing-desk', name: 'Billing desk', numbers: [{ number: '+6560000001' }] };
  const start = agent();
  const { config } = addTransferToAgent(start, start.agents.items[0].id, billing);
  const app = await mount('subagents', config, { extra: { workspace: { agents: [billing] } } });
  await agentView(app, 'All settings');
  const field = await until(app, () => $(app.container, '[data-field="subagents.summary"]'));
  assert.ok(field, 'the transfer’s card is open, with the row');
  assert.ok($(field, 'button[role="switch"], input[type="checkbox"]').disabled, 'it cannot be switched on');
  assert.match(textOf(field), /Not available yet: the server needs to support it/);
  assert.equal(JSON.stringify(app.config), JSON.stringify(config), 'nothing was written');
  await agentView(app, 'Who answers');
  await app.unmount();
});

// ---- a list of the draft (tools here): its items as rows that say what each is, one Add with the studio's kinds, the
// chosen item's card beside
const chipsOf = (app) => $$(app.container, '[data-card="tools.mine"] .dtIList li button[aria-pressed]');
const addTool = async (app, option) => {
  await a.click($(app.container, '[data-card="tools.mine"] .stAddBtn'));
  await a.click($(document.body, `.stPickCard[data-option="${option}"]`));
};

test('a list shows each item as a row, has one place to add, and its chosen item opens in the card beside it', async () => {
  const app = await mount('tools');
  await agentView(app, 'All settings');
  assert.equal(await until(app, () => chipsOf(app).length === app.config.tools.length), true, 'a row for each tool');
  assert.ok(
    $$(app.container, '[data-card="tools.mine"] .dtIList .dtIMeta').every((m) => textOf(m).length > 0),
    'each row says what the tool does',
  );
  assert.equal($$(app.container, '[data-card="tools.mine"] .stAddBtn').length, 1, 'one Add');
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(app.config.tools[0].id)}`, 'the first is open');
  await a.click(chipsOf(app)[1]);
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(app.config.tools[1].id)}`);
  await a.type($(app.container, '#dt-tools-when'), 'When the caller asks for it.');
  assert.equal(app.config.tools[1].description, 'When the caller asks for it.', 'its card writes the draft');
  await agentView(app, 'What it can do');
  await app.unmount();
});

test('adding picks a kind; the new tool opens, has an id of its own and is given to the agent that answers first', async () => {
  const app = await mount('tools');
  await agentView(app, 'All settings');
  const before = app.config.tools.length;
  await addTool(app, 'rules_only');
  assert.equal(app.config.tools.length, before + 1);
  const made = app.config.tools.at(-1).id;
  assert.equal(new Set(app.config.tools.map((t) => t.id)).size, before + 1, 'an id of its own');
  assert.ok(app.config.agents.items[0].tools.includes(made), 'the agent that answers can use it');
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(made)}`, 'and its card is open');
  await agentView(app, 'What it can do');
  await app.unmount();
});

test('a kind an agent needs only one of (ending the call) opens the one it has, rather than adding a second', async () => {
  const app = await mount('tools');
  await agentView(app, 'All settings');
  const before = app.config.tools.length;
  await a.click($(app.container, '[data-card="tools.mine"] .stAddBtn'));
  assert.match(textOf($(document.body, '.stPickCard[data-option="end_call"]')), /It has one already/);
  await a.click($(document.body, '.stPickCard[data-option="end_call"]'));
  assert.equal(app.config.tools.length, before, 'nothing is added');
  const ending = app.config.tools.find((t) => t.builtin === 'end_call').id;
  assert.equal(textOf($(app.container, '[data-card="tools.tool"] h2')), `A tool: ${humanize(ending)}`, 'the one it has opens');
  await agentView(app, 'What it can do');
  await app.unmount();
});

test('deleting an item asks first when something uses it, takes the pointers out, and Undo puts it back', async () => {
  const app = await mount('tools');
  await agentView(app, 'All settings');
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
  await agentView(app, 'What it can do');
  await app.unmount();
});

test('an empty list says so, with the one way to add', async () => {
  const app = await mount('tools', { ...agent(), tools: [] });
  await agentView(app, 'All settings');
  assert.match(textOf($(app.container, '[data-card="tools.mine"] .dtIEmpty')), /No tools yet/);
  assert.match(textOf($(app.container, '[data-card="tools.mine"] .dtIEmpty .stAddBtn')), /Add a tool/, 'the way to add, named for what it adds, right there');
  assert.match(textOf($(app.container, '[data-card="tools.tool"]')), /No tools yet/);
  await agentView(app, 'What it can do');
  await app.unmount();
});

// ---- Tools as what it can do (canvas page "4 · Tools, redesigned")
test('Tools as what it can do: the sentence names what is on, blanks what is not, and a blank opens its switch in place', async () => {
  const app = await mount('tools');
  await agentView(app, 'What it can do');
  assert.ok(await until(app, () => !!$(app.container, '.tlHero')), 'the overview');
  const sentence = said($(app.container, '.tlSentence'));
  assert.match(sentence, /can .+\./);
  const blanks = $$(app.container, '.tlSentence .apTok.blank');
  assert.ok(blanks.length > 0, 'an ability not on yet is a blank');
  assert.match(sentence, /Not yet: /);
  await a.click(blanks[0]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop [role="switch"]')), 'its switch opens in place');
  // one tile for each ability, and the way to add
  assert.equal($$(app.container, '.tlTile').filter((t) => /On|Off/.test(textOf(t.querySelector('.tlState')))).length, 4);
  assert.ok($(app.container, '.tlTile.add'));
  await app.unmount();
});

test('a tool opens as the steps of one run, and its steps write the draft', async () => {
  const app = await mount('tools');
  await agentView(app, 'What it can do');
  assert.ok(await until(app, () => !!$(app.container, '.tlHero')));
  const first = app.config.tools[0];
  await a.click(byText(app.container, '.apLine button.apChange', /^Open/));
  assert.ok(await until(app, () => !!$(app.container, '.tlPage')), 'its own page');
  assert.deepEqual($$(app.container, '.tlStep b').map(textOf), [
    'Asked for',
    'May it run?',
    first.type === 'http' ? 'Calls your system' : 'What it does',
    'What comes back',
    'Then',
    'If it fails',
  ]);
  await a.type($(app.container, '#dt-tools-when'), 'When the caller asks for it.');
  assert.equal(app.config.tools[0].description, 'When the caller asks for it.', 'a step writes the tool');
  await a.click(byText(app.container, 'button', /Back to/));
  assert.ok(await until(app, () => !!$(app.container, '.tlHero')), 'and back');
  await app.unmount();
});

test('adding a tool picks it by what it does, and the new tool opens on its page', async () => {
  const app = await mount('tools');
  await agentView(app, 'What it can do');
  assert.ok(await until(app, () => !!$(app.container, '.tlHero')));
  const before = app.config.tools.length;
  await a.click($(app.container, '.tlTile.add'));
  assert.ok(await until(app, () => $$(app.container, '.tlKind').length > 6), 'the kinds open under “Add a tool”');
  await a.click(byText(app.container, '.tlKind', /Only run rules/));
  assert.equal(app.config.tools.length, before + 1);
  assert.ok(app.config.agents.items[0].tools.includes(app.config.tools.at(-1).id), 'the agent that answers can use it');
  assert.ok(await until(app, () => !!$(app.container, '.tlPage')), 'it opens');
  await a.click(byText(app.container, 'button', /Back to/));
  await app.unmount();
});

test('Tools’ workspace gives every quick setting, and every setting of a tool, exactly one place', () => {
  const quick = DETAILED_PARTS.tools.cols
    .flat()
    .find((c) => c.id === 'quick')
    .rows.map((r) => `quick.${r.id}`);
  assert.deepEqual([...toolsPlaced()].sort(), [...quick].sort(), 'the quick rows, once each');
  const card = DETAILED_PARTS.tools.cols.flat().find((c) => c.id === 'tool');
  const entry = { key: 'x', name: 'X', base: ['tools', 0], item: { id: 'x', type: 'builtin', builtin: 'noop' } };
  const here = { config: { tools: [entry.item] }, chosen: () => entry };
  const ids = [...card.rowsFor(here), ...card.advFor(here)].map((r) => r.id);
  assert.deepEqual([...toolPlaced()].sort(), [...ids].sort(), 'a tool’s rows, once each');
});

// ---- Connections as what it reaches (canvas page "5 · Connections, redesigned"), for any agent
const reaching = () => ({
  ...agent(),
  connections: {
    customer_records: { type: 'http', base_url: 'https://api.example.com' },
    partner_tools: { type: 'mcp', url: 'https://mcp.example.com' },
    texts: { type: 'notifier', kind: 'sms', provider: 'twilio' },
  },
  tools: [...agent().tools, { id: 'look_up_order', type: 'http', connection: 'customer_records', request: { method: 'GET', path: '/orders' } }],
  telephony: { transfers: [{ id: 'front_desk', method: 'sip_refer', target: '+15550123' }] },
});

test('Connections as what it reaches: the sentence says what it has, blanks what it has not, and a blank opens its list', async () => {
  const app = await mount('connections', reaching());
  await agentView(app, 'What it reaches');
  assert.ok(await until(app, () => !!$(app.container, '.cxHero')), 'the overview');
  assert.match(
    said($(app.container, '.cxSentence')),
    /reaches 3 of your systems and passes callers on to one place\. Not yet: a form, a message to send or a multi-step task\./,
  );
  // the picture: what reaches out, and the systems
  assert.ok(byText(app.container, '.cxMap .cxNode', /Look up order/), 'the tool that reaches out');
  assert.ok(byText(app.container, '.cxMap .cxNode', /Customer records/), 'the system it reaches');
  // the MCP server is kept, but said not to run yet
  assert.ok(byText(app.container, '.apLine', /Partner tools.*Its tools aren’t run yet/));
  await a.click(byText(app.container, '.cxSentence .apTok.blank', /a form/));
  assert.ok(await until(app, () => !!$(document.body, '.apPop .cxTokenList')), 'its list opens in place');
  await a.click(byText(document.body, '.apPop button', /Add a form/));
  assert.equal(app.config.forms.length, 1, 'a form is added');
  assert.ok(await until(app, () => !!$(app.container, '.cxPage .cxPreview')), 'and opens, as the caller sees it');
  await a.click(byText(app.container, 'button', /Back to/));
  await app.unmount();
});

test('a system opens on its own page: how it signs in is chosen, and only a secret’s name is saved', async () => {
  const app = await mount('connections', reaching());
  await agentView(app, 'What it reaches');
  assert.ok(await until(app, () => !!$(app.container, '.cxHero')));
  await a.click(byText(app.container, '.cxMap button.cxNode', /Customer records/));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')), 'its page');
  assert.ok(byText(app.container, '.cxUses li', /Look up order/), 'what uses it');
  await a.click(byText(app.container, '.cxSignIn button', /^A token$/));
  assert.deepEqual(app.config.connections.customer_records.auth, { type: 'bearer', token: { secret: 'CUSTOMER_RECORDS_TOKEN' } });
  await a.click(byText(app.container, '.cxSignIn button', /^No sign-in$/));
  assert.equal(app.config.connections.customer_records.auth, undefined);
  await a.click(byText(app.container, 'button', /Back to/));
  // a texts-or-emails service has no address: its page asks what it sends and through which service instead
  await a.click(byText(app.container, '.cxMap button.cxNode', /Texts/));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')));
  assert.ok(!$(app.container, '[data-field="connections.address"]'), 'no address');
  assert.ok($(app.container, '[data-field="connections.provider"]'), 'its service');
  await a.click(byText(app.container, 'button', /Back to/));
  await app.unmount();
});

test('a phone transfer opens as the path of the call, and says what it is for', async () => {
  const app = await mount('connections', reaching());
  await agentView(app, 'What it reaches');
  assert.ok(await until(app, () => !!$(app.container, '.cxHero')));
  await a.click($(app.container, '[data-line^="tr:"] .apChange'));
  assert.ok(await until(app, () => !!$(app.container, '.cxPath')), 'its path');
  assert.deepEqual($$(app.container, '.cxPath .tlStep b').map(textOf), ['When', 'Before it connects', 'Moves the call', 'Once connected', 'If it fails']);
  assert.ok(!$(app.container, '[data-field="connections.request"]'), 'by phone: no request to ask another system');
  await a.type($(app.container, '#dt-connections-about'), 'The front desk team.');
  assert.equal(app.config.telephony.transfers[0].description, 'The front desk team.');
  await a.click(byText(app.container, 'button', /Back to/));
  await app.unmount();
});

test('Connections’ workspace gives every setting of every list exactly one place', () => {
  const part = DETAILED_PARTS.connections;
  const stand = { connections: { type: 'http' }, transfers: { id: 't' }, forms: { id: 'f' }, notifications: { id: 'n' }, tasks: { id: 'k' } };
  for (const list of Object.keys(stand)) {
    const card = part.cols.flat().find((c) => c.id === list);
    const entry = { key: 'x', name: 'X', base: [list, 0], item: stand[list] };
    const here = { config: {}, chosen: () => entry };
    const ids = [...card.rowsFor(here), ...card.advFor(here)].map((r) => r.id);
    const placed = connectionsPlaced(list);
    assert.deepEqual([...placed].sort(), [...ids].sort(), `${list}: each row once, none left out, none made up`);
    assert.equal(new Set(placed).size, placed.length, `${list}: no row twice`);
  }
});

// ---- After the call: the questions asked of every call
const withQuestions = (analysis) => ({ ...agent(), post_call: { analysis } });
const kindPills = (app, n) => $(app.container, `[role="radiogroup"][aria-label="Kind of answer to question ${n}"]`);

test('after the call: switching a question away from “One of a list” and back keeps its answers to choose from', async () => {
  const app = await mount('aftercall', withQuestions([{ id: 'feel', type: 'enum', question: 'How did they feel?', values: ['Happy', 'Neutral', 'Unhappy'] }]));
  await agentView(app, 'All settings');
  await a.click(byText(kindPills(app, 1), 'button', /number/i));
  assert.equal(app.config.post_call.analysis[0].values, undefined, 'the configuration keeps a list only with “One of a list”');
  await a.click(byText(kindPills(app, 1), 'button', /one of a list/i));
  assert.deepEqual(app.config.post_call.analysis[0].values, ['Happy', 'Neutral', 'Unhappy']);
  await agentView(app, 'After a call');
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
    await agentView(app, 'All settings');
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
    await agentView(app, 'After a call');
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
  await agentView(app, 'All settings');
  await a.click(byText(app.container, 'button', '+ Why did they get in touch?'));
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-q0'));
  await a.click(byText(app.container, 'button', '+ A question of your own'));
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-q1'));
  await a.click($$(app.container, 'button[aria-label^="Remove question"]')[0]);
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-q0'), 'the row that took its place');
  await a.click($$(app.container, 'button[aria-label^="Remove question"]')[0]);
  assert.equal(document.activeElement, $(app.container, '#dt-aftercall-own'));
  assert.equal($(app.container, '#dt-aftercall-q0'), null);
  await agentView(app, 'After a call');
  await app.unmount();
});

// ---- After the call: its own workspace
const afterAll = () => ({
  ...agent(),
  post_call: {
    summary: { enabled: true, prompt: 'Why they called.' },
    analysis: [
      { id: 'solved', type: 'boolean', question: 'Was it solved?' },
      { id: 'why', type: 'enum', question: 'Why did they call?', values: ['A question', 'A problem'] },
      { id: 'feel', type: 'enum', question: 'How did they feel?', values: ['Happy', 'Unhappy'] },
    ],
    recording: { transcript: true, retention_days: 30 },
    redaction: { enabled: true, entities: ['card_number', 'pin'] },
  },
  observability: { session_log: { retention_days: 90 } },
  wrapups: [{ id: 'closing', wait_s: 10, on_silence: [{ type: 'say', text: 'Goodbye' }, { type: 'end_call' }] }],
  events: [{ on: 'call_started', do: [{ type: 'wrapup', wrapup: 'closing' }] }],
});

test('After the call says what happens once a call ends: blanks for a new agent, then what it writes, keeps and hides, drawn as one call’s record', async () => {
  const fresh = await mount('aftercall');
  await agentView(fresh, 'After a call');
  assert.ok(await until(fresh, () => !!$(fresh.container, '.acHero')));
  assert.equal(
    said($(fresh.container, '.grSentence')),
    'When a call ends, Acme keeps a log of each call. Not yet: a summary, questions about each call or hiding sensitive details.',
  );
  assert.equal(textOf($(fresh.container, '.acHero .apName p')), 'Keeps a log of each call');
  await fresh.unmount();

  const app = await mount('aftercall', afterAll());
  assert.ok(await until(app, () => !!$(app.container, '.acHero')));
  assert.equal(
    said($(app.container, '.grSentence')),
    'When a call ends, Acme writes a summary and answers 3 questions. It keeps a log for 90 days and the transcript for 30 days, and hides card numbers and PINs in all of it. After a natural end point it waits 10 seconds for a reply, then says “Goodbye” and hangs up.',
  );
  assert.match(textOf($(app.container, '.acRec')), /My card is\s*\[REDACTED\]\s*and my PIN is\s*\[REDACTED\]/, 'the record shows what is hidden');
  // before the server has answered, the guide's list: summaries and questions are kept but not done yet
  const line = (key) => textOf($(app.container, `[data-line="${key}"]`));
  assert.match(line('summary'), /Not run yet/);
  assert.match(line('q0'), /Yes or no.*Not run yet/);
  assert.match(line('log'), /deleted after 90 days/);
  assert.doesNotMatch(line('close'), /Needs a look/, 'its closing wait is started by a step');
  // a part of the sentence opens its own settings
  await a.click(byText($(app.container, '.grSentence'), 'button', /^90 days/));
  assert.ok($(app.container, '#dt-aftercall-logdays'), 'how long logs are kept, in place');
  await app.unmount();
});

test('After the call: a question opens in place, a new one is ready to type, and a closing wait that nothing starts needs a look', async () => {
  const app = await mount('aftercall');
  assert.ok(await until(app, () => !!$(app.container, '.acHero')));
  await a.click($(app.container, '[data-line="addQuestion"] .apChange'));
  await a.click(byText(app.container, 'button', '+ Why did they get in touch?'));
  assert.equal(app.config.post_call.analysis.length, 1);
  assert.ok(await until(app, () => document.activeElement === $(app.container, '#dt-aftercall-q0')), 'the new question’s line is open, ready to type');
  assert.equal($$(app.container, '[data-line="q0"] [role="radiogroup"]').length, 1, 'its kind of answer, in place');
  // a closing wait, added from its line: nothing starts it yet
  await a.click($(app.container, '[data-line="close"] .apChange'));
  assert.deepEqual(app.config.wrapups, [{ id: 'closing', wait_s: 10, on_silence: [{ type: 'end_call' }] }]);
  assert.ok($(app.container, '#dt-aftercall-wait'), 'its wait, in place');
  assert.match(textOf($(app.container, '[data-line="close"]')), /Nothing starts it, so it never runs.*Needs a look/);
  assert.match(textOf($(app.container, '.acHero .apName p')), /1 needs a look/);
  await app.unmount();
});

test('After the call’s workspace gives every setting a place, and the logging it hands to Engine is there', () => {
  const part = DETAILED_PARTS.aftercall;
  const partRows = part.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  assert.deepEqual([...afterCallPlaced()].filter((id) => id !== 'questions.add').sort(), [...partRows].sort(), 'each row once, none left out, none made up');
  assert.ok(afterCallPlaced().includes('questions.add'), 'adding a question has its line');
  const engineRows = DETAILED_PARTS.settings.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => row.path?.join('.')));
  for (const path of ['observability.metrics', 'observability.log_level', 'observability.tracing']) assert.ok(engineRows.includes(path), path);
});

// ---- Engine and details: its own workspace
const detailed = () => {
  const config = agent();
  config.meta = { ...config.meta, version: '1.4.2', status: 'published', environment: 'staging' };
  config.runtime = { ...config.runtime, timezone: 'Asia/Singapore', secrets_vault: 'team-vault' };
  config.constants = { payment_url: 'https://pay.example.com' };
  config.builder = { lint: { max_prompt_words_per_agent: 450, max_tools_per_agent: 8 } };
  return config;
};

test('Engine and details says who it is and how it runs: blanks for a new agent, then a nameplate with who sets each detail', async () => {
  const fresh = await mount('settings');
  await agentView(fresh, 'Its details');
  assert.ok(await until(fresh, () => !!$(fresh.container, '.enHero')));
  assert.match(
    said($(fresh.container, '.grSentence')),
    /^Acme is acme, version 0\.1\.0\. It runs on LiveKit Agents with your own model keys\. Not yet: the environment it’s meant for, a time zone or fixed values\.$/,
  );
  assert.equal(textOf($(fresh.container, '.enHero .apName p')), 'Version 0.1.0 · draft');
  await fresh.unmount();

  const app = await mount('settings', detailed());
  assert.ok(await until(app, () => !!$(app.container, '.enHero')));
  assert.equal(
    said($(app.container, '.grSentence')),
    'Acme is acme, version 1.4.2, published and meant for staging. It runs on LiveKit Agents with your own model keys, tells the time in Asia/Singapore and finds its secrets in team-vault. It has 1 fixed value, and the studio warns over 450 words or 8 tools an agent.',
  );
  assert.equal($$(app.container, '.enCell.locked').length, 3, 'the id, the version and the status are set elsewhere');
  assert.match(textOf($(app.container, '.enValues')), /\{\{const\.payment_url\}\}.*not used yet/);
  await app.unmount();
});

test('Engine and details: fixed values are a table edited in place; a number stays a number and a name is written once the schema takes it', async () => {
  const app = await mount('settings');
  assert.ok(await until(app, () => !!$(app.container, '.enHero')));
  await a.click($(app.container, '[data-line="consts"] .apChange'));
  await a.click(byText($(app.container, '[data-line="consts"]'), 'button', /Add a value/));
  assert.deepEqual(app.config.constants, { value_1: '' });
  const name = $(app.container, '[aria-label="Name of fixed value 1"]');
  assert.equal(document.activeElement, name, 'the new value’s name takes the keyboard');
  await a.type(name, 'Pay URL');
  assert.deepEqual(app.config.constants, { value_1: '' }, 'a name the schema doesn’t take is not written');
  assert.match(textOf($(app.container, '[data-line="consts"]')), /Lower-case letters/);
  await a.type(name, 'callback_hours');
  await a.type($(app.container, '[aria-label="Value of callback_hours"]'), '4');
  assert.deepEqual(app.config.constants, { callback_hours: 4 });
  await app.unmount();
});

test('Engine and details’ workspace gives every setting a place, and the logs gain the OpenTelemetry export and a log file', () => {
  const part = DETAILED_PARTS.settings;
  const partRows = part.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  assert.deepEqual([...enginePlaced()].sort(), [...partRows].sort(), 'each row once, none left out, none made up');
  const paths = part.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => row.path?.join('.')));
  for (const path of ['observability.otel.enabled', 'observability.otel.endpoint', 'observability.otel.service_name', 'observability.log_file'])
    assert.ok(paths.includes(path), path);
});

// ---- Images & Videos: its own workspace
const withCheckForm = () => ({ ...agent(), forms: [{ id: 'check', title: 'Check a card', fields: [], on_submit: [] }] });
const pictured = () => {
  const config = withCheckForm();
  config.channels = config.channels.map((c) => (c.type === 'web_chat' ? { ...c, modalities: { ...c.modalities, input: ['text', 'image', 'video'] } } : c));
  config.defaults.models.llm = { ...config.defaults.models.llm, vision: true };
  config.state = { variables: { id_photo: { type: 'string' }, cam: { type: 'string' }, name: { type: 'string' }, cam_name: { type: 'string' } } };
  config.forms[0].on_submit = [
    { type: 'request_image', kind: 'upload', into: 'id_photo', prompt: 'The front of your card', quality: { min_sharpness: 8, min_dimension: 400 } },
    {
      type: 'analyze_image',
      images: ['id_photo'],
      instructions: 'Read it.',
      fields: { name: { type: 'string' } },
      required: ['name'],
      model: { provider: 'openai', model: 'gpt-4.1' },
    },
    { type: 'request_image', kind: 'camera', into: 'cam', quality: { min_sharpness: 25, min_brightness: 40, min_dimension: 400 } },
    {
      type: 'analyze_image',
      images: ['cam'],
      instructions: 'Read it.',
      fields: { name: { type: 'string' } },
      into: { name: 'cam_name' },
      model: { provider: 'openai', model: 'gpt-4.1' },
    },
    { type: 'compare_values', pairs: [{ left: 'name', right: 'cam_name', label: 'name' }] },
    { type: 'discard_image', images: ['id_photo', 'cam'] },
  ];
  return config;
};

test('Images & Videos says what happens to a picture: blanks for a new agent, then one picture’s journey', async () => {
  const fresh = await mount('media');
  await agentView(fresh, 'Its pictures');
  assert.ok(await until(fresh, () => !!$(fresh.container, '.mdHero')));
  assert.equal(
    said($(fresh.container, '.grSentence')),
    'Acme doesn’t take pictures yet. Not yet: photos or the camera on a way in or a step that asks for a picture.',
  );
  assert.equal($$(fresh.container, '.mdSt.empty').length, 4, 'the journey drawn empty, each station adding a step');
  await fresh.unmount();

  const app = await mount('media', pictured());
  assert.ok(await until(app, () => !!$(app.container, '.mdHero')));
  assert.equal(
    said($(app.container, '.grSentence')),
    'Acme takes photos and the camera on Web chat. In the form “Check a card” it asks for a photo and the camera, reads 1 detail from each with gpt-4.1, checks in code that they match and forgets every picture straight after. Photos are held to Standard and the camera to Standard.',
  );
  assert.deepEqual($$(app.container, '.mdLane b').map(textOf), ['The photo', 'The camera', 'Both'], 'a lane per picture, then where they meet');
  assert.match(textOf($(app.container, '.mdHero .apName p')), /1 way in takes pictures · 2 requests · 2 readings · 1 comparison · all forgotten/);
  // a step opens on its own page, with its own rows
  await a.click($(app.container, '[data-line="step:forms.0.on_submit.4"] .apChange'));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')));
  assert.match(textOf($(app.container, '.cxPage .tlPageHead')), /Compare in code/);
  await a.click(byText($(app.container, '[data-field="media.require"]'), 'button', 'Any one matches'));
  assert.equal(app.config.forms[0].on_submit[4].require, 'any');
  await a.click($(app.container, '.tlBack'));
  assert.ok(await until(app, () => !!$(app.container, '.mdHero')));
  await app.unmount();
});

test('Images & Videos: a starting point adds ask, read and forget, lets the website take photos, and opens the request', async () => {
  const app = await mount('media', withCheckForm());
  assert.ok(await until(app, () => !!$(app.container, '.mdHero')));
  await a.click($(app.container, '[data-line="add"] .apChange'));
  await a.click(byText($(app.container, '[data-line="add"]'), '.tlKind', /A photo of a document/));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')), 'the new request opens on its page');
  assert.match(textOf($(app.container, '.cxPage .tlPageHead')), /Ask for a photo/);
  assert.deepEqual(
    app.config.forms[0].on_submit.map((x) => x.type),
    ['request_image', 'analyze_image', 'discard_image'],
  );
  assert.ok(app.config.channels.find((c) => c.type === 'web_chat').modalities.input.includes('image'), 'the website takes photos now');
  await a.click($(app.container, '.tlBack'));
  assert.ok(await until(app, () => !!$(app.container, '.mdHero')));
  assert.match(said($(app.container, '.grSentence')), /^Acme takes photos on Web chat\. In the form “Check a card” it asks for a photo, reads 3 details with/);
  await app.unmount();
});

test('Images & Videos: All settings opens on an agent with no picture steps, and a problem’s “show me” on a way in opens it', async () => {
  const fresh = await mount('media');
  await agentView(fresh, 'All settings');
  assert.ok(await until(fresh, () => !!$(fresh.container, '[data-card="media.requests"]')), 'every card draws, the empty step lists too');
  await agentView(fresh, 'Its pictures');
  await fresh.unmount();
  const web = pictured().channels.findIndex((c) => c.type === 'web_chat');
  const app = await mount('media', pictured(), { request: { path: ['channels', web, 'inputs', 'image', 'max_bytes'], nonce: 1 } });
  assert.ok(await until(app, () => !!$(app.container, '#dt-media-maxSize')), 'the way in’s own rows, in All settings');
  await agentView(app, 'Its pictures');
  await app.unmount();
});

test('Images & Videos: two parts of the sentence that open the same editor each keep their own anchor', async () => {
  const app = await mount('media', pictured());
  assert.ok(await until(app, () => !!$(app.container, '.mdHero')));
  const parts = $$(app.container, '.grSentence .apTok[aria-haspopup]').filter((b) => /^(photos|the camera)/.test(textOf(b)));
  assert.equal(parts.length, 2);
  await a.click(parts[0]);
  assert.deepEqual(
    parts.map((b) => b.getAttribute('aria-expanded')),
    ['true', 'false'],
    'only the part clicked says it is open',
  );
  await app.unmount();
});

test('Images & Videos’ workspace gives every setting a place', () => {
  const part = DETAILED_PARTS.media;
  const cards = part.cols.flat();
  const partRows = cards.flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  assert.deepEqual([...mediaPlaced()].sort(), [...partRows].sort(), 'the part’s own rows, each once');
  const config = pictured();
  const facts = (path) => factsAt(engine, schema, path, config);
  const stand = {
    ways: { key: 'web', name: 'Web chat', base: ['channels', config.channels.findIndex((c) => c.type === 'web_chat')] },
    seeing: { key: 'main', name: 'Main', base: ['agents', 'items', 0] },
    requests: { key: 'r', name: 'r', base: ['forms', 0, 'on_submit', 0] },
    reads: { key: 'a', name: 'a', base: ['forms', 0, 'on_submit', 1] },
    compares: { key: 'c', name: 'c', base: ['forms', 0, 'on_submit', 4] },
    forgets: { key: 'f', name: 'f', base: ['forms', 0, 'on_submit', 5] },
  };
  for (const [listId, entry] of Object.entries(stand)) {
    const card = cards.find((c) => c.of === listId);
    const at = { config, facts, chosen: () => entry };
    const ids = [...card.rowsFor(at), ...(card.advFor?.(at) || [])].map((r) => r.id);
    assert.deepEqual([...mediaItemPlaced(listId)].sort(), [...ids].sort(), `${listId}: each row once, none left out`);
  }
});

// ---- the whole-app review (2026-11-07): Build fixes, each pinned
const blur = (el) =>
  act(async () => {
    el.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new window.FocusEvent('blur', { bubbles: false }));
  });

test('a connection can’t be renamed to a name another one has: it says so and nothing merges', async () => {
  const config = agent();
  config.connections = { crm: { type: 'http', base_url: 'https://crm.example.com' }, billing: { type: 'http', base_url: 'https://billing.example.com' } };
  const app = await mount('connections', config);
  await agentView(app, 'All settings');
  const card = () => $(app.container, '[data-card="connections.connections"]');
  const box = $(card(), '[data-field="connections.name"] input');
  await a.type(box, 'billing');
  await blur(box);
  assert.match(textOf($(card(), '[data-field="connections.name"]')), /Another one already has this name/);
  assert.deepEqual(Object.keys(app.config.connections), ['crm', 'billing']);
  await agentView(app, 'What it reaches');
  await app.unmount();
});

test('a rule’s value box shows the chosen rule’s own value, never the one chosen before', async () => {
  const config = agent();
  config.state = { variables: { attempts: { type: 'integer' }, vip: { type: 'boolean' } } };
  config.guardrails = {
    escalation: [
      { id: 'too_many', when: { state: 'attempts', gte: 3 }, action: 'end_call' },
      { id: 'vip_rule', when: { state: 'vip', equals: true }, action: 'end_call' },
    ],
  };
  const app = await mount('guardrails', config);
  await agentView(app, 'All settings');
  const card = () => $(app.container, '[data-card="guardrails.rule"]');
  const box = () => $(card(), '[data-field="guardrails.ruleCompare"] input');
  assert.equal(box().value, '3');
  await a.click(byText(card(), 'button', 'vip_rule'));
  assert.equal(box().value, 'true');
  await agentView(app, 'What it guards');
  await app.unmount();
});

test('the agent that answers first can’t be deleted from Subagents’ All settings: it says why instead', async () => {
  const config =
    addSubagent(agent(), 'assistant', { name: 'Billing', when: 'bills' }).config || addSubagent(agent(), 'assistant', { name: 'Billing', when: 'bills' });
  const app = await mount('subagents', config);
  await agentView(app, 'All settings');
  const card = $(app.container, '[data-card="subagents.subagent"]');
  assert.ok(card, 'the subagent card');
  assert.match(textOf(card), /It answers first, so it can’t be deleted/);
  assert.equal(byText(card, 'button', /^Delete this/), null);
  await agentView(app, 'Who answers');
  await app.unmount();
});

test('removing one of two equal words takes away only that one', async () => {
  const config = agent();
  config.persona = { ...config.persona, style_rules: ['Be brief', 'Be brief', 'Be kind'] };
  const app = await mount('agent', config);
  await agentView(app, 'All settings');
  const removes = $$(app.container, 'button[aria-label="Remove “Be brief”"]');
  assert.equal(removes.length, 2, 'both chips are there');
  await a.click(removes[0]);
  assert.deepEqual(app.config.persona.style_rules, ['Be brief', 'Be kind']);
  await agentView(app, 'Profile');
  await app.unmount();
});

test('switching on the off-topic rule on an agent with no tools also switches on ending the call, so it works', async () => {
  const config = agent();
  config.tools = [];
  config.agents.items = config.agents.items.map((x) => ({ ...x, tools: [] }));
  config.guardrails = { topics: { allowed: ['orders'] } };
  const app = await mount('guardrails', config);
  await agentView(app, 'All settings');
  const sw = $(app.container, '#dt-guardrails-offtopic');
  assert.match(textOf($(app.container, '[data-field="guardrails.offtopic"]')), /also switches on “End the call politely”/);
  await a.click(sw);
  const rule = app.config.guardrails.topics.on_off_topic;
  assert.ok(rule?.then, 'the rule runs a tool');
  assert.equal(app.config.tools.find((t) => t.id === rule.then)?.builtin, 'end_call');
  await agentView(app, 'What it guards');
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
  await agentView(app, 'All settings');
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
  await agentView(app, 'What it guards');
  await app.unmount();
});

// ---- Channels: what a channel offers is the server's table of kinds (GET /channel-types), not a list in the part
// ---- Channels as how people reach it (canvas page "6 · Channels, redesigned"), for any agent
const three = () => ({
  ...agent(),
  channels: [
    { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: 'Hello.' } },
    { id: 'chat', type: 'web_chat', enabled: true, entry: { widget_id: 'w' }, modalities: { input: ['text'], output: ['text'] } },
    { id: 'wa', type: 'whatsapp', enabled: true, modalities: { input: ['text'], output: ['text'] } },
  ],
});
const openDoor = async (app, name) => {
  await a.click(byText(app.container, '.chDoor', name));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')), `${name} opens on its page`);
};
const pageFields = (app) => $$(app.container, '.cxPage [data-field]').map((row) => row.dataset.field);
const backTo = async (app) => {
  await a.click(byText(app.container, 'button', /Back to/));
  assert.ok(await until(app, () => !!$(app.container, '.chHero')));
};

test('a way in offers what its kind can have: a keypad on a phone line, forms on a web chat; a kind that doesn’t run says so', async () => {
  const { FALLBACK } = await import('../src/studio/form/channelTypes.js');
  const app = await mount('channels', three(), { extra: { channelTypes: FALLBACK } });
  await agentView(app, 'How people reach it');
  assert.ok(await until(app, () => $$(app.container, '.chDoor').length >= 3), 'a door for each way in');
  await openDoor(app, /Phone calls/);
  assert.ok(pageFields(app).includes('channels.dtmf') && !pageFields(app).includes('channels.forms'), `a phone line: ${pageFields(app).join(', ')}`);
  assert.ok(pageFields(app).includes('channels.route'), 'and how callers reach it');
  await backTo(app);
  await openDoor(app, /Chat on your website/);
  assert.ok(pageFields(app).includes('channels.forms') && !pageFields(app).includes('channels.dtmf'), `a web chat: ${pageFields(app).join(', ')}`);
  await backTo(app);
  if (FALLBACK.find((t) => t.type === 'whatsapp')?.runsToday === false) {
    assert.match(textOf(byText(app.container, '.chDoor', /WhatsApp/)), /Not connected yet/);
    await openDoor(app, /WhatsApp/);
    assert.ok(pageFields(app).includes('channels.notRunning'), 'WhatsApp says it is not connected yet');
    await backTo(app);
  }
  await app.unmount();
});

test('a way in’s greeting can be talked over unless it says otherwise (unset reads as on, as the channel form reads it)', async () => {
  const { FALLBACK } = await import('../src/studio/form/channelTypes.js');
  const app = await mount('channels', three(), { extra: { channelTypes: FALLBACK } });
  await agentView(app, 'How people reach it');
  assert.ok(await until(app, () => !!$(app.container, '.chHero')));
  await openDoor(app, /Phone calls/);
  const sw = () => $(app.container, '[data-field="channels.interrupt"] [role="switch"]');
  assert.equal(sw().getAttribute('aria-checked'), 'true', 'nothing set: callers may interrupt');
  await a.click(sw());
  assert.equal(app.config.channels[0].greeting.allow_interruptions, false, 'switched off: written as false');
  await backTo(app);
  await app.unmount();
});

test('Channels says how people reach it: the ways in that are on, the others as blanks, its hours and who is calling', async () => {
  const { FALLBACK } = await import('../src/studio/form/channelTypes.js');
  const config = {
    ...three(),
    schedules: {
      office: { description: 'Office hours', timezone: 'UTC', weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }] },
    },
  };
  const app = await mount('channels', config, { extra: { channelTypes: FALLBACK } });
  await agentView(app, 'How people reach it');
  assert.ok(await until(app, () => !!$(app.container, '.chHero')));
  assert.match(
    said($(app.container, '.chSentence')),
    /People reach Acme by chatting on your website, calling a phone number and one more way\. Not yet: talking on your website\. Its team is in on weekdays, 9:00 to 17:00\. How it knows who is calling: not set yet\./,
  );
  assert.ok($(app.container, '.chWeekStrip'), 'the week of its hours');
  // a blank way in opens the switches, which make it ready
  await a.click(byText(app.container, '.chSentence .apTok.blank', /talking on your website/));
  assert.ok(await until(app, () => !!$(document.body, '.apPop [aria-label="Where people reach it"]')), 'the switches open in place');
  await a.click(byText(document.body, '.apPop [aria-label="Where people reach it"] button', /Talk on your website/));
  assert.ok(
    app.config.channels.some((c) => c.type === 'web_voice' && c.enabled !== false),
    'talking on the website is on',
  );
  await app.unmount();
});

test('a way in’s carries, a set of hours’ week and its closed days are edited as they read, never emptied', async () => {
  const { FALLBACK } = await import('../src/studio/form/channelTypes.js');
  const config = {
    ...three(),
    schedules: {
      office: { description: 'Office hours', timezone: 'UTC', weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }] },
    },
  };
  const app = await mount('channels', config, { extra: { channelTypes: FALLBACK } });
  await agentView(app, 'How people reach it');
  assert.ok(await until(app, () => !!$(app.container, '.chHero')));
  await openDoor(app, /Chat on your website/);
  const carry = (label, words) => byText($(app.container, `[role="group"][aria-label="${label}"]`), 'button', words);
  assert.ok(carry('The person can', /^type$/).disabled, 'its only way in can’t be taken away');
  // photos and the camera are asked on Images & Videos only: here they are said, with the way there
  assert.equal(carry('The person can', /send photos|show the camera/), null);
  assert.match(textOf($(app.container, '.chPictures')), /Set on\s*Images & Videos/);
  await backTo(app);
  await a.click($(app.container, '.chWeekStrip'));
  assert.ok(await until(app, () => !!$(app.container, '.chWeek')), 'the hours open, with their week');
  await a.click(byText($(app.container, '.chDays'), 'button', /^Sat$/));
  assert.deepEqual(app.config.schedules.office.weekly[0].days, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  await a.type($(app.container, '.chAddDay input'), '2026-12-25');
  await a.click(byText(app.container, '.chAddDay button', /Add the day/));
  assert.deepEqual(app.config.schedules.office.holidays, ['2026-12-25']);
  await backTo(app);
  await app.unmount();
});

test('Channels’ workspace gives every setting exactly one place', async () => {
  const { FALLBACK } = await import('../src/studio/form/channelTypes.js');
  const part = DETAILED_PARTS.channels;
  const partRows = part.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  assert.deepEqual([...channelsPlaced()].sort(), [...partRows].sort(), 'the sentence holds the switches and who is calling');
  for (const [list, item] of [
    ['channels', { id: 'phone', type: 'sip_voice', modalities: { input: ['audio'], output: ['audio'] } }],
    ['channels', { id: 'chat', type: 'web_chat', modalities: { input: ['text'], output: ['text'] } }],
    ['schedules', { timezone: 'UTC', weekly: [] }],
  ]) {
    const card = part.cols.flat().find((c) => c.of === list);
    const entry = { key: item.id || 'x', name: 'X', base: [list, 0], item };
    const here = { config: { channels: [item], schedules: { x: item } }, chosen: () => entry, channelTypes: FALLBACK };
    const ids = [...card.rowsFor(here), ...card.advFor(here)].map((r) => r.id).filter((id) => !id.startsWith('entry_'));
    const placed = channelsItemPlaced(list);
    assert.deepEqual(
      ids.filter((id) => !placed.includes(id)),
      [],
      `${list}: every row has a place`,
    );
  }
});

// ---- Subagents and hand-overs: who answers
// a team made the way the Workflow canvas makes one: the first agent passes callers to two subagents, one of which can
// send them back
const team = () => {
  let config = agent();
  const first = config.agents.items[0].id;
  config = addSubagent(config, first, { name: 'Bookings', when: 'The caller wants to book a visit.' }).config;
  config = addSubagent(config, first, { name: 'Billing', when: 'The caller asks about a bill.' }).config;
  const [bookings, billing] = config.agents.items.slice(1).map((x) => x.id);
  config.agents.items[1].instructions = { ...config.agents.items[1].instructions, role: 'Books, moves and cancels visits.' };
  config.agents.items[2].instructions = { ...config.agents.items[2].instructions, role: 'Explains a bill and takes a payment.' };
  config = addBackToStart(config, bookings).config;
  // Billing has no way back: the one the hand-over rules gave it is taken away
  const backId = config.tools.find((x) => x.builtin === 'return_to_entry')?.id;
  config.agents.items[2].tools = config.agents.items[2].tools.filter((t) => t !== backId);
  return { config, first, bookings, billing };
};
const saBack = async (app) => {
  await a.click($(app.container, '.tlBack'));
  assert.ok(await until(app, () => !!$(app.container, '.saHero')));
};

test('Subagents says who answers: one agent alone, then a team with its ways back, drawn as a relay', async () => {
  const alone = await mount('subagents', agent(), { extra: { workspace: [] } });
  await agentView(alone, 'Who answers');
  assert.ok(await until(alone, () => !!$(alone.container, '.saHero')));
  assert.match(
    said($(alone.container, '.saSentence')),
    /^\S.* answers every call itself\. Not yet: a subagent to pass callers to or another agent to transfer to\./,
  );
  assert.ok($(alone.container, '.saRelay.alone'), 'one agent: the way to add a subagent');
  assert.equal($(alone.container, '[aria-labelledby="sa-back"]'), null, 'no ways back to set with nobody to come back from');
  await alone.unmount();

  const { config } = team();
  const app = await mount('subagents', config, { extra: { workspace: [] } });
  assert.ok(await until(app, () => !!$(app.container, '.saHero')));
  assert.match(said($(app.container, '.saSentence')), /answers first and passes callers to 2 subagents; 1 of them can send callers back\./);
  assert.match(textOf($(app.container, '.saHero .apName p')), /^3 agents · \d+ hand-overs · 1 way back/);
  assert.equal($$(app.container, '.saRelay [data-node^="s"]').length, 2, 'a node for each subagent');
  // the agents, the hand-overs and the ways back, each a line
  assert.equal($$(app.container, '[data-line^="agent:"]').length, 3);
  assert.equal($$(app.container, '[data-line^="hand:"]').length, 2);
  assert.match(textOf($(app.container, '[data-line="ways"]')), /Bookings · can send the caller back to/);
  // the ways back open as a list, each opening its subagent
  await a.click(byText(app.container, '.saSentence .apTok', /1 of them/));
  assert.ok(await until(app, () => !!$(document.body, '.apPop')), 'the ways back open in place');
  assert.match(textOf($(document.body, '.apPop')), /Billing\s*can’t send them back yet/);
  await app.unmount();
});

test('Subagents: an agent and a hand-over each open on a page of their own, with their own settings', async () => {
  const { config, bookings, first } = team();
  const app = await mount('subagents', config, { extra: { workspace: [] } });
  assert.ok(await until(app, () => !!$(app.container, '.saHero')));
  // a subagent: its job, what it uses, how it sounds, its way back; the rest under "more"
  await a.click($(app.container, `[data-line="agent:${bookings}"] .apChange`));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')), 'the subagent opens on its page');
  assert.equal(textOf($(app.container, '.cxPage h2')), 'Bookings');
  const fields = () => $$(app.container, '.cxPage [data-field]').map((row) => row.dataset.field);
  for (const f of ['subagents.name', 'subagents.does', 'subagents.tools', 'subagents.back']) assert.ok(fields().includes(f), `${f} is on its page`);
  const backTool = () => app.config.tools.find((x) => x.builtin === 'return_to_entry')?.id;
  assert.ok(app.config.agents.items[1].tools.includes(backTool()), 'it can send callers back');
  await a.click($(app.container, '.cxPage [data-field="subagents.back"] [role="switch"], .cxPage [data-field="subagents.back"] input[type="checkbox"]'));
  assert.ok(!app.config.agents.items[1].tools.includes(backTool()), 'its way back is switched off');
  await saBack(app);
  // a hand-over: when, while it hands over, who takes over
  await a.click($(app.container, `[data-line^="hand:${first}/"] .apChange`));
  assert.ok(await until(app, () => !!$(app.container, '.saPath')), 'the hand-over opens with its path');
  assert.deepEqual($$(app.container, '.saPath .tlStep b').map(textOf), ['When', 'While it hands over', 'Who takes over']);
  await a.type($(app.container, '#dt-subagents-say'), 'One moment.');
  assert.equal(app.config.agents.items[0].handoffs[0].announce, 'One moment.');
  assert.ok($(app.container, '.cxPage [data-field="subagents.remember"]'), 'what it remembers as it hands over (set_state) is offered');
  await saBack(app);
  await app.unmount();
});

test('Subagents: a hand-over is added by where the caller should go, and the hand-over rules are offered when missing', async () => {
  const { config, bookings, billing } = team();
  // without the rules: the first agent's and the specialists'
  config.agents.items.forEach((x) => {
    x.instructions = { ...x.instructions, rules: [] };
  });
  const app = await mount('subagents', config, { extra: { workspace: [] } });
  assert.ok(await until(app, () => !!$(app.container, '.saFix')), 'the missing rules are said');
  await a.click(byText(app.container, '.saFix button', /Add the hand-over rules/));
  assert.ok(await until(app, () => !$(app.container, '.saFix')), 'and added');
  assert.ok(app.config.agents.items[0].instructions.rules.length > 0);
  // to a subagent: from Bookings to Billing
  await a.click($(app.container, '[data-line="addHand"] .apChange'));
  await a.click(byText(app.container, '.saKinds .tlKind', /To a subagent/));
  const [from, to] = $$(app.container, '.saAddRow .stFInput');
  await a.choose(from, bookings);
  await a.choose(to, billing);
  await a.click(byText(app.container, '.saAddRow button', /^Add$/));
  assert.ok(await until(app, () => !!$(app.container, '.saPath')), 'the new hand-over opens on its page');
  assert.ok(
    app.config.agents.items[1].handoffs?.some((h) => h.to === billing),
    'Bookings now passes callers to Billing',
  );
  await saBack(app);
  // to another agent: none of the workspace's has a number, so it says why
  await a.click($(app.container, '[data-line="addHand"] .apChange'));
  assert.ok(byText(app.container, '.saKinds .tlKind.later', /To another agent/), 'a hand-over to another agent waits for a number');
  await app.unmount();
});

test('Subagents’ workspace gives every setting exactly one place', () => {
  const part = DETAILED_PARTS.subagents;
  const cards = Object.fromEntries(part.cols.flat().map((c) => [c.id, c]));
  const { config } = team();
  const here = { config, workspace: [], chosen: () => null };
  const partRows = [
    ...part.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`)),
    // the back card's settings for the whole team (its per-agent switch is on each agent's page)
    ...cards.back
      .rowsFor(here)
      .filter((r) => r.id !== 'back')
      .map((r) => `back.${r.id}`),
  ];
  assert.deepEqual([...subagentsPlaced()].sort(), [...partRows].sort(), 'the sentence and the chapters hold the team’s settings');
  const lists = {
    agents: ['subagent', ['agents', 'items', 1], config.agents.items[1]],
    handoffs: ['handover', ['agents', 'items', 0, 'handoffs', 0], config.agents.items[0].handoffs[0]],
  };
  for (const [list, [cardId, base, item]] of Object.entries(lists)) {
    const entry = { key: 'x', name: 'X', base, item };
    const at = { ...here, chosen: () => entry };
    const ids = [
      ...cards[cardId].rowsFor(at),
      ...(cards[cardId].advFor?.(at) || []),
      ...(list === 'agents' ? cards.back.rowsFor(at).filter((r) => r.id === 'back') : []),
    ].map((r) => r.id);
    const placed = subagentsItemPlaced(list);
    assert.deepEqual(
      ids.filter((id) => !placed.includes(id)),
      [],
      `${list}: every row has a place`,
    );
    assert.deepEqual(
      placed.filter((id, i) => placed.indexOf(id) !== i),
      [],
      `${list}: and only one`,
    );
  }
  // a hand-over to another agent of the workspace
  const billing = { id: 'billing-desk', name: 'Billing desk', numbers: [{ number: '+6560000001' }] };
  const start = agent();
  const made = addTransferToAgent(start, start.agents.items[0].id, billing);
  const toolId = made.id.split('::tool::')[1];
  const entry = { key: toolId, name: 'X', base: ['tools', made.config.tools.findIndex((t) => t.id === toolId)], item: {}, other: billing };
  const at = { config: made.config, workspace: { agents: [billing] }, chosen: () => entry };
  const ids = [...cards.transfer.rowsFor(at), ...cards.transfer.advFor(at)].map((r) => r.id);
  assert.deepEqual(
    ids.filter((id) => !subagentsItemPlaced('agentTransfers').includes(id)),
    [],
    'agentTransfers: every row has a place',
  );
});

test('a number that can’t be empty keeps its last value while the box is cleared, so clearing it and typing 5 gives 5', async () => {
  const config = agent();
  config.guardrails = { ...(config.guardrails || {}), topics: { on_off_topic: { max_strikes: 3, then: config.tools[0].id, say: 'Let’s stay on topic.' } } };
  const app = await mount('guardrails', config);
  await agentView(app, 'All settings');
  const box = $(app.container, '#dt-guardrails-strikes');
  await a.type(box, '');
  assert.equal(app.config.guardrails.topics.on_off_topic.max_strikes, 3, 'cleared: still 3 in the draft');
  assert.equal(box.value, '', 'and the box stays empty to type in');
  await a.type(box, '5');
  assert.equal(app.config.guardrails.topics.on_off_topic.max_strikes, 5);
  await agentView(app, 'What it guards');
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
  await agentView(app, 'All settings');
  const card = () => $(app.container, '[data-card="guardrails.input"]');
  const chips = () => $$(card(), '.dtItems > button[aria-current]');
  const shown = () => $$(card(), '.dtRow[data-field]').map((r) => r.getAttribute('data-field').replace('guardrails.', ''));
  // what it looks for, what it does and how it is enforced, then what it says and its name (All settings opens every fold)
  const expect = {
    details: ['entities', 'action', 'enforce', 'checkSay', 'name'],
    kind: ['statement', 'enforce', 'name'],
    secrets: ['fields', 'enforce', 'name'],
    codes: ['patterns', 'action', 'enforce', 'checkSay', 'name'],
    tricks: ['action', 'enforce', 'checkSay', 'name'],
  };
  const KNOWN = ['entities', 'patterns', 'fields', 'statement', 'action', 'enforce', 'checkSay', 'name'];
  assert.equal(await until(app, () => chips().length === 5), true, 'a chip for each check');
  for (const [i, [id, rows]] of Object.entries(expect).entries()) {
    await a.click(chips()[i]);
    assert.ok(await until(app, () => chips()[i].getAttribute('aria-current') === 'true'), `${id} is chosen`);
    assert.ok(await until(app, () => JSON.stringify(shown().filter((r) => KNOWN.includes(r))) === JSON.stringify(rows)), `${id}: ${shown().join(', ')}`);
  }
  // personal details: shown for a personal-detail check, and a choice is kept
  await a.click(chips()[0]);
  await until(app, () => shown().includes('entities'));
  await a.click(byText(card(), '[data-field="guardrails.entities"] .dtPills button', 'Bank account numbers'));
  assert.deepEqual(app.config.guardrails.input[0].entities, ['card_number', 'bank_account'], 'kept in entities');
  // the rule in words: kept in `text`, as the schema has it
  await a.click(chips()[1]);
  assert.ok(await until(app, () => $(card(), '#dt-guardrails-statement')), 'the rule’s words are in view');
  await a.type($(card(), '#dt-guardrails-statement'), 'Never shame the caller.');
  assert.equal(app.config.guardrails.input[1].text, 'Never shame the caller.');
  assert.equal('statement' in app.config.guardrails.input[1], false, 'nothing written beside it');
  await agentView(app, 'What it guards');
  await app.unmount();
});

// ---- Guardrails as what it guards (canvas page "8 · Guardrails, redesigned"), for any agent
const guarded = () => {
  let config = agent();
  config.guardrails = {
    input: [
      { id: 'tricks', type: 'prompt_injection', enforcement: 'both', on_trigger: { action: 'deflect', say: 'I can only help with Acme.' } },
      { id: 'card_numbers', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
    ],
    output: [
      { id: 'no_promises', type: 'statement', text: 'Never promise a refund.', enforcement: 'prompt' },
      { id: 'secret_fields', type: 'field_firewall', fields: ['otp'], enforcement: 'code' },
    ],
    topics: { allowed: ['orders', 'returns'] },
    limits: { max_call_duration_s: 900 },
  };
  config = setMoment(config, 'abusive_end', true);
  return config;
};
const grBack = async (app) => {
  await a.click($(app.container, '.tlBack'));
  assert.ok(await until(app, () => !!$(app.container, '.grHero')));
};

test('Guardrails says what it guards: nothing yet as blanks, then every check, topic, moment and limit, drawn as the path of a line', async () => {
  const bare = agent();
  delete bare.guardrails;
  const fresh = await mount('guardrails', bare);
  await agentView(fresh, 'What it guards');
  assert.ok(await until(fresh, () => !!$(fresh.container, '.grHero')));
  assert.match(
    said($(fresh.container, '.grSentence')),
    /follows its instructions, and nothing is checked yet\. Not yet: a check on what callers say, the topics it keeps to or a longest call\./,
  );
  assert.equal($$(fresh.container, '.grGate.empty').length, 2, 'both sets of checks are empty, each with its way to add one');
  await fresh.unmount();

  const app = await mount('guardrails', guarded());
  assert.ok(await until(app, () => !!$(app.container, '.grHero')));
  assert.match(
    said($(app.container, '.grSentence')),
    /^Before .+ hears a caller, it refuses tricks and hides personal details; before it speaks, it follows a rule in words and keeps secret fields out\. It keeps to 2 topics, ends the call when someone is abusive and ends every call at 15 minutes\.$/,
  );
  assert.equal($$(app.container, '.grGate[data-node="in"] .grChip').length, 2, 'what callers say: two checks');
  assert.equal($$(app.container, '.grGate[data-node="out"] .grChip').length, 2, 'what it says: two checks');
  // what really happens to each, before the server has answered: the guide's list
  const line = (key) => textOf($(app.container, `[data-line="${key}"]`));
  assert.match(line('check:output:secret_fields'), /Not run yet/);
  assert.match(line('check:output:no_promises'), /Told to/);
  assert.doesNotMatch(line('check:input:tricks'), /Not run yet/);
  assert.match(textOf($(app.container, '.grWatch')), /Someone abusive.*Longest call\s*· 15 minutes/);
  await app.unmount();
});

test('Guardrails: a check and a rule of its own each open on a page of their own, with their own settings', async () => {
  const app = await mount('guardrails', guarded());
  assert.ok(await until(app, () => !!$(app.container, '.grHero')));
  // a check on what it says: its words, in view
  await a.click($(app.container, '[data-line="check:output:no_promises"] .apChange'));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')), 'the check opens on its page');
  assert.match(textOf($(app.container, '.cxPage .tlPageHead')), /No promises/);
  await a.type($(app.container, '#dt-guardrails-statementOut'), 'Never promise a repair time.');
  assert.equal(app.config.guardrails.output[0].text, 'Never promise a repair time.');
  await grBack(app);
  // personal details: its steps, and the fact about its kind
  await a.click($(app.container, '[data-line="check:input:card_numbers"] .apChange'));
  assert.ok(await until(app, () => !!$(app.container, '.grPath')));
  assert.deepEqual($$(app.container, '.grPath .tlStep b').map(textOf), ['What it looks for', 'When it finds it', 'How it is enforced']);
  assert.match(textOf($(app.container, '.cxPage')), /always hides what it finds in the log/);
  await grBack(app);
  // a rule of its own: added, said when, and what it does
  await a.click($(app.container, '[data-line="addRule"] .apChange'));
  assert.ok(await until(app, () => !!$(app.container, '#dt-guardrails-ruleIntent')), 'the new rule opens on its page');
  assert.match(textOf($(app.container, '.cxPage')), /When isn’t said yet: it never acts/);
  await a.type($(app.container, '#dt-guardrails-ruleIntent'), 'asks_for_human');
  await a.click(byText($(app.container, '[data-field="guardrails.ruleThen"]'), 'button', 'Ends the call'));
  const rule = app.config.guardrails.escalation.at(-1);
  assert.deepEqual([rule.when, rule.action, rule.tool], [{ intent: 'asks_for_human' }, 'end_call', undefined]);
  await grBack(app);
  assert.match(textOf($(app.container, `[data-line="rule:${rule.id}"]`)), /When what they want is “asks for human”: end the call/);
  await app.unmount();
});

test('Guardrails: a check that is plainly missing something needs a look, and is added by which words it checks', async () => {
  const config = guarded();
  config.guardrails.input[1].entities = [];
  const app = await mount('guardrails', config);
  assert.ok(await until(app, () => !!$(app.container, '.grHero')));
  assert.match(textOf($(app.container, '[data-line="check:input:card_numbers"]')), /It looks for nothing yet.*Needs a look/);
  assert.match(textOf($(app.container, '.grHero .apName p')), /1 needs a look/);
  // add a check on what it says: a rule in words
  await a.click($(app.container, '[data-line="addCheck"] .apChange'));
  await a.click(byText($(app.container, '.grWhere'), 'button', /^What .+ says$/));
  await a.click(byText($(app.container, '[data-line="addCheck"]'), '.tlKind', /A rule in words/));
  assert.ok(await until(app, () => !!$(app.container, '.cxPage')), 'the new check opens on its page');
  assert.equal(app.config.guardrails.output.length, 3);
  assert.equal(app.config.guardrails.output[2].type, 'statement');
  await grBack(app);
  await app.unmount();
});

test('Guardrails’ workspace gives every setting exactly one place', () => {
  const part = DETAILED_PARTS.guardrails;
  const cards = Object.fromEntries(part.cols.flat().map((c) => [c.id, c]));
  const partRows = part.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  assert.deepEqual([...guardrailsPlaced()].sort(), [...partRows].sort(), 'the sentence and the chapters hold the part’s own rows');
  const config = guarded();
  const facts = (path) => factsAt(engine, schema, path, config);
  const every = (list, cardId, entries) => {
    const ids = new Set();
    entries.forEach((entry) => {
      const at = { config, facts, chosen: () => entry };
      [...cards[cardId].rowsFor(at), ...(cards[cardId].advFor?.(at) || [])].forEach((r) => ids.add(r.id));
    });
    const placed = guardrailsItemPlaced(list);
    assert.deepEqual(
      [...ids].filter((id) => !placed.includes(id)),
      [],
      `${list}: every row has a place`,
    );
    assert.deepEqual(
      placed.filter((id, i) => placed.indexOf(id) !== i),
      [],
      `${list}: and only one`,
    );
  };
  const of = (where) => config.guardrails[where].map((item, i) => ({ key: item.id, name: item.id, base: ['guardrails', where, i], item }));
  every('input', 'input', of('input'));
  every('output', 'output', of('output'));
  every('rules', 'rule', [{ key: 'r', name: 'r', base: ['guardrails', 'escalation', 0], item: config.guardrails.escalation[0] }]);
  // no two rows of the part share a name, so "show me" lands on one
  const entryFor = {
    input: of('input')[0],
    output: of('output')[0],
    rule: { key: 'r', name: 'r', base: ['guardrails', 'escalation', 0], item: config.guardrails.escalation[0] },
  };
  const names = Object.values(cards).flatMap((card) => {
    const at = { config, facts, chosen: () => entryFor[card.id] };
    return [...(card.rows || []), ...(card.adv || []), ...(card.rowsFor ? card.rowsFor(at) : []), ...(card.advFor ? card.advFor(at) : [])].map((r) => r.id);
  });
  assert.deepEqual(
    names.filter((id, i) => names.indexOf(id) !== i),
    [],
  );
});

test('a secret is never a typed box: the model’s access key opens the secret picker (agent config guide 5, x-ui secret-picker)', async () => {
  const config = agent();
  config.defaults.models.llm.api_key = { secret: 'OPENAI_API_KEY' };
  const app = await mount('agent', config);
  await agentView(app, 'All settings');
  const fold = $$(app.container, 'details.dtAdv').find((d) => /Key kept on the server/.test(textOf(d)));
  fold.open = true;
  fold.dispatchEvent(new window.Event('toggle'));
  assert.ok(await until(app, () => !!$(app.container, '[data-field="agent.key"]')), 'the Advanced rows open');
  const row = $(app.container, '[data-field="agent.key"]');
  assert.equal($(row, 'input[type="text"]'), null, 'no text box that would store a raw key');
  assert.match(textOf(row), /secret: OPENAI_API_KEY/, 'the secret’s name is shown, not [object Object]');
  assert.ok(byText(row, 'button', 'Edit'), 'it opens the schema-drawn editor, with its secret picker');
  await agentView(app, 'Profile');
  await app.unmount();
});

test('what it remembers is a sheet: the first 12, a search, filters by kind, and one detail at a time to change or add', async () => {
  const config = agent();
  const vars = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`value_${i + 1}`, { type: 'string' }]));
  vars.pin = { type: 'string', sensitive: true };
  vars.verified = { type: 'boolean', default: false };
  config.state = { ...config.state, variables: vars };
  const app = await mount('conversation', config);
  await agentView(app, 'All settings');
  const sheet = () => $(app.container, '[data-field="conversation.variables"] .rmWrap');
  const names = () => $$(sheet(), '.rmTable tbody th button').map(textOf);
  assert.ok(await until(app, () => names().length > 0), 'All settings is drawn');
  assert.equal(names().length, 12, 'the first 12 of 32');
  assert.match(textOf($(sheet(), '.rmCount')), /20 more below/);
  // the filters say how many each holds
  assert.deepEqual($$(sheet(), '.rmTools .cvPills button').map(textOf), ['All 32', 'Text 31', 'Yes or no 1', 'Secret 1']);
  await a.click(byText(sheet(), '.rmTools .cvPills button', /^Secret/));
  assert.deepEqual(names(), ['pin']);
  assert.match(textOf($(sheet(), '.rmTable tbody tr')), /kept secret/);
  await a.click(byText(sheet(), '.rmTools .cvPills button', /^All/));
  await a.type($(sheet(), '.rmFind input'), 'value_3');
  assert.deepEqual(names(), ['value 3', 'value 30']);
  await a.type($(sheet(), '.rmFind input'), 'verified');
  assert.match(textOf($(sheet(), '.rmTable tbody tr')), /Yes or no.*“false”/);
  // a detail opens beside the table; its kind and its start are written to the draft
  await a.click($(sheet(), '.rmTable tbody th button'));
  assert.equal(textOf($(sheet(), '.rmEdit h4')), 'verified');
  await a.click(byText($(sheet(), '.rmEdit'), '[aria-label="Starts as"] button', /^From the channel$/));
  assert.deepEqual(app.config.state.variables.verified.source, { channel: 'id' });
  assert.equal(app.config.state.variables.verified.default, null);
  await a.click(byText($(sheet(), '.rmEdit'), '[aria-label="Kind"] button', /^Text$/));
  assert.equal(app.config.state.variables.verified.type, 'string');
  await a.click($(sheet(), '.rmEdit [role="switch"]'));
  assert.equal(app.config.state.variables.verified.sensitive, true);
  // a new one: named as people write it, kept under a key the config can use
  await a.click($(sheet(), '.rmClose'));
  await a.type($(sheet(), '.rmNew input'), 'Preferred branch');
  await a.click(byText($(sheet(), '.rmNew'), 'button', /^One of a list$/));
  await a.click(byText($(sheet(), '.rmNew'), 'button', /Add it/));
  assert.deepEqual(app.config.state.variables.preferred_branch, { type: 'enum', nullable: true, default: null, values: [] });
  assert.equal(textOf($(sheet(), '.rmEdit h4')), 'preferred branch', 'the new one opens');
  await agentView(app, 'The call');
  await app.unmount();
});

test('Conversation as a call you can see: the sentence opens its editors, and the drawing lights the moment', async () => {
  const config = agent();
  config.channels = [{ id: 'web-voice', type: 'web_voice', enabled: true }];
  config.defaults.conversation = {
    inactivity: {
      enabled: true,
      timeout_s: 150,
      max_nudges: 2,
      nudges: [{ type: 'say', text: 'Still there?' }],
      on_exhausted: { do: [{ type: 'end_call', say: 'Goodbye.' }] },
    },
  };
  const app = await mount('conversation', config);
  await agentView(app, 'The call');
  assert.ok(await until(app, () => !!$(app.container, '.cvHero')), 'the overview');
  assert.match(
    said($(app.container, '.cvSentence')),
    /waits the usual pause after a caller stops, and callers can cut in\. If someone goes quiet, it checks in twice, 2½ minutes apart, then says goodbye and ends the call\./,
  );
  assert.ok($(app.container, '.cdScore svg[role="img"]'), 'the drawn call, with words for a screen reader');
  // how long it waits: Quick fills in both limits, and its moment lights up
  await a.click($$(app.container, '.cvSentence .apTok')[0]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop .cvChoices')), 'the waiting choices open in place');
  assert.ok($(app.container, '.cdHi'), 'the moment it shapes is lit');
  await a.click(byText(document.body, '.apPop button', /Quick/));
  assert.deepEqual(
    [app.config.defaults.conversation.turn_handling.endpointing.min_delay, app.config.defaults.conversation.turn_handling.endpointing.max_delay],
    [0.3, 1.5],
  );
  assert.match(said($(app.container, '.cvSentence')), /waits a quick beat/, 'the sentence follows');
  await a.click(byText(document.body, '.apPop button', 'Done'));
  // the script: a check-in more, said in its own words
  const quiet = $$(app.container, '.apLine').find((l) => /Quiet callers/.test(textOf(l)));
  await a.click(byText(quiet, 'button', /Open the script/));
  assert.ok(await until(app, () => !!$(document.body, '.apPop .cvScript')), 'the script opens');
  await a.click(byText(document.body, '.apPop button', 'Add a check-in'));
  assert.equal(app.config.defaults.conversation.inactivity.max_nudges, 3);
  assert.equal(app.config.defaults.conversation.inactivity.nudges.length, 3, 'with a line of its own');
  assert.match(said($(app.container, '.cvSentence')), /checks in 3 times/);
  await a.click(byText(document.body, '.apPop button', 'Done'));
  // All settings: every setting
  await agentView(app, 'All settings');
  assert.ok(await until(app, () => $$(app.container, '.dtPart [data-field]').length >= 25), 'every setting');
  await agentView(app, 'The call');
  await app.unmount();
});

test('Conversation for an agent that only chats: the same page as every agent, and it says which parts wait for voice', async () => {
  const config = agent();
  config.channels = [{ id: 'web-chat', type: 'web_chat', enabled: true }];
  config.defaults.conversation = {
    inactivity: { enabled: true, timeout_s: 600, max_nudges: 1, nudges: [{ type: 'say', text: 'Still there?' }], on_exhausted: { do: [{ type: 'end_call' }] } },
  };
  const app = await mount('conversation', config);
  await agentView(app, 'The call');
  assert.ok(await until(app, () => !!$(app.container, '.cdScore')), 'the drawn call, as on every agent');
  assert.match(
    said($(app.container, '.cvSentence')),
    /waits the usual pause after a caller stops, and callers can cut in\. If someone goes quiet, it checks in once, after 10 minutes, then says goodbye and closes the chat\./,
  );
  assert.equal($$(app.container, '.apLine').filter((l) => /Waiting|Cutting in|Says it like/.test(textOf(l))).length, 3, 'the same lines as every agent');
  assert.match(textOf($(app.container, '.cvHero .apHint')), /take effect once a voice channel is on/, 'and which wait for voice');
  await app.unmount();
});

test('Conversation’s overview gives every one of its settings exactly one place', () => {
  const rows = DETAILED_PARTS.conversation.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  const placed = placedIds();
  assert.deepEqual([...placed].sort(), [...rows].sort(), 'each row once, none left out, none made up');
  assert.equal(new Set(placed).size, placed.length, 'no row twice');
});

test('Conversation for a brand-new agent: the whole sentence, with blanks to click and fill in', async () => {
  const config = minimalConfig('fresh', 'Fresh');
  config.channels = [{ id: 'web-chat', type: 'web_chat', enabled: true }];
  delete config.defaults?.conversation?.inactivity;
  const app = await mount('conversation', config);
  await agentView(app, 'The call');
  assert.ok(await until(app, () => !!$(app.container, '.cvHero')), 'the overview');
  assert.match(said($(app.container, '.cvSentence')), /If someone goes quiet, it checks in how often, how far apart, then what happens\./);
  const blanks = $$(app.container, '.cvSentence .apTok.blank.optional');
  assert.equal(blanks.length, 3, 'three blanks, as Agent shows its own');
  assert.match(textOf($(app.container, '.cvHero .apHint')), /Click any part to change it/);
  // a blank opens the script, ready to fill in: typing a wait switches check-ins on
  await a.click(blanks[1]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop .cvSteps')), 'the script, to fill in');
  await a.type($(document.body, '.apPop .cvInline input'), '90');
  assert.deepEqual([app.config.defaults.conversation.inactivity.enabled, app.config.defaults.conversation.inactivity.timeout_s], [true, 90]);
  await a.click(byText(document.body, '.apPop button', 'Add a check-in'));
  assert.match(said($(app.container, '.cvSentence')), /checks in once, after 1½ minutes, then what happens/);
  await a.click(byText(document.body, '.apPop button', 'Says goodbye and closes the chat'));
  assert.match(said($(app.container, '.cvSentence')), /then says goodbye and closes the chat\./);
  await app.unmount();
});

test('Conversation for a brand-new agent: “Start with the usual” fills in the whole script', async () => {
  const config = minimalConfig('fresh', 'Fresh');
  config.channels = [{ id: 'web-chat', type: 'web_chat', enabled: true }];
  delete config.defaults?.conversation?.inactivity;
  const app = await mount('conversation', config);
  await agentView(app, 'The call');
  await a.click($(app.container, '.cvSentence .apTok.blank'));
  assert.ok(await until(app, () => !!$(document.body, '.apPop .cvSetup')), 'the shortcut is offered');
  await a.click(byText(document.body, '.apPop button', 'Start with the usual'));
  const quiet = app.config.defaults.conversation.inactivity;
  assert.deepEqual([quiet.enabled, quiet.timeout_s, quiet.max_nudges, quiet.nudges.length], [true, 120, 2, 2]);
  assert.match(said($(app.container, '.cvSentence')), /checks in twice, 2 minutes apart, then says goodbye and closes the chat/);
  assert.equal($(document.body, '.apPop .cvSetup'), null, 'the shortcut goes once it is set up');
  await app.unmount();
});

test('Agent for an agent that only chats: the same profile as every agent, its voice a blank it may leave', async () => {
  const config = agent();
  config.channels = [{ id: 'web-chat', type: 'web_chat', enabled: true }];
  delete config.defaults.models.tts;
  const app = await mount('agent', config);
  await agentView(app, 'Profile');
  assert.ok(await until(app, () => !!$(app.container, '.apHero')), 'the profile');
  assert.match(said($(app.container, '.apSentence')), /speaks .+ in a voice, and thinks with/);
  assert.ok($(app.container, '.apSentence .apTok.blank.optional'), 'its voice: a grey blank');
  assert.match(textOf($(app.container, '.apHero .apHint')), /take effect once a voice channel is on/);
  const lines = $$(app.container, '.apLine .apLineLabel').map((l) => textOf(l));
  assert.ok(lines.includes('Voice') && lines.some((l) => /Hears and speaks/.test(l)), 'the same lines as every agent');
  // who it is: its two names; the rest is under the brief's "more"
  await a.click($$(app.container, '.apSentence .apTok')[0]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop #dt-agent-persona')), 'who it is opens');
  assert.equal($$(document.body, '.apPop [data-field]').length, 2, 'introduces itself as, and its name in the list');
  await a.click(byText(document.body, '.apPop button', 'Done'));
  assert.match(textOf($(app.container, '.apMoreNames')), /Description.*Tags.*Owner/);
  await app.unmount();
});

test('Agent: what it thinks with opens as its list alone, the choice shown once (ticked)', async () => {
  const app = await mount('agent');
  await agentView(app, 'Profile');
  assert.ok(await until(app, () => !!$(app.container, '.apHero')), 'the profile');
  const model = $$(app.container, '.apSentence .apTok').at(-1);
  await a.click(model);
  assert.ok(await until(app, () => !!$(document.body, '.apPop .pkPicker.bare .pkModelList')), 'the list, at once');
  assert.equal($(document.body, '.apPop .dtPickBtn'), null, 'no select-like button above it');
  assert.equal($(document.body, '.apPop .pkChosen'), null, 'no card repeating the choice');
  assert.equal($$(document.body, '.apPop .pkModelList li.on').length, 1, 'the choice, ticked in the list');
  await a.click(byText(document.body, '.apPop button', 'Done'));
  await app.unmount();
});

test('Knowledge for a new agent: the whole sentence with blanks, an empty shelf, and how it searches chosen before there is a base', async () => {
  const config = agent();
  delete config.knowledge;
  const app = await mount('knowledge', config);
  await agentView(app, 'What it knows');
  assert.ok(await until(app, () => !!$(app.container, '.kwHero')), 'what it knows');
  assert.match(said($(app.container, '.kwSentence')), /answers from documents and web pages, searched on every caller turn for the 4 best passages\./);
  assert.equal($$(app.container, '.kwSentence .apTok.blank.optional').length, 2, 'documents and web pages: grey blanks');
  assert.ok($(app.container, '.kwShelf.empty'), 'an empty shelf, saying it answers from its brief');
  const searchLines = $$(app.container, '[aria-labelledby="kw-search"] .apLine');
  assert.deepEqual(
    searchLines.filter((l) => $(l, '.apChange')).map((l) => textOf($(l, '.apLineLabel'))),
    ['When it searches', 'How many passages'],
    'when and how many can be chosen already; the rest wait for something to read',
  );
  // chosen before there is a base: held, and said so
  await a.click(byText(app.container, '.kwSentence .apTok', /on every caller turn/));
  assert.ok(await until(app, () => !!$(document.body, '.apPop .kwModes')), 'its choice opens');
  await a.click($$(document.body, '.apPop .kwMode')[1]);
  assert.match(textOf($(document.body, '.apPop .kwHeldNote')), /saved with the first document or web page/);
  assert.match(said($(app.container, '.kwSentence')), /searched when it decides it needs to/);
  assert.equal(app.config.knowledge, undefined, 'nothing written yet: a base needs something to read');
  await a.click(byText(document.body, '.apPop button', 'Done'));
  // a web page, added from its blank, makes the base: the choice is written into it, and everything can be changed
  await a.click($$(app.container, '.kwSentence .apTok')[1]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop #dt-knowledge-page')), 'the web page editor opens');
  await a.type($(document.body, '.apPop #dt-knowledge-page'), 'www.example.com/help');
  await a.click(byText(document.body, '.apPop button', 'Add'));
  assert.equal(app.config.knowledge[0].sources[0].url, 'https://www.example.com/help');
  assert.ok(await until(app, () => app.config.knowledge[0].mode === 'tool'), 'the held choice is written into the new base');
  await a.click(byText(document.body, '.apPop button', 'Done'));
  assert.match(said($(app.container, '.kwSentence')), /answers from documents and 1 web page, searched when it decides it needs to/);
  assert.ok(await until(app, () => !!$(app.container, '[data-field="knowledge.index"]')), 'the shelf now holds the index');
  await app.unmount();
});

test('Knowledge: when it searches, as two ways; choosing “when it decides” gives its readers a search tool', async () => {
  const config = agent();
  config.knowledge = [{ id: 'knowledge', type: 'vector_store', mode: 'inject', sources: [{ type: 'file', file_id: 'faq.md' }] }];
  config.agents.items[0].knowledge = ['knowledge'];
  const app = await mount('knowledge', config);
  await agentView(app, 'What it knows');
  assert.ok(await until(app, () => !!$(app.container, '.kwHero')), 'what it knows');
  await a.click($$(app.container, '.kwSentence .apTok')[2]);
  assert.ok(await until(app, () => !!$(document.body, '.apPop .kwModes')), 'the two ways open in place');
  await a.click(byText(document.body, '.apPop .kwMode', /When it decides/));
  assert.equal(app.config.knowledge[0].mode, 'tool');
  const tool = app.config.tools.find((t) => t.type === 'knowledge' && t.source === 'knowledge');
  assert.ok(tool && app.config.agents.items[0].tools.includes(tool.id), 'its reader searches through a tool now');
  assert.match(said($(app.container, '.kwSentence')), /searched when it decides it needs to/);
  await a.click(byText(document.body, '.apPop button', 'Done'));
  // how close a match: off by default (every match), on gives the line
  const close = $$(app.container, '.apLine').find((l) => /How close a match/.test(textOf(l)));
  await a.click(byText(close, 'button', /Change/));
  assert.ok(await until(app, () => !!$(app.container, '.apLine.open .kwMatch')), 'the scale opens under its line');
  await a.click($(app.container, '.apLine.open .kwMatch [role="switch"]'));
  assert.equal(app.config.knowledge[0].retrieval.min_score, 0.4, 'a line at 0.40');
  await agentView(app, 'All settings');
  assert.ok(await until(app, () => $$(app.container, '.dtPart [data-field^="knowledge."]').length >= 15), 'every setting');
  await agentView(app, 'What it knows');
  await app.unmount();
});

test('Knowledge’s workspace gives every one of its settings exactly one place', () => {
  const rows = DETAILED_PARTS.knowledge.cols.flat().flatMap((card) => [...(card.rows || []), ...(card.adv || [])].map((row) => `${card.id}.${row.id}`));
  const placed = knowledgePlaced();
  assert.deepEqual([...placed].sort(), [...rows].sort(), 'each row once, none left out, none made up');
  assert.equal(new Set(placed).size, placed.length, 'no row twice');
});

// ---- every Build setting drives the agent (2026-11-07 review): what a row shows and writes is what the agent uses
test('a tool is offered only the settings its kind has: a task has no inputs for the model, a knowledge search its own number', async () => {
  const config = agent();
  config.knowledge = [{ id: 'kb', type: 'vector_store', sources: [] }];
  config.tools = [
    { id: 'verify', type: 'task', task: 'verify', description: 'Checks who it is.' },
    { id: 'search_kb', type: 'knowledge', source: 'kb', top_k: 7 },
    ...config.tools,
  ];
  const app = await mount('tools', config);
  await agentView(app, 'All settings');
  const card = () => $(app.container, '[data-card="tools.tool"]');
  const pickTool = (re) => a.click($$(app.container, '[data-card="tools.mine"] button').find((b) => re.test(textOf(b))));
  await pickTool(/verify/i);
  assert.match(textOf(card()), /When it uses it/);
  assert.doesNotMatch(textOf(card()), /What the model fills in/, 'a task has no inputs the model fills in');
  await pickTool(/search/i);
  assert.equal($(app.container, '#dt-tools-kTopK').value, '7', 'a knowledge search shows its own number');
  await app.unmount();
});

test('with a speech-to-speech model, its own voice is chosen, and the speaking voice says it isn’t used', async () => {
  const config = agent();
  config.defaults.models.realtime = { provider: 'openai', model: 'gpt-realtime' };
  const app = await mount('agent', config);
  await agentView(app, 'All settings');
  assert.match(textOf($(app.container, '[data-card="agent.voice"]')), /Not used while a speech-to-speech model speaks/);
  await a.choose($(app.container, '#dt-agent-realtimeVoice'), 'coral');
  assert.equal(app.config.defaults.models.realtime.voice, 'coral');
  await app.unmount();
});

test('a channel’s greeting field says when other channels share the line, and the quiet-caller switch reads as its script does', async () => {
  const config = agent();
  config.channels = [
    { id: 'chat', type: 'web_chat', enabled: true, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hi there' } },
    { id: 'talk', type: 'web_voice', enabled: true, modalities: { input: ['audio', 'text'], output: ['audio', 'text'] }, greeting: { say: 'Hi there' } },
  ];
  config.defaults.conversation = { inactivity: { timeout_s: 30, max_nudges: 1, nudges: [{ type: 'say', text: 'Still there?' }] } };
  const app = await mount('channels', config);
  await agentView(app, 'All settings');
  assert.match(textOf($(app.container, '[data-card="channels.channel"]')), /2 channels say this line, so it changes on all of them/);
  await app.unmount();
  const conv = await mount('conversation', config);
  await agentView(conv, 'All settings');
  const sw = $(conv.container, '#dt-conversation-nudge');
  assert.ok(sw, 'the switch');
  assert.equal(sw.getAttribute('aria-checked') === 'true' || sw.checked === true, true, 'a script with no “enabled” counts as on, as its sentence says');
  await conv.unmount();
});
