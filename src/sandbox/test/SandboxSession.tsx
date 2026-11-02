// The door to Sandbox's test conversation for code outside src/sandbox: a few lines that load the simulated session
// (SimulatedSession.tsx, the imitation agent with it) only when they are drawn, which is only in Sandbox. The Live
// studio never carries the imitation.
import React, { Suspense, lazy } from 'react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import type { TestSession } from '../../hooks/useTestSession';

const SimulatedSession = lazy(() => import('./SimulatedSession'));

/** Holds the agent's test conversation in Sandbox (an imitation in this browser) and hands it to `children`. */
export function SandboxSession({ editor, children }: { editor: DraftEditor; children: (session: TestSession) => React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SimulatedSession editor={editor}>{children}</SimulatedSession>
    </Suspense>
  );
}
