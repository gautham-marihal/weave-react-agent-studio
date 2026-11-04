// One call in progress as a Live board card, worked out from its records: who is talking, what was said last, which
// agent has it, how long it has run, and what needs a look. Pure, with the time passed in, so the board can redraw it
// every second and tests can play a call through.

import { HANDOFF_TOOL, WANTS_A_PERSON, closeness } from '../insights/questionsModel.js';
import { fixMojibake } from '../trace/records.js';

const WAITING_S = 8; // a caller who has waited this long for an answer is waiting
const QUIET_S = 45; // nothing written for this long, in a call that is going on
const SLOW_ANSWER_S = 5; // an answer that took this long, earlier in the call
const LONG_S = 10 * 60; // a call this long is worth knowing about
export const RECENT_MS = 10 * 60 * 1000; // how long a call that ended stays on the board

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => fixMojibake(String(v ?? '')).trim();

const TONE_RANK = { bad: 3, warn: 2, info: 1 };

// A phone number with only its last digits showing: "+65 •••• 4471"; anything else (a web visitor's id) is hidden.
export function maskCaller(caller) {
  const raw = String(caller || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!raw || digits.length < 6) return '';
  // the country code when the number shows where it ends ("+44 20 …"), else a guess from the length
  const written = raw.match(/^\+(\d{1,3})[\s.-]/);
  const country = raw.startsWith('+') ? `+${written ? written[1] : digits.slice(0, Math.max(1, Math.min(3, digits.length - 8)))} ` : '';
  return `${country}•••• ${digits.slice(-4)}`;
}

const isVoice = (channel) => /voice|sip|phone|call/.test(String(channel?.type || ''));

// How a duration reads on a card: "45 s", "2:05", "1:02:10".
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

const times = (n) => (n === 2 ? 'twice' : `${n} times`);

//   summary: the call list row (id, bot, room, channel, caller, started_at, status, last_event_at, handoffs)
//   records: its records so far, in seq order
//   heardAtMs: when the board last got a record, on this clock, so durations don't rely on the server's clock agreeing
//   nowMs: the time now, on this clock
export function liveCall(summary, records, { nowMs, heardAtMs = null, endedAtMs = null } = {}) {
  const s = isObj(summary) ? summary : {};
  const recs = list(records)
    .filter(isObj)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const last = recs[recs.length - 1] || null;
  const lastElapsed = num(last?.elapsed_s) ?? 0;
  // when the last record was written, on this clock: when it reached us, or its own time if that is not in our future
  const lastAt = Date.parse(last?.t);
  const heard = Math.max(num(heardAtMs) ?? -Infinity, Number.isNaN(lastAt) ? -Infinity : Math.min(nowMs, lastAt));
  const heardMs = Number.isFinite(heard) ? heard : nowMs;
  const ended = recs.some((r) => r.event === 'call_ended' || r.event === 'session_closed') || s.status === 'ended';
  const cutOff = s.status === 'unfinished';
  const status = ended ? 'ended' : cutOff ? 'cut_off' : 'live';
  const going = status === 'live';
  const sinceHeardS = Math.max(0, (nowMs - heardMs) / 1000);
  const durationS = going ? lastElapsed + sinceHeardS : (num(recs.find((r) => r.event === 'call_ended')?.duration_s) ?? num(s.duration_s) ?? lastElapsed);

  // the conversation, and who has it now
  const lines = [];
  let agent = '';
  let firstAgent = '';
  const handovers = [];
  const tools = [];
  const errors = [];
  const guardrails = [];
  const limits = [];
  const answerWaits = [];
  let pendingSay = null; // the elapsed time of a caller line not yet answered
  recs.forEach((r) => {
    switch (r.event) {
      case 'agent_entered':
        if (r.first || !agent) firstAgent = firstAgent || String(r.agent || '');
        else handovers.push({ to: String(r.agent || ''), at: num(r.elapsed_s) });
        agent = String(r.agent || agent);
        break;
      case 'user_said': {
        const said = text(r.text);
        if (!said) break;
        lines.push({ who: 'caller', text: said, at: num(r.elapsed_s), seq: r.seq });
        if (pendingSay === null) pendingSay = num(r.elapsed_s);
        break;
      }
      case 'agent_said': {
        const said = text(r.text);
        if (!said) break;
        lines.push({ who: 'agent', text: said, at: num(r.elapsed_s), seq: r.seq, agent });
        if (pendingSay !== null && num(r.elapsed_s) !== null) answerWaits.push(num(r.elapsed_s) - pendingSay);
        pendingSay = null;
        break;
      }
      case 'tool_called': {
        const error = r.error ?? r.err ?? null;
        const name = String(r.tool || r.name || 'a tool');
        tools.push({ tool: name, error: error ? String(error) : '', at: num(r.elapsed_s) });
        // a hand-over to another agent is the next agent_entered record; a tool passing the call to a person has none
        if (!error && !r.handoff && HANDOFF_TOOL.test(name)) handovers.push({ to: 'a person', at: num(r.elapsed_s), tool: name });
        break;
      }
      case 'error':
        errors.push(text(r.message ?? r.error ?? r.detail ?? 'Something went wrong'));
        break;
      case 'session_closed':
        if (r.error) errors.push(text(r.error));
        break;
      case 'guardrail_triggered':
        guardrails.push(String(r.rule || r.id || 'a rule'));
        break;
      case 'limit_reached':
        limits.push(String(r.limit || r.name || 'a limit').replace(/_/g, ' '));
        break;
      default:
    }
  });

  // what needs a look, the worst first
  const flags = [];
  const flag = (id, tone, label, detail = '') => flags.push({ id, tone, label, detail });
  if (cutOff) flag('cut_off', 'bad', 'Cut off', 'The call stopped without an ending.');
  const failed = tools.filter((t) => t.error);
  if (failed.length) {
    const byTool = failed.reduce((acc, t) => ({ ...acc, [t.tool]: (acc[t.tool] || 0) + 1 }), {});
    Object.entries(byTool).forEach(([tool, n]) =>
      flag(`tool:${tool}`, 'bad', `“${tool}” failed${n > 1 ? ` ${times(n)}` : ''}`, failed.find((t) => t.tool === tool).error),
    );
  }
  if (errors.length) flag('error', 'bad', 'Error', errors[errors.length - 1]);
  if (limits.length) flag('limit', 'bad', 'A call limit was reached', limits.join(', '));
  const waitingS = going && pendingSay !== null ? Math.max(0, durationS - pendingSay) : 0;
  if (going && waitingS >= WAITING_S) flag('waiting', 'bad', `Caller waiting ${Math.round(waitingS)} s`, 'The caller spoke and has not had an answer yet.');
  else if (going && sinceHeardS >= QUIET_S) flag('quiet', 'warn', `Nothing for ${Math.round(sinceHeardS)} s`, 'No one has said anything for a while.');
  const callerLines = lines.filter((l) => l.who === 'caller');
  const repeatedAt = callerLines.findIndex((l, i) => i > 0 && closeness(l.text, callerLines[i - 1].text) >= 0.85);
  if (repeatedAt > 0) flag('repeated', 'warn', 'Caller repeated themselves', `“${callerLines[repeatedAt].text}”`);
  const asked = callerLines.find((l) => WANTS_A_PERSON.test(l.text.replace(/[’‘]/g, "'")));
  const passedOn = handovers.some((h) => h.to === 'a person');
  if (asked && !passedOn) flag('asked_person', 'warn', 'Asked for a person', `“${asked.text}”`);
  if (guardrails.length)
    flag('guardrail', 'warn', `A safety rule stepped in${guardrails.length > 1 ? ` ${times(guardrails.length)}` : ''}`, guardrails.join(', '));
  const slowest = answerWaits.length ? Math.max(...answerWaits) : 0;
  if (slowest >= SLOW_ANSWER_S && !flags.some((f) => f.id === 'waiting'))
    flag('slow', 'warn', `Slow answer (${slowest.toFixed(1)} s)`, 'One answer took a long time.');
  if (handovers.length) {
    const lastTo = handovers[handovers.length - 1].to;
    flag('handed_over', 'info', lastTo === 'a person' ? 'Passed to a person' : `Passed to ${lastTo}`, '');
  }
  if (durationS >= LONG_S) flag('long', 'info', `Long call (${Math.floor(durationS / 60)} min)`, '');
  flags.sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
  const worst = flags.length ? flags[0].tone : '';

  const lastLine = lines[lines.length - 1] || null;
  return {
    key: `${s.bot || ''}/${s.id || ''}`,
    id: s.id || '',
    bot: s.bot || '',
    room: s.room || '',
    channel: isObj(s.channel) ? s.channel : { id: String(s.channel || ''), type: '' },
    voice: isVoice(s.channel),
    caller: maskCaller(s.caller),
    startedAt: s.started_at || null,
    status,
    durationS,
    sinceHeardS,
    endedAtMs: endedAtMs ?? (going ? null : heardMs),
    agent: agent || firstAgent,
    firstAgent,
    lines,
    lastLine,
    // the agent is working on an answer: the last thing said was the caller's
    thinking: going && pendingSay !== null && waitingS < WAITING_S,
    tools,
    flags,
    attention: worst === 'bad' || worst === 'warn',
    worst,
    callerTurns: callerLines.length,
  };
}

// Board order: what needs a look first (worst, then longest waiting), then the rest, longest running first.
export function boardOrder(a, b) {
  const rank = (c) => (c.attention ? TONE_RANK[c.worst] : 0);
  return rank(b) - rank(a) || b.durationS - a.durationS;
}

// The line atop the board: calls now, how many need a look, how many ended in the last minutes, and per agent.
export function boardSummary(calls) {
  const live = list(calls).filter((c) => c.status === 'live');
  const ended = list(calls).filter((c) => c.status !== 'live');
  const byAgent = {};
  live.forEach((c) => {
    byAgent[c.bot] = byAgent[c.bot] || { live: 0, attention: 0 };
    byAgent[c.bot].live += 1;
    if (c.attention) byAgent[c.bot].attention += 1;
  });
  return { live: live.length, attention: live.filter((c) => c.attention).length, ended: ended.length, byAgent };
}

// A caller's words, hidden: what a screen shared in a room shows instead of what a caller said.
export const hiddenWords = (line) => {
  const n = String(line?.text || '')
    .split(/\s+/)
    .filter(Boolean).length;
  return `Caller spoke (${n} word${n === 1 ? '' : 's'})`;
};

// What a screen reader hears when the board changes: a new call, one now needing a look, one that ended.
// before/after: liveCall()s by key; names: agent names by id. At most `max` messages, most important first.
export function changesToAnnounce(before, after, names = {}, max = 3) {
  const out = [];
  const name = (c) => names[c.bot] || c.bot;
  Object.values(after).forEach((c) => {
    const was = before[c.key];
    if (!was && c.status === 'live') out.push({ rank: 1, text: `New call on ${name(c)}` });
    else if (was && c.attention && (!was.attention || was.flags[0]?.id !== c.flags[0]?.id)) out.push({ rank: 3, text: `${name(c)}: ${c.flags[0].label}` });
    else if (was && was.status === 'live' && c.status !== 'live')
      out.push({ rank: 2, text: `A call on ${name(c)} ${c.status === 'cut_off' ? 'was cut off' : 'ended'}` });
  });
  return out
    .sort((a, b) => b.rank - a.rank)
    .slice(0, max)
    .map((m) => m.text);
}
