import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { starters } from '../data/starters';
import { unknownKeys } from '../test/schemaKeys';
import {
  KNOWLEDGE_ID,
  actionsOf,
  addKnowledgeFile,
  addKnowledgePage,
  applyStarter,
  botIdProblem,
  cleanUrl,
  freeBotId,
  isStarterRole,
  knowledgeOf,
  numberProblem,
  reachOf,
  removeKnowledge,
  setDetails,
  setEndCall,
  setHandOver,
  setLookup,
  setReach,
  stepForPath,
  stepStates,
  voicesFor,
  withMainLanguage,
} from './setup';

// The minimal draft POST /bots makes (read from the live API).
const fresh = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'smile-dental', name: 'Smile Dental', version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
  persona: { name: 'Smile Dental' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'smile-dental-widget' }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hello! How can I help you today?' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Smile Dental', kind: 'standalone', instructions: { role: 'You are a helpful assistant. Answer briefly and politely.' }, tools: [] }] },
});
const care = () => applyStarter(fresh(), { company: 'Smile Dental', starter: starters[0] });
const entry = (c: AgentConfig) => c.agents?.items?.find((a) => a.id === c.agents?.entry);
const PROVIDERS: ProvidersAnswer = {
  providers: [
    { name: 'deepgram', stages: ['stt'], installed: true, key_available: false, realtime_runnable: false, plugin: '', default_secret: 'DEEPGRAM_API_KEY' },
    { name: 'openai', stages: ['stt', 'llm', 'tts'], installed: true, key_available: true, realtime_runnable: true, plugin: '', default_secret: 'OPENAI_API_KEY' },
    { name: 'elevenlabs', stages: ['stt', 'tts'], installed: true, key_available: true, realtime_runnable: false, plugin: '', default_secret: 'ELEVEN_API_KEY' },
  ],
  stages: {},
  turn_detectors: [],
} as unknown as ProvidersAnswer;

describe('language', () => {
  it('an agent with no main language gets the person’s own; one that has one keeps it (same object)', () => {
    const given = withMainLanguage(fresh(), ['en-GB']);
    expect(given.defaults?.language).toEqual({ primary: 'en-GB', speaks: ['en'] });
    expect(withMainLanguage(given, ['fr-FR'])).toBe(given);
  });

  it('voices listed are the ones that speak the language, for the provider', () => {
    const es = voicesFor('cartesia', 'es-MX');
    expect(es.length).toBeGreaterThan(0);
    expect(es.every((v) => v.locale.startsWith('es'))).toBe(true);
    expect(voicesFor('elevenlabs', 'en-GB').every((v) => v.provider === 'ElevenLabs' && v.locale.startsWith('en'))).toBe(true);
    expect(voicesFor(undefined, 'en-US')).toEqual([]);
  });
});

describe('where people reach it', () => {
  it('switches on and off, the last one stays, and switching on says what came with it', () => {
    let config = care();
    expect(reachOf(config)).toEqual({ web_chat: true, web_voice: false, sip_voice: false });
    const refused = setReach(config, 'web_chat', false);
    expect(refused.refused).toMatch(/at least one way/);
    expect(refused.config).toBe(config);

    const phone = setReach(config, 'sip_voice', true, { providers: PROVIDERS, botId: 'smile-dental' });
    expect(phone.refused).toBe('');
    config = phone.config;
    expect(reachOf(config).sip_voice).toBe(true);
    const line = config.channels?.find((c) => c.type === 'sip_voice');
    expect(line?.greeting?.say).toBe(care().channels?.[0].greeting?.say);
    expect(config.defaults?.models?.stt).toEqual({ provider: 'openai', model: 'gpt-4o-transcribe' });
    expect(config.defaults?.models?.tts?.provider).toBe('elevenlabs');
    expect(config.defaults?.models?.tts?.model).toBe('eleven_flash_v2_5');
    expect(typeof config.defaults?.models?.tts?.voice_id).toBe('string');
    expect(config.persona?.disclosures?.recording_notice).toMatch(/recorded/);
    expect(phone.added.join(', ')).toMatch(/phone calls channel.*speech recognition.*voice.*recording notice/);

    config = setReach(config, 'web_chat', false).config;
    expect(reachOf(config)).toEqual({ web_chat: false, web_voice: false, sip_voice: true });
    expect(config.channels?.some((c) => c.type === 'web_chat' && c.enabled === false)).toBe(true);
    config = setReach(config, 'web_chat', true).config;
    expect(config.channels?.filter((c) => c.type === 'web_chat').length).toBe(1);
    expect(unknownKeys(config)).toEqual([]);
  });

  it('no provider reported: no speech models are invented', () => {
    const r = setReach(care(), 'web_voice', true, { providers: null });
    expect(r.config.defaults?.models?.tts).toBeUndefined();
    expect(r.added.some((a) => a.includes('voice ('))).toBe(false);
  });
});

describe('what it knows', () => {
  it('documents and pages go into one base the answering agent reads, which goes when it is empty', () => {
    let config = care();
    config = addKnowledgeFile(config, 'faq.md');
    config = addKnowledgeFile(config, 'faq.md');
    config = addKnowledgePage(config, 'https://smile.example/prices');
    expect(knowledgeOf(config)).toEqual({ files: ['faq.md'], pages: ['https://smile.example/prices'], depths: { 'https://smile.example/prices': 0 }, attached: true });
    const site = addKnowledgePage(config, 'https://smile.example/', { linked: true });
    expect(knowledgeOf(site).depths['https://smile.example/']).toBe(1);
    const again = addKnowledgePage(site, 'https://smile.example/');
    expect(knowledgeOf(again).depths['https://smile.example/']).toBe(0);
    expect(knowledgeOf(again).pages.filter((u) => u === 'https://smile.example/').length).toBe(1);
    const base = (config.knowledge as Array<{ id: string; mode: string }>).find((b) => b.id === KNOWLEDGE_ID);
    expect(base?.mode).toBe('inject');
    expect(entry(config)?.knowledge).toContain(KNOWLEDGE_ID);
    expect(unknownKeys(site)).toEqual([]);

    config = removeKnowledge(config, 'file', 'faq.md').config;
    config = removeKnowledge(config, 'url', 'https://smile.example/prices').config;
    expect(config.knowledge).toBeUndefined();
    expect(entry(config)?.knowledge).toBeUndefined();
  });

  it('the last document stays while a tool searches the base', () => {
    let config = addKnowledgeFile(care(), 'faq.md');
    config = { ...config, tools: [...(config.tools ?? []), { id: 'search_faq', type: 'knowledge', source: KNOWLEDGE_ID } as never] };
    const r = removeKnowledge(config, 'file', 'faq.md');
    expect(r.refused).toMatch(/search_faq tool searches these/);
    expect(r.config).toBe(config);
  });

  it('a web address a person typed is made whole, or refused', () => {
    expect(cleanUrl('smile.example/help')).toBe('https://smile.example/help');
    expect(cleanUrl('  http://smile.example  ')).toBe('http://smile.example/');
    expect(cleanUrl('localhost')).toBe('');
    expect(cleanUrl('not a page')).toBe('');
    expect(cleanUrl('')).toBe('');
  });
});

describe('what it can do', () => {
  it('ending the conversation switches on with its goodbye, and goes when switched off', () => {
    let config = setEndCall(fresh(), true);
    expect(actionsOf(config).end_call.on).toBe(true);
    expect((config.messages as Array<{ id: string }>).some((m) => m.id === 'goodbye')).toBe(true);
    expect(unknownKeys(config)).toEqual([]);
    config = setEndCall(config, false);
    expect(actionsOf(config).end_call.on).toBe(false);
    expect((config.tools ?? []).some((t) => t.id === 'end_call')).toBe(false);
    expect(config.messages).toBeUndefined();
  });

  it('passing to a person brings its transfer and callback line; off, they go', () => {
    let config = setHandOver(fresh(), true, { number: ' +6561234567 ' });
    expect(actionsOf(config).hand_over).toEqual({ on: true, number: '+6561234567' });
    expect(unknownKeys(config)).toEqual([]);
    config = setHandOver(config, false);
    expect(actionsOf(config).hand_over.on).toBe(false);
    expect(config.telephony).toBeUndefined();
  });

  it('a number to pass calls to needs its country code (or a SIP address)', () => {
    expect(numberProblem('+65 6123 4567')).toBe('');
    expect(numberProblem('sip:desk@pbx.example.com')).toBe('');
    expect(numberProblem('6123 4567')).toMatch(/country code/);
    expect(numberProblem('+12')).toMatch(/whole number/);
  });

  it('contact details are a form and the tool that shows it; on the phone it asks in words', () => {
    let config = setDetails(fresh(), true, { fields: ['name', 'email'] });
    expect(actionsOf(config).details).toEqual({ on: true, fields: ['name', 'email'] });
    const form = (config.forms as Array<{ id: string; fields: Array<{ required?: boolean }>; otherwise: Array<{ text: string }> }>).find((f) => f.id === 'contact_details');
    expect(form?.fields[0].required).toBe(true);
    expect(form?.otherwise[0].text).toMatch(/your name and email\?/);
    expect(entry(config)?.tools).toContain('collect_details');
    expect(unknownKeys(config)).toEqual([]);
    config = setDetails(config, false);
    expect(config.forms).toBeUndefined();
    expect(actionsOf(config).details.on).toBe(false);
  });

  it('a lookup turns a typed address into a connection and a tool, and reads back the same', () => {
    const made = setLookup(fresh(), true, { url: 'https://shop.example.com/orders/{order number}', finds: 'an order', needs: 'order number' });
    expect(made.problem).toBe('');
    const config = made.config;
    expect((config.connections as Record<string, unknown>).your_system).toEqual({ type: 'http', base_url: 'https://shop.example.com' });
    const tool = (config.tools ?? []).find((t) => t.id === 'look_up') as unknown as { request: { path: string }; parameters: { required: string[] } };
    expect(tool.request.path).toBe('/orders/{{args.order_number}}');
    expect(tool.parameters.required).toEqual(['order_number']);
    expect(actionsOf(config).lookup).toEqual({ on: true, url: 'https://shop.example.com/orders/{order number}', finds: 'an order', needs: 'order number' });
    expect(unknownKeys(config)).toEqual([]);

    const query = setLookup(fresh(), true, { url: 'shop.example.com/find', finds: 'an order', needs: 'order number' }).config;
    expect(((query.tools ?? []).find((t) => t.id === 'look_up') as unknown as { request: { query: unknown } }).request.query).toEqual({ order_number: '{{args.order_number}}' });
    expect(setLookup(fresh(), true, { url: 'nowhere', needs: 'x' }).problem).toMatch(/web address/);
    expect(setLookup(fresh(), true, { url: 'https://shop.example.com/{x}', needs: ' ' }).problem).toMatch(/needs from the person/);

    const off = setLookup(config, false).config;
    expect(off.connections).toBeUndefined();
    expect(actionsOf(off).lookup.on).toBe(false);
  });

  it('a tool that another agent also uses is kept when switched off for the first one', () => {
    let config = setEndCall(fresh(), true);
    config = { ...config, agents: { ...config.agents, items: [...(config.agents?.items ?? []), { id: 'billing', name: 'Billing', kind: 'standalone', instructions: { role: 'x' }, tools: ['end_call'] }] } };
    const off = setEndCall(config, false);
    expect((off.tools ?? []).some((t) => t.id === 'end_call')).toBe(true);
    expect(actionsOf(off).end_call.on).toBe(false);
  });
});

describe('starters', () => {
  it('every starter makes a different agent with only real config keys', () => {
    const made = starters.filter((s) => s.id !== 'blank').map((s) => applyStarter(fresh(), { company: 'Acme', starter: s }));
    made.forEach((c) => expect(unknownKeys(c)).toEqual([]));
    expect(new Set(made.map((c) => c.agents?.items?.[0].instructions?.role)).size).toBe(made.length);
  });

  it('keeps the agent’s own id, version and models, and does not change its input', () => {
    const input = fresh();
    const before = JSON.stringify(input);
    const c = applyStarter(input, { company: 'Acme', starter: starters[0] });
    expect(JSON.stringify(input)).toBe(before);
    expect(c.meta?.id).toBe('smile-dental');
    expect(c.meta?.version).toBe('0.1.0');
    expect(c.defaults?.models).toEqual(input.defaults?.models);
  });

  it('applying twice changes nothing more', () => {
    const once = applyStarter(fresh(), { company: 'Acme', starter: starters[1] });
    expect(applyStarter(once, { company: 'Acme', starter: starters[1] })).toEqual(once);
  });

  it('blank leaves the server’s draft as it is (apart from the main language)', () => {
    const c = applyStarter(fresh(), { company: 'Acme', starter: starters[starters.length - 1], languages: [] });
    expect({ ...c, defaults: { ...c.defaults, language: undefined } }).toEqual({ ...fresh(), defaults: { ...fresh().defaults, language: undefined } });
  });

  it('starters that may need a person give the agent the tool for it', () => {
    expect(actionsOf(care()).hand_over.on).toBe(true);
    expect(actionsOf(care()).end_call.on).toBe(true);
  });
});

describe('steps', () => {
  it('where each step stands', () => {
    const blank = stepStates(fresh(), { starters });
    expect(blank.purpose).toBe('todo');
    expect(blank.voice).toBe('todo');
    expect(blank.knowledge).toBe('optional');
    expect(blank.actions).toBe('optional');
    expect(blank.try).toBe('todo');
    expect(blank.live).toBe('todo');

    expect(stepStates(care(), { starters }).purpose).toBe('todo');
    expect(isStarterRole(starters[0].instructions, starters)).toBe(true);
    expect(isStarterRole(`${starters[0].instructions} We are Smile Dental, open 8 to 6.`, starters)).toBe(false);
    expect(isStarterRole('', starters)).toBe(false);

    let ready = withMainLanguage(care(), ['en-US']);
    ready = { ...ready, agents: { ...ready.agents, items: (ready.agents?.items ?? []).map((a) => ({ ...a, instructions: { role: 'You answer the phone for Smile Dental. Help people book a check-up and answer questions about prices.' } })) } };
    const states = stepStates(ready, { tried: true, deployed: { staging: '0.1.0' }, starters });
    expect(states).toMatchObject({ purpose: 'done', reach: 'done', voice: 'done', actions: 'done', try: 'done', live: 'done' });
    expect(stepStates(setReach(ready, 'sip_voice', true, { providers: null }).config).voice).toBe('todo');
  });

  it('a problem the server found belongs to the step that asks for it', () => {
    expect(stepForPath(['agents', 'items', 0, 'instructions'])).toBe('purpose');
    expect(stepForPath(['messages', 0])).toBe('purpose');
    expect(stepForPath(['channels', 1, 'greeting'])).toBe('reach');
    expect(stepForPath(['defaults', 'models', 'tts', 'voice_id'])).toBe('voice');
    expect(stepForPath(['knowledge', 0])).toBe('knowledge');
    expect(stepForPath(['telephony', 'transfers', 0, 'target'])).toBe('actions');
    expect(stepForPath(['runtime'])).toBe('');
    expect(stepForPath(undefined)).toBe('');
  });

  it('a new agent’s id comes from its name and is always free; one typed under Advanced is checked', () => {
    expect(freeBotId('Smile Dental', [])).toBe('smile-dental');
    expect(freeBotId('Smile Dental', ['smile-dental'])).toBe('smile-dental-2');
    expect(freeBotId('Smile Dental', ['smile-dental', 'smile-dental-2'])).toBe('smile-dental-3');
    expect(freeBotId('123 Café!', [])).toBe('cafe');
    expect(freeBotId('', [])).toBe('agent');
    expect(freeBotId('Logs', [])).toBe('logs-2');
    expect(botIdProblem('Smile', [])).toMatch(/lowercase/);
    expect(botIdProblem('gm', ['gm'])).toMatch(/Another agent/);
    expect(botIdProblem('tmp', [])).toMatch(/reserved/);
    expect(botIdProblem('smile-dental', [])).toBe('');
  });
});
