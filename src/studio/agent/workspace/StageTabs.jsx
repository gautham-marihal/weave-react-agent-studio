import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import { navigate, routeHref } from '../../route.js';
import { STAGES, resolvePage, stageOf } from '../pages.js';
import Mark from './Mark.jsx';
import { stageTab } from './look.js';

// The row under the agent's name: the stages as numbered tabs, in the order of the work, and, while it is not ready,
// its progress as one dot per step and its next step.
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
        {STAGES.map((stage, i) => {
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
              <span className={`nlStageNum ${on ? 'on' : ''}`} aria-hidden="true">
                {i + 1}
              </span>
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
          // why the next step matters, in the readiness plan's words
          title={plan.next.text || undefined}
          className="tw-mb-2 tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-1.5 tw-text-sm tw-text-ink-soft hover:tw-text-ink"
          onClick={() => onStep?.(plan.next)}
        >
          <span className="tw-font-semibold tw-text-ink">Getting it ready</span>
          <span className="nlReadyDots" aria-hidden="true">
            {Array.from({ length: plan.total }, (_, n) => (
              <i key={n} className={n < plan.done ? 'done' : ''} />
            ))}
          </span>
          <span>
            {plan.done} of {plan.total} · Next: {plan.next.label}
          </span>
          <Icon name="arrowRight" size={14} />
        </button>
      )}
    </div>
  );
}
