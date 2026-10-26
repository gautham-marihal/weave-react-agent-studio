import React, { useCallback, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { isDemoMode } from '../../demo/demoMode.js';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { Modal, Notice } from '../ui.jsx';
import { formatWhen } from '../format.js';
import { useAsync } from '../useAsync.js';
import { addMockTo, describeTurn, newScenario, parseImport } from './model.js';
import { isFinished, normalizeHeadline, normalizeScenarioList, resultSummary, runTokens, testStatusOf, tokenWords } from './runResults.js';
import { useTestRun } from './useTestRun.js';
import ResultView from './ResultView.jsx';
import ScenarioForm from './ScenarioForm.jsx';
import './scenarios.css';
import Icon from '../../ui/Icon.jsx';
import { channelLabel } from '../newlayout/rowNames.js';
import { askConfirm } from '../../ui/dialogs.js';

// Test scenarios: conversations written down with what must be true afterwards, kept in the agent's draft (`tests`) and run by the
// server's runner. A scenario with a `model_script` runs the real runtime with a scripted model (free, the same every time); one without
// is live (a real model: it costs money and is only run when asked). Results appear as scenarios finish, each with its checks, what to
// do about a failure, and the trace of what happened. In demo mode there is no runtime: an imitation answers in the same shapes and
// says so.

const STATUS = { passed: ['Passed', 'good'], failed: ['Failed', 'bad'], error: ['Broke', 'bad'], skipped: ['Skipped', 'idle'], running: ['Running…', 'warn'] };
const Chip = ({ status }) => {
  const [text, tone] = STATUS[status] || ['Not run', 'idle'];
  return <span className={`scChip ${tone}`}>{text}</span>;
};
const ModeChip = ({ mode }) =>
  mode === 'live' ? (
    <span className="scChip warn" title="Uses a real model when run: costs money, and can differ from run to run">
      Live
    </span>
  ) : (
    <span className="scChip idle" title="Runs the real runtime with a scripted model: free and the same every time">
      Scripted
    </span>
  );

export default function ScenariosTab({ botId, name, editor, pollMs }) {
  const config = editor.parsed.value;
  const ready = editor.status === 'ready' && editor.isObject && !editor.parsed.error;
  const scenarios = useMemo(() => (Array.isArray(config?.tests) ? config.tests.filter((s) => s && typeof s === 'object') : []), [config]);
  const [editing, setEditing] = useState(null); // { index: number | -1 (new), scenario }
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [paid, setPaid] = useState({ live: false, judge: false });
  const [network, setNetwork] = useState(false); // let the bot's API calls reach real systems (the server refuses unless an operator allows it)
  const [confirm, setConfirm] = useState(null); // 'live' | 'judge'
  const [queued, setQueued] = useState(null); // the ids the current run was asked for (null = all)
  const [mockAdded, setMockAdded] = useState({}); // scenario id -> ["GET /x"]

  const saved = useAsync((signal) => api.listTests(botId, { ref: 'draft' }, { signal }), [botId]);
  const heads = useAsync((signal) => api.listTestRuns(botId, 10, { signal }), [botId]);
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId]);
  const list = useMemo(() => normalizeScenarioList(saved.data), [saved.data]);
  const headlines = useMemo(() => (Array.isArray(heads.data) ? heads.data.map(normalizeHeadline) : []), [heads.data]);

  const refresh = useCallback(() => {
    saved.reload();
    heads.reload();
  }, [saved, heads]);
  const { run, running, starting, error, start, open, clear, dismissError } = useTestRun(botId, { scenarios, onFinished: refresh, pollMs });

  if (!ready)
    return (
      <Notice kind="warn" title="The draft can’t be read right now">
        Fix its JSON in the agent’s settings first. Scenarios are part of the draft.
      </Notice>
    );

  const writeTests = (next) => {
    const copy = { ...config };
    if (next.length) copy.tests = next;
    else delete copy.tests;
    editor.setValue(copy);
  };
  const body = (ids) => ({
    ...(editor.dirty ? { config } : { ref: 'draft' }),
    ...(ids ? { scenarios: ids } : {}),
    ...(paid.live ? { live: true } : {}),
    ...(paid.judge ? { judge: true } : {}),
    ...(network ? { allow_network: true } : {}),
  });
  const go = (ids) => {
    setQueued(ids);
    setMockAdded({});
    return start(body(ids));
  };
  const liveCount = scenarios.filter((s) => !(Array.isArray(s.model_script) && s.model_script.length)).length;
  const resultOf = (id) => run?.scenarios.find((r) => r.id === id) || null;
  const earlier = (id) => list.items.find((i) => i.scenario?.id === id) || null;
  const pending = (id) => running && (!queued || queued.includes(id)) && !resultOf(id);

  // "this exact version": which published version the latest finished run tested
  const latest = run && isFinished(run.status) ? run : headlines.find((h) => isFinished(h.status)) || null;
  const testedVersion = latest?.checksum ? (Array.isArray(versions.data) ? versions.data : []).find((v) => v.checksum === latest.checksum) : null;
  const newest = Array.isArray(versions.data) ? versions.data[0] : null;
  const newestStatus = newest ? testStatusOf(newest, headlines.length ? headlines : run ? [run] : []) : null;

  const turnOn = (what) => setConfirm(what);
  const accept = () => {
    setPaid((p) => ({ ...p, [confirm]: true }));
    setConfirm(null);
  };

  return (
    <div className="scTab">
      <section className="stCard scHead">
        <div>
          <h3>Test scenarios</h3>
          <p className="stMuted">
            Write down conversations and what must be true afterwards, run them, and see which fail and why. They are part of {name}’s draft (<code>tests</code>
            ), so they are saved and versioned with it.
          </p>
        </div>
        <span className="scChip idle" title="Which runner plays the scenarios">
          {isDemoMode() ? 'Demo imitation' : 'The real runtime'}
        </span>
      </section>

      <DemoNote kind="scenarios">
        There is no runtime in demo mode: scenarios are played by a simple imitation. A pass here means the scenario is well formed and its checks can be met by
        the imitation, <strong>not</strong> that the real agent would pass. Reviewer (“judge”) checks are never graded.
      </DemoNote>
      {!isDemoMode() && (
        <p className="scBanner" role="note">
          Scenarios run in the real runtime but <strong>never call a real API</strong>: the mocks you write answer the bot’s API calls
          {saved.data && list.networkAllowed ? ' (this server lets a run reach real APIs when asked; the studio never asks)' : ''}. Scenarios with a model
          script are free and repeatable; the others are live and only run when you include them.
        </p>
      )}

      {editor.dirty && (
        <Notice
          kind="info"
          title="Runs use your edits, saved or not"
          actions={
            <button type="button" className="quietButton" onClick={() => editor.save()} disabled={editor.saving}>
              {editor.saving ? 'Saving…' : 'Save draft'}
            </button>
          }
        >
          The scenarios and everything else you changed are in the draft but not saved. A run tests exactly what is in the editor.
        </Notice>
      )}

      {newest && newestStatus && (
        <p className={`scVersionLine ${newestStatus.state}`} role="status">
          <b>Version {newest.version}</b>:{' '}
          {newestStatus.state === 'passed'
            ? newestStatus.run?.skipped > 0
              ? `the scenarios that ran passed on this exact version (${newestStatus.run.skipped} not run).`
              : 'these scenarios passed on this exact version.'
            : newestStatus.state === 'partial'
              ? `the latest run covered only some of the scenarios on this exact version (${newestStatus.text}).`
              : newestStatus.state === 'failed'
                ? `the latest run on this exact version ${newestStatus.text === 'Broke' ? 'broke' : 'failed'}.`
                : 'no run has tested this exact version yet.'}
        </p>
      )}

      <div className="scBar">
        <button type="button" className="primaryCta compactCta" disabled={!scenarios.length || running || starting} onClick={() => go(null)}>
          {starting ? 'Starting…' : running ? 'Running…' : `Run all (${scenarios.length})`}
          {paid.live || paid.judge ? ' · uses a paid model' : ''}
          {network ? ' · real requests' : ''}
        </button>
        <button type="button" className="quietButton" disabled={!!editing} onClick={() => setEditing({ index: -1, scenario: newScenario(config) })}>
          <Icon name="plus" size={14} /> New scenario
        </button>
        <button type="button" className="quietButton" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>
          Paste scenarios…
        </button>
        <button type="button" className="quietButton" onClick={refresh} disabled={saved.loading}>
          Refresh results
        </button>
      </div>

      <details className="scPaid">
        <summary>Paid and real-request options{paid.live || paid.judge || network ? ' (on)' : ''}</summary>
        <label className="scCheck">
          <input type="checkbox" checked={paid.live} onChange={(event) => (event.target.checked ? turnOn('live') : setPaid((p) => ({ ...p, live: false })))} />
          <span>
            <strong>Include live scenarios</strong> ({liveCount} of {scenarios.length}). They use a real language model: <b>this costs money</b> and the result
            can differ from run to run. Without this they are skipped.
          </span>
        </label>
        <label className="scCheck">
          <input
            type="checkbox"
            checked={paid.judge}
            onChange={(event) => (event.target.checked ? turnOn('judge') : setPaid((p) => ({ ...p, judge: false })))}
          />
          <span>
            <strong>Grade “a reviewer would agree that…” checks</strong>. A model grades each one: <b>this costs money</b>. A scenario with a model script can’t
            be graded.
          </span>
        </label>
        <label className="scCheck">
          <input
            type="checkbox"
            checked={network}
            onChange={async (event) => {
              if (!event.target.checked) {
                setNetwork(false);
                return;
              }
              const ok = await askConfirm({
                title: 'Let this run send requests to the real systems?',
                body: 'A scenario normally never calls a real API: its mocks answer. With this on, a request can change real data. The server refuses it unless an operator has allowed it.',
                confirmLabel: 'Allow real requests',
                tone: 'danger',
              });
              if (ok) setNetwork(true);
            }}
          />
          <span>
            <strong>Let requests reach real systems</strong> (for operators). Scenarios normally never call a real API; with this on they can, and a request can{' '}
            <b>change real data</b>. The server refuses it unless an operator has allowed it.
          </span>
        </label>
      </details>

      {confirm && (
        <Modal
          eyebrow="Costs money"
          title={confirm === 'live' ? 'Run live scenarios?' : 'Grade reviewer checks?'}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="quietButton" onClick={() => setConfirm(null)}>
                Not now
              </button>
              <button type="button" className="primaryCta compactCta" onClick={accept}>
                {confirm === 'live' ? 'Include live scenarios' : 'Grade them'}
              </button>
            </>
          }
        >
          <p className="stMuted">
            {confirm === 'live'
              ? 'A live scenario talks to a real language model, so each run is billed by the model’s provider and the answers can differ every time. A scripted scenario never needs one.'
              : 'Each reviewer check is graded by a language model, so each run is billed by the model’s provider.'}{' '}
            It stays on only until you leave this tab. Nothing is run until you press a Run button.
          </p>
        </Modal>
      )}

      {importOpen && (
        <section className="stCard scImport">
          <label>
            <span>Paste a list of scenarios as JSON</span>
            <textarea
              className="stFInput mono"
              rows={6}
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setImportResult(null);
              }}
              spellCheck={false}
              aria-label="Scenarios as JSON"
              placeholder='[{ "id": "asks_for_a_person", "channel": "web-chat", "turns": [{ "say": "Can I speak to someone?" }], "expect": [{ "tool_called": "escalate_to_human" }] }]'
            />
          </label>
          <div className="scActions">
            <button
              type="button"
              className="primaryCta compactCta"
              disabled={!importText.trim()}
              onClick={() => {
                const result = parseImport(importText, config);
                setImportResult(result);
                if (result.scenarios.length) {
                  writeTests([...scenarios, ...result.scenarios]);
                  if (!result.problems.length) {
                    setImportText('');
                    setImportOpen(false);
                  }
                }
              }}
            >
              Add them
            </button>
          </div>
          {importResult && (
            <div role="status">
              {importResult.scenarios.length > 0 && (
                <p className="scOk">
                  Added {importResult.scenarios.length} scenario{importResult.scenarios.length === 1 ? '' : 's'} to the draft.
                </p>
              )}
              {importResult.problems.length > 0 && (
                <ul className="scProblems">
                  {importResult.problems.map((p) => (
                    <li key={p} className="stFErr">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <Notice
          kind={error.kind === 'info' ? 'info' : 'error'}
          title={error.title}
          actions={
            <button type="button" className="quietButton" onClick={dismissError}>
              Dismiss
            </button>
          }
        >
          {error.body}
          {error.errors?.length > 0 && (
            <ul className="scProblems">
              {error.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {run && (
        <section className="stCard scSummary" aria-label="Current run" role="status">
          <h4>
            {running ? 'Running…' : 'Latest run'}: {formatWhen(run.startedAt)}{' '}
            <span className="scChip idle">{run.ref === 'unsaved' ? 'your unsaved edits' : run.ref || 'draft'}</span>
            {run.runner === 'demo' && <span className="scChip warn">imitation</span>}
          </h4>
          {running && (
            <div className="scProgress" aria-hidden="true">
              <i style={{ width: `${run.total ? Math.round((run.scenarios.length / run.total) * 100) : 5}%` }} />
            </div>
          )}
          <p>
            <b className="scNum good">{run.passed}</b> passed · <b className="scNum bad">{run.failed}</b> failed
            {run.skipped > 0 && (
              <>
                {' '}
                · <b className="scNum">{run.skipped}</b> skipped
              </>
            )}
            {run.errors > 0 && (
              <>
                {' '}
                · <b className="scNum bad">{run.errors}</b> broke
              </>
            )}{' '}
            of {run.total || run.scenarios.length}
            {running && ` (${run.scenarios.length} done)`}.
          </p>
          {!running && runTokens(run) && <p className="stMuted scUsage">Live scenarios used {tokenWords(runTokens(run))}.</p>}
          {!running && testedVersion && (
            <p className="scVersionLine passed">
              This run tested the exact published version <b>{testedVersion.version}</b>.
            </p>
          )}
          {!running && !testedVersion && run.checksum && (
            <p className="stMuted">
              This run tested {run.ref === 'unsaved' ? 'your unsaved edits' : `the ${run.ref || 'draft'}`}, which is not a published version.
            </p>
          )}
          {!running && run.failed + run.errors > 0 && (
            <p className="scFailed">
              Failing:{' '}
              {run.scenarios
                .filter((s) => s.status === 'failed' || s.status === 'error')
                .map((s) => s.id)
                .join(', ')}
            </p>
          )}
          {!running && (
            <button type="button" className="stLink" onClick={clear}>
              Hide this run
            </button>
          )}
        </section>
      )}

      {editing && (
        <section className="stCard">
          <ScenarioForm
            key={editing.index}
            initial={editing.scenario}
            config={config}
            others={scenarios.filter((_, i) => i !== editing.index)}
            isNew={editing.index < 0}
            onCancel={() => setEditing(null)}
            onSave={(savedScenario) => {
              writeTests(editing.index < 0 ? [...scenarios, savedScenario] : scenarios.map((s, i) => (i === editing.index ? savedScenario : s)));
              setEditing(null);
            }}
          />
        </section>
      )}

      <section className="stCard" aria-label="Scenarios">
        {scenarios.length === 0 ? (
          <div className="scEmpty">
            <strong>No scenarios yet</strong>
            <span>
              A scenario is one conversation: what the caller says, and what must be true afterwards (a tool was called, something was said, a state variable
              ended up a certain way, an API request was or wasn’t made).
            </span>
            <button type="button" className="primaryCta compactCta" onClick={() => setEditing({ index: -1, scenario: newScenario(config) })}>
              Write the first one
            </button>
          </div>
        ) : (
          <ul className="scList">
            {scenarios.map((scenario, index) => {
              const live = resultOf(scenario.id);
              const before = earlier(scenario.id);
              const result = live || before?.result || null;
              const isOld = !live && !!before?.result;
              const mode = result?.mode || (Array.isArray(scenario.model_script) && scenario.model_script.length ? 'scripted' : 'live');
              const status = pending(scenario.id) ? 'running' : result?.status;
              const open = !!result && !isOld && ['failed', 'error'].includes(result.status);
              return (
                <li key={`${scenario.id}-${index}`} className="scItem" data-scenario={scenario.id}>
                  <header>
                    <strong>{scenario.id}</strong>
                    <ModeChip mode={mode} />
                    <small>
                      {channelLabel(config, scenario.channel)} · {(scenario.turns || []).length} turn{(scenario.turns || []).length === 1 ? '' : 's'} ·{' '}
                      {(scenario.expect || []).length} expectation{(scenario.expect || []).length === 1 ? '' : 's'}
                    </small>
                    {status ? (
                      <span title={isOld ? `Last run: ${formatWhen(before.ranAt)} (saved draft)` : undefined}>
                        <Chip status={status} />
                      </span>
                    ) : (
                      <span className="scChip idle">Not run</span>
                    )}
                    <span className="scItemActions">
                      <button type="button" className="quietButton" disabled={running || starting} onClick={() => go([scenario.id])}>
                        Run
                      </button>
                      <button
                        type="button"
                        className="quietButton"
                        disabled={!!editing}
                        onClick={() => setEditing({ index, scenario: JSON.parse(JSON.stringify(scenario)) })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="stFDel small"
                        aria-label={`Delete ${scenario.id}`}
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: `Delete the scenario “${scenario.id}”?`,
                            body: 'It is taken out of the draft. Until you save, reloading the draft brings it back.',
                            confirmLabel: 'Delete scenario',
                            tone: 'danger',
                          });
                          if (ok) writeTests(scenarios.filter((_, i) => i !== index));
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </header>
                  {scenario.description && <p className="scDesc">{scenario.description}</p>}
                  <p className="scSaid">{(scenario.turns || []).map(describeTurn).join(' → ')}</p>
                  {result && (
                    <details className={`scLast ${result.status}`} open={open || undefined}>
                      <summary>
                        <Chip status={result.status} />{' '}
                        <small>
                          {isOld ? `from the last run (${formatWhen(before.ranAt)}, saved draft)` : `in the run of ${formatWhen(run?.startedAt)}`} ·{' '}
                          {resultSummary(result)}
                        </small>
                      </summary>
                      <ResultView
                        result={result}
                        scenario={scenario}
                        onEdit={() => setEditing({ index, scenario: JSON.parse(JSON.stringify(scenario)) })}
                        mockAdded={mockAdded[scenario.id] || []}
                        onAddMock={(request) => {
                          writeTests(scenarios.map((s, i) => (i === index ? addMockTo(s, request) : s)));
                          setMockAdded((m) => ({ ...m, [scenario.id]: [...(m[scenario.id] || []), `${request.method || ''} ${request.path}`] }));
                        }}
                      />
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {headlines.length > 0 && (
        <section className="stCard" aria-label="Earlier runs">
          <h4>Earlier runs</h4>
          <ul className="scHistory">
            {headlines.map((h) => (
              <li key={h.id}>
                <button type="button" className={`quietButton ${run?.id === h.id ? 'on' : ''}`} aria-pressed={run?.id === h.id} onClick={() => open(h.id)}>
                  {formatWhen(h.startedAt)} · {h.ref === 'unsaved' ? 'unsaved edits' : h.ref || 'draft'} ·{' '}
                  {h.status === 'running' ? 'running' : `${h.passed}/${h.total} passed${h.failed ? `, ${h.failed} failed` : ''}`}
                </button>
              </li>
            ))}
          </ul>
          <p className="stMuted">Kept by the server. Each run says which exact configuration it tested.</p>
        </section>
      )}
    </div>
  );
}
