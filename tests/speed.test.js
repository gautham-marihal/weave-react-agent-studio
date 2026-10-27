import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';
import { ADVICE_AT, sampleOf, seconds, spreadPick, summarize, verdictOf } from '../src/studio/speed/speedModel.ts';
import { parseWorkspaceHash, workspaceHref } from '../src/pages/helpers.js';
import { parseRoute } from '../src/studio/route.js';

// The Speed page (what was "Cost and speed" until the costs were taken out on 2026-10-22): how fast agents answer, from their calls.
const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

// a call as the API gives it: a row of the list, and GET /calls/{id}
function call({ id = 'c1', bot = 'acme', type = 'web_chat', duration = 60, waits = [1.2, 2.5], said = 'Hello there.' } = {}) {
  let seq = 0;
  const events = [{ t: at(0), seq: ++seq, elapsed_s: 0, event: 'call_started' }];
  let t = 1;
  waits.forEach((w, i) => {
    events.push({ t: at(t), seq: ++seq, elapsed_s: t, event: 'user_said', text: `Question ${i}` });
    if (i === 0) events.push({ t: at(t + 0.2), seq: ++seq, elapsed_s: t + 0.2, event: 'tool_called', tool: 'find_order', duration_ms: 800 });
    events.push({ t: at(t + w), seq: ++seq, elapsed_s: t + w, event: 'agent_said', text: said, timing: { llm_node_ttft: w / 2 } });
    t += 10;
  });
  events.push({ t: at(duration), seq: ++seq, elapsed_s: duration, event: 'call_ended', duration_s: duration });
  return { summary: { id, bot, channel: { id: type, type }, started_at: at(0), duration_s: duration, status: 'ended' }, page: { events } };
}

test('a call gives its waits, when the model started, and how long each tool took', () => {
  const c = call();
  const sample = sampleOf(c.summary, c.page);
  assert.deepEqual(
    sample.waits.map((w) => w.ms),
    [1200, 2500],
  );
  assert.deepEqual(sample.ttfts, [600, 1250]);
  assert.deepEqual(sample.tools, [{ tool: 'find_order', ms: 800, failed: false }]);
  assert.equal('usage' in sample, false, 'nothing about money or tokens is kept');
});

test('the summary: half the answers, 1 in 10, the share within a target, the spread, the slowest answers and tools', () => {
  const calls = [call({ id: 'a' }), call({ id: 'b', waits: [0.8, 4, 9] }), call({ id: 'c', type: 'web_voice', duration: 90 }), call({ id: 'd' })];
  const s = summarize({ samples: calls.map((c) => sampleOf(c.summary, c.page)), totalCalls: 140, targetMs: 2000 });
  assert.equal(s.sampled, 4);
  assert.equal(s.totalCalls, 140);
  assert.equal(s.speed.answers, 9);
  assert.equal(s.speed.p50, 2500, 'answers: 0.8, 1.2 ×3, 2.5 ×3, 4 and 9 s');
  assert.equal(s.speed.within.toFixed(3), (4 / 9).toFixed(3));
  assert.deepEqual(
    s.speed.buckets.map((b) => b.n),
    [1, 3, 3, 1, 0, 1],
  );
  assert.equal(s.speed.slowest[0].ms, 9000);
  assert.equal(s.speed.slowest[0].callId, 'b');
  assert.deepEqual(s.speed.tools, [{ tool: 'find_order', n: 4, p50: 800, maxMs: 800, failed: 0 }]);
  const none = summarize({ samples: [], totalCalls: 0 });
  assert.equal(none.speed.p50, null);
  assert.equal(none.speed.within, null);
  assert.equal('costPerCall' in none, false, 'no cost is worked out');
});

test('seconds read the way people say them', () => {
  assert.equal(seconds(1234), '1.2 s');
  assert.equal(seconds(456), '456 ms');
  assert.equal(seconds(12345), '12 s');
  assert.equal(seconds(null), '–');
});

test('the page is at #/speed, and an old #/cost link still opens it, on the workspace and in an agent', () => {
  assert.equal(workspaceHref('speed'), '#/speed');
  assert.deepEqual(parseWorkspaceHash('#/speed'), { id: 'speed' });
  assert.deepEqual(parseWorkspaceHash('#/cost'), { id: 'speed' }, 'an old bookmark');
  assert.equal(parseRoute('#/bots/acme/speed').tab, 'speed');
  assert.equal(parseRoute('#/bots/acme/cost').tab, 'speed', 'an old link to an agent’s page');
});

test('demo: the made-up calls have answers to time', async () => {
  const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => ({}), now: () => new Date(T0).toISOString() });
  const listed = (await api.handle('GET', `/bots/front-desk/calls?since=${encodeURIComponent(new Date(T0 - 14 * 86400e3).toISOString())}&limit=100`)).body
    .calls;
  const finished = listed.filter((c) => c.status === 'ended');
  assert.ok(finished.length > 10);
  const samples = [];
  for (const c of finished.slice(0, 20)) samples.push(sampleOf({ ...c, bot: 'front-desk' }, (await api.handle('GET', `/bots/front-desk/calls/${c.id}`)).body));
  const s = summarize({ samples, totalCalls: finished.length });
  assert.ok(s.speed.answers > 10);
  assert.ok(s.speed.p50 > 0);
});

// a voice call as the runtime records one: making sure the caller finished on their words; the model starting, the voice starting and the whole delay on
// the answer; a request to the business's own system in between
function voiceCall({ id = 'v1', bot = 'acme', turns = 3, eot = 1.2, ttft = 1.4, ttfb = 0.7, request = 0.9, at0 = 0 } = {}) {
  let seq = 0;
  const events = [{ t: at(at0), seq: ++seq, elapsed_s: 0, event: 'call_started', channel: { id: 'phone', type: 'sip_voice' } }];
  let t = 2;
  for (let i = 0; i < turns; i += 1) {
    events.push({
      t: at(at0 + t),
      seq: ++seq,
      elapsed_s: t,
      event: 'user_said',
      text: `Question ${i}`,
      timing: { end_of_turn_delay: eot, transcription_delay: eot * 0.8 },
    });
    events.push({
      t: at(at0 + t + 0.4),
      seq: ++seq,
      elapsed_s: t + 0.4,
      event: 'http_request',
      name: 'order_api',
      ms: request * 1000,
      status: i === 0 ? 503 : 200,
      attempts: i === 0 ? 2 : 1,
    });
    const e2e = eot + ttft + request + ttfb + 0.05;
    events.push({
      t: at(at0 + t + 3),
      seq: ++seq,
      elapsed_s: t + 3,
      event: 'agent_said',
      text: 'Here you are.',
      timing: { llm_node_ttft: ttft, tts_node_ttfb: ttfb, e2e_latency: e2e },
    });
    t += 12;
  }
  return { summary: { id, bot, channel: { id: 'phone', type: 'sip_voice' }, started_at: at(at0), status: 'ended' }, page: { events } };
}

test('a voice call: what the caller waited is the delay it records, split into its parts', () => {
  const c = voiceCall();
  const s = sampleOf(c.summary, c.page);
  assert.equal(s.voice, true);
  assert.equal(s.answers.length, 3);
  const a = s.answers[0];
  assert.equal(a.ms, 4250, 'the delay the call recorded: 1.2 + 1.4 + 0.9 + 0.7 + 0.05 s');
  assert.deepEqual(a.stages, { listen: 1200, think: 1400, systems: 900, reply: 700 }, 'what is left (50 ms) is too little to call a part');
  assert.equal(a.say, 'Question 0');
  assert.deepEqual(s.requests[0], { name: 'order_api', ms: 900, failed: true, retried: true });
});

test('a chat: what is left once the model has started is the answer being written', () => {
  const c = call({ waits: [3] });
  const [a] = sampleOf(c.summary, c.page).answers;
  // 3 s in all: the model started at 1.5 s, the tool took 0.8 s, so 0.7 s went on writing the rest
  assert.deepEqual(a.stages, { think: 1500, systems: 800, reply: 700 });
});

test('the parts of a wait, averaged for voice calls and chats apart', () => {
  const s = summarize({ samples: [sampleOf(voiceCall().summary, voiceCall().page), sampleOf(call().summary, call().page)] });
  assert.equal(s.stages.voice.answers, 3);
  assert.equal(Math.round(s.stages.voice.avg.listen.ms), 1200);
  assert.equal(s.stages.chat.avg.listen, undefined, 'a chat has no caller to wait for');
  assert.ok(s.stages.chat.avg.think);
  const api = s.systems.find((r) => r.name === 'order_api');
  assert.deepEqual([api.kind, api.label, api.n, api.p50, api.failed, api.retried], ['request', 'Order api', 3, 900, 1, 1]);
});

test('how the calls did, in a word: 9 in 10 within the target is good, 3 in 4 ok, less is slow; too few answers say nothing yet', () => {
  assert.equal(verdictOf(0.95, 40), 'good');
  assert.equal(verdictOf(0.8, 40), 'ok');
  assert.equal(verdictOf(0.5, 40), 'slow');
  assert.equal(verdictOf(1, 3), 'few');
  assert.equal(verdictOf(null, 0), 'few');
});

test('suggestions come only from what the calls show, biggest first, each with the setting it opens', () => {
  const slow = summarize({ samples: [sampleOf(voiceCall().summary, voiceCall().page)] });
  const ids = slow.advice.map((a) => a.id);
  assert.deepEqual(ids, ['think', 'listen', 'system:request:order_api', 'speak']);
  const think = slow.advice[0];
  assert.equal(think.title, 'The AI model takes 1.4 s to start answering');
  assert.deepEqual(think.path, ['defaults', 'models', 'llm']);
  assert.equal(`${think.lead} 1.1–1.4 s${think.tail}`, 'The AI model takes 1.1–1.4 s to start answering', 'the halves say it for several agents at once');
  assert.deepEqual(slow.advice[1].path, ['defaults', 'conversation', 'turn_handling', 'endpointing']);
  assert.deepEqual(slow.advice[2].path, ['connections']);
  assert.deepEqual(slow.advice[3].path, ['defaults', 'models', 'tts']);
  // quick parts suggest nothing
  const quick = voiceCall({ eot: 0.5, ttft: 0.6, ttfb: 0.2, request: 0.1 });
  assert.deepEqual(summarize({ samples: [sampleOf(quick.summary, quick.page)] }).advice, []);
  // and nothing is said from fewer than three answers
  const once = voiceCall({ turns: 2 });
  assert.equal(summarize({ samples: [sampleOf(once.summary, once.page)] }).advice.filter((a) => a.id !== 'system:request:order_api').length, 0);
  assert.equal(ADVICE_AT.think, 1000);
});

test('day by day: a point for every day of the period, an empty day left empty', () => {
  const nowMs = T0 + 3 * 86400e3;
  const s = summarize({ samples: [sampleOf(voiceCall().summary, voiceCall().page)], days: 7, nowMs });
  assert.equal(s.days.length, 7);
  assert.equal(s.days.at(-1).day, '2026-10-23');
  const withAnswers = s.days.filter((d) => d.n);
  assert.deepEqual(
    withAnswers.map((d) => [d.day, d.n, d.p50]),
    [['2026-10-20', 3, 4250]],
  );
  assert.equal(s.days[0].p50, null);
});

test('demo: a voice call records its parts, and they add up to the delay the caller heard', async () => {
  const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => ({}), now: () => new Date(T0).toISOString() });
  const listed = (await api.handle('GET', `/bots/front-desk/calls?since=${encodeURIComponent(new Date(T0 - 14 * 86400e3).toISOString())}&limit=100`)).body
    .calls;
  const voice = listed.filter((c) => ['sip_voice', 'web_voice'].includes(c.channel?.type) && c.status === 'ended');
  assert.ok(voice.length >= 2, 'some of the front desk’s calls come in by phone');
  const s = sampleOf({ ...voice[0], bot: 'front-desk' }, (await api.handle('GET', `/bots/front-desk/calls/${voice[0].id}`)).body);
  const a = s.answers.find((x) => x.stages.listen);
  assert.ok(a, 'an answer with its parts');
  const parts = Object.values(a.stages).reduce((n, v) => n + v, 0);
  assert.ok(Math.abs(parts - a.ms) <= 60, `${parts} vs ${a.ms}`);
});

test('a busy agent: the calls read for their timings are spread over the days, not only the newest', () => {
  const H = 3600e3;
  // newest first: 30 calls today, 3 yesterday, 2 the day before
  const calls = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, started_at: new Date(T0 - i * 60e3).toISOString() })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `y${i}`, started_at: new Date(T0 - 24 * H - i * H).toISOString() })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, started_at: new Date(T0 - 48 * H - i * H).toISOString() })),
  ];
  const picked = spreadPick(calls, 9);
  assert.equal(picked.length, 9);
  assert.deepEqual(
    picked.map((c) => c.id),
    ['t0', 't1', 't2', 't3', 'y0', 'y1', 'y2', 'b0', 'b1'],
  );
  assert.equal(spreadPick(calls, 50), calls, 'all of them when there are no more than asked for');
});
