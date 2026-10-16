// Mounts the real FormEditor (and so Node.jsx, the tool and channel editors…) or one of the other screens in a DOM with a config held in
// state, the way the Config tab does, so a test can click and type and then read the config that came out. It is bundled by
// tests/component/dom.js (esbuild) because it is JSX; nothing here is part of the app.
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FormEditor from '../../src/studio/form/FormEditor.jsx';
import SimpleConfig from '../../src/studio/simple/SimpleConfig.jsx';
import ScenariosTab from '../../src/studio/scenarios/ScenariosTab.jsx';
import ChatPreview from '../../src/studio/preview/ChatPreview.jsx';
import KnowledgeTab from '../../src/studio/knowledge/KnowledgeTab.jsx';
import WorkflowTab from '../../src/studio/workflow/WorkflowTab.jsx';
import CallsView from '../../src/studio/calls/CallsView.jsx';
import TraceView from '../../src/studio/trace/TraceView.jsx';
import { ValidationPanel } from '../../src/studio/ConfigTab.jsx';
import SmartSelect from '../../src/studio/SmartSelect.jsx';
import { useSimulatedSession } from '../../src/studio/test/useSimulatedSession.js';
import JourneyNav, { NextBar } from '../../src/studio/JourneyNav.jsx';
import StatePill from '../../src/studio/StatePill.jsx';
import { agentState } from '../../src/studio/status.js';

function PreviewScreen({ editor, mode, locked }) {
  const session = useSimulatedSession({ getConfig: async () => editor.parsed.value });
  return <ChatPreview session={session} mode={mode} modeLocked={locked} onMode={() => {}} botId="x" editor={editor} />;
}

const SCREENS = {
  form: (editor) => <FormEditor editor={editor} onShowJson={() => {}} onShowModels={() => {}} />,
  simple: (editor) => <SimpleConfig editor={editor} onShowJson={() => {}} onOpenAll={() => {}} />,
  scenarios: (editor, props) => <ScenariosTab botId="x" name="X" editor={editor} pollMs={props.pollMs} />,
  knowledge: (editor, props) => <KnowledgeTab botId="x" name="X" editor={editor} pollMs={props.pollMs} />,
  calls: (editor, props) => <CallsView bots={props.bots || [{ id: 'x', name: 'X' }]} fixedBotId={props.fixedBotId || ''} />,
  validation: (editor, props) => <ValidationPanel editor={editor} folded={!!props.folded} onFold={() => {}} onJump={props.onJump || (() => {})} onApply={(next) => editor.setValue(next)} onOpenModels={props.onOpenModels || (() => {})} />,
  smartselect: (editor, props) => <SmartSelect value={editor.parsed.value.picked ?? ''} options={props.options} ariaLabel="Pick one" action={!!props.action} placeholder={props.placeholder} onChange={(picked) => editor.setValue({ picked })} />,
  trace: (editor, props) => <TraceView records={props.records || []} live={!!props.live} />,
  journey: (editor, props) => <><JourneyNav botId="acme" tab={props.tab || 'config'} live={!!props.live} /><NextBar botId="acme" tab={props.tab || 'config'} /><StatePill state={agentState(props.state || {})} /></>,
  workflow: (editor) => <WorkflowTab editor={editor} botId="x" />,
  preview: (editor, props) => <PreviewScreen editor={editor} mode={props.mode || 'simulated'} locked={!!props.locked} />,
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
    save: async () => { setDirty(false); },
    reload: () => {},
    meta: {},
    conflict: false,
    setValue: (next) => { setConfig(next); setDirty(true); onConfig(next); },
  };
  return SCREENS[screen](editor, props);
}

export async function mountScreen(screen, initial, { props = {}, report = null, ready = '.stForm' } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = { config: initial };
  await act(async () => { root.render(<Host initial={initial} onConfig={(next) => { state.config = next; }} screen={screen} props={props} report={report} />); });
  for (let i = 0; i < 50 && !container.querySelector(ready); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return {
    container,
    get config() { return state.config; },
    async wait(ms) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); },
    async unmount() { await act(async () => root.unmount()); container.remove(); },
  };
}

export const mountForm = (initial) => mountScreen('form', initial);

export { act };
