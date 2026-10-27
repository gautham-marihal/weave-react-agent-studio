import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDGE, START_ID, buildWorkflow, describeWorkflow, enterId, parseNodeId, toolNodeId, triggerId } from '../src/studio/workflow/workflowModel.js';
import { routeEdge, sidesFor } from '../src/studio/workflow/geometry.js';
import * as ops from '../src/studio/workflow/workflowOps.js';
import { validateDemo } from '../src/demo/demoValidate.js';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { createEngine } from '../src/studio/form/engine.js';
import { corpus } from './corpus/corpus.js';

const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
const single = () => minimalConfig('solo', 'Solo');
const overlaps = (nodes) => {
  const out = [];
  nodes.forEach((a, i) =>
    nodes.slice(i + 1).forEach((b) => {
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) out.push(`${a.id} / ${b.id}`);
    }),
  );
  return out;
};
const errorsOf = (config) => validateDemo(config, 'solo').errors;

test('a single agent is drawn as its channels, the subagent and what it can do, each channel leading to it (with no channel, Start)', () => {
  const config = single();
  const flow = buildWorkflow(config);
  assert.equal(flow.nodes[0].type, 'trigger');
  const agents = flow.nodes.filter((n) => n.type === 'agent');
  assert.equal(agents.length, 1);
  assert.ok(agents[0].entry);
  assert.deepEqual(
    flow.edges.filter((e) => e.kind === 'start').map((e) => [e.from, e.to]),
    config.channels.map((c) => [triggerId(c.id), agents[0].id]),
  );
  assert.ok(
    flow.nodes.every((n) => n.type !== 'trigger' || n.x < agents[0].x),
    'left to right: where a call comes in, then who answers',
  );
  const none = buildWorkflow({ ...config, channels: [] });
  assert.deepEqual(
    none.edges.filter((e) => e.kind === 'start').map((e) => [e.from, e.to]),
    [[START_ID, agents[0].id]],
  );
  assert.equal(flow.empty, false);
  assert.equal(buildWorkflow({ agents: { entry: '', items: [] } }).empty, true);
});

test('the example agent: every hand-over, tool and safety rule that moves a caller is an arrow, and what an agent can do are blocks', () => {
  const flow = buildWorkflow(example());
  const agentIds = flow.nodes.filter((n) => n.type === 'agent').map((n) => n.id);
  assert.deepEqual(agentIds, ['greeter', 'billing', 'tech_support', 'safety_watch']);
  const handoffs = flow.edges.filter((e) => e.kind === 'handoff');
  assert.deepEqual(
    handoffs.map((e) => [e.from, e.to, e.ref.handoff]),
    [
      ['greeter', 'billing', 0],
      ['greeter', 'tech_support', 1],
    ],
  );
  assert.ok(handoffs[0].full.startsWith('The caller asks about a bill'), 'the arrow carries when it is taken');
  assert.ok(
    flow.edges.some((e) => e.kind === 'return' && e.from === 'billing' && e.to === 'greeter'),
    '"back to menu" is an arrow back to the first agent',
  );
  assert.ok(
    flow.nodes.some((n) => n.type === 'end' && n.agent === 'greeter'),
    'the end_call tool is an End block',
  );
  assert.ok(
    flow.nodes.some((n) => n.type === 'transfer' && n.agent === 'billing'),
    'a transfer_or_callback tool is a phone transfer block',
  );
  assert.ok(flow.nodes.some((n) => n.type === 'tool' && n.id === toolNodeId('billing', 'get_bill_summary')));
  const hidden = buildWorkflow(example(), { tools: false });
  assert.equal(hidden.nodes.filter((n) => n.type === 'tool').length, 0, 'tools can be left out');
  assert.equal(hidden.toolBlocks, flow.nodes.filter((n) => n.type === 'tool').length, 'and are still counted');
  assert.ok(describeWorkflow(flow).some((s) => /^Front Door hands the caller to Billing/.test(s)));
});

test('what an agent does as it takes over (on_enter) is drawn before it; a hand-over or a return there is an arrow instead', () => {
  const config = single();
  const id = config.agents.items[0].id;
  config.agents.items[0].on_enter = [
    { type: 'say', text: 'Hello there' },
    { type: 'set_state', values: { a: 1 } },
    { type: 'send_form', form: 'callback' },
    { type: 'return_to_entry' },
  ];
  const flow = buildWorkflow(config);
  const enters = flow.nodes.filter((n) => n.role === 'enter');
  assert.deepEqual(
    enters.map((n) => [n.id, n.type, n.sub]),
    [
      [enterId(id, 0), 'say', 'Hello there'],
      [enterId(id, 1), 'state', 'a = 1'],
      [enterId(id, 2), 'step', 'callback'],
    ],
  );
  assert.ok(
    flow.edges.some((e) => e.kind === 'enter' && e.from === enterId(id, 0) && e.to === id),
    'each runs into the agent',
  );
});

test('the default layout never puts one block on top of another, with or without tools', () => {
  [example(), single()].forEach((config) =>
    [true, false].forEach((tools) => {
      const stripped = JSON.parse(JSON.stringify(config));
      delete stripped.builder;
      assert.deepEqual(overlaps(buildWorkflow(stripped, { tools }).nodes), []);
    }),
  );
});

test('a place saved for a block is kept; the blocks that go with an agent follow it unless they have a place of their own; nothing ends up covered', () => {
  const config = example();
  const base = buildWorkflow(config);
  const billing = base.nodes.find((n) => n.id === 'billing');
  assert.deepEqual([billing.x, billing.y], [380, 60], 'the saved place is used');
  assert.ok(billing.moved);

  const c = single();
  const id = c.agents.items[0].id;
  c.agents.items[0].on_enter = [{ type: 'say', text: 'Hi' }];
  const before = buildWorkflow(c);
  const moved = buildWorkflow(ops.setPositions(c, { [id]: { x: 700, y: 500 } }));
  const dx = moved.nodes.find((n) => n.id === id).x - before.nodes.find((n) => n.id === id).x;
  assert.equal(moved.nodes.find((n) => n.id === enterId(id, 0)).x - before.nodes.find((n) => n.id === enterId(id, 0)).x, dx, 'the step follows the agent');
  const own = buildWorkflow(ops.setPositions(ops.setPositions(c, { [id]: { x: 700, y: 500 } }), { [enterId(id, 0)]: { x: 50, y: 50 } }));
  assert.deepEqual(
    [own.nodes.find((n) => n.id === enterId(id, 0)).x, own.nodes.find((n) => n.id === enterId(id, 0)).y],
    [50, 50],
    'a block with its own place stays there',
  );
  assert.deepEqual(overlaps(buildWorkflow(config).nodes.filter((n) => !n.moved)), [], 'blocks placed automatically never cover each other');
  assert.equal(base.crowded, true, 'a saved layout with no room for the blocks that go with the agents is reported');
});

test('node ids say what they are', () => {
  assert.deepEqual(parseNodeId(START_ID), { kind: 'start' });
  assert.deepEqual(parseNodeId('start'), { kind: 'agent', agent: 'start' }, 'an agent may be called "start"');
  assert.deepEqual(parseNodeId('billing'), { kind: 'agent', agent: 'billing' });
  assert.deepEqual(parseNodeId('a::enter::2'), { agent: 'a', kind: 'enter', index: 2 });
  assert.deepEqual(parseNodeId('a::tool::end_call'), { agent: 'a', kind: 'tool', tool: 'end_call' });
});

test('arrows leave the sides that face each other and the curve ends on the block', () => {
  const a = { id: 'a', x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(sidesFor(a, { id: 'b', x: 0, y: 200, w: 100, h: 50 }), ['bottom', 'top']);
  assert.deepEqual(sidesFor(a, { id: 'b', x: 300, y: 10, w: 100, h: 50 }), ['right', 'left']);
  assert.deepEqual(sidesFor({ ...a, y: 300 }, { id: 'b', x: 0, y: 0, w: 100, h: 50 }), ['top', 'bottom']);
  const g = routeEdge(a, { id: 'b', x: 0, y: 200, w: 100, h: 50 });
  assert.match(g.d, /^M 50 50 C .* 50 200$/);
  assert.ok(g.ly > 50 && g.ly < 200, 'the label sits between the blocks');
  const l0 = routeEdge(a, { id: 'b', x: 0, y: 200, w: 100, h: 50 }, { lane: 0, lanes: 2 });
  const l1 = routeEdge(a, { id: 'b', x: 0, y: 200, w: 100, h: 50 }, { lane: 1, lanes: 2 });
  assert.ok(l1.ly - l0.ly >= 24, 'and so are their words');
  assert.notEqual(
    routeEdge(a, { id: 'b', x: 0, y: 200, w: 100, h: 50 }, { lane: 0, lanes: 2 }).d,
    routeEdge(a, { id: 'b', x: 0, y: 200, w: 100, h: 50 }, { lane: 1, lanes: 2 }).d,
    'arrows between the same two blocks do not lie on one another',
  );
});

// every point of a route's path, sampled from its "d" (cubic pieces), for testing it against a block
const sampled = (d) => {
  const nums = d.match(/-?[0-9.]+/g).map(Number);
  const pts = [];
  let [x, y] = nums.slice(0, 2);
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [c1x, c1y, c2x, c2y, ex, ey] = nums.slice(i, i + 6);
    for (let s = 0; s <= 20; s += 1) {
      const t = s / 20;
      const u = 1 - t;
      pts.push([u ** 3 * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex, u ** 3 * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey]);
    }
    [x, y] = [ex, ey];
  }
  return pts;
};
const through = (d, r) => sampled(d).some(([x, y]) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);

test('an arrow goes around a block in its way, not behind it, and is left as it was when nothing is in the way', () => {
  const a = { id: 'a', x: 0, y: 0, w: 200, h: 80 };
  const b = { id: 'b', x: 400, y: 300, w: 200, h: 80 };
  const plain = routeEdge(a, b);
  // a block across the usual curve
  const wall = { id: 'w', x: 220, y: 120, w: 200, h: 80 };
  assert.ok(through(plain.d, wall), 'the usual curve would run through it');
  const around = routeEdge(a, b, { obstacles: [a, b, wall] });
  assert.ok(!through(around.d, wall), around.d);
  // with nothing in the way the route is the usual one, and the arrow's own ends never count as in its way
  assert.equal(routeEdge(a, b, { obstacles: [a, b, { id: 'far', x: 900, y: 900, w: 50, h: 50 }] }).d, plain.d);
  // boxed in on the way down, it bends round the side of the block
  const shelf = { id: 's', x: -40, y: 150, w: 700, h: 60 };
  const bent = routeEdge(a, b, { obstacles: [a, b, shelf] });
  assert.ok(!through(bent.d, shelf), bent.d);
  // the words sit on the route that is drawn
  assert.ok(Number.isFinite(around.lx) && Number.isFinite(around.ly));
});

// ---- editing
test('Subagent: a real agent with a hand-over from the one it was added to; the first agent stops being "standalone"; nothing else changes', () => {
  const config = single();
  const from = config.agents.items[0].id;
  const { config: next, id } = ops.addSubagent(config, from);
  assert.equal(config.agents.items.length, 1, 'the original is untouched');
  const agent = next.agents.items.find((a) => a.id === id);
  assert.deepEqual(Object.keys(agent).sort(), ['id', 'instructions', 'kind', 'name', 'tools']);
  assert.equal(agent.kind, 'specialist');
  assert.match(agent.instructions.role, /Describe what this agent does/);
  const handoff = next.agents.items[0].handoffs[0];
  assert.equal(handoff.to, id);
  assert.match(handoff.tool, /^[a-z][a-z0-9_]{0,63}$/);
  assert.match(handoff.id, /^[a-z][a-z0-9_-]{0,63}$/);
  assert.ok(handoff.description.length > 0);
  assert.notEqual(next.agents.items[0].kind, 'standalone');
  assert.deepEqual(errorsOf(next), []);
  const again = ops.addSubagent(next, from);
  assert.notEqual(again.id, id, 'a second one gets its own id');
  const tools = again.config.agents.items[0].handoffs.map((h) => h.tool);
  assert.equal(new Set(tools).size, tools.length, 'and its own hand-over tool name');
  assert.deepEqual(
    ops.addSubagent(config, from, { at: { x: 10.4, y: 20.6 } }).config.builder.ui.graph_positions[ops.addSubagent(config, from).id],
    { x: 10, y: 21 },
    'a place can be given',
  );
});

test('Agent transfer links two existing agents, never an agent to itself, and a second link gets its own id', () => {
  const { config } = ops.addSubagent(single(), single().agents.items[0].id);
  const [a, b] = config.agents.items.map((x) => x.id);
  assert.equal(ops.addAgentTransfer(config, a, a), config, 'not to itself');
  assert.equal(ops.addAgentTransfer(config, a, 'nobody'), config);
  const back = ops.addAgentTransfer(config, b, a, 'The caller wants to start over.');
  assert.deepEqual(
    back.agents.items[1].handoffs.map((h) => [h.to, h.description]),
    [[a, 'The caller wants to start over.']],
  );
  const twice = ops.addAgentTransfer(ops.addAgentTransfer(config, b, a), b, a);
  assert.equal(new Set(twice.agents.items[1].handoffs.map((h) => h.id)).size, 2);
  assert.deepEqual(errorsOf(twice), []);
});

test('Say, Update state, Phone number transfer, Tool and End write ordinary settings', () => {
  const base = single();
  const a = base.agents.items[0].id;
  const say = ops.addSay(base, a, 'Welcome!');
  assert.deepEqual(say.config.agents.items[0].on_enter, [{ type: 'say', text: 'Welcome!' }]);
  assert.equal(say.id, enterId(a, 0));

  const state = ops.addUpdateState(say.config, a);
  assert.deepEqual(state.config.agents.items[0].on_enter[1], { type: 'set_state', values: {} }, 'with no variable yet it sets nothing, and says so');
  const withVar = ops.addStateVariable(base, 'caller_intent', 'string');
  assert.deepEqual(withVar.state.variables.caller_intent, { type: 'string', nullable: true, default: null });
  assert.deepEqual(ops.addUpdateState(withVar, a).config.agents.items[0].on_enter[0].values, { caller_intent: '' }, 'with one it starts on the first');

  const phone = ops.addPhoneTransfer(base, a, '+1 800 555 0100');
  assert.equal(phone.config.telephony.transfers.at(-1).target, '+1 800 555 0100');
  assert.equal(phone.config.telephony.transfers.at(-1).method, 'sip_refer');
  const tool = phone.config.tools.at(-1);
  assert.deepEqual([tool.type, tool.builtin, tool.params.transfer], ['builtin', 'transfer_or_callback', phone.config.telephony.transfers.at(-1).id]);
  assert.ok(phone.config.agents.items[0].tools.includes(tool.id));
  assert.equal(ops.addPhoneTransfer(base, a, '  ').config, base, 'a number is needed');
  assert.deepEqual(errorsOf(phone.config), []);

  const end = ops.addEnd(base, a);
  assert.ok(
    end.config.tools.some((t) => t.builtin === 'end_call') &&
      end.config.agents.items[0].tools.includes(end.config.tools.find((t) => t.builtin === 'end_call').id),
  );
  assert.equal(ops.addEnd(end.config, a).config, end.config, 'it is not added twice');
  const other = ops.addSubagent(end.config, a);
  const second = ops.addEnd(other.config, other.id);
  assert.equal(
    second.config.tools.filter((t) => t.builtin === 'end_call').length,
    end.config.tools.filter((t) => t.builtin === 'end_call').length,
    'the same way of ending the call is shared, not copied',
  );
  assert.deepEqual(errorsOf(second.config), []);

  const lookup = { ...base, tools: [{ id: 'lookup', type: 'http', description: 'Look something up.' }] };
  const withTool = ops.addTool(lookup, a, 'lookup');
  assert.deepEqual([withTool.id, withTool.config.agents.items[0].tools], [`${a}::tool::lookup`, ['lookup']]);
  assert.equal(ops.addTool(withTool.config, a, 'lookup').config, withTool.config, 'a tool is not offered twice');
  assert.equal(ops.addTool(base, a, 'nope').config, base, 'a tool that does not exist cannot be offered');
});
const list = (v) => (Array.isArray(v) ? v : []);

test('taking things away: a step, a tool block (and the transfer behind it when nothing else uses it), and an agent with every hand-over to it', () => {
  let config = single();
  const a = config.agents.items[0].id;
  config = ops.addSay(config, a).config;
  const phone = ops.addPhoneTransfer(config, a, '+1 800 555 0100');
  config = phone.config;
  const toolId = config.tools.at(-1).id;
  const transferCount = config.telephony.transfers.length;
  assert.equal(ops.removeNode(config, enterId(a, 0)).agents.items[0].on_enter, undefined, 'the last step takes the empty list with it');
  const gone = ops.removeNode(config, phone.id);
  assert.ok(!gone.agents.items[0].tools.includes(toolId));
  assert.ok(!gone.tools.some((t) => t.id === toolId), 'a transfer tool nothing offers any more goes too');
  assert.equal(gone.telephony.transfers.length, transferCount - 1);
  const shared = ops.addSubagent(config, a);
  const other = ops.addTool(shared.config, shared.id, toolId);
  assert.ok(other.id, 'the other agent can offer it too');
  const keep = ops.removeNode(other.config, phone.id);
  assert.ok(
    keep.tools.some((t) => t.id === toolId),
    'while another agent still offers it, it stays',
  );

  const two = ops.addSubagent(single(), single().agents.items[0].id);
  const [first, second] = two.config.agents.items.map((x) => x.id);
  let wired = ops.addAgentTransfer(two.config, second, first);
  wired.agents.items[1].on_enter = [
    { type: 'handoff', to: first },
    { type: 'say', text: 'x' },
  ];
  wired.tools = [...list(wired.tools), { id: 'route', type: 'builtin', builtin: 'noop', effects: [{ do: [{ type: 'handoff', to: second }] }] }];
  wired.guardrails = { escalation: [{ id: 'r', when: { keywords: ['x'] }, action: 'handoff', to: second }] };
  wired = ops.setPositions(ops.setEntry(wired, second), { [second]: { x: 1, y: 1 }, [`${second}::tool::x`]: { x: 2, y: 2 }, [first]: { x: 3, y: 3 } });
  const removed = ops.removeNode(wired, second);
  assert.deepEqual(
    removed.agents.items.map((x) => x.id),
    [first],
  );
  assert.equal(removed.agents.entry, first, 'the agent that answers first moves on to the one that is left');
  assert.equal(removed.agents.items[0].handoffs, undefined);
  assert.equal(removed.tools.find((t) => t.id === 'route').effects, undefined, 'a tool rule that handed over to it goes');
  assert.equal(removed.guardrails.escalation, undefined, 'and so does a safety rule (and a list left empty is not kept)');
  assert.deepEqual(Object.keys(removed.builder.ui.graph_positions), [first], 'its places are forgotten');
  assert.equal(ops.removeNode(single(), single().agents.items[0].id).agents.items.length, 1, 'the last agent cannot be deleted');
  assert.equal(ops.removeNode(config, START_ID), config);
});

test('places: saved to the file as whole numbers, forgotten on Tidy up with the empty parts removed, and a free spot is found', () => {
  const config = single();
  const placed = ops.setPositions(config, { a: { x: 10.6, y: 20.2 } });
  assert.deepEqual(placed.builder.ui.graph_positions, { a: { x: 11, y: 20 } });
  assert.equal(ops.hasSavedPositions(placed), true);
  assert.equal(ops.hasSavedPositions(config), false);
  const cleared = ops.clearPositions(placed);
  assert.equal(cleared.builder, undefined);
  assert.equal(ops.clearPositions(config), config);
  const flow = buildWorkflow(config);
  const agent = flow.nodes.find((n) => n.type === 'agent');
  const spot = ops.freeSpot(flow, { x: agent.x, y: agent.y }, { w: agent.w, h: agent.h });
  assert.deepEqual(overlaps([...flow.nodes, { id: 'new', ...spot, w: agent.w, h: agent.h }]), []);
});

test('duplicating an agent gives it its own id and its own hand-over tool names', () => {
  const config = example();
  const { config: next, id } = ops.duplicateAgent(config, 'greeter');
  const copy = next.agents.items.find((a) => a.id === id);
  assert.equal(copy.name, 'Front Door (copy)');
  const names = next.agents.items.flatMap((a) => (a.handoffs || []).map((h) => h.tool));
  assert.equal(new Set(names).size, names.length);
  assert.equal(config.agents.items.length, 4, 'the original list is untouched');
});

test('every agent in the corpus can be drawn: unique block ids, every arrow joins two blocks, and nothing placed automatically covers anything', () => {
  const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
  const entries = corpus(createEngine(schema)).filter((e) => e.config?.agents);
  assert.ok(entries.length > 5);
  entries.forEach((entry) => {
    const config = JSON.parse(JSON.stringify(entry.config));
    delete config.builder;
    [true, false].forEach((tools) => {
      const flow = buildWorkflow(config, { tools });
      const ids = flow.nodes.map((n) => n.id);
      assert.equal(new Set(ids).size, ids.length, `${entry.name}: block ids are unique`);
      flow.edges.forEach((e) => assert.ok(ids.includes(e.from) && ids.includes(e.to), `${entry.name}: ${e.id} joins two blocks`));
      assert.deepEqual(overlaps(flow.nodes), [], `${entry.name}: nothing covers anything`);
      // every arrow is a sentence, apart from what is plugged in under a subagent (its model, its knowledge)
      assert.ok(describeWorkflow(flow).length >= flow.edges.filter((e) => e.kind !== 'plug' && !e.stub).length);
    });
  });
});

test('a hand-over made by a tool’s rules or a safety rule can be pointed somewhere else or taken away, and every hand-over id is unique across the agent', () => {
  const config = example();
  const moved = ops.retargetToolHandoff(config, 'report_hazard_chat', 'safety_watch', 'billing');
  assert.deepEqual(
    buildWorkflow(moved)
      .edges.filter((e) => e.kind === 'tool')
      .map((e) => [e.from, e.to]),
    [['tech_support', 'billing']],
  );
  assert.equal(ops.retargetToolHandoff(config, 'report_hazard_chat', 'safety_watch', 'nobody'), config, 'only to an agent that exists');
  const stopped = ops.removeToolHandoff(config, 'report_hazard_chat', 'safety_watch');
  assert.equal(buildWorkflow(stopped).edges.filter((e) => e.kind === 'tool').length, 0);
  assert.ok(
    !JSON.stringify(stopped.tools.find((t) => t.id === 'report_hazard_chat').effects || []).includes('"handoff"'),
    'only the hand-over goes; the tool’s other steps stay',
  );
  assert.ok(
    stopped.tools.some((t) => t.id === 'report_hazard_chat'),
    'the tool itself stays',
  );

  const withRule = JSON.parse(JSON.stringify(config));
  withRule.guardrails.escalation.push({ id: 'to_watch', when: { keywords: ['smoke'] }, action: 'handoff', to: 'safety_watch' });
  const rule = buildWorkflow(withRule).edges.find((e) => e.kind === 'rule');
  assert.deepEqual(rule.ref.ids, ['to_watch']);
  assert.equal(ops.retargetRule(withRule, 'to_watch', 'billing').guardrails.escalation.find((r) => r.id === 'to_watch').to, 'billing');
  assert.ok(!ops.removeRule(withRule, 'to_watch').guardrails.escalation.some((r) => r.id === 'to_watch'));

  // the real validator wants a hand-over id to be unique across the whole agent, not just within one agent
  const added = ops.addAgentTransfer(ops.addAgentTransfer(config, 'billing', 'tech_support'), 'safety_watch', 'tech_support');
  const ids = added.agents.items.flatMap((a) => (a.handoffs || []).map((h) => h.id));
  assert.equal(new Set(ids).size, ids.length);
  const copy = ops.duplicateAgent(config, 'greeter').config;
  const copyIds = copy.agents.items.flatMap((a) => (a.handoffs || []).map((h) => h.id));
  assert.equal(new Set(copyIds).size, copyIds.length);
  assert.ok(
    ops.addPhoneTransfer(single(), single().agents.items[0].id, '+1 800').config.tools.at(-1).params.fallback.length > 0,
    'a transfer says what happens when it cannot be made',
  );
});

test('Update state starts from a value that fits the variable, whatever its type', () => {
  assert.deepEqual(
    ['string', 'integer', 'number', 'boolean', 'object', 'array', 'enum'].map((type) => ops.blankValue({ type, values: ['a', 'b'] })),
    ['', 0, 0, false, {}, [], 'a'],
  );
  const config = single();
  const a = config.agents.items[0].id;
  [
    ['n', { type: 'number' }, 0],
    ['e', { type: 'enum', values: ['x', 'y'] }, 'x'],
    ['o', { type: 'object' }, {}],
  ].forEach(([name, variable, value]) => {
    const withVar = { ...config, state: { variables: { [name]: variable } } };
    assert.deepEqual(ops.addUpdateState(withVar, a).config.agents.items[0].on_enter[0].values, { [name]: value });
  });
});

test('an agent no hand-over leads to from Start is marked as unreachable, and nothing is marked when every agent can be reached', () => {
  const config = single();
  const first = config.agents.items[0].id;
  const { config: two, id } = ops.addSubagent(config, first);
  assert.deepEqual(buildWorkflow(two).stranded, []);
  const flipped = ops.setEntry(two, id); // the new agent answers first, and nothing leads back to the first one
  const flow = buildWorkflow(flipped);
  assert.deepEqual(flow.stranded, [config.agents.items[0].name]);
  assert.equal(flow.nodes.find((n) => n.id === first).stranded, true);
  assert.equal(flow.nodes.find((n) => n.id === id).stranded, false);
});

test('deleting an agent leaves nothing pointing at it, however deep, and takes the places of the steps that moved', () => {
  const two = ops.addSubagent(single(), single().agents.items[0].id);
  const [first, second] = two.config.agents.items.map((x) => x.id);
  const config = JSON.parse(JSON.stringify(two.config));
  config.tools = [
    {
      id: 'route',
      type: 'builtin',
      builtin: 'noop',
      effects: [
        {
          when: { state: { x: 1 } },
          do: [
            { type: 'if_then', then: [{ type: 'handoff', to: second }] },
            { type: 'set_state', values: {} },
          ],
        },
      ],
    },
  ];
  config.agents.items[0].on_enter = [
    { type: 'handoff', to: second },
    { type: 'say', text: 'a' },
    { type: 'say', text: 'b' },
  ];
  config.tests = [{ id: 't', channel: 'web_chat', turns: [], expect: [{ agent_is: second }, { said_matches: 'hello' }] }];
  const placed = ops.setPositions(config, { [`${first}::enter::2`]: { x: 1, y: 1 } });
  const removed = ops.removeAgent(placed, second);
  assert.ok(!JSON.stringify(removed).includes(`"to":"${second}"`), 'no hand-over to it is left, even one nested in another step');
  assert.deepEqual(
    removed.agents.items[0].on_enter.map((x) => x.type),
    ['say', 'say'],
  );
  assert.deepEqual(removed.tests[0].expect, [{ said_matches: 'hello' }], 'a check about it goes; the test keeps its other checks');
  assert.equal(removed.builder?.ui?.graph_positions?.[`${first}::enter::2`], undefined, 'a saved place for a step that is now another step is forgotten');
  const gone = ops.removeHandoff(placed, first, { enter: 0 });
  assert.equal(gone.builder?.ui?.graph_positions?.[`${first}::enter::2`], undefined);
});

test('a transfer used by something else (an on_enter step) stays when the tool that used it is taken away', () => {
  const base = single();
  const a = base.agents.items[0].id;
  const phone = ops.addPhoneTransfer(base, a, '+1 800 555 0100');
  const transferId = phone.config.telephony.transfers.at(-1).id;
  const other = ops.addSubagent(phone.config, a);
  const withStep = JSON.parse(JSON.stringify(other.config));
  withStep.agents.items[1].on_enter = [{ type: 'transfer', transfer: transferId }];
  const removed = ops.removeNode(withStep, phone.id);
  assert.ok(removed.telephony.transfers.some((t) => t.id === transferId));
});

test('Delete: a deleted-agent list is brought back only for the agents it shows, and duplicating copes with odd hand-overs', () => {
  const config = example();
  config.agents.items[0].handoffs = [null, { to: 'billing' }, ...config.agents.items[0].handoffs];
  const { config: next } = ops.duplicateAgent(config, 'greeter');
  const copy = next.agents.items.at(-1);
  assert.ok(copy.handoffs.every((h) => h.id && h.tool));
});

test('an agent with the id "start" is an agent, not the Start block; the place of the Start block saved under its old name is still read, then replaced', () => {
  const config = single();
  config.agents.items.push({ id: 'start', name: 'Start', kind: 'specialist', instructions: { role: 'Greets.' } });
  const flow = buildWorkflow(config);
  assert.equal(flow.nodes.find((n) => n.id === 'start')?.type, 'agent');
  assert.ok(!flow.edges.some((e) => e.from === e.to));
  // with no channel, the Start block: its place once saved as "start" is still read
  const legacy = { ...single(), channels: [] };
  legacy.builder = { ui: { graph_positions: { start: { x: 300, y: 20 } } } };
  const at = buildWorkflow(legacy).nodes.find((n) => n.id === START_ID);
  assert.deepEqual([at.x, at.y], [300, 20]);
  assert.deepEqual(ops.setPositions(legacy, { [START_ID]: { x: 310, y: 30 } }).builder.ui.graph_positions, { [START_ID]: { x: 310, y: 30 } });
});

test('a hand-over to an agent that is gone draws no arrow, is no way out, and is listed on its agent to be taken away', () => {
  const config = single();
  const first = config.agents.items[0];
  first.kind = 'router';
  first.handoffs = [{ id: 'to_b', tool: 'go_to_b', description: 'Billing questions.', to: 'b' }];
  config.agents.items.push({
    id: 'b',
    name: 'B',
    kind: 'specialist',
    instructions: { role: 'Helps.' },
    handoffs: [{ id: 'to_gone', tool: 'go_to_gone', description: 'x', to: 'gone' }],
    on_enter: [{ type: 'handoff', to: 'gone_too' }],
  });
  const flow = buildWorkflow(config);
  assert.ok(!flow.edges.some((e) => e.to === 'gone' || e.to === 'gone_too'));
  const b = flow.nodes.find((n) => n.id === 'b');
  assert.deepEqual(b.broken, [
    { handoff: 0, to: 'gone' },
    { enter: 0, to: 'gone_too' },
  ]);
  assert.equal(b.deadEnd, true, 'a hand-over to nobody is no way out');
  const fixed = ops.removeHandoff(ops.removeHandoff(config, 'b', { handoff: 0 }), 'b', { enter: 0 });
  assert.deepEqual(buildWorkflow(fixed).nodes.find((n) => n.id === 'b').broken, []);
});

test('nothing is drawn past the top or left edge, and nothing lies on another block, even with an agent saved near the top that has many tools', () => {
  const flow = buildWorkflow(example());
  assert.deepEqual(
    flow.nodes.filter((n) => n.x < EDGE || n.y < EDGE).map((n) => n.id),
    [],
  );
  assert.deepEqual(overlaps(flow.nodes), []);
});

test('blocks and lines name tools as the Tools page does; a tool that sends something says so; "who answers first" naming nobody is noticed', () => {
  const config = example();
  const flow = buildWorkflow(config);
  const pay = flow.nodes.find((n) => n.id === toolNodeId('billing', 'send_payment_link'));
  assert.equal(pay.label, 'Send payment link');
  assert.equal(pay.sub, 'Sends something to your systems');
  assert.ok(describeWorkflow(flow).includes('Billing can use “Get bill summary”.'));
  assert.equal(flow.entryUnset, false);
  config.agents.entry = 'nobody';
  assert.equal(buildWorkflow(config).entryUnset, true);
});

test('a step as an agent takes over can run earlier or later; at either end it stays', () => {
  const config = single();
  const id = config.agents.items[0].id;
  config.agents.items[0].on_enter = [
    { type: 'say', text: 'a' },
    { type: 'say', text: 'b' },
  ];
  const moved = ops.moveEnterStep(config, id, 1, -1);
  assert.deepEqual(
    moved.config.agents.items[0].on_enter.map((s) => s.text),
    ['b', 'a'],
  );
  assert.equal(moved.id, enterId(id, 0));
  assert.equal(ops.moveEnterStep(config, id, 0, -1).config, config);
  assert.equal(ops.moveEnterStep(config, id, 1, 1).config, config);
});

test('an item of the agents list that is not an agent does not stop agents and hand-overs being added', () => {
  const config = single();
  config.agents.items.push(null);
  const made = ops.addSubagent(config, config.agents.items[0].id, { name: 'Billing', when: 'Bills.' });
  assert.ok(made.config.agents.items.some((a) => a?.name === 'Billing'));
  assert.ok(ops.addAgentTransfer(made.config, made.id, config.agents.items[0].id).agents.items.find((a) => a?.id === made.id).handoffs);
});

test('Tidy up (no saved places): in columns, nothing covers anything (blocks or the words on arrows), and every arrow has its own route and its own place for its words', async () => {
  const { labelBox } = await import('../src/studio/workflow/workflowModel.js');
  [example(), ...corpus().map((e) => e.config)].forEach((given) => {
    const config = JSON.parse(JSON.stringify(given));
    delete config.builder;
    const flow = buildWorkflow(config);
    const rects = flow.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    const drawn = flow.edges.filter((e) => !e.hidden && e.kind !== 'plug' && e.kind !== 'uses');
    drawn.forEach((e) => {
      assert.ok(e.points?.length >= 2, `${e.id} has its route`);
      const words = e.missing ? 'Say when' : e.label && e.kind !== 'start' ? e.full || e.label : '';
      if (!words) return;
      assert.ok(e.labelAt, `${e.id} has a place for its words`);
      const b = labelBox(words);
      rects.push({ id: `words of ${e.id}`, x: e.labelAt.x - b.width / 2, y: e.labelAt.y - b.height / 2, w: b.width, h: b.height });
    });
    assert.deepEqual(overlaps(rects), []);
    // the subagent that answers first comes after the channels, left to right
    const entry = flow.nodes.find((n) => n.type === 'agent' && n.entry);
    flow.nodes.filter((n) => n.type === 'trigger').forEach((t) => assert.ok(t.x + t.w < entry.x));
  });
});

test('Tidy up: each line runs level and upright on a lane of its own, from the side of one block to the side of the next; no two share a stretch, and none crosses a block or the words of another', async () => {
  const { labelBox } = await import('../src/studio/workflow/workflowModel.js');
  // a subagent that passes callers to six others, two of which pass callers on between them
  let busy = single();
  const hub = busy.agents.items[0].id;
  const ids = ['Orders', 'Returns', 'Billing', 'Repairs', 'Sales', 'After hours'].map((name) => {
    const made = ops.addSubagent(busy, hub, { name, when: `The caller asks about ${name.toLowerCase()}.` });
    busy = made.config;
    return made.id;
  });
  busy = ops.addAgentTransfer(ops.addAgentTransfer(busy, ids[0], ids[1]), ids[3], ids[0]);
  [busy, example(), ...corpus().map((e) => e.config)].forEach((given) => {
    const config = JSON.parse(JSON.stringify(given));
    delete config.builder;
    const flow = buildWorkflow(config);
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const drawn = flow.edges.filter((e) => !e.hidden && e.kind !== 'plug' && e.kind !== 'uses');
    const runs = [];
    const words = [];
    drawn.forEach((e) => {
      const [a, b] = [byId.get(e.from), byId.get(e.to)];
      const [p, q] = [e.points[0], e.points.at(-1)];
      assert.ok((p.x === a.x || p.x === a.x + a.w) && p.y > a.y && p.y < a.y + a.h, `${e.id} leaves from a side of ${a.id}`);
      assert.ok((q.x === b.x || q.x === b.x + b.w) && q.y > b.y && q.y < b.y + b.h, `${e.id} reaches a side of ${b.id}`);
      e.points.slice(1).forEach((s, i) => {
        const r = e.points[i];
        assert.ok(r.x === s.x || r.y === s.y, `${e.id} runs level or upright`);
        runs.push({ e, x: Math.min(r.x, s.x), y: Math.min(r.y, s.y), w: Math.abs(s.x - r.x), h: Math.abs(s.y - r.y) });
      });
      const said = e.missing ? 'Say when' : e.label && e.kind !== 'start' ? e.full || e.label : '';
      if (!said) return;
      const lb = labelBox(said);
      words.push({ e, x: e.labelAt.x - lb.width / 2, y: e.labelAt.y - lb.height / 2, w: lb.width, h: lb.height });
    });
    const across = (r, o) => r.x < o.x + o.w - 1 && r.x + r.w > o.x + 1 && r.y < o.y + o.h - 1 && r.y + r.h > o.y + 1;
    runs.forEach((r) => {
      flow.nodes.forEach((n) => assert.ok(n.id === r.e.from || n.id === r.e.to || !across(r, n), `${r.e.id} does not cross ${n.id}`));
      words.forEach((w) => assert.ok(w.e === r.e || !across(r, w), `${r.e.id} does not cross the words of ${w.e.id}`));
    });
    runs.forEach((r, i) =>
      runs.slice(i + 1).forEach((o) => {
        if (r.e === o.e) return;
        const upright = !r.w && !o.w && r.x === o.x && Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y) > 2;
        const level = !r.h && !o.h && r.y === o.y && Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x) > 2;
        assert.ok(!upright && !level, `${r.e.id} and ${o.e.id} do not share a stretch`);
      }),
    );
  });
});

test('lanes: a fan of lines turns nested, the farthest first, so none cross; points on a side keep their order and their room; corners are rounded', async () => {
  const { orderLanes, spread, roundedPath } = await import('../src/studio/workflow/edgeLanes.js');
  // leaving at 0 and 10 for 1000 and 500 up; at 20 and 30 for 500 and 1000 down
  const order = orderLanes([
    { a: 10, b: -500 },
    { a: 0, b: -1000 },
    { a: 20, b: 500 },
    { a: 30, b: 1000 },
  ]);
  assert.ok(order.indexOf(1) < order.indexOf(0), 'the one going farthest up turns first');
  assert.ok(order.indexOf(3) < order.indexOf(2), 'the one going farthest down turns first');
  assert.deepEqual(spread([50, 50, 50], 0, 100), [50, 60, 70]);
  assert.deepEqual(spread([95, 99], 0, 100), [90, 100]);
  assert.deepEqual(spread([-20, 500], 0, 100), [0, 100], 'each as near where it heads as the side allows');
  assert.deepEqual(spread([0, 0, 0], 0, 10), [0, 5, 10], 'spread evenly when the side is too short');
  assert.equal(
    roundedPath([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 80, y: 40 },
    ]),
    'M 0 0 L 32 0 Q 40 0 40 8 L 40 32 Q 40 40 48 40 L 80 40',
  );
});

test('no words are cut: a long name or line makes its block taller; the words on an arrow wrap into more lines', async () => {
  const { labelBox } = await import('../src/studio/workflow/workflowModel.js');
  const config = single();
  const id = config.agents.items[0].id;
  const short = buildWorkflow(config).nodes.find((n) => n.id === id).h;
  config.agents.items[0].name = 'Front desk for the whole of the customer care team in the evenings and at weekends';
  config.agents.items[0].instructions.role =
    'You greet every caller, find out what they need, and pass them on to the right team without making them repeat themselves.';
  const tall = buildWorkflow(config).nodes.find((n) => n.id === id);
  assert.ok(tall.h > short, 'taller, not cut');
  assert.equal(tall.brief, 'You greet every caller, find out what they need, and pass them on to the right team without making them repeat themselves.');
  const words = labelBox('The caller asks about a bill, charges, a payment, a refund, a direct debit or a late fee');
  assert.ok(words.lines.length > 1 && words.lines.join(' ') === 'The caller asks about a bill, charges, a payment, a refund, a direct debit or a late fee');
});

test('a way back to the first subagent is a small block beside the subagent (its arrow kept for the lists, not drawn across the picture)', () => {
  const flow = buildWorkflow(example());
  const back = flow.nodes.find((n) => n.type === 'back' && n.agent === 'billing');
  assert.equal(back.label, 'Back to Front Door');
  const arrow = flow.edges.find((e) => e.id === back.edge);
  assert.deepEqual([arrow.kind, arrow.from, arrow.to, arrow.hidden], ['return', 'billing', 'greeter', true]);
  assert.ok(describeWorkflow(flow).includes('Billing sends the caller back to Front Door (back to the start).'));
});

test('a way out is a way out wherever it is: a tool whose effects hand over, an on-enter step that ends or transfers', () => {
  const config = {
    channels: [{ id: 'chat', type: 'web_chat' }],
    agents: {
      entry: 'a',
      items: [
        { id: 'a', handoffs: [{ to: 'b' }, { to: 'c' }] },
        { id: 'b', tools: ['go'] },
        { id: 'c', on_enter: [{ type: 'end_call' }] },
      ],
    },
    tools: [{ id: 'go', type: 'http', effects: [{ do: [{ type: 'handoff', to: 'a' }] }] }],
  };
  const of = (id) => buildWorkflow(config).nodes.find((n) => n.id === id);
  assert.equal(of('b').deadEnd, false);
  assert.equal(of('c').deadEnd, false);
});

test('deleting a "Back to …" block takes it away, as an on-enter step or as a tool, and two End tools switched off together both go', () => {
  const config = {
    agents: { entry: 'menu', items: [{ id: 'menu' }, { id: 'billing', tools: ['back', 'end_voice', 'end_chat'], on_enter: [{ type: 'return_to_entry' }] }] },
    tools: [
      { id: 'back', type: 'builtin', builtin: 'return_to_entry' },
      { id: 'end_voice', type: 'builtin', builtin: 'end_call' },
      { id: 'end_chat', type: 'builtin', builtin: 'end_call' },
    ],
  };
  assert.equal(ops.removeNode(config, 'billing::back::back').agents.items[1].tools.includes('back'), false);
  assert.equal(ops.removeNode(config, 'billing::back::enter0').agents.items[1].on_enter, undefined);
  const both = ['end_voice', 'end_chat'].reduce((c, id) => ops.removeNode(c, toolNodeId('billing', id)), config);
  assert.deepEqual(both.agents.items[1].tools, ['back']);
});
