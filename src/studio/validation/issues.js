// A validation message the way a customer needs it: which setting (by its label, not its path), what is wrong in plain words, and, when the
// studio can do it, a button that fixes it. The server's sentences stay the source of truth (they are what it says is wrong); this recognises
// the common ones and rewrites them, and anything it doesn't recognise is shown as the server wrote it, with its place named by labels. The
// fixes only ever change the draft (they are ordinary edits and can be undone), and each is offered only when it is certain what to do.
// Pure: no network, no DOM.

import { isObj } from '../form/engine.js';
import { describeSetting } from '../form/plainLanguage.js';
import { SKIPPED_SECTIONS, layoutFor, viewForPath } from '../form/layout.js';
import { COLLECTIONS, deleteItem, renameEverywhere } from '../form/references.js';
import { defaultsForType } from '../form/presets.js';
import { enableRedaction } from '../records/recordsModel.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const list = (v) => (Array.isArray(v) ? v : []);
const getAt = (root, path) => path.reduce((node, part) => (node == null ? node : node[part]), root);
const setAt = (root, path, value) => {
  if (!path.length) return value;
  const next = clone(root);
  let node = next;
  path.slice(0, -1).forEach((part, i) => { if (node[part] == null) node[part] = typeof path[i + 1] === 'number' ? [] : {}; node = node[part]; });
  node[path[path.length - 1]] = value;
  return next;
};
const removeAt = (root, path) => {
  const next = clone(root);
  const parent = getAt(next, path.slice(0, -1));
  if (Array.isArray(parent)) parent.splice(path[path.length - 1], 1); else if (isObj(parent)) delete parent[path[path.length - 1]];
  return next;
};

// ---- where a path is, in the customer's words -------------------------------------------------------------------------------------------------
const NOUNS = { 'http connections': 'connection', 'mcp connections': 'tool server', agents: 'agent', tools: 'tool', 'tool names': 'tool', messages: 'fixed line', schedules: 'schedule', channels: 'channel', forms: 'form', wrapups: 'closing message', notifications: 'message to send', tasks: 'task', knowledge: 'knowledge base', transfers: 'transfer', 'state variables': 'remembered value', notifiers: 'text or email service', constants: 'fixed value' };
const noun = (collection) => NOUNS[String(collection).replace(/_/g, ' ')] || String(collection).replace(/_/g, ' ').replace(/s$/, '');

// "Channels › phone › What it can hear and say › What it accepts" for ['channels', 0, 'modalities', 'input']. The first part is the screen of
// "All settings" the setting is on; the rest are the labels of what contains it, with a list item or a map entry named by the author's own word.
export function labelPath(config, schema, path, engine) {
  if (!Array.isArray(path) || !path.length) return { parts: [], text: '', screen: null };
  const sectionKeys = isObj(schema?.properties) ? Object.keys(schema.properties).filter((k) => !SKIPPED_SECTIONS.has(k)) : [];
  const groups = sectionKeys.length ? layoutFor(sectionKeys, (key) => Object.keys((engine ? engine.flatten(schema.properties[key]) : schema.properties[key])?.properties || {})) : [];
  const view = groups.length ? viewForPath(groups, path) : null;
  const parts = [];
  if (view) parts.push(view.label);
  const MAPS = ['variables', 'connections', 'schedules', 'constants', 'overrides', 'graph_positions'];
  let owner = '';
  let node = config;
  let shape = schema?.properties?.[path[0]] || null;
  path.forEach((segment, i) => {
    node = node == null ? node : node[segment];
    if (i === 0) {
      if (!view) parts.push(describeSetting(segment, { owner: '' }).label);
      owner = segment;
      return;
    }
    const resolved = shape && engine ? engine.resolveShape(shape, config?.[path[0]] === undefined ? undefined : path.slice(0, i).reduce((n, p) => (n == null ? n : n[p]), config)) : null;
    if (typeof segment === 'number') {
      const word = isObj(node) ? (typeof node.id === 'string' && node.id) || (typeof node.name === 'string' && node.name) : '';
      parts.push(word || `#${segment + 1}`);
      shape = resolved ? resolved.items || null : null;
      return;
    }
    if (i === 1 && view?.only?.includes(segment)) { owner = segment; shape = resolved?.properties?.[segment] || null; return; }
    const declared = resolved ? !!resolved.properties?.[segment] : !MAPS.includes(String(path[i - 1]));
    if (!declared && (resolved ? isObj(resolved.additionalProperties) || resolved.additionalProperties === undefined : true)) {
      // an entry of a map: the author's own word, and the owner stays the map
      parts.push(segment);
      shape = resolved && isObj(resolved.additionalProperties) ? resolved.additionalProperties : null;
      return;
    }
    parts.push(describeSetting(segment, { owner }).label);
    owner = segment;
    shape = resolved?.properties?.[segment] || null;
  });
  return { parts, text: parts.join(' › '), screen: view };
}

// ---- recognising the server's sentences ------------------------------------------------------------------------------------------------------
const TYPE_WORDS = { number: 'a number', integer: 'a whole number', string: 'text', boolean: 'yes or no', array: 'a list', object: 'a group of settings' };
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 64) || 'item';
const distance = (a, b) => {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};
const quoted = (text) => `“${text}”`;

// Each rule: a pattern for the server's sentence, and a function from the match to { text, fixes }. `ctx` has the config, the engine, the path of the
// issue, and `label(name, owner)` for a setting's plain name.
const RULES = [
  { re: /audio input needs an stt/i, make: () => ({ text: 'This channel takes audio in, so the agent needs a model to listen with (speech-to-text), and none is chosen.', fixes: [{ id: 'models-stt', label: 'Choose a listening model', open: { kind: 'models', stage: 'stt' } }] }) },
  { re: /audio output needs a tts/i, make: () => ({ text: 'This channel speaks, so the agent needs a model to speak with (text-to-speech), and none is chosen.', fixes: [{ id: 'models-tts', label: 'Choose a speaking model', open: { kind: 'models', stage: 'tts' } }] }) },
  { re: /^'(.+)' is not a declared (.+?) id \(declared: (.*)\)$/, make: (m, ctx) => {
    const [, value, collection, declaredText] = m;
    const declared = /none declared/.test(declaredText) ? [] : declaredText.split(',').map((s) => s.trim()).filter(Boolean);
    const near = [...declared].sort((a, b) => distance(a, value) - distance(b, value)).slice(0, 3);
    return {
      text: declared.length ? `There is no ${noun(collection)} called ${quoted(value)}. Choose one that exists.` : `There is no ${noun(collection)} called ${quoted(value)}, and none has been made yet.`,
      fixes: near.map((id) => ({ id: `use-${id}`, label: `Use ${quoted(id)}`, apply: (config) => setAt(config, ctx.path, id) })),
    };
  } },
  { re: /^'(.+)' is not a declared (.+?) id$/, make: (m) => ({ text: `There is no ${noun(m[2])} called ${quoted(m[1])}.`, fixes: [] }) },
  { re: /^'(.+)' is a required property$/, make: (m, ctx) => {
    const name = m[1];
    const owner = ctx.path.length ? String(ctx.path.filter((p) => typeof p === 'string').slice(-1)[0] || '') : '';
    const label = describeSetting(name, { owner: ctx.path.length ? owner : '' }).label;
    const what = ctx.path.length ? quoted(label) : `the ${quoted(label)} section`;
    return {
      text: ctx.path.length ? `${what} has to be filled in here, and it is missing.` : `The agent needs ${what}, and it is missing.`,
      // adding the setting is one click; what it should say is then the person's to write, so the form takes them to it
      fixes: ctx.path.length && ctx.addMissing(name) ? [{ id: `add-${name}`, label: `Add ${what.replace(/[“”]/g, '')}`, apply: (config) => ctx.addMissing(name)(config), jumpTo: [...ctx.path, name] }] : [],
    };
  } },
  { re: /^duplicate (\w+) id '(.+)' \((\d+) times\)$/, make: (m) => ({ text: `Two ${m[1]}s are both called ${quoted(m[2])}. Every id has to be different, so give one of them another.`, fixes: [] }) },
  { re: /^'(.+)' does not match '\^\[a-z\]\[a-z0-9_-\]\{0,63\}\$'$/, make: (m, ctx) => {
    const collection = Object.entries(COLLECTIONS).find(([, info]) => info.kind === 'list' && info.path.join('.') === ctx.path.slice(0, -1).filter((p) => typeof p !== 'number').join('.'))?.[0];
    const fixed = slug(m[1]);
    return {
      text: `${quoted(m[1])} can’t be used as an id. Start with a lowercase letter, then use lowercase letters, digits, _ or -, up to 64 characters.`,
      fixes: collection && ctx.engine ? [{ id: 'rename-id', label: `Rename it to ${quoted(fixed)}`, apply: (config) => renameEverywhere(ctx.engine, config, collection, m[1], fixed) }] : [{ id: 'fix-id', label: `Use ${quoted(fixed)}`, apply: (config) => setAt(config, ctx.path, fixed) }],
    };
  } },
  { re: /^'(.+)' does not match '\^\[A-Z\]\[A-Z0-9_\]\*\$'$/, make: (m, ctx) => {
    const fixed = String(m[1]).toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^[^A-Z]+/, '') || 'SECRET';
    return { text: `A secret’s name uses capital letters, digits and _ and starts with a letter. ${quoted(m[1])} doesn’t.`, fixes: [{ id: 'secret-name', label: `Use ${quoted(fixed)}`, apply: (config) => setAt(config, ctx.path, fixed) }] };
  } },
  { re: /^'(.*)' does not match '(.+)'$/, make: (m) => ({ text: `${quoted(m[1])} isn’t in the form this setting needs.`, fixes: [] }) },
  { re: /^(-?[\d.]+) is less than or equal to the minimum of (-?[\d.]+)$/, make: (m) => ({ text: `${m[1]} is too small: it has to be more than ${m[2]}.`, fixes: [] }) },
  { re: /^(-?[\d.]+) is less than the minimum of (-?[\d.]+)$/, make: (m) => ({ text: `${m[1]} is too small: it has to be at least ${m[2]}.`, fixes: [] }) },
  { re: /^(-?[\d.]+) is greater than (?:or equal to )?the maximum of (-?[\d.]+)$/, make: (m) => ({ text: `${m[1]} is too big: it can be at most ${m[2]}.`, fixes: [] }) },
  { re: /^'?(.*?)'? is not of type '(\w+)'$/, make: (m) => ({ text: `${quoted(m[1])} isn’t ${TYPE_WORDS[m[2]] || `a ${m[2]}`}, which is what this setting needs.`, fixes: [] }) },
  { re: /^'(.+)' is not one of \[(.*)\]$/, make: (m, ctx) => {
    const options = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    return { text: `${quoted(m[1])} isn’t one of the choices.`, fixes: options.length && options.length <= 4 ? options.map((o) => ({ id: `choose-${o}`, label: `Use ${quoted(o)}`, apply: (config) => setAt(config, ctx.path, o) })) : [] };
  } },
  { re: /^this config uses features that need schema_version ([\d.]+)(?: \((.*)\))?, but says ([\d.]+)$/, make: (m) => ({
    text: `Something in this agent needs a newer file format (schema version ${m[1]})${m[2] ? `: ${m[2]}` : ''}. The draft says ${m[3]}.`,
    fixes: [{ id: 'raise-version', label: `Use schema version ${m[1]}`, apply: (config) => ({ ...config, schema_version: m[1] }) }],
  }) },
  { re: /^tool '(.+)' is not used by any agent, task or guardrail$/, make: (m, ctx) => {
    const id = m[1];
    const agents = list(ctx.config?.agents?.items).filter((a) => isObj(a) && a.id);
    const entry = ctx.config?.agents?.entry;
    const ordered = [...agents.filter((a) => a.id === entry), ...agents.filter((a) => a.id !== entry)].slice(0, 2);
    return {
      text: `The tool ${quoted(id)} isn’t offered to any agent, so it will never be used.`,
      fixes: [
        ...ordered.map((agent) => ({ id: `offer-${agent.id}`, label: `Offer it to ${quoted(agent.id)}`, apply: (config) => {
          const index = list(config.agents.items).findIndex((a) => a?.id === agent.id);
          return setAt(config, ['agents', 'items', index, 'tools'], [...list(config.agents.items[index].tools), id]);
        } })),
        { id: 'delete-tool', label: 'Delete the tool', apply: (config) => deleteItem(config, 'tools', id) },
      ],
    };
  } },
  { re: /^template '(.*)' reads undeclared state variable '(.+)'$/, make: (m) => ({
    text: `This text uses the remembered value ${quoted(m[2])}, which doesn’t exist.`,
    fixes: [{ id: 'add-variable', label: `Add the remembered value ${quoted(m[2])}`, apply: (config) => setAt(config, ['state', 'variables', m[2]], { type: 'string' }) }],
  }) },
  { re: /^(?:Additional|Unevaluated) properties are not allowed \((.+) (?:was|were) unexpected\)$/, make: (m, ctx) => {
    const keys = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    return {
      text: `${keys.map(quoted).join(', ')} ${keys.length === 1 ? 'isn’t a setting' : 'aren’t settings'} that can be used here.`,
      fixes: keys.length && keys.length <= 3 ? [{ id: 'remove-unknown', label: `Remove ${keys.map(quoted).join(', ')}`, apply: (config) => keys.reduce((c, key) => removeAt(c, [...ctx.path, key]), config) }] : [],
    };
  } },
  { re: /^\[\] should be non-empty$/, make: () => ({ text: 'This list can’t be empty: add at least one.', fixes: [] }) },
  { re: /the bot declares sensitive variables and saves transcripts, but post_call\.redaction is not set/i, make: () => ({
    text: 'The agent handles sensitive details and saves transcripts, but nothing hides them, so transcripts will contain what callers say.',
    fixes: [{ id: 'redaction', label: 'Hide sensitive details in saved transcripts', apply: (config) => enableRedaction(config).config }],
  }) },
  { re: /the bot declares sensitive variables and the per-call session log is on/i, make: () => ({
    text: 'The agent handles sensitive details and keeps a log of each call. Values marked sensitive are hidden in the log, but what callers say is recorded.',
    fixes: [{ id: 'redaction', label: 'Hide sensitive details in saved transcripts', apply: (config) => enableRedaction(config).config }],
  }) },
];

// ---- one issue, described ----------------------------------------------------------------------------------------------------------------------
// `ctx`: { config, schema, engine } (engine and schema are optional: without them the words are still plain, just fewer fixes).
export function describeIssue(issue, ctx = {}) {
  const config = ctx.config;
  const path = Array.isArray(issue.path) ? issue.path : [];
  const where = labelPath(config, ctx.schema, path, ctx.engine);
  const addMissing = (name) => {
    if (!ctx.engine) return null;
    return (current) => {
      if (!path.length) {
        const section = ctx.schema?.properties?.[name];
        return section ? setAt(current, [name], ctx.engine.defaultFor(section)) : current;
      }
      const parent = getAt(current, path);
      if (name === 'entry' && isObj(parent) && typeof parent.type === 'string' && path[0] === 'channels') return setAt(current, [...path, 'entry'], defaultsForType(parent.type, current?.meta?.id).entry || {});
      let shape = ctx.schema?.properties?.[path[0]];
      // walk to the object's own schema
      let value = current[path[0]];
      for (let i = 1; i < path.length && shape; i += 1) {
        const resolved = ctx.engine.resolveShape(shape, value);
        const step = path[i];
        value = value == null ? value : value[step];
        shape = typeof step === 'number' ? resolved.items : (resolved.properties?.[step] || (isObj(resolved.additionalProperties) ? resolved.additionalProperties : null));
      }
      const resolved = shape ? ctx.engine.resolveShape(shape, value) : null;
      const sub = resolved?.properties?.[name];
      return sub ? setAt(current, [...path, name], ctx.engine.defaultFor(sub)) : current;
    };
  };
  const rulectx = { config, engine: ctx.engine, schema: ctx.schema, path, addMissing };
  for (const rule of RULES) {
    const m = rule.re.exec(issue.message || '');
    if (!m) continue;
    const made = rule.make(m, rulectx);
    return { severity: issue.severity, path: issue.path, where, text: made.text, fixes: made.fixes || [], raw: issue.message, recognised: true };
  }
  return { severity: issue.severity, path: issue.path, where, text: issue.message, fixes: [], raw: issue.message, recognised: false };
}

// The issues of a report, described and ordered for reading: what can be fixed in a click first, then what needs the person.
export function describeIssues(issues, ctx = {}) {
  const described = issues.map((issue) => describeIssue(issue, ctx));
  const errors = described.filter((d) => d.severity === 'error');
  const warnings = described.filter((d) => d.severity !== 'error');
  const byFix = (a, b) => Number(b.fixes.length > 0) - Number(a.fixes.length > 0);
  return {
    fixNow: errors.filter((d) => d.fixes.length > 0),
    needsYou: errors.filter((d) => d.fixes.length === 0),
    worthALook: [...warnings].sort(byFix),
    errors: errors.length,
    warnings: warnings.length,
  };
}
