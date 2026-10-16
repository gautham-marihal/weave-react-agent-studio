import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { minimalConfig } from '../src/demo/demoApi.js';

// "Describe it", mounted in jsdom with a stand-in for the server's /llm route and for the validator: what is written is sent, what comes back is shown as a
// proposal, nothing reaches the draft until Apply, and Undo puts it back.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const realFetch = globalThis.fetch;
function serve({ configured = true, answers, errors = () => [] }) {
  const calls = { status: 0, messages: [], validate: 0 };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/llm/status')) { calls.status += 1; return new Response(JSON.stringify({ configured, model: 'claude-sonnet-5-5', models: ['claude-sonnet-5-5', 'claude-opus-5-5'] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (u.endsWith('/llm/v1/messages')) {
      const body = JSON.parse(init.body); calls.messages.push(body);
      const out = answers.shift();
      if (out instanceof Error) throw out;
      if (typeof out === 'number') return new Response(JSON.stringify({ error: 'x' }), { status: out });
      return new Response(JSON.stringify(out(body)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.endsWith('/validate')) { calls.validate += 1; const body = JSON.parse(init.body); return new Response(JSON.stringify({ valid: true, errors: errors(body), warnings: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return realFetch(url, init);
  };
  return calls;
}
const reply = (mutate, extra = {}) => (body) => {
  const text = body.messages[0].content;
  const current = JSON.parse(text.split('CURRENT DRAFT (edit this; keep what the request does not touch):\n')[1].split('\n\nREQUEST:')[0]);
  const config = JSON.parse(JSON.stringify(current)); mutate(config);
  return { content: [{ type: 'tool_use', id: 'tu', name: 'submit_config', input: { config, summary: 'Made it formal.', assumptions: ['English only.'], questions: ['Opening hours?'], ...extra } }], usage: { input_tokens: 2100, output_tokens: 300 } };
};
const mount = (config = minimalConfig('acme', 'Acme')) => mountScreen('assistant', config, { ready: '.asTab' });
const settle = async (app, ms = 60) => { await app.wait(ms); };

test('with no AI set up the built-in rules are offered and called what they are; the first use of the AI asks before anything is sent', async () => {
  window.localStorage.clear();
  const calls = serve({ configured: false, answers: [] });
  let app = await mount(); await settle(app);
  assert.match(textOf($(app.container, '.asEngine')), /Built-in rules, not AI/);
  assert.match(textOf($(app.container, '.asTab')), /No AI model is set up on this server/);
  assert.match(textOf($(app.container, '.asTab')), /ANTHROPIC_API_KEY/);
  assert.equal($$(app.container, '.asExamples button').length, 4);
  assert.equal(byText(app.container, 'button', /Make a first draft/).disabled, true, 'nothing to send yet');
  await app.unmount();

  serve({ configured: true, answers: [] });
  app = await mount(); await settle(app);
  assert.match(textOf($(app.container, '.asEngine')), /AI/);
  assert.match(textOf($(app.container, '.asTab')), /Before you use the AI/);
  await a.type($(app.container, '#as-input'), 'Make it formal please');
  assert.equal(byText(app.container, 'button', /Build it/).disabled, true, 'not before the person has said they understand what is sent');
  await a.click(byText(app.container, 'button', 'I understand, continue'));
  assert.equal(byText(app.container, 'button', /Build it/).disabled, false);
  assert.equal(window.localStorage.getItem('weave_ai_consent'), '1');
  assert.equal(calls.messages.length, 0);
  await app.unmount();
});

test('a request is sent with the draft, the answer is checked and shown as a proposal, nothing is in the draft until Apply, and Undo puts it back', async () => {
  window.localStorage.clear(); window.localStorage.setItem('weave_ai_consent', '1');
  const base = minimalConfig('acme', 'Acme');
  const calls = serve({ answers: [reply((c) => { c.persona.tone = 'formal and calm'; })] });
  const app = await mount(base); await settle(app);
  await a.type($(app.container, '#as-input'), 'Make it more formal and calm.');
  await a.click(byText(app.container, 'button', /Build it/));
  for (let i = 0; i < 40 && !$(app.container, '.asBot:not(.working)'); i += 1) await settle(app, 25);
  assert.equal(calls.messages.length, 1);
  assert.match(calls.messages[0].messages[0].content, /REQUEST:\nMake it more formal and calm\./);
  assert.match(calls.messages[0].messages[0].content, /"id": "acme"/, 'the current draft goes with it');
  assert.equal(calls.messages[0].tool_choice.name, 'submit_config');
  assert.equal(calls.validate, 1, 'what came back was checked');
  const card = $(app.container, '.asBot');
  assert.match(textOf(card), /Made it formal\./);
  assert.match(textOf(card), /Opening hours\?/);
  assert.match(textOf(card), /English only\./);
  assert.match(textOf(card), /Set “Tone of voice” to “formal and calm”/, 'what would change is a plain sentence');
  assert.match(textOf(card), /Checked: no errors/);
  assert.match(textOf(card), /2\.1k in · 300 out/);
  assert.equal(app.config.persona.tone, base.persona.tone, 'the draft is untouched until Apply');
  await a.click(byText(card, 'button', 'Apply to the draft'));
  assert.equal(app.config.persona.tone, 'formal and calm');
  const done = textOf($(app.container, '.asBot'));
  assert.match(done, /Applied to the draft\. 1 change: 1 added, 0 changed, 0 removed\./, 'once applied, the answer says exactly how much changed');
  assert.match(done, /What changed/);
  assert.match(done, /Not saved yet/);
  assert.match(done, /It is now in/i);
  assert.match(done, /Settings\s*Personality/, 'it says which parts of the settings changed');
  assert.match(done, /Workflow\s*1 agent, 0 hand-overs/, 'and what the Workflow now shows');
  assert.ok(byText($(app.container, '.asWhere'), 'button', 'Open in All settings') && byText($(app.container, '.asWhere'), 'button', 'Open in JSON') && byText($(app.container, '.asWhere'), 'button', 'See the workflow'));
  const ledger = textOf($(app.container, '.asAside'));
  assert.match(ledger, /Changes made here/);
  assert.match(ledger, /Make it more formal and calm\./, 'and the side panel keeps a running list of what was changed and why');
  assert.match(ledger, /1 added/);
  assert.match(textOf($(app.container, '.asAside')), /The agent now/);
  assert.match(textOf($(app.container, '.asAside')), /Tone\s*formal and calm/, 'and shows the agent as it is now');
  await a.click(byText($(app.container, '.asBot'), 'button', 'Undo'));
  assert.deepEqual(app.config, base, 'Undo puts the draft back exactly');
  assert.match(textOf($(app.container, '.asAside')), /Nothing yet/, 'and takes it off the list');
  await app.unmount();
});

test('problems the checker finds are handed back to the AI; what remains is shown, not hidden; failures of the call are said in words; Not this changes nothing', async () => {
  window.localStorage.clear(); window.localStorage.setItem('weave_ai_consent', '1');
  const base = minimalConfig('acme', 'Acme');
  let first = true;
  const calls = serve({ answers: [reply((c) => { c.agents.entry = 'nobody'; }), reply((c) => { c.agents.entry = 'nobody'; }), reply((c) => { c.agents.entry = 'nobody'; }), 503, new Error('offline')],
    errors: (c) => (c.agents.entry === 'nobody' ? [{ path: ['agents', 'entry'], message: 'unknown agent' }] : []) });
  const app = await mount(base); await settle(app);
  await a.type($(app.container, '#as-input'), 'Break it');
  await a.click(byText(app.container, 'button', /Build it/));
  for (let i = 0; i < 60 && !$(app.container, '.asBot:not(.working)'); i += 1) await settle(app, 25);
  assert.equal(calls.messages.length, 3, 'asked, then asked to fix twice');
  const card = $(app.container, '.asBot');
  assert.match(textOf(card), /1 problem the checker still finds/);
  assert.match(textOf(card), /agents\.entry unknown agent/);
  assert.match(textOf(card), /You can apply it and fix the rest by hand/);
  await a.click(byText(card, 'button', 'Not this'));
  assert.match(textOf($(app.container, '.asBot')), /Set aside/);
  assert.deepEqual(app.config, base);

  await a.type($(app.container, '#as-input'), 'Try again');
  await a.click(byText(app.container, 'button', /Send/));
  for (let i = 0; i < 40 && $$(app.container, '.asBot.error').length < 1; i += 1) await settle(app, 25);
  assert.match(textOf($(app.container, '.asBot.error')), /No AI model is set up on this server/);
  await a.type($(app.container, '#as-input'), 'And again');
  await a.click(byText(app.container, 'button', /Send/));
  for (let i = 0; i < 40 && $$(app.container, '.asBot.error').length < 2; i += 1) await settle(app, 25);
  assert.match(textOf($$(app.container, '.asBot.error')[1]), /could not reach the AI service/);
  assert.equal(first, true);
  await app.unmount();
});

test('the built-in rules make a first draft that says it replaces the draft, and applying it can be undone', async () => {
  window.localStorage.clear();
  serve({ configured: false, answers: [] });
  const base = minimalConfig('acme', 'Acme');
  const app = await mount(base); await settle(app);
  await a.click($$(app.container, '.asExamples button')[0]);
  await a.click(byText(app.container, 'button', /Make a first draft/));
  for (let i = 0; i < 40 && !$(app.container, '.asBot:not(.working)'); i += 1) await settle(app, 25);
  const card = $(app.container, '.asBot');
  assert.match(textOf(card), /built-in rules, not AI/i);
  assert.match(textOf(card), /replaces the whole draft/);
  await a.click(byText(card, 'button', 'Apply to the draft'));
  assert.notDeepEqual(app.config, base);
  await a.click(byText($(app.container, '.asBot'), 'button', 'Undo'));
  assert.deepEqual(app.config, base);
  assert.ok(byLabel(app.container, 'What do you need?') || $(app.container, 'label[for=as-input]'));
  await app.unmount();
  globalThis.fetch = realFetch;
});
