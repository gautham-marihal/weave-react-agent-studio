import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultInterrupt,
  defaultLlm,
  defaultVoice,
  interruptChoice,
  llmChoice,
  llmOptions,
  setInterrupt,
  setLlm,
  setVoice,
  voiceChoice,
  voiceOptions,
} from '../src/studio/workflow/agentOverrides.js';
import { TEMPLATES } from '../src/studio/workflow/workflowTemplates.js';
import { isBuiltin } from '../src/studio/workflow/workflowOps.js';
import { validateDemo } from '../src/demo/demoValidate.js';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { readFileSync } from 'node:fs';

// What the Workflow's panel and its Templates menu do to a draft: an agent's own settings (kept in its `overrides`, absent while it uses the default), and
// the ready-made pieces of a workflow, each made of the same edits as the ＋ menu.
const single = () => minimalConfig('solo', 'Solo');
const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
const withTts = () => {
  const config = single();
  config.defaults.models.tts = { provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice_id: 'EXAVITQu4vr4xnSDxMaL' };
  return config;
};
const template = (id) => TEMPLATES.find((t) => t.id === id);
const errorsOf = (config) => validateDemo(config, 'solo').errors;

test('an agent uses the default AI model until it has its own; going back to the default leaves no empty overrides', () => {
  const config = single();
  const agent = config.agents.items[0];
  assert.equal(llmChoice(agent, config), '');
  assert.equal(defaultLlm(config), 'GPT-4.1 Mini (OpenAI)');
  const same = setLlm(agent, 'openai|gpt-4.1', config);
  assert.deepEqual(
    same.overrides,
    { models: { llm: { model: 'gpt-4.1' } } },
    'the default’s provider: the model alone (the provider and key are the default’s)',
  );
  assert.equal(llmChoice(same, config), 'openai|gpt-4.1');
  const other = setLlm(agent, 'anthropic|claude-sonnet-5-5', config);
  assert.deepEqual(
    other.overrides,
    { models: { llm: { model: 'claude-sonnet-5-5', provider: 'anthropic', api_key: { secret: 'ANTHROPIC_API_KEY' } } } },
    'another provider brings its own key, not the default’s',
  );
  assert.equal(llmChoice(other, config), 'anthropic|claude-sonnet-5-5');
  assert.deepEqual(
    setLlm(other, 'openai|gpt-4.1', config).overrides,
    { models: { llm: { model: 'gpt-4.1' } } },
    'back on the default’s provider, its key is used',
  );
  assert.equal(agent.overrides, undefined, 'the agent it was given is not changed');
  assert.equal(setLlm(other, '', config).overrides, undefined);
  const both = setInterrupt(other, false);
  assert.deepEqual(setLlm(both, '', config).overrides, { conversation: { turn_handling: { interruption: { enabled: false } } } }, 'only the model goes');
  assert.equal(defaultLlm({}), 'Not chosen yet');
});

test('an agent’s own settings of the model (a temperature) are kept when its model changes, and when it goes back to the default', () => {
  const config = example();
  const tech = config.agents.items.find((a) => a.id === 'tech_support');
  assert.deepEqual(tech.overrides.models.llm, { model: 'gpt-4.1', temperature: 0.2 });
  assert.equal(llmChoice(tech, config), 'openai|gpt-4.1', 'no provider of its own: the default’s');
  assert.deepEqual(setLlm(tech, 'openai|gpt-4.1-mini', config).overrides.models.llm, { model: 'gpt-4.1-mini', temperature: 0.2 });
  assert.deepEqual(setLlm(tech, '', config).overrides.models.llm, { temperature: 0.2 });
});

test('the models offered are those of the providers the server can run; an agent’s own choice is kept even when it is not in the catalogue', () => {
  const config = single();
  const agent = config.agents.items[0];
  const groups = (options) => [...new Set(options.map((o) => o.group))];
  assert.ok(groups(llmOptions(agent, [], config)).length > 1, 'every provider while the server has not said');
  assert.deepEqual(groups(llmOptions(agent, [{ name: 'openai', stages: ['llm'] }], config)), ['OpenAI']);
  assert.deepEqual(
    groups(
      llmOptions(
        agent,
        [
          { name: 'openai', stages: ['llm'], installed: false },
          { name: 'anthropic', stages: ['llm'] },
        ],
        config,
      ),
    ),
    ['Anthropic'],
  );
  const custom = setLlm(agent, 'openai|my-fine-tune', config);
  assert.deepEqual(llmOptions(custom, [{ name: 'openai', stages: ['llm'] }], config)[0], {
    value: 'openai|my-fine-tune',
    label: 'my-fine-tune',
    group: 'OpenAI',
  });
});

test('an agent’s own voice: one of the default’s engine is the voice alone; another engine brings that engine’s first model and its key', () => {
  const config = withTts();
  const agent = config.agents.items[0];
  assert.equal(voiceChoice(agent, config), '');
  assert.equal(defaultVoice(config), 'Sarah (ElevenLabs)');
  assert.ok(voiceOptions(agent, config).some((o) => o.value === 'cartesia|db6b0ed5-d5d3-463d-ae85-518a07d3c2b4' && o.group === 'Cartesia'));
  const same = setVoice(agent, 'elevenlabs|cgSgspJ2msm6clMCkdW9', config);
  assert.deepEqual(same.overrides.models.tts, { voice_id: 'cgSgspJ2msm6clMCkdW9' });
  assert.equal(voiceChoice(same, config), 'elevenlabs|cgSgspJ2msm6clMCkdW9');
  const own = setVoice(agent, 'cartesia|db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', config);
  assert.deepEqual(own.overrides.models.tts, {
    voice_id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
    provider: 'cartesia',
    model: 'sonic-3',
    api_key: { secret: 'CARTESIA_API_KEY' },
  });
  assert.equal(voiceChoice(own, config), 'cartesia|db6b0ed5-d5d3-463d-ae85-518a07d3c2b4');
  assert.deepEqual(setVoice(own, 'elevenlabs|cgSgspJ2msm6clMCkdW9', config).overrides.models.tts, { voice_id: 'cgSgspJ2msm6clMCkdW9' });
  assert.equal(setVoice(own, '', config).overrides, undefined);
});

test('whether callers can interrupt an agent: the default (on unless the defaults say off), its own yes or no, and back', () => {
  const config = single();
  const agent = config.agents.items[0];
  assert.equal(interruptChoice(agent), undefined);
  assert.equal(defaultInterrupt(config), true);
  assert.equal(defaultInterrupt({ defaults: { conversation: { turn_handling: { interruption: { enabled: false } } } } }), false);
  const off = setInterrupt(agent, false);
  assert.equal(interruptChoice(off), false);
  assert.equal(off.overrides.conversation.turn_handling.interruption.enabled, false);
  assert.equal(setInterrupt(off, undefined).overrides, undefined);
});

test('Front desk with specialists adds Sales and Support, told what they do, and the first agent passes callers to both', () => {
  const config = single();
  const done = template('specialists').apply(config);
  const items = done.config.agents.items;
  assert.deepEqual(
    items.map((a) => a.name),
    [config.agents.items[0].name, 'Sales', 'Support'],
  );
  assert.ok(items.slice(1).every((a) => a.instructions.role.length > 20));
  assert.deepEqual(
    items[0].handoffs.map((h) => h.to),
    [items[1].id, items[2].id],
  );
  assert.ok(
    items[0].handoffs.every((h) => String(h.description).trim()),
    'each says when',
  );
  assert.equal(done.select, items[1].id);
  assert.match(done.note, /Added Sales and Support/);
  assert.equal(config.agents.items.length, 1, 'the draft it was given is not changed');
  assert.deepEqual(errorsOf(done.config), errorsOf(config));
});

test('Back to the first subagent: unavailable with one subagent; otherwise every other subagent can pass callers back, once', () => {
  assert.equal(template('back').unavailable(single()), 'There is only one subagent.');
  // new specialists come with the way back already (workflow/handoffRules.js)
  const made = template('specialists').apply(single()).config;
  assert.equal(template('back').unavailable(made), 'Every subagent can already pass callers back.');
  // with the way back taken from them, the template gives it back
  const three = JSON.parse(JSON.stringify(made));
  three.agents.items.slice(1).forEach((a) => (a.tools = (a.tools || []).filter((id) => !id.startsWith('back_to'))));
  assert.equal(template('back').unavailable(three), '');
  const done = template('back').apply(three);
  const [entry, ...rest] = done.config.agents.items;
  assert.ok(rest.every((a) => a.handoffs.some((h) => h.to === entry.id)));
  assert.equal(template('back').unavailable(done.config), 'Every subagent can already pass callers back.');
  assert.deepEqual(errorsOf(done.config), errorsOf(three));
});

test('Every subagent can end the conversation: each one that can’t yet is given the way to, and then it says there is nothing to add', () => {
  const three = template('specialists').apply(single()).config;
  const canEnd = (config, agent) =>
    (agent.tools || []).some((id) =>
      isBuiltin(
        (config.tools || []).find((t) => t.id === id),
        'end_call',
      ),
    );
  assert.equal(template('end').unavailable(three), '');
  const done = template('end').apply(three);
  assert.ok(done.config.agents.items.every((a) => canEnd(done.config, a)));
  assert.equal(template('end').unavailable(done.config), 'Every subagent can already end the conversation.');
  assert.deepEqual(errorsOf(done.config), errorsOf(three));
});

test('Back to the first subagent counts every way back a subagent already has (the built-in "back to the start" tool too)', () => {
  const config = JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
  assert.equal(template('back').unavailable(config), 'Every subagent can already pass callers back.');
});

test('Front desk with specialists writes each role to its own agent, whatever else the list of agents holds', () => {
  const config = single();
  config.agents.items.push(null);
  const items = template('specialists').apply(config).config.agents.items.filter(Boolean);
  assert.deepEqual(
    items.slice(1).map((a) => [a.name, a.instructions.role.split(' ')[2]]),
    [
      ['Sales', 'callers'],
      ['Support', 'callers'],
    ],
  );
});

test('sticky notes: a new one in the middle of what is in sight, with an id unlike the others; a list that is not notes reads as none', async () => {
  const { newNote, readNotes, NOTE_SIZE } = await import('../src/studio/workflow/notes.js');
  const first = newNote([], { x: 300, y: 200 });
  assert.deepEqual([first.id, first.x + NOTE_SIZE.w / 2, first.y + NOTE_SIZE.h / 2, first.text, first.color], ['::note::1', 300, 200, '', 'yellow']);
  assert.equal(newNote([first, { ...first, id: '::note::2' }], { x: 0, y: 0 }).id, '::note::3');
  // no browser storage (as in a test, or a locked-down browser): nothing, and no error
  assert.deepEqual(readNotes('any'), []);
});
