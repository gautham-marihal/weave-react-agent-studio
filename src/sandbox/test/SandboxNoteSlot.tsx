// A place on a screen for the note about what is made up there. In Sandbox it loads the note (SandboxNote.tsx) when
// drawn. In Live it draws nothing, unless `always`: a conversation played in this browser (Live's banking rehearsal)
// says what it is in Live too.
import React, { Suspense, lazy } from 'react';
import { isSandbox } from '../mode';

export type SandboxNoteKind = 'test' | 'banking' | 'trace' | 'scenarios' | 'callers' | 'checks' | 'calls' | 'monitoring' | 'replay';

const SandboxNote = lazy(() => import('./SandboxNote'));

export function SandboxNoteSlot({ kind, className, always = false }: { kind: SandboxNoteKind; className?: string; always?: boolean }) {
  if (!isSandbox() && !always) return null;
  return (
    <Suspense fallback={null}>
      <SandboxNote kind={kind} className={className} />
    </Suspense>
  );
}
