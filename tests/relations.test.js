import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { buildAgentMap, describeEdges, NODE } from '../src/studio/relations/agentMap.js';
import { buildToolGrid, setToolOffered } from '../src/studio/relations/toolGrid.js';
import { describeWeek, exceptions, minutesOf, openAt, weekWindows } from '../src/studio/relations/scheduleStrip.js';
import { describeTask } from '../src/studio/relations/taskSteps.js';
import { usedBy } from '../src/studio/relations/usedBy.js';

// The pictures of how an agent's parts relate: who hands the caller to whom, who has which tool, when the line is open, what a task does step by step,
// and where each tool, line and value is used. Each is a pure model first; the screens draw it.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const example = { ...JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8')), schema_version: '1.2' };

// ---------------------------------------------------------------- agent map
test('the agents of the example are boxes in columns by distance from the one that answers first, with their hand-overs as arrows', () => {
  const map = buildAgentMap(example);
  assert.equal(map.entry, example.agents.entry);
  assert.equal(map.nodes.length, example.agents.items.length);
  const first = map.nodes.find((n) => n.entry);
  assert.equal(first.column, 0);
  assert.equal(first.x, NODE.pad);
  assert.ok(map.edges.length >= 3, 'hand-overs are drawn');
  map.edges.filter((e) => e.kind === 'handoff').forEach((e) => {
    const from = map.nodes.find((n) => n.id === e.from); const to = map.nodes.find((n) => n.id === e.to);
    assert.ok(from && to);
  });
  assert.ok(map.width > 0 && map.height > 0);
  // a node never overlaps another
  const boxes = map.nodes.map((n) => `${n.x},${n.y}`);
  assert.equal(new Set(boxes).size, boxes.length);
});

test('an agent nothing can reach is shown, in a column of its own, and said to be unreachable', () => {
  const config = { agents: { entry: 'a', items: [{ id: 'a', handoffs: [{ id: 'to_b', to: 'b' }] }, { id: 'b' }, { id: 'lonely' }] } };
  const map = buildAgentMap(config);
  assert.deepEqual(map.unreachable, ['lonely']);
  assert.equal(map.nodes.find((n) => n.id === 'lonely').reachable, false);
  assert.equal(map.nodes.find((n) => n.id === 'lonely').column, 2);
  assert.equal(map.nodes.find((n) => n.id === 'b').column, 1);
  assert.deepEqual(describeEdges(map), ['a hands the caller to b (to_b).']);
});

test('a tool whose rules hand over, and a safety rule that does, are drawn as their own kinds of arrow; a hand-over to nobody is not drawn', () => {
  const config = {
    agents: { entry: 'front', items: [{ id: 'front', name: 'Front desk', tools: ['escalate'], handoffs: [{ id: 'bad', to: 'ghost' }] }, { id: 'billing' }, { id: 'safety' }] },
    tools: [{ id: 'escalate', effects: [{ do: [{ type: 'say' }, { type: 'handoff', to: 'billing' }] }] }],
    guardrails: { escalation: [{ id: 'abuse', action: 'handoff', to: 'safety' }, { id: 'x', action: 'end_call' }] },
  };
  const map = buildAgentMap(config);
  assert.deepEqual(map.edges.map((e) => [e.kind, e.from, e.to]), [['tool', 'front', 'billing'], ['rule', 'front', 'safety']]);
  assert.deepEqual(describeEdges(map), ['Front desk can pass the caller to billing (escalate).', 'Front desk passes the caller, under a safety rule, to safety (abuse).']);
});

test('arrows between the same two agents are merged, and an empty or odd configuration doesn’t break the picture', () => {
  const config = { agents: { entry: 'a', items: [{ id: 'a', handoffs: [{ id: 'one', to: 'b' }, { id: 'two', to: 'b' }, { to: 'a' }] }, { id: 'b' }] } };
  const map = buildAgentMap(config);
  const merged = map.edges.find((e) => e.to === 'b');
  assert.deepEqual(merged.labels, ['one', 'two']);
  assert.equal(map.edges.find((e) => e.self).to, 'a');
  assert.deepEqual(buildAgentMap({}).nodes, []);
  assert.deepEqual(buildAgentMap(null).edges, []);
  assert.equal(buildAgentMap({ agents: { items: [{ id: 'only' }] } }).entry, 'only', 'with no entry named, the first agent answers first');
});

// ---------------------------------------------------------------- tool grid
test('the grid says who has each tool, which tools nobody has, and which are shared', () => {
  const grid = buildToolGrid(example);
  assert.equal(grid.rows.length, example.tools.length);
  assert.equal(grid.agents.length, example.agents.items.length);
  grid.rows.forEach((row) => assert.equal(row.cells.length, grid.agents.length));
  const expectedUnused = example.tools.filter((t) => !example.agents.items.some((a) => (a.tools || []).includes(t.id))).map((t) => t.id);
  assert.deepEqual(grid.unused, expectedUnused);
  const shared = example.tools.filter((t) => example.agents.items.filter((a) => (a.tools || []).includes(t.id)).length > 1).map((t) => t.id);
  assert.deepEqual(grid.shared, shared);
  grid.agents.forEach((a) => assert.equal(a.count, grid.rows.filter((r) => r.agents.includes(a.id)).length));
});

test('ticking a cell edits the agent’s own tools list and nothing else', () => {
  const config = { agents: { entry: 'a', items: [{ id: 'a', tools: ['x'] }, { id: 'b' }] }, tools: [{ id: 'x' }, { id: 'y' }] };
  const added = setToolOffered(config, 'a', 'y', true);
  assert.deepEqual(added.agents.items[0].tools, ['x', 'y']);
  assert.equal(setToolOffered(added, 'a', 'y', true), added, 'the same object when nothing changes');
  const removed = setToolOffered(added, 'a', 'x', false);
  assert.deepEqual(removed.agents.items[0].tools, ['y']);
  assert.equal('tools' in setToolOffered(removed, 'a', 'y', false).agents.items[0], false, 'an empty list is not left behind');
  assert.deepEqual(setToolOffered(config, 'b', 'x', true).agents.items[1].tools, ['x']);
  assert.deepEqual(config.agents.items[0].tools, ['x'], 'the original is not touched');
  assert.equal(setToolOffered(config, 'ghost', 'x', true), config);
});

// ---------------------------------------------------------------- schedule strip
test('a week is shown as open windows per day, in words and as bars', () => {
  const hours = example.schedules.support_hours;
  assert.equal(describeWeek(hours), 'Monday to Friday 08:00–20:00; Saturday 09:00–17:00.');
  const week = weekWindows(hours);
  assert.deepEqual(week.mon, [[480, 1200]]);
  assert.deepEqual(week.sun, []);
  assert.equal(openAt(hours, 'tue', 9 * 60), true);
  assert.equal(openAt(hours, 'tue', 20 * 60), false, 'the end is exclusive');
  assert.equal(openAt(hours, 'sun', 12 * 60), false);
  assert.equal(describeWeek({ weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '00:00', end: '24:00' }] }), 'Open all day, every day.');
  assert.equal(describeWeek({ weekly: [] }), 'Never open.');
  assert.deepEqual(weekWindows({ weekly: [{ days: ['mon'], start: '09:00', end: '12:00' }, { days: ['mon'], start: '11:00', end: '14:00' }, { days: ['mon'], start: '15:00', end: '16:00' }] }).mon, [[540, 840], [900, 960]], 'overlapping windows are merged');
  assert.equal(minutesOf('24:00'), 1440);
  assert.equal(minutesOf('25:00'), null);
  assert.equal(minutesOf('nope'), null);
});

test('holidays and one-off exceptions are listed in date order, a holiday winning over an exception', () => {
  assert.deepEqual(exceptions(example.schedules.support_hours), [{ date: '2026-12-24', text: 'Open 09:00–13:00' }, { date: '2026-12-25', text: 'Closed all day' }]);
  assert.deepEqual(exceptions({ holidays: ['2026-01-01'], overrides: { '2026-01-01': 'closed', '2026-01-02': 'closed' } }), [{ date: '2026-01-01', text: 'Closed all day' }, { date: '2026-01-02', text: 'Closed all day' }]);
});

// ---------------------------------------------------------------- task steps
test('a task reads top to bottom: what is asked, how it is checked, when it is skipped, and how it ends', () => {
  const task = describeTask(example.tasks[0]);
  assert.equal(task.summary, 'Checks who the caller is in 2 steps.');
  assert.deepEqual(task.steps.map((s) => [s.number, s.id]), [[1, 'account'], [2, 'surname']]);
  assert.deepEqual(task.steps[0].notes, ['skipped when “customer” is already known', 'checked by the tool “lookup_account”', 'up to 3 tries']);
  assert.equal(task.steps[1].ask, 'Ask for the surname on the account.');
  assert.deepEqual(task.outcomes.map((o) => [o.label, o.text]), [
    ['When it works', 'remembers verified = true, goes back to the agent that started it, says nothing'],
    ['If it fails', 'result “failed”, goes back to the agent that started it'],
    ['If the caller declines', 'result “declined”, goes back to the agent that started it'],
  ]);
  assert.deepEqual(describeTask(null), { summary: '', steps: [], outcomes: [] });
});

// ---------------------------------------------------------------- used by
test('what uses a tool, a fixed line, a remembered value or a connection is found, one entry per place, each with a path to jump to', () => {
  const tool = example.agents.items.flatMap((a) => a.tools || [])[0];
  const uses = usedBy(engine, example, 'tools', tool);
  assert.ok(uses.length >= 1);
  assert.ok(uses.every((u) => /^agent “[a-z_]+”$/.test(u.place) || u.place.length > 0));
  assert.ok(Array.isArray(uses[0].path));
  const conn = usedBy(engine, example, 'connections', 'billing_api');
  assert.ok(conn.some((u) => /tool/.test(u.place)), 'a connection says which tools call it');
  const variable = usedBy(engine, example, 'state_vars', 'verified');
  assert.ok(variable.length >= 1, 'a remembered value is found in rules and text');
  assert.deepEqual(usedBy(engine, example, 'tools', 'nobody_has_this'), []);
  assert.deepEqual(usedBy(engine, null, 'tools', 'x'), []);
});

test('the same configuration is walked once for all the cards, not once per card', () => {
  const config = JSON.parse(JSON.stringify(example));
  const before = performance.now();
  for (let i = 0; i < 200; i += 1) usedBy(engine, config, 'tools', example.tools[i % example.tools.length].id);
  const each = (performance.now() - before) / 200;
  assert.ok(each < 1, `a lookup on an unchanged configuration is quick (${each.toFixed(3)} ms)`);
});
