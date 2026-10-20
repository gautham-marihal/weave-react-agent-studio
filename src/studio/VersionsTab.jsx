import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import SmartSelect from './SmartSelect.jsx';
import { api } from '../api/client.js';
import { formatDiffPath, formatWhen, truncate } from './format.js';
import { navigate, routeHref } from './route.js';
import { ErrorState, Modal, Notice, Spinner } from './ui.jsx';
import { useAsync } from './useAsync.js';
import { isFinished, normalizeHeadline, testStatusOf } from './scenarios/runResults.js';
import ShipFlow from './release/ShipFlow.jsx';
import { shipSteps } from './release/shipFlow.js';
import { readinessSteps, stepRoute } from './newlayout/readiness.js';
import { useGate } from './release/gate.js';
import { useLatestPublished } from './changes/useLatestPublished.js';
import { changesSince } from './changes/sinceRelease.js';
import PlainDiff from './compare/PlainDiff.jsx';
import Menu from './manage/Menu.jsx';
import { plainChanges } from './compare/plainCompare.js';

const OP_LABEL = { add: 'Added', remove: 'Removed', change: 'Changed' };
const OP_MARK = { add: '+', remove: '−', change: '~' };

function Value({ value }) {
  const [open, setOpen] = useState(false);
  const full = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const long = full.length > 240;
  return (
    <div className="stValue">
      <pre>{open || !long ? full : truncate(full, 240)}</pre>
      {long && (
        <button type="button" className="linkButton" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

// meta.version / status / created_at / updated_at are set by the server when a version is published,
// so they differ in every comparison with the draft. They are real but rarely what you came to see.
const BOOKKEEPING = new Set(['version', 'status', 'created_at', 'updated_at']);
const isBookkeeping = (change) => change.path?.[0] === 'meta' && change.path.length === 2 && BOOKKEEPING.has(change.path[1]);

const sideName = (v) => (String(v) === 'draft' ? 'the draft' : `version ${v}`);

function DiffView({ diff }) {
  const [showMeta, setShowMeta] = useState(false);
  const { shown, hiddenCount } = useMemo(() => {
    const all = diff?.changes || [];
    return { shown: showMeta ? all : all.filter((change) => !isBookkeeping(change)), hiddenCount: all.filter(isBookkeeping).length };
  }, [diff, showMeta]);
  const groups = useMemo(() => {
    const map = new Map();
    shown.forEach((change) => {
      const key = change.path?.[0] ?? '(config)';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(change);
    });
    return [...map.entries()];
  }, [shown]);

  const [technical, setTechnical] = useState(false);
  const plain = useMemo(() => plainChanges(diff?.changes || []), [diff]);
  if (!diff) return null;
  const toggle = hiddenCount > 0 && (
    <button type="button" className="linkButton" onClick={() => setShowMeta((v) => !v)}>
      {showMeta ? 'Hide' : 'Show'} version bookkeeping ({hiddenCount}, set by the server on publish)
    </button>
  );
  if (!technical) {
    if (plain.total === 0) {
      return (
        <div className="stDiff">
          <p className="stMuted">
            {sideName(diff.from)} and {sideName(diff.to)} are the same{hiddenCount ? ', apart from details the server sets when a version is published' : ''}.
          </p>
        </div>
      );
    }
    return (
      <div className="stDiff">
        <p className="stMuted">
          {plain.total} change{plain.total === 1 ? '' : 's'} from {sideName(diff.from)} to {sideName(diff.to)}.{' '}
          <button type="button" className="linkButton" onClick={() => setTechnical(true)}>
            Show the technical view
          </button>
        </p>
        <PlainDiff plain={plain} />
      </div>
    );
  }
  if (!shown.length) {
    return (
      <div className="stDiff">
        <p className="stMuted">
          No differences between {diff.from} and {diff.to}
          {hiddenCount ? ' apart from version bookkeeping' : ''}.
        </p>
        {toggle}
      </div>
    );
  }
  return (
    <div className="stDiff">
      <p className="stMuted">
        {shown.length} change{shown.length === 1 ? '' : 's'} in {groups.length} section{groups.length === 1 ? '' : 's'}.{' '}
        <button type="button" className="linkButton" onClick={() => setTechnical(false)}>
          Back to the plain view
        </button>{' '}
        {toggle}
      </p>
      {groups.map(([section, changes]) => (
        <details key={section} className="stDiffGroup" open={groups.length <= 3}>
          <summary>
            <strong>{section}</strong>
            <span>{changes.length}</span>
          </summary>
          {changes.map((change, index) => (
            <div key={index} className={`stChange ${change.op}`}>
              <div className="stChangeHead">
                <b aria-label={OP_LABEL[change.op]}>{OP_MARK[change.op]}</b>
                <code>{formatDiffPath(change.path)}</code>
              </div>
              <div className="stChangeBody">
                {change.op !== 'add' && (
                  <div>
                    <small>{change.op === 'remove' ? 'Removed' : 'Before'}</small>
                    <Value value={change.before} />
                  </div>
                )}
                {change.op !== 'remove' && (
                  <div>
                    <small>{change.op === 'add' ? 'Added' : 'After'}</small>
                    <Value value={change.after} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}

function RestoreDialog({ botId, version, dirty, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const [old, draft] = await Promise.all([api.getVersion(botId, version), api.getDraft(botId)]);
      // The restored copy needs a version number that is still unused: keep the draft's current one.
      // created_at / updated_at / status are set by the server on publish, so they are not carried back.
      const { created_at: _c, updated_at: _u, ...oldMeta } = old.config.meta || {};
      const config = { ...old.config, meta: { ...oldMeta, status: draft.config.meta?.status || 'draft', version: draft.config.meta?.version } };
      await api.saveDraft(botId, config, draft.revision);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="RESTORE"
      title={`Restore version ${version}`}
      subtitle="The draft is replaced with this version’s configuration. Nothing is published or deployed until you do that yourself."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="modalCreate" onClick={restore} disabled={busy}>
            {busy ? 'Restoring…' : 'Restore as draft'}
          </button>
        </>
      }
    >
      {dirty && (
        <Notice kind="warn" title="You have unsaved edits">
          They will be lost if you restore.
        </Notice>
      )}
      {error && (
        <Notice kind="error" title="Couldn’t restore">
          {error.kind === 'conflict' ? 'The draft changed while you were restoring. Try again.' : error.message}
        </Notice>
      )}
    </Modal>
  );
}

export default function VersionsTab({ botId, editor, refreshKey, summary }) {
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId, refreshKey]);
  const list = useMemo(() => versions.data || [], [versions.data]);
  // test runs say which exact configuration they tested, so a version can show whether IT passed (a read; nothing is run)
  const runs = useAsync((signal) => api.listTestRuns(botId, 50, { signal }), [botId, refreshKey]);
  const headlines = useMemo(() => (Array.isArray(runs.data) ? runs.data.map(normalizeHeadline) : []), [runs.data]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('draft');
  const [restoreTarget, setRestoreTarget] = useState(null);
  const compareRef = useRef(null);
  // where each version runs now: { '0.1.0': ['Staging'], ... }
  const runsIn = useMemo(() => {
    const out = {};
    ['development', 'staging', 'production'].forEach((env) => {
      const version = summary?.deployed?.[env];
      if (version) out[version] = [...(out[version] || []), env];
    });
    return out;
  }, [summary]);

  // Default comparison: the newest published version against the draft.
  useEffect(() => {
    if (!list.length) return;
    setFrom((current) => (current && list.some((item) => item.version === current) ? current : list[0].version));
  }, [list]);

  // where the draft stands on the way to callers: saved, valid, tested, published, deployed
  const latest = useLatestPublished(botId, refreshKey);
  const [gateOn] = useGate(botId);
  const latestRun = useMemo(() => (Array.isArray(runs.data) ? headlines.find((run) => isFinished(run.status)) || null : undefined), [runs.data, headlines]);
  const flow = useMemo(() => {
    const draft = editor.parsed.value;
    const pub = latest.published;
    return shipSteps({
      dirty: editor.dirty,
      parseError: editor.parsed.error || '',
      report: editor.report,
      scenarioCount: Array.isArray(draft?.tests) ? draft.tests.length : 0,
      latestRun: latestRun || null,
      published: pub?.config ? { version: pub.version, changes: draft ? changesSince(pub.config, draft).total : 0 } : null,
      deployed: summary?.deployed || {},
      gate: { enabled: gateOn, savedAt: editor.meta?.savedAt || '' },
    });
  }, [editor.dirty, editor.parsed, editor.report, editor.meta?.savedAt, latestRun, latest.published, summary, gateOn]);
  // the steps of building it that are still to do (the same list as the menu's progress card and the Overview), so this page never calls it ready alone
  const buildLeft = useMemo(() => {
    const draft = editor.parsed.value;
    const plan = readinessSteps({
      config: draft,
      summary,
      report: editor.report,
      scenarioCount: Array.isArray(draft?.tests) ? draft.tests.length : 0,
      latestRun,
      gate: gateOn ? { enabled: true, savedAt: editor.meta?.savedAt || '', dirty: editor.dirty } : null,
    });
    return plan.steps.filter((step) => (step.state === 'todo' || step.state === 'blocked') && !['checks', 'tests', 'releases'].includes(step.page));
  }, [editor.parsed, editor.report, editor.meta?.savedAt, editor.dirty, summary, latestRun, gateOn]);
  const goTo = (action) => navigate(action.publish ? routeHref(botId, 'versions', { publish: '1' }) : routeHref(botId, action.tab), { guard: false });
  const openStep = (step) => {
    const { tab, params } = stepRoute(step);
    navigate(routeHref(botId, tab, params), { guard: false });
  };

  const canDiff = !!from && !!to && from !== to;
  const diff = useAsync(
    (signal) => (canDiff ? api.diff(botId, from, to, { signal }) : Promise.resolve(null)),
    [botId, from, to, canDiff, editor.savedTick, refreshKey],
  );

  if (versions.loading && !versions.data) return <Spinner label="Loading versions" />;
  if (versions.error && !versions.data) return <ErrorState error={versions.error} onRetry={versions.reload} what="the versions" />;

  const options = [
    { value: 'draft', label: 'Draft (working copy)' },
    ...list.map((item, index) => ({ value: item.version, label: `Version ${item.version}${index === 0 ? ' (latest)' : ''}` })),
  ];

  return (
    <div className="stVersions">
      {!latest.loading && <ShipFlow flow={flow} onAction={goTo} buildLeft={buildLeft} onStep={openStep} />}
      {list.length === 0 ? (
        <section className="emptyPanel">
          <div className="emptyPanelIcon" aria-hidden="true">
            <Icon name="release" size={22} />
          </div>
          <h2>Nothing published yet</h2>
          <p>Publishing freezes the draft as an immutable version you can compare, restore and deploy.</p>
        </section>
      ) : (
        <>
          <section className="stCard">
            <h3>Published versions</h3>
            <div className="stTable" role="table">
              <div className="stRow head" role="row">
                <span>Version</span>
                <span>Published</span>
                <span>By</span>
                <span>Checksum</span>
                <span>Tests</span>
                <span />
              </div>
              {list.map((item, index) => (
                <div className="stRow" role="row" key={item.version}>
                  <span className="stVersionCell">
                    <strong>{item.version}</strong>
                    {index === 0 && <em className="stTag">latest</em>}
                    {(runsIn[item.version] || []).map((env) => (
                      <em key={env} className={`stEnvTag ${env}`} title={`This version runs in ${env}`}>
                        {env === 'development' ? 'Dev' : env === 'staging' ? 'Staging' : 'Production'}
                      </em>
                    ))}
                  </span>
                  <span title={item.published_at}>{formatWhen(item.published_at)}</span>
                  <span>{item.published_by || '—'}</span>
                  <span>
                    <code>{String(item.checksum || '').slice(0, 10)}</code>
                  </span>
                  <span>
                    {(() => {
                      const t = testStatusOf(item, headlines);
                      return (
                        <span
                          className={`stTestChip ${t.state}`}
                          title={
                            t.state === 'none'
                              ? 'No run has tested this exact version'
                              : t.state === 'partial'
                                ? 'The latest run on this exact version covered only some of its scenarios'
                                : `The latest run on this exact version ${t.text.toLowerCase()}`
                          }
                        >
                          {runs.error ? '—' : t.text}
                        </span>
                      );
                    })()}
                  </span>
                  {/* one thing to do with a version, the rest in its menu */}
                  <span className="stRowActions">
                    <button
                      type="button"
                      className="quietButton"
                      onClick={() => navigate(routeHref(botId, 'deploy', { version: item.version }), { guard: false })}
                    >
                      Deploy…
                    </button>
                    <Menu
                      label={`More for version ${item.version}`}
                      items={[
                        {
                          label: 'Compare with the draft',
                          onClick: () => {
                            setFrom(item.version);
                            setTo('draft');
                            compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          },
                        },
                        { label: 'Restore as the draft…', onClick: () => setRestoreTarget(item.version) },
                      ]}
                    />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="stCard" ref={compareRef}>
            <h3>Compare</h3>
            <div className="stCompare">
              <label>
                <span>From</span>
                <SmartSelect className="" value={from} ariaLabel="From" options={options} onChange={setFrom} />
              </label>
              <b aria-hidden="true">
                <Icon name="arrowRight" size={16} />
              </b>
              <label>
                <span>To</span>
                <SmartSelect className="" value={to} ariaLabel="To" options={options} onChange={setTo} />
              </label>
            </div>
            {!canDiff && <p className="stMuted">Choose two different versions to compare.</p>}
            {canDiff && diff.loading && !diff.data && <Spinner label="Comparing" />}
            {canDiff && diff.error && <ErrorState error={diff.error} onRetry={diff.reload} what="the comparison" />}
            {canDiff && !diff.error && diff.data && <DiffView key={`${from}-${to}`} diff={diff.data} />}
          </section>
        </>
      )}

      {restoreTarget && (
        <RestoreDialog
          botId={botId}
          version={restoreTarget}
          dirty={editor.dirty}
          onClose={() => setRestoreTarget(null)}
          onDone={() => {
            setRestoreTarget(null);
            editor.reload();
            navigate(routeHref(botId, 'config'), { guard: false });
          }}
        />
      )}
    </div>
  );
}
