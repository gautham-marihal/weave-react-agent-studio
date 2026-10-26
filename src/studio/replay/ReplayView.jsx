import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { isDemoMode } from '../../demo/demoMode.js';
import { Notice, Spinner } from '../ui.jsx';
import { useAsync } from '../useAsync.js';
import { isFinished } from '../scenarios/runResults.js';
import { useTestRun } from '../scenarios/useTestRun.js';
import { readCall } from './callFacts.js';
import { compareReplay } from './compareReplay.js';
import { configWithScenario, factsFromResult, playSimulated, scenarioForReplay } from './replayRun.js';
import './replay.css';

const toolNames = (tools) => tools.map((t) => t.tool).filter(Boolean);

function Said({ lines, empty = 'said nothing' }) {
  if (!lines.length) return <p className="rpSaid rpNone">{empty}</p>;
  return lines.map((text, index) => (
    <p key={index} className="rpSaid">
      {text}
    </p>
  ));
}

function Tools({ tools, was }) {
  if (!tools.length) return null;
  const gone = was ? new Set(toolNames(was)) : null;
  return (
    <ul className="rpTools" aria-label="Tools used">
      {tools.map((t, index) => (
        <li key={index} className={`${t.error ? 'bad' : ''} ${gone && !gone.has(t.tool) ? 'new' : ''}`}>
          <code>{t.tool}</code>
          {t.handoff ? (
            <span>
              {' '}
              → hands over to <b>{t.handoff}</b>
            </span>
          ) : null}
          {t.error ? <span> failed: {t.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// The original call and the replay, turn against turn, with what changed in words above it.
export function ReplayCompare({ cmp, sourceLabel, targetLabel }) {
  const { turns, lines, verdict } = cmp;
  return (
    <div className="rpCompare" data-verdict={verdict}>
      <section className={`rpVerdict ${verdict}`} role="status" aria-label="What changed">
        <h4>
          {verdict === 'same'
            ? 'Nothing changed: the agent does the same things'
            : `${lines.length} ${lines.length === 1 ? 'difference' : 'differences'} from the call`}
        </h4>
        {lines.length > 0 && (
          <ul>
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
        <small>
          Compared on what the agent did (tools, hand-overs, how it ended) and, more loosely, on what it said{sourceLabel ? `. ${sourceLabel}` : ''}
        </small>
      </section>

      <div className="rpGrid" role="table" aria-label="The call and its replay">
        <div className="rpHead" role="row">
          <span>The call</span>
          <span>{targetLabel}</span>
        </div>
        {(cmp.opening.was.length > 0 || cmp.opening.now.length > 0) && (
          <div className={`rpTurn ${cmp.opening.sameWords ? '' : 'changed'}`} role="row">
            <p className="rpCaller" role="cell">
              <em>Before the caller speaks</em>
            </p>
            <div className="rpSide" role="cell">
              <Said lines={cmp.opening.was} />
            </div>
            <div className="rpSide" role="cell">
              <Said lines={cmp.opening.now} />
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.index} className={`rpTurn ${t.changed ? 'changed' : ''} ${t.reached ? '' : 'unreached'}`} role="row" data-turn={t.index + 1}>
            <p className="rpCaller" role="cell">
              <b>Caller</b> {t.say}
              {t.changed && <span className="rpBadge">changed</span>}
            </p>
            <div className="rpSide" role="cell">
              <Said lines={t.original.said} />
              <Tools tools={t.original.tools} />
            </div>
            <div className="rpSide" role="cell">
              {t.reached ? (
                <>
                  <Said lines={t.replay.said} />
                  <Tools tools={t.replay.tools} was={t.original.tools} />
                </>
              ) : (
                <p className="rpSaid rpNone">not reached: the agent had already ended the conversation</p>
              )}
            </div>
          </div>
        ))}
        <div className="rpEnd" role="row">
          <p role="cell">
            <b>How it ended</b>
          </p>
          <p role="cell">
            {cmp.agent.was ? <>“{cmp.agent.was}” in charge</> : '—'}
            {cmp.ended.was ? ', the call ended' : ''}
          </p>
          <p role="cell" className={cmp.agent.changed || cmp.ended.changed ? 'rpDiff' : ''}>
            {cmp.agent.now ? <>“{cmp.agent.now}” in charge</> : '—'}
            {cmp.ended.now ? ', the conversation ended' : ''}
          </p>
        </div>
        {cmp.state.length > 0 && (
          <div className="rpEnd" role="row">
            <p role="cell">
              <b>What it remembered</b>
            </p>
            <p role="cell">{cmp.state.map((s) => `${s.name} = ${JSON.stringify(s.was ?? null)}`).join(', ')}</p>
            <p role="cell" className="rpDiff">
              {cmp.state.map((s) => `${s.name} = ${JSON.stringify(s.now ?? null)}`).join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// "What if it ran again?": the caller's words of this call played to the draft (or to a published version), and laid beside what happened. Changes nothing.
export default function ReplayView({ botId, events, editor, onMakeTest, draftLabel = '' }) {
  const original = useMemo(() => readCall(events), [events]);
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId]);
  const [target, setTarget] = useState('draft');
  const [outcome, setOutcome] = useState(null); // { cmp, source, label, notes, unmocked }
  const [problem, setProblem] = useState('');
  const [paid, setPaid] = useState(false);
  const [runnerScenario, setRunnerScenario] = useState(null);
  const runnerTarget = useRef('');
  const { run, running, starting, error, start, clear } = useTestRun(botId, { scenarios: runnerScenario ? [{ id: runnerScenario }] : [] });
  const demo = isDemoMode();

  const options = useMemo(() => {
    const list = Array.isArray(versions.data) ? versions.data : [];
    return [
      { value: 'draft', label: draftLabel || (editor?.dirty ? 'The draft (with your unsaved edits)' : 'The draft') },
      ...list.map((v, i) => ({ value: v.version, label: `Version ${v.version}${i === 0 ? ' (latest)' : ''}` })),
    ];
  }, [versions.data, editor?.dirty, draftLabel]);
  const labelOf = (value) => options.find((o) => o.value === value)?.label || value;

  const configFor = async (value) => {
    if (value === 'draft') {
      const draft = editor?.parsed?.value;
      if (!draft) throw new Error('The draft can’t be read right now. Fix its JSON in the agent’s settings first.');
      return draft;
    }
    const record = await api.getVersion(botId, value);
    if (!record?.config) throw new Error(`Version ${value} has no configuration to replay.`);
    return record.config;
  };

  const replayHere = async () => {
    setProblem('');
    setOutcome(null);
    clear();
    try {
      const config = await configFor(target);
      const facts = playSimulated(config, original);
      setOutcome({
        cmp: compareReplay(original, facts),
        source: 'simulated',
        label: labelOf(target),
        notes: [],
        unmocked: [],
        playedOn: target === 'draft' ? editor?.text : null,
      });
    } catch (e) {
      setProblem(e.message || 'The replay could not be played.');
    }
  };

  const replayOnRunner = async () => {
    setProblem('');
    setOutcome(null);
    clear();
    try {
      const config = await configFor(target);
      const scenario = scenarioForReplay(config, original);
      setRunnerScenario(scenario.id);
      runnerTarget.current = target;
      await start({ config: configWithScenario(config, scenario), scenarios: [scenario.id], live: true });
    } catch (e) {
      setProblem(e.message || 'The run could not be started.');
    }
  };

  // when the runner has played the scenario, read its answer
  useEffect(() => {
    if (!run || !isFinished(run.status) || !runnerScenario) return;
    const result = run.scenarios.find((s) => s.id === runnerScenario);
    if (!result) return;
    if (result.status === 'error' || result.status === 'skipped') {
      setProblem(result.detail || result.reason || 'The runner could not play this replay.');
      return;
    }
    const facts = factsFromResult(result, { channelId: original.channelId });
    setOutcome({
      cmp: compareReplay(original, facts),
      source: 'runner',
      label: `${labelOf(runnerTarget.current)} on ${demo ? 'the demo imitation' : 'the real runtime'}`,
      notes: result.notes || [],
      unmocked: result.unmocked || [],
      playedOn: runnerTarget.current === 'draft' ? editor?.text : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, runnerScenario]);

  const noWords = original.turns.length === 0;
  const busy = running || starting;

  return (
    <div className="rpView">
      <section className="rpIntro">
        <h4>Play this call again</h4>
        <p>
          The caller’s words are played to the agent as it is now, or to a published version, and laid beside what happened in the call. Nothing is saved and no
          real caller is involved.
        </p>
      </section>

      {noWords ? (
        <Notice kind="info" title="Nothing to replay">
          The caller said nothing in this call.
        </Notice>
      ) : (
        <>
          <div className="rpControls">
            <label>
              <span>Play it to</span>
              <select
                className="stFInput small"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setOutcome(null);
                }}
                aria-label="Play it to"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primaryCta compactCta" onClick={replayHere} disabled={busy || !editor}>
              Replay in the browser
            </button>
            <button
              type="button"
              className="quietButton"
              onClick={replayOnRunner}
              disabled={busy || !editor || (!paid && !demo)}
              title={!demo && !paid ? 'Tick the box below first: this uses the live model' : undefined}
            >
              {busy ? 'Running…' : demo ? 'Replay on the demo runner' : 'Replay on the real runtime'}
            </button>
          </div>
          {!demo && (
            <label className="rpPaid">
              <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Replaying on the real runtime uses the live language
              model, which costs money. The agent’s API calls are never made for real: only mocks answer them.
            </label>
          )}
          <p className="rpNote" role="note">
            <b>In the browser</b> is free and instant, but it is a simulation: simple rules for the tools, hand-overs and goodbyes, with no language model, so
            its wording is not the agent’s. Trust it for <i>what the agent does</i>, not <i>how it says it</i>.{' '}
            <b>{demo ? 'On the demo runner' : 'On the real runtime'}</b>{' '}
            {demo ? 'is an imitation too, run the way the scenario runner would.' : 'is the real agent with its real model.'}
          </p>
        </>
      )}

      {!editor && !noWords && (
        <Notice kind="info" title="Open this call from the agent’s own Calls page to replay it">
          Replays use the agent’s draft, which that page has open.
        </Notice>
      )}
      {problem && (
        <Notice kind="error" title="The replay didn’t run">
          {problem}
        </Notice>
      )}
      {error && (
        <Notice kind={error.kind === 'info' ? 'info' : 'error'} title={error.title}>
          {error.body}
        </Notice>
      )}
      {busy && <Spinner label="Replaying the call" />}
      {outcome && (
        <>
          {outcome.playedOn != null && outcome.playedOn !== editor?.text && (
            <Notice kind="warn" title="The draft has changed since this replay">
              Replay again to see the draft as it is now.
            </Notice>
          )}
          <ReplayCompare
            cmp={outcome.cmp}
            targetLabel={`Replay: ${outcome.label}`}
            sourceLabel={outcome.source === 'simulated' ? 'This replay is a simulation.' : ''}
          />
          {outcome.unmocked.length > 0 && (
            <Notice kind="info" title="The agent made requests nothing answered">
              {outcome.unmocked.map((r) => `${r.method || ''} ${r.path}`.trim()).join(', ')}. In a test, add a mock for each so the answer is the same every
              time.
            </Notice>
          )}
          {outcome.notes.map((note, index) => (
            <p key={index} className="rpNote">
              {note}
            </p>
          ))}
          {onMakeTest && (
            <div className="rpAfter">
              <button type="button" className="primaryCta compactCta" onClick={onMakeTest}>
                Keep this call as a test
              </button>
              <small>So the same conversation is checked every time the agent changes.</small>
            </div>
          )}
        </>
      )}
    </div>
  );
}
