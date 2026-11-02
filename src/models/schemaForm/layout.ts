// How "All settings" is laid out: grouped by the task someone came to do, not by the shape of the config file. Every
// property is on exactly one screen (layout.test.ts fails otherwise); a section the schema adds later shows at the end
// of "Engine and operator settings" until it is placed here. Pure: no React, no network.
import type { Path } from '../../types/studio';

/** One screen of the form: a whole top-level section, or part of one (`only`: the sub-sections it shows). */
export interface FormView {
  id: string;
  key: string;
  label: string;
  only?: string[];
  group?: string;
}

export interface FormGroup {
  id: string;
  label: string;
  short?: string;
  advanced?: boolean;
  views: FormView[];
}

const view = (key: string, label: string, extra: { only?: string[] } = {}): FormView => ({
  id: extra.only ? `${key}.${extra.only.join('+')}` : key,
  key,
  label,
  ...extra,
});

export const LAYOUT: FormGroup[] = [
  { id: 'about', label: 'About this agent', short: 'About', views: [view('meta', 'Name and details'), view('persona', 'Personality and rules')] },
  {
    id: 'talks',
    label: 'How it talks',
    views: [
      view('messages', 'Fixed lines'),
      view('defaults', 'Language', { only: ['language'] }),
      view('defaults', 'AI models', { only: ['models'] }),
      view('defaults', 'Conversation flow', { only: ['conversation'] }),
    ],
  },
  {
    id: 'does',
    label: 'What it can do',
    views: [
      view('tools', 'Tools'),
      view('knowledge', 'Knowledge'),
      view('forms', 'Forms'),
      view('notifications', 'Messages it sends'),
      view('tasks', 'Multi-step tasks'),
      view('connections', 'Connections'),
    ],
  },
  {
    id: 'behaves',
    label: 'How it behaves',
    views: [
      view('agents', 'Agents'),
      view('guardrails', 'Safety rules'),
      view('schedules', 'Business hours'),
      view('events', 'Events'),
      view('state', 'Things it remembers'),
    ],
  },
  {
    id: 'where',
    label: 'Where it is available',
    short: 'Availability',
    views: [view('channels', 'Channels'), view('telephony', 'Phone transfers'), view('identity', 'Caller identity')],
  },
  { id: 'after', label: 'After the call', views: [view('post_call', 'Summary, recording and saved files'), view('wrapups', 'Closing messages')] },
  { id: 'quality', label: 'Quality and records', short: 'Quality', views: [view('tests', 'Test scenarios'), view('observability', 'Call records and logs')] },
  {
    id: 'engine',
    label: 'Engine and operator settings',
    short: 'Advanced',
    advanced: true,
    views: [
      view('runtime', 'Engine'),
      view('defaults', 'Reliability', { only: ['reliability'] }),
      view('constants', 'Fixed values'),
      view('builder', 'Studio notes'),
    ],
  },
];

export const SKIPPED_SECTIONS = new Set(['$schema', 'schema_version']);
export const FIRST_GROUP = 'about';

// What a settings screen says it is for, when the schema's own words (technical, or missing) are not the right lead.
export const VIEW_NOTES: Record<string, string> = {
  runtime:
    'How the voice engine runs this agent. The worker settings and the dispatch name are not read by the runtime (the worker takes its values from the server’s environment), so changing them here changes nothing.',
  builder: 'Notes for the studio and its linter. The runtime ignores this section.',
  constants: 'Values that never change, which you can use in what the agent says.',
};

const readable = (key: string) => key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * The groups for a schema: LAYOUT's screens that exist in it, plus a screen for each unclaimed part of a split section
 * and each unknown section.
 *   sectionKeys: the schema's top-level section names
 *   subkeys(key): the property names inside a section's object
 */
export function layoutFor(sectionKeys: string[], subkeys: (key: string) => string[] = () => []): FormGroup[] {
  const present = new Set(sectionKeys);
  const groups: FormGroup[] = LAYOUT.map((group) => ({
    ...group,
    views: group.views.filter((v) => present.has(v.key)).map((v) => ({ ...v, group: group.id })),
  }));
  // parts of a split section that no screen shows
  const claimed = new Map<string, string[]>();
  groups.forEach((group) =>
    group.views.forEach((v) => {
      if (v.only) claimed.set(v.key, [...(claimed.get(v.key) || []), ...v.only]);
    }),
  );
  const engine = groups.find((g) => g.id === 'engine') as FormGroup;
  const extra: FormView[] = [];
  claimed.forEach((taken, key) => {
    const rest = subkeys(key).filter((name) => !taken.includes(name));
    if (rest.length) extra.push({ ...view(key, 'Other defaults', { only: rest }), group: engine.id });
  });
  // sections nobody placed
  const placed = new Set(LAYOUT.flatMap((g) => g.views.map((v) => v.key)));
  sectionKeys
    .filter((key) => !placed.has(key) && !SKIPPED_SECTIONS.has(key))
    .forEach((key) => extra.push({ ...view(key, readable(key)), group: engine.id }));
  engine.views = [...engine.views, ...extra];
  return groups.filter((group) => group.views.length);
}

/** The screen a path (['defaults', 'conversation', 'inactivity']) lives on. */
export function viewForPath(groups: FormGroup[], path: Path | null | undefined): FormView | null {
  const [key, sub] = path || [];
  const views = groups.flatMap((g) => g.views);
  return views.find((v) => v.key === key && (!v.only || v.only.includes(String(sub)))) || views.find((v) => v.key === key) || null;
}

export const viewById = (groups: FormGroup[], id: string | null | undefined): FormView | null =>
  groups.flatMap((g) => g.views).find((v) => v.id === id) || null;
