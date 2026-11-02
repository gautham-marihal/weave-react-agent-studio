// Find a setting by name or purpose ("silent", `timeout_s`) from anywhere. Built from GET /schema, the plain-language
// catalogue and the layout, so it knows every setting and where it lives ("How it talks › Conversation flow › …").
// Pure: no network, no DOM.
import { isObj, type RawSchema, type SchemaNode } from './engine';
import { describeSetting, type Level } from './plainLanguage';
import { SKIPPED_SECTIONS, layoutFor, viewForPath } from './layout';

// Set up by the platform when a phone number is added, never asked for; offering them would lead to a field that isn't
// there.
const PLATFORM_SET = new Set(['channels.[].entry.dnis', 'channels.[].entry.sip_trunk', 'channels.[].entry.dispatch_rule']);

// Everyday words a part's own name doesn't use ("opening hours" for business hours), by path, so they find it too.
const ALSO: Record<string, string> = {
  schedules: 'opening hours office hours open closed holidays',
  'telephony.transfers': 'hand over handover human person escalate',
  knowledge: 'documents files faq website pages',
  guardrails: 'safety block blocked forbidden topics',
  post_call: 'summary wrap up',
  channels: 'phone chat website widget reach whatsapp sms',
  tools: 'actions abilities integrations lookup webhook',
  connections: 'api webhook endpoint integration',
  'defaults.language': 'languages multilingual',
  'defaults.models': 'llm gpt ai',
  tests: 'scenarios test cases',
};

/** One setting, once per place: `trail` is the keys from the top ('[]' a list item, '{}' a map entry). */
export interface SettingEntry {
  name: string;
  trail: string[];
  /** As far as it can be opened: up to the first list or map (an item can't be named before there is one). */
  jump: string[];
  label: string;
  purpose: string;
  level: Level;
  example: string;
  also: string;
  crumbs: string[];
  screen: { id: string; label: string } | null;
  group: { id: string; label: string; advanced: boolean } | null;
  where: string;
}

const deref = (schema: RawSchema, node: unknown): RawSchema => {
  let n: unknown = node;
  for (let i = 0; i < 24 && isObj(n) && typeof n.$ref === 'string'; i += 1) {
    const { $ref, ...rest } = n as RawSchema;
    const target = String($ref)
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .reduce<unknown>((x, k) => (isObj(x) ? x[decodeURIComponent(k)] : undefined), schema);
    n = { ...(isObj(target) ? target : {}), ...rest };
  }
  return isObj(n) ? (n as RawSchema) : {};
};

const LEVELS: Level[] = ['guided', 'detailed', 'expert'];
const audienceOf = (flat: RawSchema): Level | undefined => {
  const a = isObj(flat['x-ui']) ? flat['x-ui'].audience : undefined;
  return LEVELS.includes(a as Level) ? (a as Level) : undefined;
};

/** Every property in the schema, once per place, with its plain label and where it lives. */
export function buildSettingsIndex(schema: RawSchema | null | undefined): SettingEntry[] {
  if (!schema || !isObj(schema.properties)) return [];
  const root = schema;
  const props = schema.properties;
  const sectionKeys = Object.keys(props).filter((k) => !SKIPPED_SECTIONS.has(k));
  const groups = layoutFor(sectionKeys, (key) => Object.keys(deref(root, props[key]).properties || {}));
  type Partial = Omit<SettingEntry, 'also' | 'crumbs' | 'screen' | 'group' | 'where'>;
  const found = new Map<string, Partial>();
  const walk = (node: SchemaNode | unknown, trail: string[], owner: string, stack: string[]) => {
    if (!isObj(node)) return;
    let here = stack;
    if (typeof node.$ref === 'string') {
      if (stack.includes(node.$ref)) return;
      here = [...stack, node.$ref];
    }
    const n = deref(root, node);
    Object.entries(n.properties || {}).forEach(([name, sub]) => {
      const next = [...trail, name];
      const flat = deref(root, sub);
      const key = next.join('.');
      if (!found.has(key)) {
        const words = describeSetting(name, { owner, description: flat.description });
        const stop = next.findIndex((part) => part === '[]' || part === '{}');
        found.set(key, {
          name,
          trail: next,
          jump: stop === -1 ? next : next.slice(0, stop),
          label: words.label,
          purpose: words.purpose,
          level: audienceOf(flat) || words.level,
          example: words.example,
        });
      }
      walk(sub, next, name, here);
    });
    (['oneOf', 'anyOf', 'allOf'] as const).forEach((k) => (n[k] || []).forEach((branch) => walk(branch, trail, owner, here)));
    if (isObj(n.items)) walk(n.items, [...trail, '[]'], owner, here);
    if (isObj(n.additionalProperties)) walk(n.additionalProperties, [...trail, '{}'], owner, here);
    (['then', 'else'] as const).forEach((k) => walk(n[k], trail, owner, here));
  };
  sectionKeys.forEach((key) => {
    const flat = deref(root, props[key]);
    const words = describeSetting(key, { owner: '', description: flat.description });
    found.set(key, { name: key, trail: [key], jump: [key], label: words.label, purpose: words.purpose, level: words.level, example: words.example });
    walk(props[key], [key], key, []);
  });
  return [...found.values()]
    .filter((entry) => !PLATFORM_SET.has(entry.trail.join('.')))
    .map((entry) => {
      const view = viewForPath(groups, entry.jump);
      const group = groups.find((g) => g.id === view?.group);
      // where it is: the group and screen, then the labels of the containers above it
      const containers = entry.trail.slice(0, -1).filter((p) => p !== '[]' && p !== '{}');
      const crumbs: string[] = [];
      let owner = '';
      containers.forEach((name, i) => {
        if (i === 0) return; // the screen names the section
        crumbs.push(describeSetting(name, { owner }).label);
        owner = name;
      });
      return {
        ...entry,
        also: ALSO[entry.trail.join('.')] || '',
        crumbs,
        screen: view ? { id: view.id, label: view.label } : null,
        group: group ? { id: group.id, label: group.label, advanced: !!group.advanced } : null,
        where: [group?.label, view?.label, ...crumbs].filter(Boolean).join(' › '),
      };
    });
}

const norm = (text: unknown) => String(text || '').toLowerCase();
const wordsOf = (text: unknown) =>
  norm(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Settings matching what was typed, best first. Every word must match somewhere; a match at the start of a label word
 * counts most, then the label, technical name, purpose, or where it lives.
 */
export function searchSettings(index: SettingEntry[], query: string, limit = 8): SettingEntry[] {
  const typed = wordsOf(query);
  if (!typed.length || typed.join('').length < 2) return [];
  const scored: { entry: SettingEntry; score: number }[] = [];
  for (const entry of index) {
    const label = norm(entry.label);
    const labelWords = wordsOf(entry.label);
    const nameWords = wordsOf(entry.name);
    const alsoWords = wordsOf(entry.also);
    const purpose = norm(entry.purpose);
    const where = norm(entry.where);
    let total = 0;
    let all = true;
    for (const word of typed) {
      let best = 0;
      if (labelWords.includes(word)) best = 10;
      else if (labelWords.some((w) => w.startsWith(word))) best = 8;
      else if (label.includes(word)) best = 6;
      else if (nameWords.some((w) => w === word) || alsoWords.includes(word)) best = 7;
      else if (nameWords.some((w) => w.startsWith(word)) || norm(entry.name).includes(word)) best = 5;
      else if (purpose.includes(word)) best = 3;
      else if (where.includes(word)) best = 2;
      if (!best) {
        all = false;
        break;
      }
      total += best;
    }
    if (!all) continue;
    // a screen's own heading beats the same word deep inside; experts' settings come after
    const depth = entry.trail.length;
    scored.push({ entry, score: total * 10 - depth + (entry.level === 'expert' ? -15 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.where.localeCompare(b.entry.where));
  // one per label and place: a list item's property is the same setting for every item
  const seen = new Set<string>();
  const out: SettingEntry[] = [];
  for (const { entry } of scored) {
    const key = `${entry.label}|${entry.where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
