import React, { useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { EnvSlots } from '../../ui.jsx';
import { formatWhen } from '../../format.js';
import { navigate, routeHref } from '../../route.js';
import { OUTCOMES, channelLabel, formatSeconds, outcomeOf, statusOf } from '../../calls/callModel.js';
import { analyse, changeWords } from '../../monitoring/monitorModel.js';
import { useMonitoring } from '../../monitoring/useMonitoring.js';
import { seconds } from '../../speed/speedModel.js'; // a wait is written as Speed writes it, so the two show the same number
import PageShell, { Section } from '../PageShell.jsx';
import Stat from '../Stat.jsx';
import { Skeleton, SkeletonRows } from '../../../ui/Skeleton.jsx';
import { readinessSteps } from '../readiness.js';
import { tabFor } from '../pages.js';
import { STEPS, stepIndex } from '../../setup/setupModel.js';
import { inSetup, useSetupProgress } from '../../setup/setupProgress.js';

const MARK = { done: 'check', blocked: 'alert' };
const DAYS = 7;
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const callWord = (n) => `${n} call${n === 1 ? '' : 's'}`;

// The calls of the last days against the days before, in words: "Down from 12 the week before", never a bare "-4".
const comparedWithBefore = (now, before) => changeWords(now, before, 'the week before') || (now ? 'None the week before' : 'None the week before either');

// How many were passed to a person, as a count: two rounded percentages (88% handled, 13% passed on) would not add up to 100.
function passedOnText(calls, handoffRate) {
  const passed = Math.round((handoffRate || 0) * calls);
  if (!passed) return 'None passed to a person';
  return `${passed} of ${callWord(calls)} passed to a person`;
}

// An agent's overview: how it did this week, how far it is from ready (the steps, each opening the page where it is done), where it runs, and its latest calls.
//   plan: the steps to get ready (readiness.js); when not given they are worked out here. onStep(step): opens a step (else this page goes to its page).
export default function HomePage({ botId, name, summary, editor, scenarioCount, plan: givenPlan = null, onProblems, onTest, onStep, top = null }) {
  const config = editor.parsed.value;
  const computed = useMemo(
    () => (givenPlan ? null : readinessSteps({ config, summary, report: editor.report, scenarioCount })),
    [givenPlan, config, summary, editor.report, scenarioCount],
  );
  const plan = givenPlan || computed;
  const [showSteps, setShowSteps] = useState(false);
  const bots = useMemo(() => [{ id: botId, name, deployed: summary?.deployed || {} }], [botId, name, summary]);
  const data = useMonitoring({ bots, days: DAYS });
  const report = useMemo(
    () => analyse({ calls: data.calls, samples: data.samples, bots, nowMs: data.nowMs, days: DAYS }),
    [data.calls, data.samples, bots, data.nowMs],
  );
  const { totals, previous, series } = report;
  const recent = useMemo(
    () =>
      [...data.calls]
        .filter((c) => Date.parse(c.started_at) >= data.nowMs - DAYS * 86400000)
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
        .slice(0, 5),
    [data.calls, data.nowMs],
  );
  const go = (tab, params) => navigate(routeHref(botId, tab, params), { guard: false });
  const open = (step) => {
    if (onStep) {
      onStep(step);
      return;
    }
    if (step.page === 'checks') {
      onProblems();
      return;
    }
    go(tabFor(step.page, step.part));
  };
  const ready = plan.total > 0 && !plan.next;
  // the guided setup: offered to an agent that is being set up, or was never published, until it is ready; picked up where it was left
  const [setup] = useSetupProgress(botId);
  const offerSetup = !ready && inSetup(setup, summary);
  const description = config?.meta?.description;
  const reading = data.loading && !data.calls.length;

  return (
    <PageShell title="Overview" lead={description || `How ${name} is doing, and what to do next.`} wide>
      {top}
      {offerSetup && (
        <section className="suBanner" aria-label="Setting it up">
          <span className="suChoiceIcon" aria-hidden="true">
            <Icon name="sparkle" size={18} />
          </span>
          <div>
            <strong>{setup.known ? 'Finish setting it up' : 'Set it up step by step'}</strong>
            <p>
              {setup.known && setup.step
                ? `You stopped at “${STEPS[stepIndex(setup.step)].label}”. Everything so far is saved.`
                : 'A few short steps, one screen at a time: what it does, where people reach it, how it sounds, what it knows and can do; then try it and put it live.'}
            </p>
          </div>
          <button type="button" className="primaryCta" onClick={() => go('setup', setup.step ? { step: setup.step } : undefined)}>
            {setup.known ? 'Continue setup' : 'Start the setup'} <Icon name="arrowRight" size={15} />
          </button>
        </section>
      )}

      {/* laid out by its own width, so it also reads well beside the docked test panel */}
      <div className="ovBody">
        <div className="ovStats" role="group" aria-label={`The last ${DAYS} days`}>
          <Stat
            label={`Calls · last ${DAYS} days`}
            loading={reading}
            value={totals.calls}
            sub={comparedWithBefore(totals.calls, previous.calls)}
            series={series}
            onOpen={() => go('calls')}
          />
          <Stat
            label="Handled without a person"
            loading={reading}
            value={totals.calls ? pct(1 - (totals.handoffRate || 0)) : '–'}
            sub={totals.calls ? passedOnText(totals.calls, totals.handoffRate) : 'No calls yet'}
            onOpen={() => go('monitoring')}
          />
          <Stat
            label="Typical answer time"
            loading={reading}
            value={seconds(totals.waitP50)}
            sub={totals.waitP90 !== null && totals.waitP90 !== undefined ? `1 in 10 over ${seconds(totals.waitP90)}` : 'No answers timed yet'}
            onOpen={() => go('speed')}
          />
          <Stat
            label="Cut off"
            loading={reading}
            value={totals.calls ? pct(totals.cutOffRate) : '–'}
            sub={totals.calls ? (totals.cutOff ? `${callWord(totals.cutOff)} stopped without an ending` : 'None stopped without an ending') : 'No calls yet'}
            onOpen={() => go('monitoring')}
          />
        </div>

        <div className="ovGrid">
          <div className="ovMain">
            <Section
              title="Getting it ready"
              lead={plan.total ? `${plan.done} of ${plan.total} steps done${ready ? '. It is ready.' : ''}` : ''}
              action={
                plan.next ? (
                  // quiet: the next step's row is marked below, and the bar above the page has the page's one strong button
                  <button type="button" className="quietButton compactCta" onClick={() => open(plan.next)}>
                    {plan.next.label}
                  </button>
                ) : (
                  <button type="button" className="linkButton" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps}>
                    {showSteps ? 'Hide the steps' : 'Show the steps'}
                  </button>
                )
              }
            >
              {plan.total > 0 && (
                <span className="ovProgress" role="progressbar" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.done} aria-label="Steps done">
                  <i style={{ width: `${Math.round((plan.done / plan.total) * 100)}%` }} />
                </span>
              )}
              {plan.total === 0 && <SkeletonRows rows={4} label="Reading the draft" />}
              {plan.total > 0 && (!ready || showSteps) && (
                <ol className="nlSteps">
                  {plan.steps.map((step) => (
                    <li
                      key={step.id}
                      className={`${step.state} ${plan.next && plan.next.id === step.id ? 'next' : ''}`}
                      data-step={step.id}
                      data-state={step.state}
                    >
                      <button type="button" onClick={() => open(step)}>
                        <span className="nlStepMark" aria-hidden="true">
                          {MARK[step.state] ? <Icon name={MARK[step.state]} size={14} /> : null}
                        </span>
                        <span className="nlStepText">
                          <strong>
                            {step.label}
                            {step.state === 'optional' ? <em> optional</em> : null}
                          </strong>
                          <small>{step.text}</small>
                        </span>
                        <Icon name="chevronRight" size={16} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {ready && !showSteps && (
                <p className="ovReady">
                  <Icon name="check" size={16} /> Everything it needs is done: it is built, checked, published and live.
                </p>
              )}
            </Section>
          </div>

          <div className="ovSide">
            <Section
              title="Where it runs"
              action={
                <button type="button" className="linkButton" onClick={() => go('deploy')}>
                  Releases
                </button>
              }
            >
              {summary ? (
                <>
                  <EnvSlots deployed={summary.deployed} onPick={() => go('deploy')} />
                  <p className="nlHint">
                    {summary.latest_version ? `The newest published version is v${summary.latest_version}.` : 'Nothing is published yet.'}
                  </p>
                </>
              ) : (
                <div className="ovEnvSkeleton" role="status" aria-label="Reading what is deployed">
                  <Skeleton width={120} height={26} round />
                  <Skeleton width={110} height={26} round />
                  <Skeleton width={130} height={26} round />
                </div>
              )}
            </Section>

            <Section
              title="Latest calls"
              action={
                <button type="button" className="linkButton" onClick={() => go('calls')}>
                  All calls
                </button>
              }
            >
              {!recent.length && data.loading ? (
                <SkeletonRows rows={3} label="Reading the calls" square={false} />
              ) : recent.length ? (
                <ul className="ovCalls">
                  {recent.map((c) => {
                    const status = OUTCOMES[outcomeOf(c)] || statusOf(c.status);
                    return (
                      <li key={c.id}>
                        <button type="button" onClick={() => go('calls', { call: c.id })}>
                          <span className={`ovCallDot ${status.tone}`} aria-hidden="true" />
                          <span className="ovCallText">
                            <strong>{channelLabel(c.channel) || 'Call'}</strong>
                            <small>
                              {status.label} · {formatSeconds(c.duration_s) || '–'}
                            </small>
                          </span>
                          <span className="ovCallWhen">{formatWhen(c.started_at)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="nlHint">
                  No calls in the last {DAYS} days.{' '}
                  <button type="button" className="linkButton" onClick={onTest}>
                    Test it
                  </button>{' '}
                  and the conversation shows up here.
                </p>
              )}
            </Section>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
