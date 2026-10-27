import React from 'react';
import { describeTask } from './taskSteps.js';

// A task read top to bottom (see taskSteps.js), above the fields that edit it.
export default function TaskSteps({ value }) {
  const task = describeTask(value);
  if (!task.steps.length) return null;
  return (
    <section className="rlSteps" aria-label="The task step by step">
      <p className="rlStepsSummary">{task.summary}</p>
      <ol>
        {task.steps.map((step) => (
          <li key={step.id}>
            <b>{step.ask || step.id}</b>
            {step.notes.length > 0 && <small>{step.notes.join(' · ')}</small>}
          </li>
        ))}
      </ol>
      {task.outcomes.length > 0 && (
        <dl>
          {task.outcomes.map((o) => (
            <React.Fragment key={o.key}>
              <dt>{o.label}</dt>
              <dd>{o.text}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}
