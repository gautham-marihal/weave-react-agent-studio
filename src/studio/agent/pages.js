import { SHOWN, matchScore } from '../../ui/match.ts';

// An agent's pages, in the order the work is done (overview, build, test and launch, watch, settings). Old addresses
// (#/bots/x/deploy, /scenarios...) open the page that now holds them. Pure: no React, no DOM.
//   bare: a group drawn without a heading (the overview at the top, the settings at the bottom)

export const PAGE_GROUPS = [
  { id: 'overview', label: 'Overview', bare: true, pages: [{ id: 'home', label: 'Overview', icon: 'home' }] },
  {
    id: 'build',
    label: 'Build',
    // the parts of Build › Detailed, in the order the design numbers them (1 Agent … 10 After the call; 11 is Settings)
    pages: [
      { id: 'agent', label: 'Agent', icon: 'agent' },
      { id: 'conversation', label: 'Conversation', icon: 'chat' },
      { id: 'knowledge', label: 'Knowledge', icon: 'records' },
      { id: 'tools', label: 'Tools', icon: 'tools' },
      { id: 'connections', label: 'Connections', icon: 'plug' },
      { id: 'channels', label: 'Channels', icon: 'dial' },
      { id: 'media', label: 'Images & Videos', icon: 'image' },
      { id: 'workflow', label: 'Workflow', icon: 'workflow' },
      { id: 'subagents', label: 'Subagents and hand-overs', icon: 'team' },
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
  // the rest of Settings, once everything else moved to the part it changes (its address stays /settings)
  { id: 'manage', label: 'Settings', bare: true, pages: [{ id: 'settings', label: 'Engine and details', icon: 'sliders' }] },
];

export const PAGES = PAGE_GROUPS.flatMap((g) => g.pages);

// The stage tabs across an agent's top, with the pages each holds; the first opens when its tab is chosen. Build opens
// on its guided view ("build", every part on one page).
export const STAGES = [
  { id: 'overview', label: 'Overview', pages: ['home'] },
  {
    id: 'build',
    label: 'Build',
    pages: [
      'build',
      'agent',
      'conversation',
      'knowledge',
      'tools',
      'connections',
      'channels',
      'media',
      'workflow',
      'subagents',
      'guardrails',
      'aftercall',
      'settings',
    ],
  },
  { id: 'test', label: 'Test', pages: ['tests'] },
  { id: 'release', label: 'Release', pages: ['releases'] },
  { id: 'monitor', label: 'Monitor', pages: ['calls', 'monitoring', 'questions', 'speed'] },
];
// The stage a page belongs to (null for one in no stage: the guided setup)
export const stageOf = (page) => STAGES.find((stage) => stage.pages.includes(page)) || null;
export const PAGE_IDS = PAGES.map((p) => p.id);
// the guided setup has an address but isn't in the menu: while it is open, the menu shows its steps instead
export const PAGE_LABELS = { ...Object.fromEntries(PAGES.map((p) => [p.id, p.label])), setup: 'Set up', build: 'Build' };
// The addresses of the agent's own pages; route.js accepts them beside the old ones (journey.js).
export const EXTRA_PAGE_IDS = [
  'home',
  'build',
  'agent',
  'conversation',
  'tools',
  'connections',
  'channels',
  'media',
  'subagents',
  'guardrails',
  'aftercall',
  'settings',
  'tests',
  'releases',
  'monitoring',
  'callers',
  'setup',
];

// An address (old or current) → the page that shows it, and its `part` when the page has several.
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
  build: { page: 'build' },
};
export function resolvePage(tab, { bare = false } = {}) {
  if (bare) return { page: 'home' };
  if (PAGE_IDS.includes(tab)) return { page: tab };
  return SHOWN_BY[tab] || { page: 'agent' };
}

// The address segment for a page's part (each part keeps its old address, so old links still open it).
const PART_TAB = { tests: { try: 'test', scenarios: 'scenarios', checks: 'checks', callers: 'callers' }, releases: { versions: 'versions', deploy: 'deploy' } };
export const tabFor = (page, part) => (PART_TAB[page] && PART_TAB[page][part]) || page;

// The top-level config sections each page edits, so every part of the schema is reachable (a test checks this).
// `only` limits the page's settings form; the Agent page's rows and the Workflow canvas cover their own sections too.
// Key order matters to `locate`: the first page (after the Agent page) whose list has the key is where it is shown.
export const PAGE_SECTIONS = {
  agent: ['meta', 'persona', 'messages', 'defaults'],
  conversation: ['state', 'events'],
  tools: ['tools'],
  connections: ['connections', 'forms', 'notifications', 'tasks', 'telephony'],
  knowledge: ['knowledge'],
  subagents: ['agents'],
  workflow: ['agents'],
  channels: ['channels', 'identity', 'schedules'],
  guardrails: ['guardrails'],
  aftercall: ['post_call', 'wrapups', 'observability'],
  tests: ['tests'],
  settings: ['meta', 'runtime', 'constants', 'builder', 'defaults', 'observability'],
};

export const sectionsCovered = () => new Set(Object.values(PAGE_SECTIONS).flat());

// What each page is for, in a sentence, under its title.
export const PAGE_LEAD = {
  conversation: 'How it behaves during a call: taking turns, silences, what it remembers and reacts to.',
  tools: 'What the agent can do besides talk: look something up, hand over to a person, end the call.',
  connections: 'What its tools reach: connections, phone transfers, forms, messages and multi-step tasks.',
  media: 'Photos and the camera: where customers can send them, what it asks for, how picky the checks are and what happens to the pictures.',
  subagents: 'Who answers, what each subagent does, and who passes callers to whom.',
  knowledge: 'The documents and sources the agent can look things up in.',
  workflow: 'Who answers first, and how a call moves from one agent to another.',
  channels: 'Where people reach the agent, and when.',
  guardrails: 'Boundaries for what the agent will say and do.',
  aftercall: 'What happens when a call ends: the summary, the closing message, what is kept.',
  settings: 'What runs it underneath: its version and status, the engine, fixed values and the studio’s own checks.',
  tests: 'Check that the agent behaves: try it, run the conversations it must always get right, and run the readiness checks.',
  releases: 'Publish a version, and choose what is live where.',
  calls: 'Every conversation this agent has had.',
  monitoring: 'How this agent is doing, from its calls.',
  speed: 'How fast the agent answers, and where the time goes.',
  questions: 'What callers asked that it couldn’t answer, grouped however they put it. Answer one in a sentence and it goes into the draft, with a test.',
};

// Where a config path is edited: the page, the Agent page panel (`drawer`) if it is one of its rows, and the field
// (`focus`) if it is asked above a page's form. Used for "show me" on a problem.
export function locate(path) {
  const [key, sub, third, fourth] = Array.isArray(path) ? path : [];
  // the recording disclosure lives beside the recording settings (After the call); tone and style rules have their own
  // panel; the Personality panel leaves all three out
  if (key === 'persona' && sub === 'disclosures') return { page: 'aftercall', focus: 'notice' };
  if (key === 'persona' && (sub === 'tone' || sub === 'style_rules')) return { page: 'agent', drawer: 'behaviour' };
  if (key === 'persona') return { page: 'agent', drawer: 'persona' };
  if (key === 'messages') return { page: 'agent', drawer: 'messages' };
  // each channel's first words are the Agent page's field (the channel panel leaves them out); the rest stays there
  if (key === 'channels' && sub !== undefined && third === 'greeting' && fourth === 'say') return { page: 'agent', focus: 'greeting' };
  // language, each model's provider and model, and the voice are on the Agent page; other `defaults` are on Settings
  if (key === 'defaults' && sub === 'language') return { page: 'agent', drawer: 'language' };
  if (key === 'defaults' && sub === 'models') {
    if (third === 'tts' && fourth === 'voice_id') return { page: 'agent', drawer: 'voice' };
    // voice detection and the end-of-turn model are part of taking turns
    if (third === 'vad' || third === 'turn_detector') return { page: 'conversation' };
    // the models as a whole ("Open Models") are the AI models row; a model's other settings are rows of their own
    return third === undefined || (['stt', 'llm', 'tts'].includes(third) && [undefined, 'provider', 'model'].includes(fourth))
      ? { page: 'agent', drawer: 'models' }
      : { page: 'agent' };
  }
  // taking turns, silences, sounds and failing services are the Conversation part
  if (key === 'defaults' && (sub === 'conversation' || sub === 'reliability')) return { page: 'conversation' };
  if (key === 'defaults') return { page: 'settings' };
  // the name, description, tags and owner are the Agent part's; the rest of `meta` is Engine and details
  if (key === 'meta' && ['name', 'description', 'tags', 'owner'].includes(sub)) return { page: 'agent' };
  // how many times a call may move between agents is asked with the hand-overs
  if (key === 'guardrails' && sub === 'limits' && third === 'max_handoffs_per_call') return { page: 'subagents' };
  // the log of each call and what it holds are After the call's; metrics, the log level, tracing and the export are
  // Engine and details', beside the rest of the logging
  if (key === 'observability' && ['metrics', 'log_level', 'tracing', 'otel', 'log_file'].includes(sub)) return { page: 'settings' };
  // photos, the camera and their details on a way in, and how an agent sees pictures, are Images & Videos'
  if (key === 'channels' && sub !== undefined && third === 'inputs') return { page: 'media' };
  if (key === 'agents' && sub === 'items' && fourth === 'vision') return { page: 'media' };
  if (key === 'tests') return { page: 'tests', part: 'scenarios' };
  const page = Object.keys(PAGE_SECTIONS).find((id) => id !== 'agent' && PAGE_SECTIONS[id].includes(key));
  return { page: page || 'settings' };
}

// ---- the search (Ctrl K) on an agent's pages
// The panels of the Agent page, by the id `locate` gives, as the page names them.
const AGENT_PANELS = {
  voice: 'Voice and language',
  language: 'Voice and language',
  models: 'AI models',
  behaviour: 'What it says',
  persona: 'Name and introduction',
  messages: 'What it says',
};

// Where a search result is shown: `locate` for its openable path, or the Agent page field for greeting and role.
// The role is that field only with one agent; with several it is chosen in the Workflow's settings.
//   entry: { trail, jump } from the settings index (settingsSearch.js)
//   config: the draft, when known
export function searchTarget({ trail = [], jump = [] } = {}, config = null) {
  const t = Array.isArray(trail) ? trail : [];
  const several = Array.isArray(config?.agents?.items) && config.agents.items.length > 1;
  const greeting = t.indexOf('greeting');
  if (t[0] === 'channels' && greeting > 0 && [undefined, 'say'].includes(t[greeting + 1])) return { page: 'agent', focus: 'greeting', path: ['channels'] };
  if (t[0] === 'agents' && t.includes('instructions') && t.at(-1) === 'role' && !several) return { page: 'agent', focus: 'role', path: ['agents'] };
  const path = Array.isArray(jump) && jump.length ? jump : t.slice(0, 1);
  return { ...locate(path), path };
}

// The fields `focus` names, as their page names them (the notice is in After the call's Recording card).
const FIELD_NAMES = { greeting: 'What it says first', role: 'What it should do', notice: 'Recording' };

// Where a setting lives, in the pages' own words ("Channels › Business hours › Opening times", "Agent › Voice"). Agent
// page panels and fields stop at the page's own name for them.
//   entry: { trail, jump, screen: { label }, crumbs } from the settings index
export function settingWhere(entry = {}) {
  const target = searchTarget(entry);
  const page = PAGE_LABELS[target.page] || 'Settings';
  if (target.focus) return `${page} › ${FIELD_NAMES[target.focus]}`;
  if (target.drawer) return `${page} › ${AGENT_PANELS[target.drawer] || 'Settings'}`;
  const parts = [page, entry.screen?.label || '', ...(Array.isArray(entry.crumbs) ? entry.crumbs : [])].filter(Boolean);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(' › ');
}

// A setting found in many places under one name (Business hours in every task) is shown at most `max` times, best
// first, so other results still fit in the list.
export function capSameLabel(entries, max = 2) {
  const seen = new Map();
  return entries.filter((entry) => {
    const n = (seen.get(entry.label) || 0) + 1;
    seen.set(entry.label, n);
    return n <= max;
  });
}

// The words people would type to find each page, besides its name.
const PAGE_WORDS = {
  home: 'overview home dashboard status ready next',
  agent: 'instructions prompt role greeting hello voice language model persona name tone description tags owner',
  conversation: 'turns interrupt interruption silence quiet nudge pronunciation sounds variables state events reliability',
  connections: 'connection api transfer phone forms messages sms email tasks verification',
  subagents: 'subagent agents hand over handover hand-off transfer specialist multi entry first',
  knowledge: 'documents files faq website pages answers sources',
  tools: 'actions abilities lookup hand over end call integrations api forms connections',
  workflow: 'agents handover hand-off canvas flow specialist multi',
  channels: 'phone chat website widget reach business hours opening hours whatsapp sms',
  media: 'pictures picture photos photo images image videos camera video upload library sample card id identity verification kyc face sharpness',
  guardrails: 'safety block blocked topics rules limits',
  aftercall: 'summary recording redaction wrap up analysis',
  tests: 'try scenarios checks simulated callers',
  releases: 'publish deploy versions live rollback roll back',
  calls: 'conversations history transcripts recordings',
  monitoring: 'health dashboard stats handoffs cut off',
  questions: 'unanswered gaps asked faq',
  speed: 'latency slow fast answer time',
  settings: 'engine version status environment constants fixed values json runtime',
};

// What search offers on an agent besides settings: its pages and common tasks, by the words people would type.
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

// AGENT_SEARCH entries matching the query (fuzzy, ui/match.ts) on title or words, not the description, which also says
// what a page is NOT for. Ranked: title starts with it, title has it, tasks, pages. With nothing typed, the pages.
export function searchAgent(query) {
  const phrase = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  if (!phrase) return AGENT_SEARCH.filter((item) => item.id.startsWith('page-'));
  const rank = (item) => {
    const title = item.title.toLowerCase();
    // a title match first; then a task before a page that is only where it is done
    return title.startsWith(phrase) ? 0 : title.includes(phrase) ? 1 : item.id.startsWith('page-') ? 3 : 2;
  };
  return AGENT_SEARCH.map((item, i) => ({ item, i, r: rank(item), score: matchScore(phrase, item.title, item.words) }))
    .filter((m) => m.score >= SHOWN)
    .sort((a, b) => a.r - b.r || b.score - a.score || a.i - b.i)
    .map(({ item }) => item);
}
