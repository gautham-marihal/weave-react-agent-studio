import React, { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, CircleAlertIcon, CircleCheckIcon, KeyRoundIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import type { AgentConfig, Issue } from '../../../../types/studio';
import type { ValidationView } from '../../../../utils/serverValidation';
import { describePath } from '../../../../utils/validate';
import { secretState } from '../../../../utils/providerOptions';
import { useSecretKeys } from '../../../../hooks/useProviders';
import { BUILD_SECTIONS, sectionOfPath } from '../../../../models/agentPages';
import { remedyFor, targetOfPath, type FlowGraph } from '../../../../models/workflow';
import { captionOf } from './look';
import { cn } from '../../../../utils/styles';

interface ChecksPanelProps {
  view: ValidationView;
  config: AgentConfig;
  graph: FlowGraph;
  open: boolean;
  onToggle: () => void;
  /** Go to what a problem is about: its block on the canvas, or the setting elsewhere. */
  onShow: (issue: Issue) => void;
}

type Tab = 'problems' | 'unsupported' | 'secrets';
interface Row {
  issue: Issue;
  tone: 'danger' | 'warning';
}
interface Group {
  key: string;
  title: string;
  caption: string;
  rows: Row[];
}

/**
 * The server's checks on what is in the editor (POST /validate, run again 500 ms after each change, and by Save), along
 * the foot of the canvas. Grouped by the block each problem is about; the server decides what can be published.
 */
export function ChecksPanel({ view, config, graph, open, onToggle, onShow }: ChecksPanelProps) {
  const keys = useSecretKeys();
  const [tab, setTab] = useState<Tab>('problems');
  const report = view.report ?? view.previous;
  const checking = view.status === 'checking' || view.status === 'unknown';
  const errors = report?.errors.length ?? 0;
  const warnings = report?.warnings.length ?? 0;
  const unsupported = report?.unsupported.length ?? 0;
  const secrets = report?.secrets_required.length ?? 0;

  const groups = useMemo<Group[]>(() => {
    if (!report) return [];
    const byKey = new Map<string, Group>();
    const rows: Row[] = [...report.errors.map((issue) => ({ issue, tone: 'danger' as const })), ...report.warnings.map((issue) => ({ issue, tone: 'warning' as const }))];
    rows.forEach((row) => {
      const target = targetOfPath(row.issue.path, config);
      const node = target ? graph.nodes.find((n) => n.id === target.node) : undefined;
      let group: Pick<Group, 'key' | 'title' | 'caption'>;
      if (node) group = { key: node.id, title: node.label, caption: captionOf(node) };
      else {
        const section = sectionOfPath(row.issue.path);
        const label = BUILD_SECTIONS.find((s) => s.id === section)?.label;
        group = row.issue.path ? { key: `section:${section}`, title: label ?? 'Settings', caption: 'Not on the canvas' } : { key: 'general', title: 'The whole agent', caption: 'No single setting' };
      }
      const g = byKey.get(group.key) ?? { ...group, rows: [] };
      g.rows.push(row);
      byKey.set(group.key, g);
    });
    const weight = (g: Group) => g.rows.filter((r) => r.tone === 'danger').length * 1000 + g.rows.length;
    return [...byKey.values()].sort((a, b) => weight(b) - weight(a));
  }, [report, config, graph]);

  const status = !report ?
  view.status === 'failed' ? 'The server’s checks could not be run' : 'Checking…' :
  checking ? 'Checking…' : view.status === 'failed' ? 'Could not check the latest changes' : 'Checked by the server';

  return (
    <section aria-labelledby="canvas-checks-title" className="shrink-0 border-t border-line bg-surface">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="canvas-checks-body"
          className="flex items-center gap-1.5 rounded px-1 text-[13px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {open ? <ChevronDownIcon className="h-4 w-4" aria-hidden /> : <ChevronUpIcon className="h-4 w-4" aria-hidden />}
          <span id="canvas-checks-title">Checks</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          {report &&
          <>
              <Count tone="danger" n={errors} word="error" />
              <Count tone="warning" n={warnings} word="warning" />
              {unsupported > 0 && <Count tone="neutral" n={unsupported} word="not run yet" plural="not run yet" />}
              {report.valid && errors === 0 &&
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                  <CircleCheckIcon className="h-3.5 w-3.5" aria-hidden />
                  Passed
                </span>
            }
            </>
          }
          <span className="flex items-center gap-1 text-xs text-muted">
            {checking && <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {status}
          </span>
        </div>
        <span className="ml-auto hidden text-xs text-muted md:inline">{errors > 0 ? 'Saving works; the server won’t publish until errors are fixed.' : 'The server decides what can be published.'}</span>
      </div>

      {open &&
      <div id="canvas-checks-body" className="border-t border-line">
          <div role="tablist" aria-label="Checks" className="flex gap-1 border-b border-line px-3 pt-1.5">
            <TabButton id="problems" tab={tab} setTab={setTab}>Problems{report ? ` (${errors + warnings})` : ''}</TabButton>
            <TabButton id="unsupported" tab={tab} setTab={setTab}>Not run yet ({unsupported})</TabButton>
            <TabButton id="secrets" tab={tab} setTab={setTab}>Secrets ({secrets})</TabButton>
          </div>
          <div className={cn('h-52 max-h-[34vh] overflow-y-auto overscroll-contain px-3 py-2 transition-opacity', checking && report && 'opacity-60')}>
            {!report && view.status === 'failed' &&
          <p className="text-[13px] text-ink-soft" role="alert">{view.error ?? 'The server could not be reached.'} They run again when you change something.</p>
          }
            {!report && view.status !== 'failed' && <p className="text-[13px] text-muted">Waiting for the server…</p>}

            {report && tab === 'problems' && (
          groups.length === 0 ?
          <p className="flex items-center gap-2 text-[13px] text-ink-soft"><CircleCheckIcon className="h-4 w-4 text-success" aria-hidden />The server found no problems.</p> :

          <ul className="space-y-3">
                  {groups.map((g) =>
            <li key={g.key}>
                      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="font-semibold text-ink">{g.title}</span>
                        <span className="text-muted">{g.caption}</span>
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {g.rows.map((row, i) => <IssueRow key={i} row={row} config={config} onShow={onShow} />)}
                      </ul>
                    </li>
            )}
                </ul>)
          }

            {report && tab === 'unsupported' && (
          unsupported === 0 ?
          <p className="text-[13px] text-muted">The runtime can run everything this agent uses.</p> :

          <ul className="space-y-1.5">
                  {report.unsupported.map((u) =>
            <li key={u.where} className={cn('rounded-md px-2.5 py-1.5 text-[13px] text-ink-soft', u.severity === 'security' ? 'border border-danger/40 bg-danger-soft' : 'bg-warning-soft')}>
                      {u.severity === 'security' ?
              <><span className="font-semibold text-danger">Not protected yet: </span><span className="font-medium text-ink">{u.feature}</span> is set up but the runtime does not enforce it yet.</> :
              <>Uses <span className="font-medium text-ink">{u.feature}</span>, which the runtime can’t run yet. It is skipped on calls.</>
              }
                      <span className="mt-0.5 block break-all font-mono text-xs text-muted">{u.where}</span>
                    </li>
            )}
                </ul>)
          }

            {report && tab === 'secrets' &&
          <>
                <p className="text-xs text-muted">Names only. Admins set the values on the server; Studio never sees them.</p>
                <ul className="mt-1.5 space-y-1">
                  {report.secrets_required.map((s) =>
              <li key={s} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 break-all font-mono text-ink-soft">
                        <KeyRoundIcon className="h-3 w-3 shrink-0 text-muted" aria-hidden />
                        {s}
                      </span>
                      {secretState(s, keys) === 'missing' ? <span className="text-warning">Missing</span> : secretState(s, keys) === 'found' ? <span className="text-success">Found</span> : <span className="text-muted">Checked at deploy</span>}
                    </li>
              )}
                  {secrets === 0 && <li className="text-[13px] text-muted">It needs no secrets.</li>}
                </ul>
              </>
          }
          </div>
        </div>
      }
    </section>);

}

function Count({ tone, n, word, plural }: { tone: 'danger' | 'warning' | 'neutral'; n: number; word: string; plural?: string }) {
  const Icon = tone === 'danger' ? CircleAlertIcon : TriangleAlertIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        n === 0 ? 'bg-subtle text-muted' : tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-subtle text-ink-soft'
      )}>
      {tone !== 'neutral' && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {n} {n === 1 ? word : plural ?? `${word}s`}
    </span>);

}

function TabButton({ id, tab, setTab, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn('-mb-px border-b-2 px-2 pb-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink')}>
      {children}
    </button>);

}

function IssueRow({ row, config, onShow }: { row: Row; config: AgentConfig; onShow: (issue: Issue) => void }) {
  const { issue, tone } = row;
  const Icon = tone === 'danger' ? CircleAlertIcon : TriangleAlertIcon;
  const remedy = remedyFor(issue.message);
  return (
    <li>
      <button
        type="button"
        onClick={() => onShow(issue)}
        disabled={!issue.path}
        className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:hover:bg-transparent">
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'danger' ? 'text-danger' : 'text-warning')} aria-label={tone === 'danger' ? 'Error' : 'Warning'} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13px] leading-snug text-ink [overflow-wrap:anywhere]">{issue.message}</span>
          {remedy && <span className="block text-xs text-ink-soft">{remedy}</span>}
          {issue.path &&
          <span className="mt-0.5 block text-xs text-muted [overflow-wrap:anywhere]">
              {describePath(issue.path, config)} · <span className="font-mono">{issue.path.join('.')}</span>
            </span>
          }
        </span>
        {issue.path && <span className="shrink-0 self-center text-xs font-medium text-accent">Show</span>}
      </button>
    </li>);

}
