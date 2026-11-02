import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../ui/Toast';
import { CircleAlertIcon, CircleCheckIcon, KeyRoundIcon, LoaderCircleIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import type { EnvironmentName, Issue, Path } from '../../types/studio';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { useStudio } from '../../contexts/StudioContext';
import { useAuth } from '../../contexts/AuthContext';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { describePath } from '../../utils/validate';
import { draftChangeCount, envLabel, latestVersion } from '../../utils/agentStatus';
import { missingSecrets } from '../../utils/providerOptions';
import { useSecretKeys } from '../../hooks/useProviders';
import { useEnvironments } from '../../hooks/useReleaseData';
import { cn } from '../../utils/styles';
import type { GateAnswer } from '../../models/readiness';
import { targetPath } from '../../models/agentPages';
import { publishOptions, type PublishChoice } from '../../models/releaseVersion';
import { splitUnsupported } from '../../models/releaseChecklist';
import { noteDeploySecrets } from '../../models/releaseEnvironments';
import { ChangeList } from './ChangeList';
import { ReleaseChecklist } from './release/ReleaseChecklist';
import { useChangesSincePublished } from '../../hooks/usePublishedChanges';

interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  editor: DraftEditor;
  onGoToField: (path: Path) => void;
  /** "Tests must pass before publishing": its answer, or null when the gate is off. */
  gate: GateAnswer | null;
}

/** The environment a new version is tried in first: the server's development environment, when it has one. */
const FIRST_ENV = 'development';

export function PublishDialog({ open, onClose, editor, onGoToField, gate }: PublishDialogProps) {
  const { publish, deploy } = useStudio();
  const { can } = useAuth();
  const navigate = useNavigate();
  const agent = editor.agent;
  const latest = agent ? latestVersion(agent) : undefined;
  const draftVersion = editor.config?.meta?.version;
  const { options, defaultChoice } = useMemo(() => publishOptions(latest?.version, draftVersion), [latest?.version, draftVersion]);
  const [choice, setChoice] = useState<PublishChoice>(defaultChoice);
  const [published, setPublished] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  // Problems the server reported when it refused to publish (shown instead of the local check).
  const [serverErrors, setServerErrors] = useState<Issue[] | null>(null);
  // Warnings the server returned with the published version.
  const [serverWarnings, setServerWarnings] = useState<Issue[]>([]);
  // Putting the new version live in Development from here.
  const [live, setLive] = useState<{ phase: 'idle' | 'working' | 'done'; error: string | null; missing: string[] }>({ phase: 'idle', error: null, missing: [] });
  const environments = useEnvironments();

  useEffect(() => {
    if (open) {
      setPublished(null);
      setPublishing(false);
      setServerErrors(null);
      setServerWarnings([]);
      setChoice(defaultChoice);
      setLive({ phase: 'idle', error: null, missing: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The server's report on the saved draft (the editor holds exactly that when this opens). It informs: the server
  // decides at publish time, and only its refusal (422) stops a publish.
  const report = editor.validationView.report;
  const keys = useSecretKeys();
  const missing = useMemo(() => report ? missingSecrets(report.secrets_required, keys) : [], [report, keys]);
  const changes = agent ? draftChangeCount(agent) : 0;
  // What this version will change, in the same words as the header's list; shown first.
  const sincePublished = useChangesSincePublished(editor);
  if (!agent || !editor.config) return null;
  const held = !!gate && !gate.ok;
  const picked = options.find((o) => o.value === choice && !o.disabled) ?? options.find((o) => o.value === defaultChoice) ?? options[0];
  const willPublish = picked.disabled ? '' : picked.version;
  const notEnforced = splitUnsupported(report?.unsupported).security;
  const canGoLive = can('deploy') && (environments.data ?? []).includes(FIRST_ENV);

  const handlePublish = async () => {
    if (publishing || !willPublish) return;
    setPublishing(true);
    const res = await publish(agent.id, picked.value === 'draft' ? undefined : picked.value);
    setPublishing(false);
    if (!res.ok) {
      setServerErrors(res.errors);
      return;
    }
    setServerWarnings(res.warnings);
    setPublished(res.version.version);
    toast.success(`Published ${res.version.version}`, { description: 'The version is frozen. Put it live when you are ready.' });
  };

  if (published) {
    const chooseWhere = () => {
      onClose();
      navigate(`/agents/${agent.id}/release?deploy=${encodeURIComponent(published)}`);
    };
    const putLive = async () => {
      setLive({ phase: 'working', error: null, missing: [] });
      try {
        const outcome = await deploy(agent.id, published, FIRST_ENV as EnvironmentName, 'Put live after publishing');
        noteDeploySecrets(agent.id, FIRST_ENV, published, outcome.preflight?.secrets_missing);
        if (outcome.deployment.status === 'failed') setLive({ phase: 'idle', error: 'The server could not start it in Development. The previous version keeps serving.', missing: [] });
        else {
          setLive({ phase: 'done', error: null, missing: outcome.preflight?.secrets_missing ?? [] });
          toast.success(`${published} is live in ${envLabel(FIRST_ENV as EnvironmentName)}`);
        }
      } catch (err: unknown) {
        setLive({ phase: 'idle', error: err instanceof Error ? err.message : 'The server did not deploy it.', missing: [] });
      }
    };
    const isLive = live.phase === 'done';
    const movedOn = agent.draft.config?.meta?.version;
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={isLive ? `Version ${published} is live in Development` : `Version ${published} is published`}
        footer={
        <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {isLive ?
          <Button variant="primary" onClick={chooseWhere}>See where it runs</Button> :
          <>
                <Button variant={canGoLive ? 'secondary' : 'primary'} onClick={chooseWhere} disabled={live.phase === 'working'}>Choose where</Button>
                {canGoLive &&
            <Button variant="primary" onClick={() => void putLive()} disabled={live.phase === 'working'}>
                    {live.phase === 'working' ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />Putting it live…</> : 'Put it live in Development'}
                  </Button>
            }
              </>
          }
          </>
        }>
        <div className="flex gap-3">
          <CircleCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          <p className="text-sm leading-relaxed text-ink-soft" aria-live="polite">
            {isLive ?
            'It answers in Development from now on, so you can try it for real there. Staging and Production are chosen on Release.' :
            'It’s frozen and can’t change. Put it live in Development to try it for real, or choose where it runs. Keep editing the draft safely; that doesn’t touch this version.'}
          </p>
        </div>
        {live.error && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">It couldn’t be put live: {live.error}</p>}
        {live.missing.length > 0 &&
        <p className="mt-4 flex gap-2 text-[13px] text-ink-soft">
            <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            Secrets not set on the server: <span className="font-mono">{live.missing.join(', ')}</span>. Calls that need them will fail.
          </p>
        }
        {serverWarnings.length > 0 &&
        <ul className="mt-4 space-y-1.5">
            {serverWarnings.map((w, i) =>
          <li key={i} className="flex items-start gap-2 text-[13px] text-ink-soft">
                <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                {w.message}
              </li>
          )}
          </ul>
        }
        {movedOn && movedOn !== published && <p className="mt-4 text-xs text-muted">The draft has moved on to {movedOn}, so your next publish won’t collide.</p>}
      </Dialog>);

  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={willPublish ? `Publish version ${willPublish}` : 'Publish a new version'}
      description={`Freezes the saved draft (revision ${editor.baseRevision}). ${!latest ? 'This will be the first version.' : changes === null ? `Changes since ${latest.version} could not be counted.` : `${changes} ${changes === 1 ? 'change' : 'changes'} since ${latest.version}.`} Nothing changes for callers until it is deployed.`}
      footer={
      <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant={held ? 'secondary' : 'primary'} onClick={handlePublish} disabled={publishing || !willPublish} title={held ? 'Publish although the tests gate is holding it' : undefined}>
              {publishing ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />Publishing…</> : held ? <>Publish anyway ({willPublish || '—'})</> : <>Publish {willPublish}</>}
            </Button>
          </>
      }>
      {held && gate &&
      <div role="status" className="mb-6 rounded-lg border border-warning/40 bg-warning-soft p-3">
          <p className="text-sm font-medium text-ink">Held: tests must pass before publishing</p>
          <p className="mt-0.5 text-[13px] text-ink-soft">{gate.why}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onClose();
              navigate(targetPath(agent.id, gate.action === 'scenarios' ? { stage: 'build', focus: 'tests' } : { stage: 'test', focus: 'scenarios' }));
            }}>
              {gate.action === 'scenarios' ? 'Add tests' : 'Run the tests'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">You can still publish: “Publish anyway” is below. The switch is on the Test page (kept in this browser).</p>
        </div>
      }
      {report && !report.valid &&
      <div className="mb-6 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
          <p className="text-sm font-medium text-ink">The server’s checks found {report.errors.length} {report.errors.length === 1 ? 'problem' : 'problems'}</p>
          <p className="text-[13px] text-muted">The server will refuse to publish until they are fixed. You can still try.</p>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
          {report.errors.map((e, i) =>
        <li key={i} className="flex items-start gap-3 px-3 py-3">
              <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0 flex-1">
                {e.path && <p className="text-xs font-medium text-muted">{describePath(e.path, editor.config!)}</p>}
                <p className="text-sm text-ink">{e.message}</p>
              </div>
              {e.path &&
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onClose();
              onGoToField(e.path!);
            }}>

                  Go to field
                </Button>
          }
            </li>
        )}
        </ul>
        </div>
      }
      {notEnforced.length > 0 &&
      <div role="note" className="mb-6 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <ShieldAlertIcon className="h-4 w-4 text-danger" aria-hidden />
            Some protections in this draft are declared but not enforced
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            The runtime doesn’t enforce them yet, so a version published from this draft looks protected and isn’t. Publishing is allowed; think twice before Production.
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-soft">
            {notEnforced.map((u) => <li key={u.where}>{u.feature} <span className="font-mono text-xs text-muted">({u.where})</span></li>)}
          </ul>
        </div>
      }
      {editor.validationView.status !== 'checked' &&
      <p className="mb-4 text-[13px] text-muted" aria-live="polite">
          {editor.validationView.status === 'failed' ? `The server’s checks could not be run (${editor.validationView.error}). The server still checks when you publish.` : 'The server is checking the draft…'}
        </p>
      }
      <div className="space-y-6">
          {latest &&
        <section aria-labelledby="publish-changes">
              <h3 id="publish-changes" className="text-sm font-medium text-ink">What changes since {latest.version}</h3>
              <div className="mt-2 max-h-72 overflow-y-auto pr-1">
                {sincePublished.error ?
              <p className="text-[13px] text-muted">The published version could not be read ({sincePublished.error}), so the changes are not listed.</p> :
              <ChangeList summary={sincePublished.summary} emptyText="Nothing: the draft is the same as the published version." />}
              </div>
            </section>
        }
          {serverErrors &&
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3">
              <p className="text-sm font-medium text-danger">The server did not publish this draft</p>
              <ul className="mt-1.5 space-y-1">
                {serverErrors.map((e, i) =>
            <li key={i} className="text-[13px] text-ink-soft">
                    {e.path && <span className="font-medium text-ink">{describePath(e.path, editor.config!)}: </span>}
                    {e.message}
                  </li>
            )}
              </ul>
            </div>
        }
          <fieldset>
            <legend className="text-sm font-medium text-ink">{latest ? `Version number (the latest published is ${latest.version})` : 'Version number'}</legend>
            {!latest && <p className="mt-1 text-[13px] text-muted">This is the first version of this agent, so it is published under the draft’s own number.</p>}
            <div role="radiogroup" aria-label="Version number" className={cn('mt-2 grid gap-2', options.length > 1 && 'sm:grid-cols-3')}>
              {options.map((o) => {
              const active = o.value === picked.value && !o.disabled;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={o.disabled || publishing}
                  onClick={() => setChoice(o.value)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-[border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60',
                    o.value === 'draft' && options.length > 1 && 'sm:col-span-3',
                    active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong'
                  )}>

                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{o.label}</span>
                      <span className="font-mono text-xs text-accent">{o.version}</span>
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug text-muted">{o.matchesDraft ? 'Also the draft’s own number.' : o.hint}</span>
                  </button>);

            })}
            </div>
          </fieldset>

          <ReleaseChecklist agentId={agent.id} config={editor.config} report={report} compact onNavigate={onClose} />

          {report && report.warnings.length > 0 &&
        <section>
              <h3 className="text-sm font-medium text-ink">Worth a look before you publish</h3>
              <p className="text-[13px] text-muted">Warnings never block publishing.</p>
              <ul className="mt-2 space-y-1.5">
                {report.warnings.map((w, i) =>
            <li key={i} className="flex items-start gap-2 text-[13px] text-ink-soft">
                    <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                    {w.message}
                  </li>
            )}
              </ul>
            </section>
        }

          {(report?.secrets_required ?? []).length > 0 &&
        <section>
            <h3 className="text-sm font-medium text-ink">Secrets this version needs on the server</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {(report?.secrets_required ?? []).map((s) =>
            <li
              key={s}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs',
                missing.includes(s) ? 'border-warning/30 bg-warning-soft text-warning' : 'border-line text-ink-soft'
              )}>

                  <KeyRoundIcon className="h-3 w-3" aria-hidden />
                  {s}
                  {missing.includes(s) && <span className="font-sans">· missing</span>}
                </li>
            )}
            </ul>
            {missing.length > 0 && <p className="mt-2 text-[13px] text-muted">You can still publish. Calls will fail until an admin adds the missing secrets on the server.</p>}
          </section>
        }
        </div>
    </Dialog>);

}
