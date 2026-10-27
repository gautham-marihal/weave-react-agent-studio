import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import Mark from './Mark.jsx';

// One part in Build's Guided view: on the left what it is, with a link to all its settings; on the right its plain
// controls. A status shows under the title only when something is to do or wrong.
//   part: the part's row (buildSections.js); problems: how many the checks found there
//   onMore: opens the part's own page
export default function GuidedSection({ id, title, text, part, problems = 0, onMore, children }) {
  return (
    <section
      id={`guided-${id}`}
      data-guided={id}
      aria-labelledby={`guided-${id}-title`}
      className="tw-grid tw-scroll-mt-[calc(var(--under-bar)+16px)] tw-gap-6 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-py-8 first:tw-pt-2 last:tw-border-b-0 md:tw-grid-cols-[220px_minmax(0,1fr)] lg:tw-gap-10"
    >
      <div>
        <h2 id={`guided-${id}-title`} className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">
          {title}
        </h2>
        <p className="tw-m-0 tw-mt-1 tw-text-sm tw-leading-relaxed tw-text-muted">{text}</p>
        {part && (problems > 0 || part.state === 'todo' || part.state === 'attention') && (
          <p className="tw-m-0 tw-mt-3 tw-flex tw-items-start tw-gap-2 tw-text-sm tw-text-ink-soft">
            <span className="tw-mt-[3px] tw-flex">
              <Mark problems={problems} todo={1} />
            </span>
            <span>{part.status}</span>
          </p>
        )}
        {onMore && (
          <button
            type="button"
            onClick={onMore}
            className="tw-mt-3 tw-inline-flex tw-cursor-pointer tw-items-center tw-gap-1 tw-border-0 tw-bg-transparent tw-p-0 tw-text-sm tw-font-medium tw-text-accent-ink hover:tw-underline"
          >
            More settings for this <Icon name="arrowRight" size={14} />
          </button>
        )}
      </div>
      <div className="tw-min-w-0">{children}</div>
    </section>
  );
}
