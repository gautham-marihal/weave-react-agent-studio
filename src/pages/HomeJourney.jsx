import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../ui/Icon.jsx';
import { STAGES, journeyProgress } from '../studio/journey.js';
import { useAgentHealth } from '../studio/health/useAgentHealth.js';
import { useAsync } from '../studio/useAsync.js';
import { agentState } from '../studio/status.js';

// Home's answer to "what now?": the agent you were last working on, where it stands on the path (build, test, release, monitor), and the one thing to do
// next. It replaces a checklist about the workspace, which a person finishes once, with the journey of an agent, which they repeat for every agent.
const LAST_KEY = 'weave_last_agent';
export const rememberAgent = (botId) => { try { localStorage.setItem(LAST_KEY, botId); } catch { /* storage unavailable */ } };
const lastAgent = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };

const STAGE_ICON = { build: 'build', test: 'test', release: 'release', monitor: 'monitor' };
const STATE_TEXT = { done: 'Done', attention: 'Needs attention', todo: 'To do' };

export default function HomeJourney({ bots, onOpenTab, onCreate }) {
  const loaded = Array.isArray(bots);
  const list = loaded ? bots : [];
  const remembered = lastAgent();
  const [chosen, setChosen] = useState('');
  const bot = useMemo(() => list.find((b) => b.id === chosen) || list.find((b) => b.id === remembered) || [...list].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] || null, [list, chosen, remembered]);
  const visible = useMemo(() => (bot ? [bot] : []), [bot]);
  const { meta } = useAgentHealth(visible);
  const health = bot ? meta[bot.id]?.health || null : null;
  const calls = useAsync((signal) => (bot ? api.listCalls(bot.id, { limit: 1 }, { signal }) : Promise.resolve(null)), [bot?.id]);
  const callCount = calls.data && Array.isArray(calls.data.calls) ? calls.data.calls.length : null;
  const progress = useMemo(() => journeyProgress({ bot, health, callCount }), [bot, health, callCount]);
  useEffect(() => { if (chosen && !list.some((b) => b.id === chosen)) setChosen(''); }, [list, chosen]);

  if (!loaded) return <section className="progressCard homeJourney" aria-label="Your next step"><p className="hjNote" role="status">Loading your agents…</p></section>;
  if (!bot) {
    return (
      <section className="progressCard homeJourney" aria-label="Your first step">
        <div className="hjHead"><span>Your first step</span></div>
        <h3>Create your first agent</h3>
        <p className="hjNote">An agent answers calls or chats for you. Pick a starting point, give it a name, and you will be talking to it in a few minutes.</p>
        <button type="button" className="primaryCta compactCta" onClick={onCreate}>Create an agent</button>
      </section>
    );
  }
  const state = agentState({ deployed: bot.deployed || {}, tests: progress.stages[1].state === 'done' ? 'passed' : progress.stages[1].state === 'attention' ? 'failed' : 'unknown', problems: progress.stages[0].state === 'attention' ? 1 : 0 });
  return (
    <section className="progressCard homeJourney" aria-label={`Where ${bot.name || bot.id} stands`}>
      <div className="hjHead">
        <span>{progress.allDone ? 'All steps done' : 'Your next step'}</span>
        {list.length > 1 && (
          <select className="stFInput small" aria-label="Which agent" value={bot.id} onChange={(event) => setChosen(event.target.value)}>
            {list.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
          </select>
        )}
      </div>
      <h3>{bot.name || bot.id} <span className={`hjState ${state.tone}`} title={state.hint}>{state.label}</span></h3>
      <ol className="hjStages">
        {STAGES.map((stage, index) => {
          const item = progress.stages[index];
          return (
            <li key={stage.id} className={`${item.state} ${item.current ? 'current' : ''}`} data-stage={stage.id} data-state={item.state}>
              <span className="hjIcon"><Icon name={item.state === 'done' ? 'check' : item.state === 'attention' ? 'alert' : STAGE_ICON[stage.id]} size={16} /></span>
              <span><strong>{stage.label}</strong><small>{item.current ? stage.question : STATE_TEXT[item.state]}</small></span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="primaryCta compactCta hjNext" onClick={() => onOpenTab(bot.id, progress.next.tab)}>{progress.next.label} <Icon name="arrowRight" size={15} /></button>
    </section>
  );
}
