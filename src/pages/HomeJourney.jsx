import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../ui/Icon.jsx';
import { useAgentHealth } from '../studio/health/useAgentHealth.js';
import { useKnowledge } from '../studio/knowledge/useKnowledge.js';
import { readinessSteps, stepRoute } from '../studio/newlayout/readiness.js';
import { useGate } from '../studio/release/gate.js';
import { isFinished, normalizeHeadline } from '../studio/scenarios/runResults.js';
import StatePill from '../studio/StatePill.jsx';
import { agentState } from '../studio/status.js';
import { useAsync } from '../studio/useAsync.js';

// Home's answer to "what now?": the agent you were last working on, how far it is from ready, and the one thing to do next. The steps are the same ones its
// menu and its Overview show (readiness.js), worked out from the same things (the draft, its check, its tests' latest run, what is published and deployed),
// so Home, the agent and Releases always agree.
const LAST_KEY = 'weave_last_agent';
export const rememberAgent = (botId) => {
  try {
    localStorage.setItem(LAST_KEY, botId);
  } catch {
    /* storage unavailable */
  }
};
const lastAgent = () => {
  try {
    return localStorage.getItem(LAST_KEY) || '';
  } catch {
    return '';
  }
};

const MARK = { done: 'check', blocked: 'alert' };

//   onOpenTab(botId, tab, params): opens a page of the agent (a step's page, with the panel to open)
export default function HomeJourney({ bots, onOpenTab, onCreate }) {
  const loaded = Array.isArray(bots);
  const list = useMemo(() => (loaded ? bots : []), [loaded, bots]);
  const remembered = lastAgent();
  const [chosen, setChosen] = useState('');
  const bot = useMemo(
    () =>
      list.find((b) => b.id === chosen) ||
      list.find((b) => b.id === remembered) ||
      [...list].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] ||
      null,
    [list, chosen, remembered],
  );
  const visible = useMemo(() => (bot ? [bot] : []), [bot]);
  const { meta } = useAgentHealth(visible);
  const answer = bot ? meta[bot.id] || null : null;
  const runs = useAsync((signal) => (bot ? api.listTestRuns(bot.id, 20, { signal }) : Promise.resolve(null)), [bot?.id]);
  const latestRun = useMemo(
    () => (Array.isArray(runs.data) ? runs.data.map(normalizeHeadline).find((run) => isFinished(run.status)) || null : undefined),
    [runs.data],
  );
  const [gateOn] = useGate(bot?.id || '');
  const config = answer?.config || null;
  // what the server has read of its documents, when it has any (so this says what its menu says)
  const knowledge = useKnowledge(Array.isArray(config?.knowledge) && config.knowledge.length ? bot.id : null);
  const plan = useMemo(
    () =>
      config
        ? readinessSteps({
            config,
            summary: bot,
            report: answer?.report || null,
            scenarioCount: Array.isArray(config.tests) ? config.tests.length : 0,
            latestRun,
            gate: gateOn ? { enabled: true, savedAt: bot?.updated_at || '', dirty: false } : null,
            knowledgeRead: knowledge.data,
          })
        : null,
    [config, bot, answer?.report, latestRun, gateOn, knowledge.data],
  );
  useEffect(() => {
    if (chosen && !list.some((b) => b.id === chosen)) setChosen('');
  }, [list, chosen]);

  if (!loaded)
    return (
      <section className="progressCard homeJourney" aria-label="Your next step" aria-busy="true">
        <span className="hjSkeleton wide" />
        <span className="hjSkeleton" />
        <span className="hjSkeleton bar" />
      </section>
    );
  if (!bot) {
    return (
      <section className="progressCard homeJourney" aria-label="Your first step">
        <div className="hjHead">
          <span>Your first step</span>
        </div>
        <h3>Create your first agent</h3>
        <p className="hjNote">
          An agent answers calls or chats for you. Pick a starting point, give it a name, and you will be talking to it in a few minutes.
        </p>
        <button type="button" className="primaryCta compactCta" onClick={onCreate}>
          Create an agent
        </button>
      </section>
    );
  }
  const errors = Array.isArray(answer?.report?.errors) ? answer.report.errors.length : 0;
  const state = agentState({
    deployed: bot.deployed || {},
    tests: latestRun ? (latestRun.status === 'passed' ? 'passed' : 'failed') : 'unknown',
    problems: errors,
  });
  const open = (step) => {
    const { tab, params } = stepRoute(step);
    onOpenTab(bot.id, tab, params);
  };
  const ready = !!plan && plan.total > 0 && !plan.next;
  const rest = plan ? plan.steps.filter((s) => (s.state === 'todo' || s.state === 'blocked') && s.id !== plan.next?.id).slice(0, 3) : [];
  const pct = plan?.total ? Math.round((plan.done / plan.total) * 100) : 0;

  return (
    <section className="progressCard homeJourney" aria-label={`Where ${bot.name || bot.id} stands`}>
      <div className="hjHead">
        <span>{ready ? 'Ready' : 'Your next step'}</span>
        {list.length > 1 && (
          <select className="stFInput small" aria-label="Which agent" value={bot.id} onChange={(event) => setChosen(event.target.value)}>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}
              </option>
            ))}
          </select>
        )}
      </div>
      <h3>
        {bot.name || bot.id} <StatePill state={state} />
      </h3>
      {!plan ? (
        <div aria-busy="true" aria-label={`Reading ${bot.name || bot.id}`}>
          <span className="hjSkeleton" />
          <span className="hjSkeleton bar" />
        </div>
      ) : (
        <>
          <div className="hjProgress">
            <span>
              {plan.done} of {plan.total} steps done
            </span>
            <span className="hjBar" role="progressbar" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.done} aria-label="Steps done">
              <i style={{ width: `${pct}%` }} />
            </span>
          </div>
          {ready ? (
            <p className="hjNote">
              <Icon name="check" size={15} /> Everything it needs is done: it is built, checked, published and live.
            </p>
          ) : (
            <button type="button" className={`hjStep ${plan.next.state}`} data-step={plan.next.id} onClick={() => open(plan.next)}>
              <span className="hjMark" aria-hidden="true">
                <Icon name={MARK[plan.next.state] || 'arrowRight'} size={15} />
              </span>
              <span className="hjStepText">
                <strong>{plan.next.label}</strong>
                <small>{plan.next.text}</small>
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          )}
          {rest.length > 0 && (
            <p className="hjRest">
              Also to do:{' '}
              {rest.map((step, i) => (
                <React.Fragment key={step.id}>
                  {i > 0 && ', '}
                  <button type="button" className="linkButton" data-step={step.id} onClick={() => open(step)}>
                    {step.label}
                  </button>
                </React.Fragment>
              ))}
            </p>
          )}
          {ready && (
            <button type="button" className="primaryCta compactCta hjNext" onClick={() => onOpenTab(bot.id, 'home')}>
              Open its overview <Icon name="arrowRight" size={15} />
            </button>
          )}
        </>
      )}
    </section>
  );
}
