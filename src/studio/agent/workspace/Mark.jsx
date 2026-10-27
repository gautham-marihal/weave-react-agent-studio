import React from 'react';
import Icon from '../../../ui/Icon.jsx';

// The mark beside a tab or list item, most pressing first: the problem count, a ring while something is to do, or a
// check once done. Nothing otherwise.
export default function Mark({ problems = 0, todo = 0, done = false }) {
  if (problems > 0)
    return (
      <span className="tw-rounded-full tw-bg-danger tw-px-1.5 tw-text-[11px] tw-font-semibold tw-leading-[18px] tw-text-surface">
        {problems}
        <span className="srOnly"> {problems === 1 ? 'problem' : 'problems'}</span>
      </span>
    );
  if (todo > 0)
    return (
      <span
        className="tw-h-2 tw-w-2 tw-shrink-0 tw-rounded-full tw-border-[1.5px] tw-border-solid tw-border-warning"
        role="img"
        aria-label={`${todo} ${todo === 1 ? 'step' : 'steps'} to do`}
      />
    );
  if (done)
    return (
      <span className="tw-inline-grid tw-shrink-0 tw-place-items-center tw-text-success" role="img" aria-label="Done">
        <Icon name="check" size={12} />
      </span>
    );
  return null;
}
