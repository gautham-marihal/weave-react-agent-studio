// The corpus the conformance tests run over: configs that exist today, plus configs generated to be bigger and odder than any one customer's.
//
//   example   the API's own example config (tests/fixtures/agent-config.example.json)
//   starter   every starting point the Create dialog offers
//   scaled    a real starter with many tools and agents added, built only from valid parts
//   stress    every kind of tool and every kind of channel at once (renders and renames; its validity is not claimed)
//   dir       every *.json in the folder named by CONFORMANCE_DIR, for bots a customer brought (anonymise them first)
//
// `valid: true` means "the server calls this valid" (it is checked against the real API when CONFORMANCE_SERVER=1), so the form must draw no
// red mark on it: every red mark on a valid config is a false alarm. Pure apart from reading files.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyStarter, STARTERS } from '../../src/studio/starters.ts';
import { minimalConfig } from '../../src/demo/demoApi.js';
import { CHANNEL_PRESETS, buildChannel } from '../../src/studio/form/presets.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function scaledConfig(tools = 30, agents = 6) {
  const config = applyStarter(minimalConfig('scaled', 'Scaled'), 'support');
  config.connections = { ...(config.connections || {}), api: { type: 'http', base_url: 'https://api.example.com' } };
  const more = Array.from({ length: tools }, (_, i) => ({
    id: `lookup_${i}`,
    type: 'http',
    connection: 'api',
    description: `Looks up record number ${i} when the caller asks about it`,
    request: { method: 'GET', path: `/records/${i}/{{args.record_id}}`, query: { v: '2' } },
    parameters: { type: 'object', required: ['record_id'], properties: { record_id: { type: 'string', description: 'The id of the record' } } },
    result: { to_llm: ['found', 'summary'] },
    timeout_s: 6,
  }));
  config.tools = [...(config.tools || []), ...more];
  const extra = Array.from({ length: agents }, (_, i) => ({
    id: `helper_${i}`,
    name: `Helper ${i}`,
    kind: 'specialist',
    instructions: { role: `Help with topic ${i}.` },
    tools: more.slice(i * 3, i * 3 + 3).map((t) => t.id),
  }));
  config.agents = { ...config.agents, items: [...config.agents.items, ...extra] };
  return config;
}

// Every kind of channel, and the defaults of every kind of tool, in one config. Not claimed valid: it exists to be drawn and renamed.
export function stressConfig(engine) {
  const config = scaledConfig(8, 4);
  const channels = [];
  CHANNEL_PRESETS.forEach((preset) => channels.push(buildChannel(preset.id, { taken: channels.map((c) => c.id), botId: 'stress' })));
  config.channels = channels;
  const toolSchema = engine.root.properties.tools.items;
  const branches = engine.branchesOf(engine.flatten(toolSchema));
  branches.forEach((branch, i) => {
    const made = engine.defaultFor(branch);
    if (made && typeof made === 'object') config.tools.push({ ...made, id: `kind_${i}` });
  });
  return config;
}

function sharedName(example) {
  const config = clone(example);
  const scenario = {
    id: 'hazard_reaches_safety',
    channel: 'web-chat',
    turns: [{ say: 'There is a sparking cable on Main Street.' }],
    expect: [{ tool_called: 'report_hazard' }, { tool_called_with: { tool: 'report_hazard', args: { location: 'Main Street' } } }],
  };
  config.tests = [...(Array.isArray(config.tests) ? config.tests : []), scenario];
  return config;
}

export function corpus(engine) {
  const out = [];
  const example = JSON.parse(readFileSync(new URL('../fixtures/agent-config.example.json', import.meta.url), 'utf8'));
  out.push({ name: 'the API’s example', source: 'example', config: example, valid: true });
  // what found UI_REVIEW round 3's bug 2.2: one tool per channel sharing the name the model calls (report_hazard for the phone, report_hazard_chat named
  // report_hazard for the chat), and a scenario that checks it by that name, as the runner does. A valid config: no red mark may say the tool is unknown.
  out.push({
    name: 'the API’s example, with a scenario that checks a tool by the name the model calls',
    source: 'example',
    config: sharedName(example),
    valid: true,
  });
  STARTERS.forEach((starter) =>
    out.push({
      name: `starter ${starter.id}`,
      source: 'starter',
      config: applyStarter(minimalConfig(`s-${starter.id}`.slice(0, 30), starter.name || starter.id), starter.id),
      valid: true,
    }),
  );
  out.push({ name: 'scaled: 30 tools, 6 more agents', source: 'scaled', config: scaledConfig(30, 6), valid: true });
  if (engine) out.push({ name: 'stress: every tool kind and channel', source: 'stress', config: stressConfig(engine), valid: false });
  if (process.env.CONFORMANCE_DIR) {
    readdirSync(process.env.CONFORMANCE_DIR)
      .filter((f) => f.endsWith('.json'))
      .forEach((file) => {
        out.push({ name: `dir ${file}`, source: 'dir', config: JSON.parse(readFileSync(join(process.env.CONFORMANCE_DIR, file), 'utf8')), valid: true });
      });
  }
  return out.map((entry) => ({ ...entry, config: clone(entry.config) }));
}
