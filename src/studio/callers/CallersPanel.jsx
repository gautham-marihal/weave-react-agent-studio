import React, { useEffect, useMemo, useState } from 'react';
import { isDemoMode } from '../../demo/demoMode.js';
import Icon from '../../ui/Icon.jsx';
import { Notice, Spinner } from '../ui.jsx';
import ResultView from '../scenarios/ResultView.jsx';
import { useTestRun } from '../scenarios/useTestRun.js';
import { isFinished } from '../scenarios/runResults.js';
import { expectationLines, suggestions } from './personas.js';
import './callers.css';
import Button from '../../ui/Button.tsx';

const DEFAULT_CALLERS = ['caller_direct', 'caller_frustrated', 'caller_wants_person', 'caller_off_topic'];
const STATE = {
  passed: { mark: 'check', word: 'Passed', tone: 'good' },
  basic: { mark: 'check', word: 'Basic checks passed', tone: 'good' },
  failed: { mark: 'alert', word: 'Needs a look', tone: 'bad' },
  error: { mark: 'alert', word: 'Could not run', tone: 'bad' },
  skipped: { mark: '', word: 'Not run', tone: 'idle' },
};

// Simulated callers: scripted people who phone the draft, plus checks made from what the agent has. Run some on the
// draft (nothing is saved) and keep the good ones as tests. They are scripted, not played by a model, so what they say
// doesn't follow the agent's answers; the reviewer checks (calm? on topic?) need the live model.
export default function CallersPanel({ botId, name, editor }) {
  const config = editor.parsed.value;
  const ready = editor.status === 'ready' && editor.isObject && !editor.parsed.error;
  const demo = isDemoMode();
  const all = useMemo(() => (ready ? suggestions(config) : []), [ready, config]);
  const [picked, setPicked] = useState(() => new Set());
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started && all.length && picked.size === 0)
      setPicked(new Set(all.filter((s) => s.group === 'check' || DEFAULT_CALLERS.includes(s.key)).map((s) => s.key)));
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const [paid, setPaid] = useState(false);
  const [judge, setJudge] = useState(false);
  const [queued, setQueued] = useState([]); // the suggestions the current run was asked for
  const [open, setOpen] = useState('');
  const [justKept, setJustKept] = useState([]);

  const scenarioList = useMemo(() => queued.map((s) => s.scenario), [queued]);
  const { run, running, starting, error, start, clear } = useTestRun(botId, { scenarios: scenarioList });
  const chosen = all.filter((s) => picked.has(s.key));
  const needsJudge = chosen.some((s) => s.needsJudge);
  const busy = running || starting;
  const canRun = ready && chosen.length > 0 && !busy && (demo || paid);

  if (!ready)
    return (
      <Notice kind="warn" title="The draft can’t be read right now">
        Fix the JSON first. The callers try the draft.
      </Notice>
    );

  const toggle = (key) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const go = async () => {
    setStarted(true);
    clear();
    setOpen('');
    setJustKept([]);
    setQueued(chosen);
    const ids = chosen.map((s) => s.scenario.id);
    // played from the editor's contents plus these scenarios: nothing is saved, so trying callers changes nothing
    const withThem = {
      ...config,
      tests: [...(Array.isArray(config.tests) ? config.tests.filter((t) => !ids.includes(t?.id)) : []), ...chosen.map((s) => s.scenario)],
    };
    await start({ config: withThem, scenarios: ids, live: true, ...(judge && needsJudge ? { judge: true } : {}) });
  };

  const resultOf = (s) => run?.scenarios.find((r) => r.id === s.scenario.id) || null;
  const finished = !!run && isFinished(run.status);
  const counts = finished
    ? queued.reduce(
        (n, s) => {
          const r = resultOf(s);
          const k = r?.status === 'passed' ? 'passed' : r?.status === 'failed' || r?.status === 'error' ? 'attention' : 'skipped';
          const ungraded = r?.status === 'passed' && r.checks.some((c) => c.passed === null) ? 1 : 0;
          return { ...n, [k]: n[k] + 1, ungraded: n.ungraded + ungraded };
        },
        { passed: 0, attention: 0, skipped: 0, ungraded: 0 },
      )
    : null;

  const keep = (list) => {
    const have = new Set((Array.isArray(config.tests) ? config.tests : []).map((t) => t?.id));
    const add = list.filter((s) => !have.has(s.scenario.id)).map((s) => s.scenario);
    if (!add.length) return;
    editor.setValue({ ...config, tests: [...(Array.isArray(config.tests) ? config.tests : []), ...add] });
    setJustKept(add.map((t) => t.id));
  };
  const isKept = (s) => s.kept || (Array.isArray(config.tests) && config.tests.some((t) => t?.id === s.scenario.id));

  const group = (id, title, lead) => (
    <section className="cpGroup" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <p>{lead}</p>
      </header>
      <ul className="cpList">
        {all
          .filter((s) => s.group === id)
          .map((s) => {
            const result = resultOf(s);
            const waiting = running && queued.some((q) => q.key === s.key) && !result;
            const ungraded = result && result.status === 'passed' ? result.checks.filter((c) => c.passed === null).length : 0;
            const st = result ? (ungraded ? STATE.basic : STATE[result.status] || STATE.skipped) : null;
            return (
              <li key={s.key} className={`${picked.has(s.key) ? 'on' : ''} ${st ? st.tone : ''}`} data-key={s.key}>
                <label className="cpPick">
                  <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} disabled={busy} aria-label={s.name} />
                  <span className="cpText">
                    <strong>{s.name}</strong>
                    <small>{s.blurb}</small>
                  </span>
                </label>
                <span className="cpStatus">
                  {waiting && (
                    <span className="cpWait" role="status">
                      Running…
                    </span>
                  )}
                  {st && (
                    <span className={`cpResult ${st.tone}`}>
                      {st.mark ? <Icon name={st.mark} size={14} /> : null}
                      {st.word}
                    </span>
                  )}
                  {isKept(s) && <span className="cpKept">A test</span>}
                  {s.needsJudge && !st && (
                    <span className="cpJudge" title="One of its checks is graded by a reviewer, which needs the live model">
                      reviewer
                    </span>
                  )}
                </span>
                <span className="cpActions">
                  <Button type="button" size="small" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? '' : s.key)}>
                    {/* what is seen, then whose: "What it says: Frustrated" (open or shut is said by aria-expanded) */}
                    {result ? 'Details' : 'What it says'}
                    <span className="srOnly">: {s.name}</span>
                  </Button>
                  {!isKept(s) && (
                    <Button type="button" size="small" onClick={() => keep([s])}>
                      Keep as a test<span className="srOnly">: {s.name}</span>
                    </Button>
                  )}
                </span>
                {open === s.key && (
                  <div className="cpDetail">
                    <p>
                      <b>The caller says</b>
                    </p>
                    <ol>
                      {s.scenario.turns.map((t, i) => (
                        <li key={i}>{t.say}</li>
                      ))}
                    </ol>
                    <p>
                      <b>What should hold afterwards</b>
                    </p>
                    <ul>
                      {expectationLines(s.scenario).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                    {result && <ResultView result={result} scenario={s.scenario} />}
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </section>
  );

  return (
    <div className="cpPanel">
      <section className="cpIntro">
        <p>
          Scripted callers try {name || 'the agent'}’s draft and show where it struggles: someone cross, someone who rambles, someone who asks for a person.
          Below them are checks made from what the agent has (its tools, its goodbye). Nothing is saved by running them.
        </p>
        <p className="cpNote">
          The callers are scripted, not played by an AI: what they say does not change with the agent’s answers. They are a quick way to meet the cases that
          usually go wrong.
        </p>
      </section>

      {group('caller', 'Callers', 'People who phone in. Pick the ones to try.')}
      {group('check', 'Checks from what the agent has', 'Made from its tools and its goodbye. Each says whether the agent does what its setup promises.')}

      <section className="cpRun" aria-label="Run">
        <div className="cpRunRow">
          <Button type="button" variant="primary" size="compact" onClick={go} disabled={!canRun}>
            {starting ? 'Starting…' : running ? 'Running…' : `Try ${chosen.length} on the draft`}
          </Button>
          <button type="button" className="linkButton" onClick={() => setPicked(new Set(all.map((s) => s.key)))} disabled={busy}>
            Select all
          </button>
          <button type="button" className="linkButton" onClick={() => setPicked(new Set())} disabled={busy}>
            Clear
          </button>
          <span className="cpCount">
            {chosen.length} of {all.length} chosen
          </span>
        </div>
        {demo ? (
          <p className="cpNote">
            Demo: the callers are played by the demo’s imitation, which follows tools and hand-overs but does not read instructions or grade the reviewer
            checks.
          </p>
        ) : (
          <>
            <label className="cpPaid">
              <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />{' '}
              <span>
                These run on the real agent with its live language model. <b>That costs money</b>, a few calls’ worth for each one picked.
              </span>
            </label>
            {needsJudge && (
              <label className="cpPaid">
                <input type="checkbox" checked={judge} onChange={(event) => setJudge(event.target.checked)} />{' '}
                <span>
                  Also let a reviewer grade the judgement checks (calm, on topic, polite). This uses the live model again; without it those checks are shown as
                  not checked.
                </span>
              </label>
            )}
          </>
        )}
      </section>

      {error && (
        <Notice kind={error.kind === 'info' ? 'info' : 'error'} title={error.title}>
          {error.body}
        </Notice>
      )}
      {busy && <Spinner label="The callers are phoning in" />}
      {finished && counts && (
        <section className="cpSummary" role="status" aria-label="How it went" data-state={counts.attention ? 'attention' : 'good'}>
          <strong>{counts.attention ? `${counts.attention} of ${queued.length} need a look` : `All ${queued.length - counts.skipped} that ran passed`}</strong>
          <span>
            {counts.passed} passed{counts.ungraded ? ` (${counts.ungraded} of them without the reviewer’s judgement, which was not graded)` : ''}
            {counts.skipped ? `, ${counts.skipped} not run` : ''}. Open Details on a caller to see what it said and why.
          </span>
          {queued.some((s) => resultOf(s)?.status === 'passed' && !isKept(s)) && (
            <Button type="button" onClick={() => keep(queued.filter((s) => resultOf(s)?.status === 'passed'))}>
              Keep the ones that passed as tests
            </Button>
          )}
        </section>
      )}
      {justKept.length > 0 && (
        <p className="cpDone" role="status">
          Added {justKept.length === 1 ? 'a test' : `${justKept.length} tests`} to the draft, not saved yet: {justKept.join(', ')}. They run with the other
          scenarios from now on.
        </p>
      )}
    </div>
  );
}
