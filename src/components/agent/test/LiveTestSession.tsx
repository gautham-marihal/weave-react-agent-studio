// Live's test conversation for one agent's pages: the real agent on the Agent Builder runtime (useTestSession). For a
// draft wired to the banking gateway it also offers a banking rehearsal on the mock bank, the same one Sandbox has,
// chosen under "Played by" (src/sandbox/banking/LiveBankingSession, loaded when the agent's pages open, as Sandbox's
// session is). The tree is the same whether the draft is a banking one or not, so the pages under it are never
// remounted when it becomes one. The real agent's conversation is held here, so it carries on whichever is shown.
import React, { Suspense, lazy } from 'react';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { useTestSession, type TestSession } from '../../../hooks/useTestSession';
import { usesGateway } from '../../../models/bankingTools';

const LiveBankingSession = lazy(() => import('../../../sandbox/banking/LiveBankingSession'));

export function LiveTestSession({ editor, children }: { editor: DraftEditor; children: (session: TestSession) => React.ReactNode }) {
  const real = useTestSession(editor.agent?.id ?? '');
  return (
    <Suspense fallback={null}>
      <LiveBankingSession editor={editor} real={real} banking={usesGateway(editor.config)}>
        {children}
      </LiveBankingSession>
    </Suspense>
  );
}
