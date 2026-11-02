import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLinkIcon, MessageSquareIcon, XIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { StageId } from '../../../../types/studio';
import type { TestSession } from '../../../../hooks/useTestSession';
import { LiveTestSession } from '../LiveTestSession';
import { isSandbox } from '../../../../sandbox/mode';
import { SandboxSession } from '../../../../sandbox/test/SandboxSession';
import { cn } from '../../../../utils/styles';
import { TryPanel } from '../TryPanel';
import { DOCK_KEY, TestDockContext, type TestDockValue } from './testDockContext';
import { TestDockToggle } from './TestDockToggle';

// The test panel beside any page of the agent: talk to the agent while editing. It holds the agent's one test
// conversation for the whole workspace, so the conversation keeps going while the person moves between pages, and
// the Test page shows the same conversation. Mounted once in the agent workspace around the page body. The panel
// floats at the side of the page (the whole screen on a phone), so no page has to give up its width.

interface TestDockProps {
  editor: DraftEditor;
  stage: StageId;
  children: React.ReactNode;
  /** A floating "Try it" button when the panel is shut; off once the header carries its own toggle. */
  floatingToggle?: boolean;
}

const readOpen = () => {
  try {
    return sessionStorage.getItem(DOCK_KEY) === '1';
  } catch {
    return false;
  }
};

export function TestDock(props: TestDockProps) {
  // In Sandbox the conversation is an imitation answered in this browser (loaded only then); in Live, the real agent,
  // and for a banking agent a banking rehearsal on the mock bank as well.
  if (isSandbox()) return <SandboxSession editor={props.editor}>{(session) => <DockBody {...props} session={session} />}</SandboxSession>;
  return <LiveTestSession editor={props.editor}>{(session) => <DockBody {...props} session={session} />}</LiveTestSession>;
}

function DockBody({ editor, stage, children, floatingToggle = true, session }: TestDockProps & { session: TestSession }) {
  const agentId = editor.agent?.id ?? '';
  const [open, setOpenState] = useState(readOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      if (next) sessionStorage.setItem(DOCK_KEY, '1');
      else sessionStorage.removeItem(DOCK_KEY);
    } catch {
      // Storage blocked: the panel still opens and shuts for this page.
    }
  }, []);

  // Another agent opened in the same workspace: the conversation with the last one ends.
  const stopRef = useRef(session.stop);
  stopRef.current = session.stop;
  useEffect(() => () => stopRef.current(), [agentId]);

  const value: TestDockValue = { session, open, setOpen };
  // On the Test page the conversation is the page itself.
  const docked = open && stage !== 'test' && !!editor.config;
  const active = session.status === 'connecting' || session.status === 'waiting' || session.status === 'live';

  return (
    <TestDockContext.Provider value={value}>
      <div className="min-w-0 flex-1">{children}</div>
      {docked && (
        <aside
          aria-label="Test panel"
          className={cn(
            'fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-overlay',
            'sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(680px,calc(100vh-6rem))] sm:w-[400px] sm:rounded-xl',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <MessageSquareIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              <p className="truncate text-sm font-semibold text-ink">Try it</p>
              {active && <span className="h-2 w-2 shrink-0 rounded-full bg-success" title="A conversation is going" aria-label="A conversation is going" />}
            </div>
            <div className="flex items-center gap-1">
              <Link
                to={`/agents/${agentId}/test`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
                Full test page
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the test panel"
                className="rounded-md p-1.5 text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <XIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <TryPanel editor={editor} session={session} compact />
          </div>
          {active && <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">The conversation keeps going while you move between pages.</p>}
        </aside>
      )}
      {floatingToggle && !docked && stage !== 'test' && editor.config && (
        <div className="fixed bottom-5 right-5 z-30">
          <TestDockToggle floating />
        </div>
      )}
    </TestDockContext.Provider>
  );
}
