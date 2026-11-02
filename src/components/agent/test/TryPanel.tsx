import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CameraIcon, FlaskConicalIcon, ImageIcon, MonitorUpIcon } from 'lucide-react';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import type { PlayedBy, TestSession } from '../../../hooks/useTestSession';
import { useVersionConfig } from '../../../hooks/useVersionConfig';
import { useStudio } from '../../../contexts/StudioContext';
import type { Agent, AgentConfig, Deployment, EnvironmentName } from '../../../types/studio';
import { envLabel, environments } from '../../../utils/agentStatus';
import { channelInputs, finalStateOf, pictureProblem, testability, toolsUsedIn } from '../../../utils/testSession';
import { isObj, scenarioFromConversation, scenariosOf } from '../../../models/scenario';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { TestConsole } from './TestConsole';
import { SandboxNoteSlot } from '../../../sandbox/test/SandboxNoteSlot';
import { Notice, Select } from './scenarios/parts';

// Talking to the agent: the conversation (TestConsole) plus what to talk to (the saved draft, the latest published
// version, or what is live in an environment), the notices that matter before starting (models not saved, parts the
// runtime does not run yet), pictures, camera and screen sharing when the channel takes them, and "make a scenario
// from this conversation". Used by the Test page and by the test panel beside other pages.

interface TryPanelProps {
  editor: DraftEditor;
  session: TestSession;
  /** The narrow layout of the panel beside other pages. */
  compact?: boolean;
  currentAgentId?: string;
  onSwitchAgent?: (agentId: string) => void;
}

const MODEL_STAGES = ['stt', 'llm', 'tts', 'realtime'] as const;
const modelsOf = (config: AgentConfig | null | undefined) => {
  const models = isObj(config?.defaults?.models) ? (config?.defaults?.models as Record<string, unknown>) : {};
  return JSON.stringify(MODEL_STAGES.map((k) => models[k] ?? null));
};
const modelWords = (config: AgentConfig | null | undefined) =>
  MODEL_STAGES.map((k) => {
    const m = config?.defaults?.models?.[k];
    return isObj(m) && m.provider
      ? `${k === 'stt' ? 'speech-to-text' : k === 'tts' ? 'voice' : k === 'llm' ? 'language model' : 'realtime'} ${String(m.provider)}${m.model ? ` ${String(m.model)}` : ''}`
      : '';
  })
    .filter(Boolean)
    .join(', ');

/** What is live in each environment: its newest active deployment, whatever order the history lists them in. */
function liveIn(deployments: Deployment[]): Partial<Record<EnvironmentName, Deployment>> {
  const out: Partial<Record<EnvironmentName, Deployment>> = {};
  deployments.forEach((d) => {
    const seen = out[d.environment];
    if (d.status === 'active' && (!seen || d.deployed_at >= seen.deployed_at)) out[d.environment] = d;
  });
  return out;
}

export function TryPanel({ editor, session, compact = false, currentAgentId, onSwitchAgent }: TryPanelProps) {
  const navigate = useNavigate();
  const { getAgent } = useStudio();
  const agent = editor.agent as Agent;
  const config = editor.config as AgentConfig;
  const [target, setTarget] = useState('draft');
  const active = session.status === 'connecting' || session.status === 'waiting' || session.status === 'live';

  // What can be talked to: the draft, the newest published version, and each environment something is live in.
  const deployed = useMemo(() => liveIn(agent.deployments), [agent.deployments]);
  const targets = useMemo(() => {
    // Sandbox's imitation plays what is in the editor, saved or not.
    const out = [{ value: 'draft', label: session.sandbox ? 'The draft, as edited' : 'The saved draft' }];
    if (agent.versions[0]) out.push({ value: 'latest', label: `Latest published (v${agent.versions[0].version})` });
    environments.forEach((env: EnvironmentName) => {
      const d = deployed[env];
      if (d) out.push({ value: env, label: `${envLabel(env)} (v${d.version})` });
    });
    return out;
  }, [agent.versions, deployed, session.sandbox]);
  useEffect(() => {
    if (!targets.some((t) => t.value === target)) setTarget('draft');
  }, [targets, target]);
  const version = target === 'draft' ? undefined : target === 'latest' ? agent.versions[0]?.version : deployed[target as EnvironmentName]?.version;
  const versionConfig = useVersionConfig(agent, version);
  const testConfig = target === 'draft' ? config : versionConfig.config;
  const reach = testability(testConfig);

  // The saved draft is what a draft conversation runs; models changed in the editor are not part of it until saved.
  const savedConfig = getAgent(agent.id)?.draft.config;
  const modelsUnsaved = !session.sandbox && target === 'draft' && editor.dirty && !!savedConfig && modelsOf(savedConfig) !== modelsOf(config);
  const unsupported = target === 'draft' ? (editor.validationView.report?.unsupported ?? []) : [];

  // What the channel of this conversation takes, as the server said when it started.
  const channelId = session.info?.channel?.id;
  const inputs = channelInputs(session.info?.channel);
  const channelCfg = (testConfig?.channels ?? []).find((c) => c.id === channelId);
  const imageCfg =
    target === 'draft' && isObj(channelCfg?.inputs) && isObj(channelCfg?.inputs.image) ? (channelCfg?.inputs.image as Record<string, unknown>) : null;
  const screenShare = target === 'draft' && isObj(channelCfg?.inputs) && isObj(channelCfg?.inputs.video) && channelCfg?.inputs.video.screen_share === true;
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pictureNote, setPictureNote] = useState('');
  const { attachCamera } = session;
  useEffect(() => {
    if (session.media.camera) attachCamera(videoRef.current);
  }, [session.media.camera, attachCamera]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !imageCfg) return;
    const accepted = Array.isArray(imageCfg.accepted_mime) ? imageCfg.accepted_mime.filter((x): x is string => typeof x === 'string') : [];
    const problem = pictureProblem(file, { acceptedMime: accepted, maxBytes: typeof imageCfg.max_bytes === 'number' ? imageCfg.max_bytes : 0 });
    setPictureNote(problem);
    if (!problem) await session.sendImage(file, typeof imageCfg.topic === 'string' && imageCfg.topic ? imageCfg.topic : 'image-upload');
  };

  // A finished conversation becomes a starting scenario in the draft: the caller's turns, the tools used, the final state.
  const [madeFrom, setMadeFrom] = useState<{ id: string; first: string } | null>(null);
  const firstId = session.messages[0]?.id ?? '';
  const made = madeFrom && madeFrom.first === firstId ? madeFrom.id : null;
  const canMake = editor.canEdit && !active && session.messages.some((m) => m.from === 'user');
  const makeScenario = () => {
    const scenario = scenarioFromConversation(config, {
      channel: channelId,
      messages: session.messages.map((m) => ({ from: m.from, text: m.text })),
      tools: toolsUsedIn(session.records),
      finalState: finalStateOf(session.records),
    });
    editor.replaceConfig({ ...config, tests: [...scenariosOf(config), scenario] });
    setMadeFrom({ id: scenario.id, first: firstId });
  };

  const connected = session.status === 'live';
  const footer =
    (inputs.image || inputs.video) && active ? (
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2" aria-label="Pictures and video">
        {inputs.video && (
          <Button
            size="sm"
            variant={session.media.camera ? 'primary' : 'secondary'}
            aria-pressed={session.media.camera}
            disabled={!connected}
            onClick={() => void session.toggleMedia('camera')}
          >
            <CameraIcon className="h-3.5 w-3.5" aria-hidden />
            {session.media.camera ? 'Camera on' : 'Camera off'}
          </Button>
        )}
        {inputs.video && screenShare && (
          <Button
            size="sm"
            variant={session.media.screen ? 'primary' : 'secondary'}
            aria-pressed={session.media.screen}
            disabled={!connected}
            onClick={() => void session.toggleMedia('screen')}
          >
            <MonitorUpIcon className="h-3.5 w-3.5" aria-hidden />
            {session.media.screen ? 'Sharing screen' : 'Share screen'}
          </Button>
        )}
        {inputs.image && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={!connected || !imageCfg}
              title={imageCfg ? 'Send a picture' : 'Pictures can be sent when talking to the draft'}
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              Send a picture
            </Button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={(Array.isArray(imageCfg?.accepted_mime) ? (imageCfg?.accepted_mime as string[]) : ['image/*']).join(',')}
              onChange={(e) => void onFile(e)}
            />
          </>
        )}
        {pictureNote && (
          <p role="alert" className="w-full text-xs text-danger">
            {pictureNote}
          </p>
        )}
        {session.media.camera && (
          <video ref={videoRef} className="mt-1 h-28 w-40 rounded-md bg-ink/80 object-cover" autoPlay muted playsInline aria-label="Your camera" />
        )}
      </div>
    ) : null;

  // In the narrow panel a banking conversation's customer device takes turns with the transcript, and comes forward
  // by itself when it needs the person (a keypad, a confirmation).
  const [view, setView] = useState<'conversation' | 'device'>('conversation');
  const attention = session.extras?.attention ?? '';
  const firstAttention = useRef(attention);
  useEffect(() => {
    if (!compact || attention === firstAttention.current) return;
    firstAttention.current = attention;
    if (/^[^|]+\||\|[^|:]+:ready\|/.test(attention)) setView('device');
  }, [attention, compact]);
  const deviceView = compact && session.extras && view === 'device';

  // Live, banking agent: who plays the agent (the real one, or a rehearsal on the mock bank), chosen before it starts.
  const playedBy = session.playedBy;
  const toolbar = (
    <>
      {playedBy && (
        <Select
          className="h-7 w-auto max-w-[16rem] py-0 text-xs"
          label="Played by"
          value={playedBy.value}
          options={playedBy.options}
          disabled={active}
          onChange={(v) => playedBy.onChange(v as PlayedBy)}
        />
      )}
      <Select className="h-7 w-auto max-w-[14rem] py-0 text-xs" label="Talk to" value={target} options={targets} disabled={active} onChange={setTarget} />
    </>
  );

  return (
    <div className={compact ? 'flex h-full min-h-0 flex-col' : 'flex min-w-0 flex-col gap-3'}>
      <div className={compact ? 'space-y-2 px-3 pt-3 empty:hidden' : 'space-y-3 empty:hidden'}>
        {session.sandbox && <SandboxNoteSlot kind={session.extras ? 'banking' : 'test'} always />}
        {compact && session.extras && (
          <Segmented
            size="sm"
            label="Show"
            options={[
              { value: 'conversation', label: 'Conversation' },
              { value: 'device', label: 'Customer’s device' },
            ]}
            value={view}
            onChange={(v) => setView(v as 'conversation' | 'device')}
          />
        )}
        {target !== 'draft' && (
          <Notice tone="info" title={version ? `This talks to version ${version}` : 'Loading that version…'}>
            It runs with the models and settings it was published with; your draft edits are not part of it.
            {versionConfig.error ? ` Its settings could not be read: ${versionConfig.error}` : ''}
          </Notice>
        )}
        {testConfig && reach.state === 'none' && !active && !session.sandbox && (
          <Notice tone="warning" title="This can’t be tried in the browser">
            Talking to the agent here needs a web chat or web voice channel
            {reach.phone.length ? `. It only has a phone line (${reach.phone.join(', ')}), which is tried by calling its number` : ''}.
          </Notice>
        )}
        {reach.state === 'off' && !active && !session.sandbox && (
          <Notice tone="warning" title="The web channels are switched off">
            Switch one on under Where it is available, or the server may refuse to start a conversation.
          </Notice>
        )}
        {modelsUnsaved && !active && (
          <Notice
            tone="warning"
            title="The AI models you chose aren’t saved yet"
            actions={
              <Button size="sm" variant="secondary" onClick={() => void editor.save()} disabled={!editor.canSave}>
                Save draft
              </Button>
            }
          >
            A conversation talks to the saved draft, which still uses {modelWords(savedConfig) || 'the models it had'}. You’ll be asked to save before it
            starts.
          </Notice>
        )}
        {unsupported.length > 0 && !active && (
          <Notice tone="warning" title={`${unsupported.length} ${unsupported.length === 1 ? 'part' : 'parts'} of this agent aren’t run by the runtime yet`}>
            The conversation may behave differently from what the settings describe:{' '}
            {[...new Set(unsupported.map((u) => u.feature).filter(Boolean))].join(', ')}.
          </Notice>
        )}
        {made && (
          <Notice
            tone="success"
            title={`Added the scenario “${made}” to the draft`}
            actions={
              <Button size="sm" variant="secondary" onClick={() => navigate(`/agents/${agent.id}/test?focus=scenarios`)}>
                Open scenarios
              </Button>
            }
          >
            It has what you said, the tools that were used and the state at the end. Edit what it checks, then run it. The draft isn’t saved yet.
          </Notice>
        )}
      </div>
      {deviceView && <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{session.extras?.beside}</div>}
      <div className={compact ? (deviceView ? 'hidden' : 'min-h-0 flex-1') : ''}>
        <TestConsole
          session={session}
          config={config}
          revision={editor.baseRevision}
          onBeforeStart={() => editor.ensureSaved('Start the test')}
          hasUnsaved={editor.dirty}
          currentAgentId={currentAgentId}
          onSwitchAgent={onSwitchAgent}
          target={target}
          targetChip={
            target === 'draft' ? undefined : version ? `v${version}${target === 'latest' ? '' : ` · ${envLabel(target as EnvironmentName)}`}` : target
          }
          channelsConfig={testConfig}
          toolbar={toolbar}
          footer={footer}
          compact={compact}
        />
      </div>
      {canMake && (
        <div className={compact ? 'border-t border-line px-3 py-2' : ''}>
          <Button
            size="sm"
            variant="secondary"
            onClick={makeScenario}
            disabled={!!made}
            title="Turns what you said and what the agent did into a test scenario in the draft"
          >
            <FlaskConicalIcon className="h-3.5 w-3.5" aria-hidden />
            {made ? 'Made into a scenario' : 'Make a scenario from this conversation'}
          </Button>
        </div>
      )}
    </div>
  );
}
