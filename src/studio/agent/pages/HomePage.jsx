import React, { useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { EnvSlots } from '../../ui.jsx';
import { formatWhen, periodOf } from '../../format.js';
import { navigate, routeHref } from '../../route.js';
import { OUTCOMES, channelLabel, formatSeconds, outcomeOf, statusOf } from '../../calls/callModel.js';
import { analyse, changeWords } from '../../monitoring/monitorModel.js';
import { useMonitoring } from '../../monitoring/useMonitoring.ts';
import { seconds } from '../../speed/speedModel.ts'; // same wait format as Speed, so both show the same number
import PageShell, { Section } from '../PageShell.jsx';
import Stat from '../Stat.jsx';
import { Skeleton, SkeletonRows } from '../../../ui/Skeleton.jsx';
import { readinessSteps } from '../readiness.js';
import { tabFor } from '../pages.js';
import { STEPS, stepIndex } from '../../setup/setupModel.js';
import { inSetup, useSetupProgress } from '../../setup/setupProgress.js';

const MARK = { done: 'check', blocked: 'alert' };
// a build part drawn as a step of the same list
const PART_STATE = { done: 'done', todo: 'todo', attention: 'blocked', optional: 'optional' };
const DAYS = 7;
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const callWord = (n) => `${n} call${n === 1 ? '' : 's'}`;

// This week's calls against the week before, in words ("Down from 12 the week before"), never a bare "-4".
const comparedWithBefore = (now, before) => changeWords(now, before, 'the week before') || (now ? 'None the week before' : 'None the week before either');

// Calls passed to a person, as a count: two rounded percentages (88% handled, 13% passed on) may not add up to 100.
function passedOnText(calls, handoffRate) {
  const passed = Math.round((handoffRate || 0) * calls);
  if (!passed) return 'None passed to a person';
  return `${passed} of ${callWord(calls)} passed to a person`;
}

// An agent's overview: build parts, readiness steps, this week's numbers, where it runs and the latest calls. Until it
// is live, the build comes first (an agent nobody can reach has no numbers worth reading); once live, the numbers lead.
//   plan: readiness steps (readiness.js); worked out here when not given
//   onStep(step): opens a step (else this page goes to the step's page)
//   sections: the build parts (buildSections.js)
export default function HomePage({
  botId,
  name,
  summary,
  editor,
  scenarioCount,
  plan: givenPlan = null,
  sections = [],
  onProblems,
  onTest,
  onStep,
  top = null,
}) {
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
        .filter((c) => Date.parse(c.started_at) >= periodOf(data.nowMs, DAYS).startMs)
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
  // the guided setup is offered while an agent is in setup or unpublished, until ready; it resumes where it was left
  const [setup] = useSetupProgress(botId);
  const offerSetup = !ready && inSetup(setup, summary);
  const description = config?.meta?.description;
  const reading = data.loading && !data.calls.length;
  const live = Object.values(summary?.deployed || {}).some(Boolean);
  const partsDone = sections.filter((s) => s.state === 'done').length;

  const stats = (
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
  );

  // one row per build part, each opening its page
  const build = sections.length > 0 && (
    <Section title="Build" lead={`${partsDone} of ${sections.length} parts set up. The optional ones can wait; open any part to change it.`}>
      <ol className="nlSteps ovBuild">
        {sections.map((part) => (
          <li key={part.id} className={PART_STATE[part.state]} data-part={part.id} data-state={part.state}>
            <button type="button" onClick={() => go(part.id)} title={part.purpose}>
              <span className="nlStepMark" aria-hidden="true">
                {MARK[PART_STATE[part.state]] ? <Icon name={MARK[PART_STATE[part.state]]} size={14} /> : null}
              </span>
              <span className="nlStepText">
                <strong>
                  {part.label}
                  {part.state === 'optional' ? <em> optional</em> : null}
                </strong>
                <small>{part.status}</small>
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );

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
        {live && stats}

        <div className="ovGrid">
          <div className="ovMain">
            {build}
            <Section
              title="Getting it ready"
              lead={plan.total ? `${plan.done} of ${plan.total} steps done${ready ? '. It is ready.' : ''}` : ''}
              action={
                plan.next ? (
                  // quiet: the next step is marked below, and the top bar has the page's one strong button
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
        {!live && stats}
      </div>
    </PageShell>
  );
}
