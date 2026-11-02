import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '../ui/Toast';
import { DownloadIcon, KeyRoundIcon, LoaderCircleIcon, PhoneIcon, PlusIcon, RotateCcwIcon } from 'lucide-react';
import type { EnvironmentName, Version } from '../../types/studio';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { useStudio } from '../../contexts/StudioContext';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { StatusChip, type ChipTone } from '../ui/StatusChip';
import { Dialog } from '../ui/Dialog';
import { DeployDialog } from './release/DeployDialog';
import { CompareDialog } from './release/CompareDialog';
import { AddNumberDialog } from './release/AddNumberDialog';
import { ShipStrip } from './Readiness';
import { restoreAsDraft } from '../../models/changes';
import type { ShipFlow } from '../../models/shipFlow';
import { testStatusOf, type VersionTestState } from '../../models/releaseChecklist';
import { deploySecretsMissing, environmentList, numberProblems, numbersByEnvironment, onDeploySecrets } from '../../models/releaseEnvironments';
import { useAgentNumbers, useEnvironments, useTestRuns } from '../../hooks/useReleaseData';
import { currentDeployments, draftChangeCount, envLabel, newestFirst, pendingDeployment } from '../../utils/agentStatus';
import { timeAgo } from '../../utils/format';
import { cn } from '../../utils/styles';

const testChip: Record<VersionTestState, { tone: ChipTone; title: string }> = {
  passed: { tone: 'success', title: 'The latest run on this exact version passed' },
  failed: { tone: 'danger', title: 'The latest run on this exact version did not pass' },
  partial: { tone: 'warning', title: 'The latest run on this exact version covered only some of its scenarios' },
  none: { tone: 'neutral', title: 'No run has tested this exact version' },
};

// Re-render when a deploy notes the secrets the server could not find.
let deployNotes = 0;
const subscribeDeployNotes = (listener: () => void) =>
onDeploySecrets(() => {
  deployNotes += 1;
  listener();
});

interface ReleaseStageProps {
  editor: DraftEditor;
  onPublish: () => void;
  /** The ship flow (readiness model): the same status Overview, the header and the lists show. */
  ship: ShipFlow | null;
}

export function ReleaseStage({ editor, onPublish, ship }: ReleaseStageProps) {
  const agent = editor.agent!;
  const { rollback, logAudit, loadVersionConfig } = useStudio();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const handleExportVersion = async (v: Version) => {
    let config;
    try {
      config = await loadVersionConfig(agent.id, v.version);
    } catch (err: unknown) {
      toast.error(`Could not export ${v.version}`, { description: err instanceof Error ? err.message : undefined });
      return;
    }
    const jsonStr = JSON.stringify(config, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.id}-${v.version}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logAudit('exported', agent.id, `Exported frozen version ${v.version} as JSON`);
    toast.success(`Exported ${agent.id} ${v.version}`, {
      description: 'Downloaded JSON configuration file.',
    });
  };
  const [deployTarget, setDeployTarget] = useState<{env?: EnvironmentName;version?: string;} | null>(null);
  const [compare, setCompare] = useState<{a: string;b: string;} | null>(null);
  const [rollbackEnv, setRollbackEnv] = useState<EnvironmentName | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [addNumberEnv, setAddNumberEnv] = useState<string | null>(null);

  useEffect(() => {
    const deployV = params.get('deploy') ?? (params.get('focus') === 'deploy' ? agent.versions[0]?.version ?? null : null);
    const rb = params.get('rollback') as EnvironmentName | null;
    if (deployV) setDeployTarget({ version: deployV, env: 'development' });
    if (rb && agent.deployments.some((d) => d.environment === rb)) setRollbackEnv(rb);
    if (deployV || rb || params.get('focus')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = currentDeployments(agent);
  const latest = agent.versions[0];
  const changes = draftChangeCount(agent);
  // The environments the server has (GET /environments); until known, the ones the deployments name.
  const serverEnvs = useEnvironments();
  const envs = environmentList(serverEnvs.data, agent.deployments.map((d) => d.environment));
  const environments = envs.names as EnvironmentName[];
  // The phone numbers each environment answers, and the test runs behind each version's "Tests" chip.
  const numbers = useAgentNumbers(agent.id);
  const dialled = useMemo(() => numbersByEnvironment(numbers.data ?? []), [numbers.data]);
  const runs = useTestRuns(agent.id, true, agent.versions[0]?.version);
  useSyncExternalStore(subscribeDeployNotes, () => deployNotes);

  const canDeployTo = (env: EnvironmentName) => env === 'production' ? can('deploy_production') : can('deploy');
  const rbDeployment = rollbackEnv ? current[rollbackEnv] : undefined;

  const [releaseBusy, setReleaseBusy] = useState(false);

  const confirmRollback = async () => {
    if (!rollbackEnv || releaseBusy) return;
    const env = rollbackEnv;
    setReleaseBusy(true);
    try {
      const result = await rollback(agent.id, env);
      if (!result) toast.error(`Nothing to roll ${envLabel(env)} back to`);
      else if (result.deployment.status === 'active') toast.success(`${envLabel(env)} is back on ${result.deployment.version}`);
      else if (result.deployment.status === 'failed') toast.error(`Rolling ${envLabel(env)} back to ${result.deployment.version} failed`);
      else toast(`Rolling ${envLabel(env)} back to ${result.deployment.version}`, { description: 'The server has not finished yet. This page shows when it does.' });
      setRollbackEnv(null);
    } catch (err: unknown) {
      toast.error(`Could not roll ${envLabel(env)} back`, { description: err instanceof Error ? err.message : undefined });
    } finally {
      setReleaseBusy(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget || releaseBusy) return;
    const target = restoreTarget;
    setReleaseBusy(true);
    try {
      // An ordinary edit: the version's settings go into the editor (keeping the draft's own version number), nothing
      // is saved until Save, and Undo takes it back.
      const config = await loadVersionConfig(agent.id, target);
      if (!editor.config) throw new Error('The draft is not loaded.');
      editor.replaceConfig(restoreAsDraft(editor.config, config));
      logAudit('restored', agent.id, `Put ${target} into the editor as the draft (not saved yet)`);
      toast.success(`${target} is in the editor`, { description: 'Not saved yet: press Save to keep it, or Undo (Ctrl+Z) to go back. Nothing changed for callers.' });
      setRestoreTarget(null);
      navigate(`/agents/${agent.id}/build`);
    } catch (err: unknown) {
      toast.error(`Could not restore ${target}`, { description: err instanceof Error ? err.message : undefined });
    } finally {
      setReleaseBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-10">
      {ship && <div className="mb-8"><ShipStrip agentId={agent.id} ship={ship} onSave={() => void editor.save()} onPublish={onPublish} /></div>}
      <section aria-labelledby="envs-title">
        <h2 id="envs-title" className="text-sm font-semibold text-ink">Environments</h2>
        {!envs.fromServer &&
        <p className="mt-1 text-xs text-warning" role="status">
            {serverEnvs.error ? `The server’s environments could not be read (${serverEnvs.error}).` : 'Reading the server’s environments…'}
            {environments.length ? ' Showing the ones this agent is deployed to.' : ''}
            {serverEnvs.error && <button type="button" className="ml-1 font-medium text-accent hover:underline" onClick={serverEnvs.reload}>Try again</button>}
          </p>
        }
        <div className={cn('mt-3 grid gap-4 md:grid-cols-2', environments.length >= 3 && 'lg:grid-cols-3')}>
          {environments.map((env) => {
            const live = current[env];
            const pending = pendingDeployment(agent, env);
            const allowed = canDeployTo(env);
            const phones = dialled[env] ?? [];
            const secretsMissing = deploySecretsMissing(agent.id, env, live?.version);
            return (
              <article key={env} data-env={env} className="flex flex-col rounded-xl border border-line bg-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink-soft">{envLabel(env)}</h3>
                  {env === 'production' && <StatusChip tone={can('deploy_production') ? 'neutral' : 'warning'}>{can('deploy_production') ? 'Needs typed confirmation' : 'Admin only'}</StatusChip>}
                </div>
                {pending ?
                <div className="mt-3" aria-live="polite">
                    <p className="flex items-center gap-2 text-sm font-medium text-info">
                      <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />
                      Deploying {pending.version}…
                    </p>
                    <p className="mt-1 text-xs text-muted">{live ? `${live.version} keeps serving until it’s active.` : 'Not serving yet.'}</p>
                  </div> :
                live ?
                <div className="mt-2">
                    <p className="font-mono text-2xl font-medium text-ink">{live.version}</p>
                    <p className="mt-1 text-xs text-muted">{live.deployed_by} · {timeAgo(live.deployed_at)}</p>
                  </div> :

                <p className="mt-3 text-sm text-muted">Nothing deployed</p>
                }
                {secretsMissing.length > 0 &&
                <p className="mt-2 flex items-start gap-1.5 text-xs text-warning" title="What the server could not find when this version was deployed from this tab. It checks again at every deploy.">
                    <KeyRoundIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>Secrets not found when deployed: <span className="font-mono">{secretsMissing.join(', ')}</span></span>
                  </p>
                }
                {phones.length > 0 &&
                <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft" data-numbers={env} title="The phone numbers whose calls this environment answers">
                    <PhoneIcon className="mt-0.5 h-3 w-3 shrink-0 text-muted" aria-hidden />
                    <span className="font-mono">{phones.join(', ')}</span>
                  </p>
                }
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <Button size="sm" variant="secondary" disabled={!allowed || !latest || !!pending} onClick={() => setDeployTarget({ env })}>
                    Deploy…
                  </Button>
                  {live?.previous_version &&
                  <Button size="sm" variant="ghost" disabled={!allowed || !!pending} onClick={() => setRollbackEnv(env)}>
                      <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
                      Roll back to {live.previous_version}
                    </Button>
                  }
                </div>
              </article>);

          })}
        </div>
      </section>

      <section aria-labelledby="numbers-title" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="numbers-title" className="text-sm font-semibold text-ink">Phone numbers</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-muted">The numbers people dial to reach {agent.name}. Each one answers with the version deployed in its environment.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={!can('deploy') || environments.length === 0} onClick={() => setAddNumberEnv(environments[0] ?? '')}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add a number
          </Button>
        </div>
        {numbers.error ?
        <p className="mt-3 text-[13px] text-muted" role="status">The phone numbers could not be read ({numbers.error}).</p> :
        !numbers.data ?
        <div className="mt-3 h-10 animate-pulse rounded-lg bg-subtle" aria-busy="true" aria-label="Loading the phone numbers" /> :
        numbers.data.length === 0 ?
        <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-4 text-[13px] text-muted">No number yet. Add one, and callers who dial it reach {agent.name} (its deployed version needs a phone channel).</p> :
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {numbers.data.map((n) => {
            const problems = numberProblems(n);
            return (
              <li key={n.number} data-number={n.number} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-mono text-sm text-ink">
                      <PhoneIcon className="h-3.5 w-3.5 text-muted" aria-hidden />
                      {n.number}
                    </p>
                    {problems.map((p) => <p key={p} className="mt-0.5 text-xs text-warning">{p}</p>)}
                  </div>
                  <StatusChip tone={problems.length ? 'warning' : 'neutral'}>{n.environment ? envLabel(n.environment as EnvironmentName) : 'No environment'}</StatusChip>
                </li>);
          })}
          </ul>
        }
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="versions-title">
          <h2 id="versions-title" className="text-sm font-semibold text-ink">Versions</h2>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            <li className="flex flex-wrap items-center justify-between gap-3 bg-canvas/60 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  Draft <span className="font-mono text-xs font-normal text-muted">rev {agent.draft.revision}</span>
                </p>
                <p className="text-xs text-muted">
                  {!latest ? 'Never published' : changes === null ? `Changes since ${latest.version} could not be counted` : changes ? `${changes} unpublished ${changes === 1 ? 'change' : 'changes'} since ${latest.version}` : `Same as ${latest.version}`}
                </p>
              </div>
              <div className="flex gap-2">
                {latest && changes !== 0 &&
                <Button size="sm" variant="ghost" onClick={() => setCompare({ a: latest.version, b: 'draft' })}>Compare</Button>
                }
                <Button size="sm" variant="secondary" onClick={onPublish} disabled={!can('publish')}>Publish</Button>
              </div>
            </li>
            {agent.versions.map((v, i) => {
              const liveIn = environments.filter((e) => current[e]?.version === v.version);
              const prev = agent.versions[i + 1];
              // The newest version's scenarios are known (its config is loaded), so a run of only some of them says so.
              const ownTests = v.config?.tests;
              const tests = testStatusOf(v, runs.data ?? [], { scenarioCount: Array.isArray(ownTests) ? ownTests.length : 0 });
              return (
                <li key={v.version} data-version={v.version} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-ink">{v.version}</span>
                      {liveIn.map((e) => <StatusChip key={e} tone={e === 'production' ? 'accent' : 'neutral'}>{envLabel(e)}</StatusChip>)}
                      <StatusChip tone={runs.error ? 'neutral' : testChip[tests.state].tone} title={runs.error ? `The test runs could not be read (${runs.error})` : testChip[tests.state].title}>
                        Tests: {runs.error ? 'unknown' : runs.data ? tests.text : '…'}
                      </StatusChip>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {v.published_by} · {timeAgo(v.published_at)} · <span className="font-mono">{v.checksum.slice(0, 15)}</span>
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setCompare({ a: prev?.version ?? v.version, b: v.version })}>Compare</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleExportVersion(v)} title="Download version JSON">
                      <DownloadIcon className="h-3.5 w-3.5 mr-1" />
                      Export
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!can('edit')} onClick={() => setRestoreTarget(v.version)}>Restore</Button>
                    <Button size="sm" variant="secondary" disabled={!can('deploy')} onClick={() => setDeployTarget({ version: v.version })}>Deploy</Button>
                  </div>
                </li>);

            })}
          </ul>
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="text-sm font-semibold text-ink">Deployment history</h2>
          {agent.deployments.length === 0 ?
          <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">No deployments yet.</p> :

          <ol className="mt-3 space-y-0 border-l border-line pl-4">
              {newestFirst(agent.deployments).map((d) => {
              const isCurrent = current[d.environment]?.id === d.id;
              return (
                <li key={d.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-line-strong" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{envLabel(d.environment)}</span>
                      <span className="font-mono text-xs text-ink-soft">
                        {d.previous_version ? `${d.previous_version} → ` : ''}
                        {d.version}
                      </span>
                      {d.status === 'pending' ?
                    <StatusChip tone="info" dot>Deploying</StatusChip> :
                    d.status === 'failed' ?
                    <StatusChip tone="danger" dot>Failed</StatusChip> :
                    isCurrent ?
                    <StatusChip tone="success" dot>Live</StatusChip> :

                    <StatusChip>Replaced</StatusChip>
                    }
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {d.deployed_by} · {timeAgo(d.deployed_at)}
                      {d.note ? ` · ${d.note}` : ''}
                    </p>
                  </li>);

            })}
            </ol>
          }
        </section>
      </div>

      <DeployDialog open={!!deployTarget} onClose={() => setDeployTarget(null)} agent={agent} initialEnv={deployTarget?.env} initialVersion={deployTarget?.version} />
      <AddNumberDialog
        open={addNumberEnv !== null}
        onClose={() => setAddNumberEnv(null)}
        agentId={agent.id}
        agentName={agent.name}
        environments={environments}
        initialEnv={addNumberEnv ?? undefined}
        onAdded={numbers.reload} />
      <CompareDialog open={!!compare} onClose={() => setCompare(null)} agent={agent} initialA={compare?.a ?? 'draft'} initialB={compare?.b ?? 'draft'} />

      <Dialog
        open={!!rollbackEnv}
        onClose={() => setRollbackEnv(null)}
        title={rollbackEnv && rbDeployment ? `Roll ${envLabel(rollbackEnv)} back to ${rbDeployment.previous_version}?` : 'Roll back'}
        description={rbDeployment ? `${rbDeployment.version} keeps serving until ${rbDeployment.previous_version} is active. Your draft is not touched.` : undefined}
        footer={
        <>
            <Button variant="ghost" onClick={() => setRollbackEnv(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmRollback} disabled={!rollbackEnv || !canDeployTo(rollbackEnv) || releaseBusy}>{releaseBusy ? 'Rolling back…' : 'Roll back'}</Button>
          </>
        }>
        
        <p className="text-sm text-ink-soft">
          {rollbackEnv && !canDeployTo(rollbackEnv) ? 'Only admins can change Production.' : 'This is recorded in the deployment history with your name.'}
        </p>
      </Dialog>

      <Dialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        title={`Restore ${restoreTarget} as your draft?`}
        description="Puts this version’s settings into the editor as the draft. Nothing is saved until you press Save, Undo takes it back, and nothing changes for callers."
        footer={
        <>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmRestore} disabled={releaseBusy}>{releaseBusy ? 'Reading the version…' : 'Put it in the editor'}</Button>
          </>
        }>
        
        <p className="text-sm text-ink-soft">
          {changes === null ? 'Unpublished changes in the draft would be replaced in the editor; Undo brings them back.' : changes > 0 ? `The saved draft has ${changes} unpublished ${changes === 1 ? 'change' : 'changes'}. They are replaced in the editor; Undo brings them back, and nothing is lost until you save.` : 'The draft has no unpublished changes.'}
        </p>
      </Dialog>
    </div>);

}