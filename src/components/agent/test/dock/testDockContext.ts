import { createContext, useContext } from 'react';
import type { TestSession } from '../../../../hooks/useTestSession';

// The one test conversation of the open agent, shared by the Test page and the test panel beside other pages, so a
// conversation keeps going while the person moves between pages.

export interface TestDockValue {
  session: TestSession;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const TestDockContext = createContext<TestDockValue | null>(null);

/** The shared conversation and panel state, or null outside an agent's workspace. */
export const useTestDock = (): TestDockValue | null => useContext(TestDockContext);

/** Whether the panel was left open in this browser tab. */
export const DOCK_KEY = 'weave_test_dock';
