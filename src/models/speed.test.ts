import { describe, expect, it } from 'vitest';
import { ADVICE_AT, groupAdvice, mainPart, sampleOf, seconds, settingTarget, spreadPick, summarize, timeRange, verdictOf } from './speed';

// Ported from Weave React's tests/speed.test.js: how fast agents answer, from their calls' records.
const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

// a call as the API gives it: a row of the list, and GET /calls/{id}
function call({ id = 'c1', bot = 'acme', type = 'web_chat', duration = 60, waits = [1.2, 2.5], said = 'Hello there.' } = {}) {
  let seq = 0;
  const events: Record<string, unknown>[] = [{ t: at(0), seq: ++seq, elapsed_s: 0, event: 'call_started' }];
  let t = 1;
  waits.forEach((w, i) => {
    events.push({ t: at(t), seq: ++seq, elapsed_s: t, event: 'user_said', text: `Question ${i}` });
    if (i === 0) events.push({ t: at(t + 0.2), seq: ++seq, elapsed_s: t + 0.2, event: 'tool_called', tool: 'find_order', duration_ms: 800 });
    events.push({ t: at(t + w), seq: ++seq, elapsed_s: t + w, event: 'agent_said', text: said, timing: { llm_node_ttft: w / 2 } });
    t += 10;
  });
  events.push({ t: at(duration), seq: ++seq, elapsed_s: duration, event: 'call_ended', duration_s: duration });
  return { summary: { id, bot, channel: { id: type, type }, started_at: at(0), duration_s: duration, status: 'ended' as const }, page: { events } };
}

// a voice call as the runtime records one: making sure the caller finished on their words; the model starting, the
// voice starting and the whole delay on the answer; a request to the business's own system in between
function voiceCall({ id = 'v1', bot = 'acme', turns = 3, eot = 1.2, ttft = 1.4, ttfb = 0.7, request = 0.9, at0 = 0 } = {}) {
  let seq = 0;
  const events: Record<string, unknown>[] = [{ t: at(at0), seq: ++seq, elapsed_s: 0, event: 'call_started', channel: { id: 'phone', type: 'sip_voice' } }];
  let t = 2;
  for (let i = 0; i < turns; i += 1) {
    events.push({ t: at(at0 + t), seq: ++seq, elapsed_s: t, event: 'user_said', text: `Question ${i}`, timing: { end_of_turn_delay: eot, transcription_delay: eot * 0.8 } });
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
    events.push({ t: at(at0 + t + 3), seq: ++seq, elapsed_s: t + 3, event: 'agent_said', text: 'Here you are.', timing: { llm_node_ttft: ttft, tts_node_ttfb: ttfb, e2e_latency: e2e } });
    t += 12;
  }
  return { summary: { id, bot, channel: { id: 'phone', type: 'sip_voice' }, started_at: at(at0), status: 'ended' as const }, page: { events } };
}

const sampleOfCall = (c: { summary: Parameters<typeof sampleOf>[0]; page: unknown }) => sampleOf(c.summary, c.page);

describe('Speed', () => {
  it('reads a call’s waits, when the model started, and how long each tool took', () => {
    const sample = sampleOfCall(call());
    expect(sample.waits.map((w) => w.ms)).toEqual([1200, 2500]);
    expect(sample.ttfts).toEqual([600, 1250]);
    expect(sample.tools).toEqual([{ tool: 'find_order', ms: 800, failed: false }]);
    expect('usage' in sample).toBe(false);
  });

  it('sums up: half the answers, 1 in 10, the share within a target, the spread, the slowest answers and tools', () => {
    const calls = [call({ id: 'a' }), call({ id: 'b', waits: [0.8, 4, 9] }), call({ id: 'c', type: 'web_voice', duration: 90 }), call({ id: 'd' })];
    const s = summarize({ samples: calls.map(sampleOfCall), totalCalls: 140, targetMs: 2000 });
    expect(s.sampled).toBe(4);
    expect(s.totalCalls).toBe(140);
    expect(s.speed.answers).toBe(9);
    expect(s.speed.p50).toBe(2500);
    expect(s.speed.within?.toFixed(3)).toBe((4 / 9).toFixed(3));
    expect(s.speed.buckets.map((b) => b.n)).toEqual([1, 3, 3, 1, 0, 1]);
    expect(s.speed.slowest[0].ms).toBe(9000);
    expect(s.speed.slowest[0].callId).toBe('b');
    expect(s.speed.tools).toEqual([{ tool: 'find_order', n: 4, p50: 800, maxMs: 800, failed: 0 }]);
    const none = summarize({ samples: [], totalCalls: 0 });
    expect(none.speed.p50).toBeNull();
    expect(none.speed.within).toBeNull();
    expect('costPerCall' in none).toBe(false);
  });

  it('writes seconds the way people say them', () => {
    expect(seconds(1234)).toBe('1.2 s');
    expect(seconds(456)).toBe('456 ms');
    expect(seconds(12345)).toBe('12 s');
    expect(seconds(null)).toBe('–');
  });

  it('takes a voice call’s wait from the delay it records, split into its parts', () => {
    const s = sampleOfCall(voiceCall());
    expect(s.voice).toBe(true);
    expect(s.answers).toHaveLength(3);
    const a = s.answers[0];
    expect(a.ms).toBe(4250);
    expect(a.stages).toEqual({ listen: 1200, think: 1400, systems: 900, reply: 700 });
    expect(a.say).toBe('Question 0');
    expect(s.requests[0]).toEqual({ name: 'order_api', ms: 900, failed: true, retried: true });
  });

  it('counts what is left of a chat answer once the model has started as the answer being written', () => {
    const [a] = sampleOfCall(call({ waits: [3] })).answers;
    expect(a.stages).toEqual({ think: 1500, systems: 800, reply: 700 });
  });

  it('averages the parts of a wait for voice calls and chats apart', () => {
    const s = summarize({ samples: [sampleOfCall(voiceCall()), sampleOfCall(call())] });
    expect(s.stages.voice?.answers).toBe(3);
    expect(Math.round(s.stages.voice?.avg.listen?.ms ?? 0)).toBe(1200);
    expect(s.stages.chat?.avg.listen).toBeUndefined();
    expect(s.stages.chat?.avg.think).toBeTruthy();
    const api = s.systems.find((r) => r.name === 'order_api');
    expect([api?.kind, api?.label, api?.n, api?.p50, api?.failed, api?.retried]).toEqual(['request', 'Order api', 3, 900, 1, 1]);
    expect(mainPart(s.stages)?.id).toBe('think');
  });

  it('says how the calls did in a word: 9 in 10 within the target is good, 3 in 4 ok, less is slow; too few say nothing', () => {
    expect(verdictOf(0.95, 40)).toBe('good');
    expect(verdictOf(0.8, 40)).toBe('ok');
    expect(verdictOf(0.5, 40)).toBe('slow');
    expect(verdictOf(1, 3)).toBe('few');
    expect(verdictOf(null, 0)).toBe('few');
  });

  it('suggests only from what the calls show, biggest first, each with the setting it opens', () => {
    const slow = summarize({ samples: [sampleOfCall(voiceCall())] });
    expect(slow.advice.map((a) => a.id)).toEqual(['think', 'listen', 'system:request:order_api', 'speak']);
    const think = slow.advice[0];
    expect(think.title).toBe('The AI model takes 1.4 s to start answering');
    expect(think.path).toEqual(['defaults', 'models', 'llm']);
    expect(`${think.lead} 1.1–1.4 s${think.tail}`).toBe('The AI model takes 1.1–1.4 s to start answering');
    expect(slow.advice[1].path).toEqual(['defaults', 'conversation', 'turn_handling', 'endpointing']);
    expect(slow.advice[2].path).toEqual(['connections']);
    expect(slow.advice[3].path).toEqual(['defaults', 'models', 'tts']);
    const quick = voiceCall({ eot: 0.5, ttft: 0.6, ttfb: 0.2, request: 0.1 });
    expect(summarize({ samples: [sampleOfCall(quick)] }).advice).toEqual([]);
    const once = voiceCall({ turns: 2 });
    expect(summarize({ samples: [sampleOfCall(once)] }).advice.filter((a) => a.id !== 'system:request:order_api')).toHaveLength(0);
    expect(ADVICE_AT.think).toBe(1000);
  });

  it('opens a suggestion’s setting on the agent’s Build page that holds it', () => {
    expect(settingTarget(['defaults', 'models', 'llm'])).toEqual({ stage: 'build', section: 'agent', focus: 'model' });
    expect(settingTarget(['defaults', 'models', 'tts'])).toEqual({ stage: 'build', section: 'agent', focus: 'voice' });
    expect(settingTarget(['connections'])).toEqual({ stage: 'build', section: 'tools', focus: undefined });
  });

  it('says a suggestion for several agents once, with their range of times', () => {
    const slow = summarize({ samples: [sampleOfCall(voiceCall())] }).advice;
    const quicker = summarize({ samples: [sampleOfCall(voiceCall({ id: 'v2', bot: 'b', ttft: 1.1 }))] }).advice;
    const grouped = groupAdvice([
      { bot: 'acme', advice: slow },
      { bot: 'b', advice: quicker },
    ]);
    const think = grouped.find((g) => g.id === 'think');
    expect(think?.agents.map((a) => a.bot)).toEqual(['acme', 'b']);
    expect(timeRange(think?.agents.map((a) => a.ms) ?? [])).toBe('1.1–1.4 s');
    expect(timeRange([1400, 1400])).toBe('1.4 s');
    expect(grouped.length).toBeLessThanOrEqual(5);
  });

  it('draws a point for every day of the period, an empty day left empty', () => {
    const nowMs = T0 + 3 * 86400e3;
    const s = summarize({ samples: [sampleOfCall(voiceCall())], days: 7, nowMs });
    expect(s.days).toHaveLength(7);
    expect(s.days.at(-1)?.day).toBe(new Date(nowMs).toLocaleDateString('sv-SE'));
    const withAnswers = s.days.filter((d) => d.n);
    expect(withAnswers.map((d) => [d.n, d.p50])).toEqual([[3, 4250]]);
    expect(s.days[0].p50).toBeNull();
  });

  it('spreads the calls read for a busy agent over the days, not only the newest', () => {
    const H = 3600e3;
    const calls = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, started_at: new Date(T0 - i * 60e3).toISOString() })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `y${i}`, started_at: new Date(T0 - 24 * H - i * H).toISOString() })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, started_at: new Date(T0 - 48 * H - i * H).toISOString() })),
    ];
    const picked = spreadPick(calls, 9);
    expect(picked).toHaveLength(9);
    expect(picked.map((c) => c.id)).toEqual(['t0', 't1', 't2', 't3', 'y0', 'y1', 'y2', 'b0', 'b1']);
    expect(spreadPick(calls, 50)).toBe(calls);
  });
});
