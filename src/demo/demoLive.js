// Calls in progress, IMITATED for demo mode: a few conversations that start, go on, and end as the clock moves, so the
// Live board has something to watch without a backend. Everything is a pure function of the agent and the time (no
// timers, no state): the same minute always gives the same calls, a call that began a minute ago has the records it
// would have by now, and asking again a moment later gives more of them. They are labelled as demo data on the screens.

import { llmOf, makeCall } from './demoCalls.js';

const list = (v) => (Array.isArray(v) ? v : []);

export const SLOT_MS = 30000; // a new call may begin in every slot
export const KEEP_MS = 20 * 60 * 1000; // how long a finished call is still listed
export const CUT_OFF_AFTER_S = 120; // a call that stops writing is "cut off" after this long (the API's own rule)

// A small stable number from text (FNV-1a).
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// What each kind of call is about. A caller takes 14–28 s to say the next thing; the agent answers in 1–3 s (the "slow"
// one in 9–13 s), so a call lasts two to four minutes and a few are always going on.
const SCENARIOS = [
  { id: 'plain', ask: 'What are your opening hours?' },
  { id: 'plain', ask: 'How do I reset my password?' },
  { id: 'handoff', ask: 'I need to change my booking' },
  { id: 'toolfail', ask: 'Where is my order?' },
  { id: 'slow', ask: 'Is my payment received?' },
  { id: 'repeat', ask: 'Can I get a refund?' },
  { id: 'plain', ask: 'Where is my order?' },
  { id: 'cutoff', ask: 'I need to speak to someone' },
  { id: 'plain', ask: 'Can I change my delivery address?' },
  { id: 'person', ask: 'My parcel arrived damaged' },
];

function conversation(scenario, { greeting, tool, other }) {
  const hello = { role: 'assistant', text: greeting };
  const ask = { role: 'user', text: scenario.ask };
  const said = (role, text, extra) => ({ role, text, ...(extra || {}) });
  switch (scenario.id) {
    case 'handoff':
      return [
        hello,
        ask,
        said('assistant', 'I can help with that. Which booking is it about?'),
        said('user', 'The one for next Tuesday, reference BK-2231.'),
        said('assistant', 'Changing the date needs our bookings team. I’ll pass you to a specialist now.', {
          tools: [{ tool: 'to_specialist', args: {}, handoff: other }],
        }),
        said('user', 'Thank you'),
        said('assistant', 'Hello, this is the specialist. I can see booking BK-2231. What date would suit you?'),
        said('user', 'Thursday the same week, if possible.'),
        said('assistant', 'Thursday is free at the same time. Shall I move it?'),
        said('user', 'Yes please.'),
        said('assistant', 'Done. You’ll get a confirmation by email. Anything else?'),
        said('user', 'No, that’s all, thanks.'),
        said('assistant', 'Goodbye, and thank you for calling.', { tools: [{ tool: 'end_call', args: {}, output: { ended: true } }] }),
      ];
    case 'toolfail':
      return [
        hello,
        ask,
        said('assistant', 'Let me look that up. What is your order number?'),
        said('user', 'It’s NB-1003.'),
        said('assistant', 'I can’t reach the order system right now. Let me try again.', {
          tools: [{ tool, args: { order_id: 'NB-1003' }, error: 'HTTP 503' }],
        }),
        said('user', 'Please try again'),
        said('assistant', 'Sorry, it is still not answering.', { tools: [{ tool, args: { order_id: 'NB-1003' }, error: 'HTTP 503' }] }),
        said('user', 'That’s annoying. Can someone call me back?'),
        said('assistant', 'Of course. I’ve noted that you’d like a call back today about order NB-1003.'),
        said('user', 'Okay, thanks.'),
        said('assistant', 'Thank you for your patience. Goodbye.', { tools: [{ tool: 'end_call', args: {}, output: { ended: true } }] }),
      ];
    case 'repeat':
      return [
        hello,
        ask,
        said('assistant', 'One moment, I am looking into that.'),
        said('user', 'Can I get a refund?'),
        said('assistant', 'Sorry, let me try that again. Which order is it for?'),
        said('user', 'The blue jacket I bought last week.'),
        said('assistant', 'Thanks. Refunds go back to the card you paid with within five working days. Shall I start one?'),
        said('user', 'Yes, please.'),
        said('assistant', 'Done. You’ll get an email confirming it. Anything else?'),
        said('user', 'No, thank you.'),
        said('assistant', 'Goodbye!', { tools: [{ tool: 'end_call', args: {}, output: { ended: true } }] }),
      ];
    case 'person':
      return [
        hello,
        ask,
        said('assistant', 'I’m sorry to hear that. Could you tell me what was damaged?'),
        said('user', 'The box was crushed and the lamp inside is broken.'),
        said('assistant', 'Thank you. I can send a replacement, or a refund. Which would you prefer?'),
        said('user', 'I want to speak to a person about this.'),
        said('assistant', 'Of course. I’m passing you to a colleague now.', {
          tools: [{ tool: 'escalate_to_human', args: { reason: 'damaged item' }, output: { transferred: true } }],
        }),
      ];
    case 'cutoff':
      return [
        hello,
        ask,
        said('assistant', 'Of course. Can I ask what it is about, so I find the right person?'),
        said('user', 'It’s about my last bill.'),
        said('assistant', 'Let me find someone for you.'),
        said('user', 'Hello? Are you there?'),
      ];
    default:
      return [
        hello,
        ask,
        said('assistant', 'I can help with that. One moment.', { tools: [{ tool, args: {}, output: { ok: true } }] }),
        said('user', 'Great.'),
        said('assistant', 'Here is what I found. Is there anything else I can check?'),
        said('user', 'Can you also check my last payment?'),
        said('assistant', 'Yes, your last payment arrived on Monday.'),
        said('user', 'And when is the next one due?'),
        said('assistant', 'The next one is due on the 1st of next month.'),
        said('user', 'Thanks, that is all.'),
        said('assistant', 'Goodbye, and thank you for getting in touch.', { tools: [{ tool: 'end_call', args: {}, output: { ended: true } }] }),
      ];
  }
}

const iso = (ms) => new Date(ms).toISOString();

// The summary a list row would carry, worked out from the records so far.
function summaryOf(full, events, status, elapsedS) {
  const last = events[events.length - 1];
  return {
    ...full.summary,
    status,
    last_event_at: last.t,
    size: JSON.stringify(events).length,
    duration_s: status === 'ended' ? full.summary.duration_s : Math.round(elapsedS),
    caller_turns: events.filter((e) => e.event === 'user_said').length,
    agent_turns: events.filter((e) => e.event === 'agent_said').length,
    handoffs: events.filter((e) => e.event === 'agent_entered' && e.first === false).length,
  };
}

// The calls of one agent as they are at `nowMs`: the ones in progress, and the ones that ended or were cut off in the last KEEP_MS.
// Each is { summary, events, final_state?, usage? } like a stored call. `bot` is { id, config }.
export function liveCallsFor(bot, nowMs, { keepMs = KEEP_MS } = {}) {
  const config = bot?.config || {};
  const channels = list(config.channels).filter((c) => c && c.enabled !== false && c.id);
  if (!channels.length) return [];
  const greetOf = (c) => (typeof c?.greeting?.say === 'string' ? c.greeting.say : 'Hello! How can I help you today?');
  const agents = list(config.agents?.items)
    .map((a) => a?.id)
    .filter(Boolean);
  const entry = config.agents?.entry || agents[0] || 'assistant';
  const other = agents.find((id) => id !== entry) || 'specialist';
  const tool = list(config.tools).find((t) => t && t.id && !t.builtin)?.id || 'lookup_order';
  const out = [];
  const first = Math.floor((nowMs - keepMs - 5 * 60 * 1000) / SLOT_MS);
  const last = Math.floor(nowMs / SLOT_MS);
  for (let n = first; n <= last; n += 1) {
    const h = hash(`${bot.id}:${n}`);
    if (h % 100 >= 55) continue; // not every slot starts a call
    const startMs = n * SLOT_MS + (h % 20000);
    if (startMs > nowMs) continue;
    const scenario = SCENARIOS[(h >>> 8) % SCENARIOS.length];
    const channel = channels[(h >>> 4) % channels.length];
    const caller = channel.type === 'sip_voice' ? `+65${String(81000000 + (h % 9000000)).padStart(8, '0')}` : null;
    const full = makeCall({
      botId: bot.id,
      ref: 'production',
      version: '0.1.1',
      channel: { id: channel.id, type: channel.type },
      caller,
      startedAt: iso(startMs),
      agent: entry,
      idSuffix: `live${n}`,
      callerGap: (turn) => 14 + ((h >>> (turn % 16)) % 15),
      replyGap: (turn) => (scenario.id === 'slow' ? 9 + ((h >>> turn) % 5) : 1.1 + ((h >>> (turn + 3)) % 17) / 10),
      model: llmOf(config),
      status: 'ended',
      messages: conversation(scenario, { greeting: greetOf(channel), tool, other }),
    });
    const elapsedS = (nowMs - startMs) / 1000;
    const total = full.summary.duration_s;
    if (scenario.id === 'cutoff') {
      // the worker stops writing partway: the last record is the caller's last line, and nothing follows it
      const written = full.events.filter((e) => e.event !== 'session_closed' && e.event !== 'call_ended');
      const stops = written[written.length - 1].elapsed_s;
      const events = written.filter((e) => e.elapsed_s <= elapsedS);
      if (!events.length) continue;
      const status = elapsedS - stops > CUT_OFF_AFTER_S ? 'unfinished' : 'in_progress';
      if (status === 'unfinished' && nowMs - (startMs + stops * 1000) > keepMs) continue;
      out.push({ summary: summaryOf(full, events, status, Math.min(elapsedS, stops)), events });
      continue;
    }
    if (elapsedS < total) {
      const events = full.events.filter((e) => e.elapsed_s <= elapsedS);
      if (!events.length) continue;
      out.push({ summary: summaryOf(full, events, 'in_progress', elapsedS), events });
    } else if (nowMs - (startMs + total * 1000) <= keepMs) {
      out.push(full);
    }
  }
  return out.sort((a, b) => Date.parse(b.summary.started_at) - Date.parse(a.summary.started_at));
}

// One of them, by id or room (what `GET /calls/{id}` does).
export const liveCallOf = (bot, key, nowMs) => liveCallsFor(bot, nowMs).find((c) => c.summary.id === key || c.summary.room === key) || null;

// Follows a live call the way the stream endpoint does: the records so far (after `after`), then each new one as the
// clock reaches it, then `onEnd` when the call ends. A call that is cut off just stops. `read` gives the clock in ms;
// `every` is how often it looks. Returns a function that stops.
export function followLive(
  bot,
  key,
  { onOpen, onRecord, onEnd },
  { after = 0, read = () => Date.now(), every = 1000, schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let stopped = false;
  let timer = null;
  let seq = after;
  let opened = false;
  const look = () => {
    if (stopped) return;
    const call = liveCallOf(bot, key, read());
    if (!call) return;
    if (!opened) {
      opened = true;
      if (onOpen) onOpen(call.summary);
    }
    call.events
      .filter((e) => e.seq > seq)
      .forEach((e) => {
        seq = e.seq;
        onRecord(e);
      });
    if (call.summary.status === 'ended') {
      if (onEnd) onEnd();
      return;
    }
    timer = schedule(look, every);
  };
  timer = schedule(look, 0);
  return () => {
    stopped = true;
    cancel(timer);
  };
}
