// Phone numbers on the platform (GET /numbers and /bots/{id}/numbers). A number belongs to an agent and an environment,
// so whatever version is deployed there answers. Rows are read tolerantly (a missing part is left out, never an error),
// and every state is said in plain words. Pure.

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const ENVIRONMENT_WORDS: Record<string, string> = { development: 'Development', staging: 'Staging', production: 'Production' };
export const environmentWord = (env: string | null | undefined): string => ENVIRONMENT_WORDS[env ?? ''] || text(env) || '—';

export interface RuleTarget {
  agent: string;
  bot: string;
  ref: string;
}

export interface NumberRow {
  number: string;
  /** Set up through the builder for one of its agents; anything else is read-only here. */
  managed: boolean;
  trunk: { id: string; name: string } | null;
  bot: string;
  environment: string;
  rule: { id: string; name: string; agents: string[]; targets: RuleTarget[] } | null;
  options: { recordAudio?: boolean; krisp?: boolean; allowedAddresses: string[]; maxCallDurationS?: number };
  problems: string[];
  deployment: { deployed: boolean; version: string } | null;
  phoneChannel: boolean | null;
  lastCall: { id: string; at: string; caller: string; status: string } | null;
  routing: string;
  routingNote: string;
  status: string;
}

function readMetadata(metadata: unknown): Json | null {
  if (isObj(metadata)) return metadata;
  if (typeof metadata !== 'string' || !metadata.trim().startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(metadata);
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Who a dispatch rule sends calls to, from the platform's [agent name, metadata] pairs: for the builder's numbers its
 * runtime with {"bot","ref"} metadata; for numbers set up by hand that agent's own name.
 */
export function ruleTarget(entry: unknown): RuleTarget {
  const [name, metadata] = Array.isArray(entry) ? entry : [entry, ''];
  const meta = readMetadata(metadata);
  return { agent: text(name), bot: text(meta?.bot), ref: text(meta?.ref) };
}

const problemText = (p: unknown): string => (isObj(p) ? [text(p.message || p.problem), text(p.fix)].filter(Boolean).join(' ') || JSON.stringify(p) : text(p));

// ---- a row of the list -----------------------------------------------------------------------------------------------
export function normalizeNumber(raw: unknown): NumberRow {
  const r = isObj(raw) ? raw : {};
  const o = isObj(r.options) ? r.options : {};
  const d = isObj(r.deployment) ? r.deployment : null;
  const call = isObj(r.last_call) ? r.last_call : null;
  const rule = isObj(r.rule) ? r.rule : null;
  const trunk = isObj(r.trunk) ? r.trunk : null;
  const targets = rule ? list(rule.agents).map(ruleTarget) : [];
  return {
    number: text(r.number),
    managed: r.managed === true,
    trunk: trunk ? { id: text(trunk.id), name: text(trunk.name) } : null,
    bot: text(r.bot),
    environment: text(r.environment),
    rule: rule
      ? {
          id: text(rule.id),
          name: text(rule.name),
          agents: targets.map((t) => t.bot || t.agent).filter(Boolean),
          targets: targets.filter((t) => t.agent || t.bot),
        }
      : null,
    options: {
      recordAudio: typeof o.record_audio === 'boolean' ? o.record_audio : undefined,
      krisp: typeof o.krisp === 'boolean' ? o.krisp : undefined,
      allowedAddresses: list(o.allowed_addresses).map(text),
      maxCallDurationS: num(o.max_call_duration_s),
    },
    problems: list(r.problems).map(problemText).filter(Boolean),
    deployment: d ? { deployed: d.deployed === true, version: text(d.version) } : null,
    phoneChannel: typeof r.phone_channel === 'boolean' ? r.phone_channel : null,
    lastCall: call ? { id: text(call.id), at: text(call.at), caller: text(call.caller), status: text(call.status) } : null,
    routing: text(r.routing),
    routingNote: text(r.routing_note),
    status: text(r.status),
  };
}

/** The rows of GET /numbers: a list, or a list wrapped in { numbers } (or { items }). Rows with no number are dropped. */
export const normalizeNumbers = (raw: unknown): NumberRow[] =>
  list(isObj(raw) ? (raw.numbers ?? raw.items) : raw)
    .map(normalizeNumber)
    .filter((n) => n.number);

export type Tone = 'good' | 'wait' | 'bad' | 'muted';

/** What a row's status means, in a customer's words. */
export function statusWords(row: NumberRow): { tone: Tone; label: string; words: string } {
  if (!row.managed)
    return {
      tone: 'muted',
      label: 'Set up outside Studio',
      words: 'This number was set up on the phone system outside Studio. It is shown so it isn’t used twice, and can’t be changed or released here.',
    };
  if (row.status === 'ready') return { tone: 'good', label: 'Ready', words: 'A call to this number has been logged.' };
  if (row.status === 'waiting_for_calls') return { tone: 'wait', label: 'Waiting for calls', words: 'Set up and deployed. No call has been logged yet.' };
  if (row.status === 'problem') return { tone: 'bad', label: 'Needs attention', words: row.problems.length ? row.problems.join(' ') : 'Something is not set up.' };
  return { tone: 'muted', label: row.status ? row.status.replace(/_/g, ' ') : 'Set up', words: '' };
}

/** "Answered by version 0.1.1 of Acme Support, in Production." (or why a call would not be answered) */
export function answeredBy(row: NumberRow, botName = ''): string {
  if (!row.managed) return row.rule?.agents.length ? `Sent to ${row.rule.agents.join(', ')} by the phone system.` : 'Routed by the phone system.';
  const who = botName || row.bot || 'an agent';
  if (row.deployment && !row.deployment.deployed) return `Nothing is deployed to ${environmentWord(row.environment)} for ${who} yet, so a call would not be answered.`;
  if (row.phoneChannel === false) return `The version in ${environmentWord(row.environment)} has no phone channel, so a call would not be answered.`;
  return `Answered by ${row.deployment?.version ? `version ${row.deployment.version} of ` : ''}${who}, in ${environmentWord(row.environment)}.`;
}

/** "5 min ago", "3 h ago", "2 days ago": short, for a line under a number. '' for a time that can't be read. */
export function agoWords(iso: string, nowMs: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((nowMs - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const CALL_ENDINGS: Record<string, string> = { ended: '', in_progress: 'still going on', unfinished: 'cut off' };

/** "Last call 5 min ago, from +6591234567 (cut off)", or '' before the first one. */
export function lastCallWords(row: Pick<NumberRow, 'lastCall'> | null | undefined, nowMs: number = Date.now()): string {
  const call = row?.lastCall;
  if (!call) return '';
  const when = agoWords(call.at, nowMs);
  const ending = CALL_ENDINGS[call.status] ?? text(call.status).replace(/_/g, ' ');
  return `Last call ${when || 'at an unknown time'}${call.caller ? `, from ${call.caller}` : ''}${ending ? ` (${ending})` : ''}`;
}

/** Details only support needs: the trunk and dispatch rule the platform made, with their ids. */
export function supportDetails(row: NumberRow): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (row.trunk) out.push({ label: 'Trunk', value: [row.trunk.name, row.trunk.id && `(${row.trunk.id})`].filter(Boolean).join(' ') });
  if (row.rule) {
    out.push({ label: 'Dispatch rule', value: [row.rule.name, row.rule.id && `(${row.rule.id})`].filter(Boolean).join(' ') });
    const targets = row.rule.targets.map((t) => (t.bot ? `${t.agent || 'the runtime'}, for ${t.bot}${t.ref ? ` (${t.ref})` : ''}` : t.agent));
    if (targets.length) out.push({ label: 'Sends calls to', value: targets.join('; ') });
  }
  return out;
}

/** Whether a configuration has a phone line that is on. A call to a number is answered only by a version that has one. */
export const hasPhoneChannel = (config: unknown): boolean =>
  list(isObj(config) ? config.channels : null).some((c) => isObj(c) && c.type === 'sip_voice' && c.enabled !== false);

/** An environment as the picker shows it: "Production · runs v0.1.1" or "Staging · nothing deployed". */
export function environmentOption(env: string, current: Record<string, { version?: string } | undefined> | null | undefined): string {
  if (!isObj(current)) return environmentWord(env);
  const version = text(current[env]?.version);
  return `${environmentWord(env)} · ${version ? `runs v${version}` : 'nothing deployed'}`;
}

/**
 * Warnings before a number is set up (or moved) where its calls would not be answered.
 *   deployed: the version there ('' for none, null while unknown); phone: whether it has a phone line (null while unknown)
 */
export function setupWarnings({ env, deployed, phone, botName = 'this agent' }: { env: string; deployed: string | null; phone: boolean | null; botName?: string }): string[] {
  const where = environmentWord(env);
  if (deployed === '')
    return [
      `Nothing is deployed to ${where} for ${botName} yet, so a call to this number would not be answered. Deploy a version that has a phone line to ${where} first, or choose another environment.`,
    ];
  if (deployed && phone === false)
    return [
      `Version ${deployed}, deployed to ${where}, has no phone line that is on, so a call to this number would not be answered. Add a phone line in Build › Channels, then publish and deploy.`,
    ];
  return [];
}

export interface NumberBody {
  number?: string;
  environment?: string;
  record_audio?: boolean;
  krisp?: boolean;
  allowed_addresses?: string[];
  max_call_duration_s?: number | null;
}

const durationWords = (seconds: number): string => (Math.round(seconds / 60) >= 1 ? `${Math.round((seconds / 60) * 10) / 10} minutes` : `${seconds} seconds`);

/** What a change does, one sentence each, for the person to confirm before it is sent. */
export function changeWords(body: NumberBody): string[] {
  const out: string[] = [];
  if (body.environment) out.push(`Move it to ${environmentWord(body.environment)}: calls are then answered by the version deployed there.`);
  if (body.record_audio !== undefined) out.push(body.record_audio ? 'Start recording the audio of calls.' : 'Stop recording the audio of calls.');
  if (body.krisp !== undefined) out.push(body.krisp ? 'Start filtering background noise.' : 'Stop filtering background noise.');
  if (body.allowed_addresses !== undefined) out.push(body.allowed_addresses.length ? `Only accept calls from ${body.allowed_addresses.join(', ')}.` : 'Accept calls from any address.');
  if (body.max_call_duration_s === null) out.push('Take away the longest-call limit.');
  else if (body.max_call_duration_s !== undefined) out.push(`End calls after ${durationWords(body.max_call_duration_s)}.`);
  return out;
}

/** What to say once a number is set up. Setting it up again is safe (the server answers `changed: ["already set up"]`). */
export function setUpWords(result: unknown, { number, botName, env }: { number: string; botName: string; env: string }): string {
  const changed = list(isObj(result) ? result.changed : null).map(text);
  if (changed.includes('already set up')) return `${number} was already set up for ${botName} in ${environmentWord(env)}. Nothing was changed.`;
  return `${number} was set up for ${botName} in ${environmentWord(env)}.`;
}

/** The settings of a number in a line. */
export function optionWords(row: NumberRow): string {
  const o = row.options;
  const parts: string[] = [];
  if (o.recordAudio !== undefined) parts.push(o.recordAudio ? 'calls are recorded' : 'calls are not recorded');
  if (o.krisp) parts.push('noise filtering on');
  if (o.maxCallDurationS) parts.push(`calls end after ${durationWords(o.maxCallDurationS)}`);
  if (o.allowedAddresses.length) parts.push(`only from ${o.allowedAddresses.length} address${o.allowedAddresses.length === 1 ? '' : 'es'}`);
  return parts.join(' · ');
}

// ---- the form: checking a number as it is typed ------------------------------------------------------------------------
export interface CheckView {
  status: string;
  who: string;
  trunk: string;
  reason: string;
  warnings: string[];
}

export function normalizeCheck(raw: unknown): CheckView {
  const r = isObj(raw) ? raw : {};
  const owner = isObj(r.owner) ? r.owner : {};
  const who = text(owner.bot) ? `${text(owner.bot)}${owner.environment ? ` (${environmentWord(text(owner.environment))})` : ''}` : text(typeof r.owner === 'string' ? r.owner : '');
  const trunk = text(owner.trunk) || text(owner.trunk_name) || text(typeof r.owner === 'string' ? r.owner : '');
  return { status: text(r.status), who, trunk, reason: text(r.reason), warnings: list(r.warnings).map(text) };
}

export function checkWords(check: CheckView): { tone: Tone; words: string } {
  switch (check.status) {
    case 'free':
      return { tone: 'good', words: 'This number is free.' };
    case 'taken_by_builder':
      return { tone: 'bad', words: check.who ? `This number is already used by ${check.who}.` : 'This number is already used by another agent.' };
    case 'taken_external':
      return {
        tone: 'bad',
        words: check.trunk ? `This number is used by “${check.trunk}”, which Studio does not manage.` : 'This number is used on the phone system by something Studio does not manage.',
      };
    case 'invalid':
      return { tone: 'bad', words: check.reason || 'This does not look like a valid number.' };
    default:
      return { tone: 'muted', words: '' };
  }
}

// ---- the settings the form's hints come from ---------------------------------------------------------------------------
export interface NumberSettingsView {
  pattern: string;
  environments: string[];
  defaults: { recordAudio: boolean; krisp: boolean; allowedAddresses: string[] };
  recording: { format: string; path: string };
  livekitConfigured: boolean;
}

export function normalizeNumberSettings(raw: unknown): NumberSettingsView {
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

/** A typed number against the server's pattern (when it sent one). '' = fine, or nothing to say yet. */
export function numberProblem(value: string, pattern: string): string {
  const typed = text(value).trim();
  if (!typed || !pattern) return '';
  try {
    return new RegExp(pattern).test(typed) ? '' : 'Write the number the way your phone system expects it, with no spaces or brackets.';
  } catch {
    return '';
  }
}

export interface NumberForm {
  number: string;
  environment: string;
  recordAudio?: boolean;
  krisp?: boolean;
  /** As typed: addresses separated by commas or spaces. */
  allowedAddresses: string;
  /** As typed, in minutes; empty means no limit. */
  maxMinutes: string;
}

export const parseAddresses = (value: string): string[] =>
  text(value)
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);

/** Minutes typed by a person -> the seconds the API wants (30 to 86400). Empty means "no limit". */
export function parseMaxDuration(minutes: string): { value: number | undefined; error: string } {
  const typed = text(minutes).trim();
  if (!typed) return { value: undefined, error: '' };
  const n = Number(typed);
  if (!Number.isFinite(n) || n <= 0) return { value: undefined, error: 'Write a number of minutes, like 30.' };
  const seconds = Math.round(n * 60);
  if (seconds < 30 || seconds > 86400) return { value: undefined, error: 'Between half a minute and 24 hours (1440 minutes).' };
  return { value: seconds, error: '' };
}

/** What is sent to set a number up: only what was set, so the server's own defaults apply to the rest. */
export function createBody(form: NumberForm, defaults: NumberSettingsView['defaults']): NumberBody & { number: string; environment: string } {
  const body: NumberBody & { number: string; environment: string } = { number: text(form.number).trim(), environment: form.environment };
  if (form.recordAudio !== undefined && form.recordAudio !== defaults.recordAudio) body.record_audio = form.recordAudio;
  if (form.krisp !== undefined && form.krisp !== defaults.krisp) body.krisp = form.krisp;
  const addresses = parseAddresses(form.allowedAddresses);
  if (addresses.length) body.allowed_addresses = addresses;
  const max = parseMaxDuration(form.maxMinutes);
  if (max.value !== undefined) body.max_call_duration_s = max.value;
  return body;
}

/** Only what changed, for PATCH /bots/{id}/numbers/{number}. An emptied "longest call" takes the limit away. */
export function patchBody(before: NumberRow, form: Omit<NumberForm, 'number'>): NumberBody {
  const out: NumberBody = {};
  if (form.environment && form.environment !== before.environment) out.environment = form.environment;
  if (form.recordAudio !== undefined && form.recordAudio !== before.options.recordAudio) out.record_audio = form.recordAudio;
  if (form.krisp !== undefined && form.krisp !== before.options.krisp) out.krisp = form.krisp;
  const addresses = parseAddresses(form.allowedAddresses);
  if (JSON.stringify(addresses) !== JSON.stringify(before.options.allowedAddresses)) out.allowed_addresses = addresses;
  const max = parseMaxDuration(form.maxMinutes);
  if (max.value !== undefined && max.value !== before.options.maxCallDurationS) out.max_call_duration_s = max.value;
  else if (max.value === undefined && !max.error && before.options.maxCallDurationS) out.max_call_duration_s = null;
  return out;
}

/** The form for an existing number, from its row. */
export const formOf = (row: NumberRow, defaults: NumberSettingsView['defaults']): NumberForm => ({
  number: row.number,
  environment: row.environment,
  recordAudio: row.options.recordAudio ?? defaults.recordAudio,
  krisp: row.options.krisp ?? defaults.krisp,
  allowedAddresses: row.options.allowedAddresses.join(', '),
  maxMinutes: row.options.maxCallDurationS ? String(Math.round((row.options.maxCallDurationS / 60) * 100) / 100) : '',
});

// ---- when something goes wrong -----------------------------------------------------------------------------------------
interface ErrorLike {
  status?: number;
  kind?: string;
  message?: string;
}
const asError = (error: unknown): ErrorLike | null => (error && typeof error === 'object' ? (error as ErrorLike) : null);

/** What went wrong, without technical words. */
export function numbersProblem(error: unknown): string {
  const e = asError(error);
  if (!e) return '';
  const detail = text(e.message);
  if (e.status === 503 && e.kind !== 'network')
    return 'This server has no phone-system (LiveKit) credentials, so numbers can’t be set up from here yet. Ask whoever runs the server.';
  if (e.status === 502) return `The phone system could not be reached or refused this${detail ? `: ${detail}` : '.'}`;
  if (e.status === 409 || e.status === 422) return detail || 'The server did not accept this number.';
  if (e.status === 404) return detail && !/^Request failed/.test(detail) ? detail : 'The server could not find that number or agent.';
  if (e.status === 405) return 'This server cannot manage phone numbers yet.';
  return detail || 'Something went wrong.';
}

/** "This server has no numbers feature" (404/405 on the list), rather than a real failure. */
export const notSupported = (error: unknown): boolean => {
  const e = asError(error);
  return !!e && (e.status === 404 || e.status === 405 || e.kind === 'not_found');
};

/** "This server has no phone-system credentials" (503 from the API itself): the feature is not available, not empty. */
export const noPhoneSystem = (error: unknown): boolean => {
  const e = asError(error);
  return !!e && e.status === 503 && e.kind !== 'network';
};
