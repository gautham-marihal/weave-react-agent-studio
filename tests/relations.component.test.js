import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';

// The relationship views and the plain-language problems, drawn: the agent map, the tool grid, the schedule strip, the task steps, "used by", the
// fix buttons beside a field, and the checks panel that groups what is wrong by what to do about it.
const { mountForm, mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const example = { ...JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8')), schema_version: '1.2' };
const clone = (v) => JSON.parse(JSON.stringify(v));

test('the agent map shows every agent, marks the one that answers first, and opens an agent when its box is pressed', async () => {
  const app = await mountForm(clone(example));
  await a.section(app.container, 'agents');
  const map = $(app.container, '.rlMap');
  assert.ok(map, 'the map is drawn above the agents');
  const nodes = $$(map, '.rlNode');
  assert.equal(nodes.length, example.agents.items.length);
  assert.equal($$(map, '.rlNode.entry').length, 1);
  assert.match($(map, '.rlNode.entry').getAttribute('aria-label'), /answers first/);
  assert.ok($$(map, '.rlEdge').length >= 3, 'hand-overs are arrows');
  assert.match(textOf($(map, '.rlList')), /hands the caller to/, 'the same information as sentences');
  const target = nodes.find((n) => /billing/i.test(n.getAttribute('aria-label')));
  await a.click(target);
  await app.wait(400);
  assert.ok($$(app.container, '.stFFlash').length > 0 || $(app.container, '[data-path^="agents.items[1]"]'), 'the agent’s card is where focus went');
  await app.unmount();
});

test('the map is not drawn for a single agent, and a stranded agent is called out', async () => {
  const one = clone(example);
  one.agents.items = [one.agents.items[0]];
  one.agents.entry = one.agents.items[0].id;
  const app = await mountForm(one);
  await a.section(app.container, 'agents');
  assert.equal($(app.container, '.rlMap'), null);
  await app.unmount();
  const stranded = clone(example);
  stranded.agents.items.push({ id: 'lonely', name: 'Lonely', kind: 'specialist', instructions: { role: 'Wait.' } });
  const app2 = await mountForm(stranded);
  await a.section(app2.container, 'agents');
  assert.match(textOf($(app2.container, '.rlMap .stFWarn')), /“lonely” can’t be reached/);
  assert.ok($(app2.container, '.rlNode.stranded'));
  await app2.unmount();
});

test('the tool grid ticks edit the agent’s own tools, can be undone, and say which tools nobody has', async () => {
  const config = clone(example);
  const app = await mountForm(config);
  await a.section(app.container, 'tools');
  const grid = $(app.container, '.rlGrid');
  assert.ok(grid);
  grid.open = true;
  const agent = config.agents.items[0];
  const unused = config.tools.find((t) => !config.agents.items.some((x) => (x.tools || []).includes(t.id)));
  assert.ok(unused, 'the example has a tool nobody offers');
  const box = byLabel(grid, `${agent.name} can use ${unused.id}`);
  assert.equal(box.checked, false);
  assert.match(textOf($(grid, 'summary')), /nobody has/);
  await a.check(box);
  assert.ok(app.config.agents.items[0].tools.includes(unused.id), 'the agent now offers it');
  assert.match(textOf($(app.container, '.stFToast')), new RegExp(`Gave “${unused.id}” to the agent “${agent.id}”`));
  await a.click(byText($(app.container, '.stFToast'), 'button', 'Undo'));
  assert.equal((app.config.agents.items[0].tools || []).includes(unused.id), false, 'undone');
  await app.unmount();
});

test('a schedule is drawn as a week and a task as its steps, above the fields that edit them', async () => {
  const app = await mountForm(clone(example));
  await a.section(app.container, 'schedules');
  const strip = $(app.container, '.rlStrip');
  assert.ok(strip);
  assert.match(textOf($(strip, 'figcaption')), /Monday to Friday 08:00–20:00; Saturday 09:00–17:00\./);
  assert.equal($$(strip, '.rlStripRow').length, 7);
  assert.match(textOf($(strip, '.rlStripSpecial')), /2026-12-24 Open 09:00–13:00/);
  await a.section(app.container, 'tasks');
  const steps = $(app.container, '.rlSteps');
  assert.ok(steps);
  assert.match(textOf(steps), /Checks who the caller is in 2 steps/);
  assert.match(textOf(steps), /checked by the tool “lookup_account”/);
  await app.unmount();
});

test('every tool says what uses it, as buttons that go there, and what nothing uses', async () => {
  const config = clone(example);
  config.tools.push({ id: 'spare', type: 'builtin', builtin: 'noop', description: 'Nothing uses this.' });
  const app = await mountForm(config);
  await a.section(app.container, 'tools');
  for (const toggle of $$(app.container, '.stFGroupToggle[aria-expanded=false]')) await a.click(toggle);
  const used = $$(app.container, '.rlUsed').filter((el) => !el.classList.contains('none'));
  const unusedNote = $$(app.container, '.rlUsed.none');
  assert.ok(used.length > 0 && unusedNote.length > 0, 'both are drawn');
  assert.ok($$(used[0], '.rlChip').length > 0);
  assert.match(textOf(unusedNote[0]), /Nothing uses this yet/);
  await app.unmount();
});

test('a problem beside a field is said in plain words with a button that fixes it', async () => {
  const config = clone(example);
  config.agents.entry = 'greter';
  const report = {
    valid: false,
    errors: [{ path: ['agents', 'entry'], message: "'greter' is not a declared agents id (declared: billing, greeter, safety_watch, tech_support)" }],
    warnings: [],
  };
  const app = await mountScreen('form', config, { report });
  await a.section(app.container, 'agents');
  const issue = $(app.container, '.stFIssue');
  assert.ok(issue);
  assert.match(textOf(issue), /There is no agent called “greter”\. Choose one that exists\./);
  assert.doesNotMatch(textOf(issue), /is not a declared/);
  await a.click(byText(issue, 'button', 'Use “greeter”'));
  assert.equal(app.config.agents.entry, 'greeter');
  assert.match(textOf($(app.container, '.stFToast')), /Use “greeter”\./);
  await app.unmount();
});

test('the checks panel names each problem by its labels, puts what a click fixes first, folds the advice, and applies a fix', async () => {
  const config = clone(example);
  config.tools.push({ id: 'spare', type: 'builtin', builtin: 'noop', description: 'x' });
  config.agents.entry = 'greter';
  const report = {
    valid: false,
    errors: [
      { path: ['agents', 'entry'], message: "'greter' is not a declared agents id (declared: billing, greeter, safety_watch, tech_support)" },
      { path: ['tools', 5, 'timeout_s'], message: '-1 is less than or equal to the minimum of 0' },
    ],
    warnings: [{ path: ['tools', config.tools.length - 1], message: "tool 'spare' is not used by any agent, task or guardrail" }],
    unsupported: [],
  };
  const jumps = [];
  const app = await mountScreen('validation', config, { report, ready: '.vxList', props: { onJump: (path) => jumps.push(path) } });
  const shown = app.container.cloneNode(true);
  $$(shown, '.vxRaw').forEach((el) => el.remove()); // the server's own sentence and path sit in a fold, for whoever wants them
  const text = textOf(shown);
  assert.match(text, /Fix these first/);
  assert.match(text, /Agents › Who answers first/, 'the place is named by labels');
  assert.doesNotMatch(text, /agents\.entry|agents\["entry"\]/, 'no raw path is shown');
  const heads = $$(app.container, '.vxList > section, .vxList > details').map(
    (s) => s.getAttribute('aria-label') || textOf($(s, 'summary')).replace(/\d+$/, '').trim(),
  );
  assert.deepEqual(heads, ['Can be fixed here', 'Needs your input', 'Worth a look']);
  assert.equal($(app.container, 'details.vxFold').open, false, 'the advice is folded while there are errors');
  await a.click(byText(app.container, 'button.vxFix', 'Use “greeter”'));
  assert.equal(app.config.agents.entry, 'greeter');
  await a.click(byText(app.container, 'button.stLink', 'Show me'));
  assert.ok(jumps.length >= 1);
  await app.unmount();
});
