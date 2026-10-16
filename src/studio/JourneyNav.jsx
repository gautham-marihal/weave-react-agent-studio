import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';
import { STAGES, nextStep, stageOf } from './journey.js';
import { navigate, routeHref } from './route.js';
import './journey.css';
import './agentRail.css';

const STAGE_ICONS = { build: 'build', test: 'test', release: 'release', monitor: 'monitor' };
// the picture beside each tab, shown only when the sidebar is folded to icons
const TAB_ICONS = { describe: 'sparkle', config: 'sliders', workflow: 'subagent', knowledge: 'records', test: 'test', scenarios: 'flag', checks: 'check', versions: 'copy', deploy: 'release', calls: 'phone' };

// The agent's tabs, grouped into the four stages of its life: build it, test it, release it, watch it. Each stage says what question it answers; the one
// you are in is marked. Every tab is still one click away and every link to a tab still works; the grouping only shows where each belongs.
// Inside an agent the dashboard's sidebar shows this menu (its #agentNavSlot), like the agent's own menu in a product built around one agent at a time;
// where there is no such slot (a narrow window, a test) it is drawn above the page.
export default function JourneyNav(props) {
  const [slot, setSlot] = useState(null);
  // only while the sidebar is on screen (it is hidden on a narrow window, where the menu stays above the page)
  useLayoutEffect(() => {
    const wide = window.matchMedia ? window.matchMedia('(min-width: 901px)') : { matches: true, addEventListener() {}, removeEventListener() {} };
    const pick = () => setSlot(wide.matches ? document.getElementById('agentNavSlot') : null);
    pick();
    wide.addEventListener?.('change', pick);
    return () => wide.removeEventListener?.('change', pick);
  }, []);
  const menu = <StageMenu {...props} />;
  return slot ? createPortal(menu, slot) : menu;
}

function StageMenu({ botId, tab, live }) {
  const current = stageOf(tab);
  return (
    <nav className="stTabs stJourney" aria-label="Agent sections">
      {STAGES.map((stage, index) => (
        <div key={stage.id} className={`stStage ${stage.id === current.id ? 'current' : ''}`} role="group" aria-label={`${stage.label}: ${stage.question}`} title={stage.question} data-stage={stage.id}>
          <span className="stStageHead"><Icon name={STAGE_ICONS[stage.id]} size={15} /><b>{index + 1}. {stage.label}</b><small>{stage.question}</small></span>
          <div className="stStageTabs">
            {stage.tabs.map(([id, label]) => (
              <button key={id} type="button" title={label} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(routeHref(botId, id), { guard: false })}>
                <span className="stTabIcon" aria-hidden="true"><Icon name={TAB_ICONS[id] || 'build'} size={18} /></span><span className="stTabLabel">{label}</span>{id === 'test' && live && <i className="stTLiveDot" title="A test conversation is running" />}
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
