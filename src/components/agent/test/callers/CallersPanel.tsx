import React, { useEffect, useMemo, useState } from 'react';
import { CheckIcon, LoaderCircleIcon, PhoneIncomingIcon, TriangleAlertIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { AgentConfig } from '../../../../types/studio';
import { useTestRun } from '../../../../hooks/useTestRun';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { cn } from '../../../../utils/styles';
import { DEFAULT_CALLERS, configWithScenarios, expectationLines, suggestions, type Suggestion } from '../../../../models/callers';
import { scenariosOf } from '../../../../models/scenario';
import { isFinished, type ScenarioResult } from '../../../../models/scenarioRuns';
import { Notice } from '../scenarios/parts';
import { ResultView } from '../scenarios/ResultView';
import { isSandbox } from '../../../../sandbox/mode';
import { SandboxNoteSlot } from '../../../../sandbox/test/SandboxNoteSlot';

// Scripted callers: ready-made people who phone the draft (someone cross, someone who rambles, someone who wants a
// person), plus checks made from what the agent has. They run on the server against what is in the editor (sent as
// `config`, so nothing is saved), and the good ones can be kept as tests. What they say is written in advance and does
// not follow the agent's answers; the reviewer checks (calm? on topic?) need the live model.

type Shown = { word: string; tone: 'success' | 'danger' | 'neutral'; icon?: 'check' | 'alert' };
const SHOWN: Record<string, Shown> = {
  passed: { word: 'Passed', tone: 'success', icon: 'check' },
  basic: { word: 'Basic checks passed', tone: 'success', icon: 'check' },
  failed: { word: 'Needs a look', tone: 'danger', icon: 'alert' },
  error: { word: 'Could not run', tone: 'danger', icon: 'alert' },
  skipped: { word: 'Not run', tone: 'neutral' },
};

export function CallersPanel({ editor }: { editor: DraftEditor }) {
  const agentId = editor.agent?.id ?? '';
  const config = editor.config as AgentConfig;
  const all = useMemo(() => suggestions(config), [config]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && all.length && picked.size === 0)
      setPicked(new Set(all.filter((s) => s.group === 'check' || DEFAULT_CALLERS.includes(s.key)).map((s) => s.key)));
  }, [all, touched, picked.size]);
  const [paid, setPaid] = useState(false);
  const [judge, setJudge] = useState(false);
  const [queued, setQueued] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState('');
  const [justKept, setJustKept] = useState<string[]>([]);

  const queuedScenarios = useMemo(() => queued.map((s) => s.scenario), [queued]);
  const { run, running, starting, problem, start, clear } = useTestRun(agentId, { scenarios: queuedScenarios });
  const chosen = all.filter((s) => picked.has(s.key));
  const needsJudge = chosen.some((s) => s.needsJudge);
  const busy = running || starting;
  // In Sandbox the callers are played by its imitation, which costs nothing, so nothing asks about cost.
  const sandbox = isSandbox();
  const canRun = chosen.length > 0 && !busy && (sandbox || paid);
  const tests = scenariosOf(config);
  const isKept = (s: Suggestion) => s.kept || tests.some((t) => t.id === s.scenario.id);

  const toggle = (key: string) => {
    setTouched(true);
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const go = async () => {
    setTouched(true);
    clear();
    setOpen('');
    setJustKept([]);
    setQueued(chosen);
    // Played from the editor's contents plus these callers: nothing is saved, so trying callers changes nothing.
    await start({
      config: configWithScenarios(
        config,
        chosen.map((s) => s.scenario),
      ),
      scenarios: chosen.map((s) => s.scenario.id),
      live: true,
      ...(judge && needsJudge ? { judge: true } : {}),
    });
  };
  const resultOf = (s: Suggestion): ScenarioResult | null => run?.scenarios.find((r) => r.id === s.scenario.id) ?? null;
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

  // Kept tests go into the draft through the editor, unsaved, like any other edit.
  const keep = (items: Suggestion[]) => {
    const have = new Set(tests.map((t) => t.id));
    const add = items.filter((s) => !have.has(s.scenario.id)).map((s) => s.scenario);
    if (!add.length) return;
    editor.replaceConfig({ ...config, tests: [...tests, ...add] });
    setJustKept(add.map((t) => t.id));
  };

  const group = (id: Suggestion['group'], title: string, lead: string) => (
    <section aria-label={title} className="rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs text-muted">{lead}</p>
      </header>
      <ul className="divide-y divide-line">
        {all
          .filter((s) => s.group === id)
          .map((s) => {
            const result = resultOf(s);
            const waiting = running && queued.some((q) => q.key === s.key) && !result;
            const ungraded = result && result.status === 'passed' ? result.checks.filter((c) => c.passed === null).length : 0;
            const shown = result ? (ungraded ? SHOWN.basic : (SHOWN[result.status] ?? SHOWN.skipped)) : null;
            const expanded = open === s.key;
            return (
              <li key={s.key} data-key={s.key} className={cn('px-4 py-3', picked.has(s.key) && 'bg-accent-soft/20')}>
                <div className="flex flex-wrap items-start gap-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                      checked={picked.has(s.key)}
                      onChange={() => toggle(s.key)}
                      disabled={busy}
                      aria-label={s.name}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{s.name}</span>
                      <span className="block text-xs text-muted">{s.blurb}</span>
                    </span>
                  </label>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {waiting && (
                      <StatusChip tone="info">
                        <LoaderCircleIcon className="h-3 w-3 animate-spin" aria-hidden />
                        Running…
                      </StatusChip>
                    )}
                    {shown && (
                      <span data-result={shown.word}>
                        <StatusChip tone={shown.tone}>
                          {shown.icon === 'check' ? (
                            <CheckIcon className="h-3 w-3" aria-hidden />
                          ) : shown.icon === 'alert' ? (
                            <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                          ) : null}
                          {shown.word}
                        </StatusChip>
                      </span>
                    )}
                    {isKept(s) && <StatusChip tone="accent">A test</StatusChip>}
                    {s.needsJudge && !shown && <StatusChip title="One of its checks is graded by a reviewer, which needs the live model">reviewer</StatusChip>}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : s.key)}>
                      {result ? 'Details' : 'What it says'}
                      <span className="sr-only">: {s.name}</span>
                    </Button>
                    {!isKept(s) && editor.canEdit && (
                      <Button size="sm" variant="secondary" onClick={() => keep([s])}>
                        Keep as a test<span className="sr-only">: {s.name}</span>
                      </Button>
                    )}
                  </span>
                </div>
                {expanded && (
                  <div className="mt-3 space-y-3 rounded-lg border border-line bg-canvas/50 p-3 text-[13px]" data-detail={s.key}>
                    <div>
                      <p className="text-xs font-semibold text-muted">The caller says</p>
                      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink-soft">
                        {s.scenario.turns.map((t, i) => (
                          <li key={i}>{t.say}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted">What should hold afterwards</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
                        {expectationLines(s.scenario).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </div>
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
    <div className="space-y-5">
      <section className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <PhoneIncomingIcon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
          <h2 className="text-sm font-semibold text-ink">Scripted callers</h2>
          <p>
            Ready-made callers try what is in the editor and show where the agent struggles: someone cross, someone who rambles, someone who asks for a person.
            Below them are checks made from what the agent has (its tools, its goodbye). Running them saves nothing.
          </p>
          <p className="mt-1">
            Each caller’s words are written in advance, so they do not change with the agent’s answers. They are a quick way to meet the cases that usually go
            wrong.
          </p>
        </div>
      </section>

      {group('caller', 'Callers', 'People who phone in. Pick the ones to try.')}
      {group('check', 'Checks from what the agent has', 'Made from its tools and its goodbye. Each says whether the agent does what its setup promises.')}

      <section aria-label="Run" className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => void go()} disabled={!canRun}>
            {busy && <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {starting ? 'Starting…' : running ? 'Running…' : `Try ${chosen.length} on the draft`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              setPicked(new Set(all.map((s) => s.key)));
            }}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              setPicked(new Set());
            }}
          >
            Clear
          </Button>
          <span className="text-xs text-muted" data-testid="caller-count">
            {chosen.length} of {all.length} chosen
          </span>
        </div>
        {sandbox ? (
          <SandboxNoteSlot kind="callers" />
        ) : (
        <>
        <label className="flex items-start gap-2.5 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            aria-label="These use the live model and cost money"
          />
          <span>
            These run on the real agent with its live language model. <strong className="text-ink">That costs money</strong>, a few calls’ worth for each one
            picked.
          </span>
        </label>
        {needsJudge && (
          <label className="flex items-start gap-2.5 text-[13px] text-ink-soft">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
              checked={judge}
              onChange={(e) => setJudge(e.target.checked)}
              aria-label="Also grade the judgement checks"
            />
            <span>
              Also let a reviewer grade the judgement checks (calm, on topic, polite). This uses the live model again; without it those checks are shown as not
              checked.
            </span>
          </label>
        )}
        </>
        )}
      </section>

      {problem && (
        <Notice tone={problem.tone === 'info' ? 'info' : 'danger'} title={problem.title}>
          {problem.body}
        </Notice>
      )}
      {finished && counts && (
        <Notice
          tone={counts.attention ? 'warning' : 'success'}
          title={counts.attention ? `${counts.attention} of ${queued.length} need a look` : `All ${queued.length - counts.skipped} that ran passed`}
          actions={
            editor.canEdit &&
            queued.some((s) => resultOf(s)?.status === 'passed' && !isKept(s)) && (
              <Button size="sm" variant="secondary" onClick={() => keep(queued.filter((s) => resultOf(s)?.status === 'passed'))}>
                Keep the ones that passed as tests
              </Button>
            )
          }
        >
          {counts.passed} passed{counts.ungraded ? ` (${counts.ungraded} of them without the reviewer’s judgement, which was not graded)` : ''}
          {counts.skipped ? `, ${counts.skipped} not run` : ''}. Open Details on a caller to see what it said and why.
        </Notice>
      )}
      {justKept.length > 0 && (
        <Notice tone="info" title={`Added ${justKept.length === 1 ? 'a test' : `${justKept.length} tests`} to the draft, not saved yet`}>
          {justKept.join(', ')}. They run with the other scenarios from now on. Save the draft to keep them.
        </Notice>
      )}
    </div>
  );
}
