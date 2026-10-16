// The path an agent takes: build it, test it, release it, watch it. The tabs of an agent are grouped into these four stages, each with the question it
// answers, so a customer is never asked "what now?": every tab ends with a "Next" that leads to the following one. Nothing is moved out of reach; each
// old tab is still a tab, and every old link (#/bots/{id}/deploy) still opens it. Pure: no React, no DOM.

export const STAGES = [
  {
    id: 'build',
    label: 'Build',
    question: 'What is it, and what can it do?',
    tabs: [
      ['describe', 'Describe'],
      ['config', 'Config'],
      ['workflow', 'Workflow'],
      ['knowledge', 'Knowledge'],
    ],
  },
  {
    id: 'test',
    label: 'Test',
    question: 'Does it behave?',
    tabs: [
      ['test', 'Test'],
      ['scenarios', 'Scenarios'],
      ['checks', 'Checks'],
    ],
  },
  {
    id: 'release',
    label: 'Release',
    question: 'Is it safe to put live, and what is live where?',
    tabs: [
      ['versions', 'Versions'],
      ['deploy', 'Deploy'],
    ],
  },
  { id: 'monitor', label: 'Monitor', question: 'How is it doing?', tabs: [['calls', 'Calls']] },
];

export const TAB_IDS = STAGES.flatMap((s) => s.tabs.map(([id]) => id));
export const TAB_LABELS = Object.fromEntries(STAGES.flatMap((s) => s.tabs));

export const stageOf = (tab) => STAGES.find((s) => s.tabs.some(([id]) => id === tab)) || STAGES[0];

// One step forward from each tab, so the whole path can be walked by pressing "Next". `then` is what the step is for, in the customer's words.
export const NEXT = {
  describe: { tab: 'config', label: 'Review what it made', then: 'Read the settings it filled in, and change anything by hand.' },
  config: { tab: 'test', label: 'Test it', then: 'Talk to the agent and see how it answers.' },
  workflow: { tab: 'test', label: 'Test it', then: 'Talk to the agent and see the flow work.' },
  knowledge: { tab: 'test', label: 'Test it', then: 'Ask it a question your documents can answer.' },
  test: { tab: 'scenarios', label: 'Check it with scenarios', then: 'Write the conversations it must always get right, and run them.' },
  scenarios: { tab: 'checks', label: 'Run the readiness checks', then: 'Try the saved draft against everyday situations.' },
  checks: { tab: 'versions', label: 'Release it', then: 'Publish a version, a frozen copy you can put live.' },
  versions: { tab: 'deploy', label: 'Put it live', then: 'Choose where this version runs.' },
  deploy: { tab: 'calls', label: 'Watch how it does', then: 'See every call and what happened in it.' },
  calls: null,
};
export const nextStep = (tab) => (Object.prototype.hasOwnProperty.call(NEXT, tab) ? NEXT[tab] : NEXT.config);

// Whether every step of the journey can be reached from the first using only "Next" (a test relies on it).
export function walk(start = 'config') {
  const seen = [];
  let at = start;
  while (at && !seen.includes(at)) {
    seen.push(at);
    at = NEXT[at]?.tab;
  }
  return seen;
}

// Where an agent stands on the path, for the Home page: each stage done, needing attention, or still to do, and the one thing to do next. Built from what the
// agent list and its health already say; a stage nothing is known about stays "to do", never "done".
//   bot: { latest_version, deployed }   health: { state, parts: [{ id }] } or null   callCount: a number, or null when not read
export function journeyProgress({ bot, health = null, callCount = null } = {}) {
  const parts = Array.isArray(health?.parts) ? health.parts : [];
  const has = (id) => parts.some((p) => p.id === id);
  const published = !!bot?.latest_version;
  const live = !!(bot?.deployed && Object.values(bot.deployed).some(Boolean));
  const scenarios = health?.checked?.includes('tests');
  const stages = {
    build: has('invalid') ? 'attention' : health && health.state !== 'unknown' ? 'done' : 'todo',
    test: has('tests_failing') ? 'attention' : scenarios && !has('tests_not_run') ? 'done' : 'todo',
    release: published && live ? 'done' : 'todo',
    monitor: typeof callCount === 'number' && callCount > 0 ? 'done' : 'todo',
  };
  const order = ['build', 'test', 'release', 'monitor'];
  const current = order.find((id) => stages[id] !== 'done') || 'monitor';
  const next = {
    build: { tab: 'config', label: has('invalid') ? 'Fix what the checks found' : 'Finish building it' },
    test: { tab: has('tests_failing') ? 'scenarios' : 'test', label: has('tests_failing') ? 'See the tests that fail' : 'Test it' },
    release: { tab: published ? 'deploy' : 'versions', label: published ? 'Put it live' : 'Publish a version' },
    monitor: { tab: 'calls', label: stages.monitor === 'done' ? 'See how it is doing' : 'Watch for calls' },
  }[current];
  return {
    stages: order.map((id) => ({ id, state: stages[id], current: id === current && !(stages[id] === 'done') })),
    current,
    next,
    allDone: order.every((id) => stages[id] === 'done'),
  };
}
