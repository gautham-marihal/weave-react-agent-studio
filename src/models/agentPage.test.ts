import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import {
  entryAgentIndex,
  greetingHint,
  greetingOf,
  greetingTarget,
  readAgentPage,
  readDataFlow,
  setAgentName,
  setGreeting,
  setPersona,
  setRole,
  shareGreeting,
  staleNameParts,
  staleSentence,
} from './agentPage';

// The minimal draft POST /bots makes, with a role, a tone and a style rule written in.
const base = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'acme', name: 'Acme', version: '0.1.0', status: 'draft' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  persona: { name: 'Acme', tone: 'warm', style_rules: ['One question at a time.'] },
  channels: [{ id: 'web_chat', type: 'web_chat', enabled: true, greeting: { say: 'Hi! How can I help you today?' } }],
  agents: {
    entry: 'assistant',
    items: [{ id: 'assistant', name: 'Acme', instructions: { role: 'You are a customer care agent for Acme.', opening: 'Greet them.' }, tools: [] }],
  },
  messages: [],
});
const twoChannels = (): AgentConfig => ({
  ...base(),
  channels: [
    { id: 'web_chat', type: 'web_chat', enabled: true, greeting: { say: 'Hi there!' } },
    { id: 'phone', type: 'sip_voice', enabled: true, greeting: { say: 'Hi there!' } },
  ],
});
const says = (config: AgentConfig) => (config.channels ?? []).map((c) => c.greeting?.say);

describe('reading the Agent page', () => {
  it('reads the everyday settings out of the full configuration', () => {
    const read = readAgentPage(base());
    expect(read.name).toBe('Acme');
    expect(read.role).toMatch(/customer care agent/);
    expect(read.greeting).toMatch(/How can I help you today/);
    expect(read.agentId).toBe('assistant');
    expect(read.channels.map((c) => c.name)).toEqual(['Web chat']);
    expect(read.voiceChannel).toBe(false);
    expect(read.styleRules).toEqual(['One question at a time.']);
    expect(readAgentPage(twoChannels()).voiceChannel).toBe(true);
  });

  it('the agent that answers first is a real agent: a null or half-typed item is never chosen', () => {
    expect(entryAgentIndex({ agents: { items: [null as never, { id: 'a', name: 'A' }] } })).toBe(1);
    expect(entryAgentIndex({ agents: { entry: 'b', items: [null as never, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } })).toBe(2);
    expect(entryAgentIndex({ agents: { items: [null as never] } })).toBe(-1);
  });
});

describe('writing', () => {
  it('every setter changes only its own field and gives back the same object when nothing changes', () => {
    const config = base();
    expect(setRole(config, readAgentPage(config).role)).toBe(config);
    expect(setPersona(config, 'tone', 'warm')).toBe(config);
    expect(setGreeting(config, readAgentPage(config).greeting)).toBe(config);
    expect(setAgentName(config, 'Acme')).toBe(config);
    const next = setRole(config, 'You help with bills.');
    expect(next.agents?.items?.[0].instructions?.role).toBe('You help with bills.');
    expect(next.agents?.items?.[0].instructions?.opening).toBe('Greet them.');
    expect({ ...next, agents: null }).toEqual({ ...config, agents: null });
    expect(config.agents?.items?.[0].instructions?.role).toMatch(/^You are a customer care agent/);
  });

  it('renaming the agent renames what it calls itself only while the two were the same, also after emptying', () => {
    expect(setAgentName(base(), 'Bolt').persona?.name).toBe('Bolt');
    const custom = { ...base(), persona: { ...base().persona, name: 'Sam' } };
    expect(setAgentName(custom, 'Bolt').persona?.name).toBe('Sam');
    let config = setAgentName(base(), '');
    config = setAgentName(config, 'Sam');
    expect(config.meta?.name).toBe('Sam');
    expect(config.persona?.name).toBe('Sam');
  });

  it('tone, style rules, persona name and company are added and removed cleanly', () => {
    const config = base();
    expect(setPersona(config, 'tone', '').persona?.tone).toBeUndefined();
    expect(setPersona(config, 'style_rules', ['A', 'B']).persona?.style_rules).toEqual(['A', 'B']);
    expect('style_rules' in (setPersona(config, 'style_rules', []).persona ?? {})).toBe(false);
    expect(setPersona(config, 'company', 'Acme Ltd').persona?.company).toBe('Acme Ltd');
    expect(setPersona(config, 'shared_rules', ['Never guess.']).persona?.shared_rules).toEqual(['Never guess.']);
  });
});

describe('what it says first', () => {
  it('is changed where it is written: on the channel, or in the fixed line it points at (the main language’s text)', () => {
    const config = base();
    expect(setGreeting(config, 'Hi!').channels?.[0].greeting?.say).toBe('Hi!');
    const ref: AgentConfig = { ...config, channels: [{ id: 'web_chat', type: 'web_chat', enabled: true, greeting: { say: { message: 'hello' } } }], messages: [{ id: 'hello', text: 'Old' }] };
    const next = setGreeting(ref, 'New');
    expect((next.messages as Array<{ id: string; text: unknown }>).find((m) => m.id === 'hello')?.text).toBe('New');
    expect(next.channels?.[0].greeting?.say).toEqual({ message: 'hello' });
    expect(readAgentPage(ref).greetingIsReference).toBe(true);
    const langs: AgentConfig = { ...ref, defaults: { ...ref.defaults, language: { primary: 'en-US', speaks: ['en', 'es'] } }, messages: [{ id: 'hello', text: { en: 'Hello', es: 'Hola' } }] };
    expect((setGreeting(langs, 'Howdy').messages as Array<{ text: unknown }>)[0].text).toEqual({ en: 'Howdy', es: 'Hola' });
  });

  it('emptying it takes the greeting out (an empty one is refused), and the channels then wait for the caller', () => {
    const empty = setGreeting(twoChannels(), '');
    expect(says(empty)).toEqual([undefined, undefined]);
    expect(JSON.stringify(empty.channels)).not.toContain('"say":""');
    expect(readAgentPage(empty).greeting).toBe('');
    expect(greetingOf(empty).waiting).toEqual(['Web chat', 'Phone']);
  });

  it('emptied and typed again on one visit, the field writes to the channels it was for, and a fixed line is pointed at again', () => {
    const config = twoChannels();
    config.messages = [{ id: 'hello', text: 'Hello from Acme' }];
    (config.channels ?? []).forEach((c) => (c.greeting = { say: { message: 'hello' } }));
    const target = greetingTarget(config);
    const typed = setGreeting(setGreeting(config, '', target), 'Welcome to Acme', target);
    expect(says(typed)).toEqual([{ message: 'hello' }, { message: 'hello' }]);
    expect((typed.messages as Array<{ id: string; text: unknown }>).find((m) => m.id === 'hello')?.text).toBe('Welcome to Acme');
  });

  it('a channel that says something else first keeps it; it is shown, and shared only when asked', () => {
    const config = twoChannels();
    (config.channels ?? [])[1].greeting = { say: 'Thanks for calling Acme.' };
    const target = greetingTarget(config);
    const typed = setGreeting(config, 'Hello!', target);
    expect(says(typed)).toEqual(['Hello!', 'Thanks for calling Acme.']);
    const shown = greetingOf(typed, target);
    expect(shown.others).toEqual([{ name: 'Phone', text: 'Thanks for calling Acme.' }]);
    expect(greetingHint(shown)).toBe('Web chat says this. Phone says “Thanks for calling Acme.”.');
    expect(says(shareGreeting(typed, target))).toEqual(['Hello!', 'Hello!']);
  });

  it('the hint says who waits and who says it', () => {
    const three: AgentConfig = { ...base(), channels: [...(twoChannels().channels ?? []), { id: 'sms', type: 'sms', enabled: true, greeting: { say: 'Text us.' } }] };
    const target = greetingTarget(three);
    expect(greetingHint(greetingOf(setGreeting(three, '', target), target))).toBe('Web chat and Phone wait for the caller to start until you type a line here. SMS says “Text us.”.');
    expect(greetingHint(greetingOf(setGreeting(twoChannels(), '')))).toBe('Not set yet: type one and every channel will say it.');
    expect(greetingHint(greetingOf(twoChannels()))).toBe('Used on 2 channels.');
    const none: AgentConfig = { ...base(), channels: [{ id: 'web_chat', type: 'web_chat', enabled: true }] };
    expect(greetingHint(greetingOf(none))).toBe('Not set yet: type one and every channel will say it.');
  });
});

describe('after a rename', () => {
  it('offers to change the places that still say the old name, and changes them all when asked', () => {
    const config = setAgentName({ ...twoChannels(), persona: { name: 'Acme' } }, 'Bolt');
    const stillAcme: AgentConfig = { ...config, persona: { name: 'Acme' }, channels: (config.channels ?? []).map((c) => ({ ...c, greeting: { say: 'Welcome to Acme!' } })) };
    const parts = staleNameParts(stillAcme, 'Acme', 'Bolt');
    expect(parts.map((p) => p.words)).toEqual(['what it says first', 'the name it introduces itself by', 'its instructions']);
    expect(staleSentence(parts, 'Acme')).toBe('What it says first, the name it introduces itself by and its instructions still say “Acme”.');
    const fixed = parts.reduce((next, part) => part.change(next), stillAcme);
    expect(says(fixed)).toEqual(['Welcome to Bolt!', 'Welcome to Bolt!']);
    expect(fixed.persona?.name).toBe('Bolt');
    expect(fixed.agents?.items?.[0].instructions?.role).toBe('You are a customer care agent for Bolt.');
  });

  it('says nothing when nothing still says the old name, or the name did not change', () => {
    expect(staleNameParts(base(), 'Zed', 'Bolt')).toEqual([]);
    expect(staleNameParts(base(), 'Acme', 'Acme')).toEqual([]);
    const one = staleNameParts({ ...base(), persona: {} }, 'Acme', 'Bolt');
    expect(staleSentence(one, 'Acme')).toBe('Its instructions still say “Acme”.');
  });
});

describe('where conversations are processed', () => {
  it('names each provider once, with the stage each does', () => {
    const flow = readDataFlow({ defaults: { models: { stt: { provider: 'deepgram', model: 'nova-3' }, llm: { provider: 'openai', model: 'gpt-4.1-mini' }, tts: { provider: 'elevenlabs' } } } });
    expect(flow.chosen).toBe(true);
    expect(flow.sentence).toBe('Conversations are processed by Deepgram, OpenAI and ElevenLabs.');
    expect(flow.lines).toEqual(['Listening: Deepgram (nova-3)', 'Thinking: OpenAI (gpt-4.1-mini)', 'Speaking: ElevenLabs']);
    expect(readDataFlow({ defaults: { models: { llm: { provider: 'openai' } } } }).sentence).toBe('Conversations are processed by OpenAI.');
  });

  it('the call summary’s model counts, and nothing chosen is said, not hidden', () => {
    const flow = readDataFlow({ defaults: { models: { llm: { provider: 'openai' } } }, post_call: { summary: { enabled: true, llm: { provider: 'anthropic', model: 'claude' } } } });
    expect(flow.sentence).toMatch(/OpenAI and Anthropic/);
    expect(flow.lines).toContain('Call summaries: Anthropic (claude)');
    const none = readDataFlow({});
    expect(none.chosen).toBe(false);
    expect(none.sentence).toMatch(/No AI services are chosen yet/);
  });
});
