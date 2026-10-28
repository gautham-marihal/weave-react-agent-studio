import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { sentenceCase } from '../ui/text.js';
import { api } from '../api/client.ts';
import ReleaseChecklist from './release/ReleaseChecklist.jsx';
import { useLiveSession } from './test/useLiveSession.js';
import { useSimulatedSession } from './test/useSimulatedSession.js';
import { isDemoMode } from '../demo/demoMode.js';
import { refreshBots, useBots } from './agents.js';
import { applyChange, takeChange } from './pendingChange.js';
import { nextVersion, publishOptions, randomTag } from './format.js';
import { useManage } from './manage/useManage.jsx';
import { splitUnsupported } from './preflight.ts';
import { DemoNote } from '../demo/DemoBadge.jsx';
import { dismissNotes, peekNotes } from './assistantNotes.js';
import { navigate, routeHref, setLeaveGuard } from './route.js';
import { useGateStatus } from './release/gate.js';
import { ErrorState, Notice } from './ui.jsx';
import NotFound from '../ui/NotFound.jsx';
import { useAsync } from './useAsync.js';
import { useDraftEditor } from './useDraftEditor.js';
import AgentLayout from './agent/AgentLayout.jsx';
import Icon from '../ui/Icon.jsx';
import Button from '../ui/Button.tsx';

// One agent, open: loads the agent and its draft, and holds what lives across its pages (test conversation, publish
// panel, changes asked for by other pages, menu actions). AgentLayout.jsx draws the pages.

const PlainIssues = lazy(() => import('./validation/PlainIssues.jsx')); // problems named by label, not path

// Publishing belongs to the Release stage, so this panel sits on the Versions page beside the release checklist.
function PublishFrame({ eyebrow, title, subtitle, footer, children }) {
  return (
    <section className="stCard stPublishPanel" aria-label={title}>
      <header>
        {eyebrow && <small>{sentenceCase(eyebrow)}</small>}
        <h3>{title}</h3>
        {subtitle && <p className="stMuted">{subtitle}</p>}
      </header>
      {children}
      {footer && <div className="stPublishFooter">{footer}</div>}
    </section>
  );
}

//   done: what was just published; the owner keeps it because a publish re-reads the agent and redraws this panel
//   onDeployed(): after the new version is put live in Development from this panel
function PublishDialog({ botId, editor, latestVersion, onClose, onPublished, done = null, onDeployed }) {
  const gate = useGateStatus(botId, editor);
  const [anyway, setAnyway] = useState(false);
  const held = gate.enabled && !gate.check.ok && !anyway;
  // "draft" publishes under the draft's own version number. A bump is counted from the latest
  // published version, and the server refuses one until something has been published.
  const draftVersion = editor.parsed.value?.meta?.version;
  const { options, defaultChoice } = useMemo(() => publishOptions(latestVersion, draftVersion), [latestVersion, draftVersion]);
  const [choice, setChoice] = useState(defaultChoice);
  const [phase, setPhase] = useState('idle'); // idle | working | done
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [allWarnings, setAllWarnings] = useState(false);
  const [deploy, setDeploy] = useState({ phase: 'idle', error: null }); // deploying from here: idle | working | done
  const blocked = !!editor.parsed.error || !editor.isObject || !editor.report || !editor.report.valid;
  const picked =
    options.find((option) => option.value === choice && !option.disabled) || options.find((option) => option.value === defaultChoice) || options[0];
  const willPublish = picked.version;

  const publish = async () => {
    setPhase('working');
    setError(null);
    if (editor.dirty) {
      const saved = await editor.save();
      if (!saved) {
        setPhase('idle');
        setError({ message: 'Your edits could not be saved, so nothing was published. Save them on their own to see what the server says.' });
        return;
      }
    }
    try {
      const published = await api.publish(botId, picked.value === 'draft' ? undefined : picked.value);
      setResult(published);
      setPhase('done');
      onPublished(published);
    } catch (err) {
      setError(err);
      setPhase('idle');
    }
  };

  const shown = done || (phase === 'done' ? result : null);
  if (shown) {
    const chooseWhere = () => {
      onClose();
      navigate(routeHref(botId, 'deploy', { version: shown.version }), { guard: false });
    };
    const putLive = async () => {
      setDeploy({ phase: 'working', error: null });
      try {
        await api.deploy(botId, { version: shown.version, environment: 'development', note: 'Put live after publishing' });
        setDeploy({ phase: 'done', error: null });
        onDeployed?.();
      } catch (err) {
        setDeploy({ phase: 'idle', error: err });
      }
    };
    const live = deploy.phase === 'done';
    return (
      <PublishFrame
        eyebrow={live ? 'LIVE' : 'PUBLISHED'}
        title={live ? `Version ${shown.version} is live in Development` : `Version ${shown.version} is published`}
        subtitle={
          live
            ? 'It answers in Development from now on: try it for real there. Staging and Production are chosen on Deploy.'
            : 'It is now frozen. Put it live in Development to try it for real, or choose where it runs.'
        }
        footer={
          <>
            <button type="button" className="modalCancel" onClick={onClose}>
              Close
            </button>
            {!live ? (
              <>
                <button type="button" className="modalCancel" onClick={chooseWhere} disabled={deploy.phase === 'working'}>
                  Choose where
                </button>
                <button type="button" className="modalCreate" onClick={putLive} disabled={deploy.phase === 'working'}>
                  {deploy.phase === 'working' ? 'Putting it live…' : 'Put it live in Development'}
                </button>
              </>
            ) : (
              <button type="button" className="modalCreate" onClick={chooseWhere}>
                See where it runs
              </button>
            )}
          </>
        }
      >
        {deploy.error && (
          <Notice kind="error" title="It couldn’t be put live">
            {deploy.error.message}
          </Notice>
        )}
        {shown.warnings?.length > 0 && (
          <Notice kind="warn" title={`${shown.warnings.length} warning${shown.warnings.length === 1 ? '' : 's'}`}>
            <Suspense fallback={null}>
              <PlainIssues issues={shown.warnings} />
            </Suspense>
          </Notice>
        )}
        {shown.secrets_required?.length > 0 && (
          <p className="stMuted">
            Needs {shown.secrets_required.length} secret{shown.secrets_required.length === 1 ? '' : 's'}: {shown.secrets_required.join(', ')}.
          </p>
        )}
        <p className="stMuted">The draft has moved on to {nextVersion(shown.version, 'patch')}, so your next publish won’t collide.</p>
      </PublishFrame>
    );
  }

  return (
    <PublishFrame
      eyebrow="PUBLISH"
      title={`Publish version ${willPublish || ''}`.trim()}
      subtitle="Publishing freezes the saved draft as an immutable version. It does not change what callers get until you deploy it."
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={phase === 'working'}>
            Cancel
          </button>
          <button type="button" className="modalCreate" onClick={publish} disabled={blocked || held || phase === 'working'}>
            {phase === 'working' ? 'Publishing…' : 'Publish'}
          </button>
        </>
      }
    >
      {gate.enabled && !gate.check.ok && (
        <Notice
          kind="warn"
          title="Publishing is held until the tests pass"
          actions={
            <Button
              type="button"
              onClick={() => {
                onClose();
                navigate(routeHref(botId, gate.check.action === 'callers' ? 'callers' : 'scenarios'), { guard: false });
              }}
            >
              {gate.check.action === 'callers' ? 'Add tests' : 'Run the tests'}
            </Button>
          }
        >
          {gate.check.why}
          <label className="gateAnyway">
            <input type="checkbox" checked={anyway} onChange={(event) => setAnyway(event.target.checked)} /> Publish anyway, without a passing run
          </label>
        </Notice>
      )}
      {gate.enabled && gate.check.ok && (
        <p className="stMuted" role="status">
          Tests must pass before publishing is on: {gate.check.why}
        </p>
      )}
      <DemoNote kind="publish">
        Publishing here only records a version in this browser. Nothing is sent to a server, and the draft is checked by simple demo rules, not the real
        validator.
      </DemoNote>
      {blocked && (
        <Notice kind="error" title="This draft can’t be published yet">
          {editor.parsed.error
            ? editor.parsed.duplicates?.length
              ? 'Remove the repeated key in the JSON first.'
              : 'Fix the JSON first.'
            : !editor.report
              ? 'Wait for the check to finish.'
              : 'Fix the problems first: each one says where it is.'}
        </Notice>
      )}
      {!blocked && splitUnsupported(editor.report?.unsupported).security.length > 0 && (
        <Notice kind="error" title="Some protections in this draft are declared but not enforced">
          The runtime doesn’t enforce them yet, so a version published from this draft looks protected and isn’t. Publishing is allowed; deploying it to
          production will ask for confirmation.
          <ul className="stPlain">
            {splitUnsupported(editor.report.unsupported).security.map((item, index) => (
              <li key={index}>
                {item.feature} <code>{item.where}</code>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {!blocked &&
        editor.report?.warnings?.length > 0 &&
        (() => {
          const warnings = editor.report.warnings;
          const shown = allWarnings ? warnings : warnings.slice(0, 5);
          return (
            <Notice kind="warn" title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'} before you publish`}>
              These don’t stop a publish, and they will be in the version. Fix them first if they matter.
              <Suspense fallback={null}>
                <PlainIssues issues={shown} config={editor.parsed.value} />
              </Suspense>
              {warnings.length > 5 && (
                <button type="button" className="stLink" onClick={() => setAllWarnings((v) => !v)}>
                  {allWarnings ? 'Show fewer' : `Show all ${warnings.length}`}
                </button>
              )}
            </Notice>
          );
        })()}
      {!blocked && <ReleaseChecklist botId={botId} config={editor.parsed.value} report={editor.report} target="draft" compact />}
      {editor.dirty && !blocked && (
        <Notice kind="info" title="Unsaved edits">
          They will be saved first, then published.
        </Notice>
      )}
      {error && (
        <Notice kind="error" title={error.kind === 'invalid' ? 'The server rejected this draft' : 'Couldn’t publish'}>
          {error.message}
          {error.errors?.length > 0 && (
            <Suspense fallback={null}>
              <PlainIssues issues={error.errors} severity="error" config={editor.parsed.value} />
            </Suspense>
          )}
        </Notice>
      )}
      {latestVersion ? (
        <fieldset className="stBump">
          <legend>Version number (latest published is {latestVersion})</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className={`${picked.value === option.value ? 'on' : ''} ${option.disabled ? 'off' : ''} ${option.value === 'draft' ? 'wide' : ''}`}
            >
              <input
                type="radio"
                name="version-choice"
                value={option.value}
                checked={picked.value === option.value}
                onChange={() => setChoice(option.value)}
                disabled={option.disabled || phase === 'working'}
              />
              <span>
                <strong>
                  {option.label} <b>{option.version}</b>
                </strong>
                <small>{option.matchesDraft ? 'Also the draft’s own number' : option.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="stMuted">This is the first version of this agent, so it is published as {draftVersion}.</p>
      )}
      <p className="stMuted">Afterwards the draft moves on to {nextVersion(willPublish, 'patch')}, so your next publish won’t collide.</p>
    </PublishFrame>
  );
}

export default function AgentWorkspace({ botId, tab, bare = false, params, onRecordSession, readinessRuns = [], onRecordReadiness }) {
  const [refresh, setRefresh] = useState(0);
  const bot = useAsync((signal) => api.getBot(botId, { signal }), [botId, refresh]);
  const editor = useDraftEditor(botId);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // The test conversation lives here, not in the Test tab, so switching tabs doesn't hang up.
  // A finished test conversation is handed to the page that keeps the Sessions list.
  const nameRef = useRef(botId);
  const handleFinished = ({ info, messages, startedAt, endedAt, tools, state, agent }) => {
    // Demo mode keeps a simulated conversation as a call for the Calls page and trace (the runtime records real ones).
    if (isDemoMode() && info?.simulated) {
      import('../demo/demoApi.js').then(({ getDemoApi }) =>
        getDemoApi().recordConversation(botId, {
          startedAt: new Date(startedAt).toISOString(),
          channel: info.channel,
          messages,
          tools,
          state,
          agent,
          version: info.version === 'draft' ? 'draft' : info.version,
        }),
      );
    }
    if (!onRecordSession) return;
    onRecordSession({
      id: `SES_${Date.now().toString(36)}${randomTag()}`,
      agentId: botId,
      agentName: nameRef.current,
      versionKey: info?.ref || 'draft',
      versionLabel: !info?.version || info.version === 'draft' ? 'Draft' : `Version ${info.version}`,
      room: info?.room || '—',
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSec: Math.max(1, Math.round((endedAt - startedAt) / 1000)),
      channel: info?.simulated ? 'Test: simulated chat' : info?.channel?.type === 'web_voice' ? 'Test: voice' : 'Test: chat',
      participants: 2,
      status: 'Completed',
      userMessages: messages.filter((m) => m.role === 'user').length,
      transcript: messages.slice(0, 300),
    });
  };
  const realSession = useLiveSession({ onFinished: handleFinished });
  // The simulation runs on the draft's current contents (unsaved edits included), else that version's config.
  const configFor = async (ref) => {
    if (ref === 'draft') return editorRef.current.parsed.value;
    const version = ref === 'latest' ? bot.data?.latest_version : bot.data?.deployed?.[ref] || ref;
    return (await api.getVersion(botId, version)).config;
  };
  const configForRef = useRef(configFor);
  configForRef.current = configFor;
  const simSession = useSimulatedSession({ onFinished: handleFinished, getConfig: (ref) => configForRef.current(ref) });
  // Real or simulated agent (demo mode has no real one); the choice can't change mid-conversation.
  const modeLocked = isDemoMode();
  const [sessionMode, setSessionModeState] = useState(modeLocked ? 'simulated' : 'real');
  const setSessionMode = (next) => {
    if (!modeLocked || next === 'simulated') setSessionModeState(next);
  };
  const session = sessionMode === 'simulated' ? simSession : realSession;
  const live = [realSession.status, simSession.status].some((status) => ['starting', 'connecting', 'waiting', 'live'].includes(status));
  const publishOpen = tab === 'versions' && params?.publish === '1';
  const closePublish = () => navigate(routeHref(botId, 'versions'), { guard: false });
  // What was just published, kept here while the agent is re-read (which redraws the publish panel); cleared on close.
  const [justPublished, setJustPublished] = useState(null);
  useEffect(() => {
    if (!publishOpen) setJustPublished(null);
  }, [publishOpen]);

  // Reloading the page would lose unsaved edits and hang up a running test conversation.
  useEffect(() => {
    if (!editor.dirty && !live) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor.dirty, live]);

  // Any in-app navigation away from this agent asks first.
  useEffect(() => {
    if (!editor.dirty && !live) {
      setLeaveGuard(null);
      return undefined;
    }
    // what leaving would lose; the router shows this in its leave dialog
    setLeaveGuard(() =>
      editor.dirty && live
        ? 'Your unsaved edits will be lost, and the test conversation that is still running will end.'
        : editor.dirty
          ? 'Your unsaved edits will be lost.'
          : 'The test conversation that is still running will end.',
    );
    return () => setLeaveGuard(null);
  }, [editor.dirty, live]);

  // Anything that changes the agent also refreshes the shared list, so every page shows the same thing.
  const bump = () => {
    setRefresh((n) => n + 1);
    refreshBots();
  };
  useEffect(() => {
    if (editor.savedTick) refreshBots();
  }, [editor.savedTick]);

  // The list's copy of the agent until its details load, so the bar doesn't flash its id or "Draft".
  const listed = (useBots().all || []).find((b) => b.id === botId) || null;
  const summary = bot.data || listed;
  const name = editor.savedName || summary?.name || botId;
  nameRef.current = name;
  // A voice or connection another page asked to put on this agent is applied to the draft, unsaved, for review.
  const [applied, setApplied] = useState(null);
  // What the draft assistant assumed, shown until it has been read (see demo/draftAssistant.js).
  const [assistantNote, setAssistantNote] = useState(() => peekNotes(botId));
  useEffect(() => {
    if (editor.status !== 'ready' || editor.dirty || !editor.isObject) return;
    const change = takeChange(botId);
    if (!change) return;
    const result = applyChange(editor.parsed.value, change);
    if (!result) return;
    // Something already set that way is not a change: say so instead of announcing an unsaved edit.
    const unchanged = JSON.stringify(result.config) === JSON.stringify(editor.parsed.value);
    if (!unchanged) editor.setValue(result.config);
    setApplied({ ...result, unchanged });
    navigate(routeHref(botId, 'config'), { guard: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.status, editor.dirty, editor.isObject, botId]);

  const manage = useManage({
    editor,
    onRenamed: () => {
      bot.reload();
      editor.reload();
    },
    onRemoved: () => navigate(routeHref()),
    onMoved: () => navigate(routeHref(), { guard: false }),
  });
  const manageBot = { id: botId, name, latest_version: summary?.latest_version, deployed: summary?.deployed || {} };

  if (bot.error && !bot.data && bot.error.kind === 'not_found') {
    return (
      <div className="stWorkspace">
        <NotFound
          title="This agent doesn’t exist"
          text={`There is no agent called “${botId}”. It may have been deleted, or the link may be mistyped.`}
          actionLabel="Go to agents"
          onAction={() => navigate(routeHref(), { guard: false })}
        />
      </div>
    );
  }
  if (bot.error && !bot.data) {
    return (
      <div className="stWorkspace">
        <button type="button" className="agentBackLink stBack" onClick={() => navigate(routeHref())}>
          <Icon name="arrowLeft" size={15} />
          Agents
        </button>
        <ErrorState error={bot.error} onRetry={bot.reload} what="this agent" />
      </div>
    );
  }

  const notices = (
    <>
      {applied && (
        <Notice
          kind="info"
          title={applied.unchanged ? 'Already set on this draft' : 'Added to this draft, not saved yet'}
          actions={
            <Button type="button" onClick={() => setApplied(null)}>
              Dismiss
            </Button>
          }
        >
          {applied.note} {applied.unchanged ? 'Nothing needed to change.' : 'Check it below, then save the draft.'}
        </Notice>
      )}
      {assistantNote && (
        <Notice
          kind="warn"
          title="This draft was made from your description by the demo assistant"
          actions={
            <Button
              type="button"
              onClick={() => {
                dismissNotes(botId);
                setAssistantNote(null);
              }}
            >
              I’ve read this
            </Button>
          }
        >
          The demo assistant is rule-based, not an AI model: it picked a starter and filled in what it could from keywords. Read the role and rules, and try the
          draft in the preview.
          <details className="stFold" open>
            <summary>What it assumed ({assistantNote.assumptions?.length || 0})</summary>
            <ul className="stPlain">
              {(assistantNote.assumptions || []).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
          <details className="stFold amber" open>
            <summary>What you still need to decide ({assistantNote.questions?.length || 0})</summary>
            <ul className="stPlain">
              {(assistantNote.questions || []).map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </details>
        </Notice>
      )}
    </>
  );
  const publishPanel = publishOpen ? (
    <PublishDialog
      botId={botId}
      editor={editor}
      latestVersion={summary?.latest_version || null}
      onClose={closePublish}
      done={justPublished}
      onPublished={(published) => {
        setJustPublished(published);
        bump();
        editor.reload();
      }}
      onDeployed={bump}
    />
  ) : null;
  return (
    <AgentLayout
      ws={{
        botId,
        tab,
        bare,
        params,
        editor,
        summary,
        name,
        refresh,
        bump,
        session,
        sessionMode,
        modeLocked,
        setSessionMode,
        realSession,
        manage,
        manageBot,
        live,
        publishPanel,
        readinessRuns,
        onRecordReadiness,
        notices,
      }}
    />
  );
}
