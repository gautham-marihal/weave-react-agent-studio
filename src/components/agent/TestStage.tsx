import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlertIcon, PhoneIcon } from 'lucide-react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { isWebChannel, type Path } from '../../types/studio';
import type { TestSession } from '../../hooks/useTestSession';
import { LiveTestSession } from './test/LiveTestSession';
import { TracePanel } from './test/TracePanel';
import { VoiceReadinessPanel } from './test/VoiceReadinessPanel';
import { TryPanel } from './test/TryPanel';
import { ScenariosPanel } from './test/scenarios/ScenariosPanel';
import { CallersPanel } from './test/callers/CallersPanel';
import { ReadinessChecksPanel } from './test/checks/ReadinessChecksPanel';
import { useTestDock } from './test/dock/testDockContext';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { describePath } from '../../utils/validate';
import { usesGateway } from '../../models/bankingTools';
import { useGatewayTimeline } from '../../hooks/useGatewayTimeline';
import { AgentSelector } from './test/AgentSelector';
import { LiveBankingPanel } from './test/LiveBankingPanel';
import { isSandbox } from '../../sandbox/mode';
import { SandboxSession } from '../../sandbox/test/SandboxSession';
import { SandboxNoteSlot } from '../../sandbox/test/SandboxNoteSlot';

interface TestStageProps {
  editor: DraftEditor;
  onGoToField: (path: Path) => void;
}

const TABS = [
  { value: 'live', label: 'Live conversation' },
  { value: 'readiness', label: 'Voice readiness' },
  { value: 'scenarios', label: 'Scenarios' },
  { value: 'callers', label: 'Scripted callers' },
  { value: 'checks', label: 'Readiness checks' },
] as const;
type TestTab = (typeof TABS)[number]['value'];

/**
 * The Test page. Inside an agent's workspace the conversation is the one the test panel beside other pages shares
 * (so it keeps going across pages); on its own the page holds its own.
 */
export function TestStage(props: TestStageProps) {
  const dock = useTestDock();
  if (dock) return <TestStageBody {...props} session={dock.session} />;
  // In Sandbox the conversation is an imitation answered in this browser (loaded only then); in Live, the real agent,
  // and for a banking agent a banking rehearsal on the mock bank as well.
  if (isSandbox()) return <SandboxSession editor={props.editor}>{(session) => <TestStageBody {...props} session={session} />}</SandboxSession>;
  return <LiveTestSession editor={props.editor}>{(session) => <TestStageBody {...props} session={session} />}</LiveTestSession>;
}

function TestStageBody({ editor, onGoToField, session }: TestStageProps & { session: TestSession }) {
  const navigate = useNavigate();
  const config = editor.config!;
  const validation = editor.validationView.report;
  const hasWebChannel = (config.channels ?? []).some((c) => c.enabled && isWebChannel(c.type));
  // Drafts wired to the banking gateway get the customer's device and the gateway's own timeline. In Sandbox the
  // banking conversation brings its own device (session.extras); in Live the device shows what is true.
  const banking = usesGateway(config) || Boolean(session.extras);
  const gatewayTrace = useGatewayTimeline(session.room, session.startedAt, banking);
  const trace = React.useMemo(
    () => (gatewayTrace.length ? [...session.trace, ...gatewayTrace].sort((a, b) => a.at_ms - b.at_ms) : session.trace),
    [session.trace, gatewayTrace]
  );

  let blocker: React.ReactNode = null;
  // The server's checks inform; the server itself refuses a session for a draft it cannot run (and says why).
  const problems = validation && !validation.valid ? (
      <div role="status" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft/40 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <CircleAlertIcon className="h-4 w-4 text-danger" aria-hidden />
          The server’s checks found {validation.errors.length} {validation.errors.length === 1 ? 'problem' : 'problems'}. It may refuse to start a test until they are fixed.
        </p>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-left">
          {validation.errors.map((e, i) => (
            <li key={i} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                {e.path && <p className="text-xs text-muted">{describePath(e.path, config)}</p>}
                <p className="text-[13px] text-ink">{e.message}</p>
              </div>
              {e.path && (
                <Button size="sm" variant="secondary" onClick={() => onGoToField(e.path!)}>
                  Fix
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  // Sandbox's imitation plays a phone-only agent as text, so only a real conversation needs a web channel.
  if (!hasWebChannel && !session.sandbox) {
    blocker = (
      <Blocker
        icon={<PhoneIcon className="h-5 w-5 text-muted" aria-hidden />}
        title="This agent is phone only"
        body="Testing in Studio uses web chat or web voice. Turn one of them on under Where it is available — you can keep it off in production."
      >
        <Button variant="secondary" className="mt-4" onClick={() => navigate(`/agents/${editor.agent!.id}/build`)}>
          Go to Build
        </Button>
      </Blocker>
    );
  }

  // The open tab lives in the address (?focus=scenarios), so a readiness step or "Open scenarios" can open it.
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  const activeTab: TestTab = TABS.some((t) => t.value === focus) ? (focus as TestTab) : 'live';
  const setActiveTab = (tab: TestTab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'live') next.delete('focus');
        else next.set('focus', tab);
        return next;
      },
      { replace: true }
    );

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Test Mode" options={[...TABS]} value={activeTab} onChange={(v) => setActiveTab(v as TestTab)} />
          <AgentSelector
            currentAgentId={editor.agent!.id}
            onSelect={(id) => {
              if (id !== editor.agent!.id) {
                if (session.status !== 'idle') session.stop();
                navigate(`/agents/${id}/test`);
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span>
            {activeTab === 'scenarios' && editor.dirty
              ? 'Scenario runs use what is in the editor'
              : session.sandbox
                ? 'Conversations use what is in the editor'
                : `Conversations use saved revision rev ${editor.baseRevision}`}
          </span>
        </div>
      </div>

      {activeTab === 'live' && problems}
      {activeTab === 'live' ? (
        blocker ?? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <TryPanel
              editor={editor}
              session={session}
              currentAgentId={editor.agent!.id}
              onSwitchAgent={(id) => {
                if (session.status !== 'idle') session.stop();
                navigate(`/agents/${id}/test`);
              }}
            />
            <div className="flex min-w-0 flex-col gap-4">
              {session.extras ? session.extras.beside : banking && <LiveBankingPanel session={session} />}
              {session.sandbox && <SandboxNoteSlot kind="trace" always />}
              {/* The trace scrolls inside its own column instead of stretching the page. */}
              <div className="flex max-h-[640px] min-h-0 flex-col lg:max-h-[720px] [&>section]:max-h-full">
                <TracePanel trace={trace} live={session.status === 'live' || session.status === 'waiting'} />
              </div>
            </div>
          </div>
        )
      ) : activeTab === 'readiness' ? (
        <VoiceReadinessPanel botId={editor.agent!.id} config={config} />
      ) : activeTab === 'scenarios' ? (
        <ScenariosPanel editor={editor} />
      ) : activeTab === 'callers' ? (
        <CallersPanel editor={editor} />
      ) : (
        <ReadinessChecksPanel agent={editor.agent!} />
      )}
    </div>
  );
}

interface BlockerProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}

function Blocker({ icon, title, body, children }: BlockerProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-14 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle">{icon}</span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {children}
    </div>
  );
}