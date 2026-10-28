// Live check that hand-overs between subagents work in an agent built by the studio: a shop agent made the way the
// Workflow makes one (a starter, then three specialists added with addSubagent), run on the server's test runner with
// the real model. It runs twice, with nothing saved: once as the studio builds agents now (with the hand-over rules,
// workflow/handoffRules.js) and once without them, to show what they change.
//   node scripts/handoffLiveCheck.mjs <bot-id>
// <bot-id> is any existing agent: the run uses its test runner with this configuration in place of its draft, and saves
// nothing to it. Reads AGENT_BUILDER_URL and AGENT_BUILDER_API_KEY from .env.local and never prints the key. Each run
// uses the live model for ten short conversations.
import fs from 'node:fs';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { addSubagent } from '../src/studio/workflow/workflowOps.js';
import { FIRST_AGENT_RULE, handoffGaps } from '../src/studio/workflow/handoffRules.js';

const host = process.argv[2];
if (!host) {
  console.error('Usage: node scripts/handoffLiveCheck.mjs <bot-id of an existing agent, used only for its test runner>');
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
);
const base = env.AGENT_BUILDER_URL.replace(/\/$/, '');
const headers = { Authorization: `Bearer ${env.AGENT_BUILDER_API_KEY}`, 'Content-Type': 'application/json' };
async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ---- the agent, built the way the Workflow builds one
const SPECIALISTS = [
  [
    'Orders',
    'Where an order is, delivery dates, changing or cancelling an order.',
    'You help with the caller’s orders: where an order is, when it will arrive, and changing or cancelling it. Ask for the order number.',
  ],
  [
    'Returns',
    'Returning an item and refunds.',
    'You handle returns and refunds: explain the 30-day return policy, ask for the order number and the reason, and say how the refund is paid.',
  ],
  [
    'Billing',
    'Payments, invoices and charges on a card.',
    'You handle payments, invoices and unexpected charges. Ask for the last four digits of the card and the date of the charge.',
  ],
];
function buildShop() {
  let config = applyStarter(minimalConfig('northwind-shop', 'Northwind Shop'), 'support');
  const desk = config.agents.entry || config.agents.items[0].id;
  const ids = {};
  for (const [name, when, role] of SPECIALISTS) {
    const made = addSubagent(config, desk, { name, when });
    config = made.config;
    config.agents.items.find((agent) => agent.id === made.id).instructions.role = role;
    ids[name] = made.id;
  }
  return { config, desk, ids };
}
// the same agent as the studio built it before the hand-over rules: no rules and no way back
function withoutRules(config) {
  const next = structuredClone(config);
  const back = next.tools.filter((tool) => tool.builtin === 'return_to_entry').map((tool) => tool.id);
  next.tools = next.tools.filter((tool) => !back.includes(tool.id));
  for (const agent of next.agents.items) {
    agent.tools = (agent.tools || []).filter((id) => !back.includes(id));
    const rules = (agent.instructions.rules || []).filter((rule) => rule !== FIRST_AGENT_RULE && !rule.startsWith('Your job is only what your role says.'));
    agent.instructions = { ...agent.instructions, rules };
    if (!rules.length) delete agent.instructions.rules;
  }
  return next;
}

const { config: shop, ids } = buildShop();
if (handoffGaps(shop).length) throw new Error('the studio left hand-over gaps in a new agent');
const route = (name, say) => ({
  id: `route_${ids[name]}`,
  channel: 'web-chat',
  turns: [{ say }],
  expect: [{ tool_called: `go_to_${ids[name]}` }],
  target: ids[name],
});
const bounce = (id, from, first, to, second) => ({
  id,
  channel: 'web-chat',
  turns: [{ say: first }, { say: second }],
  expect: [{ tool_called: `go_to_${ids[from]}` }, { tool_called: `go_to_${ids[to]}` }],
  target: ids[to],
});
const scenarios = [
  route('Orders', 'Where is my order? It was supposed to arrive yesterday.'),
  route('Returns', 'I want to return a jacket I bought.'),
  route('Billing', 'There is a charge on my card I don’t recognise.'),
  bounce(
    'bounce_orders_to_billing',
    'Orders',
    'Can you tell me when my order will arrive?',
    'Billing',
    'Actually, I was charged twice for it. Can you look at my card?',
  ),
  bounce('bounce_returns_to_orders', 'Returns', 'I want to return a lamp.', 'Orders', 'Wait, before that, where is my other order?'),
];

async function run(label, config) {
  const testConfig = { ...structuredClone(config), tests: scenarios.map(({ target, ...scenario }) => scenario) };
  const { errors = [] } = await call('POST', '/validate', testConfig);
  if (errors.length) throw new Error(`${label}: not valid: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  const started = await call('POST', `/bots/${host}/tests/run`, { config: testConfig, live: true, judge: false });
  let result = started;
  const t0 = Date.now();
  while (!['passed', 'failed', 'error', 'cancelled'].includes(result.status)) {
    if (Date.now() - t0 > 20 * 60 * 1000) throw new Error(`${label}: still running after 20 minutes`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    result = await call('GET', `/bots/${host}/tests/runs/${started.run_id}`);
  }
  return result;
}

const results = {};
for (const [label, config] of [
  ['with the rules (the studio now)', shop],
  ['without them (the studio before)', withoutRules(shop)],
]) {
  results[label] = await run(label, config);
}
for (const [label, result] of Object.entries(results)) {
  let passed = 0;
  console.log(`\n${label}:`);
  for (const scenario of result.scenarios) {
    const target = scenarios.find((s) => s.id === scenario.id)?.target;
    const ok = scenario.status === 'passed' && String(scenario.final_agent || '').split('/')[0] === target;
    if (ok) passed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${scenario.id.padEnd(28)} ended with ${scenario.final_agent}`);
    if (!ok) for (const line of (scenario.transcript || []).slice(-1)) console.log(`        last reply: ${String(line.text).slice(0, 150)}`);
  }
  console.log(`  ${passed} of ${result.scenarios.length}`);
}
