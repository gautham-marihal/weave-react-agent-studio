import React from 'react';
import Icon from '../ui/Icon.jsx';
import { STAGES, nextStep, stageOf } from './journey.js';
import { navigate, routeHref } from './route.js';
import './journey.css';

const STAGE_ICONS = { build: 'build', test: 'test', release: 'release', monitor: 'monitor' };

// The agent's tabs, grouped into the four stages of its life: build it, test it, release it, watch it. Each stage says what question it answers; the one
// you are in is marked. Every tab is still one click away and every link to a tab still works; the grouping only shows where each belongs.
export default function JourneyNav({ botId, tab, live }) {
  const current = stageOf(tab);
  return (
    <nav className="stTabs stJourney" aria-label="Agent sections">
      {STAGES.map((stage, index) => (
        <div key={stage.id} className={`stStage ${stage.id === current.id ? 'current' : ''}`} role="group" aria-label={`${stage.label}: ${stage.question}`} title={stage.question} data-stage={stage.id}>
          <span className="stStageHead"><Icon name={STAGE_ICONS[stage.id]} size={15} /><b>{index + 1}. {stage.label}</b><small>{stage.question}</small></span>
          <div className="stStageTabs">
            {stage.tabs.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(routeHref(botId, id), { guard: false })}>
                {label}{id === 'test' && live && <i className="stTLiveDot" title="A test conversation is running" />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// "Next: Test it →" at the bottom of every tab, so the path from building to watching can be walked with this button alone and nobody is left asking
// "what now?". The last stop says so and offers the way back.
export function NextBar({ botId, tab }) {
  const step = nextStep(tab);
  const go = (to) => navigate(routeHref(botId, to), { guard: false });
  if (!step) {
    return (
      <footer className="stNext end" aria-label="Next step">
        <div><small>That is the whole path</small><strong>Watching how it does</strong><span>Change something, and the path starts again from Build.</span></div>
        <button type="button" className="quietButton" onClick={() => go('config')}>Back to Config</button>
      </footer>
    );
  }
  return (
    <footer className="stNext" aria-label="Next step">
      <div><small>Next</small><strong>{step.label}</strong><span>{step.then}</span></div>
      <button type="button" className="primaryCta compactCta" onClick={() => go(step.tab)}>Next: {step.label} <Icon name="arrowRight" size={15} /></button>
    </footer>
  );
}
