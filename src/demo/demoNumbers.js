// Phone numbers IMITATED for demo mode and the tests (FRONTEND_GUIDE 10.5). The real API creates LiveKit SIP trunks;
// here numbers live in the demo state and nothing is connected. Shapes match the live server (read on 2026-10-22).

const list = (v) => (Array.isArray(v) ? v : []);
const ENVIRONMENTS = ['development', 'staging', 'production'];
const PATTERN = '^\\+?[0-9]{3,15}$';
const ok = (body, status = 200) => ({ status, body });
const fail = (status, detail) => ({ status, body: { detail } });

// Numbers "set up by hand" on the imaginary phone system: listed, but not changeable from here.
const HAND_MADE = [
  {
    number: '+6563001000',
    trunk: { id: 'ST_demo1', name: 'singtel poc' },
    rule: { id: 'SDR_demo1', name: 'singtel poc rule', agents: [['agent-singtel', '']] },
  },
  {
    number: '+81355550100',
    trunk: { id: 'ST_demo2', name: 'japan pilot' },
    rule: { id: 'SDR_demo2', name: 'japan pilot rule', agents: [['agent-japan', '']] },
  },
];

const numberSettings = () => ({
  number_pattern: PATTERN,
  environments: ENVIRONMENTS,
  defaults: { record_audio: true, krisp: false, allowed_addresses: [] },
  recording: { format: 'MP3, audio only', path: '/out/{room_name}-{time}' },
  livekit_configured: true,
  demo: true,
});

const clean = (value) => String(value ?? '').trim();

function checkNumber(state, value) {
  const number = clean(value);
  // eslint-disable-next-line sonarjs/concise-regex -- the server's own pattern, word for word, as it sends it
  if (!new RegExp(PATTERN).test(number))
    return { number, status: 'invalid', reason: 'Use digits only, with an optional + at the start (3 to 15 digits, no spaces).', owner: null, warnings: [] };
  const ours = list(state.numbers).find((n) => n.number === number);
  if (ours)
    return {
      number,
      status: 'taken_by_builder',
      owner: { trunk: `agent-builder ${ours.bot}`, bot: ours.bot, environment: ours.environment, agents: ruleAgents(ours) },
      warnings: [],
    };
  const hand = HAND_MADE.find((n) => n.number === number);
  if (hand) return { number, status: 'taken_external', owner: { trunk: hand.trunk.name, agents: hand.rule.agents }, warnings: [] };
  return { number, status: 'free', owner: null, warnings: number.startsWith('+') ? [] : ['A number without a + may be read as an extension.'] };
}

// Our dispatch rule sends calls to the builder's runtime, naming the bot and environment in its metadata.
const ruleAgents = (record) => [['agent-builder-runtime', JSON.stringify({ bot: record.bot, ref: record.environment })]];

// The row for one number: the guide's fields, with the status worked out from what is deployed to its environment.
function rowOf(state, record) {
  const bot = state.bots?.[record.bot];
  const version = bot?.deployed?.[record.environment] || null;
  const config = version ? bot.versions.find((v) => v.version === version)?.config : null;
  const phoneChannel = config ? list(config.channels).some((c) => c?.type === 'sip_voice' && c.enabled !== false) : false;
  const problems = [];
  if (!bot) problems.push('This agent no longer exists.');
  else if (!version) problems.push(`Nothing is deployed to ${record.environment}, so a call would not be answered.`);
  else if (!phoneChannel) problems.push(`The version in ${record.environment} has no phone channel.`);
  const lastCall = record.last_call || null;
  return {
    number: record.number,
    managed: true,
    trunk: { id: record.trunk_id, name: `agent-builder ${record.bot}` },
    bot: record.bot,
    environment: record.environment,
    rule: { id: record.rule_id, name: `agent-builder ${record.bot} (${record.environment})`, agents: ruleAgents(record) },
    options: { ...record.options },
    problems,
    deployment: { deployed: !!version, version },
    phone_channel: phoneChannel,
    last_call: lastCall,
    routing: lastCall ? 'calls_arriving' : 'no_calls_yet',
    routing_note: lastCall
      ? ''
      : `No call to ${record.number} has been logged yet. If calls are expected, whoever runs the phone system (FreeSWITCH) must route ${record.number} to the LiveKit SIP service.`,
    status: problems.length ? 'problem' : lastCall ? 'ready' : 'waiting_for_calls',
  };
}

const handRow = (hand) => ({
  number: hand.number,
  managed: false,
  trunk: hand.trunk,
  bot: null,
  environment: null,
  rule: hand.rule,
  options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: null },
  problems: [],
});

function validOptions(body) {
  const out = {};
  if (body.record_audio !== undefined) {
    if (typeof body.record_audio !== 'boolean') return { error: 'record_audio must be true or false.' };
    out.record_audio = body.record_audio;
  }
  if (body.krisp !== undefined) {
    if (typeof body.krisp !== 'boolean') return { error: 'krisp must be true or false.' };
    out.krisp = body.krisp;
  }
  if (body.allowed_addresses !== undefined) {
    const addresses = list(body.allowed_addresses).map(String);
    if (!Array.isArray(body.allowed_addresses) || addresses.some((a) => !/^[0-9a-f.:]+(\/\d{1,3})?$/i.test(a)))
      return { error: 'allowed_addresses must be IP addresses or networks, like 203.0.113.7 or 10.0.0.0/8.' };
    out.allowed_addresses = addresses;
  }
  if (body.max_call_duration_s !== undefined && body.max_call_duration_s !== null) {
    const n = body.max_call_duration_s;
    if (!Number.isInteger(n) || n < 30 || n > 86400) return { error: 'max_call_duration_s must be a whole number of seconds from 30 to 86400.' };
    out.max_call_duration_s = n;
  }
  return { out };
}

// Answers a numbers request, or null for another path. `ctx` has `id` (a new id) and `commit` (saves the state).
export function routeNumbers(method, path, body, state, ctx) {
  state.numbers = list(state.numbers);
  const all = () => [...state.numbers.map((r) => rowOf(state, r)), ...HAND_MADE.map(handRow)];
  if (path === '/numbers/settings' && method === 'GET') return ok(numberSettings());
  if (path === '/numbers' && method === 'GET') return ok(all());
  if (path === '/numbers/check' && method === 'GET') return ok(checkNumber(state, ctx.params.get('number')));
  const m = path.match(/^\/bots\/([^/]+)\/numbers(?:\/([^/]+))?$/);
  if (!m) return null;
  const botId = decodeURIComponent(m[1]);
  const target = m[2] ? decodeURIComponent(m[2]) : '';
  if (!state.bots?.[botId]) return fail(404, 'No such agent.');
  if (!target && method === 'GET') return ok(state.numbers.filter((r) => r.bot === botId).map((r) => rowOf(state, r)));
  if (!target && method === 'POST') {
    const number = clean(body.number);
    if (!ENVIRONMENTS.includes(body.environment)) return fail(422, `environment must be one of ${ENVIRONMENTS.join(', ')}.`);
    const found = checkNumber(state, number);
    if (found.status === 'invalid') return fail(422, found.reason);
    if (found.status === 'taken_by_builder') {
      const same = state.numbers.find((r) => r.number === number);
      if (same.bot === botId && same.environment === body.environment) return ok({ ...rowOf(state, same), changed: ['already set up'] });
      return fail(409, `${number} already belongs to ${same.bot} (${same.environment}).`);
    }
    if (found.status === 'taken_external') return fail(409, `${number} is used by “${found.owner.trunk}”, which this builder does not manage.`);
    const options = validOptions(body);
    if (options.error) return fail(422, options.error);
    const record = {
      number,
      bot: botId,
      environment: body.environment,
      trunk_id: ctx.id('ST'),
      rule_id: ctx.id('SDR'),
      options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: null, ...options.out },
      last_call: null,
    };
    state.numbers.push(record);
    ctx.commit();
    return ok({ ...rowOf(state, record), changed: ['trunk', 'dispatch rule'] }, 201);
  }
  const record = state.numbers.find((r) => r.number === target);
  if (target && !record) {
    if (HAND_MADE.some((n) => n.number === target))
      return fail(409, `${target} was set up by hand on the phone system. This builder does not manage it, so it cannot be changed here.`);
    return fail(404, `${target} is not a number of this builder.`);
  }
  if (record.bot !== botId) return fail(409, `${target} belongs to ${record.bot}, not ${botId}.`);
  if (method === 'PATCH') {
    if (body.environment !== undefined && !ENVIRONMENTS.includes(body.environment)) return fail(422, `environment must be one of ${ENVIRONMENTS.join(', ')}.`);
    const options = validOptions(body);
    if (options.error) return fail(422, options.error);
    if (body.environment) record.environment = body.environment;
    record.options = { ...record.options, ...options.out };
    ctx.commit();
    return ok(rowOf(state, record));
  }
  if (method === 'DELETE') {
    state.numbers = state.numbers.filter((r) => r !== record);
    ctx.commit();
    return ok({
      removed: [
        { kind: 'dispatch rule', id: record.rule_id },
        { kind: 'inbound trunk', id: record.trunk_id },
      ],
    });
  }
  return null;
}
