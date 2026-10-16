import React from 'react';
import Icon from '../../ui/Icon.jsx';
import './shipFlow.css';

const MARK = { done: 'check', blocked: 'alert', todo: null, optional: null };

// The way from a draft to callers as one line of five steps, and the one thing to do next. It informs; every step is still done in its own tab.
export default function ShipFlow({ flow, onAction }) {
  const { steps, done, total, next, ready } = flow;
  return (
    <section className="shipFlow" aria-label="Release progress" data-ready={ready ? 'yes' : 'no'}>
      <header>
        <h3>{ready ? 'Ready: it is saved, checked, published and live' : `${done} of ${total} steps done`}</h3>
        {next && next.action && (
          <button type="button" className="primaryCta compactCta" onClick={() => onAction(next.action)}>
            {next.action.label}
          </button>
        )}
      </header>
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
