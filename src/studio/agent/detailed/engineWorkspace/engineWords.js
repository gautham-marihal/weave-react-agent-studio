// Build › Engine and details in plain words, for any agent: who it is (its id, version, status, the environment it is
// meant for), how it runs (the engine, where models come from, its time zone, where secrets are found, how it hangs up),
// its fixed values with where each is used, the studio's own checks, and its logs. Pure: no React, no DOM.
//
// From the schema and agent config guide 2 (§3.2 meta, §3.3 runtime, §3.4 constants, §3.26 observability and builder):
// the id is fixed once created, the version is set by Release and the status by the server; one worker runs every
// agent, so the worker settings are set on the worker, not read from here; the dispatch name is old and ignored; a
// rotating log file is not applied yet; the studio checks are the studio's own (warnings while building).

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
export const together = (words, last = 'and') => (words.length > 1 ? `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}` : words[0] || '');
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const ENGINES = { 'livekit-agents': 'LiveKit Agents' };
export const MODES = { plugins: 'your own model keys', inference: 'LiveKit’s hosted models' };
export const ENVIRONMENTS = { development: 'development', staging: 'staging', production: 'production' };
export const STATUSES = { draft: 'a draft', published: 'published', archived: 'archived' };
export const LEVELS = { DEBUG: 'everything', INFO: 'what matters', WARNING: 'warnings', ERROR: 'errors only' };

// the time there now ("14:32"), or null when the name is not a time zone this browser knows
export function timeIn(zone, now = new Date()) {
  if (!zone) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(now);
  } catch {
    return null;
  }
}

// ---- fixed values: how many places use each ({{const.name}}, spaces allowed inside the braces)
export function usesOf(config, name) {
  if (!isObj(config)) return 0;
  const rest = { ...config };
  delete rest.constants;
  const text = JSON.stringify(rest);
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`\\{\\{\\s*const\\.${safe}\\s*\\}\\}`, 'g')) || []).length;
}
// a value as it is shown and typed: words as they are, anything else as JSON ("4", "true", ["a","b"])
export const shownValue = (v) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
// what a typed value is: a number stays a number, true and false stay true and false, a list or object typed as JSON is
// kept as one; anything else is words
export function typedValue(text) {
  const t = String(text ?? '');
  const trimmed = t.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return t;
    }
  }
  return t;
}
export const NAME_RULE = /^[a-z][a-z0-9_]{0,63}$/;
// why a name can't be used, or ''
export function nameProblem(name, taken = []) {
  if (!name) return 'Give it a name';
  if (!NAME_RULE.test(name)) return 'Lower-case letters, digits and _, starting with a letter';
  if (taken.includes(name)) return 'Another value has this name';
  return '';
}
export function constantsIn(config) {
  const c = isObj(config?.constants) ? config.constants : {};
  return Object.entries(c).map(([name, value]) => ({ name, value, shown: shownValue(value), uses: usesOf(config, name) }));
}
export const usedWords = (n) => (n ? `used in ${plural(n, 'place')}` : 'not used yet');

// everything the workspace says, read once
export function detailsOf(config) {
  const meta = isObj(config?.meta) ? config.meta : {};
  const runtime = isObj(config?.runtime) ? config.runtime : {};
  const lint = isObj(config?.builder?.lint) ? config.builder.lint : {};
  const obs = isObj(config?.observability) ? config.observability : {};
  const otel = isObj(obs.otel) ? obs.otel : {};
  const hangup = isObj(runtime.hangup) ? runtime.hangup : {};
  const tz = str(runtime.timezone);
  const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== undefined ? Number(v) : null);
  return {
    id: str(meta.id),
    version: str(meta.version),
    status: str(meta.status) || 'draft',
    env: str(meta.environment),
    created: str(meta.created_at),
    changed: str(meta.updated_at),
    engine: str(runtime.engine),
    engineWords: ENGINES[runtime.engine] || str(runtime.engine) || '',
    mode: str(runtime.provider_mode),
    modeWords: MODES[runtime.provider_mode] || '',
    tz,
    tzNow: timeIn(tz),
    vault: str(runtime.secrets_vault),
    drain: hangup.drain !== false,
    closeRoom: hangup.delete_room_on_close !== false,
    worker: isObj(runtime.worker) && Object.keys(runtime.worker).length > 0,
    dispatch: str(runtime.dispatch_name),
    consts: constantsIn(config),
    lint: { words: num(lint.max_prompt_words_per_agent), tools: num(lint.max_tools_per_agent), mono: lint.warn_on_monolith === true },
    logs: {
      level: str(obs.log_level),
      metrics: obs.metrics === true,
      tracing: obs.tracing === true,
      otel: otel.enabled === true,
      endpoint: str(otel.endpoint),
      service: str(otel.service_name),
      file: isObj(obs.log_file) ? str(obs.log_file.path) : '',
    },
  };
}

// the studio's warnings, as a phrase ("450 words or 8 tools"); '' when none is set
export function lintWords(lint) {
  const over = [lint.words !== null && plural(lint.words, 'word'), lint.tools !== null && plural(lint.tools, 'tool')].filter(Boolean);
  return together(over, 'or');
}
// the logs in a line: "what matters · metrics on · tracing off · sent to otel.example.com"
export function logsWords(logs) {
  const host = (() => {
    try {
      return new URL(logs.endpoint).host;
    } catch {
      return logs.endpoint;
    }
  })();
  return [
    `Log detail: ${LEVELS[logs.level] || 'the worker’s own'}`,
    `metrics ${logs.metrics ? 'on' : 'off'}`,
    `tracing ${logs.tracing ? 'on' : 'off'}`,
    logs.otel ? (host ? `sent to ${host}` : 'sent to OpenTelemetry, no address yet') : 'no export',
  ].join(' · ');
}
// a date in words ("6 Oct 2026")
export const dayOf = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
// the line under the name: its version, status and environment
export function summaryLine(d) {
  const parts = d.version ? [`Version ${d.version}`, d.status, d.env] : ['Draft', 'not published yet', d.env];
  const line = parts.filter(Boolean).join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
