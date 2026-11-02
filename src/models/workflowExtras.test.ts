import { describe, expect, it } from 'vitest';
import type { AgentConfig, AgentRole } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { unknownKeys } from '../test/schemaKeys';
import {
  NOTE_SIZE,
  TEMPLATES,
  addEvent,
  addPhoneTransfer,
  addSay,
  addStateVariable,
  addTransferToAgent,
  addUpdateState,
  defaultInterrupt,
  defaultLlm,
  defaultVoice,
  describeEnterStep,
  interruptChoice,
  isBuiltin,
  llmChoice,
  llmOptions,
  moveEnterStep,
  newNote,
  readNotes,
  removeEnterStep,
  removeStateVariable,
  setInterrupt,
  setLlm,
  setVoice,
  stateNameProblem,
  voiceChoice,
  voiceOptions,
  workspaceAgents } from
'./workflowExtras';

const single = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'solo', name: 'Solo', version: '0.1.0', status: 'draft' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } } },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: {}, modalities: { input: ['text'], output: ['text'] } }],
  agents: { entry: 'front', items: [{ id: 'front', name: 'Front desk', kind: 'standalone', instructions: { role: 'Greets callers.' }, tools: [] }] }
});
const template = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};
const agentOf = (c: AgentConfig, id: string) => (c.agents?.items ?? []).find((a) => a.id === id) as AgentRole;

describe('on-enter steps', () => {
  it('adds a line to say and an update of state, reorders them, and takes them away, an empty list going', () => {
    let c = addSay(single(), 'front', 'Hello there');
    c = addStateVariable(c, 'plan', 'string');
    c = addUpdateState(c, 'front');
    expect(agentOf(c, 'front').on_enter).toEqual([{ type: 'say', text: 'Hello there' }, { type: 'set_state', values: { plan: '' } }]);
    expect(describeEnterStep((agentOf(c, 'front').on_enter as unknown[])[0], c)).toBe('Says “Hello there”');
    expect(describeEnterStep((agentOf(c, 'front').on_enter as unknown[])[1], c)).toBe('Remembers plan');
    c = moveEnterStep(c, 'front', 1, -1);
    expect((agentOf(c, 'front').on_enter as {type: string;}[]).map((s) => s.type)).toEqual(['set_state', 'say']);
    expect(moveEnterStep(c, 'front', 0, -1)).toBe(c);
    c = removeEnterStep(removeEnterStep(c, 'front', 0), 'front', 0);
    expect(agentOf(c, 'front').on_enter).toBeUndefined();
    expect(unknownKeys(addSay(single(), 'front'))).toEqual([]);
  });

  it('starts an update of state with nothing when there is no state yet, typed values otherwise', () => {
    expect(agentOf(addUpdateState(single(), 'front'), 'front').on_enter).toEqual([{ type: 'set_state', values: {} }]);
    const c = addUpdateState(addStateVariable(single(), 'tries', 'integer'), 'front');
    expect(agentOf(c, 'front').on_enter).toEqual([{ type: 'set_state', values: { tries: 0 } }]);
  });
});

describe('transfers', () => {
  it('to a phone number: a transfer and the tool that uses it; the same number again changes nothing', () => {
    const r = addPhoneTransfer(single(), 'front', '+44 20 7946 0000');
    const tool = r.config.tools?.find((t) => t.id === r.toolId);
    expect(isBuiltin(tool, 'transfer_or_callback')).toBe(true);
    expect(agentOf(r.config, 'front').tools).toContain(r.toolId);
    const transfer = r.config.telephony?.transfers?.[0];
    expect(transfer).toMatchObject({ method: 'sip_refer', target: '+44 20 7946 0000' });
    expect((tool?.params as {transfer: string;}).transfer).toBe(transfer.id);
    expect(unknownKeys(r.config)).toEqual([]);
    const again = addPhoneTransfer(r.config, 'front', '+442079460000');
    expect(again.config).toBe(r.config);
    expect(again.note).toMatch(/already transfers/);
    expect(addPhoneTransfer(single(), 'front', '  ').toolId).toBe('');
  });

  it('a transfer still waiting for a number is given it instead of a second one', () => {
    const c = single();
    c.telephony = { transfers: [{ id: 'human_support', description: 'A person.', method: 'sip_refer', target: '' }] };
    c.tools = [{ id: 'escalate', type: 'builtin', builtin: 'transfer_or_callback', description: 'x', params: { transfer: 'human_support' } }];
    agentOf(c, 'front').tools = ['escalate'];
    const r = addPhoneTransfer(c, 'front', '+15550100');
    expect(r.toolId).toBe('escalate');
    expect(r.config.telephony.transfers).toHaveLength(1);
    expect(r.config.telephony.transfers[0].target).toBe('+15550100');
  });

  it('to another agent of the workspace: through its number; an agent with no number can’t be chosen', () => {
    const others = workspaceAgents(
      [{ id: 'solo', name: 'Solo' }, { id: 'front-desk', name: 'Front Desk' }, { id: 'bookings', name: 'Bookings' }],
      [{ number: '+15550101', bot: 'front-desk', environment: 'development' }, { number: '+15550999', bot: { id: 'bookings' } }, { number: 'x' }],
      'solo'
    );
    expect(others.map((o) => [o.id, o.numbers.map((n) => n.number)])).toEqual([['front-desk', ['+15550101']], ['bookings', ['+15550999']]]);
    expect(workspaceAgents([{ id: 'a' }], { numbers: [{ number: '+1', bot: 'a' }] }, '')[0].numbers).toHaveLength(1);
    const r = addTransferToAgent(single(), 'front', others[0]);
    expect(r.config.telephony.transfers[0]).toMatchObject({ target: '+15550101', description: 'Transfer to Front Desk.' });
    expect(r.config.tools?.find((t) => t.id === r.toolId)?.description).toBe('The caller needs Front Desk.');
    expect(unknownKeys(r.config)).toEqual([]);
    expect(addTransferToAgent(r.config, 'front', others[0]).config).toBe(r.config);
    expect(addTransferToAgent(single(), 'front', { id: 'x', name: 'X', numbers: [] }).toolId).toBe('');
  });
});

describe('an agent’s own settings', () => {
  const answer: ProvidersAnswer = {
    providers: [
    { name: 'openai', stages: ['llm'], installed: true, key_available: true, default_secret: 'OPENAI_API_KEY' },
    { name: 'groq', stages: ['llm'], installed: true, key_available: false, default_secret: 'GROQ_API_KEY' }]

  } as unknown as ProvidersAnswer;

  it('uses the default AI model until it has its own; going back leaves no empty overrides', () => {
    const config = single();
    const agent = agentOf(config, 'front');
    expect(llmChoice(agent, config)).toBe('');
    expect(defaultLlm(config)).toBe('GPT-4.1 mini (OpenAI)');
    const same = setLlm(agent, 'openai|gpt-4.1', config, answer);
    expect(same.overrides).toEqual({ models: { llm: { model: 'gpt-4.1' } } });
    expect(llmChoice(same, config)).toBe('openai|gpt-4.1');
    const other = setLlm(agent, 'groq|llama-3.3-70b', config, answer);
    expect(other.overrides).toEqual({ models: { llm: { model: 'llama-3.3-70b', provider: 'groq', api_key: { secret: 'GROQ_API_KEY' } } } });
    expect(setLlm(other, 'openai|gpt-4.1', config).overrides).toEqual({ models: { llm: { model: 'gpt-4.1' } } });
    expect(agent.overrides).toBeUndefined();
    expect(setLlm(other, '', config).overrides).toBeUndefined();
    expect(setLlm(setInterrupt(other, false), '', config).overrides).toEqual({ conversation: { turn_handling: { interruption: { enabled: false } } } });
    expect(defaultLlm({})).toBe('Not chosen yet');
  });

  it('keeps its own model settings (a temperature) when the model changes or goes back to the default', () => {
    const config = single();
    const agent: AgentRole = { ...agentOf(config, 'front'), overrides: { models: { llm: { model: 'gpt-4.1', temperature: 0.2 } } } };
    expect(setLlm(agent, 'openai|gpt-4.1-mini', config).overrides).toEqual({ models: { llm: { model: 'gpt-4.1-mini', temperature: 0.2 } } });
    expect(setLlm(agent, '', config).overrides).toEqual({ models: { llm: { temperature: 0.2 } } });
  });

  it('offers the models of providers the server can run, and keeps an own choice not in the catalogue', () => {
    const config = single();
    const agent = agentOf(config, 'front');
    const groups = (o: {group: string;}[]) => [...new Set(o.map((x) => x.group))];
    expect(groups(llmOptions(agent, null, config)).length).toBeGreaterThan(1);
    expect(groups(llmOptions(agent, answer, config))).toEqual(['OpenAI', 'Groq']);
    const custom = setLlm(agent, 'openai|my-fine-tune', config);
    expect(llmOptions(custom, answer, config)[0]).toEqual({ value: 'openai|my-fine-tune', label: 'my-fine-tune', group: 'OpenAI' });
  });

  it('its own voice: the default engine’s voice alone; another engine brings its first model and key', () => {
    const config = single();
    config.defaults = { models: { ...config.defaults?.models, tts: { provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice_id: 'EXAVITQu4vr4xnSDxMaL' } } };
    const agent = agentOf(config, 'front');
    expect(voiceChoice(agent, config)).toBe('');
    expect(defaultVoice(config)).toBe('Sarah (ElevenLabs)');
    const cartesia = voiceOptions(agent, config).find((o) => o.group === 'Cartesia');
    expect(cartesia).toBeTruthy();
    const same = setVoice(agent, 'elevenlabs|cgSgspJ2msm6clMCkdW9', config);
    expect(same.overrides).toEqual({ models: { tts: { voice_id: 'cgSgspJ2msm6clMCkdW9' } } });
    const own = setVoice(agent, String(cartesia?.value), config);
    expect(own.overrides).toMatchObject({ models: { tts: { provider: 'cartesia', model: 'sonic-3', api_key: { secret: 'CARTESIA_API_KEY' } } } });
    expect(setVoice(own, '', config).overrides).toBeUndefined();
  });

  it('whether callers can interrupt it: the default, its own yes or no, and back', () => {
    const config = single();
    const agent = agentOf(config, 'front');
    expect(interruptChoice(agent)).toBeUndefined();
    expect(defaultInterrupt(config)).toBe(true);
    expect(defaultInterrupt({ defaults: { conversation: { turn_handling: { interruption: { enabled: false } } } } })).toBe(false);
    const off = setInterrupt(agent, false);
    expect(interruptChoice(off)).toBe(false);
    expect(setInterrupt(off, undefined).overrides).toBeUndefined();
  });
});

describe('templates', () => {
  it('Front desk with specialists adds Sales and Support, told what they do, and the first agent passes callers to both', () => {
    const config = single();
    const done = template('specialists').apply(config);
    const items = done.config.agents?.items ?? [];
    expect(items.map((a) => a.name)).toEqual(['Front desk', 'Sales', 'Support']);
    expect(items.slice(1).every((a) => String(a.instructions?.role).length > 20)).toBe(true);
    expect((items[0].handoffs ?? []).map((h: {to: string;}) => h.to)).toEqual([items[1].id, items[2].id]);
    expect((items[0].handoffs ?? []).every((h: {description: string;}) => h.description.trim())).toBe(true);
    expect(items[0].kind).toBe('router');
    expect(done.select).toBe(items[1].id);
    expect(done.note).toMatch(/Added Sales and Support/);
    expect(config.agents?.items).toHaveLength(1);
    expect(unknownKeys(done.config)).toEqual([]);
  });

  it('Back to the first agent: unavailable with one agent; otherwise every other agent can pass callers back, once', () => {
    expect(template('back').unavailable(single())).toBe('There is only one agent.');
    const three = template('specialists').apply(single()).config;
    expect(template('back').unavailable(three)).toBe('');
    const done = template('back').apply(three);
    const [entry, ...rest] = done.config.agents?.items ?? [];
    expect(rest.every((a) => (a.handoffs ?? []).some((h: {to: string;}) => h.to === entry.id))).toBe(true);
    expect(template('back').unavailable(done.config)).toBe('Every agent can already pass callers back.');
    expect(unknownKeys(done.config)).toEqual([]);
  });

  it('Back to the first agent counts the built-in “back to the start” tool as a way back', () => {
    const three = template('specialists').apply(single()).config;
    three.tools = [{ id: 'back', type: 'builtin', builtin: 'return_to_entry', description: 'Back.' }];
    (three.agents?.items ?? []).slice(1).forEach((a) => {
      a.tools = ['back'];
    });
    expect(template('back').unavailable(three)).toBe('Every agent can already pass callers back.');
  });

  it('Every agent can end the conversation: one shared goodbye tool, then nothing more to add', () => {
    const three = template('specialists').apply(single()).config;
    expect(template('end').unavailable(three)).toBe('');
    const done = template('end').apply(three);
    const ends = (done.config.tools ?? []).filter((t) => isBuiltin(t, 'end_call'));
    expect(ends).toHaveLength(1);
    expect((done.config.agents?.items ?? []).every((a) => (a.tools ?? []).includes(ends[0].id))).toBe(true);
    expect(template('end').unavailable(done.config)).toBe('Every agent can already end the conversation.');
    expect(unknownKeys(done.config)).toEqual([]);
  });

  it('Front desk with specialists writes each role to its own agent, whatever else the list holds', () => {
    const config = single();
    (config.agents?.items as unknown[]).push(null);
    const items = template('specialists').apply(config).config.agents?.items?.filter(Boolean) ?? [];
    expect(items.slice(1).map((a) => [a.name, String(a.instructions?.role).split(' ')[2]])).toEqual([['Sales', 'callers'], ['Support', 'callers']]);
  });
});

describe('state and events', () => {
  it('adds a state variable by the schema’s rules, refuses a bad or taken name, and removes it', () => {
    expect(stateNameProblem(single(), 'Plan')).toMatch(/lowercase/);
    const c = addStateVariable(single(), 'plan', 'enum');
    expect(c.state).toEqual({ variables: { plan: { type: 'enum', values: ['first'] } } });
    expect(stateNameProblem(c, 'plan')).toMatch(/already/);
    expect(addStateVariable(c, 'plan', 'string')).toBe(c);
    expect(removeStateVariable(c, 'plan').state).toBeUndefined();
    expect(unknownKeys(c)).toEqual([]);
  });
  it('adds an event hook with nothing to do yet', () => {
    expect(addEvent(single(), 'call_started').events).toEqual([{ on: 'call_started', do: [] }]);
  });
});

describe('sticky notes', () => {
  it('a new one sits in the middle of what is in sight, with an id unlike the others; no storage reads as none', () => {
    const first = newNote([], { x: 300, y: 200 });
    expect([first.id, first.x + NOTE_SIZE.w / 2, first.y + NOTE_SIZE.h / 2, first.text, first.color]).toEqual(['::note::1', 300, 200, '', 'yellow']);
    expect(newNote([first, { ...first, id: '::note::2' }], { x: 0, y: 0 }).id).toBe('::note::3');
    expect(readNotes('any')).toEqual([]);
  });
});

describe('where a new block goes', () => {
  it('below the place wanted when that is taken, never on top of another block', async () => {
    const { freePlace } = await import('./workflowExtras');
    const taken = [{ x: 0, y: 0, w: 200, h: 80 }, { x: 0, y: 104, w: 200, h: 80 }];
    expect(freePlace({ x: 300, y: 0 }, { w: 200, h: 80 }, taken)).toEqual({ x: 300, y: 0 });
    expect(freePlace({ x: 0, y: 0 }, { w: 200, h: 80 }, taken)).toEqual({ x: 0, y: 208 });
  });
});
