import { describe, expect, it } from 'vitest';
import {
  describeCondition,
  describeWhen,
  knowledgeBlocks,
  modelLines,
  normalizePrompt,
  onEnterLines,
  promptAdvice,
  promptRequest,
  stateLines,
  toolParameters,
  whatIfValue,
  whatIfVariables,
  withLocalOffset,
} from './promptPreview';

// What POST /preview/prompt answers (FRONTEND_GUIDE 10.1), trimmed.
const answer = {
  agent: { id: 'assistant', name: 'Acme' },
  channel: { id: 'phone', type: 'sip_voice' },
  instructions: 'You help with bills.\n\nBe brief.',
  sections: [
    { kind: 'role', label: 'Its role', text: 'You help with bills.', active: true },
    { kind: 'conditional', label: 'Only while', text: 'Billing only.', active: false, when: "{'state': 'intent', 'equals': 'billing'}" },
  ],
  greeting: 'Hello!',
  on_enter: [{ type: 'say', text: 'Hello again' }],
  tools: [
    { name: 'lookup', description: 'Gets the bill', offered: true, parameters: { type: 'object', properties: { account_id: { type: 'string' }, when: { type: ['string', 'null'] } }, required: ['account_id'] } },
    { name: 'ghost', offered: false, reason: 'not defined' },
  ],
  knowledge: { before_each_reply: [{ base: 'faq', top_k: 3 }] },
  models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } },
  state: { verified: true, pin: '•••' },
  stats: { words: 7, approx_tokens: 10, tools_offered: 1 },
  warnings: [{ path: ['tools'], message: 'One tool is not offered.' }],
};

describe('reading the server’s answer', () => {
  it('reads every part, whatever the agent and channel look like', () => {
    const p = normalizePrompt(answer);
    expect(p.agentName).toBe('Acme');
    expect(p.channelId).toBe('phone');
    expect(p.sections.map((s) => [s.kind, s.active])).toEqual([
      ['role', true],
      ['conditional', false],
    ]);
    expect(p.stats).toEqual({ words: 7, tokens: 10, toolsOffered: 1 });
    expect(p.warnings).toEqual(['One tool is not offered.']);
    expect(p.onEnter).toHaveLength(1);
    expect(normalizePrompt({ ...answer, agent: 'assistant', channel: null }).agentName).toBe('assistant');
  });

  it('a missing part is left out, never an error; no token count is made up', () => {
    const p = normalizePrompt({ instructions: 'one two three' });
    expect(p.stats).toEqual({ words: 3, tokens: 0, toolsOffered: 0 });
    expect(p.sections).toEqual([]);
    expect(normalizePrompt(null).instructions).toBe('');
  });

  it('advice: too long, too many tools, and tools that will not be offered, in words', () => {
    expect(promptAdvice(normalizePrompt(answer)).map((a) => a.id)).toEqual(['dropped']);
    expect(promptAdvice(normalizePrompt(answer))[0].text).toBe('1 tool will not be offered to the model: ghost (not defined).');
    const long = normalizePrompt({ ...answer, stats: { words: 2000, approx_tokens: 2700, tools_offered: 20 } });
    expect(promptAdvice(long).map((a) => a.id)).toEqual(['long', 'tools', 'dropped']);
    expect(promptAdvice(null)).toEqual([]);
  });
});

describe('the what-ifs', () => {
  it('only what was changed is sent, the caller’s number trimmed', () => {
    expect(promptRequest({ a: 1 }, {})).toEqual({ config: { a: 1 } });
    expect(promptRequest({}, { agent: 'billing', channel: 'phone', state: { verified: true, plan: '' }, now: '2026-10-14T03:00:00+08:00', callerPhone: ' +6561234567 ' })).toEqual({
      config: {},
      agent: 'billing',
      channel: 'phone',
      state: { verified: true },
      now: '2026-10-14T03:00:00+08:00',
      caller_phone: '+6561234567',
    });
  });

  it('the time picked is sent with the browser’s offset', () => {
    expect(withLocalOffset('2026-10-14T03:00', 480)).toBe('2026-10-14T03:00:00+08:00');
    expect(withLocalOffset('2026-10-14T03:00', -330)).toBe('2026-10-14T03:00:00-05:30');
    expect(withLocalOffset('', 0)).toBe('');
    expect(withLocalOffset('yesterday', 0)).toBe('');
  });

  it('a few simple state variables are offered, never a sensitive one, and typed values mean what they say', () => {
    const vars = whatIfVariables({ state: { variables: { verified: { type: 'boolean', default: false }, pin: { type: 'string', sensitive: true }, tries: { default: 0 } } } });
    expect(vars.map((v) => [v.name, v.type])).toEqual([
      ['verified', 'boolean'],
      ['tries', 'number'],
    ]);
    expect(whatIfValue('boolean', 'true')).toBe(true);
    expect(whatIfValue('integer', '3')).toBe(3);
    expect(whatIfValue('number', 'x')).toBeUndefined();
    expect(whatIfValue('string', '')).toBeUndefined();
  });
});

describe('conditions in words', () => {
  it('reads each kind of condition', () => {
    expect(describeCondition({ state: 'verified', equals: true })).toBe('the state verified is true');
    expect(describeCondition({ arg: 'n', gte: 3 })).toBe('the argument n is at least 3');
    expect(describeCondition({ channel: ['phone', 'web'] })).toBe('the channel is “phone”, “web”');
    expect(describeCondition({ all: [{ state: 'a', equals: 'x' }, { not: { state: 'b', in: ['y', 'z'] } }] })).toBe('the state a is “x” and not (the state b is one of “y”, “z”)');
    expect(describeCondition({ schedule: 'hours', open: false })).toBe('hours is closed');
  });

  it('the `when` of a block is put in words, whether an object, its JSON, or Python’s way of writing it', () => {
    const words = 'the state pending_request is set';
    expect(describeWhen({ state: 'pending_request', not_equals: null })).toBe(words);
    expect(describeWhen('{"state":"pending_request","not_equals":null}')).toBe(words);
    expect(describeWhen("{'state': 'pending_request', 'not_equals': None}")).toBe(words);
    expect(describeWhen({ state: 'plan', equals: null })).toBe('the state plan is not set');
    expect(describeWhen('only on weekdays')).toBe('only on weekdays');
    expect(describeWhen('{not json')).toBe('{not json');
    expect(describeWhen(undefined)).toBe('');
    expect(describeWhen(normalizePrompt(answer).sections[1].when)).toBe('the state intent is “billing”');
  });
});

describe('the looser parts, in words', () => {
  it('what runs when an agent takes over reads each action, and nothing means nothing', () => {
    expect(onEnterLines(undefined)).toEqual([]);
    const lines = onEnterLines([{ type: 'say', text: 'Hello again' }, 'something written', { type: 'set_state', values: { step: 'start' } }]);
    expect(lines[0]).toMatch(/Hello again/);
    expect(lines[1]).toBe('something written');
    expect(lines[2]).toBe('Set step to “start”');
  });

  it('knowledge: an array, an object of lists, an object of facts and a plain text all show; null shows nothing', () => {
    expect(knowledgeBlocks(null)).toEqual([]);
    expect(knowledgeBlocks([])).toEqual([]);
    expect(knowledgeBlocks(['faq'])).toEqual([{ heading: 'Knowledge searched', items: ['faq'] }]);
    const blocks = knowledgeBlocks({ before_each_reply: [{ base: 'faq', top_k: 3 }], tools: [{ tool: 'search_help', base: 'faq' }], note: 'built nightly' });
    expect(blocks.map((b) => b.heading)).toEqual(['Searched before every reply', 'Searched when the model asks', 'Note']);
    expect(blocks[0].items[0]).toBe('faq (top k 3)');
    expect(blocks[1].items[0]).toBe('search_help (base faq)');
    expect(knowledgeBlocks({ bases: [] })).toEqual([]);
  });

  it('models: each stage says its provider, model and the NAME of the secret; fallbacks follow; layers read too', () => {
    const lines = modelLines({
      llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' }, temperature: 0.3, fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }] },
      stt: { provider: 'deepgram', model: 'nova-3' },
      tts: null,
    });
    expect(lines.map((l) => l.label)).toEqual(['Thinking', 'Listening']);
    expect(lines[0].text).toMatch(/openai gpt-4\.1-mini/);
    expect(lines[0].text).toMatch(/temperature 0\.3/);
    expect(lines[0].text).toMatch(/uses the secret OPENAI_API_KEY/);
    expect(lines[0].text).toMatch(/then anthropic claude-sonnet-5-5/);
    expect(modelLines(null)).toEqual([]);
    const layered = modelLines([
      { layer: 'defaults', llm: { provider: 'openai', model: 'a' } },
      { layer: 'agent', llm: { provider: 'openai', model: 'b' } },
    ]);
    expect(layered.map((l) => l.label)).toEqual(['Defaults', 'Agent']);
    expect(layered[1].text).toMatch(/Thinking: openai b/);
  });

  it('state: values are listed, sensitive ones stay masked and are marked, unset is said', () => {
    expect(stateLines(null)).toEqual([]);
    expect(stateLines({ verified: true, pin: '•••', name: null, intent: 'billing' }).map((l) => [l.name, l.text, l.masked])).toEqual([
      ['verified', 'true', false],
      ['pin', '•••', true],
      ['name', 'not set', false],
      ['intent', 'billing', false],
    ]);
  });

  it('what it gives each tool: the parameters with their types, required ones marked', () => {
    expect(toolParameters(normalizePrompt(answer).tools)).toEqual([
      {
        name: 'lookup',
        params: [
          { name: 'account_id', type: 'string', required: true },
          { name: 'when', type: 'string or null', required: false },
        ],
      },
    ]);
  });
});
