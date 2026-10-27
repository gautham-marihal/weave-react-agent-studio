import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import Tip from '../../../ui/Tip.tsx';
import { navigate, routeHref } from '../../route.js';
import HueIcon from './HueIcon.jsx';
import Mark from './Mark.jsx';
import { HUES, cx, sideItem } from './look.js';

// Build: one draft in four views picked at the top: Guided (all parts on one page), Detailed (one part at a time),
// Workflow (the canvas) and JSON (the draft as text). On wide screens the checks sit beside Guided and Detailed.
//   sections: the parts (buildSections.js); problems: how many the checks found, by page
//   checks: the checks card shown beside the page
//   jsonOpen: the JSON view is open (the Settings page, at its JSON)
//   status: { checked, problems } for the checks chip; onChecks: opens the full panel
const VIEWS = [
  { id: 'guided', label: 'Guided', page: 'build' },
  { id: 'detailed', label: 'Detailed', page: 'agent' },
  { id: 'workflow', label: 'Workflow', page: 'workflow' },
];

export default function BuildStage({ botId, page, sections, problems = {}, checks = null, jsonOpen = false, onJson, status = null, onChecks, children }) {
  const go = (id) => navigate(routeHref(botId, id), { guard: false });
  const view = page === 'build' ? 'guided' : page === 'workflow' ? 'workflow' : jsonOpen ? 'json' : 'detailed';
  const besideChecks = checks && (view === 'guided' || view === 'detailed');

  return (
    <div className="tw-grid tw-gap-6">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-2">
        <div className="segmented" role="group" aria-label="How to see the draft" title="One draft, four views: a change in one is in all of them.">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" data-view={v.id} aria-pressed={view === v.id} onClick={() => go(v.page)}>
              {v.label}
            </button>
          ))}
          <button type="button" data-view="json" aria-pressed={view === 'json'} onClick={onJson}>
            JSON
          </button>
        </div>
        {status && <ChecksChip status={status} beside={besideChecks} onOpen={onChecks} />}
      </div>

      <div
        className={cx(
          'tw-grid tw-gap-8',
          view === 'detailed' && 'lg:tw-grid-cols-[190px_minmax(0,1fr)]',
          view === 'detailed' && besideChecks && 'min-[1440px]:tw-grid-cols-[190px_minmax(0,1fr)_300px]',
          view === 'guided' && besideChecks && 'min-[1440px]:tw-grid-cols-[minmax(0,1fr)_300px]',
        )}
      >
        {view === 'detailed' && <PartList page={page} sections={sections} problems={problems} go={go} />}
        <div className="tw-min-w-0">{children}</div>
        {besideChecks && (
          <aside
            aria-label="What the checks found"
            className="tw-hidden tw-self-start min-[1440px]:tw-sticky min-[1440px]:tw-top-[var(--under-bar)] min-[1440px]:tw-block"
          >
            {checks}
          </aside>
        )}
      </div>
    </div>
  );
}

// The checks result in a word, opening the full panel. Hidden on wide screens when the checks card is already
// beside the page (`beside`).
function ChecksChip({ status, beside, onOpen }) {
  const { checked, problems } = status;
  const words = !checked ? 'Checking…' : problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'}` : 'Checks pass';
  return (
    <button
      type="button"
      data-checks={!checked ? 'checking' : problems ? 'problems' : 'pass'}
      className={cx(
        beside && 'min-[1440px]:tw-hidden',
        'tw-ml-auto tw-inline-flex tw-cursor-pointer tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-bg-surface tw-px-3 tw-py-1 tw-text-sm tw-font-medium',
        !checked && 'tw-border-line tw-text-muted',
        checked && problems > 0 && 'tw-border-danger tw-text-danger',
        checked && !problems && 'tw-border-line tw-text-success',
      )}
      onClick={onOpen}
    >
      <Icon name={checked && problems ? 'alert' : 'check'} size={14} />
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
        {item('settings', 'All settings', 'sliders')}
      </ul>
    </nav>
  );
}
