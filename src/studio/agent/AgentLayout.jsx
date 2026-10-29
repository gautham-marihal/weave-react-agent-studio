import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, groupIssues } from '../../api/client.ts';
import CallsView from '../calls/CallsView.jsx';
import ChangesPanel from '../changes/ChangesPanel.jsx';
import { changesSince, revertSection } from '../changes/sinceRelease.js';
import { useLatestPublished } from '../changes/useLatestPublished.js';
import { JsonPart } from '../JsonEditor.jsx';
import { ValidationPanel } from '../ValidationPanel.jsx';
import MonitoringPage from '../monitoring/MonitoringPage.jsx';
import AgentAlerts from '../insights/AgentAlerts.jsx';
import ChatPreview from '../preview/ChatPreview.jsx';
import { navigate, routeHref } from '../route.js';
import { useGate } from '../release/gate.js';
import { isFinished, normalizeHeadline } from '../scenarios/runResults.js';
import { useAsync } from '../useAsync.js';
import Icon from '../../ui/Icon.jsx';
import { ErrorState, Notice, Spinner } from '../ui.jsx';
import { SkeletonRows } from '../../ui/Skeleton.jsx';
import { readinessSteps } from './readiness.js';
import { buildSections } from './buildSections.js';
import StageTabs from './workspace/StageTabs.jsx';
import BuildStage from './workspace/BuildStage.jsx';
import GuidedBuild from './workspace/GuidedBuild.jsx';
import ChecksCard from './workspace/ChecksCard.jsx';
import PromptPreview from '../form/PromptPreview.jsx';
import { readSimple } from '../simple/simpleModel.js';
import MonitorTabs from './workspace/MonitorTabs.jsx';
import NextStepBar from './workspace/NextStepBar.jsx';
import AgentTopBar from './AgentTopBar.jsx';
import ShareAgentDrawer from '../team/ShareAgentDrawer.jsx';
import { ActionSwitches, KnowledgeBlock, ReachChoices } from '../setup/SimpleBlocks.jsx';
import { KNOWLEDGE_ID, reachOf, whoReadsKnowledge } from '../setup/setupModel.js';
import { LimitsBlock, MomentsBlock, TopicsBlock } from './blocks/GuardrailBlocks.jsx';
import { QuestionsBlock, RecordingBlock, SensitiveBlock, SummaryBlock } from './blocks/AfterCallBlocks.jsx';
import { askedAbove } from './blocks/afterCallModel.js';
import { inSetup, useSetupProgress } from '../setup/setupProgress.js';
import CallersPanel from '../callers/CallersPanel.jsx';
import BankingPage from '../banking/BankingPage.tsx';
import GateStrip from '../release/GateStrip.jsx';
import Drawer from './Drawer.jsx';
import PageShell, { Section } from './PageShell.jsx';
import { humanize } from './rowNames.js';
import { PAGE_LABELS, PAGE_LEAD, PAGE_SECTIONS, SETTINGS_ELSEWHERE, locate, resolvePage, searchTarget, stageOf, tabFor } from './pages.js';
import { onSettingFocus, takeSettingFocus } from '../settingFocus.js';
import AgentPage from './pages/AgentPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ListPage from './pages/ListPage.jsx';
import { TryGuardrailsView } from '../form/TryPanels.jsx';
import SectionPage from './pages/SectionPage.jsx';
import './agent.css';
import { askConfirm } from '../../ui/dialogs.js';
import { whenPanelKept } from './stagedPanel.js';
import { useLiveNumbers } from '../../pages/LiveNumbers.jsx';
import { useKnowledge } from '../knowledge/useKnowledge.js';
import { describeWeek } from '../relations/scheduleStrip.js';
import { usedBy } from '../relations/usedBy.js';

const AssistantTab = lazy(() => import('../assistant/AssistantTab.jsx'));
const DeployTab = lazy(() => import('../DeployTab.jsx'));
const VersionsTab = lazy(() => import('../VersionsTab.jsx'));
const TestTab = lazy(() => import('../test/TestTab.jsx'));
const ScenariosTab = lazy(() => import('../scenarios/ScenariosTab.jsx'));
const ChecksTab = lazy(() => import('../checks/ChecksTab.jsx'));
const KnowledgeTab = lazy(() => import('../knowledge/KnowledgeTab.jsx'));
const WorkflowTab = lazy(() => import('../workflow/WorkflowTab.jsx'));
const QuestionsPage = lazy(() => import('../insights/QuestionsPage.jsx'));
const SpeedPage = lazy(() => import('../speed/SpeedPage.jsx'));
const SetupWizard = lazy(() => import('../setup/SetupWizard.jsx'));

// Readiness steps the guided setup covers: while the agent is in setup (`inSetup`), each opens the setup at that step,
// so there is one place to get it ready. Once published, the steps open the agent's own pages.
const SETUP_STEP = { prompt: 'purpose', hello: 'purpose', voice: 'voice', abilities: 'actions', publish: 'live', deploy: 'live' };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "a, b and 2 more": a few names, the rest counted
const namesInWords = (names) => {
  const shown = names.filter(Boolean).slice(0, 2);
  const more = names.filter(Boolean).length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
};
const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return '';
  }
};
// The phone transfers in words: where calls go, or that a number is still to be set
function transfersInWords(config) {
  const transfers = (Array.isArray(config?.telephony?.transfers) ? config.telephony.transfers : []).filter((t) => t && typeof t === 'object');
  if (!transfers.length) return 'None yet. Where a call can be passed to a person.';
  const numbers = transfers.map((t) => (typeof t.target === 'string' ? t.target.trim() : t.target ? 'a number chosen during the call' : '')).filter(Boolean);
  const waiting = transfers.length - numbers.length;
  const parts = [
    numbers.length ? `Passes calls to ${namesInWords(numbers)}` : '',
    waiting ? `${plural(waiting, 'transfer')} with no number yet: callers are offered a callback` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
// the part of a page that holds its settings form, for a page that has other parts
const FORM_PART = { workflow: 'settings', knowledge: 'settings', settings: 'settings' };
// Pages that edit the draft through their own controls; they wait while the draft isn't valid JSON (Agent and Workflow
// say so themselves; Settings is where the JSON is fixed).
const READS_THE_DRAFT = new Set(['home', 'build', 'banking', 'tools', 'channels', 'guardrails', 'aftercall', 'knowledge', 'tests']);
const TOOL_LISTS = [
  {
    id: 'tools',
    path: ['tools'],
    kind: 'tools',
    word: 'tool',
    pickerKey: 'tools',
    title: 'All its tools',
    lead: 'Everything it can use, what the switches above add included. Open one to change how it works.',
    empty: { title: 'No tools yet', text: 'Tools let the agent do things: end the call, hand over to a person, look something up.' },
  },
];
const TOOL_EXTRAS = [
  {
    key: 'telephony',
    title: 'Phone transfers',
    icon: 'phoneTransfer',
    // what is set, not what the section is
    value: (c) => transfersInWords(c),
  },
  {
    key: 'connections',
    title: 'Connections',
    icon: 'plug',
    value: (c, n) =>
      n
        ? `${plural(n, 'connection')}: ${namesInWords(Object.entries(c?.connections || {}).map(([id, x]) => hostOf(x?.base_url) || humanize(id)))}`
        : 'None yet. A connection is a web service its tools call, such as your billing system.',
  },
  {
    key: 'forms',
    title: 'Forms',
    icon: 'records',
    value: (c, n) =>
      n
        ? `${plural(n, 'form')}: ${namesInWords((Array.isArray(c?.forms) ? c.forms : []).map((f) => f?.title || humanize(f?.id || 'form')))}`
        : 'None yet. A form collects details such as a name and number on screen.',
  },
  {
    key: 'notifications',
    title: 'Messages it sends',
    icon: 'mail',
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
    title: 'All channels',
    lead: 'Each place it can be reached, and what it says first there. Open one for its details.',
    empty: { title: 'No channels yet', text: 'A channel is where people reach the agent: a phone line, a chat on your website.' },
  },
];
// Business hours in words: one schedule's week and time zone, or the names of several. Hours change nothing on their
// own (a transfer or rule follows them), so an unused one says so.
const scheduleWords = (c, n) => {
  const all = Object.entries(c?.schedules && typeof c.schedules === 'object' ? c.schedules : {});
  if (!n || !all.length) return 'None yet. Opening hours your hand-overs and rules can follow; on their own they change nothing.';
  if (all.length === 1) {
    const [, s] = all[0];
    return `${describeWeek(s).replace(/[.]$/, '')}${typeof s?.timezone === 'string' && s.timezone ? `, ${s.timezone}` : ''}`;
  }
  return `${plural(all.length, 'schedule')}: ${namesInWords(all.map(([id, s]) => (typeof s?.description === 'string' && s.description.trim()) || humanize(id)))}`;
};
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
const CHANNEL_EXTRAS = [
  {
    key: 'schedules',
    title: 'Business hours',
    icon: 'clock',
    value: scheduleWords,
    status: (c, engine) =>
      engine && Object.keys(c?.schedules && typeof c.schedules === 'object' ? c.schedules : {}).some((id) => !usedBy(engine, c, 'schedules', id).length)
        ? { tone: '', text: 'Not used' }
        : null,
    start: {
      title: 'No business hours yet',
      text: 'A phone transfer or a rule can follow them, for example to pass calls to a person only while someone is there.',
      label: 'Start with Monday to Friday, 9 to 5',
      make: (c) => ({
        ...c,
        schedules: {
          business_hours: {
            description: 'Office hours',
            timezone: localZone(),
            weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }],
          },
        },
      }),
    },
  },
  { key: 'identity', title: 'Caller identity', icon: 'user', value: () => 'How the agent knows who is calling' },
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
  {
    id: 'escalation',
    path: ['guardrails', 'escalation'],
    kind: 'escalation',
    word: 'rule',
    pickerKey: 'guardrails.escalation',
    title: 'All its hand-over and ending rules',
    lead: 'The ones switched on above, and any of your own: when a call meets one, it hands over or ends by itself.',
    empty: { title: 'No rules yet', text: 'Switch one on above, or add one of your own.' },
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

// Whether the window is at least this wide (it follows resizing).
function useWide(query) {
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, [query]);
  return wide;
}

// An agent's screens: a side menu, a top bar, one page at a time. AgentWorkspace.jsx holds the state and hands it in as
// `ws`, so moving between pages never loses an edit or hangs up a test.
export default function AgentLayout({ ws }) {
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
    testSession,
    testMode,
    setTestMode,
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
  const [localPart, setLocalPart] = useState({}); // parts with no address of their own
  const [focusRequest, setFocusRequest] = useState(null);
  const [openRequest, setOpenRequest] = useState(null);
  const [lastFix, setLastFix] = useState(null); // { label, previous }
  // on a wide window the test conversation docks beside the page across page changes; on a narrow one it slides over
  const wideEnough = useWide('(min-width: 1280px)');
  const testDocked = drawer === 'test' && wideEnough;
  // the bar and stage tabs stick to the top; their height (--nl-head-h) is where other sticky parts sit
  const headRef = useRef(null);
  useLayoutEffect(() => {
    const head = headRef.current;
    if (!head || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => head.parentElement?.style.setProperty('--nl-head-h', `${head.offsetHeight}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(head);
    return () => watch.disconnect();
  }, [page === 'setup']); // eslint-disable-line react-hooks/exhaustive-deps -- the header is there on every page but the setup's

  const config = editor.parsed.value;
  const issues = useMemo(() => groupIssues(editor.report), [editor.report]);
  const errorIssues = issues.filter((i) => i.severity === 'error');
  const errorCount = errorIssues.length;
  // errors counted per page that holds each (the Agent page's rows included)
  const errorsByPage = useMemo(
    () =>
      issues
        .filter((i) => i.severity === 'error')
        .reduce((acc, i) => {
          const p = locate(i.path).page;
          acc[p] = (acc[p] || 0) + 1;
          return acc;
        }, {}),
    [issues],
  );
  const scenarioCount = Array.isArray(config?.tests) ? config.tests.length : 0;
  const { published } = useLatestPublished(botId, refresh);
  const changes = useMemo(() => (published?.config && config ? changesSince(published.config, config) : { total: 0, groups: [] }), [published, config]);

  // An open/focus request names its `page` and lasts for that visit only: arriving keeps it (a form that loads later
  // can still take it), leaving ends it, so coming back later doesn't open it again.
  useEffect(() => {
    setOpenRequest((r) => (r && r.page === page ? r : null));
    setFocusRequest((r) => (r && r.page === page ? r : null));
  }, [page]);
  // links from elsewhere: ?open=<panel> or ?focus=<field> on the Agent page, ?show=problems for the checks
  const askOpen = page === 'agent' ? params?.open || '' : '';
  const askFocus = page === 'agent' ? params?.focus || '' : '';
  const askShow = params?.show || '';
  // a link to one setting from outside the agent (e.g. Speed): ?setting=defaults.models.llm opens where it lives
  const askSetting = params?.setting || '';
  useEffect(() => {
    if (askOpen) setOpenRequest({ open: askOpen, nonce: Date.now(), page: 'agent' });
    else if (askFocus) setOpenRequest({ focus: askFocus, nonce: Date.now(), page: 'agent' });
  }, [askOpen, askFocus]);
  useEffect(() => {
    if (askShow === 'problems') setDrawer('problems');
    // ?show=json: the publish checklist's "Edit as JSON" when the draft can't be read
    if (askShow === 'json') setLocalPart((old) => ({ ...old, settings: 'json' }));
  }, [askShow]);
  // The recording notice asked for from search: scroll to its field and focus it. Not cancelled when the request
  // clears, because the field appears a moment after the page.
  useEffect(() => {
    if (page !== 'aftercall' || openRequest?.focus !== 'notice') return;
    window.setTimeout(() => {
      const el = document.querySelector('input[aria-label="Recording notice"]');
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
      }
    }, 60);
  }, [page, openRequest]);
  // ?tool= (an alert's "Open the tool") opens its panel once per visit; a tool no longer in the draft is said so
  const toolsList = config?.tools;
  const toolIndex =
    page === 'tools' && params?.tool && Array.isArray(toolsList) ? toolsList.findIndex((t) => t && (t.id === params.tool || t.name === params.tool)) : -1;
  const missingTool = page === 'tools' && params?.tool && Array.isArray(toolsList) && toolIndex < 0 ? params.tool : '';
  useEffect(() => {
    if (toolIndex >= 0) setFocusRequest({ path: ['tools', toolIndex], nonce: Date.now(), page: 'tools' });
  }, [toolIndex, params?.tool]);

  const go = useCallback((target, query) => navigate(routeHref(botId, target, query), { guard: false }), [botId]);
  // Ctrl/Cmd+S saves the draft from any page of the agent, and only when there is something to save.
  const saveKey = useRef(null);
  saveKey.current = { save: editor.save, can: editor.dirty && !editor.saving && !editor.parsed.error && editor.isObject };
  useEffect(() => {
    const onKey = (event) => {
      if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')) return;
      event.preventDefault();
      if (saveKey.current.can) saveKey.current.save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // the tests' latest run (re-read on leaving the Tests page, where they run) and whether they must pass to publish
  const runs = useAsync((signal) => api.listTestRuns(botId, 20, { signal }), [botId, page === 'tests']);
  const latestRun = useMemo(
    () => (Array.isArray(runs.data) ? runs.data.map(normalizeHeadline).find((run) => isFinished(run.status)) || null : undefined),
    [runs.data],
  );
  const [gateOn] = useGate(botId);
  const gate = useMemo(
    () => (gateOn ? { enabled: true, savedAt: editor.meta?.savedAt || '', dirty: editor.dirty } : null),
    [gateOn, editor.meta?.savedAt, editor.dirty],
  );
  // What the server has read of the documents: read while the draft has knowledge or on the Knowledge page (which
  // shares it, so the menu follows a build there), and again after each save.
  const hasKnowledge = Array.isArray(config?.knowledge) && config.knowledge.length > 0;
  const knowledgeRead = useKnowledge(hasKnowledge || page === 'knowledge' ? botId : null);
  const reloadKnowledge = knowledgeRead.reload;
  const knowledgeSaved = useRef(editor.meta?.savedAt || '');
  useEffect(() => {
    const savedAt = editor.meta?.savedAt || '';
    if (savedAt === knowledgeSaved.current) return;
    knowledgeSaved.current = savedAt;
    reloadKnowledge();
  }, [editor.meta?.savedAt, reloadKnowledge]);
  // the steps from this draft to a live agent (the Overview's checklist and the menu's progress card)
  const plan = useMemo(
    () => readinessSteps({ config, summary, report: editor.report, scenarioCount, latestRun, gate, knowledgeRead: knowledgeRead.data }),
    [config, summary, editor.report, scenarioCount, latestRun, gate, knowledgeRead.data],
  );
  // the seven build parts and where each stands, for Build's side list and the Overview
  const sections = useMemo(() => buildSections({ config, errorsByPage, knowledgeRead: knowledgeRead.data }), [config, errorsByPage, knowledgeRead.data]);
  const [setupProgress] = useSetupProgress(botId);
  const settingUp = inSetup(setupProgress, summary);
  const openStep = useCallback(
    (step) => {
      if (!step) return;
      if (step.page === 'checks') {
        setDrawer('problems');
        return;
      }
      if (settingUp && SETUP_STEP[step.id]) {
        go('setup', { step: SETUP_STEP[step.id] });
        return;
      }
      if (step.target) {
        setOpenRequest({ ...step.target, nonce: Date.now(), page: 'agent' });
        go('agent');
        return;
      }
      go(tabFor(step.page, step.part));
    },
    [go, settingUp],
  );
  // Shows a place in the configuration: its page, then the panel (Agent page) or field. A page whose form is one of its
  // parts (Workflow, Knowledge, Settings) switches to that part first.
  const showPath = useCallback(
    (path) => {
      const where = locate(path);
      if (FORM_PART[where.page]) setLocalPart((old) => ({ ...old, [where.page]: FORM_PART[where.page] }));
      setFocusRequest({ path, nonce: Date.now(), page: where.page });
      if (where.drawer || where.focus) setOpenRequest({ id: where.drawer, focus: where.focus, nonce: Date.now(), page: where.page });
      setDrawer(null);
      go(tabFor(where.page, where.part));
    },
    [go],
  );
  // ?setting=… once the draft is read (going to the setting's page drops the parameter, so it runs once)
  useEffect(() => {
    if (askSetting && editor.isObject) showPath(askSetting.split('.'));
  }, [askSetting, editor.isObject, showPath]);
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
  // "Open Models" in a form: the Agent page's AI models panel; a side panel with unapplied changes asks first.
  //   stage: 'stt' | 'llm' | 'tts', the model to show; anything else (a click) shows the panel
  const openModels = (stage) => whenPanelKept(() => showPath(['defaults', 'models', ...(['stt', 'llm', 'tts'].includes(stage) ? [stage] : [])]));
  const form = (id) => ({ keys: PAGE_SECTIONS[id], editor, focusRequest, onShowJson: openJson, onOpenJson: openJson, onShowModels: openModels });
  // the newest draft, for work that finishes after the render that started it (an upload)
  const latestConfig = useRef(config);
  latestConfig.current = config;
  // A field asked for by another page ("change it on the Agent page"): go there and focus it. Search requests (Ctrl K)
  // are taken below, on ask and when the agent opens with one waiting; a side panel with unapplied changes asks first.
  const showField = (target, focus) =>
    whenPanelKept(() => {
      setDrawer(null);
      setOpenRequest({ focus, nonce: Date.now(), page: target });
      go(target);
    });
  // the numbers callers dial (read only), shown on the Channels page: a phone line with no number can't be called yet
  const phoneNumbers = useLiveNumbers(page === 'channels' && !!config && reachOf(config).sip_voice, { botId });
  const phoneLine =
    phoneNumbers.mode !== 'live'
      ? ''
      : phoneNumbers.rows.length
        ? `Callers dial ${phoneNumbers.rows.map((r) => r.number).join(', ')}`
        : 'No number yet: one is added when it goes live (Releases › Deploy)';
  const showSetting = useRef(null);
  showSetting.current = (request) => {
    if (request.view === 'json') {
      openJson();
      return;
    }
    const target = searchTarget({ trail: request.trail, jump: request.path }, config);
    if (target.focus) {
      setDrawer(null);
      setOpenRequest({ focus: target.focus, nonce: Date.now(), page: target.page });
      go(target.page);
      return;
    }
    showPath(target.path);
  };
  useEffect(() => {
    const take = () => {
      const request = takeSettingFocus(botId);
      // a panel with unapplied changes (no Done pressed) asks first, rather than being replaced and its changes lost
      if (request) whenPanelKept(() => showSetting.current(request));
    };
    take();
    return onSettingFocus(take);
  }, [botId]);

  // Only the setup's own knowledge base (or none): documents are added with the plain controls. An agent with bases of
  // its own keeps the full Knowledge page.
  const knowledgeBases = Array.isArray(config?.knowledge) ? config.knowledge : [];
  const simpleKnowledge = editor.isObject && knowledgeBases.every((b) => b?.id === KNOWLEDGE_ID && b.type === 'vector_store' && b.mode === 'inject');

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
        plan={plan}
        sections={sections}
        onTest={() => setDrawer('test')}
        onStep={openStep}
        top={<AgentAlerts botId={botId} />}
      />
    );
  } else if (page === 'build') {
    body = (
      <GuidedBuild
        botId={botId}
        config={config}
        set={editor.setValue}
        latest={() => latestConfig.current}
        sections={sections}
        problems={errorsByPage}
        simpleKnowledge={simpleKnowledge}
        onUploaded={knowledgeRead.reload}
        onOpen={go}
      />
    );
  } else if (page === 'agent') {
    body = (
      <AgentPage
        editor={editor}
        openRequest={openRequest}
        notices={notices}
        plan={plan}
        onShowJson={openJson}
        onOpenJson={openJson}
        onShowModels={openModels}
      />
    );
  } else if (page === 'banking') {
    body = (
      <PageShell title="Banking" lead={PAGE_LEAD.banking}>
        <BankingPage
          config={config}
          set={editor.setValue}
          onTest={() => {
            setTestMode('rehearsal');
            go(tabFor('tests', 'try'));
          }}
        />
      </PageShell>
    );
  } else if (page === 'tools') {
    body = (
      <ListPage
        notice={
          missingTool ? (
            <Notice kind="warn" title={`“${missingTool}” isn’t in the draft`}>
              The calls used a tool by this name, but the draft has none: it was renamed or removed since. The tools it has now are below.
            </Notice>
          ) : null
        }
        title="Tools"
        lead={PAGE_LEAD.tools}
        editor={editor}
        top={
          editor.isObject ? (
            // the setup's own switches, so changing them later is the same move as the first time
            <Section title="What it can do" lead="Switch on what it may do in a conversation.">
              <ActionSwitches config={config} set={editor.setValue} onPage />
            </Section>
          ) : null
        }
        lists={TOOL_LISTS}
        extras={TOOL_EXTRAS}
        extrasTitle="Transfers, connections, forms, messages and tasks"
        openRequest={focusRequest}
        onShowJson={openJson}
        onOpenJson={openJson}
        onShowModels={openModels}
      />
    );
  } else if (page === 'channels') {
    body = (
      <ListPage
        title="Channels"
        lead={PAGE_LEAD.channels}
        editor={editor}
        top={
          editor.isObject ? (
            <Section title="Where people reach it" lead="Switch each one on or off. A new one says what it says first, set on the Agent page.">
              <ReachChoices
                config={config}
                set={editor.setValue}
                botId={botId}
                onPage
                onShowNotice={() => showField('aftercall', 'notice')}
                onShowVoice={() =>
                  whenPanelKept(() => {
                    setOpenRequest({ open: 'voice', nonce: Date.now(), page: 'agent' });
                    go('agent');
                  })
                }
                onShowNumber={() => go(tabFor('releases', 'deploy'))}
              />
            </Section>
          ) : null
        }
        lists={CHANNEL_LISTS}
        extras={CHANNEL_EXTRAS}
        extrasTitle="Hours and callers"
        onShowGreeting={() => showField('agent', 'greeting')}
        rowInfo={(kind, item) => (kind === 'channels' && item.type === 'sip_voice' ? phoneLine : '')}
        openRequest={focusRequest}
        onShowJson={openJson}
        onOpenJson={openJson}
        onShowModels={openModels}
      />
    );
  } else if (page === 'guardrails') {
    body = (
      <ListPage
        title="Guardrails"
        lead={PAGE_LEAD.guardrails}
        editor={editor}
        top={
          editor.isObject ? (
            <>
              <Section title="Topics" lead="What it keeps to, and what it stays away from.">
                <TopicsBlock config={config} set={editor.setValue} />
              </Section>
              <Section title="When it hands over or ends the call" lead="Moments it acts on by itself, whatever the conversation.">
                <MomentsBlock config={config} set={editor.setValue} />
              </Section>
            </>
          ) : null
        }
        lists={GUARDRAIL_LISTS}
        footer={
          <>
            {editor.isObject && (
              <Section title="Limits" lead="The most a call can take, whatever happens in it. Leave a box empty for no limit.">
                <LimitsBlock config={config} set={editor.setValue} onShowNudges={() => whenPanelKept(() => showPath(['defaults', 'conversation']))} />
              </Section>
            )}
            <Section title="Test the checks" lead="See what these checks would do with something a caller might say, before anyone calls.">
              <TryGuardrailsView config={config} />
            </Section>
          </>
        }
        openRequest={focusRequest}
        onShowJson={openJson}
        onOpenJson={openJson}
        onShowModels={openModels}
      />
    );
  } else if (page === 'aftercall') {
    body = (
      <SectionPage title="After the call" lead={PAGE_LEAD.aftercall} {...form('aftercall')} hide={askedAbove(config)}>
        {editor.isObject && (
          <>
            <Section title="After each call" lead="What is written, answered and kept once a call ends.">
              <div className="suFields">
                <SummaryBlock config={config} set={editor.setValue} unsupported={editor.report?.unsupported} />
                <QuestionsBlock config={config} set={editor.setValue} unsupported={editor.report?.unsupported} />
                <RecordingBlock config={config} set={editor.setValue} unsupported={editor.report?.unsupported} />
                <SensitiveBlock config={config} set={editor.setValue} unsupported={editor.report?.unsupported} />
              </div>
            </Section>
            <section className="nlSection smMore">
              <header>
                <div>
                  <h2>More after-call settings</h2>
                  <p>The model that writes the summaries once they are on, files sent after each call, closing messages, and the call records and logs.</p>
                </div>
              </header>
            </section>
          </>
        )}
      </SectionPage>
    );
  } else if (page === 'knowledge') {
    const p = part('knowledge', 'files');
    body =
      p === 'files' ? (
        <PageShell
          title="Knowledge"
          lead={PAGE_LEAD.knowledge}
          parts={[
            { id: 'files', label: 'Documents' },
            { id: 'settings', label: 'How it searches' },
          ]}
          part={p}
          onPart={setPart('knowledge')}
        >
          <KnowledgeTab
            botId={botId}
            name={name}
            editor={editor}
            knowledge={knowledgeRead}
            // the setup's own "What it knows" while the agent has only the setup's base, or none
            simple={simpleKnowledge}
            top={
              simpleKnowledge
                ? ({ reload }) => (
                    <Section title="What it knows" lead={`Documents and web pages it answers from. ${whoReadsKnowledge(config)}`}>
                      <KnowledgeBlock botId={botId} config={config} set={editor.setValue} latest={() => latestConfig.current} onPage onUploaded={reload} />
                    </Section>
                  )
                : null
            }
          />
        </PageShell>
      ) : (
        <SectionPage
          title="Knowledge"
          lead={PAGE_LEAD.knowledge}
          parts={[
            { id: 'files', label: 'Documents' },
            { id: 'settings', label: 'How it searches' },
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
          // the switch beside the title, so the canvas starts higher and gets the height
          partsInHead
          parts={[
            { id: 'canvas', label: 'Canvas' },
            { id: 'settings', label: 'Advanced' },
          ]}
          part={p}
          onPart={setPart('workflow')}
        >
          <WorkflowTab editor={editor} botId={botId} onShowSetting={showPath} onShowJson={openJson} onTest={() => setDrawer('test')} />
        </PageShell>
      ) : (
        <SectionPage
          title="Workflow"
          lead={PAGE_LEAD.workflow}
          // where it is on the Canvas part too
          partsInHead
          parts={[
            { id: 'canvas', label: 'Canvas' },
            { id: 'settings', label: 'Advanced' },
          ]}
          part={p}
          onPart={setPart('workflow')}
          // every subagent's instructions, as on the Canvas panel (the first is the Agent page's "What it should do")
          {...form('workflow')}
        />
      );
  } else if (page === 'settings') {
    // the settings' sections are its tabs; the whole configuration as JSON is one button away
    const p = part('settings', 'settings');
    const toggle = (
      <button type="button" className="quietButton nlBtn" onClick={() => setPart('settings')(p === 'json' ? 'settings' : 'json')}>
        <Icon name={p === 'json' ? 'sliders' : 'code'} size={15} />
        {p === 'json' ? 'Back to the settings' : 'Edit as JSON'}
      </button>
    );
    body =
      p === 'json' ? (
        <PageShell title="Settings" lead="The whole configuration as JSON. Edits here are the same draft as every page: save as usual." actions={toggle}>
          <JsonPart editor={editor} />
        </PageShell>
      ) : (
        <SectionPage title="Settings" lead={PAGE_LEAD.settings} actions={toggle} {...form('settings')} {...SETTINGS_ELSEWHERE} />
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
          top={<AgentAlerts botId={botId} />}
          bots={[{ id: botId, name }]}
          onOpenAgent={(id, target, query) => go(target, query)}
          onOpenCall={(id, callId, view) => go('calls', { call: callId, ...(view && view !== 'trace' ? { view } : {}) })}
        />
      </div>
    );
  } else if (page === 'speed') {
    body = (
      <div className="nlPage wide">
        <SpeedPage agentOnly bots={[{ id: botId, name }]} onOpenCall={(id, callId) => go('calls', { call: callId })} onShowSetting={showPath} />
      </div>
    );
  } else if (page === 'questions') {
    body = (
      <PageShell title="Questions" lead={PAGE_LEAD.questions}>
        <QuestionsPage botId={botId} editor={editor} onOpenCall={(callId) => go('calls', { call: callId })} />
      </PageShell>
    );
  } else if (page === 'tests') {
    // opens on trying the agent; a link to one part (e.g. Scenarios from the checklist) still opens that part
    const p = part('tests', 'try');
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
            session={testSession}
            mode={testMode}
            modeLocked={modeLocked}
            onMode={setTestMode}
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
        {p === 'versions' && <VersionsTab botId={botId} editor={editor} refreshKey={refresh} summary={summary} knowledgeRead={knowledgeRead.data} />}
        {p === 'deploy' && <DeployTab botId={botId} name={name} initialVersion={params?.version} refreshKey={refresh} onDeployed={bump} />}
      </PageShell>
    );
  }

  // Every page reads the draft: show an outline while it loads (not an empty agent or "the JSON needs fixing"), and
  // why it failed, with Try again, if it couldn't be read.
  const drawn = editor.status !== 'loading' && editor.status !== 'error' && !((editor.parsed?.error || !editor.isObject) && READS_THE_DRAFT.has(page));
  if (editor.status === 'loading') {
    body = (
      <div className="nlPage" aria-busy="true">
        <span className="skeleton" style={{ width: 200, height: 30 }} aria-hidden="true" />
        <span className="skeleton" style={{ width: '46%', height: 12, marginTop: 14 }} aria-hidden="true" />
        <SkeletonRows rows={5} label="Loading the agent" />
      </div>
    );
  } else if (editor.status === 'error') {
    body = (
      <PageShell title={PAGE_LABELS[page] || 'Agent'}>
        <ErrorState error={editor.loadError} onRetry={editor.reload} what="this agent’s draft" />
      </PageShell>
    );
  } else if ((editor.parsed?.error || !editor.isObject) && READS_THE_DRAFT.has(page)) {
    // Invalid JSON (a half-typed edit): a page editing through its own controls would build from nothing and replace
    // the whole draft, so it waits until the JSON is fixed in Settings.
    body = (
      <PageShell title={PAGE_LABELS[page] || 'Agent'}>
        <Notice
          kind="warn"
          title="The JSON needs fixing first"
          actions={
            <button type="button" className="quietButton" onClick={openJson}>
              Open the JSON
            </button>
          }
        >
          This page reads the draft, which isn’t valid JSON right now.
        </Notice>
      </PageShell>
    );
  }

  // The page in its stage's frame: Build's parts down the side (checks beside on a wide screen), Monitor's pages as
  // tabs. A page that couldn't be drawn (loading, error, JSON to fix) is shown as it is.
  const checksPanel = <ChecksCard editor={editor} onJump={(path) => showPath(path)} onAll={() => setDrawer('problems')} />;
  const stage = drawn ? stageOf(page)?.id : null;
  const staged =
    stage === 'build' ? (
      <BuildStage
        botId={botId}
        page={page}
        sections={sections}
        problems={errorsByPage}
        checks={testDocked ? null : checksPanel}
        jsonOpen={page === 'settings' && localPart.settings === 'json'}
        onJson={openJson}
        status={{ checked: !!editor.report, problems: errorCount }}
        onChecks={() => setDrawer('problems')}
      >
        {body}
      </BuildStage>
    ) : stage === 'monitor' ? (
      <MonitorTabs botId={botId} page={page}>
        {body}
      </MonitorTabs>
    ) : (
      body
    );

  // a refused (someone else saved first) or failed save, shown on every page of the agent, the setup's too
  const saveNotices = (
    <>
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
    </>
  );

  // The guided setup is its own page: its steps replace the menu, and its Back and Next replace the top bar.
  if (page === 'setup') {
    return (
      <div className="stWorkspace nlWorkspace" data-layout="new" data-page="setup">
        {editor.status === 'error' ? (
          <PageShell title="Set up">
            <ErrorState error={editor.loadError} onRetry={editor.reload} what="this agent’s draft" />
          </PageShell>
        ) : (
          <Suspense fallback={<Spinner label="Loading" />}>
            <SetupWizard
              botId={botId}
              name={name}
              editor={editor}
              summary={summary}
              session={session}
              sessionMode={sessionMode}
              modeLocked={modeLocked}
              setSessionMode={setSessionMode}
              bump={bump}
              initialStep={params?.step || ''}
              notices={saveNotices}
            />
          </Suspense>
        )}
        {manage.element}
        <div ref={realSession.audioHostRef} className="stTAudio" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="stWorkspace nlWorkspace" data-layout="new" data-page={page}>
      <div className="nlHead" ref={headRef}>
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
                onClick: async () => {
                  const ok = await askConfirm({
                    title: 'Discard your unsaved edits?',
                    body: 'The saved draft is loaded again, and what you changed since the last save is lost.',
                    confirmLabel: 'Discard edits',
                    tone: 'danger',
                  });
                  if (ok) editor.reload();
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
          testOpen={drawer === 'test'}
          onTest={() => setDrawer((d) => (d === 'test' ? null : 'test'))}
          onShare={() => setDrawer('share')}
          onPreview={editor.isObject ? () => setDrawer('prompt') : null}
        />
        <StageTabs botId={botId} page={page} plan={plan} problems={errorsByPage} onStep={openStep} />
      </div>

      {saveNotices}
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

      <div className={`nlMain ${testDocked ? 'docked' : ''}`}>
        <div className="nlBody">
          <Suspense fallback={<Spinner label="Loading" />}>{staged}</Suspense>
          <NextStepBar plan={plan} onStep={openStep} />
        </div>
        {testDocked && (
          <aside className="nlTestDock" aria-label="Test your agent">
            <header>
              <span className="nlDrawerIcon" aria-hidden="true">
                <Icon name="test" size={16} />
              </span>
              <strong>Test your agent</strong>
              <button type="button" className="nlDrawerClose" aria-label="Close the test panel" onClick={() => setDrawer(null)}>
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="nlTestDockBody">
              <ChatPreview session={session} mode={sessionMode} modeLocked={modeLocked} onMode={setSessionMode} botId={botId} editor={editor} />
            </div>
          </aside>
        )}
      </div>

      {drawer === 'share' && <ShareAgentDrawer botId={botId} name={name} onClose={() => setDrawer(null)} />}
      {drawer === 'prompt' && (
        <Drawer title="Preview the prompt" icon="eye" width="wide" onClose={() => setDrawer(null)}>
          {/* what the agent that answers first is told; another agent's is on its own page */}
          <PromptPreview agentId={readSimple(config).agentId} config={config} startOpen />
        </Drawer>
      )}
      {drawer === 'describe' && (
        <Drawer title="Describe it" icon="sparkle" width="wide" onClose={() => setDrawer(null)}>
          <div className="nlDescribe">
            <Suspense fallback={<Spinner label="Loading" />}>
              <AssistantTab editor={editor} botId={botId} name={name} onShowSetting={showPath} onShowJson={openJson} />
            </Suspense>
          </div>
        </Drawer>
      )}
      {drawer === 'test' && !testDocked && (
        <Drawer title="Test your agent" icon="test" className="testDrawer" onClose={() => setDrawer(null)}>
          <ChatPreview session={session} mode={sessionMode} modeLocked={modeLocked} onMode={setSessionMode} botId={botId} editor={editor} />
        </Drawer>
      )}
      {drawer === 'problems' && (
        <Drawer title="What the checks found" icon="check" onClose={() => setDrawer(null)}>
          <ValidationPanel
            editor={editor}
            onJump={(path) => showPath(path)}
            onApply={applyFix}
            onOpenModels={openModels}
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
      {/* the agent's voice plays from here, so it keeps playing across page changes */}
      <div ref={realSession.audioHostRef} className="stTAudio" aria-hidden="true" />
    </div>
  );
}
