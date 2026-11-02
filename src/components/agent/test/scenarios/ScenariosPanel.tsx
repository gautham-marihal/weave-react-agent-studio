import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardPasteIcon, FlaskConicalIcon, LoaderCircleIcon, PencilIcon, PlayIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { Agent, AgentConfig } from '../../../../types/studio';
import { api } from '../../../../api/client';
import { useTestRun } from '../../../../hooks/useTestRun';
import { useVersionConfig } from '../../../../hooks/useVersionConfig';
import { loadFacts } from '../../../../utils/agentFacts';
import { formatDateTime } from '../../../../utils/format';
import { cn, inputClass } from '../../../../utils/styles';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { StatusChip } from '../../../ui/StatusChip';
import { TestsGateSwitch } from '../TestsGateSwitch';
import {
  addMockTo,
  channelTypeOf,
  describeTurn,
  isScripted,
  newScenario,
  parseImport,
  scenariosOf,
  type ImportResult,
  type RequestSeen,
  type ScenarioDef,
} from '../../../../models/scenario';
import {
  isFinished,
  normalizeHeadline,
  normalizeScenarioList,
  refWords,
  resultSummary,
  runTokens,
  testStatusOf,
  tokenWords,
  type Run,
} from '../../../../models/scenarioRuns';
import { ModeChip, Notice, RunChip } from './parts';
import { ResultView } from './ResultView';
import { ScenarioForm } from './ScenarioForm';
import { isSandbox } from '../../../../sandbox/mode';
import { SandboxNoteSlot } from '../../../../sandbox/test/SandboxNoteSlot';

// Test scenarios: written conversations with what must be true afterwards, kept in the draft (`tests`) and run by the
// server. With a model script a run is scripted (free, repeatable); without, it is live (a real model that costs
// money, run only when asked). Edits go into the draft through the draft editor and are saved with it.

interface ScenariosPanelProps {
  editor: DraftEditor;
}

type Paid = 'live' | 'judge';
const channelWords: Record<string, string> = { web_chat: 'web chat', web_voice: 'web voice', sip_voice: 'phone line' };

export function ScenariosPanel({ editor }: ScenariosPanelProps) {
  const agent = editor.agent as Agent;
  const agentId = agent.id;
  const config = editor.config as AgentConfig;
  const scenarios = useMemo(() => scenariosOf(config), [config]);
  const canEdit = editor.canEdit;
  // In Sandbox the runs are played by an imitation in this browser (POST /tests/run is answered there).
  const sandbox = isSandbox();

  // The scenario open in the form, by id (null: a new one), not by position, which a delete or paste can change.
  const [editing, setEditing] = useState<{ id: string | null; scenario: ScenarioDef } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [paid, setPaid] = useState({ live: false, judge: false });
  const [network, setNetwork] = useState(false);
  const [confirm, setConfirm] = useState<Paid | 'network' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[] | null>(null);
  const [mockAdded, setMockAdded] = useState<Record<string, string[]>>({});

  // What the server knows: each saved scenario's last result, and the earlier runs.
  const [saved, setSaved] = useState<ReturnType<typeof normalizeScenarioList> | null>(null);
  const [heads, setHeads] = useState<Run[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tests, runs] = await Promise.all([api.listTests(agentId, { ref: 'draft' }), api.listTestRuns(agentId, 10)]);
      setSaved(normalizeScenarioList(tests));
      setHeads((Array.isArray(runs) ? runs : []).map(normalizeHeadline));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the test results.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFinished = useCallback(
    () => {
      void refresh();
      // The readiness steps, the ship flow and the tests gate read the newest run too.
      void loadFacts(agentId, { force: true });
    },
    [agentId, refresh],
  );
  const { run, running, starting, problem, start, open, clear, dismissProblem } = useTestRun(agentId, { scenarios, onFinished });

  // "This exact version": the newest published version's own scenarios, so a run covering only some is not a pass of all.
  const newest = agent.versions[0];
  const newestConfig = useVersionConfig(agent, newest?.version);
  const newestStatus = newest
    ? testStatusOf(newest, heads.length ? heads : run ? [run] : [], { scenarioCount: scenariosOf(newestConfig.config).length })
    : null;
  const latest = run && isFinished(run.status) ? run : (heads.find((h) => isFinished(h.status)) ?? null);
  const testedVersion = latest?.checksum ? agent.versions.find((v) => v.checksum === latest.checksum) : undefined;

  const writeTests = (next: ScenarioDef[]) => {
    const copy: AgentConfig = { ...config };
    if (next.length) copy.tests = next;
    else delete copy.tests;
    editor.replaceConfig(copy);
  };
  const go = (ids: string[] | null) => {
    setQueued(ids);
    setMockAdded({});
    // A run tests exactly what is in the editor: unsaved edits go as `config` (the run's ref is then "unsaved").
    return start({
      ...(editor.dirty ? { config } : { ref: 'draft' }),
      ...(ids ? { scenarios: ids } : {}),
      ...(paid.live ? { live: true } : {}),
      ...(paid.judge ? { judge: true } : {}),
      ...(network ? { allow_network: true } : {}),
    });
  };
  const liveCount = scenarios.filter((s) => !isScripted(s)).length;
  const tokens = run ? runTokens(run) : null;
  const resultOf = (id: string) => run?.scenarios.find((r) => r.id === id) ?? null;
  const earlier = (id: string) => saved?.items.find((i) => i.scenario.id === id) ?? null;
  const pending = (id: string) => running && (!queued || queued.includes(id)) && !resultOf(id);
  const busy = running || starting;
  const onConfirm = () => {
    if (confirm === 'network') setNetwork(true);
    else if (confirm) setPaid((p) => ({ ...p, [confirm]: true }));
    setConfirm(null);
  };

  const addImport = () => {
    const result = parseImport(importText, config);
    setImportResult(result);
    if (result.scenarios.length) writeTests([...scenarios, ...result.scenarios]);
    // What was added (or already there) leaves the box, so "Add them" again adds nothing twice.
    if (result.rejected && (result.scenarios.length || result.already.length)) {
      if (result.rejected.length) setImportText(JSON.stringify(result.rejected, null, 2));
      else setImportText('');
    }
  };

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-surface p-4">
        <div className="max-w-2xl">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            Test scenarios
            {sandbox && (
              <StatusChip tone="warning" title="Which runner plays the scenarios">
                Sandbox imitation
              </StatusChip>
            )}
          </h2>
          {sandbox ? (
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              Write down conversations and what must be true afterwards, run them, and see which fail and why. They are part of the draft (
              <code className="font-mono">tests</code>), so they are saved and versioned with it.
            </p>
          ) : (
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            Write down conversations and what must be true afterwards, run them, and see which fail and why. They are part of the draft (
            <code className="font-mono">tests</code>), so they are saved and versioned with it. A scenario never calls a real API: the mocks you write answer
            the agent’s requests
            {saved?.networkAllowed ? ' (this server lets a run reach real systems when asked)' : ''}. Scenarios with a model script are free and repeatable; the
            others are live and only run when you include them.
          </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Refresh results
          </Button>
          <Button variant="secondary" size="sm" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)} disabled={!canEdit}>
            <ClipboardPasteIcon className="h-3.5 w-3.5" aria-hidden />
            Paste scenarios…
          </Button>
          <Button variant="secondary" size="sm" disabled={!!editing || !canEdit} onClick={() => setEditing({ id: null, scenario: newScenario(config) })}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            New scenario
          </Button>
          <Button variant="primary" size="sm" disabled={!scenarios.length || busy} onClick={() => void go(null)}>
            {busy ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PlayIcon className="h-3.5 w-3.5" aria-hidden />}
            {starting ? 'Starting…' : running ? 'Running…' : `Run all (${scenarios.length})`}
            {!sandbox && (paid.live || paid.judge) ? ' · uses a paid model' : ''}
            {network ? ' · real requests' : ''}
          </Button>
        </div>
      </section>
      <SandboxNoteSlot kind="scenarios" />

      <TestsGateSwitch agentId={agentId} />

      {editor.dirty && (
        <Notice
          tone="info"
          title="Runs use your edits, saved or not"
          actions={
            canEdit && (
              <Button size="sm" variant="secondary" onClick={() => void editor.save()} disabled={!editor.canSave}>
                Save draft
              </Button>
            )
          }
        >
          The scenarios and everything else you changed are in the editor but not saved. A run tests exactly what is in the editor, and its result is marked
          “your unsaved edits”.
        </Notice>
      )}

      {newest && newestStatus && !newestConfig.loading && (
        <p
          role="status"
          className={cn(
            'rounded-lg border px-3 py-2 text-[13px]',
            newestStatus.state === 'passed'
              ? 'border-success/30 bg-success-soft/40 text-ink'
              : newestStatus.state === 'failed'
                ? 'border-danger/30 bg-danger-soft/40 text-ink'
                : 'border-line bg-subtle/50 text-ink-soft',
          )}
        >
          <strong className="text-ink">Version {newest.version}</strong>:{' '}
          {newestStatus.state === 'passed'
            ? newestStatus.run && newestStatus.run.skipped > 0
              ? `the scenarios that ran passed on this exact version (${newestStatus.run.skipped} not run).`
              : 'these scenarios passed on this exact version.'
            : newestStatus.state === 'partial'
              ? `the latest run covered only some of the scenarios on this exact version (${newestStatus.text}).`
              : newestStatus.state === 'failed'
                ? `the latest run on this exact version ${newestStatus.text === 'Broke' ? 'broke' : 'failed'}.`
                : 'no run has tested this exact version yet.'}
        </p>
      )}

      {/* In Sandbox nothing is paid and nothing reaches a real system: the imitation plays live scenarios when they are
          included, never grades reviewer checks, and has no real requests to allow. */}
      {sandbox ? (
        <details className="rounded-xl border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">Run options{paid.live ? ' (on)' : ''}</summary>
          <div className="space-y-3 border-t border-line px-4 py-3 text-[13px] text-ink-soft">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
                checked={paid.live}
                aria-label="Include live scenarios"
                onChange={(e) => setPaid((p) => ({ ...p, live: e.target.checked }))}
              />
              <span>
                <strong className="text-ink">Include live scenarios</strong> ({liveCount} of {scenarios.length}). In Sandbox the imitation plays them too, and nothing
                is billed. Without this they are skipped, as they are with a real runtime.
              </span>
            </label>
          </div>
        </details>
      ) : (
      <details className="rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">
          Paid and real-request options{paid.live || paid.judge || network ? ' (on)' : ''}
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-3 text-[13px] text-ink-soft">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
              checked={paid.live}
              aria-label="Include live scenarios"
              onChange={(e) => (e.target.checked ? setConfirm('live') : setPaid((p) => ({ ...p, live: false })))}
            />
            <span>
              <strong className="text-ink">Include live scenarios</strong> ({liveCount} of {scenarios.length}). They use a real language model:{' '}
              <strong className="text-ink">this costs money</strong> and the result can differ from run to run. Without this they are skipped.
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
              checked={paid.judge}
              aria-label="Grade reviewer checks"
              onChange={(e) => (e.target.checked ? setConfirm('judge') : setPaid((p) => ({ ...p, judge: false })))}
            />
            <span>
              <strong className="text-ink">Grade “a reviewer would agree that…” checks.</strong> A model grades each one:{' '}
              <strong className="text-ink">this costs money</strong>. A scenario with a model script can’t be graded.
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
              checked={network}
              aria-label="Let requests reach real systems"
              onChange={(e) => (e.target.checked ? setConfirm('network') : setNetwork(false))}
            />
            <span>
              <strong className="text-ink">Let requests reach real systems</strong> (for operators). Scenarios normally never call a real API; with this on they
              can, and a request can <strong className="text-ink">change real data</strong>. The server refuses it unless an operator has allowed it.
            </span>
          </label>
          <p className="text-xs text-muted">These stay on only while this page is open. Nothing runs until you press a Run button.</p>
        </div>
      </details>
      )}

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'live' ? 'Run live scenarios?' : confirm === 'judge' ? 'Grade reviewer checks?' : 'Let runs send requests to real systems?'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Not now
            </Button>
            <Button variant={confirm === 'network' ? 'danger' : 'primary'} onClick={onConfirm}>
              {confirm === 'live' ? 'Include live scenarios' : confirm === 'judge' ? 'Grade them' : 'Allow real requests'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          {confirm === 'live'
            ? 'A live scenario talks to a real language model, so each run is billed by the model’s provider and the answers can differ every time. A scripted scenario never needs one.'
            : confirm === 'judge'
              ? 'Each reviewer check is graded by a language model, so each run is billed by the model’s provider.'
              : 'A scenario normally never calls a real API: its mocks answer. With this on, a request can change real data. The server refuses it unless an operator has allowed it.'}
        </p>
      </Dialog>

      {importOpen && (
        <section className="space-y-2 rounded-xl border border-line bg-surface p-4" aria-label="Paste scenarios">
          <label className="block text-xs font-medium text-muted">
            Paste a list of scenarios as JSON
            <textarea
              className={cn(inputClass, 'mt-1 font-mono text-xs')}
              rows={6}
              value={importText}
              spellCheck={false}
              aria-label="Scenarios as JSON"
              placeholder='[{ "id": "asks_for_a_person", "channel": "web-chat", "turns": [{ "say": "Can I speak to someone?" }], "expect": [{ "tool_called": "escalate_to_human" }] }]'
              onChange={(e) => {
                setImportText(e.target.value);
                setImportResult(null);
              }}
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={!importText.trim()} onClick={addImport}>
              Add them
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>
              Close
            </Button>
          </div>
          {importResult && (
            <div role="status" className="space-y-1 text-[13px]">
              {importResult.scenarios.length > 0 && (
                <p className="text-success">
                  Added {importResult.scenarios.length} scenario{importResult.scenarios.length === 1 ? '' : 's'} to the draft (not saved yet).
                  {importResult.problems.length > 0 && ' The box keeps only the ones below, to fix and add.'}
                </p>
              )}
              {importResult.already.length > 0 && (
                <p className="text-muted">
                  {importResult.already.length === 1 ? `“${importResult.already[0]}” is` : `${importResult.already.length} of them are`} in the draft already,
                  so {importResult.already.length === 1 ? 'it was' : 'they were'} not added again.
                </p>
              )}
              {importResult.problems.length > 0 && (
                <ul className="space-y-0.5 text-danger">
                  {importResult.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {problem && (
        <Notice
          tone={problem.tone === 'info' ? 'info' : 'danger'}
          title={problem.title}
          actions={
            <Button size="sm" variant="ghost" onClick={dismissProblem}>
              Dismiss
            </Button>
          }
        >
          {problem.body}
          {problem.errors && problem.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problem.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {loadError && (
        <Notice
          tone="warning"
          title="The last results could not be read"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Notice>
      )}

      {run && (
        <section role="status" aria-label="Current run" className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{running ? 'Running…' : 'Latest run'}</h3>
            <RunChip status={run.status} />
            <StatusChip>{run.ref === 'unsaved' ? 'your unsaved edits' : run.ref || 'draft'}</StatusChip>
            {run.startedAt && <span className="text-xs text-muted">{formatDateTime(run.startedAt)}</span>}
          </div>
          {running && (
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${run.total ? Math.max(5, Math.round((run.scenarios.length / run.total) * 100)) : 5}%` }}
              />
            </div>
          )}
          <p className="text-[13px] text-ink-soft" data-testid="run-counts">
            <strong className="text-success">{run.passed}</strong> passed · <strong className="text-danger">{run.failed}</strong> failed
            {run.skipped > 0 && <> · {run.skipped} skipped</>}
            {run.errors > 0 && (
              <>
                {' '}
                · <strong className="text-danger">{run.errors}</strong> broke
              </>
            )}{' '}
            of {run.total || run.scenarios.length}
            {running && ` (${run.scenarios.length} done)`}.
          </p>
          {!running && tokens && <p className="text-xs text-muted">Live scenarios used {tokenWords(tokens)}.</p>}
          {!running && testedVersion && <p className="text-xs text-success">This run tested the exact published version {testedVersion.version}.</p>}
          {!running && !testedVersion && run.checksum && (
            <p className="text-xs text-muted">This run tested {refWords(run.ref)}, which is not a published version.</p>
          )}
          {!running && (
            <Button size="sm" variant="ghost" onClick={clear}>
              Hide this run
            </Button>
          )}
        </section>
      )}

      {editing && (
        <section className="rounded-xl border border-accent/40 bg-surface p-4">
          <ScenarioForm
            key={editing.id ?? '(new)'}
            initial={editing.scenario}
            config={config}
            isNew={editing.id === null}
            others={scenarios.filter((s) => editing.id === null || s.id !== editing.id)}
            onCancel={() => setEditing(null)}
            onSave={(value) => {
              // Put back in place (by id); a new one, or one removed meanwhile, goes at the end.
              const at = editing.id === null ? -1 : scenarios.findIndex((s) => s.id === editing.id);
              writeTests(at < 0 ? [...scenarios, value] : scenarios.map((s, i) => (i === at ? value : s)));
              setEditing(null);
            }}
          />
        </section>
      )}

      <section aria-label="Scenarios" className="rounded-xl border border-line bg-surface">
        {scenarios.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FlaskConicalIcon className="mx-auto h-8 w-8 text-muted" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold text-ink">No scenarios yet</h3>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              A scenario is one conversation: what the caller says, and what must be true afterwards (a tool was used, something was said, a value was
              remembered, an API request was or wasn’t made).
            </p>
            {canEdit && (
              <Button className="mt-4" variant="primary" size="sm" disabled={!!editing} onClick={() => setEditing({ id: null, scenario: newScenario(config) })}>
                Write the first one
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {scenarios.map((scenario, index) => {
              const fresh = resultOf(scenario.id);
              const before = earlier(scenario.id);
              const result = fresh ?? before?.result ?? null;
              const isOld = !fresh && !!before?.result;
              const mode = result?.mode ?? (isScripted(scenario) ? 'scripted' : 'live');
              const status = pending(scenario.id) ? 'running' : result?.status;
              const turns = Array.isArray(scenario.turns) ? scenario.turns : [];
              const expectations = Array.isArray(scenario.expect) ? scenario.expect : [];
              const type = channelTypeOf(config, scenario.channel);
              return (
                <li key={`${scenario.id}-${index}`} className="px-4 py-3" data-scenario={scenario.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-mono text-[13px] text-ink">{scenario.id}</strong>
                    <ModeChip mode={mode} />
                    <span className="text-xs text-muted">
                      {scenario.channel}
                      {channelWords[type] ? ` (${channelWords[type]})` : ''} · {turns.length} turn{turns.length === 1 ? '' : 's'} · {expectations.length} check
                      {expectations.length === 1 ? '' : 's'}
                    </span>
                    <RunChip status={status} title={isOld && before?.ranAt ? `Last run ${formatDateTime(before.ranAt)} (saved draft)` : undefined} />
                    <span className="ml-auto flex items-center gap-1">
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void go([scenario.id])} aria-label={`Run ${scenario.id}`}>
                        <PlayIcon className="h-3 w-3" aria-hidden />
                        Run
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!editing || !canEdit}
                        aria-label={`Edit ${scenario.id}`}
                        onClick={() => setEditing({ id: scenario.id, scenario: JSON.parse(JSON.stringify(scenario)) as ScenarioDef })}
                      >
                        <PencilIcon className="h-3 w-3" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={editing?.id === scenario.id || !canEdit}
                        aria-label={`Delete ${scenario.id}`}
                        onClick={() => setDeleting(scenario.id)}
                      >
                        <Trash2Icon className="h-3 w-3" aria-hidden />
                      </Button>
                    </span>
                  </div>
                  {scenario.description && <p className="mt-1 text-[13px] text-ink-soft">{scenario.description}</p>}
                  <p className="mt-1 truncate text-xs text-muted">{turns.map(describeTurn).join(' → ')}</p>
                  {result && (
                    <details className="mt-2 rounded-lg border border-line" open={!isOld && (result.status === 'failed' || result.status === 'error')}>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
                        <RunChip status={result.status} />
                        <span className="text-muted">
                          {isOld ? `From the last run${before?.ranAt ? ` (${formatDateTime(before.ranAt)}, saved draft)` : ''}` : 'In this run'} ·{' '}
                          {resultSummary(result)}
                        </span>
                      </summary>
                      <div className="border-t border-line p-3">
                        <ResultView
                          result={result}
                          scenario={scenario}
                          mockAdded={mockAdded[scenario.id] ?? []}
                          onEdit={canEdit ? () => setEditing({ id: scenario.id, scenario: JSON.parse(JSON.stringify(scenario)) as ScenarioDef }) : undefined}
                          // Not while it is open in the form, whose Save would put it back as it was.
                          onAddMock={
                            !canEdit || editing?.id === scenario.id
                              ? null
                              : (request: RequestSeen) => {
                                  writeTests(scenarios.map((s, i) => (i === index ? addMockTo(s, request) : s)));
                                  setMockAdded((m) => ({ ...m, [scenario.id]: [...(m[scenario.id] ?? []), `${request.method ?? ''} ${request.path}`.trim()] }));
                                }
                          }
                        />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {heads.length > 0 && (
        <section aria-label="Earlier runs" className="rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink">Earlier runs</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {heads.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  aria-pressed={run?.id === h.id}
                  onClick={() => void open(h.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    run?.id === h.id ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:bg-subtle',
                  )}
                >
                  {h.startedAt ? formatDateTime(h.startedAt) : h.id} · {h.ref === 'unsaved' ? 'unsaved edits' : h.ref || 'draft'} ·{' '}
                  {h.status === 'running' ? 'running' : `${h.passed}/${h.total} passed${h.failed ? `, ${h.failed} failed` : ''}`}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Kept by the server. Each run says which exact configuration it tested.</p>
        </section>
      )}

      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete the scenario “${deleting ?? ''}”?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                writeTests(scenarios.filter((s) => s.id !== deleting));
                setDeleting(null);
              }}
            >
              Delete scenario
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">It is taken out of the draft. Until you save, Undo brings it back.</p>
      </Dialog>
    </div>
  );
}
