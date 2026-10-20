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
  {
    id: 'monitor',
    label: 'Monitor',
    question: 'How is it doing?',
    tabs: [
      ['calls', 'Calls'],
      ['questions', 'Questions'],
      ['cost', 'Cost and speed'],
    ],
  },
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
  cost: { tab: 'scenarios', label: 'Run the scenarios', then: 'After changing the model, check it still behaves.' },
  questions: { tab: 'scenarios', label: 'Run the scenarios', then: 'Check the answers you added, with the tests made from them.' },
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
