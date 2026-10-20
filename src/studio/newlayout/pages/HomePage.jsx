import React, { useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { EnvSlots } from '../../ui.jsx';
import { formatWhen } from '../../format.js';
import { navigate, routeHref } from '../../route.js';
import { channelLabel, formatSeconds, statusOf } from '../../calls/callModel.js';
import { analyse } from '../../monitoring/monitorModel.js';
import { useMonitoring } from '../../monitoring/useMonitoring.js';
import PageShell, { Section } from '../PageShell.jsx';
import { readinessSteps } from '../readiness.js';
import { tabFor } from '../pages.js';

const MARK = { done: 'check', blocked: 'alert' };
const DAYS = 7;
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const secs = (ms) => (ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`);

// One number of the last week, what it means, and how it compares with the week before; it opens the page that explains it.
function Stat({ label, value, sub, series, onOpen }) {
  const max = Math.max(1, ...(series || []).map((d) => d.calls));
  return (
    <button type="button" className="ovStat" onClick={onOpen}>
      <span className="ovStatLabel">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
      {series && (
        <span className="ovSpark" aria-hidden="true">
          {series.map((d) => (
            <i key={d.day} style={{ height: `${Math.max(6, (d.calls / max) * 100)}%` }} />
          ))}
        </span>
      )}
    </button>
  );
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
  const description = config?.meta?.description;
  const reading = data.loading && !data.calls.length;
  const delta = totals.calls - previous.calls;

  return (
    <PageShell title="Overview" lead={description || `How ${name} is doing, and what to do next.`} wide>
      {top}

      {/* laid out by its own width, so it also reads well beside the docked test panel */}
      <div className="ovBody">
        <div className="ovStats" role="group" aria-label={`The last ${DAYS} days`}>
          <Stat
            label={`Calls · last ${DAYS} days`}
            value={reading ? '…' : totals.calls}
            sub={reading ? '' : `${delta > 0 ? '+' : ''}${delta} on the ${DAYS} days before`}
            series={series}
            onOpen={() => go('calls')}
          />
          <Stat
            label="Handled without a person"
            value={totals.calls ? pct(1 - (totals.handoffRate || 0)) : '–'}
            sub={totals.calls ? `${pct(totals.handoffRate)} passed to a person` : 'No calls yet'}
            onOpen={() => go('monitoring')}
          />
          <Stat
            label="Typical answer time"
            value={secs(totals.waitP50)}
            sub={totals.waitP90 !== null && totals.waitP90 !== undefined ? `1 in 10 over ${secs(totals.waitP90)}` : 'No answers timed yet'}
            onOpen={() => go('cost')}
          />
          <Stat
            label="Cut off"
            value={totals.calls ? pct(totals.cutOffRate) : '–'}
            sub={totals.calls ? `${totals.cutOff} call${totals.cutOff === 1 ? '' : 's'} stopped without an ending` : 'No calls yet'}
            onOpen={() => go('monitoring')}
          />
        </div>

        <div className="ovGrid">
          <div className="ovMain">
            <Section
              title="Getting it ready"
              lead={plan.total ? `${plan.done} of ${plan.total} steps done${ready ? '. It is ready.' : ''}` : 'Reading the draft…'}
              action={
                plan.next ? (
                  <button type="button" className="primaryCta compactCta" onClick={() => open(plan.next)}>
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
              {(!ready || showSteps) && (
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
                  <Icon name="check" size={16} /> Everything it needs is done: it is saved, checked, published and live.
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
              {summary ? <EnvSlots deployed={summary.deployed} onPick={() => go('deploy')} /> : <p className="nlHint">Reading what is deployed…</p>}
              <p className="nlHint">{summary?.latest_version ? `The newest published version is v${summary.latest_version}.` : 'Nothing is published yet.'}</p>
            </Section>

            <Section
              title="Latest calls"
              action={
                <button type="button" className="linkButton" onClick={() => go('calls')}>
                  All calls
                </button>
              }
            >
              {recent.length ? (
                <ul className="ovCalls">
                  {recent.map((c) => {
                    const status = statusOf(c.status);
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
                  {data.loading ? (
                    'Reading the calls…'
                  ) : (
                    <>
                      No calls in the last {DAYS} days.{' '}
                      <button type="button" className="linkButton" onClick={onTest}>
                        Test it
                      </button>{' '}
                      and the conversation shows up here.
                    </>
                  )}
                </p>
              )}
            </Section>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
