import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import Button from '../../../ui/Button.tsx';

// A bar at the end of the agent's page while it is not ready: the next step, with a button that opens it.
//   plan: the steps to get it ready (readiness.js)
export default function NextStepBar({ plan, onStep }) {
  const next = plan?.next;
  if (!next) return null;
  return (
    <div
      role="region"
      aria-label="Next step"
      className="tw-mt-8 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-rounded-card tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-4 tw-py-3"
    >
      <p className="tw-m-0 tw-min-w-0 tw-text-sm tw-text-ink-soft">
        <strong className="tw-text-ink">Next: {next.label}.</strong> {next.text}
      </p>
      <Button type="button" size="compact" className="tw-flex tw-items-center tw-gap-2" onClick={() => onStep(next)}>
        {next.label} <Icon name="arrowRight" size={14} />
      </Button>
    </div>
  );
}
