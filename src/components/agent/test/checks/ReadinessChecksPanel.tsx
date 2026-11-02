import React, { useState } from 'react';
import { CheckIcon, ClipboardCheckIcon, LoaderCircleIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import type { Agent } from '../../../../types/studio';
import { api } from '../../../../api/client';
import { READINESS_CHECKS, checkRunOf, keepRuns, runReadinessChecks, type CheckRun } from '../../../../models/checks';
import { formatDateTime, randomHex } from '../../../../utils/format';
import { cn } from '../../../../utils/styles';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { Notice, Select } from '../scenarios/parts';

// Readiness checks: the saved draft or a published version read against everyday situations (a greeting, ending the
// call, reaching a person, a caller who goes quiet) before going live. Nothing is run and no call is placed. The run
// history is kept in this browser: the server has no store for it.

const storageKey = (agentId: string) => `weave_readiness_checks_${agentId}`;

function readHistory(agentId: string): CheckRun[] {
  try {
    return keepRuns(JSON.parse(localStorage.getItem(storageKey(agentId)) ?? '[]'));
  } catch {
    return [];
  }
}

function writeHistory(agentId: string, runs: CheckRun[]) {
  try {
    localStorage.setItem(storageKey(agentId), JSON.stringify(keepRuns(runs)));
  } catch {
    // Storage full or blocked: the run still shows until the page is left.
  }
}

export function ReadinessChecksPanel({ agent }: { agent: Agent }) {
  const options = [
    { value: 'draft', label: 'The saved draft' },
    ...agent.versions.map((v, i) => ({ value: v.version, label: `Version ${v.version}${i === 0 ? ' (latest)' : ''}` })),
  ];
  const [target, setTarget] = useState('draft');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<CheckRun[]>(() => readHistory(agent.id));
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    if (running) return;
    const option = options.find((o) => o.value === target) ?? options[0];
    setRunning(true);
    setError('');
    try {
      const config = option.value === 'draft' ? (await api.getDraft(agent.id)).config : (await api.getVersion(agent.id, option.value)).config;
      const record = checkRunOf(
        agent.id,
        option.value,
        option.label.replace(' (latest)', ''),
        runReadinessChecks(config),
        new Date().toISOString(),
        `check_${Date.now().toString(36)}${randomHex(4)}`,
      );
      const next = keepRuns([record, ...history]);
      setHistory(next);
      writeHistory(agent.id, next);
      setOpen(record.id);
    } catch (e) {
      setError(`Couldn’t read that configuration: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <ClipboardCheckIcon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink">Readiness checks</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              Read {agent.name}’s configuration against everyday situations before you put it live: a greeting, a way to end the call, reaching a person, a
              caller who goes quiet. These checks only read what is set up. No conversation is run and no call is placed. To talk to the agent, use the
              conversation; to run the conversations it must always get right, use Scenarios.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Check
            <Select className="w-56" label="Which version to check" value={target} options={options} onChange={setTarget} />
          </label>
          <Button variant="primary" size="sm" onClick={() => void run()} disabled={running}>
            {running && <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {running ? 'Checking…' : `Run ${READINESS_CHECKS.length} checks`}
          </Button>
        </div>
        {error && (
          <Notice tone="danger" title="Couldn’t run the checks">
            {error}
          </Notice>
        )}
      </section>

      {history.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
          <ClipboardCheckIcon className="mx-auto h-8 w-8 text-muted" aria-hidden />
          <h3 className="mt-3 text-sm font-semibold text-ink">No checks run yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
            Run the {READINESS_CHECKS.length} checks above to see how {agent.name} handles everyday situations. Every run is kept here to compare.
          </p>
        </div>
      ) : (
        <section aria-label="Earlier checks" className="rounded-xl border border-line bg-surface">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Earlier checks</h3>
            <span className="text-xs text-muted">Kept in this browser</span>
          </header>
          <ul className="divide-y divide-line">
            {history.map((item) => {
              const isOpen = open === item.id;
              const all = item.passed === item.total;
              return (
                <li key={item.id} data-check-run={item.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : item.id)}
                    className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors duration-150 hover:bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                  >
                    <StatusChip tone={all ? 'success' : 'warning'}>
                      {all ? <CheckIcon className="h-3 w-3" aria-hidden /> : <TriangleAlertIcon className="h-3 w-3" aria-hidden />}
                      Passed {item.passed} of {item.total}
                    </StatusChip>
                    <strong className="text-[13px] text-ink">{item.targetLabel}</strong>
                    <time className="ml-auto text-xs text-muted" dateTime={item.ranAt}>
                      {formatDateTime(item.ranAt)}
                    </time>
                  </button>
                  {isOpen && (
                    <ul className="space-y-1.5 px-4 pb-4" aria-label="Results">
                      {item.results.map((result) => (
                        <li key={result.id} className="flex items-start gap-2" data-passed={String(result.passed)}>
                          <span
                            aria-hidden
                            className={cn(
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                              result.passed ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                            )}
                          >
                            {result.passed ? <CheckIcon className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
                          </span>
                          <span className="text-[13px]">
                            <span className="font-medium text-ink">{result.name}</span>
                            <span className="block text-xs text-muted">{result.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
