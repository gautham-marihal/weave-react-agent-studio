import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import { navigate, routeHref } from '../../route.js';
import { STAGES, resolvePage, stageOf } from '../pages.js';
import HueIcon from './HueIcon.jsx';
import Mark from './Mark.jsx';
import { HUES, stageTab } from './look.js';

// The row under the agent's name: the stages as tabs and, while it is not ready, its progress and next step.
const STAGE_ICONS = { overview: 'home', build: 'build', test: 'play', release: 'rocket', monitor: 'monitor' };
//   plan: the steps to get it ready (readiness.js); problems: how many the checks found, by page
export default function StageTabs({ botId, page, plan, problems = {}, onStep }) {
  const current = stageOf(page);
  // the steps still to do, counted on the stage that holds their page
  const todo = {};
  (plan?.steps || [])
    .filter((step) => step.state === 'todo' || step.state === 'blocked')
    .forEach((step) => {
      const stage = stageOf(resolvePage(step.page).page)?.id;
      if (stage) todo[stage] = (todo[stage] || 0) + 1;
    });
  const problemsOn = (stage) => stage.pages.reduce((sum, id) => sum + (problems[id] || 0), 0);

  return (
    <div className="tw-flex tw-flex-wrap tw-items-end tw-justify-between tw-gap-x-6 tw-gap-y-2 tw-border-0 tw-border-b tw-border-solid tw-border-line">
      <nav aria-label="Agent stages" className="tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-overflow-x-auto tw-overflow-y-hidden">
        {STAGES.map((stage) => {
          const on = current?.id === stage.id;
          return (
            <button
              key={stage.id}
              type="button"
              data-stage={stage.id}
              aria-current={on ? 'page' : undefined}
              className={stageTab(on)}
              onClick={() => navigate(routeHref(botId, stage.pages[0]), { guard: false })}
            >
              <HueIcon name={STAGE_ICONS[stage.id]} hue={HUES[stage.id]} />
              {stage.label}
              <Mark problems={problemsOn(stage)} todo={todo[stage.id] || 0} />
            </button>
          );
        })}
      </nav>
      {plan?.next && plan.total > 0 && (
        <button
          type="button"
          data-next-step={plan.next.id}
          className="tw-mb-2 tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-1.5 tw-text-sm tw-text-ink-soft hover:tw-text-ink"
          onClick={() => onStep?.(plan.next)}
        >
          <span className="tw-font-semibold tw-text-ink">
            Getting it ready · {plan.done} of {plan.total}
          </span>
          <span>Next: {plan.next.label}</span>
          <Icon name="arrowRight" size={14} />
        </button>
      )}
    </div>
  );
}
