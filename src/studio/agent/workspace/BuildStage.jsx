import React, { useRef } from 'react';
import Icon from '../../../ui/Icon.jsx';
import Tip from '../../../ui/Tip.tsx';
import { useFadeOnChange } from '../../../ui/motion.ts';
import { navigate, routeHref } from '../../route.js';
import HueIcon from './HueIcon.jsx';
import Mark from './Mark.jsx';
import { HUES, cx, sideItem } from './look.js';

// Build: one draft in four views, picked in the agent's bar (StageViews.jsx): Guided (the agent in nine steps, with its
// own summary of the checks), Detailed (one part at a time, its parts listed down the side), Workflow (the canvas) and
// JSON (the draft as text). Detailed shows each problem under its own field.
//   sections: the parts (buildSections.js); problems: how many the checks found, by page
//   jsonOpen: the JSON view is open (the Settings page, at its JSON)
export default function BuildStage({ botId, page, sections, problems = {}, jsonOpen = false, children }) {
  const go = (id) => navigate(routeHref(botId, id), { guard: false });
  const view = page === 'build' ? 'guided' : page === 'workflow' ? 'workflow' : jsonOpen ? 'json' : 'detailed';
  // a view that changes fades in; the view buttons above it stay still
  const content = useRef(null);
  useFadeOnChange(content, `${page}|${view}`);

  // the same room under the view buttons as every other stage has (Workflow's canvas page brings its own)
  return (
    <div className={cx('tw-grid tw-gap-6', view !== 'workflow' && 'tw-pt-7')}>
      <div className={cx('tw-grid tw-gap-8', view === 'detailed' && 'lg:tw-grid-cols-[190px_minmax(0,1fr)]')}>
        {view === 'detailed' && <PartList page={page} sections={sections} problems={problems} go={go} />}
        <div className="tw-min-w-0" ref={content}>
          {children}
        </div>
      </div>
    </div>
  );
}

// The checks result in a word, opening the full panel (in the agent's bar, beside Build's views). failed: the last
// check couldn't run (the page says why, with Check again), so there is no result to give.
export function ChecksChip({ status, onOpen }) {
  const { checked, problems, failed = false } = status;
  const words = failed ? 'Not checked' : !checked ? 'Checking…' : problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'}` : 'Checks pass';
  return (
    <button
      type="button"
      data-checks={failed ? 'failed' : !checked ? 'checking' : problems ? 'problems' : 'pass'}
      className={cx(
        'tw-ml-auto tw-inline-flex tw-cursor-pointer tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-bg-surface tw-px-3 tw-py-1 tw-text-sm tw-font-medium',
        !checked && 'tw-border-line tw-text-muted',
        checked && problems > 0 && 'tw-border-danger tw-text-danger',
        checked && !problems && 'tw-border-line tw-text-success',
      )}
      onClick={onOpen}
    >
      <Icon name={failed || (checked && problems) ? 'alert' : 'check'} size={14} />
      {words}
    </button>
  );
}

// The parts down the left of the Detailed view, marked done, to do or with problems; a tooltip says what each is for.
function PartList({ page, sections, problems, go }) {
  const item = (id, label, icon, mark = null, tip = null) => {
    const button = (
      <button type="button" data-page={id} aria-current={page === id ? 'page' : undefined} className={sideItem(page === id)} onClick={() => go(id)}>
        <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-2.5">
          <HueIcon name={icon} hue={HUES[id]} size={14} tile />
          {label}
        </span>
        {mark}
      </button>
    );
    return (
      <li key={id}>
        {tip ? (
          <Tip label={tip} side="right">
            {button}
          </Tip>
        ) : (
          button
        )}
      </li>
    );
  };
  return (
    <nav aria-label="Build" className="lg:tw-sticky lg:tw-top-[var(--under-bar)] lg:tw-self-start">
      <ul className="tw-m-0 tw-flex tw-list-none tw-flex-wrap tw-gap-1 tw-p-0 lg:tw-flex-col lg:tw-gap-0.5">
        {sections.map((part) =>
          item(
            part.id,
            part.label,
            part.icon,
            <Mark problems={problems[part.id] || 0} todo={part.state === 'todo' || part.state === 'attention' ? 1 : 0} done={part.state === 'done'} />,
            `${part.purpose} Now: ${part.status}`,
          ),
        )}
        {item('settings', 'Engine and details', 'sliders')}
      </ul>
    </nav>
  );
}
