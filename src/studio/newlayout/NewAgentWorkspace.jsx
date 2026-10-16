import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { groupIssues } from '../../api/client.js';
import CallsView from '../calls/CallsView.jsx';
import ChangesPanel from '../changes/ChangesPanel.jsx';
import { changesSince, revertSection } from '../changes/sinceRelease.js';
import { useLatestPublished } from '../changes/useLatestPublished.js';
import { JsonEditor, ValidationPanel } from '../ConfigTab.jsx';
import MonitoringPage from '../monitoring/MonitoringPage.jsx';
import ChatPreview from '../preview/ChatPreview.jsx';
import { navigate, routeHref } from '../route.js';
import { Notice, Spinner } from '../ui.jsx';
import AgentNav from './AgentNav.jsx';
import AgentTopBar from './AgentTopBar.jsx';
import ShareAgentDrawer from '../team/ShareAgentDrawer.jsx';
import CallersPanel from '../callers/CallersPanel.jsx';
import GateStrip from '../release/GateStrip.jsx';
import Drawer from './Drawer.jsx';
import PageShell from './PageShell.jsx';
import { PAGE_LEAD, PAGE_SECTIONS, SETTINGS_ELSEWHERE, locate, resolvePage, tabFor } from './pages.js';
import AgentPage from './pages/AgentPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ListPage from './pages/ListPage.jsx';
import SectionPage from './pages/SectionPage.jsx';
import './newlayout.css';

const AssistantTab = lazy(() => import('../assistant/AssistantTab.jsx'));
const DeployTab = lazy(() => import('../DeployTab.jsx'));
const VersionsTab = lazy(() => import('../VersionsTab.jsx'));
const TestTab = lazy(() => import('../test/TestTab.jsx'));
const ScenariosTab = lazy(() => import('../scenarios/ScenariosTab.jsx'));
const ChecksTab = lazy(() => import('../checks/ChecksTab.jsx'));
const KnowledgeTab = lazy(() => import('../knowledge/KnowledgeTab.jsx'));
const WorkflowTab = lazy(() => import('../workflow/WorkflowTab.jsx'));

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TOOL_LISTS = [
  {
    id: 'tools',
    path: ['tools'],
    kind: 'tools',
    word: 'tool',
    pickerKey: 'tools',
    empty: { title: 'No tools yet', text: 'Tools let the agent do things: end the call, hand over to a person, look something up.' },
  },
];
const TOOL_EXTRAS = [
  {
    key: 'connections',
    title: 'Connections',
    icon: 'plug',
    value: (c, n) =>
      n
        ? `${plural(n, 'connection')}: the web services its tools call`
        : 'None yet. A connection is a web service its tools call, such as your billing system.',
  },
  {
    key: 'forms',
    title: 'Forms',
    icon: 'records',
    value: (c, n) => (n ? `${plural(n, 'form')} to show a caller` : 'None yet. A form collects details such as a name and number on screen.'),
  },
  {
    key: 'notifications',
    title: 'Messages it sends',
    icon: 'quote',
    value: (c, n) => (n ? `${plural(n, 'message')} it can text or email` : 'None yet. Texts and emails it can send during or after a call.'),
  },
  {
    key: 'tasks',
    title: 'Multi-step tasks',
    icon: 'flag',
    value: (c, n) => (n ? plural(n, 'task') : 'None yet. Walk a caller through several steps, such as checking who they are.'),
  },
];
const CHANNEL_LISTS = [
  {
    id: 'channels',
    path: ['channels'],
    kind: 'channels',
    word: 'channel',
    pickerKey: 'channels',
    empty: { title: 'No channels yet', text: 'A channel is where people reach the agent: a phone line, a chat on your website.' },
  },
];
const CHANNEL_EXTRAS = [
  {
    key: 'telephony',
    title: 'Phone transfers',
    icon: 'phoneTransfer',
    value: (c, n) => (n ? 'Where a call can be passed to a person' : 'None yet. Where a call can be passed to a person.'),
  },
  {
    key: 'schedules',
    title: 'Business hours',
    icon: 'flag',
    value: (c, n) => (n ? plural(n, 'schedule') : 'None yet. When the agent, or a person it hands over to, is available.'),
  },
  { key: 'identity', title: 'Caller identity', icon: 'agent', value: () => 'How the agent knows who is calling' },
];
const GUARDRAIL_LISTS = [
  {
    id: 'input',
    path: ['guardrails', 'input'],
    kind: 'guardrails',
    word: 'check',
    pickerKey: 'guardrails.input',
    title: 'On what the caller says',
    lead: 'Checks that run on the caller’s words before the agent answers.',
    empty: {
      title: 'No checks on the caller yet',
      text: 'For example: refuse tricks to change the agent’s instructions, or keep card numbers out of the records.',
    },
  },
  {
    id: 'output',
    path: ['guardrails', 'output'],
    kind: 'guardrails',
    word: 'check',
    pickerKey: 'guardrails.output',
    title: 'On what the agent says',
    lead: 'Checks that run on the agent’s own words before they are spoken.',
    empty: { title: 'No checks on the agent yet', text: 'For example: block a promise it must not make, or keep secret fields out of everything it says.' },
  },
];
const TEST_PARTS = [
  { id: 'try', label: 'Try it' },
  { id: 'callers', label: 'Simulated callers' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'checks', label: 'Readiness checks' },
];
const RELEASE_PARTS = [
  { id: 'versions', label: 'Versions' },
  { id: 'deploy', label: 'Deploy' },
];

// An agent in the new layout: one menu down the side, one bar across the top, one page at a time. Everything the agent's state needs (the draft, the test
// conversation, the published versions, the dialogs) is held by BotWorkspace and handed in as `ws`, so switching layouts never loses an edit or hangs up a test.
export default function NewAgentWorkspace({ ws }) {
  const {
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
  } = ws;
  const resolved = useMemo(() => resolvePage(tab, { bare }), [tab, bare]);
  const { page } = resolved;
  const [drawer, setDrawer] = useState(resolved.drawer || null); // 'describe' | 'test' | 'problems' | null
  // an old address that names a panel (/describe) opens it, also when the agent is already open
  useEffect(() => {
    if (resolved.drawer) setDrawer(resolved.drawer);
  }, [resolved.drawer, tab]);
  const [changesOpen, setChangesOpen] = useState(false);
  const [localPart, setLocalPart] = useState({}); // the part of a page that has no address of its own (Knowledge, Workflow, Settings)
  const [focusRequest, setFocusRequest] = useState(null);
  const [openRequest, setOpenRequest] = useState(null);
  const [lastFix, setLastFix] = useState(null); // { label, previous }

  const config = editor.parsed.value;
  const issues = useMemo(() => groupIssues(editor.report), [editor.report]);
  const errorIssues = issues.filter((i) => i.severity === 'error');
  const errorCount = errorIssues.length;
  // problems to fix, counted against the page that holds each (the Agent page's rows included)
  const errorsByPage = errorIssues.reduce((acc, i) => {
    const p = locate(i.path).page;
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const scenarioCount = Array.isArray(config?.tests) ? config.tests.length : 0;
  const { published } = useLatestPublished(botId, refresh);
  const changes = useMemo(() => (published?.config && config ? changesSince(published.config, config) : { total: 0, groups: [] }), [published, config]);

  // a request to open something on a page is for that visit only: leaving the page ends it, so coming back later does not open it again
  useEffect(() => {
    setOpenRequest(null);
    setFocusRequest(null);
  }, [page]);

  const go = useCallback((target, query) => navigate(routeHref(botId, target, query), { guard: false }), [botId]);
  // Shows a place in the configuration: the page that holds it, and (on the Agent page) the panel, or (on a settings page) the field.
  const showPath = useCallback(
    (path) => {
      const where = locate(path);
      setFocusRequest({ path, nonce: Date.now() });
      if (where.drawer) setOpenRequest({ id: where.drawer, nonce: Date.now() });
      setDrawer(null);
      go(tabFor(where.page, where.part));
    },
    [go],
  );
  const applyFix = (next, label, jumpTo) => {
    setLastFix({ label, previous: editor.parsed.value });
    editor.setValue(next);
    if (jumpTo) window.setTimeout(() => showPath(jumpTo), 60);
  };

  const part = (id, fallback) => (resolved.part && resolved.page === id ? resolved.part : localPart[id] || fallback);
  const setPart = (id) => (next) => {
    if (id === 'tests' || id === 'releases') go(tabFor(id, next));
    else setLocalPart((old) => ({ ...old, [id]: next }));
  };
  const openJson = () => {
    setLocalPart((old) => ({ ...old, settings: 'json' }));
    go('settings');
  };
  const form = (id) => ({ keys: PAGE_SECTIONS[id], editor, focusRequest, onShowJson: openJson, onOpenJson: openJson });

  let body = null;
  if (page === 'home') {
    body = (
      <HomePage
        botId={botId}
        name={name}
        summary={summary}
        editor={editor}
        scenarioCount={scenarioCount}
        onProblems={() => setDrawer('problems')}
        onDescribe={() => setDrawer('describe')}
        onTest={() => setDrawer('test')}
        onStep={(target) => {
          setOpenRequest({ ...target, nonce: Date.now() });
          go('agent');
        }}
      />
    );
  } else if (page === 'agent') {
    body = <AgentPage editor={editor} openRequest={openRequest} notices={notices} onShowJson={openJson} onOpenJson={openJson} />;
  } else if (page === 'tools') {
    body = (
      <ListPage
        title="Tools"
        lead={PAGE_LEAD.tools}
        editor={editor}
        lists={TOOL_LISTS}
        extras={TOOL_EXTRAS}
        openRequest={focusRequest}
        onShowJson={openJson}
        onOpenJson={openJson}
      />
    );
  } else if (page === 'channels') {
    body = (
      <ListPage
        title="Channels"
        lead={PAGE_LEAD.channels}
        editor={editor}
        lists={CHANNEL_LISTS}
        extras={CHANNEL_EXTRAS}
        openRequest={focusRequest}
        onShowJson={openJson}
        onOpenJson={openJson}
      />
    );
  } else if (page === 'guardrails') {
    body = (
      <ListPage
        title="Guardrails"
        lead={PAGE_LEAD.guardrails}
        editor={editor}
        lists={GUARDRAIL_LISTS}
        openRequest={focusRequest}
        onShowJson={openJson}
        onOpenJson={openJson}
      />
    );
  } else if (page === 'aftercall') {
    body = <SectionPage title="After the call" lead={PAGE_LEAD.aftercall} {...form('aftercall')} />;
  } else if (page === 'knowledge') {
    const p = part('knowledge', 'files');
    body =
      p === 'files' ? (
        <PageShell
          title="Knowledge"
          lead={PAGE_LEAD.knowledge}
          wide
          parts={[
            { id: 'files', label: 'Files and index' },
            { id: 'settings', label: 'Settings' },
          ]}
          part={p}
          onPart={setPart('knowledge')}
        >
          <KnowledgeTab botId={botId} name={name} editor={editor} />
        </PageShell>
      ) : (
        <SectionPage
          title="Knowledge"
          lead={PAGE_LEAD.knowledge}
          parts={[
            { id: 'files', label: 'Files and index' },
            { id: 'settings', label: 'Settings' },
          ]}
          part={p}
          onPart={setPart('knowledge')}
          {...form('knowledge')}
        />
      );
  } else if (page === 'workflow') {
    const p = part('workflow', 'canvas');
    body =
      p === 'canvas' ? (
        <PageShell
          title="Workflow"
          lead={PAGE_LEAD.workflow}
          wide
          parts={[
            { id: 'canvas', label: 'Canvas' },
            { id: 'settings', label: 'Settings' },
          ]}
          part={p}
          onPart={setPart('workflow')}
        >
          <WorkflowTab editor={editor} botId={botId} />
        </PageShell>
      ) : (
        <SectionPage
          title="Workflow"
          lead={PAGE_LEAD.workflow}
          parts={[
            { id: 'canvas', label: 'Canvas' },
            { id: 'settings', label: 'Settings' },
          ]}
          part={p}
          onPart={setPart('workflow')}
          {...form('workflow')}
        />
      );
  } else if (page === 'settings') {
    const p = part('settings', 'settings');
    const parts = [
      { id: 'settings', label: 'Settings' },
      { id: 'json', label: 'JSON' },
    ];
    body =
      p === 'json' ? (
        <PageShell title="Settings" lead={PAGE_LEAD.settings} parts={parts} part={p} onPart={setPart('settings')}>
          <JsonEditor text={editor.text} onChange={editor.setText} errorLines={new Set()} />
        </PageShell>
      ) : (
        <SectionPage
          title="Settings"
          lead={PAGE_LEAD.settings}
          parts={parts}
          part={p}
          onPart={setPart('settings')}
          {...form('settings')}
          {...SETTINGS_ELSEWHERE}
        />
      );
  } else if (page === 'calls') {
    body = (
      <PageShell title="Calls" lead={PAGE_LEAD.calls} wide>
        <CallsView
          bots={[{ id: botId, name }]}
          fixedBotId={botId}
          editor={editor}
          initialCall={params?.call ? { botId, id: params.call, raw: null, view: params.view } : null}
          onOpenAgent={() => setDrawer('test')}
        />
      </PageShell>
    );
  } else if (page === 'monitoring') {
    body = (
      <div className="nlPage wide">
        <MonitoringPage
          agentOnly
          bots={[{ id: botId, name }]}
          onOpenAgent={(id, target, query) => go(target, query)}
          onOpenCall={(id, callId, view) => go('calls', { call: callId, ...(view && view !== 'trace' ? { view } : {}) })}
        />
      </div>
    );
  } else if (page === 'tests') {
    const p = part('tests', 'scenarios');
    body = (
      <PageShell title="Tests" lead={PAGE_LEAD.tests} wide parts={TEST_PARTS} part={p} onPart={setPart('tests')}>
        <GateStrip botId={botId} editor={editor} />
        {p === 'callers' && <CallersPanel botId={botId} name={name} editor={editor} />}
        {p === 'try' && (
          <TestTab
            botId={botId}
            name={name}
            summary={summary}
            editor={editor}
            session={session}
            mode={sessionMode}
            modeLocked={modeLocked}
            onMode={setSessionMode}
          />
        )}
        {p === 'scenarios' && <ScenariosTab botId={botId} name={name} editor={editor} />}
        {p === 'checks' && <ChecksTab botId={botId} name={name} runs={readinessRuns} onRun={onRecordReadiness} />}
      </PageShell>
    );
  } else if (page === 'releases') {
    const p = part('releases', 'versions');
    body = (
      <PageShell title="Releases" lead={PAGE_LEAD.releases} wide parts={RELEASE_PARTS} part={p} onPart={setPart('releases')}>
        {p === 'versions' && params?.publish === '1' && publishPanel}
        {p === 'versions' && <VersionsTab botId={botId} editor={editor} refreshKey={refresh} summary={summary} />}
        {p === 'deploy' && <DeployTab botId={botId} initialVersion={params?.version} refreshKey={refresh} onDeployed={bump} />}
      </PageShell>
    );
  }

  return (
    <div className="stWorkspace nlWorkspace" data-layout="new" data-page={page}>
      <AgentNav botId={botId} page={page} counts={errorsByPage} dots={{ tests: live }} />
      <AgentTopBar
        botId={botId}
        name={name}
        summary={summary}
        editor={editor}
        manageMenu={manage.menuItems(manageBot, {
          dirty: editor.dirty,
          before: [
            {
              label: 'Discard unsaved edits and reload',
              disabled: !editor.dirty,
              onClick: () => {
                if (window.confirm('Discard your unsaved edits and reload the saved draft?')) editor.reload();
              },
            },
            { divider: true },
          ],
        })}
        problems={errorCount}
        changes={published?.config ? changes.total : null}
        live={live}
        onDescribe={() => setDrawer('describe')}
        onProblems={() => setDrawer('problems')}
        onChanges={() => setChangesOpen(true)}
        onTest={() => setDrawer('test')}
        onShare={() => setDrawer('share')}
      />

      {editor.conflict && (
        <Notice
          kind="warn"
          title="Someone else saved this draft after you opened it"
          actions={
            <>
              <button type="button" className="quietButton" onClick={editor.reload}>
                Load theirs (drop my edits)
              </button>
              <button type="button" className="dangerButton" onClick={() => editor.save({ overwrite: true })}>
                Overwrite with mine
              </button>
            </>
          }
        >
          Your changes were not saved. Overwriting replaces their version of the draft.
        </Notice>
      )}
      {editor.saveError && (
        <Notice
          kind="error"
          title="Couldn’t save the draft"
          actions={
            <button type="button" className="quietButton" onClick={editor.dismissSaveError}>
              Dismiss
            </button>
          }
        >
          {editor.saveError.message}
        </Notice>
      )}
      {lastFix && (
        <Notice
          kind="info"
          title={`${lastFix.label}.`}
          actions={
            <>
              <button
                type="button"
                className="quietButton"
                onClick={() => {
                  editor.setValue(lastFix.previous);
                  setLastFix(null);
                }}
              >
                Undo
              </button>
              <button type="button" className="quietButton" onClick={() => setLastFix(null)}>
                Dismiss
              </button>
            </>
          }
        />
      )}

      <div className="nlBody">
        <Suspense fallback={<Spinner label="Loading" />}>{body}</Suspense>
      </div>

      {drawer === 'share' && <ShareAgentDrawer botId={botId} name={name} onClose={() => setDrawer(null)} />}
      {drawer === 'describe' && (
        <Drawer title="Describe it" icon="sparkle" width="wide" onClose={() => setDrawer(null)}>
          <div className="nlDescribe">
            <Suspense fallback={<Spinner label="Loading" />}>
              <AssistantTab editor={editor} botId={botId} name={name} />
            </Suspense>
          </div>
        </Drawer>
      )}
      {drawer === 'test' && (
        <Drawer title="Try it" icon="test" onClose={() => setDrawer(null)}>
          <ChatPreview
            session={session}
            mode={sessionMode}
            modeLocked={modeLocked}
            onMode={setSessionMode}
            botId={botId}
            editor={editor}
            onClose={() => setDrawer(null)}
          />
        </Drawer>
      )}
      {drawer === 'problems' && (
        <Drawer title="What the checks found" icon="check" onClose={() => setDrawer(null)}>
          <ValidationPanel
            editor={editor}
            onJump={(path) => showPath(path)}
            onApply={applyFix}
            onOpenModels={() => showPath(['defaults', 'models'])}
            onJumpOffset={() => {
              setDrawer(null);
              openJson();
            }}
          />
        </Drawer>
      )}
      {changesOpen && published?.config && (
        <ChangesPanel
          changes={changes}
          version={published.version}
          onClose={() => setChangesOpen(false)}
          onRevert={(key, section) => {
            applyFix(revertSection(config, published.config, key), `${section} put back as published in v${published.version}`);
            setChangesOpen(false);
          }}
        />
      )}

      {manage.element}
      {/* The agent's voice is played from here, so it keeps playing when you move between pages. */}
      <div ref={realSession.audioHostRef} className="stTAudio" aria-hidden="true" />
    </div>
  );
}
