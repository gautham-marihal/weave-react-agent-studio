import React, { useEffect, useState } from 'react';
import { api } from '../../../../api/client.ts';
import Button from '../../../../ui/Button.tsx';
import { askConfirm } from '../../../../ui/dialogs.js';
import { Modal } from '../../../ui.jsx';
import { formatBytes, isBuilding, readableFix, readingState, sinceRead } from '../../../knowledge/model.js';
import { useBuilds } from '../../../knowledge/useKnowledge.js';
import { knowledgeOf, removeKnowledge } from '../../../setup/setupKnowledge.js';
import { buildStep, docBase } from './knowledgeView.js';
import './knowledge.css';

// Build › Knowledge, the documents' search index (FRONTEND_GUIDE 10.2): whether callers can get these answers yet,
// building it (POST …/build, then GET …/status until done or failed) and the state of each file and page. The server
// builds and searches what is SAVED, so a draft whose files differ says so and offers "Save and build". Building is
// only ever started by a press. The last index keeps answering while a new one builds, so a failed build costs nothing.
//   ctx: the Detailed page's (config, set, editor, botId, knowledgeRead: what GET /knowledge said, onUploaded: re-read)

const list = (v) => (Array.isArray(v) ? v : []);
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return '';
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};
const STEPS = ['Read', 'Cut into passages', 'Embed', 'Switch in'];
const passagesWord = (n) => `${n} passage${n === 1 ? '' : 's'}`;
// the server's 409 in plain words: its advice to add force=true is for code, and the dialog's buttons do that
const plainConflict = (message) =>
  String(message || '')
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/force\s*=/i.test(sentence))
    .join(' ');

// the base as the server knows it (from GET /knowledge), or null
const knownOf = (ctx, base) => (base && ctx.knowledgeRead ? list(ctx.knowledgeRead.bases).find((b) => b.id === base.id) || null : null);

// the base as the server knows it, and the build followed here (or one started elsewhere, picked up)
function useIndex(ctx) {
  const base = docBase(ctx.config);
  const known = knownOf(ctx, base);
  const builds = useBuilds(ctx.botId, { onChange: () => ctx.onUploaded?.() });
  const ownBuild = base ? builds.builds[base.id] : null;
  const { follow } = builds;
  const runningElsewhere = !ownBuild && isBuilding(known?.build);
  const baseId = base?.id;
  useEffect(() => {
    if (baseId && runningElsewhere) follow(baseId);
  }, [baseId, runningElsewhere, follow]);
  const build = ownBuild || known?.build || null;
  const reading = base ? readingState(known, { draftSources: base.sources, build }) : { state: 'none', names: [] };
  const keyAvailable = ctx.knowledgeRead ? ctx.knowledgeRead.keyAvailable !== false && known?.keyAvailable !== false : true;
  return { base, known, build, builds, reading, keyAvailable, loaded: !!ctx.knowledgeRead };
}

const RING = 2 * Math.PI * 27;
function Ring({ share, tone, children, spinning }) {
  return (
    <span className={`kxRing ${tone} ${spinning ? 'spin' : ''}`}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r="27" className="kxRingTrack" />
        <circle cx="32" cy="32" r="27" className="kxRingFill" strokeDasharray={RING.toFixed(1)} strokeDashoffset={((1 - share) * RING).toFixed(1)} />
      </svg>
      <b>{children}</b>
    </span>
  );
}

// The "Search index" row
export function IndexRow({ ctx }) {
  const { base, known, build, builds, reading, keyAvailable, loaded } = useIndex(ctx);
  const [saving, setSaving] = useState(false);
  if (!base) return <span className="dtNote">Add a document or a web page first.</span>;
  const passages = known?.index?.passages || 0;
  const facts = known?.index
    ? [when(known.index.builtAt) && `Built ${when(known.index.builtAt)}`, passagesWord(passages), known.index.embedding].filter(Boolean).join(' · ')
    : '';
  const error = builds.errors[base.id];
  const start = async () => {
    if (reading.state === 'unsaved') {
      setSaving(true);
      const saved = await ctx.editor?.save?.();
      setSaving(false);
      if (!saved) return;
      await ctx.onUploaded?.();
    }
    builds.start(base.id);
  };
  const S = {
    none: { title: 'Reading what the server has…', sub: '', tone: 'idle', share: 0 },
    unsaved: {
      title: 'Not saved yet',
      sub: 'The server builds what is saved: these files and pages aren’t, yet.',
      tone: 'idle',
      share: passages ? 1 : 0,
      go: 'Save and build',
    },
    reading: {
      title: 'Building…',
      sub: `${build?.startedAt ? `Started ${ago(build.startedAt)}` : 'Started'} · the last index keeps answering meanwhile`,
      tone: 'accent',
      share: (buildStep(build) + 0.5) / 4,
    },
    missing: {
      title: 'A file isn’t uploaded',
      sub: `${reading.names.join(', ')} ${reading.names.length === 1 ? 'is' : 'are'} named but not on the server: a build leaves ${reading.names.length === 1 ? 'it' : 'them'} out.`,
      tone: 'bad',
      share: passages ? 1 : 0,
      go: 'Build now',
    },
    failed: {
      title: 'The build failed',
      sub: build?.error || 'The server didn’t say why.',
      tone: 'bad',
      share: passages ? 1 : 0,
      go: 'Try again',
      pill: passages ? 'The last index is still answering' : '',
    },
    unread: { title: 'Not built yet', sub: 'Callers get no answers from these files until it is built.', tone: 'idle', share: 0, go: 'Build now' },
    changed: {
      title: 'Out of date',
      sub: facts,
      tone: 'warn',
      share: 1,
      go: 'Build now',
      pill: reading.names.length ? `${reading.names.length} changed` : 'Changed',
    },
    ready: { title: 'Up to date', sub: facts, tone: 'good', share: 1, go: 'Build again', quiet: true },
  };
  const s = loaded ? S[reading.state] || S.none : S.none;
  const busy = reading.state === 'reading' || saving;
  // the server's problems that aren't about one listed file (those are said on the file's own card)
  const general = list(known?.problems).filter(
    (p) => !/^The file .+? (is not uploaded|changed after)/i.test(p.problem) && !/no index has been built/i.test(p.problem),
  );
  return (
    <div className="kxIndexBox">
      <div className={`kxIndex ${s.tone}`} data-state={loaded ? reading.state : 'loading'}>
        <Ring share={s.share} tone={s.tone} spinning={reading.state === 'reading'}>
          {reading.state === 'reading' ? `${Math.round(s.share * 100)}%` : passages}
        </Ring>
        <span className="kxIndexWords">
          <b>
            {s.title}
            {s.pill && <span className={`kxPill ${s.tone === 'good' ? 'good' : s.tone === 'bad' ? 'grey' : 'warn'}`}>{s.pill}</span>}
          </b>
          {s.sub && <small>{s.sub}</small>}
        </span>
        {s.go && (
          <Button
            type="button"
            variant={s.quiet ? 'secondary' : 'primary'}
            size="compact"
            onClick={start}
            disabled={!keyAvailable || busy || !ctx.botId}
            title={keyAvailable ? undefined : 'This server can’t build an index: it has no embedding key.'}
          >
            {saving ? 'Saving…' : s.go}
          </Button>
        )}
        {reading.state === 'reading' && (
          <Button type="button" size="compact" disabled>
            Building…
          </Button>
        )}
      </div>
      {reading.state === 'reading' && (
        <div className="kxBuild">
          <ol className="kxSteps" aria-label="How far the build is">
            {STEPS.map((step, i) => (
              <li
                key={step}
                className={i < buildStep(build) ? 'done' : i === buildStep(build) ? 'on' : ''}
                aria-current={i === buildStep(build) ? 'step' : undefined}
              >
                {step}
              </li>
            ))}
          </ol>
          {list(build?.log).length > 0 && (
            <pre className="kxLog" aria-label="What the build is doing">
              {list(build.log).slice(-4).join('\n')}
            </pre>
          )}
        </div>
      )}
      {!keyAvailable && (
        <p className="kxNote bad" role="note">
          This server can’t build an index: it has no embedding key. An operator has to set it on the server.
        </p>
      )}
      {error && (
        <p className="stFieldError" role="alert">
          {error}
        </p>
      )}
      {general.length > 0 && (
        <ul className="kxProblems" aria-label="What the server found">
          {general.map((p) => (
            <li key={p.problem}>
              {p.problem}
              {readableFix(p) ? ` ${readableFix(p)}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- the files and pages, each a card with its own state
const EXT = { pdf: 'PDF', md: 'MD', markdown: 'MD', txt: 'TXT', html: 'HTML', htm: 'HTML', csv: 'CSV', json: 'JSON' };
const extOf = (name) => EXT[String(name).split('.').pop().toLowerCase()] || 'FILE';
const hostOf = (url) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
};

function RemoveDialog({ name, onClose, onDone, ctx }) {
  const [choice, setChoice] = useState('out');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const options = [
    { id: 'out', title: 'Only take it out of this agent', hint: 'The file stays on the server for later.' },
    { id: 'del', title: 'Take it out and delete the file', hint: 'Gone from the server. The next build leaves it out.' },
  ];
  const go = async () => {
    const removed = removeKnowledge(ctx.config, 'file', name);
    if (removed.refused) {
      setProblem(removed.refused);
      return;
    }
    ctx.set(removed.config);
    if (choice === 'out') {
      onDone(`${name} is taken out of this agent. Save to keep it that way; the file stays on the server.`);
      return;
    }
    setBusy(true);
    try {
      await api.deleteKnowledgeFile(ctx.botId, name);
    } catch (e) {
      if (e?.kind !== 'conflict' && e?.status !== 409) {
        setBusy(false);
        onDone(`${name} is out of this agent, but the file couldn’t be deleted: ${e?.message || 'something went wrong'}.`, true);
        return;
      }
      // the saved draft still reads it: said, and deleted only on a second yes
      const sure = await askConfirm({
        title: 'The saved draft still reads this file',
        body: `${plainConflict(e.message)} Deleting it now means a build of the saved draft fails until you save this change. It is out of your draft either way.`.trim(),
        confirmLabel: 'Delete it anyway',
        cancelLabel: 'Keep the file',
        tone: 'danger',
      });
      if (!sure) {
        setBusy(false);
        onDone(`${name} is out of this agent; the file is kept on the server.`);
        return;
      }
      try {
        await api.deleteKnowledgeFile(ctx.botId, name, true);
      } catch (again) {
        setBusy(false);
        onDone(`${name} is out of this agent, but the file couldn’t be deleted: ${again?.message || 'something went wrong'}.`, true);
        return;
      }
    }
    setBusy(false);
    ctx.onUploaded?.();
    onDone(`${name} is taken out and deleted from the server.`);
  };
  return (
    <Modal
      title={`Remove ${name}?`}
      subtitle="It stops being part of what this agent answers from once you save."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant={choice === 'del' ? 'danger' : 'primary'} onClick={go} disabled={busy}>
            {busy ? 'Deleting…' : choice === 'del' ? 'Remove and delete' : 'Remove'}
          </Button>
        </>
      }
    >
      <div className="kxChoice" role="radiogroup" aria-label="What to remove">
        {options.map((o, index) => (
          <label key={o.id} className={`kxOpt ${choice === o.id ? 'on' : ''} ${o.id === 'del' ? 'del' : ''}`}>
            <input
              type="radio"
              name="kx-remove"
              value={o.id}
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
              autoFocus={index === 0}
              className="kxOptInput"
            />
            <span>
              <b>{o.title}</b>
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </div>
      {problem && (
        <p className="stFieldError" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  );
}

export function SourceCards({ ctx, id }) {
  const { files, pages, depths } = knowledgeOf(ctx.config);
  const known = knownOf(ctx, docBase(ctx.config));
  const [removing, setRemoving] = useState('');
  const [said, setSaid] = useState({ text: '', bad: false });
  const [refused, setRefused] = useState('');
  const since = known ? sinceRead(known) : { missing: [], changed: [] };
  const documents = list(known?.index?.documents);
  const sizes = Object.fromEntries(list(ctx.knowledgeRead?.files).map((f) => [f.name, f.size]));
  const onServer = new Set(list(ctx.knowledgeRead?.files).map((f) => f.name));
  const fixFor = (name, kind) => readableFix(list(known?.problems).find((p) => p.problem.includes(name) && new RegExp(kind, 'i').test(p.problem)) || {});
  const fileState = (name) => {
    if (ctx.knowledgeRead && (since.missing.includes(name) || (!onServer.has(name) && known)))
      return { tone: 'bad', text: 'Not uploaded', fix: fixFor(name, 'not uploaded') || 'Upload it, or take it out.' };
    if (since.changed.includes(name)) return { tone: 'warn', text: 'Changed since the build', fix: fixFor(name, 'changed') || 'Build it again.' };
    const doc = documents.find((d) => d.name === name);
    if (doc) return { tone: 'good', text: 'In the index', passages: doc.passages };
    return { tone: 'grey', text: known?.index ? 'Read at the next build' : 'Not built yet' };
  };
  const pageState = (url) => {
    const host = hostOf(url);
    const doc = documents.find((d) => d.name === url || d.name.startsWith(url) || hostOf(d.name).startsWith(host));
    return doc ? { tone: 'good', text: 'In the index' } : { tone: 'grey', text: known?.index ? 'Read at the next build' : 'Not built yet' };
  };
  const removePage = (url) => {
    const result = removeKnowledge(ctx.config, 'url', url);
    setRefused(result.refused);
    if (!result.refused) ctx.set(result.config);
  };
  const cards = [
    ...files.map((name) => {
      const st = fileState(name);
      const size = sizes[name];
      const sub = [typeof size === 'number' && formatBytes(size), typeof st.passages === 'number' && passagesWord(st.passages)].filter(Boolean).join(' · ');
      return { key: `file:${name}`, name, label: extOf(name), web: false, sub: sub || 'a file', st, remove: () => setRemoving(name) };
    }),
    ...pages.map((url) => {
      const depth = depths[url] || 0;
      return {
        key: `url:${url}`,
        name: hostOf(url),
        title: url,
        label: 'WEB',
        web: true,
        sub: depth ? `a web page · ${depth} level${depth === 1 ? '' : 's'} of links` : 'a web page',
        st: pageState(url),
        remove: () => removePage(url),
      };
    }),
  ];
  return (
    <>
      {/* the message and the dialog stay when the last one goes: removing it is still under way */}
      {cards.length === 0 ? (
        <span className="dtNote" id={id}>
          Nothing yet: until you add some, it answers only from its instructions.
        </span>
      ) : (
        <ul className="kxSources" id={id} aria-label="What it has read">
          {cards.map((c) => (
            <li key={c.key} className={`kxSrc ${c.st.tone}`} data-source={c.key}>
              <div className="kxSrcTop">
                <span className={`kxIco ${c.web ? 'web' : ''}`} aria-hidden="true">
                  {c.label}
                </span>
                <span className="kxName" title={c.title || c.name}>
                  {c.name}
                  <small>{c.sub}</small>
                </span>
                <button type="button" className="kxX" aria-label={`Remove ${c.title || c.name}`} onClick={c.remove}>
                  ×
                </button>
              </div>
              <span className={`kxPill ${c.st.tone}`}>
                <i aria-hidden="true" />
                {c.st.text}
              </span>
              {c.st.fix && (
                <p className="kxFix">
                  <b>Fix:</b> {c.st.fix}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {refused && (
        <small className="stFieldError" role="alert">
          {refused}
        </small>
      )}
      {said.text && (
        <small className={said.bad ? 'stFieldError' : 'dtNote'} role="status">
          {said.text}
        </small>
      )}
      {removing && (
        <RemoveDialog
          name={removing}
          ctx={ctx}
          onClose={() => setRemoving('')}
          onDone={(text, bad = false) => {
            setRemoving('');
            setSaid({ text, bad });
          }}
        />
      )}
    </>
  );
}
