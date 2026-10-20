// The pages of an agent in the new layout, and how they relate to the tabs of the classic one. One level: a menu of what the agent has, in the order the work
// is done: an overview, then building it, testing and launching it, watching it, and its settings last. Every old address still works (#/bots/x/deploy,
// /scenarios, /versions...): the new layout reads it and shows the page that now holds that tab, and the classic layout reads the new addresses and shows the
// tab that comes closest. Pure: no React, no DOM.
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
      { id: 'cost', label: 'Cost and speed', icon: 'gauge' },
    ],
  },
  { id: 'manage', label: 'Settings', bare: true, pages: [{ id: 'settings', label: 'Settings', icon: 'sliders' }] },
];

export const PAGES = PAGE_GROUPS.flatMap((g) => g.pages);
export const PAGE_IDS = PAGES.map((p) => p.id);
export const PAGE_LABELS = Object.fromEntries(PAGES.map((p) => [p.id, p.label]));
// The addresses only the new layout has; route.js accepts them beside the classic tabs.
export const EXTRA_PAGE_IDS = ['home', 'agent', 'tools', 'channels', 'guardrails', 'aftercall', 'settings', 'tests', 'releases', 'monitoring', 'callers'];

// A classic tab (or a new page) → the page that shows it, and which part of that page (`part`) when the page has several.
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
};
export function resolvePage(tab, { bare = false } = {}) {
  if (bare) return { page: 'home' };
  if (PAGE_IDS.includes(tab)) return { page: tab };
  return SHOWN_BY[tab] || { page: 'agent' };
}

// The address segment for a page and one of its parts (the address of a part stays the classic tab's, so old links and new ones are the same).
const PART_TAB = { tests: { try: 'test', scenarios: 'scenarios', checks: 'checks', callers: 'callers' }, releases: { versions: 'versions', deploy: 'deploy' } };
export const tabFor = (page, part) => (PART_TAB[page] && PART_TAB[page][part]) || page;

// The classic tab nearest to a page, for someone who switches back.
const CLASSIC_TAB = {
  home: 'config',
  agent: 'config',
  tools: 'config',
  channels: 'config',
  guardrails: 'config',
  aftercall: 'config',
  settings: 'config',
  tests: 'test',
  callers: 'scenarios',
  releases: 'versions',
  monitoring: 'calls',
};
export const classicTab = (tab) => CLASSIC_TAB[tab] || tab;

// Which top-level sections of the configuration each page edits, so that every part of the schema is reachable from somewhere (a test checks it against
// the schema). `only` is what the page's settings form is limited to; the Agent page's rows and the Workflow canvas cover their own sections as well.
export const PAGE_SECTIONS = {
  agent: ['meta', 'persona', 'messages', 'defaults'],
  tools: ['tools', 'connections', 'forms', 'notifications', 'tasks'],
  knowledge: ['knowledge'],
  workflow: ['agents', 'state', 'events'],
  channels: ['channels', 'telephony', 'identity', 'schedules'],
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
  cost: 'What a call costs, where the money and the time go, and what another model would cost.',
  questions: 'What callers asked that it couldn’t answer, grouped however they put it. Answer one in a sentence and it goes into the draft, with a test.',
};

// Where a place in the configuration (a path such as ['defaults', 'models', 'tts', 'voice_id']) is edited in the new layout: the page, and the panel of the
// Agent page that holds it when it is one of its rows. Used for "show me" on a problem.
export function locate(path) {
  const [key, sub, third, fourth] = Array.isArray(path) ? path : [];
  if (key === 'persona') return { page: 'agent', drawer: 'persona' };
  if (key === 'messages') return { page: 'agent', drawer: 'messages' };
  // what the Agent page asks for (the main and spoken languages; each model's provider and model; the voice); the rest of `defaults` is on Settings
  if (key === 'defaults' && sub === 'language')
    return ['primary', 'speaks', undefined].includes(third) ? { page: 'agent', drawer: 'language' } : { page: 'settings' };
  if (key === 'defaults' && sub === 'models') {
    if (third === 'tts' && fourth === 'voice_id') return { page: 'agent', drawer: 'voice' };
    return ['stt', 'llm', 'tts'].includes(third) && [undefined, 'provider', 'model'].includes(fourth)
      ? { page: 'agent', drawer: 'models' }
      : { page: 'settings' };
  }
  if (key === 'defaults') return { page: 'settings' };
  if (key === 'meta' && sub === 'name') return { page: 'agent' };
  if (key === 'tests') return { page: 'tests', part: 'scenarios' };
  const page = Object.keys(PAGE_SECTIONS).find((id) => id !== 'agent' && PAGE_SECTIONS[id].includes(key));
  return { page: page || 'settings' };
}
