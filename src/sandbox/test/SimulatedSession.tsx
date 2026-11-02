// Sandbox's test conversation for one agent's pages (loaded only in Sandbox, see SandboxSession.tsx), handed to
// `children`: for a draft wired to the banking gateway a banking conversation (src/sandbox/banking), otherwise the
// simulated session, both on the editor's current contents. When a conversation ends it is kept as one of the agent's
// calls, so it shows on the Calls page and in the trace, and the bell says so (Weave React's AgentWorkspace
// handleFinished and Dashboard recordSession).
import React, { useCallback, useRef, useState } from 'react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import type { TestSession } from '../../hooks/useTestSession';
import { useStudio } from '../../contexts/StudioContext';
import { callPath } from '../../utils/routes';
import { useDraftConfig } from './draftConfig';
import { usesGateway } from '../../models/bankingTools';
import { sandboxRecordConversation } from '../sandboxApi';
import { useBankingConversation } from '../banking/useBankingConversation';
import { useSimulatedSession } from './useSimulatedSession';
import { TEST_CHANNEL_LABEL, conversationToKeep, sessionNotification, versionLabelOf, type FinishedConversation } from './simulatedConversation';

export interface SimulatedSessionProps {
  editor: DraftEditor;
  children: (session: TestSession) => React.ReactNode;
}

export default function SimulatedSession({ editor, children }: SimulatedSessionProps) {
  const { addNotification } = useStudio();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const agentId = editor.agent?.id ?? '';

  // The draft is the editor's contents, unsaved edits included; a version, "latest" or an environment is what was
  // published as it.
  const getConfig = useDraftConfig(editor);

  const onFinished = useCallback(
    (done: FinishedConversation) => {
      const keep = conversationToKeep(done);
      if (!keep) return;
      const callId = sandboxRecordConversation(done.agentId, keep);
      const line = sessionNotification({
        agentName: done.agentName,
        channelLabel: done.channelLabel ?? TEST_CHANNEL_LABEL,
        durationS: (done.endedAt - done.startedAt) / 1000,
        versionLabel: versionLabelOf(done.version),
        userMessages: done.lines.filter((m) => m.from === 'user').length,
      });
      addNotification({ type: 'test', status: 'success', ...line, ...(callId ? { link: callPath(done.agentId, callId) } : {}) });
    },
    [addNotification],
  );

  const options = { agentId, agentName: editor.agent?.name ?? agentId, getConfig, onFinished };
  const bankingDraft = usesGateway(editor.config);
  const simulated = useSimulatedSession(options);
  const banking = useBankingConversation({ ...options, wanted: bankingDraft });

  // Which one a conversation is: decided when it starts, by whether what it plays is wired to the banking gateway.
  // Before any starts, the draft decides (so the start screen says the right thing).
  const [playing, setPlaying] = useState<'banking' | 'simulated' | null>(null);
  const byDraft = bankingDraft ? 'banking' : 'simulated';
  const shown = playing && (playing === 'banking' ? banking : simulated).status !== 'idle' ? playing : byDraft;
  const start = useCallback(
    async (...args: Parameters<TestSession['start']>) => {
      const [, , ref = 'draft'] = args;
      let isBanking = usesGateway(editorRef.current.config);
      try {
        isBanking = usesGateway((await getConfig(ref)).config);
      } catch {
        // the session that starts says why the configuration could not be read
      }
      const [next, other] = isBanking ? [banking, simulated] : [simulated, banking];
      other.stop();
      setPlaying(isBanking ? 'banking' : 'simulated');
      await next.start(...args);
    },
    [banking, simulated, getConfig]
  );
  const session = shown === 'banking' ? banking : simulated;
  return <>{children({ ...session, start })}</>;
}
