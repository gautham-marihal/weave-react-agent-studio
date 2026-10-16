import { useEffect, useMemo, useState } from 'react';
import SmartSelect from './SmartSelect.jsx';
import { api } from '../api/client.js';
import { formatDiffPath, formatWhen, truncate } from './format.js';
import { navigate, routeHref } from './route.js';
import { ErrorState, Modal, Notice, Spinner } from './ui.jsx';
import { useAsync } from './useAsync.js';
import { normalizeHeadline, testStatusOf } from './scenarios/runResults.js';

const OP_LABEL = { add: 'Added', remove: 'Removed', change: 'Changed' };
const OP_MARK = { add: '+', remove: '−', change: '~' };

function Value({ value }) {
  const [open, setOpen] = useState(false);
  const full = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const long = full.length > 240;
  return (
    <div className="stValue">
      <pre>{open || !long ? full : truncate(full, 240)}</pre>
      {long && <button type="button" className="linkButton" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Show all'}</button>}
    </div>
  );
}

// meta.version / status / created_at / updated_at are set by the server when a version is published,
// so they differ in every comparison with the draft. They are real but rarely what you came to see.
const BOOKKEEPING = new Set(['version', 'status', 'created_at', 'updated_at']);
const isBookkeeping = (change) => change.path?.[0] === 'meta' && change.path.length === 2 && BOOKKEEPING.has(change.path[1]);

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

  if (!diff) return null;
  const toggle = hiddenCount > 0 && (
    <button type="button" className="linkButton" onClick={() => setShowMeta((v) => !v)}>
      {showMeta ? 'Hide' : 'Show'} version bookkeeping ({hiddenCount}, set by the server on publish)
    </button>
  );
  if (!shown.length) {
    return (
      <div className="stDiff">
        <p className="stMuted">No differences between {diff.from} and {diff.to}{hiddenCount ? ' apart from version bookkeeping' : ''}.</p>
        {toggle}
      </div>
    );
  }
  return (
    <div className="stDiff">
      <p className="stMuted">{shown.length} change{shown.length === 1 ? '' : 's'} in {groups.length} section{groups.length === 1 ? '' : 's'}. {toggle}</p>
      {groups.map(([section, changes]) => (
        <details key={section} className="stDiffGroup" open={groups.length <= 3}>
          <summary><strong>{section}</strong><span>{changes.length}</span></summary>
          {changes.map((change, index) => (
            <div key={index} className={`stChange ${change.op}`}>
              <div className="stChangeHead"><b aria-label={OP_LABEL[change.op]}>{OP_MARK[change.op]}</b><code>{formatDiffPath(change.path)}</code></div>
              <div className="stChangeBody">
                {change.op !== 'add' && <div><small>{change.op === 'remove' ? 'Removed' : 'Before'}</small><Value value={change.before} /></div>}
                {change.op !== 'remove' && <div><small>{change.op === 'add' ? 'Added' : 'After'}</small><Value value={change.after} /></div>}
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
      footer={(
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="modalCreate" onClick={restore} disabled={busy}>{busy ? 'Restoring…' : 'Restore as draft'}</button>
        </>
      )}
    >
      {dirty && <Notice kind="warn" title="You have unsaved edits">They will be lost if you restore.</Notice>}
      {error && <Notice kind="error" title="Couldn’t restore">{error.kind === 'conflict' ? 'The draft changed while you were restoring. Try again.' : error.message}</Notice>}
    </Modal>
  );
}

export default function VersionsTab({ botId, editor, refreshKey }) {
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId, refreshKey]);
  const list = useMemo(() => versions.data || [], [versions.data]);
  // test runs say which exact configuration they tested, so a version can show whether IT passed (a read; nothing is run)
  const runs = useAsync((signal) => api.listTestRuns(botId, 50, { signal }), [botId, refreshKey]);
  const headlines = useMemo(() => (Array.isArray(runs.data) ? runs.data.map(normalizeHeadline) : []), [runs.data]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('draft');
  const [restoreTarget, setRestoreTarget] = useState(null);

  // Default comparison: the newest published version against the draft.
  useEffect(() => {
    if (!list.length) return;
    setFrom((current) => (current && list.some((item) => item.version === current) ? current : list[0].version));
  }, [list]);

  const canDiff = !!from && !!to && from !== to;
  const diff = useAsync((signal) => (canDiff ? api.diff(botId, from, to, { signal }) : Promise.resolve(null)), [botId, from, to, canDiff, editor.savedTick, refreshKey]);

  if (versions.loading && !versions.data) return <Spinner label="Loading versions" />;
  if (versions.error && !versions.data) return <ErrorState error={versions.error} onRetry={versions.reload} what="the versions" />;

  const options = [{ value: 'draft', label: 'Draft (working copy)' }, ...list.map((item, index) => ({ value: item.version, label: `Version ${item.version}${index === 0 ? ' (latest)' : ''}` }))];

  return (
    <div className="stVersions">
      {list.length === 0 ? (
        <section className="emptyPanel">
          <div className="emptyPanelIcon" aria-hidden="true">◫</div>
          <h2>Nothing published yet</h2>
          <p>Publishing freezes the draft as an immutable version you can compare, restore and deploy.</p>
        </section>
      ) : (
        <>
          <section className="stCard">
            <h3>Published versions</h3>
            <div className="stTable" role="table">
              <div className="stRow head" role="row"><span>Version</span><span>Published</span><span>By</span><span>Checksum</span><span>Tests</span><span /></div>
              {list.map((item, index) => (
                <div className="stRow" role="row" key={item.version}>
                  <span><strong>{item.version}</strong>{index === 0 && <em className="stTag">latest</em>}</span>
                  <span title={item.published_at}>{formatWhen(item.published_at)}</span>
                  <span>{item.published_by || '—'}</span>
                  <span><code>{String(item.checksum || '').slice(0, 10)}</code></span>
                  <span>{(() => { const t = testStatusOf(item, headlines); return <span className={`stTestChip ${t.state}`} title={t.state === 'none' ? 'No run has tested this exact version' : `The latest run on this exact version ${t.text.toLowerCase()}`}>{runs.error ? '—' : t.text}</span>; })()}</span>
                  <span className="stRowActions">
                    <button type="button" className="quietButton" onClick={() => { setFrom(item.version); setTo('draft'); }}>Compare</button>
                    <button type="button" className="quietButton" onClick={() => navigate(routeHref(botId, 'deploy', { version: item.version }), { guard: false })}>Deploy</button>
                    <button type="button" className="quietButton" onClick={() => setRestoreTarget(item.version)}>Restore</button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="stCard">
            <h3>Compare</h3>
            <div className="stCompare">
              <label><span>From</span>
                <SmartSelect className="" value={from} ariaLabel="From" options={options} onChange={setFrom} />
              </label>
              <b aria-hidden="true">→</b>
              <label><span>To</span>
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
          onDone={() => { setRestoreTarget(null); editor.reload(); navigate(routeHref(botId, 'config'), { guard: false }); }}
        />
      )}
    </div>
  );
}
