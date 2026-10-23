// Call records, IMITATED for demo mode: a few made-up calls per agent, and the conversations had in the simulated preview, answered in the
// shapes the real API uses (`GET /bots/{id}/calls`, `.../calls/{id}`, `.../transcript`). They are labelled as demo data on the screens.
// Pure: no network, no DOM, no clock of its own.

import { isObj } from '../studio/form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');
// the number a phone caller rang, as the runtime records it on a call (FRONTEND_GUIDE 10.3: `dialled`); a web visitor rings nothing
const DEMO_DIALLED = '+6531580100';

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
  // optional, for calls that should look like a real line: how long the caller takes to say the next thing, and how long the agent takes to answer
  // (each a number or a function of the turn), and the model the agent runs on (written on its requests and in the usage)
  callerGap = null,
  replyGap = null,
  model = null,
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
      dialled: channel?.type === 'sip_voice' ? DEMO_DIALLED : null,
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
  let inputTokens = 0;
  let outputTokens = 0;
  const gap = (value, turn, fallback) => (typeof value === 'function' ? value(turn) : typeof value === 'number' ? value : fallback);
  // a voice call records what the runtime times on one (in seconds): waiting to be sure the caller finished, the text of what they said, and, on the
  // answer, the model starting, the voice starting and the whole delay the caller heard. Varied a little from turn to turn, the same every time.
  const voice = channel?.type === 'sip_voice' || channel?.type === 'web_voice';
  const r3 = (v) => Math.round(v * 1000) / 1000;
  let heard = 0; // making sure the caller finished, on the turn being answered
  messages.forEach((m) => {
    if (m.role === 'user') {
      callerTurns += 1;
      const spoken = events.filter((e) => e.event === 'user_said' || e.event === 'agent_said').length + 1;
      // what a request costs grows with the conversation: the instructions, plus every line so far
      inputTokens += model ? 900 + 45 * spoken : 120;
      add('model_request', { agent, model: model?.model || 'demo-model', messages: spoken, tools: [] }, gap(callerGap, callerTurns, stepSeconds));
      if (voice) heard = r3(0.55 + ((seq * 37) % 60) / 100);
      add('user_said', { text: m.text, ...(voice ? { timing: { end_of_turn_delay: heard, transcription_delay: r3(heard * 0.85) } } : {}) }, 0.02);
    } else {
      let toolMs = 0; // the tools of this answer, which the delay a voice call records includes
      list(m.tools).forEach((t) => {
        // a tool takes a few hundred milliseconds to a second or so on a call that looks real, and a moment otherwise
        const took = typeof t.ms === 'number' ? t.ms : model ? 180 + ((seq * 389 + String(t.tool).length * 97) % 1300) : 12;
        toolMs += took;
        add('tool_called', { tool: t.tool, args: t.args || {}, ...(t.error ? { error: t.error } : { result: t.output ?? null }), duration_ms: took }, 0.3);
        if (t.handoff) {
          handoffs += 1;
          add('agent_entered', { agent: t.handoff, first: false }, 0.05);
        }
      });
      agentTurns += 1;
      outputTokens += model ? Math.max(12, Math.round(String(m.text || '').length / 4)) : 40;
      const wait = gap(replyGap, agentTurns, stepSeconds / 2);
      add(
        'agent_said',
        {
          text: m.text,
          interrupted: false,
          ...(m.simulated ? { simulated: true } : {}),
          ...(voice && callerTurns > 0
            ? (() => {
                // the whole delay the caller heard is its parts and a little more, as the runtime records it
                const ttft = r3(wait * 0.55);
                const ttfb = r3(0.18 + ((seq * 53) % 40) / 100);
                return { timing: { llm_node_ttft: ttft, tts_node_ttfb: ttfb, e2e_latency: r3(heard + ttft + ttfb + toolMs / 1000 + 0.06) } };
              })()
            : replyGap !== null && callerTurns > 0
              ? { timing: { llm_node_ttft: Math.round(wait * 0.55 * 1000) / 1000 } }
              : {}),
        },
        wait,
      );
    }
  });
  add('session_closed', { reason: closedBy, error: null }, 1.5);
  const usage = model
    ? [{ type: 'llm_usage', provider: model.provider || 'demo', model: model.model || 'demo-model', input_tokens: inputTokens, output_tokens: outputTokens }]
    : [];
  add('call_ended', { duration_s: Math.round(elapsed), caller_turns: callerTurns, agent_turns: agentTurns, handoffs, usage, state }, 0.1);
  return { events, callerTurns, agentTurns, handoffs, durationS: Math.round(elapsed), usage };
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
  callerGap,
  replyGap,
  model,
}) {
  const room = `session-${botId}-${idSuffix || Math.abs(Date.parse(startedAt)).toString(16).slice(-8)}`;
  const built = buildEvents({
    botId,
    ref,
    version,
    room,
    channel,
    caller,
    messages,
    agent,
    startedAt,
    state,
    ...(stepSeconds ? { stepSeconds } : {}),
    ...(callerGap !== undefined ? { callerGap } : {}),
    ...(replyGap !== undefined ? { replyGap } : {}),
    ...(model ? { model } : {}),
  });
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
    dialled: channel?.type === 'sip_voice' ? DEMO_DIALLED : null,
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
        ? built.usage.length
          ? built.usage
          : [{ type: 'llm_usage', provider: 'demo', model: 'demo-model', input_tokens: 120 * summary.caller_turns, output_tokens: 40 * summary.agent_turns }]
        : undefined,
  };
}

const SEED_VERSION = '0.1.1'; // the version the made-up calls say they ran (the agent's draft has moved on)

// The model an agent runs on, as its calls report it (the draft's language model), written in their usage as a real call writes it.
export const llmOf = (config) => {
  const llm = config?.defaults?.models?.llm;
  return llm && typeof llm.model === 'string' && llm.model
    ? { provider: String(llm.provider || ''), model: llm.model }
    : { provider: 'openai', model: 'gpt-4.1-mini' };
};

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
      model: llmOf(config),
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
      model: llmOf(config),
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
      model: llmOf(config),
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
        model: llmOf(config),
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
  return [
    ...calls,
    ...(history ? [...seedHistory(botId, config, nowIso), ...seedQuestions(botId, config, nowIso), ...seedIncident(botId, config, nowIso)] : []),
  ].sort((x, y) => Date.parse(y.summary.started_at) - Date.parse(x.summary.started_at));
}

// Something going wrong right now, so Alerts has something to show: on an agent whose id says "support" its lookup tool has failed on the last few calls
// (an API that is down); on one whose id says "front" the answers of the last hour are slow. The others are fine. Deterministic, relative to `nowIso`.
export function seedIncident(botId, config, nowIso) {
  const channels = list(config?.channels);
  const web = channels.find((c) => c?.type === 'web_chat') || channels[0];
  const greeting = typeof web?.greeting?.say === 'string' ? web.greeting.say : 'Hello! How can I help you today?';
  const entry = config?.agents?.entry || 'assistant';
  // the hand-over to a person is what fails: every demo agent has that tool, so "Open the tool" on the alert lands on it
  const tools = list(config?.tools).filter((t) => t && t.id);
  const tool = (tools.find((t) => /escalat|transfer|human/.test(t.id)) || tools.find((t) => t.id !== 'end_call'))?.id || 'escalate_to_human';
  const chan = { id: web?.id || 'web-chat', type: web?.type || 'web_chat' };
  const ago = (minutes) => new Date(Date.parse(nowIso) - minutes * 60 * 1000).toISOString();
  if (/support/.test(botId))
    return [4, 9, 15, 22].map((minutes, i) =>
      makeCall({
        model: llmOf(config),
        botId,
        ref: 'production',
        version: SEED_VERSION,
        channel: chan,
        startedAt: ago(minutes),
        agent: entry,
        idSuffix: `inc${i}`,
        messages: [
          { role: 'assistant', text: greeting },
          {
            role: 'user',
            text: [
              'My parcel arrived damaged, I need to talk to someone.',
              'Can I speak to a person about a refund?',
              'I want to make a complaint.',
              'Please put me through to your team.',
            ][i],
          },
          {
            role: 'assistant',
            text: 'I’m sorry, I couldn’t put you through to the team just now. Please try again in a little while.',
            tools: [{ tool, args: { reason: 'caller asked for a person' }, error: 'HTTP 503' }],
          },
        ],
      }),
    );
  if (/front/.test(botId))
    return [12, 31, 48].map((minutes, i) =>
      makeCall({
        model: llmOf(config),
        botId,
        ref: 'production',
        version: SEED_VERSION,
        channel: chan,
        startedAt: ago(minutes),
        agent: entry,
        idSuffix: `slow${i}`,
        stepSeconds: 19, // about ten seconds before each answer
        messages: [
          { role: 'assistant', text: greeting },
          { role: 'user', text: ['What are your opening hours?', 'Where are you located?', 'Can I book for Friday?'][i] },
          { role: 'assistant', text: 'One moment while I check that for you.' },
          { role: 'user', text: 'Thanks' },
          { role: 'assistant', text: 'You are welcome. Goodbye!' },
        ],
      }),
    );
  return [];
}

// Two weeks of questions the agent could not answer, worded different ways, so "Questions it couldn't answer" has something to group: Sunday delivery
// (passed to a person), paying with PayPal and a student discount (it did not know), shipping abroad (found nothing), and one the caller had to ask twice.
export function seedQuestions(botId, config, nowIso) {
  const channels = list(config?.channels);
  const web = channels.find((c) => c?.type === 'web_chat') || channels[0];
  const greeting = typeof web?.greeting?.say === 'string' ? web.greeting.say : 'Hello! How can I help you today?';
  const agents = list(config?.agents?.items)
    .map((a) => a?.id)
    .filter(Boolean);
  const entry = config?.agents?.entry || agents[0] || 'assistant';
  const other = agents.find((id) => id !== entry) || 'specialist';
  const chan = { id: web?.id || 'web-chat', type: web?.type || 'web_chat' };
  const ago = (hours) => new Date(Date.parse(nowIso) - hours * 3600 * 1000).toISOString();
  const passOn = { text: 'I’m not sure about that. Let me pass you to someone who can help.', tools: [{ tool: 'to_specialist', args: {}, handoff: other }] };
  const passOnWords = { text: 'Let me pass you to a colleague who can help with that.' };
  const didNotKnow = (topic) => ({ text: `I’m afraid I don’t have any information about ${topic}.` });
  const foundNothing = { text: 'I couldn’t find anything about that.', tools: [{ tool: 'search_help', args: {}, output: { results: [] } }] };
  const asked = [
    [5, 'Do you deliver on Sundays?', passOn],
    [29, 'Can you deliver on a Sunday?', passOnWords],
    [53, 'Is Sunday delivery available?', passOn],
    [98, 'do you deliver sundays', passOn],
    [170, 'Do you deliver on Sundays?', passOnWords],
    [16, 'Can I pay with PayPal?', didNotKnow('payment methods')],
    [77, 'Do you take PayPal?', didNotKnow('payment methods')],
    [140, 'Can I pay using PayPal please?', didNotKnow('payment methods')],
    [40, 'Is there a student discount?', didNotKnow('discounts')],
    [121, 'Do you have discounts for students?', didNotKnow('discounts')],
    [66, 'Do you ship to Malaysia?', foundNothing],
    [190, 'Can you ship my order to Malaysia?', foundNothing],
  ];
  const calls = asked.map(([hours, question, reply], i) =>
    makeCall({
      model: llmOf(config),
      botId,
      ref: 'production',
      version: SEED_VERSION,
      channel: chan,
      startedAt: ago(hours + 0.3),
      agent: entry,
      idSuffix: `q${i}`,
      messages: [
        { role: 'assistant', text: greeting },
        { role: 'user', text: question },
        { role: 'assistant', ...reply },
      ],
    }),
  );
  // the caller had to ask twice: the agent's first answer missed the point
  calls.push(
    makeCall({
      model: llmOf(config),
      botId,
      ref: 'production',
      version: SEED_VERSION,
      channel: chan,
      startedAt: ago(84.4),
      agent: entry,
      idSuffix: 'q_again',
      messages: [
        { role: 'assistant', text: greeting },
        { role: 'user', text: 'Can I change the delivery address after ordering?' },
        { role: 'assistant', text: 'Orders usually arrive in three to five days.' },
        { role: 'user', text: 'Can I change the delivery address after I ordered?' },
        { role: 'assistant', text: 'Let me pass you to a colleague who can help with that.' },
      ],
    }),
  );
  return calls;
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
  // an agent people can also ring takes some of these on its phone line or its web voice
  const spoken = channels.find((c) => c?.type === 'sip_voice' || c?.type === 'web_voice');
  const voiceChan = spoken ? { id: spoken.id || spoken.type, type: spoken.type } : null;
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
        model: llmOf(config),
        botId,
        ref,
        version,
        channel: voiceChan && n % 3 === 1 ? voiceChan : chan,
        ...(voiceChan && n % 3 === 1 && voiceChan.type === 'sip_voice' ? { caller: `+65912${String(34500 + n * 17).slice(-5)}` } : {}),
        startedAt: ago(hours),
        agent: entry,
        idSuffix: `h${n}`,
        status,
        stepSeconds: slow ? 12 : undefined,
        // answers in about one to three and a half seconds, varying from call to call (a slow one waits its 6 s)
        ...(slow ? {} : { replyGap: (turn) => 0.9 + ((n * 7 + turn * 3) % 26) / 10 }),
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
