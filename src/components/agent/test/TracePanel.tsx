import React, { useMemo } from 'react';
import type { TraceEvent } from '../../../types/testConsole';
import { rowsFromTraceEvents } from '../../../models/trace';
import { TraceView } from '../../calls/TraceView';

// The Test stage's live trace: the call's own records as they stream in, notes about the test conversation, and (for
// drafts wired to the banking gateway) the gateway's timeline, all in the same view a finished call uses.
export function TracePanel({ trace, live = false }: { trace: TraceEvent[]; live?: boolean }) {
  const rows = useMemo(() => rowsFromTraceEvents(trace), [trace]);
  return (
    <TraceView
      rows={rows}
      live={live}
      fill
      title="Live trace"
      description="What the agent did behind each reply."
      emptyText="Start a conversation to see model calls, tools and forms here."
    />
  );
}
