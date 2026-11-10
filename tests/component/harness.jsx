// Mounts the real FormEditor (and so Node.jsx, the tool and channel editors…) or one of the other screens in a DOM with a config held in
// state, the way the Config tab does, so a test can click and type and then read the config that came out. It is bundled by
// tests/component/dom.js (esbuild) because it is JSX; nothing here is part of the app.
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../src/api/queryClient.ts';
import { TipProvider } from '../../src/ui/Tip.tsx';
import FormEditor from '../../src/studio/form/FormEditor.jsx';
import ScenariosTab from '../../src/studio/scenarios/ScenariosTab.jsx';
import ChatPreview from '../../src/studio/preview/ChatPreview.jsx';
import KnowledgeTab from '../../src/studio/knowledge/KnowledgeTab.jsx';
import WorkflowTab from '../../src/studio/workflow/WorkflowTab.jsx';
import AssistantTab from '../../src/studio/assistant/AssistantTab.jsx';
import CallsView from '../../src/studio/calls/CallsView.jsx';
import MonitoringPage from '../../src/studio/monitoring/MonitoringPage.jsx';
import TraceView from '../../src/studio/trace/TraceView.jsx';
import { ValidationPanel } from '../../src/studio/ValidationPanel.jsx';
import HomePage from '../../src/studio/agent/pages/HomePage.jsx';
import LanguagePicker from '../../src/studio/agent/pickers/LanguagePicker.jsx';
import VoicePicker from '../../src/studio/agent/pickers/VoicePicker.jsx';
import ModelPicker from '../../src/studio/agent/pickers/ModelPicker.jsx';
import { FALLBACK_PROVIDERS } from '../../src/studio/models/catalog.js';
import TeamPage from '../../src/studio/team/TeamPage.jsx';
import ShareAgentDrawer from '../../src/studio/team/ShareAgentDrawer.jsx';
import FixCallDrawer from '../../src/studio/fixcall/FixCallDrawer.jsx';
import CallersPanel from '../../src/studio/callers/CallersPanel.jsx';
import TestHealth, { useTestHealth } from '../../src/studio/test/TestHealth.jsx';
import StageTabs from '../../src/studio/agent/workspace/StageTabs.jsx';
import StageViews from '../../src/studio/agent/workspace/StageViews.jsx';
import BuildStage from '../../src/studio/agent/workspace/BuildStage.jsx';
import GuidedBuild from '../../src/studio/agent/workspace/GuidedBuild.jsx';
import AgentTopBar from '../../src/studio/agent/AgentTopBar.jsx';
import AgentSwitcher from '../../src/studio/agent/AgentSwitcher.jsx';
import SmartSelect from '../../src/studio/SmartSelect.jsx';
import { FreeValue, NumberInput } from '../../src/studio/form/fields.jsx';
import { useSimulatedSession } from '../../src/studio/test/useSimulatedSession.js';
import StatePill from '../../src/studio/StatePill.jsx';
import { agentState } from '../../src/studio/status.js';
import { StyleCards } from '../../src/ui/StylePicker.jsx';
import PageShell from '../../src/studio/agent/PageShell.jsx';
import { Choice, OneOf } from '../../src/ui/OneOf.tsx';
import SearchOverlay from '../../src/pages/SearchPalette.jsx';
import { bestFirst } from '../../src/ui/match.ts';
import { DetailedPage } from '../../src/studio/agent/detailed/Detailed.jsx';
import { agentPart } from '../../src/studio/agent/detailed/parts/agentPart.jsx';
import { conversationPart } from '../../src/studio/agent/detailed/parts/conversationPart.jsx';
import { knowledgePart } from '../../src/studio/agent/detailed/parts/knowledgePart.jsx';
import { toolsPart } from '../../src/studio/agent/detailed/parts/toolsPart.jsx';
import { connectionsPart } from '../../src/studio/agent/detailed/parts/connectionsPart.jsx';
import { channelsPart } from '../../src/studio/agent/detailed/parts/channelsPart.jsx';
import { mediaPart } from '../../src/studio/agent/detailed/parts/mediaPart.jsx';
import { stepsPart } from '../../src/studio/agent/detailed/parts/stepsPart.jsx';
import { subagentsPart } from '../../src/studio/agent/detailed/parts/subagentsPart.jsx';
import { guardrailsPart } from '../../src/studio/agent/detailed/parts/guardrailsPart.jsx';
import { afterCallPart } from '../../src/studio/agent/detailed/parts/afterCallPart.jsx';
import { enginePart } from '../../src/studio/agent/detailed/parts/enginePart.jsx';

// the parts of Build › Detailed, by page id, for the tests that read their specs
export const DETAILED_PARTS = Object.fromEntries(
  [
    agentPart,
    conversationPart,
    knowledgePart,
    toolsPart,
    connectionsPart,
    channelsPart,
    mediaPart,
    stepsPart,
    subagentsPart,
    guardrailsPart,
    afterCallPart,
    enginePart,
  ].map((part) => [part.id, part]),
);

// the search (Ctrl K) over a few pages, matched the way the workspace matches them; what is chosen goes into the config, and closing it shows "closed"
const SEARCH_PAGES = [
  { type: 'page', id: 'home', title: 'Home', description: 'What needs attention, and the next step', icon: 'home' },
  { type: 'page', id: 'monitoring', title: 'Monitoring', description: 'How your agents are doing', icon: 'monitor' },
  { type: 'page', id: 'speed', title: 'Speed', description: 'How fast your agents answer', icon: 'gauge' },
  { type: 'action', id: 'help', title: 'Help & shortcuts', description: 'Keyboard shortcuts', icon: 'help' },
];
function SearchScreen({ editor }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(true);
  const found = bestFirst(SEARCH_PAGES, query, (item) => [item.title, item.description]);
  const groups = [
    { group: 'Navigate', items: found.filter((item) => item.type === 'page') },
    { group: 'Actions', items: found.filter((item) => item.type === 'action') },
  ].filter((group) => group.items.length);
  return open ? (
    <SearchOverlay
      query={query}
      onQueryChange={setQuery}
      groups={groups}
      onSelect={(item) => {
        setOpen(false);
        editor.setValue({ picked: item.id });
      }}
      onClose={() => setOpen(false)}
    />
  ) : (
    <p className="searchClosed">closed</p>
  );
}

function PreviewScreen({ editor, mode, locked }) {
  const session = useSimulatedSession({ getConfig: async () => editor.parsed.value });
  return <ChatPreview session={session} mode={mode} modeLocked={locked} onMode={() => {}} botId="x" editor={editor} />;
}

// "Ready to publish?" as the Test stage draws it, with the facts it is given; the part a tile opens goes into `opened`
// Build's Guided view with its step kept here, as the app keeps it in the address
function GuidedScreen({ editor, props }) {
  const [step, setStep] = useState(props.step || 'who');
  return (
    <GuidedBuild
      botId="x"
      config={editor.parsed.value}
      set={editor.setValue}
      latest={() => editor.parsed.value}
      problems={props.problems || 0}
      step={step}
      onStep={setStep}
      onOpen={props.onOpen || (() => {})}
      onTest={props.onTest || (() => {})}
      onPublish={props.onPublish || (() => {})}
    />
  );
}

function HealthScreen({ editor, props }) {
  const health = useTestHealth({ botId: 'x', editor, readinessRuns: props.readinessRuns || [], callers: props.callers || null, on: true });
  return <TestHealth health={health} onOpen={(id) => props.opened?.push(id)} />;
}

const SCREENS = {
  form: (editor) => <FormEditor editor={editor} onShowJson={() => {}} onShowModels={() => {}} />,
  scenarios: (editor, props) => <ScenariosTab botId="x" name="X" editor={editor} pollMs={props.pollMs} />,
  knowledge: (editor, props) => <KnowledgeTab botId="x" name="X" editor={editor} pollMs={props.pollMs} />,
  calls: (editor, props) => (
    <CallsView bots={props.bots || [{ id: 'x', name: 'X' }]} fixedBotId={props.fixedBotId || ''} editor={props.withEditor ? editor : null} />
  ),
  monitoring: (editor, props) => (
    <MonitoringPage bots={props.bots || [{ id: 'x', name: 'X' }]} onOpenAgent={props.onOpenAgent || (() => {})} onOpenCall={props.onOpenCall || (() => {})} />
  ),
  validation: (editor, props) => (
    <ValidationPanel
      editor={editor}
      folded={!!props.folded}
      onFold={() => {}}
      onJump={props.onJump || (() => {})}
      onApply={(next) => editor.setValue(next)}
      onOpenModels={props.onOpenModels || (() => {})}
    />
  ),
  freevalue: (editor) => <FreeValue value={editor.parsed.value.v} aria-label="Value" onChange={(v) => editor.setValue({ v })} />,
  // a number whose 0 means "not set" (a guardrail limit): what it gives back for 0 is empty
  numberinput: (editor) => (
    <label>
      Limit
      <NumberInput value={editor.parsed.value.n ?? null} nullable onChange={(n) => editor.setValue({ n: n ? n : undefined })} />
    </label>
  ),
  smartselect: (editor, props) => (
    <SmartSelect
      value={editor.parsed.value.picked ?? ''}
      options={props.options}
      ariaLabel="Pick one"
      action={!!props.action}
      placeholder={props.placeholder}
      onChange={(picked) => editor.setValue({ picked })}
    />
  ),
  trace: (editor, props) => <TraceView records={props.records || []} live={!!props.live} />,
  statepill: (editor, props) => <StatePill state={agentState(props.state || {})} />,
  workflow: (editor, props) => <WorkflowTab editor={editor} botId="x" onShowSetting={props.onShowSetting || null} workspace={props.workspace || null} />,
  detailed: (editor, props) => (
    <DetailedPage part={DETAILED_PARTS[props.part]} editor={editor} extra={props.extra || {}} request={props.request || null} onShowJson={() => {}} />
  ),
  homepage: (editor, props) => (
    <HomePage
      botId="x"
      name="X"
      summary={props.summary || {}}
      editor={editor}
      scenarioCount={props.scenarioCount || 0}
      sections={props.sections || []}
      onProblems={props.onProblems || (() => {})}
      onDescribe={() => {}}
      onTest={() => {}}
    />
  ),
  languagepicker: (editor) => <LanguagePicker config={editor.parsed.value} set={editor.setValue} />,
  voicepicker: (editor) => <VoicePicker config={editor.parsed.value} set={editor.setValue} />,
  modelpicker: (editor, props) => <ModelPicker config={editor.parsed.value} set={editor.setValue} providers={props.providers || FALLBACK_PROVIDERS} live />,
  team: (_editor, props) => (
    <TeamPage
      agents={props.agents || []}
      existingIds={props.existingIds || null}
      workspaceName="Acme"
      profile={{ fullName: 'Owner', email: 'owner@acme.com' }}
    />
  ),
  share: () => <ShareAgentDrawer botId="a" name="Acme Support" onClose={() => {}} onOpenTeam={() => {}} />,
  fixcall: (editor, props) => (
    <FixCallDrawer
      botId="x"
      facts={props.facts}
      call={props.call || null}
      events={props.events || []}
      editor={editor}
      onClose={() => {}}
      onApplied={() => {}}
    />
  ),
  callers: (editor) => <CallersPanel botId="x" name="Acme" editor={editor} />,
  testhealth: (editor, props) => <HealthScreen editor={editor} props={props} />,
  stylecards: () => <StyleCards />,
  stagetabs: (editor, props) => (
    <StageTabs botId="x" page={props.page || 'home'} plan={props.plan || null} problems={props.problems || {}} onStep={props.onStep} />
  ),
  guidedbuild: (editor, props) => <GuidedScreen editor={editor} props={props} />,
  buildstage: (editor, props) => (
    <BuildStage botId="x" page={props.page || 'agent'} sections={props.sections || []} problems={props.problems || {}} onJson={() => {}}>
      <p className="theOpenPage">the open page</p>
    </BuildStage>
  ),
  stageviews: (editor, props) => (
    <StageViews
      botId="x"
      page={props.page}
      part={props.part || ''}
      checks={props.checks || null}
      counts={props.counts || {}}
      onJson={() => {}}
      onChecks={() => {}}
    />
  ),
  topbar: (editor, props) => (
    <AgentTopBar
      botId="x"
      name="Acme"
      summary={{ deployed: {} }}
      editor={{ ...editor, dirty: props.dirty ?? editor.dirty }}
      manageMenu={props.manageMenu || []}
      problems={props.problems || 0}
      changes={props.changes ?? null}
      live={false}
      testOpen={!!props.testOpen}
      onDescribe={() => {}}
      onProblems={props.onProblems || (() => {})}
      onChanges={props.onChanges || (() => {})}
      onTest={props.onTest || (() => {})}
      onShare={() => {}}
    />
  ),
  agentswitch: (editor, props) => <AgentSwitcher botId="a" bots={props.bots || []} tab={props.tab || 'tools'} />,
  assistant: (editor) => <AssistantTab editor={editor} botId="x" name="X" />,
  preview: (editor, props) => <PreviewScreen editor={editor} mode={props.mode || 'simulated'} locked={!!props.locked} />,
  search: (editor) => <SearchScreen editor={editor} />,
  pageshell: (editor) => (
    <PageShell
      title="Knowledge"
      parts={[
        { id: 'files', label: 'Documents' },
        { id: 'settings', label: 'How it searches' },
      ]}
      part={editor.parsed.value.part}
      onPart={(part) => editor.setValue({ part })}
    >
      <p>the {editor.parsed.value.part} part</p>
    </PageShell>
  ),
  oneof: (editor) => (
    <OneOf label="How to read this call" value={editor.parsed.value.view} onChange={(view) => editor.setValue({ view })}>
      <Choice value="trace">What happened</Choice>
      <Choice value="conversation">Conversation only</Choice>
      <Choice value="replay" disabled>
        Replay
      </Choice>
    </OneOf>
  ),
};

function Host({ initial, onConfig, screen, props, report }) {
  const [config, setConfig] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const editor = {
    parsed: { value: config, error: null },
    isObject: true,
    status: 'ready',
    report: report || null,
    dirty,
    saving: false,
    save: async () => {
      setDirty(false);
    },
    reload: () => {},
    meta: {},
    conflict: false,
    setValue: (next) => {
      setConfig(next);
      setDirty(true);
      onConfig(next);
    },
  };
  return SCREENS[screen](editor, props);
}

export async function mountScreen(screen, initial, { props = {}, report = null, ready = '.stForm' } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = { config: initial };
  // the app's data cache, emptied for each screen so one test's calls never answer another's; a failed read is not retried here
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TipProvider>
          <Host
            initial={initial}
            onConfig={(next) => {
              state.config = next;
            }}
            screen={screen}
            props={props}
            report={report}
          />
        </TipProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 50 && !container.querySelector(ready); i += 1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  return {
    container,
    get config() {
      return state.config;
    },
    async wait(ms) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export const mountForm = (initial) => mountScreen('form', initial);

export { act };
// the demo API the mounted screens talk to (the bundle's own copy), for a test that needs an answer the demo never gives
export { getDemoApi } from '../../src/demo/demoApi.js';
