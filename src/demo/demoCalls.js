// Call records, IMITATED for demo mode: a few made-up calls per agent, and the conversations had in the simulated preview, answered in the
// shapes the real API uses (`GET /bots/{id}/calls`, `.../calls/{id}`, `.../transcript`). They are labelled as demo data on the screens.
// Pure: no network, no DOM, no clock of its own.

import { isObj } from '../studio/form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');

// The records of a conversation, like the runtime writes them: call_started, agent_entered, agent_said / user_said, tool_called, state_changed,
// session_closed, call_ended. `messages` is [{ role: 'user' | 'assistant', text, tools?: [{ tool, args, output, error }] }].
export function buildEvents({
  botId,
  ref = 'draft',
  version = 'draft',
  room,
  channel,
  caller = null,
  messages = [],
  agent = 'assistant',
  startedAt,
  state = {},
  closedBy = 'participant_disconnected',
  stepSeconds = 4,
}) {
  const events = [];
  let seq = 0;
  let elapsed = 0;
  const at = () => new Date(Date.parse(startedAt) + elapsed * 1000).toISOString();
  const add = (event, fields = {}, gap = 0.1) => {
    seq += 1;
    elapsed += gap;
    events.push({ t: at(), seq, elapsed_s: Math.round(elapsed * 1000) / 1000, event, ...fields });
  };
  add(
    'call_started',
    {
      bot: botId,
      ref,
      version,
      room,
      channel,
      caller,
      dialled: null,
      participant: { identity: caller || 'visitor', kind: 'standard' },
      attributes: {},
      not_supported_yet: [],
    },
    0.05,
  );
  add('agent_entered', { agent, first: true });
  let callerTurns = 0;
  let agentTurns = 0;
  let handoffs = 0;
  messages.forEach((m) => {
    if (m.role === 'user') {
      callerTurns += 1;
      add(
        'model_request',
        { agent, model: 'demo-model', messages: events.filter((e) => e.event === 'user_said' || e.event === 'agent_said').length + 1, tools: [] },
        stepSeconds,
      );
      add('user_said', { text: m.text }, 0.02);
    } else {
      list(m.tools).forEach((t) => {
        add('tool_called', { tool: t.tool, args: t.args || {}, ...(t.error ? { error: t.error } : { result: t.output ?? null }), duration_ms: 12 }, 0.3);
        if (t.handoff) {
          handoffs += 1;
          add('agent_entered', { agent: t.handoff, first: false }, 0.05);
        }
      });
      agentTurns += 1;
      add('agent_said', { text: m.text, interrupted: false, ...(m.simulated ? { simulated: true } : {}) }, stepSeconds / 2);
    }
  });
  add('session_closed', { reason: closedBy, error: null }, 1.5);
  add('call_ended', { duration_s: Math.round(elapsed), caller_turns: callerTurns, agent_turns: agentTurns, handoffs, usage: [], state }, 0.1);
  return { events, callerTurns, agentTurns, handoffs, durationS: Math.round(elapsed) };
}

// A stored call: the summary the list shows, plus its events.
export function makeCall({
  botId,
  ref = 'draft',
  version = 'draft',
  channel = { id: 'web-chat', type: 'web_chat' },
  caller = null,
  startedAt,
  messages,
  state = {},
  agent,
  status = 'ended',
  idSuffix = '',
  stepSeconds,
}) {
  const room = `session-${botId}-${idSuffix || Math.abs(Date.parse(startedAt)).toString(16).slice(-8)}`;
  const built = buildEvents({ botId, ref, version, room, channel, caller, messages, agent, startedAt, state, ...(stepSeconds ? { stepSeconds } : {}) });
  const id = `${room}_${stamp(startedAt)}`;
  // a call that was cut off has its records but no ending (no session_closed, no call_ended)
  const events =
    status === 'in_progress'
      ? built.events.slice(0, Math.max(3, Math.floor(built.events.length / 2)))
      : status === 'unfinished'
        ? built.events.slice(0, -2)
        : built.events;
  const last = events[events.length - 1];
  const summary = {
    id,
    room,
    bot: botId,
    ref,
    version,
    channel,
    caller,
    dialled: null,
    started_at: startedAt,
    status,
    last_event_at: last.t,
    size: JSON.stringify(events).length,
    duration_s: status === 'ended' ? built.durationS : Math.round(last.elapsed_s),
    caller_turns: events.filter((e) => e.event === 'user_said').length,
    agent_turns: events.filter((e) => e.event === 'agent_said').length,
    handoffs: built.handoffs,
  };
  return {
    summary,
    events,
    final_state: status === 'ended' ? state : undefined,
    usage:
      status === 'ended'
        ? [{ type: 'llm_usage', provider: 'demo', model: 'demo-model', input_tokens: 120 * summary.caller_turns, output_tokens: 40 * summary.agent_turns }]
        : undefined,
  };
}

const SEED_VERSION = '0.1.1'; // the version the made-up calls say they ran (the agent's draft has moved on)

// A few believable calls for an agent, newest first, spread over the last days. Made from the agent's own greeting and a couple of lines.
export function seedCalls(botId, config, nowIso, { history = true } = {}) {
  const channels = list(config?.channels);
  const web = channels.find((c) => c?.type === 'web_chat') || channels[0];
  const phone = channels.find((c) => c?.type === 'sip_voice' || c?.type === 'web_voice');
  const greeting = typeof web?.greeting?.say === 'string' ? web.greeting.say : 'Hello! How can I help you today?';
  const entry = config?.agents?.entry || 'assistant';
  const ago = (hours) => new Date(Date.parse(nowIso) - hours * 3600 * 1000).toISOString();
  const chan = (c) => ({ id: c?.id || 'web-chat', type: c?.type || 'web_chat' });
  const talk = (...pairs) =>
    pairs.flatMap(([user, agent, extra]) => [
      { role: 'user', text: user },
      { role: 'assistant', text: agent, ...(extra || {}) },
    ]);
  const calls = [
    makeCall({
      botId,
      ref: 'production',
      version: SEED_VERSION,
      channel: chan(web),
      caller: null,
      startedAt: ago(2),
      agent: entry,
      idSuffix: 'a1d2',
      messages: [
        { role: 'assistant', text: greeting },
        ...talk(
          ['What can you help me with?', 'I can answer questions about your account and orders, and pass you to a person if you would like.'],
          ['Thanks, that is all', 'Goodbye, and thank you for getting in touch.', { tools: [{ tool: 'end_call', args: {}, output: { ended: true } }] }],
        ),
      ],
    }),
    makeCall({
      botId,
      ref: 'development',
      version: SEED_VERSION,
      channel: chan(web),
      caller: null,
      startedAt: ago(7),
      agent: entry,
      idSuffix: 'b7e4',
      messages: [
        { role: 'assistant', text: greeting },
        ...talk([
          'Where is my order?',
          'I can’t reach the order system right now.',
          { tools: [{ tool: 'find_order', args: { order_id: 'NB-1003' }, error: 'HTTP 503' }] },
        ]),
      ],
    }),
    makeCall({
      botId,
      ref: 'draft',
      version: 'draft',
      channel: chan(web),
      caller: null,
      startedAt: ago(26),
      agent: entry,
      idSuffix: 'c9f1',
      messages: [{ role: 'assistant', text: greeting }, ...talk(['hello', 'Hi again. What do you need?'])],
      status: 'ended',
    }),
  ];
  if (phone)
    calls.push(
      makeCall({
        botId,
        ref: 'production',
        version: SEED_VERSION,
        channel: chan(phone),
        caller: '+6591234567',
        startedAt: ago(30),
        agent: entry,
        idSuffix: 'd3a8',
        messages: [
          { role: 'assistant', text: greeting },
          ...talk([
            'I need to speak to a person',
            'I’ll put you through now.',
            { tools: [{ tool: 'transfer_or_callback', args: { reason: 'asked for a person' }, output: { transferred: true } }] },
          ]),
        ],
      }),
    );
  return [...calls, ...(history ? seedHistory(botId, config, nowIso) : [])].sort((x, y) => Date.parse(y.summary.started_at) - Date.parse(x.summary.started_at));
}

// Two weeks of earlier calls, so Monitoring has something to show: version 0.1.0 early on and doing well, version 0.1.1 since. Agents whose id says
// "support" have a rough 0.1.1 (calls cut off, a tool failing, people handed over), so the comparison between versions has something to find; the others
// have a few ordinary hiccups. Deterministic: the same agent always gets the same history.
export function seedHistory(botId, config, nowIso) {
  const channels = list(config?.channels);
  const web = channels.find((c) => c?.type === 'web_chat') || channels[0];
  const greeting = typeof web?.greeting?.say === 'string' ? web.greeting.say : 'Hello! How can I help you today?';
  const agents = list(config?.agents?.items)
    .map((a) => a?.id)
    .filter(Boolean);
  const entry = config?.agents?.entry || agents[0] || 'assistant';
  const other = agents.find((id) => id !== entry) || 'specialist';
  const tool = list(config?.tools).find((t) => t && t.id && !t.builtin)?.id || 'lookup_order';
  const chan = { id: web?.id || 'web-chat', type: web?.type || 'web_chat' };
  const ago = (hours) => new Date(Date.parse(nowIso) - hours * 3600 * 1000).toISOString();
  const asks = [
    'Where is my order?',
    'I need to change my booking',
    'What are your opening hours?',
    'Can I get a refund?',
    'How do I reset my password?',
    'Is my payment received?',
  ];
  const rough = /support/.test(botId);
  const out = [];
  const add = (n, hours, version, ref, ask, { status = 'ended', fail = false, handoff = false, repeat = false, slow = false } = {}) => {
    const agentSays = fail ? 'I can’t reach the system right now.' : handoff ? 'I’ll pass you to a specialist.' : 'I can help with that. One moment.';
    const tools = fail
      ? [{ tool, args: {}, error: 'HTTP 500' }]
      : handoff
        ? [{ tool: 'to_specialist', args: {}, handoff: other }]
        : [{ tool, args: {}, output: { ok: true } }];
    const talk = [
      { role: 'user', text: ask },
      { role: 'assistant', text: agentSays, tools },
    ];
    if (repeat) talk.push({ role: 'user', text: ask }, { role: 'assistant', text: 'Sorry, let me try that again.' });
    out.push(
      makeCall({
        botId,
        ref,
        version,
        channel: chan,
        startedAt: ago(hours),
        agent: entry,
        idSuffix: `h${n}`,
        status,
        stepSeconds: slow ? 12 : undefined,
        messages: [{ role: 'assistant', text: greeting }, ...talk],
      }),
    );
  };
  for (let i = 0; i < 8; i += 1) add(i, 24 * 8 + i * 14 + (i % 3) * 3, '0.1.0', 'production', asks[i % asks.length], { handoff: i === 3 });
  for (let i = 0; i < 8; i += 1) {
    const hours = 6 + i * 19 + (i % 2) * 4;
    if (rough)
      add(20 + i, hours, '0.1.1', 'production', asks[(i + 2) % asks.length], {
        status: i % 3 === 0 ? 'unfinished' : 'ended',
        fail: i % 2 === 1,
        handoff: i === 4 || i === 6,
      });
    else add(20 + i, hours, '0.1.1', 'production', asks[(i + 2) % asks.length], { repeat: i === 2, slow: i === 5, status: i === 7 ? 'unfinished' : 'ended' });
  }
  return out;
}

// A conversation had in the simulated preview, kept as a call so Sessions and the trace have something real-looking to show.
export function callFromConversation(botId, { startedAt, channel, messages, tools = [], state = {}, version = 'draft', agent }) {
  const withTools = messages.map((m, i) =>
    m.role === 'assistant' && tools.length
      ? { ...m, tools: i === messages.findIndex((x) => x.role === 'assistant' && x !== messages[0]) ? tools : undefined }
      : m,
  );
  return makeCall({
    botId,
    ref: 'draft',
    version,
    channel: channel || { id: 'web-chat', type: 'web_chat' },
    startedAt,
    messages: withTools.map((m) => ({ ...m, simulated: true })),
    state,
    agent,
  });
}

// ---- the endpoints --------------------------------------------------------------------------------------------------------------------
export function listCallsOf(calls, params, nowMs) {
  const limit = Math.min(200, Math.max(1, Number(params.get('limit')) || 25));
  const since = params.get('since') ? Date.parse(params.get('since')) : -Infinity;
  const until = params.get('until') ? Date.parse(params.get('until')) : Infinity;
  const caller = (params.get('caller') || '').toLowerCase();
  const channel = params.get('channel');
  const status = params.get('status');
  const rows = calls
    .map((c) => c.summary)
    .filter((s) => Date.parse(s.started_at) >= since && Date.parse(s.started_at) <= until)
    .filter(
      (s) =>
        !caller ||
        String(s.caller || '')
          .toLowerCase()
          .includes(caller),
    )
    .filter((s) => !channel || s.channel?.id === channel || s.channel?.type === channel)
    .filter((s) => !status || s.status === status)
    .sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at));
  const offset = Number(params.get('cursor')) || 0;
  void nowMs;
  const page = rows.slice(offset, offset + limit);
  return { calls: page, next: offset + limit < rows.length ? String(offset + limit) : null };
}

export function getCallOf(call, params) {
  const after = Number(params.get('after')) || 0;
  const limit = Math.min(2000, Math.max(1, Number(params.get('limit')) || 500));
  const kinds = (params.get('kinds') || '').split(',').filter(Boolean);
  const all = call.events.filter((e) => e.seq > after && (!kinds.length || kinds.includes(e.event)));
  const events = all.slice(0, limit);
  const counts = {};
  call.events.forEach((e) => {
    counts[e.event] = (counts[e.event] || 0) + 1;
  });
  const ended = call.summary.status === 'ended';
  return {
    call: call.summary,
    events,
    next_after: events.length ? events[events.length - 1].seq : after,
    more: all.length > events.length,
    complete: ended,
    counts,
    ...(ended ? { final_state: call.final_state || {}, usage: call.usage || [] } : {}),
  };
}

export const transcriptOf = (call) => ({
  call: call.summary,
  turns: call.events
    .filter((e) => e.event === 'user_said' || e.event === 'agent_said')
    .map((e) => ({ role: e.event === 'user_said' ? 'caller' : 'agent', text: e.text, at: e.t, elapsed_s: e.elapsed_s })),
});

// Replays a call to `onRecord` one record at a time (what the stream does), then `onEnd` when it has ended. Returns a function that stops.
export function followCallOf(call, { onOpen, onRecord, onEnd }, { delayMs = 350, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let stopped = false;
  let timer = null;
  let i = 0;
  if (onOpen) onOpen(call.summary);
  const step = () => {
    if (stopped) return;
    if (i < call.events.length) {
      onRecord(call.events[i]);
      i += 1;
      timer = schedule(step, delayMs);
      return;
    }
    if (call.summary.status === 'ended' && onEnd) onEnd();
  };
  timer = schedule(step, 0);
  return () => {
    stopped = true;
    cancel(timer);
  };
}

export const isCallObject = (v) => isObj(v) && isObj(v.summary);
