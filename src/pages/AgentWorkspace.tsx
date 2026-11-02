import React, { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Path, StageId } from '../types/studio';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { usePendingChange } from '../hooks/usePendingChange';
import { AgentHeader } from '../components/agent/AgentHeader';
import { BuildStage, type FocusRequest } from '../components/agent/BuildStage';
import { TestStage } from '../components/agent/TestStage';
import { TestDock } from '../components/agent/test/dock/TestDock';
import { ReleaseStage } from '../components/agent/ReleaseStage';
import { MonitorStage } from '../components/agent/MonitorStage';
import { NextStepBar } from '../components/agent/NextStepBar';
import { ConflictDialog } from '../components/agent/ConflictDialog';
import { PublishDialog } from '../components/agent/PublishDialog';
import { SaveFirstDialog } from '../components/agent/SaveFirstDialog';
import { LeaveGuard } from '../components/agent/LeaveGuard';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { Button } from '../components/ui/Button';
import { useStudio } from '../contexts/StudioContext';
import { useReadiness } from '../hooks/useReadiness';
import { OverviewStage } from '../components/agent/OverviewStage';
import { SetupWizard } from '../components/agent/setup/SetupWizard';
import { BUILD_SECTIONS, sectionOfPath, targetPath, type BuildSection } from '../models/agentPages';
import { useDeepLink } from '../hooks/useDeepLink';

const stageIds: StageId[] = ['overview', 'build', 'test', 'release', 'monitor', 'setup'];

export function AgentWorkspace() {
  const params = useParams();
  const agentId = params.agentId ?? '';
  const [stageParam, sectionParam] = (params['*'] ?? '').split('/') as [StageId, string | undefined];
  const stage: StageId = stageIds.includes(stageParam) ? stageParam : 'overview';
  const section: BuildSection = BUILD_SECTIONS.some((s) => s.id === sectionParam) ? (sectionParam as BuildSection) : 'agent';
  const navigate = useNavigate();
  const editor = useDraftEditor(agentId);
  // A change queued elsewhere for this agent (keep a call as a test, fix a call) lands in the draft, unsaved.
  usePendingChange(agentId, editor);
  // One answer to "is it ready, what next?" for the header, Overview, Build's menu, Release and the bar below.
  const readiness = useReadiness(editor);
  const { refreshAgent, loading } = useStudio();
  const [retrying, setRetrying] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const goToField = useCallback(
    (path: Path) => {
      navigate(targetPath(agentId, { stage: 'build', section: sectionOfPath(path) ?? 'agent' }));
      setFocusRequest({ path, nonce: Date.now() });
    },
    [agentId, navigate]
  );

  // Publish freezes the saved draft: with unsaved edits it asks to save first.
  const { ensureSaved } = editor;
  const openPublish = useCallback(async () => {
    if (await ensureSaved('Publish')) setPublishOpen(true);
  }, [ensureSaved]);
  // ?setting=, ?tool=, ?open=, ?show= and ?publish=1 open exactly what they name
  useDeepLink(editor, stage, section, openPublish);

  if (editor.agent?.loadError) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center" role="alert">
        <h1 className="text-lg font-semibold text-ink">{editor.agent.name} could not be loaded</h1>
        <p className="mt-1 text-sm text-muted">{editor.agent.loadError}</p>
        <p className="mt-1 text-sm text-muted">Nothing is shown or editable until the draft can be read from the server.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button
            variant="primary"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              await refreshAgent(agentId).finally(() => setRetrying(false));
            }}
          >
            {retrying ? 'Trying…' : 'Try again'}
          </Button>
          <Link to="/agents" className="inline-flex items-center px-3 text-sm font-medium text-accent hover:underline">Back to agents</Link>
        </div>
      </div>);

  }

  // A deep link opened before the agent list has arrived: not "not found" yet, just not read yet.
  if (!editor.agent && loading) return <WorkspaceSkeleton />;

  if (!editor.agent || !editor.config) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-lg font-semibold text-ink">Agent not found</h1>
        <p className="mt-1 text-sm text-muted">There’s no agent with the id “{agentId}”, or you don’t have access to it.</p>
        <Link to="/agents" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">Back to agents</Link>
      </div>);

  }

  return (
    <div className="flex min-h-screen flex-col">
      <AgentHeader editor={editor} onPublish={openPublish} readiness={readiness} stage={stage} />
      <TestDock editor={editor} stage={stage}>
        <ErrorBoundary fallbackTitle="An error occurred in this workspace stage">
          {stage === 'overview' && readiness && <OverviewStage editor={editor} state={readiness} onPublish={openPublish} />}
          {stage === 'setup' && <SetupWizard editor={editor} step={sectionParam} />}
          {stage === 'build' && <BuildStage editor={editor} section={section} readiness={readiness?.readiness ?? null} focusRequest={focusRequest} />}
          {stage === 'test' && <TestStage editor={editor} onGoToField={goToField} />}
          {stage === 'release' && <ReleaseStage editor={editor} onPublish={openPublish} ship={readiness?.ship ?? null} />}
          {stage === 'monitor' && <MonitorStage editor={editor} />}
        </ErrorBoundary>
      </TestDock>
      {readiness && stage !== 'setup' && <NextStepBar agentId={agentId} readiness={readiness.readiness} />}
      <ConflictDialog editor={editor} />
      <SaveFirstDialog editor={editor} />
      <LeaveGuard editor={editor} agentId={agentId} />
      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} editor={editor} onGoToField={goToField} gate={readiness?.gate ?? null} />
    </div>);

}

/** The agent header and a page body, in the shape they take once loaded. */
function WorkspaceSkeleton() {
  return (
    <div className="flex min-h-screen flex-col" aria-busy="true" aria-label="Loading the agent">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-3.5 lg:px-10">
          <div className="h-7 w-56 animate-pulse rounded bg-subtle" />
          <div className="mt-2.5 h-4 w-96 max-w-full animate-pulse rounded bg-subtle" />
          <div className="mt-4 flex gap-3">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-8 w-20 animate-pulse rounded bg-subtle" />)}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-10">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-subtle" />)}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-subtle" />
        </div>
      </div>
    </div>);

}
