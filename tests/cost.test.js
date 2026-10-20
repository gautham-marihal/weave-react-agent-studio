import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';
import { alternatives, costOfCall, modelsOf, money, sampleOf, seconds, summarize } from '../src/studio/cost/costModel.js';
import { STARTING_PRICES, mergePrices, priceFor } from '../src/studio/cost/prices.js';

const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const prices = mergePrices();

// a call as the API gives it: a row of the list, and GET /calls/{id}
function call({
  id = 'c1',
  bot = 'acme',
  type = 'web_chat',
  duration = 60,
  usage = [{ provider: 'openai', model: 'gpt-4.1-mini', input_tokens: 4000, output_tokens: 300 }],
  waits = [1.2, 2.5],
  said = 'Hello there.',
} = {}) {
  let seq = 0;
  const events = [{ t: at(0), seq: ++seq, elapsed_s: 0, event: 'call_started' }];
  let t = 1;
  waits.forEach((w, i) => {
    events.push({ t: at(t), seq: ++seq, elapsed_s: t, event: 'user_said', text: `Question ${i}` });
    if (i === 0) events.push({ t: at(t + 0.2), seq: ++seq, elapsed_s: t + 0.2, event: 'tool_called', tool: 'find_order', duration_ms: 800 });
    events.push({ t: at(t + w), seq: ++seq, elapsed_s: t + w, event: 'agent_said', text: said, timing: { llm_node_ttft: w / 2 } });
    t += 10;
  });
  events.push({ t: at(duration), seq: ++seq, elapsed_s: duration, event: 'call_ended', duration_s: duration, usage });
  return { summary: { id, bot, channel: { id: type, type }, started_at: at(0), duration_s: duration, status: 'ended' }, page: { events, usage } };
}

test('prices: list prices, with a person’s own on top; a model is found by provider and model, or by its name alone', () => {
  assert.deepEqual(priceFor(prices, 'llm', 'openai', 'gpt-4.1-mini'), { input: 0.4, output: 1.6 });
  assert.deepEqual(priceFor(prices, 'llm', 'api.openai.com', 'gpt-4.1-mini'), { input: 0.4, output: 1.6 }, 'a call may name the provider by its address');
  assert.equal(priceFor(prices, 'tts', 'elevenlabs', 'eleven_flash_v2_5'), null, 'a plan price is not guessed');
  const mine = mergePrices({
    llm: { 'openai/gpt-4.1-mini': { input: 0.3, output: 1.2 }, 'openai/gpt-4o': null, 'x/broken': { input: 'a' } },
    tts: { 'elevenlabs/eleven_flash_v2_5': { million: 50 } },
  });
  assert.deepEqual(mine.llm['openai/gpt-4.1-mini'], { input: 0.3, output: 1.2 });
  assert.equal(mine.llm['openai/gpt-4o'], undefined, 'a price can be taken away');
  assert.equal(mine.llm['x/broken'], undefined, 'a broken price is ignored');
  assert.deepEqual(mine.tts['elevenlabs/eleven_flash_v2_5'], { million: 50 });
  Object.entries(STARTING_PRICES).forEach(([stage, table]) =>
    Object.entries(table).forEach(([key, price]) => {
      assert.match(key, /^[a-z_]+\/\S+$/, key);
      Object.values(price).forEach((v) => assert.ok(v > 0 && v < 100, `${stage} ${key}`));
    }),
  );
});

test('a text call costs its tokens; a voice call adds its minutes heard and the characters spoken; what has no price is named, not guessed', () => {
  const text = call();
  const sample = sampleOf(text.summary, text.page);
  assert.equal(sample.voice, false);
  assert.deepEqual(
    sample.waits.map((w) => w.ms),
    [1200, 2500],
  );
  assert.deepEqual(sample.ttfts, [600, 1250]);
  assert.deepEqual(sample.tools, [{ tool: 'find_order', ms: 800 }]);
  const models = {
    llm: { provider: 'openai', model: 'gpt-4.1-mini' },
    stt: { provider: 'deepgram', model: 'nova-3' },
    tts: { provider: 'elevenlabs', model: 'eleven_flash_v2_5' },
  };
  const textCost = costOfCall(sample, models, prices);
  assert.equal(textCost.llm.toFixed(6), ((4000 * 0.4 + 300 * 1.6) / 1e6).toFixed(6));
  assert.equal(textCost.stt, 0, 'a text call hears no audio');
  assert.deepEqual(textCost.missing, []);
  const voice = call({ type: 'sip_voice', duration: 120, said: 'x'.repeat(500) });
  const voiceCost = costOfCall(sampleOf(voice.summary, voice.page), models, prices);
  assert.equal(voiceCost.stt.toFixed(6), (2 * 0.0077).toFixed(6), 'two minutes heard');
  assert.equal(voiceCost.tts, 0);
  assert.deepEqual(voiceCost.missing, [{ stage: 'tts', provider: 'elevenlabs', model: 'eleven_flash_v2_5' }]);
  const priced = costOfCall(sampleOf(voice.summary, voice.page), models, mergePrices({ tts: { 'elevenlabs/eleven_flash_v2_5': { million: 100 } } }));
  assert.equal(priced.tts.toFixed(6), ((1000 * 100) / 1e6).toFixed(6), 'two answers of 500 characters');
  const silent = call({ usage: [] });
  assert.equal(costOfCall(sampleOf(silent.summary, silent.page), models, prices).reported, false, 'a call that reports no use is said to');
  assert.deepEqual(modelsOf({ defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1' } } } }), {
    llm: { provider: 'openai', model: 'gpt-4.1' },
    stt: null,
    tts: null,
  });
});

test('the summary: per call, per minute, a month as lately, by part and by model; speed with a target; what is left out', () => {
  const calls = [call({ id: 'a' }), call({ id: 'b', waits: [0.8, 4, 9] }), call({ id: 'c', type: 'web_voice', duration: 90 }), call({ id: 'd', usage: [] })];
  const samples = calls.map((c) => sampleOf(c.summary, c.page));
  const models = { acme: { llm: { provider: 'openai', model: 'gpt-4.1-mini' }, stt: { provider: 'deepgram', model: 'nova-3' }, tts: null } };
  const s = summarize({ samples, totalCalls: 140, modelsByBot: models, prices, days: 14, targetMs: 2000 });
  assert.equal(s.sampled, 4);
  assert.equal(s.perDay, 10);
  assert.ok(Math.abs(s.monthly - 10 * 30 * s.costPerCall) < 1e-9);
  assert.ok(s.parts.stt > 0, 'one voice call heard');
  assert.equal(s.unreported, 1);
  assert.equal(s.voiceCalls, 1);
  assert.equal(s.models.length, 1);
  assert.equal(s.models[0].calls, 3);
  assert.equal(s.models[0].input, 4000);
  assert.equal(s.speed.answers, 9);
  assert.equal(s.speed.p50, 2500, 'answers: 0.8, 1.2 ×3, 2.5 ×3, 4 and 9 s');
  assert.equal(s.speed.within.toFixed(3), (4 / 9).toFixed(3));
  assert.deepEqual(
    s.speed.buckets.map((b) => b.n),
    [1, 3, 3, 1, 0, 1],
  );
  assert.equal(s.speed.slowest[0].ms, 9000);
  assert.equal(s.speed.slowest[0].callId, 'b');
  assert.deepEqual(s.speed.tools, [{ tool: 'find_order', n: 4, avgMs: 800, maxMs: 800 }]);
  const none = summarize({ samples: [], totalCalls: 0, prices });
  assert.equal(none.costPerCall, null);
  assert.equal(none.speed.p50, null);
});

test('another model: what a call would cost on each priced model with the same tokens, the cheapest first, with the saving', () => {
  const alt = alternatives({ current: { provider: 'openai', model: 'gpt-4.1' }, tokens: { input: 4000, output: 300 }, prices });
  assert.equal(alt.current.toFixed(6), ((4000 * 2 + 300 * 8) / 1e6).toFixed(6));
  assert.ok(!alt.options.some((o) => o.model === 'gpt-4.1'), 'not itself');
  assert.deepEqual(
    alt.options.map((o) => o.costPerCall),
    [...alt.options.map((o) => o.costPerCall)].sort((a, b) => a - b),
  );
  const mini = alt.options.find((o) => o.model === 'gpt-4.1-mini');
  assert.equal(mini.saving.toFixed(2), '0.80');
  assert.equal(mini.sameProvider, true);
  assert.equal(alt.options.find((o) => o.provider === 'google').sameProvider, false);
  assert.equal(
    alternatives({ current: { provider: 'anthropic', model: 'unknown' }, tokens: { input: 10, output: 1 }, prices }).current,
    null,
    'no price: nothing to compare to',
  );
  assert.deepEqual(alternatives({ current: null, tokens: { input: null }, prices }).options, []);
});

test('money and seconds read the way people say them', () => {
  assert.equal(money(0.0012), '$0.0012');
  assert.equal(money(0.005), '$0.005');
  assert.equal(money(0.00000003), 'under $0.0001');
  assert.equal(money(1.234), '$1.23');
  assert.equal(money(1234.5), '$1,235');
  assert.equal(money(null), '–');
  assert.equal(seconds(1234), '1.2 s');
  assert.equal(seconds(null), '–');
});

test('demo: the made-up calls report the agent’s model and real-looking tokens, so the page prices them; Front Desk has a phone line', async () => {
  const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => ({}), now: () => new Date(T0).toISOString() });
  const listed = (await api.handle('GET', `/bots/front-desk/calls?since=${encodeURIComponent(new Date(T0 - 14 * 86400e3).toISOString())}&limit=100`)).body
    .calls;
  const finished = listed.filter((c) => c.status === 'ended');
  assert.ok(finished.length > 10);
  const samples = [];
  for (const c of finished.slice(0, 20)) samples.push(sampleOf({ ...c, bot: 'front-desk' }, (await api.handle('GET', `/bots/front-desk/calls/${c.id}`)).body));
  const config = (await api.handle('GET', '/bots/front-desk/draft')).body.config;
  const models = modelsOf(config);
  assert.deepEqual(models.stt, { provider: 'deepgram', model: 'nova-3' });
  const s = summarize({ samples, totalCalls: finished.length, modelsByBot: { 'front-desk': models }, prices, days: 14 });
  assert.ok(s.costPerCall > 0, 'priced');
  assert.equal(s.models[0].model, 'gpt-4.1-mini');
  assert.ok(s.tokens.input > 900);
  assert.ok(s.speed.answers > 10);
});
