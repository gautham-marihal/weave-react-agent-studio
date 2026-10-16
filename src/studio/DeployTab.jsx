import React, { useEffect, useMemo, useRef, useState } from 'react';
import SmartSelect from './SmartSelect.jsx';
import { api } from '../api/client.js';
import { formatWhen } from './format.js';
import { DemoNote } from '../demo/DemoBadge.jsx';
import { PRODUCTION_WORD, mayDeploy, rollbackTarget, splitUnsupported } from './preflight.js';
import { envLabel, ErrorState, Notice, Spinner } from './ui.jsx';
import { useAsync } from './useAsync.js';
import ReleaseChecklist from './release/ReleaseChecklist.jsx';
import { normalizePreflightKnowledge } from './release/checklist.js';

const STATUS_TEXT = { active: 'Active', pending: 'Deploying…', failed: 'Failed' };

function StatusPill({ status }) {
  return (
    <span className={`stStatus ${status}`}>
      <i aria-hidden="true" />
      {STATUS_TEXT[status] || status}
    </span>
  );
}

// Parts of the agent the runtime can't run yet. A security item (a protection that is declared but not enforced) comes
// first, in red: the agent looks protected and isn't.
export function UnsupportedNotices({ items }) {
  const { security, advice } = splitUnsupported(items);
  if (!security.length && !advice.length) return null;
  return (
    <>
      {security.length > 0 && (
        <Notice kind="error" title={`${security.length} protection${security.length === 1 ? ' is' : 's are'} declared but not enforced`}>
          The agent looks protected and is not: the runtime doesn’t enforce {security.length === 1 ? 'this' : 'these'} yet.
          <ul className="stPlain">
            {security.map((item, index) => (
              <li key={index}>
                <strong>{item.feature}</strong> <code>{item.where}</code>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {advice.length > 0 && (
        <Notice kind="warn" title={`${advice.length} feature${advice.length === 1 ? '' : 's'} not available in the runtime yet`}>
          <ul className="stPlain">
            {advice.map((item, index) => (
              <li key={index}>
                {item.feature} <code>{item.where}</code>
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
}

function Preflight({ preflight }) {
  if (!preflight) return null;
  const missing = preflight.secrets_missing || [];
  const unsupported = preflight.unsupported || [];
  const knowledge = normalizePreflightKnowledge(preflight.knowledge);
  if (!missing.length && !unsupported.length && !knowledge.length) return null;
  return (
    <div className="stPreflight">
      {missing.length > 0 && (
        <Notice kind="warn" title={`${missing.length} secret${missing.length === 1 ? '' : 's'} not found on the server`}>
          The agent may fail when it needs them. Names only; they can’t be set from here yet.
          <div className="stChips">
            {missing.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
        </Notice>
      )}
      {knowledge.length > 0 && (
        <Notice kind="warn" title={`${knowledge.length} knowledge problem${knowledge.length === 1 ? '' : 's'} in this version`}>
          Callers asking about these get no answer from the knowledge base, or an out-of-date one.
          <ul className="stPlain">
            {knowledge.map((p, i) => (
              <li key={i}>
                {p.base && <strong>{p.base}: </strong>}
                {p.problem}
                {p.fix ? ` ${p.fix}` : ''}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <UnsupportedNotices items={unsupported} />
    </div>
  );
}

export default function DeployTab({ botId, initialVersion, refreshKey, onDeployed }) {
  const envs = useAsync((signal) => api.environments({ signal }), []);
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId, refreshKey]);
  const deployments = useAsync((signal) => api.listDeployments(botId, { signal }), [botId, refreshKey]);

  const [version, setVersion] = useState(initialVersion || '');
  const [environment, setEnvironment] = useState('development');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState(null);
  const [last, setLast] = useState(null); // { deployment, preflight }
  const [typed, setTyped] = useState(''); // the word that confirms a production deploy while a security item stands
  const [notFound, setNotFound] = useState({}); // environment -> secrets the server couldn't find when something was last deployed there
  const formRef = useRef(null);
  // The validator's view of the chosen version, before anything is deployed.
  const check = useAsync(
    async (signal) => {
      if (!version) return null;
      const record = await api.getVersion(botId, version, { signal });
      const report = await api.validate(record.config, { signal });
      return { ...report, __record: record };
    },
    [botId, version],
  );

  const versionList = useMemo(() => versions.data || [], [versions.data]);
  useEffect(() => {
    if (!versionList.length) return;
    setVersion((current) => (versionList.some((item) => item.version === current) ? current : versionList[0].version));
  }, [versionList]);

  // A deploy may come back "pending"; poll it until it settles. The previous version keeps serving meanwhile.
  const pendingId = last?.deployment?.status === 'pending' ? last.deployment.id : null;
  useEffect(() => {
    if (!pendingId) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await api.getDeployment(botId, pendingId);
        const deployment = result.deployment || result;
        if (cancelled) return;
        setLast((old) => (old ? { ...old, deployment } : old));
        if (deployment.status !== 'pending') {
          deployments.reload();
          onDeployed?.();
        }
      } catch {
        /* try again on the next tick */
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId, botId]);

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      const result = await api.deploy(botId, { version, environment, note: note.trim() });
      setLast(result);
      setNotFound((old) => ({ ...old, [environment]: result.preflight?.secrets_missing || [] }));
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

  const security = splitUnsupported(check.data?.unsupported).security;
  const allowed = mayDeploy({ environment, security, typed });
  const onDeployClick = () => {
    if (!allowed) return;
    if (environment === 'production' && !confirming) {
      setConfirming(true);
      return;
    }
    deploy();
  };

  // "Roll back" only fills in the form (the version before this one, in this environment); the button still has to be pressed.
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
  const history = [...(deployments.data?.history || [])].reverse();
  const environments = envs.data || [];
  const inFlight = deploying || last?.deployment?.status === 'pending';
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
            </div>
          );
        })}
      </section>

      {versionList.length === 0 ? (
        <section className="emptyPanel">
          <div className="emptyPanelIcon" aria-hidden="true">
            ▲
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
              <select
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
              </select>
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

          {check.loading && !check.data && <p className="stMuted">Checking this version…</p>}
          {check.error && <p className="stMuted">Couldn’t check this version before deploying ({check.error.message}). You can still deploy it.</p>}
          {check.data && (
            <ReleaseChecklist
              botId={botId}
              config={check.data.__record?.config}
              report={check.data}
              version={{ version, checksum: check.data.__record?.checksum }}
              environment={environment}
              refreshKey={refreshKey}
            />
          )}
          {check.data && environment === 'production' && security.length > 0 && (
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
              <button type="button" className="quietButton" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            )}
          </div>
        </section>
      )}

      {last && (
        <section className="stCard">
          <h3>Latest deployment</h3>
          <div className="stLast">
            <StatusPill status={last.deployment.status} />
            <span>
              v{last.deployment.version} → {envLabel(last.deployment.environment)}
            </span>
            {last.deployment.previous_version && <span className="stMuted">replaced v{last.deployment.previous_version}</span>}
          </div>
          {last.deployment.status === 'pending' && <p className="stMuted">Setting things up. The previous version keeps serving until this one is active.</p>}
          {last.deployment.status === 'failed' && (
            <Notice kind="error" title="The deployment failed">
              The previous version is still serving.
            </Notice>
          )}
          <Preflight preflight={last.preflight} />
        </section>
      )}

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
              <span>Version</span>
              <span>Environment</span>
              <span>Status</span>
              <span>When</span>
              <span>Note</span>
            </div>
            {history.map((item) => (
              <div className="stRow hist" role="row" key={item.id}>
                <span>
                  <strong>{item.version}</strong>
                  {item.previous_version && <small className="stMuted"> from {item.previous_version}</small>}
                </span>
                <span>{envLabel(item.environment)}</span>
                <span>
                  <StatusPill status={item.status} />
                </span>
                <span title={item.deployed_at}>
                  {formatWhen(item.deployed_at)}
                  {item.deployed_by ? ` · ${item.deployed_by}` : ''}
                </span>
                <span className="stNoteCell">{item.note || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
