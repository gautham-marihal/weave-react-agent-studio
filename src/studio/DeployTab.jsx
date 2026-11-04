import React, { useEffect, useMemo, useRef, useState } from 'react';
import SmartSelect from './SmartSelect.jsx';
import Icon from '../ui/Icon.jsx';
import { api } from '../api/client.ts';
import { formatWhen } from './format.js';
import { DemoNote } from '../demo/DemoBadge.jsx';
import { PRODUCTION_WORD, mayDeploy, rollbackTarget, splitUnsupported } from './preflight.ts';
import { envLabel, ErrorState, Notice, Spinner } from './ui.jsx';
import { useAsync } from './useAsync.js';
import ReleaseChecklist from './release/ReleaseChecklist.jsx';
import Preflight from './release/Preflight.jsx';
import { failureReason, useDeploymentWatch } from './release/deployWatch.js';
import { AgentNumbers, useLiveNumbers } from '../pages/LiveNumbers.jsx';
import Select from '../ui/Select.tsx';
import Button from '../ui/Button.tsx';

// The Deploy page: which version runs in each environment, putting a version live, what the runtime can't run yet
// (release/Preflight.jsx, also shown when publishing), and the deployment history.

const STATUS_TEXT = { active: 'Active', pending: 'Deploying…', failed: 'Failed', replaced: 'Replaced' };

function StatusPill({ status }) {
  return (
    <span className={`stStatus ${status}`}>
      <i aria-hidden="true" />
      {STATUS_TEXT[status] || status}
    </span>
  );
}

export default function DeployTab({ botId, name = '', initialVersion, refreshKey, onDeployed }) {
  const envs = useAsync((signal) => api.environments({ signal }), []);
  // the agent's phone numbers, if this server has them: each environment card names its own; listed and added below
  const numbers = useLiveNumbers(true, { botId });
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId, refreshKey]);
  const deployments = useAsync((signal) => api.listDeployments(botId, { signal }), [botId, refreshKey]);

  const [version, setVersion] = useState(initialVersion || '');
  const [environment, setEnvironment] = useState('development');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState(null);
  const [last, setLast] = useState(null); // { deployment, preflight }
  const [typed, setTyped] = useState(''); // the word that confirms a production deploy despite a security item
  const [notFound, setNotFound] = useState({}); // env -> secrets missing at the last deploy there
  const formRef = useRef(null);
  // The validator's view of the chosen version, before anything is deployed.
  const check = useAsync(
    async (signal) => {
      if (!version) return null;
      const record = await api.getVersion(botId, version, { signal });
      const report = await api.validate(record.config, { signal });
      return { ...report, __record: record, __for: version };
    },
    [botId, version],
  );
  // Only the chosen version's check counts. useAsync keeps the previous answer while loading (and after a failure),
  // but that is another version's, so it is neither shown nor used to decide what a production deploy asks for.
  const report = check.data && check.data.__for === version && !check.loading ? check.data : null;

  const versionList = useMemo(() => versions.data || [], [versions.data]);
  useEffect(() => {
    if (!versionList.length) return;
    setVersion((current) => (versionList.some((item) => item.version === current) ? current : versionList[0].version));
  }, [versionList]);

  // A deploy may come back "pending"; it is followed until it settles. The previous version keeps serving meanwhile.
  const watch = useDeploymentWatch(botId, last?.deployment, (deployment) => {
    setLast((old) => (old ? { ...old, deployment } : old));
    // the secrets the server couldn't find belong to the version that now runs there: only once it does
    if (deployment.status === 'active') setNotFound((old) => ({ ...old, [deployment.environment]: last?.preflight?.secrets_missing || [] }));
    if (deployment.status !== 'pending') {
      deployments.reload();
      onDeployed?.();
    }
  });

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      const result = await api.deploy(botId, { version, environment, note: note.trim() });
      setLast(result);
      if (result.deployment.status === 'active') setNotFound((old) => ({ ...old, [environment]: result.preflight?.secrets_missing || [] }));
      setConfirming(false);
      setNote('');
      deployments.reload();
      if (result.deployment.status !== 'pending') onDeployed?.();
    } catch (err) {
      setError(err);
    } finally {
      setDeploying(false);
    }
  };

  // Production with a failed check: its protections are unknown, so the confirming word is asked for anyway.
  const security = report ? splitUnsupported(report.unsupported).security : environment === 'production' && check.error ? ['unchecked'] : [];
  const allowed = mayDeploy({ environment, security, typed }) && (!!report || !!check.error);
  const onDeployClick = () => {
    if (!allowed) return;
    if (environment === 'production' && !confirming) {
      setConfirming(true);
      return;
    }
    deploy();
  };

  // "Roll back" only fills in the form with the previous version; the button still has to be pressed.
  const prepareRollback = (env, to) => {
    setVersion(to);
    setEnvironment(env);
    setNote(`Roll back from ${deployments.data?.current?.[env]?.version}`);
    setConfirming(false);
    setTyped('');
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  if ((envs.loading && !envs.data) || (versions.loading && !versions.data)) return <Spinner label="Loading deployments" />;
  if (envs.error && !envs.data) return <ErrorState error={envs.error} onRetry={envs.reload} what="the environments" />;
  if (versions.error && !versions.data) return <ErrorState error={versions.error} onRetry={versions.reload} what="the versions" />;

  const current = deployments.data?.current || {};
  // The API lists deployments oldest first; show the latest at the top.
  // A deployment followed by a newer one to the same environment no longer runs there: "Replaced".
  const history = (() => {
    const seen = new Set();
    return [...(deployments.data?.history || [])].reverse().map((item) => {
      const shown = item.status === 'active' && seen.has(item.environment) ? { ...item, status: 'replaced' } : item;
      if (item.status === 'active') seen.add(item.environment);
      return shown;
    });
  })();
  const environments = envs.data || [];
  // a deployment under way holds the form, unless following it stopped (then what runs is unknown, and deploying or
  // rolling back is the person's call again)
  const inFlight = deploying || (last?.deployment?.status === 'pending' && !watch.checkError);
  const running = current[environment]?.version;
  // Until the deployments have arrived we don't know what is running where, so never claim "nothing".
  const known = !!deployments.data;

  return (
    <div className="stDeploy">
      <DemoNote kind="deploy">
        “Deploy” only records which version an environment points at, here in this browser. Nothing is live: no phone number, widget or server is involved, and
        a real agent is not running anywhere.
      </DemoNote>
      {deployments.error && !deployments.data && <ErrorState error={deployments.error} onRetry={deployments.reload} what="what is deployed" />}
      <section className="stEnvGrid" aria-label="What is running where" aria-busy={!known}>
        {environments.map((env) => {
          const item = current[env];
          const back = rollbackTarget(deployments.data, env);
          const missingSecrets = notFound[env] || [];
          const dialled = numbers.mode === 'live' ? numbers.rows.filter((row) => row.environment === env).map((row) => row.number) : [];
          return (
            <div key={env} className={`stEnvCard ${env} ${item ? 'on' : ''}`}>
              <small>{envLabel(env)}</small>
              {!known ? (
                <>
                  <strong className="none">{deployments.error ? 'Unknown' : 'Loading…'}</strong>
                  <span>{deployments.error ? 'Couldn’t read what is deployed' : 'Checking what is running here'}</span>
                </>
              ) : item ? (
                <>
                  <strong>v{item.version}</strong>
                  <span>
                    {formatWhen(item.deployed_at)}
                    {item.deployed_by ? ` by ${item.deployed_by}` : ''}
                  </span>
                  {back && versionList.some((v) => v.version === back) && !inFlight && (
                    <button type="button" className="stLink" onClick={() => prepareRollback(env, back)}>
                      Roll back to v{back}…
                    </button>
                  )}
                  {missingSecrets.length > 0 && (
                    <small className="stFWarn stEnvSecrets" title="Names the server could not find when this was deployed. Checked at deploy time.">
                      Secrets not found: {missingSecrets.join(', ')}
                    </small>
                  )}
                </>
              ) : (
                <>
                  <strong className="none">Nothing deployed</strong>
                  <span>Callers routed here get no agent</span>
                </>
              )}
              {dialled.length > 0 && (
                <span className="stEnvNumbers" data-numbers={env} title="The phone numbers whose calls this environment answers">
                  <Icon name="phone" size={13} /> {dialled.join(', ')}
                </span>
              )}
            </div>
          );
        })}
      </section>

      {versionList.length === 0 ? (
        <section className="emptyPanel">
          <div className="emptyPanelIcon" aria-hidden="true">
            <Icon name="release" size={22} />
          </div>
          <h2>Publish a version first</h2>
          <p>Only published versions can be deployed. Use Publish in the header once the draft is valid.</p>
        </section>
      ) : (
        <section className="stCard" ref={formRef}>
          <h3>Deploy a version</h3>
          <div className="stDeployForm">
            <label>
              <span>Version</span>
              <SmartSelect
                className=""
                value={version}
                ariaLabel="Version"
                disabled={inFlight}
                options={versionList.map((item, index) => ({ value: item.version, label: `${item.version}${index === 0 ? ' (latest)' : ''}` }))}
                onChange={(chosen) => {
                  setVersion(chosen);
                  setConfirming(false);
                  setTyped('');
                }}
              />
            </label>
            <label>
              <span>Environment</span>
              <Select
                value={environment}
                onChange={(event) => {
                  setEnvironment(event.target.value);
                  setConfirming(false);
                  setTyped('');
                }}
                disabled={inFlight}
              >
                {environments.map((env) => (
                  <option key={env} value={env}>
                    {envLabel(env)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="wide">
              <span>
                Note <em>(optional)</em>
              </span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why this version, or what changed"
                maxLength={200}
                disabled={inFlight}
              />
            </label>
          </div>

          {!report && !check.error && <p className="stMuted">Checking this version…</p>}
          {!report && check.error && <p className="stMuted">Couldn’t check this version before deploying ({check.error.message}). You can still deploy it.</p>}
          {report && (
            <ReleaseChecklist
              botId={botId}
              config={report.__record?.config}
              report={report}
              version={{ version, checksum: report.__record?.checksum }}
              environment={environment}
              refreshKey={refreshKey}
            />
          )}
          {report && environment === 'production' && security.length > 0 && (
            <p className="stMuted">Because of the protections above, deploying to production asks you to type “{PRODUCTION_WORD}” first.</p>
          )}
          {environment === 'production' && security.length > 0 && (
            <label className="stTypedConfirm">
              <span>
                Type <b>{PRODUCTION_WORD}</b> to deploy this to production anyway
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={PRODUCTION_WORD}
                autoComplete="off"
                spellCheck={false}
                disabled={inFlight}
              />
            </label>
          )}
          {running === version && (
            <p className="stMuted">
              Version {version} is already running in {envLabel(environment)}. Deploying it again creates a new deployment record.
            </p>
          )}
          {running && running !== version && (
            <p className="stMuted">
              This replaces version {running} in {envLabel(environment)}. To roll back, deploy an older version (the “Roll back” link above fills it in).
            </p>
          )}
          {confirming && (
            <Notice kind="warn" title="This changes what real callers get">
              Production will switch to version {version}. Press the button again to confirm.
            </Notice>
          )}
          {error && (
            <Notice kind="error" title="Couldn’t deploy">
              {error.message}
            </Notice>
          )}

          <div className="stActions">
            <button
              type="button"
              className={environment === 'production' && confirming ? 'dangerButton' : 'primaryCta compactCta'}
              onClick={onDeployClick}
              disabled={!version || inFlight || !allowed}
              title={!allowed ? `Type “${PRODUCTION_WORD}” above to confirm` : undefined}
            >
              {deploying ? 'Deploying…' : confirming ? `Confirm: deploy ${version} to production` : `Deploy to ${envLabel(environment)}`}
            </button>
            {confirming && (
              <Button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            )}
          </div>
        </section>
      )}

      {last && (
        <section className="stCard">
          <h3>Latest deployment</h3>
          {/* a status: a screen reader hears it move from deploying to active or failed */}
          <div className="stLast" role="status">
            <StatusPill status={last.deployment.status} />
            <span>
              v{last.deployment.version} → {envLabel(last.deployment.environment)}
            </span>
            {/* the version before is replaced only once this one runs; until then it still serves */}
            {last.deployment.previous_version && last.deployment.status === 'active' && (
              <span className="stMuted">replaced v{last.deployment.previous_version}</span>
            )}
          </div>
          {last.deployment.status === 'pending' && !watch.checkError && (
            <p className="stMuted">Setting things up. The previous version keeps serving until this one is active.</p>
          )}
          {last.deployment.status === 'pending' && watch.checkError && (
            <Notice
              kind="warn"
              title="Couldn’t check how this deployment is going"
              actions={
                <Button
                  type="button"
                  onClick={() => {
                    watch.retry();
                    deployments.reload();
                  }}
                >
                  Check again
                </Button>
              }
            >
              {watch.checkError.message} The previous version keeps serving until this one is active. Check again asks once more and reads the history below
              again.
            </Notice>
          )}
          {last.deployment.status === 'failed' && (
            <Notice kind="error" title="The deployment failed">
              {failureReason(last.deployment) ? `${failureReason(last.deployment)} ` : ''}The previous version is still serving.
            </Notice>
          )}
          <Preflight preflight={last.preflight} />
        </section>
      )}

      <AgentNumbers live={numbers} botId={botId} botName={name || botId} current={known ? current : null} />

      <section className="stCard">
        <h3>History</h3>
        {deployments.loading && !deployments.data ? (
          <Spinner label="Loading history" />
        ) : deployments.error && !deployments.data ? (
          <ErrorState error={deployments.error} onRetry={deployments.reload} what="the history" />
        ) : history.length === 0 ? (
          <p className="stMuted">No deployments yet.</p>
        ) : (
          <div className="stTable" role="table">
            <div className="stRow head hist" role="row">
              <span role="columnheader">Version</span>
              <span role="columnheader">Environment</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">When</span>
              <span role="columnheader">Note</span>
            </div>
            {history.map((item) => (
              <div className="stRow hist" role="row" key={item.id}>
                <span role="cell">
                  <strong>{item.version}</strong>
                  {item.previous_version && <small className="stMuted"> from {item.previous_version}</small>}
                </span>
                <span role="cell">{envLabel(item.environment)}</span>
                <span role="cell">
                  <StatusPill status={item.status} />
                </span>
                <span role="cell" title={item.deployed_at}>
                  {formatWhen(item.deployed_at)}
                  {item.deployed_by ? ` · ${item.deployed_by}` : ''}
                </span>
                <span role="cell" className="stNoteCell">
                  {item.note || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
