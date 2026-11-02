// A problem the server's checks found, the way a person needs it: the setting by its label, what is wrong in plain
// words, and a fix button when the studio is certain what to do (a fix is an ordinary, undoable draft edit). The
// server's sentences stay the source of truth: common ones are reworded, anything else is shown as written.
// Pure: no network, no DOM.
import type { Path } from '../types/studio';
import { isObj, type Json, type RawSchema, type SchemaEngine } from './schemaForm/engine';
import { describeSetting } from './schemaForm/plainLanguage';
import { SKIPPED_SECTIONS, layoutFor, viewForPath, type FormView } from './schemaForm/layout';
import { COLLECTIONS, deleteItem, renameEverywhere } from './schemaForm/references';

type Config = Json;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const getAt = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>((node, part) => (node === null || node === undefined ? node : (node as Record<string | number, unknown>)[part]), root);
function setAt(root: Config, path: Path, value: unknown): Config {
  if (!path.length) return value as Config;
  const next = clone(root);
  let node = next as Record<string | number, unknown>;
  path.slice(0, -1).forEach((part, i) => {
    if (node[part] === null || node[part] === undefined) node[part] = typeof path[i + 1] === 'number' ? [] : {};
    node = node[part] as Record<string | number, unknown>;
  });
  node[path[path.length - 1]] = value;
  return next;
}
function removeAt(root: Config, path: Path): Config {
  const next = clone(root);
  const parent = getAt(next, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
  else if (isObj(parent)) delete parent[String(last)];
  return next;
}

// ---- where a path is, in the customer's words ----------------------------------------------------------------------

const NOUNS: Record<string, string> = {
  'http connections': 'connection',
  'mcp connections': 'tool server',
  agents: 'agent',
  tools: 'tool',
  'tool names': 'tool',
  messages: 'fixed line',
  schedules: 'schedule',
  channels: 'channel',
  forms: 'form',
  wrapups: 'closing message',
  notifications: 'message to send',
  tasks: 'task',
  knowledge: 'knowledge base',
  transfers: 'transfer',
  'state variables': 'remembered value',
  notifiers: 'text or email service',
  constants: 'fixed value',
};
const noun = (collection: string) => NOUNS[collection.replace(/_/g, ' ')] || collection.replace(/_/g, ' ').replace(/s$/, '');

export interface PlacePath {
  parts: string[];
  text: string;
  screen: FormView | null;
}

const MAPS = ['variables', 'connections', 'schedules', 'constants', 'overrides', 'graph_positions'];

/**
 * "Channels › phone › What it can hear and say › What it accepts" for ['channels', 0, 'modalities', 'input']: the
 * "All settings" screen, then the labels of what holds it (list items and map entries by the author's own word).
 */
export function labelPath(config: unknown, schema: RawSchema | null | undefined, path: Path | null | undefined, engine?: SchemaEngine | null): PlacePath {
  if (!Array.isArray(path) || !path.length) return { parts: [], text: '', screen: null };
  const props = isObj(schema?.properties) ? (schema?.properties as Record<string, unknown>) : null;
  const sectionKeys = props ? Object.keys(props).filter((k) => !SKIPPED_SECTIONS.has(k)) : [];
  const groups = sectionKeys.length
    ? layoutFor(sectionKeys, (key) => Object.keys((engine ? engine.flatten(props?.[key]) : (props?.[key] as RawSchema))?.properties || {}))
    : [];
  const view = groups.length ? viewForPath(groups, path) : null;
  const parts: string[] = [];
  if (view) parts.push(view.label);
  let owner = '';
  let node: unknown = config;
  let shape: unknown = props?.[String(path[0])] ?? null;
  path.forEach((segment, i) => {
    node = node === null || node === undefined ? node : (node as Record<string | number, unknown>)[segment];
    if (i === 0) {
      if (!view) parts.push(describeSetting(segment, { owner: '' }).label);
      owner = String(segment);
      return;
    }
    let resolved = null;
    if (shape && engine) {
      try {
        resolved = engine.resolveShape(shape, getAt(config, path.slice(0, i)));
      } catch {
        resolved = null;
      }
    }
    if (typeof segment === 'number') {
      const word = isObj(node) ? (typeof node.id === 'string' && node.id) || (typeof node.name === 'string' && node.name) : '';
      parts.push(word || `#${segment + 1}`);
      shape = resolved ? resolved.items || null : null;
      return;
    }
    if (i === 1 && view?.only?.includes(segment)) {
      owner = segment;
      shape = resolved?.properties?.[segment] || null;
      return;
    }
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

// ---- fixes ---------------------------------------------------------------------------------------------------------

/** A fix: a change to the draft (`apply`), or a place to go and choose (`open`). */
export interface IssueFix {
  id: string;
  label: string;
  apply?: (config: Config) => Config;
  /** A choice the person makes: the field to open (the models to listen or speak with). */
  open?: Path;
  /** Where to go after the change, for what the person still has to write. */
  jumpTo?: Path;
}

// What the agent already handles that is worth hiding: card numbers, what its personal-details checks look for, and
// PINs when a value it keeps sensitive is named like one.
function sensitiveEntities(config: Config): string[] {
  const entities = new Set(['card_number']);
  const guardrails = isObj(config.guardrails) ? config.guardrails : {};
  ['input', 'output'].forEach((side) =>
    list(guardrails[side]).forEach((rule) => {
      if (isObj(rule) && rule.type === 'pii_detect') list(rule.entities).forEach((e) => entities.add(String(e)));
    }),
  );
  const vars = getAt(config, ['state', 'variables']);
  Object.entries(isObj(vars) ? vars : {}).forEach(([name, spec]) => {
    if (isObj(spec) && spec.sensitive === true && /pin/i.test(name)) entities.add('pin');
  });
  return [...entities];
}

/** Turns redaction on for what the agent handles. Redaction needs schema 1.2, so a lower version is raised. */
export function enableRedaction(config: Config): Config {
  const allowed = ['card_number', 'bank_account', 'national_id', 'phone_number', 'email', 'date_of_birth', 'otp', 'pin'];
  const next = clone(config);
  const postCall = isObj(next.post_call) ? { ...next.post_call } : {};
  postCall.redaction = { enabled: true, entities: sensitiveEntities(config).filter((e) => allowed.includes(e)) };
  next.post_call = postCall;
  if (next.schema_version !== '1.2') next.schema_version = '1.2';
  return next;
}

// What a channel of each kind starts its `entry` with (a web channel names its widget).
const channelEntry = (type: string, botId: unknown): Json =>
  type === 'web_voice' || type === 'web_chat' ? { widget_id: `${typeof botId === 'string' && botId ? botId : 'agent'}-widget` } : {};

// ---- recognising the server's sentences ------------------------------------------------------------------------------

const TYPE_WORDS: Record<string, string> = { number: 'a number', integer: 'a whole number', string: 'text', boolean: 'yes or no', array: 'a list', object: 'a group of settings' };
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 64) || 'item';
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const quoted = (text: string) => `“${text}”`;

interface RuleContext {
  config: Config;
  engine: SchemaEngine | null;
  schema: RawSchema | null;
  path: Path;
  addMissing: (name: string) => ((config: Config) => Config) | null;
}
interface Rule {
  re: RegExp;
  make: (m: RegExpExecArray, ctx: RuleContext) => { text: string; fixes: IssueFix[] };
}

const RULES: Rule[] = [
  {
    re: /audio input needs an stt/i,
    make: () => ({
      text: 'This channel takes audio in, so the agent needs a model to listen with (speech-to-text), and none is chosen.',
      fixes: [{ id: 'models-stt', label: 'Choose a listening model', open: ['defaults', 'models', 'stt', 'provider'] }],
    }),
  },
  {
    re: /audio output needs a tts/i,
    make: () => ({
      text: 'This channel speaks, so the agent needs a model to speak with (text-to-speech), and none is chosen.',
      fixes: [{ id: 'models-tts', label: 'Choose a speaking model', open: ['defaults', 'models', 'tts', 'provider'] }],
    }),
  },
  {
    re: /^'(.+)' is not a declared (.+?) id \(declared: (.*)\)$/,
    make: (m, ctx) => {
      const [, value, collection, declaredText] = m;
      const declared = /none declared/.test(declaredText)
        ? []
        : declaredText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const near = [...declared].sort((a, b) => distance(a, value) - distance(b, value)).slice(0, 3);
      return {
        text: declared.length
          ? `There is no ${noun(collection)} called ${quoted(value)}. Choose one that exists.`
          : `There is no ${noun(collection)} called ${quoted(value)}, and none has been made yet.`,
        fixes: near.map((id) => ({ id: `use-${id}`, label: `Use ${quoted(id)}`, apply: (config: Config) => setAt(config, ctx.path, id) })),
      };
    },
  },
  { re: /^'(.+)' is not a declared (.+?) id$/, make: (m) => ({ text: `There is no ${noun(m[2])} called ${quoted(m[1])}.`, fixes: [] }) },
  {
    re: /^'(.+)' is a required property$/,
    make: (m, ctx) => {
      const name = m[1];
      const owner = ctx.path.length ? String(ctx.path.filter((p) => typeof p === 'string').slice(-1)[0] || '') : '';
      const label = describeSetting(name, { owner }).label;
      const what = ctx.path.length ? quoted(label) : `the ${quoted(label)} section`;
      const add = ctx.addMissing(name);
      return {
        text: ctx.path.length ? `${what} has to be filled in here, and it is missing.` : `The agent needs ${what}, and it is missing.`,
        // adding the setting is one click; what it should say is the person's to write, so the form takes them there
        fixes: ctx.path.length && add ? [{ id: `add-${name}`, label: `Add ${what.replace(/[“”]/g, '')}`, apply: add, jumpTo: [...ctx.path, name] }] : [],
      };
    },
  },
  {
    re: /^duplicate (\w+) id '(.+)' \((\d+) times\)$/,
    make: (m) => ({ text: `Two ${m[1]}s are both called ${quoted(m[2])}. Every id has to be different, so give one of them another.`, fixes: [] }),
  },
  {
    re: /^'(.+)' does not match '\^\[a-z\]\[a-z0-9_-\]\{0,63\}\$'$/,
    make: (m, ctx) => {
      const listPath = ctx.path
        .slice(0, -1)
        .filter((p) => typeof p !== 'number')
        .join('.');
      const collection = Object.entries(COLLECTIONS).find(([, info]) => info.kind === 'list' && info.path.join('.') === listPath)?.[0];
      const fixed = slug(m[1]);
      const engine = ctx.engine;
      return {
        text: `${quoted(m[1])} can’t be used as an id. Start with a lowercase letter, then use lowercase letters, digits, _ or -, up to 64 characters.`,
        fixes:
          collection && engine
            ? [{ id: 'rename-id', label: `Rename it to ${quoted(fixed)}`, apply: (config: Config) => renameEverywhere(engine, config, collection, m[1], fixed) }]
            : [{ id: 'fix-id', label: `Use ${quoted(fixed)}`, apply: (config: Config) => setAt(config, ctx.path, fixed) }],
      };
    },
  },
  {
    re: /^'(.+)' does not match '\^\[A-Z\]\[A-Z0-9_\]\*\$'$/,
    make: (m, ctx) => {
      const fixed =
        m[1]
          .toUpperCase()
          .replace(/[^A-Z0-9_]+/g, '_')
          .replace(/^[^A-Z]+/, '') || 'SECRET';
      return {
        text: `A secret’s name uses capital letters, digits and _ and starts with a letter. ${quoted(m[1])} doesn’t.`,
        fixes: [{ id: 'secret-name', label: `Use ${quoted(fixed)}`, apply: (config: Config) => setAt(config, ctx.path, fixed) }],
      };
    },
  },
  { re: /^'(.*)' does not match '(.+)'$/, make: (m) => ({ text: `${quoted(m[1])} isn’t in the form this setting needs.`, fixes: [] }) },
  {
    re: /^(-?[\d.]+) is less than or equal to the minimum of (-?[\d.]+)$/,
    make: (m) => ({ text: `${m[1]} is too small: it has to be more than ${m[2]}.`, fixes: [] }),
  },
  { re: /^(-?[\d.]+) is less than the minimum of (-?[\d.]+)$/, make: (m) => ({ text: `${m[1]} is too small: it has to be at least ${m[2]}.`, fixes: [] }) },
  {
    re: /^(-?[\d.]+) is greater than (?:or equal to )?the maximum of (-?[\d.]+)$/,
    make: (m) => ({ text: `${m[1]} is too big: it can be at most ${m[2]}.`, fixes: [] }),
  },
  {
    re: /^'?(.*?)'? is not of type '(\w+)'$/,
    make: (m) => ({ text: `${quoted(m[1])} isn’t ${TYPE_WORDS[m[2]] || `a ${m[2]}`}, which is what this setting needs.`, fixes: [] }),
  },
  {
    re: /^'(.+)' is not one of \[(.*)\]$/,
    make: (m, ctx) => {
      const options = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      return {
        text: `${quoted(m[1])} isn’t one of the choices.`,
        fixes:
          options.length && options.length <= 4
            ? options.map((o) => ({ id: `choose-${o}`, label: `Use ${quoted(o)}`, apply: (config: Config) => setAt(config, ctx.path, o) }))
            : [],
      };
    },
  },
  {
    re: /^this config uses features that need schema_version ([\d.]+)(?: \((.*)\))?, but says ([\d.]+)$/,
    make: (m) => ({
      text: `Something in this agent needs a newer file format (schema version ${m[1]})${m[2] ? `: ${m[2]}` : ''}. The draft says ${m[3]}.`,
      fixes: [{ id: 'raise-version', label: `Use schema version ${m[1]}`, apply: (config: Config) => ({ ...config, schema_version: m[1] }) }],
    }),
  },
  {
    re: /^tool '(.+)' is not used by any agent, task or guardrail$/,
    make: (m, ctx) => {
      const id = m[1];
      const agents = list(getAt(ctx.config, ['agents', 'items'])).filter((a): a is Json => isObj(a) && !!a.id);
      const entry = getAt(ctx.config, ['agents', 'entry']);
      const ordered = [...agents.filter((a) => a.id === entry), ...agents.filter((a) => a.id !== entry)].slice(0, 2);
      return {
        text: `The tool ${quoted(id)} isn’t offered to any agent, so it will never be used.`,
        fixes: [
          ...ordered.map((agent) => ({
            id: `offer-${String(agent.id)}`,
            label: `Offer it to ${quoted(String(agent.id))}`,
            apply: (config: Config) => {
              const items = list(getAt(config, ['agents', 'items']));
              const index = items.findIndex((a) => isObj(a) && a.id === agent.id);
              const current = list(isObj(items[index]) ? (items[index] as Json).tools : undefined);
              return setAt(config, ['agents', 'items', index, 'tools'], [...current, id]);
            },
          })),
          { id: 'delete-tool', label: 'Delete the tool', apply: (config: Config) => deleteItem(config, 'tools', id) },
        ],
      };
    },
  },
  {
    re: /^template '(.*)' reads undeclared state variable '(.+)'$/,
    make: (m) => ({
      text: `This text uses the remembered value ${quoted(m[2])}, which doesn’t exist.`,
      fixes: [
        {
          id: 'add-variable',
          label: `Add the remembered value ${quoted(m[2])}`,
          apply: (config: Config) => setAt(config, ['state', 'variables', m[2]], { type: 'string' }),
        },
      ],
    }),
  },
  {
    re: /^(?:Additional|Unevaluated) properties are not allowed \((.+) (?:was|were) unexpected\)$/,
    make: (m, ctx) => {
      const keys = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      return {
        text: `${keys.map(quoted).join(', ')} ${keys.length === 1 ? 'isn’t a setting' : 'aren’t settings'} that can be used here.`,
        fixes:
          keys.length && keys.length <= 3
            ? [
                {
                  id: 'remove-unknown',
                  label: `Remove ${keys.map(quoted).join(', ')}`,
                  apply: (config: Config) => keys.reduce((c, key) => removeAt(c, [...ctx.path, key]), config),
                },
              ]
            : [],
      };
    },
  },
  { re: /^\[\] should be non-empty$/, make: () => ({ text: 'This list can’t be empty: add at least one.', fixes: [] }) },
  {
    re: /the bot declares sensitive variables and saves transcripts, but post_call\.redaction is not set/i,
    make: () => ({
      text: 'The agent handles sensitive details and saves transcripts, but nothing hides them, so transcripts will contain what callers say.',
      fixes: [{ id: 'redaction', label: 'Hide sensitive details in saved transcripts', apply: enableRedaction }],
    }),
  },
  {
    re: /the bot declares sensitive variables and the per-call session log is on/i,
    make: () => ({
      text: 'The agent handles sensitive details and keeps a log of each call. Values marked sensitive are hidden in the log, but what callers say is recorded.',
      fixes: [{ id: 'redaction', label: 'Hide sensitive details in saved transcripts', apply: enableRedaction }],
    }),
  },
];

// ---- one issue, described -------------------------------------------------------------------------------------------

export interface IssueInput {
  path: Path | null;
  message: string;
  severity?: 'error' | 'warning';
}

export interface DescribedIssue {
  severity: 'error' | 'warning';
  path: Path | null;
  where: PlacePath;
  text: string;
  fixes: IssueFix[];
  /** The server's own sentence. */
  raw: string;
  recognised: boolean;
}

export interface DescribeContext {
  config: unknown;
  schema?: RawSchema | null;
  engine?: SchemaEngine | null;
}

/** One problem in plain words, with fixes where the studio is certain (without the schema there are fewer). */
export function describeIssue(issue: IssueInput, ctx: DescribeContext): DescribedIssue {
  const config = (isObj(ctx.config) ? ctx.config : {}) as Config;
  const engine = ctx.engine ?? null;
  const schema = ctx.schema ?? null;
  const path = Array.isArray(issue.path) ? issue.path : [];
  const where = labelPath(config, schema, path, engine);
  const addMissing = (name: string) => {
    if (!engine) return null;
    return (current: Config): Config => {
      if (!path.length) {
        const section = schema?.properties?.[name];
        return section ? setAt(current, [name], engine.defaultFor(section)) : current;
      }
      const parent = getAt(current, path);
      if (name === 'entry' && isObj(parent) && typeof parent.type === 'string' && path[0] === 'channels')
        return setAt(current, [...path, 'entry'], channelEntry(parent.type, getAt(current, ['meta', 'id'])));
      // walk to the object's own schema
      let shape: unknown = schema?.properties?.[String(path[0])];
      let value: unknown = current[String(path[0])];
      for (let i = 1; i < path.length && shape; i += 1) {
        const resolved = engine.resolveShape(shape, value);
        const step = path[i];
        value = value === null || value === undefined ? value : (value as Record<string | number, unknown>)[step];
        shape = typeof step === 'number' ? resolved.items : resolved.properties?.[step] || (isObj(resolved.additionalProperties) ? resolved.additionalProperties : null);
      }
      const resolved = shape ? engine.resolveShape(shape, value) : null;
      const sub = resolved?.properties?.[name];
      return sub ? setAt(current, [...path, name], engine.defaultFor(sub)) : current;
    };
  };
  const severity = issue.severity === 'error' ? 'error' : 'warning';
  const ruleCtx: RuleContext = { config, engine, schema, path, addMissing };
  for (const rule of RULES) {
    const m = rule.re.exec(issue.message || '');
    if (!m) continue;
    const made = rule.make(m, ruleCtx);
    return { severity, path: issue.path, where, text: made.text, fixes: made.fixes, raw: issue.message, recognised: true };
  }
  return { severity, path: issue.path, where, text: issue.message, fixes: [], raw: issue.message, recognised: false };
}

/** A report's problems, described and ordered for reading: one-click fixes first, then what needs the person. */
export function describeIssues(issues: IssueInput[], ctx: DescribeContext) {
  const described = issues.map((issue) => describeIssue(issue, ctx));
  const errors = described.filter((d) => d.severity === 'error');
  const warnings = described.filter((d) => d.severity !== 'error');
  const byFix = (a: DescribedIssue, b: DescribedIssue) => Number(b.fixes.length > 0) - Number(a.fixes.length > 0);
  return {
    fixNow: errors.filter((d) => d.fixes.length > 0),
    needsYou: errors.filter((d) => d.fixes.length === 0),
    worthALook: [...warnings].sort(byFix),
    errors: errors.length,
    warnings: warnings.length,
  };
}
