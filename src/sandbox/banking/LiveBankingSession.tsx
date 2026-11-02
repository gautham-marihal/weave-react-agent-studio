// Live's test conversation (through components/agent/test/LiveTestSession). For a draft that is not wired to the
// banking gateway, the real agent and nothing else. For a banking draft, the real agent on the Agent Builder runtime,
// or a banking rehearsal on the mock bank played in this browser, the same rehearsal Sandbox has, so a banking agent
// works end to end in Live too. The rehearsal asks nothing of the gateway until the draft is a banking one.
// "Played by" chooses before a conversation starts. The real agent comes first, always: the rehearsal is not the agent
// (rule-based turns, the browser's voice) and is only played when the person chooses it. A rehearsal is not
// added to Calls, which in Live lists real calls only; the bell says it ended and why it is not there.
import React, { useCallback, useState } from 'react';
import { useStudio } from '../../contexts/StudioContext';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import type { PlayedBy, PlayedByChoice, TestSession } from '../../hooks/useTestSession';
import { useDraftConfig } from '../test/draftConfig';
import { sessionNotification, TEST_CHANNEL_LABEL, versionLabelOf, type FinishedConversation } from '../test/simulatedConversation';
import { useBankingConversation } from './useBankingConversation';

const RUNNING: ReadonlySet<TestSession['status']> = new Set(['connecting', 'waiting', 'live']);

export const PLAYED_BY_OPTIONS: PlayedByChoice['options'] = [
  { value: 'agent', label: 'The real agent' },
  { value: 'rehearsal', label: 'Banking rehearsal (mock bank)' },
];

/** Said in the bell when a Live rehearsal ends. */
export const REHEARSAL_NOT_IN_CALLS = 'A rehearsal on the mock bank: it is not added to Calls, which lists real calls.';

export interface LiveBankingSessionProps {
  editor: DraftEditor;
  /** The real agent's conversation (useTestSession), held by the caller so it lives on whichever is shown. */
  real: TestSession;
  /** The draft is wired to the banking gateway (models/bankingTools usesGateway). */
  banking: boolean;
  children: (session: TestSession) => React.ReactNode;
}

export default function LiveBankingSession({ editor, real, banking, children }: LiveBankingSessionProps) {
  const { addNotification } = useStudio();
  const getConfig = useDraftConfig(editor);
  const agentId = editor.agent?.id ?? '';

  const onFinished = useCallback(
    (done: FinishedConversation) => {
      const line = sessionNotification({
        agentName: done.agentName,
        channelLabel: done.channelLabel ?? TEST_CHANNEL_LABEL,
        durationS: (done.endedAt - done.startedAt) / 1000,
        versionLabel: versionLabelOf(done.version),
        userMessages: done.lines.filter((m) => m.from === 'user').length,
      });
      addNotification({ type: 'test', status: 'success', title: line.title, description: `${line.description} ${REHEARSAL_NOT_IN_CALLS}` });
    },
    [addNotification]
  );
  const rehearsal = useBankingConversation({ agentId, agentName: editor.agent?.name ?? agentId, getConfig, onFinished, wanted: banking, studio: 'live' });

  // A choice belongs to one agent: another agent opens on itself, never on a rehearsal chosen for the last one.
  const [chosenFor, setChosenFor] = useState<{ agentId: string; value: PlayedBy } | null>(null);
  const chosen = chosenFor?.agentId === agentId ? chosenFor.value : null;
  const setChosen = useCallback((value: PlayedBy) => setChosenFor({ agentId, value }), [agentId]);
  // A conversation that is running keeps the screen until it ends; otherwise the choice decides.
  const running: PlayedBy | null = RUNNING.has(real.status) ? 'agent' : RUNNING.has(rehearsal.status) ? 'rehearsal' : null;
  if (!banking && running !== 'rehearsal') return <>{children(real)}</>;
  // The agent itself (its own greeting, voice and model) unless the person chose the rehearsal.
  const shown = running ?? chosen ?? 'agent';
  const session = shown === 'agent' ? real : rehearsal;
  const playedBy: PlayedByChoice = { value: shown, options: PLAYED_BY_OPTIONS, onChange: setChosen };
  return <>{children({ ...session, playedBy })}</>;
}
