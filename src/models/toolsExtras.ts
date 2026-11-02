// What a tool reaches beyond itself, for the Tools page: phone transfers (telephony.transfers), connections, forms, the
// messages it sends (notifications) and multi-step tasks. Each kind is said in words for its row, and read and written
// back through these helpers, which write only the server's own config paths (GET /schema). Credentials are never kept
// in the config: a connection names a secret (`{ secret: NAME }`) that the server resolves. Pure: no React, no network.
import type { AgentConfig } from '../types/studio';

export type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
export const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? {})) as T;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The extras, in the order the page shows them. `key` is the top-level config key each lives under. */
export type ExtraKey = 'telephony' | 'connections' | 'forms' | 'notifications' | 'tasks';
export const EXTRAS: { key: ExtraKey; title: string; word: string }[] = [
  { key: 'telephony', title: 'Phone transfers', word: 'transfer' },
  { key: 'connections', title: 'Connections', word: 'connection' },
  { key: 'forms', title: 'Forms', word: 'form' },
  { key: 'notifications', title: 'Messages it sends', word: 'message' },
  { key: 'tasks', title: 'Multi-step tasks', word: 'task' },
];

// ---- words ---------------------------------------------------------------------------------------------------------------------------------
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "a, b and 2 more": a few names, the rest counted. */
export const namesInWords = (names: string[]) => {
  const all = names.filter(Boolean);
  const shown = all.slice(0, 2);
  const more = all.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
};
/** "billing_api" -> "Billing api". */
export const humanize = (id: string) => {
  const t = String(id ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : '';
};
export const hostOf = (url: unknown) => {
  try {
    return new URL(String(url).replace(/\{\{[^}]*\}\}/g, 'x')).host;
  } catch {
    return '';
  }
};

export const transfersOf = (config: AgentConfig | null | undefined): Json[] => list<Json>(config?.telephony?.transfers).filter(isObj);
export const connectionsOf = (config: AgentConfig | null | undefined): [string, Json][] =>
  Object.entries(isObj(config?.connections) ? (config?.connections as Json) : {}).filter((e): e is [string, Json] => isObj(e[1]));
export const formsOf = (config: AgentConfig | null | undefined): Json[] => list<Json>(config?.forms).filter(isObj);
export const notificationsOf = (config: AgentConfig | null | undefined): Json[] => list<Json>(config?.notifications).filter(isObj);
export const tasksOf = (config: AgentConfig | null | undefined): Json[] => list<Json>(config?.tasks).filter(isObj);

/** How many of a kind there are. */
export function countOf(config: AgentConfig | null | undefined, key: ExtraKey): number {
  if (key === 'telephony') return transfersOf(config).length;
  if (key === 'connections') return connectionsOf(config).length;
  if (key === 'forms') return formsOf(config).length;
  if (key === 'notifications') return notificationsOf(config).length;
  return tasksOf(config).length;
}

/** A transfer's target in words: a number, a secret's name, chosen during the call, or '' when none is set yet. */
export function targetWords(target: unknown): string {
  if (typeof target === 'string') return target.trim();
  if (isObj(target) && typeof target.secret === 'string') return `the number in the secret ${target.secret}`;
  if (isObj(target) && isObj(target.lookup)) return 'a number chosen during the call';
  return '';
}

/** The phone transfers in words: where calls go, or that a number is still to be set. */
export function transfersInWords(config: AgentConfig | null | undefined): string {
  const transfers = transfersOf(config);
  if (!transfers.length) return 'None yet. Where a call can be passed to a person.';
  const numbers = transfers.map((t) => (t.method === 'http_request' ? `${humanize(String(t.id ?? ''))} (through a connection)` : targetWords(t.target))).filter(Boolean);
  const waiting = transfers.length - numbers.length;
  return [numbers.length ? `Passes calls to ${namesInWords(numbers)}` : '', waiting ? `${plural(waiting, 'transfer')} with no number yet: callers are offered a callback` : '']
    .filter(Boolean)
    .join(' · ');
}

/** What each kind holds, in one sentence for its row. */
export function extraInWords(config: AgentConfig | null | undefined, key: ExtraKey): string {
  const n = countOf(config, key);
  switch (key) {
    case 'telephony':
      return transfersInWords(config);
    case 'connections':
      return n
        ? `${plural(n, 'connection')}: ${namesInWords(connectionsOf(config).map(([id, c]) => hostOf(c.base_url ?? c.url) || humanize(id)))}`
        : 'None yet. A connection is a web service its tools call, such as your billing system.';
    case 'forms':
      return n ? `${plural(n, 'form')}: ${namesInWords(formsOf(config).map((f) => str(f.title) || humanize(str(f.id) || 'form')))}` : 'None yet. A form collects details such as a name and number on screen.';
    case 'notifications':
      return n ? `${plural(n, 'message')} it can text or email` : 'None yet. Texts and emails it can send during or after a call.';
    default:
      return n ? `${plural(n, 'task')}: ${namesInWords(tasksOf(config).map((t) => humanize(str(t.id))))}` : 'None yet. Walk a caller through several steps, such as checking who they are.';
  }
}

/** The server's problems under one kind (errors whose path starts with its key; transfers under telephony). */
export function problemsUnder(errors: { path: Array<string | number> | null }[] | undefined, key: ExtraKey, index?: number | string): number {
  return list<{ path: Array<string | number> | null }>(errors).filter((e) => {
    const p = e?.path;
    if (!Array.isArray(p) || p[0] !== key) return false;
    if (index === undefined) return true;
    return key === 'telephony' ? p[1] === 'transfers' && p[2] === index : p[1] === index;
  }).length;
}

// ---- ids --------------------------------------------------------------------------------------------------------------------------------------
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/** A free id from a base: "transfer", "transfer_2", ... */
export function freeId(taken: string[], base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 60) || 'item';
  let id = clean;
  for (let n = 2; taken.includes(id); n++) id = `${clean}_${n}`;
  return id;
}
/** Why an id can't be used ('' when it can). */
export function idProblem(id: string, taken: string[]): string {
  if (!id.trim()) return 'It needs an id.';
  if (!ID_PATTERN.test(id)) return 'Use lowercase letters, digits, _ and -, starting with a letter.';
  if (taken.includes(id)) return `“${id}” is already used.`;
  return '';
}

// ---- where each is used -----------------------------------------------------------------------------------------------------------------------
/**
 * The places that name an item, in words ("tool “escalate”", "a step of the task “verify”"). Found by walking the config
 * for the keys that refer to each kind; an item named nowhere is not used.
 */
export function usedBy(config: AgentConfig | null | undefined, key: ExtraKey, id: string): string[] {
  if (!config || !id) return [];
  const out: string[] = [];
  const keysFor: Record<ExtraKey, string[]> = {
    telephony: ['transfer'],
    connections: ['connection', 'via'],
    forms: ['form'],
    notifications: ['notification'],
    tasks: ['task', 'next'],
  };
  const watch = keysFor[key];
  const place = (path: Array<string | number>): string => {
    const [top, i] = path;
    if (top === 'tools') return `the tool “${String(list<Json>(config.tools)[Number(i)]?.id ?? i)}”`;
    if (top === 'telephony') return `the transfer “${str(transfersOf(config)[Number(path[2])]?.id)}”`;
    if (top === 'forms') return `the form “${str(formsOf(config)[Number(i)]?.id)}”`;
    if (top === 'notifications') return `the message “${str(notificationsOf(config)[Number(i)]?.id)}”`;
    if (top === 'tasks') return `the task “${str(tasksOf(config)[Number(i)]?.id)}”`;
    if (top === 'agents') return 'an agent';
    if (top === 'events') return 'an event';
    if (top === 'guardrails') return 'a guardrail';
    return String(top);
  };
  const walk = (v: unknown, path: Array<string | number>) => {
    if (Array.isArray(v)) v.forEach((x, n) => walk(x, [...path, n]));
    else if (isObj(v)) {
      Object.entries(v).forEach(([k, x]) => {
        if (watch.includes(k) && x === id) {
          // a task's `next` and a tool's `task` name tasks; `task` elsewhere (a tool's type) is a word, not a reference
          const words = place(path);
          if (!out.includes(words)) out.push(words);
        }
        walk(x, [...path, k]);
      });
    }
  };
  (['tools', 'agents', 'telephony', 'forms', 'notifications', 'tasks', 'events', 'guardrails', 'post_call'] as const).forEach((k) => walk((config as Json)[k], [k]));
  // a transfer's own id is not a use of itself; a connection is named by tools and requests
  return out.filter((w) => !(key === 'tasks' && w === `the task “${id}”`));
}

// ---- writing ------------------------------------------------------------------------------------------------------------------------------------
function withList(config: AgentConfig, key: 'forms' | 'notifications' | 'tasks', change: (items: Json[]) => Json[]): AgentConfig {
  const next = clone(config);
  const items = change(list<Json>((next as Json)[key]).map((x) => (isObj(x) ? { ...x } : x)) as Json[]);
  if (items.length) (next as Json)[key] = items;
  else delete (next as Json)[key];
  return next;
}

/** Sets or takes away (undefined / '') one key of an object; an empty array or object goes too. */
export function patch<T extends Json>(obj: T, changes: Json): T {
  const next = { ...obj } as Json;
  Object.entries(changes).forEach(([k, v]) => {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) delete next[k];
    else next[k] = v;
  });
  return next as T;
}

// transfers
export function addTransfer(config: AgentConfig): { config: AgentConfig; index: number } {
  const next = clone(config);
  const tel = (isObj(next.telephony) ? next.telephony : {}) as Json;
  const transfers = list<Json>(tel.transfers);
  const id = freeId(transfers.map((t) => str(t?.id)), transfers.length ? 'transfer' : 'human_support');
  tel.transfers = [...transfers, { id, method: 'sip_refer', target: '' }];
  next.telephony = tel as AgentConfig['telephony'];
  return { config: next, index: transfers.length };
}
export function setTransfer(config: AgentConfig, index: number, changes: Json): AgentConfig {
  const next = clone(config);
  const tel = (isObj(next.telephony) ? next.telephony : {}) as Json;
  tel.transfers = list<Json>(tel.transfers).map((t, i) => (i === index && isObj(t) ? patchTransfer(t, changes) : t));
  next.telephony = tel as AgentConfig['telephony'];
  return next;
}
// a sip_refer needs a target (an empty one is kept: callers get the fallback until it is set); an http_request a request
function patchTransfer(t: Json, changes: Json): Json {
  const out = patch(t, changes);
  if ('target' in changes && changes.target === '') out.target = '';
  if (out.method === 'sip_refer') {
    if (out.target === undefined) out.target = '';
    delete out.request;
  }
  if (out.method === 'http_request') {
    if (out.target === '') delete out.target;
    if (!isObj(out.request)) out.request = { connection: '', method: 'POST', path: '/' };
    delete out.uri_template;
    delete out.play_dialtone;
    delete out.headers;
  }
  return out;
}
export function removeTransfer(config: AgentConfig, index: number): AgentConfig {
  const next = clone(config);
  const tel = (isObj(next.telephony) ? next.telephony : {}) as Json;
  const transfers = list<Json>(tel.transfers).filter((_, i) => i !== index);
  if (transfers.length) tel.transfers = transfers;
  else delete tel.transfers;
  if (Object.keys(tel).length) next.telephony = tel as AgentConfig['telephony'];
  else delete next.telephony;
  return next;
}

/** A transfer's target as the editor offers it: a number typed, a secret named, or chosen from what was remembered. */
export type TargetKind = 'number' | 'secret' | 'lookup';
export const targetKind = (target: unknown): TargetKind => (isObj(target) && typeof target.secret === 'string' ? 'secret' : isObj(target) && isObj(target.lookup) ? 'lookup' : 'number');

// connections
export type ConnectionType = 'http' | 'notifier' | 'mcp';
export const CONNECTION_TYPES: { type: ConnectionType; label: string; help: string }[] = [
  { type: 'http', label: 'A web service', help: 'An HTTP API its tools and requests call, such as your billing system.' },
  { type: 'notifier', label: 'A text or email sender', help: 'The service that sends its texts or emails (Twilio, SendGrid…).' },
  { type: 'mcp', label: 'An MCP server', help: 'A server of tools. Not available in the runtime yet.' },
];
export function addConnection(config: AgentConfig, type: ConnectionType, wanted = ''): { config: AgentConfig; id: string } {
  const next = clone(config);
  const all = (isObj(next.connections) ? next.connections : {}) as Json;
  const id = freeId(Object.keys(all), wanted || (type === 'notifier' ? 'sender' : type === 'mcp' ? 'mcp_server' : 'web_service'));
  all[id] = type === 'http' ? { type, base_url: '' } : type === 'mcp' ? { type, url: '' } : { type, kind: 'sms', provider: '' };
  next.connections = all as AgentConfig['connections'];
  return { config: next, id };
}
export function setConnection(config: AgentConfig, id: string, changes: Json): AgentConfig {
  const next = clone(config);
  const all = (isObj(next.connections) ? next.connections : {}) as Json;
  if (!isObj(all[id])) return config;
  const out = patch(all[id] as Json, changes);
  // required by the schema even while empty
  if (out.type === 'http' && out.base_url === undefined) out.base_url = '';
  if (out.type === 'mcp' && out.url === undefined) out.url = '';
  if (out.type === 'notifier' && out.provider === undefined) out.provider = '';
  all[id] = out;
  next.connections = all as AgentConfig['connections'];
  return next;
}
/** A connection under a new id, in the same place; only offered while nothing uses it. */
export function renameConnection(config: AgentConfig, from: string, to: string): AgentConfig {
  const all = (isObj(config?.connections) ? config.connections : {}) as Json;
  if (!(from in all) || from === to || to in all) return config;
  const next = clone(config);
  next.connections = Object.fromEntries(Object.entries(all).map(([k, v]) => [k === from ? to : k, v])) as AgentConfig['connections'];
  return next;
}
export function removeConnection(config: AgentConfig, id: string): AgentConfig {
  const next = clone(config);
  const all = { ...((isObj(next.connections) ? next.connections : {}) as Json) };
  delete all[id];
  if (Object.keys(all).length) next.connections = all as AgentConfig['connections'];
  else delete next.connections;
  return next;
}

/** How a web service is signed in to. Every credential is a secret's name, never the value. */
export type AuthType = 'none' | 'bearer' | 'api_key' | 'basic';
export const AUTH_TYPES: { type: AuthType; label: string }[] = [
  { type: 'none', label: 'No sign-in' },
  { type: 'bearer', label: 'A token' },
  { type: 'api_key', label: 'A key in a header' },
  { type: 'basic', label: 'A user name and password' },
];
export const SECRET_PATTERN = /^[A-Z][A-Z0-9_]*$/;
/** Why a secret name can't be used ('' when it can, or when nothing is typed yet). */
export function secretNameProblem(name: string): string {
  if (!name) return '';
  return SECRET_PATTERN.test(name) ? '' : 'A secret’s name is in capitals, digits and _, such as BILLING_API_TOKEN. Type its name, never its value.';
}
export const secretName = (v: unknown) => (isObj(v) && typeof v.secret === 'string' ? v.secret : '');
export const secretRef = (name: string) => ({ secret: name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') });
/** The fields each sign-in needs, as secrets (api_key also names its header in plain text). */
export const AUTH_SECRETS: Record<AuthType, { key: string; label: string }[]> = {
  none: [],
  bearer: [{ key: 'token', label: 'Secret with the token' }],
  api_key: [{ key: 'key', label: 'Secret with the key' }],
  basic: [
    { key: 'username', label: 'Secret with the user name' },
    { key: 'password', label: 'Secret with the password' },
  ],
};
export function authFor(type: AuthType, had: unknown): Json | undefined {
  if (type === 'none') return isObj(had) && had.type === 'none' ? had : undefined;
  const old = isObj(had) ? had : {};
  const out: Json = { type };
  AUTH_SECRETS[type].forEach(({ key }) => (out[key] = isObj(old[key]) ? old[key] : { secret: '' }));
  if (type === 'api_key') out.header = typeof old.header === 'string' ? old.header : 'X-Api-Key';
  return out;
}

/** Header rows (name: value) back to the object the schema takes; rows with no name are dropped. */
export function headersFrom(rows: [string, string][]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  rows.forEach(([k, v]) => {
    if (k.trim()) out[k.trim()] = v;
  });
  return Object.keys(out).length ? out : undefined;
}

// forms
export const FIELD_TYPES: { type: string; label: string }[] = [
  { type: 'text', label: 'Short text' },
  { type: 'textarea', label: 'Long text' },
  { type: 'email', label: 'Email address' },
  { type: 'phone', label: 'Phone number' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'One of a list' },
  { type: 'checkbox', label: 'Tick box' },
];
export const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export function addForm(config: AgentConfig): { config: AgentConfig; index: number } {
  const forms = formsOf(config);
  const id = freeId(forms.map((f) => str(f.id)), forms.length ? 'form' : 'contact_details');
  return {
    config: withList(config, 'forms', (items) => [...items, { id, title: 'Your details', fields: [{ name: 'name', label: 'Your name', type: 'text', required: true }], submit_label: 'Send' }]),
    index: forms.length,
  };
}
/** A form changed; its title is kept even while empty (the schema needs one, and the server says so). */
export const setForm = (config: AgentConfig, index: number, changes: Json) =>
  withList(config, 'forms', (items) => items.map((f, i) => (i === index ? keepEmpty(patch(f, changes), changes, ['title']) : f)));
/** Required text kept as typed, even empty. */
const keepEmpty = (out: Json, changes: Json, keys: string[]) => {
  keys.forEach((k) => {
    if (changes[k] === '') out[k] = '';
  });
  return out;
};
export const removeForm = (config: AgentConfig, index: number) => withList(config, 'forms', (items) => items.filter((_, i) => i !== index));

/** A field changed; a list to choose from stays only with "One of a list" (which needs one). */
export function setField(config: AgentConfig, formIndex: number, fieldIndex: number, changes: Json): AgentConfig {
  return withList(config, 'forms', (items) =>
    items.map((f, i) => {
      if (i !== formIndex) return f;
      const fields = list<Json>(f.fields).map((x, n) => {
        if (n !== fieldIndex) return x;
        const out = keepEmpty(patch(x, changes), changes, ['name', 'label']);
        if ('required' in changes && changes.required === false) delete out.required;
        if (out.type === 'select' && !list(out.options).length) out.options = ['Yes', 'No'];
        if (out.type !== 'select') delete out.options;
        return out;
      });
      return { ...f, fields };
    })
  );
}
export function addField(config: AgentConfig, formIndex: number): AgentConfig {
  return withList(config, 'forms', (items) =>
    items.map((f, i) => {
      if (i !== formIndex) return f;
      const fields = list<Json>(f.fields);
      const name = freeId(fields.map((x) => str(x?.name)), 'field').replace(/-/g, '_');
      return { ...f, fields: [...fields, { name, label: 'New field', type: 'text' }] };
    })
  );
}
/** The last field stays (a form needs one). */
export function removeField(config: AgentConfig, formIndex: number, fieldIndex: number): AgentConfig {
  return withList(config, 'forms', (items) => items.map((f, i) => (i === formIndex && list(f.fields).length > 1 ? { ...f, fields: list(f.fields).filter((_, n) => n !== fieldIndex) } : f)));
}
export function moveField(config: AgentConfig, formIndex: number, from: number, to: number): AgentConfig {
  return withList(config, 'forms', (items) => items.map((f, i) => (i === formIndex ? { ...f, fields: moveItem(list(f.fields), from, to) } : f)));
}

/** A copy of a list with one item moved (an out-of-range move leaves it as it is). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (!Array.isArray(items) || to < 0 || to >= items.length || from < 0 || from >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// notifications
/** The senders it can use: connections of type notifier, with what they send. */
export const notifiersOf = (config: AgentConfig | null | undefined) =>
  connectionsOf(config)
    .filter(([, c]) => c.type === 'notifier')
    .map(([id, c]) => ({ id, kind: str(c.kind), provider: str(c.provider) }));
export function addNotification(config: AgentConfig): { config: AgentConfig; index: number } {
  const all = notificationsOf(config);
  const via = notifiersOf(config)[0]?.id ?? '';
  const id = freeId(all.map((n) => str(n.id)), 'message');
  return {
    config: withList(config, 'notifications', (items) => [...items, { id, deliver: [{ via, to: ['{{state.caller_phone}}'], body: '' }] }]),
    index: all.length,
  };
}
export const setNotification = (config: AgentConfig, index: number, changes: Json) => withList(config, 'notifications', (items) => items.map((n, i) => (i === index ? patch(n, changes) : n)));
export const removeNotification = (config: AgentConfig, index: number) => withList(config, 'notifications', (items) => items.filter((_, i) => i !== index));
export function setDelivery(config: AgentConfig, index: number, d: number, changes: Json): AgentConfig {
  return withList(config, 'notifications', (items) =>
    items.map((n, i) => {
      if (i !== index) return n;
      const deliver = list<Json>(n.deliver).map((x, k) => {
        if (k !== d) return x;
        const out = patch(x, changes);
        ['via', 'body'].forEach((key) => {
          if (out[key] === undefined) out[key] = '';
        });
        if (out.to === undefined) out.to = [''];
        return out;
      });
      return { ...n, deliver };
    })
  );
}
export function addDelivery(config: AgentConfig, index: number): AgentConfig {
  const via = notifiersOf(config)[0]?.id ?? '';
  return withList(config, 'notifications', (items) => items.map((n, i) => (i === index ? { ...n, deliver: [...list(n.deliver), { via, to: [''], body: '' }] } : n)));
}
/** The last way of sending stays (a message needs one). */
export function removeDelivery(config: AgentConfig, index: number, d: number): AgentConfig {
  return withList(config, 'notifications', (items) => items.map((n, i) => (i === index && list(n.deliver).length > 1 ? { ...n, deliver: list(n.deliver).filter((_, k) => k !== d) } : n)));
}
/** Who a message goes to, as typed: addresses or numbers separated by commas (templates allowed). */
export const recipientsText = (to: unknown): string | null => (Array.isArray(to) ? to.filter((x) => typeof x === 'string').join(', ') : typeof to === 'string' ? to : null);
export const recipientsFrom = (text: string): string[] => {
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : [''];
};

/** The {{…}} names a text can use, for the hint under a message's text. */
export function templateHints(config: AgentConfig | null | undefined): string[] {
  const vars = Object.keys(isObj(config?.state?.variables) ? (config?.state?.variables as Json) : {});
  return [...vars.map((v) => `{{state.${v}}}`), '{{state.caller_phone}}', '{{with.name}}'].filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
}

/** An action in a few words, for the lists of actions shown read-only (before, closed, on_submit…). */
export function actionWords(action: unknown, config?: AgentConfig | null): string {
  if (!isObj(action)) return 'Does something';
  const say = (v: unknown) => (typeof v === 'string' ? `“${v}”` : isObj(v) && typeof v.message === 'string' ? `the fixed line “${v.message}”` : 'a line');
  switch (action.type) {
    case 'say':
      return `Says ${say(action.text)}`;
    case 'generate':
      return 'Says something the model writes';
    case 'set_state':
      return `Remembers ${Object.keys(isObj(action.values) ? action.values : {}).join(', ') || 'a value'}`;
    case 'handoff':
      return `Hands over to ${str(action.to) || 'another agent'}`;
    case 'return_to_entry':
      return 'Goes back to the first agent';
    case 'end_call':
      return 'Ends the call';
    case 'transfer':
      return `Transfers with “${str(action.transfer)}”`;
    case 'notify':
      return `Sends the message “${str(action.notification)}”`;
    case 'send_form':
      return `Shows the form “${str(action.form)}”`;
    case 'wrapup':
      return `Starts the wrap-up “${str(action.wrapup)}”`;
    case 'http': {
      const host = hostOf(isObj(config?.connections) ? (config?.connections as Json)[str(action.connection)] && ((config?.connections as Json)[str(action.connection)] as Json).base_url : '');
      return `Calls ${str(action.method) || 'GET'} ${str(action.path) || '/'}${host ? ` on ${host}` : action.connection ? ` on “${str(action.connection)}”` : ''}`;
    }
    case 'log':
      return 'Writes a log line';
    case 'play_sound':
      return 'Plays a sound';
    case 'collect_dtmf':
      return 'Collects keypad digits';
    default:
      return humanize(str(action.type)) || 'Does something';
  }
}
