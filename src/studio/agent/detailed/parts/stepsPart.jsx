import React from 'react';
import StepsWorkspace from '../stepsWorkspace/StepsWorkspace.jsx';

// Steps: the call, step by step (design: canvas "Build steps section"). It has no settings of its own: every step is
// read from and written to the place the agent already keeps it (stepsWorkspace/stepsModel.js), so it draws only its
// own workspace and adds no cards.
export const stepsPart = {
  id: 'steps',
  num: '8',
  title: 'Steps',
  question: 'What happens on a call, in order. Every time steps run exactly as written; guided steps are what the agent is told to do, in its own words.',
  cols: [[], []],
  render: (ctx) => <StepsWorkspace ctx={ctx} />,
};
