// Phone numbers on the real platform (FRONTEND_GUIDE 10.5): the number is the person's, the API checks it is free and creates the LiveKit SIP trunk and dispatch
// rule. A number belongs to a bot and an environment, so a call to it is answered by whatever version is deployed there. The list also holds the numbers set up
// by hand on the phone system, which are read-only here. This module reads the API's rows TOLERANTLY (a missing part is left out, never an error) and says
// everything in plain words. Pure: no network, no DOM.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const ENVIRONMENT_WORDS = { development: 'Development', staging: 'Staging', production: 'Production' };
export const environmentWord = (env) => ENVIRONMENT_WORDS[env] || text(env) || '—';

// ---- a row of the list -------------------------------------------------------------------------------------------------------------------------
export function normalizeNumber(raw) {
  const r = isObj(raw) ? raw : {};
  const o = isObj(r.options) ? r.options : {};
  const d = isObj(r.deployment) ? r.deployment : null;
  const call = isObj(r.last_call) ? r.last_call : null;
  return {
    number: text(r.number),
    managed: r.managed === true,
    trunk: isObj(r.trunk) ? { id: text(r.trunk.id), name: text(r.trunk.name) } : null,
    bot: text(r.bot),
    environment: text(r.environment),
    // the platform lists a rule's agents as [bot, ref] pairs
    rule: isObj(r.rule)
      ? {
          id: text(r.rule.id),
          name: text(r.rule.name),
          agents: list(r.rule.agents)
            .map((a) => (Array.isArray(a) ? text(a[0]) : text(a)))
            .filter(Boolean),
        }
      : null,
    options: {
      recordAudio: typeof o.record_audio === 'boolean' ? o.record_audio : undefined,
      krisp: typeof o.krisp === 'boolean' ? o.krisp : undefined,
      allowedAddresses: list(o.allowed_addresses).map(text),
      maxCallDurationS: num(o.max_call_duration_s),
    },
    problems: list(r.problems).map((p) => (isObj(p) ? text(p.message || p.problem || JSON.stringify(p)) : text(p))),
    deployment: d ? { deployed: d.deployed === true, version: text(d.version) } : null,
    phoneChannel: typeof r.phone_channel === 'boolean' ? r.phone_channel : null,
    lastCall: call ? { id: text(call.id), at: text(call.at), caller: text(call.caller), status: text(call.status) } : null,
    routing: text(r.routing),
    routingNote: text(r.routing_note),
    status: text(r.status),
  };
}

export const normalizeNumbers = (raw) =>
  list(isObj(raw) ? (raw.numbers ?? raw.items) : raw)
    .map(normalizeNumber)
    .filter((n) => n.number);

// What a row's status means, in a customer's words.
export function statusWords(row) {
  if (!row.managed)
    return { tone: 'muted', label: 'Set up by hand', words: 'This number was set up on the phone system by hand. It can be seen here but not changed.' };
  if (row.status === 'ready') return { tone: 'good', label: 'Ready', words: 'A call to this number has been logged.' };
  if (row.status === 'waiting_for_calls') return { tone: 'wait', label: 'Waiting for calls', words: 'Set up and deployed. No call has been logged yet.' };
  if (row.status === 'problem')
    return { tone: 'bad', label: 'Needs attention', words: row.problems.length ? row.problems.join(' ') : 'Something is not set up.' };
  return { tone: 'muted', label: row.status ? row.status.replace(/_/g, ' ') : 'Set up', words: '' };
}

// "Calls to this number are answered by version 0.1.1 of Acme Support in Production." (or why not)
export function answeredBy(row, botName = '') {
  if (!row.managed) return row.rule?.agents.length ? `Sent to ${row.rule.agents.join(', ')} by the phone system.` : 'Routed by the phone system.';
  const who = botName || row.bot || 'an agent';
  if (row.deployment && !row.deployment.deployed)
    return `Nothing is deployed to ${environmentWord(row.environment)} for ${who} yet, so a call would not be answered.`;
  if (row.phoneChannel === false) return `The version in ${environmentWord(row.environment)} has no phone channel, so a call would not be answered.`;
  return `Answered by ${row.deployment?.version ? `version ${row.deployment.version} of ` : ''}${who}, in ${environmentWord(row.environment)}.`;
}

// The settings of a number in a line.
export function optionWords(row) {
  const o = row.options;
  const parts = [];
  if (o.recordAudio !== undefined) parts.push(o.recordAudio ? 'calls are recorded' : 'calls are not recorded');
  if (o.krisp) parts.push('noise filtering on');
  if (o.maxCallDurationS)
    parts.push(
      `calls end after ${Math.round(o.maxCallDurationS / 60) >= 1 ? `${Math.round((o.maxCallDurationS / 60) * 10) / 10} minutes` : `${o.maxCallDurationS} seconds`}`,
    );
  if (o.allowedAddresses.length) parts.push(`only from ${o.allowedAddresses.length} address${o.allowedAddresses.length === 1 ? '' : 'es'}`);
  return parts.join(' · ');
}

// ---- the form: checking a number as it is typed -----------------------------------------------------------------------------------------------------
export function normalizeCheck(raw) {
  const r = isObj(raw) ? raw : {};
  const owner = isObj(r.owner) ? r.owner : {};
  const who = text(owner.bot)
    ? `${text(owner.bot)}${owner.environment ? ` (${environmentWord(owner.environment)})` : ''}`
    : text(typeof r.owner === 'string' ? r.owner : '');
  const trunk = text(owner.trunk) || text(owner.trunk_name) || text(typeof r.owner === 'string' ? r.owner : '');
  return {
    status: text(r.status),
    who,
    trunk,
    reason: text(r.reason),
    warnings: list(r.warnings).map(text),
  };
}

export function checkWords(check) {
  switch (check.status) {
    case 'free':
      return { tone: 'good', words: 'This number is free.' };
    case 'taken_by_builder':
      return { tone: 'bad', words: check.who ? `This number is already used by ${check.who}.` : 'This number is already used by another agent.' };
    case 'taken_external':
      return {
        tone: 'bad',
        words: check.trunk
          ? `This number is used by “${check.trunk}”, which this builder does not manage.`
          : 'This number is used on the phone system by something this builder does not manage.',
      };
    case 'invalid':
      return { tone: 'bad', words: check.reason || 'This does not look like a valid number.' };
    default:
      return { tone: 'muted', words: '' };
  }
}

// ---- the settings the form's hints come from ----------------------------------------------------------------------------------------------------
export function normalizeNumberSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const d = isObj(r.defaults) ? r.defaults : {};
  return {
    pattern: text(r.number_pattern),
    environments: list(r.environments).length ? list(r.environments).map(text) : ['development', 'staging', 'production'],
    defaults: { recordAudio: d.record_audio !== false, krisp: d.krisp === true, allowedAddresses: list(d.allowed_addresses).map(text) },
    recording: isObj(r.recording) ? { format: text(r.recording.format), path: text(r.recording.path) } : { format: text(r.recording), path: '' },
    livekitConfigured: r.livekit_configured !== false,
  };
}

// A number typed by a person, against the server's pattern (when it sent one). '' = fine or nothing to say yet.
export function numberProblem(value, pattern) {
  const typed = text(value).trim();
  if (!typed) return '';
  if (!pattern) return '';
  try {
    return new RegExp(pattern).test(typed) ? '' : 'Write the number the way your phone system expects it, with no spaces or brackets.';
  } catch {
    return '';
  }
}

// What is sent to create a number: only what was set, so the server's own defaults apply to the rest.
export function createBody(form, defaults) {
  const body = { number: text(form.number).trim(), environment: form.environment };
  if (form.recordAudio !== undefined && form.recordAudio !== defaults.recordAudio) body.record_audio = form.recordAudio;
  if (form.krisp !== undefined && form.krisp !== defaults.krisp) body.krisp = form.krisp;
  const addresses = parseAddresses(form.allowedAddresses);
  if (addresses.length) body.allowed_addresses = addresses;
  const max = parseMaxDuration(form.maxMinutes);
  if (max.value !== undefined) body.max_call_duration_s = max.value;
  return body;
}

// Only what changed, for a PATCH.
export function patchBody(before, form) {
  const out = {};
  if (form.environment && form.environment !== before.environment) out.environment = form.environment;
  if (form.recordAudio !== undefined && form.recordAudio !== before.options.recordAudio) out.record_audio = form.recordAudio;
  if (form.krisp !== undefined && form.krisp !== before.options.krisp) out.krisp = form.krisp;
  const addresses = parseAddresses(form.allowedAddresses);
  if (JSON.stringify(addresses) !== JSON.stringify(before.options.allowedAddresses)) out.allowed_addresses = addresses;
  const max = parseMaxDuration(form.maxMinutes);
  if (max.value !== undefined && max.value !== before.options.maxCallDurationS) out.max_call_duration_s = max.value;
  // an empty box means no limit: take away the one that is set (the rows show "none" as null)
  else if (max.value === undefined && !max.error && before.options.maxCallDurationS) out.max_call_duration_s = null;
  return out;
}

export const parseAddresses = (value) =>
  text(value)
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);

// Minutes typed by a person -> the seconds the API wants (30 to 86400). Empty means "no limit set".
export function parseMaxDuration(minutes) {
  const typed = text(minutes).trim();
  if (!typed) return { value: undefined, error: '' };
  const n = Number(typed);
  if (!Number.isFinite(n) || n <= 0) return { value: undefined, error: 'Write a number of minutes, like 30.' };
  const seconds = Math.round(n * 60);
  if (seconds < 30 || seconds > 86400) return { value: undefined, error: 'Between half a minute and 24 hours (1440 minutes).' };
  return { value: seconds, error: '' };
}

// ---- when something goes wrong ------------------------------------------------------------------------------------------------------------------
export function numbersProblem(error) {
  if (!error) return '';
  const detail = text(error.message);
  if (error.status === 503)
    return 'This server has no phone-system (LiveKit) credentials, so numbers cannot be set up from here yet. Ask whoever runs the server.';
  if (error.status === 502) return `The phone system could not be reached or refused this${detail ? `: ${detail}` : '.'}`;
  if (error.status === 409 || error.status === 422) return detail || 'The server did not accept this number.';
  if (error.status === 404) return detail && !/^Request failed/.test(detail) ? detail : 'The server could not find that number or agent.';
  if (error.status === 405) return 'This server cannot manage phone numbers yet.';
  return detail || 'Something went wrong.';
}

// Does this failure mean "this server has no numbers feature" (so the old preview stays), rather than a real problem?
export const notSupported = (error) => !!error && (error.status === 404 || error.status === 405 || error.kind === 'not_found');
