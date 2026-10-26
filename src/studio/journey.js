// The path an agent takes: build it, test it, release it, watch it, and the page addresses each step had (#/bots/{id}/deploy...). The agent's pages
// answer to every one of them, so an old link still opens the page that holds it. Pure: no React, no DOM.

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
      ['speed', 'Speed'],
    ],
  },
];

export const TAB_IDS = STAGES.flatMap((s) => s.tabs.map(([id]) => id));
