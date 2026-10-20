// What an agent costs to run, and how fast it answers, from its calls. Pure: no React, no network.
//
// Cost is an ESTIMATE, and says what it rests on:
//   language model  the tokens each call reports (its `usage`), at the price of the model it names
//   listening       for a voice call, its minutes, at the price of the agent's speech-to-text model
//   speaking        for a voice call, the characters the agent said, at the price of its text-to-speech model
// A part with no price, or a call that reports no model use, is left out of the sum and named, never guessed. Phone line charges are not included.
// Speed is measured: the time from the caller's words to the agent's answer, and (when the call records it) how long the model took to start.

import { readCall } from '../replay/callFacts.js';
import { percentile } from '../monitoring/monitorModel.js';
import { isVoice } from '../live/liveModel.js';
import { fixMojibake } from '../trace/records.js';
import { priceFor, priceKey } from './prices.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);

// The models an agent is set to use, from its configuration.
export function modelsOf(config) {
  const m = config?.defaults?.models || {};
  const pick = (part) => (isObj(part) && part.model ? { provider: String(part.provider || ''), model: String(part.model) } : null);
  return { llm: pick(m.llm), stt: pick(m.stt), tts: pick(m.tts) };
}

// One call, as the numbers need it. summary: its row in the call list; page: GET /calls/{id} (events, usage).
export function sampleOf(summary, page) {
  const events = list(page?.events).filter(isObj);
  const ended = events.find((e) => e.event === 'call_ended');
  const usage = (list(page?.usage).length ? list(page.usage) : list(ended?.usage))
    .filter(isObj)
    .map((u) => ({ provider: String(u.provider || ''), model: String(u.model || ''), input: num(u.input_tokens) || 0, output: num(u.output_tokens) || 0 }))
    .filter((u) => u.input + u.output > 0);
  const facts = readCall(events);
  return {
    bot: summary?.bot || '',
    id: summary?.id || '',
    startedAt: summary?.started_at || null,
    cutOff: summary?.status === 'unfinished',
    channel: summary?.channel || null,
    voice: isVoice(summary?.channel),
    durationS: num(summary?.duration_s) ?? num(ended?.duration_s) ?? 0,
    usage,
    spokenChars: sum(events.filter((e) => e.event === 'agent_said').map((e) => fixMojibake(String(e.text || '')).length)),
    waits: facts.turns.filter((t) => typeof t.waitMs === 'number').map((t) => ({ ms: t.waitMs, say: t.say })),
    ttfts: events
      .map((e) => num(e.timing?.llm_node_ttft))
      .filter((v) => v !== null)
      .map((s) => Math.round(s * 1000)),
    tools: events
      .filter((e) => e.event === 'tool_called' && num(e.duration_ms) !== null)
      .map((e) => ({ tool: String(e.tool || e.name || 'a tool'), ms: e.duration_ms })),
  };
}

// The cost of one call, by part, with what could not be priced: { llm, stt, tts, total, missing: [{ stage, provider, model }], reported }
export function costOfCall(sample, models, prices) {
  const missing = [];
  let llm = 0;
  sample.usage.forEach((u) => {
    const price = priceFor(prices, 'llm', u.provider, u.model);
    if (!price) missing.push({ stage: 'llm', provider: u.provider, model: u.model });
    else llm += (u.input * price.input + u.output * price.output) / 1e6;
  });
  let stt = 0;
  let tts = 0;
  if (sample.voice) {
    if (models?.stt) {
      const price = priceFor(prices, 'stt', models.stt.provider, models.stt.model);
      if (price) stt = (sample.durationS / 60) * price.minute;
      else missing.push({ stage: 'stt', ...models.stt });
    }
    if (models?.tts) {
      const price = priceFor(prices, 'tts', models.tts.provider, models.tts.model);
      if (price) tts = (sample.spokenChars / 1e6) * price.million;
      else missing.push({ stage: 'tts', ...models.tts });
    }
  }
  return { llm, stt, tts, total: llm + stt + tts, missing, reported: sample.usage.length > 0 };
}

const BUCKETS = [
  [0, 1000, 'under 1 s'],
  [1000, 2000, '1–2 s'],
  [2000, 3000, '2–3 s'],
  [3000, 5000, '3–5 s'],
  [5000, 8000, '5–8 s'],
  [8000, Infinity, '8 s or more'],
];

// Everything the page shows, from the calls read (`samples`) and how many calls there were in the period (`totalCalls`, for the projection).
//   modelsByBot: { botId: modelsOf(config) }   prices: mergePrices()   days: the period   targetMs: "answers within" target
export function summarize({ samples = [], totalCalls = null, modelsByBot = {}, prices, days = 14, targetMs = 2000 } = {}) {
  const costs = samples.map((s) => ({ sample: s, cost: costOfCall(s, modelsByBot[s.bot], prices) }));
  const n = costs.length;
  const calls = totalCalls ?? n;
  const perDay = days > 0 ? calls / days : null;
  const parts = {
    llm: avg(costs.map((c) => c.cost.llm)),
    stt: avg(costs.map((c) => c.cost.stt)),
    tts: avg(costs.map((c) => c.cost.tts)),
  };
  const costPerCall = n ? avg(costs.map((c) => c.cost.total)) : null;
  const minutes = sum(samples.map((s) => s.durationS)) / 60;

  // what could not be priced, by model, with how many calls it touches
  const missingMap = new Map();
  costs.forEach(({ cost }) => {
    const seen = new Set();
    cost.missing.forEach((m) => {
      const key = `${m.stage}|${priceKey(m.provider, m.model)}`;
      if (seen.has(key)) return;
      seen.add(key);
      missingMap.set(key, { ...m, key: priceKey(m.provider, m.model), calls: (missingMap.get(key)?.calls || 0) + 1 });
    });
  });

  // by model: the calls that used it, tokens per call, and what it costs per call
  const byModel = new Map();
  costs.forEach(({ sample }) => {
    sample.usage.forEach((u) => {
      const key = priceKey(u.provider, u.model);
      const row = byModel.get(key) || { provider: u.provider, model: u.model, calls: new Set(), input: 0, output: 0 };
      row.calls.add(sample.id);
      row.input += u.input;
      row.output += u.output;
      byModel.set(key, row);
    });
  });
  const models = [...byModel.values()]
    .map((r) => {
      const price = priceFor(prices, 'llm', r.provider, r.model);
      const count = r.calls.size;
      return {
        provider: r.provider,
        model: r.model,
        calls: count,
        input: r.input / count,
        output: r.output / count,
        costPerCall: price ? (r.input * price.input + r.output * price.output) / 1e6 / count : null,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  // speed
  const waits = samples.flatMap((s) => s.waits.map((w) => ({ ...w, bot: s.bot, callId: s.id, startedAt: s.startedAt })));
  const ms = waits.map((w) => w.ms);
  const ttfts = samples.flatMap((s) => s.ttfts);
  const toolMap = new Map();
  samples.forEach((s) =>
    s.tools.forEach((t) => {
      const row = toolMap.get(t.tool) || { tool: t.tool, n: 0, total: 0, max: 0 };
      row.n += 1;
      row.total += t.ms;
      row.max = Math.max(row.max, t.ms);
      toolMap.set(t.tool, row);
    }),
  );
  const speed = {
    answers: ms.length,
    p50: percentile(ms, 50),
    p90: percentile(ms, 90),
    ttftP50: percentile(ttfts, 50),
    within: ms.length ? ms.filter((v) => v <= targetMs).length / ms.length : null,
    buckets: BUCKETS.map(([from, to, label]) => ({ label, n: ms.filter((v) => v >= from && v < to).length, slow: from >= 3000 })),
    slowest: [...waits].sort((a, b) => b.ms - a.ms).slice(0, 5),
    tools: [...toolMap.values()].map((r) => ({ tool: r.tool, n: r.n, avgMs: r.total / r.n, maxMs: r.max })).sort((a, b) => b.avgMs - a.avgMs),
  };

  return {
    sampled: n,
    totalCalls: calls,
    perDay,
    costPerCall,
    perMinute: minutes > 0 ? sum(costs.map((c) => c.cost.total)) / minutes : null,
    monthly: costPerCall !== null && perDay !== null ? perDay * 30 * costPerCall : null,
    parts,
    missing: [...missingMap.values()].sort((a, b) => b.calls - a.calls),
    unreported: costs.filter((c) => !c.cost.reported).length,
    // a call cut off before its end never writes the record that reports model use
    unreportedCutOff: costs.filter((c) => !c.cost.reported && c.sample.cutOff).length,
    voiceCalls: samples.filter((s) => s.voice).length,
    tokens: {
      input: avg(samples.filter((s) => s.usage.length).map((s) => sum(s.usage.map((u) => u.input)))),
      output: avg(samples.filter((s) => s.usage.length).map((s) => sum(s.usage.map((u) => u.output)))),
    },
    models,
    speed,
  };
}

// Other language models with a price, and what a call would cost on each with the same tokens (a smaller model may need more words to get the same
// result: it is an estimate of the price, not of the quality). current: { provider, model }; tokens: per call { input, output }.
export function alternatives({ current, tokens, prices }) {
  if (!tokens || tokens.input === null) return { current: null, options: [] };
  const costWith = (price) => (tokens.input * price.input + (tokens.output || 0) * price.output) / 1e6;
  const now = current ? priceFor(prices, 'llm', current.provider, current.model) : null;
  const currentCost = now ? costWith(now) : null;
  const options = Object.entries(prices?.llm || {})
    .map(([key, price]) => {
      const [provider, ...rest] = key.split('/');
      const model = rest.join('/');
      const cost = costWith(price);
      return {
        key,
        provider,
        model,
        costPerCall: cost,
        saving: currentCost ? (currentCost - cost) / currentCost : null,
        sameProvider: !!current && provider === String(current.provider || '').toLowerCase(),
      };
    })
    .filter((o) => !current || o.key !== priceKey(current.provider, current.model))
    .sort((a, b) => a.costPerCall - b.costPerCall);
  return { current: currentCost, options };
}

// Money as people read it: "$0.0123" for less than a cent, "$1.23", "$1,234".
export function money(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  if (value === 0) return '$0';
  if (value < 0.0001) return 'under $0.0001';
  if (value < 0.01) return `$${value.toPrecision(2).replace(/0+$/, '')}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
export const seconds = (ms) => (ms === null || ms === undefined ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
