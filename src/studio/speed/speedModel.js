// How fast an agent answers, from its calls, and where each wait goes. Pure: no React, no network.
// Speed is measured from the call's own records: the time from the caller's words to the agent's answer (or, on a voice call, the delay the call itself
// records between the caller stopping and the agent starting to speak), and inside it, when the records say so: waiting to be sure the caller had
// finished, the model starting its answer, the tools and the requests to the business's own systems, and the voice starting to speak.

import { fixMojibake } from '../trace/records.js';
import { percentile } from '../monitoring/monitorModel.js';
import { humanize } from '../newlayout/rowNames.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const secMs = (v) => (num(v) === null ? null : Math.round(v * 1000)); // the records time a step in seconds
const VOICE = new Set(['sip_voice', 'web_voice']);
const DAY = 24 * 3600 * 1000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

// The parts of a wait, in the order they happen, as the page names them. `voice`: only a voice call has it.
export const STAGES = [
  { id: 'listen', label: 'Making sure the caller finished', voice: true, about: 'Waiting a moment of silence to be sure the caller has stopped speaking.' },
  { id: 'think', label: 'The model starting its answer', about: 'The language model reading the conversation and starting to answer.' },
  { id: 'systems', label: 'Looking things up', about: 'The agent’s tools and the requests it makes to your own systems.' },
  {
    id: 'reply',
    label: 'Getting the answer out',
    about: 'On a voice call, the voice turning the first words into sound; in a chat, the rest of the answer being written before it is shown.',
  },
  { id: 'other', label: 'Everything else', about: 'Time the call’s records do not put down to one of the steps above.' },
];

// One call, as the numbers need it. summary: its row in the call list; page: GET /calls/{id} (its events).
//   answers: [{ ms, say, stages: { listen?, think?, systems?, reply?, other? } }]
//   waits (each answer's ms and the caller's words), ttfts, tools, requests: kept for the page's lists and for Home
export function sampleOf(summary, page) {
  const events = list(page?.events)
    .filter(isObj)
    .slice()
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const started = events.find((e) => e.event === 'call_started');
  const channel = summary?.channel?.type || started?.channel?.type || '';
  const voice = VOICE.has(channel);

  const answers = [];
  let turn = null;
  events.forEach((e) => {
    if (e.event === 'user_said') {
      const say = fixMojibake(typeof e.text === 'string' ? e.text : '').trim();
      turn = { say, at: num(e.elapsed_s), listen: secMs(e.timing?.end_of_turn_delay), tools: 0, requests: 0, done: false };
      return;
    }
    if (!turn || turn.done) return;
    if (e.event === 'tool_called' && num(e.duration_ms) !== null) turn.tools += e.duration_ms;
    else if (e.event === 'http_request' && num(e.ms) !== null) turn.requests += e.ms;
    else if (e.event === 'agent_said' && typeof e.text === 'string' && e.text.trim()) {
      turn.done = true;
      const gap = turn.at !== null && num(e.elapsed_s) !== null ? Math.max(0, Math.round((e.elapsed_s - turn.at) * 1000)) : null;
      const e2e = secMs(e.timing?.e2e_latency);
      // what the caller waited: the delay a voice call records, else from their words to the answer (on a voice call, plus making sure they finished)
      const ms = e2e ?? (gap === null ? null : gap + (voice && turn.listen !== null ? turn.listen : 0));
      if (ms === null) return;
      const stages = {};
      if (voice && turn.listen !== null) stages.listen = turn.listen;
      const think = secMs(e.timing?.llm_node_ttft);
      if (think !== null) stages.think = think;
      // a tool's time already holds the requests it made
      const systems = turn.tools || turn.requests;
      if (systems) stages.systems = systems;
      const speak = secMs(e.timing?.tts_node_ttfb);
      if (voice && speak !== null) stages.reply = speak;
      const rest = ms - Object.values(stages).reduce((a, b) => a + b, 0);
      // in a chat what is left once the model has started is the answer being written; on a voice call it is not put down to anything
      // (a tenth of a second or more: less is rounding in the records)
      if (rest >= 100 && (think !== null || systems)) stages[voice ? 'other' : 'reply'] = rest;
      answers.push({ ms, say: turn.say, stages });
    }
  });
  return {
    bot: summary?.bot || '',
    id: summary?.id || '',
    startedAt: summary?.started_at || null,
    channel,
    voice,
    answers,
    waits: answers.map((a) => ({ ms: a.ms, say: a.say })),
    ttfts: events
      .map((e) => num(e.timing?.llm_node_ttft))
      .filter((v) => v !== null)
      .map((s) => Math.round(s * 1000)),
    tools: events
      .filter((e) => e.event === 'tool_called' && num(e.duration_ms) !== null)
      .map((e) => ({ tool: String(e.tool || e.name || 'a tool'), ms: e.duration_ms, failed: !!e.error })),
    requests: events
      .filter((e) => e.event === 'http_request' && num(e.ms) !== null)
      .map((e) => ({
        name: String(e.name || e.connection || e.tool || 'a request'),
        ms: e.ms,
        failed: !!e.error || (num(e.status) !== null && e.status >= 400),
        retried: num(e.attempts) !== null && e.attempts > 1,
      })),
  };
}

const BUCKETS = [
  [0, 1000, 'under 1 s'],
  [1000, 2000, '1–2 s'],
  [2000, 3000, '2–3 s'],
  [3000, 5000, '3–5 s'],
  [5000, 8000, '5–8 s'],
  [8000, Infinity, '8 s or more'],
];

// Which of an agent's finished calls (newest first) to read for their timings when there are more than `count`: some from every day of the period, not
// only the newest (a busy agent's newest calls can all be today's), so the day-by-day line reaches back over the whole period. The newest call of each
// day is taken in turn, newest day first, then the next of each, until `count` are taken. Returned newest first.
export function spreadPick(calls, count) {
  if (calls.length <= count) return calls;
  const byDay = new Map();
  calls.forEach((c) => {
    const t = Date.parse(c?.started_at || '');
    const key = Number.isFinite(t) ? dayKey(t) : '';
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(c);
  });
  const queues = [...byDay.values()];
  const picked = new Set();
  for (let round = 0; picked.size < count; round += 1) {
    queues.forEach((q) => {
      if (picked.size < count && q[round]) picked.add(q[round]);
    });
  }
  return calls.filter((c) => picked.has(c));
}

// How the calls did against the target, in one word: good (9 in 10 within it), ok (3 in 4), slow; few when there are too few answers to say.
export function verdictOf(within, answers) {
  if (within === null || answers < 5) return 'few';
  if (within >= 0.9) return 'good';
  if (within >= 0.75) return 'ok';
  return 'slow';
}

// The parts of a wait, averaged over the answers that recorded each part, for voice calls and for chats apart (a voice call has more of them).
function stagesOf(answers) {
  const out = {};
  for (const kind of ['voice', 'chat']) {
    const these = answers.filter((a) => (kind === 'voice') === a.voice && Object.keys(a.stages).length);
    if (!these.length) continue;
    const avg = {};
    STAGES.forEach((s) => {
      const values = these.map((a) => a.stages[s.id]).filter((v) => typeof v === 'number');
      if (values.length) avg[s.id] = { ms: mean(values), n: values.length };
    });
    out[kind] = { answers: these.length, wait: mean(these.map((a) => a.ms)), avg };
  }
  return out;
}

// The tools and the business's own systems the answers waited on: how often, how long (typically and at worst), how often they failed or had to retry.
function systemsOf(samples) {
  const rows = new Map();
  const add = (kind, name, ms, failed, retried) => {
    const key = `${kind}:${name}`;
    const row = rows.get(key) || { kind, name, label: humanize(name) || name, times: [], failed: 0, retried: 0 };
    row.times.push(ms);
    if (failed) row.failed += 1;
    if (retried) row.retried += 1;
    rows.set(key, row);
  };
  samples.forEach((s) => {
    list(s.tools).forEach((t) => add('tool', t.tool, t.ms, t.failed, false));
    list(s.requests).forEach((r) => add('request', r.name, r.ms, r.failed, r.retried));
  });
  return [...rows.values()]
    .map(({ times, ...r }) => ({ ...r, n: times.length, p50: percentile(times, 50), max: Math.max(...times) }))
    .sort((a, b) => b.p50 - a.p50);
}

// What would make answers sooner, from what the calls show (nothing is suggested without the numbers for it), biggest first.
//   { id, ms, title, lead, tail, why, whyAll?, action, path }: path, the setting to open (as the agent's pages take it); lead and tail around the time
// a suggestion's title, and its two halves around the time, so suggestions about several agents can be said once with the range of their times
const titled = (lead, ms, tail) => ({ title: `${lead} ${seconds(ms)}${tail}`, lead, tail });
export const ADVICE_AT = { listen: 1000, think: 1000, speak: 600, write: 2500, system: 700 }; // ms
function adviceOf(stages, systems) {
  const out = [];
  const voice = stages.voice?.avg || {};
  const chat = stages.chat?.avg || {};
  const both = (id) => {
    const parts = [voice[id], chat[id]].filter(Boolean);
    const n = parts.reduce((a, p) => a + p.n, 0);
    return n ? { ms: parts.reduce((a, p) => a + p.ms * p.n, 0) / n, n } : null;
  };
  const listen = voice.listen;
  if (listen && listen.n >= 3 && listen.ms >= ADVICE_AT.listen)
    out.push({
      id: 'listen',
      ms: listen.ms,
      ...titled('The agent waits', listen.ms, ' to be sure the caller has finished speaking'),
      why: 'On voice calls this comes before every answer. A shorter wait answers sooner; too short and it may speak over a caller who only paused.',
      action: 'Shorten the wait at the end of a turn',
      path: ['defaults', 'conversation', 'turn_handling', 'endpointing'],
    });
  const think = both('think');
  if (think && think.n >= 3 && think.ms >= ADVICE_AT.think)
    out.push({
      id: 'think',
      ms: think.ms,
      ...titled('The AI model takes', think.ms, ' to start answering'),
      why: 'A faster language model starts sooner, and so do shorter instructions: the model reads all of them before every answer.',
      action: 'Choose a faster model',
      path: ['defaults', 'models', 'llm'],
    });
  const speak = voice.reply;
  if (speak && speak.n >= 3 && speak.ms >= ADVICE_AT.speak)
    out.push({
      id: 'speak',
      ms: speak.ms,
      ...titled('The voice takes', speak.ms, ' to start speaking'),
      why: 'Some text-to-speech models are made to start quickly (a “flash” or “turbo” model, for example).',
      action: 'Choose a faster voice model',
      path: ['defaults', 'models', 'tts'],
    });
  const write = chat.reply;
  if (write && write.n >= 3 && write.ms >= ADVICE_AT.write)
    out.push({
      id: 'write',
      ms: write.ms,
      ...titled('Chat answers take', write.ms, ' longer to be written in full'),
      why: 'A chat answer is shown once it is written in full, so long answers keep people waiting. Asking for shorter answers helps.',
      action: 'Ask for shorter answers',
      path: ['persona', 'style_rules'],
    });
  systems
    .filter((s) => s.n >= 2 && s.p50 >= ADVICE_AT.system)
    .slice(0, 2)
    .forEach((s) =>
      out.push({
        id: `system:${s.kind}:${s.name}`,
        ms: s.p50,
        ...titled(`${s.label} usually takes`, s.p50, ''),
        why: `Callers wait while it answers (used ${s.n} times; the longest took ${seconds(s.max)}). Look at it on your side, or have the agent say it is checking while it waits.`,
        whyAll: 'Callers wait while it answers. Look at it on your side, or have the agent say it is checking while it waits.',
        action: s.kind === 'request' ? 'Open its connection' : 'Open the tool',
        path: [s.kind === 'request' ? 'connections' : 'tools'],
      }),
    );
  return out.sort((a, b) => b.ms - a.ms);
}

// The part of an answer's wait that took longest, for the list of the slowest.
const causeOf = (stages) => {
  const [id] = Object.entries(stages).sort((a, b) => b[1] - a[1])[0] || [];
  return id ? STAGES.find((s) => s.id === id) : null;
};

// Everything the page shows, from the calls read (`samples`) and how many calls there were in the period (`totalCalls`).
//   targetMs: the "answered within" target; days, nowMs: the period, for the day-by-day line (left out without them)
export function summarize({ samples = [], totalCalls = null, targetMs = 2000, days = 0, nowMs = 0 } = {}) {
  const answers = samples.flatMap((s) =>
    list(s.answers).map((a) => ({ ...a, bot: s.bot, callId: s.id, startedAt: s.startedAt, channel: s.channel, voice: s.voice })),
  );
  const ms = answers.map((a) => a.ms);
  const ttfts = samples.flatMap((s) => s.ttfts);
  const within = ms.length ? ms.filter((v) => v <= targetMs).length / ms.length : null;
  const systems = systemsOf(samples);
  const stages = stagesOf(answers);

  // a point for every day of the period, a day with no answers left empty
  const byDay = [];
  if (days > 0 && nowMs) {
    for (let i = days - 1; i >= 0; i -= 1) byDay.push({ day: dayKey(nowMs - i * DAY), times: [] });
    const index = new Map(byDay.map((d) => [d.day, d]));
    answers.forEach((a) => {
      const t = Date.parse(a.startedAt || '');
      if (Number.isFinite(t)) index.get(dayKey(t))?.times.push(a.ms);
    });
  }

  return {
    sampled: samples.length,
    totalCalls: totalCalls ?? samples.length,
    verdict: verdictOf(within, ms.length),
    speed: {
      answers: ms.length,
      p50: percentile(ms, 50),
      p90: percentile(ms, 90),
      max: ms.length ? Math.max(...ms) : null,
      ttftP50: percentile(ttfts, 50),
      within,
      buckets: BUCKETS.map(([from, to, label]) => ({ label, n: ms.filter((v) => v >= from && v < to).length, slow: from >= 3000 })),
      slowest: [...answers]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map((a) => ({ ms: a.ms, say: a.say, bot: a.bot, callId: a.callId, channel: a.channel, voice: a.voice, cause: causeOf(a.stages) })),
      tools: systems.filter((s) => s.kind === 'tool').map((s) => ({ tool: s.name, n: s.n, p50: s.p50, maxMs: s.max, failed: s.failed })),
    },
    stages,
    systems,
    days: byDay.map((d) => ({ day: d.day, n: d.times.length, p50: percentile(d.times, 50), p90: percentile(d.times, 90) })),
    advice: adviceOf(stages, systems),
  };
}

export const seconds = (ms) => (ms === null || ms === undefined ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
