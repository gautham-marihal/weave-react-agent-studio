// The pages of an agent. One level: a menu of what the agent has, in the order the work is done: an overview, then building it, testing and launching it,
// watching it, and its settings last. Every old address still works (#/bots/x/deploy, /scenarios, /versions...): it opens the page that now holds it.
// Pure: no React, no DOM.
//   `bare`: a group drawn without a heading (the overview at the top, the settings at the bottom)

export const PAGE_GROUPS = [
  { id: 'overview', label: 'Overview', bare: true, pages: [{ id: 'home', label: 'Overview', icon: 'home' }] },
  {
    id: 'build',
    label: 'Build',
    pages: [
      { id: 'agent', label: 'Agent', icon: 'agent' },
      { id: 'knowledge', label: 'Knowledge', icon: 'records' },
      { id: 'tools', label: 'Tools', icon: 'tools' },
      { id: 'workflow', label: 'Workflow', icon: 'subagent' },
      { id: 'channels', label: 'Channels', icon: 'dial' },
      { id: 'guardrails', label: 'Guardrails', icon: 'shield' },
      { id: 'aftercall', label: 'After the call', icon: 'flag' },
    ],
  },
  {
    id: 'launch',
    label: 'Test and launch',
    pages: [
      { id: 'tests', label: 'Tests', icon: 'test' },
      { id: 'releases', label: 'Releases', icon: 'release' },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    pages: [
      { id: 'calls', label: 'Calls', icon: 'phone' },
      { id: 'monitoring', label: 'Monitoring', icon: 'monitor' },
      { id: 'questions', label: 'Questions', icon: 'help' },
      { id: 'speed', label: 'Speed', icon: 'gauge' },
    ],
  },
  { id: 'manage', label: 'Settings', bare: true, pages: [{ id: 'settings', label: 'Settings', icon: 'sliders' }] },
];

export const PAGES = PAGE_GROUPS.flatMap((g) => g.pages);
export const PAGE_IDS = PAGES.map((p) => p.id);
// (the guided setup is a page with an address, and not in the menu: while it is open the menu shows its steps instead)
export const PAGE_LABELS = { ...Object.fromEntries(PAGES.map((p) => [p.id, p.label])), setup: 'Set up' };
// The addresses of the agent's own pages; route.js accepts them beside the old ones (journey.js).
export const EXTRA_PAGE_IDS = [
  'home',
  'agent',
  'tools',
  'channels',
  'guardrails',
  'aftercall',
  'settings',
  'tests',
  'releases',
  'monitoring',
  'callers',
  'setup',
];

// An old address (or a page's own) → the page that shows it, and which part of that page (`part`) when the page has several.
const SHOWN_BY = {
  describe: { page: 'agent', drawer: 'describe' },
  config: { page: 'agent' },
  workflow: { page: 'workflow' },
  knowledge: { page: 'knowledge' },
  test: { page: 'tests', part: 'try' },
  scenarios: { page: 'tests', part: 'scenarios' },
  checks: { page: 'tests', part: 'checks' },
  callers: { page: 'tests', part: 'callers' },
  versions: { page: 'releases', part: 'versions' },
  deploy: { page: 'releases', part: 'deploy' },
  calls: { page: 'calls' },
  setup: { page: 'setup' },
};
export function resolvePage(tab, { bare = false } = {}) {
  if (bare) return { page: 'home' };
  if (PAGE_IDS.includes(tab)) return { page: tab };
  return SHOWN_BY[tab] || { page: 'agent' };
}

// The address segment for a page and one of its parts (a part keeps the address it always had, so old links still open it).
const PART_TAB = { tests: { try: 'test', scenarios: 'scenarios', checks: 'checks', callers: 'callers' }, releases: { versions: 'versions', deploy: 'deploy' } };
export const tabFor = (page, part) => (PART_TAB[page] && PART_TAB[page][part]) || page;

// Which top-level sections of the configuration each page edits, so that every part of the schema is reachable from somewhere (a test checks it against
// the schema). `only` is what the page's settings form is limited to; the Agent page's rows and the Workflow canvas cover their own sections as well.
export const PAGE_SECTIONS = {
  agent: ['meta', 'persona', 'messages', 'defaults'],
  tools: ['tools', 'connections', 'forms', 'notifications', 'tasks', 'telephony'],
  knowledge: ['knowledge'],
  workflow: ['agents', 'state', 'events'],
  channels: ['channels', 'identity', 'schedules'],
  guardrails: ['guardrails'],
  aftercall: ['post_call', 'wrapups', 'observability'],
  tests: ['tests'],
  settings: ['meta', 'runtime', 'constants', 'builder', 'defaults'],
};

// What the Settings page leaves out of its form because another page already asks for it (the name, the languages, the provider, model and voice of each
// part of a call; the test scenarios are not in its sections at all): a person is asked for each thing once. What is left is what only Settings has: the description, tags and owner, the
// keys and addresses of the models, how turns are taken, the engine.
export const SETTINGS_ELSEWHERE = {
  skipViews: ['defaults.language'], // all of the language is asked on the Agent page
  hide: [
    ['meta', 'name'],
    ...['stt', 'llm', 'tts'].flatMap((stage) => [
      ['defaults', 'models', stage, 'provider'],
      ['defaults', 'models', stage, 'model'],
    ]),
    ['defaults', 'models', 'tts', 'voice_id'],
  ],
};
export const sectionsCovered = () => new Set(Object.values(PAGE_SECTIONS).flat());

// What each page is for, in a sentence, under its title.
export const PAGE_LEAD = {
  tools: 'What the agent can do besides talk: look something up, hand over to a person, end the call.',
  knowledge: 'The documents and sources the agent can look things up in.',
  workflow: 'Who answers first, and how a call moves from one agent to another.',
  channels: 'Where people reach the agent, and when.',
  guardrails: 'Boundaries for what the agent will say and do.',
  aftercall: 'What happens when a call ends: the summary, the closing message, what is kept.',
  settings:
    'The rest of the agent’s configuration: its description and owner, the keys and addresses of its models, how turns are taken, the engine. Its name, languages, models and voice are on the Agent page.',
  tests: 'Check that the agent behaves: try it, run the conversations it must always get right, and run the readiness checks.',
  releases: 'Publish a version, and choose what is live where.',
  calls: 'Every conversation this agent has had.',
  monitoring: 'How this agent is doing, from its calls.',
  speed: 'How fast the agent answers, and where the time goes.',
  questions: 'What callers asked that it couldn’t answer, grouped however they put it. Answer one in a sentence and it goes into the draft, with a test.',
};

// Where a place in the configuration (a path such as ['defaults', 'models', 'tts', 'voice_id']) is edited in the new layout: the page, the panel of the
// Agent page that holds it when it is one of its rows, and the field (`focus`) when it is one of the few asked above a page's form. Used for "show me" on
// a problem.
export function locate(path) {
  const [key, sub, third, fourth] = Array.isArray(path) ? path : [];
  // what callers are told about the recording is asked beside what is recorded (After the call › Recording); the tone and style rules have a panel of
  // their own; the Personality and rules panel leaves all three out
  if (key === 'persona' && sub === 'disclosures') return { page: 'aftercall', focus: 'notice' };
  if (key === 'persona' && (sub === 'tone' || sub === 'style_rules')) return { page: 'agent', drawer: 'behaviour' };
  if (key === 'persona') return { page: 'agent', drawer: 'persona' };
  if (key === 'messages') return { page: 'agent', drawer: 'messages' };
  // what each channel says first is the Agent page's field (a channel's panel leaves it out); the rest of the greeting stays with the channel
  if (key === 'channels' && sub !== undefined && third === 'greeting' && fourth === 'say') return { page: 'agent', focus: 'greeting' };
  // what the Agent page asks for (all of the language; each model's provider and model; the voice); the rest of `defaults` is on Settings
  if (key === 'defaults' && sub === 'language') return { page: 'agent', drawer: 'language' };
  if (key === 'defaults' && sub === 'models') {
    if (third === 'tts' && fourth === 'voice_id') return { page: 'agent', drawer: 'voice' };
    // the models as a whole ("Open Models") are the AI models panel too
    return third === undefined || (['stt', 'llm', 'tts'].includes(third) && [undefined, 'provider', 'model'].includes(fourth))
      ? { page: 'agent', drawer: 'models' }
      : { page: 'settings' };
  }
  if (key === 'defaults') return { page: 'settings' };
  if (key === 'meta' && sub === 'name') return { page: 'agent' };
  if (key === 'tests') return { page: 'tests', part: 'scenarios' };
  const page = Object.keys(PAGE_SECTIONS).find((id) => id !== 'agent' && PAGE_SECTIONS[id].includes(key));
  return { page: page || 'settings' };
}

// ---- the search (Ctrl K) on an agent's pages
// The panels of the Agent page, by the id `locate` gives, as the page names them.
const AGENT_PANELS = {
  voice: 'Voice',
  language: 'Language',
  models: 'AI models',
  behaviour: 'Tone and style',
  persona: 'Personality and rules',
  messages: 'Fixed lines',
};

// Where a setting the search found is shown: the place `locate` gives for the part of its path that can be opened, and, for the two settings that are
// fields of the Agent page (what it says first, and what it should do), that field. What an agent should do is the Agent page's field when the agent has
// one agent; with several, which agent is meant is chosen in the Workflow's settings. Whether the greeting may be interrupted stays with the channel.
//   entry: { trail, jump } from the settings index (src/studio/settingsSearch.js); config: the draft, when it is known
export function searchTarget({ trail = [], jump = [] } = {}, config = null) {
  const t = Array.isArray(trail) ? trail : [];
  const several = Array.isArray(config?.agents?.items) && config.agents.items.length > 1;
  const greeting = t.indexOf('greeting');
  if (t[0] === 'channels' && greeting > 0 && [undefined, 'say'].includes(t[greeting + 1])) return { page: 'agent', focus: 'greeting', path: ['channels'] };
  if (t[0] === 'agents' && t.includes('instructions') && t.at(-1) === 'role' && !several) return { page: 'agent', focus: 'role', path: ['agents'] };
  const path = Array.isArray(jump) && jump.length ? jump : t.slice(0, 1);
  return { ...locate(path), path };
}

// The fields `focus` names, as their page names them (the recording notice is a field of After the call's Recording card).
const FIELD_NAMES = { greeting: 'What it says first', role: 'What it should do', notice: 'Recording' };

// Where a setting lives, in the new layout's own words: "Channels › Business hours › Opening times", "Agent › Voice". A panel or field of the Agent page
// is named as the page names it, and nothing deeper (the panel shows it plainly).
//   entry: { trail, jump, screen: { label }, crumbs } from the settings index
export function settingWhere(entry = {}) {
  const target = searchTarget(entry);
  const page = PAGE_LABELS[target.page] || 'Settings';
  if (target.focus) return `${page} › ${FIELD_NAMES[target.focus]}`;
  if (target.drawer) return `${page} › ${AGENT_PANELS[target.drawer] || 'Settings'}`;
  const parts = [page, entry.screen?.label || '', ...(Array.isArray(entry.crumbs) ? entry.crumbs : [])].filter(Boolean);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(' › ');
}

// A setting found in many places under one name (Business hours as a condition in every task and transfer) is shown at most `max` times: the best matches,
// in the order the search ranked them, so the other settings it found still fit in the list.
export function capSameLabel(entries, max = 2) {
  const seen = new Map();
  return entries.filter((entry) => {
    const n = (seen.get(entry.label) || 0) + 1;
    seen.set(entry.label, n);
    return n <= max;
  });
}

// The words people use for each page, besides its name: what they would type to find it.
const PAGE_WORDS = {
  home: 'overview home dashboard status ready next',
  agent: 'instructions prompt role greeting hello voice language model persona name tone',
  knowledge: 'documents files faq website pages answers sources',
  tools: 'actions abilities lookup hand over end call integrations api forms connections',
  workflow: 'agents handover hand-off canvas flow specialist multi',
  channels: 'phone chat website widget reach business hours opening hours whatsapp sms',
  guardrails: 'safety block blocked topics rules limits',
  aftercall: 'summary recording redaction wrap up analysis',
  tests: 'try scenarios checks simulated callers',
  releases: 'publish deploy versions live rollback roll back',
  calls: 'conversations history transcripts recordings',
  monitoring: 'health dashboard stats handoffs cut off',
  questions: 'unanswered gaps asked faq',
  speed: 'latency slow fast answer time',
  settings: 'description owner tags engine keys json reliability',
};

// What the search offers on an agent besides its settings: its pages, and the things people come to do, by the words they would type.
//   { id, title, description, words, tab, params? }; the address is routeHref(botId, tab, params)
export const AGENT_SEARCH = [
  ...PAGES.map((p) => ({
    id: `page-${p.id}`,
    title: p.label,
    description: { home: 'How it is doing, and what to do next', agent: 'Who it is, what it should do, and how it sounds' }[p.id] || PAGE_LEAD[p.id] || '',
    words: PAGE_WORDS[p.id] || '',
    tab: p.id,
    icon: p.icon,
  })),
  {
    id: 'setup',
    title: 'Set it up step by step',
    description: 'The guided setup: what it does, where people reach it, its voice, what it knows and can do',
    words: 'wizard guide start onboarding',
    tab: 'setup',
    icon: 'sparkle',
  },
  { id: 'test', title: 'Test it', description: 'Talk to it the way a customer would', words: 'try chat preview talk call', tab: 'test', icon: 'test' },
  {
    id: 'publish',
    title: 'Publish a version',
    description: 'Freeze the saved draft as a version you can put live',
    words: 'release save version',
    tab: 'versions',
    params: { publish: '1' },
    icon: 'release',
  },
  {
    id: 'deploy',
    title: 'Put a version live',
    description: 'Choose which version people reach in Development, Staging and Production',
    words: 'deploy go live launch environment production staging development',
    tab: 'deploy',
    icon: 'release',
  },
  {
    id: 'rollback',
    title: 'Roll back',
    description: 'Put an earlier version live again',
    words: 'undo revert previous restore older',
    tab: 'deploy',
    icon: 'release',
  },
  {
    id: 'number',
    title: 'Add a phone number',
    description: 'The number callers dial to reach this agent',
    words: 'phone number dial telephony call line',
    tab: 'deploy',
    icon: 'dial',
  },
  {
    id: 'describe',
    title: 'Describe a change',
    description: 'Say in your own words what to change, and check it before it is applied',
    words: 'assistant ai write generate',
    tab: 'describe',
    icon: 'sparkle',
  },
];

// The entries of AGENT_SEARCH that match what was typed: every word in the title or the words people use (not the description, which also says what a
// page is NOT for). Those whose title starts with what was typed come first, then those whose title has it, then the things to do, then the pages, each
// in their own order.
// With nothing typed, the pages.
export function searchAgent(query) {
  const typed = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!typed.length) return AGENT_SEARCH.filter((item) => item.id.startsWith('page-'));
  const phrase = typed.join(' ');
  const rank = (item) => {
    const title = item.title.toLowerCase();
    // a match on the title first; then a thing to do before a page that is only where it is done
    return title.startsWith(phrase) ? 0 : title.includes(phrase) ? 1 : item.id.startsWith('page-') ? 3 : 2;
  };
  return AGENT_SEARCH.filter((item) => {
    const text = `${item.title} ${item.words}`.toLowerCase();
    return typed.every((word) => text.includes(word));
  })
    .map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ item }) => item);
}
