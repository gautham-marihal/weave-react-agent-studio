import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';
import { applyStarter } from '../src/studio/starters.js';
import { readSimple, setRole } from '../src/studio/simple/simpleModel.js';
import {
  KNOWLEDGE_ID,
  actionsOf,
  addKnowledgeFile,
  addKnowledgePage,
  cleanUrl,
  defaultLanguage,
  isStarterRole,
  knowledgeOf,
  reachOf,
  removeKnowledge,
  setDetails,
  setEndCall,
  setHandOver,
  setLookup,
  setReach,
  stepForPath,
  stepStates,
  withMainLanguage,
} from '../src/studio/setup/setupModel.js';
import { inSetup } from '../src/studio/setup/setupProgress.js';

// The guided setup of the New layout (src/studio/setup): what each step reads from an agent and writes into it. Each change must be complete on its own, so a
// person never has to go to a second place to make the first one work.
const fresh = () => minimalConfig('smile-dental', 'Smile Dental');
const care = () => applyStarter(fresh(), 'support');
const entry = (config) => config.agents.items.find((a) => a.id === config.agents.entry);
const PROVIDERS = [
  { name: 'deepgram', stages: ['stt'], installed: true, key_available: true },
  { name: 'cartesia', stages: ['stt', 'tts'], installed: true, key_available: true },
];

test('setup: the main language starts as the person’s own, by exact code, then by base language, else English (US)', () => {
  assert.equal(defaultLanguage(['en-GB', 'en']), 'en-GB');
  assert.equal(defaultLanguage(['fr']), 'fr-FR');
  assert.equal(defaultLanguage(['EN-au']), 'en-AU');
  assert.equal(defaultLanguage(['xx-YY', 'de-AT']), 'de-DE');
  assert.equal(defaultLanguage(['xx']), 'en-US');
  assert.equal(defaultLanguage([]), 'en-US');
  assert.equal(defaultLanguage(undefined), 'en-US');
  assert.equal(defaultLanguage(['', null]), 'en-US');
});

test('setup: an agent with no main language is given one; an agent with one keeps it', () => {
  const given = withMainLanguage(fresh(), ['en-GB']);
  assert.equal(readSimple(given).primaryLanguage, 'en-GB');
  assert.deepEqual(given.defaults.language.speaks, ['en']);
  const kept = withMainLanguage(given, ['fr-FR']);
  assert.equal(kept, given, 'unchanged, the same object');
});

test('setup: ways of reaching it switch on and off, and the last one stays', () => {
  let config = care();
  assert.deepEqual(reachOf(config), { web_chat: true, web_voice: false, sip_voice: false });
  const refused = setReach(config, 'web_chat', false);
  assert.match(refused.refused, /at least one way/);
  assert.equal(refused.config, config);

  const phone = setReach(config, 'sip_voice', true, { providers: PROVIDERS, botId: 'smile-dental' });
  assert.equal(phone.refused, '');
  config = phone.config;
  assert.equal(reachOf(config).sip_voice, true);
  const line = config.channels.find((c) => c.type === 'sip_voice');
  assert.equal(line.greeting.say, readSimple(care()).greeting, 'a new channel says the line the agent already says');
  assert.ok(config.defaults.models.stt?.provider && config.defaults.models.tts?.provider, 'the first voice channel brings speech models');
  assert.match(config.persona.disclosures.recording_notice, /recorded/);

  config = setReach(config, 'web_chat', false).config;
  assert.deepEqual(reachOf(config), { web_chat: false, web_voice: false, sip_voice: true });
  assert.ok(
    config.channels.some((c) => c.type === 'web_chat' && c.enabled === false),
    'switched off, not deleted',
  );
  config = setReach(config, 'web_chat', true).config;
  assert.equal(config.channels.filter((c) => c.type === 'web_chat').length, 1, 'switched back on, not added twice');
});

test('setup: documents and web pages go into one base the answering agent reads, which goes when it is empty', () => {
  let config = care();
  config = addKnowledgeFile(config, 'faq.md');
  config = addKnowledgeFile(config, 'faq.md');
  config = addKnowledgePage(config, 'https://smile.example/prices');
  assert.deepEqual(knowledgeOf(config), {
    files: ['faq.md'],
    pages: ['https://smile.example/prices'],
    depths: { 'https://smile.example/prices': 0 },
    attached: true,
  });
  // a website's home page can bring the pages it links to; adding a page again takes the new choice, once
  const site = addKnowledgePage(config, 'https://smile.example/', { linked: true });
  assert.equal(knowledgeOf(site).depths['https://smile.example/'], 1);
  const again = addKnowledgePage(site, 'https://smile.example/');
  assert.equal(knowledgeOf(again).depths['https://smile.example/'], 0);
  assert.equal(knowledgeOf(again).pages.filter((u) => u === 'https://smile.example/').length, 1);
  const base = config.knowledge.find((b) => b.id === KNOWLEDGE_ID);
  assert.equal(base.mode, 'inject');
  assert.ok(entry(config).knowledge.includes(KNOWLEDGE_ID));

  config = removeKnowledge(config, 'file', 'faq.md').config;
  config = removeKnowledge(config, 'url', 'https://smile.example/prices').config;
  assert.equal(config.knowledge, undefined);
  assert.equal(entry(config).knowledge, undefined);
});

test('setup: a web address a person typed is made whole, or refused', () => {
  assert.equal(cleanUrl('smile.example/help'), 'https://smile.example/help');
  assert.equal(cleanUrl('  http://smile.example  '), 'http://smile.example/');
  assert.equal(cleanUrl('localhost'), '');
  assert.equal(cleanUrl('not a page'), '');
  assert.equal(cleanUrl(''), '');
});

test('setup: ending the conversation and passing to a person switch on with everything they need', () => {
  let config = setEndCall(fresh(), true);
  assert.equal(actionsOf(config).end_call.on, true);
  assert.ok(
    config.messages.some((m) => m.id === 'goodbye'),
    'the goodbye it says',
  );
  config = setEndCall(config, false);
  assert.equal(actionsOf(config).end_call.on, false);
  assert.ok(!config.tools.some((t) => t.id === 'end_call'), 'taken out when no agent has it');

  config = setHandOver(fresh(), true, { number: ' +6561234567 ' });
  const hand = actionsOf(config).hand_over;
  assert.deepEqual(hand, { on: true, number: '+6561234567' });
  config = setHandOver(config, false);
  assert.equal(actionsOf(config).hand_over.on, false);
  assert.ok(!(config.telephony?.transfers || []).length, 'its transfer goes with it');
});

test('setup: contact details are a form and the tool that shows it; on the phone it asks in words', () => {
  let config = setDetails(fresh(), true, { fields: ['name', 'email'] });
  const details = actionsOf(config).details;
  assert.deepEqual(details, { on: true, fields: ['name', 'email'] });
  const form = config.forms.find((f) => f.id === 'contact_details');
  assert.equal(form.fields[0].required, true);
  assert.match(form.otherwise[0].text, /your name and email\?/);
  assert.ok(entry(config).tools.includes('collect_details'));
  config = setDetails(config, false);
  assert.equal(config.forms, undefined);
  assert.equal(actionsOf(config).details.on, false);
});

test('setup: a lookup turns a typed address into a connection and a tool, and reads back the same', () => {
  const made = setLookup(fresh(), true, { url: 'https://shop.example.com/orders/{order number}', finds: 'an order', needs: 'order number' });
  assert.equal(made.problem, '');
  const config = made.config;
  assert.deepEqual(config.connections.your_system, { type: 'http', base_url: 'https://shop.example.com' });
  const tool = config.tools.find((t) => t.id === 'look_up');
  assert.equal(tool.request.path, '/orders/{{args.order_number}}');
  assert.deepEqual(tool.parameters.required, ['order_number']);
  assert.deepEqual(actionsOf(config).lookup, {
    on: true,
    url: 'https://shop.example.com/orders/{order number}',
    finds: 'an order',
    needs: 'order number',
  });

  const query = setLookup(fresh(), true, { url: 'shop.example.com/find', finds: 'an order', needs: 'order number' }).config;
  assert.deepEqual(query.tools.find((t) => t.id === 'look_up').request.query, { order_number: '{{args.order_number}}' }, 'no brackets: a query value');

  assert.match(setLookup(fresh(), true, { url: 'nowhere', needs: 'x' }).problem, /web address/);
  assert.match(setLookup(fresh(), true, { url: 'https://shop.example.com/{x}', needs: ' ' }).problem, /needs from the person/);

  const off = setLookup(config, false).config;
  assert.equal(off.connections, undefined);
  assert.equal(actionsOf(off).lookup.on, false);
});

test('setup: where each step stands', () => {
  const blank = stepStates(fresh());
  assert.equal(blank.purpose, 'todo', 'the minimal instructions do not count');
  assert.equal(blank.voice, 'todo', 'no main language');
  assert.equal(blank.knowledge, 'optional');
  assert.equal(blank.try, 'todo');
  assert.equal(blank.live, 'todo');

  // a starter's own words, untouched, still ask for more; made the business's own, the step is done
  assert.equal(stepStates(care()).purpose, 'todo');
  assert.ok(isStarterRole(readSimple(care()).role));
  assert.ok(!isStarterRole(`${readSimple(care()).role} We are Smile Dental, open 8 to 6.`));
  assert.ok(!isStarterRole(''));
  const ready = withMainLanguage(setRole(care(), 'You answer the phone for Smile Dental. Help people book a check-up and answer questions about prices.'), [
    'en-US',
  ]);
  const states = stepStates(ready, { progress: { tried: true }, summary: { latest_version: '0.1.0', deployed: { staging: '0.1.0' } } });
  assert.equal(states.purpose, 'done');
  assert.equal(states.reach, 'done');
  assert.equal(states.voice, 'done', 'chat only: a language is enough');
  assert.equal(states.actions, 'done', 'the starter’s own actions');
  assert.equal(states.try, 'done');
  assert.equal(states.live, 'done', 'live anywhere counts');

  const phone = setReach(ready, 'sip_voice', true, { providers: [] }).config;
  assert.equal(stepStates(phone).voice, 'todo', 'a voice channel needs a voice');
});

test('setup: a problem the checks found belongs to the step that asks for it', () => {
  assert.equal(stepForPath(['agents', 'items', 0, 'instructions']), 'purpose');
  assert.equal(stepForPath(['messages', 0]), 'purpose');
  assert.equal(stepForPath(['channels', 1, 'greeting']), 'reach');
  assert.equal(stepForPath(['defaults', 'models', 'tts', 'voice_id']), 'voice');
  assert.equal(stepForPath(['knowledge', 0]), 'knowledge');
  assert.equal(stepForPath(['telephony', 'transfers', 0, 'target']), 'actions');
  assert.equal(stepForPath(['runtime']), '');
  assert.equal(stepForPath(undefined), '');
});

test('setup: it is where the next steps are done while an agent is being set up, or was never published', () => {
  const none = { step: '', tried: false, finished: false };
  assert.equal(inSetup(none, null), false, 'not while the agent is still being read');
  assert.equal(inSetup(none, { latest_version: null }), true, 'never published');
  assert.equal(inSetup(none, { latest_version: '0.1.1' }), false, 'published, and not set up here');
  assert.equal(inSetup({ ...none, known: true, step: 'voice' }, { latest_version: '0.1.1' }), true, 'started here');
  assert.equal(inSetup({ ...none, known: true, finished: true }, { latest_version: null }), false, 'finished');
});

test('demo: a new agent has no calls until it is put live', async () => {
  const T0 = Date.parse('2026-10-22T10:00:00Z');
  const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => ({}), now: () => new Date(T0).toISOString(), quietNewAgents: true });
  const created = await api.handle('POST', '/bots', { id: 'smile-dental', name: 'Smile Dental' });
  assert.equal(created.status, 201);
  const since = encodeURIComponent(new Date(T0 - 7 * 86400e3).toISOString());
  const before = await api.handle('GET', `/bots/smile-dental/calls?since=${since}&limit=100`);
  assert.equal(before.body.calls.length, 0);
  const live = await api.handle('GET', `/bots/smile-dental/calls?status=in_progress`);
  assert.equal(live.body.calls.length, 0, 'none in progress either');

  const draft = (await api.handle('GET', '/bots/smile-dental/draft')).body;
  await api.handle('PUT', '/bots/smile-dental/draft', { config: applyStarter(draft.config, 'support'), revision: draft.revision });
  const published = await api.handle('POST', '/bots/smile-dental/publish', {});
  assert.equal(published.status, 201, JSON.stringify(published.body));
  await api.handle('POST', '/bots/smile-dental/deploy', { version: published.body.version, environment: 'development' });
  const after = await api.handle('GET', `/bots/smile-dental/calls?status=in_progress`);
  assert.ok(Array.isArray(after.body.calls), 'calls in progress can come in once it is live');

  const seeded = await api.handle('GET', `/bots/acme-support/calls?since=${since}&limit=100`);
  assert.ok(seeded.body.calls.length > 0, 'the demo’s own agents keep their calls');
});
