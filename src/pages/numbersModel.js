// Phone numbers on the real platform (FRONTEND_GUIDE 10.5): the number is the person's, the API checks it is free and creates the LiveKit SIP trunk and dispatch
// rule. A number belongs to a bot and an environment, so a call to it is answered by whatever version is deployed there. The list also holds the numbers set up
// by hand on the phone system, which are read-only here. This module reads the API's rows TOLERANTLY (a missing part is left out, never an error) and says
// everything in plain words. Pure: no network, no DOM.

import { formatWhen } from '../studio/format.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const ENVIRONMENT_WORDS = { development: 'Development', staging: 'Staging', production: 'Production' };
export const environmentWord = (env) => ENVIRONMENT_WORDS[env] || text(env) || '—';

// Who a dispatch rule sends calls to. The platform lists them as [agent name, metadata] pairs: for a number this builder set up the agent is the builder's
// runtime and the metadata says which bot and environment ({"bot":"voice-test","ref":"development"}); for one set up by hand it is that agent's own name.
export function ruleTarget(entry) {
  const [name, metadata] = Array.isArray(entry) ? entry : [entry, ''];
  const meta = readMetadata(metadata);
  return { agent: text(name), bot: text(meta?.bot), ref: text(meta?.ref) };
}
function readMetadata(metadata) {
  if (isObj(metadata)) return metadata;
  if (typeof metadata !== 'string' || !metadata.trim().startsWith('{')) return null;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}

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
    // `agents`: who the rule sends calls to, by name (the bot, for one of ours); `targets`: the pairs as the platform has them, for the support details
    rule: isObj(r.rule)
      ? {
          id: text(r.rule.id),
          name: text(r.rule.name),
          agents: list(r.rule.agents)
            .map(ruleTarget)
            .map((t) => t.bot || t.agent)
            .filter(Boolean),
          targets: list(r.rule.agents)
            .map(ruleTarget)
            .filter((t) => t.agent || t.bot),
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
    return {
      tone: 'muted',
      label: 'Set up outside the builder',
      words: 'This number was set up on the phone system outside the builder. It is shown so it isn’t used twice, and can’t be changed or released here.',
    };
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

// "Last call 5 min ago, from +6591234567 (cut off)", or '' before the first one.
const CALL_ENDINGS = { ended: '', in_progress: 'still going on', unfinished: 'cut off' };
export function lastCallWords(row, nowMs = Date.now()) {
  const call = row?.lastCall;
  if (!call) return '';
  const when = formatWhen(call.at, { nowMs });
  const ending = CALL_ENDINGS[call.status] ?? text(call.status).replace(/_/g, ' ');
  return `Last call ${when || 'at an unknown time'}${call.caller ? `, from ${call.caller}` : ''}${ending ? ` (${ending})` : ''}`;
}

// The details support asks for, never needed to set a number up: the trunk and dispatch rule the platform made, with their ids.
export function supportDetails(row) {
  const out = [];
  if (row.trunk) out.push({ label: 'Trunk', value: [row.trunk.name, row.trunk.id && `(${row.trunk.id})`].filter(Boolean).join(' ') });
  if (row.rule) {
    out.push({ label: 'Dispatch rule', value: [row.rule.name, row.rule.id && `(${row.rule.id})`].filter(Boolean).join(' ') });
    const targets = (row.rule.targets || []).map((t) => (t.bot ? `${t.agent || 'the runtime'}, for ${t.bot}${t.ref ? ` (${t.ref})` : ''}` : t.agent));
    if (targets.length) out.push({ label: 'Sends calls to', value: targets.join('; ') });
  }
  return out;
}

// Does this configuration have a phone line that is on? A call to a number is answered only by a version that has one.
export const hasPhoneChannel = (config) => list(isObj(config) ? config.channels : null).some((c) => isObj(c) && c.type === 'sip_voice' && c.enabled !== false);

// An environment as the picker offers it, short enough for the box: "Production · runs v0.1.1" or "Staging · nothing deployed". `current` is GET
// deployments' `current`.
export function environmentOption(env, current) {
  if (!isObj(current)) return environmentWord(env);
  const version = text(current[env]?.version);
  return `${environmentWord(env)} · ${version ? `runs v${version}` : 'nothing deployed'}`;
}

// What to warn about before a number is set up (or moved) for an agent and an environment: a call to it would not be answered. `deployed` is the version
// deployed there ('' for none, null while not known); `phone` whether that version has a phone line that is on (null while not known).
export function setupWarnings({ env, deployed, phone, botName = 'this agent' }) {
  const where = environmentWord(env);
  if (deployed === '')
    return [
      `Nothing is deployed to ${where} for ${botName} yet, so a call to this number would not be answered. Deploy a version that has a phone line to ${where} first, or choose another environment.`,
    ];
  if (deployed && phone === false)
    return [
      `Version ${deployed}, deployed to ${where}, has no phone line that is on, so a call to this number would not be answered. Add a phone line on the Channels page, then publish and deploy.`,
    ];
  return [];
}

// What a change does, one sentence each, for the person to confirm before it is sent. `body` is what patchBody would send.
export function changeWords(before, body) {
  const out = [];
  if (body.environment) out.push(`Move it to ${environmentWord(body.environment)}: calls are then answered by the version deployed there.`);
  if (body.record_audio !== undefined) out.push(body.record_audio ? 'Start recording the audio of calls.' : 'Stop recording the audio of calls.');
  if (body.krisp !== undefined) out.push(body.krisp ? 'Start filtering background noise.' : 'Stop filtering background noise.');
  if (body.allowed_addresses !== undefined)
    out.push(body.allowed_addresses.length ? `Only accept calls from ${body.allowed_addresses.join(', ')}.` : 'Accept calls from any address.');
  if (body.max_call_duration_s === null) out.push('Take away the longest-call limit.');
  else if (body.max_call_duration_s !== undefined) out.push(`End calls after ${durationWords(body.max_call_duration_s)}.`);
  return out;
}

const durationWords = (seconds) => (Math.round(seconds / 60) >= 1 ? `${Math.round((seconds / 60) * 10) / 10} minutes` : `${seconds} seconds`);

// What to say once a number has been set up. Creating is safe to repeat: the second time the platform answers `changed: ["already set up"]`.
export function setUpWords(result, { number, botName, env }) {
  const changed = list(isObj(result) ? result.changed : null).map(text);
  if (changed.includes('already set up')) return `${number} was already set up for ${botName} in ${environmentWord(env)}. Nothing was changed.`;
  return `${number} was set up for ${botName} in ${environmentWord(env)}.`;
}

// The settings of a number in a line.
export function optionWords(row) {
  const o = row.options;
  const parts = [];
  if (o.recordAudio !== undefined) parts.push(o.recordAudio ? 'calls are recorded' : 'calls are not recorded');
  if (o.krisp) parts.push('noise filtering on');
  if (o.maxCallDurationS) parts.push(`calls end after ${durationWords(o.maxCallDurationS)}`);
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

// Does it mean "this server has no phone-system credentials" (503)? Then the feature is hidden, not shown as an empty list.
export const noPhoneSystem = (error) => !!error && error.status === 503;
