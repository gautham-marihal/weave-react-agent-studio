import React, { useMemo } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { EnvSlots } from '../../ui.jsx';
import { navigate, routeHref } from '../../route.js';
import PageShell, { Section } from '../PageShell.jsx';
import { readinessSteps } from '../readiness.js';
import { tabFor } from '../pages.js';

const MARK = { done: 'check', blocked: 'alert' };

// An agent's first page: where it stands on the way to live, as a short list of steps each of which opens the page where it is done, and what is running where.
export default function HomePage({ botId, name, summary, editor, scenarioCount, onProblems, onDescribe, onTest, onStep }) {
  const config = editor.parsed.value;
  const plan = useMemo(() => readinessSteps({ config, summary, report: editor.report, scenarioCount }), [config, summary, editor.report, scenarioCount]);
  const open = (step) => {
    if (step.page === 'checks') {
      onProblems();
      return;
    }
    if (step.target && onStep) {
      onStep(step.target);
      return;
    }
    navigate(routeHref(botId, tabFor(step.page, step.part)), { guard: false });
  };
  const description = config?.meta?.description;
  return (
    <PageShell
      title="Home"
      lead={description || `Where ${name} stands, and what to do next.`}
      actions={
        <button type="button" className="quietButton nlBtn" onClick={onDescribe}>
          <Icon name="sparkle" size={16} />
          Describe it in words
        </button>
      }
    >
      <Section
        title="Getting it ready"
        lead={plan.total ? `${plan.done} of ${plan.total} steps done${plan.next ? '' : '. It is ready.'}` : 'Reading the draft…'}
        action={
          plan.next ? (
            <button type="button" className="primaryCta compactCta" onClick={() => open(plan.next)}>
              {plan.next.label}
            </button>
          ) : null
        }
      >
        <ol className="nlSteps">
          {plan.steps.map((step) => (
            <li key={step.id} className={`${step.state} ${plan.next && plan.next.id === step.id ? 'next' : ''}`} data-step={step.id} data-state={step.state}>
              <button type="button" onClick={() => open(step)}>
                <span className="nlStepMark" aria-hidden="true">
                  {MARK[step.state] ? <Icon name={MARK[step.state]} size={14} /> : null}
                </span>
                <span className="nlStepText">
                  <strong>
                    {step.label}
                    {step.state === 'optional' ? <em> optional</em> : null}
                  </strong>
                  <small>{step.text}</small>
                </span>
                <Icon name="chevronRight" size={16} />
              </button>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="What is running where"
        action={
          <button type="button" className="linkButton" onClick={() => navigate(routeHref(botId, 'deploy'), { guard: false })}>
            Open Releases
          </button>
        }
      >
        {summary ? (
          <EnvSlots deployed={summary.deployed} onPick={() => navigate(routeHref(botId, 'deploy'), { guard: false })} />
        ) : (
          <p className="nlHint">Reading what is deployed…</p>
        )}
        <p className="nlHint">{summary?.latest_version ? `The newest published version is v${summary.latest_version}.` : 'Nothing is published yet.'}</p>
      </Section>

      <Section title="Jump to">
        <div className="nlQuick">
          <button type="button" onClick={onTest}>
            <Icon name="test" size={18} />
            <span>
              <strong>Try it</strong>
              <small>Talk to the agent as it is now</small>
            </span>
          </button>
          <button type="button" onClick={() => navigate(routeHref(botId, 'calls'), { guard: false })}>
            <Icon name="phone" size={18} />
            <span>
              <strong>Calls</strong>
              <small>What callers have said and what happened</small>
            </span>
          </button>
          <button type="button" onClick={() => navigate(routeHref(botId, 'monitoring'), { guard: false })}>
            <Icon name="monitor" size={18} />
            <span>
              <strong>Monitoring</strong>
              <small>How it is doing, and what needs attention</small>
            </span>
          </button>
        </div>
      </Section>
    </PageShell>
  );
}
