import React from 'react';
import Icon from '../../ui/Icon.jsx';
import './shipFlow.css';

const MARK = { done: 'check', blocked: 'alert', todo: null, optional: null };

// The way from a draft to callers as one line of five steps, and the one thing to do next. It informs; every step is still done in its own tab.
// `buildLeft`: the steps of building the agent still to do (readiness.js, the list the menu and the Overview show): while there are some, the draft can be
// shipped but the agent is not called ready, and the first of them is offered (`onStep`).
export default function ShipFlow({ flow, onAction, buildLeft = [], onStep }) {
  const { steps, done, total, next, ready } = flow;
  const left = buildLeft[0] || null;
  const allReady = ready && !left;
  const title = allReady
    ? 'Ready: it is built, checked, published and live'
    : ready
      ? `Published and live. ${buildLeft.length === 1 ? 'One step is' : `${buildLeft.length} steps are`} still to do before it is ready.`
      : `${done} of ${total} release steps done`;
  return (
    <section className="shipFlow" aria-label="Release progress" data-ready={allReady ? 'yes' : 'no'}>
      <header>
        <h3>{title}</h3>
        {next && next.action ? (
          <button type="button" className="primaryCta compactCta" onClick={() => onAction(next.action)}>
            {next.action.label}
          </button>
        ) : left && onStep ? (
          <button type="button" className="primaryCta compactCta" onClick={() => onStep(left)}>
            {left.label}
          </button>
        ) : null}
      </header>
      {!ready && left && onStep && (
        <p className="shipLeft">
          Also still to do before it is ready:{' '}
          <button type="button" className="linkButton" onClick={() => onStep(left)}>
            {left.label}
          </button>
          {buildLeft.length > 1 ? ` and ${buildLeft.length - 1} more` : ''}
        </p>
      )}
      <ol className="shipSteps">
        {steps.map((step, index) => (
          <li key={step.id} className={`${step.state} ${next && next.id === step.id ? 'next' : ''}`} data-step={step.id} data-state={step.state}>
            <span className="shipMark" aria-hidden="true">
              {MARK[step.state] ? <Icon name={MARK[step.state]} size={14} /> : index + 1}
            </span>
            <span className="shipCopy">
              <strong>
                {step.label}
                {step.state === 'optional' ? ' (optional)' : ''}
              </strong>
              <small>{step.text}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
