import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '../../ui/Toast';
import { CircleCheckIcon, LoaderCircleIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import type { Agent, EnvironmentName } from '../../../types/studio';
import { useStudio, type DeployOutcome } from '../../../contexts/StudioContext';
import { useAuth } from '../../../contexts/AuthContext';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { currentDeployments, envLabel } from '../../../utils/agentStatus';
import { useServerValidation, versionKey } from '../../../hooks/useServerValidation';
import { useVersionConfig } from '../../../hooks/useVersionConfig';
import { useEnvironments } from '../../../hooks/useReleaseData';
import { environmentList, noteDeploySecrets } from '../../../models/releaseEnvironments';
import { normalizePreflightKnowledge } from '../../../models/releaseChecklist';
import { cn, easeOut, inputClass } from '../../../utils/styles';
import { ReleaseChecklist } from './ReleaseChecklist';
import { isBankingAgent } from '../../../models/bankingAgent';
import { BANKING_DEPLOY_NEEDS } from '../../../models/bankingStatus';

interface DeployDialogProps {
  open: boolean;
  onClose: () => void;
  agent: Agent;
  initialEnv?: EnvironmentName;
  initialVersion?: string;
}

export function DeployDialog({ open, onClose, agent, initialEnv, initialVersion }: DeployDialogProps) {
  const { deploy } = useStudio();
  const { can } = useAuth();
  // The environments the server has (GET /environments); until known, the ones the deployments name.
  const serverEnvs = useEnvironments();
  const envs = environmentList(serverEnvs.data, agent.deployments.map((d) => d.environment));
  const [env, setEnv] = useState<EnvironmentName>('development');
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DeployOutcome | null>(null);

  useEffect(() => {
    if (!open) return;
    setEnv(initialEnv ?? 'development');
    setVersion(initialVersion ?? agent.versions[0]?.version ?? '');
    setNote('');
    setConfirmText('');
    setDeploying(false);
    setDeployError(null);
    setOutcome(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const v = agent.versions.find((x) => x.version === version);
  const versionConfig = useVersionConfig(agent, v?.version);
  const vConfig = versionConfig.config;
  // The server's checks on this version's config (POST /validate); the deploy's own preflight follows when it runs.
  const report = useServerValidation(v ? versionKey(agent.id, v.version) : '', vConfig, 0).report;
  const current = currentDeployments(agent)[env];
  const isProd = env === 'production';
  const allowed = isProd ? can('deploy_production') : can('deploy');
  const alreadyLive = current?.version === version;
  const confirmOk = !isProd || confirmText.trim() === agent.id;

  const handleDeploy = async () => {
    if (!v || !allowed || !confirmOk || alreadyLive || deploying) return;
    setDeploying(true);
    setDeployError(null);
    try {
      const result = await deploy(agent.id, version, env, note.trim());
      setOutcome(result);
      noteDeploySecrets(agent.id, env, version, result.preflight?.secrets_missing);
      if (result.deployment.status === 'active') toast.success(`${result.deployment.version} is live in ${envLabel(env)}`);
    } catch (err: unknown) {
      setDeployError(err instanceof Error ? err.message : 'The server did not deploy this version.');
    } finally {
      setDeploying(false);
    }
  };

  if (outcome) {
    const { deployment, preflight } = outcome;
    const active = deployment.status === 'active';
    const failed = deployment.status === 'failed';
    const knowledge = normalizePreflightKnowledge(preflight.knowledge);
    // A banking agent works only when the server holds the gateway's token and the runtime reaches the gateway.
    const banking = isBankingAgent(vConfig);
    const bankingTokenMissing = preflight.secrets_missing.includes('BANKING_GATEWAY_TOKEN');
    return (
      <Dialog open={open} onClose={onClose} title={active ? 'Deployed' : failed ? 'Deployment failed' : `Still deploying ${deployment.version}`} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <motion.div key={deployment.status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: easeOut }} className="flex gap-3">
          {active ? <CircleCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden /> : failed ? <TriangleAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden /> : <LoaderCircleIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-info" aria-hidden />}
          <div aria-live="polite">
            <p className="text-sm font-medium text-ink">
              {active ? `${deployment.version} is live in ${envLabel(deployment.environment)}.` : failed ? `${deployment.version} did not go live in ${envLabel(deployment.environment)}.` : 'The server has not finished yet. Release shows when it does.'}
            </p>
            <p className="mt-1 text-sm text-muted">
              {active ?
              deployment.previous_version ?
              `If anything looks wrong, roll back to ${deployment.previous_version} from Release.` :
              'This is the first version in this environment.' :
              deployment.previous_version ?
              `${deployment.previous_version} keeps serving callers.` :
              'Nothing is serving this environment.'}
            </p>
          </div>
        </motion.div>
        {(preflight.secrets_missing.length > 0 || preflight.unsupported.length > 0 || knowledge.length > 0 || banking) &&
        <section className="mt-5" aria-labelledby="server-preflight">
            <h3 id="server-preflight" className="text-sm font-medium text-ink">What the server found</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
              {banking &&
            <li className="flex gap-2" data-deploy-note="banking"><TriangleAlertIcon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', bankingTokenMissing ? 'text-danger' : 'text-warning')} aria-hidden /><span>Banking: {bankingTokenMissing ? 'the server does not have BANKING_GATEWAY_TOKEN, so every banking tool will fail. ' : ''}{BANKING_DEPLOY_NEEDS}</span></li>
            }
              {preflight.secrets_missing.length > 0 &&
            <li className="flex gap-2"><TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />Secrets not set on the server: <span className="font-mono">{preflight.secrets_missing.join(', ')}</span>. Calls that need them will fail.</li>
            }
              {preflight.unsupported.map((u) =>
            <li key={u.where} className={cn('flex gap-2', u.severity === 'security' && 'font-medium text-danger')}><TriangleAlertIcon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', u.severity === 'security' ? 'text-danger' : 'text-warning')} aria-hidden />{u.feature} can’t run yet{u.severity === 'security' ? ' — it looks protected but is not enforced' : ''} <span className="font-mono text-xs text-muted">({u.where})</span></li>
            )}
              {knowledge.map((k, i) =>
            <li key={i} className="flex gap-2"><TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /><span>{k.base && <span className="font-medium text-ink">{k.base}: </span>}{k.problem}{k.fix ? ` ${k.fix}` : ''}</span></li>
            )}
            </ul>
          </section>
        }
      </Dialog>);

  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Deploy a version"
      description="Puts a frozen version in front of callers in one environment."
      footer={
      <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={isProd ? 'danger' : 'primary'} onClick={handleDeploy} disabled={!v || !allowed || !confirmOk || alreadyLive || deploying}>
            {deploying ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />Deploying…</> : <>Deploy {version} to {envLabel(env)}</>}
          </Button>
        </>
      }>
      
      {agent.versions.length === 0 ?
      <p className="text-sm text-muted">Publish a version first — only frozen versions can be deployed.</p> :

      <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <fieldset>
              <legend className="text-sm font-medium text-ink">Environment</legend>
              {!envs.fromServer &&
            <p className="mt-1 text-xs text-warning">
                  {serverEnvs.error ? `The server’s environments could not be read (${serverEnvs.error}).` : 'Reading the server’s environments…'}
                  {envs.names.length ? ' Showing the ones this agent is deployed to.' : ''}
                </p>
            }
              <div role="radiogroup" aria-label="Environment" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {envs.names.map((name) => {
                const e = name as EnvironmentName;
                const active = e === env;
                const live = currentDeployments(agent)[e];
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setEnv(e);
                      setConfirmText('');
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left transition-[border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong'
                    )}>
                    
                      <span className="block text-sm font-medium text-ink">{envLabel(e)}</span>
                      <span className="block font-mono text-xs text-muted">{live ? live.version : 'empty'}</span>
                    </button>);

              })}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-sm font-medium text-ink">Version</span>
              <select className={cn(inputClass, 'mt-2 font-mono')} value={version} onChange={(e) => setVersion(e.target.value)}>
                {agent.versions.map((x) => <option key={x.version} value={x.version}>{x.version}</option>)}
              </select>
            </label>
          </div>

          <p className="text-[13px] text-ink-soft">
            {alreadyLive ?
          `${version} is already live in ${envLabel(env)}.` :
          current ?
          `Replaces ${current.version} in ${envLabel(env)}. ${current.version} keeps serving until the new version is active.` :
          `First deployment to ${envLabel(env)}.`}
          </p>

          <div className="space-y-1.5">
            {v && vConfig && report ?
          <ReleaseChecklist agentId={agent.id} config={vConfig} report={report} version={{ version: v.version, checksum: v.checksum }} onNavigate={onClose} /> :
          <p className="text-[13px] text-muted" aria-live="polite">{versionConfig.error ? `Couldn’t check this version before deploying (${versionConfig.error}). You can still deploy it.` : 'Checking this version…'}</p>
          }
            <p className="text-xs text-muted">Worked out in this browser. The server runs its own checks when you deploy, and they are shown afterwards.</p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-ink">Note <span className="font-normal text-muted">(optional)</span></span>
            <input className={cn(inputClass, 'mt-1.5')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What’s in this release?" />
          </label>

          {deployError &&
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">Not deployed: {deployError}</p>
        }

          {isProd &&
        <div className="rounded-lg border border-danger/25 bg-danger-soft/50 p-4">
              {allowed ?
          <>
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <ShieldAlertIcon className="h-4 w-4 text-danger" aria-hidden />
                    This changes what real callers hear.
                  </p>
                  <label htmlFor="prod-confirm" className="mt-2 block text-[13px] text-ink-soft">
                    Type <code className="rounded bg-surface px-1 font-mono text-ink">{agent.id}</code> to confirm.
                  </label>
                  <input id="prod-confirm" className={cn(inputClass, 'mt-1.5 font-mono')} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" spellCheck={false} />
                </> :

          <p className="flex items-center gap-2 text-sm text-ink">
                  <ShieldAlertIcon className="h-4 w-4 text-danger" aria-hidden />
                  Only admins can deploy to Production. Ask an admin to promote this version.
                </p>
          }
            </div>
        }
        </div>
      }
    </Dialog>);

}