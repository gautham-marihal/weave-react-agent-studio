import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlertIcon, CircleCheckIcon, KeyRoundIcon, LoaderCircleIcon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import type { AgentConfig, Path } from '../../types/studio';
import type { ValidationView } from '../../utils/serverValidation';
import { describePath } from '../../utils/validate';
import { secretState } from '../../utils/providerOptions';
import { useSecretKeys } from '../../hooks/useProviders';
import { useSchema } from '../../hooks/useSchema';
import { useStudio } from '../../contexts/StudioContext';
import { cn } from '../../utils/styles';
import { oldToolsOf, repairOldTools } from '../../models/setup';
import { describeIssues, type DescribedIssue, type IssueFix } from '../../models/validationIssues';
import { formatPath } from '../../models/schemaForm/paths';
import type { Json } from '../../models/schemaForm/engine';
import { Button } from '../ui/Button';
import { isSandbox } from '../../sandbox/mode';
import { SandboxNoteSlot } from '../../sandbox/test/SandboxNoteSlot';

interface ValidationPanelProps {
  view: ValidationView;
  config: AgentConfig;
  onGoTo: (path: Path) => void;
  /** Puts a repaired config in the editor (undoable, saved like any edit). Absent when the draft cannot be edited. */
  onRepair?: (config: AgentConfig) => void;
  /** Takes the last change back (the Undo after a one-click fix). */
  onUndo?: () => void;
}

/** Tools saved by an older studio in a shape the server refuses, and the one-click repair. */
function OldToolsRepair({ config, onRepair }: { config: AgentConfig; onRepair?: (config: AgentConfig) => void }) {
  const found = oldToolsOf(config);
  if (!found.length) return null;
  const automatic = found.some((o) => o.fix !== 'manual');
  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <TriangleAlertIcon className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        {found.length} {found.length === 1 ? 'tool is' : 'tools are'} in an old format the server no longer accepts
      </p>
      <ul className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
        {found.map((o) => (
          <li key={o.id}>
            {o.change}
            {o.description && <span className="block text-xs text-muted">It was: {o.description}</span>}
          </li>
        ))}
      </ul>
      {automatic && onRepair && (
        <Button size="sm" variant="primary" className="mt-3" onClick={() => onRepair(repairOldTools(config))}>
          Repair {found.filter((o) => o.fix !== 'manual').length === 1 ? 'it' : 'them'}
        </Button>
      )}
      {automatic && onRepair && <p className="mt-1.5 text-xs text-muted">You can undo it, and nothing is saved until you save.</p>}
    </div>
  );
}

/**
 * The server's checks on the draft in the editor (POST /validate, or the report Save returned), in plain words: each
 * problem names the setting by its label, says what is wrong, and offers a fix when the studio is certain what to do.
 * A fix is an ordinary edit, with Undo.
 */
export function ValidationPanel({ view, config, onGoTo, onRepair, onUndo }: ValidationPanelProps) {
  const keys = useSecretKeys();
  const { schema, engine } = useSchema();
  const { technicalNames } = useStudio();
  const [done, setDone] = useState<{ label: string; config: AgentConfig } | null>(null);
  const validation = view.report ?? view.previous;
  const validating = view.status === 'checking' || view.status === 'unknown';
  const shown = useMemo(() => {
    if (!validation) return null;
    const issues = [...validation.errors.map((i) => ({ ...i, severity: 'error' as const })), ...validation.warnings.map((i) => ({ ...i, severity: 'warning' as const }))];
    return describeIssues(issues, { config, schema, engine });
  }, [validation, config, schema, engine]);
  // the Undo stays while the fix is the last change made
  useEffect(() => {
    if (done && done.config !== config) setDone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const applyFix = (fix: IssueFix) => {
    if (fix.open) {
      onGoTo(fix.open);
      return;
    }
    if (!fix.apply || !onRepair) return;
    const next = fix.apply(config as unknown as Json) as unknown as AgentConfig;
    onRepair(next);
    setDone({ label: fix.label, config: next });
    if (fix.jumpTo) {
      const to = fix.jumpTo;
      window.setTimeout(() => onGoTo(to), 120);
    }
  };

  if (!validation || !shown) {
    return (
      <section aria-labelledby="checks-title" className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="checks-title" className="text-sm font-semibold text-ink">Checks</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            {view.status === 'failed' ? 'Could not check' : <><LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />Checking…</>}
          </span>
        </div>
        {view.status === 'failed' ?
        <div className="px-4 py-4" role="alert">
            <p className="text-sm text-ink">The server’s checks could not be run.</p>
            <p className="mt-1 text-[13px] text-muted">{view.error}</p>
            <p className="mt-2 text-[13px] text-muted">They run again when you change something. Publishing is still decided by the server.</p>
          </div> :

        <div className="space-y-3 px-4 py-4" aria-busy="true">
            <div className="h-4 w-3/4 animate-pulse rounded bg-subtle" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-subtle" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-subtle" />
          </div>
        }
      </section>);

  }
  const clean = validation.valid && validation.warnings.length === 0 && validation.unsupported.length === 0;
  const rowProps = { config, onGoTo, onFix: onRepair ? applyFix : undefined, technical: technicalNames };

  return (
    <section aria-labelledby="checks-title" className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="checks-title" className="text-sm font-semibold text-ink">Checks</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
          {validating ?
          <>
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Checking…
            </> :

          view.status === 'failed' ? 'Could not check the latest changes' : isSandbox() ? 'Checked in this browser' : 'Checked by the server'
          }
        </span>
      </div>

      <div className={cn('space-y-5 px-4 py-4 transition-opacity duration-150', validating && 'opacity-60')}>
        {done && (
          <div role="status" className="flex items-center justify-between gap-2 rounded-md bg-success-soft/60 px-3 py-2 text-[13px] text-ink">
            <span>Done: {done.label}. Nothing is saved until you save.</span>
            {onUndo && (
              <button
                type="button"
                onClick={() => {
                  onUndo();
                  setDone(null);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Undo2Icon className="h-3.5 w-3.5" aria-hidden />
                Undo
              </button>
            )}
          </div>
        )}
        <OldToolsRepair config={config} onRepair={onRepair} />
        {clean &&
        <div className="flex gap-2.5">
            <CircleCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <p className="text-sm text-ink-soft">The server found no problems.</p>
          </div>
        }

        {shown.errors > 0 &&
        <div>
            <h3 className="text-[13px] font-semibold text-danger">{shown.errors} {shown.errors === 1 ? 'error' : 'errors'}</h3>
            <p className="text-xs text-muted">The server will not publish until these are fixed. Saving still works.</p>
            {shown.fixNow.length > 0 &&
          <IssueList title={shown.needsYou.length ? 'Fix these first: one click each' : undefined} items={shown.fixNow} {...rowProps} />
          }
            {shown.needsYou.length > 0 &&
          <IssueList title={shown.fixNow.length ? 'Then these, which need you' : undefined} items={shown.needsYou} {...rowProps} />
          }
          </div>
        }

        {shown.warnings > 0 &&
        <div>
            <h3 className="text-[13px] font-semibold text-warning">{shown.warnings} {shown.warnings === 1 ? 'warning' : 'warnings'}</h3>
            <p className="text-xs text-muted">Never block. Worth a look.</p>
            <IssueList items={shown.worthALook} {...rowProps} />
          </div>
        }

        {validation.unsupported.length > 0 &&
        <div>
            <h3 className="text-[13px] font-semibold text-warning">Not available yet</h3>
            <ul className="mt-2 space-y-2">
              {validation.unsupported.map((u) =>
            <li key={u.where} className={cn('rounded-md px-3 py-2 text-[13px] text-ink-soft', u.severity === 'security' ? 'border border-danger/40 bg-danger-soft' : 'bg-warning-soft')}>
                  {u.severity === 'security' ?
              <><span className="font-semibold text-danger">Not protected yet: </span><span className="font-medium text-ink">{u.feature}</span> is set up but the runtime does not enforce it yet. Callers are not protected by it.</> :
              <>This agent uses <span className="font-medium text-ink">{u.feature}</span>, which the runtime can’t run yet. It will be skipped on calls.</>
              }
                  <span className="mt-0.5 block break-all font-mono text-xs text-muted">{u.where}</span>
                </li>
            )}
            </ul>
          </div>
        }

        <div>
          <h3 className="text-[13px] font-semibold text-ink">Secrets the server needs</h3>
          <p className="mt-0.5 text-xs text-muted">Names only. Admins set values on the server; Studio never sees them. The server reports on provider keys; other secrets are checked when you deploy.</p>
          <ul className="mt-2 space-y-1">
            {validation.secrets_required.map((s) =>
            <li key={s} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-mono text-ink-soft">
                  <KeyRoundIcon className="h-3 w-3 text-muted" aria-hidden />
                  {s}
                </span>
                {secretState(s, keys) === 'missing' ? <span className="text-warning">Missing</span> : secretState(s, keys) === 'found' ? <span className="text-success">Found</span> : <span className="text-muted">Checked at deploy</span>}
              </li>
            )}
          </ul>
        </div>
        <SandboxNoteSlot kind="checks" />
      </div>
    </section>);

}

interface IssueListProps {
  title?: string;
  items: DescribedIssue[];
  config: AgentConfig;
  onGoTo: (path: Path) => void;
  onFix?: (fix: IssueFix) => void;
  technical: boolean;
}

function IssueList({ title, items, config, onGoTo, onFix, technical }: IssueListProps) {
  return (
    <div className="mt-2">
      {title && <p className="text-[12px] font-medium text-ink-soft">{title}</p>}
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <IssueRow key={`${item.raw}-${i}`} item={item} config={config} onGoTo={onGoTo} onFix={onFix} technical={technical} />
        ))}
      </ul>
    </div>
  );
}

function IssueRow({ item, config, onGoTo, onFix, technical }: { item: DescribedIssue; config: AgentConfig; onGoTo: (path: Path) => void; onFix?: (fix: IssueFix) => void; technical: boolean }) {
  const error = item.severity === 'error';
  const Icon = error ? CircleAlertIcon : TriangleAlertIcon;
  const where = item.where.text || (item.path ? describePath(item.path, config) : '');
  const path = item.path;
  return (
    <li className="rounded-md p-1.5 transition-colors hover:bg-subtle" data-issue={item.raw}>
      <button
        type="button"
        onClick={() => path && onGoTo(path)}
        disabled={!path}
        className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default"
        aria-label={path ? `Show me: ${item.text}` : item.text}>
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', error ? 'text-danger' : 'text-warning')} aria-hidden />
        <span className="min-w-0">
          {where && <span className="block text-xs font-medium text-muted [overflow-wrap:anywhere]">{where}</span>}
          <span className="block text-[13px] leading-snug text-ink [overflow-wrap:anywhere]">{item.text}</span>
        </span>
      </button>
      {onFix && item.fixes.length > 0 && (
        <div className="ml-5 mt-1.5 flex flex-wrap gap-1.5">
          {item.fixes.map((fix) => (
            <button
              key={fix.id}
              type="button"
              onClick={() => onFix(fix)}
              className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-[12px] font-medium text-ink shadow-sm hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {fix.label}
            </button>
          ))}
        </div>
      )}
      {item.raw !== item.text && (
        <details className="ml-5 mt-1 text-[12px] text-muted" open={technical || undefined}>
          <summary className="cursor-pointer select-none">What the server said</summary>
          <p className="mt-0.5 [overflow-wrap:anywhere]">{item.raw}</p>
          {path && <code className="font-mono text-[11px]">{formatPath(path)}</code>}
        </details>
      )}
    </li>
  );
}
